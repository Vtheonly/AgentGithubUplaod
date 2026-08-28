/**
 * Waterfall Allocator — distributes a payment across unpaid installments
 * in chronological order (oldest due date first).
 * Guarantees: sum(allocatedAmount) + unallocatedAmount === paymentAmount.
 */
import type { Installment } from "../../model/payment";
import { clampNonNegative } from "../shared/money";

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
  categoryFilter?: Installment["category"],
  paymentStatus: "paid" | "pending" = "paid",
): AllocationResult {
  if (paymentAmount <= 0) {
    return { allocations: [], unallocatedAmount: 0, totalAllocated: 0, paymentAmount };
  }

  const eligible = installments
    .filter((i) => i.status !== "paid")
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .slice()
    .sort(chronologically);

  const allocations: InstallmentAllocation[] = [];
  let remaining = paymentAmount;
  const cleared = paymentStatus === "paid";

  for (const ins of eligible) {
    if (remaining <= 0) break;
    // EQUIVALENCE FIX (finding A-0042-PENDING-CAPACITY, scenario
    // fin-024-double-pending-collection-capacity): the pending-funds
    // waterfall must subtract the tranche's EXISTING uncleared allocation
    // from its remaining capacity. Using amountDue - amountPaid for both
    // branches let a second pending payment push amountPending BEYOND
    // amountDue — when both checks later cleared, amountPaid exceeded
    // amountDue and the excess money vanished (no parent credit). The
    // backend RPC (collect_and_allocate_payment, canonical 0034) already
    // computed capacity as amountDue - amountPaid - amountPending; the
    // canonical engine now mirrors it (INV-6/INV-7).
    const insRemaining = cleared
      ? clampNonNegative(ins.amountDue - ins.amountPaid)
      : clampNonNegative(ins.amountDue - ins.amountPaid - (ins.amountPending ?? 0));
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
          : ins.status === "overdue"
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
  categoryFilter?: Installment["category"],
): boolean {
  const totalRemaining = installments
    .filter((i) => i.status !== "paid")
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .reduce((s, i) => s + clampNonNegative(i.amountDue - i.amountPaid), 0);
  return paymentAmount > totalRemaining + 0.001;
}
