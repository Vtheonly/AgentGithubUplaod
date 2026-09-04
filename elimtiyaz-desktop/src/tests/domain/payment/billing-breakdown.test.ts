/**
 * Unit tests for the canonical parent billing breakdown (T-164).
 *
 * Verifies `computeParentBillingBreakdown`:
 *   - PREFERS real installment rows (server waterfall amounts, INV-4
 *     remaining with `amountPending`) over client-side synthesis.
 *   - Synthesizes the official 40/30/30 schedule ONLY when a child has
 *     charges and no physical tranche rows — with exact conservation and
 *     the official Sept 15 / Dec 15 / Mar 15 due dates.
 *   - Runs the display waterfall over synthetic tranches using the
 *     canonical `allocatePaymentToInstallments` (chronological, oldest
 *     due date first, across children).
 *   - Reserves real-installment money so cleared payments cannot be
 *     double-counted against synthetic tranches.
 *   - Consolidates per-service totals and resolves the academic year.
 *
 * The headline scenario reproduces the owner-reported case: a 285 000 DZD
 * imported annual charge with 125 000 DZD cleared payments and NO physical
 * tranches → T1 (114 000) fully covered, T2 (85 500) 11 000 covered /
 * 74 500 remaining, T3 (85 500) untouched, total remaining 160 000 DZD.
 *
 * Also verifies `describeAdjustment` (credit/debit badge + diagnostic
 * fallback for blank legacy reasons).
 */
import { describe, it, expect } from "vitest";
import {
  computeParentBillingBreakdown,
  describeAdjustment,
  resolveBillingAcademicYear,
} from "../../../domain/calc/payment/billing-breakdown";
import type { Installment, Payment, PaymentCategory } from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Student } from "../../../domain/model/student";

/* ============================================================ */
/*  Fixtures                                                     */
/* ============================================================ */

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: overrides.id ?? "stu-1",
    tenantId: "tenant-1",
    code: "ELV-2025-000001",
    parentId: "p-1",
    firstName: "Sara",
    lastName: "BENALI",
    displayName: null,
    gender: "female",
    birthDate: "2015-04-02",
    enrollmentDate: "2025-09-01",
    level: "primaire",
    gradeYear: 3,
    gradeLevel: "3ap",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: "2025-09-01T00:00:00.000Z",
    updatedAt: "2025-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCharge(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: overrides.id ?? "led-charge-1",
    tenantId: "tenant-1",
    accountId: "parent:p-1:category:tuition",
    parentId: "p-1",
    studentId: overrides.studentId ?? "stu-1",
    category: (overrides.category as PaymentCategory) ?? "tuition",
    amount: overrides.amount ?? 285_000,
    type: "charge",
    sourceType: "bulk_import",
    sourceId: "run-1",
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: overrides.description ?? "Devis annuel (import Excel run run-1)",
    actorId: "system",
    actorName: "System",
    at: "2025-08-11T22:22:37.094Z",
    metadata: overrides.metadata ?? {},
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: overrides.id ?? "pay-1",
    tenantId: "tenant-1",
    receiptNumber: "REC-2025-000001",
    parentId: "p-1",
    studentId: null,
    amount: overrides.amount ?? 125_000,
    method: "cash",
    status: overrides.status ?? "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-cashier",
    collectedAt: "2025-09-10T10:00:00.000Z",
    createdAt: "2025-09-10T10:00:00.000Z",
    updatedAt: "2025-09-10T10:00:00.000Z",
    ...overrides,
  };
}

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: "p-1",
    studentId: overrides.studentId ?? "stu-1",
    category: (overrides.category as PaymentCategory) ?? "tuition",
    label: overrides.label ?? "Tranche 1 — Scolarité",
    amountDue: overrides.amountDue ?? 114_000,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2025-09-15",
    paidDate: overrides.paidDate ?? null,
    status: overrides.status ?? "unpaid",
    ...overrides,
  };
}

/* ============================================================ */
/*  Headline scenario — the owner-reported 285k / 125k case      */
/* ============================================================ */

describe("computeParentBillingBreakdown — synthetic schedule (import gap)", () => {
  it("splits a 285 000 DZD charge into the official 114 000 / 85 500 / 85 500 tranches", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 285_000 })],
      installments: [],
      payments: [],
      students: [makeStudent()],
      fallbackTotalDue: 285_000,
    });

    expect(breakdown.totalBilled).toBe(285_000);
    expect(breakdown.hasSyntheticTranches).toBe(true);
    const tranches = breakdown.byChild[0].tranches;
    expect(tranches).toHaveLength(3);
    expect(tranches.map((t) => t.amountDue)).toEqual([114_000, 85_500, 85_500]);
    // Exact conservation — no dinar lost or invented.
    expect(tranches.reduce((s, t) => s + t.amountDue, 0)).toBe(285_000);
  });

  it("uses the official Sept 15 / Dec 15 / Mar 15 due dates", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge()],
      installments: [],
      payments: [],
      students: [makeStudent()],
    });
    const dueDates = breakdown.byChild[0].tranches.map((t) => t.dueDate);
    expect(dueDates).toEqual([
      "2025-09-15T00:00:00.000Z",
      "2025-12-15T00:00:00.000Z",
      "2026-03-15T00:00:00.000Z",
    ]);
    expect(breakdown.byChild[0].tranches.map((t) => t.dueWindowLabel)).toEqual([
      "Septembre",
      "Décembre",
      "Mars",
    ]);
  });

  it("covers T1 fully and spills 11 000 into T2 for 125 000 cleared (remaining 160 000)", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 285_000 })],
      installments: [],
      payments: [
        makePayment({ id: "pay-1", amount: 95_000 }),
        makePayment({ id: "pay-2", amount: 30_000 }),
      ],
      students: [makeStudent()],
    });

    const tranches = breakdown.byChild[0].tranches;
    // T1: 114 000 fully covered.
    expect(tranches[0].amountPaid).toBe(114_000);
    expect(tranches[0].remaining).toBe(0);
    expect(tranches[0].status).toBe("paid");
    // T2: 11 000 covered → 74 500 remaining.
    expect(tranches[1].amountPaid).toBe(11_000);
    expect(tranches[1].remaining).toBe(74_500);
    expect(tranches[1].status).toBe("partial");
    // T3 untouched.
    expect(tranches[2].amountPaid).toBe(0);
    expect(tranches[2].remaining).toBe(85_500);
    expect(tranches[2].status).toBe("unpaid");
    // Σ remaining === the exact outstanding balance.
    expect(tranches.reduce((s, t) => s + t.remaining, 0)).toBe(160_000);
    expect(breakdown.totalClearedPaid).toBe(125_000);
  });

  it("only counts CLEARED payments in the display waterfall (sumPaidPayments semantics)", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 285_000 })],
      installments: [],
      payments: [
        makePayment({ id: "pay-1", amount: 50_000, status: "pending" }),
        makePayment({ id: "pay-2", amount: 30_000, status: "paid" }),
      ],
      students: [makeStudent()],
    });
    expect(breakdown.totalClearedPaid).toBe(30_000);
    expect(breakdown.byChild[0].tranches[0].amountPaid).toBe(30_000);
  });
});

/* ============================================================ */
/*  Real installments are authoritative                         */
/* ============================================================ */

describe("computeParentBillingBreakdown — real installment rows", () => {
  it("uses the stored server-waterfall amounts verbatim (no client re-allocation)", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 285_000 })],
      installments: [
        makeInstallment({
          id: "ins-1",
          amountDue: 114_000,
          amountPaid: 100_000,
          status: "partial",
        }),
        makeInstallment({
          id: "ins-2",
          label: "Tranche 2 — Scolarité",
          amountDue: 85_500,
          dueDate: "2025-12-15",
        }),
        makeInstallment({
          id: "ins-3",
          label: "Tranche 3 — Scolarité",
          amountDue: 85_500,
          dueDate: "2026-03-15",
        }),
      ],
      payments: [makePayment({ amount: 100_000 })],
      students: [makeStudent()],
    });

    expect(breakdown.hasSyntheticTranches).toBe(false);
    const tranches = breakdown.byChild[0].tranches;
    expect(tranches).toHaveLength(3);
    expect(tranches[0].amountPaid).toBe(100_000); // from the DB row, not recomputed
    expect(tranches[0].remaining).toBe(14_000);
    expect(tranches[0].status).toBe("partial");
    expect(tranches[0].installment?.id).toBe("ins-1");
    // Σ remaining matches the ledger: 285 000 − 100 000.
    expect(tranches.reduce((s, t) => s + t.remaining, 0)).toBe(185_000);
  });

  it("honours INV-4: remaining subtracts amountPending (uncleared check)", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 114_000 })],
      installments: [
        makeInstallment({ amountDue: 114_000, amountPaid: 40_000, amountPending: 30_000 }),
      ],
      payments: [makePayment({ amount: 70_000 })],
      students: [makeStudent()],
    });
    const t = breakdown.byChild[0].tranches[0];
    expect(t.remaining).toBe(44_000); // 114 000 − 40 000 − 30 000
    expect(t.amountPending).toBe(30_000);
  });

  it("sorts real tranches chronologically by due date", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 285_000 })],
      installments: [
        makeInstallment({
          id: "ins-3",
          label: "Tranche 3",
          amountDue: 85_500,
          dueDate: "2026-03-15",
        }),
        makeInstallment({
          id: "ins-1",
          amountDue: 114_000,
          dueDate: "2025-09-15",
        }),
      ],
      payments: [],
      students: [makeStudent()],
    });
    expect(breakdown.byChild[0].tranches.map((t) => t.key)).toEqual(["ins-1", "ins-3"]);
  });
});

/* ============================================================ */
/*  Mixed real + synthetic: no double counting                  */
/* ============================================================ */

describe("computeParentBillingBreakdown — mixed families", () => {
  it("reserves real-installment money so cleared payments are not double-counted", () => {
    // Child A: real tranches with 100 000 already paid (server-side).
    // Child B: charges, no tranches. Family cleared payments: 150 000.
    // The synthetic waterfall over B must receive 50 000, not 150 000.
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [
        makeCharge({ id: "c-a", studentId: "stu-a", amount: 200_000 }),
        makeCharge({ id: "c-b", studentId: "stu-b", amount: 100_000 }),
      ],
      installments: [
        makeInstallment({
          id: "ins-a1",
          studentId: "stu-a",
          amountDue: 200_000,
          amountPaid: 100_000,
          status: "partial",
        }),
      ],
      payments: [makePayment({ amount: 150_000 })],
      students: [
        makeStudent({ id: "stu-a", firstName: "A" }),
        makeStudent({ id: "stu-b", firstName: "B" }),
      ],
    });

    const childA = breakdown.byChild.find((c) => c.student.id === "stu-a")!;
    const childB = breakdown.byChild.find((c) => c.student.id === "stu-b")!;
    expect(childA.isSyntheticSchedule).toBe(false);
    expect(childA.tranches[0].amountPaid).toBe(100_000);
    expect(childB.isSyntheticSchedule).toBe(true);
    // B's synthetic T1 is 40 % of 100 000 = 40 000 → fully covered by the
    // 50 000 residual; T2 (30 000) receives the last 10 000.
    expect(childB.tranches[0].amountPaid).toBe(40_000);
    expect(childB.tranches[0].status).toBe("paid");
    expect(childB.tranches[1].amountPaid).toBe(10_000);
    expect(childB.tranches[1].status).toBe("partial");
    expect(breakdown.hasSyntheticTranches).toBe(true);
  });

  it("attributes charges per child via studentId and consolidates per service", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [
        makeCharge({ id: "c-a", studentId: "stu-a", amount: 200_000, category: "tuition" }),
        makeCharge({ id: "c-b", studentId: "stu-b", amount: 30_000, category: "transport" }),
      ],
      installments: [
        makeInstallment({
          id: "ins-a",
          studentId: "stu-a",
          amountDue: 200_000,
          amountPaid: 200_000,
          status: "paid",
        }),
      ],
      payments: [makePayment({ amount: 200_000 })],
      students: [makeStudent({ id: "stu-a" }), makeStudent({ id: "stu-b" })],
    });

    expect(breakdown.byChild.map((c) => c.billedTotal)).toEqual([200_000, 30_000]);
    expect(breakdown.byService.map((s) => s.category)).toEqual(["tuition", "transport"]);
    expect(breakdown.byService.find((s) => s.category === "tuition")?.amount).toBe(200_000);
    expect(breakdown.byService.find((s) => s.category === "transport")?.amount).toBe(30_000);
  });

  it("falls back to family charges for a single-child family without student attribution", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ studentId: null, amount: 150_000 })],
      installments: [
        makeInstallment({ studentId: null, amountDue: 150_000, amountPaid: 50_000, status: "partial" }),
      ],
      payments: [makePayment({ amount: 50_000 })],
      students: [makeStudent()],
    });
    expect(breakdown.byChild[0].billedTotal).toBe(150_000);
    expect(breakdown.byChild[0].tranches[0].amountPaid).toBe(50_000);
    expect(breakdown.hasSyntheticTranches).toBe(false);
  });
});

/* ============================================================ */
/*  Totals + academic year                                      */
/* ============================================================ */

describe("computeParentBillingBreakdown — totals & academic year", () => {
  it("falls back to profile.totalDue when the ledger has no charge rows", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [],
      installments: [],
      payments: [],
      students: [makeStudent()],
      fallbackTotalDue: 250_000,
    });
    expect(breakdown.totalBilled).toBe(250_000);
    expect(breakdown.byService).toEqual([
      { category: "tuition", label: "Scolarité Annuelle", amount: 250_000, count: 1 },
    ]);
  });

  it("resolves the academic year from charge metadata, then description, then class placement", () => {
    const charge = makeCharge({ metadata: { academicYear: "2026-2027" } });
    expect(resolveBillingAcademicYear([charge], [makeStudent()], {})).toBe("2026-2027");

    const described = makeCharge({ description: "Scolarité 2025-2026 (import)" });
    expect(resolveBillingAcademicYear([described], [makeStudent()], {})).toBe("2025-2026");

    expect(
      resolveBillingAcademicYear([], [makeStudent({ id: "stu-x" })], {
        classAcademicYearOf: (sid) => (sid === "stu-x" ? "2024-2025" : null),
      }),
    ).toBe("2024-2025");

    expect(
      resolveBillingAcademicYear([], [makeStudent()], { currentYearCode: "2027-2028" }),
    ).toBe("2027-2028");

    expect(resolveBillingAcademicYear([], [makeStudent()], {})).toBe("2025-2026");
  });

  it("synthesizes against the resolved academic year's calendar", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ metadata: { academicYear: "2026-2027" } })],
      installments: [],
      payments: [],
      students: [makeStudent()],
    });
    expect(breakdown.academicYear).toBe("2026-2027");
    expect(breakdown.byChild[0].tranches[0].dueDate).toBe("2026-09-15T00:00:00.000Z");
  });
});

/* ============================================================ */
/*  Adjustment diagnostics                                      */
/* ============================================================ */

describe("describeAdjustment", () => {
  it("labels negative amounts as credit / deduction with the stored reason", () => {
    const diag = describeAdjustment({ amount: -71_000, reason: "Remise fratrie (3 enfants)" });
    expect(diag.kind).toBe("credit");
    expect(diag.badgeLabel).toBe("Crédit / Déduction");
    expect(diag.reasonLabel).toBe("Remise fratrie (3 enfants)");
    expect(diag.isDiagnosticFallback).toBe(false);
  });

  it("labels positive amounts as debit / majoration (discount reversal)", () => {
    const diag = describeAdjustment({
      amount: 71_000,
      reason: "Annulation de remise lors du ré-import",
    });
    expect(diag.kind).toBe("debit");
    expect(diag.badgeLabel).toBe("Débit / Majoration");
    expect(diag.isDiagnosticFallback).toBe(false);
  });

  it("substitutes a diagnostic when the legacy reason is blank", () => {
    const credit = describeAdjustment({ amount: -50_000, reason: "" });
    expect(credit.isDiagnosticFallback).toBe(true);
    expect(credit.reasonLabel).toContain("Déduction");

    const debit = describeAdjustment({ amount: 50_000, reason: "   " });
    expect(debit.isDiagnosticFallback).toBe(true);
    expect(debit.reasonLabel).toContain("Régularisation");
  });
});
