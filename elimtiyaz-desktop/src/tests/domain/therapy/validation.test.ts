/**
 * Therapy validation unit tests (plan §05.07).
 *
 * Covers:
 *   - Reason / start-date / consent validation
 *   - Duration + session-date bounds
 *   - Create/update inputs for both Psyc + Orthophonie
 *   - "Only one active follow-up per therapist per student" rule
 *   - RBAC visibility helpers (canViewPsychologicalFollowUp etc.)
 */
import { describe, it, expect } from "vitest";
import {
  validateReason,
  validateStartDate,
  validateParentConsent,
  validateDurationMinutes,
  validateSessionDate,
  validateCreatePsychologicalFollowUpInput,
  validateUpdatePsychologicalFollowUpInput,
  validateConductPsychologicalSessionInput,
  validateCreatePsychologicalReportInput,
  validateCreateSpeechTherapyFollowUpInput,
  validateUpdateSpeechTherapyFollowUpInput,
  validateConductSpeechTherapyEvaluationInput,
  validateConductSpeechTherapySessionInput,
  canOpenPsychologicalFollowUp,
  canOpenSpeechTherapyFollowUp,
  canClosePsychologicalFollowUp,
  canCloseSpeechTherapyFollowUp,
  canViewPsychologicalFollowUp,
  canViewSpeechTherapyFollowUp,
} from "../../../domain/calc/therapy/validation";
import type {
  PsychologicalFollowUp,
  SpeechTherapyFollowUp,
} from "../../../domain/model/therapy";

const basePsyFu: PsychologicalFollowUp = {
  id: "psy-fu-001",
  tenantId: "tenant-1",
  studentId: "stu-001",
  studentName: "Amine Benali",
  studentCode: "ELV-001",
  psychologistId: "per-007",
  psychologistName: "Mme Leila Bensaïd",
  reason: "Anxiété scolaire signalée par l'enseignant",
  startDate: "2025-09-01",
  endDate: null,
  status: "active",
  confidentialityLevel: "standard",
  parentConsent: true,
  parentConsentDate: "2025-08-30",
  notes: null,
  academicYearId: "ay-2025-2026",
  academicYearCode: "2025-2026",
  createdAt: "2025-09-01T00:00:00Z",
  updatedAt: "2025-09-01T00:00:00Z",
};

const baseOrthoFu: SpeechTherapyFollowUp = {
  id: "ortho-fu-001",
  tenantId: "tenant-1",
  studentId: "stu-007",
  studentName: "Khaled Mokrani",
  studentCode: "ELV-007",
  therapistId: "per-008",
  therapistName: "Mme Amel Kaci",
  reason: "Troubles de l'articulation sur les sifflantes",
  startDate: "2025-09-01",
  endDate: null,
  status: "active",
  parentConsent: true,
  parentConsentDate: "2025-08-30",
  notes: null,
  academicYearId: "ay-2025-2026",
  academicYearCode: "2025-2026",
  createdAt: "2025-09-01T00:00:00Z",
  updatedAt: "2025-09-01T00:00:00Z",
};

describe("Therapy Validation", () => {
  describe("Common validators", () => {
    it("validateReason rejects short / empty / too long", () => {
      expect(validateReason("").isValid).toBe(false);
      expect(validateReason("court").isValid).toBe(false); // < 10 chars
      expect(validateReason("Motif suffisamment long").isValid).toBe(true);
      expect(validateReason("x".repeat(1001)).isValid).toBe(false);
    });
    it("validateStartDate rejects empty / invalid", () => {
      expect(validateStartDate("").isValid).toBe(false);
      expect(validateStartDate("not-a-date").isValid).toBe(false);
      expect(validateStartDate("2025-09-01").isValid).toBe(true);
    });
    it("validateParentConsent enforces consent + date", () => {
      expect(validateParentConsent(false, null).isValid).toBe(false);
      expect(validateParentConsent(true, null).isValid).toBe(false);
      expect(validateParentConsent(true, "2025-08-30").isValid).toBe(true);
    });
    it("validateDurationMinutes bounds 1min..8h", () => {
      expect(validateDurationMinutes(0).isValid).toBe(false);
      expect(validateDurationMinutes(45).isValid).toBe(true);
      expect(validateDurationMinutes(8 * 60).isValid).toBe(true);
      expect(validateDurationMinutes(8 * 60 + 1).isValid).toBe(false);
    });
    it("validateSessionDate rejects far-future dates", () => {
      expect(validateSessionDate("").isValid).toBe(false);
      const future = new Date();
      future.setFullYear(future.getFullYear() + 2);
      expect(validateSessionDate(future.toISOString()).isValid).toBe(false);
      expect(validateSessionDate("2025-09-15T10:00:00Z").isValid).toBe(true);
    });
  });

  describe("Psychology follow-up", () => {
    it("validates create input", () => {
      const res = validateCreatePsychologicalFollowUpInput({
        studentId: "stu-1",
        psychologistId: "per-1",
        psychologistName: "Dr Psych",
        reason: "Motif suffisamment long",
        startDate: "2025-09-01",
        parentConsent: true,
        parentConsentDate: "2025-08-30",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      });
      expect(res.isValid).toBe(true);
    });
    it("rejects create without consent", () => {
      const res = validateCreatePsychologicalFollowUpInput({
        studentId: "stu-1",
        psychologistId: "per-1",
        psychologistName: "Dr",
        reason: "Motif suffisamment long",
        startDate: "2025-09-01",
        parentConsent: false,
        parentConsentDate: null,
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("consentement"))).toBe(true);
    });
    it("canOpenPsychologicalFollowUp rejects duplicate active", () => {
      const existing = [basePsyFu];
      expect(
        canOpenPsychologicalFollowUp(existing, "per-007").isValid,
      ).toBe(false);
      expect(
        canOpenPsychologicalFollowUp(existing, "per-999").isValid,
      ).toBe(true);
    });
    it("canClosePsychologicalFollowUp rejects already-closed", () => {
      expect(canClosePsychologicalFollowUp(basePsyFu).isValid).toBe(true);
      expect(
        canClosePsychologicalFollowUp({ ...basePsyFu, status: "closed" }).isValid,
      ).toBe(false);
    });
  });

  describe("Psychology session + report", () => {
    it("validates session input", () => {
      const res = validateConductPsychologicalSessionInput({
        followUpId: "psy-fu-1",
        date: "2025-09-15T10:00:00Z",
        durationMinutes: 45,
        type: "follow_up",
        summary: "Séance productive",
        conductedById: "per-1",
        conductedByName: "Dr",
      });
      expect(res.isValid).toBe(true);
    });
    it("rejects session with bad type", () => {
      const res = validateConductPsychologicalSessionInput({
        followUpId: "psy-fu-1",
        date: "2025-09-15T10:00:00Z",
        durationMinutes: 45,
        type: "invalid" as never,
        summary: "x",
        conductedById: "per-1",
        conductedByName: "Dr",
      });
      expect(res.isValid).toBe(false);
    });
    it("validates report input", () => {
      const res = validateCreatePsychologicalReportInput({
        followUpId: "psy-fu-1",
        title: "Bilan T1",
        period: "T1 2025-2026",
        content: "Contenu du rapport",
        authoredById: "per-1",
        authoredByName: "Dr",
      });
      expect(res.isValid).toBe(true);
    });
  });

  describe("Speech therapy follow-up + evaluation + session", () => {
    it("validates create input", () => {
      const res = validateCreateSpeechTherapyFollowUpInput({
        studentId: "stu-1",
        therapistId: "per-1",
        therapistName: "Dr Ortho",
        reason: "Motif suffisamment long",
        startDate: "2025-09-01",
        parentConsent: true,
        parentConsentDate: "2025-08-30",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      });
      expect(res.isValid).toBe(true);
    });
    it("canOpenSpeechTherapyFollowUp rejects duplicate", () => {
      expect(canOpenSpeechTherapyFollowUp([baseOrthoFu], "per-008").isValid).toBe(false);
      expect(canOpenSpeechTherapyFollowUp([baseOrthoFu], "per-999").isValid).toBe(true);
    });
    it("validates evaluation input", () => {
      const res = validateConductSpeechTherapyEvaluationInput({
        followUpId: "ortho-fu-1",
        date: "2025-09-15",
        type: "initial",
        articulation: 55,
        fluency: 75,
        comprehension: 90,
        expression: 70,
        summary: "Évaluation initiale",
        conductedById: "per-1",
        conductedByName: "Dr",
      });
      expect(res.isValid).toBe(true);
    });
    it("rejects evaluation with out-of-bounds scores", () => {
      const res = validateConductSpeechTherapyEvaluationInput({
        followUpId: "ortho-fu-1",
        date: "2025-09-15",
        type: "initial",
        articulation: 150,
        fluency: -5,
        comprehension: null,
        expression: null,
        summary: "x",
        conductedById: "per-1",
        conductedByName: "Dr",
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Articulation"))).toBe(true);
      expect(res.errors.some((e) => e.includes("Fluence"))).toBe(true);
    });
    it("validates session input", () => {
      const res = validateConductSpeechTherapySessionInput({
        followUpId: "ortho-fu-1",
        date: "2025-09-15T10:00:00Z",
        durationMinutes: 30,
        exercises: "Exercices pratiqués",
        observations: "Observations",
        conductedById: "per-1",
        conductedByName: "Dr",
      });
      expect(res.isValid).toBe(true);
    });
    it("canCloseSpeechTherapyFollowUp rejects already-closed", () => {
      expect(canCloseSpeechTherapyFollowUp(baseOrthoFu).isValid).toBe(true);
      expect(
        canCloseSpeechTherapyFollowUp({ ...baseOrthoFu, status: "closed" }).isValid,
      ).toBe(false);
    });
  });

  describe("RBAC visibility helpers", () => {
    it("SuperAdmin always sees psychological follow-ups", () => {
      expect(
        canViewPsychologicalFollowUp(
          { ...basePsyFu, confidentialityLevel: "restricted" },
          {
            userId: "usr-other",
            role: "super_admin",
            hasPermission: () => false,
          },
        ),
      ).toBe(true);
    });
    it("Manager always sees psychological follow-ups", () => {
      expect(
        canViewPsychologicalFollowUp(
          { ...basePsyFu, confidentialityLevel: "restricted" },
          {
            userId: "usr-other",
            role: "manager",
            hasPermission: () => false,
          },
        ),
      ).toBe(true);
    });
    it("Assigned psychologist sees their own follow-up", () => {
      expect(
        canViewPsychologicalFollowUp(
          { ...basePsyFu, confidentialityLevel: "restricted" },
          {
            userId: "per-007",
            role: "teacher",
            hasPermission: () => false,
          },
        ),
      ).toBe(true);
    });
    it("Other staff cannot see restricted follow-ups", () => {
      expect(
        canViewPsychologicalFollowUp(
          { ...basePsyFu, confidentialityLevel: "restricted" },
          {
            userId: "usr-other",
            role: "teacher",
            hasPermission: (perm) => perm === "view_psychology",
          },
        ),
      ).toBe(false);
    });
    it("Other staff can see standard follow-ups with ViewPsychology permission", () => {
      expect(
        canViewPsychologicalFollowUp(
          { ...basePsyFu, confidentialityLevel: "standard" },
          {
            userId: "usr-other",
            role: "teacher",
            hasPermission: (perm) => perm === "view_psychology",
          },
        ),
      ).toBe(true);
    });
    it("Speech therapy: therapist sees their own follow-up", () => {
      expect(
        canViewSpeechTherapyFollowUp(baseOrthoFu, {
          userId: "per-008",
          role: "teacher",
          hasPermission: () => false,
        }),
      ).toBe(true);
    });
  });
});
