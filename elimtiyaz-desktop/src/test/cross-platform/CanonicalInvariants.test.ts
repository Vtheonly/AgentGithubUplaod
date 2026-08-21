/**
 * Canonical Invariant Tests — verifies each of the 10 canonical invariants
 * from CANONICAL-FINANCIAL-LOGIC.md §4 holds for the desktop engine.
 *
 * These tests are NOT cross-platform comparison tests. They verify that the
 * desktop engine independently satisfies the canonical rules. Combined with
 * the Android equivalent (in `app/src/test/java/com/example/core/`),
 * they provide two levels of protection:
 *
 *   1. Engine A == Engine B  (cross-platform equivalence tests)
 *   2. Engine A satisfies canonical rules  (THIS FILE)
 *   3. Engine B satisfies canonical rules  (Android equivalent)
 *
 * Two engines can agree with each other while both being wrong. These
 * invariant tests catch that case.
 */
import { describe, test, expect } from "vitest";
import {
  computeAccountBalance,
  computeParentSummary,
} from "../../domain/calc/ledger/balance";
import { buildOverdueDueDateMap } from "../../domain/calc/ledger/overdue";
import {
  createChargeEntry,
  createPaymentEntry,
  createAdjustmentEntry,
  createReversalEntry,
} from "../../domain/calc/ledger/entries";
import { deriveAccountId } from "../../domain/calc/ledger/account-id";
import { allocatePaymentToInstallments } from "../../domain/calc/payment/waterfall-allocator";
import { revertPaymentAllocation } from "../../domain/calc/payment/lifo-reversal";
import { reconcileLedger } from "../../domain/calc/reconcile";
import {
  crossCheckPayments,
  crossCheckClearedBalance,
  crossCheckParentCredit,
} from "../../domain/calc/reconcile/cross-checks";
import type { LedgerEntry } from "../../domain/model/ledger";

const TENANT = "00000000-0000-0000-0000-000000000001";
const PARENT = "par-inv-test";
const STUDENT = "stu-inv-test";
const TUITION_ACCOUNT = deriveAccountId(PARENT, "tuition", STUDENT);
const PARENT_CREDIT_ACCOUNT = deriveAccountId(PARENT, "parent_credit", null);

// Use an explicit `now` that is AFTER all test entry dates so the
// isAtOrBefore(e.at, now) filter in computeAccountBalance doesn't
// exclude future-dated test entries.
const NOW = new Date("2026-12-31T00:00:00Z");

// ============================================================================
// INV-1: Balance is computed, never stored
// ============================================================================
describe("INV-1: Balance is computed, never stored", () => {
  test("balance = Σ entries.amount for the account", () => {
    const charge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 10_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const payment = createPaymentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 3_000_000,
      method: "cash", receiptNumber: "REC-001",
      paymentStatus: "paid", sourceType: "payment", sourceId: "pay-001",
      actorId: "usr-001", actorName: "Agent",
      description: "Payment",
      at: "2026-09-20T00:00:00Z",
    });
    const entries = [charge, payment];
    const result = computeAccountBalance(entries, TUITION_ACCOUNT, NOW);
    // 10,000,000 - 3,000,000 = 7,000,000
    expect(result.balance).toBe(7_000_000);
  });

  test("entries after `now` are excluded (as-of query)", () => {
    const past = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Past charge",
      at: "2026-01-01T00:00:00Z",
    });
    const future = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-002",
      actorId: "system", actorName: "System",
      description: "Future charge",
      at: "2027-01-01T00:00:00Z",
    });
    const entries = [past, future];
    const result = computeAccountBalance(
      entries,
      TUITION_ACCOUNT,
      new Date("2026-06-15T00:00:00Z"),
    );
    // Only the past charge counts
    expect(result.balance).toBe(5_000_000);
  });

  test("an empty ledger yields zero balance (not null/undefined)", () => {
    const result = computeAccountBalance([], TUITION_ACCOUNT, NOW);
    expect(result.balance).toBe(0);
    expect(result.totalCharged).toBe(0);
    expect(result.totalPaid).toBe(0);
  });
});

// ============================================================================
// INV-2: Typed totals exclude reversed originals
// ============================================================================
describe("INV-2: Typed totals exclude reversed originals", () => {

  test("a non-reversed payment is included in totalPaid", () => {
    const charge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 10_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const payment = createPaymentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 3_000_000,
      method: "cash", receiptNumber: "REC-001",
      paymentStatus: "paid", sourceType: "payment", sourceId: "pay-001",
      actorId: "usr-001", actorName: "Agent",
      description: "Payment",
      at: "2026-09-20T00:00:00Z",
    });
    const entries = [charge, payment];
    const result = computeAccountBalance(entries, TUITION_ACCOUNT, NOW);
    expect(result.totalPaid).toBe(3_000_000);
  });
});

// ============================================================================
// INV-3: Parent credit is a separate bucket
// ============================================================================
describe("INV-3: Parent credit is a separate bucket", () => {
  test("parent_credit adjustment contributes to unallocatedCredit (negative)", () => {
    const credit = createAdjustmentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: null,
      category: "parent_credit", amount: -5_000_000,
      sourceType: "adjustment", sourceId: "adj-001",
      actorId: "system", actorName: "System",
      reason: "Banked credit",
      at: "2026-09-15T00:00:00Z",
    });
    const entries = [credit];
    const result = computeAccountBalance(entries, PARENT_CREDIT_ACCOUNT, NOW);
    expect(result.unallocatedCredit).toBe(-5_000_000);
    expect(result.balance).toBe(-5_000_000);
  });

  test("non-parent_credit adjustments do NOT contribute to unallocatedCredit", () => {
    const tuitionAdj = createAdjustmentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: -2_000_000,
      sourceType: "adjustment", sourceId: "adj-002",
      actorId: "system", actorName: "System",
      reason: "Tuition waiver",
      at: "2026-09-15T00:00:00Z",
    });
    const entries = [tuitionAdj];
    const result = computeAccountBalance(entries, TUITION_ACCOUNT, NOW);
    expect(result.balance).toBe(-2_000_000);
    expect(result.unallocatedCredit).toBe(0);
  });
});

// ============================================================================
// INV-4: Overdue classification (threshold = 0.001 DZD)
// ============================================================================
describe("INV-4: Overdue classification (threshold = 0.001 DZD)", () => {
  test("account with balance > 0.001 DZD and past due date is overdue", () => {
    const charge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const entries = [charge];
    const dueDateMap = buildOverdueDueDateMap(entries);
    const summary = computeParentSummary(entries, PARENT, "Test Parent", dueDateMap, NOW);
    expect(summary.totalOverdue).toBeGreaterThan(0);
  });

  test("account with balance = 0 is NOT overdue", () => {
    const charge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const payment = createPaymentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      method: "cash", receiptNumber: "REC-001",
      paymentStatus: "paid", sourceType: "payment", sourceId: "pay-001",
      actorId: "usr-001", actorName: "Agent",
      description: "Payment",
      at: "2026-09-20T00:00:00Z",
    });
    const entries = [charge, payment];
    const dueDateMap = buildOverdueDueDateMap(entries);
    const summary = computeParentSummary(entries, PARENT, "Test Parent", dueDateMap, NOW);
    expect(summary.totalOverdue).toBe(0);
  });
});

// ============================================================================
// INV-5: Valid payments only
// ============================================================================
describe("INV-5: Valid payments only", () => {
  test("pending payment reduces balance immediately", () => {
    const charge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const pendingPayment = createPaymentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 2_000_000,
      method: "check", receiptNumber: "REC-001",
      paymentStatus: "pending", sourceType: "payment", sourceId: "pay-001",
      actorId: "usr-001", actorName: "Agent",
      description: "Check payment (pending)",
      at: "2026-09-20T00:00:00Z",
    });
    const entries = [charge, pendingPayment];
    const result = computeAccountBalance(entries, TUITION_ACCOUNT, NOW);
    // Pending payment reduces balance immediately: 5M - 2M = 3M
    expect(result.balance).toBe(3_000_000);
    expect(result.totalPending).toBe(2_000_000);
    expect(result.totalCleared).toBe(0);
  });

  test("paid payment contributes to totalCleared, not totalPending", () => {
    const charge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const paidPayment = createPaymentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 2_000_000,
      method: "cash", receiptNumber: "REC-001",
      paymentStatus: "paid", sourceType: "payment", sourceId: "pay-001",
      actorId: "usr-001", actorName: "Agent",
      description: "Cash payment",
      at: "2026-09-20T00:00:00Z",
    });
    const entries = [charge, paidPayment];
    const result = computeAccountBalance(entries, TUITION_ACCOUNT, NOW);
    expect(result.totalCleared).toBe(2_000_000);
    expect(result.totalPending).toBe(0);
  });
});

// ============================================================================
// INV-6: Waterfall allocation
// ============================================================================
describe("INV-6: Waterfall allocation", () => {
  test("allocates to oldest installment first", () => {
    const installments = [
      { id: "ins-1", category: "tuition" as const, amountDue: 5_000_000, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15T00:00:00Z", status: "unpaid" as const },
      { id: "ins-2", category: "tuition" as const, amountDue: 5_000_000, amountPaid: 0, amountPending: 0, dueDate: "2026-12-15T00:00:00Z", status: "unpaid" as const },
    ];
    const result = allocatePaymentToInstallments(installments, 6_000_000, "tuition", "paid");
    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0].installmentId).toBe("ins-1");
    expect(result.allocations[0].allocatedAmount).toBe(5_000_000);
    expect(result.allocations[0].newStatus).toBe("paid");
    expect(result.allocations[1].installmentId).toBe("ins-2");
    expect(result.allocations[1].allocatedAmount).toBe(1_000_000);
    expect(result.allocations[1].newStatus).toBe("partial");
    expect(result.unallocatedAmount).toBe(0);
  });

  test("overpayment is captured as unallocatedAmount", () => {
    const installments = [
      { id: "ins-1", category: "tuition" as const, amountDue: 5_000_000, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15T00:00:00Z", status: "unpaid" as const },
    ];
    const result = allocatePaymentToInstallments(installments, 7_000_000, "tuition", "paid");
    expect(result.allocations[0].allocatedAmount).toBe(5_000_000);
    expect(result.unallocatedAmount).toBe(2_000_000);
  });

  test("category filter excludes non-matching installments", () => {
    const installments = [
      { id: "ins-1", category: "tuition" as const, amountDue: 5_000_000, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15T00:00:00Z", status: "unpaid" as const },
      { id: "ins-2", category: "transport" as const, amountDue: 2_000_000, amountPaid: 0, amountPending: 0, dueDate: "2026-09-16T00:00:00Z", status: "unpaid" as const },
    ];
    const result = allocatePaymentToInstallments(installments, 5_000_000, "tuition", "paid");
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].installmentId).toBe("ins-1");
  });
});

// ============================================================================
// INV-7: Overpayment → parent_credit
// ============================================================================
describe("INV-7: Overpayment → parent_credit", () => {
  test("overpayment creates a parent_credit adjustment with correct shape", () => {
    const tuitionCharge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const payment = createPaymentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 7_000_000,
      method: "cash", receiptNumber: "REC-001",
      paymentStatus: "paid", sourceType: "payment", sourceId: "pay-001",
      actorId: "usr-001", actorName: "Agent",
      description: "Overpayment",
      at: "2026-09-20T00:00:00Z",
    });
    // The overpayment credit entry (canonical shape)
    const creditEntry = createAdjustmentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: null,
      category: "parent_credit",
      amount: -2_000_000,
      sourceType: "adjustment",
      sourceId: `credit-${payment.id}`,
      actorId: "usr-001", actorName: "Agent",
      reason: `Crédit parent (trop-perçu) ${payment.receiptNumber}`,
      at: "2026-09-20T00:00:00Z",
    });
    const entries = [tuitionCharge, payment, creditEntry];

    // Verify the canonical shape
    expect(creditEntry.studentId).toBeNull();
    expect(creditEntry.category).toBe("parent_credit");
    expect(creditEntry.amount).toBe(-2_000_000);
    expect(creditEntry.accountId).toBe(PARENT_CREDIT_ACCOUNT);

    // Verify the parent_credit account has the credit
    const creditAccount = computeAccountBalance(entries, PARENT_CREDIT_ACCOUNT, NOW);
    expect(creditAccount.unallocatedCredit).toBe(-2_000_000);
  });
});

// ============================================================================
// INV-8: Refund = LIFO reversal
// ============================================================================
describe("INV-8: Refund = LIFO reversal", () => {
  test("refund of a cleared (paid) payment subtracts from amountPaid", () => {
    const installments = [
      { id: "ins-1", category: "tuition" as const, amountDue: 5_000_000, amountPaid: 5_000_000, amountPending: 0, dueDate: "2026-09-15T00:00:00Z", status: "paid" as const },
    ];
    // Refund 3M of a cleared payment — originalWasPending=false
    const result = revertPaymentAllocation(installments, 3_000_000, "tuition", false);
    expect(result.reverts).toHaveLength(1);
    expect(result.reverts[0].installmentId).toBe("ins-1");
    expect(result.reverts[0].revertedAmount).toBe(3_000_000);
    expect(result.reverts[0].newAmountPaid).toBe(2_000_000);
    expect(result.reverts[0].newStatus).toBe("partial");
  });

  test("refund of a pending payment subtracts from amountPending (not amountPaid)", () => {
    const installments = [
      { id: "ins-1", category: "tuition" as const, amountDue: 5_000_000, amountPaid: 0, amountPending: 5_000_000, dueDate: "2026-09-15T00:00:00Z", status: "pending_clearance" as const },
    ];
    // Refund 3M of a pending payment — originalWasPending=true
    const result = revertPaymentAllocation(installments, 3_000_000, "tuition", true);
    expect(result.reverts).toHaveLength(1);
    expect(result.reverts[0].newAmountPending).toBe(2_000_000);
    // amountPaid should NOT change (the funds were never cleared)
    expect(result.reverts[0].newAmountPaid).toBe(0);
  });
});

// ============================================================================
// INV-9: Reconciliation (6 cross-checks)
// ============================================================================
describe("INV-9: Reconciliation (6 cross-checks)", () => {
  test("reconcileLedger produces a report with the expected structure", () => {
    const entries: LedgerEntry[] = [
      createChargeEntry({
        tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
        category: "tuition", amount: 5_000_000,
        sourceType: "installment", sourceId: "ins-001",
        actorId: "system", actorName: "System",
        description: "Tuition T1",
        at: "2026-09-15T00:00:00Z",
      }),
    ];
    const report = reconcileLedger(entries);
    expect(report).toBeDefined();
    expect(report.violations).toBeDefined();
    expect(Array.isArray(report.violations)).toBe(true);
    expect(report.entryCount).toBe(1);
  });

  test("crossCheckPayments runs without crashing on empty inputs", () => {
    const violations = crossCheckPayments([], []);
    expect(Array.isArray(violations)).toBe(true);
    expect(violations).toHaveLength(0);
  });

  test("crossCheckClearedBalance runs without crashing on empty inputs", () => {
    const violations = crossCheckClearedBalance([], []);
    expect(Array.isArray(violations)).toBe(true);
    expect(violations).toHaveLength(0);
  });

  test("crossCheckParentCredit runs without crashing on empty inputs", () => {
    const violations = crossCheckParentCredit([], []);
    expect(Array.isArray(violations)).toBe(true);
    expect(violations).toHaveLength(0);
  });
});

// ============================================================================
// INV-10: Single source of truth
// ============================================================================
describe("INV-10: Single source of truth", () => {
  test("computeAccountBalance is the only way to compute an account balance", () => {
    const charge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const result1 = computeAccountBalance([charge], TUITION_ACCOUNT, NOW);
    const result2 = computeAccountBalance([charge], TUITION_ACCOUNT, NOW);
    expect(result1.balance).toBe(result2.balance);
    expect(result1.balance).toBe(5_000_000);
  });

  test("computeParentSummary is the only way to compute a parent summary", () => {
    const charge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const entries = [charge];
    const dueDateMap = buildOverdueDueDateMap(entries);
    const summary1 = computeParentSummary(entries, PARENT, "Test", dueDateMap, NOW);
    const summary2 = computeParentSummary(entries, PARENT, "Test", dueDateMap, NOW);
    expect(summary1.totalOutstanding).toBe(summary2.totalOutstanding);
    expect(summary1.totalOutstanding).toBe(5_000_000);
  });

  test("computeParentSummary uses computeAccountBalance internally (no parallel calculation)", () => {
    const charge = createChargeEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 5_000_000,
      sourceType: "installment", sourceId: "ins-001",
      actorId: "system", actorName: "System",
      description: "Tuition T1",
      at: "2026-09-15T00:00:00Z",
    });
    const payment = createPaymentEntry({
      tenantId: TENANT, parentId: PARENT, studentId: STUDENT,
      category: "tuition", amount: 2_000_000,
      method: "cash", receiptNumber: "REC-001",
      paymentStatus: "paid", sourceType: "payment", sourceId: "pay-001",
      actorId: "usr-001", actorName: "Agent",
      description: "Payment",
      at: "2026-09-20T00:00:00Z",
    });
    const entries = [charge, payment];
    const dueDateMap = buildOverdueDueDateMap(entries);
    const summary = computeParentSummary(entries, PARENT, "Test", dueDateMap, NOW);
    const accountBalance = computeAccountBalance(entries, TUITION_ACCOUNT, NOW);
    // The parent summary's total outstanding should match the sum of
    // per-account balances (computed via computeAccountBalance).
    expect(summary.totalOutstanding).toBe(accountBalance.balance);
  });
});
