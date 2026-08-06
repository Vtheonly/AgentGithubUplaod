/**
 * School year validation unit tests (plan §05.05).
 *
 * Covers:
 *   - Code format (AAAA-AAAA, year N + 1)
 *   - Date range validation (8-14 months)
 *   - Term structure validation
 *   - Lifecycle preconditions (archive / restore / delete / set-current)
 *   - Duplicate code detection
 */
import { describe, it, expect } from "vitest";
import {
  validateSchoolYearCode,
  validateSchoolYearLabel,
  validateSchoolYearDates,
  validateTermStructure,
  validateCreateSchoolYearInput,
  validateUpdateSchoolYearInput,
  canArchiveSchoolYear,
  canRestoreSchoolYear,
  canDeleteSchoolYear,
  canSetCurrentSchoolYear,
  checkDuplicateCode,
} from "../../../domain/calc/academics/school-year";
import type { AcademicYear } from "../../../domain/model/academic";

const baseYear: AcademicYear = {
  id: "ay-2025-2026",
  tenantId: "tenant-1",
  code: "2025-2026",
  label: "Année scolaire 2025-2026",
  startDate: "2025-09-01",
  endDate: "2026-06-30",
  termStructure: "trimester",
  isCurrent: true,
  isArchived: false,
};

describe("School Year Validation", () => {
  describe("validateSchoolYearCode", () => {
    it("accepts valid codes", () => {
      expect(validateSchoolYearCode("2025-2026").isValid).toBe(true);
      expect(validateSchoolYearCode("2026-2027").isValid).toBe(true);
      expect(validateSchoolYearCode("2025/2026").isValid).toBe(true);
    });
    it("rejects empty", () => {
      expect(validateSchoolYearCode("").isValid).toBe(false);
    });
    it("rejects bad format", () => {
      expect(validateSchoolYearCode("2025-26").isValid).toBe(false);
      expect(validateSchoolYearCode("2025_2026_2027").isValid).toBe(false);
      expect(validateSchoolYearCode("abc-defg").isValid).toBe(false);
    });
    it("rejects non-consecutive years", () => {
      expect(validateSchoolYearCode("2025-2027").isValid).toBe(false);
      expect(validateSchoolYearCode("2026-2025").isValid).toBe(false);
    });
  });

  describe("validateSchoolYearLabel", () => {
    it("accepts valid labels", () => {
      expect(validateSchoolYearLabel("Année scolaire 2025-2026").isValid).toBe(true);
    });
    it("rejects empty / too long", () => {
      expect(validateSchoolYearLabel("").isValid).toBe(false);
      expect(validateSchoolYearLabel("x".repeat(101)).isValid).toBe(false);
    });
  });

  describe("validateSchoolYearDates", () => {
    it("accepts valid school year range", () => {
      expect(
        validateSchoolYearDates("2025-09-01", "2026-06-30").isValid,
      ).toBe(true);
    });
    it("rejects end before start", () => {
      expect(
        validateSchoolYearDates("2026-06-30", "2025-09-01").isValid,
      ).toBe(false);
    });
    it("rejects too-short range", () => {
      expect(
        validateSchoolYearDates("2025-09-01", "2025-10-01").isValid,
      ).toBe(false);
    });
    it("rejects too-long range", () => {
      expect(
        validateSchoolYearDates("2025-09-01", "2027-09-02").isValid,
      ).toBe(false);
    });
  });

  describe("validateTermStructure", () => {
    it("accepts known structures", () => {
      expect(validateTermStructure("semester").isValid).toBe(true);
      expect(validateTermStructure("trimester").isValid).toBe(true);
      expect(validateTermStructure("quarter").isValid).toBe(true);
    });
    it("rejects unknown", () => {
      expect(validateTermStructure("quadrimester" as never).isValid).toBe(false);
    });
  });

  describe("validateCreateSchoolYearInput", () => {
    it("accepts valid input", () => {
      expect(
        validateCreateSchoolYearInput({
          code: "2026-2027",
          label: "Année scolaire 2026-2027",
          startDate: "2026-09-01",
          endDate: "2027-06-30",
          termStructure: "trimester",
        }).isValid,
      ).toBe(true);
    });
    it("accumulates errors", () => {
      const res = validateCreateSchoolYearInput({
        code: "bad",
        label: "",
        startDate: "",
        endDate: "",
        termStructure: "bad" as never,
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("validateUpdateSchoolYearInput", () => {
    it("requires both dates together", () => {
      expect(
        validateUpdateSchoolYearInput({ startDate: "2025-09-01" }).isValid,
      ).toBe(false);
      expect(
        validateUpdateSchoolYearInput({
          startDate: "2025-09-01",
          endDate: "2026-06-30",
        }).isValid,
      ).toBe(true);
    });
  });

  describe("canArchiveSchoolYear", () => {
    it("rejects archive of current year", () => {
      expect(canArchiveSchoolYear(baseYear, 0).isValid).toBe(false);
    });
    it("allows archive of non-current year", () => {
      expect(
        canArchiveSchoolYear({ ...baseYear, isCurrent: false }, 0).isValid,
      ).toBe(true);
    });
    it("allows archive with active classes (warn only)", () => {
      expect(
        canArchiveSchoolYear({ ...baseYear, isCurrent: false }, 5).isValid,
      ).toBe(true);
    });
    it("rejects archive of already-archived year", () => {
      expect(
        canArchiveSchoolYear({ ...baseYear, isCurrent: false, isArchived: true }, 0).isValid,
      ).toBe(false);
    });
  });

  describe("canRestoreSchoolYear", () => {
    it("allows restore of archived year", () => {
      expect(
        canRestoreSchoolYear({ ...baseYear, isArchived: true }).isValid,
      ).toBe(true);
    });
    it("rejects restore of non-archived year", () => {
      expect(canRestoreSchoolYear(baseYear).isValid).toBe(false);
    });
  });

  describe("canDeleteSchoolYear", () => {
    it("rejects delete of current year", () => {
      expect(canDeleteSchoolYear(baseYear, 0, 0).isValid).toBe(false);
    });
    it("rejects delete with classes", () => {
      expect(
        canDeleteSchoolYear({ ...baseYear, isCurrent: false }, 5, 0).isValid,
      ).toBe(false);
    });
    it("rejects delete with students", () => {
      expect(
        canDeleteSchoolYear({ ...baseYear, isCurrent: false }, 0, 5).isValid,
      ).toBe(false);
    });
    it("allows delete of empty non-current year", () => {
      expect(
        canDeleteSchoolYear({ ...baseYear, isCurrent: false }, 0, 0).isValid,
      ).toBe(true);
    });
  });

  describe("canSetCurrentSchoolYear", () => {
    it("allows setting non-archived year as current", () => {
      expect(canSetCurrentSchoolYear(baseYear).isValid).toBe(true);
    });
    it("rejects setting archived year as current", () => {
      expect(
        canSetCurrentSchoolYear({ ...baseYear, isArchived: true }).isValid,
      ).toBe(false);
    });
  });

  describe("checkDuplicateCode", () => {
    it("passes on no conflict", () => {
      expect(
        checkDuplicateCode("2027-2028", [baseYear]).isValid,
      ).toBe(true);
    });
    it("fails on conflict", () => {
      expect(
        checkDuplicateCode("2025-2026", [baseYear]).isValid,
      ).toBe(false);
    });
    it("passes when conflict is on same id (excludeId)", () => {
      expect(
        checkDuplicateCode("2025-2026", [baseYear], baseYear.id).isValid,
      ).toBe(true);
    });
  });
});
