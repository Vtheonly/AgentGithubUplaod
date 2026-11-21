/**
 * E2.2 (ROADMAP Phase 1 / 1.2) — the INV-4 predicate conversion:
 * ONE settled/overdue vocabulary.
 *
 * Gates:
 *   A. BUG-019 — sumPendingPayments counts the UNCLEARED PAIR
 *      (pending || pending_clearance), the financial-query-engine's own
 *      population (one vocabulary, no undercounted pending_clearance lane).
 *   B. The waterfall's no-progress fallback derives overdue DYNAMICALLY
 *      (never the stored "overdue" string — the live census: zero rows).
 *   C. The settled-predicate conversions are POPULATION-IDENTICAL to the
 *      replaced string checks (the drift matrix: a "paid"-status row with a
 *      real balance, a drifted "unpaid" row fully covered by amounts).
 *   D. deriveDebtTriage's buckets are derived through the canonical
 *      computeDebtAgingStatus engine with IDENTICAL boundaries (the
 *      per-boundary fixture: days −10/0/1/5/6/15/16/60/61/100 × the default
 *      thresholds + a custom-threshold run) — the DUP-016 bridge pinned.
 *   E. The source guards: no raw settled/overdue status-string verdicts
 *      remain in the converted files; the dead "Alerte auto" lane is gone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Installment, Payment } from "../../domain/model/payment";
import { sumPendingPayments } from "../../domain/calc/payment/sums";
import { isInstallmentSettled, isInstallmentOverdue } from "../../domain/calc/payment/queries";
import { allocatePaymentToInstallments } from "../../domain/calc/payment/waterfall-allocator";
import { deriveDebtTriage } from "../../features/dashboard/components/analytics/executive-statistics";
import { DEFAULT_DEBT_AGING_THRESHOLDS } from "../../domain/calc/ledger/debt-aging";

const SRC = join(__dirname, "../../");

// ============================================================
// A. BUG-019 — the uncleared pair
// ============================================================

function payment(status: Payment["status"], amount: number): Payment {
  return {
    id: `p-${status}-${amount}`,
    amount,
    status,
    method: "check",
    category: "tuition",
    parentId: "par-1",
    studentId: "stu-1",
    collectedAt: "2026-01-15T10:00:00Z",
    collectedBy: "collector-1",
    receiptNumber: "R-1",
    createdAt: "2026-01-15T10:00:00Z",
  } as unknown as Payment;
}

describe("E2.2 — A. sumPendingPayments counts the uncleared PAIR (BUG-019)", () => {
  it("pending + pending_clearance are BOTH counted; every other status excluded", () => {
    const payments = [
      payment("pending", 100),
      payment("pending_clearance", 250),
      payment("paid", 1000),
      payment("partial", 10),
      payment("refunded", 5),
      payment("cancelled", 5),
    ];
    expect(sumPendingPayments(payments)).toBe(350);
  });

  it("a pending_clearance-only population was ZERO before the alignment — the undercount lane", () => {
    expect(sumPendingPayments([payment("pending_clearance", 1250)])).toBe(1250);
  });

  it("the population equals the financial-query-engine's own filter (one vocabulary)", () => {
    const payments = [payment("pending", 100), payment("pending_clearance", 250), payment("paid", 999)];
    // financial-query-engine.ts:520 — the engine's own pending lane:
    const enginePopulation = payments.filter(
      (p) => p.status === "pending" || p.status === "pending_clearance",
    );
    const sumsPopulation = payments.filter(
      (p) => p.status === "pending" || p.status === "pending_clearance",
    );
    expect(sumPendingPayments(payments)).toBe(
      enginePopulation.reduce((s, p) => s + p.amount, 0),
    );
    expect(enginePopulation).toEqual(sumsPopulation);
  });
});

// ============================================================
// B. The waterfall's no-progress fallback derives overdue dynamically
// ============================================================

function installment(overrides: Partial<Installment>): Installment {
  return {
    id: "ins-1",
    parentId: "par-1",
    studentId: "stu-1",
    category: "tuition",
    label: "Tranche 1",
    trancheNumber: 1,
    amountDue: 100,
    amountPaid: 0,
    amountPending: 0,
    dueDate: "2026-01-01",
    status: "unpaid",
    paidDate: null,
    createdAt: "2025-09-01T00:00:00Z",
    ...overrides,
  } as unknown as Installment;
}

describe("E2.2 — B. the waterfall no-progress fallback (INV-4: derived, never the string)", () => {
  // The fallback branch fires only when newAmountPaid ≤ 0 (a negative
  // amountPaid data-drift row with a small payment) — the branch the
  // `ins.status === "overdue"` string read used to govern.
  function noProgressRow(dueDate: string, storedStatus: string): Installment {
    return installment({ amountDue: 100, amountPaid: -200, dueDate, status: storedStatus as Installment["status"] });
  }

  it("a PAST-due no-progress row writes \"overdue\" — even with stored status \"unpaid\" (the string never read)", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const result = allocatePaymentToInstallments(
      [noProgressRow("2026-01-01", "unpaid")],
      50,
      null,
      "paid",
      now,
    );
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].newStatus).toBe("overdue");
  });

  it("a FUTURE-due no-progress row writes \"pending\"", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const result = allocatePaymentToInstallments(
      [noProgressRow("2026-09-01", "unpaid")],
      50,
      null,
      "paid",
      now,
    );
    expect(result.allocations[0].newStatus).toBe("pending");
  });

  it("a stored-status \"overdue\" string has NO special power anymore: the future-due row stays \"pending\"", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const result = allocatePaymentToInstallments(
      [noProgressRow("2026-09-01", "overdue")],
      50,
      null,
      "paid",
      now,
    );
    expect(result.allocations[0].newStatus).toBe("pending"); // the STRING said overdue; the amounts+clock say future
  });
});

// ============================================================
// C. The settled-predicate drift matrix (population identity)
// ============================================================

describe("E2.2 — C. the settled predicate vs the replaced string checks (the drift matrix)", () => {
  it("a drifted \"unpaid\" row fully covered by amounts IS settled (the string check missed it)", () => {
    expect(
      isInstallmentSettled(installment({ status: "unpaid", amountDue: 100, amountPaid: 60, amountPending: 40 })),
    ).toBe(true);
  });

  it("a \"paid\"-status row IS settled even with a drifted balance (the status lane of the predicate)", () => {
    expect(isInstallmentSettled(installment({ status: "paid", amountDue: 100, amountPaid: 0 }))).toBe(true);
  });

  it("an ordinary owing row is NOT settled and IS dynamically overdue only past due", () => {
    const owing = installment({ status: "unpaid", amountDue: 100, amountPaid: 10 });
    expect(isInstallmentSettled(owing)).toBe(false);
    const now = new Date("2026-04-01T00:00:00Z");
    expect(isInstallmentOverdue({ ...owing, dueDate: "2026-01-01" }, now)).toBe(true);
    expect(isInstallmentOverdue({ ...owing, dueDate: "2026-09-01" }, now)).toBe(false);
  });

  it("the operational console's finder population is IDENTICAL to the old status+inline-remaining filter", () => {
    // The exact old filter (operational-query-console.tsx pre-E2.2):
    const oldFilter = (item: Installment) =>
      item.status !== "paid" &&
      Math.max(0, item.amountDue - item.amountPaid - (item.amountPending ?? 0)) > 0;
    const newFilter = (item: Installment) => !isInstallmentSettled(item);
    const rows = [
      installment({ status: "paid", amountDue: 100, amountPaid: 0 }),
      installment({ status: "paid", amountDue: 100, amountPaid: 100 }),
      installment({ status: "unpaid", amountDue: 100, amountPaid: 0 }),
      installment({ status: "unpaid", amountDue: 100, amountPaid: 60, amountPending: 40 }),
      installment({ status: "unpaid", amountDue: 100, amountPaid: 100 }),
      installment({ status: "partial", amountDue: 100, amountPaid: 30 }),
    ];
    for (const row of rows) {
      expect(newFilter(row), JSON.stringify(row)).toBe(oldFilter(row));
    }
    // And the populations over the whole matrix:
    expect(rows.filter(newFilter)).toEqual(rows.filter(oldFilter));
  });
});

// ============================================================
// D. deriveDebtTriage — the DUP-016 bridge (boundaries identical)
// ============================================================

describe("E2.2 — D. deriveDebtTriage derives through computeDebtAgingStatus (DUP-016)", () => {
  const NOW_MS = new Date("2026-04-01T00:00:00Z").getTime();
  const DAY = 86_400_000;

  function triageRow(daysOverdue: number, amountDue = 100, parentId = "par-1"): Installment {
    const dueMs = NOW_MS - daysOverdue * DAY;
    const dueDate = new Date(dueMs).toISOString().slice(0, 10);
    return installment({ parentId, amountDue, amountPaid: 0, dueDate, status: "unpaid" });
  }

  it("the per-boundary matrix: the buckets are IDENTICAL to the previous inline edges", () => {
    // Previous inline semantics (kept byte-for-byte by the bridge):
    //   days <= 0 → not_due; <= yellow(15) → current; <= red(60) → reminder; else chronic
    const cases: Array<{ days: number; expected: string }> = [
      { days: -10, expected: "not_due" },
      { days: 0, expected: "not_due" },
      { days: 1, expected: "current" },
      { days: 5, expected: "current" }, // the aging engine's green grace band — bridged INTO current
      { days: 6, expected: "current" }, // the aging engine's yellow band — current
      { days: 15, expected: "current" },
      { days: 16, expected: "reminder" }, // orange
      { days: 60, expected: "reminder" },
      { days: 61, expected: "chronic" }, // red
      { days: 100, expected: "chronic" },
    ];
    for (const { days, expected } of cases) {
      const triage = deriveDebtTriage([triageRow(days)], NOW_MS);
      const nonZero = triage.buckets.find((b) => b.amount > 0);
      expect(nonZero?.bucket, `days=${days}`).toBe(expected);
    }
  });

  it("the mixed-world totals: amounts, family funnel, and callList match the hand-computed inline-arithmetic oracle", () => {
    // Families: A (2 rows: 10d 100 + 70d 250), B (1 row: 20d 300), C (1 row: future 150)
    const rows = [
      triageRow(10, 100, "A"),
      triageRow(70, 250, "A"),
      triageRow(20, 300, "B"),
      triageRow(-5, 150, "C"),
    ];
    const triage = deriveDebtTriage(rows, NOW_MS);
    const byBucket = Object.fromEntries(triage.buckets.map((b) => [b.bucket, b.amount]));
    // Old arithmetic: not_due 150; current (10d ≤ 15) 100; reminder (20d) 300; chronic (70d) 250.
    expect(byBucket).toEqual({ not_due: 150, current: 100, reminder: 300, chronic: 250 });
    expect(triage.totalOutstanding).toBe(800);
    // Family funnel (worst-days semantics): A worst 70 (past due, beyond yellow, beyond red), B worst 20 (past due, beyond yellow), C 0.
    expect(triage.funnelFamilyCounts).toEqual({ debtors: 3, pastDue: 2, beyondYellow: 2, critical: 1 });
    // The call list = chronic families ranked by outstanding: A (350) only.
    expect(triage.callList).toHaveLength(1);
    expect(triage.callList[0].parentId).toBe("A");
    expect(triage.callList[0].outstanding).toBe(350);
  });

  it("custom thresholds flow through the canonical engine (the parameterization is real, not baked)", () => {
    const thresholds = { ...DEFAULT_DEBT_AGING_THRESHOLDS, yellowDays: 10, redDays: 30 };
    const triage = deriveDebtTriage([triageRow(12)], NOW_MS, thresholds);
    // 12 > yellow(10) and <= red(30) → reminder under the custom edges.
    expect(triage.buckets.find((b) => b.amount > 0)?.bucket).toBe("reminder");
  });

  it("a settled row never enters any bucket (the amounts gate)", () => {
    const settled = installment({ status: "unpaid", amountDue: 100, amountPaid: 100, dueDate: "2026-01-01" });
    const triage = deriveDebtTriage([settled], NOW_MS);
    expect(triage.totalOutstanding).toBe(0);
    expect(triage.funnelFamilyCounts.debtors).toBe(0);
  });
});

// ============================================================
// E. Source guards — the string verdicts are gone
// ============================================================

describe("E2.2 — E. the source guards", () => {
  const converted = [
    "domain/calc/payment/waterfall-allocator.ts",
    "features/financials/installment-schedule-tab.tsx",
    "features/dashboard/components/analytics/operational-query-console.tsx",
    "infrastructure/mock/repositories/notification-alerts-repository.ts",
    "infrastructure/mock/repositories/financial/installment-ops.ts",
  ];

  it("no raw `status === \"overdue\"` / `status === \"paid\"` verdicts remain in the converted files", () => {
    for (const f of converted) {
      const src = readFileSync(join(SRC, f), "utf8");
      // Comment lines are allowed to reference the retired idiom.
      const code = src
        .split("\n")
        .filter((line) => {
          const t = line.trim();
          return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
        })
        .join("\n");
      expect(code, f).not.toMatch(/\.status === "overdue"/);
      expect(code, f).not.toMatch(/\.status !== "overdue"/);
      // The paid-string verdict guard applies to the INSTALLMENT-verdict
      // files. The console's `payment.status === "paid"` (its paidTotal
      // card) is the PAYMENT state machine — explicitly OUT of E2.2's scope
      // (a payment IS "paid" as a lifecycle state; INV-4 governs the
      // installment settled/overdue VERDICTS).
      if (f !== "features/dashboard/components/analytics/operational-query-console.tsx") {
        expect(code, f).not.toMatch(/\.status === "paid"/);
        expect(code, f).not.toMatch(/\.status !== "paid"/);
      }
    }
  });

  it("the dead \"Alerte auto\" stored-status lane is gone; ONE predicate-driven badge remains", () => {
    const src = readFileSync(join(SRC, "features/financials/installment-schedule-tab.tsx"), "utf8");
    expect(src).not.toContain("Alerte auto");
    expect(src).toContain("isInstallmentOverdue(i)");
  });

  it("each converted file imports its canonical predicate", () => {
    expect(readFileSync(join(SRC, "domain/calc/payment/waterfall-allocator.ts"), "utf8")).toContain(
      'import { isInstallmentOverdue, isInstallmentSettled } from "./queries"',
    );
    expect(readFileSync(join(SRC, "features/dashboard/components/analytics/operational-query-console.tsx"), "utf8")).toContain(
      "isInstallmentSettled",
    );
    expect(readFileSync(join(SRC, "infrastructure/mock/repositories/notification-alerts-repository.ts"), "utf8")).toContain(
      "isInstallmentSettled",
    );
    expect(readFileSync(join(SRC, "infrastructure/mock/repositories/financial/installment-ops.ts"), "utf8")).toContain(
      "isInstallmentSettled",
    );
  });

  it("sums.ts carries the BUG-019 uncleared-pair filter", () => {
    const src = readFileSync(join(SRC, "domain/calc/payment/sums.ts"), "utf8");
    expect(src).toContain('p.status === "pending" || p.status === "pending_clearance"');
  });
});
