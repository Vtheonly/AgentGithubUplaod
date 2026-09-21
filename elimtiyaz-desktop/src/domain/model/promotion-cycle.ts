/**
 * T-403 — the human-in-the-loop promotion-cycle model.
 *
 * The workflow unit (ADR pending closeout — this file mirrors migration
 * 0108's `promotion_cycles` / `promotion_cycle_classes` contract):
 *
 *   Academic Year → Promotion Cycle → Level/Grade → Class/Group → Student
 *   decisions → Review → Confirm
 *
 * Batch promotion is a BATCH operation in scope, but NOT a blind one-click
 * operation: the whole year is ONE managed cycle while each class is
 * reviewed and explicitly confirmed ONE AT A TIME. The decisions themselves
 * flow through the SAME canonical engine as the batch flow
 * (`buildPromotionReviewQueue` + `execute_batch_promotion`) — this model
 * adds the WORKFLOW state, never a second promotion algorithm.
 */

/** The cycle's lifecycle (0108's CHECK constraint, verbatim). */
export type PromotionCycleStatus =
  | "draft"
  | "in_review"
  | "partially_processed"
  | "completed"
  | "cancelled";

/** The per-class review state inside a cycle (0108's CHECK, verbatim). */
export type PromotionCycleClassStatus =
  | "pending"
  | "in_review"
  | "processed"
  | "exception"
  | "skipped";

export const PROMOTION_CYCLE_STATUS_LABELS_FR: Record<PromotionCycleStatus, string> = {
  draft: "Brouillon",
  in_review: "En révision",
  partially_processed: "Partiellement traité",
  completed: "Terminé",
  cancelled: "Annulé",
};

export const PROMOTION_CYCLE_CLASS_STATUS_LABELS_FR: Record<PromotionCycleClassStatus, string> = {
  pending: "À traiter",
  in_review: "En révision",
  processed: "Traité",
  exception: "Dérogation",
  skipped: "Ignoré",
};

/** One promotion cycle (the aggregated view `fn_get_promotion_cycles` returns). */
export interface PromotionCycle {
  readonly id: string;
  readonly sourceAcademicYear: string;
  readonly targetAcademicYear: string;
  readonly status: PromotionCycleStatus;
  readonly notes: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly completedByName: string | null;
  readonly classesTotal: number;
  readonly classesProcessed: number;
  readonly studentsAwaiting: number;
  readonly promotedCount: number;
  readonly repeatingCount: number;
  readonly deferredCount: number;
}

/** One class's review state inside a cycle (`fn_get_promotion_cycle_classes`). */
export interface PromotionCycleClass {
  readonly id: string;
  readonly cycleId: string;
  readonly classId: string;
  readonly classCode: string;
  readonly className: string;
  readonly gradeCode: string;
  readonly status: PromotionCycleClassStatus;
  readonly studentsAwaiting: number;
  readonly promotedCount: number;
  readonly repeatingCount: number;
  readonly deferredCount: number;
  readonly exceptionNote: string | null;
  readonly processedByName: string | null;
  readonly processedAt: string | null;
}

/** The result of a class confirmation (`fn_confirm_promotion_cycle_class`). */
export interface PromotionClassConfirmResult {
  readonly cycleId: string;
  readonly classId: string;
  readonly className: string;
  readonly promoted: number;
  readonly repeated: number;
  readonly deferred: number;
  readonly incompleteNotesCount: number;
  readonly incompleteNotesAcked: boolean;
}

/**
 * The incomplete-notes warning detector. The SQL side (0108 §5) enforces the
 * two-phase ack — a student's notes are incomplete when ANY assessment row of
 * the source year has a missing mark, or when they have NO complete row at
 * all. This client-side mirror PRE-VISUALIZES the warning so the reviewer
 * sees it before the server rejects the first attempt (the same
 * never-treat-missing-grades-as-zero honesty rule as T-336).
 */
export function findStudentsWithIncompleteNotes(
  students: readonly { id: string; firstName: string; lastName: string }[],
  assessments: readonly {
    studentId: string;
    devoir1: number | null;
    devoir2: number | null;
    examen: number | null;
    academicYear?: string | null;
  }[],
  sourceAcademicYear: string,
): { id: string; name: string }[] {
  const complete = new Set(
    assessments
      .filter(
        (a) =>
          a.academicYear === sourceAcademicYear &&
          a.devoir1 != null &&
          a.devoir2 != null &&
          a.examen != null,
      )
      .map((a) => a.studentId),
  );
  return students
    .filter((s) => !complete.has(s.id))
    .map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}` }));
}

/** The blocking warning text (the task's mandated message shape). */
export function incompleteNotesWarning(incomplete: readonly { name: string }[]): string {
  return `Les notes ne sont pas encore toutes renseignées (${incomplete.length} élève(s) : ${
    incomplete.map((s) => s.name).join(", ") || "—"
  }). Êtes-vous sûr de vouloir continuer ?`;
}
