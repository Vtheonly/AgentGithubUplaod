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
