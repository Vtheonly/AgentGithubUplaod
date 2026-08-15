/**
 * Installment query helpers — outstanding, overdue, aging, current tranche.
 *
 * These functions are PURE: they take an array of installments and return
 * derived values. They do NOT mutate state.
 *
 * Extracted from the deleted `installments.ts` shim so all installment
 * queries live in one place alongside the allocator + reversal engines.
 */
import type { Installment, AgingBucket } from "@/domain/model/payment";
import { clampNonNegative, sumOf } from "../shared/money";
import { daysBetweenFloor, isStrictlyPast } from "../shared/dates";
import { sumInstallmentsDue, sumInstallmentsPaid } from "./sums";

/** Remaining amount on a single installment (>= 0). */
export function installmentRemaining(installment: Installment): number {
  return clampNonNegative(installment.amountDue - installment.amountPaid);
}

/** Total outstanding across all given installments (>= 0). */
export function totalOutstanding(installments: readonly Installment[]): number {
  return clampNonNegative(sumInstallmentsDue(installments) - sumInstallmentsPaid(installments));
}

/** Sum of remaining amounts on installments whose `dueDate` has passed and are not paid. */
export function overdueAmount(installments: readonly Installment[], now: Date = new Date()): number {
  const overdue = installments.filter((i) => i.status !== "paid" && isStrictlyPast(i.dueDate, now));
  return sumOf(overdue, (i) => installmentRemaining(i));
}

/** Maximum days overdue across all overdue installments (0 when none are overdue). */
export function maxDaysOverdue(installments: readonly Installment[], now: Date = new Date()): number {
  const days = installments
    .filter((i) => i.status !== "paid" && isStrictlyPast(i.dueDate, now))
    .map((i) => daysBetweenFloor(i.dueDate, now));
  return days.length === 0 ? 0 : Math.max(...days);
}

/** Classify a days-overdue count into one of 5 canonical aging buckets. */
export function agingBucketFromDays(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 30) return "0_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  if (daysOverdue <= 180) return "91_180";
  return "180_plus";
}

/**
 * Label of the next unpaid installment (chronologically first by `dueDate`),
 * optionally narrowed by `category`. Returns `null` when there are no
 * outstanding installments matching the filter.
 */
export function currentTrancheLabel(
  installments: readonly Installment[],
  categoryFilter?: Installment["category"],
): string | null {
  const matching = installments
    .filter((i) => i.status !== "paid")
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .slice()
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  return matching.length > 0 ? matching[0].label : null;
}
