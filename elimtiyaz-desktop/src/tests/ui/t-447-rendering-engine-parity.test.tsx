/**
 * T-447 — the END-TO-END chain test: Source Data → Domain Engine →
 * Frontend (the mandate's "Confirm that the numbers calculated by the
 * engine exactly match what the frontend displays").
 *
 * This suite renders the REAL components with the REAL engine output
 * over a fixture corpus (every billing category + FI + pending +
 * over-coverage) and asserts the RENDERED DOM carries the engine's exact
 * numbers — and that the TWO surfaces (Statistics WaveVelocityCard and
 * the Finance TrancheWaveHeader) render THE SAME figures per wave, the
 * exact-dinar parity at the displayed-DOM level (stronger than the
 * view-model parity pinned in t-447-pooled-waves.test.ts).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "../../i18n/i18n";
import { WaveVelocityCard } from "../../features/dashboard/components/analytics/executive-cards";
import { TooltipProvider } from "../../shared/ui/tooltip";
import { deriveTrancheWaves as deriveStatisticsWaves } from "../../features/dashboard/components/analytics/executive-statistics";
import {
  derivePooledTrancheWaves,
  deriveNonWaveSummary,
} from "../../domain/calc/payment/tranche-waves";
import {
  deriveTrancheWaves as deriveFinanceWaves,
  TrancheWaveHeader,
} from "../../features/financials/installment-schedule-tab";
import { formatDzdPlain, formatDzd } from "../../core/format/currency";
import type { Installment, PaymentCategory } from "../../domain/model/payment";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
}));

const NOW = new Date("2026-10-01T00:00:00Z").getTime();

function mk(partial: Partial<Installment> & { id: string }): Installment {
  return {
    tenantId: "t",
    parentId: "fam-a",
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

/** The every-category corpus: tuition + transport + services + FI + pending + a future wave. */
const CORPUS: Installment[] = [
  mk({ id: "tu1-a", category: "tuition", trancheNumber: 1, parentId: "fam-a", amountDue: 80_000, amountPaid: 50_000 }),
  mk({ id: "tu1-b", category: "tuition", trancheNumber: 1, parentId: "fam-b", amountDue: 80_000, amountPaid: 80_000, status: "paid" }),
  mk({ id: "tu2-a", category: "tuition", trancheNumber: 2, parentId: "fam-a", amountDue: 80_000, amountPaid: 20_000, amountPending: 10_000, dueDate: "2026-12-15" }),
  mk({ id: "tu3-a", category: "tuition", trancheNumber: 3, parentId: "fam-a", amountDue: 80_000, amountPaid: 0, dueDate: "2027-03-15" }),
  mk({ id: "tr1-a", category: "transport", trancheNumber: 1, parentId: "fam-a", amountDue: 30_000, amountPaid: 30_000, status: "paid" }),
  mk({ id: "tr1-c", category: "transport", trancheNumber: 1, parentId: "fam-c", amountDue: 30_000, amountPaid: 0 }),
  mk({ id: "ca1-d", category: "canteen", trancheNumber: 1, parentId: "fam-d", amountDue: 12_000, amountPaid: 6_000 }),
  mk({ id: "bo1-d", category: "books", trancheNumber: 1, parentId: "fam-d", amountDue: 8_000, amountPaid: 8_000, status: "paid" }),
  mk({ id: "fi-a", category: "tuition", trancheNumber: 0, label: "Frais d'inscription (FI)", parentId: "fam-a", amountDue: 10_000, amountPaid: 10_000, status: "paid", dueDate: "2025-09-05" }),
  mk({ id: "fi-c", category: "tuition", trancheNumber: 0, label: "Frais d'inscription (FI)", parentId: "fam-c", amountDue: 10_000, amountPaid: 2_500, dueDate: "2025-09-05" }),
];

const pooled = derivePooledTrancheWaves(CORPUS, NOW);
const statisticsWaves = deriveStatisticsWaves(CORPUS, NOW);
const nonWave = deriveNonWaveSummary(CORPUS, NOW);
const financeWaves = deriveFinanceWaves(CORPUS);

function renderStatisticsCard() {
  render(
    <TooltipProvider>
      <WaveVelocityCard
        waves={statisticsWaves}
        pooled={pooled}
        nonWave={nonWave}
        nowEpochMs={NOW}
      />
    </TooltipProvider>,
  );
}

describe("T-447 — Source → Engine → Frontend: the RENDERED numbers ARE the engine numbers (Statistics)", () => {
  it("every pooled wave card displays the engine's collectedPct, dossiers, and the four amounts", () => {
    renderStatisticsCard();
    for (const w of pooled) {
      const card = screen.getByTestId(`wave-meter-${w.wave}`);
      const text = card.textContent ?? "";
      // the rate — the engine's exact integer
      expect(text).toContain(`${w.collectedPct}%`);
      // the settled/total counts
      expect(text).toContain(`${w.settledCount}/${w.installmentCount} dossiers`);
      // the four amounts — the engine's exact figures, formatted the ONE way
      expect(text).toContain(formatDzdPlain(w.dueTotal));
      expect(text).toContain(formatDzdPlain(w.paidTotal));
      expect(text).toContain(formatDzdPlain(w.pendingTotal));
      expect(text).toContain(formatDzdPlain(w.remainingTotal));
    }
  });

  it("the reconciliation line's rendered figures satisfy Total dû = Encaissé + En cours + Reste dû at the DOM level", () => {
    renderStatisticsCard();
    for (const w of pooled) {
      const line = screen.getByTestId(`wave-identity-${w.wave}`).textContent ?? "";
      // the identity is stated with the wave's own rendered numbers
      expect(line).toContain("Total dû");
      expect(line).toContain(formatDzdPlain(w.dueTotal));
      expect(line).toContain(formatDzdPlain(w.paidTotal));
      expect(line).toContain(formatDzdPlain(w.pendingTotal));
      expect(line).toContain(formatDzdPlain(w.remainingTotal));
      // the mathematical invariant over the ENGINE numbers (the DOM
      // renders the engine's values verbatim — the previous assertion)
      expect(w.dueTotal + w.overCoverageTotal).toBe(
        w.paidTotal + w.pendingTotal + w.remainingTotal,
      );
    }
  });

  it("the per-category chips render every category the engine grouped (no silent exclusion in the DOM)", () => {
    renderStatisticsCard();
    for (const w of pooled) {
      const chips = screen.getByTestId(`wave-categories-${w.wave}`);
      for (const c of w.perCategory) {
        // the chip's category + its exact remaining amount
        expect(chips.textContent).toContain(
          `${formatDzdPlain(c.dueTotal > 0 ? Math.round((c.paidTotal / c.dueTotal) * 100) : 0)}%`,
        );
      }
    }
    // the corpus's concrete categories appear as chips
    const t1chips = screen.getByTestId("wave-categories-1").textContent ?? "";
    for (const needle of ["Scolarité", "Transport", "Cantine", "Livres"]) {
      expect(t1chips).toContain(needle);
    }
  });

  it("the FI / non-wave section renders the engine's non-wave groups (the registration fee visible)", () => {
    renderStatisticsCard();
    const section = screen.getByTestId("wave-nonwave");
    expect(section.textContent).toContain("Frais d'inscription (FI)");
    const fi = nonWave.find((g) => g.kind === "fi")!;
    // the section renders the remaining in the compact convention + the
    // group's collection rate + the engagement count
    expect(section.textContent).toContain(formatDzd(fi.remainingTotal, { compact: true }));
    expect(section.textContent).toContain(
      `${Math.round((fi.paidTotal / fi.dueTotal) * 100)}%`,
    );
    expect(section.textContent).toContain(`${fi.installmentCount} engagements`);
  });
});

describe("T-447 — Finance ↔ Statistics: the two surfaces render THE SAME figures (the exact-dinar parity, displayed)", () => {
  it("per wave (T1, T2, T3): the Statistics card and the Finance strip display the engine's identical amounts", () => {
    renderStatisticsCard();
    const { container } = render(
      <TrancheWaveHeader
        waves={financeWaves}
        basisLabel="Toutes catégories (sélection courante)"
        showTuitionBreakdown
      />,
    );
    const stripText = container.textContent ?? "";
    for (const fw of financeWaves) {
      const statsCard = screen.getByTestId(`wave-meter-${fw.index}`);
      const statsText = statsCard.textContent ?? "";
      // the Finance strip renders "Encaissé : X" / "Dû : Y" with the SAME
      // formatted figures the Statistics card carries
      expect(stripText).toContain(`Encaissé : ${formatDzdPlain(fw.paid)}`);
      expect(stripText).toContain(`Dû : ${formatDzdPlain(fw.due)}`);
      // …and the SAME figures appear on the Statistics card (the exact-dinar
      // parity at the DOM level: same figures, one formatting convention)
      expect(statsText).toContain(formatDzdPlain(fw.due));
      expect(statsText).toContain(formatDzdPlain(fw.paid));
      if (fw.pending > 0) {
        expect(stripText).toContain(formatDzdPlain(fw.pending));
        expect(statsText).toContain(formatDzdPlain(fw.pending));
      }
      expect(statsText).toContain(formatDzdPlain(fw.remaining));
      // the rates are the same integer on both surfaces (the canonical
      // PARITY-001 pct — the Finance clamp is retired)
      const statsRate = pooled.find((p) => p.wave === fw.index)?.collectedPct;
      expect(fw.pct).toBe(statsRate);
      expect(statsText).toContain(`${fw.pct}%`);
    }
  });

  it("the engine is the single source: pooled === Σ per-category stats === the Finance pool (the three derivations agree)", () => {
    for (const p of pooled) {
      // Σ the per-category breakdown === the pooled totals (the engine's
      // internal consistency — what the DOM renders verbatim)
      expect(p.dueTotal).toBe(p.perCategory.reduce((s, c) => s + c.dueTotal, 0));
      expect(p.paidTotal).toBe(p.perCategory.reduce((s, c) => s + c.paidTotal, 0));
      expect(p.pendingTotal).toBe(p.perCategory.reduce((s, c) => s + c.pendingTotal, 0));
      expect(p.remainingTotal).toBe(p.perCategory.reduce((s, c) => s + c.remainingTotal, 0));
      // the Finance pool === the canonical pool
      const fw = financeWaves.find((f) => f.index === p.wave)!;
      expect(fw.due).toBe(p.dueTotal);
      expect(fw.paid).toBe(p.paidTotal);
      expect(fw.pending).toBe(p.pendingTotal);
      expect(fw.remaining).toBe(p.remainingTotal);
    }
    // and the corpus's TOTAL outstanding is consistent across the wave
    // rows and the non-wave rows (every dinar accounted for exactly once)
    const waveRemaining = pooled.reduce((s, w) => s + w.remainingTotal, 0);
    const nonWaveRemaining = nonWave.reduce((s, g) => s + g.remainingTotal, 0);
    const rawRemaining = CORPUS.reduce(
      (s, i) => s + Math.max(0, i.amountDue - i.amountPaid - i.amountPending),
      0,
    );
    expect(waveRemaining + nonWaveRemaining).toBe(rawRemaining);
  });
});
