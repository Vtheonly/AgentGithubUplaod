/**
 * Installment helpers — outstanding, overdue, aging.
 * Allocation logic moved to waterfall-allocator.ts + lifo-reversal.ts.
 */
import type { Installment, AgingBucket } from "@/domain/model/payment";
import { clampNonNegative, sumOf } from "../shared/money";
import { daysBetweenFloor, isStrictlyPast } from "../shared/dates";
import { sumInstallmentsDue, sumInstallmentsPaid } from "./sums";

export type { InstallmentAllocation, AllocationResult } from "./waterfall-allocator";
export type { RevertAllocation, RevertAllocationResult } from "./lifo-reversal";
export { allocatePaymentToInstallments, isOverpayment } from "./waterfall-allocator";
export { revertPaymentAllocation, reevaluateInstallmentStatus } from "./lifo-reversal";

export function installmentRemaining(installment: Installment): number {
  return clampNonNegative(installment.amountDue - installment.amountPaid);
}

export function totalOutstanding(installments: readonly Installment[]): number {
  return clampNonNegative(sumInstallmentsDue(installments) - sumInstallmentsPaid(installments));
}

export function overdueAmount(installments: readonly Installment[], now: Date = new Date()): number {
  const overdue = installments.filter((i) => i.status !== "paid" && isStrictlyPast(i.dueDate, now));
  return sumOf(overdue, (i) => installmentRemaining(i));
}

export function maxDaysOverdue(installments: readonly Installment[], now: Date = new Date()): number {
  const days = installments
    .filter((i) => i.status !== "paid" && isStrictlyPast(i.dueDate, now))
    .map((i) => daysBetweenFloor(i.dueDate, now));
  return days.length === 0 ? 0 : Math.max(...days);
}

export function agingBucketFromDays(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 30) return "0_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  if (daysOverdue <= 180) return "91_180";
  return "180_plus";
}

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
