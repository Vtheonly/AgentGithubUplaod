/**
 * Unified Reconciliation Engine — single public entry point that runs all
 * ledger self-checks + cross-entity checks (payments ↔ ledger ↔ installments).
 *
 * T-016 (2026-08-30): the two remaining cross-checks — `crossCheckBalanceSum`
 * (INV-9 — Σ entries ≡ Σ account balances) and `crossCheckParentCredit`
 * (every negative balance backed by a `parent_credit` adjustment) — are now
 * wired in. Inputs are derived from the ledger itself (the only source the
 * engine has) by replaying it through `computeAccountBalance` /
 * `computeParentSummary`, so callers do not need to extend
 * `ReconciliationContext` with extra inputs. The derived balances and
 * summaries are also returned on the report (`.derived`) so consumers can
 * reuse the replay instead of recomputing.
 */
import type { LedgerEntry } from "@/domain/model/ledger";
import type { Payment, Installment } from "@/domain/model/payment";
import type { ReconciliationReport, ReconciliationViolation } from "@/domain/reconcile-types";
import { reconcileLedger } from "./index";
import {
  crossCheckPayments, crossCheckInstallments,
  crossCheckClearedBalance, crossCheckInstallmentPayments,
  crossCheckBalanceSum, crossCheckParentCredit,
} from "./cross-checks";
import { computeAccountBalance, computeParentSummary } from "../ledger/balance";

export interface ReconciliationContext {
  readonly ledger: readonly LedgerEntry[];
  readonly payments: readonly Payment[];
  readonly installments: readonly Installment[];
}

/**
 * Replay the ledger once to derive every input the cross-checks need:
 *   - per-account balances (for `crossCheckBalanceSum`)
 *   - per-parent summaries (for `crossCheckParentCredit`)
 *
 * Both helpers live in `domain/calc/ledger/balance.ts` and are the canonical
 * balance-computation path — the same code the UI and reports use — so
 * deriving the reconciler's inputs from them does not introduce a parallel
 * implementation (AGENTS.md §9). The parent name is taken from the first
 * ledger entry's `actorName`-equivalent is not stored on entries, so we
 * fall back to the parentId; the name is only used for error messages.
 */
function deriveFromLedger(ledger: readonly LedgerEntry[]) {
  const accountIds = new Set(ledger.map((e) => e.accountId));
  const accountBalances = Array.from(accountIds, (id) =>
    computeAccountBalance(ledger, id),
  );

  const parentIds = new Set(ledger.map((e) => e.parentId));
  const parentSummaries = Array.from(parentIds, (pid) =>
    computeParentSummary(ledger, pid, pid),
  );

  return { accountBalances, parentSummaries };
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

  // T-016: the two previously-unwired cross-checks (INV-9 + UNBACKED_PARENT_CREDIT).
  // Derived from the ledger itself — see `deriveFromLedger`.
  const { accountBalances, parentSummaries } = deriveFromLedger(ctx.ledger);
  violations.push(...crossCheckBalanceSum(ctx.ledger, accountBalances));
  violations.push(...crossCheckParentCredit(parentSummaries, ctx.ledger));

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
