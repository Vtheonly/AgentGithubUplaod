/**
 * Installment calculation helpers — single source of truth for per-installment
 * and parent-level installment math.
 *
 * Extracted from `domain/model/payment.ts`:
 *   - `installmentRemaining`  — remaining on a single installment (clamped ≥ 0)
 *   - `totalOutstanding`      — sum of remaining across all installments
 *   - `overdueAmount`         — sum of remaining for overdue installments
 *   - `maxDaysOverdue`        — worst (max) days overdue across installments
 *   - `agingBucketFromDays`   — maps a days-overdue number to an aging bucket
 *
 * Behavior preserved verbatim:
 *   - "Overdue" = `status !== "paid"` AND `dueDate < now`.
 *   - `maxDaysOverdue` uses `Math.floor((now - dueDate) / MS_PER_DAY)` (days).
 *   - `agingBucketFromDays` boundaries: 0-30, 31-60, 61-90, 91-180, 180+.
 */
import type { Installment, AgingBucket } from "@/domain/model/payment";
import { clampNonNegative, sumOf } from "../shared/money";
import { daysBetweenFloor, isStrictlyPast } from "../shared/dates";
import { sumInstallmentsDue, sumInstallmentsPaid } from "./sums";

/**
 * Remaining amount on a single installment: `amountDue - amountPaid`.
 * Never negative (clamped at 0 via `Math.max(0, ...)`, preserved from original).
 */
export function installmentRemaining(installment: Installment): number {
  return clampNonNegative(installment.amountDue - installment.amountPaid);
}

/**
 * Total remaining balance for a parent across all installments.
 * Equals `sumInstallmentsDue - sumInstallmentsPaid`, clamped at 0.
 */
export function totalOutstanding(installments: readonly Installment[]): number {
  return clampNonNegative(
    sumInstallmentsDue(installments) - sumInstallmentsPaid(installments),
  );
}

/**
 * Overdue amount: the portion of the outstanding balance whose
 * installment due date has already passed AND the installment is not
 * fully paid.
 *
 * `now` is injectable for testability.
 */
export function overdueAmount(
  installments: readonly Installment[],
  now: Date = new Date(),
): number {
  const overdueInstallments = installments.filter(
    (i) => i.status !== "paid" && isStrictlyPast(i.dueDate, now),
  );
  return sumOf(overdueInstallments, (i) => installmentRemaining(i));
}

/**
 * Days overdue for a parent's worst (max) overdue installment.
 * Returns 0 if no installments are overdue.
 *
 * Implementation note: uses `daysBetweenFloor(dueDate, now)` from
 * `calc/shared/dates` to guarantee the same `Math.floor(... / 86_400_000)`
 * behavior as the original inline code.
 */
export function maxDaysOverdue(
  installments: readonly Installment[],
  now: Date = new Date(),
): number {
  const overdueDays = installments
    .filter((i) => i.status !== "paid" && isStrictlyPast(i.dueDate, now))
    .map((i) => daysBetweenFloor(i.dueDate, now));
  return overdueDays.length === 0 ? 0 : Math.max(...overdueDays);
}

/**
 * Map a days-overdue number to an aging bucket.
 *
 * Boundaries (preserved from original):
 *   - 0–30 days   → "0_30"
 *   - 31–60 days  → "31_60"
 *   - 61–90 days  → "61_90"
 *   - 91–180 days → "91_180"
 *   - 181+ days   → "180_plus"
 *
 * Note: negative inputs (future due dates) are treated as 0 days.
 */
export function agingBucketFromDays(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 30) return "0_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  if (daysOverdue <= 180) return "91_180";
  return "180_plus";
}

/* ============================================================ */
/*  Waterfall Allocation Engine (Payment → Tranches)            */
/*                                                              */
/*  Distributes a single payment amount sequentially across     */
/*  unpaid / partially-paid installments in chronological       */
/*  order (oldest first). Guarantees that the Ledger and the    */
/*  Installment table stay mathematically in sync:              */
/*                                                              */
/*    sum(allocatedAmount) + unallocatedAmount === paymentAmount*/
/*                                                              */
/*  Any excess (overpayment) is returned as `unallocatedAmount` */
/*  so the caller can store it as parent credit.                */
/*                                                              */
/*  UNIFIED ARCHITECTURE:                                       */
/*  - Branches on `paymentStatus`:                              */
/*    * "paid"     → increments `amountPaid`; may transition    */
/*                   status to "paid" / "partial".              */
/*    * "pending"  → increments `amountPending` ONLY; status    */
/*                   transitions to "pending_clearance"; the    */
/*                   tranche is NOT considered satisfied until   */
/*                   the underlying payment clears the bank.    */
/*  - `InstallmentAllocation` now also reports the new          */
/*    `amountPending` value and distinguishes cleared vs        */
/*    pending allocations.                                     */
/* ============================================================ */

/**
 * A single allocation result — how much of the payment was applied
 * to a specific installment, plus the resulting post-allocation
 * state of that installment.
 */
export interface InstallmentAllocation {
  /** ID of the installment that received funds. */
  readonly installmentId: string;
  /** Amount of the payment applied to this installment (>= 0). */
  readonly allocatedAmount: number;
  /** New `amountPaid` value for this installment after allocation. */
  readonly newAmountPaid: number;
  /** New `amountPending` value for this installment after allocation. */
  readonly newAmountPending: number;
  /** New `status` value for this installment after allocation. */
  readonly newStatus: "paid" | "partial" | "overdue" | "pending" | "pending_clearance";
  /** True if this installment transitioned from non-paid to paid. */
  readonly fullySatisfied: boolean;
  /** Whether this allocation was a cleared (paid) or pending allocation. */
  readonly cleared: boolean;
}

/**
 * Result of the waterfall allocation — the per-installment
 * breakdown plus any leftover amount that couldn't be applied
 * (overpayment / advance credit).
 */
export interface AllocationResult {
  /** Per-installment allocations, in the order they were satisfied. */
  readonly allocations: readonly InstallmentAllocation[];
  /** Leftover amount that exceeded all outstanding installments. */
  readonly unallocatedAmount: number;
  /** Sum of all `allocatedAmount` values (convenience for callers). */
  readonly totalAllocated: number;
  /** The original payment amount that was being allocated. */
  readonly paymentAmount: number;
}

/**
 * Pure function: allocate a payment across unpaid installments in
 * chronological order (oldest due date first), like a waterfall.
 *
 * Rules:
 *   1. Only installments where `status !== "paid"` are eligible.
 *   2. Eligible installments are sorted by `dueDate` ASC (oldest first).
 *      Ties broken by `id` ASC for determinism.
 *   3. The payment is applied to the first eligible installment up to
 *      its remaining balance; any remainder flows to the next.
 *   4. Branch on `paymentStatus`:
 *        - `"paid"`: increment `amountPaid`. If `amountPaid >= amountDue`,
 *          transition status to `"paid"`; else if `amountPaid > 0`,
 *          transition to `"partial"`.
 *        - `"pending"`: increment `amountPending` ONLY. Transition status
 *          to `"pending_clearance"`. Do NOT touch `amountPaid` and do NOT
 *          transition to `"paid"` — Invariant 4 (Cleared Funds Only).
 *   5. If the payment exceeds the sum of all remaining balances, the
 *      excess is returned as `unallocatedAmount` (parent credit).
 *
 * This function is PURE — it does not mutate the input installments.
 * Callers (repository layer) must persist the resulting new states.
 *
 * @param installments     All installments for the parent (or for a
 *                         category-filtered subset). The function will
 *                         filter and sort internally.
 * @param paymentAmount    The total amount being paid. Must be >= 0.
 * @param categoryFilter   Optional — if provided, only installments
 *                         matching this category are eligible.
 * @param paymentStatus    Clearing status of the underlying payment.
 *                         Defaults to `"paid"` (cash). Use `"pending"`
 *                         for uncleared checks/transfers.
 */
export function allocatePaymentToInstallments(
  installments: readonly Installment[],
  paymentAmount: number,
  categoryFilter?: Installment["category"],
  paymentStatus: "paid" | "pending" = "paid",
): AllocationResult {
  if (paymentAmount <= 0) {
    return {
      allocations: [],
      unallocatedAmount: 0,
      totalAllocated: 0,
      paymentAmount,
    };
  }

  const eligible = installments
    .filter((i) => i.status !== "paid")
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .slice()
    .sort((a, b) => {
      const da = new Date(a.dueDate).getTime();
      const db = new Date(b.dueDate).getTime();
      if (da !== db) return da - db;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const allocations: InstallmentAllocation[] = [];
  let remaining = paymentAmount;
  const cleared = paymentStatus === "paid";

  for (const ins of eligible) {
    if (remaining <= 0) break;
    // For cleared payments, the remaining debt is `amountDue - amountPaid`.
    // For pending payments, we still allocate against (amountDue - amountPaid),
    // but the funds land in `amountPending` — they don't reduce the debt yet.
    const insRemaining = clampNonNegative(ins.amountDue - ins.amountPaid);
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
      // Pending: funds land in amountPending; status becomes "pending_clearance".
      newAmountPending = (ins.amountPending ?? 0) + allocate;
      fullySatisfied = false; // Never satisfied by pending funds.
      newStatus = "pending_clearance";
    }

    allocations.push({
      installmentId: ins.id,
      allocatedAmount: allocate,
      newAmountPaid,
      newAmountPending,
      newStatus,
      fullySatisfied,
      cleared,
    });
    remaining -= allocate;
  }

  const totalAllocated = paymentAmount - remaining;
  return {
    allocations,
    unallocatedAmount: clampNonNegative(remaining),
    totalAllocated,
    paymentAmount,
  };
}

/* ============================================================ */
/*  Reverse-Waterfall (LIFO) — Refunds / Cancellations          */
/*                                                              */
/*  When a payment is refunded, canceled, or rejected (e.g. a    */
/*  bounced check), the original waterfall allocation must be    */
/*  reversed. This function walks the installments in REVERSE    */
/*  chronological order (newest satisfied tranche first) and     */
/*  subtracts the reversal amount from `amountPaid` (or          */
/*  `amountPending` if the original payment was uncleared).      */
/*                                                              */
/*  Invariant 5 (Reversal Balance):                              */
/*    reversalEntry.amount + originalEntry.amount === 0          */
/*                                                              */
/*  After un-allocation, each affected installment's status is   */
/*  re-evaluated:                                               */
/*    - amountPaid >= amountDue           → "paid"               */
/*    - amountPaid > 0                    → "partial"            */
/*    - amountPaid === 0 & dueDate < now  → "overdue"            */
/*    - amountPaid === 0 & dueDate >= now → "pending"            */
/* ============================================================ */

/**
 * A single un-allocation result — how much was subtracted from a
 * specific installment, plus the resulting post-reversal state.
 */
export interface RevertAllocation {
  readonly installmentId: string;
  /** Amount subtracted from this installment (>= 0). */
  readonly revertedAmount: number;
  readonly newAmountPaid: number;
  readonly newAmountPending: number;
  readonly newStatus: "paid" | "partial" | "overdue" | "pending";
  /** True if the installment transitioned from "paid" to non-paid. */
  readonly reopened: boolean;
}

/**
 * Result of the reverse-waterfall un-allocation.
 *
 * Invariant: `sum(revertedAmount) === min(reversalAmount, totalRevertible)`.
 */
export interface RevertAllocationResult {
  readonly reverts: readonly RevertAllocation[];
  /** Sum of all `revertedAmount` values. */
  readonly totalReverted: number;
  /** Leftover reversal amount that couldn't be absorbed (rare —
   *  indicates a data-integrity problem). */
  readonly unrevertedAmount: number;
  readonly reversalAmount: number;
}

/**
 * Re-evaluate an installment's status based on its post-reversal
 * `amountPaid` and `dueDate` vs `now`.
 */
export function reevaluateInstallmentStatus(
  amountPaid: number,
  amountDue: number,
  dueDate: string,
  now: Date = new Date(),
): "paid" | "partial" | "overdue" | "pending" {
  if (amountPaid >= amountDue && amountDue > 0) return "paid";
  if (amountPaid > 0) return "partial";
  // amountPaid === 0
  return isStrictlyPast(dueDate, now) ? "overdue" : "pending";
}

/**
 * Pure function: reverse a prior waterfall allocation in LIFO order
 * (newest satisfied tranche un-allocated first).
 *
 * Behavior:
 *   1. Select installments where `amountPaid > 0` (or `amountPending > 0`
 *      when `originalWasPending = true`).
 *   2. Sort by `dueDate` DESCENDING (newest satisfied tranche first).
 *   3. Subtract `reversalAmount` sequentially from each installment's
 *      `amountPaid` (or `amountPending`), clamped at 0.
 *   4. Re-evaluate each affected installment's status via
 *      `reevaluateInstallmentStatus`.
 *   5. Return the per-installment un-allocation breakdown.
 *
 * This function is PURE — it does not mutate the input installments.
 *
 * @param installments         All installments for the parent.
 * @param reversalAmount       The amount to reverse (positive number).
 * @param categoryFilter       Optional — restrict reversal to a category.
 * @param originalWasPending   When `true`, subtract from `amountPending`
 *                             instead of `amountPaid` (the original payment
 *                             was an uncleared check/transfer that was
 *                             canceled before clearing).
 */
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
    .filter((i) =>
      originalWasPending
        ? (i.amountPending ?? 0) > 0
        : i.amountPaid > 0,
    )
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .slice()
    .sort((a, b) => {
      // LIFO: newest satisfied tranche first.
      const da = new Date(a.dueDate).getTime();
      const db = new Date(b.dueDate).getTime();
      if (da !== db) return db - da;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; // reverse id tiebreak
    });

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
      installmentId: ins.id,
      revertedAmount: revert,
      newAmountPaid,
      newAmountPending,
      newStatus,
      reopened,
    });
    remaining -= revert;
  }

  const totalReverted = reversalAmount - remaining;
  return {
    reverts,
    totalReverted,
    unrevertedAmount: clampNonNegative(remaining),
    reversalAmount,
  };
}

/**
 * Compute the "current tranche" label for display in the Debt Meter.
 *
 * Returns the label of the oldest unpaid/partial installment, or null
 * if all installments are paid.
 */
export function currentTrancheLabel(
  installments: readonly Installment[],
  categoryFilter?: Installment["category"],
): string | null {
  const matching = installments
    .filter((i) => i.status !== "paid")
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .slice()
    .sort((a, b) => {
      const da = new Date(a.dueDate).getTime();
      const db = new Date(b.dueDate).getTime();
      return da - db;
    });
  return matching.length > 0 ? matching[0].label : null;
}

/**
 * Detect whether a payment would result in overpayment.
 * Returns true if `paymentAmount` exceeds the sum of all remaining
 * balances for the eligible installments.
 */
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
