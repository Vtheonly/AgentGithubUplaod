/**
 * Pricing Configuration domain — plan §"Administration".
 *
 * Hard rule: "All pricing must be configurable by administrators.
 *             Never hardcode payment values."
 *
 * The billing system reads amounts from this config — never from constants.
 * Adding or changing a price MUST NOT require modifying source code.
 *
 * Pricing is structured by category and qualifier:
 *   - Tuition: by academic level (primaire / cem / lycee)
 *   - Transport: by city tier (t1 / t2 / t3)
 *   - Registration: flat per academic year
 *   - Monthly: by level (optional monthly payment option)
 *   - Discounts: named discount codes with percentage or fixed amount
 *   - Penalties: per-day late payment penalty
 *   - Additional services: free-form name → price
 */
import type { AcademicLevel } from "./student";

export type PricingCategory =
  | "tuition"
  | "transport"
  | "registration"
  | "monthly"
  | "discount"
  | "penalty"
  | "additional";

export type DiscountType = "percentage" | "fixed_amount";

/** Single pricing entry. The `qualifier` disambiguates within a category. */
export interface PricingEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly category: PricingCategory;
  /** Sub-key within the category: level for tuition, tier for transport, name for additional. */
  readonly qualifier: string;
  readonly label: string;
  /** Positive number for charges (tuition, transport, etc.) and penalties.
   *  For discounts: percentage (0-100) when type=percentage, or DZD amount when type=fixed_amount (negative). */
  readonly amount: number;
  readonly discountType?: DiscountType;
  readonly isActive: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface PricingConfig {
  readonly tuitionByLevel: Record<AcademicLevel, number>;
  readonly transportByTier: Record<"t1" | "t2" | "t3", number>;
  readonly registrationFee: number;
  readonly monthlyByLevel: Partial<Record<AcademicLevel, number>>;
  readonly latePenaltyPerDay: number;
  readonly discounts: readonly PricingEntry[];
  readonly additionalServices: readonly PricingEntry[];
}

/** Convenience: look up tuition price for a level. */
export function tuitionForLevel(config: PricingConfig, level: AcademicLevel): number {
  return config.tuitionByLevel[level] ?? 0;
}

/** Convenience: look up transport price for a tier. */
export function transportForTier(config: PricingConfig, tier: "t1" | "t2" | "t3"): number {
  return config.transportByTier[tier] ?? 0;
}

/** Compute the 3-tranche schedule for tuition (plan §07.03 — Tuition = 3 tranches). */
export function tuitionTranches(
  totalAmount: number,
): ReadonlyArray<{ label: string; amountDue: number }> {
  const perTranche = Math.round(totalAmount / 3);
  const last = totalAmount - perTranche * 2; // remainder goes to last tranche
  return [
    { label: "Tranche 1", amountDue: perTranche },
    { label: "Tranche 2", amountDue: perTranche },
    { label: "Tranche 3", amountDue: last },
  ];
}

/** Apply a discount to a base amount. Returns the discounted total. */
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

export const PRICING_CATEGORY_LABELS_FR: Record<PricingCategory, string> = {
  tuition: "Scolarité",
  transport: "Transport",
  registration: "Inscription",
  monthly: "Mensualité",
  discount: "Remise",
  penalty: "Pénalité",
  additional: "Service additionnel",
};

export const DISCOUNT_TYPE_LABELS_FR: Record<DiscountType, string> = {
  percentage: "Pourcentage",
  fixed_amount: "Montant fixe",
};
