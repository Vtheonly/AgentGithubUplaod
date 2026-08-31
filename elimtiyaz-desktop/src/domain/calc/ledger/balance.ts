/**
 * Ledger balance computation — the ONLY way to compute an account balance.
 *
 * PRINCIPLE (preserved verbatim from pre-refactor `ledger.ts`):
 *   - Balances are NEVER stored as a number — they are ALWAYS computed by
 *     replaying the ledger entries.
 *   - Every UI surface that displays a balance MUST call `computeAccountBalance`
 *     (or `computeParentSummary` for parent-level aggregates).
 *   - Hardcoding the same formula in 2+ places is forbidden.
 *
 * Entry direction (unchanged):
 *   - Positive amount = debit (parent owes more)
 *   - Negative amount = credit (payment received / adjustment applied)
 *
 * Reversal handling (unchanged):
 *   - Reversed entries are excluded from typed totals (totalCharged, totalPaid,
 *     etc.) but the reversal's signed amount still contributes to `balance`.
 *   - The `reversedIds` set is computed once before the main loop.
 *
 * Convenience aliases (`replayParentLedger`, `balanceForAccount`,
 * `totalOutstandingAcrossAccounts`) were moved here from the deleted
 * `ledger-balance.ts` shim so all balance logic lives in one place.
 */
import type { LedgerEntry } from "@/domain/model/ledger";
import type {
  AccountBalance,
  ParentLedgerSummary,
} from "@/domain/model/ledger";
import { absAmount } from "../shared/money";
import { isAtOrBefore, toEpochMs } from "../shared/dates";

/**
 * Compute the balance for a single account by replaying its ledger entries.
 *
 * @param entries   ALL ledger entries for the account (any order — sorted internally).
 * @param accountId The account to compute the balance for.
 * @param now       Optional `Date` for "as-of" queries (excludes entries after `now`).
 */
export function computeAccountBalance(
  entries: readonly LedgerEntry[],
  accountId: string,
  now: Date = new Date(),
): AccountBalance {
  const relevant = entries
    .filter((e) => e.accountId === accountId)
    .filter((e) => isAtOrBefore(e.at, now))
    .sort((a, b) => {
      // Sort by timestamp, then by id for stability — preserved from original.
      const t = toEpochMs(a.at) - toEpochMs(b.at);
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });

  let balance = 0;
  let totalCharged = 0;
  let totalPaid = 0;
  let totalAdjusted = 0;
  let totalRefunded = 0;
  let totalCleared = 0;
  let totalPending = 0;
  let unallocatedCredit = 0;
  let lastActivityAt: string | null = null;

  // Detect reversal chains: an entry with `reversesId` cancels out the
  // reversed entry's contribution to the typed totals (but NOT to the
  // balance — the reversal's signed amount already does that).
  const reversedIds = new Set(
    relevant.filter((e) => e.reversesId).map((e) => e.reversesId!),
  );

  for (const e of relevant) {
    balance += e.amount;
    if (reversedIds.has(e.id)) continue; // skip typed-total for reversed entries

    switch (e.type) {
      case "charge":
        totalCharged += e.amount;
        break;
      case "payment":
        // Payments are negative; totalPaid/totalCleared/totalPending are positive.
        totalPaid += absAmount(e.amount);
        if (e.paymentStatus === "paid") totalCleared += absAmount(e.amount);
        else if (e.paymentStatus === "pending") totalPending += absAmount(e.amount);
        break;
      case "adjustment":
        // Adjustments can be + or -.
        totalAdjusted += e.amount;
        // Track parent_credit adjustments separately so callers can
        // auto-apply them to future charges.
        if (e.category === "parent_credit") {
          unallocatedCredit += e.amount;
        }
        break;
      case "refund":
        // Refunds are negative.
        totalRefunded += absAmount(e.amount);
        break;
      case "reversal":
        // Reversals are already accounted for via the reversed entry's exclusion.
        break;
      case "transfer":
        // Transfers are intra-account moves; net zero on balance, no typed total.
        break;
    }
    if (lastActivityAt === null || e.at > lastActivityAt) lastActivityAt = e.at;
  }

  // Derive parent/student/category from the first entry (or default).
  const first = relevant[0];
  return {
    accountId,
    parentId: first?.parentId ?? "",
    studentId: first?.studentId ?? null,
    category: first?.category ?? "other",
    balance,
    totalCharged,
    totalPaid,
    totalCleared,
    totalPending,
    totalAdjusted,
    totalRefunded,
    unallocatedCredit,
    entryCount: relevant.length,
    lastActivityAt,
  };
}

/**
 * Compute the aggregate balance for a parent across all their accounts.
 *
 * Pulls every entry for the parent, groups by accountId, computes per-account
 * balances, then aggregates.
 *
 * @param entries                      All ledger entries (will be filtered to this parent).
 * @param parentId                     The parent to summarize.
 * @param parentName                   Display name for the parent.
 * @param overdueCategoryDueDates      Optional map of accountId → due Date. Used to
 *                                     classify accounts as overdue when balance > 0
 *                                     AND dueDate < now.
 * @param now                          Optional `Date` for "as-of" queries.
 */
export function computeParentSummary(
  entries: readonly LedgerEntry[],
  parentId: string,
  parentName: string,
  overdueCategoryDueDates: ReadonlyMap<string, Date> = new Map(),
  now: Date = new Date(),
): ParentLedgerSummary {
  const parentEntries = entries.filter((e) => e.parentId === parentId);
  const accountIds = new Set(parentEntries.map((e) => e.accountId));
  const accounts: AccountBalance[] = [];
  for (const accId of accountIds) {
    accounts.push(computeAccountBalance(parentEntries, accId, now));
  }

  // Aggregate.
  let totalOutstanding = 0;
  let totalOverdue = 0;
  let totalCharged = 0;
  let totalPaid = 0;
  let totalCleared = 0;
  let totalPending = 0;
  let totalAdjusted = 0;
  let totalRefunded = 0;
  let totalUnallocatedCredit = 0;
  let entryCount = 0;
  let lastActivityAt: string | null = null;

  for (const acc of accounts) {
    totalOutstanding += acc.balance;
    totalCharged += acc.totalCharged;
    totalPaid += acc.totalPaid;
    totalCleared += acc.totalCleared;
    totalPending += acc.totalPending;
    totalAdjusted += acc.totalAdjusted;
    totalRefunded += acc.totalRefunded;
    totalUnallocatedCredit += acc.unallocatedCredit;
    entryCount += acc.entryCount;
    if (lastActivityAt === null || (acc.lastActivityAt && acc.lastActivityAt > lastActivityAt)) {
      lastActivityAt = acc.lastActivityAt;
    }

    // Overdue: balance > 0 AND the latest charge on this account is past due.
    const dueDate = overdueCategoryDueDates.get(acc.accountId);
    if (acc.balance > 0.001 && dueDate && dueDate.getTime() < now.getTime()) {
      totalOverdue += acc.balance;
    }
  }

  return {
    parentId,
    parentName,
    totalOutstanding,
    totalOverdue,
    totalCharged,
    totalPaid,
    totalCleared,
    totalPending,
    totalAdjusted,
    totalRefunded,
    totalUnallocatedCredit,
    accounts,
    entryCount,
    lastActivityAt,
  };
}

/**
 * DISPLAY-level credit derivation for a parent (ADR-010 / T-104, DATA-009).
 *
 * The canonical writer `collect_and_allocate_payment` books the FULL payment
 * entry (−amount) AND a `parent_credit` adjustment (−unallocated) on
 * overpayment, so the raw ledger balance double-counts the credit for
 * canonical-path overpayments (DATA-009): charge 100k + payment −150k +
 * credit −50k → totalOutstanding −100k while the TRUE credit is 50k
 * (= |totalUnallocatedCredit|). Conversely, the 0062 reconciliation
 * deliberately did NOT materialize `parent_credit` entries for historical
 * overpayers ("balance = −excess is exact there"), so for them the raw
 * negative balance IS the credit.
 *
 * Convention (ADR-010): when the parent's net position is a credit
 * (balance < 0), BOOKED unallocated credit wins when present; otherwise the
 * raw negative balance is the credit:
 *
 *   credit = balance < 0 ? (unallocatedCredit < 0 ? -unallocatedCredit
 *                                                 : -balance)
 *                        : 0
 *
 * Both inputs are the canonical aggregates (`totalOutstanding` INV-1 raw
 * replay; `totalUnallocatedCredit` Σ `adjustment`/`parent_credit` entries) —
 * this helper NEVER mutates them and is display-only. It must stay in sync
 * with the website port (`src/lib/canonical/portal-derive.ts`) — pinned by
 * the desktop unit suite and the website t-104 tests respectively.
 */
export function displayParentCredit(
  totalOutstanding: number,
  totalUnallocatedCredit: number,
): number {
  if (totalOutstanding >= 0) return 0;
  return totalUnallocatedCredit < 0 ? -totalUnallocatedCredit : -totalOutstanding;
}

// ─── Convenience aliases (moved from the deleted `ledger-balance.ts` shim) ────

/**
 * Convenience wrapper around `computeParentSummary` that mirrors the legacy
 * signature. Reads ALL entries (caller filters by tenant) and replays them
 * for a single parent.
 */
export function replayParentLedger(
  allEntries: readonly LedgerEntry[],
  parentId: string,
  parentName: string,
  overdueCategoryDueDates: ReadonlyMap<string, Date> = new Map(),
  now: Date = new Date(),
): ParentLedgerSummary {
  return computeParentSummary(allEntries, parentId, parentName, overdueCategoryDueDates, now);
}

/**
 * Convenience wrapper around `computeAccountBalance` that mirrors the legacy
 * signature.
 */
export function balanceForAccount(
  allEntries: readonly LedgerEntry[],
  accountId: string,
  now: Date = new Date(),
): AccountBalance {
  return computeAccountBalance(allEntries, accountId, now);
}

/**
 * Sum of `balance` across every distinct `accountId` present in `allEntries`.
 * Useful for tenant-wide exposure dashboards. Each account is replayed
 * independently.
 */
export function totalOutstandingAcrossAccounts(
  allEntries: readonly LedgerEntry[],
  now: Date = new Date(),
): number {
  const accountIds = new Set(allEntries.map((e) => e.accountId));
  let total = 0;
  for (const accId of accountIds) {
    total += computeAccountBalance(allEntries, accId, now).balance;
  }
  return total;
}
