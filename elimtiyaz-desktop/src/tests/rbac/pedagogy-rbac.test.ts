/**
 * RBAC permission tests for the new pedagogy modules.
 *
 * Verifies that:
 *   - Each new permission exists in the Permission enum
 *   - Each role has the expected permission set
 *   - The FeatureRegistry exposes the new feature nodes with correct gating
 *   - Therapy records are filtered by confidentiality (psychology only)
 */
import { describe, it, expect } from "vitest";
import { Permission, DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import { Academics } from "../../core/rbac/feature-registry";
import {
  canViewPsychologicalFollowUp,
  canViewSpeechTherapyFollowUp,
} from "../../domain/calc/therapy/validation";
import type { PsychologicalFollowUp, SpeechTherapyFollowUp } from "../../domain/model/therapy";

describe("Pedagogy RBAC", () => {
  describe("New permissions exist", () => {
    it("defines ManageSchoolYears", () => {
      expect(Permission.ManageSchoolYears).toBe("manage_school_years");
    });
    it("defines Club permissions", () => {
      expect(Permission.ViewClubs).toBe("view_clubs");
      expect(Permission.ManageClubs).toBe("manage_clubs");
      expect(Permission.EnrollClubMembers).toBe("enroll_club_members");
      expect(Permission.LogClubActivities).toBe("log_club_activities");
    });
    it("defines Psychology permissions", () => {
      expect(Permission.ViewPsychology).toBe("view_psychology");
      expect(Permission.ManagePsychology).toBe("manage_psychology");
      expect(Permission.ConductPsychologySession).toBe("conduct_psychology_session");
      expect(Permission.CreatePsychologyReport).toBe("create_psychology_report");
    });
    it("defines Orthophonie permissions", () => {
      expect(Permission.ViewOrthophonie).toBe("view_orthophonie");
      expect(Permission.ManageOrthophonie).toBe("manage_orthophonie");
      expect(Permission.ConductOrthophonieSession).toBe("conduct_orthophonie_session");
    });
  });

  describe("SuperAdmin", () => {
    it("has ALL permissions (including therapy)", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.SuperAdmin];
      expect(perms.has(Permission.ManageSchoolYears)).toBe(true);
      expect(perms.has(Permission.ViewClubs)).toBe(true);
      expect(perms.has(Permission.ViewPsychology)).toBe(true);
      expect(perms.has(Permission.ManagePsychology)).toBe(true);
      expect(perms.has(Permission.ViewOrthophonie)).toBe(true);
      expect(perms.has(Permission.ManageOrthophonie)).toBe(true);
    });
  });

  describe("Manager", () => {
    it("has program oversight of clubs + therapy (view-only for therapy)", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.Manager];
      expect(perms.has(Permission.ManageSchoolYears)).toBe(true);
      expect(perms.has(Permission.ViewClubs)).toBe(true);
      expect(perms.has(Permission.ManageClubs)).toBe(true);
      expect(perms.has(Permission.ViewPsychology)).toBe(true);
      expect(perms.has(Permission.ViewOrthophonie)).toBe(true);
      // Managers do NOT have direct clinical access (conduct session)
      expect(perms.has(Permission.ManagePsychology)).toBe(false);
      expect(perms.has(Permission.ConductPsychologySession)).toBe(false);
      expect(perms.has(Permission.ManageOrthophonie)).toBe(false);
      expect(perms.has(Permission.ConductOrthophonieSession)).toBe(false);
    });
  });

  describe("Teacher", () => {
    it("can view clubs + log activities, but NOT therapy", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.Teacher];
      expect(perms.has(Permission.ViewClubs)).toBe(true);
      expect(perms.has(Permission.LogClubActivities)).toBe(true);
      expect(perms.has(Permission.ViewPsychology)).toBe(false);
      expect(perms.has(Permission.ViewOrthophonie)).toBe(false);
      expect(perms.has(Permission.ManageClubs)).toBe(false);
    });
  });

  describe("FinancialOfficer", () => {
    it("can view clubs (for billing context), but NOT therapy", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.FinancialOfficer];
      expect(perms.has(Permission.ViewClubs)).toBe(true);
      expect(perms.has(Permission.ViewPsychology)).toBe(false);
      expect(perms.has(Permission.ViewOrthophonie)).toBe(false);
      expect(perms.has(Permission.ManageClubs)).toBe(false);
    });
  });

  describe("SupportStaff", () => {
    it("can enroll club members, but NOT therapy", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.SupportStaff];
      expect(perms.has(Permission.ViewClubs)).toBe(true);
      expect(perms.has(Permission.EnrollClubMembers)).toBe(true);
      expect(perms.has(Permission.ViewPsychology)).toBe(false);
      expect(perms.has(Permission.ViewOrthophonie)).toBe(false);
    });
  });

  describe("Feature registry — Academics section", () => {
    it("exposes new feature nodes for clubs + therapy", () => {
      const childIds = (Academics.children ?? []).map((c) => c.id);
      expect(childIds).toContain("academics.school_years");
      expect(childIds).toContain("academics.clubs");
      expect(childIds).toContain("academics.psychology");
      expect(childIds).toContain("academics.orthophonie");
    });
  });

  describe("Therapy confidentiality filtering", () => {
    const standardFu: PsychologicalFollowUp = {
      id: "psy-1",
      tenantId: "t1",
      studentId: "stu-1",
      studentName: "X",
      studentCode: "ELV-1",
      psychologistId: "per-1",
      psychologistName: "Y",
      reason: "Motif",
      startDate: "2025-09-01",
      endDate: null,
      status: "active",
      confidentialityLevel: "standard",
      parentConsent: true,
      parentConsentDate: "2025-08-30",
      notes: null,
      academicYearId: "ay-1",
      academicYearCode: "2025-2026",
      createdAt: "2025-09-01",
      updatedAt: "2025-09-01",
    };

    const restrictedFu: PsychologicalFollowUp = {
      ...standardFu,
      id: "psy-2",
      confidentialityLevel: "restricted",
    };

    it("SuperAdmin sees both standard + restricted", () => {
      const session = {
        userId: "anyone",
        role: "super_admin",
        hasPermission: () => false,
      };
      expect(canViewPsychologicalFollowUp(standardFu, session)).toBe(true);
      expect(canViewPsychologicalFollowUp(restrictedFu, session)).toBe(true);
    });

    it("Manager sees both standard + restricted", () => {
      const session = {
        userId: "anyone",
        role: "manager",
        hasPermission: () => false,
      };
      expect(canViewPsychologicalFollowUp(standardFu, session)).toBe(true);
      expect(canViewPsychologicalFollowUp(restrictedFu, session)).toBe(true);
    });

    it("Assigned psychologist sees their own (restricted)", () => {
      const session = {
        userId: "per-1",
        role: "teacher",
        hasPermission: () => false,
      };
      expect(canViewPsychologicalFollowUp(restrictedFu, session)).toBe(true);
    });

    it("Teacher with ViewPsychology sees standard but NOT restricted", () => {
      const session = {
        userId: "other-user",
        role: "teacher",
        hasPermission: (perm: string) => perm === "view_psychology",
      };
      expect(canViewPsychologicalFollowUp(standardFu, session)).toBe(true);
      expect(canViewPsychologicalFollowUp(restrictedFu, session)).toBe(false);
    });

    it("Teacher WITHOUT ViewPsychology sees neither", () => {
      const session = {
        userId: "other-user",
        role: "teacher",
        hasPermission: () => false,
      };
      expect(canViewPsychologicalFollowUp(standardFu, session)).toBe(false);
      expect(canViewPsychologicalFollowUp(restrictedFu, session)).toBe(false);
    });

    it("Speech therapy: no confidentiality level — only role + permission + assignment", () => {
      const fu: SpeechTherapyFollowUp = {
        id: "ortho-1",
        tenantId: "t1",
        studentId: "stu-1",
        studentName: "X",
        studentCode: "ELV-1",
        therapistId: "per-2",
        therapistName: "Y",
        reason: "Motif",
        startDate: "2025-09-01",
        endDate: null,
        status: "active",
        parentConsent: true,
        parentConsentDate: "2025-08-30",
        notes: null,
        academicYearId: "ay-1",
        academicYearCode: "2025-2026",
        createdAt: "2025-09-01",
        updatedAt: "2025-09-01",
      };
      // SuperAdmin
      expect(
        canViewSpeechTherapyFollowUp(fu, {
          userId: "x",
          role: "super_admin",
          hasPermission: () => false,
        }),
      ).toBe(true);
      // Assigned therapist
      expect(
        canViewSpeechTherapyFollowUp(fu, {
          userId: "per-2",
          role: "teacher",
          hasPermission: () => false,
        }),
      ).toBe(true);
      // Random user with ViewOrthophonie
      expect(
        canViewSpeechTherapyFollowUp(fu, {
          userId: "x",
          role: "teacher",
          hasPermission: (p) => p === "view_orthophonie",
        }),
      ).toBe(true);
      // Random user without permission
      expect(
        canViewSpeechTherapyFollowUp(fu, {
          userId: "x",
          role: "teacher",
          hasPermission: () => false,
        }),
      ).toBe(false);
    });
  });
});
