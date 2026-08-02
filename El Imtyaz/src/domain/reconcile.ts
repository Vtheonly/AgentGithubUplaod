/**
 * Reconciliation & validation engine — iteration 5 (refactored in iteration 1
 * of the platform-wide refactor).
 *
 * Continuously verifies ledger integrity. Detects:
 *   - Orphan reversals (reversal entry references a non-existent original)
 *   - Double reversals (an entry is reversed more than once)
 *   - Balance inconsistencies (sum of entries ≠ displayed balance)
 *   - Negative charges (charges must be positive)
 *   - Positive payments (payments must be negative — credit)
 *   - Mis-typed entries (entry type doesn't match signed-amount convention)
 *   - Duplicate entry IDs
 *   - Duplicate receipt numbers within the same tenant
 *   - Account ID mismatch (entry.accountId doesn't match derived ID)
 *   - Missing required fields (description, actorId, etc.)
 *
 * The engine is PURE — it takes a list of entries and returns a list of
 * violations. It never mutates state. The mock repository runs it on
 * every mutation; production (Supabase) would run it via a scheduled
 * Edge Function.
 *
 * ---------------------------------------------------------------------------
 * REFACTOR NOTE (iteration 1):
 * The implementation now lives in `@/domain/calc/reconcile/`. This file is
 * kept as a thin re-export shim so existing imports (`@/domain/reconcile`)
 * continue to work without modification. Once all call sites have migrated
 * to `@/domain/calc`, this shim can be removed.
 * ---------------------------------------------------------------------------
 */

// Types are sourced from the shared `reconcile-types.ts` file (avoids a
// circular dependency between the calc orchestrator and the check modules).
export type {
  ReconciliationSeverity,
  ReconciliationViolation,
  ReconciliationReport,
} from "./reconcile-types";

// Implementation: re-export everything from the new calc module.
export {
  reconcileLedger,
  checkDuplicateIds,
  checkRequiredFields,
  checkSignedAmountConvention,
  checkAccountIdsMatch,
  checkReversalIntegrity,
  checkDuplicateReceiptNumbers,
  checkTenantConsistency,
  crossCheckPayments,
  crossCheckInstallments,
  crossCheckBalanceSum,
} from "./calc/reconcile";
