/**
 * Pricing calculation module — public barrel.
 *
 * Re-exports all pricing calc submodules so callers can import everything
 * from `@domain/calc/pricing`.
 *
 * Submodules:
 *   - `discount-rules`  — 5 canonical discount evaluators + legacy pricing-config
 *                         helpers (applyDiscount, findDiscountByCode,
 *                         computeSiblingDiscount)
 *   - `discount-engine` — evaluateAllSystemDiscounts, sumDiscounts
 *   - `tuition`         — tuitionForGradeLevel, tuitionForLevel,
 *                         tuitionTranchesForGrade, tuitionTranches
 *   - `transport`       — transportForDestination, transportForTier,
 *                         transportTranchesForDestination
 */
export * from "./discount-rules";
export * from "./discount-engine";
export * from "./tuition";
export * from "./transport";
// Re-export the pricing model types so callers can import everything
// (including `type PricingConfig`) from `@domain/calc/pricing`.
export type {
  PricingConfig,
  PricingEntry,
  TuitionPricing,
  TransportPricing,
} from "@/domain/model/pricing";
