/**
 * Student — belongs to exactly one Parent. Atomic batch registration
 * creates a Parent + N Students in a single transaction (plan §04.03).
 */
import type { Gender, Parent, CreateParentInput } from "./parent";
import type { PaymentPlan } from "./payment";
// `AcademicHistoryEntry`, `PromotionDecision`, and `PROMOTION_DECISION_LABELS_FR`
// are defined canonically in `./academic` (single source of truth per the
// Phase 4A consolidation directive). They are re-exported below for backward
// compatibility with callers importing them from `./student`.
import type {
  AcademicHistoryEntry,
  PromotionDecision,
} from "./academic";
import { PROMOTION_DECISION_LABELS_FR } from "./academic";

export type { Gender } from "./parent";
export type { PaymentPlan } from "./payment";
export type { AcademicHistoryEntry, PromotionDecision };
export { PROMOTION_DECISION_LABELS_FR };

export type AcademicLevel = "primaire" | "cem" | "lycee";
export type StudentStatus = "active" | "graduated" | "transferred" | "suspended" | "withdrawn";

/**
 * Granular grade level — the canonical pedagogical placement of a student.
 *
 * Drives tuition pricing per the official 2026-2027 fee schedule:
 *   - Preschool: `prescolaire_1`, `prescolaire_2`
 *   - Primary  : `1ap`, `2ap`, `3ap`, `4ap`, `5ap`
 *   - Middle    : `1am`, `2am`, `3am`, `4am`
 *   - High      : `1ere_annee`, `2eme_annee`, `3eme_annee`
 *
 * The legacy `level` + `gradeYear` pair is kept for backward-compatibility
 * with existing data and code paths; new code SHOULD prefer `gradeLevel`.
 * The two representations are interconvertible via `gradeLevelFromLevelYear`
 * and `levelYearFromGradeLevel`.
 */
export type GradeLevel =
  | "prescolaire_1"
  | "prescolaire_2"
  | "1ap"
  | "2ap"
  | "3ap"
  | "4ap"
  | "5ap"
  | "1am"
  | "2am"
  | "3am"
  | "4am"
  | "1ere_annee"
  | "2eme_annee"
  | "3eme_annee";

export const GRADE_LEVELS: readonly GradeLevel[] = [
  "prescolaire_1",
  "prescolaire_2",
  "1ap",
  "2ap",
  "3ap",
  "4ap",
  "5ap",
  "1am",
  "2am",
  "3am",
  "4am",
  "1ere_annee",
  "2eme_annee",
  "3eme_annee",
];

export const GRADE_LEVEL_LABELS_FR: Record<GradeLevel, string> = {
  prescolaire_1: "Préscolaire 01",
  prescolaire_2: "Préscolaire 02",
  "1ap": "1AP",
  "2ap": "2AP",
  "3ap": "3AP",
  "4ap": "4AP",
  "5ap": "5AP",
  "1am": "1AM",
  "2am": "2AM",
  "3am": "3AM",
  "4am": "4AM",
  "1ere_annee": "1ère Année",
  "2eme_annee": "2ème Année",
  "3eme_annee": "3ème Année",
};

/** Map a grade level to its academic level (primaire / cem / lycee). */
export function academicLevelFromGradeLevel(g: GradeLevel): AcademicLevel {
  switch (g) {
    case "prescolaire_1":
    case "prescolaire_2":
    case "1ap":
    case "2ap":
    case "3ap":
    case "4ap":
    case "5ap":
      return "primaire";
    case "1am":
    case "2am":
    case "3am":
    case "4am":
      return "cem";
    case "1ere_annee":
    case "2eme_annee":
    case "3eme_annee":
      return "lycee";
  }
}

/** Map a grade level to its 1-indexed year within its academic level. */
export function gradeYearFromGradeLevel(g: GradeLevel): number {
  switch (g) {
    case "prescolaire_1":
      return 0;
    case "prescolaire_2":
      return 0;
    case "1ap":
      return 1;
    case "2ap":
      return 2;
    case "3ap":
      return 3;
    case "4ap":
      return 4;
    case "5ap":
      return 5;
    case "1am":
      return 1;
    case "2am":
      return 2;
    case "3am":
      return 3;
    case "4am":
      return 4;
    case "1ere_annee":
      return 1;
    case "2eme_annee":
      return 2;
    case "3eme_annee":
      return 3;
  }
}

/** Inverse of `gradeYearFromGradeLevel` — best-effort fallback for legacy data. */
export function gradeLevelFromLevelYear(level: AcademicLevel, year: number): GradeLevel {
  if (level === "primaire") {
    if (year <= 0) return "prescolaire_2";
    switch (year) {
      case 1:
        return "1ap";
      case 2:
        return "2ap";
      case 3:
        return "3ap";
      case 4:
        return "4ap";
      default:
        return "5ap";
    }
  }
  if (level === "cem") {
    switch (year) {
      case 1:
        return "1am";
      case 2:
        return "2am";
      case 3:
        return "3am";
      default:
        return "4am";
    }
  }
  // lycee
  switch (year) {
    case 1:
      return "1ere_annee";
    case 2:
      return "2eme_annee";
    default:
      return "3eme_annee";
  }
}

export interface Student {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string; // ELV-2025-001234
  readonly parentId: string; // NOT NULL FK — plan §04.01
  readonly firstName: string;
  readonly lastName: string;
  /**
   * COMPLETE display name as imported (e.g. "BENALI Sara").
   * When non-null, UI shows this verbatim instead of `{firstName} {lastName}`.
   * Migration 0027.
   */
  readonly displayName: string | null;
  readonly gender: Gender;
  readonly birthDate: string; // ISO date
  readonly enrollmentDate: string; // ISO date
  readonly level: AcademicLevel;
  readonly gradeYear: number; // 1..5 (primaire) | 1..4 (cem) | 1..3 (lycee)
  /** Canonical granular grade level — preferred over `level` + `gradeYear`. */
  readonly gradeLevel: GradeLevel;
  readonly classId: string | null;
  readonly photoUrl: string | null;
  readonly medicalNotes: string | null;
  readonly transportTier: string | null;
  readonly status: StudentStatus;
  /**
   * Selected payment plan for this student's annual tuition.
   *
   * - `"full_annual"` → 1 charge + 1 installment for the net annual fee
   *                     (enables 10% early-bird discount when paid ≤ June 30).
   * - `"tranches"`    → 3 charges + 3 installments per `Prices.md` schedule.
   *
   * Defaults to `"tranches"` for new enrollments.
   */
  readonly paymentPlan: PaymentPlan;
  /**
   * Append-only academic history — one entry per completed academic year
   * (plan §04.07). Written by the batch promotion flow; rendered in the
   * student drawer's "Académique" tab.
   */
  readonly academicHistory?: readonly AcademicHistoryEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateStudentInput {
  readonly firstName: string;
  readonly lastName: string;
  /** Complete name. When omitted, derived from first+last. */
  readonly displayName?: string | null;
  readonly gender: Gender;
  readonly birthDate: string;
  readonly level: AcademicLevel;
  readonly gradeYear: number;
  /** Optional granular grade level. If omitted, derived from `level`+`gradeYear`. */
  readonly gradeLevel?: GradeLevel;
  readonly classId?: string | null;
  readonly medicalNotes?: string | null;
  readonly transportTier?: string | null;
  /** Payment plan — defaults to `"tranches"` when omitted. */
  readonly paymentPlan?: PaymentPlan;
}

/**
 * Partial update payload for an existing student.
 *
 * Extends the create input with lifecycle fields the edit form manages
 * (`status`, `academicHistory`) — previously `updateStudent` only accepted
 * `Partial<CreateStudentInput>`, which silently excluded the student status
 * from any edit flow.
 */
export interface UpdateStudentInput extends Partial<CreateStudentInput> {
  readonly status?: StudentStatus;
  readonly academicHistory?: readonly AcademicHistoryEntry[];
}

/**
 * Returns the COMPLETE student name for display.
 * Prefers `displayName` and falls back to `{firstName} {lastName}`.
 */
export function studentDisplayName(s: Pick<Student, "firstName" | "lastName" | "displayName">): string {
  const dn = (s.displayName ?? "").trim();
  if (dn) return dn;
  const composed = `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim();
  return composed || "—";
}

export interface BatchRegistrationInput {
  readonly parent: CreateParentInput;
  readonly students: readonly CreateStudentInput[];
  /**
   * Billing flags from the wizard's step 3 — when omitted the repository
   * applies its defaults (registration fee included, transport included).
   *
   * FIX (billing persistence): previously the wizard computed a full billing
   * summary (tuition + discounts + tranches + transport + registration fee)
   * but submitted only `{parent, students}` — no charges, ledger entries, or
   * installments were ever created, so new families started with a zero
   * balance despite the "Total facturé" shown in the review step.
   */
  readonly includeRegistration?: boolean;
  readonly includeTransport?: boolean;
  /** Calendar year the academic year starts (for due dates + discounts). */
  readonly academicYearStartYear?: number;
}

export interface BatchRegistrationResult {
  readonly parent: import("./parent").Parent;
  readonly students: readonly Student[];
}

// `AcademicHistoryEntry` is re-exported from `./academic` at the top of this
// file — see the import block above.

export const LEVEL_LABELS_FR: Record<AcademicLevel, string> = {
  primaire: "Primaire",
  cem: "CEM",
  lycee: "Lycée",
};

export const LEVEL_YEARS: Record<AcademicLevel, number> = {
  primaire: 5,
  cem: 4,
  lycee: 3,
};

export const STUDENT_STATUS_LABELS_FR: Record<StudentStatus, string> = {
  active: "Actif",
  graduated: "Diplômé",
  transferred: "Transféré",
  suspended: "Suspendu",
  withdrawn: "Retiré",
};

// `PROMOTION_DECISION_LABELS_FR` is re-exported from `./academic` at the top
// of this file. The canonical definition (with gender-neutral `Promu(e)` /
// `Diplômé(e)` / `Transféré(e)` labels) lives in `./academic`.
