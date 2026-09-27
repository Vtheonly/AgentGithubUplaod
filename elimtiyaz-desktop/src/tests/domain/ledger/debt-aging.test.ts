/**
 * Unit tests for the canonical cross-year debt-aging engine (T-405 as
 * amended by T-429 / DEBT-100, docs/domain/financial-rules.md §15.1).
 *
 * THE T-429 SEMANTIC (issues #24/#25 Track 5 + Track 2 item 3): the status
 * is PURELY due-date-based aging over the INV-4 remaining, driven by the
 * CONFIGURABLE thresholds (defaults: grace 5 / yellow 15 / red 60 /
 * active-payer window 15). The pre-T-429 "active payer" rule (a payment
 * within 60 days → GREEN) is REMOVED — a recent payment ANNOTATES the
 * explanation ("Payeur actif — dernier paiement il y a N j"), never masks
 * past-due debt.
 *
 * The two ARCHETYPE fixtures from T-405 keep their FACTS (both owe
 * 100,000 DZD originating 2024-2025; Parent A pays monthly, Parent B
 * stopped) — under T-429 BOTH are RED (608 days past due); only the
 * ANNOTATION differs. The facts sections below pin the analysis layer
 * (unchanged by T-429); the status sections pin the new hierarchy.
 */
import { describe, it, expect } from "vitest";
import {
  computeDebtAgingAnalysis,
  computeDebtAgingStatus,
  resolveAcademicYearForDate,
  academicYearStart,
  DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS,
  DEBT_AGING_EPSILON_DZD,
  DEFAULT_DEBT_AGING_THRESHOLDS,
  type DebtAgingThresholds,
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

/* ── The two archetypes (the FACTS are unchanged by T-429) ────────── */

describe("T-405 + T-429 debt aging — the two archetype parents (facts)", () => {
  it("Parent A: old debt + continued monthly payment → the FACTS, and RED with the active-payer annotation", () => {
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

    // The facts (T-405's analysis layer — unchanged):
    expect(analysis.outstandingAmount).toBe(100_000);
    expect(analysis.originAcademicYear).toBe("2024-2025");
    expect(analysis.oldestDueDate).toBe("2024-10-15");
    expect(analysis.debtAgeDays).toBe(608);
    expect(analysis.lastPaymentAt).toBe(payments[payments.length - 1].at);
    expect(analysis.daysSinceLastPayment).toBe(10);
    expect(analysis.inactivityDays).toBe(10);
    expect(analysis.hasSubsequentYearPayments).toBe(true);
    expect(analysis.subsequentYearPaymentCount).toBe(10);
    expect(analysis.subsequentYearPaymentTotal).toBe(80_000);

    // THE T-429 STATUS: 608 days past due is RED regardless of the payment
    // behavior — the pre-T-429 GREEN / active_payer masking is GONE. The
    // recent payment appears ONLY as the explanation annotation.
    expect(analysis.status.level).toBe("red");
    expect(analysis.status.reasonCode).toBe("critical_delinquency");
    expect(analysis.status.explanationFr).toContain("Payeur actif"); // the annotation
    expect(analysis.status.explanationFr).toContain("Critique");
  });

  it("Parent B: same old debt, prolonged non-payment → RED without the annotation", () => {
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
    expect(analysis.status.explanationFr).not.toContain("Payeur actif"); // 591 j > the 15-j window
  });

  it("THE T-429 INVARIANT: identical debt facts → the SAME status (payment behavior no longer drives it)", () => {
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
    // T-429: same age → same status (the T-405 "differs only through
    // behavior" invariant is superseded by the owner's decoupling mandate).
    expect(a.status.level).toBe(b.status.level);
    expect(a.status.reasonCode).toBe(b.status.reasonCode);
  });
});

/* ── The ordered status evaluation (T-429's configurable hierarchy) ── */

describe("T-429 debt aging — the 4-tier configurable hierarchy (§15.1 as amended)", () => {
  it("tier 1: outstanding <= 0.001 DZD → GREEN / resolved", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 0, debtAgeDays: 0, inactivityDays: 0 });
    expect(s.level).toBe("green");
    expect(s.reasonCode).toBe("resolved");
    const sEpsilon = computeDebtAgingStatus({ outstandingAmount: DEBT_AGING_EPSILON_DZD, debtAgeDays: 500, inactivityDays: 500 });
    expect(sEpsilon.reasonCode).toBe("resolved");
  });

  it("tier 2: debtAge <= grace (5) → GREEN / not_due (À échoir — En cours)", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 5, inactivityDays: 0 });
    expect(s.level).toBe("green");
    expect(s.reasonCode).toBe("not_due");
    expect(s.explanationFr).toContain("échoir");
  });

  it("tier 3: 5 < debtAge <= yellow (15) → YELLOW / watch", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 15, inactivityDays: 90 });
    expect(s.level).toBe("yellow");
    expect(s.reasonCode).toBe("watch");
    const s6 = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 6, inactivityDays: 90 });
    expect(s6.level).toBe("yellow");
  });

  it("tier 4: 15 < debtAge <= red (60) → ORANGE / sustained_delinquency", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 60, inactivityDays: 90 });
    expect(s.level).toBe("orange");
    expect(s.reasonCode).toBe("sustained_delinquency");
    const s16 = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 16, inactivityDays: 90 });
    expect(s16.level).toBe("orange");
  });

  it("tier 5: debtAge > red (60) → RED / critical_delinquency", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 61, inactivityDays: 0 });
    expect(s.level).toBe("red");
    expect(s.reasonCode).toBe("critical_delinquency");
  });

  it("THE DECOUPLING: a payment 10 days ago does NOT make an ancient debt green (issue #24 Track 2 item 3)", () => {
    // Pre-T-429 this was GREEN / active_payer — the masking the owner
    // removed: "a recent payment must not mask accounts that remain
    // millions of dinars past due".
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 730, inactivityDays: 10 });
    expect(s.level).toBe("red");
    expect(s.reasonCode).toBe("critical_delinquency");
    expect(s.explanationFr).toContain("Payeur actif"); // the annotation survives
  });

  it("young current debt + recent payment → GREEN via tier 2 (the à-échoir window, not the payer rule)", () => {
    const s = computeDebtAgingStatus({ outstandingAmount: 100_000, debtAgeDays: 3, inactivityDays: 3 });
    expect(s.level).toBe("green");
    expect(s.reasonCode).toBe("not_due");
  });

  it("INV-16c: amount magnitude never changes the level", () => {
    const small = computeDebtAgingStatus({ outstandingAmount: 500, debtAgeDays: 400, inactivityDays: 400 });
    const huge = computeDebtAgingStatus({ outstandingAmount: 900_000, debtAgeDays: 400, inactivityDays: 400 });
    expect(small.level).toBe(huge.level);
    expect(small.level).toBe("red");
  });

  it("CONFIGURABLE: custom thresholds change the boundaries (the system_settings contract)", () => {
    const thresholds: DebtAgingThresholds = {
      gracePeriodDays: 10,
      yellowDays: 30,
      redDays: 120,
      activePayerGraceDays: 7,
    };
    // debtAge 12: within the custom grace (10? no — 12 > 10) → yellow? no:
    // 12 <= 30 → yellow.
    const s12 = computeDebtAgingStatus({ outstandingAmount: 100, debtAgeDays: 12, inactivityDays: 50 }, thresholds);
    expect(s12.level).toBe("yellow");
    // debtAge 31..120 → orange; > 120 → red.
    const s60 = computeDebtAgingStatus({ outstandingAmount: 100, debtAgeDays: 60, inactivityDays: 50 }, thresholds);
    expect(s60.level).toBe("orange");
    const s130 = computeDebtAgingStatus({ outstandingAmount: 100, debtAgeDays: 130, inactivityDays: 50 }, thresholds);
    expect(s130.level).toBe("red");
    // The custom active-payer window (7) narrows the annotation.
    const s8 = computeDebtAgingStatus({ outstandingAmount: 100, debtAgeDays: 60, inactivityDays: 8 }, thresholds);
    expect(s8.explanationFr).not.toContain("Payeur actif");
    const s6 = computeDebtAgingStatus({ outstandingAmount: 100, debtAgeDays: 60, inactivityDays: 6 }, thresholds);
    expect(s6.explanationFr).toContain("Payeur actif");
  });

  it("the analysis accepts thresholds (the settings-injected path)", () => {
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-C",
      installments: [makeInstallment({ parentId: "p-C", dueDate: "2026-06-10" })],
      ledgerEntries: [],
      now: NOW,
      thresholds: { gracePeriodDays: 3, yellowDays: 9, redDays: 30, activePayerGraceDays: 15 },
    });
    // due 2026-06-10 → 5 days past due at NOW: 3 < 5 <= 9 → yellow.
    expect(analysis.debtAgeDays).toBe(5);
    expect(analysis.status.level).toBe("yellow");
    expect(analysis.status.reasonCode).toBe("watch");
  });
});

/* ── The analysis layer (T-405 — unchanged by T-429) ───────────────── */

describe("T-405 debt aging — the analysis layer (facts)", () => {
  it("paid 5 days ago: the inactivity fact is computed, the status follows the age", () => {
    const installments = [
      makeInstallment({ id: "ins-2", amountDue: 100_000, amountPaid: 40_000, dueDate: "2024-10-15" }),
    ];
    const payments = [
      ...monthlyPayerEntries("p-A", "2025-09-05T10:00:00.000Z", 9),
      makeEntry({ id: "led-recent", at: "2026-06-10T10:00:00.000Z", amount: -5_000 }),
    ];
    const analysis = computeDebtAgingAnalysis({
      parentId: "p-A",
      installments,
      ledgerEntries: payments,
      now: NOW,
    });
    expect(analysis.outstandingAmount).toBe(60_000);
    expect(analysis.debtAgeDays).toBe(608);
    expect(analysis.status.reasonCode).toBe("critical_delinquency"); // the age drives it
    expect(analysis.status.explanationFr).toContain("Payeur actif"); // paid 5 days ago
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

/* ── Payment behavior semantics (facts — annotations since T-429) ──── */

describe("T-405 debt aging — payment behavior semantics (facts)", () => {
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
    expect(analysis.debtAgeDays).toBe(182);
    // 182 > 60 (red) → critical.
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
    expect(analysis.lastPaymentAt).toBe("2026-03-01T10:00:00.000Z");
    expect(analysis.inactivityDays).toBe(106);
  });

  it("subsequent-year payments are counted and totalled (INV-15)", () => {
    const payments = [
      makeEntry({ id: "pay-orig", at: "2024-11-01T10:00:00.000Z", amount: -10_000 }),
      makeEntry({ id: "pay-sub1", at: "2025-10-01T10:00:00.000Z", amount: -15_000 }),
      makeEntry({ id: "pay-sub2", at: "2026-01-15T10:00:00.000Z", amount: -5_000 }),
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
      makeEntry({ id: "pay-old", at: "2024-09-01T10:00:00.000Z", amount: -10_000 }),
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
      makeInstallment({ id: "cur", amountDue: 30_000, dueDate: "2026-03-15" }),
      makeInstallment({ id: "hist", amountDue: 70_000, dueDate: "2024-11-15" }),
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
    const seedSummaryTotal = 80_000 + 60_000;
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

  it("the T-429 defaults are the owner-specified values (migration 0125's seed)", () => {
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.gracePeriodDays).toBe(5);
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.yellowDays).toBe(15);
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.redDays).toBe(60);
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.activePayerGraceDays).toBe(15);
    expect(DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS).toBe(60); // the documented legacy window (reference only)
    expect(DEBT_AGING_EPSILON_DZD).toBe(0.001);
  });
});
