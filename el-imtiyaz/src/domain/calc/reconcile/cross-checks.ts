/**
 * Cross-entity reconciliation checks — verify the ledger against other
 * data sources (payments table, installments table, account balances).
 *
 * Extracted from `domain/reconcile.ts`:
 *   - `crossCheckPayments`        — every payment has a matching ledger entry
 *   - `crossCheckInstallments`    — every installment has a matching charge entry
 *   - `crossCheckBalanceSum`      — sum of entries = sum of account balances
 *
 * Behavior preserved verbatim — same severity assignments, same tolerance
 * (0.01 DZD) for the balance-sum check.
 */
import type { LedgerEntry } from "@/domain/model/ledger";
import type { ReconciliationViolation } from "@/domain/reconcile-types";
import { absAmount, amountsApproximatelyEqual } from "../shared/money";

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
    if (absAmount(entry.amount) !== p.amount) {
      out.push({
        severity: "error",
        code: "PAYMENT_AMOUNT_MISMATCH",
        message: `Payment ${p.id} amount ${p.amount} does not match ledger entry amount ${absAmount(entry.amount)}.`,
        entryId: entry.id,
        details: { paymentAmount: p.amount, ledgerAmount: absAmount(entry.amount) },
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
 *
 * Tolerance: 0.01 DZD (preserved from original `Math.abs(diff) > 0.01`).
 */
export function crossCheckBalanceSum(
  entries: readonly LedgerEntry[],
  accountBalances: ReadonlyArray<{ balance: number }>,
): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  const entriesSum = entries.reduce((s, e) => s + e.amount, 0);
  const balancesSum = accountBalances.reduce((s, b) => s + b.balance, 0);
  // Allow for floating-point drift.
  if (!amountsApproximatelyEqual(entriesSum, balancesSum)) {
    out.push({
      severity: "error",
      code: "BALANCE_SUM_MISMATCH",
      message: `Sum of all entries (${entriesSum}) does not equal sum of all account balances (${balancesSum}).`,
      details: { entriesSum, balancesSum, diff: entriesSum - balancesSum },
    });
  }
  return out;
}
