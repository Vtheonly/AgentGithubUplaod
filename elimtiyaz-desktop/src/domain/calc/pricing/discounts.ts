/**
 * Pricing discount calculations — re-export shim.
 * Logic moved to discount-rules.ts + discount-engine.ts.
 */
import type { PricingConfig, PricingEntry, DiscountCode, DiscountType } from "@/domain/model/pricing";
import type { GradeLevel } from "@/domain/model/student";
import type { PaymentPlan } from "@/domain/model/payment";

export * from "./discount-rules";
export * from "./discount-engine";

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

export function findDiscountByCode(
  config: PricingConfig,
  code: DiscountCode,
): PricingEntry | undefined {
  return config.discounts.find((d) => d.discountCode === code && d.isActive);
}

export function computeSiblingDiscount(
  config: PricingConfig,
  childrenCount: number,
): number {
  if (childrenCount <= 1) return 0;
  const entry = findDiscountByCode(config, "sibling_fixed");
  if (!entry) return 0;
  return entry.amount * (childrenCount - 1);
}

export type { GradeLevel, PaymentPlan };
