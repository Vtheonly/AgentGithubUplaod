/**
 * Individual ledger reconciliation checks — pure functions, each enforcing
 * one specific invariant.
 *
 * Extracted from `domain/reconcile.ts`. Each function takes the full ledger
 * entry list and returns only the violations it found — the orchestrator
 * (`reconcileLedger`) concatenates them.
 *
 * Severity conventions (preserved from original):
 *   - `error`   — must be fixed; ledger is inconsistent
 *   - `warning` — should be investigated (e.g. missing actor name)
 *   - `info`    — informational, no action needed
 */
import type { LedgerEntry, LedgerEntryType } from "@/domain/model/ledger";
import { deriveAccountId } from "../ledger/account-id";
import type { ReconciliationViolation } from "@/domain/reconcile-types";

/**
 * Re-export the shared types so callers can import everything from one place.
 * The types themselves live in `domain/reconcile-types.ts` to avoid a circular
 * dependency between this calc module and the orchestrator.
 */
export type { ReconciliationViolation, ReconciliationSeverity } from "@/domain/reconcile-types";

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

/**
 * Required fields: id, tenantId, accountId, parentId, amount, type,
 * sourceType, sourceId, description, actorId, actorName, at.
 *
 * Missing `actorId` / `actorName` is a WARNING (anonymous operations are
 * forbidden but the entry is still considered valid for replay). All other
 * missing fields are ERRORS.
 */
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
