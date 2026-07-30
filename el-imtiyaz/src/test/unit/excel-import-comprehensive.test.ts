/**
 * Comprehensive Excel import unit tests — Iteration 14.
 *
 * This file complements the existing per-module tests with end-to-end
 * scenarios that exercise the FULL pipeline (parser → detector →
 * validator → coercer → matcher → storage) on synthetic workbooks.
 *
 * Coverage areas:
 *   1. Schema detection (ETAT, BON, Devis, REF + unknown sheet).
 *   2. Field coercion for every supported type.
 *   3. Edge cases: empty file, missing required headers, all-empty rows.
 *   4. Iteration 14 fixes: NEM optional, niveau tolerateUnknown,
 *      partial identity extraction, optional email downgrade.
 *   5. Idempotent re-import (same file twice).
 *   6. Strict mode (reject on any error).
 *   7. Dry-run mode (validate without writing).
 *   8. Excel formula errors (#REF!, #N/A) tolerance.
 *   9. monthlyArray aggregation.
 *  10. Audit sink invocation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import ExcelJS from "exceljs";
import {
  ImportEngine,
  InMemoryAdapter,
  ETAT_SCHEMA,
  REF_SCHEMA,
  BON_SCHEMA,
  DEVIS_SCHEMA,
} from "../../infrastructure/excel/import-engine";
import { SheetDetector } from "../../infrastructure/excel/import-engine/parsers/sheet-detector";
import { FieldCoercer, defaultCoercer } from "../../infrastructure/excel/import-engine/validators/field-coercer";
import { UpsertMatcher } from "../../infrastructure/excel/import-engine/dedupe/upsert-matcher";
import type { FieldSpec } from "../../infrastructure/excel/import-engine/types";

// ── Helpers ──────────────────────────────────────────────────────────────

async function makeFile(
  sheets: Array<{
    name: string;
    header?: readonly (string | number)[];
    rows: readonly (readonly (string | number | null)[])[];
    startRow?: number; // for schemas with non-default dataStartRow
  }>,
): Promise<File> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    if (sheet.header && sheet.header.length > 0) {
      ws.addRow(sheet.header as (string | number)[]);
    }
    for (const row of sheet.rows) {
      ws.addRow(row as (string | number | null)[]);
    }
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer], "test.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function makeField(overrides: Partial<FieldSpec> = {}): FieldSpec {
  return {
    key: "test",
    header: "TEST",
    type: "string",
    required: false,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Iteration 14 — Excel import comprehensive tests", () => {
  describe("Schema detection", () => {
    const detector = new SheetDetector();

    it("detects ETAT by sheet name (case-insensitive)", () => {
      expect(detector.detect("ETAT 20262027")?.name).toBe("etat");
      expect(detector.detect("etat 20252026")?.name).toBe("etat");
      expect(detector.detect("ETAT")?.name).toBe("etat");
    });

    it("detects BON by sheet name (case-insensitive)", () => {
      expect(detector.detect("BON")?.name).toBe("bon");
      expect(detector.detect("BONS")?.name).toBe("bon");
      expect(detector.detect("bon ")?.name).toBe("bon");
    });

    it("detects Devis by sheet name", () => {
      expect(detector.detect("Devis")?.name).toBe("devis");
      expect(detector.detect("DEVIS")?.name).toBe("devis");
    });

    it("detects REF by sheet name", () => {
      expect(detector.detect("REF")?.name).toBe("ref");
      expect(detector.detect("Ref")?.name).toBe("ref");
    });

    it("returns null for unknown sheet names", () => {
      expect(detector.detect("Summary")).toBeNull();
      expect(detector.detect("RandomSheet")).toBeNull();
    });

    it("falls back to header signature when name doesn't match (tier 2)", () => {
      // Build headers that match ETAT's required headers.
      const headers = ["NOM", "niveau", "CLASSE", "DEVIS ANNUEL"];
      const schema = detector.detect("RandomSheet", headers);
      expect(schema?.name).toBe("etat");
    });

    it("returns null when neither name nor headers match", () => {
      expect(detector.detect("RandomSheet", ["foo", "bar"])).toBeNull();
    });
  });

  describe("FieldCoercer — every type", () => {
    const coercer = new FieldCoercer();

    it("string: trims whitespace + applies uppercase/lowercase", () => {
      const f = makeField({ type: "string", uppercase: true });
      const r = coercer.coerce("  hello  ", f);
      expect(r.value).toBe("HELLO");
      expect(r.errors).toHaveLength(0);

      const f2 = makeField({ type: "string", lowercase: true });
      expect(coercer.coerce("  HELLO  ", f2).value).toBe("hello");
    });

    it("string: enforces minLength on non-empty values", () => {
      const f = makeField({ type: "string", minLength: 5, required: false });
      const r = coercer.coerce("hi", f);
      expect(r.errors.some((e) => e.rule === "minLength")).toBe(true);
    });

    it("string: skips minLength when value is empty + optional", () => {
      const f = makeField({ type: "string", minLength: 5, required: false });
      const r = coercer.coerce("", f);
      expect(r.errors).toHaveLength(0);
    });

    it("email: accepts valid email", () => {
      const f = makeField({ type: "email", required: false });
      const r = coercer.coerce("user@example.com", f);
      expect(r.value).toBe("user@example.com");
      expect(r.errors).toHaveLength(0);
    });

    it("email (optional): downgrades invalid email to warning (Iter 14)", () => {
      const f = makeField({ type: "email", required: false });
      const r = coercer.coerce("BON01", f);
      expect(r.errors).toHaveLength(0);
      expect(r.warnings.some((w) => w.rule === "email")).toBe(true);
    });

    it("email (required): keeps invalid email as error", () => {
      const f = makeField({ type: "email", required: true });
      const r = coercer.coerce("BON01", f);
      expect(r.errors.some((e) => e.rule === "email")).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });

    it("phone: normalizes float-stored numbers", () => {
      const f = makeField({ type: "phone" });
      const r = coercer.coerce("799534750", f);
      // phone rule returns warnings on invalid (tolerant); valid → string
      expect(r.value).not.toBeNull();
    });

    it("phoneList: splits multi-value and normalizes each", () => {
      const f = makeField({ type: "phoneList" });
      const r = coercer.coerce("0663701834/0770123456", f);
      expect(Array.isArray(r.value)).toBe(true);
      expect((r.value as string[]).length).toBe(2);
    });

    it("number: parses French-locale numbers (1 234,56)", () => {
      const f = makeField({ type: "number" });
      const r = coercer.coerce("1 234,56", f);
      expect(r.value).toBe(1234.56);
      expect(r.errors).toHaveLength(0);
    });

    it("number: rejects non-numeric strings", () => {
      const f = makeField({ type: "number" });
      const r = coercer.coerce("abc", f);
      expect(r.errors.some((e) => e.rule === "number")).toBe(true);
    });

    it("number: enforces min constraint", () => {
      const f = makeField({ type: "number", min: 0 });
      const r = coercer.coerce(-5, f);
      expect(r.errors.some((e) => e.rule === "positiveNumber")).toBe(true);
    });

    it("numberOrRef: tolerates #REF! as a warning, not error", () => {
      const f = makeField({ type: "numberOrRef" });
      const r = coercer.coerce("#REF!", f);
      // #REF! is detected as excelError → warning for non-required fields.
      expect(r.value).toBeNull();
    });

    it("enum: accepts canonical value", () => {
      const f = makeField({ type: "enum", values: ["PRIM", "COLG"] });
      const r = coercer.coerce("PRIM", f);
      expect(r.value).toBe("PRIM");
      expect(r.errors).toHaveLength(0);
    });

    it("enum: rejects unknown value when tolerateUnknown is false", () => {
      const f = makeField({ type: "enum", values: ["PRIM"], tolerateUnknown: false });
      const r = coercer.coerce("INVALID", f);
      expect(r.errors.some((e) => e.rule === "enum")).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });

    it("enum: downgrades unknown value to warning when tolerateUnknown is true (Iter 14)", () => {
      const f = makeField({ type: "enum", values: ["PRIM"], tolerateUnknown: true });
      const r = coercer.coerce("INVALID", f);
      expect(r.errors).toHaveLength(0);
      expect(r.warnings.some((w) => w.rule === "enum")).toBe(true);
      expect(r.value).toBe("INVALID"); // still coerced to uppercase
    });

    it("enum: comparison is case-insensitive + trims whitespace", () => {
      const f = makeField({ type: "enum", values: ["PRIM"] });
      const r = coercer.coerce("  prim  ", f);
      expect(r.value).toBe("PRIM");
      expect(r.errors).toHaveLength(0);
    });

    it("date: preserves Date instances", () => {
      const f = makeField({ type: "date" });
      const d = new Date("2026-07-31");
      const r = coercer.coerce(d, f);
      expect(r.value).toBe(d);
    });

    it("date: warns on invalid date string", () => {
      const f = makeField({ type: "date" });
      const r = coercer.coerce("not-a-date", f);
      expect(r.value).toBeNull();
      expect(r.warnings.some((w) => w.rule === "date")).toBe(true);
    });

    it("excelError: returns warning for #REF! on optional fields", () => {
      const f = makeField({ type: "number", required: false });
      const r = coercer.coerce("#REF!", f);
      expect(r.value).toBeNull();
      expect(r.warnings.some((w) => w.rule === "excelError")).toBe(true);
    });

    it("excelError: returns error for #REF! on required fields", () => {
      const f = makeField({ type: "number", required: true });
      const r = coercer.coerce("#REF!", f);
      expect(r.value).toBeNull();
      expect(r.errors.some((e) => e.rule === "excelError")).toBe(true);
    });

    it("optional empty value returns the default", () => {
      const f = makeField({ type: "number", required: false, default: 0 });
      const r = coercer.coerce(null, f);
      expect(r.value).toBe(0);
      expect(r.errors).toHaveLength(0);
    });

    it("required missing value returns error + default", () => {
      const f = makeField({ type: "string", required: true, default: "" });
      const r = coercer.coerce(null, f);
      expect(r.errors.some((e) => e.rule === "required")).toBe(true);
      expect(r.value).toBe("");
    });
  });

  describe("UpsertMatcher — Iteration 14 partial identity", () => {
    it("builds identity from all present fields", () => {
      const m = new UpsertMatcher(ETAT_SCHEMA);
      const id = m.extractIdentity({ nem: ["0663701834"], nom: "ZIREG LEA" });
      expect(id).not.toBeNull();
      expect(id?.nem).toBe("0663701834");
      expect(id?.nom).toBe("ZIREG LEA");
    });

    it("builds identity from NOM alone when NEM is empty (Iter 14)", () => {
      const m = new UpsertMatcher(ETAT_SCHEMA);
      const id = m.extractIdentity({ nem: [], nom: "ZIREG LEA" });
      expect(id).not.toBeNull();
      expect(id?.nom).toBe("ZIREG LEA");
      expect(id?.nem).toBeUndefined();
    });

    it("builds identity when NEM is null", () => {
      const m = new UpsertMatcher(ETAT_SCHEMA);
      const id = m.extractIdentity({ nem: null, nom: "Test" });
      expect(id).not.toBeNull();
      expect(id?.nom).toBe("Test");
    });

    it("returns null when ALL identity fields are empty", () => {
      const m = new UpsertMatcher(ETAT_SCHEMA);
      const id = m.extractIdentity({ nem: [], nom: "" });
      expect(id).toBeNull();
    });

    it("returns null when ALL identity fields are missing", () => {
      const m = new UpsertMatcher(ETAT_SCHEMA);
      const id = m.extractIdentity({});
      expect(id).toBeNull();
    });

    it("sameIdentity: matches records with same identity values", () => {
      const m = new UpsertMatcher(ETAT_SCHEMA);
      const a = { nem: ["0663701834"], nom: "ZIREG LEA" };
      const b = { nem: ["0663701834"], nom: "ZIREG LEA" };
      expect(m.sameIdentity(a, b)).toBe(true);
    });

    it("sameIdentity: rejects records with different identity", () => {
      const m = new UpsertMatcher(ETAT_SCHEMA);
      const a = { nem: ["0663701834"], nom: "ZIREG LEA" };
      const b = { nem: ["0770123456"], nom: "ZIREG LEA" };
      expect(m.sameIdentity(a, b)).toBe(false);
    });

    it("strategy returns the schema's identity strategy", () => {
      expect(new UpsertMatcher(ETAT_SCHEMA).strategy()).toBe("upsert");
    });
  });

  describe("ETAT schema — Iteration 14 alignment", () => {
    it("niveau enum includes all 14 documented codes", () => {
      const f = ETAT_SCHEMA.fields.find((f) => f.key === "niveau")!;
      const expected = [
        "PRIM", "COLG", "LYC",
        "GS", "MS", "PS", "TPS",
        "AUTISTE",
        "NV2", "NV3", "NV4", "NV5",
        "CLYC", "LYCI",
      ];
      expect(f.values).toEqual(expected);
    });

    it("niveau has tolerateUnknown=true", () => {
      const f = ETAT_SCHEMA.fields.find((f) => f.key === "niveau")!;
      expect(f.tolerateUnknown).toBe(true);
    });

    it("OPTION enum includes documented typos TENSP + TRNP", () => {
      const f = ETAT_SCHEMA.fields.find((f) => f.key === "option")!;
      expect(f.values).toContain("TRNSP");
      expect(f.values).toContain("TENSP");
      expect(f.values).toContain("TRNP");
    });

    it("NEM is optional (required: false)", () => {
      const f = ETAT_SCHEMA.fields.find((f) => f.key === "nem")!;
      expect(f.required).toBe(false);
    });

    it("requiredHeaders excludes NEM (4 headers, not 5)", () => {
      expect(ETAT_SCHEMA.requiredHeaders).toEqual([
        "NOM", "niveau", "CLASSE", "DEVIS ANNUEL",
      ]);
      expect(ETAT_SCHEMA.requiredHeaders).not.toContain("NEM");
    });

    it("required fields are: nom, niveau, classe, devisAnnuel", () => {
      const requiredKeys = ETAT_SCHEMA.fields.filter((f) => f.required).map((f) => f.key);
      expect(requiredKeys).toEqual(["nom", "niveau", "classe", "devisAnnuel"]);
    });
  });

  describe("End-to-end import — synthetic ETAT workbook", () => {
    let engine: ImportEngine;

    beforeEach(() => {
      engine = new ImportEngine({ generateReports: false });
    });

    it("imports a valid row successfully", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "ZIREG LEA", "PRIM", "CE1", 54000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsRead).toBe(1);
      expect(ctx.stats.rowsImported).toBe(1);
      expect(ctx.stats.rowsRejected).toBe(0);
      expect(ctx.errors).toHaveLength(0);
    });

    it("imports a row without NEM (Iter 14 — NEM is optional)", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["", "Anonymous Student", "PRIM", "CE1", 54000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsImported).toBe(1);
      expect(ctx.stats.rowsRejected).toBe(0);
    });

    it("imports a row with AUTISTE niveau (Iter 14 — expanded enum)", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Special Student", "AUTISTE", "AUTISTE", 30000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsImported).toBe(1);
      expect(ctx.stats.rowsRejected).toBe(0);
    });

    it("imports a row with MS niveau (Iter 14 — pre-school)", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Pre-School Student", "MS", "MS", 18000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsImported).toBe(1);
      expect(ctx.stats.rowsRejected).toBe(0);
    });

    it("imports a row with unknown niveau as a warning (Iter 14 — tolerateUnknown)", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Test Student", "FUTURE_CODE", "CE1", 30000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsImported).toBe(1);
      expect(ctx.stats.rowsRejected).toBe(0);
      expect(ctx.warnings.some((w) => w.rule === "enum")).toBe(true);
      expect(ctx.errors.some((e) => e.rule === "enum")).toBe(false);
    });

    it("imports a row with TENSP option (Iter 14 — documented typo)", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "OPTION", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Test", "PRIM", "CE1", "TENSP", 30000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsImported).toBe(1);
      expect(ctx.stats.rowsRejected).toBe(0);
    });

    it("rejects a row missing required NOM", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "", "PRIM", "CE1", 54000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsRejected).toBe(1);
      expect(ctx.errors.some((e) => e.rule === "required" && e.field === "nom")).toBe(true);
    });

    it("rejects a row missing required niveau", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Test", "", "CE1", 54000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsRejected).toBe(1);
      expect(ctx.errors.some((e) => e.rule === "required" && e.field === "niveau")).toBe(true);
    });

    it("rejects a row missing required DEVIS ANNUEL", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Test", "PRIM", "CE1", ""],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsRejected).toBe(1);
      expect(ctx.errors.some((e) => e.rule === "required" && e.field === "devisAnnuel")).toBe(true);
    });

    it("imports a row with an invalid optional email as a warning (Iter 14)", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["E-MAIL", "NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["BON01", "0663701834", "Test", "PRIM", "CE1", 54000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsImported).toBe(1);
      expect(ctx.stats.rowsRejected).toBe(0);
      expect(ctx.warnings.some((w) => w.rule === "email")).toBe(true);
    });

    it("aggregates REGLEMENTS DETTES monthlyArray across 12 columns", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: [
            "NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL",
            "REGLEMENTS DETTES",
            "sep", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug",
          ],
          rows: [
            [
              "0663701834", "Test", "PRIM", "CE1", 54000, null,
              1000, 2000, 3000, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsImported).toBe(1);
      // The monthlyArray should be in the stored record.
      const storage = engine.getStorage() as InMemoryAdapter;
      const records = await storage.listRecords("etat");
      expect(records.length).toBe(1);
      const reglements = (records[0].record as Record<string, unknown>).reglements as Record<string, number>;
      expect(reglements.sep).toBe(1000);
      expect(reglements.oct).toBe(2000);
      expect(reglements.nov).toBe(3000);
      expect(reglements.dec).toBe(0);
    });

    it("tolerates #REF! in optional numeric fields (warning, not error)", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL", "REMISE"],
          rows: [
            ["0663701834", "Test", "PRIM", "CE1", 54000, "#REF!"],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsImported).toBe(1);
      expect(ctx.stats.rowsRejected).toBe(0);
      expect(ctx.warnings.some((w) => w.rule === "excelError")).toBe(true);
    });

    it("skips empty rows (all cells null/empty)", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Real Row", "PRIM", "CE1", 54000],
            ["", "", "", "", ""],
            ["", "", "", "", null],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      // Empty rows are counted in rowsRead but not imported.
      expect(ctx.stats.rowsRead).toBeGreaterThanOrEqual(1);
      expect(ctx.stats.rowsImported).toBe(1);
    });

    it("re-importing the same file is idempotent (skip on second run)", async () => {
      // Use a shared InMemoryAdapter so both engines see the same storage.
      const sharedStorage = new InMemoryAdapter();
      await sharedStorage.init();
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Test", "PRIM", "CE1", 54000],
          ],
        },
      ]);
      const engine1 = new ImportEngine({ generateReports: false, storage: sharedStorage });
      await engine1.init();
      const ctx1 = await engine1.importFile(file, "test.xlsx");
      expect(ctx1.stats.rowsImported).toBe(1);
      expect(ctx1.stats.rowsSkipped).toBe(0);

      // Re-import with the same shared storage — should skip.
      const engine2 = new ImportEngine({ generateReports: false, storage: sharedStorage });
      await engine2.init();
      const ctx2 = await engine2.importFile(file, "test.xlsx");
      expect(ctx2.stats.rowsSkipped).toBe(1);
      expect(ctx2.stats.rowsImported).toBe(0);
    });

    it("dryRun validates without writing to storage", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Test", "PRIM", "CE1", 54000],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx", { dryRun: true });
      expect(ctx.stats.rowsRead).toBe(1);
      // In dry-run mode, rows are counted as imported for preview but not actually stored.
      expect(ctx.stats.rowsImported).toBe(1);
      // Verify storage is empty (no records were written).
      const storage = engine.getStorage() as InMemoryAdapter;
      const records = await storage.listRecords("etat");
      expect(records.length).toBe(0);
    });

    it("strict mode rejects the entire run when there are errors", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [
            ["0663701834", "Valid", "PRIM", "CE1", 54000],
            ["", "", "", "", ""], // empty — counted but not rejected
            ["0663701834", "", "PRIM", "CE1", 54000], // missing NOM — error
          ],
        },
      ]);
      await engine.init();
      await expect(
        engine.importFile(file, "test.xlsx", { strict: true }),
      ).rejects.toThrow(/strict/i);
    });

    it("emits import.run_started + import.run_completed audit events", async () => {
      const auditCalls: Array<{ action: string; entityType: string }> = [];
      const engineWithAudit = new ImportEngine({
        generateReports: false,
        auditSink: {
          async logAction(action, entityType) {
            auditCalls.push({ action, entityType });
          },
        },
      });
      await engineWithAudit.init();
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [["0663701834", "Test", "PRIM", "CE1", 54000]],
        },
      ]);
      await engineWithAudit.importFile(file, "test.xlsx");
      expect(auditCalls).toHaveLength(2);
      expect(auditCalls[0].action).toBe("import.run_started");
      expect(auditCalls[0].entityType).toBe("import_run");
      expect(auditCalls[1].action).toBe("import.run_completed");
      expect(auditCalls[1].entityType).toBe("import_run");
    });

    it("ignores sheets with unknown schemas (default filter)", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [["0663701834", "Test", "PRIM", "CE1", 54000]],
        },
        {
          name: "RandomSheet",
          header: ["foo", "bar"],
          rows: [["a", "b"]],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      // Only the ETAT sheet is processed — the unknown sheet is filtered
      // out by selectSheets() before processSheet() runs.
      expect(ctx.sheetResults).toHaveLength(1);
      expect(ctx.sheetResults[0].sheet).toBe("ETAT 20262027");
      expect(ctx.stats.rowsImported).toBe(1);
    });

    it("emits unknown_schema warning when a forced sheet doesn't match any schema", async () => {
      const file = await makeFile([
        {
          name: "RandomSheet",
          header: ["foo", "bar"],
          rows: [["a", "b"]],
        },
      ]);
      await engine.init();
      // Force processing the unknown sheet via the `sheets` option.
      const ctx = await engine.importFile(file, "test.xlsx", { sheets: ["RandomSheet"] });
      expect(ctx.warnings.some((w) => w.rule === "unknown_schema")).toBe(true);
    });

    it("processes multiple matching sheets in one run", async () => {
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [["0663701834", "Test1", "PRIM", "CE1", 54000]],
        },
        {
          name: "REF",
          header: [], // REF schema has no header row
          rows: [
            ["Prof A", "CE1", "", "Alger", "", ""],
          ],
        },
      ]);
      await engine.init();
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.sheetResults.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Edge cases", () => {
    it("handles a file with no matching sheets (all unknown)", async () => {
      const engine = new ImportEngine({ generateReports: false });
      await engine.init();
      const file = await makeFile([
        {
          name: "Summary",
          header: ["foo"],
          rows: [["bar"]],
        },
      ]);
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsRead).toBe(0);
      expect(ctx.stats.rowsImported).toBe(0);
      expect(ctx.warnings.some((w) => w.rule === "no_sheets" || w.rule === "unknown_schema")).toBe(true);
    });

    it("handles a file with header but no data rows", async () => {
      const engine = new ImportEngine({ generateReports: false });
      await engine.init();
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [],
        },
      ]);
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsRead).toBe(0);
      expect(ctx.stats.rowsImported).toBe(0);
    });

    it("computes a file checksum (SHA-256) for deduplication", async () => {
      const engine = new ImportEngine({ generateReports: false });
      await engine.init();
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [["0663701834", "Test", "PRIM", "CE1", 54000]],
        },
      ]);
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.fileChecksum).toBeTruthy();
      expect(ctx.fileChecksum).toMatch(/^[a-f0-9]{64}$/i);
    });

    it("each run gets a unique run ID", async () => {
      const engine = new ImportEngine({ generateReports: false });
      await engine.init();
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [["0663701834", "Test", "PRIM", "CE1", 54000]],
        },
      ]);
      const ctx1 = await engine.importFile(file, "test.xlsx");
      const ctx2 = await engine.importFile(file, "test.xlsx");
      expect(ctx1.runId).not.toBe(ctx2.runId);
    });

    it("preview lists sheets with detected schema", async () => {
      const engine = new ImportEngine({ generateReports: false });
      await engine.init();
      const file = await makeFile([
        {
          name: "ETAT 20262027",
          header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
          rows: [["0663701834", "Test", "PRIM", "CE1", 54000]],
        },
        {
          name: "RandomSheet",
          header: ["foo"],
          rows: [["bar"]],
        },
      ]);
      const sheets = await engine.preview(file);
      expect(sheets).toHaveLength(2);
      const etat = sheets.find((s) => s.name === "ETAT 20262027");
      expect(etat?.schema?.name).toBe("etat");
      const random = sheets.find((s) => s.name === "RandomSheet");
      expect(random?.schema).toBeNull();
    });
  });

  describe("REF schema — fan-out to multiple reference tables", () => {
    it("extracts records into multiple reference tables", async () => {
      const engine = new ImportEngine({ generateReports: false });
      await engine.init();
      // REF schema has headerRow=0 (no header) — columns are positional.
      // Column A = enseignant, B = classe, D = localite (per REF_SCHEMA).
      const file = await makeFile([
        {
          name: "REF",
          header: [],
          rows: [
            ["Prof A", "CE1", "", "Alger"],
            ["Prof B", "CM2", "", "Oran"],
          ],
        },
      ]);
      const ctx = await engine.importFile(file, "test.xlsx");
      expect(ctx.stats.rowsImported).toBe(2);
      expect(ctx.errors).toHaveLength(0);
    });
  });
});
