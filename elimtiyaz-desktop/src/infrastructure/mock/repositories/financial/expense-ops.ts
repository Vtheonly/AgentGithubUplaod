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
import { uploadPrivateMedia } from "../../../storage/media-vault";
import type {
  Expense,
  ExpenseAttachment,
  ExpenseAttachmentFile,
  ExpenseAttachmentSource,
  SubmitExpenseInput,
  UpdateExpenseInput,
  ExpenseStatus,
} from "../../../../domain/model/expense";
import type { FinancialOpsCtx } from "./types";

/**
 * VAULT §08.03 — notify the requester of an approve/reject decision.
 * "Requester is notified with the rejection reason."
 */
function notifyRequester(
  ctx: FinancialOpsCtx,
  expense: Expense,
  kind: "approved" | "rejected",
  reason: string | null,
  actorId: string,
): void {
  const { store, nowIso } = ctx;
  const notification = {
    id: `ntf-expense-${expense.id}-${kind}-${Date.now()}`,
    title: kind === "approved"
      ? `Dépense approuvée — ${expense.requestCode}`
      : `Dépense rejetée — ${expense.requestCode}`,
    body: kind === "approved"
      ? `Votre demande « ${expense.title} » (${expense.amount.toLocaleString("fr-FR")} DZD) a été approuvée par l'administration. ${reason ? `Note : ${reason}` : ""}`.trim()
      : `Votre demande « ${expense.title} » (${expense.amount.toLocaleString("fr-FR")} DZD) a été rejetée. Motif : ${reason ?? "Non précisé"}`,
    type: "expense_pending" as const,
    priority: kind === "rejected" ? ("high" as const) : ("medium" as const),
    source: "system" as const,
    sourceLabel: "Module Dépenses",
    entityType: "expense",
    entityId: expense.id,
    targetUserId: expense.submittedBy,
    targetRole: null,
    triggeredAt: null,
    readAt: null,
    createdAt: nowIso(),
    createdBy: actorId,
  };
  store.notifications = [notification, ...store.notifications];
  store.notifyNotifications();
}

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
    urgency: input.urgency ?? "medium",
    id: `exp-${String(seq).padStart(3, "0")}`,
    tenantId,
    requestCode: `EXP-2025-${String(seq).padStart(3, "0")}`,
    status: "submitted",
    submittedBy,
    // T-521 (WORKFORCE-520): the distinct accountable person — defaults to
    // the submitter when not named (the common case), another staff member
    // when submitting on someone's behalf.
    responsibleProfileId: input.responsibleProfileId ?? submittedBy,
    submittedAt: nowIso(),
    approvedBy: null, approvedAt: null, approvalNote: null,
    disbursedBy: null, disbursedAt: null,
    proofUrl: null, proofUploadedBy: null, proofUploadedAt: null,
    finalSpentAmount: null,
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
    diff: {
      before: null,
      after: {
        title: exp.title,
        amount: exp.amount,
        category: exp.category,
        urgency: exp.urgency,
        status: exp.status,
      },
    },
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
  // VAULT §08.03 — notify the requester of the approval.
  notifyRequester(ctx, expense, "approved", note ?? null, approver);
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
  // VAULT §08.03 — the requester is notified WITH the rejection reason.
  notifyRequester(ctx, expense, "rejected", note, approver);
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

/**
 * Iteration 6: settle a disbursed expense by attaching a proof URL.
 *
 * VAULT §08.05 (Tier 3) — the settle step ALSO captures the actual final
 * spent amount (may differ from the requested amount); the financial
 * officer verifies it against the disbursed funds before closing.
 */
export async function settleProofExpense(
  ctx: FinancialOpsCtx,
  id: string,
  proofUrl: string,
  uploadedBy: string,
  finalSpentAmount?: number,
): Promise<Result<Expense>> {
  const { nowIso, store } = ctx;
  const expense = store.expenses.find((e) => e.id === id);
  if (!expense) return Err(Errors.notFound("Expense", id));
  if (expense.status !== "disbursed") {
    return Err(Errors.conflict(`Transition non autorisée: ${expense.status} → settled`));
  }
  if (!proofUrl) {
    return Err(Errors.validation("Le justificatif (reçu) est obligatoire pour clôturer la dépense"));
  }
  const patches: Partial<Expense> = {
    proofUrl,
    proofUploadedBy: uploadedBy,
    proofUploadedAt: nowIso(),
    ...(finalSpentAmount !== undefined && finalSpentAmount > 0 ? { finalSpentAmount } : {}),
  };
  return transitionExpense(ctx, id, "settled", patches, AuditActions.ExpenseSettle, uploadedBy);
}

/**
 * T-521 (issue #29): edit an EXISTING expense — only while draft/submitted
 * (the pre-approval window). The SAME record is updated, never duplicated.
 */
export async function updateExpense(
  ctx: FinancialOpsCtx,
  id: string,
  input: UpdateExpenseInput,
  actorId: string,
): Promise<Result<Expense>> {
  const { store, appendAudit } = ctx;
  const idx = store.expenses.findIndex((e) => e.id === id);
  if (idx < 0) return Err(Errors.notFound("Expense", id));
  const before = store.expenses[idx];
  if (before.status !== "draft" && before.status !== "submitted") {
    return Err(
      Errors.conflict(
        `Modification impossible: la dépense est déjà ${before.status} — seules les dépenses en attente sont modifiables.`,
        `Modification impossible : la dépense est déjà ${before.status} — seules les dépenses en attente sont modifiables.`,
      ),
    );
  }
  const after: Expense = {
    ...before,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.payee !== undefined ? { payee: input.payee } : {}),
    ...(input.urgency !== undefined ? { urgency: input.urgency } : {}),
    ...(input.responsibleProfileId !== undefined
      ? { responsibleProfileId: input.responsibleProfileId }
      : {}),
  };
  store.expenses[idx] = after;
  store.notifyExpenses();
  appendAudit({
    action: AuditActions.ExpenseUpdate,
    entityType: "expense",
    entityId: id,
    actorId,
    actorName: "Session courante",
    diff: {
      before: { title: before.title, amount: before.amount },
      after: { title: after.title, amount: after.amount },
    },
  });
  return Ok(after);
}

/**
 * T-521 (issue #29 / WORKFORCE-518): attach a supporting image — the bytes go
 * through the ONE media vault (`uploadPrivateMedia` is mode-aware: the
 * in-memory mock vault when Supabase is not configured, the private
 * `expense-receipts` bucket otherwise) and the canonical metadata row lands
 * in the mock store's `expenseAttachments`. NEVER creates a separate expense.
 */
export async function addExpenseAttachment(
  ctx: FinancialOpsCtx,
  expenseId: string,
  file: ExpenseAttachmentFile,
  uploadedBy: string,
  source: ExpenseAttachmentSource = "desktop",
): Promise<Result<ExpenseAttachment>> {
  const { store, appendAudit, nowIso, delay, tenantId } = ctx;
  await delay(180);
  const expense = store.expenses.find((e) => e.id === expenseId);
  if (!expense) return Err(Errors.notFound("Expense", expenseId));

  let upload;
  try {
    upload = await uploadPrivateMedia({
      bucket: "expense-receipts",
      entityId: expenseId,
      // T-361/UPLOAD-102 compliance: the source guard requires the tenant
      // argument in explicit `tenantId: <variable>` form (the object
      // shorthand `tenantId,` is semantically identical but fails the
      // regex — expanded here so the merged battery stays green).
      tenantId: tenantId,
      file: file.blob as File,
    });
  } catch (e) {
    return Err(
      Errors.network(
        e instanceof Error
          ? `Échec du téléversement : ${e.message}`
          : "Échec du téléversement du justificatif",
      ),
    );
  }

  const attachment: ExpenseAttachment = {
    id: `expatt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    expenseId,
    storageBucket: "expense-receipts",
    storagePath: upload.path,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    uploadedBy,
    uploadedAt: nowIso(),
    source,
  };
  store.expenseAttachments = [attachment, ...store.expenseAttachments];
  store.notifyExpenseAttachments();
  appendAudit({
    action: AuditActions.ExpenseAttachmentAdd,
    entityType: "expense",
    entityId: expenseId,
    actorId: uploadedBy,
    actorName: "Session courante",
    diff: {
      before: null,
      after: { fileName: attachment.fileName, source: attachment.source },
    },
  });
  return Ok(attachment);
}

/** T-521: remove one attachment (the metadata row; mock vault bytes stay). */
export function removeExpenseAttachment(
  ctx: FinancialOpsCtx,
  attachmentId: string,
  actorId: string,
): Result<void> {
  const { store, appendAudit } = ctx;
  const existing = store.expenseAttachments.find((a) => a.id === attachmentId);
  if (!existing) return Err(Errors.notFound("Attachment", attachmentId));
  store.expenseAttachments = store.expenseAttachments.filter(
    (a) => a.id !== attachmentId,
  );
  store.notifyExpenseAttachments();
  appendAudit({
    action: AuditActions.ExpenseAttachmentRemove,
    entityType: "expense",
    entityId: existing.expenseId,
    actorId,
    actorName: "Session courante",
    diff: { before: { attachmentId }, after: null },
  });
  return Ok(undefined);
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
