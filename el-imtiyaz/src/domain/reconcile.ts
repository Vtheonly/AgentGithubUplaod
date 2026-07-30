/**
 * Reconciliation & validation engine — iteration 5.
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
 */
import type { LedgerEntry, LedgerEntryType } from "./model/ledger";
import { deriveAccountId } from "./model/ledger";

export type ReconciliationSeverity = "error" | "warning" | "info";

export interface ReconciliationViolation {
  readonly severity: ReconciliationSeverity;
  readonly code: string;
  readonly message: string;
  readonly entryId?: string;
  readonly accountId?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ReconciliationReport {
  readonly checkedAt: string;
  readonly entryCount: number;
  readonly accountCount: number;
  readonly violations: readonly ReconciliationViolation[];
  readonly passed: boolean;
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
  };
}

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

/* ================================================================== */
/*  Individual checks                                                  */
/* ================================================================== */

/** Every entry must have a unique ID. */
export function checkDuplicateIds(entries: readonly LedgerEntry[]): ReconciliationViolation[] {
  const seen = new Map<string, number>();
  for (const e of entries) {
    seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
  }
  const out: ReconciliationViolation[] = [];
  for (const [id, count] of seen) {
    if (count > 1) {
      out.push({
        severity: "error",
        code: "DUPLICATE_ENTRY_ID",
        message: `Entry ID "${id}" appears ${count} times. Entry IDs must be unique.`,
        entryId: id,
      });
    }
  }
  return out;
}

/** Required fields: id, tenantId, accountId, parentId, amount, type, sourceType, sourceId, description, actorId, actorName, at. */
export function checkRequiredFields(entries: readonly LedgerEntry[]): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  for (const e of entries) {
    if (!e.id) out.push({ severity: "error", code: "MISSING_ID", message: "Entry has no ID.", entryId: e.id });
    if (!e.tenantId) out.push({ severity: "error", code: "MISSING_TENANT_ID", message: `Entry ${e.id} has no tenantId.`, entryId: e.id });
    if (!e.accountId) out.push({ severity: "error", code: "MISSING_ACCOUNT_ID", message: `Entry ${e.id} has no accountId.`, entryId: e.id });
    if (!e.parentId) out.push({ severity: "error", code: "MISSING_PARENT_ID", message: `Entry ${e.id} has no parentId.`, entryId: e.id });
    if (typeof e.amount !== "number" || Number.isNaN(e.amount)) out.push({ severity: "error", code: "INVALID_AMOUNT", message: `Entry ${e.id} has invalid amount.`, entryId: e.id });
    if (!e.type) out.push({ severity: "error", code: "MISSING_TYPE", message: `Entry ${e.id} has no type.`, entryId: e.id });
    if (!e.sourceType) out.push({ severity: "error", code: "MISSING_SOURCE_TYPE", message: `Entry ${e.id} has no sourceType.`, entryId: e.id });
    if (!e.sourceId) out.push({ severity: "error", code: "MISSING_SOURCE_ID", message: `Entry ${e.id} has no sourceId.`, entryId: e.id });
    if (!e.description || !e.description.trim()) out.push({ severity: "error", code: "MISSING_DESCRIPTION", message: `Entry ${e.id} has no description.`, entryId: e.id });
    if (!e.actorId) out.push({ severity: "warning", code: "MISSING_ACTOR_ID", message: `Entry ${e.id} has no actorId (anonymous operations are forbidden).`, entryId: e.id });
    if (!e.actorName) out.push({ severity: "warning", code: "MISSING_ACTOR_NAME", message: `Entry ${e.id} has no actorName.`, entryId: e.id });
    if (!e.at) out.push({ severity: "error", code: "MISSING_TIMESTAMP", message: `Entry ${e.id} has no timestamp.`, entryId: e.id });
  }
  return out;
}

/**
 * Signed-amount convention:
 *   - `charge`     → positive
 *   - `payment`    → negative
 *   - `adjustment` → either (signed)
 *   - `refund`     → negative
 *   - `reversal`   → opposite of original
 *   - `transfer`   → either
 */
export function checkSignedAmountConvention(entries: readonly LedgerEntry[]): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  for (const e of entries) {
    switch (e.type as LedgerEntryType) {
      case "charge":
        if (e.amount <= 0) {
          out.push({
            severity: "error",
            code: "CHARGE_NOT_POSITIVE",
            message: `Charge entry ${e.id} has amount ${e.amount}. Charges must be positive.`,
            entryId: e.id,
            details: { amount: e.amount },
          });
        }
        break;
      case "payment":
        if (e.amount >= 0) {
          out.push({
            severity: "error",
            code: "PAYMENT_NOT_NEGATIVE",
            message: `Payment entry ${e.id} has amount ${e.amount}. Payments must be negative (credits).`,
            entryId: e.id,
            details: { amount: e.amount },
          });
        }
        break;
      case "refund":
        if (e.amount >= 0) {
          out.push({
            severity: "error",
            code: "REFUND_NOT_NEGATIVE",
            message: `Refund entry ${e.id} has amount ${e.amount}. Refunds must be negative.`,
            entryId: e.id,
            details: { amount: e.amount },
          });
        }
        break;
      case "adjustment":
        if (e.amount === 0) {
          out.push({
            severity: "error",
            code: "ADJUSTMENT_ZERO",
            message: `Adjustment entry ${e.id} has amount 0. Adjustments must be non-zero.`,
            entryId: e.id,
          });
        }
        break;
      case "reversal":
      case "transfer":
        // Both can be either sign; no check.
        break;
    }
  }
  return out;
}

/** entry.accountId must equal deriveAccountId(parentId, category, studentId). */
export function checkAccountIdsMatch(entries: readonly LedgerEntry[]): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  for (const e of entries) {
    const expected = deriveAccountId(e.parentId, e.category, e.studentId);
    if (e.accountId !== expected) {
      out.push({
        severity: "error",
        code: "ACCOUNT_ID_MISMATCH",
        message: `Entry ${e.id} accountId "${e.accountId}" does not match derived "${expected}".`,
        entryId: e.id,
        accountId: e.accountId,
        details: { expected, actual: e.accountId },
      });
    }
  }
  return out;
}

/**
 * Reversal integrity:
 *   - Every reversal's `reversesId` must reference an existing entry.
 *   - An entry can be reversed at most once.
 *   - The reversal's amount must equal `-original.amount`.
 *   - The reversal's accountId must match the original's accountId.
 */
export function checkReversalIntegrity(entries: readonly LedgerEntry[]): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const reversalCountByOriginal = new Map<string, number>();

  for (const e of entries) {
    if (!e.reversesId) continue;
    const original = byId.get(e.reversesId);
    if (!original) {
      out.push({
        severity: "error",
        code: "ORPHAN_REVERSAL",
        message: `Reversal entry ${e.id} references non-existent original ${e.reversesId}.`,
        entryId: e.id,
        details: { reversesId: e.reversesId },
      });
      continue;
    }
    reversalCountByOriginal.set(e.reversesId, (reversalCountByOriginal.get(e.reversesId) ?? 0) + 1);
    if (e.amount !== -original.amount) {
      out.push({
        severity: "error",
        code: "REVERSAL_AMOUNT_MISMATCH",
        message: `Reversal ${e.id} amount ${e.amount} does not negate original ${original.id} amount ${original.amount}.`,
        entryId: e.id,
        details: { reversalAmount: e.amount, originalAmount: original.amount },
      });
    }
    if (e.accountId !== original.accountId) {
      out.push({
        severity: "error",
        code: "REVERSAL_ACCOUNT_MISMATCH",
        message: `Reversal ${e.id} accountId does not match original ${original.id} accountId.`,
        entryId: e.id,
      });
    }
  }

  for (const [originalId, count] of reversalCountByOriginal) {
    if (count > 1) {
      out.push({
        severity: "error",
        code: "DOUBLE_REVERSAL",
        message: `Entry ${originalId} is reversed ${count} times. An entry can be reversed at most once.`,
        entryId: originalId,
        details: { reversalCount: count },
      });
    }
  }
  return out;
}

/** Receipt numbers must be unique within a tenant. */
export function checkDuplicateReceiptNumbers(entries: readonly LedgerEntry[]): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  const seen = new Map<string, string[]>(); // receiptNumber → [entryId, ...]
  for (const e of entries) {
    if (!e.receiptNumber) continue;
    const list = seen.get(e.receiptNumber) ?? [];
    list.push(e.id);
    seen.set(e.receiptNumber, list);
  }
  for (const [receiptNumber, ids] of seen) {
    if (ids.length > 1) {
      out.push({
        severity: "error",
        code: "DUPLICATE_RECEIPT_NUMBER",
        message: `Receipt number "${receiptNumber}" is used by ${ids.length} entries: ${ids.join(", ")}.`,
        details: { receiptNumber, entryIds: ids.join(", ") },
      });
    }
  }
  return out;
}

/** All entries must share the same tenantId (within a single ledger). */
export function checkTenantConsistency(entries: readonly LedgerEntry[]): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  if (entries.length === 0) return out;
  const first = entries[0].tenantId;
  for (const e of entries) {
    if (e.tenantId !== first) {
      out.push({
        severity: "error",
        code: "TENANT_MISMATCH",
        message: `Entry ${e.id} tenantId "${e.tenantId}" does not match ledger tenant "${first}".`,
        entryId: e.id,
      });
    }
  }
  return out;
}

/* ================================================================== */
/*  Cross-checks against other entities                                */
/* ================================================================== */

/**
 * Verify that every payment in `payments` has a corresponding ledger entry
 * and that the amounts match.
 *
 * Used by the repository layer after every mutation to ensure the Payment
 * table and the Ledger stay in sync.
 */
export function crossCheckPayments(
  payments: ReadonlyArray<{ id: string; amount: number; status: string; receiptNumber: string }>,
  ledgerEntries: readonly LedgerEntry[],
): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  const ledgerBySourceId = new Map<string, LedgerEntry>();
  for (const e of ledgerEntries) {
    if (e.type === "payment" && e.sourceType === "payment") {
      ledgerBySourceId.set(e.sourceId, e);
    }
  }
  for (const p of payments) {
    const entry = ledgerBySourceId.get(p.id);
    if (!entry) {
      out.push({
        severity: "warning",
        code: "PAYMENT_WITHOUT_LEDGER_ENTRY",
        message: `Payment ${p.id} (${p.receiptNumber}) has no corresponding ledger entry.`,
        details: { paymentId: p.id, receiptNumber: p.receiptNumber },
      });
      continue;
    }
    if (Math.abs(entry.amount) !== p.amount) {
      out.push({
        severity: "error",
        code: "PAYMENT_AMOUNT_MISMATCH",
        message: `Payment ${p.id} amount ${p.amount} does not match ledger entry amount ${Math.abs(entry.amount)}.`,
        entryId: entry.id,
        details: { paymentAmount: p.amount, ledgerAmount: Math.abs(entry.amount) },
      });
    }
    if (entry.paymentStatus !== p.status) {
      out.push({
        severity: "warning",
        code: "PAYMENT_STATUS_MISMATCH",
        message: `Payment ${p.id} status "${p.status}" does not match ledger entry status "${entry.paymentStatus}".`,
        entryId: entry.id,
      });
    }
  }
  return out;
}

/**
 * Verify that every installment in `installments` has a corresponding
 * ledger charge entry and that the amounts match.
 */
export function crossCheckInstallments(
  installments: ReadonlyArray<{
    id: string;
    parentId: string;
    studentId: string | null;
    category: string;
    amountDue: number;
    label: string;
  }>,
  ledgerEntries: readonly LedgerEntry[],
): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  const ledgerBySourceId = new Map<string, LedgerEntry>();
  for (const e of ledgerEntries) {
    if (e.type === "charge" && e.sourceType === "installment") {
      ledgerBySourceId.set(e.sourceId, e);
    }
  }
  for (const inst of installments) {
    const entry = ledgerBySourceId.get(inst.id);
    if (!entry) {
      out.push({
        severity: "warning",
        code: "INSTALLMENT_WITHOUT_LEDGER_ENTRY",
        message: `Installment ${inst.id} (${inst.label}) has no corresponding ledger charge entry.`,
        details: { installmentId: inst.id, label: inst.label },
      });
      continue;
    }
    if (entry.amount !== inst.amountDue) {
      out.push({
        severity: "error",
        code: "INSTALLMENT_AMOUNT_MISMATCH",
        message: `Installment ${inst.id} amountDue ${inst.amountDue} does not match ledger entry amount ${entry.amount}.`,
        entryId: entry.id,
        details: { installmentAmount: inst.amountDue, ledgerAmount: entry.amount },
      });
    }
  }
  return out;
}

/**
 * Verify that the sum of all account balances equals the sum of all
 * entry amounts. (By definition this should always hold — but it's a
 * sanity check against bugs in the balance computation.)
 */
export function crossCheckBalanceSum(
  entries: readonly LedgerEntry[],
  accountBalances: ReadonlyArray<{ balance: number }>,
): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  const entriesSum = entries.reduce((s, e) => s + e.amount, 0);
  const balancesSum = accountBalances.reduce((s, b) => s + b.balance, 0);
  // Allow for floating-point drift.
  if (Math.abs(entriesSum - balancesSum) > 0.01) {
    out.push({
      severity: "error",
      code: "BALANCE_SUM_MISMATCH",
      message: `Sum of all entries (${entriesSum}) does not equal sum of all account balances (${balancesSum}).`,
      details: { entriesSum, balancesSum, diff: entriesSum - balancesSum },
    });
  }
  return out;
}
