import { describe, it, expect } from "vitest";
import {
  mapNiveauCode,
  isKnownNiveauCode,
  listKnownNiveauCodes,
  DEFAULT_NIVEAU_MAPPING,
} from "../../../infrastructure/excel/import-engine/mappers/niveau-mapper";

describe("niveau-mapper", () => {
  describe("mapNiveauCode", () => {
    it("maps PRIM to primaire year 1", () => {
      const r = mapNiveauCode("PRIM");
      expect(r.academicLevel).toBe("primaire");
      expect(r.gradeYear).toBe(1);
      expect(r.gradeLevel).toBe("1ap");
    });

    it("maps COLG to cem year 1", () => {
      const r = mapNiveauCode("COLG");
      expect(r.academicLevel).toBe("cem");
      expect(r.gradeLevel).toBe("1am");
    });

    it("maps LYC to lycee year 1", () => {
      const r = mapNiveauCode("LYC");
      expect(r.academicLevel).toBe("lycee");
      expect(r.gradeLevel).toBe("1ere_annee");
    });

    it("maps pre-school codes to prescolaire slots", () => {
      expect(mapNiveauCode("GS").gradeLevel).toBe("prescolaire_2");
      expect(mapNiveauCode("MS").gradeLevel).toBe("prescolaire_2");
      expect(mapNiveauCode("PS").gradeLevel).toBe("prescolaire_1");
      expect(mapNiveauCode("TPS").gradeLevel).toBe("prescolaire_1");
    });

    it("maps AUTISTE to a neutral prescolaire slot", () => {
      const r = mapNiveauCode("AUTISTE");
      expect(r.academicLevel).toBe("primaire");
      expect(r.gradeYear).toBe(0);
    });

    it("maps lycée variants (CLYC, LYCI) to 1ere_annee", () => {
      expect(mapNiveauCode("CLYC").gradeLevel).toBe("1ere_annee");
      expect(mapNiveauCode("LYCI").gradeLevel).toBe("1ere_annee");
    });

    it("maps NV2-5 variants to year 1 of corresponding level", () => {
      expect(mapNiveauCode("NV2").academicLevel).toBe("primaire");
      expect(mapNiveauCode("NV3").academicLevel).toBe("cem");
      expect(mapNiveauCode("NV4").academicLevel).toBe("lycee");
      expect(mapNiveauCode("NV5").academicLevel).toBe("lycee");
    });

    it("normalizes input (trim + uppercase)", () => {
      expect(mapNiveauCode("  prim  ").gradeLevel).toBe("1ap");
      expect(mapNiveauCode("colg").gradeLevel).toBe("1am");
    });

    it("returns DEFAULT_NIVEAU_MAPPING for unknown codes (import no matter what)", () => {
      expect(mapNiveauCode("XYZ")).toEqual(DEFAULT_NIVEAU_MAPPING);
      expect(mapNiveauCode("FOO")).toEqual(DEFAULT_NIVEAU_MAPPING);
    });

    it("returns DEFAULT_NIVEAU_MAPPING for null/undefined/blank input", () => {
      expect(mapNiveauCode(null)).toEqual(DEFAULT_NIVEAU_MAPPING);
      expect(mapNiveauCode(undefined)).toEqual(DEFAULT_NIVEAU_MAPPING);
      expect(mapNiveauCode("")).toEqual(DEFAULT_NIVEAU_MAPPING);
      expect(mapNiveauCode("   ")).toEqual(DEFAULT_NIVEAU_MAPPING);
    });

    it("returns DEFAULT_NIVEAU_MAPPING for non-string input", () => {
      expect(mapNiveauCode(42)).toEqual(DEFAULT_NIVEAU_MAPPING);
      expect(mapNiveauCode({ foo: "bar" })).toEqual(DEFAULT_NIVEAU_MAPPING);
    });
  });

  describe("isKnownNiveauCode", () => {
    it("returns true for canonical codes", () => {
      expect(isKnownNiveauCode("PRIM")).toBe(true);
      expect(isKnownNiveauCode("prim")).toBe(true);
      expect(isKnownNiveauCode("  COLG  ")).toBe(true);
    });

    it("returns false for unknown codes", () => {
      expect(isKnownNiveauCode("XYZ")).toBe(false);
      expect(isKnownNiveauCode(null)).toBe(false);
      expect(isKnownNiveauCode(undefined)).toBe(false);
      expect(isKnownNiveauCode("")).toBe(false);
    });
  });

  describe("listKnownNiveauCodes", () => {
    it("returns a frozen array of all canonical codes", () => {
      const codes = listKnownNiveauCodes();
      expect(Object.isFrozen(codes)).toBe(true);
      expect(codes).toContain("PRIM");
      expect(codes).toContain("COLG");
      expect(codes).toContain("LYC");
      expect(codes).toContain("AUTISTE");
      expect(codes.length).toBeGreaterThanOrEqual(13);
    });
  });
});
