/**
 * Payment operations — plain-function helpers used by `MockPaymentRepository`.
 *
 * Extracted from `financial-repository.ts` in task 6-b. Behavior preserved
 * verbatim — only file location + import paths changed.
 *
 * UNIFIED ARCHITECTURE (this revision):
 *   - `collectPayment` now runs the waterfall allocation engine
 *     (`allocatePaymentAcrossInstallments`) and writes a `parent_credit`
 *     adjustment entry when there's an overpayment. This closes the loop
 *     on Invariant 2 (Waterfall Conservation) and Invariant 4 (Cleared
 *     Funds Only) — uncleared checks/transfers no longer mark tranches
 *     as `"paid"`.
 *   - `refundPayment` now calls `revertPaymentAllocation` (LIFO) to
 *     subtract the reversed amount from `installment.amountPaid` (or
 *     `amountPending`) and re-evaluate tranche statuses. This closes
 *     the loop on Invariant 5 (Reversal Balance).
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
import { allocatePaymentAcrossInstallments } from "./installment-ops";
import { revertPaymentAllocation } from "../../../../domain/calc/payment/installments";
import type { FinancialOpsCtx } from "./types";

/**
 * Collect a payment and atomically:
 *   1. Insert the `payments` row.
 *   2. Append the canonical payment ledger entry (negative credit).
 *   3. Run the waterfall allocator against the parent's installments:
 *      - For cash (status="paid"): increment `amountPaid`, possibly mark
 *        tranches as `"paid"` / `"partial"`.
 *      - For check/transfer (status="pending"): increment `amountPending`
 *        only; status becomes `"pending_clearance"`. The tranche is NOT
 *        considered satisfied until the underlying payment clears.
 *   4. If there's an overpayment (`unallocatedAmount > 0`), append a
 *      `parent_credit` adjustment entry under category `"parent_credit"`
 *      so the credit can be auto-absorbed by future charges.
 */
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

  // === 1. Append the canonical payment ledger entry ===
  // The ledger is the single source of truth; the payments table is a
  // denormalized view. accountId is student-scoped when studentId is
  // provided, parent-scoped otherwise.
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

  // === 2. Run the waterfall allocator ===
  // For cash (status="paid"): increments amountPaid, possibly marks tranches "paid".
  // For check/transfer (status="pending"): increments amountPending ONLY;
  // status becomes "pending_clearance". Tranche is NOT satisfied until clearance.
  const allocationResult = await allocatePaymentAcrossInstallments(
    ctx,
    input.parentId,
    input.amount,
    payment.id,
    input.category,
    collectedBy,
    "Session courante",
    status,
  );

  // === 3. Record overpayment as parent_credit (if any) ===
  if (allocationResult.ok) {
    const unallocated = allocationResult.value.unallocatedAmount;
    if (unallocated > 0.5) {
      const creditEntry: LedgerEntry = {
        id: `led-${nowIso()}-${Math.random().toString(36).slice(2, 10)}`,
        tenantId,
        // Parent-level credit account: student-scoped-null.
        accountId: deriveAccountId(input.parentId, "parent_credit", null),
        parentId: input.parentId,
        studentId: null,
        category: "parent_credit",
        amount: -unallocated, // negative = credit (school owes parent)
        type: "adjustment",
        sourceType: "adjustment",
        sourceId: `credit-${payment.id}`,
        method: null,
        receiptNumber: payment.receiptNumber,
        paymentStatus: null,
        reversesId: null,
        description: `Crédit parent (excédent de paiement reçu ${payment.receiptNumber})`,
        actorId: collectedBy,
        actorName: "Session courante",
        at: nowIso(),
        metadata: Object.freeze({
          sourcePaymentId: payment.id,
          unallocatedAmount: unallocated,
          category: "parent_credit",
        }),
      };
      store.ledger = [...store.ledger, creditEntry];
      store.notifyLedger();
      appendAudit({
        action: AuditActions.PaymentAdjust,
        entityType: "adjustment",
        entityId: creditEntry.id,
        actorId: collectedBy,
        actorName: "Session courante",
        diff: {
          before: null,
          after: {
            amount: -unallocated,
            category: "parent_credit",
            sourcePaymentId: payment.id,
          },
        },
        note: `Excédent de paiement ${payment.receiptNumber} stocké comme crédit parent`,
      });
    }
  }

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
        status: payment.status,
        allocations: allocationResult.ok ? allocationResult.value.allocations.length : 0,
        unallocatedCredit: allocationResult.ok ? allocationResult.value.unallocatedAmount : 0,
      },
    },
  });
  return Ok(payment);
}

/**
 * Refund / cancel a payment atomically:
 *   1. Update `payments.status` to `"refunded"`.
 *   2. Append a ledger reversal entry that negates the original payment entry.
 *   3. Call `revertPaymentAllocation` (LIFO) to subtract the reversed
 *      amount from the installments' `amountPaid` (or `amountPending`
 *      when the original payment was uncleared) and re-evaluate statuses.
 *   4. Write an audit entry per affected installment.
 *
 * This implements Invariant 5 (Reversal Balance) and ensures tranches
 * are correctly re-opened when a check bounces or a payment is canceled.
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

  // === 1. Append the ledger reversal entry ===
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

    // === 2. Reverse the waterfall allocation (LIFO) ===
    // Determine whether the original payment was cleared or pending.
    const originalWasPending = originalLedgerEntry.paymentStatus === "pending";
    const parentInstallments = store.installments.filter((i) => i.parentId === before.parentId);
    const revertResult = revertPaymentAllocation(
      parentInstallments,
      before.amount,
      before.category,
      originalWasPending,
    );

    // === 3. Persist each revert ===
    for (const rev of revertResult.reverts) {
      const insIdx = store.installments.findIndex((i) => i.id === rev.installmentId);
      if (insIdx < 0) continue;
      const insBefore = store.installments[insIdx];
      store.installments[insIdx] = {
        ...insBefore,
        amountPaid: rev.newAmountPaid,
        amountPending: rev.newAmountPending,
        status: rev.newStatus,
        // Clear paidDate if the tranche is no longer satisfied.
        paidDate: rev.newStatus === "paid" ? insBefore.paidDate : null,
      };
      appendAudit({
        action: "installment.revert_allocation",
        entityType: "installment",
        entityId: rev.installmentId,
        actorId: "usr-current",
        actorName: "Session courante",
        diff: {
          before: {
            amountPaid: insBefore.amountPaid,
            amountPending: insBefore.amountPending,
            status: insBefore.status,
          },
          after: {
            amountPaid: rev.newAmountPaid,
            amountPending: rev.newAmountPending,
            status: rev.newStatus,
            reverted: rev.revertedAmount,
          },
        },
        note: `Inversion LIFO — paiement ${id} remboursé. Reverted ${rev.revertedAmount} DZD.`,
      });
    }
    if (revertResult.reverts.length > 0) {
      store.notifyInstallments();
    }

    appendAudit({
      action: AuditActions.PaymentRefund,
      entityType: "payment",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: {
        before: { status: before.status, ledgerEntryId: originalLedgerEntry.id },
        after: {
          status: "refunded",
          reversalEntryId: reversalEntry.id,
          revertsCount: revertResult.reverts.length,
          totalReverted: revertResult.totalReverted,
          unreverted: revertResult.unrevertedAmount,
        },
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

/** Adjust a parent's account (manual entry — appends an adjustment ledger entry). */
export async function adjustAccount(
  ctx: FinancialOpsCtx,
  parentId: string,
  amount: number,
  reason: string,
  approvedBy: string,
): Promise<Result<AccountAdjustment>> {
  const { store, appendAudit, nowIso, delay, tenantId } = ctx;
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

  // Also append an adjustment ledger entry so the parent's balance reflects
  // the credit/debit. The category is "other" by default — callers wanting
  // parent_credit semantics should use the dedicated overpayment flow inside
  // `collectPayment`.
  const adjustmentEntry: LedgerEntry = {
    id: `led-${nowIso()}-${Math.random().toString(36).slice(2, 10)}`,
    tenantId,
    accountId: deriveAccountId(parentId, "other", null),
    parentId,
    studentId: null,
    category: "other",
    amount, // signed: + for debit (penalty), - for credit (waiver)
    type: "adjustment",
    sourceType: "adjustment",
    sourceId: adj.id,
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: reason,
    actorId: approvedBy,
    actorName: "Session courante",
    at: nowIso(),
    metadata: Object.freeze({ reason, adjustmentId: adj.id }),
  };
  store.ledger = [...store.ledger, adjustmentEntry];
  store.notifyLedger();

  appendAudit({
    action: AuditActions.PaymentAdjust,
    entityType: "adjustment",
    entityId: adj.id,
    actorId: approvedBy,
    actorName: "Session courante",
    diff: { before: null, after: { amount, reason, ledgerEntryId: adjustmentEntry.id } },
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
