/**
 * Clearance transition — moves uncleared funds into cleared funds when the
 * bank confirms a check / transfer (vault §07.02: PENDING → PAID on
 * "bank clearance verified").
 *
 * Mirrors the LIFO reversal module's shape so the repository layer can use
 * both symmetrically:
 *   - `revertPaymentAllocation` (LIFO) — used when a payment FAILS (bounce).
 *   - `clearPendingAllocation` (FIFO / waterfall order) — used when a
 *     payment CLEARS. Uncleared funds were originally applied oldest-tranche
 *     first by the waterfall, so the clearing pass walks the same order and
 *     moves each tranche's `amountPending` into `amountPaid`.
 *
 * Invariant 4 (Cleared Funds Only): a tranche may only be `"paid"` when its
 * CLEARED funds (`amountPaid`) cover `amountDue` — enforced here by
 * re-evaluating the status from `newAmountPaid` only.
 */
import type { Installment } from "../../model/payment";
import { reevaluateInstallmentStatus } from "./lifo-reversal";

export interface ClearAllocation {
  readonly installmentId: string;
  readonly clearedAmount: number;
  readonly newAmountPaid: number;
  readonly newAmountPending: number;
  readonly newStatus: "paid" | "partial" | "overdue" | "pending";
  readonly fullySatisfied: boolean;
}

export interface ClearAllocationResult {
  readonly clears: readonly ClearAllocation[];
  readonly totalCleared: number;
  readonly unclearedAmount: number;
  readonly requestedAmount: number;
}

function chronologically(a: Installment, b: Installment): number {
  const da = new Date(a.dueDate).getTime();
  const db = new Date(b.dueDate).getTime();
  if (da !== db) return da - db;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Move up to `clearAmount` of uncleared (`amountPending`) funds into cleared
 * (`amountPaid`) funds, oldest tranche first — the same order the waterfall
 * originally applied them.
 *
 * @param installments  The parent's installments (all of them; filtered here).
 * @param clearAmount   Total uncleared amount to clear (typically the
 *                      payment's `amount`).
 * @param categoryFilter Optional — restrict to one category (matches the
 *                      allocation-time category filter).
 */
export function clearPendingAllocation(
  installments: readonly Installment[],
  clearAmount: number,
  categoryFilter?: Installment["category"],
  now: Date = new Date(),
): ClearAllocationResult {
  if (clearAmount <= 0) {
    return { clears: [], totalCleared: 0, unclearedAmount: 0, requestedAmount: clearAmount };
  }

  const eligible = installments
    .filter((i) => (i.amountPending ?? 0) > 0)
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .slice()
    .sort(chronologically);

  const clears: ClearAllocation[] = [];
  let remaining = clearAmount;

  for (const ins of eligible) {
    if (remaining <= 0) break;
    const pending = ins.amountPending ?? 0;
    if (pending <= 0) continue;
    const moved = Math.min(remaining, pending);
    const newAmountPaid = ins.amountPaid + moved;
    const newAmountPending = Math.max(0, pending - moved);
    const newStatus = reevaluateInstallmentStatus(newAmountPaid, ins.amountDue, ins.dueDate, now);
    clears.push({
      installmentId: ins.id,
      clearedAmount: moved,
      newAmountPaid,
      newAmountPending,
      newStatus,
      fullySatisfied: newStatus === "paid",
    });
    remaining -= moved;
  }

  const totalCleared = clearAmount - remaining;
  return {
    clears,
    totalCleared,
    unclearedAmount: Math.max(0, remaining),
    requestedAmount: clearAmount,
  };
}
