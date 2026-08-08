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
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { SubjectBehavior } from "../subject-behavior";
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
} from "../../../domain/model/payment";
import type { AllocationResult } from "../../../domain/calc/payment/installments";
import type { Expense, SubmitExpenseInput, ExpenseStatus } from "../../../domain/model/expense";
import type { LedgerEntry } from "../../../domain/model/ledger";
import {
  store, TENANT_ID, appendAudit, nowIso, delay,
} from "./mock-store";
import { type FinancialOpsCtx } from "./financial/types";
import {
  collectPayment, refundPayment, adjustAccount, generateReceiptForPayment,
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
    return new SubjectBehavior(store.payments.filter((p) => p.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Payment[]> {
    return new SubjectBehavior(store.payments.filter((p) => p.studentId === studentId));
  }
  observeById(id: string): Observable<Payment | null> {
    return new SubjectBehavior(store.payments.find((p) => p.id === id) ?? null);
  }
  collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    return collectPayment(ctx, input, collectedBy);
  }
  refund(id: string): Promise<Result<Payment>> {
    return refundPayment(ctx, id);
  }
  adjust(parentId: string, amount: number, reason: string, approvedBy: string): Promise<Result<AccountAdjustment>> {
    return adjustAccount(ctx, parentId, amount, reason, approvedBy);
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
  observeByParent(parentId: string): Observable<Installment[]> {
    return new SubjectBehavior(store.installments.filter((i) => i.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Installment[]> {
    return new SubjectBehavior(store.installments.filter((i) => i.studentId === studentId));
  }
  observeById(id: string): Observable<Installment | null> {
    return new SubjectBehavior<Installment | null>(store.installments.find((i) => i.id === id) ?? null);
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
}

// ============================================================================
// Expenses (with iteration 6 state machine + self-approval rule)
// ============================================================================

export class MockExpenseRepository implements ExpenseRepository {
  observe(): Observable<Expense[]> {
    return store.expenses$;
  }
  observeByStatus(status: string): Observable<Expense[]> {
    return new SubjectBehavior(store.expenses.filter((e) => e.status === status));
  }
  observeById(id: string): Observable<Expense | null> {
    return new SubjectBehavior(store.expenses.find((e) => e.id === id) ?? null);
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
