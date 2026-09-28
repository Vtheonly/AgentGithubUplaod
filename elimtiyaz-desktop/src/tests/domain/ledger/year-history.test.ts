/**
 * T-436 — the canonical year-history engine's fixture suite
 * (docs/domain/financial-rules.md §17; ADR-030).
 *
 * THE OWNER'S EXACT SCENARIO (the issue's example, generalized across
 * three academic years):
 *
 *   2025-2026: 100,000 DZD charges · 80,000 paid · 20,000 unpaid at year
 *   end. 2026-2027: re-enrolled with NEW prices (120,000 total — price
 *   changes between years), the 20,000 carried forward, then a payment
 *   made DURING 2026-2027 settles the OLD 2025-2026 debt — recorded as a
 *   2026-2027 payment whose allocation targets 2025-2026, with the exact
 *   settlement point visible on the old year's record.
 *
 * Plus the invariants: the attribution precedence (persisted → INV-14),
 * the freeze (an échéance edit NEVER re-attributes a persisted row —
 * DATA-051's fix), historical pricing preservation (INV-19a — stored
 * amounts, never re-priced), the carry-forward chain across 2+
 * transitions, left-while-owing / re-enrolled-while-owing, the paid-date
 * heuristic for legacy rows, and determinism.
 */
import { describe, it, expect } from "vitest";
import {
  computeParentYearHistory,
} from "../../../domain/calc/ledger/year-history";
import {
  computeDebtAgingAnalysis,
} from "../../../domain/calc/ledger/debt-aging";
import type { Installment, Payment, PaymentAllocation } from "../../../domain/model/payment";
import type { LedgerEntry, LedgerEntryType } from "../../../domain/model/ledger";
import type { PricingConfigSummary } from "../../../domain/model/pricing";

/* ── The pinned clock + the tenant's academic years ────────────────── */

const NOW = new Date("2027-01-15T12:00:00.000Z");

const YEARS = [
  { id: "ay-2024", code: "2024-2025", startDate: "2024-09-01", endDate: "2025-06-30" },
  { id: "ay-2025", code: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" },
  { id: "ay-2026", code: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" },
] as const;

/* ── Fixture builders ─────────────────────────────────────────────── */

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

function pricingConfigFor(code: string, label: string): PricingConfigSummary {
  return {
    id: `cfg-${code}`,
    tenantId: "tenant-1",
    academicYearId: `ay-${code.slice(0, 4)}`,
    academicYearLabel: code,
    academicYearCode: code,
    label,
    isActive: code === "2026-2027",
    isCurrentYear: code === "2026-2027",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

/* ── THE OWNER'S SCENARIO (the issue's 100k/80k/20k example) ───────── */

/**
 * Parent A, the issue's exact shape:
 *   2025-2026 — T1 40,000 (Sept 15) · T2 30,000 (Dec 15) · T3 30,000
 *   (Mar 15) = 100,000 charged. pay-1 40,000 (Nov 2025, settles T1);
 *   pay-2 40,000 (Feb 2026: 30,000 on T2 + 10,000 on T3) — 80,000 paid,
 *   20,000 outstanding at the 2025-2026 year end.
 *   2026-2027 — re-enrolled; NEW prices: 3 × 40,000 (120,000 total).
 *   pay-3 20,000 (Oct 2026) settles the OLD T3 — the cross-year
 *   settlement. Current state: the old debt fully paid at 2026-10-20;
 *   the new year's 120,000 untouched.
 */
function ownerScenario() {
  const installments: Installment[] = [
    makeInstallment({
      id: "ins-T1-25", label: "Tranche 1", trancheNumber: 1,
      amountDue: 40_000, amountPaid: 40_000, dueDate: "2025-09-15",
      paidDate: "2025-11-01", status: "paid", academicYearId: "ay-2025",
    }),
    makeInstallment({
      id: "ins-T2-25", label: "Tranche 2", trancheNumber: 2,
      amountDue: 30_000, amountPaid: 30_000, dueDate: "2025-12-15",
      paidDate: "2026-02-01", status: "paid", academicYearId: "ay-2025",
    }),
    makeInstallment({
      id: "ins-T3-25", label: "Tranche 3", trancheNumber: 3,
      amountDue: 30_000, amountPaid: 30_000, dueDate: "2026-03-15",
      paidDate: "2026-10-20", status: "paid", academicYearId: "ay-2025",
    }),
    makeInstallment({
      id: "ins-T1-26", label: "Tranche 1", trancheNumber: 1,
      amountDue: 40_000, dueDate: "2026-09-15", academicYearId: "ay-2026",
    }),
    makeInstallment({
      id: "ins-T2-26", label: "Tranche 2", trancheNumber: 2,
      amountDue: 40_000, dueDate: "2026-12-15", academicYearId: "ay-2026",
    }),
    makeInstallment({
      id: "ins-T3-26", label: "Tranche 3", trancheNumber: 3,
      amountDue: 40_000, dueDate: "2027-03-15", academicYearId: "ay-2026",
    }),
  ];
  const payments: Payment[] = [
    makePayment({
      id: "pay-1", amount: 40_000, collectedAt: "2025-11-01T10:00:00.000Z",
      receiptNumber: "REC-2025-000001", academicYearId: "ay-2025",
    }),
    makePayment({
      id: "pay-2", amount: 40_000, collectedAt: "2026-02-01T10:00:00.000Z",
      receiptNumber: "REC-2026-000001", academicYearId: "ay-2025",
    }),
    makePayment({
      id: "pay-3", amount: 20_000, collectedAt: "2026-10-20T10:00:00.000Z",
      receiptNumber: "REC-2026-000002", academicYearId: "ay-2026",
    }),
  ];
  const allocations: PaymentAllocation[] = [
    makeAllocation({ paymentId: "pay-1", installmentId: "ins-T1-25", allocatedAmount: 40_000, label: "Tranche 1", createdAt: "2025-11-01T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-2", installmentId: "ins-T2-25", allocatedAmount: 30_000, label: "Tranche 2", createdAt: "2026-02-01T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-2", installmentId: "ins-T3-25", allocatedAmount: 10_000, label: "Tranche 3", createdAt: "2026-02-01T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-3", installmentId: "ins-T3-25", allocatedAmount: 20_000, label: "Tranche 3", createdAt: "2026-10-20T10:00:00.000Z" }),
  ];
  const ledgerEntries: LedgerEntry[] = [
    makeEntry({ id: "led-1", sourceId: "pay-1", amount: -40_000, at: "2025-11-01T10:00:00.000Z", receiptNumber: "REC-2025-000001" }),
    makeEntry({ id: "led-2", sourceId: "pay-2", amount: -40_000, at: "2026-02-01T10:00:00.000Z", receiptNumber: "REC-2026-000001" }),
    makeEntry({ id: "led-3", sourceId: "pay-3", amount: -20_000, at: "2026-10-20T10:00:00.000Z", receiptNumber: "REC-2026-000002" }),
  ];
  return { installments, payments, allocations, ledgerEntries };
}

function ownerHistory() {
  const s = ownerScenario();
  return computeParentYearHistory({
    parentId: "p-1",
    installments: s.installments,
    payments: s.payments,
    allocations: s.allocations,
    ledgerEntries: s.ledgerEntries,
    academicYears: YEARS,
    pricingConfigs: new Map([
      ["2025-2026", pricingConfigFor("2025-2026", "Tarification 2025-2026")],
      ["2026-2027", pricingConfigFor("2026-2027", "Tarification 2026-2027 (nouveaux prix)")],
    ]),
    now: NOW,
  });
}

/* ── The owner's scenario, asserted end to end ─────────────────────── */

describe("T-436 year-history — the owner's 100k/80k/20k scenario across 2025-2026 → 2026-2027", () => {
  const history = ownerHistory();

  it("renders one record per academic year, ordered by year start", () => {
    expect(history.years.map((y) => y.academicYear)).toEqual(["2025-2026", "2026-2027"]);
  });

  it("2025-2026: what they were supposed to pay — every charge with ITS prices", () => {
    const y = history.years[0];
    expect(y.totalCharged).toBe(100_000);
    expect(y.charges.map((c) => c.amountDue)).toEqual([40_000, 30_000, 30_000]);
    expect(y.charges.every((c) => c.attribution.source === "persisted")).toBe(true);
    // INV-19b: the year's pricing configuration is REFERENCED.
    expect(y.pricingConfig?.label).toBe("Tarification 2025-2026");
    expect(y.pricingConfig?.academicYearCode).toBe("2025-2026");
  });

  it("2025-2026: the year-end outstanding is the 20,000 the issue specifies (as-of the year end — the later settlement does NOT rewrite it)", () => {
    const y = history.years[0];
    expect(y.yearEndOutstanding).toBe(20_000);
    expect(y.yearEndBasis).toBe("allocations");
    expect(y.isOpen).toBe(false);
  });

  it("2025-2026: what they paid during the year (the 80,000) is itemized", () => {
    const y = history.years[0];
    expect(y.paymentsMadeInYearTotal).toBe(80_000);
    expect(y.paymentsMadeInYear.map((p) => p.paymentId)).toEqual(["pay-1", "pay-2"]);
    // pay-2 (Feb 2026) is INSIDE the 2025-2026 academic window — the
    // payment-made year is 2025-2026 (INV-18: the year the payment was
    // made in, not the calendar year).
    expect(y.paymentsMadeInYear[1].attribution.source).toBe("persisted");
  });

  it("the old debt was fully paid IN 2026-2027 — the exact settlement point is on the old year's charge", () => {
    const y = history.years[0];
    const t3 = y.charges.find((c) => c.installmentId === "ins-T3-25")!;
    expect(t3.settlement).toBe("fully_paid");
    // The completing payment's date (pay-3, 2026-10-20) — NOT the stored
    // paidDate fallback when allocations exist (the exact moment).
    expect(t3.settledAt).toBe("2026-10-20T10:00:00.000Z");
  });

  it("the cross-year settlement is a first-class fact on the RECEIVING year (INV-18c/18d)", () => {
    const y = history.years[0];
    expect(y.settlementsReceivedFromLaterYears).toHaveLength(1);
    const s = y.settlementsReceivedFromLaterYears[0];
    expect(s.paymentId).toBe("pay-3");
    expect(s.paymentYear).toBe("2026-2027");
    expect(s.targetYear).toBe("2025-2026");
    expect(s.installmentId).toBe("ins-T3-25");
    expect(s.allocatedAmount).toBe(20_000);
    expect(y.settlementsReceivedFromLaterYearsTotal).toBe(20_000);
  });

  it("2026-2027: re-enrolled with the carried-forward 20,000 + NEW prices (120,000)", () => {
    const y = history.years[1];
    expect(y.carriedForwardFromPriorYear).toBe(20_000);
    expect(y.totalCharged).toBe(120_000);
    expect(y.charges.map((c) => c.amountDue)).toEqual([40_000, 40_000, 40_000]);
    expect(y.pricingConfig?.label).toBe("Tarification 2026-2027 (nouveaux prix)");
    expect(y.isOpen).toBe(true);
    // The re-enrollment flag lives on the DEBT year (2025-2026: they
    // re-enrolled in 2026-2027 while owing 20,000); the open final year
    // carries neither flag — the honest presentation (INV-20).
    expect(history.years[0].reEnrolledOwing).toBe(true);
    expect(history.years[0].leftOwing).toBe(false);
    expect(y.reEnrolledOwing).toBe(false);
    expect(y.leftOwing).toBe(false);
  });

  it("2026-2027: the 20,000 payment MADE in 2026-2027 is attributed to 2026-2027", () => {
    const y = history.years[1];
    expect(y.paymentsMadeInYearTotal).toBe(20_000);
    expect(y.paymentsMadeInYear[0].paymentId).toBe("pay-3");
    expect(y.paymentsMadeInYear[0].attribution.code).toBe("2026-2027");
  });

  it("the top-level totals reconcile: the old debt is NOT still owed, the new year is", () => {
    expect(history.totalOutstandingNow).toBe(120_000);
    expect(history.priorYearOutstandingStillOwed).toBe(0);
  });

  it("the balance evolution shows the state change from one year to the next", () => {
    const y25 = history.years[0];
    // 2025-2026: 3 charges (40+30+30) − 2 payments (40+40) → 20,000 out.
    const last25 = y25.balanceEvolution[y25.balanceEvolution.length - 1];
    expect(last25.runningOutstanding).toBe(20_000);
    const y26 = history.years[1];
    // 2026-2027 starts FROM the carried 20,000, +120,000 − 20,000.
    expect(y26.balanceEvolution[0].runningOutstanding).toBe(20_000 + 40_000);
    const last26 = y26.balanceEvolution[y26.balanceEvolution.length - 1];
    expect(last26.runningOutstanding).toBe(20_000 + 120_000 - 20_000);
  });
});

/* ── The attribution precedence + the freeze (DATA-051's fix) ───────── */

describe("T-436 — the attribution precedence (INV-18a) and the freeze (INV-18b)", () => {
  const baseCharge = {
    parentId: "p-2",
    amountDue: 50_000,
    amountPaid: 0,
    label: "Tranche 1",
  };

  it("a persisted academicYearId WINS over the due-date rule", () => {
    // Due 2026-01-15 → INV-14 says 2025-2026; the persisted id says
    // 2024-2025 (a late fee booked into the older year).
    const ins = makeInstallment({
      ...baseCharge, id: "ins-persisted", dueDate: "2026-01-15",
      academicYearId: "ay-2024",
    });
    const h = computeParentYearHistory({
      parentId: "p-2", installments: [ins], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    expect(h.years.map((y) => y.academicYear)).toEqual(["2024-2025"]);
    expect(h.years[0].charges[0].attribution).toMatchObject({
      code: "2024-2025", id: "ay-2024", source: "persisted",
    });
  });

  it("a NULL academicYearId falls back to the INV-14 date rule (byte-identical to pre-T-436)", () => {
    const ins = makeInstallment({ ...baseCharge, id: "ins-null", dueDate: "2026-01-15" });
    const h = computeParentYearHistory({
      parentId: "p-2", installments: [ins], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    expect(h.years[0].academicYear).toBe("2025-2026");
    expect(h.years[0].charges[0].attribution.source).toBe("due_date");
  });

  it("an échéance edit NEVER re-attributes a persisted row (the DATA-051 freeze)", () => {
    const before = makeInstallment({
      ...baseCharge, id: "ins-freeze", dueDate: "2025-10-15",
      academicYearId: "ay-2025",
    });
    const after = {
      ...before,
      // The Tranches tab's "Modifier l'échéance" moves the due date into
      // the NEXT academic year — the persisted year must survive.
      dueDate: "2026-10-15",
    };
    for (const ins of [before, after]) {
      const h = computeParentYearHistory({
        parentId: "p-2", installments: [ins], ledgerEntries: [],
        academicYears: YEARS, now: NOW,
      });
      expect(h.years).toHaveLength(1);
      expect(h.years[0].academicYear).toBe("2025-2026");
      expect(h.years[0].charges[0].attribution.source).toBe("persisted");
    }
  });

  it("an unresolvable persisted id (a vanished year row) falls back to the date rule", () => {
    const ins = makeInstallment({
      ...baseCharge, id: "ins-dangling", dueDate: "2025-10-15",
      academicYearId: "ay-gone",
    });
    const h = computeParentYearHistory({
      parentId: "p-2", installments: [ins], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    expect(h.years[0].charges[0].attribution).toMatchObject({
      code: "2025-2026", source: "due_date",
    });
  });

  it("payments attribute by their made-in year — persisted first, INV-14 on collectedAt otherwise", () => {
    const ledger = [
      makeEntry({ parentId: "p-3", id: "led-a", sourceId: "pay-a", amount: -5_000, at: "2026-10-05T10:00:00.000Z" }),
      makeEntry({ parentId: "p-3", id: "led-b", sourceId: "pay-b", amount: -5_000, at: "2026-10-05T10:00:00.000Z" }),
    ];
    const payments: Payment[] = [
      makePayment({ parentId: "p-3", id: "pay-a", amount: 5_000, collectedAt: "2026-10-05T10:00:00.000Z", academicYearId: "ay-2024" }),
      makePayment({ parentId: "p-3", id: "pay-b", amount: 5_000, collectedAt: "2026-10-05T10:00:00.000Z" }),
    ];
    const h = computeParentYearHistory({
      parentId: "p-3", installments: [], payments, ledgerEntries: ledger,
      academicYears: YEARS, now: NOW,
    });
    // pay-a (persisted 2024-2025) + pay-b (date fallback 2026-2027).
    const byYear = new Map(h.years.map((y) => [y.academicYear, y]));
    expect(byYear.get("2024-2025")?.paymentsMadeInYear[0].paymentId).toBe("pay-a");
    expect(byYear.get("2026-2027")?.paymentsMadeInYear[0].paymentId).toBe("pay-b");
  });

  it("ledger-only payments (no payment rows) attribute by their entry date — the pre-T-436 behavior", () => {
    const ledger = [
      makeEntry({ parentId: "p-4", id: "led-x", sourceId: "pay-x", amount: -5_000, at: "2026-02-05T10:00:00.000Z" }),
    ];
    const h = computeParentYearHistory({
      parentId: "p-4", installments: [], ledgerEntries: ledger,
      academicYears: YEARS, now: NOW,
    });
    expect(h.years).toHaveLength(1);
    expect(h.years[0].academicYear).toBe("2025-2026");
  });
});

/* ─­─ Historical pricing preservation (INV-19) ───────────────────────── */

describe("T-436 — historical pricing preservation (INV-19a)", () => {
  it("a price change between years NEVER recalculates the old year's stored amounts", () => {
    const history = ownerHistory();
    const y25 = history.years[0];
    const y26 = history.years[1];
    // The stored amounts are what was actually charged then (100,000 at
    // the 2025-2026 prices) — NOT what the 2026-2027 config would price.
    expect(y25.totalCharged).toBe(100_000);
    expect(y26.totalCharged).toBe(120_000);
    expect(y25.charges[0].amountDue).toBe(40_000);
    // Both years carry their OWN config reference (INV-19b).
    expect(y25.pricingConfig?.id).toBe("cfg-2025-2026");
    expect(y26.pricingConfig?.id).toBe("cfg-2026-2027");
  });

  it("a year without a pricing config renders null (honest), never a fabricated reference", () => {
    const ins = makeInstallment({ parentId: "p-5", id: "ins-nocfg", amountDue: 10_000, dueDate: "2024-10-15", academicYearId: "ay-2024" });
    const h = computeParentYearHistory({
      parentId: "p-5", installments: [ins], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    expect(h.years[0].pricingConfig).toBeNull();
  });
});

/* ── The carry-forward chain across MULTIPLE consecutive years ─────── */

describe("T-436 — the carry-forward chain across 3 consecutive academic years", () => {
  /**
   * Parent B: owes in EVERY year, never fully pays:
   *   2024-2025: 60,000 charged, 20,000 paid (Jan 2025) → 40,000 out.
   *   2025-2026: 60,000 charged (new prices), 10,000 paid (Jan 2026) →
   *   50,000 out + the 40,000 carried in.
   *   2026-2027: re-enrolled again, 60,000 charged, nothing paid.
   * Allocations present → the EXACT settlement replay (no heuristic).
   */
  const installments: Installment[] = [
    makeInstallment({ parentId: "p-b", id: "ins-b-1", amountDue: 60_000, amountPaid: 20_000, dueDate: "2024-11-15", academicYearId: "ay-2024" }),
    makeInstallment({ parentId: "p-b", id: "ins-b-2", amountDue: 60_000, amountPaid: 10_000, dueDate: "2025-11-15", academicYearId: "ay-2025" }),
    makeInstallment({ parentId: "p-b", id: "ins-b-3", amountDue: 60_000, amountPaid: 0, dueDate: "2026-11-15", academicYearId: "ay-2026" }),
  ];
  const ledger: LedgerEntry[] = [
    makeEntry({ parentId: "p-b", id: "led-b1", sourceId: "pay-b1", amount: -20_000, at: "2025-01-10T10:00:00.000Z" }),
    makeEntry({ parentId: "p-b", id: "led-b2", sourceId: "pay-b2", amount: -10_000, at: "2026-01-10T10:00:00.000Z" }),
  ];
  const payments: Payment[] = [
    makePayment({ parentId: "p-b", id: "pay-b1", amount: 20_000, collectedAt: "2025-01-10T10:00:00.000Z", academicYearId: "ay-2024" }),
    makePayment({ parentId: "p-b", id: "pay-b2", amount: 10_000, collectedAt: "2026-01-10T10:00:00.000Z", academicYearId: "ay-2025" }),
  ];
  const allocations: PaymentAllocation[] = [
    makeAllocation({ paymentId: "pay-b1", installmentId: "ins-b-1", allocatedAmount: 20_000, createdAt: "2025-01-10T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-b2", installmentId: "ins-b-2", allocatedAmount: 10_000, createdAt: "2026-01-10T10:00:00.000Z" }),
  ];

  const h = computeParentYearHistory({
    parentId: "p-b", installments, payments, allocations, ledgerEntries: ledger,
    academicYears: YEARS, now: NOW,
  });

  it("renders all three years, each carrying the previous year's unpaid balance", () => {
    expect(h.years.map((y) => y.academicYear)).toEqual(["2024-2025", "2025-2026", "2026-2027"]);
    expect(h.years[0].carriedForwardFromPriorYear).toBe(0);
    expect(h.years[1].carriedForwardFromPriorYear).toBe(40_000);
    expect(h.years[2].carriedForwardFromPriorYear).toBe(50_000);
  });

  it("each year's year-end outstanding uses the EXACT allocation replay", () => {
    expect(h.years[0].yearEndBasis).toBe("allocations");
    expect(h.years[0].yearEndOutstanding).toBe(40_000);
    expect(h.years[1].yearEndOutstanding).toBe(50_000);
  });

  it("re-enrolled-while-owing on every closed transition; the open final year carries neither flag", () => {
    expect(h.years[0].reEnrolledOwing).toBe(true);
    expect(h.years[1].reEnrolledOwing).toBe(true);
    expect(h.years[0].leftOwing).toBe(false);
    expect(h.years[1].leftOwing).toBe(false);
    // The last year is OPEN — "left" can only be known after a year
    // closes with no successor (INV-20's honest presentation).
    expect(h.years[2].reEnrolledOwing).toBe(false);
    expect(h.years[2].leftOwing).toBe(false);
  });

  it("the old debt still owed TODAY is the sum over every prior year's current remaining", () => {
    expect(h.priorYearOutstandingStillOwed).toBe(40_000 + 50_000);
    expect(h.totalOutstandingNow).toBe(40_000 + 50_000 + 60_000);
  });
});

/* ── Left while owing ─────────────────────────────────────────────── */

describe("T-436 — a student who LEFT while still owing", () => {
  const installments: Installment[] = [
    makeInstallment({ parentId: "p-c", id: "ins-c-1", amountDue: 25_000, dueDate: "2024-12-15", academicYearId: "ay-2024" }),
  ];
  const h = computeParentYearHistory({
    parentId: "p-c", installments, ledgerEntries: [],
    academicYears: YEARS, now: NOW,
  });

  it("flags leftOwing when a closed year with outstanding has NO following charges", () => {
    expect(h.years).toHaveLength(1);
    expect(h.years[0].leftOwing).toBe(true);
    expect(h.years[0].reEnrolledOwing).toBe(false);
    expect(h.years[0].yearEndOutstanding).toBe(25_000);
  });
});

/* ─­─ Settlement semantics on the stored amounts ────────────────────── */

describe("T-436 — per-charge settlement semantics (the INV-4 family)", () => {
  it("pending-only funds are NOT a settlement (INV-4: cleared funds only — 'pending_clearance')", () => {
    const ins = makeInstallment({
      parentId: "p-d", id: "ins-pend", amountDue: 30_000,
      amountPending: 30_000, status: "pending_clearance",
      dueDate: "2025-10-15", academicYearId: "ay-2025",
    });
    const h = computeParentYearHistory({
      parentId: "p-d", installments: [ins], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    // The INV-4 remaining counts the uncleared commitment (due − paid −
    // pending = 0) — the debt is COVERED but not SETTLED.
    expect(h.years[0].charges[0].settlement).toBe("pending_clearance");
    expect(h.years[0].charges[0].remaining).toBe(0);
    expect(h.years[0].charges[0].settledAt).toBeNull();
  });

  it("partially paid charges are 'partially_paid' with the exact remaining", () => {
    const ins = makeInstallment({
      parentId: "p-e", id: "ins-part", amountDue: 30_000, amountPaid: 12_000,
      status: "partial", dueDate: "2025-10-15", academicYearId: "ay-2025",
    });
    const h = computeParentYearHistory({
      parentId: "p-e", installments: [ins], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    expect(h.years[0].charges[0].settlement).toBe("partially_paid");
    expect(h.years[0].charges[0].remaining).toBe(18_000);
  });

  it("a legacy fully-paid charge (no allocations) settles at its paidDate", () => {
    const ins = makeInstallment({
      parentId: "p-f", id: "ins-legacy", amountDue: 30_000, amountPaid: 30_000,
      status: "paid", paidDate: "2026-05-10", dueDate: "2025-10-15",
      academicYearId: "ay-2025",
    });
    const h = computeParentYearHistory({
      parentId: "p-f", installments: [ins], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    expect(h.years[0].charges[0].settlement).toBe("fully_paid");
    expect(h.years[0].charges[0].settledAt).toBe("2026-05-10");
    expect(h.years[0].yearEndOutstanding).toBe(0);
  });
});

/* ── Determinism + honest empties (INV-20b, §15.49a) ───────────────── */

describe("T-436 — determinism and honest empty states", () => {
  it("same inputs + same clock → deep-equal records", () => {
    const a = ownerHistory();
    const b = ownerHistory();
    expect(a).toEqual(b);
  });

  it("no data → empty years, zero totals (never fabricated numbers)", () => {
    const h = computeParentYearHistory({
      parentId: "p-none", installments: [], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    expect(h.years).toEqual([]);
    expect(h.totalOutstandingNow).toBe(0);
    expect(h.priorYearOutstandingStillOwed).toBe(0);
  });

  it("filters other parents' rows out (isolation)", () => {
    const s = ownerScenario();
    const h = computeParentYearHistory({
      parentId: "p-other", installments: s.installments,
      payments: s.payments, allocations: s.allocations,
      ledgerEntries: s.ledgerEntries, academicYears: YEARS, now: NOW,
    });
    expect(h.years).toEqual([]);
    expect(h.totalOutstandingNow).toBe(0);
  });

  it("reversed payments are excluded from the year's payments-made replay", () => {
    const ledger = [
      makeEntry({ parentId: "p-g", id: "led-g1", sourceId: "pay-g1", amount: -10_000, at: "2026-10-05T10:00:00.000Z" }),
      makeEntry({ parentId: "p-g", id: "led-g2", sourceId: "pay-g1", amount: 10_000, type: "reversal", reversesId: "led-g1", at: "2026-10-06T10:00:00.000Z" }),
    ];
    const h = computeParentYearHistory({
      parentId: "p-g", installments: [], ledgerEntries: ledger,
      academicYears: YEARS, now: NOW,
    });
    // The payment was reversed — no non-reversed payment remains, so no
    // year record renders at all (the honest empty state).
    expect(h.years).toHaveLength(0);
    expect(h.totalOutstandingNow).toBe(0);
  });
});

/* ── The debt-aging integration (the existing feature, re-based) ───── */

describe("T-436 — computeDebtAgingAnalysis consumes the persisted attribution (INV-18a)", () => {
  it("the obligation's origin year follows the persisted id, not the due date", () => {
    const ins = makeInstallment({
      parentId: "p-h", id: "ins-h", amountDue: 50_000,
      dueDate: "2026-01-15", academicYearId: "ay-2024",
    });
    const a = computeDebtAgingAnalysis({
      parentId: "p-h", installments: [ins], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    expect(a.obligations[0].academicYear).toBe("2024-2025");
    expect(a.originAcademicYear).toBe("2024-2025");
  });

  it("the subsequent-year payment count uses the persisted payment-year attribution", () => {
    const ins = makeInstallment({
      parentId: "p-i", id: "ins-i", amountDue: 50_000,
      dueDate: "2025-10-15", academicYearId: "ay-2025",
    });
    // pay-i was collected 2025-11-01 (INSIDE 2025-2026 by date) but its
    // persisted year is 2026-2027 (a corrected backfill) — the persisted
    // year wins: the payment counts as subsequent-year activity.
    const payments: Payment[] = [
      makePayment({ parentId: "p-i", id: "pay-i", amount: 10_000, collectedAt: "2025-11-01T10:00:00.000Z", academicYearId: "ay-2026" }),
    ];
    const ledger: LedgerEntry[] = [
      makeEntry({ parentId: "p-i", id: "led-i", sourceId: "pay-i", amount: -10_000, at: "2025-11-01T10:00:00.000Z" }),
    ];
    const a = computeDebtAgingAnalysis({
      parentId: "p-i", installments: [ins], payments, ledgerEntries: ledger,
      academicYears: YEARS, now: NOW,
    });
    expect(a.subsequentYearPaymentCount).toBe(1);
    expect(a.subsequentYearPaymentTotal).toBe(10_000);
  });

  it("byte-identical pre-T-436 behavior when no persisted ids exist", () => {
    const ins = makeInstallment({ parentId: "p-j", id: "ins-j", amountDue: 50_000, dueDate: "2026-01-15" });
    const a = computeDebtAgingAnalysis({
      parentId: "p-j", installments: [ins], ledgerEntries: [],
      academicYears: YEARS, now: NOW,
    });
    expect(a.obligations[0].academicYear).toBe("2025-2026");
    expect(a.originAcademicYear).toBe("2025-2026");
  });
});
