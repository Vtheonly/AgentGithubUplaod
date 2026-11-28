/**
 * Payment calculation module — public barrel.
 *
 * Re-exports all payment calc submodules so callers can import everything
 * from `@domain/calc/payment`.
 *
 * Submodules:
 *   - `sums`               — sumPaidPayments, sumInstallmentsDue, sumInstallmentsPaid
 *   - `queries`            — installmentRemaining, totalOutstanding, overdueAmount,
 *                            isInstallmentOverdue (T-426 — THE dynamic-overdue
 *                            predicate), maxDaysOverdue, agingBucketFromDays,
 *                            currentTrancheLabel
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
 *   - `payment-coverage`   — resolvePaymentAllocations (THE T-330 precedence
 *                            chain) + buildPaymentCoverage (T-579 — the ONE
 *                            every-detail coverage view model shared by the
 *                            card, the modal, the receipt PDF and the
 *                            account-statement PDF)
 *   - `payment-conflict`   — T-638 / ADR-038: the ONE canonical payment
 *                            comparison + conflict classification engine
 *                            (multi-attribute, missing-info tolerant,
 *                            explainable) shared by the workbook-import
 *                            preview and the financial auditor
 */
export * from "./sums";
export * from "./queries";
export * from "./waterfall-allocator";
export * from "./lifo-reversal";
export * from "./clearance";
export * from "./revenue";
export * from "./billing-breakdown";
export * from "./payment-coverage";
export * from "./payment-conflict";
