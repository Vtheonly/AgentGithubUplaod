/**
 * T-411 Phase 2 (DUP-006 re-base) regression suite — 95th session.
 *
 * Pins the diagnostic engine's canonical re-base:
 *
 * 1. DATA-024: the family credit comes from `computeParentSummary` +
 *    `displayParentCredit` (ADR-010) — a REVERSED credit no longer shows,
 *    and the 0062-era raw-negative-balance overpayer derives correctly.
 *
 * 2. DATA-023: tranche velocity groups by the canonical `trancheNumber` —
 *    labels like "Sonde CRUD T396 — T1" or "3ème TRANCHE (2V)" can no
 *    longer pollute the rates (the retired `label.includes` hack).
 *
 * 3. DATA-029: per-service cleared derives from `payment_allocations` —
 *    a payment whose ROW category is "other" but whose waterfall
 *    allocation satisfied tuition counts as TUITION cleared.
 *
 * 4. FA-07: the 30-day inflow forecast is the honest sum (overdue ≤ 30 j
 *    outstanding + INV-4 remaining of tranches due within 30 days) — no
 *    ×0.85 factor.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateFamilyFinancialDiagnoses,
  computeCrossServicePerformance,
  computeTreasuryHealth,
} from "../../../domain/calc/payment/financial-query-engine";
import type {
  Installment,
  Payment,
  PaymentAllocation,
  DebtSummary,
} from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";

function makeParent(overrides: Partial<Parent> = {}): Parent {
  return {
    id: overrides.id ?? "p-1",
    tenantId: "t-1",
    code: overrides.code ?? "PAR-1",
    firstName: overrides.firstName ?? "Alice",
    lastName: overrides.lastName ?? "Probe",
    phone: overrides.phone ?? "0550000000",
    isActive: true,
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
  } as unknown as Parent;
}

function makeStudent(parentId: string): Student {
  return {
    id: `s-${parentId}`,
    tenantId: "t-1",
    parentId,
    firstName: "Kid",
    lastName: "Probe",
    displayName: "Kid Probe",
    isActive: true,
  } as unknown as Student;
}

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: overrides.parentId ?? "p-1",
    studentId: null,
    category: overrides.category ?? "tuition",
    label: overrides.label ?? "Tranche 1",
    amountDue: overrides.amountDue ?? 100_000,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2025-09-15",
    paidDate: null,
    status: overrides.status ?? "pending",
    trancheNumber: overrides.trancheNumber,
  };
}

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: overrides.id ?? "led-1",
    tenantId: "t-1",
    accountId: overrides.accountId ?? "parent:p-1:category:tuition",
    parentId: overrides.parentId ?? "p-1",
    studentId: null,
    category: overrides.category ?? "tuition",
    amount: overrides.amount ?? 100_000,
    type: overrides.type ?? "charge",
    sourceType: overrides.sourceType ?? "installment",
    sourceId: overrides.sourceId ?? "src-1",
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: overrides.reversesId ?? null,
    description: overrides.description ?? "probe",
    actorId: "usr-1",
    actorName: "probe",
    at: overrides.at ?? "2025-09-01",
    metadata: {},
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: overrides.id ?? "pay-1",
    tenantId: "t-1",
    receiptNumber: overrides.receiptNumber ?? "REC-2025-000001",
    parentId: overrides.parentId ?? "p-1",
    studentId: null,
    amount: overrides.amount ?? 50_000,
    method: overrides.method ?? "cash",
    status: overrides.status ?? "paid",
    category: overrides.category ?? "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-1",
    collectedAt: overrides.collectedAt ?? "2025-10-01",
    createdAt: "2025-10-01",
    updatedAt: "2025-10-01",
  };
}

function makeAllocation(overrides: Partial<PaymentAllocation> = {}): PaymentAllocation {
  return {
    id: overrides.id ?? "alloc-1",
    paymentId: overrides.paymentId ?? "pay-1",
    chargeId: null,
    installmentId: null,
    category: overrides.category ?? "tuition",
    allocatedAmount: overrides.allocatedAmount ?? 50_000,
    label: null,
    createdAt: "2025-10-01",
  };
}

describe("T-411 Phase 2 — DATA-024 canonical credit (displayParentCredit basis)", () => {
  it("a reversed parent_credit entry does NOT surface as available credit", () => {
    const parent = makeParent();
    // charge 100k + a booked credit -30k that was later REVERSED (+30k)
    const entries = [
      makeLedgerEntry({ id: "l1", type: "charge", amount: 100_000, at: "2025-09-01" }),
      makeLedgerEntry({
        id: "l2", type: "adjustment", category: "parent_credit",
        accountId: "parent:p-1:category:parent_credit", amount: -30_000, at: "2025-09-02",
      }),
      makeLedgerEntry({
        id: "l3", type: "reversal", category: "parent_credit",
        accountId: "parent:p-1:category:parent_credit", amount: 30_000,
        reversesId: "l2", at: "2025-09-03",
      }),
    ];
    const [diag] = evaluateFamilyFinancialDiagnoses({
      parents: [parent],
      students: [makeStudent(parent.id)],
      installments: [makeInstallment({ amountDue: 100_000, amountPaid: 0 })],
      payments: [],
      ledgerEntries: entries,
      debtSummaries: [],
    });
    // The raw parent_credit filter (the OLD engine) summed |−30k| = 30k even
    // though the credit was reversed. The canonical derivation shows 0
    // (balance 100k is a debt, not a credit).
    expect(diag.unallocatedCredit).toBe(0);
  });

  it("a canonical overpayment shows the BOOKED credit (ADR-010 double-count corrected)", () => {
    const parent = makeParent();
    // charge 100k, payment −150k on tuition, credit −50k on parent_credit
    const entries = [
      makeLedgerEntry({ id: "l1", type: "charge", amount: 100_000 }),
      makeLedgerEntry({ id: "l2", type: "payment", amount: -150_000, receiptNumber: "R1" }),
      makeLedgerEntry({
        id: "l3", type: "adjustment", category: "parent_credit",
        accountId: "parent:p-1:category:parent_credit", amount: -50_000,
      }),
    ];
    const [diag] = evaluateFamilyFinancialDiagnoses({
      parents: [parent],
      students: [makeStudent(parent.id)],
      installments: [makeInstallment({ amountDue: 100_000, amountPaid: 100_000, status: "paid" })],
      payments: [makePayment({ amount: 150_000 })],
      ledgerEntries: entries,
      debtSummaries: [],
    });
    // balance = 100k − 150k − 50k = −100k (raw), booked credit = 50k → the
    // display convention picks the BOOKED 50k, never the raw −100k.
    expect(diag.unallocatedCredit).toBe(50_000);
  });

  it("totalDue/totalPaid match the ledger dossier basis (charges + adjustments / totalPaid)", () => {
    const parent = makeParent();
    const entries = [
      makeLedgerEntry({ id: "l1", type: "charge", amount: 100_000 }),
      makeLedgerEntry({
        id: "l2", type: "adjustment", category: "tuition", amount: -10_000,
      }),
      makeLedgerEntry({ id: "l3", type: "payment", amount: -40_000 }),
    ];
    const [diag] = evaluateFamilyFinancialDiagnoses({
      parents: [parent],
      students: [makeStudent(parent.id)],
      installments: [makeInstallment({ amountDue: 90_000, amountPaid: 40_000 })],
      payments: [makePayment({ amount: 40_000 })],
      ledgerEntries: entries,
      debtSummaries: [],
    });
    expect(diag.totalDue).toBe(90_000); // net due = charged + adjusted
    expect(diag.totalPaid).toBe(40_000); // ledger totalPaid
  });
});

describe("T-411 Phase 2 — DATA-023 canonical tranche waves (trancheNumber, never labels)", () => {
  it("t1 detection ignores transport rows and label text; targets the tuition wave-1 tranche", () => {
    const parent = makeParent();
    const installments = [
      // A transport row whose LABEL contains "1" (the old hack matched it)
      makeInstallment({
        id: "x1", category: "transport", label: "Transport 1er versement",
        trancheNumber: 1, amountDue: 20_000, amountPending: 20_000, status: "overdue",
        dueDate: "2024-09-01",
      }),
      // The REAL tuition T1, fully paid
      makeInstallment({
        id: "t1", category: "tuition", label: "INSCRIPTION (FI)",
        trancheNumber: 1, amountDue: 80_000, amountPaid: 80_000, status: "paid",
      }),
    ];
    const [diag] = evaluateFamilyFinancialDiagnoses({
      parents: [parent],
      students: [makeStudent(parent.id)],
      installments,
      payments: [],
      ledgerEntries: [],
      debtSummaries: [{ parentId: parent.id, parentName: "x", parentPhone: "", studentCount: 1, outstandingAmount: 20_000, daysOverdue: 90, bucket: "91_180" }],
    });
    // Old engine: t1Unpaid = true (transport label contains "1") → false
    // early_default_critical. New engine: tuition T1 is paid → no anomaly.
    expect(diag.anomalies).not.toContain("early_default_critical");
  });

  it("early_default_critical fires when the TUITION wave-1 tranche is unpaid and overdue > 60d", () => {
    const parent = makeParent();
    const installments = [
      makeInstallment({
        id: "t1", category: "tuition", label: "INSCRIPTION (FI)",
        trancheNumber: 1, amountDue: 80_000, status: "overdue", dueDate: "2024-09-01",
      }),
    ];
    const [diag] = evaluateFamilyFinancialDiagnoses({
      parents: [parent],
      students: [makeStudent(parent.id)],
      installments,
      payments: [],
      ledgerEntries: [],
      debtSummaries: [{ parentId: parent.id, parentName: "x", parentPhone: "", studentCount: 1, outstandingAmount: 80_000, daysOverdue: 90, bucket: "91_180" }],
    });
    expect(diag.anomalies).toContain("early_default_critical");
  });

  it("treasury rates group by trancheNumber — probe-style labels cannot pollute them", () => {
    const installments = [
      // Old hack: "Sonde CRUD T396 — T1" contains "1" → polluted T1 rate.
      makeInstallment({
        id: "probe", category: "tuition", label: "Sonde CRUD T396 — T1",
        trancheNumber: 2, amountDue: 10_000, amountPaid: 10_000, status: "paid",
      }),
      makeInstallment({
        id: "real-t1", category: "tuition", label: "INSCRIPTION (FI)",
        trancheNumber: 1, amountDue: 100_000, amountPaid: 50_000,
      }),
      makeInstallment({
        id: "real-t3", category: "tuition", label: "3ème TRANCHE (2V)",
        trancheNumber: 3, amountDue: 100_000, amountPaid: 100_000, status: "paid",
      }),
    ];
    const t = computeTreasuryHealth({
      payments: [],
      installments,
      expenses: [],
      debtSummaries: [],
    });
    // T1: 50k/100k = 50%. The probe row (trancheNumber 2) must NOT count.
    expect(t.t1CollectionRate).toBe(50);
    // T2: the probe row only → 100%.
    expect(t.t2CollectionRate).toBe(100);
    // T3: "3ème TRANCHE (2V)" — the old hack ALSO matched "2" here.
    expect(t.t3CollectionRate).toBe(100);
  });
});

describe("T-411 Phase 2 — DATA-029 per-service cleared from payment_allocations", () => {
  it("a payment filed under row-category 'other' but allocated to tuition counts as TUITION", () => {
    const installments = [
      makeInstallment({ id: "t1", category: "tuition", amountDue: 100_000, amountPaid: 80_000 }),
      makeInstallment({ id: "x1", category: "transport", amountDue: 20_000, amountPaid: 0 }),
    ];
    // BUSINESS-106-era shape: the payment ROW says "other", but the
    // waterfall (cross-category) actually satisfied tuition 80k + transport 20k.
    const payments = [
      makePayment({ id: "pay-1", amount: 100_000, category: "other", status: "paid" }),
    ];
    const allocations = [
      makeAllocation({ paymentId: "pay-1", category: "tuition", allocatedAmount: 80_000 }),
      makeAllocation({ paymentId: "pay-1", category: "transport", allocatedAmount: 20_000 }),
    ];
    const rows = computeCrossServicePerformance({ installments, payments, allocations });
    const tuition = rows.find((r) => r.category === "tuition");
    const transport = rows.find((r) => r.category === "transport");
    expect(tuition?.totalCleared).toBe(80_000);
    expect(transport?.totalCleared).toBe(20_000);
    // The old engine read payments.category → "other" got 100k, tuition 0.
    const other = rows.find((r) => r.category === "other");
    expect(other?.totalCleared ?? 0).toBe(0);
  });

  it("an overpayment-turned-credit does not inflate in-category cleared", () => {
    const installments = [
      makeInstallment({ id: "t1", category: "tuition", amountDue: 100_000, amountPaid: 100_000, status: "paid" }),
    ];
    // 150k payment: 100k allocated to tuition, 50k became parent_credit.
    const payments = [makePayment({ id: "pay-1", amount: 150_000, category: "tuition" })];
    const allocations = [makeAllocation({ paymentId: "pay-1", category: "tuition", allocatedAmount: 100_000 })];
    const rows = computeCrossServicePerformance({ installments, payments, allocations });
    const tuition = rows.find((r) => r.category === "tuition")!;
    // Old engine: payments.category basis → 150k cleared > 100k billed
    // (recoveryRate capped but internally inconsistent). Now: exactly 100k.
    expect(tuition.totalCleared).toBe(100_000);
    expect(tuition.recoveryRate).toBe(100);
    expect(tuition.outstandingDebt).toBe(0);
  });

  it("legacy payments without allocation rows fall back to the payment-row category", () => {
    const installments = [
      makeInstallment({ id: "t1", category: "tuition", amountDue: 50_000, amountPaid: 50_000, status: "paid" }),
    ];
    const payments = [makePayment({ id: "pay-old", amount: 50_000, category: "tuition" })];
    const rows = computeCrossServicePerformance({ installments, payments, allocations: [] });
    expect(rows.find((r) => r.category === "tuition")?.totalCleared).toBe(50_000);
  });

  it("the retired fictional services (CALC-001) are not listed", () => {
    const rows = computeCrossServicePerformance({
      installments: [makeInstallment({ category: "tuition" })],
      payments: [],
      allocations: [],
    });
    const listed = rows.map((r) => r.category);
    expect(listed).not.toContain("canteen");
    expect(listed).not.toContain("uniform");
    expect(listed).not.toContain("books");
    expect(listed).not.toContain("extracurricular");
  });
});

describe("T-411 Phase 2 — FA-07 honest 30-day inflow forecast (no ×0.85)", () => {
  it("sums overdue ≤ 30j outstanding + INV-4 remaining of tranches due within 30 days", () => {
    const now = new Date().toISOString();
    const in20Days = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const in60Days = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const installments = [
      // due in 20 days, 30k remaining → counted
      makeInstallment({ id: "up1", amountDue: 50_000, amountPaid: 20_000, dueDate: in20Days }),
      // due in 60 days → NOT counted
      makeInstallment({ id: "up2", amountDue: 40_000, dueDate: in60Days }),
    ];
    const debtSummaries: DebtSummary[] = [
      // overdue 10 days, 20k → counted
      { parentId: "p-9", parentName: "x", parentPhone: "", studentCount: 1, outstandingAmount: 20_000, daysOverdue: 10, bucket: "0_30" },
      // overdue 90 days → NOT counted (outside the 30-day window)
      { parentId: "p-8", parentName: "y", parentPhone: "", studentCount: 1, outstandingAmount: 70_000, daysOverdue: 90, bucket: "91_180" },
      // never overdue (future-due debtor, daysOverdue = 0) → NOT counted here
      { parentId: "p-7", parentName: "z", parentPhone: "", studentCount: 1, outstandingAmount: 10_000, daysOverdue: 0, bucket: "0_30" },
    ];
    const t = computeTreasuryHealth({
      payments: [],
      installments,
      expenses: [],
      debtSummaries,
    });
    // 20k (overdue ≤30j) + 30k (due within 30d, INV-4 remaining) = 50k.
    // The old engine: 100k × 0.85 = 85k (all debtors incl. 90d + never-overdue).
    expect(t.expectedInflow30d).toBe(50_000);
  });
});
