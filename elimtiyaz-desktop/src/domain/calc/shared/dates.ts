/**
 * Date math helpers — single source of truth for date arithmetic used by
 * the calculation engine.
 *
 * All functions are pure and timezone-agnostic (work in UTC milliseconds
 * via `Date.getTime()`). They NEVER mutate their inputs.
 *
 * Constants preserved verbatim from pre-refactor inline expressions:
 *   - `86_400_000` ms = 1 day (used by overdue calculations)
 *   - Month labels are FR abbreviations (Jan…Déc)
 */

/** Milliseconds in one 24-hour day. Preserved from inline `86_400_000`. */
export const MS_PER_DAY = 86_400_000;

/** French month labels (1-indexed conceptually, 0-indexed by JS Date). */
export const MONTH_LABELS_FR = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
  "Juil", "Août", "Sep", "Oct", "Nov", "Déc",
] as const;

/**
 * Parse an ISO date string to milliseconds-since-epoch.
 *
 * Wraps `new Date(iso).getTime()` so callers don't have to repeat the
 * constructor. Returns `NaN` for invalid input (preserves `Date` behavior).
 */
export function toEpochMs(iso: string | Date): number {
  return iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
}

/**
 * Whole-day difference between two dates, floored (preserves original
 * `Math.floor((now - past) / MS_PER_DAY)` behavior).
 *
 * Returns 0 when `later` is before `earlier` (no negative days).
 *
 * Used by:
 *   - `maxDaysOverdue` (payment.ts)
 *   - `maxDaysOverdueFromLedger` (ledger.ts)
 */
export function daysBetweenFloor(earlier: string | Date, later: string | Date): number {
  const earlierMs = toEpochMs(earlier);
  const laterMs = toEpochMs(later);
  if (!Number.isFinite(earlierMs) || !Number.isFinite(laterMs)) return 0;
  if (laterMs <= earlierMs) return 0;
  return Math.floor((laterMs - earlierMs) / MS_PER_DAY);
}

/**
 * True if `iso` is strictly before `now`.
 *
 * Replaces the inline `new Date(x).getTime() < nowMs` pattern. Note this
 * is STRICT less-than — equal timestamps are NOT considered past.
 */
export function isStrictlyPast(iso: string | Date, now: Date): boolean {
  return toEpochMs(iso) < now.getTime();
}

/**
 * True if `iso` is at or before `now`.
 *
 * Replaces the inline `new Date(x).getTime() <= now.getTime()` pattern
 * from `computeAccountBalance`.
 */
export function isAtOrBefore(iso: string | Date, now: Date): boolean {
  return toEpochMs(iso) <= now.getTime();
}

/**
 * Compute the start-of-month (UTC) for a given date.
 *
 * Used by `revenueByMonth` and `monthlyRevenue` to define month boundaries.
 * Preserved from `new Date(year, month, 1)` — note this uses LOCAL time
 * in the original; we keep that behavior to avoid shifting revenue buckets.
 */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Compute the exclusive end-of-month for a given date (i.e. start of next month).
 *
 * Used by `monthlyRevenue` as the upper bound for the "current month"
 * filter: `t >= monthStart && t < monthEnd`.
 */
export function endOfMonthExclusive(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

/**
 * Build 12 month-buckets ending at the month containing `now`, oldest first.
 *
 * Each bucket: `{ label, year, month, amount: 0 }` where `label` is the FR
 * abbreviation, `year`/`month` are the JS Date numeric fields, and `amount`
 * starts at 0 for the caller to accumulate into.
 *
 * Used by `revenueByMonth` — extracted verbatim from the original loop.
 */
export function buildMonthlyBuckets(
  now: Date,
  count = 12,
): ReadonlyArray<{ label: string; year: number; month: number; amount: number }> {
  const buckets: Array<{ label: string; year: number; month: number; amount: number }> = [];
  const cursor = startOfMonth(now);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    buckets.push({
      label: MONTH_LABELS_FR[d.getMonth()],
      year: d.getFullYear(),
      month: d.getMonth(),
      amount: 0,
    });
  }
  return buckets;
}
