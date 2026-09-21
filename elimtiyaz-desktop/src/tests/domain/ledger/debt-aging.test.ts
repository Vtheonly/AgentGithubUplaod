/**
 * Unit tests for the canonical cross-year debt-aging engine (T-405,
 * docs/domain/financial-rules.md §15).
 *
 * The two ARCHETYPE fixtures are the task's own definition of correct:
 *
 *   Parent A — owes 100,000 DZD originating 2024-2025 but has kept paying
 *   monthly through 2025-2026 → GREEN / active_payer (old debt + continued
 *   payment is NOT delinquency).
 *
 *   Parent B — owes 100,000 DZD originating 2024-2025 and has made no
 *   meaningful payment since → RED / critical_delinquency.
 *
 * Both have the SAME outstanding amount and the SAME origin year — the
 * status differs ONLY through payment behavior. That is the whole point of
 * T-405, pinned here so no platform mirror can regress it.
 */
import { describe, it, expect } from "vitest";
import {
  computeDebtAgingAnalysis,
  computeDebtAgingStatus,
  resolveAcademicYearForDate,
  academicYearStart,
  DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS,
  DEBT_AGING_SUSTAINED_DAYS,
  DEBT_AGING_CRITICAL_DAYS,
  DEBT_AGING_EPSILON_DZD,
} from "../../../domain/calc/ledger/debt-aging";
import type { Installment } from "../../../domain/model/payment";
import type { LedgerEntry, LedgerEntryType } from "../../../domain/model/ledger";

/* ── Fixture builders ─────────────────────────────────────────────── */

const NOW = new Date("2026-06-15T12:00:00.000Z");

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: overrides.parentId ?? "p-A",
    studentId: overrides.studentId ?? null,
    category: overrides.category ?? "tuition",
    label: overrides.label ?? "Tranche 1",
    amountDue: overrides.amountDue ?? 100_000,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2024-10-15",
    paidDate: overrides.paidDate ?? null,
    status: overrides.status ?? "unpaid",
  };
}

let entrySeq = 0;
function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  entrySeq += 1;
  return {
    id: overrides.id ?? `led-${entrySeq}`,
    tenantId: overrides.tenantId ?? "tenant-1",
    accountId: overrides.accountId ?? "parent:p-A:category:tuition",
    parentId: overrides.parentId ?? "p-A",
    studentId: overrides.studentId ?? null,
    category: overrides.category ?? "tuition",
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
    at: overrides.at ?? "2026-06-01T10:00:00.000Z",
    metadata: overrides.metadata ?? {},
  };
}

/** A monthly payer through the subsequent year (Parent A archetype). */
function monthlyPayerEntries(parentId: string, from: string, months: number): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const start = new Date(from);
  for (let i = 0; i < months; i += 1) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + i);
    entries.push(
      makeEntry({
        id: `led-pay-${parentId}-${i}`,
        parentId,
        accountId: `parent:${parentId}:category:tuition`,
        at: d.toISOString(),
        amount: -8_000,
      }),
    );
  }
  return entries;
}

/* ── The two archetypes ───────────────────────────────────────────── */

describe("T-405 debt aging — the two archetype parents", () => {
  it("Parent A: old debt + continued monthly payment → GREEN / active_payer", () => {
    // Debt originated 2024-2025 (due 2024-10-15), still 100,000 outstanding.
    // Payments every month Sep 2025 → Jun 2026 (last: 2026-06-05, 10 days ago).
    const installments = [
      makeInstallment({ parentId: "p-A", id: "ins-A", amountDue: 100_000, dueDate: "2024-10-15" }),
    ];
    const payments = monthlyPayerEntries("p-A", "2025-09-05T10:00:00.000Z", 10);
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments,
      ledgerEntries: payments,
      academicYears: [],
      now: NOW,
    });

    // The facts:
    expect(analysis.outstandingAmount).toBe(100_000);
    expect(analysis.originAcademicYear).toBe("2024-2025");
    expect(analysis.oldestDueDate).toBe("2024-10-15");
    // Debt age from the ORIGINAL due date (never reset): 2024-10-15 → 2026-06-15 = 608 days.
    expect(analysis.debtAgeDays).toBe(608);
    expect(analysis.lastPaymentAt).toBe(payments[payments.length - 1].at);
    expect(analysis.daysSinceLastPayment).toBe(10);
    expect(analysis.inactivityDays).toBe(10);
    // Subsequent-year payments: Sep 2025 onwards = 2025-2026 > 2024-2025.
    expect(analysis.hasSubsequentYearPayments).toBe(true);
    expect(analysis.subsequentYearPaymentCount).toBe(10);
    expect(analysis.subsequentYearPaymentTotal).toBe(80_000);

    // The status:
    expect(analysis.status.level).toBe("green");
    expect(analysis.status.reasonCode).toBe("active_payer");
    expect(analysis.status.explanationFr).toContain("Actif");
  });

  it("Parent B: same old debt, prolonged non-payment → RED / critical_delinquency", () => {
    // Same amount, same origin year, same due date — but the last payment
    // was 2024-11-01 (the origin year itself): ~592 days of inactivity.
    const installments = [
      makeInstallment({ parentId: "p-B", id: "ins-B", amountDue: 100_000, dueDate: "2024-10-15" }),
    ];
    const payments = [
      makeEntry({
        id: "led-pay-B-0",
        parentId: "p-B",
        accountId: "parent:p-B:category:tuition",
        at: "2024-11-01T10:00:00.000Z",
        amount: -20_000,
      }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-B",
      installments,
      ledgerEntries: payments,
      academicYears: [],
      now: NOW,
    });

    expect(analysis.outstandingAmount).toBe(100_000);
    expect(analysis.debtAgeDays).toBe(608);
    expect(analysis.originAcademicYear).toBe("2024-2025");
    expect(analysis.daysSinceLastPayment).toBe(591);
    expect(analysis.inactivityDays).toBe(591);
    expect(analysis.hasSubsequentYearPayments).toBe(false);
    expect(analysis.subsequentYearPaymentCount).toBe(0);

    expect(analysis.status.level).toBe("red");
    expect(analysis.status.reasonCode).toBe("critical_delinquency");
    expect(analysis.status.explanationFr).toContain("Critique");
  });

  it("the archetypes differ ONLY through payment behavior (amount/age/year equal)", () => {
    // The invariant the task demands: identical debt facts, opposite status.
    const mk = (parentId: string, payments: LedgerEntry[]) =>
      computeDebtAgingAnalysis({
        parentId,
        installments: [
          makeInstallment({ parentId, id: `ins-${parentId}`, amountDue: 100_000, dueDate: "2024-10-15" }),
        ],
        ledgerEntries: payments,
        now: NOW,
      });
    const a = mk("p-A", monthlyPayerEntries("p-A", "2025-09-05T10:00:00.000Z", 10));
    const b = mk("p-B", [
      makeEntry({ parentId: "p-B", accountId: "parent:p-B:category:tuition", at: "2024-11-01T10:00:00.000Z" }),
    ]);
    expect(a.outstandingAmount).toBe(b.outstandingAmount);
    expect(a.debtAgeDays).toBe(b.debtAgeDays);
    expect(a.originAcademicYear).toBe(b.originAcademicYear);
    expect(a.status.level).not.toBe(b.status.level); // green vs red
  });
});

/* ── The ordered status evaluation (INV-16) ────────────────────────── */

describe("T-405 debt aging — canonical status thresholds (§15.1)", () => {
  it("rule 1: outstanding <= 0.001 DZD → GREEN / resolved", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 0, debtAgeDays: 0, inactivityDays: 0 });
    expect(s.level).toBe("green");
    expect(s.reasonCode).toBe("resolved");
    const sEpsilon = computeDebtAgingStatus({ outstandingAmount: DEBT_AGING_EPSILON_DZD, debtAgeDays: 500, inactivityDays: 500 });
    expect(sEpsilon.reasonCode).toBe("resolved");
  });

  it("rule 2: inactivity <= 60 days → GREEN / active_payer even with ancient debt", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 900, inactivityDays: 60 });
    expect(s.level).toBe("green");
    expect(s.reasonCode).toBe("active_payer");
    const sEdge = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 900, inactivityDays: 0 });
    expect(sEdge.reasonCode).toBe("active_payer");
  });

  it("rule 2 boundary: inactivity 61 days with ancient debt → NOT green", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 900, inactivityDays: 61 });
    expect(s.level).not.toBe("green");
  });

  it("rule 3: debtAge > 180 AND inactivity > 180 → RED / critical_delinquency", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 181, inactivityDays: 181 });
    expect(s.level).toBe("red");
    expect(s.reasonCode).toBe("critical_delinquency");
  });

  it("rule 3 boundary: inactivity exactly 180 with debt 400 → falls to rule 4 (ORANGE)", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 400, inactivityDays: 180 });
    expect(s.level).toBe("orange");
    expect(s.reasonCode).toBe("sustained_delinquency");
  });

  it("rule 4: debtAge > 90 AND inactivity > 60 → ORANGE / sustained_delinquency", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 91, inactivityDays: 61 });
    expect(s.level).toBe("orange");
    expect(s.reasonCode).toBe("sustained_delinquency");
  });

  it("rule 4 boundary: debtAge exactly 90 → YELLOW (not sustained)", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 90, inactivityDays: 200 });
    expect(s.level).toBe("yellow");
    expect(s.reasonCode).toBe("watch");
  });

  it("rule 5: young debt + stopped paying → YELLOW / watch", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 70, inactivityDays: 70 });
    expect(s.level).toBe("yellow");
    expect(s.reasonCode).toBe("watch");
  });

  it("young current debt + recent payment → GREEN via rule 2", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 20, inactivityDays: 20 });
    expect(s.level).toBe("green");
    expect(s.reasonCode).toBe("active_payer");
  });

  it("INV-16c: amount magnitude never changes the level", () => {
    const small = computeDebtAgingStatus({ outstandingAmount: 500, debtAgeDays: 400, inactivityDays: 400 });
    const huge = computeDebtAgingStatus({ outstandingAmount: 900_000, debtAgeDays: 400, inactivityDays: 400 });
    expect(small.level).toBe(huge.level);
    expect(small.level).toBe("red");
  });

  it("INV-16a: rule order — a payment 30 days ago dominates a 2-year-old balance", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 150_000, debtAgeDays: 730, inactivityDays: 30 });
    expect(s.level).toBe("green");
    expect(s.reasonCode).toBe("active_payer");
  });
});

/* ── Debt-age semantics ───────────────────────────────────────────── */

describe("T-405 debt aging — age & obligation semantics", () => {
  it("debt age is measured from the OLDEST outstanding due date (INV-4 basis)", () => {
    const installments = [
      makeInstallment({ id: "new", amountDue: 50_000, dueDate: "2026-03-15" }),
      makeInstallment({ id: "old", amountDue: 80_000, dueDate: "2024-12-15" }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments,
      ledgerEntries: [],
      now: NOW,
    });
    expect(analysis.oldestDueDate).toBe("2024-12-15");
    expect(analysis.debtAgeDays).toBe(547); // 2024-12-15 → 2026-06-15
    expect(analysis.outstandingAmount).toBe(130_000);
  });

  it("a partial payment does NOT reset debt age (age is the obligation's)", () => {
    // 40,000 paid on the old tranche — age still measured from 2024-10-15.
    const installments = [
      makeInstallment({ id: "ins-old", amountDue: 100_000, amountPaid: 40_000, dueDate: "2024-10-15" }),
    ];
    const payments = [
      makeEntry({ at: "2026-06-10T10:00:00.000Z", amount: -40_000 }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments,
      ledgerEntries: payments,
      now: NOW,
    });
    expect(analysis.outstandingAmount).toBe(60_000);
    expect(analysis.debtAgeDays).toBe(608);
    expect(analysis.status.reasonCode).toBe("active_payer"); // paid 5 days ago
  });

  it("canonical remaining honors amount_pending (uncleared funds reduce owed)", () => {
    const installments = [
      makeInstallment({ id: "ins-1", amountDue: 100_000, amountPaid: 30_000, amountPending: 20_000, dueDate: "2024-10-15" }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments,
      ledgerEntries: [],
      now: NOW,
    });
    // Same formula as the Créances tab: max(0, due − paid − pending).
    expect(analysis.outstandingAmount).toBe(50_000);
  });

  it("fully-paid installments are not obligations (remaining <= 0 skipped)", () => {
    const installments = [
      makeInstallment({ id: "paid", amountDue: 100_000, amountPaid: 100_000, dueDate: "2024-10-15" }),
      makeInstallment({ id: "paid-pending", amountDue: 100_000, amountPaid: 40_000, amountPending: 60_000, dueDate: "2024-12-15" }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments,
      ledgerEntries: [],
      now: NOW,
    });
    expect(analysis.obligations).toHaveLength(0);
    expect(analysis.outstandingAmount).toBe(0);
    expect(analysis.status.reasonCode).toBe("resolved");
  });

  it("affected students are the distinct student_ids of outstanding obligations", () => {
    const installments = [
      makeInstallment({ id: "i1", studentId: "s-1", dueDate: "2024-10-15" }),
      makeInstallment({ id: "i2", studentId: "s-2", amountDue: 40_000, dueDate: "2024-11-15" }),
      makeInstallment({ id: "i3", studentId: "s-1", amountDue: 20_000, dueDate: "2024-12-15" }),
      makeInstallment({ id: "i4", studentId: "s-3", amountDue: 10_000, amountPaid: 10_000, dueDate: "2025-01-15" }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments,
      ledgerEntries: [],
      now: NOW,
    });
    expect(analysis.affectedStudentIds).toEqual(["s-1", "s-2"]);
    expect(analysis.obligations).toHaveLength(3);
  });
});

/* ── Payment behavior semantics ───────────────────────────────────── */

describe("T-405 debt aging — payment behavior semantics", () => {
  it("never-paid parents: inactivity defaults to debt age (INV-16b)", () => {
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-N",
      installments: [makeInstallment({ parentId: "p-N", dueDate: "2025-12-15" })],
      ledgerEntries: [],
      now: NOW,
    });
    expect(analysis.lastPaymentAt).toBeNull();
    expect(analysis.daysSinceLastPayment).toBeNull();
    expect(analysis.inactivityDays).toBe(analysis.debtAgeDays); // 182 days
    // 182 > 180 → RED exactly when the debt passes 180 days.
    expect(analysis.debtAgeDays).toBe(182);
    expect(analysis.status.reasonCode).toBe("critical_delinquency");
  });

  it("reversed payment entries are excluded from behavior", () => {
    const payments = [
      makeEntry({ id: "led-1", at: "2026-06-10T10:00:00.000Z", amount: -10_000 }),
      makeEntry({ id: "led-2", type: "reversal", reversesId: "led-1", amount: 10_000, at: "2026-06-11T10:00:00.000Z", paymentStatus: null }),
      makeEntry({ id: "led-3", at: "2026-03-01T10:00:00.000Z", amount: -5_000 }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments: [makeInstallment({ dueDate: "2024-10-15" })],
      ledgerEntries: payments,
      now: NOW,
    });
    // The reversed June payment does NOT count: last = March → 106 days.
    expect(analysis.lastPaymentAt).toBe("2026-03-01T10:00:00.000Z");
    expect(analysis.inactivityDays).toBe(106);
  });

  it("subsequent-year payments are counted and totalled (INV-15)", () => {
    const payments = [
      makeEntry({ id: "pay-orig", at: "2024-11-01T10:00:00.000Z", amount: -10_000 }), // origin year
      makeEntry({ id: "pay-sub1", at: "2025-10-01T10:00:00.000Z", amount: -15_000 }), // 2025-2026
      makeEntry({ id: "pay-sub2", at: "2026-01-15T10:00:00.000Z", amount: -5_000 }), // 2025-2026
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments: [makeInstallment({ dueDate: "2024-10-15" })],
      ledgerEntries: payments,
      now: NOW,
    });
    expect(analysis.subsequentYearPaymentCount).toBe(2);
    expect(analysis.subsequentYearPaymentTotal).toBe(20_000);
    expect(analysis.hasSubsequentYearPayments).toBe(true);
  });

  it("payments BEFORE the origin year are not subsequent-year activity", () => {
    const payments = [
      makeEntry({ id: "pay-old", at: "2024-09-01T10:00:00.000Z", amount: -10_000 }), // 2024-2025 == origin
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments: [makeInstallment({ dueDate: "2024-10-15" })],
      ledgerEntries: payments,
      now: NOW,
    });
    expect(analysis.subsequentYearPaymentCount).toBe(0);
    expect(analysis.hasSubsequentYearPayments).toBe(false);
  });

  it("non-payment entries (charges/adjustments) never count as payment behavior", () => {
    const entries = [
      makeEntry({ id: "chg-1", type: "charge", amount: 100_000, at: "2026-06-14T10:00:00.000Z", paymentStatus: null }),
      makeEntry({ id: "adj-1", type: "adjustment", amount: -5_000, at: "2026-06-14T10:00:00.000Z", paymentStatus: null }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments: [makeInstallment({ dueDate: "2024-10-15" })],
      ledgerEntries: entries,
      now: NOW,
    });
    expect(analysis.lastPaymentAt).toBeNull();
    expect(analysis.inactivityDays).toBe(analysis.debtAgeDays);
  });
});

/* ── Academic-year attribution (INV-14) ───────────────────────────── */

describe("T-405 debt aging — academic-year attribution", () => {
  it("uses the academic_years row whose window contains the date", () => {
    const years = [
      { code: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" },
      { code: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" },
    ];
    expect(resolveAcademicYearForDate("2025-09-01", years)).toBe("2025-2026");
    expect(resolveAcademicYearForDate("2026-01-15", years)).toBe("2025-2026");
    expect(resolveAcademicYearForDate("2026-06-30", years)).toBe("2025-2026");
    expect(resolveAcademicYearForDate("2026-09-15", years)).toBe("2026-2027");
  });

  it("falls back to the Jul1–Jun30 school-year convention outside known rows", () => {
    // The live tenant carries ONLY 2026-2027 — history resolves by convention.
    expect(resolveAcademicYearForDate("2024-10-15", [])).toBe("2024-2025");
    expect(resolveAcademicYearForDate("2025-03-15", [])).toBe("2024-2025");
    expect(resolveAcademicYearForDate("2025-07-01", [])).toBe("2025-2026");
    expect(resolveAcademicYearForDate("2025-12-15", [])).toBe("2025-2026");
    expect(resolveAcademicYearForDate("2026-06-30", [])).toBe("2025-2026");
    expect(resolveAcademicYearForDate("2026-09-15", [])).toBe("2026-2027");
  });

  it("a date inside a known row NEVER uses the convention", () => {
    const years = [{ code: "2025-2026", startDate: "2025-08-15", endDate: "2026-07-15" }];
    expect(resolveAcademicYearForDate("2025-09-15", years)).toBe("2025-2026");
  });

  it("academicYearStart sorts codes numerically", () => {
    expect(academicYearStart("2024-2025")).toBe(2024);
    expect(academicYearStart("2025-2026")).toBe(2025);
    expect(academicYearStart("2025-2026") > academicYearStart("2024-2025")).toBe(true);
  });

  it("the analysis attributes the origin year from the oldest obligation's due date", () => {
    const years = [{ code: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" }];
    const installments = [
      makeInstallment({ id: "cur", amountDue: 30_000, dueDate: "2026-03-15" }), // → 2025-2026 (row)
      makeInstallment({ id: "hist", amountDue: 70_000, dueDate: "2024-11-15" }), // → 2024-2025 (convention)
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments,
      ledgerEntries: [],
      academicYears: years,
      now: NOW,
    });
    expect(analysis.originAcademicYear).toBe("2024-2025");
    expect(analysis.obligations.find((o) => o.installmentId === "cur")?.academicYear).toBe("2025-2026");
    expect(analysis.obligations.find((o) => o.installmentId === "hist")?.academicYear).toBe("2024-2025");
  });
});

/* ── Parity with the Créances tab amount ──────────────────────────── */

describe("T-405 debt aging — Finance-tab parity", () => {
  it("outstanding equals the DebtRepository seedSummary formula for the same rows", () => {
    // Mirrors SupabaseDebtRepository.seedSummary: Σ max(0, due−paid−pending)
    // over installments with status != paid (remaining > 0 kept).
    const installments = [
      makeInstallment({ id: "a", amountDue: 120_000, amountPaid: 30_000, amountPending: 10_000, dueDate: "2024-12-15" }),
      makeInstallment({ id: "b", amountDue: 80_000, amountPaid: 80_000, dueDate: "2025-03-15", status: "paid" }),
      makeInstallment({ id: "c", amountDue: 60_000, amountPaid: 0, amountPending: 0, dueDate: "2026-03-15" }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments,
      ledgerEntries: [],
      now: NOW,
    });
    const seedSummaryTotal = 80_000 + 60_000; // a: 120−30−10, c: 60
    expect(analysis.outstandingAmount).toBe(seedSummaryTotal);
  });

  it("determinism: same inputs + same now → identical record", () => {
    const input = {
      parentId: "p-A",
      installments: [makeInstallment({ dueDate: "2024-10-15" })],
      ledgerEntries: monthlyPayerEntries("p-A", "2025-09-05T10:00:00.000Z", 6),
      now: NOW,
    };
    const r1 = computeDebtAgingAnalysis(input);
    const r2 = computeDebtAgingAnalysis(input);
    expect(r1).toEqual(r2);
  });

  it("threshold constants match the documented aging-bucket edges", () => {
    expect(DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS).toBe(60);
    expect(DEBT_AGING_SUSTAINED_DAYS).toBe(90);
    expect(DEBT_AGING_CRITICAL_DAYS).toBe(180);
    expect(DEBT_AGING_EPSILON_DZD).toBe(0.001);
  });
});
