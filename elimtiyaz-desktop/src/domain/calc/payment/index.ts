/**
 * Payment calculation module — public barrel.
 *
 * Re-exports all payment calc submodules so callers can import everything
 * from `@domain/calc/payment`.
 *
 * Submodules:
 *   - `sums`         — sumPaidPayments, sumInstallmentsDue, sumInstallmentsPaid
 *   - `installments` — installmentRemaining, totalOutstanding, overdueAmount,
 *                      maxDaysOverdue, agingBucketFromDays
 *   - `revenue`      — revenueByMonth, revenueByCategory, monthlyRevenue
 */
export * from "./sums";
export * from "./installments";
export * from "./revenue";
