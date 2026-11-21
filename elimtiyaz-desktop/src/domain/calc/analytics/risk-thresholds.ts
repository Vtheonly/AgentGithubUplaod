/**
 * The operational risk-profile thresholds — E4.5 (ARCH-009, L-6), the
 * domain-engine half of the T-596 one-engine mandate (D-U2).
 *
 * BEFORE E4.5 the classification edges lived as literals inside the
 * dashboard's operational-query-engine (the registered offenders:
 * `debtAmount >= 30_000 || daysOverdue >= 30`, `debtAmount >= 25_000`,
 * `gpa < 10`, `unexcusedAbsences >= 3 || attendanceRate < 0.85`, and the
 * preset edges `gpa >= 15` / `attendanceRate >= 0.95`) — the exact
 * "page-local arbitrary thresholds" class the T-405 rule bans.
 *
 * They now live HERE, in the domain, beside the debt-aging thresholds
 * (`domain/calc/ledger/debt-aging.ts`) — the same discipline:
 *   - the constants below are the DEFAULTS (the documented values the
 *     engine hardcoded since inception — byte-identical, so the default
 *     behavior is preserved by construction, pinned by t-e45);
 *   - every engine entry point takes an optional `thresholds` parameter
 *     (settings-sourced at the T-596 re-composition — the same
 *     prop-drilling `debtThresholds` uses today);
 *   - the scoring WEIGHTS (45/25/15/20 pts, the 12/20 watch band) stay
 *     engine internals: they are the scoring model, not classification
 *     edges, and are not tenant-configurable.
 */

/** The classification edges of `evaluateStudentRiskProfiles` + the
 *  operational quick-query presets. All values are the pre-E4.5 literals. */
export interface RiskProfileThresholds {
  /** GPA at/below which a student is "ajourné" (academic_alert). Also the
   *  isPassing edge (>= this passes). Pre-E4.5 literal: 10. */
  readonly academicAlertGpa: number;
  /** GPA at or above which a student enters the exemplary preset.
   *  Pre-E4.5 literal: 15. */
  readonly exemplaryGpa: number;
  /** Attendance rate at or above which the exemplary preset accepts.
   *  Pre-E4.5 literal: 0.95. */
  readonly exemplaryAttendanceRate: number;
  /** Unexcused absences at/after which the attendance alert fires.
   *  Pre-E4.5 literal: 3. */
  readonly unexcusedAbsenceAlert: number;
  /** Attendance rate below which the attendance alert fires.
   *  Pre-E4.5 literal: 0.85. */
  readonly attendanceRateAlert: number;
  /** Family outstanding at/above which the FINANCIAL-TENSION category
   *  fires. Pre-E4.5 literal: 25_000 DZD. */
  readonly financialTensionDzd: number;
  /** Family outstanding at/above which the risk-score's heavy financial
   *  factor fires. Pre-E4.5 literal: 30_000 DZD. */
  readonly criticalDebtDzd: number;
  /** Days overdue at/after which the risk-score's heavy financial factor
   *  fires (the OR-branch of the critical edge). Pre-E4.5 literal: 30. */
  readonly criticalDaysOverdue: number;
}

/** The documented defaults — the exact pre-E4.5 hardcoded values (the
 *  pinned-output comparison in t-e45 proves byte-identical behavior). */
export const DEFAULT_RISK_PROFILE_THRESHOLDS: RiskProfileThresholds = {
  academicAlertGpa: 10,
  exemplaryGpa: 15,
  exemplaryAttendanceRate: 0.95,
  unexcusedAbsenceAlert: 3,
  attendanceRateAlert: 0.85,
  financialTensionDzd: 25_000,
  criticalDebtDzd: 30_000,
  criticalDaysOverdue: 30,
};
