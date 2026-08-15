/**
 * LIFO Reversal — reverses a prior waterfall allocation in reverse chronological order.
 * Invariant 5: reversalEntry.amount + originalEntry.amount === 0.
 */
import type { Installment } from "../../model/payment";
import { clampNonNegative } from "../shared/money";
import { isStrictlyPast } from "../shared/dates";

export interface RevertAllocation {
  readonly installmentId: string;
  readonly revertedAmount: number;
  readonly newAmountPaid: number;
  readonly newAmountPending: number;
  readonly newStatus: "paid" | "partial" | "overdue" | "pending";
  readonly reopened: boolean;
}

export interface RevertAllocationResult {
  readonly reverts: readonly RevertAllocation[];
  readonly totalReverted: number;
  readonly unrevertedAmount: number;
  readonly reversalAmount: number;
}

export function reevaluateInstallmentStatus(
  amountPaid: number, amountDue: number, dueDate: string, now: Date = new Date(),
): "paid" | "partial" | "overdue" | "pending" {
  if (amountPaid >= amountDue && amountDue > 0) return "paid";
  if (amountPaid > 0) return "partial";
  return isStrictlyPast(dueDate, now) ? "overdue" : "pending";
}

function reverseChronologically(a: Installment, b: Installment): number {
  const da = new Date(a.dueDate).getTime();
  const db = new Date(b.dueDate).getTime();
  if (da !== db) return db - da;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function revertPaymentAllocation(
  installments: readonly Installment[],
  reversalAmount: number,
  categoryFilter?: Installment["category"],
  originalWasPending: boolean = false,
  now: Date = new Date(),
): RevertAllocationResult {
  if (reversalAmount <= 0) {
    return { reverts: [], totalReverted: 0, unrevertedAmount: 0, reversalAmount };
  }

  const eligible = installments
    .filter((i) => originalWasPending ? (i.amountPending ?? 0) > 0 : i.amountPaid > 0)
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .slice()
    .sort(reverseChronologically);

  const reverts: RevertAllocation[] = [];
  let remaining = reversalAmount;

  for (const ins of eligible) {
    if (remaining <= 0) break;
    const bucket = originalWasPending ? (ins.amountPending ?? 0) : ins.amountPaid;
    if (bucket <= 0) continue;
    const revert = Math.min(remaining, bucket);
    const newAmountPaid = originalWasPending ? ins.amountPaid : Math.max(0, ins.amountPaid - revert);
    const newAmountPending = originalWasPending ? Math.max(0, (ins.amountPending ?? 0) - revert) : (ins.amountPending ?? 0);
    const newStatus = reevaluateInstallmentStatus(newAmountPaid, ins.amountDue, ins.dueDate, now);
    const reopened = ins.status === "paid" && newStatus !== "paid";
    reverts.push({
      installmentId: ins.id, revertedAmount: revert,
      newAmountPaid, newAmountPending, newStatus, reopened,
    });
    remaining -= revert;
  }

  const totalReverted = reversalAmount - remaining;
  return {
    reverts, totalReverted,
    unrevertedAmount: clampNonNegative(remaining), reversalAmount,
  };
}
