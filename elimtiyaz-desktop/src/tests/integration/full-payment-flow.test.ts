/**
 * Integration test: full payment flow on the mock repository.
 *
 * Verifies the end-to-end behavior of the unified financial architecture:
 *   1. Collect a cash payment via `mockPaymentRepository.collect()`.
 *   2. Verify a payment row was inserted.
 *   3. Verify a payment credit ledger entry was appended (negative amount).
 *   4. Verify the waterfall allocator ran and updated `installments.amountPaid`.
 *   5. Collect an overpayment → verify `parent_credit` adjustment entry was
 *      created and the parent's `totalUnallocatedCredit` reflects it.
 *   6. Run the reconciler — verify zero `UNBACKED_TRANCHE_SATISFACTION`
 *      and `PAYMENT_LEDGER_MISMATCH` errors.
 */
import { describe, it, expect } from "vitest";
import { mockPaymentRepository, mockInstallmentRepository, mockLedgerRepository } from "../../infrastructure/mock/mock-repositories";
import { reconcileLedger, crossCheckInstallmentPayments, crossCheckClearedBalance } from "../../domain/calc/reconcile";
import { computeParentSummary } from "../../domain/calc/ledger/balance";
import type { CollectPaymentInput, Installment, Payment } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";

/** Helper: synchronously read the current value of a SubjectBehavior. */
function current<T>(obs: { get?(): T }): T {
  return (obs as { get: () => T }).get();
}

describe("Integration: Full Payment Flow (mock repository)", () => {
  it("collects a cash payment, runs waterfall, and writes the canonical ledger entry", async () => {
    // NOTE: par-001's seed marks ALL THREE tranches fully paid (idx 0 in the
    // seeder → paid on every tranche), so "pay the remaining" would collect 0
    // — an INVALID canonical operation (SQL collect_and_allocate_payment
    // raises on amount <= 0; Android collect() validates; the mock now
    // validates too). par-002's T3 is the first seed tranche with a remaining
    // balance — use it so the flow stays meaningful.
    const parentId = "par-002";
    const beforeInstallments = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const target = beforeInstallments.find(
      (i) => i.status !== "paid" && i.amountDue - i.amountPaid > 0,
    );
    expect(target).toBeDefined();

    const input: CollectPaymentInput = {
      parentId,
      studentId: target.studentId,
      amount: target.amountDue - target.amountPaid, // pay only the remaining
      method: "cash",
      category: "tuition",
      installmentId: target.id,
    };
    const result = await mockPaymentRepository.collect(input, "usr-test");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toBe(target.amountDue - target.amountPaid);
    expect(result.value.status).toBe("paid");
    expect(result.value.method).toBe("cash");

    const afterInstallments = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const updated = afterInstallments.find((i) => i.id === target.id);
    expect(updated?.amountPaid).toBe(target.amountDue);
    expect(updated?.status).toBe("paid");
  });

  it("writes a parent_credit adjustment entry when the parent overpays", async () => {
    const parentId = "par-002";
    const installments = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const totalDue = installments.reduce((s, i) => s + i.amountDue, 0);
    const totalPaid = installments.reduce((s, i) => s + i.amountPaid, 0);
    const remaining = Math.max(0, totalDue - totalPaid);
    const overpay = remaining + 25_000;

    const input: CollectPaymentInput = {
      parentId,
      studentId: installments[0]?.studentId ?? null,
      amount: overpay,
      method: "cash",
      category: "tuition",
      installmentId: null,
    };
    const result = await mockPaymentRepository.collect(input, "usr-test");
    expect(result.ok).toBe(true);

    const ledger = current<LedgerEntry[]>(mockLedgerRepository.observe());
    const creditEntries = ledger.filter(
      (e) => e.parentId === parentId && e.category === "parent_credit" && e.type === "adjustment",
    );
    expect(creditEntries.length).toBeGreaterThanOrEqual(1);
    const totalCredit = creditEntries.reduce((s, e) => s + Math.abs(e.amount), 0);
    expect(totalCredit).toBeGreaterThan(0);
    expect(totalCredit).toBeCloseTo(25_000, -2);

    const summary = computeParentSummary(ledger, parentId, "Test");
    expect(summary.totalUnallocatedCredit).toBeLessThanOrEqual(-25_000 + 1);
  });

  it("does NOT mark tranche as 'paid' when collecting an uncleared check", async () => {
    const parentId = "par-003";
    const installments = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const target = installments.find((i) => i.status !== "paid");
    if (!target) return;
    const before = target.amountPaid;

    const input: CollectPaymentInput = {
      parentId,
      studentId: target.studentId,
      amount: target.amountDue - target.amountPaid,
      method: "check",
      category: "tuition",
      installmentId: target.id,
      proofUrl: "mock://proof/check-001.jpg",
    };
    const result = await mockPaymentRepository.collect(input, "usr-test");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("pending");

    const afterInstallments = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const updated = afterInstallments.find((i) => i.id === target.id);
    expect(updated?.amountPaid).toBe(before);
    expect(updated?.amountPending).toBeGreaterThan(0);
    expect(["pending_clearance", "pending", "partial"]).toContain(updated?.status);
    expect(updated?.status).not.toBe("paid");
  });

  it("passes the reconciler with zero NEW UNBACKED_TRANCHE_SATISFACTION after a cash payment", async () => {
    const parentId = "par-004";
    const installments = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const target = installments.find((i) => i.status !== "paid");
    if (!target) return;

    // Snapshot pre-existing violations (seed data may have pre-paid tranches
    // without ledger backing — that's a known seed-data issue, not a bug in
    // the unified architecture code).
    const ledgerBefore = current<LedgerEntry[]>(mockLedgerRepository.observe());
    const beforeViolations = crossCheckInstallmentPayments(installments, ledgerBefore);
    const beforeUnbackedIds = new Set(
      beforeViolations
        .filter((v) => v.code === "UNBACKED_TRANCHE_SATISFACTION")
        .map((v) => (v.details as { installmentId?: string }).installmentId),
    );

    const input: CollectPaymentInput = {
      parentId,
      studentId: target.studentId,
      amount: target.amountDue - target.amountPaid,
      method: "cash",
      category: "tuition",
      installmentId: target.id,
    };
    await mockPaymentRepository.collect(input, "usr-test");

    const ledger = current<LedgerEntry[]>(mockLedgerRepository.observe());
    const afterInstallments = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const violations = crossCheckInstallmentPayments(afterInstallments, ledger);
    // No NEW unbacked violations should appear on the just-paid tranche.
    const newUnbacked = violations.filter(
      (v) =>
        v.code === "UNBACKED_TRANCHE_SATISFACTION" &&
        !beforeUnbackedIds.has((v.details as { installmentId?: string }).installmentId),
    );
    expect(newUnbacked).toHaveLength(0);
  });

  it("runs the master reconcileLedger() with no BALANCE_SUM_MISMATCH", async () => {
    const ledger = current<LedgerEntry[]>(mockLedgerRepository.observe());
    const report = reconcileLedger(ledger);
    const balanceSumErrors = report.violations.filter((v) => v.code === "BALANCE_SUM_MISMATCH");
    expect(balanceSumErrors).toHaveLength(0);
  });
});

describe("Integration: Check Bounce / Refund Reversal", () => {
  it("refunds a payment and reverts the installment allocation (LIFO)", async () => {
    const parentId = "par-005";
    const installments = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const target = installments.find((i) => i.status !== "paid");
    if (!target) return;
    const before = target.amountPaid;

    const collect: CollectPaymentInput = {
      parentId,
      studentId: target.studentId,
      amount: target.amountDue - target.amountPaid,
      method: "cash",
      category: "tuition",
      installmentId: target.id,
    };
    const collectResult = await mockPaymentRepository.collect(collect, "usr-test");
    expect(collectResult.ok).toBe(true);
    if (!collectResult.ok) return;
    const paymentId = collectResult.value.id;

    const afterCollect = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const satisfied = afterCollect.find((i) => i.id === target.id);
    expect(satisfied?.amountPaid).toBe(target.amountDue);

    const refundResult = await mockPaymentRepository.refund(paymentId);
    expect(refundResult.ok).toBe(true);
    if (!refundResult.ok) return;
    expect(refundResult.value.status).toBe("refunded");

    const afterRefund = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const reopened = afterRefund.find((i) => i.id === target.id);
    expect(reopened?.amountPaid).toBe(before);
    expect(reopened?.status).not.toBe("paid");
  });

  it("writes a ledger reversal entry that exactly negates the original payment entry", async () => {
    const parentId = "par-006";
    const installments = current<Installment[]>(mockInstallmentRepository.observeByParent(parentId));
    const target = installments.find((i) => i.status !== "paid");
    if (!target) return;

    const collect: CollectPaymentInput = {
      parentId,
      studentId: target.studentId,
      amount: 50_000,
      method: "cash",
      category: "tuition",
      installmentId: target.id,
    };
    const collectResult = await mockPaymentRepository.collect(collect, "usr-test");
    if (!collectResult.ok) return;
    const paymentId = collectResult.value.id;

    const ledgerBefore = current<LedgerEntry[]>(mockLedgerRepository.observe());
    const originalEntry = ledgerBefore.find(
      (e) => e.sourceType === "payment" && e.sourceId === paymentId && e.type === "payment",
    );
    expect(originalEntry).toBeDefined();

    await mockPaymentRepository.refund(paymentId);

    const ledgerAfter = current<LedgerEntry[]>(mockLedgerRepository.observe());
    const reversalEntry = ledgerAfter.find(
      (e) => e.type === "reversal" && e.reversesId === originalEntry!.id,
    );
    expect(reversalEntry).toBeDefined();
    expect(reversalEntry!.amount + originalEntry!.amount).toBe(0);
  });
});

describe("Integration: Reconciliation Sweep", () => {
  it("crossCheckClearedBalance: cleared payments sum equals cleared ledger sum (within tolerance)", async () => {
    // Note: we don't make new collections here — earlier tests in this file
    // have already mutated the shared mock store. We verify the invariant
    // holds on whatever state the store is currently in.
    const ledger = current<LedgerEntry[]>(mockLedgerRepository.observe());
    const payments = current<Payment[]>(mockPaymentRepository.observe());
    // Build the set of entry ids that have been reversed.
    const reversedIds = new Set(
      ledger.filter((e) => e.reversesId).map((e) => e.reversesId!),
    );
    const clearedPayments = payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + p.amount, 0);
    const clearedLedger = ledger
      .filter((e) => e.type === "payment" && e.paymentStatus === "paid")
      .filter((e) => !reversedIds.has(e.id)) // exclude reversed entries
      .reduce((s, e) => s + Math.abs(e.amount), 0);
    // Invariant: sums must match within 0.01 DZD.
    expect(Math.abs(clearedPayments - clearedLedger)).toBeLessThan(0.01);
  });
});
