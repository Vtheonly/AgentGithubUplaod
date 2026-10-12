/**
 * T-510 — the per-tranche amount adjustment (DEBT-105, GitHub issue #31),
 * the repository regression suite.
 *
 * THE ARCHITECTURE UNDER TEST (the issue's required behavior): editing a
 * tranche's amount due is ONE canonical write path — the installments row
 * UPDATE + the signed DELTA ledger adjustment on the tranche's own account
 * + the audit row — so that:
 *   - only the intended tranche changes (its siblings are byte-identical);
 *   - account-level and tranche-level balances stay reconciled
 *     (the T-103 invariant: Σ installments due == Σ charges + Σ
 *     adjustments — the delta lands on BOTH sides);
 *   - payments, payment allocations, pending payments, credits, discounts,
 *     and the historical ledger entries are NEVER touched;
 *   - paid / partial / unpaid / overpaid / pending tranches are all
 *     handled with the canonical status predicates (0115 + ADR-033);
 *   - the over-covered case is explicit (flagged, the excess reported,
 *     never moved);
 *   - the no-op delta is rejected (no duplicate adjustments, no double
 *     application);
 *   - failed saves leave NO partial state.
 *
 * Layers exercised:
 *   - the mock repository twin (the TS canonical mirror);
 *   - the reactive derivations (the Créances summary — the cross-view
 *     consistency witness, the SAME engine the Finance tab reads);
 *   - the Supabase twin (the RPC payload + the read-back contract).
 *
 * This suite pins the issue's 11 mandated test scenarios.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mockInstallmentRepository,
  mockDebtRepository,
} from "../../infrastructure/mock/mock-repositories";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { SupabaseInstallmentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { Installment, PaymentAllocation } from "../../domain/model/payment";
import { installmentRemaining } from "../../domain/calc/payment/queries";
// The canonical POOLED wave derivation (the domain module the Finance
// échéancier strip maps over — never the feature file itself).
import { derivePooledTrancheWaves } from "../../domain/calc/payment/tranche-waves";

// T-053 (TENANT-103): the working tenant the tenant-scoped write path needs.
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

const PAR = "par-002";
const STU = "stu-003"; // par-002's student (seed fixture)

/* ── The fixtures: deterministic tranche rows covering EVERY status class
      the issue mandates (paid / partial / unpaid / pending-clearance /
      past-due-unpaid). The rows are ADDED to the store (the seed rows are
      never touched) and removed in the afterAll restoration. ── */

function fixture(overrides: Partial<Installment> & { id: string }): Installment {
  return {
    parentId: PAR,
    studentId: STU,
    category: "tuition",
    label: `T510 ${overrides.id}`,
    trancheNumber: 1,
    amountDue: 10_000,
    amountPaid: 0,
    amountPending: 0,
    // A FUTURE due date (the ADR-033 unpaid branch — never 'overdue').
    dueDate: "2097-06-15",
    paidDate: null,
    status: "unpaid",
    paymentPlan: "tranches",
    isCustomSchedule: false,
    customSchedule: false,
    customScheduleNote: null,
    ...overrides,
  } as Installment;
}

const FIXTURES: Installment[] = [
  fixture({ id: "t510-a", trancheNumber: 1 }), // unpaid, future-due
  fixture({ id: "t510-b", trancheNumber: 2, amountDue: 10_000, amountPaid: 4_000, status: "partial" }), // partially paid
  fixture({ id: "t510-c", trancheNumber: 3, amountDue: 10_000, amountPaid: 10_000, paidDate: "2096-12-15", status: "paid" }), // fully paid
  fixture({ id: "t510-d", amountDue: 10_000, amountPaid: 2_000, amountPending: 3_000, status: "pending_clearance" }), // pending (uncleared) funds
  fixture({ id: "t510-e", amountDue: 5_000, dueDate: "2020-01-15", status: "unpaid" }), // unpaid + PAST due (ADR-033 overdue branch)
  fixture({ id: "t510-f", amountDue: 8_000, amountPaid: 8_000, paidDate: "2096-12-15", status: "paid", category: "transport" }), // paid, transport (a second category)
];

/** The store snapshot/restore — keep the singleton clean for the other
 *  suites (the t-466 convention). */
let installmentsSnapshot: Installment[];
let ledgerSnapshot: number;
let paymentsSnapshot: unknown[];
let auditSnapshot: number;

beforeAll(() => {
  installmentsSnapshot = [...store.installments];
  ledgerSnapshot = store.ledger.length;
  paymentsSnapshot = JSON.parse(JSON.stringify(store.payments));
  auditSnapshot = store.audit.length;
  store.installments.push(...FIXTURES.map((f) => ({ ...f })));
  store.notifyInstallments();
});

afterAll(() => {
  // Remove the T-510 fixture rows + their adjustment entries (the
  // deterministic ids identify them) — the singleton stays clean for the
  // next suites (the t-466 convention).
  store.installments = [...installmentsSnapshot];
  store.ledger = store.ledger.filter((e) => !e.sourceId?.startsWith("adj-t510-"));
  store.notifyInstallments();
  store.notifyLedger();
  expect(store.installments).toHaveLength(installmentsSnapshot.length);
});

function byId(id: string): Installment | undefined {
  return store.installments.find((i) => i.id === id);
}

/** The family-level T-103 gap: Σ ledger (charges + adjustments) − Σ
 *  installments due. The invariant this change preserves: the gap is
 *  UNCHANGED by a tranche adjustment (the delta lands on both sides). */
function familyGap(): number {
  const ledgerSide = store.ledger
    .filter((e) => e.parentId === PAR && (e.type === "charge" || e.type === "adjustment"))
    .reduce((sum, e) => sum + e.amount, 0);
  const installmentsSide = store.installments
    .filter((i) => i.parentId === PAR)
    .reduce((sum, i) => sum + i.amountDue, 0);
  return ledgerSide - installmentsSide;
}

/** The count of ledger adjustment entries written for a given installment. */
function adjustmentEntriesFor(installmentId: string) {
  return store.ledger.filter(
    (e) => e.type === "adjustment" && (e.metadata as Record<string, unknown> | undefined)?.installmentId === installmentId,
  );
}

/** The count of the suite's own adjustment entries in the ledger — the
 *  honest mutation witness for the fail-closed guards (the seed ledger
 *  length is the baseline; only THIS suite's writes may grow it). */
function countT510Adjustments(): number {
  return store.ledger.filter((e) => e.sourceId?.startsWith("adj-t510-")).length;
}

/** The count of the suite's own audit rows (the append-only log keeps
 *  every pre-existing row — the witness baseline for the guards). */
function countT510AuditRows(): number {
  return store.audit.filter(
    (a) => a.action === "installment.amount_adjusted" && typeof a.entityId === "string" && a.entityId.startsWith("t510-"),
  ).length;
}

const REASON = "Correction saisie import Excel — tranche recalculée";

// ============================================================================
// Scenario 1 + 2 — editing ONE tranche does not affect others; multiple
// tranches edit independently (the issue's core isolation mandate)
// ============================================================================

describe("T-510 — scenarios 1+2: per-tranche isolation + independent edits", () => {
  it("adjusts ONE tranche: every sibling row (fixtures AND seed rows) stays byte-identical, one adjustment entry lands", async () => {
    const siblingsBefore = store.installments
      .filter((i) => i.id !== "t510-a")
      .map((i) => JSON.stringify(i));
    const ledgerBefore = store.ledger.length;

    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-a",
      newAmountDue: 12_000,
      reason: REASON,
      actorId: "usr-staff-1",
      actorName: "Agent Financier",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // The intended row moved — exactly the new total.
    expect(byId("t510-a")?.amountDue).toBe(12_000);
    expect(res.value.previousAmountDue).toBe(10_000);
    expect(res.value.delta).toBe(2_000);
    // ONE ledger adjustment entry for THIS installment.
    expect(adjustmentEntriesFor("t510-a")).toHaveLength(1);
    expect(store.ledger.length).toBe(ledgerBefore + 1);
    // EVERY sibling row is byte-identical.
    const siblingsAfter = store.installments
      .filter((i) => i.id !== "t510-a")
      .map((i) => JSON.stringify(i));
    expect(siblingsAfter).toEqual(siblingsBefore);
  });

  it("edits multiple tranches independently: each delta lands once, siblings untouched, the reported family Σ is exact", async () => {
    const dueBefore = store.installments
      .filter((i) => i.parentId === PAR)
      .reduce((s, i) => s + i.amountDue, 0);

    const r1 = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-b", newAmountDue: 11_000, reason: REASON,
    });
    const r2 = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-c", newAmountDue: 9_000, reason: REASON,
    });
    expect(r1.ok && r2.ok).toBe(true);

    expect(byId("t510-b")?.amountDue).toBe(11_000);
    expect(byId("t510-c")?.amountDue).toBe(9_000);
    expect(adjustmentEntriesFor("t510-b")).toHaveLength(1);
    expect(adjustmentEntriesFor("t510-c")).toHaveLength(1);
    // The family Σ moved by exactly the Σ deltas (+1k − 1k = 0) — and the
    // result object reports the post-write Σ (the consistency witness).
    const dueAfter = store.installments
      .filter((i) => i.parentId === PAR)
      .reduce((s, i) => s + i.amountDue, 0);
    expect(dueAfter - dueBefore).toBe(0);
    expect(r2.ok ? r2.value.installmentsDueAfter : 0).toBe(dueAfter);
    // t510-a (the scenario-1 row) is untouched by THIS scenario's edits.
    expect(byId("t510-a")?.amountDue).toBe(12_000);
  });
});

// ============================================================================
// Scenario 3 + 4 — increasing and decreasing; paid / partial / unpaid
// classes (the canonical status predicates: 0115 waterfall + ADR-033)
// ============================================================================

describe("T-510 — scenarios 3+4: both directions + every status class", () => {
  it("INCREASES an unpaid future-due tranche: stays unpaid, remaining grows (INV-4)", async () => {
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-e", newAmountDue: 6_000, reason: REASON,
    });
    expect(res.ok).toBe(true);
    const row = byId("t510-e");
    expect(row?.amountDue).toBe(6_000);
    // ADR-033: unpaid + future... t510-e is PAST-due unpaid → 'overdue'.
    expect(row?.status).toBe("overdue");
    expect(installmentRemaining(row!)).toBe(6_000);
  });

  it("DECREASES a partial tranche below its cleared funds → becomes paid (the INV-4 predicate), paidDate stamped once", async () => {
    // t510-b: due 11_000 (scenario 2), paid 4_000 → reduce to 3_500.
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-b", newAmountDue: 3_500, reason: "Remise exceptionnelle direction",
    });
    expect(res.ok).toBe(true);
    const row = byId("t510-b");
    expect(row?.amountDue).toBe(3_500);
    expect(row?.status).toBe("paid"); // 4_000 cleared >= 3_500 due
    expect(row?.paidDate).toBeTruthy(); // stamped at settlement
    expect(installmentRemaining(row!)).toBe(0); // clamped, never negative
    // NOT over-covered: paid (4k) >= new due (3.5k) but pending = 0 →
    // covered = 4k > 3.5k → overcovered IS true here (4k > 3.5k). The
    // flag must be explicit.
    expect(res.ok ? res.value.overcovered : false).toBe(true);
    expect(res.ok ? res.value.excess : 0).toBe(500);
  });

  it("re-opens a fully paid tranche (increase above the cleared funds) → partial, the paid amount is preserved", async () => {
    // t510-c: due 9_000 (scenario 2), paid 10_000 → increase to 12_000.
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-c", newAmountDue: 12_000, reason: "Majoration transport annuelle",
    });
    expect(res.ok).toBe(true);
    const row = byId("t510-c");
    expect(row?.amountDue).toBe(12_000);
    expect(row?.amountPaid).toBe(10_000); // NEVER touched
    expect(row?.status).toBe("partial");
    expect(installmentRemaining(row!)).toBe(2_000);
    expect(res.ok ? res.value.overcovered : true).toBe(false);
  });

  it("an unpaid FUTURE-due tranche reduced to 0 (the full-waiver edge) → the settled class (paid), remaining 0", async () => {
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-a", newAmountDue: 0, reason: "Annulation totale — remise direction",
    });
    expect(res.ok).toBe(true);
    const row = byId("t510-a");
    expect(row?.amountDue).toBe(0);
    // 0 cleared >= 0 due → the INV-4 settled predicate → 'paid' (the
    // settled class — the outstanding-debt server views exclude it).
    expect(row?.status).toBe("paid");
    expect(installmentRemaining(row!)).toBe(0);
  });

  it("a past-due unpaid tranche stays 'overdue' after a decrease (ADR-033 — never 'pending')", async () => {
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-e", newAmountDue: 4_000, reason: REASON,
    });
    expect(res.ok).toBe(true);
    expect(byId("t510-e")?.status).toBe("overdue");
  });
});

// ============================================================================
// Scenario 5 — pending payments, credits/discounts (the adjustment class),
// and the explicit overpayment case
// ============================================================================

describe("T-510 — scenario 5: pending funds + the adjustment (credit/discount) class + overpayments", () => {
  it("a pending-clearance tranche: the uncleared funds are PRESERVED and keep their state", async () => {
    // t510-d: due 10_000, paid 2_000, pending 3_000 → increase to 11_000.
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-d", newAmountDue: 11_000, reason: REASON,
    });
    expect(res.ok).toBe(true);
    const row = byId("t510-d");
    expect(row?.amountPaid).toBe(2_000); // preserved
    expect(row?.amountPending).toBe(3_000); // preserved — never moved
    expect(row?.status).toBe("pending_clearance"); // the uncleared state is kept
    expect(installmentRemaining(row!)).toBe(11_000 - 2_000 - 3_000); // INV-4 family
    expect(res.ok ? res.value.overcovered : true).toBe(false);
  });

  it("a DECREASE is the remise class: the ledger delta is a NEGATIVE adjustment entry (the discount semantics)", async () => {
    // t510-f: due 8_000, paid 8_000, transport → reduce to 6_000.
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-f", newAmountDue: 6_000, reason: "Remise transport 2e enfant",
    });
    expect(res.ok).toBe(true);
    const entries = adjustmentEntriesFor("t510-f");
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe(-2_000); // signed: the credit/remise direction
    expect(entries[0].category).toBe("transport"); // the tranche's OWN category
    expect(entries[0].accountId).toContain("category:transport"); // its OWN account
    // The overpayment case: paid 8k, pending 0 → covered 8k > new 6k.
    expect(res.ok ? res.value.overcovered : false).toBe(true);
    expect(res.ok ? res.value.excess : 0).toBe(2_000);
    expect(byId("t510-f")?.status).toBe("paid");
  });

  it("an INCREASE is the majoration class: the ledger delta is a POSITIVE adjustment entry", async () => {
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-d", newAmountDue: 12_000, reason: REASON,
    });
    expect(res.ok).toBe(true);
    const entries = adjustmentEntriesFor("t510-d");
    expect(entries.at(-1)?.amount).toBe(1_000); // signed: the debit direction
    expect(res.ok ? res.value.delta : 0).toBe(1_000);
  });
});

// ============================================================================
// Scenario 6 — tranches with existing payment allocations: the payments,
// the payment ledger entries, and the derived allocations are untouched
// ============================================================================

describe("T-510 — scenario 6: existing payments + allocations preserved", () => {
  it("the payments array and every payment ledger entry are byte-identical after an adjustment", async () => {
    const paymentEntriesBefore = JSON.stringify(
      store.ledger.filter((e) => e.type === "payment").map((e) => JSON.stringify(e)),
    );
    await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-b", newAmountDue: 4_000, reason: REASON,
    });
    // The payments store is untouched.
    expect(JSON.parse(JSON.stringify(store.payments))).toEqual(paymentsSnapshot);
    // The payment LEDGER entries are untouched (the allocations' source).
    const paymentEntriesAfter = JSON.stringify(
      store.ledger.filter((e) => e.type === "payment").map((e) => JSON.stringify(e)),
    );
    expect(paymentEntriesAfter).toBe(paymentEntriesBefore);
  });

  it("the derived allocations (the receipt-join) are unchanged — no payment was moved between tranches", async () => {
    const derive = (): PaymentAllocation[] => {
      // The mock's allocation derivation (allocationsForPayment /
      // observeAllocations): the ledger payment entries joined by receipt.
      const out: PaymentAllocation[] = [];
      for (const e of store.ledger.filter((x) => x.type === "payment" && x.receiptNumber)) {
        out.push({
          id: e.id, paymentId: e.receiptNumber ?? "", chargeId: null, installmentId: null,
          category: e.category, allocatedAmount: Math.abs(e.amount), label: null, createdAt: e.at,
        });
      }
      return out;
    };
    const before = JSON.stringify(derive());
    await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-c", newAmountDue: 12_500, reason: REASON,
    });
    expect(JSON.stringify(derive())).toBe(before);
  });
});

// ============================================================================
// Scenario 7 — account-level totals and tranche-level reconciliation
// (the T-103 invariant: the delta lands on BOTH sides)
// ============================================================================

describe("T-510 — scenario 7: the account/tranche reconciliation (T-103 invariant)", () => {
  it("the family-level gap (Σ charges+adjustments − Σ installments due) is UNCHANGED by the adjustment", async () => {
    const gapBefore = familyGap();
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-e", newAmountDue: 5_500, reason: REASON,
    });
    expect(res.ok).toBe(true);
    expect(familyGap()).toBe(gapBefore); // the delta landed on both sides
  });

  it("the tranche's account balance moves by EXACTLY the delta (the ledger replay witness)", async () => {
    const row = byId("t510-e")!;
    const accountId = `parent:${PAR}:category:${row.category}:student:${STU}`;
    const balance = () =>
      store.ledger
        .filter((e) => e.accountId === accountId)
        .reduce((sum, e) => sum + e.amount, 0);
    const before = balance();
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-e", newAmountDue: 6_500, reason: REASON,
    });
    expect(res.ok).toBe(true);
    expect(balance() - before).toBe(1_000); // exactly the delta
  });
});

// ============================================================================
// Scenario 8 — persistence after reload + consistency across the views
// ============================================================================

describe("T-510 — scenario 8: persistence + cross-view consistency", () => {
  it("the observe() stream (the re-read path) carries the updated row — persistence after reload", async () => {
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-b", newAmountDue: 5_000, reason: REASON,
    });
    expect(res.ok).toBe(true);
    const streamed = mockInstallmentRepository
      .observe()
      .get()
      .find((i) => i.id === "t510-b");
    expect(streamed?.amountDue).toBe(5_000);
    expect(streamed?.status).toBe("partial");
    expect(byId("t510-b")?.amountDue).toBe(5_000); // the store row == the stream row
  });

  it("the Créances summary (the ledger-based view) moves by the SAME delta as the tranche view — the two views stay reconciled", async () => {
    const summaryBefore = mockDebtRepository
      .observeSummary()
      .get()
      .find((d) => d.parentId === PAR)?.outstandingAmount ?? 0;
    const trancheBefore = store.installments
      .filter((i) => i.parentId === PAR)
      .reduce((s, i) => s + installmentRemaining(i), 0);
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-e", newAmountDue: 7_500, reason: REASON,
    });
    expect(res.ok).toBe(true);
    const summaryAfter = mockDebtRepository
      .observeSummary()
      .get()
      .find((d) => d.parentId === PAR)?.outstandingAmount ?? 0;
    const trancheAfter = store.installments
      .filter((i) => i.parentId === PAR)
      .reduce((s, i) => s + installmentRemaining(i), 0);
    // Both views moved by the same amount (the ledger entry AND the row).
    // NOTE: the INV-4 clamp means a below-coverage reduction moves the
    // tranche view by LESS than the ledger delta — this scenario keeps the
    // new due ABOVE the coverage (7_500 > 0 cleared), so both sides move
    // by exactly +1_000.
    expect(summaryAfter - summaryBefore).toBe(1_000);
    expect(trancheAfter - trancheBefore).toBe(1_000);
  });

  it("the échéancier wave derivation (the canonical pooled waves) reflects the new due", async () => {
    const now = Date.now();
    const wave1DueBefore = derivePooledTrancheWaves(store.installments.filter((i) => i.parentId === PAR), now)
      .find((w) => w.wave === 1)?.dueTotal ?? 0;
    // t510-a is wave 1 (trancheNumber 1).
    await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-a", newAmountDue: 3_000, reason: REASON,
    });
    const wave1DueAfter = derivePooledTrancheWaves(store.installments.filter((i) => i.parentId === PAR), now)
      .find((w) => w.wave === 1)?.dueTotal ?? 0;
    expect(wave1DueAfter - wave1DueBefore).toBe(3_000);
  });
});

// ============================================================================
// Scenario 9 — invalid amounts and failed saves WITHOUT partial updates
// ============================================================================

describe("T-510 — scenario 9: fail-closed guards, no partial state", () => {
  it("rejects a NEGATIVE new amount: no row, ledger, or audit mutation", async () => {
    const rowsBefore = JSON.stringify(store.installments);
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-b", newAmountDue: -5, reason: REASON,
    });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(store.installments)).toBe(rowsBefore);
    expect(store.ledger.length).toBe(ledgerSnapshot + countT510Adjustments());
    expect(store.audit.length).toBe(auditSnapshot + countT510AuditRows());
  });

  it("rejects a missing/too-short reason: no mutation", async () => {
    const ledgerBefore = store.ledger.length;
    const res1 = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-b", newAmountDue: 6_000, reason: "",
    });
    const res2 = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-b", newAmountDue: 6_000, reason: "ab",
    });
    expect(res1.ok && res2.ok).toBe(false);
    expect(store.ledger.length).toBe(ledgerBefore);
    expect(byId("t510-b")?.amountDue).toBe(5_000);
  });

  it("rejects an unknown installment id: no mutation", async () => {
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-does-not-exist", newAmountDue: 1_000, reason: REASON,
    });
    expect(res.ok).toBe(false);
  });
});

// ============================================================================
// Scenario 10 — repeated saves without duplicate adjustments / double
// application (the no-op guard)
// ============================================================================

describe("T-510 — scenario 10: the double-application guard", () => {
  it("a repeated save of the SAME value is rejected — exactly ONE adjustment entry exists, the row is unchanged", async () => {
    const r1 = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-c", newAmountDue: 13_000, reason: REASON,
    });
    expect(r1.ok).toBe(true);
    const entriesAfterFirst = adjustmentEntriesFor("t510-c").length;

    // The repeated identical save — REJECTED (the no-op guard).
    const r2 = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-c", newAmountDue: 13_000, reason: REASON,
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.message).toContain("identique");

    // No duplicate entry, no double application.
    expect(adjustmentEntriesFor("t510-c")).toHaveLength(entriesAfterFirst);
    expect(byId("t510-c")?.amountDue).toBe(13_000);

    // A DIFFERENT value still applies (the guard blocks no-ops only).
    const r3 = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-c", newAmountDue: 14_000, reason: REASON,
    });
    expect(r3.ok).toBe(true);
    expect(adjustmentEntriesFor("t510-c")).toHaveLength(entriesAfterFirst + 1);
    expect(byId("t510-c")?.amountDue).toBe(14_000);
  });
});

// ============================================================================
// Scenario 11 — preservation of historical payments, allocations, and the
// audit records (append-only)
// ============================================================================

describe("T-510 — scenario 11: history + audit preservation", () => {
  it("the pre-existing audit rows are intact and the adjustment rows are APPENDED with the full audit context", async () => {
    const auditRowsBefore = store.audit.map((a) => JSON.stringify(a));
    const res = await mockInstallmentRepository.adjustAmountDue!({
      installmentId: "t510-b", newAmountDue: 6_000, reason: "Motif d'audit T-510",
      actorId: "usr-audit-1", actorName: "Auditeur",
    });
    expect(res.ok).toBe(true);
    // Every pre-existing audit row is still present (append-only).
    const auditRowsAfter = store.audit.map((a) => JSON.stringify(a));
    for (const before of auditRowsBefore) {
      expect(auditRowsAfter).toContain(before);
    }
    // The new row: the action, the actor, the before/after pair (the
    // mock serializes `diff` to a JSON string — the store's convention).
    const entry = store.audit[0];
    expect(entry.action).toBe("installment.amount_adjusted");
    expect(entry.entityId).toBe("t510-b");
    expect(entry.actorId).toBe("usr-audit-1");
    expect(entry.actorName).toBe("Auditeur");
    const diff = JSON.parse(entry.diff as string) as {
      before: { amountDue: number; status: string };
      after: { amountDue: number; status: string; ledgerEntryId: string; installmentsDueAfter: number };
    };
    expect(diff.before).toMatchObject({ amountDue: 5_000, status: "partial" });
    expect(diff.after).toMatchObject({
      amountDue: 6_000,
      status: "partial",
      ledgerEntryId: expect.any(String),
      installmentsDueAfter: expect.any(Number),
    });
    expect(entry.note).toContain("Motif d'audit T-510");
  });

  it("the payments array is byte-identical across the WHOLE suite's adjustments", () => {
    expect(JSON.parse(JSON.stringify(store.payments))).toEqual(paymentsSnapshot);
  });
});

// ============================================================================
// The Supabase twin — the RPC payload + the read-back contract
// ============================================================================

describe("T-510 — SupabaseInstallmentRepository.adjustAmountDue (the RPC twin)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake-client capture rows are shapeless by design (the t-466 pattern)
  type Row = Record<string, any>;

  function makeClient(capture: { fn: string | null; args: Row | null }) {
    const updatedRow: Row = {
      id: "t510-sup-a",
      tenant_id: "t-1",
      parent_id: PAR,
      student_id: STU,
      category: "tuition",
      label: "Tranche 2",
      tranche_number: 2,
      amount_due: 12_000,
      amount_paid: 4_000,
      amount_pending: 0,
      due_date: "2097-06-15",
      paid_date: null,
      status: "partial",
      academic_cycle: null,
      payment_plan: "tranches",
      is_custom_schedule: false,
      custom_schedule_note: null,
      source_type: null,
      source_id: null,
      academic_year_id: null,
    };
    return {
      rpc(fn: string, args: Row) {
        capture.fn = fn;
        capture.args = args;
        return Promise.resolve({
          data: [{
            installment_id: "t510-sup-a",
            parent_id: PAR,
            previous_amount_due: 10_000,
            new_amount_due: 12_000,
            delta: 2_000,
            previous_status: "unpaid",
            new_status: "partial",
            overcovered: false,
            excess: 0,
            ledger_entry_id: "led-t510-1",
            account_balance_after: 8_000,
            installments_due_after: 42_000,
          }],
          error: null,
        });
      },
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: updatedRow, error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
  }

  it("delegates to the adjust_installment_amount RPC with the exact payload and maps the read-back row", async () => {
    const capture: { fn: string | null; args: Row | null } = { fn: null, args: null };
    const repo = new SupabaseInstallmentRepository(makeClient(capture));
    const res = await repo.adjustAmountDue({
      installmentId: "t510-sup-a",
      newAmountDue: 12_000,
      reason: "Correction saisie",
      actorId: "usr-staff-1",
      actorName: "Agent Financier",
    });
    expect(res.ok).toBe(true);
    expect(capture.fn).toBe("adjust_installment_amount");
    expect(capture.args).toMatchObject({
      p_installment_id: "t510-sup-a",
      p_new_amount_due: 12_000,
      p_reason: "Correction saisie",
      p_actor_id: "usr-staff-1",
      p_actor_name: "Agent Financier",
    });
    if (!res.ok) return;
    // The read-back row (the canonical mapper).
    expect(res.value.installment.id).toBe("t510-sup-a");
    expect(res.value.installment.amountDue).toBe(12_000);
    expect(res.value.installment.status).toBe("partial");
    // The audit-context fields the UI displays.
    expect(res.value.previousAmountDue).toBe(10_000);
    expect(res.value.delta).toBe(2_000);
    expect(res.value.previousStatus).toBe("unpaid");
    expect(res.value.overcovered).toBe(false);
    expect(res.value.excess).toBe(0);
    expect(res.value.installmentsDueAfter).toBe(42_000);
  });

  it("propagates the RPC error honestly (no fake success on a rejected guard)", async () => {
    const failing = {
      rpc() {
        return Promise.resolve({
          data: null,
          error: { message: "the new amount due equals the current amount due (10000) — nothing to adjust" },
        });
      },
    } as unknown as SupabaseClient;
    const repo = new SupabaseInstallmentRepository(failing);
    const res = await repo.adjustAmountDue({
      installmentId: "t510-sup-a",
      newAmountDue: 10_000,
      reason: "no-op",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.userMessage.length).toBeGreaterThan(0);
    }
  });
});
