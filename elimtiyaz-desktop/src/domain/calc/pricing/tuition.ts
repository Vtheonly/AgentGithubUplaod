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
 *
 * UNIFIED ARCHITECTURE additions:
 *   - `getOfficialTuitionDueDates(startYear, cycle)` — returns the official
 *     ISO due-date triple per `Prices.md`: Sept 15 / Dec 15 / Mar 15 of
 *     `(startYear+1)`. This is the canonical schedule for ALL cycles
 *     (Primaire, CEM, Lycée) per the 2026-2027 fee schedule.
 *   - `getOfficialTuitionTrancheSplit(grossAnnual, cycle)` — returns the
 *     official 40% / 30% / 30% tranche split per `Prices.md`.
 */
import type { AcademicLevel, GradeLevel } from "@/domain/model/student";
import {
  GRADE_LEVELS,
  academicLevelFromGradeLevel,
} from "@/domain/model/student";
import type { AcademicCycle } from "@/domain/model/payment";
import type { PricingConfig, TuitionPricing } from "@/domain/model/pricing";
import { splitIntoParts } from "../shared/money";

/* ============================================================ */
/*  Official schedule generators (Prices.md — 2026-2027)        */
/* ============================================================ */

/**
 * Official tuition tranche due dates per `Prices.md`.
 *
 * For every cycle (Primaire, CEM, Lycée) the schedule is identical:
 *   - Tranche 1: September 15 of `startYear`      (at registration)
 *   - Tranche 2: December 15 of `startYear`       (window: Dec 1 – 15)
 *   - Tranche 3: March 15 of `startYear + 1`      (window: Mar 1 – 15)
 *
 * The `cycle` parameter is accepted for API symmetry with future
 * cycle-specific schedules but currently does not alter the output —
 * all cycles follow the same official calendar per `Prices.md`.
 *
 * @param startYear  The calendar year in which the academic year starts
 *                   (e.g. 2026 for the 2026-2027 academic year).
 * @param cycle      The student's education cycle (prescolaire / primaire /
 *                   cem / lycee). Currently informational only.
 * @returns A 3-tuple of ISO date strings `[T1, T2, T3]`.
 */
export function getOfficialTuitionDueDates(
  startYear: number,
  cycle?: AcademicCycle,
): readonly [string, string, string] {
  // Cycle is accepted for symmetry; per Prices.md all cycles share the
  // same Sept 15 / Dec 15 / Mar 15 schedule.
  void cycle;
  return [
    new Date(Date.UTC(startYear, 8, 15)).toISOString(), // Sept 15
    new Date(Date.UTC(startYear, 11, 15)).toISOString(), // Dec 15
    new Date(Date.UTC(startYear + 1, 2, 15)).toISOString(), // Mar 15
  ];
}

/**
 * Official tuition tranche percentage split per `Prices.md`.
 *
 * Every grade level follows the same 40% / 30% / 30% allocation:
 *   - Tranche 1 (At Registration): 40% of annual fee
 *   - Tranche 2 (Dec 1 – 15):      30% of annual fee
 *   - Tranche 3 (Mar 1 – 15):      30% of annual fee
 *
 * The split is applied to the **net** annual tuition (gross minus evaluated
 * system discounts) — never to per-tranche gross amounts, to avoid the
 * double-discounting bug documented in the architectural blueprint.
 *
 * @returns A 3-tuple of percentages summing to 100: `[40, 30, 30]`.
 */
export function getOfficialTuitionTrancheSplit(
  _grossAnnual?: number,
  _cycle?: AcademicCycle,
): readonly [number, number, number] {
  return [40, 30, 30];
}

/**
 * Split a net annual tuition amount into 3 tranches using the official
 * `Prices.md` 40% / 30% / 30% allocation, with the remainder absorbed
 * into Tranche 3 to guarantee exact conservation:
 *
 *   T1 = round(net × 0.40)
 *   T2 = round(net × 0.30)
 *   T3 = net − T1 − T2
 *
 * Invariant: T1 + T2 + T3 === net  (no dinar is lost or invented).
 */
export function splitNetTuitionByOfficialSchedule(
  netAnnual: number,
): readonly [number, number, number] {
  const t1 = Math.round(netAnnual * 0.4);
  const t2 = Math.round(netAnnual * 0.3);
  const t3 = netAnnual - t1 - t2;
  return [t1, t2, t3];
}

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
