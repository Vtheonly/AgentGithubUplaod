/**
 * T-513 — the year-over-year MOCK MODE (STATS-405), the regression suite.
 *
 * THE OWNER'S MANDATE (issue 1 of the three-issue fleet): "I want to add a
 * mock mode to the year-over-year comparison feature so I can test and
 * preview comparisons between the current year (N) and the previous year
 * (N-1). […] The mock mode must be clearly identified and must not modify,
 * overwrite, or interfere with real data."
 *
 * Layers pinned here:
 *   - the GENERATOR (pure): determinism, purity (input never mutated), the
 *     realism contract (the wave structure carries; ±20% band; 500-DZD
 *     rounding; real zeros stay zero; empty input → empty output);
 *   - the CARD's offer contract: the demo toggle is offered ONLY when no
 *     real previous series exists AND there is a current series;
 *   - the CARD's identification contract: the simulated rendering carries
 *     the amber DONNÉES SIMULÉES badge, the "(simulé)" bar label and the
 *     chart-area legend — unmissable on every simulated pixel;
 *   - the CARD's non-interference contract: with real N−1 data present the
 *     toggle NEVER renders and the real series drives the chart;
 *   - the CARD's honest return: toggling off restores the documented
 *     unavailable state (nothing persisted, nothing remembered).
 *
 * Recharts is mocked (the T-247 jsdom pattern — ResponsiveContainer gets a
 * 0×0 box in jsdom; the underlying derivations are pure-function tested).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

import "../../i18n/i18n";
import {
  deriveMockPrevYearRevenue,
  mockMultiplierFor,
} from "../../features/dashboard/components/analytics/yoy-mock";
import { deriveYearOverYear } from "../../features/dashboard/components/analytics/analytics-derivations";
import { YoYComparisonCard } from "../../features/dashboard/components/analytics/yoy-comparison-card";
import type { RevenuePoint } from "../../domain/model/operations";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

// Mock recharts (the T-247 pattern): capture the Bar props so the suite can
// pin the "(simulé)" legend contract without a real SVG layout.
const barMocks: { name?: string; dataKey?: string }[] = [];
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
  BarChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Bar: (props: { name?: string; dataKey?: string; children?: ReactNode }) => {
    barMocks.push({ name: props.name, dataKey: props.dataKey });
    return <div data-testid="recharts-bar" />;
  },
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
}));

/* ── Fixtures ──────────────────────────────────────────────────────── */

const CURRENT: RevenuePoint[] = [
  { label: "Sep", amount: 1_200_000 },
  { label: "Oct", amount: 800_000 },
  { label: "Nov", amount: 450_000 },
  { label: "Déc", amount: 0 },
  { label: "Jan", amount: 300_000 },
];

function renderCard(props: {
  revenue?: RevenuePoint[];
  prevRevenue?: RevenuePoint[];
  previousYear?: string | null;
}) {
  barMocks.length = 0; // module-level accumulator — reset per render
  return render(
    <YoYComparisonCard
      currentYear="2025-2026"
      previousYear={props.previousYear ?? null}
      revenue={props.revenue ?? CURRENT}
      prevRevenue={props.prevRevenue ?? []}
    />,
  );
}

/* ── The generator (pure) ──────────────────────────────────────────── */

describe("T-513 — deriveMockPrevYearRevenue (the pure generator)", () => {
  it("is DETERMINISTIC: the same input always yields the same output", () => {
    const a = deriveMockPrevYearRevenue(CURRENT);
    const b = deriveMockPrevYearRevenue(CURRENT);
    expect(a).toEqual(b);
  });

  it("never mutates the input (purity)", () => {
    const input = CURRENT.map((p) => ({ ...p }));
    const snapshot = JSON.stringify(input);
    deriveMockPrevYearRevenue(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("keeps the REAL wave structure inside the ±20% band, rounded to 500 DZD", () => {
    const mock = deriveMockPrevYearRevenue(CURRENT);
    expect(mock).toHaveLength(CURRENT.length);
    mock.forEach((m, i) => {
      const real = CURRENT[i]!.amount;
      if (real > 0) {
        // The multiplier band is [0.80, 1.20]; the 500-DZD rounding adds at
        // most ±250 DZD of slack on small amounts.
        const slack = Math.max(250, real * 0.005);
        expect(m.amount).toBeGreaterThanOrEqual(Math.round(real * 0.8 - slack));
        expect(m.amount).toBeLessThanOrEqual(Math.round(real * 1.2 + slack));
        expect(m.amount % 500).toBe(0); // school money is round money
      }
    });
  });

  it("a REAL zero month stays ZERO (no fabricated history — the honest absence)", () => {
    const mock = deriveMockPrevYearRevenue(CURRENT);
    const dec = mock.find((m) => m.label === "Déc")!;
    expect(dec.amount).toBe(0);
  });

  it("empty input → empty output (nothing to preview)", () => {
    expect(deriveMockPrevYearRevenue([])).toEqual([]);
  });

  it("a nonzero real month always simulates a POSITIVE amount", () => {
    for (let seed = 0; seed < 50; seed++) {
      const series: RevenuePoint[] = [
        { label: `M${seed}`, amount: 1_000 + seed * 137 },
      ];
      const [mocked] = deriveMockPrevYearRevenue(series);
      expect(mocked!.amount).toBeGreaterThan(0);
    }
  });

  it("the multiplier is label-stable and inside the band", () => {
    for (const label of ["Sep", "Oct", "Nov", "Déc", "Jan", "Fév", "Mar"]) {
      const m = mockMultiplierFor(label);
      expect(m).toBeGreaterThanOrEqual(0.8);
      expect(m).toBeLessThanOrEqual(1.2);
      expect(mockMultiplierFor(label)).toBe(m); // stable per label
    }
  });

  it("feeds deriveYearOverYear exactly like a real series (the preview IS the real feature)", () => {
    const mock = deriveMockPrevYearRevenue(CURRENT);
    const summary = deriveYearOverYear(CURRENT, mock);
    expect(summary.points).toHaveLength(CURRENT.length);
    // The Déc zero keeps its documented null Δ (no trend without a base).
    expect(summary.points.find((p) => p.label === "Déc")!.deltaPercent).toBeNull();
    // Nonzero months carry a real delta within the ±20% band's arithmetic.
    for (const p of summary.points) {
      if (p.label === "Déc") continue;
      expect(p.previous).toBeGreaterThan(0);
      expect(p.deltaPercent).not.toBeNull();
    }
  });
});

/* ── The card's offer / identification / non-interference contracts ─── */

describe("T-513 — YoYComparisonCard demo mode (the render contracts)", () => {
  it("offers the demo toggle ONLY when no real previous series exists", () => {
    const { rerender } = renderCard({ prevRevenue: [] });
    expect(screen.getByTestId("yoy-mock-on")).toBeInTheDocument();
    expect(screen.getByTestId("yoy-unavailable")).toBeInTheDocument();

    rerender(
      <YoYComparisonCard
        currentYear="2025-2026"
        previousYear="2024-2025"
        revenue={CURRENT}
        prevRevenue={[{ label: "Sep", amount: 500_000 }]}
      />,
    );
    // Real data present: NO toggle, NO badge — the mock cannot interfere.
    expect(screen.queryByTestId("yoy-mock-on")).not.toBeInTheDocument();
    expect(screen.queryByTestId("yoy-mock-off")).not.toBeInTheDocument();
    expect(screen.queryByTestId("yoy-mock-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("yoy-chart")).toBeInTheDocument();
  });

  it("does not offer the demo when the CURRENT series is empty (nothing to compare)", () => {
    // Pre-existing branch order (pinned since T-257): the unavailable
    // state wins when BOTH series are empty — the demo needs a current
    // series to derive from, so it is never offered here.
    renderCard({ revenue: [], prevRevenue: [] });
    expect(screen.queryByTestId("yoy-mock-on")).not.toBeInTheDocument();
    expect(screen.getByTestId("yoy-unavailable")).toBeInTheDocument();
  });

  it("toggling ON renders the SIMULATED chart with every identification marker", () => {
    renderCard({ prevRevenue: [], previousYear: null });
    fireEvent.click(screen.getByTestId("yoy-mock-on"));

    // The chart renders (the whole point: the feature becomes testable).
    expect(screen.getByTestId("yoy-chart")).toBeInTheDocument();
    // The unmissable markers: header badge + chart-area legend + the
    // "(simulé)" bar legend + the marked global chip.
    expect(screen.getByTestId("yoy-mock-badge")).toBeInTheDocument();
    expect(screen.getByTestId("yoy-mock-badge").textContent).toMatch(/simul/i);
    expect(screen.getByTestId("yoy-mock-legend")).toBeInTheDocument();
    const prevBar = barMocks.find((b) => b.dataKey === "previous");
    expect(prevBar?.name).toBe("N−1 (simulé)");
    expect(screen.getByTestId("yoy-mock-off")).toBeInTheDocument();
  });

  it("toggling OFF restores the honest unavailable state (nothing persisted)", () => {
    renderCard({ prevRevenue: [], previousYear: null });
    fireEvent.click(screen.getByTestId("yoy-mock-on"));
    expect(screen.getByTestId("yoy-chart")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("yoy-mock-off"));
    expect(screen.getByTestId("yoy-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("yoy-mock-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("yoy-chart")).not.toBeInTheDocument();
  });

  it("renders the real-data chart UNCHANGED when the previous series exists (no regression)", () => {
    barMocks.length = 0;
    renderCard({
      prevRevenue: [{ label: "Sep", amount: 500_000 }],
      previousYear: "2024-2025",
    });
    expect(screen.getByTestId("yoy-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("yoy-unavailable")).not.toBeInTheDocument();
    const prevBar = barMocks.find((b) => b.dataKey === "previous");
    expect(prevBar?.name).toBe("N−1 (2024-2025)");
    // No simulated marker anywhere on the real rendering.
    expect(screen.queryByTestId("yoy-mock-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("yoy-mock-legend")).not.toBeInTheDocument();
  });
});
