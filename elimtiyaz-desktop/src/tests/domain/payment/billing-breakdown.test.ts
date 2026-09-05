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
  classifyAdjustmentHistory,
  resolveBillingAcademicYear,
} from "../../../domain/calc/payment/billing-breakdown";
import type { AccountAdjustment, Installment, Payment, PaymentCategory } from "../../../domain/model/payment";
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

function makeAdjustment(overrides: Partial<AccountAdjustment> = {}): AccountAdjustment {
  return {
    id: overrides.id ?? "adj-1",
    parentId: "p-1",
    amount: overrides.amount ?? -50_000,
    reason: overrides.reason ?? "Remise fratrie (3 enfants)",
    approvedBy: overrides.approvedBy ?? "usr-admin",
    approvedAt: overrides.approvedAt ?? "2025-09-02T10:00:00.000Z",
    receiptRef: overrides.receiptRef ?? null,
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
      {
        category: "tuition",
        label: "Scolarité Annuelle",
        amount: 250_000,
        count: 1,
        sharePct: 100,
        childAttribution: [{ studentId: null, studentName: "Famille", amount: 250_000 }],
      },
    ]);
    // T-168: no charges + no adjustments → flat reconciliation.
    expect(breakdown.reconciliation.grossBilled).toBe(250_000);
    expect(breakdown.reconciliation.netDue).toBe(250_000);
    expect(breakdown.reconciliation.derivedRemaining).toBe(250_000);
    expect(breakdown.unattributedItems).toEqual([]);
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

/* ============================================================ */
/*  T-168 — the complete "shopping list" (700k, 2 children)      */
/* ============================================================ */

describe("computeParentBillingBreakdown — T-168 complete itemized shopping list", () => {
  // The owner's question: "if I must pay 700 000 in total, what does that
  // include?" — 2 children: tuition 285k each, transport 45k each, plus a
  // 40k family-level registration fee. EVERY dinar must be accounted for.
  const kids = [
    makeStudent({ id: "stu-a", firstName: "Sara", lastName: "BENALI" }),
    makeStudent({ id: "stu-b", firstName: "Yanis", lastName: "BENALI" }),
  ];
  const charges = [
    makeCharge({ id: "c-t1", studentId: "stu-a", amount: 285_000, category: "tuition" }),
    makeCharge({ id: "c-t2", studentId: "stu-b", amount: 285_000, category: "tuition" }),
    makeCharge({ id: "c-tr1", studentId: "stu-a", amount: 45_000, category: "transport" }),
    makeCharge({ id: "c-tr2", studentId: "stu-b", amount: 45_000, category: "transport" }),
    makeCharge({
      id: "c-ins",
      studentId: null,
      amount: 40_000,
      category: "other",
      description: "Frais d'inscription (family-level)",
    }),
  ];

  it("accounts for every dinar: Σ byChild + unattributed === totalBilled (700 000)", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: [],
      payments: [],
      students: kids,
    });
    expect(breakdown.totalBilled).toBe(700_000);
    expect(breakdown.byChild.map((c) => c.billedTotal)).toEqual([330_000, 330_000]);
    expect(breakdown.unattributedTotal).toBe(40_000);
    expect(breakdown.unattributedItems.map((i) => i.amount)).toEqual([40_000]);
    // The exhaustive shopping-list conservation invariant.
    expect(
      breakdown.byChild.reduce((s, c) => s + c.billedTotal, 0) + breakdown.unattributedTotal,
    ).toBe(breakdown.totalBilled);
  });

  it("consolidates per service with share % and per-child attribution", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: [],
      payments: [],
      students: kids,
    });
    const tuition = breakdown.byService.find((s) => s.category === "tuition")!;
    const transport = breakdown.byService.find((s) => s.category === "transport")!;
    const other = breakdown.byService.find((s) => s.category === "other")!;

    expect(tuition.amount).toBe(570_000);
    expect(tuition.count).toBe(2);
    expect(tuition.sharePct).toBe(81); // 570/700 = 81.4 → 81
    expect(tuition.childAttribution).toEqual([
      { studentId: "stu-a", studentName: "Sara BENALI", amount: 285_000 },
      { studentId: "stu-b", studentName: "Yanis BENALI", amount: 285_000 },
    ]);
    expect(transport.amount).toBe(90_000);
    expect(transport.sharePct).toBe(13); // 90/700 = 12.9 → 13
    expect(transport.childAttribution.reduce((s, c) => s + c.amount, 0)).toBe(90_000);
    // Family-level row is attributed to "Famille", not to a child.
    expect(other.amount).toBe(40_000);
    expect(other.childAttribution).toEqual([
      { studentId: null, studentName: "Famille", amount: 40_000 },
    ]);
    // Per-service attribution is exhaustive: Σ services === totalBilled.
    expect(breakdown.byService.reduce((s, x) => s + x.amount, 0)).toBe(700_000);
    expect(breakdown.byService.reduce((s, x) => s + x.sharePct, 0)).toBe(100);
  });

  it("folds family-level charges into the single child of a single-child family", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [
        makeCharge({ id: "c-t", studentId: "stu-a", amount: 285_000, category: "tuition" }),
        makeCharge({ id: "c-ins", studentId: null, amount: 40_000, category: "other" }),
      ],
      installments: [],
      payments: [],
      students: [kids[0]],
    });
    expect(breakdown.byChild[0].billedTotal).toBe(325_000);
    expect(breakdown.unattributedItems).toEqual([]);
    expect(breakdown.unattributedTotal).toBe(0);
  });
});

/* ============================================================ */
/*  T-168 — adjustment-aware reconciliation                      */
/* ============================================================ */

describe("computeParentBillingBreakdown — T-168 adjustment-aware reconciliation", () => {
  it("derives the full equation: gross − remise + majoration = net; net − cleared − pending = remaining", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 285_000 })],
      installments: [],
      payments: [
        makePayment({ id: "pay-1", amount: 95_000, status: "paid" }),
        makePayment({ id: "pay-2", amount: 30_000, status: "pending" }),
      ],
      students: [makeStudent()],
      adjustments: [
        makeAdjustment({ id: "adj-1", amount: -71_000, reason: "Remise fratrie" }),
        makeAdjustment({ id: "adj-2", amount: 20_000, reason: "Majoration transport" }),
      ],
    });
    const r = breakdown.reconciliation;
    expect(r.grossBilled).toBe(285_000);
    expect(r.adjustmentsCredit).toBe(71_000);
    expect(r.adjustmentsDebit).toBe(20_000);
    expect(r.adjustmentsCount).toBe(2);
    expect(r.netDue).toBe(234_000); // 285 000 − 71 000 + 20 000
    expect(r.clearedPaid).toBe(95_000);
    expect(r.pendingPaid).toBe(30_000);
    expect(r.derivedRemaining).toBe(109_000); // 234 000 − 95 000 − 30 000
    expect(r.serverOutstanding).toBeNull();
    expect(r.bridge).toBe(0);
    expect(r.hasBridge).toBe(false);
  });

  it("balances to the server balance when supplied (bridge = 0 case)", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 285_000 })],
      installments: [],
      payments: [makePayment({ amount: 125_000 })],
      students: [makeStudent()],
      adjustments: [makeAdjustment({ id: "adj-1", amount: -71_000, reason: "Remise" })],
      serverOutstanding: 89_000, // 285 000 − 71 000 − 125 000
    });
    const r = breakdown.reconciliation;
    expect(r.netDue).toBe(214_000);
    expect(r.derivedRemaining).toBe(89_000);
    expect(r.serverOutstanding).toBe(89_000);
    expect(r.bridge).toBe(0);
    expect(r.hasBridge).toBe(false);
  });

  it("surfaces an explicit bridge when the server balance includes invisible items (refund)", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 285_000 })],
      installments: [],
      payments: [makePayment({ amount: 125_000 })],
      students: [makeStudent()],
      serverOutstanding: 79_000, // 10 000 refund booked server-side only
    });
    const r = breakdown.reconciliation;
    expect(r.derivedRemaining).toBe(160_000);
    expect(r.bridge).toBe(-81_000); // 79 000 − 160 000
    expect(r.hasBridge).toBe(true);
  });

  it("keeps a negative derivedRemaining (overpayer credit) instead of clamping", () => {
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: [makeCharge({ amount: 100_000 })],
      installments: [],
      payments: [makePayment({ amount: 150_000 })],
      students: [makeStudent()],
    });
    expect(breakdown.reconciliation.derivedRemaining).toBe(-50_000);
  });
});

/* ============================================================ */
/*  T-168 — adjustment provenance classification                 */
/* ============================================================ */

describe("classifyAdjustmentHistory — provenance classification", () => {
  it("classifies a documented operator adjustment as actual content", () => {
    const [c] = classifyAdjustmentHistory([
      makeAdjustment({ id: "adj-1", amount: -71_000, reason: "Remise fratrie (3 enfants)" }),
    ]);
    expect(c.provenance).toBe("documented");
    expect(c.provenanceLabel).toBe("Documenté");
    expect(c.pairedWithId).toBeNull();
    expect(c.meaningLabel).toContain("réduit le solde dû");
    expect(c.reasonLabel).toBe("Remise fratrie (3 enfants)");
  });

  it("detects the owner's +X/−X re-import flip-flop as reversal pairs (order-independent)", () => {
    // The exact historical pattern: -71k/+71k and -50k/+50k alternating with
    // blank reasons (non-idempotent Excel re-import). Shuffled input proves
    // the classification does not depend on list order.
    const classified = classifyAdjustmentHistory([
      makeAdjustment({ id: "adj-c1", amount: 50_000, reason: "", approvedAt: "2025-09-05T09:00:00.000Z" }),
      makeAdjustment({ id: "adj-d2", amount: -71_000, reason: "", approvedAt: "2025-09-06T09:00:00.000Z" }),
      makeAdjustment({ id: "adj-d1", amount: 71_000, reason: "", approvedAt: "2025-09-05T10:00:00.000Z" }),
      makeAdjustment({ id: "adj-c2", amount: -50_000, reason: "", approvedAt: "2025-09-06T10:00:00.000Z" }),
    ]);
    const byId = new Map(classified.map((c) => [c.id, c]));
    expect(byId.get("adj-d1")!.pairedWithId).toBe("adj-d2");
    expect(byId.get("adj-d2")!.pairedWithId).toBe("adj-d1");
    expect(byId.get("adj-c1")!.pairedWithId).toBe("adj-c2");
    expect(byId.get("adj-c2")!.pairedWithId).toBe("adj-c1");
    for (const c of classified) {
      expect(c.provenance).toBe("reversal_pair");
      expect(c.provenanceLabel).toBe("Contrepassation");
      expect(c.meaningLabel).toContain("nul");
    }
    // Net effect of the four entries is zero — the pair detection matches.
    expect(classified.reduce((s, c) => s + c.amount, 0)).toBe(0);
  });

  it("never pairs two same-sign entries (FIFO opposite-sign only)", () => {
    const classified = classifyAdjustmentHistory([
      makeAdjustment({ id: "adj-a", amount: 50_000, reason: "Note A", approvedAt: "2025-09-01T09:00:00.000Z" }),
      makeAdjustment({ id: "adj-b", amount: 50_000, reason: "Note B", approvedAt: "2025-09-02T09:00:00.000Z" }),
      makeAdjustment({ id: "adj-c", amount: -50_000, reason: "Remise", approvedAt: "2025-09-03T09:00:00.000Z" }),
    ]);
    const byId = new Map(classified.map((c) => [c.id, c]));
    // The FIRST +50k (chronologically) is cancelled by the -50k.
    expect(byId.get("adj-a")!.provenance).toBe("reversal_pair");
    expect(byId.get("adj-a")!.pairedWithId).toBe("adj-c");
    expect(byId.get("adj-c")!.pairedWithId).toBe("adj-a");
    // The second +50k is NOT paired with anything (same sign as adj-a).
    expect(byId.get("adj-b")!.provenance).toBe("documented");
    expect(byId.get("adj-b")!.pairedWithId).toBeNull();
  });

  it("flags a legacy blank entry as undocumented with the audit hint", () => {
    const [c] = classifyAdjustmentHistory([
      makeAdjustment({ id: "adj-1", amount: -50_000, reason: "   " }),
    ]);
    expect(c.provenance).toBe("undocumented");
    expect(c.provenanceLabel).toBe("Non documenté");
    expect(c.meaningLabel).toContain("auditer");
    expect(c.isDiagnosticFallback).toBe(true);
  });

  it("skips zero-amount entries from pairing and keeps the caller order", () => {
    const input = [
      makeAdjustment({ id: "adj-z", amount: 0, reason: "", approvedAt: "2025-09-03T09:00:00.000Z" }),
      makeAdjustment({ id: "adj-2", amount: -30_000, reason: "", approvedAt: "2025-09-02T09:00:00.000Z" }),
      makeAdjustment({ id: "adj-1", amount: 30_000, reason: "", approvedAt: "2025-09-01T09:00:00.000Z" }),
    ];
    const classified = classifyAdjustmentHistory(input);
    // Caller order preserved.
    expect(classified.map((c) => c.id)).toEqual(["adj-z", "adj-2", "adj-1"]);
    // Zero entry never pairs.
    expect(classified[0].pairedWithId).toBeNull();
    expect(classified[0].provenance).toBe("undocumented");
    // The ±30k pair is detected despite the input order.
    expect(classified[1].pairedWithId).toBe("adj-1");
    expect(classified[2].pairedWithId).toBe("adj-2");
  });
});
