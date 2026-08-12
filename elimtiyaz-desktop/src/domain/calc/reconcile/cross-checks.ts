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
 *
 * UNIFIED ARCHITECTURE additions:
 *   - `crossCheckInstallmentPayments` — verifies that every installment's
 *     `amountPaid` equals the sum of cleared payment ledger entries
 *     allocated to it (plus adjustments). Emits `UNBACKED_TRANCHE_SATISFACTION`
 *     when a tranche is marked `"paid"` but has no cleared funds backing it.
 *   - `crossCheckClearedBalance` — verifies that the sum of `payments.amount`
 *     where `status === "paid"` equals the sum of `|ledger_entries.amount|`
 *     where `type === "payment"` and `paymentStatus === "paid"`. Emits
 *     `PAYMENT_LEDGER_MISMATCH` on discrepancy.
 *   - `crossCheckParentCredit` — verifies that every parent account with a
 *     negative balance (school owes parent) strictly corresponds to a
 *     `parent_credit` adjustment entry. Emits `UNBACKED_PARENT_CREDIT` otherwise.
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

/* ============================================================ */
/*  Unified Architecture cross-checks                           */
/* ============================================================ */

/**
 * Verify that every installment's `amountPaid` is fully backed by cleared
 * payment ledger entries allocated to it (plus credit adjustments).
 *
 * Invariant 4 (Cleared Funds Only):
 *   For every installment I:
 *     I.amountPaid
 *       ≡ Σ |ledger payment entries allocated to I with status='paid'|
 *       + Σ |credit adjustments allocated to I|
 *
 * Emits `UNBACKED_TRANCHE_SATISFACTION` (error) when a tranche is marked
 * `"paid"` (or has `amountPaid > 0`) but the ledger has insufficient
 * cleared funds to back it — the canonical signature of the "pending
 * check marked tranche as paid" bug.
 *
 * The mapping between ledger entries and installments uses the entry's
 * `sourceId` field: a payment entry's `sourceId` is the payment id; the
 * payment's `installmentId` field is what links it to a tranche. When
 * the caller cannot provide that mapping, it falls back to per-account
 * aggregation (sum all cleared payment credits on the installment's
 * account). Both modes are supported.
 *
 * @param installments    All installments to verify.
 * @param ledgerEntries   All ledger entries (will be filtered internally).
 * @param paymentToInstallmentId  Optional map: paymentId → installmentId.
 *                                Used for precise per-installment attribution.
 */
export function crossCheckInstallmentPayments(
  installments: ReadonlyArray<{
    id: string;
    parentId: string;
    studentId: string | null;
    category: string;
    amountDue: number;
    amountPaid: number;
    label: string;
    status: string;
  }>,
  ledgerEntries: readonly LedgerEntry[],
  paymentToInstallmentId?: ReadonlyMap<string, string>,
): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];

  // Build a per-installment ledger attribution: for each installment,
  // sum the absolute value of cleared payment entries that map to it,
  // plus the absolute value of credit adjustments on its account.
  const accountKey = (parentId: string, category: string, studentId: string | null) =>
    `${parentId}|${category}|${studentId ?? ""}`;

  // Group cleared payment credits + credit adjustments by account key.
  const clearedByAccount = new Map<string, number>();
  const adjustmentsByAccount = new Map<string, number>();
  for (const e of ledgerEntries) {
    if (e.reversesId) continue; // skip reversals — handled via reversed entry exclusion
    const key = accountKey(e.parentId, e.category, e.studentId);
    if (e.type === "payment" && e.paymentStatus === "paid") {
      clearedByAccount.set(key, (clearedByAccount.get(key) ?? 0) + absAmount(e.amount));
    } else if (e.type === "adjustment" && e.amount < 0) {
      // Negative adjustments are credits that can satisfy tranches.
      adjustmentsByAccount.set(key, (adjustmentsByAccount.get(key) ?? 0) + absAmount(e.amount));
    }
  }

  // Per-installment precise attribution (when paymentToInstallmentId provided).
  const preciseClearedByInstallment = new Map<string, number>();
  if (paymentToInstallmentId) {
    for (const e of ledgerEntries) {
      if (e.type !== "payment" || e.paymentStatus !== "paid") continue;
      if (e.reversesId) continue;
      // e.sourceId is the payment id; paymentToInstallmentId maps payment id → installment id.
      const installmentId = paymentToInstallmentId.get(e.sourceId);
      if (!installmentId) continue;
      preciseClearedByInstallment.set(
        installmentId,
        (preciseClearedByInstallment.get(installmentId) ?? 0) + absAmount(e.amount),
      );
    }
  }

  // === Per-installment precise check (when paymentToInstallmentId provided) ===
  // Each installment's amountPaid must be backed by the exact cleared payments
  // mapped to it via the paymentToInstallmentId map.
  for (const inst of installments) {
    const precise = preciseClearedByInstallment.get(inst.id);
    if (precise === undefined) continue; // skip — no precise attribution available
    const diff = inst.amountPaid - precise;
    if (Math.abs(diff) > 0.01) {
      out.push({
        severity: "error",
        code: "UNBACKED_TRANCHE_SATISFACTION",
        message:
          `Installment ${inst.id} (${inst.label}) has amountPaid=${inst.amountPaid} ` +
          `but precise cleared ledger backing=${precise.toFixed(2)} (diff=${diff.toFixed(2)}). ` +
          `Status="${inst.status}".`,
        details: {
          installmentId: inst.id,
          amountPaid: inst.amountPaid,
          clearedBacking: precise,
          diff,
          status: inst.status,
          mode: "precise",
        },
      });
    }
  }

  // === Account-level aggregate check (fallback when no precise map) ===
  // When we don't have per-installment attribution, the correct invariant is:
  //   Σ installment.amountDue on account ≡ Σ cleared payments + Σ credit adjustments on account
  // We compare the SUM of installments' amountPaid per account to the account's
  // cleared backing. This avoids false positives when a parent has multiple
  // installments on the same account (e.g. 3 tuition tranches).
  if (!paymentToInstallmentId || paymentToInstallmentId.size === 0) {
    const amountPaidByAccount = new Map<string, number>();
    const installmentCountByAccount = new Map<string, number>();
    for (const inst of installments) {
      const key = accountKey(inst.parentId, inst.category, inst.studentId);
      amountPaidByAccount.set(key, (amountPaidByAccount.get(key) ?? 0) + inst.amountPaid);
      installmentCountByAccount.set(key, (installmentCountByAccount.get(key) ?? 0) + 1);
    }
    for (const [key, totalAmountPaid] of amountPaidByAccount) {
      const cleared = clearedByAccount.get(key) ?? 0;
      const adjustments = adjustmentsByAccount.get(key) ?? 0;
      const backing = cleared + adjustments;
      const diff = totalAmountPaid - backing;
      if (Math.abs(diff) > 0.01) {
        const count = installmentCountByAccount.get(key) ?? 1;
        const [parentId, category, studentId] = key.split("|");
        // Under-backed (diff > 0): installment amountPaid exceeds cleared
        // payments — a real data integrity ERROR (tranche marked paid
        // without payment backing).
        // Over-backed (diff < 0): cleared payments exceed installment
        // amountPaid — the parent overpaid and the excess hasn't been
        // converted to parent_credit yet. This is a WARNING, not an error.
        const isOverbacked = diff < 0;
        out.push({
          severity: isOverbacked ? "warning" : "error",
          code: "UNBACKED_TRANCHE_SATISFACTION",
          message:
            `Account parent=${parentId} category=${category} student=${studentId || "—"} ` +
            `has ${count} installment(s) with Σ amountPaid=${totalAmountPaid.toFixed(2)} ` +
            `but cleared ledger backing=${backing.toFixed(2)} (diff=${diff.toFixed(2)}).` +
            (isOverbacked ? " [over-backed — excess should be parent_credit]" : ""),
          details: {
            accountKey: key,
            parentId,
            category,
            studentId: studentId || null,
            installmentCount: count,
            totalAmountPaid,
            clearedBacking: backing,
            diff,
            mode: "account_aggregate",
            overbacked: isOverbacked,
          },
        });
      }
    }
  }
  return out;
}

/**
 * Verify that the sum of cleared payments in the `payments` table equals
 * the sum of cleared payment credits on the ledger.
 *
 * Invariant: Σ payments.amount where status='paid'
 *            ≡ Σ |ledger_entries.amount| where type='payment' AND paymentStatus='paid'
 *                             AND id NOT IN (set of reversed entry ids)
 *
 * Reversed entries (those referenced by a `reversal` entry's `reversesId`)
 * are excluded from the ledger sum — their contribution is canceled out
 * by the reversal, so they should not be counted as "cleared".
 *
 * Emits `PAYMENT_LEDGER_MISMATCH` (error) on discrepancy > 0.01 DZD.
 */
export function crossCheckClearedBalance(
  payments: ReadonlyArray<{ id: string; amount: number; status: string }>,
  ledgerEntries: readonly LedgerEntry[],
): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  // Build the set of entry ids that have been reversed by a reversal entry.
  const reversedIds = new Set(
    ledgerEntries.filter((e) => e.reversesId).map((e) => e.reversesId!),
  );
  const paymentsCleared = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  const ledgerCleared = ledgerEntries
    .filter((e) => e.type === "payment" && e.paymentStatus === "paid")
    .filter((e) => !reversedIds.has(e.id)) // exclude reversed entries
    .reduce((s, e) => s + absAmount(e.amount), 0);
  if (!amountsApproximatelyEqual(paymentsCleared, ledgerCleared)) {
    out.push({
      severity: "error",
      code: "PAYMENT_LEDGER_MISMATCH",
      message:
        `Sum of cleared payments (${paymentsCleared}) does not equal sum of cleared ` +
        `payment ledger entries (${ledgerCleared}).`,
      details: { paymentsCleared, ledgerCleared, diff: paymentsCleared - ledgerCleared },
    });
  }
  return out;
}

/**
 * Verify that every parent account with a negative balance (school owes
 * the parent) strictly corresponds to a `parent_credit` adjustment entry.
 *
 * Emits `UNBACKED_PARENT_CREDIT` (warning) when a negative balance exists
 * without a corresponding `parent_credit` entry — this typically indicates
 * an overpayment that was logged as a regular payment without generating
 * the explicit credit adjustment, which breaks auto-absorption on future
 * invoices.
 */
export function crossCheckParentCredit(
  parentSummaries: ReadonlyArray<{
    parentId: string;
    parentName: string;
    totalOutstanding: number;
    accounts?: ReadonlyArray<{
      accountId: string;
      category: string;
      studentId: string | null;
      balance: number;
      unallocatedCredit?: number;
    }>;
  }>,
  ledgerEntries: readonly LedgerEntry[],
): ReconciliationViolation[] {
  const out: ReconciliationViolation[] = [];
  // Build a set of parentIds that have at least one parent_credit adjustment entry.
  const parentsWithCreditEntry = new Set<string>();
  for (const e of ledgerEntries) {
    if (e.category === "parent_credit" && e.type === "adjustment" && !e.reversesId) {
      parentsWithCreditEntry.add(e.parentId);
    }
  }
  for (const p of parentSummaries) {
    if (p.totalOutstanding < -0.01) {
      // Negative outstanding balance — school owes parent.
      if (!parentsWithCreditEntry.has(p.parentId)) {
        out.push({
          severity: "warning",
          code: "UNBACKED_PARENT_CREDIT",
          message:
            `Parent ${p.parentId} (${p.parentName}) has negative outstanding balance ` +
            `${p.totalOutstanding.toFixed(2)} but no parent_credit adjustment entry exists ` +
            `on the ledger. Auto-absorption on future invoices will not work.`,
          details: { parentId: p.parentId, outstanding: p.totalOutstanding },
        });
      }
    }
    // Also check per-account negative balances.
    if (p.accounts) {
      for (const acc of p.accounts) {
        if (acc.balance < -0.01 && acc.category !== "parent_credit") {
          out.push({
            severity: "warning",
            code: "UNBACKED_PARENT_CREDIT",
            message:
              `Account ${acc.accountId} (parent ${p.parentId}, category ${acc.category}) ` +
              `has negative balance ${acc.balance.toFixed(2)} but is not a parent_credit account. ` +
              `Overpayments should be stored as explicit parent_credit adjustments.`,
            details: { accountId: acc.accountId, balance: acc.balance, category: acc.category },
          });
        }
      }
    }
  }
  return out;
}
