/**
 * Analytics visuals regression suite (T-255..T-257, 38th session, 2026-09-09
 * — UI-307: the owner's "more Power BI–type visualizations" mandate).
 *
 * Guards the Analytics tab (all REAL-data derivations, §15.16):
 *   - The slicer engine: applyAnalyticsFilters (paid-only + range + method
 *     + category; empty selection = ALL) and presentCategories.
 *   - T-255 statistics: derivePaymentStats (count/total/mean/median/σ/
 *     best-month) + the StatStrip render.
 *   - T-339: the revenue spline / heatmap / histogram derivations were REMOVED
 *     with the vanity charts (owner kill list — STATS-400);
 *     executive-statistics.test.ts covers the replacements.
 *   - T-256 mixes: deriveMethodMix / deriveCategoryMix (top-N tail merge).
 *   - T-256 heatmap: deriveCollectionHeatmap (month columns, school-week
 *     rows, Fri/Sat exclusion, level quantization, month totals).
 *   - T-256 histogram: deriveAmountHistogram (bin edges, 50k+ open bin).
 *   - T-257 Pareto: derivePareto (desc sort, top-N, cumulative %).
 *   - T-257 aging: deriveAgingComposition (share %, canonical order).
 *   - T-257 YoY: deriveYearOverYear (label alignment, null delta on 0
 *     previous) + shiftIsoYearBack / previousAcademicYear helpers.
 *   - Render: the tab cross-filters via the method/category chips (the
 *     Power BI slicer interaction), the reset button, honest empty states.
 *
 * Recharts is mocked (jsdom renders ResponsiveContainer at 0×0 — the
 * derivations are covered by the pure-function suites; the T-247 pattern).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";

// jsdom has no ResizeObserver — the page chrome needs one. Local stub
// (the global setup stays untouched — the T-247 pattern).
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

// Mock recharts — jsdom gives ResponsiveContainer a 0×0 box (T-247 pattern).
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
  BarChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  ComposedChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  PieChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  AreaChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Bar: () => <div data-testid="recharts-bar" />,
  Line: () => <div data-testid="recharts-line" />,
  Area: () => <div data-testid="recharts-area" />,
  Pie: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Cell: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
}));

// Mock the AI copilot context — the owner's analytics overhaul (db5e159)
// added OperationalQueryConsole + CrossRiskCard to the tab, both calling
// useAICopilot() (askAgent + setIsOpen only). The REAL provider pulls
// useRepositories/useToast/useAuth — out of scope for a visuals-regression
// suite. This stub keeps the harness isolated (the same pattern as the
// recharts mock above) and leaves the owner's components untouched.
vi.mock("../../app/providers/ai-copilot-provider", () => ({
  useAICopilot: () => ({
    isOpen: false,
    setIsOpen: vi.fn(),
    toggleCopilot: vi.fn(),
    messages: [],
    isStreaming: false,
    streamingDelta: "",
    activeToolName: null,
    proposals: [],
    config: null,
    canUse: true,
    pendingClarification: null,
    askAgent: vi.fn().mockResolvedValue(undefined),
    answerClarification: vi.fn().mockResolvedValue(undefined),
    dismissClarification: vi.fn(),
    stopStreaming: vi.fn(),
    clearConversation: vi.fn(),
    approveAction: vi.fn().mockResolvedValue(undefined),
    dismissAction: vi.fn(),
    downloadArtifact: vi.fn().mockResolvedValue(undefined),
    reloadConfig: vi.fn().mockResolvedValue(undefined),
  }),
}));

import {
  applyAnalyticsFilters,
  presentCategories,
  NO_ANALYTICS_FILTERS,
  derivePaymentStats,
  deriveMethodMix,
  deriveCategoryMix,
  derivePareto,
  deriveAgingComposition,
  deriveYearOverYear,
  shiftIsoYearBack,
  previousAcademicYear,
} from "../../features/dashboard/components/analytics/analytics-derivations";
import { AnalyticsTab, type AnalyticsTabProps } from "../../features/dashboard/tabs/analytics-tab";
import type { Payment } from "../../domain/model/payment";

// ============================================================
// Fixtures
// ============================================================

/** Compact Payment fixture builder (defaults = a paid cash tuition). */
function pay(overrides: Partial<Payment> & Pick<Payment, "id">): Payment {
  return {
    tenantId: "t1",
    receiptNumber: `REC-${overrides.id}`,
    parentId: "par-001",
    studentId: null,
    amount: 10_000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "staff-1",
    collectedAt: "2025-09-15T10:00:00Z", // a Monday
    createdAt: "2025-09-15T10:00:00Z",
    updatedAt: "2025-09-15T10:00:00Z",
    ...overrides,
  };
}

const RANGE = { from: "2025-09-01", to: "2026-06-30" };

/** Weekday reference points (verified): Sep 1 2025 = Monday. */
const DATES = {
  sun: "2025-09-14T10:00:00Z", // Dimanche
  mon: "2025-09-15T10:00:00Z", // Lundi
  wed: "2025-10-01T10:00:00Z", // Mercredi
  fri: "2025-09-19T10:00:00Z", // Vendredi (excluded)
  sat: "2025-09-20T10:00:00Z", // Samedi (excluded)
};

const FIXTURE_PAYMENTS: Payment[] = [
  pay({ id: "p1", amount: 20_000, method: "cash", category: "tuition", collectedAt: DATES.sun }),
  pay({ id: "p2", amount: 10_000, method: "cash", category: "tuition", collectedAt: DATES.mon }),
  pay({ id: "p3", amount: 40_000, method: "check", category: "transport", collectedAt: DATES.wed }),
  pay({ id: "p4", amount: 6_000, method: "transfer", category: "canteen", collectedAt: DATES.wed }),
  // NOT in the paid slice (refunded / pending / out of range).
  pay({ id: "p5", amount: 99_000, status: "refunded", collectedAt: DATES.mon }),
  pay({ id: "p6", amount: 99_000, status: "pending", collectedAt: DATES.mon }),
  pay({ id: "p7", amount: 99_000, collectedAt: "2024-01-10T10:00:00Z" }),
  // Friday/Saturday (in range, paid) — excluded by the school-week rows.
  pay({ id: "p8", amount: 5_000, collectedAt: DATES.fri }),
  pay({ id: "p9", amount: 5_000, collectedAt: DATES.sat }),
];

const REVENUE = [
  { label: "Sep", amount: 30_000 },
  { label: "Oct", amount: 46_000 },
  { label: "Nov", amount: 20_000 },
  { label: "Déc", amount: 40_000 },
];

// ============================================================
// Slicer engine (applyAnalyticsFilters / presentCategories)
// ============================================================

describe("UI-307 — applyAnalyticsFilters (the cross-filter engine)", () => {
  it("keeps only PAID payments inside the range (encaissé definition)", () => {
    const out = applyAnalyticsFilters(FIXTURE_PAYMENTS, RANGE, NO_ANALYTICS_FILTERS);
    expect(out.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p8", "p9"]);
  });

  it("empty selection = ALL values (no filter semantics)", () => {
    const all = applyAnalyticsFilters(FIXTURE_PAYMENTS, RANGE, {
      methods: new Set(),
      categories: new Set(),
    });
    expect(all.length).toBe(6);
  });

  it("filters by method (check only) and by category (tuition only)", () => {
    const byMethod = applyAnalyticsFilters(FIXTURE_PAYMENTS, RANGE, {
      methods: new Set(["check"]),
      categories: new Set(),
    });
    expect(byMethod.map((p) => p.id)).toEqual(["p3"]);

    const byCategory = applyAnalyticsFilters(FIXTURE_PAYMENTS, RANGE, {
      methods: new Set(),
      categories: new Set(["tuition"]),
    });
    // p8/p9 default to tuition+cash — they match too.
    expect(byCategory.map((p) => p.id)).toEqual(["p1", "p2", "p8", "p9"]);
  });

  it("combines method AND category additively inside each group", () => {
    const out = applyAnalyticsFilters(FIXTURE_PAYMENTS, RANGE, {
      methods: new Set(["cash", "transfer"]),
      categories: new Set(["tuition", "canteen"]),
    });
    expect(out.map((p) => p.id)).toEqual(["p1", "p2", "p4", "p8", "p9"]);
  });

  it("presentCategories lists the categories of the paid in-range slice", () => {
    expect(presentCategories(FIXTURE_PAYMENTS, RANGE).sort()).toEqual([
      "canteen",
      "transport",
      "tuition",
    ]);
  });
});

// ============================================================
// T-255 — statistics + trend derivations
// ============================================================

describe("T-255 — derivePaymentStats (descriptive statistics)", () => {
  it("computes count/total/mean/median/σ over the slice", () => {
    const slice = [
      pay({ id: "a", amount: 10_000 }),
      pay({ id: "b", amount: 20_000 }),
      pay({ id: "c", amount: 30_000 }),
      pay({ id: "d", amount: 40_000 }),
    ];
    const s = derivePaymentStats(slice);
    expect(s.count).toBe(4);
    expect(s.total).toBe(100_000);
    expect(s.mean).toBe(25_000);
    expect(s.median).toBe(25_000); // (20k + 30k) / 2
    expect(s.min).toBe(10_000);
    expect(s.max).toBe(40_000);
    // σ (sample) of [10,20,30,40]k = sqrt(166.67e6) ≈ 12 910 → 12910.
    expect(s.stdDev).toBeCloseTo(12_910, -1);
  });

  it("median of an odd-length slice is the middle value", () => {
    const s = derivePaymentStats([
      pay({ id: "a", amount: 5_000 }),
      pay({ id: "b", amount: 15_000 }),
      pay({ id: "c", amount: 25_000 }),
    ]);
    expect(s.median).toBe(15_000);
  });

  it("best month is the REAL calendar month with the highest encaissé", () => {
    const s = derivePaymentStats([
      pay({ id: "a", amount: 10_000, collectedAt: "2025-09-10T10:00:00Z" }),
      pay({ id: "b", amount: 50_000, collectedAt: "2025-11-10T10:00:00Z" }),
      pay({ id: "c", amount: 20_000, collectedAt: "2025-09-20T10:00:00Z" }),
    ]);
    expect(s.bestMonth).toEqual({ label: "Nov", amount: 50_000 });
  });

  it("empty slice → zeros and no best month (honest)", () => {
    const s = derivePaymentStats([]);
    expect(s.count).toBe(0);
    expect(s.total).toBe(0);
    expect(s.mean).toBe(0);
    expect(s.median).toBe(0);
    expect(s.stdDev).toBe(0);
    expect(s.bestMonth).toBeNull();
  });
});

// T-339: the revenue-spline derivations (deriveRevenueTrend /
// deriveFilteredMonthly) were REMOVED with the vanity charts — the
// WaveVelocityCard renders the tranche staircase instead (executive-statistics.ts).


// ============================================================
// T-256 — mixes, heatmap, histogram
// ============================================================

describe("T-256 — deriveMethodMix / deriveCategoryMix", () => {
  it("method mix: amounts, counts, percents, desc sort", () => {
    const slice = [
      pay({ id: "a", amount: 20_000, method: "cash" }),
      pay({ id: "b", amount: 10_000, method: "cash" }),
      pay({ id: "c", amount: 40_000, method: "check" }),
    ];
    const mix = deriveMethodMix(slice);
    expect(mix[0]).toMatchObject({ key: "check", amount: 40_000, count: 1, percent: 57 });
    expect(mix[1]).toMatchObject({ key: "cash", amount: 30_000, count: 2, percent: 43 });
    expect(mix.map((m) => m.label)).toEqual(["Chèque", "Espèces"]);
  });

  it("category mix merges the tail beyond topN into 'Autres (n)'", () => {
    const cats = ["tuition", "transport", "canteen", "uniform", "books", "other", "extracurricular"] as const;
    const slice = cats.map((category, i) =>
      pay({ id: `c${i}`, amount: (cats.length - i) * 1_000, category }),
    );
    const mix = deriveCategoryMix(slice, 3);
    expect(mix.length).toBe(4);
    expect(mix[0].key).toBe("tuition");
    expect(mix[3]).toMatchObject({ key: "__tail__", label: "Autres (4)", count: 4 });
    expect(mix[3].amount).toBe(4_000 + 3_000 + 2_000 + 1_000);
    // Percent sum stays honest (rounding aside, ~100).
    const sum = mix.reduce((s, m) => s + m.percent, 0);
    expect(sum).toBeGreaterThanOrEqual(98);
    expect(sum).toBeLessThanOrEqual(102);
  });
});

// T-339: the weekday-heatmap and amount-histogram derivations were
// REMOVED with the vanity charts (owner kill list — STATS-400).


// ============================================================
// T-257 — Pareto, aging, YoY + range helpers
// ============================================================

describe("T-257 — derivePareto (80/20)", () => {
  it("sorts desc, caps at topN, and accumulates the cumulative share", () => {
    const debtors = [
      { parentName: "Famille A", outstandingAmount: 50_000 },
      { parentName: "Famille B", outstandingAmount: 30_000 },
      { parentName: "Famille C", outstandingAmount: 15_000 },
      { parentName: "Famille D", outstandingAmount: 5_000 },
    ];
    const p = derivePareto(debtors, 3);
    expect(p.map((d) => d.name)).toEqual(["Famille A", "Famille B", "Famille C"]);
    // Cumulative of the DISPLAYED total (95k): 50/95≈53, 80/95≈84, 100.
    expect(p[0].cumPercent).toBe(53);
    expect(p[1].cumPercent).toBe(84);
    expect(p[2].cumPercent).toBe(100);
  });

  it("drops zero/negative outstanding rows (nothing to rank)", () => {
    const p = derivePareto([
      { parentName: "X", outstandingAmount: 0 },
      { parentName: "Y", outstandingAmount: -5 },
    ]);
    expect(p).toEqual([]);
  });
});

describe("T-257 — deriveAgingComposition (100% stacked)", () => {
  it("normalizes shares in the canonical bucket order", () => {
    const segs = deriveAgingComposition([
      { bucket: "91_180", amount: 30_000, debtorCount: 2 },
      { bucket: "0_30", amount: 50_000, debtorCount: 5 },
      { bucket: "31_60", amount: 20_000, debtorCount: 3 },
    ]);
    expect(segs.map((s) => s.bucket)).toEqual(["0_30", "31_60", "91_180"]);
    expect(segs.map((s) => s.share)).toEqual([50, 20, 30]);
    expect(segs[0].debtorCount).toBe(5);
  });

  it("zero-amount buckets are dropped; empty input → empty output", () => {
    expect(deriveAgingComposition([{ bucket: "0_30", amount: 0, debtorCount: 0 }])).toEqual([]);
    expect(deriveAgingComposition([])).toEqual([]);
  });
});

describe("T-257 — deriveYearOverYear (like-for-like months)", () => {
  it("aligns by label and computes deltas (null when previous is 0)", () => {
    const prev = [
      { label: "Sep", amount: 15_000 },
      { label: "Oct", amount: 23_000 },
    ];
    const cur = [
      { label: "Sep", amount: 30_000 },
      { label: "Oct", amount: 11_500 },
      { label: "Nov", amount: 5_000 },
    ];
    const s = deriveYearOverYear(cur, prev);
    expect(s.points.map((p) => p.label)).toEqual(["Sep", "Oct", "Nov"]);
    expect(s.points[0].deltaPercent).toBe(100);
    expect(s.points[1].deltaPercent).toBe(-50);
    expect(s.points[2].deltaPercent).toBeNull(); // previous 0 → no trend claim
    expect(s.totalCurrent).toBe(46_500);
    expect(s.totalPrevious).toBe(38_000);
    expect(s.deltaPercent).toBe(Math.round(((46_500 - 38_000) / 38_000) * 100));
  });
});

describe("UI-307 — range helpers", () => {
  it("shiftIsoYearBack shifts one year, leap-day safe", () => {
    expect(shiftIsoYearBack("2025-09-01")).toBe("2024-09-01");
    expect(shiftIsoYearBack("2024-02-29")).toBe("2023-02-28");
  });

  it("previousAcademicYear parses 'YYYY-YYYY'", () => {
    expect(previousAcademicYear("2025-2026")).toBe("2024-2025");
    expect(previousAcademicYear("bad")).toBeNull();
  });
});

// ============================================================
// Render — the Analytics tab + slicer cross-filtering
// ============================================================

const TAB_PROPS = {
  revenue: REVENUE,
  prevRevenue: [
    { label: "Sep", amount: 15_000 },
    { label: "Oct", amount: 23_000 },
  ],
  academicYear: "2025-2026",
  prevAcademicYear: "2024-2025",
  debtAging: [
    { bucket: "0_30" as const, amount: 50_000, debtorCount: 5 },
    { bucket: "31_60" as const, amount: 20_000, debtorCount: 3 },
    { bucket: "91_180" as const, amount: 30_000, debtorCount: 2 },
  ],
  topDebtors: [
    { parentId: "p1", parentName: "Famille A", parentPhone: "0", studentCount: 1, outstandingAmount: 60_000, daysOverdue: 10, bucket: "0_30" as const },
    { parentId: "p2", parentName: "Famille B", parentPhone: "0", studentCount: 2, outstandingAmount: 40_000, daysOverdue: 40, bucket: "31_60" as const },
  ],
  payments: FIXTURE_PAYMENTS,
  range: RANGE,
};

describe("UI-307 — AnalyticsTab render (the report page)", () => {
  // The owner's analytics overhaul (db5e159) split the tab into two view
  // modes: "diagnostic" (the NEW default — OperationalQueryConsole +
  // CrossRiskCard + PivotMatrixCard) and "charts" (the ORIGINAL Power BI
  // chart wall — preserved verbatim). These render-regression tests pin
  // the CHART wall, so every render switches to the charts view first.
  // The diagnostic default view is exercised by the operational-query-
  // engine suites; nothing here overwrites the owner's layout.
  function renderChartsView(props: Partial<AnalyticsTabProps> = {}) {
    render(<AnalyticsTab {...TAB_PROPS} {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Flux Financiers \(métriques réelles\)/ }),
    );
    return screen.getByTestId("analytics-tab");
  }

  it("T-339: the DEFAULT view is the Executive Command Center (Pilotage)", () => {
    // No mode click — the tab opens on "pilotage" by default.
    render(<AnalyticsTab {...TAB_PROPS} />);
    expect(screen.getByTestId("executive-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("triple-risk-summary-card")).toBeInTheDocument();
    expect(screen.getByTestId("wave-velocity-card")).toBeInTheDocument();
    expect(screen.getByTestId("debt-triage-card")).toBeInTheDocument();
    expect(screen.getByTestId("discount-erosion-card")).toBeInTheDocument();
    expect(screen.getByTestId("family-concentration-card")).toBeInTheDocument();
    expect(screen.getByTestId("transport-yield-card")).toBeInTheDocument();
    expect(screen.getByTestId("service-yield-card")).toBeInTheDocument();
    expect(screen.getByTestId("enrollment-dynamics-card")).toBeInTheDocument();
    // The removed vanity charts are absent even in the other modes' DOM.
    expect(screen.queryByTestId("analytics-trend-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("heatmap-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("histogram-chart")).not.toBeInTheDocument();
  });

  it("renders the full chart wall with REAL derived statistics", () => {
    renderChartsView();
    // Stat strip reflects the unfiltered paid in-range slice (6 payments,
    // Σ 86 000 DZD — p1..p4 + the Fri/Sat rows).
    const strip = screen.getByTestId("analytics-stat-strip");
    expect(strip.getAttribute("data-count")).toBe("6");
    expect(strip.getAttribute("data-total")).toBe("86000");
    // Slicer badge carries the same live figures.
    expect(screen.getByTestId("analytics-slicer-badge").textContent).toContain("6 / 6");
    // The surviving REAL card families (T-339: trend explorer / heatmap /
    // histogram REMOVED — the owner's vanity-statistics kill list).
    expect(screen.getByTestId("method-mix-chart")).toBeInTheDocument();
    expect(screen.getByTestId("category-mix-chart")).toBeInTheDocument();
    expect(screen.getByTestId("yoy-chart")).toBeInTheDocument();
    expect(screen.getByTestId("pareto-chart")).toBeInTheDocument();
    expect(screen.getByTestId("aging-stacked-bar")).toBeInTheDocument();
    // The removed vanity charts must NOT render anywhere on the tab.
    expect(screen.queryByTestId("analytics-trend-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("heatmap-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("histogram-chart")).not.toBeInTheDocument();
  });

  it("method chip cross-filters the payments-derived cards (Power BI slicer)", () => {
    renderChartsView();
    // Before: 6 / 6.
    expect(screen.getByTestId("analytics-slicer-badge").textContent).toContain("6 / 6");
    // Click "Chèque" — only p3 survives (40 000 DZD).
    fireEvent.click(within(screen.getByTestId("analytics-method-chips")).getByText("Chèque"));
    expect(screen.getByTestId("analytics-stat-strip").getAttribute("data-count")).toBe("1");
    expect(screen.getByTestId("analytics-stat-strip").getAttribute("data-total")).toBe("40000");
    expect(screen.getByTestId("analytics-slicer-badge").textContent).toContain("1 / 6");
    // The reset control appears once a filter is active.
    expect(screen.getByTestId("analytics-slicer-reset")).toBeInTheDocument();
    // Reset restores the full slice.
    fireEvent.click(screen.getByTestId("analytics-slicer-reset"));
    expect(screen.getByTestId("analytics-stat-strip").getAttribute("data-count")).toBe("6");
  });

  it("category chip cross-filters (additive within the group)", () => {
    renderChartsView();
    const chips = within(screen.getByTestId("analytics-category-chips"));
    // Click "Scolarité" (tuition) — p1 + p2 + p8 + p9 = 40 000 DZD
    // (the Fri/Sat rows are tuition+cash too — they match the filter).
    fireEvent.click(chips.getByText("Scolarité"));
    expect(screen.getByTestId("analytics-stat-strip").getAttribute("data-count")).toBe("4");
    expect(screen.getByTestId("analytics-stat-strip").getAttribute("data-total")).toBe("40000");
    // Add "Cantine" (additive) — + p4 = 46 000 DZD.
    fireEvent.click(chips.getByText("Cantine"));
    expect(screen.getByTestId("analytics-stat-strip").getAttribute("data-count")).toBe("5");
    expect(screen.getByTestId("analytics-stat-strip").getAttribute("data-total")).toBe("46000");
  });

  it("the removed vanity charts never mount (T-339 kill list)", () => {
    renderChartsView();
    expect(screen.queryByTestId("analytics-trend-legend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("analytics-trend-view-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("heatmap-cell-Dim-2025-09")).not.toBeInTheDocument();
  });


  it("aging composition renders the normalized shares + total row", () => {
    renderChartsView();
    const bar = screen.getByTestId("aging-stacked-bar");
    const segments = bar.querySelectorAll("[role='progressbar']");
    expect(segments.length).toBe(3);
    expect(segments[0].getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByTestId("aging-table").textContent).toContain("Total");
  });

  it("YoY card renders the grouped chart when the previous series exists", () => {
    renderChartsView();
    // Σ current = 136 000; Σ previous (aligned Sep+Oct) = 38 000 → +258%.
    expect(screen.getByTestId("yoy-chart")).toBeInTheDocument();
  });

  it("renders honest empty states when there is nothing to show", () => {
    renderChartsView({
      revenue: [],
      prevRevenue: [],
      prevAcademicYear: null,
      payments: [],
      topDebtors: [],
      debtAging: [],
    });
    expect(screen.getByTestId("method-mix-empty")).toBeInTheDocument();
    expect(screen.getByTestId("category-mix-empty")).toBeInTheDocument();
    expect(screen.getByTestId("yoy-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("pareto-empty")).toBeInTheDocument();
    expect(screen.getByTestId("aging-empty")).toBeInTheDocument();
  });
});
