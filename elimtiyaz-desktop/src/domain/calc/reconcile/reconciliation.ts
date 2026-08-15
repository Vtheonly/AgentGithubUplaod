/**
 * Unified Reconciliation Engine — single public entry point that runs all
 * ledger self-checks + cross-entity checks (payments ↔ ledger ↔ installments).
 */
import type { LedgerEntry } from "@/domain/model/ledger";
import type { Payment, Installment } from "@/domain/model/payment";
import type { ReconciliationReport, ReconciliationViolation } from "@/domain/reconcile-types";
import { reconcileLedger } from "./index";
import {
  crossCheckPayments, crossCheckInstallments,
  crossCheckClearedBalance, crossCheckInstallmentPayments,
} from "./cross-checks";

export interface ReconciliationContext {
  readonly ledger: readonly LedgerEntry[];
  readonly payments: readonly Payment[];
  readonly installments: readonly Installment[];
}

export function reconcileFinancials(ctx: ReconciliationContext): ReconciliationReport {
  const violations: ReconciliationViolation[] = [];

  violations.push(...reconcileLedger(ctx.ledger).violations);

  violations.push(
    ...crossCheckPayments(
      ctx.payments.map((p) => ({
        id: p.id, amount: p.amount, status: p.status, receiptNumber: p.receiptNumber,
      })),
      ctx.ledger,
    ),
  );

  violations.push(...crossCheckInstallments(ctx.installments, ctx.ledger));
  violations.push(...crossCheckClearedBalance(ctx.payments, ctx.ledger));
  violations.push(...crossCheckInstallmentPayments(ctx.installments, ctx.ledger));

  return summarize(ctx.ledger, violations);
}

export function clearedBalancesReconcile(ctx: ReconciliationContext): boolean {
  const violations = crossCheckClearedBalance(ctx.payments, ctx.ledger);
  return violations.filter((v) => v.severity === "error").length === 0;
}

function summarize(
  ledger: readonly LedgerEntry[], violations: ReconciliationViolation[],
): ReconciliationReport {
  const errors = violations.filter((v) => v.severity === "error").length;
  const warnings = violations.filter((v) => v.severity === "warning").length;
  const infos = violations.filter((v) => v.severity === "info").length;
  const accountCount = new Set(ledger.map((e) => e.accountId)).size;
  return {
    checkedAt: new Date().toISOString(),
    entryCount: ledger.length, accountCount, violations,
    passed: errors === 0, summary: { errors, warnings, infos },
  };
}

export {
  reconcileLedger, crossCheckPayments, crossCheckInstallments,
  crossCheckClearedBalance, crossCheckInstallmentPayments,
  crossCheckBalanceSum, crossCheckParentCredit,
} from "./";
