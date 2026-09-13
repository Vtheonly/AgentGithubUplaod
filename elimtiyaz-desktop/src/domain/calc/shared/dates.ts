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

/**
 * T-356 (DASH-407): month buckets anchored to a REQUESTED window — the
 * convention `MockDashboardRepository.revenueForRange` always used (the
 * reference implementation). A cursor walks from the window's first month
 * to its last (inclusive); every payment lands in the bucket of its own
 * calendar month and NOTHING in-window is dropped. Guards: a window whose
 * end precedes its start yields []; a runaway window (custom range > 24
 * months) is capped at 24 buckets so a bad input can't generate an
 * unbounded series.
 */
export function buildWindowAnchoredBuckets(
  window: { from: string; to: string } | null | undefined,
  payments: ReadonlyArray<{ amount: number | string; collectedAt: string }> = [],
): Array<{ label: string; year: number; month: number; amount: number }> {
  if (!window) return [];
  const fromMs = Date.parse(`${window.from.slice(0, 10)}T00:00:00Z`);
  // EXCLUSIVE end at the to-date's midnight — the mock's cursor semantics
  // (`while (cursor < toMs)`): "to: 2026-09-01" yields Sep 2025..Août 2026
  // (12 buckets, the academic year), while "to: 2026-03-31" still includes
  // March (Mar 1 < Mar 31 midnight). Payments on the window's last day
  // still land — bucketing is by calendar month, not by timestamp bound.
  const toMs = Date.parse(`${window.to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) return [];

  const buckets: Array<{ label: string; year: number; month: number; amount: number }> = [];
  const cursor = new Date(fromMs);
  cursor.setUTCDate(1);
  while (cursor.getTime() < toMs && buckets.length < 24) {
    buckets.push({
      label: MONTH_LABELS_FR[cursor.getUTCMonth()],
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth(),
      amount: 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  for (const p of payments) {
    const t = Date.parse(p.collectedAt);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    const bucket = buckets.find((b) => b.year === d.getUTCFullYear() && b.month === d.getUTCMonth());
    if (bucket) bucket.amount += Number(p.amount) || 0;
  }
  return buckets;
}
