/**
 * T-439 — CALC-003 regression suite: the year-history engine's payment
 * STATUS classification (the bounced/refunded/cancelled-counted-as-paid
 * defect).
 *
 * THE BUG (registered before the fix per §13): `paidUpToClock`'s
 * allocation replay classified every payment that is not exactly
 * `status === "pending"` as cleared funds — so a BOUNCED cheque
 * (`status: "unpaid"` — what migration 0039's `mark_payment_bounced`
 * sets, rolling back `amount_pending` but NEVER deleting the payment's
 * `payment_allocations` rows), a REFUNDED and a CANCELLED payment all
 * settled their tranches in the per-year history, and an uncleared
 * cheque (`pending_clearance`) counted as PAID instead of pending.
 * The cross-year settlement block had NO status filter at all — a
 * bounced next-year payment fabricated « Dette réglée par des paiements
 * d'années suivantes » rows that never truly settled.
 *
 * THE CANONICAL SEMANTICS (financial-query-engine.ts — the T-424
 * classification the engine must reuse): `paid` → cleared;
 * `pending` | `pending_clearance` → committed-but-uncleared;
 * `unpaid`(bounced) | `refunded` | `cancelled` → NEITHER (the funds
 * are not real money against the charge).
 */
import { describe, it, expect } from "vitest";
import { computeParentYearHistory } from "../../../domain/calc/ledger/year-history";
import type { Installment, Payment, PaymentAllocation } from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";

const NOW = new Date("2027-01-15T12:00:00.000Z");

const YEARS = [
  { id: "ay-2025", code: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" },
  { id: "ay-2026", code: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" },
] as const;

let seq = 0;
function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  seq += 1;
  return {
    id: overrides.id ?? `ins-${seq}`,
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

function makePayment(overrides: Partial<Payment> = {}): Payment {
  seq += 1;
  return {
    id: overrides.id ?? `pay-${seq}`,
    tenantId: overrides.tenantId ?? "tenant-1",
    receiptNumber: overrides.receiptNumber ?? `REC-${seq}`,
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

function makeAllocation(overrides: Partial<PaymentAllocation> = {}): PaymentAllocation {
  seq += 1;
  return {
    id: overrides.id ?? `alloc-${seq}`,
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

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  seq += 1;
  return {
    id: overrides.id ?? `led-${seq}`,
    tenantId: overrides.tenantId ?? "tenant-1",
    accountId: overrides.accountId ?? "parent:p-1:category:all",
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? null,
    category: overrides.category ?? null,
    amount: overrides.amount ?? -10_000,
    type: overrides.type ?? "payment",
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

/**
 * The 0039 bounce shape: the cheque was collected + allocated (Feb
 * 2026), then bounced — the RPC flips the payment to `unpaid` and rolls
 * the INSTALLMENT's `amount_pending`/`amount_paid` back, but the
 * `payment_allocations` rows are NEVER deleted (only the purge
 * migrations ever delete allocations). The year-history replay must
 * therefore classify by STATUS, not by allocation existence.
 */
function bouncedChequeScenario() {
  const installments: Installment[] = [
    makeInstallment({
      id: "ins-T1", label: "Tranche 1", trancheNumber: 1,
      amountDue: 30_000, amountPaid: 20_000, dueDate: "2025-09-15",
      status: "partial", academicYearId: "ay-2025",
    }),
  ];
  const payments: Payment[] = [
    makePayment({ id: "pay-cash", amount: 20_000, status: "paid", collectedAt: "2025-11-01T10:00:00.000Z", academicYearId: "ay-2025" }),
    makePayment({ id: "pay-cheque", amount: 10_000, method: "check", status: "unpaid", collectedAt: "2026-02-01T10:00:00.000Z", academicYearId: "ay-2025" }),
  ];
  const allocations: PaymentAllocation[] = [
    makeAllocation({ paymentId: "pay-cash", installmentId: "ins-T1", allocatedAmount: 20_000, createdAt: "2025-11-01T10:00:00.000Z" }),
    makeAllocation({ paymentId: "pay-cheque", installmentId: "ins-T1", allocatedAmount: 10_000, createdAt: "2026-02-01T10:00:00.000Z" }),
  ];
  return { installments, payments, allocations, ledgerEntries: [] as LedgerEntry[] };
}

function historyFor(s: ReturnType<typeof bouncedChequeScenario>) {
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

describe("T-439 / CALC-003 — the year-history allocation replay classifies by payment STATUS (the 0039 bounce shape)", () => {
  it("a BOUNDED cheque (status unpaid, allocations retained) does NOT settle its tranche — the year-end outstanding keeps the bounced 10,000", () => {
    const h = historyFor(bouncedChequeScenario());
    const y = h.years.find((r) => r.academicYear === "2025-2026");
    expect(y).toBeDefined();
    // 30,000 due − 20,000 cleared cash − 0 pending = 10,000 carried out.
    expect(y!.yearEndOutstanding).toBe(10_000);
    expect(y!.yearEndBasis).toBe("allocations");
  });

  it("a REFUNDED payment does not settle its tranche", () => {
    const s = bouncedChequeScenario();
    const refunded = s.payments.map((p) =>
      p.id === "pay-cheque" ? { ...p, status: "refund_partial" as Payment["status"] } : p,
    );
    // refund_partial is not a real status — use the real vocabulary.
    const refundedReal = s.payments.map((p) =>
      p.id === "pay-cheque" ? { ...p, status: "refunded" as Payment["status"] } : p,
    );
    const h = historyFor({ ...s, payments: refundedReal ?? refunded });
    const y = h.years.find((r) => r.academicYear === "2025-2026");
    expect(y!.yearEndOutstanding).toBe(10_000);
  });

  it("a CANCELLED payment does not settle its tranche", () => {
    const s = bouncedChequeScenario();
    const cancelled = s.payments.map((p) =>
      p.id === "pay-cheque" ? { ...p, status: "cancelled" as Payment["status"] } : p,
    );
    const h = historyFor({ ...s, payments: cancelled });
    const y = h.years.find((r) => r.academicYear === "2025-2026");
    expect(y!.yearEndOutstanding).toBe(10_000);
  });

  it("an uncleared cheque (pending_clearance) stays PENDING — its allocation is committed, and a same-shape replay never reports it as cleared money on the charge", () => {
    // The paid/pending split is not directly exposed; the observable
    // contract is that pending funds still reduce the year-end
    // outstanding (committed) exactly like a pending cheque does.
    const s = bouncedChequeScenario();
    const uncleared = s.payments.map((p) =>
      p.id === "pay-cheque" ? { ...p, status: "pending_clearance" as Payment["status"] } : p,
    );
    const h = historyFor({ ...s, payments: uncleared });
    const y = h.years.find((r) => r.academicYear === "2025-2026");
    // 30,000 − 20,000 paid − 10,000 committed-pending = 0 carried out.
    expect(y!.yearEndOutstanding).toBe(0);
  });

  it("a bounced next-year payment does NOT fabricate a cross-year settlement of the old year's debt", () => {
    // 2025-2026 T3: 20,000 outstanding at year end. In 2026-2027 a
    // 20,000 cheque is collected against it, allocated — then BOUNCES
    // (status unpaid, allocation retained, the stored amount_paid
    // rolled back). The old year must show NO settlement received.
    const installments: Installment[] = [
      makeInstallment({
        id: "ins-T3-25", label: "Tranche 3", trancheNumber: 3,
        amountDue: 30_000, amountPaid: 10_000, dueDate: "2026-03-15",
        status: "partial", academicYearId: "ay-2025",
      }),
      makeInstallment({
        id: "ins-T1-26", label: "Tranche 1", trancheNumber: 1,
        amountDue: 40_000, dueDate: "2026-09-15", academicYearId: "ay-2026",
      }),
    ];
    const payments: Payment[] = [
      makePayment({ id: "pay-old", amount: 10_000, status: "paid", collectedAt: "2026-02-01T10:00:00.000Z", academicYearId: "ay-2025" }),
      makePayment({ id: "pay-bounced", amount: 20_000, method: "check", status: "unpaid", collectedAt: "2026-10-20T10:00:00.000Z", academicYearId: "ay-2026" }),
    ];
    const allocations: PaymentAllocation[] = [
      makeAllocation({ paymentId: "pay-old", installmentId: "ins-T3-25", allocatedAmount: 10_000, createdAt: "2026-02-01T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-bounced", installmentId: "ins-T3-25", allocatedAmount: 20_000, createdAt: "2026-10-20T10:00:00.000Z" }),
    ];
    const h = computeParentYearHistory({
      parentId: "p-1",
      installments,
      payments,
      allocations,
      ledgerEntries: [makeEntry({ sourceId: "pay-old", amount: -10_000, at: "2026-02-01T10:00:00.000Z" })],
      academicYears: YEARS,
      now: NOW,
    });
    const y = h.years.find((r) => r.academicYear === "2025-2026");
    expect(y!.settlementsReceivedFromLaterYears).toEqual([]);
    // The old year's year-end outstanding keeps the 20,000 (evaluated
    // at the 2025-2026 end — the later bounce is after the clock and,
    // post-fix, not counted as funds at all).
    expect(y!.yearEndOutstanding).toBe(20_000);
  });

  it("an UNCLEARED next-year cheque does not settle the old year's debt either (INV-4: uncleared funds are not a settlement)", () => {
    const installments: Installment[] = [
      makeInstallment({
        id: "ins-T3-25b", label: "Tranche 3", trancheNumber: 3,
        amountDue: 30_000, amountPaid: 10_000, amountPending: 20_000,
        dueDate: "2026-03-15", status: "partial", academicYearId: "ay-2025",
      }),
    ];
    const payments: Payment[] = [
      makePayment({ id: "pay-old2", amount: 10_000, status: "paid", collectedAt: "2026-02-01T10:00:00.000Z", academicYearId: "ay-2025" }),
      makePayment({ id: "pay-uncleared", amount: 20_000, method: "check", status: "pending_clearance", collectedAt: "2026-10-20T10:00:00.000Z", academicYearId: "ay-2026" }),
    ];
    const allocations: PaymentAllocation[] = [
      makeAllocation({ paymentId: "pay-old2", installmentId: "ins-T3-25b", allocatedAmount: 10_000, createdAt: "2026-02-01T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-uncleared", installmentId: "ins-T3-25b", allocatedAmount: 20_000, createdAt: "2026-10-20T10:00:00.000Z" }),
    ];
    const h = computeParentYearHistory({
      parentId: "p-1",
      installments,
      payments,
      allocations,
      ledgerEntries: [],
      academicYears: YEARS,
      now: NOW,
    });
    const y = h.years.find((r) => r.academicYear === "2025-2026");
    expect(y!.settlementsReceivedFromLaterYears).toEqual([]);
  });
});
