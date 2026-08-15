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
 *   - `revenue`            — revenueByMonth, revenueByCategory, monthlyRevenue
 */
export * from "./sums";
export * from "./queries";
export * from "./waterfall-allocator";
export * from "./lifo-reversal";
export * from "./revenue";
