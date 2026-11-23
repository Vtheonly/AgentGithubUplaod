/**
 * T-579 (Session 52) — the shared payment-coverage builder unit contract.
 *
 * `src/domain/calc/payment/payment-coverage.ts` is the ONE view model behind
 * the receipt PDF, the account-statement PDF, PaymentBreakdownCard and the
 * payment modal's success stage (the T-330 cross-platform lockstep
 * discipline: same payment → same coverage lines on every surface).
 *
 * This suite pins the PURE builder semantics:
 *   S1  trancheKeyOf — the canonical trancheNumber mapping (0=FI, 1..3=T1..T3,
 *       absent=AUTRE — never label parsing, T-425).
 *   S2  buildPaymentCoverage — lines join their installment identity; the
 *       per-tranche aggregation follows the CANONICAL order (FI, T1, T2, T3,
 *       AUTRE); the per-category aggregation merges same-category lines.
 *   S3  totals — paidNow / paidToDate (CLEARED payments only, INV-4) /
 *       totalJustified / remaining (never negative — an overpaid family shows
 *       the excess, not a negative debt) / excess (explicit then derived).
 *   S4  the last-resort line — an empty allocation list synthesizes the
 *       payment's own category exactly as the card renders it.
 *   S5  honest degradation — no familyPayments ⇒ paidToDate/remaining are
 *       null (the surfaces omit the rows); never fabricated.
 *   S6  the academic year precedence (ADR-030: payment-made year → the
 *       installments' year → the INV-14 date fallback).
 *   S7  resolveAllocationsForPayments — the preloaded snapshot short-circuits
 *       the chain; uncovered payments resolve through it.
 *   S8  resolvePaymentAllocations — the canonical precedence: table read
 *       FIRST, the ledger receipt-number join as fallback.
 */
import { describe, it, expect } from "vitest";
import {
  buildPaymentCoverage,
  trancheKeyOf,
  resolveAllocationsForPayments,
  resolvePaymentAllocations,
  type CoverageRepositories,
} from "../../../domain/calc/payment/payment-coverage";
import type {
  Payment,
  PaymentAllocation,
  Installment,
} from "../../../domain/model/payment";
import type { Observable } from "../../../domain/repository/repository";

const BASE_ISO = "2026-09-10T10:00:00.000Z";
const YEAR_ID = "ay-2026-2027";

function makePayment(over: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    tenantId: "ten-1",
    receiptNumber: "REC-2026-000001",
    parentId: "par-1",
    studentId: null,
    amount: 70_000,
    method: "cash",
    status: "paid",
    category: null,
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "Guichet",
    collectedAt: BASE_ISO,
    createdAt: BASE_ISO,
    updatedAt: BASE_ISO,
    ...over,
  } as Payment;
}

function makeInstallment(over: Partial<Installment> = {}): Installment {
  return {
    id: "inst-x",
    parentId: "par-1",
    studentId: null,
    category: "tuition",
    label: "Tranche 1",
    trancheNumber: 1,
    amountDue: 100_000,
    amountPaid: 0,
    amountPending: 0,
    dueDate: "2026-12-15",
    paidDate: null,
    status: "unpaid",
    academicYearId: YEAR_ID,
    ...over,
  } as Installment;
}

function makeAllocation(over: Partial<PaymentAllocation> = {}): PaymentAllocation {
  return {
    id: "al-1",
    paymentId: "pay-1",
    chargeId: null,
    installmentId: null,
    category: "tuition",
    allocatedAmount: 40_000,
    label: null,
    createdAt: BASE_ISO,
    ...over,
  } as PaymentAllocation;
}

describe("T-579 — trancheKeyOf (the canonical trancheNumber mapping)", () => {
  it("S1: 0=FI, 1..3=T1..T3, absent/other=AUTRE — never label parsing", () => {
    expect(trancheKeyOf(makeInstallment({ trancheNumber: 0 }))).toBe("FI");
    expect(trancheKeyOf(makeInstallment({ trancheNumber: 1 }))).toBe("T1");
    expect(trancheKeyOf(makeInstallment({ trancheNumber: 2 }))).toBe("T2");
    expect(trancheKeyOf(makeInstallment({ trancheNumber: 3 }))).toBe("T3");
    expect(trancheKeyOf(makeInstallment({ trancheNumber: undefined }))).toBe("AUTRE");
    expect(trancheKeyOf(undefined)).toBe("AUTRE");
  });
});

describe("T-579 — buildPaymentCoverage (the ONE view model)", () => {
  const INSTALLMENTS: readonly Installment[] = [
    makeInstallment({ id: "inst-fi", label: "Frais d'inscription (FI)", trancheNumber: 0, amountDue: 20_000 }),
    makeInstallment({ id: "inst-t1", label: "Tranche 1", trancheNumber: 1, amountDue: 100_000 }),
    makeInstallment({ id: "inst-t2", label: "Tranche 2", trancheNumber: 2, amountDue: 100_000 }),
  ];
  const ALLOCS: readonly PaymentAllocation[] = [
    makeAllocation({ id: "a-fi", installmentId: "inst-fi", allocatedAmount: 20_000, label: "Frais d'inscription (FI)" }),
    makeAllocation({ id: "a-t1-tui", installmentId: "inst-t1", allocatedAmount: 40_000, label: "Tranche 1" }),
    makeAllocation({ id: "a-t1-tra", installmentId: "inst-t1", category: "transport", allocatedAmount: 10_000, label: "Transport" }),
    // No installmentId → AUTRE, label falls back to the category.
    makeAllocation({ id: "a-clothes", category: "uniform", allocatedAmount: 5_000, label: null, installmentId: null }),
  ];

  it("S2: lines join the installment identity; byTranche keeps the canonical order; byCategory merges", () => {
    const cov = buildPaymentCoverage(makePayment(), ALLOCS, INSTALLMENTS);
    // Lines: the installment's label wins when the allocation has none.
    expect(cov.lines.map((l) => l.trancheKey)).toEqual(["FI", "T1", "T1", "AUTRE"]);
    expect(cov.lines[3].label).toBe("Uniforme");
    // Per-tranche: canonical order FI → T1 → … ; zero-sum keys omitted.
    expect(cov.byTranche.map((t) => t.key)).toEqual(["FI", "T1", "AUTRE"]);
    expect(cov.byTranche.map((t) => t.amount)).toEqual([20_000, 50_000, 5_000]);
    // Per-category: tuition 60k (20+40), transport 10k, uniform 5k.
    const cats = [...cov.byCategory].sort((a, b) => b.amount - a.amount);
    expect(cats.map((c) => c.amount)).toEqual([60_000, 10_000, 5_000]);
  });

  it("S3: totals — paidNow / paidToDate (CLEARED only) / totalJustified / remaining (never negative) / excess", () => {
    const payment = makePayment({ amount: 70_000, expectedAmount: 65_000 });
    const familyPayments: readonly Payment[] = [
      makePayment({ id: "old-1", amount: 50_000, status: "paid" }),
      makePayment({ id: "old-2", amount: 30_000, status: "pending" }), // NOT cleared — excluded.
      payment,
    ];
    const cov = buildPaymentCoverage(payment, ALLOCS, INSTALLMENTS, { familyPayments });
    expect(cov.totals.paidNow).toBe(70_000);
    // Cleared only: 50k (old-1) + 70k (this) — the pending 30k never counts.
    expect(cov.totals.paidToDate).toBe(120_000);
    // Prix justifié: 20k + 100k + 100k = 220k.
    expect(cov.totals.totalJustified).toBe(220_000);
    expect(cov.totals.remaining).toBe(100_000);
    // Derived excess: 70k − 65k expected.
    expect(cov.totals.excess).toBe(5_000);
  });

  it("S3b: remaining is NEVER negative — an overpaid family shows the excess, not a negative debt", () => {
    const payment = makePayment({ amount: 70_000 });
    const familyPayments: readonly Payment[] = [
      makePayment({ id: "old-1", amount: 300_000, status: "paid" }),
      payment,
    ];
    const cov = buildPaymentCoverage(payment, ALLOCS, INSTALLMENTS, { familyPayments });
    expect(cov.totals.remaining).toBe(0);
    expect(cov.totals.excess).toBe(0); // no expectedAmount set → no derived excess
  });

  it("S4: an empty allocation list synthesizes the last-resort line (the card's exact convention)", () => {
    const payment = makePayment({ category: "tuition", amount: 25_000 });
    const cov = buildPaymentCoverage(payment, [], INSTALLMENTS);
    expect(cov.lines).toHaveLength(1);
    expect(cov.lines[0].label).toBe("Scolarité");
    expect(cov.lines[0].allocatedAmount).toBe(25_000);
    expect(cov.lines[0].trancheKey).toBe("AUTRE");
  });

  it("S5: honest degradation — no familyPayments ⇒ paidToDate/remaining are null, never fabricated", () => {
    const cov = buildPaymentCoverage(makePayment(), ALLOCS, INSTALLMENTS);
    expect(cov.totals.paidToDate).toBeNull();
    expect(cov.totals.remaining).toBeNull();
    // The commitment totals still hold.
    expect(cov.totals.totalJustified).toBe(220_000);
  });

  it("S6: the academic year precedence — payment-made year → installments' year → the INV-14 date fallback", () => {
    const years = [{ id: YEAR_ID, code: "2026-2027" }] as never[];
    // 1) The payment's own year wins.
    const a = buildPaymentCoverage(makePayment({ academicYearId: YEAR_ID }), ALLOCS, INSTALLMENTS, { academicYears: years });
    expect(a.academicYearLabel).toBe("2026-2027");
    // 2) Without a payment year, the installments' year resolves.
    const b = buildPaymentCoverage(makePayment({ academicYearId: null }), ALLOCS, INSTALLMENTS, { academicYears: years });
    expect(b.academicYearLabel).toBe("2026-2027");
    // 3) Nothing known → the date fallback (a 2026-09-10 payment = AY 2026-2027).
    const c = buildPaymentCoverage(makePayment({ academicYearId: null }), ALLOCS, [], {});
    expect(c.academicYearLabel).toMatch(/^20\d{2}-20\d{2}$/);
  });
});

describe("T-579 — resolveAllocationsForPayments (the statement seam)", () => {
  function obs<T>(value: T): Observable<T> {
    return { get: () => value, subscribe: () => () => {} };
  }
  function makeRepos(
    allocationsForPayment: (id: string) => Promise<{ ok: boolean; value: PaymentAllocation[] }>,
    ledgerEntries: readonly { receiptNumber: string; type: string; amount: number; category: string | null }[] = [],
  ): CoverageRepositories {
    return {
      payments: { allocationsForPayment: allocationsForPayment } as never,
      ledger: {
        observeByParent: () =>
          obs(
            ledgerEntries.map((e, i) => ({
              id: `le-${i}`,
              receiptNumber: e.receiptNumber,
              type: e.type,
              amount: e.amount,
              category: e.category,
              metadata: {},
              at: BASE_ISO,
            })) as never[],
          ),
      } as never,
    };
  }

  it("S7: the preloaded snapshot short-circuits the chain; uncovered payments resolve through it", async () => {
    const p1 = makePayment({ id: "p1" });
    const p2 = makePayment({ id: "p2", receiptNumber: "REC-LEDGER" });
    const repos = makeRepos(async (id) => ({
      ok: id === "p2",
      value: id === "p2" ? [makeAllocation({ id: "chain-2", paymentId: "p2", allocatedAmount: 12_000 })] : [],
    }));
    const preloaded = [makeAllocation({ id: "pre-1", paymentId: "p1", allocatedAmount: 30_000 })];
    const map = await resolveAllocationsForPayments(repos, [p1, p2], preloaded);
    // p1 came from the snapshot — the chain was never called for it.
    expect(map.get("p1")?.map((a) => a.id)).toEqual(["pre-1"]);
    // p2 resolved through the canonical chain.
    expect(map.get("p2")?.map((a) => a.id)).toEqual(["chain-2"]);
  });

  it("S8: resolvePaymentAllocations — the ledger receipt-number join is the fallback (mock/legacy mode)", async () => {
    const payment = makePayment({ receiptNumber: "REC-LEDGER" });
    const repos = makeRepos(async () => ({ ok: true, value: [] }), [
      { receiptNumber: "REC-LEDGER", type: "payment", amount: -40_000, category: "tuition" },
      { receiptNumber: "REC-OTHER", type: "payment", amount: -1_000, category: "transport" },
      { receiptNumber: "REC-LEDGER", type: "charge", amount: 999, category: "tuition" },
    ]);
    const rows = await resolvePaymentAllocations(repos, payment);
    // ONLY the payment-type entries sharing the receipt number — the charge
    // row and the other receipt are excluded; the amount is absolute.
    expect(rows).toHaveLength(1);
    expect(rows[0].allocatedAmount).toBe(40_000);
    expect(rows[0].category).toBe("tuition");
  });
});
