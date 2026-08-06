/**
 * Teacher + Timetable validation unit tests.
 *
 * Covers:
 *   - Teacher code format + status + maxWeeklyHours validation
 *   - Personnel reference requirement
 *   - Duplicate code / duplicate person+year detection
 *   - Subject assignment uniqueness + primary teacher conflict
 *   - Timetable: day validation, time range, conflict detection
 */
import { describe, it, expect } from "vitest";
import {
  validateTeacherCode,
  validateTeacherStatus,
  validateMaxWeeklyHours,
  validateCreateTeacherInput,
  validateUpdateTeacherInput,
  canCreateTeacher,
  checkDuplicateTeacherCode,
  checkDuplicateTeacherForYear,
  validateAssignTeacherSubjectInput,
  checkDuplicateAssignment,
  checkPrimaryTeacherConflict,
  validateDay,
  validateTimeRange,
  validateCreateTimetableEntryInput,
  validateUpdateTimetableEntryInput,
  detectTimetableConflict,
} from "../../../domain/calc/teacher/validation";
import type {
  Teacher,
  TeacherSubjectAssignment,
  TimetableEntry,
} from "../../../domain/model/teacher";

const baseTeacher: Teacher = {
  id: "tch-001",
  tenantId: "tenant-1",
  personnelId: "per-001",
  firstName: "Aïcha",
  lastName: "Bouhenni",
  code: "ENS-2026-001",
  academicYearId: "ay-2025-2026",
  academicYearCode: "2025-2026",
  status: "active",
  maxWeeklyHours: 24,
  qualifiedSubjectIds: ["sub-001"],
  createdAt: "2025-09-01T00:00:00Z",
  updatedAt: "2025-09-01T00:00:00Z",
};

const baseAssignment: TeacherSubjectAssignment = {
  id: "tsa-001",
  tenantId: "tenant-1",
  teacherId: "tch-001",
  subjectId: "sub-001",
  academicYearId: "ay-2025-2026",
  isPrimary: true,
  createdAt: "2025-09-01T00:00:00Z",
};

const baseTimetableEntry: TimetableEntry = {
  id: "tt-001",
  tenantId: "tenant-1",
  academicYearId: "ay-2025-2026",
  classId: "cls-001",
  teacherId: "tch-001",
  subjectId: "sub-001",
  day: "monday",
  startMinutes: 480,
  endMinutes: 540,
  room: "B12",
  notes: null,
  createdAt: "2025-09-01T00:00:00Z",
  updatedAt: "2025-09-01T00:00:00Z",
};

describe("Teacher Validation", () => {
  describe("validateTeacherCode", () => {
    it("accepts valid codes", () => {
      expect(validateTeacherCode("ENS-2026-001").isValid).toBe(true);
      expect(validateTeacherCode("T-001").isValid).toBe(true);
    });
    it("rejects empty / too short / too long / lowercase", () => {
      expect(validateTeacherCode("").isValid).toBe(false);
      expect(validateTeacherCode("AB").isValid).toBe(false);
      expect(validateTeacherCode("X".repeat(41)).isValid).toBe(false);
      expect(validateTeacherCode("ens-001").isValid).toBe(false);
    });
  });

  describe("validateTeacherStatus", () => {
    it("accepts known statuses", () => {
      expect(validateTeacherStatus("active").isValid).toBe(true);
      expect(validateTeacherStatus("on_leave").isValid).toBe(true);
      expect(validateTeacherStatus("inactive").isValid).toBe(true);
    });
    it("rejects unknown", () => {
      expect(validateTeacherStatus("fired" as never).isValid).toBe(false);
    });
  });

  describe("validateMaxWeeklyHours", () => {
    it("accepts 0-40", () => {
      expect(validateMaxWeeklyHours(0).isValid).toBe(true);
      expect(validateMaxWeeklyHours(20).isValid).toBe(true);
      expect(validateMaxWeeklyHours(40).isValid).toBe(true);
    });
    it("rejects negative / > 40 / non-finite", () => {
      expect(validateMaxWeeklyHours(-1).isValid).toBe(false);
      expect(validateMaxWeeklyHours(41).isValid).toBe(false);
      expect(validateMaxWeeklyHours(NaN).isValid).toBe(false);
    });
  });

  describe("validateCreateTeacherInput", () => {
    it("accepts valid input", () => {
      const res = validateCreateTeacherInput({
        personnelId: "per-001",
        code: "ENS-2026-001",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      });
      expect(res.isValid).toBe(true);
    });
    it("requires personnelId (person/account reference)", () => {
      const res = validateCreateTeacherInput({
        personnelId: "",
        code: "ENS-2026-001",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("personnel"))).toBe(true);
    });
    it("requires academicYearId", () => {
      const res = validateCreateTeacherInput({
        personnelId: "per-001",
        code: "ENS-2026-001",
        academicYearId: "",
        academicYearCode: "",
      });
      expect(res.isValid).toBe(false);
    });
  });

  describe("canCreateTeacher", () => {
    it("passes when personnel exists and is a teacher", () => {
      expect(canCreateTeacher(true, true).isValid).toBe(true);
    });
    it("fails when personnel doesn't exist", () => {
      expect(canCreateTeacher(false, false).isValid).toBe(false);
    });
    it("fails when personnel is not a teacher", () => {
      expect(canCreateTeacher(true, false).isValid).toBe(false);
    });
  });

  describe("checkDuplicateTeacherCode", () => {
    it("passes on unique code", () => {
      expect(checkDuplicateTeacherCode("ENS-2026-999", [baseTeacher]).isValid).toBe(true);
    });
    it("fails on duplicate", () => {
      expect(checkDuplicateTeacherCode("ENS-2026-001", [baseTeacher]).isValid).toBe(false);
    });
    it("passes when excluding same id", () => {
      expect(
        checkDuplicateTeacherCode("ENS-2026-001", [baseTeacher], "tch-001").isValid,
      ).toBe(true);
    });
  });

  describe("checkDuplicateTeacherForYear", () => {
    it("rejects same person + same year", () => {
      expect(
        checkDuplicateTeacherForYear("per-001", "ay-2025-2026", [baseTeacher]).isValid,
      ).toBe(false);
    });
    it("allows same person + different year", () => {
      expect(
        checkDuplicateTeacherForYear("per-001", "ay-2026-2027", [baseTeacher]).isValid,
      ).toBe(true);
    });
    it("allows different person + same year", () => {
      expect(
        checkDuplicateTeacherForYear("per-999", "ay-2025-2026", [baseTeacher]).isValid,
      ).toBe(true);
    });
  });
});

describe("Teacher ↔ Subject Assignment Validation", () => {
  describe("validateAssignTeacherSubjectInput", () => {
    it("accepts valid input", () => {
      expect(
        validateAssignTeacherSubjectInput({
          teacherId: "tch-001",
          subjectId: "sub-001",
          academicYearId: "ay-2025-2026",
        }).isValid,
      ).toBe(true);
    });
    it("requires all fields", () => {
      expect(
        validateAssignTeacherSubjectInput({
          teacherId: "",
          subjectId: "",
          academicYearId: "",
        }).isValid,
      ).toBe(false);
    });
  });

  describe("checkDuplicateAssignment", () => {
    it("rejects same teacher+subject+year", () => {
      expect(
        checkDuplicateAssignment(
          { teacherId: "tch-001", subjectId: "sub-001", academicYearId: "ay-2025-2026" },
          [baseAssignment],
        ).isValid,
      ).toBe(false);
    });
    it("allows different year", () => {
      expect(
        checkDuplicateAssignment(
          { teacherId: "tch-001", subjectId: "sub-001", academicYearId: "ay-2026-2027" },
          [baseAssignment],
        ).isValid,
      ).toBe(true);
    });
  });

  describe("checkPrimaryTeacherConflict", () => {
    it("rejects second primary for same subject+year", () => {
      // Existing: tch-001 is primary for sub-001
      // Try to make tch-002 primary for same sub-001 + same year
      expect(
        checkPrimaryTeacherConflict(
          "sub-001",
          "ay-2025-2026",
          "tch-002",
          [baseAssignment],
        ).isValid,
      ).toBe(false);
    });
    it("allows same teacher to remain primary", () => {
      expect(
        checkPrimaryTeacherConflict(
          "sub-001",
          "ay-2025-2026",
          "tch-001",
          [baseAssignment],
        ).isValid,
      ).toBe(true);
    });
    it("allows secondary (non-primary) assignments", () => {
      // No conflict check needed if isPrimary is false — but the helper
      // is only called when isPrimary=true. Verify it allows a second
      // teacher when there's no existing primary.
      const noPrimary: TeacherSubjectAssignment[] = [
        { ...baseAssignment, isPrimary: false },
      ];
      expect(
        checkPrimaryTeacherConflict("sub-001", "ay-2025-2026", "tch-002", noPrimary).isValid,
      ).toBe(true);
    });
  });
});

describe("Timetable Validation", () => {
  describe("validateDay", () => {
    it("accepts monday-friday", () => {
      expect(validateDay("monday").isValid).toBe(true);
      expect(validateDay("friday").isValid).toBe(true);
    });
    it("rejects weekend + unknown", () => {
      expect(validateDay("saturday" as never).isValid).toBe(false);
      expect(validateDay("sunday" as never).isValid).toBe(false);
      expect(validateDay("funday" as never).isValid).toBe(false);
    });
  });

  describe("validateTimeRange", () => {
    it("accepts 08:00-09:00 (480-540)", () => {
      expect(validateTimeRange(480, 540).isValid).toBe(true);
    });
    it("rejects end <= start", () => {
      expect(validateTimeRange(540, 540).isValid).toBe(false);
      expect(validateTimeRange(540, 480).isValid).toBe(false);
    });
    it("rejects outside school hours (before 07:00)", () => {
      expect(validateTimeRange(360, 420).isValid).toBe(false); // 06:00-07:00
    });
    it("allows up to 20:00 (1200 minutes)", () => {
      expect(validateTimeRange(1140, 1200).isValid).toBe(true); // 19:00-20:00
    });
    it("rejects after 20:00", () => {
      expect(validateTimeRange(1200, 1260).isValid).toBe(false); // 20:00-21:00
    });
    it("rejects non-integer minutes", () => {
      expect(validateTimeRange(480.5, 540).isValid).toBe(false);
    });
  });

  describe("validateCreateTimetableEntryInput", () => {
    it("accepts valid input", () => {
      const res = validateCreateTimetableEntryInput({
        academicYearId: "ay-2025-2026",
        classId: "cls-001",
        teacherId: "tch-001",
        subjectId: "sub-001",
        day: "monday",
        startMinutes: 480,
        endMinutes: 540,
      });
      expect(res.isValid).toBe(true);
    });
    it("requires teacherId (references Teacher entity)", () => {
      const res = validateCreateTimetableEntryInput({
        academicYearId: "ay-2025-2026",
        classId: "cls-001",
        teacherId: "",
        subjectId: "sub-001",
        day: "monday",
        startMinutes: 480,
        endMinutes: 540,
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Enseignant"))).toBe(true);
    });
  });

  describe("detectTimetableConflict", () => {
    it("detects same-teacher overlapping slot", () => {
      const existing = [baseTimetableEntry]; // monday 480-540
      const input = {
        academicYearId: "ay-2025-2026",
        classId: "cls-002", // different class
        teacherId: "tch-001", // SAME teacher
        subjectId: "sub-002",
        day: "monday" as const,
        startMinutes: 510, // overlaps 480-540
        endMinutes: 570,
      };
      expect(detectTimetableConflict(input, existing).isValid).toBe(false);
    });

    it("detects same-class overlapping slot", () => {
      const existing = [baseTimetableEntry]; // cls-001 monday 480-540
      const input = {
        academicYearId: "ay-2025-2026",
        classId: "cls-001", // SAME class
        teacherId: "tch-002", // different teacher
        subjectId: "sub-002",
        day: "monday" as const,
        startMinutes: 510,
        endMinutes: 570,
      };
      expect(detectTimetableConflict(input, existing).isValid).toBe(false);
    });

    it("allows non-overlapping same-teacher same-day", () => {
      const existing = [baseTimetableEntry]; // monday 480-540
      const input = {
        academicYearId: "ay-2025-2026",
        classId: "cls-002",
        teacherId: "tch-001",
        subjectId: "sub-002",
        day: "monday" as const,
        startMinutes: 540, // starts exactly when other ends — OK
        endMinutes: 600,
      };
      expect(detectTimetableConflict(input, existing).isValid).toBe(true);
    });

    it("allows same teacher on different day", () => {
      const existing = [baseTimetableEntry]; // monday 480-540
      const input = {
        academicYearId: "ay-2025-2026",
        classId: "cls-002",
        teacherId: "tch-001",
        subjectId: "sub-002",
        day: "tuesday" as const,
        startMinutes: 480,
        endMinutes: 540,
      };
      expect(detectTimetableConflict(input, existing).isValid).toBe(true);
    });

    it("allows same teacher + same time in different academic year", () => {
      const existing = [baseTimetableEntry]; // ay-2025-2026 monday 480-540
      const input = {
        academicYearId: "ay-2026-2027", // DIFFERENT year
        classId: "cls-001",
        teacherId: "tch-001",
        subjectId: "sub-001",
        day: "monday" as const,
        startMinutes: 480,
        endMinutes: 540,
      };
      expect(detectTimetableConflict(input, existing).isValid).toBe(true);
    });

    it("excludes self on update", () => {
      const existing = [baseTimetableEntry];
      // Update the same entry — should not conflict with itself
      expect(
        detectTimetableConflict(baseTimetableEntry, existing, "tt-001").isValid,
      ).toBe(true);
    });
  });
});
