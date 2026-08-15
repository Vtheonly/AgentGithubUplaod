/**
 * Ledger Balance Engine — replay helpers + convenience layer.
 * Balances are NEVER stored; ALWAYS computed by replaying the ledger.
 */
import type { LedgerEntry } from "@/domain/model/ledger";
import type { AccountBalance, ParentLedgerSummary } from "@/domain/model/ledger";
import { computeAccountBalance, computeParentSummary } from "./balance";

export { computeAccountBalance, computeParentSummary };

export function replayParentLedger(
  allEntries: readonly LedgerEntry[],
  parentId: string,
  parentName: string,
  overdueCategoryDueDates: ReadonlyMap<string, Date> = new Map(),
  now: Date = new Date(),
): ParentLedgerSummary {
  return computeParentSummary(allEntries, parentId, parentName, overdueCategoryDueDates, now);
}

export function balanceForAccount(
  allEntries: readonly LedgerEntry[],
  accountId: string,
  now: Date = new Date(),
): AccountBalance {
  return computeAccountBalance(allEntries, accountId, now);
}

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
