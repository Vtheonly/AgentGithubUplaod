/**
 * T-442 (UI-323) — the per-year debt-origin breakdown engine suite
 * (docs/domain/financial-rules.md §17.3 INV-20e).
 *
 * Pins the ADDITIVE derivations the owner's issue mandates ("how much the
 * student owed for EACH individual year and exactly what those amounts
 * covered"):
 *
 *   1. The per-year SERVICE BREAKDOWN — the year's charges grouped by
 *      billable service (registration FI [tuition/T0] / scolarité per
 *      tranche [tuition/T1..T3] / transport / each other service
 *      category), each group with chargeCount, trancheNumbers, Σ due,
 *      Σ paid, Σ pending, Σ INV-4 remaining (INV-20a — stored columns
 *      and the SAME clamp only).
 *   2. The per-payment COVERAGE LINES — what each payment settled (the
 *      allocation rows: charge label, category, TARGET year, amount),
 *      including the cross-year case (a 2026-2027 payment settling
 *      2025-2026 debt carries targetYear "2025-2026" — INV-18c).
 *   3. The coverage-basis HONESTY — a legacy payment with no allocation
 *      records reports `coverageBasis: "unavailable"` (never a guessed
 *      coverage — INV-18d), and a bounced payment's retained allocation
 *      rows are NOT coverage (CALC-003).
 *   4. The per-year still-owed-now figure + the prior-years enumeration
 *      (Σ entries === the old single aggregate — the per-year
 *      composition, never a new number).
 *   5. Determinism (INV-20b) — same inputs + clock → identical records.
 *
 * Run:
 *   npx vitest run src/tests/domain/ledger/t-442-year-breakdown.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  computeParentYearHistory,
  YEAR_HISTORY_EPSILON_DZD,
} from "../../../domain/calc/ledger/year-history";
import type { Installment, Payment, PaymentAllocation } from "../../../domain/model/payment";
import type { LedgerEntry, LedgerEntryType } from "../../../domain/model/ledger";

/* ── The pinned clock + the tenant's academic years ────────────────── */

const NOW = new Date("2027-01-15T12:00:00.000Z");

const YEARS = [
  { id: "ay-2024", code: "2024-2025", startDate: "2024-09-01", endDate: "2025-06-30" },
  { id: "ay-2025", code: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" },
  { id: "ay-2026", code: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" },
] as const;

/* ── Fixture builders (the t-436 convention) ───────────────────────── */

let insSeq = 0;
function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  insSeq += 1;
  return {
    id: overrides.id ?? `ins-${insSeq}`,
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? "s-1",
    category: overrides.category ?? "tuition",
    label: overrides.label ?? "Tranche 1",
    trancheNumber: overrides.trancheNumber ?? 1,
    amountDue: overrides.amountDue ?? 0,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2025-09-15",
    paidDate: overrides.paidDate ?? null,
    status: overrides.status ?? "unpaid",
    academicYearId: overrides.academicYearId,
  };
}

let paySeq = 0;
function makePayment(overrides: Partial<Payment> = {}): Payment {
  paySeq += 1;
  return {
    id: overrides.id ?? `pay-${paySeq}`,
    tenantId: overrides.tenantId ?? "tenant-1",
    receiptNumber: overrides.receiptNumber ?? `REC-2026-${String(paySeq).padStart(6, "0")}`,
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? null,
    amount: overrides.amount ?? 0,
    method: overrides.method ?? "cash",
    status: overrides.status ?? "paid",
    category: overrides.category ?? null,
    installmentId: overrides.installmentId ?? null,
    proofUrl: null,
    notes: null,
    collectedBy: overrides.collectedBy ?? "usr-1",
    collectedAt: overrides.collectedAt ?? "2025-11-01T10:00:00.000Z",
    createdAt: overrides.collectedAt ?? "2025-11-01T10:00:00.000Z",
    updatedAt: overrides.collectedAt ?? "2025-11-01T10:00:00.000Z",
    academicYearId: overrides.academicYearId,
  };
}

let allocSeq = 0;
function makeAllocation(overrides: Partial<PaymentAllocation> = {}): PaymentAllocation {
  allocSeq += 1;
  return {
    id: overrides.id ?? `alloc-${allocSeq}`,
    paymentId: overrides.paymentId ?? "pay-1",
    chargeId: null,
    installmentId: overrides.installmentId ?? null,
    category: overrides.category ?? "tuition",
    allocatedAmount: overrides.allocatedAmount ?? 0,
    label: overrides.label ?? null,
    createdAt: overrides.createdAt ?? "2025-11-01T10:00:00.000Z",
    academicYearId: overrides.academicYearId,
  };
}

let ledSeq = 0;
function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  ledSeq += 1;
  return {
    id: overrides.id ?? `led-${ledSeq}`,
    tenantId: overrides.tenantId ?? "tenant-1",
    accountId: overrides.accountId ?? "parent:p-1:category:all",
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? null,
    category: overrides.category ?? null,
    amount: overrides.amount ?? -10_000,
    type: (overrides.type ?? "payment") as LedgerEntryType,
    sourceType: overrides.sourceType ?? "payment",
    sourceId: overrides.sourceId ?? "pay-1",
    method: overrides.method ?? "cash",
    receiptNumber: overrides.receiptNumber ?? null,
    paymentStatus: overrides.paymentStatus ?? "paid",
    reversesId: overrides.reversesId ?? null,
    description: overrides.description ?? "Encaissement",
    actorId: overrides.actorId ?? "usr-1",
    actorName: overrides.actorName ?? "Staff",
    at: overrides.at ?? "2025-11-01T10:00:00.000Z",
    metadata: overrides.metadata ?? {},
  };
}

/* ── THE T-442 SCENARIO — the owner's issue shape, three years, every ── */
/* ── billable service, per-year debt, partial payments, a bounced leg. ── */

/**
 * Parent p-1, the issue's exact mandate shape:
 *
 *  2024-2025 (CLOSED, left owing): FI 25,000 (paid) · T1 60,000 (40,000
 *  paid — 30,000 during the year + 10,000 by the 2026-2027 cross-year
 *  settlement; the stored amountPaid carries BOTH, as the server
 *  waterfall maintains) · T2 40,000 (unpaid) · transport T1 20,000
 *  (unpaid) · therapy_psychology 15,000 (unpaid) — the year the debt
 *  ORIGINATED.
 *
 *  2025-2026 (CLOSED, re-enrolled owing): FI 25,000 (paid) · T1 80,000
 *  (unpaid) — a second origin year with its own debt.
 *
 *  2026-2027 (OPEN, current): FI 25,000 (paid) · T1 90,000 (unpaid) ·
 *  transport T1 18,000 (unpaid) · canteen 12,000 (9,000 paid, 3,000
 *  remaining) — plus pay-X (a 2026-2027 payment with allocations
 *  settling OLD debt: 10,000 on 2024-2025 T1) and pay-B (a BOUNCED
 *  2026-2027 cheque whose retained allocation rows must NOT count as
 *  coverage — CALC-003), and pay-L (a legacy payment with NO allocation
 *  rows — the honest "unavailable" basis).
 */
function t442Scenario() {
  const installments: Installment[] = [
    // ── 2024-2025 ──
    makeInstallment({ id: "fi-24", label: "Frais d'inscription (FI)", trancheNumber: 0, amountDue: 25_000, amountPaid: 25_000, dueDate: "2024-09-15", paidDate: "2024-09-20", status: "paid", academicYearId: "ay-2024" }),
    makeInstallment({ id: "t1-24", label: "Tranche 1 — Scolarité (V1)", trancheNumber: 1, amountDue: 60_000, amountPaid: 40_000, dueDate: "2024-09-15", status: "partial", academicYearId: "ay-2024" }),
    makeInstallment({ id: "t2-24", label: "Tranche 2 — Scolarité (2V)", trancheNumber: 2, amountDue: 40_000, dueDate: "2024-12-15", status: "unpaid", academicYearId: "ay-2024" }),
    makeInstallment({ id: "tr1-24", label: "Transport T1", category: "transport", trancheNumber: 1, amountDue: 20_000, dueDate: "2024-09-15", status: "unpaid", academicYearId: "ay-2024" }),
    makeInstallment({ id: "psy-24", label: "Séance de psychologie", category: "therapy_psychology", trancheNumber: undefined, amountDue: 15_000, dueDate: "2024-10-01", status: "unpaid", academicYearId: "ay-2024" }),
    // ── 2025-2026 ──
    makeInstallment({ id: "fi-25", label: "Frais d'inscription (FI)", trancheNumber: 0, amountDue: 25_000, amountPaid: 25_000, dueDate: "2025-09-15", paidDate: "2025-09-18", status: "paid", academicYearId: "ay-2025" }),
    makeInstallment({ id: "t1-25", label: "Tranche 1 — Scolarité (V1)", trancheNumber: 1, amountDue: 80_000, dueDate: "2025-09-15", status: "unpaid", academicYearId: "ay-2025" }),
    // ── 2026-2027 (open) ──
    makeInstallment({ id: "fi-26", label: "Frais d'inscription (FI)", trancheNumber: 0, amountDue: 25_000, amountPaid: 25_000, dueDate: "2026-09-15", paidDate: "2026-09-20", status: "paid", academicYearId: "ay-2026" }),
    makeInstallment({ id: "t1-26", label: "Tranche 1 — Scolarité (V1)", trancheNumber: 1, amountDue: 90_000, dueDate: "2026-09-15", status: "unpaid", academicYearId: "ay-2026" }),
    makeInstallment({ id: "tr1-26", label: "Transport T1", category: "transport", trancheNumber: 1, amountDue: 18_000, dueDate: "2026-09-15", status: "unpaid", academicYearId: "ay-2026" }),
    makeInstallment({ id: "can-26", label: "Cantine", category: "canteen", trancheNumber: undefined, amountDue: 12_000, amountPaid: 9_000, dueDate: "2026-10-01", status: "partial", academicYearId: "ay-2026" }),
  ];
  const payments: Payment[] = [
    makePayment({ id: "pay-24a", amount: 25_000, collectedAt: "2024-09-20T10:00:00.000Z", receiptNumber: "REC-2024-000001", academicYearId: "ay-2024" }),
    makePayment({ id: "pay-24b", amount: 30_000, collectedAt: "2024-11-05T10:00:00.000Z", receiptNumber: "REC-2024-000002", academicYearId: "ay-2024" }),
    makePayment({ id: "pay-25a", amount: 25_000, collectedAt: "2025-09-18T10:00:00.000Z", receiptNumber: "REC-2025-000001", academicYearId: "ay-2025" }),
    makePayment({ id: "pay-26a", amount: 34_000, collectedAt: "2026-09-25T10:00:00.000Z", receiptNumber: "REC-2026-000001", academicYearId: "ay-2026" }),
    // pay-X: settles OLD debt (10,000 on 2024-2025 T1) + current-year items.
    makePayment({ id: "pay-26x", amount: 44_000, collectedAt: "2026-12-10T10:00:00.000Z", receiptNumber: "REC-2026-000002", academicYearId: "ay-2026" }),
    // pay-B: a BOUNCED cheque — retained allocation rows are NOT funds.
    makePayment({ id: "pay-26b", amount: 5_000, method: "check", status: "unpaid", collectedAt: "2026-12-20T10:00:00.000Z", receiptNumber: "REC-2026-000003", academicYearId: "ay-2026" }),
    // pay-L: a legacy payment with NO allocation rows (the import-era corpus).
    makePayment({ id: "pay-26l", amount: 8_000, collectedAt: "2027-01-05T10:00:00.000Z", receiptNumber: "REC-2027-000001", academicYearId: "ay-2026" }),
  ];
  const allocations: PaymentAllocation[] = [
    makeAllocation({ paymentId: "pay-24a", installmentId: "fi-24", category: "tuition", allocatedAmount: 25_000, label: "Frais d'inscription (FI)", createdAt: "2024-09-20T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-24b", installmentId: "t1-24", category: "tuition", allocatedAmount: 30_000, label: "Tranche 1 — Scolarité (V1)", createdAt: "2024-11-05T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-25a", installmentId: "fi-25", category: "tuition", allocatedAmount: 25_000, label: "Frais d'inscription (FI)", createdAt: "2025-09-18T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-26a", installmentId: "fi-26", category: "tuition", allocatedAmount: 25_000, label: "Frais d'inscription (FI)", createdAt: "2026-09-25T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-26a", installmentId: "can-26", category: "canteen", allocatedAmount: 9_000, label: "Cantine", createdAt: "2026-09-25T10:00:00.000Z" }),
    // pay-X: 10,000 settles the OLD 2024-2025 T1; 25,000 + 9,000 on current-year items.
    makeAllocation({ paymentId: "pay-26x", installmentId: "t1-24", category: "tuition", allocatedAmount: 10_000, label: "Tranche 1 — Scolarité (V1)", createdAt: "2026-12-10T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-26x", installmentId: "t1-26", category: "tuition", allocatedAmount: 25_000, label: "Tranche 1 — Scolarité (V1)", createdAt: "2026-12-10T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-26x", installmentId: "tr1-26", category: "transport", allocatedAmount: 9_000, label: "Transport T1", createdAt: "2026-12-10T10:00:00.000Z" }),
    // pay-B's retained allocation rows (the 0039 bounce never deletes them).
    makeAllocation({ paymentId: "pay-26b", installmentId: "can-26", category: "canteen", allocatedAmount: 5_000, label: "Cantine", createdAt: "2026-12-20T10:00:00.000Z" }),
    // NO allocations for pay-26l (the legacy corpus shape).
  ];
  const ledgerEntries: LedgerEntry[] = [
    makeEntry({ id: "led-24a", sourceId: "pay-24a", amount: -25_000, at: "2024-09-20T10:00:00.000Z", receiptNumber: "REC-2024-000001" }),
    makeEntry({ id: "led-24b", sourceId: "pay-24b", amount: -30_000, at: "2024-11-05T10:00:00.000Z", receiptNumber: "REC-2024-000002" }),
    makeEntry({ id: "led-25a", sourceId: "pay-25a", amount: -25_000, at: "2025-09-18T10:00:00.000Z", receiptNumber: "REC-2025-000001" }),
    makeEntry({ id: "led-26a", sourceId: "pay-26a", amount: -34_000, at: "2026-09-25T10:00:00.000Z", receiptNumber: "REC-2026-000001" }),
    makeEntry({ id: "led-26x", sourceId: "pay-26x", amount: -44_000, at: "2026-12-10T10:00:00.000Z", receiptNumber: "REC-2026-000002" }),
    makeEntry({ id: "led-26b", sourceId: "pay-26b", amount: -5_000, at: "2026-12-20T10:00:00.000Z", receiptNumber: "REC-2026-000003", paymentStatus: "unpaid" }),
    makeEntry({ id: "led-26l", sourceId: "pay-26l", amount: -8_000, at: "2027-01-05T10:00:00.000Z", receiptNumber: "REC-2027-000001" }),
  ];
  return { installments, payments, allocations, ledgerEntries };
}

function t442History() {
  const s = t442Scenario();
  return computeParentYearHistory({
    parentId: "p-1",
    installments: s.installments,
    payments: s.payments,
    allocations: s.allocations,
    ledgerEntries: s.ledgerEntries,
    academicYears: YEARS,
    now: NOW,
  });
}

/* ── 1. The per-year service breakdown ─────────────────────────────── */

describe("T-442 — the per-year service breakdown (INV-20e)", () => {
  const history = t442History();

  it("2024-2025 groups its charges by billable service: FI / scolarité / transport / the therapy service — in the canonical order", () => {
    const y = history.years.find((r) => r.academicYear === "2024-2025")!;
    expect(y.serviceBreakdown.map((g) => g.key)).toEqual([
      "registration",
      "tuition",
      "transport",
      "service",
    ]);
    expect(y.serviceBreakdown.map((g) => g.category)).toEqual([
      "tuition",
      "tuition",
      "transport",
      "therapy_psychology",
    ]);
  });

  it("the registration group is the FI alone (tuition/T0 — a fee, not a tranche): 25,000 due, 25,000 paid, 0 remaining", () => {
    const y = history.years.find((r) => r.academicYear === "2024-2025")!;
    const fi = y.serviceBreakdown[0];
    expect(fi.key).toBe("registration");
    expect(fi.chargeCount).toBe(1);
    expect(fi.trancheNumbers).toEqual([0]);
    expect(fi.charges.map((c) => c.installmentId)).toEqual(["fi-24"]);
    expect(fi.amountDue).toBe(25_000);
    expect(fi.amountPaid).toBe(25_000);
    expect(fi.remaining).toBe(0);
  });

  it("the tuition group carries the tranches with their per-tranche facts summed (INV-20a — stored columns only)", () => {
    const y = history.years.find((r) => r.academicYear === "2024-2025")!;
    const tuition = y.serviceBreakdown[1];
    expect(tuition.chargeCount).toBe(2); // T1 + T2 (no T3 this year)
    expect(tuition.trancheNumbers).toEqual([1, 2]);
    expect(tuition.amountDue).toBe(100_000); // 60,000 + 40,000
    expect(tuition.amountPaid).toBe(40_000); // the STORED column: 30,000 in-year + the 10,000 cross-year settlement
    expect(tuition.remaining).toBe(60_000); // the INV-4 sums: 20,000 + 40,000
  });

  it("the transport group and each OTHER service category are separate groups (\"any other services or charges\" — each individually visible)", () => {
    const y = history.years.find((r) => r.academicYear === "2024-2025")!;
    const transport = y.serviceBreakdown[2];
    expect(transport.key).toBe("transport");
    expect(transport.amountDue).toBe(20_000);
    expect(transport.remaining).toBe(20_000);
    const therapy = y.serviceBreakdown[3];
    expect(therapy.key).toBe("service");
    expect(therapy.category).toBe("therapy_psychology");
    expect(therapy.amountDue).toBe(15_000);
    expect(therapy.remaining).toBe(15_000);
  });

  it("2026-2027 (the open year) groups the canteen service separately from tuition/transport, with the partial payment reflected", () => {
    const y = history.years.find((r) => r.academicYear === "2026-2027")!;
    const keys = y.serviceBreakdown.map((g) => g.key);
    expect(keys).toEqual(["registration", "tuition", "transport", "service"]);
    const canteen = y.serviceBreakdown.find((g) => g.category === "canteen")!;
    expect(canteen.amountDue).toBe(12_000);
    expect(canteen.amountPaid).toBe(9_000);
    expect(canteen.remaining).toBe(3_000);
  });

  it("INV-20a pin: every group's amounts are exactly the Σ stored columns / Σ INV-4 remaining over its charges — and the groups PARTITION the year's charges", () => {
    for (const y of history.years) {
      // Partition: every charge appears in exactly one group.
      const grouped = y.serviceBreakdown.flatMap((g) => g.charges.map((c) => c.installmentId));
      expect(grouped.sort()).toEqual([...y.charges.map((c) => c.installmentId)].sort());
      // The group sums equal the direct sums (no new numbers).
      for (const g of y.serviceBreakdown) {
        expect(g.amountDue).toBe(g.charges.reduce((s, c) => s + c.amountDue, 0));
        expect(g.amountPaid).toBe(g.charges.reduce((s, c) => s + c.amountPaid, 0));
        expect(g.amountPending).toBe(g.charges.reduce((s, c) => s + c.amountPending, 0));
        expect(g.remaining).toBe(g.charges.reduce((s, c) => s + c.remaining, 0));
      }
      // Σ groups === the year's totals.
      expect(y.serviceBreakdown.reduce((s, g) => s + g.amountDue, 0)).toBe(y.totalCharged);
    }
  });
});

/* ── 2. The per-payment coverage lines ─────────────────────────────── */

describe("T-442 — the per-payment coverage lines (what each payment covered)", () => {
  const history = t442History();

  it("a payment's coverage lists EVERY charge it settled, with the charge label, the category, the amount, and the TARGET year", () => {
    const y = history.years.find((r) => r.academicYear === "2024-2025")!;
    const pay24b = y.paymentsMadeInYear.find((p) => p.paymentId === "pay-24b")!;
    expect(pay24b.coverageBasis).toBe("allocations");
    expect(pay24b.coveredCharges).toEqual([
      {
        installmentId: "t1-24",
        chargeLabel: "Tranche 1 — Scolarité (V1)",
        category: "tuition",
        targetYear: "2024-2025",
        allocatedAmount: 30_000,
      },
    ]);
  });

  it("the CROSS-YEAR case: the 2026-2027 payment that settles 2024-2025 debt carries targetYear \"2024-2025\" on that line (INV-18c — the charge's year, never the payment's)", () => {
    const y = history.years.find((r) => r.academicYear === "2026-2027")!;
    const pay26x = y.paymentsMadeInYear.find((p) => p.paymentId === "pay-26x")!;
    expect(pay26x.coverageBasis).toBe("allocations");
    expect(pay26x.coveredCharges).toHaveLength(3);
    const oldDebtLine = pay26x.coveredCharges.find((l) => l.installmentId === "t1-24")!;
    expect(oldDebtLine.targetYear).toBe("2024-2025");
    expect(oldDebtLine.allocatedAmount).toBe(10_000);
    expect(oldDebtLine.chargeLabel).toBe("Tranche 1 — Scolarité (V1)");
    // The same-year lines carry the current year.
    for (const line of pay26x.coveredCharges.filter((l) => l.installmentId !== "t1-24")) {
      expect(line.targetYear).toBe("2026-2027");
    }
  });

  it("the multi-service payment's coverage spans categories (FI + canteen in ONE payment)", () => {
    const y = history.years.find((r) => r.academicYear === "2026-2027")!;
    const pay26a = y.paymentsMadeInYear.find((p) => p.paymentId === "pay-26a")!;
    expect(pay26a.coveredCharges.map((l) => l.category).sort()).toEqual(["canteen", "tuition"]);
    expect(pay26a.coveredCharges.reduce((s, l) => s + l.allocatedAmount, 0)).toBe(34_000);
  });

  it("CALC-003: a BOUNCED payment's retained allocation rows are NOT coverage — the basis is honestly \"unavailable\"", () => {
    const y = history.years.find((r) => r.academicYear === "2026-2027")!;
    const pay26b = y.paymentsMadeInYear.find((p) => p.paymentId === "pay-26b")!;
    expect(pay26b.coveredCharges).toEqual([]);
    expect(pay26b.coverageBasis).toBe("unavailable");
  });

  it("a legacy payment with NO allocation records reports the honest \"unavailable\" basis — never a guessed coverage (INV-18d)", () => {
    const y = history.years.find((r) => r.academicYear === "2026-2027")!;
    const pay26l = y.paymentsMadeInYear.find((p) => p.paymentId === "pay-26l")!;
    expect(pay26l.coveredCharges).toEqual([]);
    expect(pay26l.coverageBasis).toBe("unavailable");
  });
});

/* ── 3. The per-year still-owed-now + the prior-years enumeration ──── */

describe("T-442 — the per-year still-owed-now figure + the prior-years enumeration", () => {
  const history = t442History();

  it("2024-2025's outstandingStillOwedNow is the year's CURRENT INV-4 remaining (post the 2026-2027 cross-year settlement)", () => {
    const y24 = history.years.find((r) => r.academicYear === "2024-2025")!;
    // T1: 60,000 − 30,000 − 10,000 = 20,000 · T2: 40,000 · transport: 20,000 · therapy: 15,000.
    expect(y24.outstandingStillOwedNow).toBe(95_000);
  });

  it("2025-2026's outstandingStillOwedNow is its own 80,000 (its own origin-year debt)", () => {
    const y25 = history.years.find((r) => r.academicYear === "2025-2026")!;
    expect(y25.outstandingStillOwedNow).toBe(80_000);
  });

  it("the prior-years enumeration lists EACH prior year with its outstanding — the per-year composition the owner mandated", () => {
    expect(history.priorYearsStillOwed).toEqual([
      { academicYear: "2024-2025", outstanding: 95_000 },
      { academicYear: "2025-2026", outstanding: 80_000 },
    ]);
  });

  it("INV-20a pin: Σ priorYearsStillOwed === the single priorYearOutstandingStillOwed aggregate (the enumeration, never a new number)", () => {
    const sum = history.priorYearsStillOwed.reduce((s, x) => s + x.outstanding, 0);
    expect(sum).toBe(history.priorYearOutstandingStillOwed);
    expect(history.priorYearOutstandingStillOwed).toBe(175_000);
  });

  it("a fully-settled prior year is ABSENT from the enumeration (only years with outstanding > epsilon appear)", () => {
    // Recompute with 2024-2025 fully paid: every charge settled.
    const s = t442Scenario();
    for (const ins of s.installments) {
      if (ins.academicYearId === "ay-2024") {
        Object.assign(ins, {
          amountPaid: ins.amountDue,
          amountPending: 0,
          status: "paid",
          paidDate: "2025-06-01",
        } as Partial<Installment>);
      }
    }
    const history2 = computeParentYearHistory({
      parentId: "p-1",
      installments: s.installments,
      payments: s.payments,
      allocations: s.allocations,
      ledgerEntries: s.ledgerEntries,
      academicYears: YEARS,
      now: NOW,
    });
    expect(history2.priorYearsStillOwed).toEqual([
      { academicYear: "2025-2026", outstanding: 80_000 },
    ]);
    expect(history2.years.find((r) => r.academicYear === "2024-2025")!.outstandingStillOwedNow).toBeLessThanOrEqual(
      YEAR_HISTORY_EPSILON_DZD,
    );
  });
});

/* ── 4. Determinism (INV-20b) ──────────────────────────────────────── */

describe("T-442 — determinism", () => {
  it("same inputs + same clock → byte-identical records (the new derivations included)", () => {
    const a = t442History();
    const b = t442History();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
