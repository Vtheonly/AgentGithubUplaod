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
 *   - Tuition: by granular grade level (prescolaire_1 ... 3eme_annee)
 *   - Transport: by named destination (ville_boumerdes / tidjelabine_sahel_figuier_corso /
 *                boudouaou_thenia_zemmouri / autres) — each with its own 3-tranche schedule
 *   - Registration: flat per academic year
 *   - Complementary services: psychology / speech therapy with semester & annual options
 *   - Additional services: free-form name → price (canteen, uniform, books, 2nd apron, clubs)
 *   - Discounts: named discount codes with percentage or fixed amount
 *   - Penalties: per-day late payment penalty
 *
 * Iteration 6 changes:
 *   - Tuition is now keyed by `GradeLevel` (14 grades) instead of `AcademicLevel` (3 levels).
 *   - Each grade level has its own 3-tranche installment schedule.
 *   - Transport is now keyed by `TransportDestination` (4 named zones) with per-destination
 *     3-tranche schedules — replacing the abstract T1/T2/T3 tiers.
 *   - 5 canonical discount codes per the official 2026-2027 schedule:
 *       * passage_palier — fixed −10,000 DA (grade-level transition)
 *       * seniority_5y   — 5% (more than 5 years seniority)
 *       * full_annual    — 10% (full annual payment before June 30)
 *       * highest_average — 10% (student with highest average in grade level)
 *       * sibling_fixed  — fixed −5,000 DA per additional student
 *   - Complementary services (psychology, speech therapy) with semester/annual options.
 *   - 2nd apron surcharge (2,000 DA).
 *
 * Backward-compatibility helpers (`tuitionForLevel`, `transportForTier`) are kept
 * but delegate to the new structure with sensible defaults.
 */
import type { AcademicLevel } from "./student";
import type { GradeLevel } from "./student";
import { GRADE_LEVELS, academicLevelFromGradeLevel, gradeLevelFromLevelYear } from "./student";
import type { TransportDestination } from "./parent";
import { TRANSPORT_DESTINATIONS, cityTierToDestination } from "./parent";

export type PricingCategory =
  | "tuition"
  | "transport"
  | "registration"
  | "monthly"
  | "discount"
  | "penalty"
  | "additional"
  | "complementary";

export type DiscountType = "percentage" | "fixed_amount";

/**
 * Canonical discount codes recognized by the billing engine.
 * Adding a new code here automatically makes it selectable in the
 * Account Adjustment modal — no UI changes required.
 */
export type DiscountCode =
  | "passage_palier"
  | "seniority_5y"
  | "full_annual"
  | "highest_average"
  | "sibling_fixed"
  | "sibling_10"
  | "sibling_15"
  | "early_bird"
  | "custom";

export const DISCOUNT_CODE_LABELS_FR: Record<DiscountCode, string> = {
  passage_palier: "Passage de palier (−10 000 DA)",
  seniority_5y: "Ancienneté > 5 ans (−5%)",
  full_annual: "Paiement annuel avant le 30 juin (−10%)",
  highest_average: "Meilleure moyenne du palier (−10%)",
  sibling_fixed: "Fratrie — par enfant supplémentaire (−5 000 DA)",
  sibling_10: "Fratrie — 2ème enfant (−10%) [legacy]",
  sibling_15: "Fratrie — 3ème enfant et + (−15%) [legacy]",
  early_bird: "Paiement anticipé annuel (−5%) [legacy]",
  custom: "Remise personnalisée",
};

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
  /** For discounts, the canonical code (drives UI grouping + ledger metadata). */
  readonly discountCode?: DiscountCode;
  readonly isActive: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/**
 * Per-grade-level tuition configuration.
 *
 * The annual amount AND the 3-tranche installment schedule are both stored,
 * so each grade can have its own non-equal tranche split (per the official
 * 2026-2027 fee schedule where T1 ≠ T2 ≠ T3 for most grades).
 */
export interface TuitionPricing {
  readonly annualAmount: number;
  /** Exactly 3 tranches — `installments[0]` is due at registration, etc. */
  readonly installments: readonly [number, number, number];
}

/**
 * Per-destination transport configuration.
 *
 * Each destination has its own 3-tranche schedule:
 *   - Tranche 1: due at registration
 *   - Tranche 2: due Dec 01 – Dec 15
 *   - Tranche 3: due Mar 01 – Mar 15
 */
export interface TransportPricing {
  readonly annualAmount: number;
  readonly installments: readonly [number, number, number];
}

/** Complementary service with semester & annual pricing options. */
export interface ComplementaryServicePricing {
  readonly semesterAmount: number;
  readonly annualAmount: number;
}

export interface PricingConfig {
  /** Per-grade-level tuition (14 entries — one per `GradeLevel`). */
  readonly tuitionByGradeLevel: Record<GradeLevel, TuitionPricing>;
  /** Per-destination transport (4 entries — one per `TransportDestination`). */
  readonly transportByDestination: Record<TransportDestination, TransportPricing>;
  readonly registrationFee: number;
  readonly monthlyByLevel: Partial<Record<AcademicLevel, number>>;
  readonly latePenaltyPerDay: number;
  readonly discounts: readonly PricingEntry[];
  readonly additionalServices: readonly PricingEntry[];
  /** Complementary services — psychology sessions, speech therapy sessions. */
  readonly complementaryServices: readonly (PricingEntry & ComplementaryServicePricing)[];
  /** 2nd apron surcharge — fixed at 2,000 DA per the official schedule. */
  readonly secondApronFee: number;
}

// ---------------------------------------------------------------------------
// Lookups & helpers
// ---------------------------------------------------------------------------

/** Convenience: look up the TuitionPricing for a granular grade level. */
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

/** Convenience: look up transport pricing for a destination. */
export function transportForDestination(
  config: PricingConfig,
  destination: TransportDestination,
): TransportPricing {
  return (
    config.transportByDestination[destination] ?? {
      annualAmount: 0,
      installments: [0, 0, 0],
    }
  );
}

/** Convenience: look up transport annual amount for a legacy tier. */
export function transportForTier(
  config: PricingConfig,
  tier: "t1" | "t2" | "t3",
): number {
  const destination = cityTierToDestination(tier);
  if (!destination) return 0;
  return transportForDestination(config, destination).annualAmount;
}

/**
 * Compute the 3-tranche schedule for tuition given a grade level.
 *
 * Returns the per-tranche schedule stored in `PricingConfig.tuitionByGradeLevel`
 * — which may be a non-equal split per the official fee schedule.
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
 */
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

/**
 * Compute the 3-tranche schedule for transport given a destination.
 *
 * Tranche 1 is due at registration, Tranche 2 Dec 01–15, Tranche 3 Mar 01–15.
 */
export function transportTranchesForDestination(
  config: PricingConfig,
  destination: TransportDestination,
): ReadonlyArray<{ label: string; amountDue: number }> {
  const pricing = transportForDestination(config, destination);
  return [
    { label: "Tranche 1 (À l'inscription)", amountDue: pricing.installments[0] },
    { label: "Tranche 2 (01 Déc – 15 Déc)", amountDue: pricing.installments[1] },
    { label: "Tranche 3 (01 Mar – 15 Mar)", amountDue: pricing.installments[2] },
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

/** Find a discount entry by its canonical code. */
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

export const PRICING_CATEGORY_LABELS_FR: Record<PricingCategory, string> = {
  tuition: "Scolarité",
  transport: "Transport",
  registration: "Inscription",
  monthly: "Mensualité",
  discount: "Remise",
  penalty: "Pénalité",
  additional: "Service additionnel",
  complementary: "Service complémentaire",
};

export const DISCOUNT_TYPE_LABELS_FR: Record<DiscountType, string> = {
  percentage: "Pourcentage",
  fixed_amount: "Montant fixe",
};

// Re-export transport destinations for convenience.
export { TRANSPORT_DESTINATIONS, GRADE_LEVELS };
