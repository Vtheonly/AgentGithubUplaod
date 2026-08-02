/**
 * Tuition pricing calculations — single source of truth for tuition lookups
 * and tranche schedules.
 *
 * Extracted from `domain/model/pricing.ts`:
 *   - `tuitionForGradeLevel`       — per-grade lookup
 *   - `tuitionForLevel`            — per-AcademicLevel lookup (legacy fallback)
 *   - `tuitionTranchesForGrade`    — 3-tranche schedule from config (per-grade)
 *   - `tuitionTranches`            — 3-tranche schedule from a flat total (equal split)
 *
 * Behavior preserved verbatim:
 *   - `tuitionTranches(total)` uses `Math.round(total / 3)` and puts the
 *     remainder in tranche 3.
 *   - `tuitionTranchesForGrade` returns the per-grade schedule stored in
 *     `PricingConfig.tuitionByGradeLevel` (which may be a non-equal split
 *     per the official fee schedule).
 *   - `tuitionForLevel` returns the FIRST grade level within the academic
 *     level — preserves the legacy "best-effort fallback" semantics.
 */
import type { AcademicLevel, GradeLevel } from "@/domain/model/student";
import {
  GRADE_LEVELS,
  academicLevelFromGradeLevel,
} from "@/domain/model/student";
import type { PricingConfig, TuitionPricing } from "@/domain/model/pricing";
import { splitIntoParts } from "../shared/money";

/**
 * Convenience: look up the TuitionPricing for a granular grade level.
 *
 * Returns `{ annualAmount: 0, installments: [0, 0, 0] }` when the grade
 * level is not configured — preserves original fallback semantics.
 */
export function tuitionForGradeLevel(
  config: PricingConfig,
  gradeLevel: GradeLevel,
): TuitionPricing {
  return config.tuitionByGradeLevel[gradeLevel] ?? { annualAmount: 0, installments: [0, 0, 0] };
}

/**
 * Convenience: look up the annual tuition for an `AcademicLevel`.
 *
 * Returns the tuition of the FIRST grade level within that academic level.
 * This is a best-effort fallback for legacy callers — new code should
 * use `tuitionForGradeLevel` directly.
 */
export function tuitionForLevel(config: PricingConfig, level: AcademicLevel): number {
  const firstGrade = GRADE_LEVELS.find((g) => academicLevelFromGradeLevel(g) === level);
  if (!firstGrade) return 0;
  return tuitionForGradeLevel(config, firstGrade).annualAmount;
}

/**
 * Compute the 3-tranche schedule for tuition given a grade level.
 *
 * Returns the per-tranche schedule stored in `PricingConfig.tuitionByGradeLevel`
 * — which may be a non-equal split per the official fee schedule.
 *
 * Labels are FR (preserved from original):
 *   - "Tranche 1 (Sept–Déc)"
 *   - "Tranche 2 (Jan–Mar)"
 *   - "Tranche 3 (Avr–Juin)"
 */
export function tuitionTranchesForGrade(
  config: PricingConfig,
  gradeLevel: GradeLevel,
): ReadonlyArray<{ label: string; amountDue: number }> {
  const pricing = tuitionForGradeLevel(config, gradeLevel);
  return [
    { label: "Tranche 1 (Sept–Déc)", amountDue: pricing.installments[0] },
    { label: "Tranche 2 (Jan–Mar)", amountDue: pricing.installments[1] },
    { label: "Tranche 3 (Avr–Juin)", amountDue: pricing.installments[2] },
  ];
}

/**
 * Compute the 3-tranche schedule for tuition given a flat total amount.
 *
 * Returns an equal 3-way split with the remainder in tranche 3.
 * Used for ad-hoc / non-grade-level tuition pricing.
 *
 * Implementation note: uses `splitIntoParts` from `calc/shared/money` to
 * guarantee the same rounding strategy as the original inline code:
 *   - `perTranche = Math.round(totalAmount / 3)`
 *   - `last = totalAmount - perTranche * 2`
 */
export function tuitionTranches(
  totalAmount: number,
): ReadonlyArray<{ label: string; amountDue: number }> {
  const parts = splitIntoParts(totalAmount, 3);
  return [
    { label: "Tranche 1", amountDue: parts[0] },
    { label: "Tranche 2", amountDue: parts[1] },
    { label: "Tranche 3", amountDue: parts[2] },
  ];
}
