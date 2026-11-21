/**
 * Waterfall Allocator — distributes a payment across unpaid installments
 * in chronological order (oldest due date first).
 * Guarantees: sum(allocatedAmount) + unallocatedAmount === paymentAmount.
 */
import type { Installment } from "../../model/payment";
import { clampNonNegative } from "../shared/money";
import { isInstallmentOverdue, isInstallmentSettled } from "./queries";

export interface InstallmentAllocation {
  readonly installmentId: string;
  readonly allocatedAmount: number;
  readonly newAmountPaid: number;
  readonly newAmountPending: number;
  readonly newStatus: "paid" | "partial" | "overdue" | "pending" | "pending_clearance";
  readonly fullySatisfied: boolean;
  readonly cleared: boolean;
}

export interface AllocationResult {
  readonly allocations: readonly InstallmentAllocation[];
  readonly unallocatedAmount: number;
  readonly totalAllocated: number;
  readonly paymentAmount: number;
}

function chronologically(a: Installment, b: Installment): number {
  const da = new Date(a.dueDate).getTime();
  const db = new Date(b.dueDate).getTime();
  if (da !== db) return da - db;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function allocatePaymentToInstallments(
  installments: readonly Installment[],
  paymentAmount: number,
  categoryFilter?: Installment["category"] | null,
  paymentStatus: "paid" | "pending" = "paid",
  /**
   * E2.2 (INV-4): the evaluation clock for the dynamically-derived overdue
   * verdict on the no-progress fallback branch below (overdue-ness is a
   * property of (due date, now, remaining) — never the stored status
   * string; live census: ZERO rows carry "overdue"). Optional — every
   * existing caller keeps its behavior with the wall clock.
   */
  now: Date = new Date(),
): AllocationResult {
  if (paymentAmount <= 0) {
    return { allocations: [], unallocatedAmount: 0, totalAllocated: 0, paymentAmount };
  }

  // ADR-023 (BUSINESS-106): `null` categoryFilter = the canonical
  // cross-category scope (financial-rules §4 — NULL/absent = ALL
  // categories), identical to the SQL waterfall's
  // `AND (p_category IS NULL OR category = p_category)`.
  const eligible = installments
    // E2.2 (INV-4): the canonical settled predicate — population-identical
    // in effect to the old paid-string filter (a drifted fully-covered row
    // was already excluded downstream by the insRemaining <= 0 gate; one
    // vocabulary, no string verdicts).
    .filter((i) => !isInstallmentSettled(i))
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .slice()
    .sort(chronologically);

  const allocations: InstallmentAllocation[] = [];
  let remaining = paymentAmount;
  const cleared = paymentStatus === "paid";

  for (const ins of eligible) {
    if (remaining <= 0) break;
    // INV-4 / BUSINESS-107 (finance UI audit FA-03): the canonical per-
    // tranche capacity is `due − paid − pending` for BOTH branches. The
    // A-0042 fix covered the pending branch only; the cleared branch kept
    // `due − paid`, so a cheque pending on a tranche followed by a CASH
    // payment over-allocated it (paid + pending > due) and the later
    // clearance then pushed amount_paid beyond amount_due with the excess
    // vanishing (no parent_credit booking). Both the TS reference and the
    // SQL twin (migration 0115) now subtract amount_pending everywhere,
    // matching the INV-4 family and the backend RPC.
    const insRemaining = clampNonNegative(
      ins.amountDue - ins.amountPaid - (ins.amountPending ?? 0),
    );
    if (insRemaining <= 0) continue;
    const allocate = Math.min(remaining, insRemaining);
    let newAmountPaid = ins.amountPaid;
    let newAmountPending = ins.amountPending ?? 0;
    let newStatus: InstallmentAllocation["newStatus"];
    let fullySatisfied = false;

    if (cleared) {
      newAmountPaid = ins.amountPaid + allocate;
      fullySatisfied = newAmountPaid >= ins.amountDue;
      newStatus = fullySatisfied
        ? "paid"
        : newAmountPaid > 0
          ? "partial"
          : // E2.2 (INV-4): derived, never read from the status string —
            // the stored "overdue" snapshot is unmaintained on live data
            // (zero rows); the post-allocation state decides.
            isInstallmentOverdue(
              { ...ins, amountPaid: newAmountPaid, amountPending: newAmountPending },
              now,
            )
            ? "overdue"
            : "pending";
    } else {
      newAmountPending = (ins.amountPending ?? 0) + allocate;
      fullySatisfied = false;
      newStatus = "pending_clearance";
    }

    allocations.push({
      installmentId: ins.id, allocatedAmount: allocate,
      newAmountPaid, newAmountPending, newStatus, fullySatisfied, cleared,
    });
    remaining -= allocate;
  }

  const totalAllocated = paymentAmount - remaining;
  return {
    allocations, unallocatedAmount: clampNonNegative(remaining),
    totalAllocated, paymentAmount,
  };
}

export function isOverpayment(
  installments: readonly Installment[],
  paymentAmount: number,
  categoryFilter?: Installment["category"] | null,
): boolean {
  const totalRemaining = installments
    // E2.2 (INV-4): the canonical settled predicate — same population as
    // the allocator's eligibility lane (one vocabulary).
    .filter((i) => !isInstallmentSettled(i))
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    // INV-4 (BUSINESS-107): capacity includes pending, matching the
    // allocator's cleared branch.
    .reduce(
      (s, i) => s + clampNonNegative(i.amountDue - i.amountPaid - (i.amountPending ?? 0)),
      0,
    );
  return paymentAmount > totalRemaining + 0.001;
}
