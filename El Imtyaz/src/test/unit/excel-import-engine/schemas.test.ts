/**
 * Tests for the Excel import engine schemas.
 *
 * Validates the 4 ported schemas (ETAT, BON, Devis, REF) and the
 * schema registry's lookup helpers.
 */
import { describe, it, expect } from "vitest";
import {
  ETAT_SCHEMA,
  BON_SCHEMA,
  DEVIS_SCHEMA,
  REF_SCHEMA,
  SCHEMAS,
  findSchemaByName,
  findSchemaForSheet,
  listSchemas,
} from "../../../infrastructure/excel/import-engine";

describe("excel-import-engine / schemas", () => {
  describe("ETAT schema", () => {
    it("matches the canonical sheet name patterns", () => {
      expect(ETAT_SCHEMA.sheetMatchers.some((re) => re.test("ETAT"))).toBe(true);
      expect(ETAT_SCHEMA.sheetMatchers.some((re) => re.test("ETAT 20262027"))).toBe(true);
      expect(ETAT_SCHEMA.sheetMatchers.some((re) => re.test("etat 20252026"))).toBe(true);
      expect(ETAT_SCHEMA.sheetMatchers.some((re) => re.test("BON"))).toBe(false);
    });

    it("has identity on NEM + NOM with upsert strategy", () => {
      expect(ETAT_SCHEMA.identity.fields).toEqual(["NEM", "NOM"]);
      expect(ETAT_SCHEMA.identity.strategy).toBe("upsert");
    });

    it("requires the 4 canonical headers (NEM is optional per Iteration 14)", () => {
      // Iteration 14: NEM is no longer required — the business doc describes
      // it as "purely informational" and many valid students have no phone.
      expect(ETAT_SCHEMA.requiredHeaders).toEqual(["NOM", "niveau", "CLASSE", "DEVIS ANNUEL"]);
    });

    it("includes the monthlyArray field for REGLEMENTS DETTES", () => {
      const reglements = ETAT_SCHEMA.fields.find((f) => f.key === "reglements");
      expect(reglements).toBeDefined();
      expect(reglements?.type).toBe("monthlyArray");
      expect(reglements?.count).toBe(12);
      expect(reglements?.monthLabels).toEqual([
        "sep", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug",
      ]);
    });

    it("marks NOM, niveau, CLASSE, DEVIS ANNUEL as required (NEM is optional per Iteration 14)", () => {
      const requiredKeys = ETAT_SCHEMA.fields.filter((f) => f.required).map((f) => f.key);
      // Iteration 14: NEM moved to optional (real sheet has many rows without phone).
      expect(requiredKeys).toEqual(["nom", "niveau", "classe", "devisAnnuel"]);
    });

    it("uses phoneList type for NEM (multi-value phone)", () => {
      const nem = ETAT_SCHEMA.fields.find((f) => f.key === "nem");
      expect(nem?.type).toBe("phoneList");
    });
  });

  describe("BON schema", () => {
    it("matches BON and BONS sheet names", () => {
      expect(BON_SCHEMA.sheetMatchers.some((re) => re.test("BON"))).toBe(true);
      expect(BON_SCHEMA.sheetMatchers.some((re) => re.test("BONS"))).toBe(true);
      expect(BON_SCHEMA.sheetMatchers.some((re) => re.test("ETAT"))).toBe(false);
    });

    it("has header at row 10 with data starting row 12", () => {
      expect(BON_SCHEMA.headerRow).toBe(10);
      expect(BON_SCHEMA.dataStartRow).toBe(12);
    });

    it("uses numberOrRef for financial fields (tolerates #REF!)", () => {
      const devis = BON_SCHEMA.fields.find((f) => f.key === "devis");
      expect(devis?.type).toBe("numberOrRef");
      const totalVerse = BON_SCHEMA.fields.find((f) => f.key === "totalVerse");
      expect(totalVerse?.type).toBe("numberOrRef");
    });
  });

  describe("Devis schema", () => {
    it("matches DEVIS sheet names", () => {
      expect(DEVIS_SCHEMA.sheetMatchers.some((re) => re.test("DEVIS"))).toBe(true);
      expect(DEVIS_SCHEMA.sheetMatchers.some((re) => re.test("DEVIS 2026"))).toBe(true);
      expect(DEVIS_SCHEMA.sheetMatchers.some((re) => re.test("ETAT"))).toBe(false);
    });

    it("has identity on client + devisNumero", () => {
      expect(DEVIS_SCHEMA.identity.fields).toEqual(["client", "devisNumero"]);
      expect(DEVIS_SCHEMA.identity.strategy).toBe("upsert");
    });

    it("has header at row 13 (form-style layout)", () => {
      expect(DEVIS_SCHEMA.headerRow).toBe(13);
    });
  });

  describe("REF schema", () => {
    it("matches REF and REFERENCES sheet names", () => {
      expect(REF_SCHEMA.sheetMatchers.some((re) => re.test("REF"))).toBe(true);
      expect(REF_SCHEMA.sheetMatchers.some((re) => re.test("REFERENCES"))).toBe(true);
      expect(REF_SCHEMA.sheetMatchers.some((re) => re.test("ETAT"))).toBe(false);
    });

    it("uses headerRow=0 (sentinel for 'no header')", () => {
      expect(REF_SCHEMA.headerRow).toBe(0);
    });

    it("has empty identity with insert strategy", () => {
      expect(REF_SCHEMA.identity.fields).toEqual([]);
      expect(REF_SCHEMA.identity.strategy).toBe("insert");
    });

    it("defines extractAs for the 3 reference tables", () => {
      expect(REF_SCHEMA.extractAs).toBeDefined();
      expect(REF_SCHEMA.extractAs?.enseignant).toEqual({ table: "ref_enseignants", column: "nom" });
      expect(REF_SCHEMA.extractAs?.classe).toEqual({ table: "ref_classes", column: "code" });
      expect(REF_SCHEMA.extractAs?.localite).toEqual({ table: "ref_localites", column: "nom" });
    });
  });

  describe("schema registry", () => {
    it("SCHEMAS array contains all 4 schemas in detection precedence order", () => {
      expect(SCHEMAS).toHaveLength(4);
      expect(SCHEMAS.map((s) => s.name)).toEqual(["etat", "ref", "bon", "devis"]);
    });

    it("findSchemaByName returns the schema by exact name", () => {
      expect(findSchemaByName("etat")?.name).toBe("etat");
      expect(findSchemaByName("bon")?.name).toBe("bon");
      expect(findSchemaByName("devis")?.name).toBe("devis");
      expect(findSchemaByName("ref")?.name).toBe("ref");
      expect(findSchemaByName("unknown")).toBeUndefined();
    });

    it("findSchemaForSheet returns the first schema whose matchers hit", () => {
      expect(findSchemaForSheet("ETAT 20262027")?.name).toBe("etat");
      expect(findSchemaForSheet("REF")?.name).toBe("ref");
      expect(findSchemaForSheet("BON")?.name).toBe("bon");
      expect(findSchemaForSheet("DEVIS")?.name).toBe("devis");
      expect(findSchemaForSheet("UnknownSheet")).toBeUndefined();
    });

    it("listSchemas returns a lightweight summary", () => {
      const list = listSchemas();
      expect(list).toHaveLength(4);
      expect(list[0]).toEqual({ name: "etat", matchers: ETAT_SCHEMA.sheetMatchers });
    });
  });
});
