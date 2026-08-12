/**
 * Money / currency math helpers — single source of truth for all
 * DZD-denominated calculations in the platform.
 *
 * Conventions (PRESERVED from pre-refactor behavior — DO NOT CHANGE):
 *   - All monetary amounts are integer DZD (no cents).
 *   - Rounding mode for tranche splits: `Math.round` (banker-style half-up).
 *   - Rounding mode for discounts: `Math.round` on the discounted total.
 *   - Negative-amount convention: payments, refunds, and fixed-amount
 *     discounts are stored as negative numbers. Use `absAmount()` to
 *     convert to the positive magnitude for display.
 *   - Floor at zero: balances and "remaining" amounts never go negative
 *     (`clampNonNegative`).
 */

/**
 * Absolute value of a signed monetary amount.
 *
 * Use this everywhere the positive magnitude of a payment / refund / credit
 * is needed for display or aggregation. The ledger stores payments as
 * negative numbers; this converts them back to positive totals.
 *
 * Preserved from original inline `Math.abs(...)` calls in `ledger.ts`.
 */
export function absAmount(amount: number): number {
  return Math.abs(amount);
}

/**
 * Clamp a monetary value to be non-negative.
 *
 * Used for "remaining balance" and "outstanding" calculations where a
 * negative result would mean the school owes the parent — those cases are
 * reported separately as `Math.abs(balance)` on a different code path.
 *
 * Preserved from original `Math.max(0, ...)` calls in `payment.ts`.
 */
export function clampNonNegative(amount: number): number {
  return Math.max(0, amount);
}

/**
 * Round a monetary amount to the nearest integer DZD using half-up rounding.
 *
 * This is the rounding mode used by `tuitionTranches` (per-tranche split)
 * and `applyDiscount` (percentage discount result). Changing this would
 * shift tranche amounts and break existing test expectations.
 */
export function roundCurrency(amount: number): number {
  return Math.round(amount);
}

/**
 * Sum a list of numbers using a numeric extractor.
 *
 * Replaces the inline `.reduce((sum, x) => sum + x.field, 0)` pattern that
 * appeared 7+ times across `payment.ts` and `ledger.ts`. The extractor is
 * invoked once per item; non-finite values are treated as 0 to keep sums
 * deterministic.
 *
 * @example
 *   sumOf(payments, (p) => p.amount)        // sum of payment amounts
 *   sumOf(installments, (i) => i.amountDue) // sum of installment dues
 */
export function sumOf<T>(items: readonly T[], extractor: (item: T) => number): number {
  let total = 0;
  for (const item of items) {
    const value = extractor(item);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/**
 * Compare two monetary amounts for approximate equality.
 *
 * Floating-point drift can accumulate when adding many decimals; this
 * helper treats differences under 1 centime (0.01 DZD) as equal. Used by
 * the reconciliation engine in `crossCheckBalanceSum`.
 */
export function amountsApproximatelyEqual(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Split a total amount into `count` near-equal parts, with the remainder
 * assigned to the last part.
 *
 * This is the exact algorithm used by `tuitionTranches(totalAmount)`:
 *   - `perPart = Math.round(total / count)`
 *   - `last = total - perPart * (count - 1)`
 *
 * Preserved verbatim — changing the split strategy would break tranche
 * amount expectations in 30+ existing tests.
 */
export function splitIntoParts(
  total: number,
  count: number,
): readonly number[] {
  if (count <= 0) return [];
  if (count === 1) return [total];
  const perPart = Math.round(total / count);
  const last = total - perPart * (count - 1);
  const parts: number[] = [];
  for (let i = 0; i < count - 1; i++) parts.push(perPart);
  parts.push(last);
  return parts;
}
