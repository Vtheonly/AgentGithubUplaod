/**
 * Pricing calculation module — public barrel.
 *
 * Re-exports all pricing calc submodules so callers can import everything
 * from `@domain/calc/pricing`.
 *
 * Submodules:
 *   - `discounts` — applyDiscount, findDiscountByCode, computeSiblingDiscount
 *   - `tuition`   — tuitionForGradeLevel, tuitionForLevel,
 *                   tuitionTranchesForGrade, tuitionTranches
 *   - `transport` — transportForDestination, transportForTier,
 *                   transportTranchesForDestination
 */
export * from "./discounts";
export * from "./tuition";
export * from "./transport";
