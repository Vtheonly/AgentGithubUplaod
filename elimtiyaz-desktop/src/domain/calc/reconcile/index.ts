/**
 * Ledger reconciliation orchestrator — runs all checks and aggregates
 * the results into a single `ReconciliationReport`.
 *
 * Extracted from `domain/reconcile.ts` `reconcileLedger`.
 *
 * The orchestrator is the ONLY public entry point for "run all checks";
 * individual checks live in `checks.ts` and cross-entity checks live in
 * `cross-checks.ts`.
 *
 * Order of checks is preserved verbatim from the original implementation
 * (the order does not affect correctness — violations are concatenated —
 * but it does affect the violation ordering in the report, which some
 * downstream consumers may rely on for stable diffs).
 *
 * This module also re-exports the individual checks and cross-checks so
 * callers can import them from a single location:
 *   `import { reconcileLedger, crossCheckPayments, ... } from "@/domain/calc/reconcile"`
 */
import type { LedgerEntry } from "@/domain/model/ledger";
import type { ReconciliationReport, ReconciliationViolation } from "@/domain/reconcile-types";
import {
  checkDuplicateIds,
  checkRequiredFields,
  checkSignedAmountConvention,
  checkAccountIdsMatch,
  checkReversalIntegrity,
  checkDuplicateReceiptNumbers,
  checkTenantConsistency,
} from "./checks";

// Re-export individual checks + cross-checks so callers have a single import.
export {
  checkDuplicateIds,
  checkRequiredFields,
  checkSignedAmountConvention,
  checkAccountIdsMatch,
  checkReversalIntegrity,
  checkDuplicateReceiptNumbers,
  checkTenantConsistency,
} from "./checks";
export {
  crossCheckPayments,
  crossCheckInstallments,
  crossCheckBalanceSum,
  crossCheckInstallmentPayments,
  crossCheckClearedBalance,
  crossCheckParentCredit,
} from "./cross-checks";

/**
 * Run all reconciliation checks against the ledger.
 */
export function reconcileLedger(entries: readonly LedgerEntry[]): ReconciliationReport {
  const violations: ReconciliationViolation[] = [];

  violations.push(...checkDuplicateIds(entries));
  violations.push(...checkRequiredFields(entries));
  violations.push(...checkSignedAmountConvention(entries));
  violations.push(...checkAccountIdsMatch(entries));
  violations.push(...checkReversalIntegrity(entries));
  violations.push(...checkDuplicateReceiptNumbers(entries));
  violations.push(...checkTenantConsistency(entries));

  const errors = violations.filter((v) => v.severity === "error").length;
  const warnings = violations.filter((v) => v.severity === "warning").length;
  const infos = violations.filter((v) => v.severity === "info").length;

  const accountCount = new Set(entries.map((e) => e.accountId)).size;

  return {
    checkedAt: new Date().toISOString(),
    entryCount: entries.length,
    accountCount,
    violations,
    passed: errors === 0,
    summary: { errors, warnings, infos },
  };
}
