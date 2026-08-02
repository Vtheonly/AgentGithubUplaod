/**
 * Payment operations — plain-function helpers used by `MockPaymentRepository`.
 *
 * Extracted from `financial-repository.ts` in task 6-b. Behavior preserved
 * verbatim — only file location + import paths changed.
 */
import type { Result } from "../../../../core/result";
import { Ok, Err } from "../../../../core/result";
import { Errors } from "../../../../core/app-error";
import { AuditActions } from "../../../../core/audit-actions";
import type {
  Payment,
  AccountAdjustment,
  Receipt,
  CollectPaymentInput,
  PaymentStatus,
} from "../../../../domain/model/payment";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import { deriveAccountId } from "../../../../domain/calc/ledger";
import type { FinancialOpsCtx } from "./types";

/** Iteration 5: collect a payment + append the canonical ledger entry. */
export async function collectPayment(
  ctx: FinancialOpsCtx,
  input: CollectPaymentInput,
  collectedBy: string,
): Promise<Result<Payment>> {
  const { store, appendAudit, nowIso, delay, tenantId } = ctx;
  await delay(250);
  const year = new Date().getFullYear();
  const seq = store.payments.length + 1;
  const status: PaymentStatus = input.method === "cash" ? "paid" : "pending";
  const payment: Payment = {
    id: `pay-${String(seq).padStart(3, "0")}`,
    tenantId,
    receiptNumber: `REC-${year}-${String(seq).padStart(6, "0")}`,
    parentId: input.parentId,
    studentId: input.studentId,
    amount: input.amount,
    method: input.method,
    status,
    category: input.category,
    installmentId: input.installmentId,
    proofUrl: input.proofUrl ?? null,
    notes: input.notes ?? null,
    collectedBy,
    collectedAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.payments.unshift(payment);
  store.notifyPayments();

  // Iteration 5: append the corresponding ledger entry. This is the
  // single source of truth for the payment's effect on the parent's
  // balance. The payment table is now a denormalized view; the ledger
  // is canonical.
  const ledgerEntry: LedgerEntry = {
    id: `led-${nowIso()}-${Math.random().toString(36).slice(2, 10)}`,
    tenantId,
    accountId: deriveAccountId(input.parentId, input.category, input.studentId),
    parentId: input.parentId,
    studentId: input.studentId,
    category: input.category,
    amount: -input.amount, // payments are credits (negative)
    type: "payment",
    sourceType: "payment",
    sourceId: payment.id,
    method: input.method,
    receiptNumber: payment.receiptNumber,
    paymentStatus: status,
    reversesId: null,
    description: `Encaissement ${payment.receiptNumber} — ${input.method} (${input.category})`,
    actorId: collectedBy,
    actorName: "Session courante",
    at: payment.collectedAt,
    metadata: Object.freeze({
      installmentId: input.installmentId ?? null,
      proofUrl: input.proofUrl ?? null,
    }),
  };
  store.ledger = [...store.ledger, ledgerEntry];
  store.notifyLedger();

  appendAudit({
    action: AuditActions.PaymentCreate,
    entityType: "payment",
    entityId: payment.id,
    actorId: collectedBy,
    actorName: "Session courante",
    diff: {
      before: null,
      after: {
        amount: payment.amount,
        method: payment.method,
        receipt: payment.receiptNumber,
        ledgerEntryId: ledgerEntry.id,
      },
    },
  });
  return Ok(payment);
}

/**
 * Iteration 6: refund a payment + append a ledger reversal entry that
 * negates the original payment's ledger entry.
 */
export async function refundPayment(
  ctx: FinancialOpsCtx,
  id: string,
): Promise<Result<Payment>> {
  const { store, appendAudit, nowIso, delay, tenantId } = ctx;
  await delay(200);
  const idx = store.payments.findIndex((p) => p.id === id);
  if (idx < 0) return Err(Errors.notFound("Payment", id));
  const before = store.payments[idx];
  const after: Payment = { ...before, status: "refunded", updatedAt: nowIso() };
  store.payments[idx] = after;
  store.notifyPayments();

  // Iteration 6: Append a ledger reversal entry that negates the original
  // payment's ledger entry. The plan's accounting engine mandates that every
  // refund be traceable — the ledger must reflect the reversal so the parent's
  // balance is correctly re-computed by replay.
  const originalLedgerEntry = store.ledger.find(
    (e) => e.sourceType === "payment" && e.sourceId === id && e.type === "payment",
  );
  if (originalLedgerEntry) {
    const reversalEntry: LedgerEntry = {
      id: `led-${nowIso()}-${Math.random().toString(36).slice(2, 10)}`,
      tenantId,
      accountId: originalLedgerEntry.accountId,
      parentId: originalLedgerEntry.parentId,
      studentId: originalLedgerEntry.studentId,
      category: originalLedgerEntry.category,
      // Original payment entry stored a NEGATIVE amount (credit).
      // Reversal negates it → POSITIVE amount (debit; parent owes it back).
      amount: -originalLedgerEntry.amount,
      type: "reversal",
      sourceType: "payment",
      sourceId: id,
      method: originalLedgerEntry.method,
      receiptNumber: originalLedgerEntry.receiptNumber,
      paymentStatus: "refunded",
      reversesId: originalLedgerEntry.id,
      description: `Remboursement ${before.receiptNumber} — inversion de l'écriture de paiement`,
      actorId: "usr-current",
      actorName: "Session courante",
      at: nowIso(),
      metadata: Object.freeze({
        refundReason: "Remboursement manuel",
        originalPaymentId: id,
      }),
    };
    store.ledger = [...store.ledger, reversalEntry];
    store.notifyLedger();
    appendAudit({
      action: AuditActions.PaymentRefund,
      entityType: "payment",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: {
        before: { status: before.status, ledgerEntryId: originalLedgerEntry.id },
        after: { status: "refunded", reversalEntryId: reversalEntry.id },
      },
    });
  } else {
    // No original ledger entry found — log a warning but still record the refund.
    appendAudit({
      action: AuditActions.PaymentRefund,
      entityType: "payment",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: { status: before.status }, after: { status: "refunded" } },
      note: "ATTENTION: aucune écriture de ledger correspondante trouvée pour le remboursement",
    });
  }
  return Ok(after);
}

/** Adjust a parent's account (manual entry — no ledger effect). */
export async function adjustAccount(
  ctx: FinancialOpsCtx,
  parentId: string,
  amount: number,
  reason: string,
  approvedBy: string,
): Promise<Result<AccountAdjustment>> {
  const { appendAudit, nowIso, delay } = ctx;
  await delay(200);
  const adj: AccountAdjustment = {
    id: `adj-${Date.now()}`,
    parentId,
    amount,
    reason,
    approvedBy,
    approvedAt: nowIso(),
    receiptRef: null,
  };
  appendAudit({
    action: AuditActions.PaymentAdjust,
    entityType: "adjustment",
    entityId: adj.id,
    actorId: approvedBy,
    actorName: "Session courante",
    diff: { before: null, after: { amount, reason } },
  });
  return Ok(adj);
}

/** Generate a (mock) receipt PDF for an existing payment. */
export async function generateReceiptForPayment(
  ctx: FinancialOpsCtx,
  paymentId: string,
  generatedBy: string,
): Promise<Result<Receipt>> {
  const { store, appendAudit, nowIso, delay } = ctx;
  await delay(180);
  const p = store.payments.find((x) => x.id === paymentId);
  if (!p) return Err(Errors.notFound("Payment", paymentId));
  const receipt: Receipt = {
    id: `rcp-${Date.now()}`,
    paymentId,
    receiptNumber: p.receiptNumber,
    pdfUrl: `mock://receipts/${p.receiptNumber}.pdf`,
    generatedAt: nowIso(),
    generatedBy,
  };
  appendAudit({
    action: AuditActions.ReceiptGenerate,
    entityType: "receipt",
    entityId: receipt.id,
    actorId: generatedBy,
    actorName: "Session courante",
  });
  return Ok(receipt);
}
