/**
 * Expense operations — plain-function helpers used by
 * `MockExpenseRepository` (iteration 6 state machine + self-approval rule).
 *
 * Extracted from `financial-repository.ts` in task 6-b. Behavior preserved
 * verbatim — only file location + import paths changed.
 */
import type { Result } from "../../../../core/result";
import { Ok, Err } from "../../../../core/result";
import { Errors } from "../../../../core/app-error";
import { AuditActions } from "../../../../core/audit-actions";
import type { Expense, SubmitExpenseInput, ExpenseStatus } from "../../../../domain/model/expense";
import type { FinancialOpsCtx } from "./types";

/** Iteration 6: submit a new expense request (status = "submitted"). */
export async function submitExpense(
  ctx: FinancialOpsCtx,
  input: SubmitExpenseInput,
  submittedBy: string,
): Promise<Result<Expense>> {
  const { store, appendAudit, nowIso, delay, tenantId } = ctx;
  await delay(220);
  const seq = store.expenses.length + 1;
  const exp: Expense = {
    ...input,
    id: `exp-${String(seq).padStart(3, "0")}`,
    tenantId,
    requestCode: `EXP-2025-${String(seq).padStart(3, "0")}`,
    status: "submitted",
    submittedBy,
    submittedAt: nowIso(),
    approvedBy: null, approvedAt: null, approvalNote: null,
    disbursedBy: null, disbursedAt: null,
    proofUrl: null, proofUploadedBy: null, proofUploadedAt: null,
    anomalyScore: null, anomalyNote: null,
  };
  store.expenses.unshift(exp);
  store.notifyExpenses();
  appendAudit({
    action: AuditActions.ExpenseSubmit,
    entityType: "expense",
    entityId: exp.id,
    actorId: submittedBy,
    actorName: "Session courante",
  });
  return Ok(exp);
}

/**
 * Iteration 6: approve an expense — enforces the "no self-approval" rule
 * (plan §08). On blocked self-approval, writes an audit entry describing
 * the attempt and returns `Err(forbidden)`.
 */
export async function approveExpense(
  ctx: FinancialOpsCtx,
  id: string,
  approver: string,
  note?: string,
): Promise<Result<Expense>> {
  const { store, appendAudit, nowIso } = ctx;
  // Iteration 6: enforce "no self-approval" rule (plan §08).
  const expense = store.expenses.find((e) => e.id === id);
  if (!expense) return Err(Errors.notFound("Expense", id));
  if (expense.submittedBy === approver) {
    appendAudit({
      action: AuditActions.ExpenseApprove,
      entityType: "expense",
      entityId: id,
      actorId: approver,
      actorName: "Session courante",
      diff: { before: { status: expense.status }, after: { status: expense.status } },
      note: "Tentative d'auto-approbation bloquée — le demandeur ne peut pas approuver sa propre dépense",
    });
    return Err(Errors.forbidden("Un demandeur ne peut pas approuver sa propre dépense (règle d'auto-approbation)"));
  }
  return transitionExpense(ctx, id, "approved", { approvedBy: approver, approvedAt: nowIso(), approvalNote: note ?? null }, AuditActions.ExpenseApprove, approver);
}

/** Iteration 6: reject an expense — also enforces "no self-approval". */
export async function rejectExpense(
  ctx: FinancialOpsCtx,
  id: string,
  approver: string,
  note: string,
): Promise<Result<Expense>> {
  const { store, nowIso } = ctx;
  // Iteration 6: enforce "no self-approval" rule (plan §08) — applies to reject too.
  const expense = store.expenses.find((e) => e.id === id);
  if (!expense) return Err(Errors.notFound("Expense", id));
  if (expense.submittedBy === approver) {
    return Err(Errors.forbidden("Un demandeur ne peut pas rejeter sa propre dépense (règle d'auto-approbation)"));
  }
  return transitionExpense(ctx, id, "rejected", { approvedBy: approver, approvedAt: nowIso(), approvalNote: note }, AuditActions.ExpenseReject, approver);
}

/** Iteration 6: disburse an approved expense. */
export async function disburseExpense(
  ctx: FinancialOpsCtx,
  id: string,
  disbursedBy: string,
): Promise<Result<Expense>> {
  const { nowIso } = ctx;
  return transitionExpense(ctx, id, "disbursed", { disbursedBy, disbursedAt: nowIso() }, AuditActions.ExpenseDisburse, disbursedBy);
}

/** Iteration 6: settle a disbursed expense by attaching a proof URL. */
export async function settleProofExpense(
  ctx: FinancialOpsCtx,
  id: string,
  proofUrl: string,
  uploadedBy: string,
): Promise<Result<Expense>> {
  const { nowIso } = ctx;
  return transitionExpense(ctx, id, "settled", { proofUrl, proofUploadedBy: uploadedBy, proofUploadedAt: nowIso() }, AuditActions.ExpenseSettle, uploadedBy);
}

/**
 * Iteration 6: shared state-machine transition.
 *
 * Enforces: submitted → approved/rejected, approved → disbursed,
 * disbursed → settled. Patches the expense, notifies observers, and
 * writes an audit entry on success.
 */
export function transitionExpense(
  ctx: FinancialOpsCtx,
  id: string,
  status: ExpenseStatus,
  patches: Partial<Expense>,
  action: string,
  actorId: string,
): Promise<Result<Expense>> {
  const { store, appendAudit } = ctx;
  const idx = store.expenses.findIndex((e) => e.id === id);
  if (idx < 0) return Promise.resolve(Err(Errors.notFound("Expense", id)));
  const before = store.expenses[idx];
  // Iteration 6: enforce state machine — submitted → approved/rejected, approved → disbursed, disbursed → settled.
  const allowedTransitions: Record<ExpenseStatus, ExpenseStatus[]> = {
    draft: ["submitted"],
    submitted: ["approved", "rejected"],
    approved: ["disbursed"],
    rejected: [],
    disbursed: ["settled"],
    settled: [],
  };
  const allowed = allowedTransitions[before.status] ?? [];
  if (!allowed.includes(status)) {
    return Promise.resolve(Err(Errors.conflict(`Transition non autorisée: ${before.status} → ${status}`)));
  }
  const after: Expense = { ...before, ...patches, status };
  store.expenses[idx] = after;
  store.notifyExpenses();
  appendAudit({
    action,
    entityType: "expense",
    entityId: id,
    actorId,
    actorName: "Session courante",
    diff: { before: { status: before.status }, after: { status } },
  });
  return Promise.resolve(Ok(after));
}
