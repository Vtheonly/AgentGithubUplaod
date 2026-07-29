/**
 * Tests for the Excel import engine validators + coercer + dedupe.
 *
 * Validates the rule functions, the FieldCoercer's type dispatch, the
 * RowValidator's per-row orchestration (including monthlyArray), and the
 * UpsertMatcher's identity extraction.
 */
import { describe, it, expect } from "vitest";
import {
  required,
  phone,
  phoneList,
  normalizePhone,
  validatePhone,
  email,
  enumRule,
  parseNumber,
  positiveNumber,
  minLength,
  type RuleIssue,
} from "../../../infrastructure/excel/import-engine";
import { FieldCoercer, defaultCoercer, coerceRecord } from "../../../infrastructure/excel/import-engine/validators/field-coercer";
import { RowValidator } from "../../../infrastructure/excel/import-engine/validators/row-validator";
import { UpsertMatcher } from "../../../infrastructure/excel/import-engine/dedupe/upsert-matcher";
import { ETAT_SCHEMA, REF_SCHEMA } from "../../../infrastructure/excel/import-engine";
import type { FieldSpec, ImportSchema } from "../../../infrastructure/excel/import-engine/types";

function makeField(overrides: Partial<FieldSpec> = {}): FieldSpec {
  return {
    key: "test",
    header: "TEST",
    type: "string",
    required: false,
    ...overrides,
  };
}

describe("excel-import-engine / validator rules", () => {
  describe("required", () => {
    it("returns an issue when value is missing and field is required", () => {
      const field = makeField({ required: true });
      const issue = required(null, field);
      expect(issue).not.toBeNull();
      expect(issue?.rule).toBe("required");
    });

    it("returns null when value is present and field is required", () => {
      const field = makeField({ required: true });
      expect(required("value", field)).toBeNull();
    });

    it("returns null when field is optional and value is missing", () => {
      const field = makeField({ required: false });
      expect(required(null, field)).toBeNull();
    });

    it("treats empty string as missing", () => {
      const field = makeField({ required: true });
      expect(required("   ", field)).not.toBeNull();
    });
  });

  describe("phone / phoneList", () => {
    it("normalizePhone handles float-stored numbers", () => {
      // Excel stores phone numbers as floats — normalize should prepend the 0.
      expect(normalizePhone("799534750")).toBe("0799534750");
      expect(normalizePhone("0799534750")).toBe("0799534750");
    });

    it("validatePhone accepts Algerian mobile formats", () => {
      expect(validatePhone("0663701834").valid).toBe(true);
      expect(validatePhone("0770123456").valid).toBe(true);
      expect(validatePhone("+213570123456").valid).toBe(true);
      expect(validatePhone("00213663701834").valid).toBe(true);
    });

    it("validatePhone rejects invalid formats", () => {
      expect(validatePhone("123").valid).toBe(false);
      expect(validatePhone("abcdefgh").valid).toBe(false);
      expect(validatePhone("").valid).toBe(false);
    });

    it("phone returns null for a valid single number", () => {
      const field = makeField({ type: "phone" });
      expect(phone("0663701834", field)).toBeNull();
    });

    it("phoneList returns null for valid multi-value (slash-separated)", () => {
      const field = makeField({ type: "phoneList" });
      expect(phoneList("0663701834/0770123456", field)).toBeNull();
    });
  });

  describe("email", () => {
    it("returns null for a valid email", () => {
      const field = makeField({ type: "email" });
      expect(email("user@example.com", field)).toBeNull();
    });

    it("returns an issue for an invalid email", () => {
      const field = makeField({ type: "email" });
      const issue = email("not-an-email", field);
      expect(issue).not.toBeNull();
      expect(issue?.rule).toBe("email");
    });
  });

  describe("enumRule", () => {
    it("returns null when value is in the enum (case-insensitive)", () => {
      const field = makeField({ type: "enum", values: ["PRIM", "CEM", "LYC"] });
      expect(enumRule("prim", field)).toBeNull();
      expect(enumRule("PRIM", field)).toBeNull();
      expect(enumRule("Prim", field)).toBeNull();
    });

    it("returns an issue when value is not in the enum", () => {
      const field = makeField({ type: "enum", values: ["PRIM", "CEM", "LYC"] });
      const issue = enumRule("invalid", field);
      expect(issue).not.toBeNull();
      expect(issue?.rule).toBe("enum");
    });

    it("returns null for empty value (let required handle it)", () => {
      const field = makeField({ type: "enum", values: ["PRIM"] });
      expect(enumRule("", field)).toBeNull();
    });
  });

  describe("parseNumber / positiveNumber", () => {
    it("parseNumber handles French decimal comma", () => {
      expect(parseNumber("12,5")).toBe(12.5);
      expect(parseNumber("1 234,56")).toBe(1234.56);
    });

    it("parseNumber strips currency symbols (DA, €, $)", () => {
      expect(parseNumber("100 DA")).toBe(100);
      expect(parseNumber("50€")).toBe(50);
      expect(parseNumber("$75")).toBe(75);
    });

    it("parseNumber returns {error: 'ref'} for #REF! formulas", () => {
      const result = parseNumber("#REF!");
      expect(result).toEqual({ error: "ref", raw: "#REF!" });
    });

    it("parseNumber returns null for empty string", () => {
      expect(parseNumber("")).toBeNull();
      expect(parseNumber("-")).toBeNull();
    });

    it("parseNumber returns {error: 'nan'} for non-numeric strings", () => {
      const result = parseNumber("abc");
      expect(result).toEqual({ error: "nan", raw: "abc" });
    });

    it("positiveNumber returns null when within range", () => {
      const field = makeField({ type: "number", min: 0, max: 100 });
      expect(positiveNumber(50, field)).toBeNull();
    });

    it("positiveNumber returns an issue when below min", () => {
      const field = makeField({ type: "number", min: 10 });
      const issue = positiveNumber(5, field);
      expect(issue).not.toBeNull();
      expect(issue?.rule).toBe("positiveNumber");
    });

    it("positiveNumber returns an issue when above max", () => {
      const field = makeField({ type: "number", max: 100 });
      const issue = positiveNumber(150, field);
      expect(issue).not.toBeNull();
    });
  });

  describe("minLength", () => {
    it("returns null when length is sufficient", () => {
      const field = makeField({ minLength: 3 });
      expect(minLength("hello", field)).toBeNull();
    });

    it("returns an issue when length is insufficient", () => {
      const field = makeField({ minLength: 5 });
      const issue = minLength("hi", field);
      expect(issue).not.toBeNull();
      expect(issue?.rule).toBe("minLength");
    });

    it("returns null for empty value (let required handle it)", () => {
      const field = makeField({ minLength: 5 });
      expect(minLength("", field)).toBeNull();
    });
  });
});

describe("excel-import-engine / FieldCoercer", () => {
  const coercer = new FieldCoercer();

  describe("isExcelError", () => {
    it("detects #REF! errors", () => {
      expect(coercer.isExcelError("#REF!")).toBe(true);
      expect(coercer.isExcelError("#N/A")).toBe(true);
      expect(coercer.isExcelError("#VALUE!")).toBe(true);
      expect(coercer.isExcelError("#DIV/0!")).toBe(true);
    });

    it("returns false for normal strings", () => {
      expect(coercer.isExcelError("hello")).toBe(false);
      expect(coercer.isExcelError("123")).toBe(false);
      expect(coercer.isExcelError(null)).toBe(false);
    });
  });

  describe("coerce — string type", () => {
    it("trims and returns the string", () => {
      const field = makeField({ type: "string" });
      const result = coercer.coerce("  hello  ", field);
      expect(result.value).toBe("hello");
      expect(result.errors).toHaveLength(0);
    });

    it("applies uppercase transform", () => {
      const field = makeField({ type: "string", uppercase: true });
      const result = coercer.coerce("hello", field);
      expect(result.value).toBe("HELLO");
    });
  });

  describe("coerce — number type", () => {
    it("parses French-locale numbers", () => {
      const field = makeField({ type: "number" });
      const result = coercer.coerce("1 234,56", field);
      expect(result.value).toBe(1234.56);
    });

    it("returns an error for non-numeric strings", () => {
      const field = makeField({ type: "number" });
      const result = coercer.coerce("abc", field);
      expect(result.value).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].rule).toBe("number");
    });
  });

  describe("coerce — numberOrRef type", () => {
    it("tolerates #REF! as a warning (not error) — caught by excelError check", () => {
      const field = makeField({ type: "numberOrRef", required: false });
      const result = coercer.coerce("#REF!", field);
      // The excelError check fires first (before type dispatch), producing
      // a warning for optional fields. This is the correct behaviour —
      // #REF! in an optional numeric column should not block the import.
      expect(result.value).toBeNull();
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].rule).toBe("excelError");
    });

    it("returns error for #REF! in required numberOrRef field", () => {
      const field = makeField({ type: "numberOrRef", required: true });
      const result = coercer.coerce("#REF!", field);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].rule).toBe("excelError");
    });
  });

  describe("coerce — enum type", () => {
    it("uppercases valid enum values", () => {
      const field = makeField({ type: "enum", values: ["PRIM", "CEM"] });
      const result = coercer.coerce("prim", field);
      expect(result.value).toBe("PRIM");
    });

    it("returns an error for invalid enum values", () => {
      const field = makeField({ type: "enum", values: ["PRIM", "CEM"] });
      const result = coercer.coerce("invalid", field);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].rule).toBe("enum");
    });
  });

  describe("coerce — required + default", () => {
    it("returns error for missing required field", () => {
      const field = makeField({ type: "string", required: true });
      const result = coercer.coerce(null, field);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].rule).toBe("required");
      expect(result.value).toBeNull();
    });

    it("returns default value for missing optional field", () => {
      const field = makeField({ type: "number", required: false, default: 0 });
      const result = coercer.coerce(null, field);
      expect(result.value).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("coerce — Excel error handling", () => {
    it("returns error for #REF! in required field", () => {
      const field = makeField({ type: "string", required: true });
      const result = coercer.coerce("#REF!", field);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].rule).toBe("excelError");
    });

    it("returns warning for #REF! in optional field", () => {
      const field = makeField({ type: "string", required: false });
      const result = coercer.coerce("#REF!", field);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe("coerceRecord", () => {
    it("coerces all fields in a record", () => {
      const fields: FieldSpec[] = [
        makeField({ key: "name", header: "NAME", type: "string", required: true }),
        makeField({ key: "age", header: "AGE", type: "number", required: true, min: 0 }),
      ];
      const result = coerceRecord({ NAME: "Alice", AGE: "30" }, fields);
      expect(result.record.name).toBe("Alice");
      expect(result.record.age).toBe(30);
      expect(result.errors).toHaveLength(0);
    });
  });
});

describe("excel-import-engine / RowValidator", () => {
  describe("ETAT schema validation", () => {
    const validator = new RowValidator(ETAT_SCHEMA);

    it("validates a complete ETAT row", () => {
      const rawRow = {
        NEM: "0663701834",
        NOM: "ZIREG LEA",
        niveau: "PRIM",
        CLASSE: "CE1",
        "DEVIS ANNUEL": "54000",
      };
      const result = validator.validate(rawRow, 2);
      expect(result.skipped).toBe(false);
      expect(result.record.nom).toBe("ZIREG LEA");
      expect(result.record.niveau).toBe("PRIM");
      expect(result.record.devisAnnuel).toBe(54000);
    });

    it("rejects a row missing required NEM", () => {
      const rawRow = {
        NOM: "ZIREG LEA",
        niveau: "PRIM",
        CLASSE: "CE1",
        "DEVIS ANNUEL": "54000",
      };
      const result = validator.validate(rawRow, 3);
      expect(result.skipped).toBe(true);
      expect(result.errors.some((e) => e.rule === "required")).toBe(true);
    });

    it("rejects an invalid niveau enum value", () => {
      const rawRow = {
        NEM: "0663701834",
        NOM: "Test Student",
        niveau: "INVALID",
        CLASSE: "CE1",
        "DEVIS ANNUEL": "54000",
      };
      const result = validator.validate(rawRow, 4);
      expect(result.skipped).toBe(true);
      expect(result.errors.some((e) => e.rule === "enum")).toBe(true);
    });

    it("coerces NEM phoneList (multi-value)", () => {
      const rawRow = {
        NEM: "0663701834/0770123456",
        NOM: "Test",
        niveau: "PRIM",
        CLASSE: "CE1",
        "DEVIS ANNUEL": "10000",
      };
      const result = validator.validate(rawRow, 5);
      expect(result.skipped).toBe(false);
      expect(Array.isArray(result.record.nem)).toBe(true);
      expect((result.record.nem as string[]).length).toBe(2);
    });

    it("aggregates monthlyArray for REGLEMENTS DETTES", () => {
      const rawRow: Record<string, unknown> = {
        NEM: "0663701834",
        NOM: "Test",
        niveau: "PRIM",
        CLASSE: "CE1",
        "DEVIS ANNUEL": "10000",
        "REGLEMENTS DETTES": null,
        sep: "1000",
        oct: "2000",
        nov: "3000",
        dec: "0",
        jan: "0",
        feb: "0",
        mar: "0",
        apr: "0",
        may: "0",
        jun: "0",
        jul: "0",
        aug: "0",
      };
      const result = validator.validate(rawRow, 6);
      expect(result.skipped).toBe(false);
      const reglements = result.record.reglements as Record<string, number>;
      expect(reglements.sep).toBe(1000);
      expect(reglements.oct).toBe(2000);
      expect(reglements.nov).toBe(3000);
      expect(reglements.dec).toBe(0);
    });
  });

  describe("REF schema validation", () => {
    const validator = new RowValidator(REF_SCHEMA);

    it("validates a REF row with synthetic A/B/D headers", () => {
      const rawRow = {
        A: "Professeur Test",
        B: "CE1",
        D: "Alger",
      };
      const result = validator.validate(rawRow, 1);
      expect(result.skipped).toBe(false);
      expect(result.record.enseignant).toBe("Professeur Test");
      expect(result.record.classe).toBe("CE1");
      expect(result.record.localite).toBe("Alger");
    });
  });
});

describe("excel-import-engine / UpsertMatcher", () => {
  describe("ETAT schema matcher", () => {
    const matcher = new UpsertMatcher(ETAT_SCHEMA);

    it("extracts identity from NEM + NOM", () => {
      const record = {
        nem: ["0663701834"],
        nom: "ZIREG LEA",
      };
      const identity = matcher.extractIdentity(record);
      expect(identity).not.toBeNull();
      expect(identity?.nem).toBe("0663701834");
      expect(identity?.nom).toBe("ZIREG LEA");
    });

    it("joins phoneList arrays with comma in identity", () => {
      const record = {
        nem: ["0663701834", "0770123456"],
        nom: "Test",
      };
      const identity = matcher.extractIdentity(record);
      expect(identity?.nem).toBe("0663701834,0770123456");
    });

    it("returns null when any identity field is missing", () => {
      const record = {
        nem: ["0663701834"],
        // nom missing
      };
      const identity = matcher.extractIdentity(record);
      expect(identity).toBeNull();
    });

    it("strategy returns 'upsert'", () => {
      expect(matcher.strategy()).toBe("upsert");
    });

    it("sameIdentity returns true for matching records", () => {
      const a = { nem: ["0663701834"], nom: "Test" };
      const b = { nem: ["0663701834"], nom: "Test" };
      expect(matcher.sameIdentity(a, b)).toBe(true);
    });

    it("sameIdentity returns false for different records", () => {
      const a = { nem: ["0663701834"], nom: "Test" };
      const b = { nem: ["0770123456"], nom: "Test" };
      expect(matcher.sameIdentity(a, b)).toBe(false);
    });
  });

  describe("REF schema matcher", () => {
    const matcher = new UpsertMatcher(REF_SCHEMA);

    it("returns null identity (no identity fields)", () => {
      const record = { enseignant: "Test", classe: "CE1" };
      expect(matcher.extractIdentity(record)).toBeNull();
    });

    it("strategy returns 'insert'", () => {
      expect(matcher.strategy()).toBe("insert");
    });

    it("identityFields is empty", () => {
      expect(matcher.identityFields).toEqual([]);
    });
  });
});
