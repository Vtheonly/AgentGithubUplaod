/**
 * Domain model barrel — re-exports all model interfaces.
 *
 * Note: `academic.ts` and `student.ts` both export `AcademicHistoryEntry`,
 * `PromotionDecision`, and `PROMOTION_DECISION_LABELS_FR` for backward
 * compatibility. To avoid duplicate-export errors, we re-export explicitly
 * from `student.ts` (canonical) and re-export `academic.ts` with exclusions.
 *
 * `AcademicCycle` is exported by both `academic.ts` and `payment.ts` —
 * same definition, so we re-export from `academic.ts` (canonical) and
 * exclude it from `payment.ts`.
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
  type AcademicHistoryEntry,
  type PromotionDecision,
  LEVEL_LABELS_FR,
  LEVEL_YEARS,
  STUDENT_STATUS_LABELS_FR,
  PROMOTION_DECISION_LABELS_FR,
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
  // Constants
  ATTENDANCE_STATUS_LABELS_FR,
  ATTENDANCE_STATUS_SHORT,
  SESSION_LABELS_FR,
  // PROMOTION_DECISION_LABELS_FR omitted — re-exported from ./student
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
  // re-exported from ./academic above).
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
