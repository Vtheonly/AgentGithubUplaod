/**
 * T-424 (DATA-042) — the canonical tranche-wave derivation + the canonical
 * settled predicate: ONE rule for every surface.
 *
 * Pins:
 *   1. `isInstallmentSettled` (INV-4) — the union predicate every surface
 *      must use: status='paid' OR nothing remains (due − paid − pending
 *      clamped at 0 — uncleared pending funds count as coverage).
 *   2. `deriveTrancheWaveStats` — the canonical grouping (category ×
 *      tranche 1..4; NULL/out-of-range rows are NON-wave rows, never
 *      coerced into wave 1) with the settled count, the INV-4 remaining
 *      totals and the per-wave amount/pending sums.
 *   3. THE CROSS-SURFACE CONSISTENCY INVARIANT — over the same rows, the
 *      Statistics view model (executive-statistics.deriveTrancheWaves) and
 *      the Finance view model (installment-schedule-tab.deriveTrancheWaves)
 *      agree by construction: the Finance pooled per-index due/paid ==
 *      Σ the Statistics per-category rows for that index, and the settled
 *      counts follow the ONE predicate. This is the regression that makes
 *      the owner's report ("Tranche 1 not paid in Statistics while its
 *      payments show paid in Finance") structurally impossible.
 */
import { describe, it, expect } from "vitest";
import { isInstallmentSettled } from "../../domain/calc/payment/queries";
import { deriveTrancheWaveStats } from "../../domain/calc/payment/tranche-waves";
import { deriveTrancheWaves as deriveStatisticsWaves } from "../../features/dashboard/components/analytics/executive-statistics";
import { deriveTrancheWaves as deriveFinanceWaves } from "../../features/financials/installment-schedule-tab";
import type { Installment, PaymentCategory } from "../../domain/model/payment";

const NOW = new Date("2026-10-01T00:00:00Z").getTime();

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

describe("T-424 — isInstallmentSettled (the canonical predicate)", () => {
  it("a status=paid row is settled", () => {
    expect(isInstallmentSettled(mk({ id: "a", status: "paid", amountPaid: 100_000 }))).toBe(true);
  });

  it("a row fully covered by an UNCLEARED CHEQUE is settled (INV-4: pending counts as coverage)", () => {
    // The exact row that produced the owner's contradiction: the CRM
    // échéancier said "settled", Statistics said "not paid".
    expect(
      isInstallmentSettled(
        mk({ id: "b", status: "pending_clearance", amountPending: 100_000 }),
      ),
    ).toBe(true);
  });

  it("a partial row is NOT settled", () => {
    expect(isInstallmentSettled(mk({ id: "c", status: "partial", amountPaid: 40_000 }))).toBe(false);
  });

  it("an unpaid row with remaining is NOT settled", () => {
    expect(isInstallmentSettled(mk({ id: "d", status: "unpaid" }))).toBe(false);
  });

  it("an overdue row with remaining is NOT settled", () => {
    expect(isInstallmentSettled(mk({ id: "e", status: "overdue" }))).toBe(false);
  });

  it("a zero-due row is settled (nothing to collect)", () => {
    expect(isInstallmentSettled(mk({ id: "f", amountDue: 0 }))).toBe(true);
  });

  it("works on projections (the échéancier node shape: status string|null + the amounts)", () => {
    const node = { status: null, amountDue: 50_000, amountPaid: 50_000, amountPending: 0 };
    expect(isInstallmentSettled(node)).toBe(true);
    const unsettled = { status: "partial", amountDue: 50_000, amountPaid: 10_000, amountPending: 0 };
    expect(isInstallmentSettled(unsettled)).toBe(false);
  });
});

describe("T-424 — deriveTrancheWaveStats (the canonical grouping)", () => {
  it("groups by category × wave 1..4 and excludes NULL / out-of-range tranche rows", () => {
    const rows: Installment[] = [
      mk({ id: "1", category: "tuition", trancheNumber: 1, amountDue: 25_000, amountPaid: 25_000, status: "paid" }),
      mk({ id: "2", category: "tuition", trancheNumber: 2, amountDue: 97_000, amountPaid: 40_000, status: "partial" }),
      mk({ id: "3", category: "tuition", trancheNumber: 4, amountDue: 71_500, amountPaid: 0, status: "unpaid", dueDate: "2027-06-15" }),
      mk({ id: "4", category: "transport", trancheNumber: 1, amountDue: 30_000, amountPaid: 30_000, status: "paid" }),
      // Non-wave rows — excluded, never coerced into wave 1:
      mk({ id: "5", trancheNumber: undefined, label: "Année complète", amountDue: 999_000 }),
      mk({ id: "6", trancheNumber: 7 as unknown as 1, label: "Custom (hors-vague)", amountDue: 5_000 }),
    ];
    const stats = deriveTrancheWaveStats(rows, NOW);
    expect(stats).toHaveLength(4); // tuition#1, tuition#2, tuition#4, transport#1
    const tuition1 = stats.find((s) => s.category === "tuition" && s.wave === 1)!;
    expect(tuition1.installmentCount).toBe(1);
    expect(tuition1.settledCount).toBe(1);
    expect(tuition1.dueTotal).toBe(25_000);
    expect(tuition1.remainingTotal).toBe(0);
    const tuition2 = stats.find((s) => s.category === "tuition" && s.wave === 2)!;
    expect(tuition2.settledCount).toBe(0);
    expect(tuition2.remainingTotal).toBe(57_000);
    expect(tuition2.anyUnsettledOverdue).toBe(true); // due 2026-12-15? no — due 2026-09-15 default → past NOW
    const tuition4 = stats.find((s) => s.category === "tuition" && s.wave === 4)!;
    expect(tuition4.anyUnsettledFuture).toBe(true); // due 2027-06-15 > NOW
    // The "Année complète" and custom rows contributed nothing:
    const sumDue = stats.reduce((s, w) => s + w.dueTotal, 0);
    expect(sumDue).toBe(25_000 + 97_000 + 71_500 + 30_000);
  });

  it("counts settled via the canonical predicate (an uncleared cheque covering a tranche settles it)", () => {
    const rows: Installment[] = [
      mk({ id: "p1", trancheNumber: 1, status: "pending_clearance", amountPending: 100_000 }),
    ];
    const [wave] = deriveTrancheWaveStats(rows, NOW);
    expect(wave.settledCount).toBe(1);
    expect(wave.remainingTotal).toBe(0);
    expect(wave.debtorFamilyCount).toBe(0);
  });

  it("pending funds are summed per wave", () => {
    const rows: Installment[] = [
      mk({ id: "p2", trancheNumber: 3, amountPending: 12_500, status: "pending_clearance" }),
    ];
    const [wave] = deriveTrancheWaveStats(rows, NOW);
    expect(wave.pendingTotal).toBe(12_500);
  });
});

describe("T-424 — the cross-surface consistency invariant (Statistics ≡ Finance)", () => {
  it("over the SAME rows, the Finance pooled per-index totals equal Σ the Statistics per-category rows, and settled follows ONE predicate", () => {
    const categories: PaymentCategory[] = ["tuition", "transport"];
    const rows: Installment[] = [];
    let n = 0;
    for (const category of categories) {
      for (const wave of [1, 2, 3, 4] as const) {
        rows.push(
          mk({
            id: `x${n++}`,
            category,
            trancheNumber: wave,
            amountDue: 100_000 + wave * 1_000,
            amountPaid: wave === 1 ? 100_000 + 1_000 : 30_000,
            status: wave === 1 ? "paid" : "partial",
            dueDate: `2026-${String(3 + wave * 3).padStart(2, "0")}-15`,
          }),
        );
      }
    }
    // Non-wave noise must not perturb either surface:
    rows.push(mk({ id: "noise", trancheNumber: undefined, amountDue: 999_000 }));

    const stats = deriveStatisticsWaves(rows, NOW); // Statistics view
    const fin = deriveFinanceWaves(rows); // Finance view

    for (const wave of [1, 2, 3, 4] as const) {
      const finCard = fin.find((f) => f.index === wave)!;
      const statRows = stats.filter((s) => s.wave === wave);
      const dueTotal = statRows.reduce((s, w) => s + w.dueTotal, 0);
      const paidTotal = statRows.reduce((s, w) => s + w.paidTotal, 0);
      expect(finCard.due, `wave ${wave}: Finance due == Σ Statistics per-category due`).toBe(dueTotal);
      expect(finCard.paid, `wave ${wave}: Finance paid == Σ Statistics per-category paid`).toBe(paidTotal);
      expect(finCard.pct).toBe(dueTotal > 0 ? Math.min(100, Math.round((paidTotal / dueTotal) * 100)) : 0);
    }

    // The settled count follows the ONE predicate on both surfaces:
    for (const s of stats) {
      const settledRows = rows.filter(
        (r) => r.category === s.category && r.trancheNumber === s.wave && isInstallmentSettled(r),
      );
      expect(s.paidCount).toBe(settledRows.length);
    }

    // Wave 1 fully settled → not the next target on either surface:
    const nextFinance = fin.find((f) => f.isNextTarget)!;
    expect(nextFinance.index).toBe(2);
  });
});
