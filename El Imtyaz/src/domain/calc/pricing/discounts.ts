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
 */
import type { PricingConfig, PricingEntry, DiscountCode, DiscountType } from "@/domain/model/pricing";

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
