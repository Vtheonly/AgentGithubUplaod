/**
 * Club validation unit tests (plan §05.07).
 *
 * Covers all validation rules + business-logic guards:
 *   - code/name/category/capacity format validation
 *   - duplicate code detection
 *   - enrollment capacity + already-active guards
 *   - archive / restore / delete preconditions
 */
import { describe, it, expect } from "vitest";
import {
  validateClubCode,
  validateClubName,
  validateClubCategory,
  validateClubCapacity,
  validateCreateClubInput,
  validateUpdateClubInput,
  validateEnrollMemberInput,
  validateWithdrawMemberInput,
  validateLogActivityInput,
  canEnrollMember,
  canArchiveClub,
  canRestoreClub,
  canDeleteClub,
  checkDuplicateClubCode,
} from "../../../domain/calc/clubs/validation";
import type { Club, ClubMembership } from "../../../domain/model/club";

const baseClub: Club = {
  id: "club-001",
  tenantId: "tenant-1",
  code: "CLUB-CHESS-01",
  name: "Club Échecs",
  description: null,
  category: "chess",
  capacity: 24,
  supervisorId: null,
  supervisorName: null,
  academicYearId: "ay-2025-2026",
  academicYearCode: "2025-2026",
  isActive: true,
  isArchived: false,
  createdAt: "2025-09-01T00:00:00Z",
  updatedAt: "2025-09-01T00:00:00Z",
};

const makeMember = (id: string, status: "active" | "withdrawn" = "active"): ClubMembership => ({
  id,
  tenantId: "tenant-1",
  clubId: "club-001",
  studentId: `stu-${id}`,
  studentName: `Student ${id}`,
  studentCode: `ELV-${id}`,
  enrolledAt: "2025-09-01T00:00:00Z",
  enrolledById: "usr-1",
  enrolledByName: "Admin",
  status,
  withdrawnAt: null,
  withdrawnReason: null,
  notes: null,
});

describe("Club Validation", () => {
  describe("validateClubCode", () => {
    it("accepts valid uppercase alphanumeric codes with dashes", () => {
      expect(validateClubCode("CLUB-CHESS-01").isValid).toBe(true);
      expect(validateClubCode("CLUB-01").isValid).toBe(true);
      expect(validateClubCode("ABC").isValid).toBe(true);
    });
    it("rejects empty / too short / too long", () => {
      expect(validateClubCode("").isValid).toBe(false);
      expect(validateClubCode("AB").isValid).toBe(false);
      expect(validateClubCode("A".repeat(41)).isValid).toBe(false);
    });
    it("rejects lowercase / special chars / spaces", () => {
      expect(validateClubCode("club-chess").isValid).toBe(false);
      expect(validateClubCode("CLUB CHESS").isValid).toBe(false);
      expect(validateClubCode("CLUB_CHESS").isValid).toBe(false);
      expect(validateClubCode("CLUB-CHESS!").isValid).toBe(false);
    });
  });

  describe("validateClubName", () => {
    it("accepts valid names", () => {
      expect(validateClubName("Club Échecs").isValid).toBe(true);
      expect(validateClubName("English Conversation Club").isValid).toBe(true);
    });
    it("rejects empty / too short / too long", () => {
      expect(validateClubName("").isValid).toBe(false);
      expect(validateClubName("AB").isValid).toBe(false);
      expect(validateClubName("A".repeat(121)).isValid).toBe(false);
    });
  });

  describe("validateClubCategory", () => {
    it("accepts known categories", () => {
      expect(validateClubCategory("chess").isValid).toBe(true);
      expect(validateClubCategory("english").isValid).toBe(true);
      expect(validateClubCategory("it").isValid).toBe(true);
      expect(validateClubCategory("sports_arts").isValid).toBe(true);
      expect(validateClubCategory("other").isValid).toBe(true);
    });
    it("rejects unknown categories", () => {
      expect(validateClubCategory("music" as never).isValid).toBe(false);
      expect(validateClubCategory("" as never).isValid).toBe(false);
    });
  });

  describe("validateClubCapacity", () => {
    it("accepts null (unlimited)", () => {
      expect(validateClubCapacity(null).isValid).toBe(true);
    });
    it("accepts positive integers", () => {
      expect(validateClubCapacity(1).isValid).toBe(true);
      expect(validateClubCapacity(50).isValid).toBe(true);
      expect(validateClubCapacity(1000).isValid).toBe(true);
    });
    it("rejects zero, negative, non-integer, too large", () => {
      expect(validateClubCapacity(0).isValid).toBe(false);
      expect(validateClubCapacity(-5).isValid).toBe(false);
      expect(validateClubCapacity(1.5).isValid).toBe(false);
      expect(validateClubCapacity(1001).isValid).toBe(false);
      expect(validateClubCapacity(NaN).isValid).toBe(false);
    });
  });

  describe("validateCreateClubInput", () => {
    it("accepts a complete valid input", () => {
      const res = validateCreateClubInput({
        code: "CLUB-CHESS-01",
        name: "Club Échecs",
        category: "chess",
        capacity: 24,
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      });
      expect(res.isValid).toBe(true);
      expect(res.errors.length).toBe(0);
    });
    it("accumulates all errors", () => {
      const res = validateCreateClubInput({
        code: "x",
        name: "",
        category: "music" as never,
        capacity: -1,
        academicYearId: "",
        academicYearCode: "",
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("validateUpdateClubInput", () => {
    it("accepts partial valid updates", () => {
      expect(validateUpdateClubInput({ name: "Nouveau nom" }).isValid).toBe(true);
      expect(validateUpdateClubInput({ capacity: 30 }).isValid).toBe(true);
    });
    it("rejects invalid updates", () => {
      expect(validateUpdateClubInput({ name: "" }).isValid).toBe(false);
      expect(validateUpdateClubInput({ capacity: -1 }).isValid).toBe(false);
    });
  });

  describe("canEnrollMember", () => {
    it("allows enrollment when club is active, not at capacity, student not already member", () => {
      const res = canEnrollMember(baseClub, [makeMember("001")], false);
      expect(res.isValid).toBe(true);
    });
    it("rejects enrollment in archived club", () => {
      const res = canEnrollMember(
        { ...baseClub, isArchived: true },
        [],
        false,
      );
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toMatch(/archivé/);
    });
    it("rejects enrollment in paused club (isActive=false)", () => {
      const res = canEnrollMember(
        { ...baseClub, isActive: false },
        [],
        false,
      );
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toMatch(/pause/);
    });
    it("rejects duplicate active membership", () => {
      const res = canEnrollMember(baseClub, [makeMember("001")], true);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toMatch(/déjà membre/);
    });
    it("rejects enrollment when capacity reached", () => {
      const fullClub = { ...baseClub, capacity: 2 };
      const members = [makeMember("001"), makeMember("002")];
      const res = canEnrollMember(fullClub, members, false);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toMatch(/Capacité/);
    });
    it("allows unlimited capacity (null)", () => {
      const unlimitedClub = { ...baseClub, capacity: null };
      const manyMembers = Array.from({ length: 100 }, (_, i) =>
        makeMember(String(i)),
      );
      const res = canEnrollMember(unlimitedClub, manyMembers, false);
      expect(res.isValid).toBe(true);
    });
  });

  describe("validateEnrollMemberInput / validateWithdrawMemberInput", () => {
    it("validates enroll input", () => {
      expect(
        validateEnrollMemberInput({
          clubId: "c1",
          studentId: "s1",
          enrolledById: "u1",
          enrolledByName: "Admin",
        }).isValid,
      ).toBe(true);
      expect(
        validateEnrollMemberInput({
          clubId: "",
          studentId: "",
          enrolledById: "",
          enrolledByName: "",
        }).isValid,
      ).toBe(false);
    });
    it("validates withdraw input", () => {
      expect(
        validateWithdrawMemberInput({
          membershipId: "m1",
          withdrawnById: "u1",
          withdrawnByName: "Admin",
        }).isValid,
      ).toBe(true);
    });
  });

  describe("validateLogActivityInput", () => {
    it("accepts a valid activity", () => {
      const res = validateLogActivityInput({
        clubId: "c1",
        title: "Séance 1",
        description: "Description",
        date: "2025-09-15T10:00:00Z",
        durationMinutes: 60,
        conductedById: "u1",
        conductedByName: "Admin",
        attendeeStudentIds: ["s1", "s2"],
      });
      expect(res.isValid).toBe(true);
    });
    it("rejects missing required fields", () => {
      const res = validateLogActivityInput({
        clubId: "",
        title: "",
        description: "",
        date: "",
        durationMinutes: 0,
        conductedById: "",
        conductedByName: "",
        attendeeStudentIds: [],
      });
      expect(res.isValid).toBe(false);
    });
    it("rejects duration > 24h", () => {
      const res = validateLogActivityInput({
        clubId: "c1",
        title: "T",
        description: "D",
        date: "2025-09-15",
        durationMinutes: 24 * 60 + 1,
        conductedById: "u1",
        conductedByName: "A",
        attendeeStudentIds: [],
      });
      expect(res.isValid).toBe(false);
    });
  });

  describe("canArchiveClub / canRestoreClub / canDeleteClub", () => {
    it("allows archive of non-archived club", () => {
      expect(canArchiveClub(baseClub, 5).isValid).toBe(true);
    });
    it("rejects archive of already-archived club", () => {
      expect(canArchiveClub({ ...baseClub, isArchived: true }, 0).isValid).toBe(false);
    });
    it("allows restore of archived club", () => {
      expect(canRestoreClub({ ...baseClub, isArchived: true }).isValid).toBe(true);
    });
    it("rejects restore of non-archived club", () => {
      expect(canRestoreClub(baseClub).isValid).toBe(false);
    });
    it("allows delete of empty club", () => {
      expect(canDeleteClub(baseClub, 0, 0).isValid).toBe(true);
    });
    it("rejects delete of club with memberships", () => {
      expect(canDeleteClub(baseClub, 1, 0).isValid).toBe(false);
    });
    it("rejects delete of club with activities", () => {
      expect(canDeleteClub(baseClub, 0, 1).isValid).toBe(false);
    });
  });

  describe("checkDuplicateClubCode", () => {
    it("passes when no conflict", () => {
      const res = checkDuplicateClubCode("CLUB-NEW", [baseClub]);
      expect(res.isValid).toBe(true);
    });
    it("fails on exact code conflict", () => {
      const res = checkDuplicateClubCode("CLUB-CHESS-01", [baseClub]);
      expect(res.isValid).toBe(false);
    });
    it("passes when conflict is on a different id (excludeId)", () => {
      const res = checkDuplicateClubCode(
        "CLUB-CHESS-01",
        [baseClub],
        "club-001",
      );
      expect(res.isValid).toBe(true);
    });
  });
});
