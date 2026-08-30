/**
 * Regression tests for T-016 — Complete the reconciler (wire the two missing
 * cross-checks: `crossCheckBalanceSum` + `crossCheckParentCredit`).
 *
 * Before T-016: `reconcileFinancials()` ran only 4 of the 6 cross-checks;
 * `crossCheckBalanceSum` and `crossCheckParentCredit` existed but were
 * never called by the orchestrator. The two corresponding invariants
 * (`BALANCE_SUM_MISMATCH`, `UNBACKED_PARENT_CREDIT`) were therefore
 * invisible to any caller that used `reconcileFinancials()` directly
 * (which is the public entry point — repositories, scheduled sweeps, the
 * reconciliation UI all use it).
 *
 * After T-016: both invariants fire from `reconcileFinancials()`. Inputs
 * are derived from the ledger itself via the canonical balance helpers
 * (`computeAccountBalance` / `computeParentSummary`) so no context
 * extension is needed.
 */
import { describe, it, expect } from "vitest";
import { reconcileFinancials } from "@/domain/calc/reconcile/reconciliation";
import { createChargeEntry, createPaymentEntry, createAdjustmentEntry } from "@/domain/model/ledger";
import type { LedgerEntry } from "@/domain/model/ledger";
import type { Payment, Installment } from "@/domain/model/payment";

function makeCtx(ledger: LedgerEntry[], payments: Payment[] = [], installments: Installment[] = []) {
  return { ledger, payments, installments };
}

describe("T-016 — reconcileFinancials wires crossCheckBalanceSum + crossCheckParentCredit", () => {
  it("clean ledger passes (sanity)", () => {
    const ledger: LedgerEntry[] = [
      createChargeEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 100_000, sourceType: "installment", sourceId: "ins-1",
        description: "Tranche 1", actorId: "u1", actorName: "Test",
      }),
      createPaymentEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 100_000, method: "cash", receiptNumber: "REC-1",
        paymentStatus: "paid", sourceType: "payment", sourceId: "pay-1",
        description: "Payment", actorId: "u1", actorName: "Test",
      }),
    ];
    const payments: Payment[] = [{
      id: "pay-1", tenantId: "t1", receiptNumber: "REC-1", parentId: "par-1",
      studentId: "stu-1", amount: 100_000, method: "cash", status: "paid",
      category: "tuition", installmentId: "ins-1", proofUrl: null, notes: null,
      collectedBy: "u1", collectedAt: "2025-09-15T10:00:00Z",
      createdAt: "2025-09-15T10:00:00Z", updatedAt: "2025-09-15T10:00:00Z",
    }];
    const installments: Installment[] = [{
      id: "ins-1", parentId: "par-1", studentId: "stu-1", category: "tuition",
      label: "Tranche 1", amountDue: 100_000, amountPaid: 100_000, amountPending: 0,
      dueDate: "2025-09-15", paidDate: "2025-09-15", status: "paid",
      academicCycle: "primaire", paymentPlan: "tranches", isCustomSchedule: false,
      customSchedule: false, customScheduleNote: null,
    }];
    const report = reconcileFinancials(makeCtx(ledger, payments, installments));
    expect(report.passed).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it("BALANCE_SUM_MISMATCH fires when entries sum diverges from account-balance sum", () => {
    // Build a clean ledger whose derived account-balance sum equals the entry sum.
    // Then inject a ghost credit entry that has NO matching account in the
    // derived balances set — i.e. a bogus entry whose accountId is unique to
    // the ghost — so the entry sum diverges from the Σ account balances.
    //
    // Concretely: parent p1, account A1 has +100 (charge) -100 (payment) = 0.
    // Add a second "ghost" payment of -50 on account A_GHOST (parent p1).
    // The derived account-balance set will compute A1=0 and A_GHOST=-50,
    // sums will match (entries sum = -50, balances sum = -50). To force a
    // MISMATCH, instead inject an entry whose amount is +1 but whose
    // accountId collides with a real account so the balance sums skip the
    // ghost. The simplest reliable way is to inject a +1 charge on a brand
    // new account and then DELETE that account from the derived set
    // (impossible without monkey-patching). So instead: feed a hand-built
    // ledger that sums to X but where one entry's accountId is empty/missing
    // — the canonical `computeAccountBalance` will then produce a 0-balance
    // account that, summed with the real one, diverges from the entries sum.
    //
    // Simpler & reliable: forge a ledger where Σ entries ≠ Σ balances by
    // relying on the `isAtOrBefore` filter — add a future-dated charge that
    // is excluded from the balance computation but still in the entries sum.
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const ledger: LedgerEntry[] = [
      // Real account A1: +100 charge (today), -100 payment (today) → balance 0
      createChargeEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 100_000, sourceType: "installment", sourceId: "ins-1",
        description: "Tranche", actorId: "u1", actorName: "Test",
      }),
      createPaymentEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 100_000, method: "cash", receiptNumber: "REC-1",
        paymentStatus: "paid", sourceType: "payment", sourceId: "pay-1",
        description: "Payment", actorId: "u1", actorName: "Test",
      }),
      // Future-dated charge on A1 — included in Σ entries but excluded from
      // the as-of-now balance of A1 by `isAtOrBefore`.
      {
        ...createChargeEntry({
          tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
          amount: 50_000, sourceType: "installment", sourceId: "ins-future",
          description: "Future", actorId: "u1", actorName: "Test",
        }),
        at: future,
      },
    ];
    const payments: Payment[] = [{
      id: "pay-1", tenantId: "t1", receiptNumber: "REC-1", parentId: "par-1",
      studentId: "stu-1", amount: 100_000, method: "cash", status: "paid",
      category: "tuition", installmentId: "ins-1", proofUrl: null, notes: null,
      collectedBy: "u1", collectedAt: "2025-09-15T10:00:00Z",
      createdAt: "2025-09-15T10:00:00Z", updatedAt: "2025-09-15T10:00:00Z",
    }];
    const installments: Installment[] = [{
      id: "ins-1", parentId: "par-1", studentId: "stu-1", category: "tuition",
      label: "Tranche", amountDue: 100_000, amountPaid: 100_000, amountPending: 0,
      dueDate: "2025-09-15", paidDate: "2025-09-15", status: "paid",
      academicCycle: "primaire", paymentPlan: "tranches", isCustomSchedule: false,
      customSchedule: false, customScheduleNote: null,
    }];
    const report = reconcileFinancials(makeCtx(ledger, payments, installments));
    const mismatch = report.violations.find((v) => v.code === "BALANCE_SUM_MISMATCH");
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe("error");
  });

  it("UNBACKED_PARENT_CREDIT fires when parent has negative balance but no parent_credit adjustment", () => {
    // Overpayment of 30k on a 100k charge → account balance -30k → parent
    // totalOutstanding -30k. No parent_credit adjustment entry exists →
    // `crossCheckParentCredit` must emit UNBACKED_PARENT_CREDIT.
    const ledger: LedgerEntry[] = [
      createChargeEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 100_000, sourceType: "installment", sourceId: "ins-1",
        description: "Tranche", actorId: "u1", actorName: "Test",
      }),
      createPaymentEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 130_000, method: "cash", receiptNumber: "REC-1",
        paymentStatus: "paid", sourceType: "payment", sourceId: "pay-1",
        description: "Overpayment", actorId: "u1", actorName: "Test",
      }),
    ];
    const payments: Payment[] = [{
      id: "pay-1", tenantId: "t1", receiptNumber: "REC-1", parentId: "par-1",
      studentId: "stu-1", amount: 130_000, method: "cash", status: "paid",
      category: "tuition", installmentId: "ins-1", proofUrl: null, notes: null,
      collectedBy: "u1", collectedAt: "2025-09-15T10:00:00Z",
      createdAt: "2025-09-15T10:00:00Z", updatedAt: "2025-09-15T10:00:00Z",
    }];
    const installments: Installment[] = [{
      id: "ins-1", parentId: "par-1", studentId: "stu-1", category: "tuition",
      label: "Tranche", amountDue: 100_000, amountPaid: 130_000, amountPending: -30_000,
      dueDate: "2025-09-15", paidDate: "2025-09-15", status: "paid",
      academicCycle: "primaire", paymentPlan: "tranches", isCustomSchedule: false,
      customSchedule: false, customScheduleNote: null,
    }];
    const report = reconcileFinancials(makeCtx(ledger, payments, installments));
    const unbacked = report.violations.find((v) => v.code === "UNBACKED_PARENT_CREDIT");
    expect(unbacked).toBeDefined();
  });

  it("UNBACKED_PARENT_CREDIT does NOT fire for a negative-balance parent_credit account (the canonical pattern)", () => {
    // A parent_credit account with a -30k credit balance is the canonical
    // way to model an overpayment — the per-account check explicitly skips
    // the `parent_credit` category, and the parent-level check is satisfied
    // by the existence of the parent_credit adjustment entry. So no
    // UNBACKED_PARENT_CREDIT violation fires for this case.
    const ledger: LedgerEntry[] = [
      createChargeEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 100_000, sourceType: "installment", sourceId: "ins-1",
        description: "Tranche", actorId: "u1", actorName: "Test",
      }),
      createPaymentEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 100_000, method: "cash", receiptNumber: "REC-1",
        paymentStatus: "paid", sourceType: "payment", sourceId: "pay-1",
        description: "Payment", actorId: "u1", actorName: "Test",
      }),
      // Standalone parent_credit adjustment on its own account — this is
      // the canonical "carry-forward credit" pattern. The per-account
      // check skips the `parent_credit` category so this negative balance
      // does NOT trigger UNBACKED_PARENT_CREDIT.
      createAdjustmentEntry({
        tenantId: "t1", parentId: "par-1", studentId: null, category: "parent_credit",
        amount: -30_000, sourceType: "manual_entry", sourceId: "adj-1",
        reason: "Carry-forward credit from prior overpayment", actorId: "u1", actorName: "Test",
      }),
    ];
    const payments: Payment[] = [{
      id: "pay-1", tenantId: "t1", receiptNumber: "REC-1", parentId: "par-1",
      studentId: "stu-1", amount: 100_000, method: "cash", status: "paid",
      category: "tuition", installmentId: "ins-1", proofUrl: null, notes: null,
      collectedBy: "u1", collectedAt: "2025-09-15T10:00:00Z",
      createdAt: "2025-09-15T10:00:00Z", updatedAt: "2025-09-15T10:00:00Z",
    }];
    const installments: Installment[] = [{
      id: "ins-1", parentId: "par-1", studentId: "stu-1", category: "tuition",
      label: "Tranche", amountDue: 100_000, amountPaid: 100_000, amountPending: 0,
      dueDate: "2025-09-15", paidDate: "2025-09-15", status: "paid",
      academicCycle: "primaire", paymentPlan: "tranches", isCustomSchedule: false,
      customSchedule: false, customScheduleNote: null,
    }];
    const report = reconcileFinancials(makeCtx(ledger, payments, installments));
    const unbacked = report.violations.find((v) => v.code === "UNBACKED_PARENT_CREDIT");
    expect(unbacked).toBeUndefined();
  });
});
