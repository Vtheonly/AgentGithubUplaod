/**
 * Mock financial repositories — Payment, Installment, Debt, Expense.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including:
 *   - Iteration 5: ledger entry append on every payment (canonical source).
 *   - Iteration 6: ledger reversal entry on refund.
 *   - Iteration 6: "no self-approval" rule for expenses.
 *   - Iteration 6: expense state machine (submitted → approved/rejected → disbursed → settled).
 *   - Iteration 9: flexible installment schedules (custom due dates, cycle regeneration).
 *
 * Task 6-b: the four classes are now thin shells that delegate their
 * mutation methods to plain-function op modules under `./financial/`.
 * The shared `FinancialOpsCtx` bundle (store + appendAudit + nowIso +
 * delay + tenantId) is constructed once at module load and passed to
 * every op call. Observer methods (observe / observeByParent / etc.)
 * stay inline on the classes since they are one-liner filters over
 * the shared `store` singleton. The public API is unchanged.
 */
import type {
  PaymentRepository,
  InstallmentRepository,
  DebtRepository,
  ExpenseRepository,
  Observable,
  ImportInstallmentInput,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok } from "../../../core/result";
import { derived } from "../subject-behavior";
import type {
  Payment,
  Installment,
  AccountAdjustment,
  Receipt,
  CollectPaymentInput,
  ParentFinancialProfile,
  DebtSummary,
  AcademicCycle,
  UpdateInstallmentDueDateInput,
  PaymentCategory,
  PaymentAllocation,
} from "../../../domain/model/payment";
import type { AllocationResult } from "../../../domain/calc/payment/waterfall-allocator";
import type { Expense, SubmitExpenseInput, ExpenseStatus } from "../../../domain/model/expense";
import type { LedgerEntry } from "../../../domain/model/ledger";
import {
  store, TENANT_ID, appendAudit, nowIso, delay,
} from "./mock-store";
import { type FinancialOpsCtx } from "./financial/types";
import {
  collectPayment, refundPayment, adjustAccount, generateReceiptForPayment,
  markPaymentCleared, markPaymentBounced,
} from "./financial/payment-ops";
import {
  appendManualCharge,
  type AppendManualChargeInput,
  type AdditionalServiceQualifier,
} from "./financial/charge-ops";
import {
  markInstallmentPaid, updateInstallmentDueDate,
  regenerateInstallmentsForCycle, findOverdueInstallments,
  allocatePaymentAcrossInstallments,
} from "./financial/installment-ops";
import {
  observeDebtSummary, observeParentFinancialProfile, sendDebtReminder,
  broadcastDebtReminders, lockDelinquentAccounts,
} from "./financial/debt-ops";
import {
  submitExpense, approveExpense, rejectExpense, disburseExpense,
  settleProofExpense, transitionExpense,
} from "./financial/expense-ops";

/** Shared ctx bundle — constructed once, passed to every op call. */
const ctx: FinancialOpsCtx = {
  store,
  appendAudit,
  nowIso,
  delay,
  tenantId: TENANT_ID,
};

// ============================================================================
// Payments
// ============================================================================

export class MockPaymentRepository implements PaymentRepository {
  observe(): Observable<Payment[]> {
    return store.payments$;
  }
  observeByParent(parentId: string): Observable<Payment[]> {
    // FIX (reactivity): derive from the store stream so payment history in
    // drawers refreshes after collect/refund/adjust/import operations.
    return derived([store.payments$], () => store.payments.filter((p) => p.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Payment[]> {
    return derived([store.payments$], () => store.payments.filter((p) => p.studentId === studentId));
  }
  observeById(id: string): Observable<Payment | null> {
    return derived([store.payments$], () => store.payments.find((p) => p.id === id) ?? null);
  }
  /**
   * T-330 mock parity: the mock store has no payment_allocations table —
   * the mock derives the coverage lines from its OWN ledger stream with
   * the same receipt-number join the Supabase fallback uses (the mock
   * waterfall writes one payment ledger entry per allocation). Both modes
   * then agree: same payment → same coverage lines (DATA-013 lesson:
   * run BOTH modes against the same fixture when touching a repository
   * contract).
   */
  async allocationsForPayment(paymentId: string): Promise<Result<readonly PaymentAllocation[]>> {
    const payment = store.payments.find((p) => p.id === paymentId);
    if (!payment || !payment.receiptNumber) return Ok([]);
    const matching = store.ledger.filter(
      (e) => e.receiptNumber === payment.receiptNumber && e.type === "payment",
    );
    return Ok(
      matching.map((e) => ({
        id: `${paymentId}-${e.id}`,
        paymentId,
        chargeId: null,
        installmentId: null,
        category: e.category,
        allocatedAmount: Math.abs(e.amount),
        label: (e.metadata?.field as string | undefined) ?? null,
        createdAt: e.at,
      })),
    );
  }
  collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    return collectPayment(ctx, input, collectedBy);
  }
  /**
   * IMPORT-108 (mock parity with SupabasePaymentRepository.bulkCollect):
   * the Excel importer's payment flush. Contract mirrors the Supabase
   * implementation — INSERT payments rows ONLY:
   *   - NO ledger entries (the importer writes the canonical bulk_import
   *     ledger entries separately via bulkAppend — the generic collect()
   *     writes its own ledger entry, so the previous per-row fallback
   *     double-booked every imported payment in the ledger);
   *   - NO waterfall allocation (the importer's installments already carry
   *     amountPaid from the workbook — collect()'s allocator would add the
   *     amount a SECOND time);
   *   - the DETERMINISTIC receiptNumber is honoured when present (IMP-…
   *     from the importer — the idempotency key; collect() ignores it and
   *     auto-generates REC-…, which made re-imports duplicate payments);
   *   - idempotent: rows whose receiptNumber already exists are returned
   *     as-is (the store's (tenant, payment_number) uniqueness analogue).
   */
  async bulkCollect(
    inputs: ReadonlyArray<{ input: CollectPaymentInput; collectedBy: string }>,
  ): Promise<Result<readonly Payment[]>> {
    const inserted: Payment[] = [];
    for (const { input, collectedBy } of inputs) {
      const receiptNumber = input.receiptNumber ?? `REC-${new Date().getFullYear()}-${String(store.payments.length + 1).padStart(6, "0")}`;
      const existing = store.payments.find((p) => p.receiptNumber === receiptNumber);
      if (existing) {
        inserted.push(existing);
        continue;
      }
      const seq = store.payments.length + 1;
      const status = input.method === "cash" ? "paid" : "pending";
      const now = nowIso();
      const payment: Payment = {
        // Globally-unique id (the plain `pay-003` sequence collides after
        // deletions — see collect()'s note): random suffix.
        id: `pay-${String(seq).padStart(3, "0")}-${Math.random().toString(36).slice(2, 8)}`,
        tenantId: TENANT_ID,
        receiptNumber,
        parentId: input.parentId,
        studentId: input.studentId,
        amount: input.amount,
        method: input.method,
        status,
        category: input.category,
        installmentId: input.installmentId,
        proofUrl: input.proofUrl ?? null,
        notes: input.notes ?? null,
        checkNumber: input.checkNumber?.trim() || null,
        checkBankName: input.checkBankName?.trim() || null,
        checkIssueDate: input.checkIssueDate || null,
        checkClearanceDate: input.checkClearanceDate || null,
        transferReference: input.transferReference?.trim() || null,
        transferSourceBank: input.transferSourceBank?.trim() || null,
        collectedBy,
        collectedAt: input.collectedAt ?? now,
        createdAt: now,
        updatedAt: now,
      };
      store.payments.unshift(payment);
      inserted.push(payment);
    }
    if (inserted.length > 0) {
      store.notifyPayments();
      appendAudit({
        action: "payment.bulk_import",
        entityType: "payment",
        entityId: inserted[0].id,
        actorId: inputs[0]?.collectedBy ?? "excel-import",
        actorName: "Excel Import",
        diff: { before: null, after: { count: inserted.length } },
        note: `Import Excel — ${inserted.length} paiement(s) en lot`,
      });
    }
    return Ok(inserted);
  }
  refund(id: string, reason: string, actorId?: string, actorName?: string): Promise<Result<Payment>> {
    return refundPayment(ctx, id, reason, actorId, actorName);
  }
  markCleared(id: string, actorId: string, actorName?: string): Promise<Result<Payment>> {
    return markPaymentCleared(ctx, id, actorId, actorName);
  }
  markBounced(id: string, reason: string, actorId: string, actorName?: string): Promise<Result<Payment>> {
    return markPaymentBounced(ctx, id, reason, actorId, actorName);
  }
  adjust(
    parentId: string,
    amount: number,
    reason: string,
    approvedBy: string,
    options?: {
      category?: PaymentCategory;
      studentId?: string | null;
    },
  ): Promise<Result<AccountAdjustment>> {
    return adjustAccount(ctx, parentId, amount, reason, approvedBy, options);
  }
  generateReceipt(paymentId: string, generatedBy: string): Promise<Result<Receipt>> {
    return generateReceiptForPayment(ctx, paymentId, generatedBy);
  }
  /**
   * Append an à-la-carte charge for an additional service (canteen, uniform,
   * books, 2nd apron). Used by the UnifiedPaymentModal `single_item` mode and
   * the parent drawer's "Sell service" action.
   */
  appendManualCharge(
    input: AppendManualChargeInput,
    actorId: string,
  ): Promise<Result<LedgerEntry>> {
    return appendManualCharge(ctx, input, actorId);
  }
}

// ============================================================================
// Installments (with iteration 9 flexible schedule support)
// ============================================================================

export class MockInstallmentRepository implements InstallmentRepository {
  observe(): Observable<Installment[]> {
    return store.installments$;
  }
  observeByParent(parentId: string): Observable<Installment[]> {
    // FIX (reactivity): derive from the store stream.
    return derived([store.installments$], () => store.installments.filter((i) => i.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Installment[]> {
    return derived([store.installments$], () => store.installments.filter((i) => i.studentId === studentId));
  }
  observeById(id: string): Observable<Installment | null> {
    return derived([store.installments$], () => store.installments.find((i) => i.id === id) ?? null);
  }
  markPaid(id: string, paymentId: string): Promise<Result<Installment>> {
    return markInstallmentPaid(ctx, id, paymentId);
  }
  allocatePayment(
    parentId: string,
    paymentAmount: number,
    paymentId: string,
    categoryFilter?: PaymentCategory,
    actorId?: string,
    actorName?: string,
  ): Promise<Result<AllocationResult>> {
    return allocatePaymentAcrossInstallments(
      ctx,
      parentId,
      paymentAmount,
      paymentId,
      categoryFilter,
      actorId,
      actorName,
    );
  }
  updateDueDate(input: UpdateInstallmentDueDateInput): Promise<Result<Installment>> {
    return updateInstallmentDueDate(ctx, input);
  }
  regenerateForCycle(parentId: string, cycle: AcademicCycle, actorId: string, actorName: string): Promise<Result<readonly Installment[]>> {
    return regenerateInstallmentsForCycle(ctx, parentId, cycle, actorId, actorName);
  }
  findOverdue(now: Date = new Date()): Promise<Result<readonly Installment[]>> {
    return findOverdueInstallments(ctx, now);
  }
  /**
   * Bulk-import an installment row idempotently. Used by the Excel importer
   * to create one installment per tuition tranche (Sept 15 / Dec 15 / Mar 15)
   * and per transport tranche, marking them paid/partial/unpaid according
   * to the imported amounts. Re-imports update the same row in place.
   *
   * Identity: `(tenant, parentId, studentId, category, trancheNumber)`.
   * The mock store uses a deterministic id derived from these fields so
   * re-imports hit the same record.
   */
  async importInstallment(input: ImportInstallmentInput): Promise<Result<Installment>> {
    await delay(120);
    const id = `imp-${input.parentId}-${input.studentId}-${input.category}-${input.trancheNumber}`;
    const existingIdx = store.installments.findIndex((i) => i.id === id);
    const installment: Installment = {
      id,
      parentId: input.parentId,
      studentId: input.studentId,
      category: input.category,
      label: input.label,
      amountDue: input.amountDue,
      amountPaid: input.amountPaid,
      amountPending: 0,
      dueDate: input.dueDate,
      paidDate: input.paidDate,
      status: input.status,
      academicCycle: input.academicCycle,
      paymentPlan: input.paymentPlan ?? "tranches",
      isCustomSchedule: false,
      customScheduleNote: null,
    };
    if (existingIdx >= 0) {
      store.installments[existingIdx] = installment;
    } else {
      store.installments.push(installment);
    }
    store.notifyInstallments();
    appendAudit({
      action: "installment.import_from_bulk",
      entityType: "installment",
      entityId: id,
      actorId: input.actorId ?? "excel-import",
      actorName: input.actorName ?? "Excel Import",
      diff: {
        before: existingIdx >= 0 ? "updated" : null,
        after: { category: input.category, trancheNumber: input.trancheNumber, amountDue: input.amountDue, amountPaid: input.amountPaid, status: input.status },
      },
      note: `Tranche ${input.trancheNumber} (${input.label}) — import Excel`,
    });
    return Ok(installment);
  }
}

// ============================================================================
// Debt (computed from ledger replay — iteration 5)
// ============================================================================

export class MockDebtRepository implements DebtRepository {
  observeSummary(): Observable<DebtSummary[]> {
    return observeDebtSummary(ctx);
  }
  observeParentProfile(parentId: string): Observable<ParentFinancialProfile | null> {
    return observeParentFinancialProfile(ctx, parentId);
  }
  sendReminder(parentId: string): Promise<Result<void>> {
    return sendDebtReminder(ctx, parentId);
  }
  broadcastReminders(minDaysOverdue?: number, actorId?: string): Promise<Result<number>> {
    return broadcastDebtReminders(ctx, minDaysOverdue ?? 0, actorId ?? "usr-current");
  }
  lockDelinquentAccounts(minDaysOverdue?: number, actorId?: string): Promise<Result<number>> {
    return lockDelinquentAccounts(ctx, minDaysOverdue ?? 90, actorId ?? "usr-current");
  }
}

// ============================================================================
// Expenses (with iteration 6 state machine + self-approval rule)
// ============================================================================

export class MockExpenseRepository implements ExpenseRepository {
  observe(): Observable<Expense[]> {
    return store.expenses$;
  }
  observeByStatus(status: string): Observable<Expense[]> {
    return derived([store.expenses$], () => store.expenses.filter((e) => e.status === status));
  }
  observeById(id: string): Observable<Expense | null> {
    return derived([store.expenses$], () => store.expenses.find((e) => e.id === id) ?? null);
  }
  submit(input: SubmitExpenseInput, submittedBy: string): Promise<Result<Expense>> {
    return submitExpense(ctx, input, submittedBy);
  }
  approve(id: string, approver: string, note?: string): Promise<Result<Expense>> {
    return approveExpense(ctx, id, approver, note);
  }
  reject(id: string, approver: string, note: string): Promise<Result<Expense>> {
    return rejectExpense(ctx, id, approver, note);
  }
  disburse(id: string, disbursedBy: string): Promise<Result<Expense>> {
    return disburseExpense(ctx, id, disbursedBy);
  }
  settleProof(id: string, proofUrl: string, uploadedBy: string): Promise<Result<Expense>> {
    return settleProofExpense(ctx, id, proofUrl, uploadedBy);
  }
  /**
   * Iteration 6: shared state-machine transition. Kept as a private method
   * on the class for backwards-compat with any subclass that overrides it,
   * but the implementation delegates to `transitionExpense(ctx, ...)`.
   */
  private transition(id: string, status: ExpenseStatus, patches: Partial<Expense>, action: string, actorId: string): Promise<Result<Expense>> {
    return transitionExpense(ctx, id, status, patches, action, actorId);
  }
}

// ============================================================================
// Singletons — exported for the barrel re-export in `mock-repositories.ts`.
// ============================================================================

export const mockPaymentRepository: PaymentRepository = new MockPaymentRepository();
export const mockInstallmentRepository: InstallmentRepository = new MockInstallmentRepository();
export const mockDebtRepository: DebtRepository = new MockDebtRepository();
export const mockExpenseRepository: ExpenseRepository = new MockExpenseRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
