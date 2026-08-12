/**
 * Pricing discount calculations — single source of truth for applying
 * percentage and fixed-amount discounts.
 *
 * Extracted from `domain/model/pricing.ts`:
 *   - `applyDiscount`           — apply one discount to a base amount
 *   - `findDiscountByCode`      — look up an active discount by canonical code
 *   - `computeSiblingDiscount`  — multi-child sibling discount
 *
 * Behavior preserved verbatim:
 *   - Percentage: clamped to [0, 100], then `Math.round(base * (1 - pct / 100))`.
 *   - Fixed amount: stored as negative; `Math.max(0, base + discount.amount)`.
 *   - Sibling: 0 for ≤1 child; otherwise `entry.amount * (children - 1)`.
 *
 * UNIFIED ARCHITECTURE additions — the 5 official `Prices.md` discount
 * evaluators. Each evaluator is a PURE function that takes the inputs
 * relevant to its rule and returns the SIGNED discount amount (negative
 * = credit). A master `evaluateAllSystemDiscounts` runs all 5 against a
 * single parameter object and returns an itemized array.
 *
 *   1. `evaluatePassageDePalier`     — −10,000 DA on cycle transition
 *   2. `evaluateSiblingDiscount`     — −5,000 DA × (N − 1) for multi-child
 *   3. `evaluateEarlyAnnualDiscount` — 10% OFF when paid ≤ June 30 (full_annual)
 *   4. `evaluateAcademicExcellenceDiscount` — 10% OFF for rank 1 in level
 *   5. `evaluateSeniorityDiscount`   — 5% OFF for >5 years seniority
 */
import type { PricingConfig, PricingEntry, DiscountCode, DiscountType } from "@/domain/model/pricing";
import type { GradeLevel } from "@/domain/model/student";
import type { PaymentPlan } from "@/domain/model/payment";

/**
 * Apply a discount to a base amount. Returns the discounted total.
 *
 * - `percentage`   → clamps discount.amount to [0, 100], rounds the result.
 * - `fixed_amount` → discount.amount is stored as a negative number; the
 *                    result is `Math.max(0, base + discount.amount)` so a
 *                    discount cannot make the total negative.
 */
export function applyDiscount(
  baseAmount: number,
  discount: { amount: number; discountType: DiscountType },
): number {
  if (discount.discountType === "percentage") {
    const pct = Math.max(0, Math.min(100, discount.amount));
    return Math.round(baseAmount * (1 - pct / 100));
  }
  // fixed_amount — stored as negative number; subtract the negative to apply.
  return Math.max(0, baseAmount + discount.amount);
}

/**
 * Find a discount entry by its canonical code.
 *
 * Only returns ACTIVE discounts. Inactive discounts are skipped (preserves
 * original behavior — `d.isActive` filter is part of the predicate).
 */
export function findDiscountByCode(
  config: PricingConfig,
  code: DiscountCode,
): PricingEntry | undefined {
  return config.discounts.find((d) => d.discountCode === code && d.isActive);
}

/**
 * Compute the total discount amount for a parent with N children, applying
 * the sibling_fixed discount once per additional child.
 *
 * Example: 3 children → 2 × sibling_fixed discount (i.e., 2 × −5 000 DA = −10 000 DA).
 *
 * Returns 0 when:
 *   - `childrenCount <= 1` (no siblings → no discount)
 *   - The `sibling_fixed` discount code is not present in `config.discounts`
 *     or is inactive.
 */
export function computeSiblingDiscount(
  config: PricingConfig,
  childrenCount: number,
): number {
  if (childrenCount <= 1) return 0;
  const entry = findDiscountByCode(config, "sibling_fixed");
  if (!entry) return 0;
  // `amount` is stored as a negative number for fixed_amount discounts.
  return entry.amount * (childrenCount - 1);
}

/* ============================================================ */
/*  Official 5 Discount Evaluators (Prices.md — 2026-2027)      */
/* ============================================================ */

/** Fixed-amount transition discount per `Prices.md` — Passage de palier. */
export const PASSAGE_DE_PALIER_AMOUNT = -10_000;

/**
 * Rule 1 — Passage de palier (Level Transition).
 *
 * Returns −10,000 DA when a student is transitioning across a cycle
 * boundary:
 *   - Primary → CEM   : 5AP → 1AM
 *   - CEM → Lycée     : 4AM → 1ère Année
 *
 * Returns 0 otherwise (same-cycle grade progression, new enrollment, etc.).
 *
 * The returned amount is SIGNED (negative = credit), ready to be added
 * to the annual discount total.
 */
export function evaluatePassageDePalier(
  previousGradeLevel: GradeLevel | null,
  currentGradeLevel: GradeLevel,
): number {
  if (!previousGradeLevel) return 0;
  const transitions: ReadonlyArray<readonly [GradeLevel, GradeLevel]> = [
    ["5ap", "1am"],
    ["4am", "1ere_annee"],
  ];
  const isTransition = transitions.some(
    ([from, to]) => previousGradeLevel === from && currentGradeLevel === to,
  );
  return isTransition ? PASSAGE_DE_PALIER_AMOUNT : 0;
}

/**
 * Rule 2 — Multi-Child Family (Parent ayant plus d'un élève).
 *
 * Returns −5,000 DA × (childrenCount − 1) — i.e. 0 for an only child,
 * −5,000 DA for the 2nd child, −10,000 DA for the 3rd, etc.
 *
 * The discount is evaluated PER CHILD based on their 1-indexed position in
 * the family. Child #1 gets 0; child #2..N each get −5,000 DA.
 *
 * @param childIndex  1-indexed position of this child within the family
 *                    (1 = first/oldest enrolled child, 2 = second, ...).
 * @param perChildAmount  Optional override (defaults to −5,000 DA per
 *                        `Prices.md`). Pass a positive number; the function
 *                        negates it.
 */
export function evaluateSiblingDiscount(
  childIndex: number,
  perChildAmount: number = 5_000,
): number {
  if (childIndex <= 1) return 0;
  return -(perChildAmount * (childIndex - 1));
}

/**
 * Rule 3 — Full Annual Payment Before June 30th.
 *
 * Returns `0.10 × grossTuition` (a positive number representing the
 * discount magnitude) when ALL of the following are true:
 *   - `paymentPlan === "full_annual"`
 *   - `paymentDate` is on or before June 30 of the academic year's
 *     starting calendar year.
 *
 * Otherwise returns 0.
 *
 * The returned amount is the SAVINGS (positive). Callers should subtract
 * it from the gross to derive the net. `evaluateAllSystemDiscounts`
 * converts this to a signed (negative) credit.
 *
 * @param paymentDate   ISO date string (or Date) when the parent intends
 *                      to settle the full annual fee.
 * @param grossTuition  Gross annual tuition before any discounts.
 * @param paymentPlan   The student's selected payment plan.
 * @param academicYearStartYear  The calendar year in which the academic
 *                      year starts (e.g. 2026 for 2026-2027). The
 *                      June-30 cutoff is interpreted against this year.
 */
export function evaluateEarlyAnnualDiscount(
  paymentDate: string | Date,
  grossTuition: number,
  paymentPlan: PaymentPlan,
  academicYearStartYear: number,
): number {
  if (paymentPlan !== "full_annual") return 0;
  const cutoff = new Date(Date.UTC(academicYearStartYear, 5, 30, 23, 59, 59)); // June 30
  const when = typeof paymentDate === "string" ? new Date(paymentDate) : paymentDate;
  if (when.getTime() > cutoff.getTime()) return 0;
  return Math.round(grossTuition * 0.1);
}

/**
 * Rule 4 — Student with Highest Average Grade in Level.
 *
 * Returns `0.10 × grossTuition` (positive savings) when the student
 * achieved Rank 1 in their grade level during the previous academic
 * year. Returns 0 otherwise.
 *
 * @param rank           1-indexed rank within the grade level (1 = top).
 * @param grossTuition   Gross annual tuition before any discounts.
 */
export function evaluateAcademicExcellenceDiscount(
  rank: number | null,
  grossTuition: number,
): number {
  if (rank === null || rank !== 1) return 0;
  return Math.round(grossTuition * 0.1);
}

/**
 * Rule 5 — Seniority (>5 Years in School).
 *
 * Returns `0.05 × grossTuition` (positive savings) when the student has
 * been enrolled at the school for strictly more than 5 years as of the
 * start of the current academic year.
 *
 * @param enrollmentDate         ISO date string (or Date) of the student's
 *                               original enrollment.
 * @param academicYearStart      ISO date string (or Date) for the start of
 *                               the academic year being billed (typically
 *                               Sept 1 of `startYear`).
 * @param grossTuition           Gross annual tuition before any discounts.
 */
export function evaluateSeniorityDiscount(
  enrollmentDate: string | Date,
  academicYearStart: string | Date,
  grossTuition: number,
): number {
  const enrolled = typeof enrollmentDate === "string" ? new Date(enrollmentDate) : enrollmentDate;
  const yearStart = typeof academicYearStart === "string" ? new Date(academicYearStart) : academicYearStart;
  // Strictly more than 5 years → > 5 × 365.25 × 86_400_000 ms (account for leap years).
  const fiveYearsMs = 5 * 365.25 * 86_400_000;
  if (yearStart.getTime() - enrolled.getTime() <= fiveYearsMs) return 0;
  return Math.round(grossTuition * 0.05);
}

/**
 * Itemized discount evaluation result. The `amount` field is SIGNED
 * (negative = credit / savings applied to the gross).
 */
export interface DiscountEvaluation {
  readonly code: DiscountCode | "passage_palier" | "sibling_fixed" | "full_annual" | "highest_average" | "seniority_5y";
  readonly label: string;
  /** Signed amount (negative = credit). Sum these to get the total discount. */
  readonly amount: number;
  /** Whether this discount was actually applied (false → amount is 0). */
  readonly applied: boolean;
  /** Human-readable reason for transparency in the UI. */
  readonly reason: string;
}

/**
 * Input bundle for `evaluateAllSystemDiscounts` — every parameter the
 * 5 official rules might need, gathered in one place so callers don't
 * have to thread 5 separate arguments.
 */
export interface EvaluateAllDiscountsParams {
  readonly grossTuition: number;
  readonly previousGradeLevel: GradeLevel | null;
  readonly currentGradeLevel: GradeLevel;
  /** 1-indexed position of this child within the family (1 = first). */
  readonly childIndex: number;
  readonly paymentPlan: PaymentPlan;
  readonly paymentDate: string | Date;
  readonly academicYearStartYear: number;
  readonly academicYearStart: string | Date;
  /** ISO date (or Date) the student was originally enrolled at the school. */
  readonly enrollmentDate: string | Date;
  /** Previous-year rank within the grade level (1 = top). */
  readonly previousRank: number | null;
  /** Optional per-child sibling amount override (defaults to 5,000 DA). */
  readonly siblingPerChildAmount?: number;
}

/**
 * Master evaluator — runs all 5 official `Prices.md` discount rules
 * against the input bundle and returns an itemized array of
 * `DiscountEvaluation` entries.
 *
 * Only applied discounts (amount !== 0) are included in the returned
 * array — skipped rules are omitted to keep the UI clean.
 *
 * The TOTAL discount is the sum of all `entry.amount` values. Callers
 * MUST apply this total ONCE to the gross annual tuition to derive the
 * net — never re-apply per tranche (that was the double-discounting bug).
 */
export function evaluateAllSystemDiscounts(
  params: EvaluateAllDiscountsParams,
): readonly DiscountEvaluation[] {
  const out: DiscountEvaluation[] = [];

  // Rule 1 — Passage de palier
  const palier = evaluatePassageDePalier(params.previousGradeLevel, params.currentGradeLevel);
  if (palier !== 0) {
    out.push({
      code: "passage_palier",
      label: "Passage de palier (−10 000 DA)",
      amount: palier,
      applied: true,
      reason: `Transition ${params.previousGradeLevel} → ${params.currentGradeLevel}`,
    });
  }

  // Rule 2 — Multi-Child
  const sibling = evaluateSiblingDiscount(params.childIndex, params.siblingPerChildAmount);
  if (sibling !== 0) {
    out.push({
      code: "sibling_fixed",
      label: `Fratrie — enfant #${params.childIndex} (−${Math.abs(sibling).toLocaleString("fr-FR")} DA)`,
      amount: sibling,
      applied: true,
      reason: `Enfant ${params.childIndex} de la fratrie`,
    });
  }

  // Rule 3 — Full Annual before June 30
  const earlySavings = evaluateEarlyAnnualDiscount(
    params.paymentDate,
    params.grossTuition,
    params.paymentPlan,
    params.academicYearStartYear,
  );
  if (earlySavings > 0) {
    out.push({
      code: "full_annual",
      label: "Paiement annuel avant le 30 juin (−10%)",
      amount: -earlySavings,
      applied: true,
      reason: "Paiement intégral avant le 30 juin",
    });
  }

  // Rule 4 — Highest Average
  const excellenceSavings = evaluateAcademicExcellenceDiscount(params.previousRank, params.grossTuition);
  if (excellenceSavings > 0) {
    out.push({
      code: "highest_average",
      label: "Meilleure moyenne du palier (−10%)",
      amount: -excellenceSavings,
      applied: true,
      reason: "Rang 1 au palier l'année précédente",
    });
  }

  // Rule 5 — Seniority
  const senioritySavings = evaluateSeniorityDiscount(
    params.enrollmentDate,
    params.academicYearStart,
    params.grossTuition,
  );
  if (senioritySavings > 0) {
    out.push({
      code: "seniority_5y",
      label: "Ancienneté > 5 ans (−5%)",
      amount: -senioritySavings,
      applied: true,
      reason: "Plus de 5 ans d'ancienneté",
    });
  }

  return out;
}

/**
 * Convenience: sum the signed amounts of an array of discount evaluations.
 * The result is the total discount (negative number) to subtract from the
 * gross annual tuition.
 */
export function sumDiscounts(evaluations: readonly DiscountEvaluation[]): number {
  return evaluations.reduce((s, e) => s + e.amount, 0);
}
