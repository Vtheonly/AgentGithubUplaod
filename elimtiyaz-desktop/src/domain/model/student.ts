/**
 * Student — belongs to exactly one Parent. Atomic batch registration
 * creates a Parent + N Students in a single transaction (plan §04.03).
 */
import type { Gender, Parent, CreateParentInput } from "./parent";

export type { Gender } from "./parent";

export type AcademicLevel = "primaire" | "cem" | "lycee";
export type StudentStatus = "active" | "graduated" | "transferred" | "suspended" | "withdrawn";
export type PromotionDecision = "promoted" | "repeated" | "graduated" | "transferred";

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
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateStudentInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly gender: Gender;
  readonly birthDate: string;
  readonly level: AcademicLevel;
  readonly gradeYear: number;
  /** Optional granular grade level. If omitted, derived from `level`+`gradeYear`. */
  readonly gradeLevel?: GradeLevel;
  readonly classId?: string | null;
  readonly medicalNotes?: string | null;
  readonly transportTier?: string | null;
}

export interface BatchRegistrationInput {
  readonly parent: CreateParentInput;
  readonly students: readonly CreateStudentInput[];
}

export interface BatchRegistrationResult {
  readonly parent: import("./parent").Parent;
  readonly students: readonly Student[];
}

export interface AcademicHistoryEntry {
  readonly academicYear: string;
  readonly level: AcademicLevel;
  readonly gradeYear: number;
  readonly classId: string | null;
  readonly className: string | null;
  readonly gpa: number;
  readonly rank: number | null;
  readonly decision: PromotionDecision;
  readonly narrative: string | null;
}

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

export const PROMOTION_DECISION_LABELS_FR: Record<PromotionDecision, string> = {
  promoted: "Promu",
  repeated: "Redouble",
  graduated: "Diplômé",
  transferred: "Transféré",
};
