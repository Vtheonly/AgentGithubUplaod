/**
 * Revenue aggregation helpers — single source of truth for revenue-by-period
 * and revenue-by-category calculations.
 *
 * Extracted from `domain/model/payment.ts`:
 *   - `revenueByMonth`      — 12-month revenue series (oldest first)
 *   - `revenueByCategory`   — current-month revenue grouped by `PaymentCategory`
 *   - `monthlyRevenue`      — total revenue for the current month
 *
 * Behavior preserved verbatim:
 *   - All three functions filter by `status === "paid"`.
 *   - `revenueByMonth` builds 12 month-buckets ending at the month containing
 *     `now`, oldest first. Payments outside the 12-month window are dropped.
 *   - `revenueByCategory` and `monthlyRevenue` filter to the calendar month
 *     containing `now` (start-of-month inclusive, end-of-month exclusive).
 */
import type { Payment, PaymentCategory } from "@/domain/model/payment";
import {
  buildMonthlyBuckets,
  endOfMonthExclusive,
  startOfMonth,
  toEpochMs,
} from "../shared/dates";
import { sumOf } from "../shared/money";

/**
 * Aggregate revenue from a list of payments grouped by month.
 * Returns 12 entries (oldest → newest) keyed by month label.
 *
 * Each entry: `{ label: "Jan", amount: 123456 }`.
 * Months with no paid payments return `amount: 0`.
 */
export function revenueByMonth(
  payments: readonly Payment[],
  now: Date = new Date(),
): ReadonlyArray<{ label: string; amount: number }> {
  const buckets = buildMonthlyBuckets(now);

  // Allocate paid payments to buckets.
  for (const p of payments) {
    if (p.status !== "paid") continue;
    const d = new Date(p.collectedAt);
    const y = d.getFullYear();
    const m = d.getMonth();
    const bucket = buckets.find((b) => b.year === y && b.month === m);
    if (bucket) bucket.amount += p.amount;
  }
  return buckets.map((b) => ({ label: b.label, amount: b.amount }));
}

/**
 * Aggregate paid payments by category for the current month.
 * Used by the Dashboard → See Details → Departments tab.
 */
export function revenueByCategory(
  payments: readonly Payment[],
  now: Date = new Date(),
): ReadonlyArray<{ category: PaymentCategory; amount: number }> {
  const monthStart = startOfMonth(now).getTime();
  const monthEnd = endOfMonthExclusive(now).getTime();
  const totals = new Map<PaymentCategory, number>();
  for (const p of payments) {
    if (p.status !== "paid") continue;
    const t = toEpochMs(p.collectedAt);
    if (t < monthStart || t >= monthEnd) continue;
    totals.set(p.category, (totals.get(p.category) ?? 0) + p.amount);
  }
  return Array.from(totals.entries()).map(([category, amount]) => ({ category, amount }));
}

/**
 * Total revenue (sum of paid payments) collected in the current month.
 */
export function monthlyRevenue(payments: readonly Payment[], now: Date = new Date()): number {
  const monthStart = startOfMonth(now).getTime();
  const monthEnd = endOfMonthExclusive(now).getTime();
  return sumOf(
    payments.filter((p) => p.status === "paid"),
    (p) => {
      const t = toEpochMs(p.collectedAt);
      return t >= monthStart && t < monthEnd ? p.amount : 0;
    },
  );
}
