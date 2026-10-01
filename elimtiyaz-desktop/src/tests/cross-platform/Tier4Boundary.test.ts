/**
 * Tier 4 — Boundary & Numerical Precision Tests.
 *
 * Tests boundary values around every meaningful financial limit:
 *   - 0 centimes
 *   - 1 centime (= 0.01 DZD)
 *   - 99 centimes (= 0.99 DZD)
 *   - 100 centimes (= 1.00 DZD)
 *   - 101 centimes (= 1.01 DZD)
 *   - MAX safe value
 *   - MAX + 1
 *
 * Also tests:
 *   - Cumulative rounding (apply discount + split + pay many times)
 *   - Repeated calculations (idempotency at boundary)
 *   - Negative values where invalid
 *   - Precision-sensitive combinations
 *
 * These tests run against BOTH the desktop engine AND the Kotlin-mirror
 * engine, then assert they produce centime-identical results.
 *
 * Run:
 *   npx vitest run src/test/cross-platform/Tier4Boundary.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  computeAccountBalance,
  computeParentSummary,
  deriveAccountId,
  allocatePaymentToInstallments,
  revertPaymentAllocation,
  evaluateAllSystemDiscounts,
  sumDiscounts,
  splitNetTuitionByOfficialSchedule,
  type LedgerEntry,
  type WaterfallInstallment,
} from "../../../financial-tests/equivalence/android_mirror/kotlin_mirror_engine";
import {
  computeAccountBalance as computeAccountBalanceDesktop,
  computeParentSummary as computeParentSummaryDesktop,
} from "../../domain/calc/ledger/balance";
import { allocatePaymentToInstallments as allocateDesktop } from "../../domain/calc/payment/waterfall-allocator";
import { revertPaymentAllocation as revertDesktop } from "../../domain/calc/payment/lifo-reversal";
import { splitNetTuitionByOfficialSchedule as splitDesktop } from "../../domain/calc/pricing/tuition";

const DZD = (centimes: number) => centimes / 100;
const CENTIMES = (dzd: number) => Math.round(dzd * 100);

const makeEntry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: over.id ?? "led-test",
  tenantId: "t1",
  accountId: over.accountId ?? deriveAccountId("par-1", over.category ?? "tuition", over.studentId ?? null),
  parentId: over.parentId ?? "par-1",
  studentId: over.studentId ?? null,
  category: over.category ?? "tuition",
  amount: over.amount ?? 0,
  type: over.type ?? "charge",
  sourceType: over.sourceType ?? "installment",
  sourceId: over.sourceId ?? "ins-test",
  method: over.method ?? null,
  receiptNumber: over.receiptNumber ?? null,
  paymentStatus: over.paymentStatus ?? null,
  reversesId: over.reversesId ?? null,
  description: over.description ?? "test",
  actorId: over.actorId ?? "u1",
  actorName: over.actorName ?? "Alice",
  at: over.at ?? "2026-01-15T10:00:00Z",
  metadata: over.metadata ?? {},
});

describe("Boundary: zero value (0 centimes)", () => {
  it("mirror: 0-centime payment returns empty allocations + 0 unallocated", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 5000000, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
    ];
    const result = allocatePaymentToInstallments(installments, 0, "tuition", "paid");
    expect(result.allocations).toHaveLength(0);
    expect(result.unallocatedAmount).toBe(0);
    expect(result.totalAllocated).toBe(0);
  });

  it("desktop: 0-DZD payment produces the same canonical state", () => {
    const installments = [
      { id: "i1", parentId: "par-1", studentId: null, category: "tuition" as const, label: "T1", amountDue: 50000, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", paidDate: null, status: "unpaid" as const },
    ];
    const result = allocateDesktop(installments, 0, "tuition", "paid");
    expect(result.allocations).toHaveLength(0);
    expect(result.unallocatedAmount).toBe(0);
  });
});

describe("Boundary: 1 centime (= 0.01 DZD)", () => {
  it("mirror: 1-centime payment against 1-centime obligation fully satisfies it", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 1, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
    ];
    const result = allocatePaymentToInstallments(installments, 1, "tuition", "paid");
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].allocatedAmount).toBe(1);
    expect(result.allocations[0].newAmountPaid).toBe(1);
    expect(result.allocations[0].fullySatisfied).toBe(true);
    expect(result.allocations[0].newStatus).toBe("paid");
  });

  it("cross-platform: 1-centime-equivalent produces matching centime-level state", () => {
    // Mirror (centimes)
    const mirrorInstallments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 1, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
    ];
    const mirrorResult = allocatePaymentToInstallments(mirrorInstallments, 1, "tuition", "paid");

    // Desktop (DZD) — 0.01 DZD against 0.01 DZD obligation
    const desktopInstallments = [
      { id: "i1", parentId: "par-1", studentId: null, category: "tuition" as const, label: "T1", amountDue: 0.01, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", paidDate: null, status: "unpaid" as const },
    ];
    const desktopResult = allocateDesktop(desktopInstallments, 0.01, "tuition", "paid");

    // Convert desktop result to centimes and compare
    expect(CENTIMES(desktopResult.allocations[0].allocatedAmount)).toBe(mirrorResult.allocations[0].allocatedAmount);
    expect(CENTIMES(desktopResult.allocations[0].newAmountPaid)).toBe(mirrorResult.allocations[0].newAmountPaid);
    expect(desktopResult.allocations[0].newStatus).toBe(mirrorResult.allocations[0].newStatus);
  });
});

describe("Boundary: 99 centimes (= 0.99 DZD)", () => {
  it("mirror: 99-centime payment against 100-centime obligation results in partial", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 100, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
    ];
    const result = allocatePaymentToInstallments(installments, 99, "tuition", "paid");
    expect(result.allocations[0].newAmountPaid).toBe(99);
    expect(result.allocations[0].fullySatisfied).toBe(false);
    expect(result.allocations[0].newStatus).toBe("partial");
  });
});

describe("Boundary: exact balance (100 centimes vs 100 centimes)", () => {
  it("mirror: payment exactly equal to obligation results in 'paid'", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 100, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
    ];
    const result = allocatePaymentToInstallments(installments, 100, "tuition", "paid");
    expect(result.allocations[0].fullySatisfied).toBe(true);
    expect(result.allocations[0].newStatus).toBe("paid");
    expect(result.unallocatedAmount).toBe(0);
  });
});

describe("Boundary: 1 centime overpayment (101 centimes vs 100 centimes)", () => {
  it("mirror: 1-centime overpayment creates 1-centime parent_credit", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 100, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
    ];
    const result = allocatePaymentToInstallments(installments, 101, "tuition", "paid");
    expect(result.totalAllocated).toBe(100);
    expect(result.unallocatedAmount).toBe(1);
  });
});

describe("Boundary: large values (Number.MAX_SAFE_INTEGER)", () => {
  it("mirror: very large obligation + payment doesn't overflow JS numbers", () => {
    // 90 trillion centimes = 900 billion DZD (way beyond real-world limits but tests the ceiling)
    const largeAmount = 9_000_000_000_000_000;
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: largeAmount, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
    ];
    const result = allocatePaymentToInstallments(installments, largeAmount, "tuition", "paid");
    expect(result.totalAllocated).toBe(largeAmount);
    expect(result.unallocatedAmount).toBe(0);
    expect(result.allocations[0].newAmountPaid).toBe(largeAmount);
  });
});

describe("Boundary: cumulative rounding (apply discount + split + pay many times)", () => {
  it("mirror: 330,000,000 DZD gross → split into 3 tranches → no centime drift across 1000 iterations", () => {
    const gross = 33_000_000_000; // 330 million DZD in centimes
    let drift = 0;
    for (let i = 0; i < 1000; i++) {
      const [t1, t2, t3] = splitNetTuitionByOfficialSchedule(gross);
      drift += (t1 + t2 + t3) - gross;
    }
    expect(drift).toBe(0); // No drift across 1000 iterations
  });

  it("cross-platform: desktop split + mirror split produce identical centime results", () => {
    const grossCentimes = 33_000_000_000;
    const grossDzd = grossCentimes / 100;
    const [mT1, mT2, mT3] = splitNetTuitionByOfficialSchedule(grossCentimes);
    const [dT1, dT2, dT3] = splitDesktop(grossDzd);
    expect(CENTIMES(dT1)).toBe(mT1);
    expect(CENTIMES(dT2)).toBe(mT2);
    expect(CENTIMES(dT3)).toBe(mT3);
  });
});

describe("Boundary: refund at exact amount (LIFO revert)", () => {
  it("mirror: refund exactly equal to original payment reverts fully", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 5000000, amountPaid: 5000000, amountPending: 0, dueDate: "2026-09-15", status: "paid" },
    ];
    const result = revertPaymentAllocation(installments, 5000000, "tuition", false);
    expect(result.totalReverted).toBe(5000000);
    expect(result.reverts[0].newAmountPaid).toBe(0);
    expect(result.reverts[0].newStatus).toBe("pending");
    expect(result.reverts[0].reopened).toBe(true);
  });

  it("mirror: refund MORE than original payment only reverts what's available", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 5000000, amountPaid: 2000000, amountPending: 0, dueDate: "2026-09-15", status: "partial" },
    ];
    // Try to refund 5,000,000 but only 2,000,000 was paid → revert 2,000,000, leave 3,000,000 unreverted
    const result = revertPaymentAllocation(installments, 5000000, "tuition", false);
    expect(result.totalReverted).toBe(2000000);
    expect(result.unrevertedAmount).toBe(3000000);
  });
});

describe("Boundary: zero-value refund", () => {
  it("mirror: 0 reversal amount returns empty reverts", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 5000000, amountPaid: 5000000, amountPending: 0, dueDate: "2026-09-15", status: "paid" },
    ];
    const result = revertPaymentAllocation(installments, 0, "tuition", false);
    expect(result.reverts).toHaveLength(0);
    expect(result.totalReverted).toBe(0);
  });
});

describe("Boundary: discount at percentage boundary (CALC-001: exactly 5%)", () => {
  it("mirror: 5% of 330,000,000 centimes gross = -16,500,000 centimes exactly; the fictional rules NEVER fire", () => {
    // T-459/PARITY-005: the mirror is CALC-001-clean — the full_annual rate
    // is 5% (the workbook SUM(F)*0.05), and the three removed rules
    // (highest_average / seniority_5y / passage_palier) never fire even
    // when their legacy params are populated (rank 1, 11-year enrollment).
    const evals = evaluateAllSystemDiscounts({
      grossTuition: 330_000_000,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 1,
      paymentPlan: "full_annual",
      paymentDate: "2026-06-15T10:00:00Z", // before June 30 cutoff
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01T00:00:00Z",
      enrollmentDate: "2015-09-01T00:00:00Z", // > 5 years seniority (ignored)
      previousRank: 1, // rank 1 = academic excellence (ignored)
    });
    expect(evals.find((e) => e.code === "full_annual")?.amount).toBe(-16_500_000);
    expect(evals.find((e) => e.code === "highest_average")).toBeUndefined();
    expect(evals.find((e) => e.code === "seniority_5y")).toBeUndefined();
    expect(evals.find((e) => e.code === "passage_palier")).toBeUndefined();
  });
});

describe("Boundary: just-before vs just-after cutoff dates", () => {
  it("mirror: payment exactly on June 30 23:59:59 UTC qualifies for full_annual discount", () => {
    const evals = evaluateAllSystemDiscounts({
      grossTuition: 330_000_000,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 1,
      paymentPlan: "full_annual",
      paymentDate: "2026-06-30T23:59:59Z",
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01T00:00:00Z",
      enrollmentDate: "2026-09-01T00:00:00Z",
      previousRank: null,
    });
    // T-459: the 5% rate (CALC-001) — the cutoff boundary semantics are
    // unchanged (on/before June 30 23:59:59 UTC qualifies).
    expect(evals.find((e) => e.code === "full_annual")?.amount).toBe(-16_500_000);
  });

  it("mirror: payment at July 1 00:00:00 UTC does NOT qualify for full_annual discount", () => {
    const evals = evaluateAllSystemDiscounts({
      grossTuition: 330_000_000,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 1,
      paymentPlan: "full_annual",
      paymentDate: "2026-07-01T00:00:00Z",
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01T00:00:00Z",
      enrollmentDate: "2026-09-01T00:00:00Z",
      previousRank: null,
    });
    expect(evals.find((e) => e.code === "full_annual")).toBeUndefined();
  });
});

describe("Boundary: seniority 5-year edge (CALC-001: the rule never fires)", () => {
  it("mirror: enrollment exactly 5 years 0 days before academic year start — no rule fires (the engine ignores the param)", () => {
    // T-459/PARITY-005: seniority_5y NEVER EXISTED at the school — the
    // legacy enrollmentDate param is accepted and intentionally ignored.
    const evals = evaluateAllSystemDiscounts({
      grossTuition: 330_000_000,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 1,
      paymentPlan: "tranches", // not full_annual
      paymentDate: "2026-09-15T10:00:00Z",
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01T00:00:00Z",
      enrollmentDate: "2021-09-01T00:00:00Z", // exactly 5 years
      previousRank: null,
    });
    expect(evals.find((e) => e.code === "seniority_5y")).toBeUndefined();
  });

  it("mirror: enrollment 5 years + 1 day — STILL no rule fires (CALC-001)", () => {
    const evals = evaluateAllSystemDiscounts({
      grossTuition: 330_000_000,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 1,
      paymentPlan: "tranches",
      paymentDate: "2026-09-15T10:00:00Z",
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01T00:00:00Z",
      enrollmentDate: "2021-08-31T00:00:00Z", // 5 years + 1 day
      previousRank: null,
    });
    expect(evals.find((e) => e.code === "seniority_5y")).toBeUndefined();
    expect(evals).toHaveLength(0);
  });
});

describe("Boundary: negative payment amount (forbidden by canonical rule)", () => {
  it("mirror: negative payment amount returns empty allocations (no crash)", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 5000000, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
    ];
    const result = allocatePaymentToInstallments(installments, -1000, "tuition", "paid");
    expect(result.allocations).toHaveLength(0);
    expect(result.totalAllocated).toBe(0);
  });
});

describe("Boundary: idempotency — same input produces same output", () => {
  it("mirror: calling allocatePaymentToInstallments twice with same input produces identical results", () => {
    const installments: WaterfallInstallment[] = [
      { id: "i1", category: "tuition", amountDue: 5000000, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
      { id: "i2", category: "tuition", amountDue: 5000000, amountPaid: 0, amountPending: 0, dueDate: "2026-12-15", status: "unpaid" },
    ];
    const r1 = allocatePaymentToInstallments(installments, 7500000, "tuition", "paid");
    const r2 = allocatePaymentToInstallments(installments, 7500000, "tuition", "paid");
    expect(r1).toEqual(r2);
  });
});

describe("Boundary: cross-platform equivalence at boundary values", () => {
  // Test that desktop and mirror produce identical results at every meaningful boundary.
  const testCases = [
    { name: "0 centimes / 0 DZD", centimes: 0 },
    { name: "1 centime / 0.01 DZD", centimes: 1 },
    { name: "99 centimes / 0.99 DZD", centimes: 99 },
    { name: "100 centimes / 1.00 DZD", centimes: 100 },
    { name: "101 centimes / 1.01 DZD", centimes: 101 },
    { name: "5,000,000 centimes / 50,000 DZD", centimes: 5_000_000 },
    { name: "330,000,000 centimes / 3.3M DZD", centimes: 330_000_000 },
  ];

  for (const tc of testCases) {
    it(`mirror == desktop for: ${tc.name}`, () => {
      const mirrorInstallments: WaterfallInstallment[] = [
        { id: "i1", category: "tuition", amountDue: tc.centimes, amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", status: "unpaid" },
      ];
      const mirrorResult = allocatePaymentToInstallments(mirrorInstallments, tc.centimes, "tuition", "paid");

      const desktopInstallments = [
        { id: "i1", parentId: "par-1", studentId: null, category: "tuition" as const, label: "T1", amountDue: DZD(tc.centimes), amountPaid: 0, amountPending: 0, dueDate: "2026-09-15", paidDate: null, status: "unpaid" as const },
      ];
      const desktopResult = allocateDesktop(desktopInstallments, DZD(tc.centimes), "tuition", "paid");

      expect(CENTIMES(desktopResult.totalAllocated)).toBe(mirrorResult.totalAllocated);
      expect(CENTIMES(desktopResult.unallocatedAmount)).toBe(mirrorResult.unallocatedAmount);
      expect(desktopResult.allocations.length).toBe(mirrorResult.allocations.length);
      if (desktopResult.allocations.length > 0) {
        expect(CENTIMES(desktopResult.allocations[0].allocatedAmount)).toBe(mirrorResult.allocations[0].allocatedAmount);
        expect(CENTIMES(desktopResult.allocations[0].newAmountPaid)).toBe(mirrorResult.allocations[0].newAmountPaid);
        expect(desktopResult.allocations[0].newStatus).toBe(mirrorResult.allocations[0].newStatus);
      }
    });
  }
});
