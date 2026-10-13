/**
 * T-517 / BUSINESS-111 — the as-of reconciliation regression suite.
 *
 * Pins the Family Account modal's financial-consistency contract after the
 * fix: the billing breakdown's `clearedPaid` applies the canonical ledger
 * replay's OWN date cutoff (`isAtOrBefore(e.at, now)`), and payments
 * recorded against FUTURE periods (the T-502/DATA-062 import bucket
 * anchors: 2V → Dec 15, v3 → Mar 15) are split into `futureRecordedPaid` —
 * surfaced, never counted as collected-to-date.
 *
 * The scenarios mirror the owner's issue report (A–I):
 *   A — fully paid invoice (100 % coverage, 0 outstanding, bridge 0)
 *   B — partially paid invoice (441 000 / 1 310 000 ≈ 33.66 % — NEVER 100 %)
 *   C — future-dated payment (excluded from cleared/coverage, present in
 *       futureRecordedPaid, bridge collapses to 0 against the as-of server
 *       balance — the NACEF contradiction cannot recur)
 *   D — scheduled installment not collected (never counted as money received)
 *   E — separate transactions each counted exactly once (the partition
 *       invariant sumPaidPayments === asOf + futureRecorded)
 *   F — the four-child family (per-child charges reconcile with the family
 *       aggregate; family-level totals never multiply by child count)
 *   G — the overdue vs outstanding offset (949 000 vs 869 000 — the
 *       stranded per-account credit, documented at the canonical engine)
 *   H — adjustments coexist with the as-of cutoff
 *   I — client/server consistency (recon.clearedPaid ≡ the canonical
 *       as-of replay's paid; recon.derivedRemaining ≡ its outstanding)
 *
 * The reference fixture is the LIVE NACEF family shape (2026-10-13
 * forensics — docs/recovery/t-517-live-verification.md): four children,
 * per-child Devis 365 000 / 345 000 / 290 000 / 310 000, per-child
 * payments V2 (Sept 15, past) + T1 (Sept 15, past) + V2_ALT (Dec 15,
 * future) + V3 (Mar 15, future), evaluation date 2026-10-13.
 */
import { describe, it, expect } from "vitest";
import {
  computeParentBillingBreakdown,
} from "../../../domain/calc/payment/billing-breakdown";
import {
  sumPaidPayments,
  sumPaidPaymentsAsOf,
  sumFutureRecordedPaidPayments,
} from "../../../domain/calc/payment/sums";
import { computeParentSummary } from "../../../domain/calc/ledger/balance";
import { buildOverdueDueDateMap } from "../../../domain/calc/ledger/overdue";
import type {
  AccountAdjustment,
  Installment,
  Payment,
  PaymentCategory,
} from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Student } from "../../../domain/model/student";

/* ============================================================ */
/*  The evaluation clock — the LIVE forensics date               */
/* ============================================================ */

const NOW = new Date("2026-10-13T12:00:00.000Z");

/* ============================================================ */
/*  Fixtures (the NACEF family shape)                            */
/* ============================================================ */

const CHILD_TOTALS = [
  { id: "stu-sai", first: "SAIFISSLEM", devis: 365_000, v2: 100_000, v3: 145_000 },
  { id: "stu-hab", first: "HABIBELLAH", devis: 345_000, v2: 92_000, v3: 133_000 },
  { id: "stu-elm", first: "ELMOATSEM", devis: 310_000, v2: 99_000, v3: 91_000 },
  { id: "stu-hib", first: "HIBERHMAN", devis: 290_000, v2: 70_000, v3: 100_000 },
] as const;

/** T1 transport versement per child (20 000, Sept 15 — past). */
const T1_PER_CHILD = 20_000;
/** V2_ALT per child (100 000, Dec 15 2026 — FUTURE at NOW). */
const V2_ALT_PER_CHILD = 100_000;

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu-1",
    tenantId: "tenant-1",
    code: "ELV-2026-000001",
    parentId: "p-1",
    firstName: "Sara",
    lastName: "BENALI",
    displayName: null,
    gender: "female",
    birthDate: "2015-04-02",
    enrollmentDate: "2026-09-01",
    level: "primaire",
    gradeYear: 3,
    gradeLevel: "3ap",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as Student;
}

function makeCharge(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: overrides.id ?? "led-charge-1",
    tenantId: "tenant-1",
    accountId:
      overrides.accountId ?? `parent:p-1:category:tuition:student:${overrides.studentId ?? "stu-1"}`,
    parentId: "p-1",
    studentId: overrides.studentId ?? "stu-1",
    category: (overrides.category as PaymentCategory) ?? "tuition",
    amount: overrides.amount ?? 285_000,
    type: "charge",
    sourceType: "bulk_import",
    sourceId: overrides.sourceId ?? "run-1",
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: overrides.description ?? "Devis annuel (import Excel run run-1)",
    actorId: "system",
    actorName: "System",
    at: overrides.at ?? "2026-09-15T00:00:00.000Z",
    metadata: overrides.metadata ?? {},
    ...overrides,
  } as LedgerEntry;
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: overrides.id ?? "pay-1",
    tenantId: "tenant-1",
    receiptNumber: overrides.receiptNumber ?? "REC-2026-000001",
    parentId: "p-1",
    studentId: overrides.studentId ?? null,
    amount: overrides.amount ?? 125_000,
    method: "cash",
    status: overrides.status ?? "paid",
    category: overrides.category ?? "tuition",
    installmentId: null,
    proofUrl: null,
    notes: overrides.notes ?? null,
    collectedBy: "usr-cashier",
    collectedAt: overrides.collectedAt ?? "2026-09-15T00:00:00.000Z",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    ...overrides,
  } as Payment;
}

function makePaymentEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: overrides.id ?? "led-pay-1",
    tenantId: "tenant-1",
    accountId: overrides.accountId ?? "parent:p-1:category:tuition",
    parentId: "p-1",
    studentId: overrides.studentId ?? null,
    category: (overrides.category as PaymentCategory) ?? "tuition",
    amount: overrides.amount ?? -125_000,
    type: "payment",
    sourceType: "bulk_import",
    sourceId: overrides.sourceId ?? "run-1",
    method: "cash",
    receiptNumber: overrides.receiptNumber ?? null,
    paymentStatus: overrides.paymentStatus ?? "paid",
    reversesId: null,
    description: overrides.description ?? "Versement (import Excel run run-1)",
    actorId: "system",
    actorName: "System",
    at: overrides.at ?? "2026-09-15T00:00:00.000Z",
    metadata: overrides.metadata ?? {},
    ...overrides,
  } as LedgerEntry;
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
    dueDate: overrides.dueDate ?? "2026-09-15",
    paidDate: overrides.paidDate ?? null,
    status: overrides.status ?? "unpaid",
    ...overrides,
  } as Installment;
}

/** The NACEF-shaped four-child fixture: charges + the 16 payments. */
function nacefFixture() {
  const students = CHILD_TOTALS.map((c) =>
    makeStudent({ id: c.id, firstName: c.first }),
  );
  const charges = CHILD_TOTALS.map((c) =>
    makeCharge({
      id: `led-devis-${c.id}`,
      studentId: c.id,
      amount: c.devis,
      accountId: `parent:p-1:category:tuition:student:${c.id}`,
    }),
  );
  const payments: Payment[] = [];
  for (const c of CHILD_TOTALS) {
    payments.push(
      makePayment({
        id: `pay-${c.id}-V2`,
        receiptNumber: `IMP-${c.id}-V2`,
        studentId: c.id,
        amount: c.v2,
        collectedAt: "2026-09-15T00:00:00.000Z", // past at NOW
      }),
      makePayment({
        id: `pay-${c.id}-T1`,
        receiptNumber: `IMP-${c.id}-T1`,
        studentId: c.id,
        amount: T1_PER_CHILD,
        category: "transport",
        collectedAt: "2026-09-15T00:00:00.000Z", // past at NOW
      }),
      makePayment({
        id: `pay-${c.id}-V2_ALT`,
        receiptNumber: `IMP-${c.id}-V2_ALT`,
        studentId: c.id,
        amount: V2_ALT_PER_CHILD,
        collectedAt: "2026-12-15T00:00:00.000Z", // FUTURE at NOW
      }),
      makePayment({
        id: `pay-${c.id}-V3`,
        receiptNumber: `IMP-${c.id}-V3`,
        studentId: c.id,
        amount: c.v3,
        collectedAt: "2027-03-15T00:00:00.000Z", // FUTURE at NOW
      }),
    );
  }
  return { students, charges, payments };
}

const NACEF_NET_DUE = CHILD_TOTALS.reduce((s, c) => s + c.devis, 0); // 1 310 000
const NACEF_PAST_PAID = CHILD_TOTALS.reduce(
  (s, c) => s + c.v2 + T1_PER_CHILD,
  0,
); // 441 000
const NACEF_FUTURE_PAID = CHILD_TOTALS.reduce(
  (s, c) => s + V2_ALT_PER_CHILD + c.v3,
  0,
); // 869 000

/* ============================================================ */
/*  The sums pair — the partition invariant                      */
/* ============================================================ */

describe("T-517 sums pair — the as-of partition", () => {
  it("partitions sumPaidPayments exactly: asOf + futureRecorded === total (scenario E)", () => {
    const { payments } = nacefFixture();
    const total = sumPaidPayments(payments);
    const asOf = sumPaidPaymentsAsOf(payments, NOW);
    const future = sumFutureRecordedPaidPayments(payments, NOW);
    expect(asOf).toBe(NACEF_PAST_PAID); // 441 000
    expect(future).toBe(NACEF_FUTURE_PAID); // 869 000
    expect(asOf + future).toBe(total); // 1 310 000 — no dinar created or lost
  });

  it("is status-strict: pending and refunded payments never enter either side", () => {
    const payments = [
      makePayment({ id: "p-paid", amount: 50_000, collectedAt: "2026-09-15T00:00:00.000Z" }),
      makePayment({ id: "p-pending", amount: 30_000, status: "pending", collectedAt: "2026-09-15T00:00:00.000Z" }),
      makePayment({ id: "p-refunded", amount: 20_000, status: "refunded", collectedAt: "2027-01-01T00:00:00.000Z" }),
    ];
    expect(sumPaidPaymentsAsOf(payments, NOW)).toBe(50_000);
    expect(sumFutureRecordedPaidPayments(payments, NOW)).toBe(0);
  });

  it("is conservative on missing dates: a paid payment with no collectedAt counts as collected", () => {
    const payments = [
      makePayment({ id: "p-nodate", amount: 70_000, collectedAt: "" } as Partial<Payment>),
    ];
    expect(sumPaidPaymentsAsOf(payments, NOW)).toBe(70_000);
    expect(sumFutureRecordedPaidPayments(payments, NOW)).toBe(0);
  });

  it("treats a payment collected exactly AT the evaluation instant as collected", () => {
    const payments = [
      makePayment({ id: "p-boundary", amount: 10_000, collectedAt: "2026-10-13T12:00:00.000Z" }),
    ];
    expect(sumPaidPaymentsAsOf(payments, NOW)).toBe(10_000); // isAtOrBefore — inclusive
    expect(sumFutureRecordedPaidPayments(payments, NOW)).toBe(0);
  });
});

/* ============================================================ */
/*  The reconciliation — scenarios A / B / C / D / F / H         */
/* ============================================================ */

describe("T-517 computeParentBillingBreakdown — the as-of reconciliation", () => {
  it("scenario A — fully paid invoice (all payments past-dated): 100 % coverage, 0 remaining, no bridge", () => {
    const { students, charges } = nacefFixture();
    const payments = CHILD_TOTALS.map((c, i) =>
      makePayment({
        id: `pay-full-${c.id}`,
        studentId: c.id,
        amount: c.devis,
        collectedAt: "2026-09-20T00:00:00.000Z", // past
        receiptNumber: `FULL-${i}`,
      }),
    );
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: [],
      payments,
      students,
      now: NOW,
      serverOutstanding: 0,
    });
    expect(breakdown.reconciliation.netDue).toBe(NACEF_NET_DUE);
    expect(breakdown.reconciliation.clearedPaid).toBe(NACEF_NET_DUE);
    expect(breakdown.reconciliation.futureRecordedPaid).toBe(0);
    expect(breakdown.reconciliation.derivedRemaining).toBe(0);
    expect(breakdown.reconciliation.bridge).toBe(0);
    expect(breakdown.reconciliation.hasBridge).toBe(false);
  });

  it("scenario B — partially paid (441 000 of 1 310 000, no future rows): coverage ≈ 33.66 %, NEVER 100 %", () => {
    const { students, charges, payments } = nacefFixture();
    const pastOnly = payments.filter(
      (p) => new Date(p.collectedAt).getTime() <= NOW.getTime(),
    );
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: [],
      payments: pastOnly,
      students,
      now: NOW,
      serverOutstanding: NACEF_NET_DUE - NACEF_PAST_PAID, // 869 000
    });
    expect(breakdown.reconciliation.clearedPaid).toBe(441_000);
    expect(breakdown.reconciliation.derivedRemaining).toBe(869_000);
    expect(breakdown.reconciliation.bridge).toBe(0);
    const pct = Math.min(
      100,
      Math.round(
        (breakdown.reconciliation.clearedPaid / breakdown.reconciliation.netDue) * 100,
      ),
    );
    expect(pct).toBe(34); // ≈ 33.66 % — the bar must NOT show 100 %
    expect(pct).toBeLessThan(100);
  });

  it("scenario C — the NACEF case: future-dated recorded payments are excluded from cleared/coverage and surfaced as futureRecordedPaid; the +869 000 bridge collapses to 0 (the modal contradiction cannot recur)", () => {
    const { students, charges, payments } = nacefFixture();
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: [],
      payments,
      students,
      now: NOW,
      serverOutstanding: 869_000, // the canonical as-of replay's outstanding
    });
    const recon = breakdown.reconciliation;
    // BEFORE T-517: clearedPaid was 1 310 000 (100 % coverage) beside a
    // 441 000 "Payé" card and an unexplained +869 000 bridge.
    expect(recon.clearedPaid).toBe(441_000);
    expect(recon.futureRecordedPaid).toBe(869_000);
    expect(recon.netDue).toBe(1_310_000);
    expect(recon.derivedRemaining).toBe(869_000);
    expect(recon.bridge).toBe(0); // the mystery bridge is GONE
    expect(recon.hasBridge).toBe(false);
    // The coverage percentage agrees with the summary cards.
    const pct = Math.min(100, Math.round((recon.clearedPaid / recon.netDue) * 100));
    expect(pct).toBe(34);
    // The partition still explains every recorded dinar.
    expect(recon.clearedPaid + recon.futureRecordedPaid).toBe(1_310_000);
  });

  it("scenario C2 — the future-recorded split is deterministic under the injected clock: advancing `now` past Dec 15 moves V2_ALT into cleared", () => {
    const { students, charges, payments } = nacefFixture();
    const later = new Date("2026-12-31T12:00:00.000Z");
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: [],
      payments,
      students,
      now: later,
    });
    const expectedCleared = NACEF_PAST_PAID + 4 * V2_ALT_PER_CHILD; // 841 000
    expect(breakdown.reconciliation.clearedPaid).toBe(expectedCleared);
    expect(breakdown.reconciliation.futureRecordedPaid).toBe(
      CHILD_TOTALS.reduce((s, c) => s + c.v3, 0),
    ); // 469 000 — only the March anchors remain future
  });

  it("scenario D — a scheduled installment not collected is never money received (real rows render verbatim; the synthetic waterfall counts only cleared payments)", () => {
    const student = makeStudent({ id: "stu-1" });
    const charges = [
      makeCharge({ id: "led-1", studentId: "stu-1", amount: 300_000 }),
    ];
    const payments = [
      makePayment({ id: "pay-1", amount: 120_000, collectedAt: "2026-09-16T00:00:00.000Z" }),
    ];

    // (a) REAL unpaid rows are authoritative (the server-side waterfall
    // state renders verbatim — never re-allocated client-side); the
    // reconciliation still counts ONLY the cleared payment as received.
    const realRows: Installment[] = [
      makeInstallment({ id: "ins-t1", studentId: "stu-1", amountDue: 120_000, dueDate: "2026-09-15", amountPaid: 0 }),
      makeInstallment({ id: "ins-t2", studentId: "stu-1", amountDue: 90_000, dueDate: "2026-12-15", amountPaid: 0 }),
      makeInstallment({ id: "ins-t3", studentId: "stu-1", amountDue: 90_000, dueDate: "2027-03-15", amountPaid: 0 }),
    ];
    const withRealRows = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: realRows,
      payments,
      students: [student],
      now: NOW,
    });
    expect(withRealRows.reconciliation.clearedPaid).toBe(120_000); // money received
    expect(withRealRows.reconciliation.futureRecordedPaid).toBe(0);
    expect(withRealRows.reconciliation.derivedRemaining).toBe(180_000);
    expect(withRealRows.byChild[0].tranchesRemaining).toBe(300_000); // the rows' own state, verbatim
    expect(withRealRows.byChild[0].isSyntheticSchedule).toBe(false);

    // (b) The SYNTHETIC path (no physical rows): the display waterfall
    // fills only the official tranches with the CLEARED payment — the two
    // future-due tranches are obligations, never money received.
    const synthetic = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: [],
      payments,
      students: [student],
      now: NOW,
    });
    expect(synthetic.reconciliation.clearedPaid).toBe(120_000);
    expect(synthetic.byChild[0].isSyntheticSchedule).toBe(true);
    expect(synthetic.byChild[0].tranchesRemaining).toBe(180_000); // 300k − 120k cleared
    const t1 = synthetic.byChild[0].tranches[0];
    expect(t1.amountPaid).toBe(120_000); // the cleared money landed on T1
    expect(t1.remaining).toBe(0);
    expect(synthetic.byChild[0].tranches.slice(1).every((t) => t.amountPaid === 0)).toBe(true);
  });

  it("scenario F — the four-child family: per-child charges reconcile with the family aggregate; totals never multiply by child count", () => {
    const { students, charges, payments } = nacefFixture();
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: [],
      payments,
      students,
      now: NOW,
    });
    // Per-child billed totals match the Devis exactly (no family-level
    // duplication, no per-child multiplication of family rows).
    expect(breakdown.byChild.map((c) => c.billedTotal)).toEqual(
      CHILD_TOTALS.map((c) => c.devis),
    );
    expect(breakdown.totalBilled).toBe(NACEF_NET_DUE);
    expect(breakdown.totalClearedPaid).toBe(NACEF_PAST_PAID);
    expect(breakdown.totalFutureRecordedPaid).toBe(NACEF_FUTURE_PAID);
    // The per-child payments (each child's four buckets) each appear once.
    expect(payments.length).toBe(16);
    expect(
      breakdown.reconciliation.clearedPaid + breakdown.reconciliation.futureRecordedPaid,
    ).toBe(NACEF_NET_DUE); // Σ per-child payments === family billed total
  });

  it("scenario H — adjustments coexist with the as-of cutoff (netDue adjusts; clearedPaid stays as-of)", () => {
    const student = makeStudent({ id: "stu-1" });
    const charges = [makeCharge({ id: "led-1", studentId: "stu-1", amount: 300_000 })];
    const adjustments: AccountAdjustment[] = [
      {
        id: "adj-1",
        parentId: "p-1",
        amount: -30_000, // remise
        reason: "Remise fratrie",
        approvedBy: "usr-admin",
        approvedAt: "2026-09-02T10:00:00.000Z",
        receiptRef: null,
      },
    ];
    const payments = [
      makePayment({ id: "pay-1", amount: 100_000, collectedAt: "2026-09-20T00:00:00.000Z" }),
      makePayment({ id: "pay-2", amount: 170_000, collectedAt: "2027-01-05T00:00:00.000Z" }), // future
    ];
    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: charges,
      installments: [],
      payments,
      students: [student],
      adjustments,
      now: NOW,
    });
    expect(breakdown.reconciliation.netDue).toBe(270_000);
    expect(breakdown.reconciliation.clearedPaid).toBe(100_000);
    expect(breakdown.reconciliation.futureRecordedPaid).toBe(170_000);
    expect(breakdown.reconciliation.derivedRemaining).toBe(170_000);
  });
});

/* ============================================================ */
/*  Scenario G + I — the canonical engine agreement              */
/* ============================================================ */

describe("T-517 client/server consistency — the recon agrees with the canonical as-of replay (scenario I) and the overdue offset is documented (scenario G)", () => {
  /** The NACEF ledger: 4 tuition charges + payment entries mirroring the
   * payments (past entries Sept 15; the 8 future entries carry the same
   * future anchors the T-502 remediation wrote). */
  function nacefLedger() {
    const { charges, payments } = nacefFixture();
    const entries: LedgerEntry[] = [...charges];
    for (const p of payments) {
      entries.push(
        makePaymentEntry({
          id: `led-${p.id}`,
          accountId: `parent:p-1:category:${p.category}:student:${p.studentId}`,
          studentId: p.studentId,
          category: p.category as PaymentCategory,
          amount: -p.amount,
          at: p.collectedAt,
          paymentStatus: "paid",
          receiptNumber: p.receiptNumber,
        }),
      );
    }
    return entries;
  }

  it("scenario I — recon.clearedPaid ≡ the replay's paid; derivedRemaining ≡ its outstanding; bridge ≡ 0", () => {
    const entries = nacefLedger();
    const { students, payments } = nacefFixture();
    const summary = computeParentSummary(
      entries,
      "p-1",
      "Famille NACEF",
      buildOverdueDueDateMap(entries),
      NOW,
    );
    // The canonical as-of replay: future-dated payment entries excluded.
    expect(summary.totalOutstanding).toBe(869_000);
    expect(summary.totalPaid).toBe(441_000);

    const breakdown = computeParentBillingBreakdown({
      ledgerEntries: entries,
      installments: [],
      payments,
      students,
      now: NOW,
      serverOutstanding: summary.totalOutstanding,
    });
    const recon = breakdown.reconciliation;
    // THE CONSISTENCY CONTRACT (the modal's two paths agree):
    expect(recon.clearedPaid).toBe(summary.totalPaid); // 441 000 === 441 000
    expect(recon.derivedRemaining).toBe(summary.totalOutstanding); // 869 000 === 869 000
    expect(recon.bridge).toBe(0);
    expect(recon.hasBridge).toBe(false);
  });

  it("scenario G — the overdue-vs-outstanding offset: 949 000 overdue vs 869 000 net outstanding = the stranded transport credit (documented, canonical, unchanged)", () => {
    const entries = nacefLedger();
    // Add the stranded-credit shape: the four per-child transport accounts
    // hold the T1 versements with NO transport charges (the Devis is a
    // single tuition-category charge that includes the transport component).
    const summary = computeParentSummary(
      entries,
      "p-1",
      "Famille NACEF",
      buildOverdueDueDateMap(entries),
      NOW,
    );
    // Four tuition accounts positive (Σ 949 000 overdue) + four transport
    // accounts at −20 000 each (−80 000) → net 869 000 outstanding.
    const positiveAccounts = summary.accounts.filter((a) => a.balance > 0.001);
    const creditAccounts = summary.accounts.filter((a) => a.balance < -0.001);
    expect(positiveAccounts.length).toBe(4);
    expect(creditAccounts.length).toBe(4);
    expect(summary.totalOverdue).toBe(949_000);
    expect(summary.totalOutstanding).toBe(869_000);
    expect(summary.totalOverdue - summary.totalOutstanding).toBe(80_000);
    // The 80 000 is exactly the stranded transport credit — the amount the
    // modal's T-517 note explains inline (« avances non affectées »).
    expect(
      creditAccounts.reduce((s, a) => s + Math.abs(a.balance), 0),
    ).toBe(80_000);
  });
});
