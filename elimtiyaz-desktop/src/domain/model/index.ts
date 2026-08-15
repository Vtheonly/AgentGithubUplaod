/**
 * Domain model barrel — re-exports all model interfaces.
 *
 * Phase 4A consolidation (single source of truth):
 *   - `AcademicCycle`, `AcademicHistoryEntry`, `PromotionDecision`, and
 *     `PROMOTION_DECISION_LABELS_FR` are defined EXCLUSIVELY in `./academic`.
 *     `./student` and `./payment` re-export them for backward compatibility
 *     with callers that imported them from those modules historically.
 *
 * To avoid duplicate-export errors in this barrel, the canonical names are
 * re-exported from `./academic` only, and excluded from the `./student` and
 * `./payment` re-export lists below (the `./student` and `./payment` modules
 * themselves still re-export them for direct-import callers).
 */
export * from "./parent";
export {
  type AcademicLevel,
  type StudentStatus,
  type GradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS_FR,
  academicLevelFromGradeLevel,
  gradeYearFromGradeLevel,
  gradeLevelFromLevelYear,
  type Student,
  type CreateStudentInput,
  type BatchRegistrationInput,
  type BatchRegistrationResult,
  // AcademicHistoryEntry, PromotionDecision, PROMOTION_DECISION_LABELS_FR
  // omitted — canonical definitions re-exported from ./academic below.
  LEVEL_LABELS_FR,
  LEVEL_YEARS,
  STUDENT_STATUS_LABELS_FR,
} from "./student";
export {
  // Types
  type AcademicCycle,
  type AcademicTerm,
  type TermStructure,
  type AcademicYear,
  type AcademicLevelModel,
  type AcademicClass,
  type Subject,
  type ClassSubject,
  type Assessment,
  type AttendanceStatus,
  type AttendanceSession,
  type AttendanceRecord,
  type Homework,
  type AcademicHistoryEntry,
  type PromotionDecision,
  // Constants
  ATTENDANCE_STATUS_LABELS_FR,
  ATTENDANCE_STATUS_SHORT,
  SESSION_LABELS_FR,
  PROMOTION_DECISION_LABELS_FR,
  DEFAULT_PASSING_GRADE,
  // Functions
  computeSubjectAverage,
  computeOverallGpa,
  isPassing,
  validateScore,
  calculateAttendanceRate,
} from "./academic";
export {
  // Re-export everything from payment.ts EXCEPT AcademicCycle (already
  // re-exported from ./academic above — ./payment now imports it from there).
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
  type Installment,
  type AccountAdjustment,
  type ParentFinancialProfile,
  type DebtSummary,
  type Receipt,
  type CollectPaymentInput,
  type UpdateInstallmentDueDateInput,
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  ACADEMIC_CYCLE_LABELS_FR,
  DEFAULT_CYCLE_TRANCHE_MONTHS,
} from "./payment";
export * from "./expense";
export * from "./personnel";
export * from "./operations";
export * from "./audit";
export * from "./backup";
export * from "./club";
export * from "./therapy";
export * from "./teacher";
