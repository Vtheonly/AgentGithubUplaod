/**
 * T-437 (GitHub issue #18 / ADR-031): the Re-enrollment domain model.
 *
 * The core distinction (academic-rules §10 / INV-21): Student = the same
 * person across all academic years; Enrollment = that student's registration
 * for ONE specific academic year. A re-enrollment NEVER creates a duplicate
 * person and NEVER re-registers a continuing student from scratch.
 *
 * This model is the desktop mirror of migration 0128's `re_enrollments`
 * table + RPC wire shapes. NO client-side business logic lives here — the
 * candidates come from `fn_generate_re_enrollment_candidates` (built on the
 * FINALIZED `student_academic_histories` rows — INV-22a: never a second
 * pass/fail engine), the decisions and the composite re-enrollment go
 * through the RPCs (INV-23/INV-25).
 */
import type { GradeLevel } from "./student";
import type { PaymentPlan } from "./payment";

/** INV-23a: the per-candidate decision state machine. */
export type ReEnrollmentStatus =
  | "waiting"
  | "started"
  | "re_enrolled"
  | "not_continuing";

export const RE_ENROLLMENT_STATUS_LABELS_FR: Record<ReEnrollmentStatus, string> = {
  waiting: "En attente de décision",
  started: "Réinscription commencée",
  re_enrolled: "Réinscrit",
  not_continuing: "Ne continue pas",
};

/** The finalized source-year result (copied from the history row at generation). */
export type ReEnrollmentFinalDecision =
  | "promoted"
  | "repeated"
  | "graduated"
  | "transferred";

/**
 * One row of the review worklist (`fn_get_re_enrollment_candidates`'s wire).
 * The source-year facts are the FINALIZED pedagogical results (INV-22a);
 * null `finalDecision` = the honest « non finalisé » state (INV-22b).
 */
export interface ReEnrollmentCandidate {
  readonly reEnrollmentId: string;
  readonly studentId: string;
  readonly studentCode: string;
  readonly studentFirstName: string;
  readonly studentLastName: string;
  readonly studentGradeLevel: string | null;
  readonly studentClassId: string | null;
  readonly parentId: string;
  readonly parentCode: string;
  readonly parentDisplayName: string;
  readonly parentPhone: string | null;
  readonly sourceAcademicYear: string;
  readonly targetAcademicYear: string;
  readonly sourceGradeLevelCode: string | null;
  readonly sourceClassName: string | null;
  readonly finalDecision: ReEnrollmentFinalDecision | null;
  readonly finalAverage: number | null;
  readonly expectedGradeLevelCode: string | null;
  readonly status: ReEnrollmentStatus;
  readonly targetClassId: string | null;
  readonly targetClassName: string | null;
  readonly decidedAt: string | null;
  readonly decidedByName: string | null;
  readonly reEnrolledAt: string | null;
  readonly installmentsWritten: number | null;
  readonly notes: string | null;
  readonly frozenAt: string | null;
  readonly createdAt: string;
}

/** The aggregate the UI renders (the worklist + the badge counts). */
export interface ReEnrollmentList {
  readonly candidates: readonly ReEnrollmentCandidate[];
  readonly waitingCount: number;
  readonly startedCount: number;
  readonly reEnrolledCount: number;
  readonly notContinuingCount: number;
  readonly totalCount: number;
  /** True when ANY row carries frozenAt (the freeze is list-wide). */
  readonly frozen: boolean;
}

export function reEnrollmentListFromCandidates(
  candidates: readonly ReEnrollmentCandidate[],
): ReEnrollmentList {
  const count = (s: ReEnrollmentStatus) =>
    candidates.filter((c) => c.status === s).length;
  return {
    candidates,
    waitingCount: count("waiting"),
    startedCount: count("started"),
    reEnrolledCount: count("re_enrolled"),
    notContinuingCount: count("not_continuing"),
    totalCount: candidates.length,
    frozen: candidates.some((c) => c.frozenAt !== null),
  };
}

/** fn_generate_re_enrollment_candidates' wire result. */
export interface GenerateCandidatesResult {
  readonly sourceAcademicYear: string;
  readonly targetAcademicYear: string;
  readonly candidatesWritten: number;
  readonly totalRows: number;
}

/** fn_set_re_enrollment_decision's accepted values (re_enrolled goes through reEnroll). */
export type ReEnrollmentDecisionInput = "waiting" | "started" | "not_continuing";

/**
 * INV-25 — the composite re-enrollment input. The billing legs stay
 * CLIENT-DERIVED (§15.39b — the canonical TS calc engine through the shared
 * billing-wire builder); the server fills the uuids and stamps
 * `academic_year_id` = target (INV-25c). The wire shapes are the EXACT
 * `register_family_batch` shapes (the shared builder guarantees it).
 */
export interface ReEnrollStudentInput {
  readonly reEnrollmentId: string;
  /** The confirmed target-year level (defaults to expectedGradeLevelCode). */
  readonly gradeLevelCode: GradeLevel;
  readonly classId: string | null;
  readonly paymentPlan: PaymentPlan;
  readonly transportTier: string | null;
  readonly installments: readonly Record<string, unknown>[];
  readonly ledgerEntries: readonly Record<string, unknown>[];
  readonly notes: string | null;
}

export interface ReEnrollStudentResult {
  readonly reEnrollmentId: string;
  readonly studentId: string;
  readonly studentCode: string;
  readonly targetAcademicYear: string;
  readonly installmentsWritten: number;
  readonly ledgerWritten: number;
}
