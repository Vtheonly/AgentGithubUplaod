/**
 * Payment calculation module — public barrel.
 *
 * Re-exports all payment calc submodules so callers can import everything
 * from `@domain/calc/payment`.
 *
 * Submodules:
 *   - `sums`               — sumPaidPayments, sumInstallmentsDue, sumInstallmentsPaid
 *   - `queries`            — installmentRemaining, totalOutstanding, overdueAmount,
 *                            maxDaysOverdue, agingBucketFromDays, currentTrancheLabel
 *   - `waterfall-allocator` — allocatePaymentToInstallments, isOverpayment
 *   - `lifo-reversal`      — revertPaymentAllocation, reevaluateInstallmentStatus
 *   - `clearance`          — clearPendingAllocation (PENDING → PAID bank clearance)
 *   - `revenue`            — revenueByMonth, revenueByCategory, monthlyRevenue
 *   - `billing-breakdown`  — computeParentBillingBreakdown, describeAdjustment,
 *                            classifyAdjustmentHistory (T-168 provenance),
 *                            adjustment-aware reconciliation
 *                            (T-164/T-168: read-side derivation behind the
 *                            parent drawer / portal "Prestations facturées"
 *                            views)
 */
export * from "./sums";
export * from "./queries";
export * from "./waterfall-allocator";
export * from "./lifo-reversal";
export * from "./clearance";
export * from "./revenue";
export * from "./billing-breakdown";
