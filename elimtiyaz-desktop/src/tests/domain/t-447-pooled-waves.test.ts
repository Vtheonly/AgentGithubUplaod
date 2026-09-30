/**
 * T-447 (STATS-401) — the canonical POOLED all-categories T1/T2/T3
 * derivation + the non-wave summary: the exact-dinar parity object.
 *
 * The owner's mandate: "Finance and Statistics tranches must represent
 * exactly the same thing… the main T1/T2/T3 analysis must include ALL
 * revenue/commitment categories… Ensure Total Due = Paid + Pending +
 * Remaining… Finance and Statistics must match to the exact dinar."
 *
 * This suite pins the DOMAIN contract (Phase 1):
 *   1. the pooled derivation pools EVERY category per wave (tuition,
 *      transport, canteen, uniform, books, extracurricular, therapy,
 *      … — no silent exclusion);
 *   2. family counts are SET UNIONS (a family owing tuition T1 AND
 *      transport T1 counts ONCE);
 *   3. the reconciliation identity holds EXACTLY per wave:
 *      dueTotal + overCoverageTotal = paidTotal + pendingTotal + remainingTotal;
 *   4. the Finance view model (installment-schedule-tab.deriveTrancheWaves)
 *      consumes the SAME pooled object — its numbers are the canonical
 *      numbers, to the dinar, for T1 AND T2 AND T3;
 *   5. collectedPct is the PARITY-001 rate (round, never clamped — an
 *      over-covered wave reads > 100);
 *   6. the non-wave summary surfaces FI (tranche 0) + unnumbered +
 *      out-of-range rows — the categories the wave model excludes BY
 *      DESIGN are visible, never silently dropped;
 *   7. honest-empty: no rows → no waves; emptyPooledWave is the zero state.
 */
import { describe, it, expect } from "vitest";
import {
  deriveTrancheWaveStats,
  derivePooledTrancheWaves,
  deriveNonWaveSummary,
  emptyPooledWave,
} from "../../domain/calc/payment/tranche-waves";
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

/** The every-category corpus: each category carries T1/T2/T3 rows. */
const ALL_CATEGORY_ROWS: Installment[] = [
  // tuition — the 3 official tranches for two families
  mk({ id: "tu1-a", category: "tuition", trancheNumber: 1, parentId: "fam-a", amountDue: 80_000, amountPaid: 50_000 }),
  mk({ id: "tu1-b", category: "tuition", trancheNumber: 1, parentId: "fam-b", amountDue: 80_000, amountPaid: 80_000, status: "paid" }),
  mk({ id: "tu2-a", category: "tuition", trancheNumber: 2, parentId: "fam-a", amountDue: 80_000, amountPaid: 20_000, amountPending: 10_000, dueDate: "2026-12-15" }),
  mk({ id: "tu2-b", category: "tuition", trancheNumber: 2, parentId: "fam-b", amountDue: 80_000, amountPaid: 0, dueDate: "2026-12-15" }),
  mk({ id: "tu3-a", category: "tuition", trancheNumber: 3, parentId: "fam-a", amountDue: 80_000, amountPaid: 0, dueDate: "2027-03-15" }),
  // transport — same families (the UNION case) + one transport-only family
  mk({ id: "tr1-a", category: "transport", trancheNumber: 1, parentId: "fam-a", amountDue: 30_000, amountPaid: 30_000, status: "paid" }),
  mk({ id: "tr1-c", category: "transport", trancheNumber: 1, parentId: "fam-c", amountDue: 30_000, amountPaid: 0 }),
  mk({ id: "tr2-a", category: "transport", trancheNumber: 2, parentId: "fam-a", amountDue: 30_000, amountPaid: 0, dueDate: "2026-12-15" }),
  // the auxiliary service categories — one row each in wave 1
  ...(
    [
      "canteen",
      "uniform",
      "books",
      "extracurricular",
      "therapy_psychology",
      "therapy_speech",
      "second_apron",
      "other",
    ] as PaymentCategory[]
  ).map((category, i) =>
    mk({
      id: `svc-${category}`,
      category,
      trancheNumber: 1,
      parentId: "fam-d",
      amountDue: 10_000 + i,
      amountPaid: 5_000,
    }),
  ),
];

describe("T-447 — derivePooledTrancheWaves (the canonical all-categories pool)", () => {
  it("pools EVERY category's rows into the per-wave totals — no category is silently excluded", () => {
    const pooled = derivePooledTrancheWaves(ALL_CATEGORY_ROWS, NOW);
    const t1 = pooled.find((w) => w.wave === 1)!;
    // tuition + transport + all 8 service categories carry T1 rows
    expect(t1.installmentCount).toBe(2 + 2 + 8);
    // every category present in the rows appears in the breakdown
    const categories = t1.perCategory.map((c) => c.category);
    for (const c of [
      "tuition",
      "transport",
      "canteen",
      "uniform",
      "books",
      "extracurricular",
      "therapy_psychology",
      "therapy_speech",
      "second_apron",
      "other",
    ] as PaymentCategory[]) {
      expect(categories).toContain(c);
    }
    // the per-category breakdown is the canonical per-category stats (the
    // SAME object family — pooled sums === Σ per-category sums)
    const stats = deriveTrancheWaveStats(ALL_CATEGORY_ROWS, NOW);
    const t1Stats = stats.filter((s) => s.wave === 1);
    expect(t1.dueTotal).toBe(t1Stats.reduce((s, r) => s + r.dueTotal, 0));
    expect(t1.paidTotal).toBe(t1Stats.reduce((s, r) => s + r.paidTotal, 0));
    expect(t1.pendingTotal).toBe(t1Stats.reduce((s, r) => s + r.pendingTotal, 0));
    expect(t1.remainingTotal).toBe(t1Stats.reduce((s, r) => s + r.remainingTotal, 0));
  });

  it("family counts are SET UNIONS across categories — a family owing tuition T1 AND transport T1 counts ONCE", () => {
    const pooled = derivePooledTrancheWaves(ALL_CATEGORY_ROWS, NOW);
    const t1 = pooled.find((w) => w.wave === 1)!;
    // fam-a (tuition + transport), fam-b (tuition), fam-c (transport), fam-d (services)
    expect(t1.familyCount).toBe(4);
    // NOT the sum of per-category family counts (2 + 2 + 1 = 5 — the
    // double-count trap the union exists to prevent)
    expect(t1.familyCount).not.toBe(t1.perCategory.reduce((s, c) => s + c.familyCount, 0));
  });

  it("carries the reconciliation identity EXACTLY: due + overCoverage = paid + pending + remaining (every wave, every category corpus)", () => {
    const pooled = derivePooledTrancheWaves(ALL_CATEGORY_ROWS, NOW);
    expect(pooled.length).toBeGreaterThan(0);
    for (const w of pooled) {
      expect(w.dueTotal + w.overCoverageTotal).toBe(w.paidTotal + w.pendingTotal + w.remainingTotal);
    }
    // and on the plain (no over-coverage) corpus the identity is the
    // mandate's plain form: Total Due = Paid + Pending + Remaining
    const t1 = pooled.find((w) => w.wave === 1)!;
    expect(t1.overCoverageTotal).toBe(0);
    expect(t1.dueTotal).toBe(t1.paidTotal + t1.pendingTotal + t1.remainingTotal);
  });

  it("overCoverageTotal surfaces funds beyond the row's due (parent credit ON the row) so the identity never silently breaks", () => {
    const rows = [
      mk({ id: "over-1", parentId: "fam-x", amountDue: 100_000, amountPaid: 90_000, amountPending: 20_000, status: "partial" }),
    ];
    const [t1] = derivePooledTrancheWaves(rows, NOW);
    // remaining clamps to 0 (90k + 20k > 100k); the 10k excess is the over-coverage
    expect(t1.remainingTotal).toBe(0);
    expect(t1.overCoverageTotal).toBe(10_000);
    expect(t1.dueTotal + t1.overCoverageTotal).toBe(t1.paidTotal + t1.pendingTotal + t1.remainingTotal);
    expect(t1.collectedPct).toBe(90); // round(paid/due) — the PARITY-001 basis
  });

  it("collectedPct is round(paid/due × 100) — NEVER clamped (an over-covered wave reads above 100)", () => {
    const rows = [
      mk({ id: "pc-1", parentId: "fam-x", amountDue: 100_000, amountPaid: 100_000, status: "paid" }),
      mk({ id: "pc-2", parentId: "fam-y", amountDue: 100_000, amountPaid: 100_000, status: "paid" }),
      mk({ id: "pc-3", parentId: "fam-z", amountDue: 100_000, amountPaid: 15_000 }),
    ];
    const [t1] = derivePooledTrancheWaves(rows, NOW);
    expect(t1.paidTotal).toBe(215_000);
    expect(t1.dueTotal).toBe(300_000);
    expect(t1.collectedPct).toBe(72);
    // the over-covered single-row case: paid 120k on due 100k → 120%
    const [over] = derivePooledTrancheWaves(
      [mk({ id: "pc-4", parentId: "fam-x", amountDue: 100_000, amountPaid: 120_000 })],
      NOW,
    );
    expect(over.collectedPct).toBe(120);
  });

  it("pools the due-date range and the overdue flag across categories", () => {
    const pooled = derivePooledTrancheWaves(ALL_CATEGORY_ROWS, NOW);
    const t1 = pooled.find((w) => w.wave === 1)!;
    expect(t1.dueDateMin).toBe(new Date("2026-09-15").getTime());
    expect(t1.anyUnsettledOverdue).toBe(true); // tu1-a: unpaid, past due
    const t3 = pooled.find((w) => w.wave === 3)!;
    expect(t3.anyUnsettledFuture).toBe(true); // tu3-a: future-dated
  });

  it("honest-empty: no wave rows → no pooled waves; emptyPooledWave is the zero state", () => {
    expect(derivePooledTrancheWaves([], NOW)).toEqual([]);
    // FI-only rows (non-wave) produce NO pooled wave
    expect(derivePooledTrancheWaves([mk({ id: "fi-1", trancheNumber: 0 })], NOW)).toEqual([]);
    const zero = emptyPooledWave(2);
    expect(zero.wave).toBe(2);
    expect(zero.dueTotal).toBe(0);
    expect(zero.installmentCount).toBe(0);
    expect(zero.perCategory).toEqual([]);
    expect(zero.collectedPct).toBe(0);
  });

  it("only waves with at least one row are returned (T1..T3 slots the presentations fill)", () => {
    const pooled = derivePooledTrancheWaves(
      [mk({ id: "only-3", trancheNumber: 3, dueDate: "2027-03-15" })],
      NOW,
    );
    expect(pooled.map((w) => w.wave)).toEqual([3]);
  });
});

describe("T-447 — Finance ↔ Statistics exact-dinar parity (the mandate's core invariant)", () => {
  it("the Finance view model consumes the canonical pool: every T1/T2/T3 number equals the canonical pooled derivation, to the dinar", () => {
    const pooled = derivePooledTrancheWaves(ALL_CATEGORY_ROWS, NOW);
    // NOTE: the Finance derivation reads the real clock internally; the
    // corpus rows are pinned around NOW so the phases agree.
    const finance = deriveFinanceWaves(ALL_CATEGORY_ROWS);
    expect(finance).toHaveLength(3);
    for (const fw of finance) {
      const canonical = pooled.find((p) => p.wave === fw.index) ?? emptyPooledWave(fw.index);
      expect(fw.due).toBe(canonical.dueTotal);
      expect(fw.paid).toBe(canonical.paidTotal);
      expect(fw.pending).toBe(canonical.pendingTotal);
      expect(fw.remaining).toBe(canonical.remainingTotal);
      expect(fw.pct).toBe(canonical.collectedPct);
    }
    // the concrete mandate numbers on the every-category corpus:
    const t1 = finance.find((w) => w.index === 1)!;
    const t1Canon = pooled.find((w) => w.wave === 1)!;
    expect(t1.due).toBe(t1Canon.dueTotal);
    // tuition T1 160k + transport T1 60k + the 8 service rows (10_000..10_007 → 80_028)
    expect(t1.due).toBe(300_028);
  });

  it("the parity holds per category too: Σ perCategory === the per-category canonical stats (the breakdown the Statistics detail grid renders)", () => {
    const pooled = derivePooledTrancheWaves(ALL_CATEGORY_ROWS, NOW);
    const stats = deriveTrancheWaveStats(ALL_CATEGORY_ROWS, NOW);
    for (const p of pooled) {
      const statsForWave = stats.filter((s) => s.wave === p.wave);
      expect(p.perCategory).toHaveLength(statsForWave.length);
      for (const c of p.perCategory) {
        const s = statsForWave.find((x) => x.category === c.category)!;
        expect(c.dueTotal).toBe(s.dueTotal);
        expect(c.paidTotal).toBe(s.paidTotal);
        expect(c.remainingTotal).toBe(s.remainingTotal);
        expect(c.familyCount).toBe(s.familyCount);
      }
    }
  });

  it("the Finance strip's tuitionPct equals the per-category tuition rate (the T-432 reconciliation line, now derived from the SAME pool)", () => {
    const pooled = derivePooledTrancheWaves(ALL_CATEGORY_ROWS, NOW);
    const finance = deriveFinanceWaves(ALL_CATEGORY_ROWS);
    const t1 = finance.find((w) => w.index === 1)!;
    const tuition = pooled.find((w) => w.wave === 1)!.perCategory.find((c) => c.category === "tuition")!;
    expect(t1.tuitionPct).toBe(Math.round((tuition.paidTotal / tuition.dueTotal) * 100));
  });
});

describe("T-447 — deriveNonWaveSummary (FI + unnumbered + out-of-range)", () => {
  it("surfaces the registration fee (category tuition, tranche 0) as its own group, FIRST", () => {
    const rows = [
      mk({ id: "fi-1", trancheNumber: 0, label: "Frais d'inscription (FI)", amountDue: 10_000, amountPaid: 10_000, status: "paid" }),
      mk({ id: "tu1-1", trancheNumber: 1, amountDue: 80_000 }),
      mk({ id: "full-1", trancheNumber: undefined, label: "Année complète", amountDue: 240_000, amountPaid: 0, parentId: "fam-e" }),
      // The legacy phantom T4: outside the typed 0..3 contract (it can
      // only arrive via legacy/untyped rows) — the derivation's
      // out-of-range arm is deliberately defensive; the cast documents
      // that this test exercises the UNTYPED legacy shape.
      mk({ id: "legacy-4", trancheNumber: 4 as Installment["trancheNumber"], label: "Tranche 4 (legacy)", amountDue: 80_000, parentId: "fam-f" }),
    ];
    const nonWave = deriveNonWaveSummary(rows, NOW);
    expect(nonWave.map((g) => g.kind)).toEqual(["fi", "unnumbered", "out_of_range"]);
    const fi = nonWave.find((g) => g.kind === "fi")!;
    expect(fi.category).toBe("tuition");
    expect(fi.installmentCount).toBe(1);
    expect(fi.settledCount).toBe(1);
    expect(fi.dueTotal).toBe(10_000);
    const full = nonWave.find((g) => g.kind === "unnumbered")!;
    expect(full.remainingTotal).toBe(240_000);
    const legacy = nonWave.find((g) => g.kind === "out_of_range")!;
    expect(legacy.dueTotal).toBe(80_000);
  });

  it("the non-wave rows NEVER leak into the waves (rule 1 — excluded, never coerced)", () => {
    const rows = [
      mk({ id: "fi-1", trancheNumber: 0 }),
      mk({ id: "full-1", trancheNumber: undefined }),
      mk({ id: "legacy-4", trancheNumber: 4 as Installment["trancheNumber"] }),
    ];
    expect(derivePooledTrancheWaves(rows, NOW)).toEqual([]);
    expect(deriveTrancheWaveStats(rows, NOW)).toEqual([]);
    expect(deriveNonWaveSummary(rows, NOW)).toHaveLength(3);
  });

  it("carries the same reconciliation identity and counts per (kind × category) group", () => {
    const rows = [
      mk({ id: "fi-1", trancheNumber: 0, amountDue: 10_000, amountPaid: 4_000, amountPending: 3_000 }),
      mk({ id: "fi-2", trancheNumber: 0, parentId: "fam-b", amountDue: 10_000, amountPaid: 10_000, status: "paid" }),
    ];
    const [fi] = deriveNonWaveSummary(rows, NOW);
    expect(fi.familyCount).toBe(2);
    expect(fi.debtorFamilyCount).toBe(1);
    expect(fi.dueTotal).toBe(20_000);
    expect(fi.paidTotal).toBe(14_000);
    expect(fi.pendingTotal).toBe(3_000);
    expect(fi.remainingTotal).toBe(3_000); // INV-4 on the unpaid row
    expect(fi.dueTotal + fi.overCoverageTotal).toBe(fi.paidTotal + fi.pendingTotal + fi.remainingTotal);
  });

  it("honest-empty: all rows waved → no non-wave groups", () => {
    expect(deriveNonWaveSummary(ALL_CATEGORY_ROWS, NOW)).toEqual([]);
  });
});

describe("T-447 — deriveTrancheWaveStats behavior preserved (the T-424 contract, refactored core)", () => {
  it("the per-category stats are byte-identical to the pre-T-447 semantics (grouping, counting, rounding, ordering by insertion)", () => {
    const stats = deriveTrancheWaveStats(ALL_CATEGORY_ROWS, NOW);
    // insertion order: tuition#1, tuition#2, tuition#3, transport#1, transport#2, then the 8 services
    expect(stats.map((s) => `${s.category}#${s.wave}`)).toEqual([
      "tuition#1",
      "tuition#2",
      "tuition#3",
      "transport#1",
      "transport#2",
      "canteen#1",
      "uniform#1",
      "books#1",
      "extracurricular#1",
      "therapy_psychology#1",
      "therapy_speech#1",
      "second_apron#1",
      "other#1",
    ]);
    const t1 = stats[0];
    expect(t1.installmentCount).toBe(2);
    expect(t1.settledCount).toBe(1);
    expect(t1.familyCount).toBe(2);
    expect(t1.debtorFamilyCount).toBe(1);
    expect(t1.overdueDebtorFamilyCount).toBe(1); // fam-a unpaid, past due
    expect(t1.dueTotal).toBe(160_000);
    expect(t1.paidTotal).toBe(130_000);
    expect(t1.remainingTotal).toBe(30_000);
  });
});
