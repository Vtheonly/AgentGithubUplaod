/**
 * Mock ledger repository — single source of truth for all financial transactions.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including reconciliation with
 * cross-checks against payments and installments.
 */
import type {
  LedgerRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { derived } from "../subject-behavior";
import type {
  LedgerEntry,
  ParentLedgerSummary,
} from "../../../domain/model/ledger";
import {
  computeAccountBalance,
  computeParentSummary,
  createReversalEntry,
} from "../../../domain/calc/ledger";
import {
  reconcileLedger,
  crossCheckPayments,
  crossCheckInstallments,
  crossCheckBalanceSum,
  crossCheckInstallmentPayments,
  crossCheckClearedBalance,
  crossCheckParentCredit,
} from "../../../domain/calc/reconcile";
import type { ReconciliationReport } from "../../../domain/reconcile-types";
import { store, appendAudit, delay } from "./mock-store";

export class MockLedgerRepository implements LedgerRepository {
  observe(): Observable<LedgerEntry[]> {
    return store.ledger$;
  }

  observeByParent(parentId: string): Observable<LedgerEntry[]> {
    // FIX (reactivity): derive from the store stream so financial history
    // views refresh after any ledger append/reversal/import.
    return derived([store.ledger$], () => store.ledger.filter((e) => e.parentId === parentId));
  }

  observeByAccount(accountId: string): Observable<LedgerEntry[]> {
    return derived([store.ledger$], () => store.ledger.filter((e) => e.accountId === accountId));
  }

  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> {
    await delay(80);
    store.ledger = [...store.ledger, entry];
    store.notifyLedger();
    appendAudit({
      action: "ledger.entry.append",
      entityType: "ledger",
      entityId: entry.id,
      actorId: entry.actorId,
      actorName: entry.actorName,
      diff: { before: null, after: { type: entry.type, amount: entry.amount, accountId: entry.accountId, category: entry.category } },
      note: `Écriture ${entry.type} — ${entry.amount.toLocaleString("fr-FR")} DZD [${entry.category}] ${entry.description.slice(0, 60)}`,
    });
    return Ok(entry);
  }

  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    await delay(120);
    store.ledger = [...store.ledger, ...entries];
    store.notifyLedger();
    appendAudit({
      action: "ledger.entry.append_many",
      entityType: "ledger",
      entityId: "batch",
      actorId: entries[0]?.actorId ?? "system",
      actorName: entries[0]?.actorName ?? "System",
      diff: { before: null, after: { count: entries.length, totalAmount: entries.reduce((s, e) => s + e.amount, 0) } },
      note: `Ajout en lot de ${entries.length} écriture(s) de ledger`,
    });
    return Ok(entries);
  }

  async reverse(originalId: string, reason: string, actorId: string, actorName: string): Promise<Result<LedgerEntry>> {
    await delay(120);
    const original = store.ledger.find((e) => e.id === originalId);
    if (!original) return Err(Errors.notFound("LedgerEntry", originalId));
    const reversal = createReversalEntry(original, { reason, actorId, actorName });
    store.ledger = [...store.ledger, reversal];
    store.notifyLedger();
    appendAudit({
      action: "ledger.entry.reverse",
      entityType: "ledger",
      entityId: reversal.id,
      actorId,
      actorName,
      diff: { before: { entryId: original.id, amount: original.amount, type: original.type }, after: { entryId: reversal.id, amount: reversal.amount, type: reversal.type, reversesId: original.id } },
      note: `Inversion de l'écriture ${original.id} (${original.amount.toLocaleString("fr-FR")} DZD) — motif: ${reason}`,
    });
    return Ok(reversal);
  }

  async summary(parentId: string): Promise<Result<ParentLedgerSummary>> {
    await delay(80);
    const parent = store.parents.find((p) => p.id === parentId);
    const parentName = parent ? `${parent.firstName} ${parent.lastName}` : "";
    const entries = store.ledger.filter((e) => e.parentId === parentId);
    return Ok(computeParentSummary(entries, parentId, parentName));
  }

  /**
   * Run reconciliation against the entire ledger. Also cross-checks
   * the Payment and Installment tables against the ledger.
   *
   * UNIFIED ARCHITECTURE (Epic 7.1): now also runs the 3 new cross-checks
   * introduced in iteration 1:
   *   - `crossCheckInstallmentPayments` (UNBACKED_TRANCHE_SATISFACTION)
   *   - `crossCheckClearedBalance` (PAYMENT_LEDGER_MISMATCH)
   *   - `crossCheckParentCredit` (UNBACKED_PARENT_CREDIT)
   */
  async reconcile(): Promise<Result<ReconciliationReport>> {
    await delay(150);
    const report = reconcileLedger(store.ledger);
    // Cross-check payments and installments.
    const paymentViolations = crossCheckPayments(
      store.payments.map((p) => ({ id: p.id, amount: p.amount, status: p.status, receiptNumber: p.receiptNumber })),
      store.ledger,
    );
    const installmentViolations = crossCheckInstallments(
      store.installments.map((i) => ({
        id: i.id,
        parentId: i.parentId,
        studentId: i.studentId,
        category: i.category,
        amountDue: i.amountDue,
        label: i.label,
      })),
      store.ledger,
    );
    // Cross-check balance sum.
    const accountIds = new Set(store.ledger.map((e) => e.accountId));
    const balances = Array.from(accountIds).map((accId) => computeAccountBalance(store.ledger, accId));
    const balanceViolations = crossCheckBalanceSum(store.ledger, balances);

    // === Epic 7.1 — NEW cross-checks ===
    // 1. Installment ↔ ledger payment backing (UNBACKED_TRANCHE_SATISFACTION)
    const installmentPaymentViolations = crossCheckInstallmentPayments(
      store.installments.map((i) => ({
        id: i.id,
        parentId: i.parentId,
        studentId: i.studentId,
        category: i.category,
        amountDue: i.amountDue,
        amountPaid: i.amountPaid,
        label: i.label,
        status: i.status,
      })),
      store.ledger,
    );
    // 2. Cleared payments ↔ cleared ledger payment credits (PAYMENT_LEDGER_MISMATCH)
    const clearedBalanceViolations = crossCheckClearedBalance(
      store.payments.map((p) => ({ id: p.id, amount: p.amount, status: p.status })),
      store.ledger,
    );
    // 3. Parent credit backing (UNBACKED_PARENT_CREDIT)
    const parentSummaries = store.parents.map((p) => {
      const parentName = `${p.firstName} ${p.lastName}`;
      const summary = computeParentSummary(store.ledger, p.id, parentName);
      return {
        parentId: p.id,
        parentName,
        totalOutstanding: summary.totalOutstanding,
        accounts: summary.accounts.map((a) => ({
          accountId: a.accountId,
          category: a.category,
          studentId: a.studentId,
          balance: a.balance,
          unallocatedCredit: a.unallocatedCredit,
        })),
      };
    });
    const parentCreditViolations = crossCheckParentCredit(parentSummaries, store.ledger);

    const allViolations = [
      ...report.violations,
      ...paymentViolations,
      ...installmentViolations,
      ...balanceViolations,
      ...installmentPaymentViolations,
      ...clearedBalanceViolations,
      ...parentCreditViolations,
    ];
    return Ok({
      ...report,
      violations: allViolations,
      passed: allViolations.filter((v) => v.severity === "error").length === 0,
      summary: {
        errors: allViolations.filter((v) => v.severity === "error").length,
        warnings: allViolations.filter((v) => v.severity === "warning").length,
        infos: allViolations.filter((v) => v.severity === "info").length,
      },
    });
  }
}

/** Singleton — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockLedgerRepository: LedgerRepository = new MockLedgerRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
