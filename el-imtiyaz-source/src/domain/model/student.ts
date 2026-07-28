/**
 * Student — belongs to exactly one Parent. Atomic batch registration
 * creates a Parent + N Students in a single transaction (plan §04.03).
 */
import type { Gender, Parent, CreateParentInput } from "./parent";

export type { Gender } from "./parent";

export type AcademicLevel = "primaire" | "cem" | "lycee";
export type StudentStatus = "active" | "graduated" | "transferred" | "suspended" | "withdrawn";
export type PromotionDecision = "promoted" | "repeated" | "graduated" | "transferred";

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
