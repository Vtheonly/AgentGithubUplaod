/**
 * Discount Rules — the 5 canonical `Prices.md` (2026-2027) discount evaluators
 * plus the legacy pricing-config lookup helpers (`applyDiscount`,
 * `findDiscountByCode`, `computeSiblingDiscount`).
 *
 * Each rule is PURE: zero I/O, zero side effects.
 */
import type { GradeLevel } from "../../model/student";
import type { PaymentPlan } from "../../model/payment";
import type {
  PricingConfig,
  PricingEntry,
  DiscountCode,
  DiscountType,
} from "../../model/pricing";

export type { GradeLevel, PaymentPlan };

export const PASSAGE_DE_PALIER_AMOUNT = -10_000;
export const SIBLING_PER_CHILD_AMOUNT = 5_000;
export const EARLY_ANNUAL_RATE = 0.10;
export const HIGHEST_AVERAGE_RATE = 0.10;
export const SENIORITY_RATE = 0.05;
export const SENIORITY_YEARS = 5;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR_AVG = 365.25;

const CYCLE_TRANSITIONS: ReadonlyArray<readonly [GradeLevel, GradeLevel]> = [
  ["5ap", "1am"],
  ["4am", "1ere_annee"],
];

export function evaluatePassageDePalier(previous: GradeLevel | null, current: GradeLevel): number {
  if (!previous) return 0;
  const crossed = CYCLE_TRANSITIONS.some(([from, to]) => previous === from && current === to);
  return crossed ? PASSAGE_DE_PALIER_AMOUNT : 0;
}

export function evaluateSiblingDiscount(childIndex: number, perChild = SIBLING_PER_CHILD_AMOUNT): number {
  if (childIndex <= 1) return 0;
  return -(perChild * (childIndex - 1));
}

export function evaluateEarlyAnnualDiscount(
  paymentDate: string | Date, grossTuition: number,
  paymentPlan: PaymentPlan, academicYearStartYear: number,
): number {
  if (paymentPlan !== "full_annual") return 0;
  const cutoff = new Date(Date.UTC(academicYearStartYear, 5, 30, 23, 59, 59));
  const when = typeof paymentDate === "string" ? new Date(paymentDate) : paymentDate;
  if (when.getTime() > cutoff.getTime()) return 0;
  // CENTIME-PRECISION ROUNDING (cross-platform equivalence fix disc-009):
  // the wire format stores centimes; rounding at whole DZD diverged from the
  // Android engine by up to 50 centimes on fractional gross amounts.
  return Math.round(grossTuition * EARLY_ANNUAL_RATE * 100) / 100;
}

export function evaluateAcademicExcellenceDiscount(rank: number | null, grossTuition: number): number {
  if (rank === null || rank !== 1) return 0;
  // Centime-precision rounding — see evaluateEarlyAnnualDiscount.
  return Math.round(grossTuition * HIGHEST_AVERAGE_RATE * 100) / 100;
}

export function evaluateSeniorityDiscount(
  enrollmentDate: string | Date, academicYearStart: string | Date, grossTuition: number,
): number {
  const enrolled = typeof enrollmentDate === "string" ? new Date(enrollmentDate) : enrollmentDate;
  const yearStart = typeof academicYearStart === "string" ? new Date(academicYearStart) : academicYearStart;
  const thresholdMs = SENIORITY_YEARS * DAYS_PER_YEAR_AVG * MS_PER_DAY;
  if (yearStart.getTime() - enrolled.getTime() <= thresholdMs) return 0;
  // Centime-precision rounding — see evaluateEarlyAnnualDiscount.
  return Math.round(grossTuition * SENIORITY_RATE * 100) / 100;
}

export function isCycleTransition(previous: GradeLevel | null, current: GradeLevel): boolean {
  if (!previous) return false;
  return CYCLE_TRANSITIONS.some(([from, to]) => previous === from && current === to);
}

// ─── Legacy pricing-config helpers ───────────────────────────────────────────
// These wrap the discount evaluators above for callers that operate on
// a `PricingConfig` (the runtime fee schedule). Moved here from the deleted
// `discounts.ts` shim so all discount logic lives in one place.

/** Apply a single `DiscountType` (percentage or fixed) to a base amount. */
export function applyDiscount(
  baseAmount: number,
  discount: { amount: number; discountType: DiscountType },
): number {
  if (discount.discountType === "percentage") {
    const pct = Math.max(0, Math.min(100, discount.amount));
    return Math.round(baseAmount * (1 - pct / 100));
  }
  return Math.max(0, baseAmount + discount.amount);
}

/** Find an active discount entry by its `discountCode`. */
export function findDiscountByCode(
  config: PricingConfig,
  code: DiscountCode,
): PricingEntry | undefined {
  return config.discounts.find((d) => d.discountCode === code && d.isActive);
}

/** Total sibling discount given a `sibling_fixed` config entry and child count. */
export function computeSiblingDiscount(
  config: PricingConfig,
  childrenCount: number,
): number {
  if (childrenCount <= 1) return 0;
  const entry = findDiscountByCode(config, "sibling_fixed");
  if (!entry) return 0;
  return entry.amount * (childrenCount - 1);
}
