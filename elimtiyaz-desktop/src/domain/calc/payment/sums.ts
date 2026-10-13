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
import { isAtOrBefore } from "../shared/dates";

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

/**
 * Sum of `amount` for payments whose status is "pending" (T-168).
 *
 * Uncleared non-cash funds (cheques / transfers awaiting bank clearance).
 * `collect_and_allocate_payment` books these on `installments.amount_pending`,
 * so the derived reconciliation (`billing-breakdown.ts`) subtracts them
 * after the cleared total to honour the server balance exactly. Mirrors
 * `sumPaidPayments` semantics (status-strict, amount-positive).
 */
export function sumPendingPayments(payments: readonly Payment[]): number {
  return sumOf(
    payments.filter((p) => p.status === "pending"),
    (p) => p.amount,
  );
}

// ─── T-517 / BUSINESS-111 — the as-of pair ─────────────────────────────────
//
// The canonical ledger replay (`computeAccountBalance`,
// `domain/calc/ledger/balance.ts`) filters entries by
// `isAtOrBefore(e.at, now)` — every BALANCE displayed anywhere is an AS-OF
// replay that EXCLUDES future-dated entries (AGENTS.md §15.95a). A
// payments-table-derived total shown BESIDE such a balance must apply the
// SAME cutoff, otherwise the two surfaces read different payment
// populations of one family and contradict each other (BUSINESS-111: the
// Family Account modal's 441 000 "Payé" card vs its 1 310 000 / 100 %
// coverage stack — the T-502/DATA-062 import remediation anchored 735
// corpus-wide payments to future tranche periods, and `sumPaidPayments`
// counted them while the replay did not).
//
// The split is CONSERVATIVE on missing dates: a `paid` payment with no
// `collectedAt` counts as COLLECTED (the pre-T-517 behavior) — the defect
// class is precisely "explicitly dated in the future", never "date
// unknown". Both helpers are status-strict ("paid" only), amount-positive,
// and partition the `sumPaidPayments` population exactly:
//   sumPaidPayments(p) === sumPaidPaymentsAsOf(p, now)
//                          + sumFutureRecordedPaidPayments(p, now)
// for any fixed `now`.

/**
 * Sum of `amount` for status="paid" payments whose `collectedAt` is at or
 * before `now` (or missing — see the module note). The balance-consistent
 * "collected to date" figure: applies the canonical ledger replay's own
 * `isAtOrBefore` predicate so a payments-derived total can never disagree
 * with the as-of balance displayed beside it (T-517 / BUSINESS-111).
 */
export function sumPaidPaymentsAsOf(
  payments: readonly Payment[],
  now: Date = new Date(),
): number {
  return sumOf(
    payments.filter(
      (p) =>
        p.status === "paid" &&
        (!p.collectedAt || isAtOrBefore(p.collectedAt, now)),
    ),
    (p) => p.amount,
  );
}

/**
 * Sum of `amount` for status="paid" payments whose `collectedAt` is
 * STRICTLY after `now`. This is the future-recorded class — money the
 * books mark received but dated to a future period (the T-502 import
 * bucket anchors). NEVER counted as collected-to-date; surfaced as its
 * own labelled line so the divergence to the as-of balance stays visible
 * and auditable (§15.95a: surface the arithmetic, never rewrite the date).
 */
export function sumFutureRecordedPaidPayments(
  payments: readonly Payment[],
  now: Date = new Date(),
): number {
  return sumOf(
    payments.filter(
      (p) =>
        p.status === "paid" &&
        !!p.collectedAt &&
        !isAtOrBefore(p.collectedAt, now),
    ),
    (p) => p.amount,
  );
}
