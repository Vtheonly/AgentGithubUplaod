/**
 * Payment sum helpers — single source of truth for summing payments and
 * installments.
 *
 * Extracted from `domain/model/payment.ts`:
 *   - `sumPaidPayments`        — sum of `amount` for payments with status "paid"
 *   - `sumInstallmentsDue`     — sum of `amountDue` across installments
 *   - `sumInstallmentsPaid`    — sum of `amountPaid` across installments
 *
 * Behavior preserved verbatim:
 *   - `sumPaidPayments` filters by `p.status === "paid"` (excludes pending/
 *     partial/overdue/refunded/cancelled). Use this everywhere the "total
 *     collected" / "total paid" metric is displayed.
 *   - `sumInstallmentsPaid` includes uncleared checks because `counter-payment`
 *     calls `installments.markPaid()` after `payments.collect()` regardless
 *     of payment status. Use this for tranche progress display.
 */
import type { Payment, Installment } from "@/domain/model/payment";
import { sumOf } from "../shared/money";

/**
 * Sum of `amount` for payments whose status is "paid".
 *
 * Excludes pending/unpaid checks and transfers — a payment is only
 * counted as revenue once it has cleared. Use this everywhere the
 * "total collected" or "total paid" metric is displayed.
 */
export function sumPaidPayments(payments: readonly Payment[]): number {
  return sumOf(
    payments.filter((p) => p.status === "paid"),
    (p) => p.amount,
  );
}

/**
 * Sum of `amountDue` across installments. This is the gross amount
 * the parent owes (independent of what has been paid).
 */
export function sumInstallmentsDue(installments: readonly Installment[]): number {
  return sumOf(installments, (i) => i.amountDue);
}

/**
 * Sum of `amountPending` across installments — uncleared non-cash funds
 * (pending checks / transfers) sitting on tranches. INV-4 family: pending
 * funds reduce the remaining amount but never mark a tranche paid.
 * Added by T-103 so `totalOutstanding` can honour the canonical
 * `amount_due − amount_paid − amount_pending` rule.
 */
export function sumInstallmentsPending(installments: readonly Installment[]): number {
  return sumOf(installments, (i) => i.amountPending);
}

/**
 * Sum of `amountPaid` across installments. This is the amount
 * allocated against installments — it INCLUDES uncleared checks because
 * `counter-payment` calls `installments.markPaid()` after `payments.collect()`
 * regardless of payment status. Use this for tranche progress display.
 */
export function sumInstallmentsPaid(installments: readonly Installment[]): number {
  return sumOf(installments, (i) => i.amountPaid);
}
