/**
 * T-502 (STATS-403) — the three-tranche meter follows the CONFIGURED debt
 * thresholds (the owner's report: "changing the number of days in the
 * configuration updates the cards and stages, but the Three-Tranche Meter
 * still reports many payments as overdue").
 *
 * The wave derivations' overdue predicate (`anyUnsettledOverdue` +
 * `overdueDebtorFamilyCount`) previously fired at 1 ms past due — a raw
 * `dueTs < nowEpochMs` comparison that ignored the tenant's configured
 * grace period (`debt.grace_period_days`, Settings → Configuration des
 * Créances), while the debt-aging engine, the triage stages and the
 * Dashboard cards all applied the configuration. The fix: the SAME
 * thresholds object flows into every wave derivation.
 *
 * This suite pins:
 *   1. the DEFAULT grace (5) — a row past due within the window is NOT
 *      overdue (the honest "in_window" middle band: neither overdue nor
 *      future);
 *   2. the CONFIGURED grace MOVES the verdicts — the same rows flip
 *      overdue/not as `gracePeriodDays` changes (the owner's exact
 *      scenario, incl. the LIVE tenant's configured grace=30);
 *   3. `overdueDebtorFamilyCount` follows the SAME configuration (the
 *      "Familles en retard" count on the meter);
 *   4. the non-wave (FI) summary follows the SAME configuration;
 *   5. PARITY under one configuration: the Statistics view model, the
 *      Finance strip view model, the pooled derivation and the per-category
 *      stats all agree on the overdue verdict for T1/T2/T3 (one
 *      configuration, every surface — the STATS-401 discipline extended
 *      to the thresholds);
 *   6. grace=0 degenerates to the day-based predicate (overdue from the
 *      first FULL day past due — the debt engine's daysBetweenFloor
 *      convention, never sub-day).
 */
import { describe, it, expect } from "vitest";
import {
  deriveTrancheWaveStats,
  derivePooledTrancheWaves,
  deriveNonWaveSummary,
} from "../../domain/calc/payment/tranche-waves";
import {
  deriveTrancheWaves as deriveStatisticsWaves,
} from "../../features/dashboard/components/analytics/executive-statistics";
import { deriveTrancheWaves as deriveFinanceWaves } from "../../features/financials/installment-schedule-tab";
import { DEFAULT_DEBT_AGING_THRESHOLDS } from "../../domain/calc/ledger/debt-aging";
import type { DebtAgingThresholds } from "../../domain/calc/ledger/debt-aging";
import type { Installment } from "../../domain/model/payment";

/** A fixed clock INSIDE the live tenant's configured reality (2026-10-11). */
const NOW = new Date("2026-10-11T00:00:00Z").getTime();

function mk(partial: Partial<Installment> & { id: string }): Installment {
  return {
    tenantId: "t",
    parentId: "par-1",
    studentId: "stu-1",
    category: "tuition",
    label: "Tranche",
    trancheNumber: 1,
    amountDue: 100_000,
    amountPaid: 0,
    amountPending: 0,
    dueDate: "2026-09-15",
    paidDate: null,
    status: "unpaid",
    academicCycle: "primaire",
    paymentPlan: "tranches",
    isCustomSchedule: false,
    customScheduleNote: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  } as Installment;
}

/** The thresholds with ONE field overridden (everything else = the DEFAULTS). */
const grace = (days: number): Pick<DebtAgingThresholds, "gracePeriodDays"> => ({
  gracePeriodDays: days,
});

describe("T-502 (STATS-403) — the wave meter's overdue verdict follows the CONFIGURED grace period", () => {
  it("DEFAULT grace (5): a row 3 days past due is NOT overdue — the honest in-window band (neither overdue nor future)", () => {
    // T1 due 2026-10-08, NOW 2026-10-11 → 3 days late (inside the default 5).
    const rows = [mk({ id: "a", parentId: "fam-a", dueDate: "2026-10-08", trancheNumber: 1 })];
    const [t1] = derivePooledTrancheWaves(rows, NOW);
    expect(t1.anyUnsettledOverdue).toBe(false);
    expect(t1.anyUnsettledFuture).toBe(false); // due date passed, but inside the window
    expect(t1.overdueDebtorFamilyCount).toBe(0);
    expect(t1.debtorFamilyCount).toBe(1); // still owes — only the VERDICT is "en cours"
  });

  it("DEFAULT grace: a row 16 days past due IS overdue (the pre-T-502 suites' fixtures stay valid)", () => {
    const rows = [mk({ id: "a", parentId: "fam-a", dueDate: "2026-09-15", trancheNumber: 1 })];
    const [t1] = derivePooledTrancheWaves(rows, NOW);
    expect(t1.anyUnsettledOverdue).toBe(true);
    expect(t1.overdueDebtorFamilyCount).toBe(1);
  });

  it("the CONFIGURED grace MOVES the verdict — the same 26-days-late T1 flips as the setting changes (the owner's live scenario: grace 5→30)", () => {
    // The live tenant's rows: T1 due 2026-09-15, now 2026-10-11 → 26 days late.
    const rows = [
      mk({ id: "a", parentId: "fam-a", dueDate: "2026-09-15", trancheNumber: 1, amountPaid: 40_000 }),
      mk({ id: "b", parentId: "fam-b", dueDate: "2026-09-15", trancheNumber: 1, amountPaid: 100_000, status: "paid" }),
    ];
    // grace 5 (default): both unsettled families' verdicts:
    const g5 = derivePooledTrancheWaves(rows, NOW, grace(5));
    expect(g5[0].anyUnsettledOverdue).toBe(true); // 26 > 5
    expect(g5[0].overdueDebtorFamilyCount).toBe(1); // fam-a owes; fam-b settled
    // grace 30 (the live configured value): 26 ≤ 30 → inside the acceptable
    // period — the meter must NOT report the wave "En retard".
    const g30 = derivePooledTrancheWaves(rows, NOW, grace(30));
    expect(g30[0].anyUnsettledOverdue).toBe(false);
    expect(g30[0].overdueDebtorFamilyCount).toBe(0);
    // grace 100: same rows, same verdict (a wide window keeps it en cours).
    const g100 = derivePooledTrancheWaves(rows, NOW, grace(100));
    expect(g100[0].anyUnsettledOverdue).toBe(false);
    // The FINANCIAL numbers never move with the configuration — only the
    // verdicts do (due/paid/pending/remaining are facts, not settings).
    for (const derived of [g5, g30, g100]) {
      expect(derived[0].dueTotal).toBe(200_000);
      expect(derived[0].paidTotal).toBe(140_000);
      expect(derived[0].remainingTotal).toBe(60_000);
      expect(derived[0].collectedPct).toBe(70);
    }
  });

  it("grace 0 degenerates to the day-based predicate (overdue from the FIRST FULL day past due — never sub-day)", () => {
    // Due 2026-10-10, NOW 2026-10-11 → 1 full day late.
    const oneDay = [mk({ id: "a", dueDate: "2026-10-10" })];
    expect(derivePooledTrancheWaves(oneDay, NOW, grace(0))[0].anyUnsettledOverdue).toBe(true);
    // Due TODAY → day 0 → not overdue even at grace 0 (the debt engine's
    // `debtAgeDays ≤ grace` tier-2 convention).
    const dueToday = [mk({ id: "b", dueDate: "2026-10-11" })];
    expect(derivePooledTrancheWaves(dueToday, NOW, grace(0))[0].anyUnsettledOverdue).toBe(false);
  });

  it("the per-category stats + the non-wave (FI) summary follow the SAME configuration", () => {
    const rows = [
      mk({ id: "t1-a", parentId: "fam-a", dueDate: "2026-09-20", trancheNumber: 1 }), // 21 days late
      mk({ id: "fi-a", parentId: "fam-a", dueDate: "2026-09-20", trancheNumber: 0, label: "Frais d'inscription (FI)" }),
    ];
    // grace 5: both the T1 wave and the FI section are overdue.
    expect(deriveTrancheWaveStats(rows, NOW, grace(5))[0].anyUnsettledOverdue).toBe(true);
    expect(deriveNonWaveSummary(rows, NOW, grace(5))[0].anyUnsettledOverdue).toBe(true);
    // grace 30: neither is (21 ≤ 30 — the acceptable period).
    expect(deriveTrancheWaveStats(rows, NOW, grace(30))[0].anyUnsettledOverdue).toBe(false);
    expect(deriveNonWaveSummary(rows, NOW, grace(30))[0].anyUnsettledOverdue).toBe(false);
  });

  it("PARITY under one configuration: Statistics view model + Finance strip + pooled derivation agree on the verdicts", () => {
    const rows = [
      mk({ id: "t1-a", parentId: "fam-a", dueDate: "2026-09-15", trancheNumber: 1, amountPaid: 40_000 }),
      mk({ id: "t2-a", parentId: "fam-a", dueDate: "2026-12-15", trancheNumber: 2 }),
      mk({ id: "t3-a", parentId: "fam-b", dueDate: "2027-03-15", trancheNumber: 3 }),
      mk({ id: "tr-a", parentId: "fam-c", category: "transport", dueDate: "2026-09-15", trancheNumber: 1, amountDue: 30_000, amountPaid: 5_000 }),
    ];
    const thresholds = grace(30); // the live tenant's configured value
    const pooled = derivePooledTrancheWaves(rows, NOW, thresholds);
    const statistics = deriveStatisticsWaves(rows, NOW, thresholds);
    const finance = deriveFinanceWaves(rows, thresholds);

    const pooledT1 = pooled.find((w) => w.wave === 1)!;
    const statsTuition1 = statistics.find((w) => w.category === "tuition" && w.wave === 1)!;
    const financeT1 = finance.find((w) => w.index === 1)!;

    // T1 is 26 days late — inside the configured 30-day window: NO surface
    // may report it overdue (the owner's exact complaint scenario).
    expect(pooledT1.anyUnsettledOverdue).toBe(false);
    expect(statsTuition1.phase).toBe("in_window");
    expect(financeT1.isOverdue).toBe(false);
    // T2/T3 are future-dated: not_due on every surface.
    const statsTuition2 = statistics.find((w) => w.category === "tuition" && w.wave === 2)!;
    const financeT2 = finance.find((w) => w.index === 2)!;
    expect(statsTuition2.phase).toBe("not_due");
    expect(financeT2.isOverdue).toBe(false);

    // The same rows under the DEFAULT grace (5) flip T1 overdue on EVERY
    // surface — the configuration is the ONLY thing that moved.
    const pooledDefault = derivePooledTrancheWaves(rows, NOW);
    const statsDefault = deriveStatisticsWaves(rows, NOW);
    const financeDefault = deriveFinanceWaves(rows);
    expect(pooledDefault.find((w) => w.wave === 1)!.anyUnsettledOverdue).toBe(true);
    expect(statsDefault.find((w) => w.category === "tuition" && w.wave === 1)!.phase).toBe("overdue");
    expect(financeDefault.find((w) => w.index === 1)!.isOverdue).toBe(true);
  });

  it("the overdueDebtorFamilyCount (the meter's « Familles en retard ») tracks the configuration across the boundary", () => {
    // Two families, 10 and 40 days late.
    const rows = [
      mk({ id: "a", parentId: "fam-10d", dueDate: "2026-10-01", trancheNumber: 1 }),
      mk({ id: "b", parentId: "fam-40d", dueDate: "2026-09-01", trancheNumber: 1 }),
    ];
    // Default grace 5: both overdue.
    expect(derivePooledTrancheWaves(rows, NOW)[0].overdueDebtorFamilyCount).toBe(2);
    // grace 15: only the 40-day family (10 ≤ 15).
    expect(derivePooledTrancheWaves(rows, NOW, grace(15))[0].overdueDebtorFamilyCount).toBe(1);
    // grace 60: neither (10 ≤ 60, 40 ≤ 60).
    expect(derivePooledTrancheWaves(rows, NOW, grace(60))[0].overdueDebtorFamilyCount).toBe(0);
  });

  it("DEFAULT_DEBT_AGING_THRESHOLDS.gracePeriodDays is the derivation's fallback (the documented 5)", () => {
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.gracePeriodDays).toBe(5);
    // A row exactly grace days late is STILL inside the window (the aging
    // engine's `debtAgeDays ≤ grace → GREEN` boundary, mirrored here).
    const boundary = [mk({ id: "a", dueDate: "2026-10-06" })]; // 5 days late at NOW
    expect(derivePooledTrancheWaves(boundary, NOW)[0].anyUnsettledOverdue).toBe(false);
    const beyond = [mk({ id: "b", dueDate: "2026-10-05" })]; // 6 days late at NOW
    expect(derivePooledTrancheWaves(beyond, NOW)[0].anyUnsettledOverdue).toBe(true);
  });
});
