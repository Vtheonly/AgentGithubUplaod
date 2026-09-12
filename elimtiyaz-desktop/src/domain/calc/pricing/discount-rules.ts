/**
 * Discount Rules — the REAL school remise rules (2026/2027).
 *
 * CALC-001/002 fix (2026-09-12): the previous "5 canonical Prices.md rules"
 * were a FICTIONAL price book that never existed at the school. Verified
 * against the actual workbook (`Suivis clients  2026_2027.xlsx`):
 *
 *   ❌ passage_palier (−10 000 DZD on 5AP→1AM / 4AM→1ère)  — DOES NOT EXIST.
 *      The ETAT rows with 10 000 DZD remises (HEBBAZ, MAHAMED OUSSAID)
 *      decompose as two 5 000 DZD sibling components (J-formulas
 *      `=5000+5000+20500` etc.); none of those children changed cycle.
 *   ❌ highest_average (rank 1 → −10%)                     — DOES NOT EXIST.
 *   ❌ seniority_5y (−5%)                                  — DOES NOT EXIST.
 *   ✅ full_annual early payment — REAL, but 5% (not 10%) and applied to
 *      the FRAIS DE SCOLARISATION only: the Devis sheet formula is
 *      `=+SUM(F15:F26)*0.05`.
 *   ✅ sibling_fixed — REAL as a DEFAULT component (5 000 DZD per additional
 *      child, visible inside the J-column decompositions). The school's
 *      actual family remises are individually NEGOTIATED (HEBBAZ 3 kids =
 *      10 000 vs KOUBA 3 kids = 41 500), so the sibling rule is a suggested
 *      default, and the wizard collects the negotiated remise as an input.
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

/**
 * Early annual payment discount rate — 5% of the FRAIS DE SCOLARISATION
 * (Devis formula `=+SUM(F15:F26)*0.05`). Superseded by
 * `school-price-matrix.ts EARLY_PAYMENT_RATE` for new code paths.
 */
export const EARLY_ANNUAL_RATE = 0.05;

/** Default sibling remise per additional child (5 000 DZD) — J-formula evidence. */
export const SIBLING_PER_CHILD_AMOUNT = 5_000;

export function evaluateSiblingDiscount(childIndex: number, perChild = SIBLING_PER_CHILD_AMOUNT): number {
  if (childIndex <= 1) return 0;
  return -(perChild * (childIndex - 1));
}

export function evaluateEarlyAnnualDiscount(
  paymentDate: string | Date, grossScolarite: number,
  paymentPlan: PaymentPlan, academicYearStartYear: number,
): number {
  if (paymentPlan !== "full_annual") return 0;
  const cutoff = new Date(Date.UTC(academicYearStartYear, 5, 30, 23, 59, 59));
  const when = typeof paymentDate === "string" ? new Date(paymentDate) : paymentDate;
  if (when.getTime() > cutoff.getTime()) return 0;
  // CENTIME-PRECISION ROUNDING (cross-platform equivalence fix disc-009):
  // the wire format stores centimes; rounding at whole DZD diverged from the
  // Android engine by up to 50 centimes on fractional gross amounts.
  // NOTE (CALC-002): the base is the SCOLARITÉ ONLY (FI and transport are
  // excluded — the workbook's `SUM(F)*0.05` sums the Frais Scolarisation
  // column, never the F I or Services columns).
  return Math.round(grossScolarite * EARLY_ANNUAL_RATE * 100) / 100;
}

// ── REMOVED RULES (CALC-001, 2026-09-12) ─────────────────────────────────────
// evaluatePassageDePalier / PASSAGE_DE_PALIER_AMOUNT / CYCLE_TRANSITIONS /
// isCycleTransition — deleted: the rule does not exist at the school.
// evaluateAcademicExcellenceDiscount / HIGHEST_AVERAGE_RATE — deleted.
// evaluateSeniorityDiscount / SENIORITY_RATE / SENIORITY_YEARS — deleted.
// (Historical implementations recoverable from git history / Android mirror.)

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
