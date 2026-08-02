/**
 * Ledger overdue calculations.
 *
 * Extracted from `domain/model/ledger.ts`:
 *   - `maxDaysOverdueFromLedger` — max days overdue across all CHARGE entries.
 *   - `buildOverdueDueDateMap`   — per-account latest charge timestamp.
 *
 * Behavior preserved verbatim — same filters, same floor-division for days,
 * same "0 when empty" sentinel.
 */
import type { LedgerEntry } from "@/domain/model/ledger";
import { daysBetweenFloor, isStrictlyPast } from "../shared/dates";

/**
 * Days overdue for a parent's worst (max) overdue charge entry.
 *
 * A charge is "overdue" when its `at` timestamp is strictly before `now`.
 * The function returns the maximum days-overdue across all charge entries,
 * or 0 if there are no overdue charges.
 *
 * Note: This is the LEDGER-aware version. The installment-aware version
 * (`maxDaysOverdue` in `payment/installments.ts`) operates on `Installment[]`
 * instead of `LedgerEntry[]`. Both are kept because they serve different
 * data sources (the ledger vs. the installments table).
 *
 * @param entries  All ledger entries (will be filtered to charges only).
 * @param now      Reference date — defaults to `new Date()`.
 */
export function maxDaysOverdueFromLedger(
  entries: readonly LedgerEntry[],
  now: Date = new Date(),
): number {
  const nowMs = now.getTime();
  const overdueChargeDays = entries
    .filter((e) => e.type === "charge")
    .filter((e) => isStrictlyPast(e.at, now))
    .map((e) => daysBetweenFloor(e.at, now));

  return overdueChargeDays.length === 0 ? 0 : Math.max(...overdueChargeDays);
}

/**
 * Build the `overdueCategoryDueDates` map for `computeParentSummary`.
 *
 * For each account, finds the latest charge entry's `at` timestamp and
 * uses that as the "due date" for overdue classification.
 *
 * @param entries  All ledger entries (will be filtered to charges only).
 * @returns Map of accountId → Date (the latest charge's `at` timestamp).
 */
export function buildOverdueDueDateMap(
  entries: readonly LedgerEntry[],
): ReadonlyMap<string, Date> {
  const map = new Map<string, Date>();
  for (const e of entries) {
    if (e.type !== "charge") continue;
    const existing = map.get(e.accountId);
    const current = new Date(e.at);
    if (!existing || current.getTime() > existing.getTime()) {
      map.set(e.accountId, current);
    }
  }
  return map;
}
