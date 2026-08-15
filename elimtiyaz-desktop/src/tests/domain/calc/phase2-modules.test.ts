/**
 * Phase 2 smoke tests: discount-engine, waterfall, lifo, reconciliation, ledger-balance.
 */
import { describe, it, expect } from "vitest";
import {
  evaluatePassageDePalier, evaluateSiblingDiscount, evaluateEarlyAnnualDiscount,
  evaluateAcademicExcellenceDiscount, evaluateSeniorityDiscount,
  evaluateAllSystemDiscounts, sumDiscounts,
} from "../../../domain/calc/pricing/discount-engine";
import { allocatePaymentToInstallments, isOverpayment } from "../../../domain/calc/payment/waterfall-allocator";
import { revertPaymentAllocation, reevaluateInstallmentStatus } from "../../../domain/calc/payment/lifo-reversal";
import { reconcileFinancials, clearedBalancesReconcile } from "../../../domain/calc/reconcile/reconciliation";
import { replayParentLedger, balanceForAccount } from "../../../domain/calc/ledger/balance";
import type { Installment, Payment } from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import { createChargeEntry, createPaymentEntry } from "../../../domain/calc/ledger/entries";

describe("discount-engine — single-pass evaluation", () => {
  it("no discounts when nothing matches", () => {
    const result = evaluateAllSystemDiscounts({
      grossTuition: 100_000, previousGradeLevel: null, currentGradeLevel: "1ap",
      childIndex: 1, paymentPlan: "tranches", paymentDate: "2025-10-01",
      academicYearStartYear: 2026, academicYearStart: "2026-09-01",
      enrollmentDate: "2024-09-01", previousRank: null,
    });
    expect(result).toHaveLength(0);
    expect(sumDiscounts(result)).toBe(0);
  });

  it("applies ALL 5 discounts (single pass)", () => {
    const result = evaluateAllSystemDiscounts({
      grossTuition: 100_000, previousGradeLevel: "5ap", currentGradeLevel: "1am",
      childIndex: 2, paymentPlan: "full_annual", paymentDate: "2026-06-15",
      academicYearStartYear: 2026, academicYearStart: "2026-09-01",
      enrollmentDate: "2018-09-01", previousRank: 1,
    });
    expect(result.length).toBe(5);
    expect(sumDiscounts(result)).toBe(-40_000);
  });

  it("passage de palier fires only on cycle transitions", () => {
    expect(evaluatePassageDePalier("5ap", "1am")).toBe(-10_000);
    expect(evaluatePassageDePalier("3ap", "4ap")).toBe(0);
    expect(evaluatePassageDePalier(null, "1ap")).toBe(0);
  });

  it("sibling discount scales linearly", () => {
    expect(evaluateSiblingDiscount(1)).toBe(0);
    expect(evaluateSiblingDiscount(2)).toBe(-5_000);
    expect(evaluateSiblingDiscount(3)).toBe(-10_000);
  });

  it("early annual requires full_annual + date ≤ June 30", () => {
    expect(evaluateEarlyAnnualDiscount("2026-06-30", 100_000, "full_annual", 2026)).toBe(10_000);
    expect(evaluateEarlyAnnualDiscount("2026-07-01", 100_000, "full_annual", 2026)).toBe(0);
  });

  it("excellence requires rank 1", () => {
    expect(evaluateAcademicExcellenceDiscount(1, 100_000)).toBe(10_000);
    expect(evaluateAcademicExcellenceDiscount(2, 100_000)).toBe(0);
  });

  it("seniority > 5 years", () => {
    expect(evaluateSeniorityDiscount("2020-08-01", "2026-09-01", 100_000)).toBe(5_000);
    expect(evaluateSeniorityDiscount("2024-09-01", "2026-09-01", 100_000)).toBe(0);
  });
});

describe("waterfall-allocator", () => {
  function makeInstallment(id: string, dueDate: string, due: number, paid: number, status: Installment["status"] = "pending"): Installment {
    return {
      id, parentId: "par-1", studentId: "stu-1", category: "tuition", label: `Tranche ${id}`,
      amountDue: due, amountPaid: paid, amountPending: 0, dueDate, paidDate: null, status,
      academicCycle: "primaire", paymentPlan: "tranches", isCustomSchedule: false,
      customSchedule: false, customScheduleNote: null,
    };
  }

  it("allocates oldest first", () => {
    const installments = [
      makeInstallment("t3", "2026-03-15", 50_000, 0),
      makeInstallment("t1", "2025-09-15", 50_000, 0),
      makeInstallment("t2", "2025-12-15", 50_000, 0),
    ];
    const result = allocatePaymentToInstallments(installments, 70_000, "tuition", "paid");
    expect(result.totalAllocated).toBe(70_000);
    expect(result.allocations[0].installmentId).toBe("t1");
    expect(result.allocations[0].fullySatisfied).toBe(true);
  });

  it("returns excess as unallocatedAmount", () => {
    const result = allocatePaymentToInstallments([makeInstallment("t1", "2025-09-15", 50_000, 0)], 80_000, "tuition", "paid");
    expect(result.unallocatedAmount).toBe(30_000);
  });

  it("pending payments do NOT satisfy the tranche", () => {
    const result = allocatePaymentToInstallments([makeInstallment("t1", "2025-09-15", 50_000, 0)], 50_000, "tuition", "pending");
    expect(result.allocations[0].fullySatisfied).toBe(false);
    expect(result.allocations[0].newStatus).toBe("pending_clearance");
    expect(result.allocations[0].newAmountPaid).toBe(0);
  });

  it("isOverpayment detects excess", () => {
    expect(isOverpayment([makeInstallment("t1", "2025-09-15", 50_000, 0)], 80_000, "tuition")).toBe(true);
    expect(isOverpayment([makeInstallment("t1", "2025-09-15", 50_000, 0)], 30_000, "tuition")).toBe(false);
  });
});

describe("lifo-reversal", () => {
  function makeInstallment(id: string, dueDate: string, due: number, paid: number, status: Installment["status"] = "paid"): Installment {
    return {
      id, parentId: "par-1", studentId: "stu-1", category: "tuition", label: `Tranche ${id}`,
      amountDue: due, amountPaid: paid, amountPending: 0, dueDate, paidDate: dueDate, status,
      academicCycle: "primaire", paymentPlan: "tranches", isCustomSchedule: false,
      customSchedule: false, customScheduleNote: null,
    };
  }

  it("un-allocates newest first (LIFO)", () => {
    const installments = [
      makeInstallment("t1", "2025-09-15", 50_000, 50_000),
      makeInstallment("t2", "2025-12-15", 50_000, 50_000),
      makeInstallment("t3", "2026-03-15", 50_000, 50_000),
    ];
    const result = revertPaymentAllocation(installments, 60_000, "tuition");
    expect(result.totalReverted).toBe(60_000);
    expect(result.reverts[0].installmentId).toBe("t3");
    expect(result.reverts[0].revertedAmount).toBe(50_000);
    expect(result.reverts[1].installmentId).toBe("t2");
    expect(result.reverts[1].revertedAmount).toBe(10_000);
  });

  it("reevaluateInstallmentStatus", () => {
    expect(reevaluateInstallmentStatus(100, 100, "2025-09-15")).toBe("paid");
    expect(reevaluateInstallmentStatus(50, 100, "2025-09-15")).toBe("partial");
    expect(reevaluateInstallmentStatus(0, 100, "2024-01-01", new Date("2025-01-01"))).toBe("overdue");
    expect(reevaluateInstallmentStatus(0, 100, "2026-01-01", new Date("2025-01-01"))).toBe("pending");
  });
});

describe("reconciliation — unified cross-checks", () => {
  function makeLedgerAndPayment(): { ledger: LedgerEntry[]; payments: Payment[]; installments: Installment[] } {
    const ledger: LedgerEntry[] = [];
    const payments: Payment[] = [];
    ledger.push(createChargeEntry({
      tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
      amount: 100_000, sourceType: "installment", sourceId: "ins-1",
      description: "Tuition tranche 1", actorId: "usr-1", actorName: "Test",
    }));
    payments.push({
      id: "pay-1", tenantId: "t1", receiptNumber: "REC-1", parentId: "par-1",
      studentId: "stu-1", amount: 100_000, method: "cash", status: "paid",
      category: "tuition", installmentId: "ins-1", proofUrl: null, notes: null,
      collectedBy: "usr-1", collectedAt: "2025-09-15T10:00:00Z",
      createdAt: "2025-09-15T10:00:00Z", updatedAt: "2025-09-15T10:00:00Z",
    });
    ledger.push(createPaymentEntry({
      tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
      amount: 100_000, method: "cash", receiptNumber: "REC-1",
      paymentStatus: "paid", sourceType: "payment", sourceId: "pay-1",
      description: "Payment for tranche 1", actorId: "usr-1", actorName: "Test",
    }));
    const installments: Installment[] = [{
      id: "ins-1", parentId: "par-1", studentId: "stu-1", category: "tuition",
      label: "Tranche 1", amountDue: 100_000, amountPaid: 100_000, amountPending: 0,
      dueDate: "2025-09-15", paidDate: "2025-09-15", status: "paid",
      academicCycle: "primaire", paymentPlan: "tranches", isCustomSchedule: false,
      customSchedule: false, customScheduleNote: null,
    }];
    return { ledger, payments, installments };
  }

  it("reconcileFinancials: clean state → passed=true", () => {
    const ctx = makeLedgerAndPayment();
    const report = reconcileFinancials(ctx);
    expect(report.passed).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it("clearedBalancesReconcile: true when matching", () => {
    expect(clearedBalancesReconcile(makeLedgerAndPayment())).toBe(true);
  });

  it("clearedBalancesReconcile: false when divergent", () => {
    const ctx = makeLedgerAndPayment();
    ctx.payments[0] = { ...ctx.payments[0], amount: 99_000 };
    expect(clearedBalancesReconcile(ctx)).toBe(false);
  });
});

describe("ledger-balance — replay helpers", () => {
  it("replayParentLedger", () => {
    const entries: LedgerEntry[] = [
      createChargeEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 100_000, sourceType: "installment", sourceId: "ins-1",
        description: "Tuition", actorId: "u1", actorName: "Test",
      }),
      createPaymentEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 60_000, method: "cash", receiptNumber: "REC-1", paymentStatus: "paid",
        sourceType: "payment", sourceId: "pay-1",
        description: "Partial payment", actorId: "u1", actorName: "Test",
      }),
    ];
    const summary = replayParentLedger(entries, "par-1", "Karim Benali");
    expect(summary.totalCharged).toBe(100_000);
    expect(summary.totalPaid).toBe(60_000);
    expect(summary.totalOutstanding).toBe(40_000);
  });

  it("balanceForAccount", () => {
    const entries: LedgerEntry[] = [
      createChargeEntry({
        tenantId: "t1", parentId: "par-1", studentId: "stu-1", category: "tuition",
        amount: 100_000, sourceType: "installment", sourceId: "ins-1",
        description: "Tuition", actorId: "u1", actorName: "Test",
      }),
    ];
    const balance = balanceForAccount(entries, entries[0].accountId);
    expect(balance.balance).toBe(100_000);
  });
});
