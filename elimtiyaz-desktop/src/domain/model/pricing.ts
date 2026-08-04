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
import { GRADE_LEVELS } from "./student";
import type { TransportDestination } from "./parent";
import { TRANSPORT_DESTINATIONS } from "./parent";

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
// Lookups & helpers — REFACTORED (iteration 1)
//
// The implementations now live in `@/domain/calc/pricing/`. The exports
// below are thin re-exports so existing imports from `@/domain/model/pricing`
// keep working. Once all call sites migrate to `@/domain/calc`, these
// re-exports can be removed.
// ---------------------------------------------------------------------------

export {
  tuitionForGradeLevel,
  tuitionForLevel,
  tuitionTranchesForGrade,
  tuitionTranches,
} from "../calc/pricing/tuition";

export {
  transportForDestination,
  transportForTier,
  transportTranchesForDestination,
} from "../calc/pricing/transport";

export {
  applyDiscount,
  findDiscountByCode,
  computeSiblingDiscount,
} from "../calc/pricing/discounts";

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
