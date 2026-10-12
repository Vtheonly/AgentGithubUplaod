/**
 * T-514 — the Family Pareto chart's full names + clickable bars (UI-342),
 * the regression suite.
 *
 * THE OWNER'S MANDATE (issue 2 of the three-issue fleet): "In the Family
 * Pareto chart, make the family names fully visible instead of truncated
 * or hidden. Additionally, make each family name or its corresponding bar
 * clickable. When clicked, it should navigate directly to the relevant
 * family's details page or open the appropriate family information view."
 *
 * Layers pinned here:
 *   - the DERIVATION: derivePareto passes the parentId through to every
 *     ParetoDatum (and stays backward compatible without it);
 *   - the FULL-NAME contract: the chart's data carries the family's FULL
 *     name (the redundant « Famille » prefix stripped, EVERY name token
 *     kept) — the pre-T-514 "A. Benali" compression is gone;
 *   - the CLICK contract: the Bar receives the onClick handler when (and
 *     only when) onOpenParent is provided, and the handler navigates with
 *     the clicked row's parentId (never a fabricated one);
 *   - the DEGRADATION contract: without onOpenParent the card renders
 *     exactly as before — no handler, no cursor, no hint;
 *   - the PAGE WIRING: the DashboardPage passes the global drawer's
 *     openParent into the AnalyticsTab (the prop existed but was never
 *     wired — the registration's root cause).
 *
 * Recharts is mocked with PROP CAPTURE (the T-247 jsdom pattern extended):
 * the mocked ComposedChart/Bar/XAxis record their props so the suite pins
 * the data/axis/click contracts without a real SVG layout.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import "../../../i18n/i18n";
import { derivePareto } from "../../../features/dashboard/components/analytics/analytics-derivations";
import { DebtorsParetoCard } from "../../../features/dashboard/components/analytics/debtors-pareto-card";
import type { DebtSummary } from "../../../domain/model/payment";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

/* ── The recharts prop-capture mock ────────────────────────────────── */

interface CapturedChartProps {
  data?: unknown[];
  children?: ReactNode;
}
const captured: { chart?: CapturedChartProps; bar?: Record<string, unknown>; xAxis?: Record<string, unknown> } = {};

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
  ComposedChart: (props: CapturedChartProps) => {
    captured.chart = props;
    return <svg>{props.children}</svg>;
  },
  Bar: (props: Record<string, unknown>) => {
    captured.bar = props;
    return <div data-testid="recharts-bar" />;
  },
  Line: () => <div data-testid="recharts-line" />,
  XAxis: (props: Record<string, unknown>) => {
    captured.xAxis = props;
    return <div />;
  },
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
}));

/* ── Fixtures ──────────────────────────────────────────────────────── */

function debtor(
  id: string,
  name: string,
  outstandingAmount: number,
): DebtSummary {
  return {
    parentId: id,
    parentName: name,
    parentPhone: "0550",
    studentCount: 2,
    outstandingAmount,
    daysOverdue: 20,
    bucket: "31_60",
  };
}

const TOP_DEBTORS: DebtSummary[] = [
  debtor("par-1", "Famille Amine Benali", 50_000),
  debtor("par-2", "Famille Yacine Hadj Ali", 30_000),
  debtor("par-3", "Famille Sarah Boudiaf", 15_000),
];

function renderCard(onOpenParent?: (parentId: string) => void) {
  captured.chart = undefined;
  captured.bar = undefined;
  captured.xAxis = undefined;
  return render(
    <DebtorsParetoCard
      topDebtors={TOP_DEBTORS}
      totalOutstanding={95_000}
      onOpenParent={onOpenParent}
    />,
  );
}

/* ── The derivation layer ──────────────────────────────────────────── */

describe("T-514 — derivePareto parentId plumb-through", () => {
  it("carries each row's parentId through to the ParetoDatum", () => {
    const p = derivePareto(TOP_DEBTORS, 8, 95_000);
    expect(p.map((d) => d.parentId)).toEqual(["par-1", "par-2", "par-3"]);
    // The pre-existing fields are untouched.
    expect(p[0]!.name).toBe("Famille Amine Benali");
    expect(p[0]!.amount).toBe(50_000);
    expect(p[0]!.cumPercent).toBe(53);
    expect(p[0]!.cumOfTotalPct).toBe(53);
  });

  it("stays backward compatible when callers carry no parentId", () => {
    const p = derivePareto(
      [
        { parentName: "Famille A", outstandingAmount: 50_000 },
        { parentName: "Famille B", outstandingAmount: 30_000 },
      ],
      8,
    );
    expect(p.map((d) => d.parentId)).toEqual([undefined, undefined]);
    expect(p.map((d) => d.name)).toEqual(["Famille A", "Famille B"]);
  });
});

/* ── The card's full-name + click contracts ────────────────────────── */

describe("T-514 — DebtorsParetoCard full names + click navigation", () => {
  it("renders the FULL family names (the pre-T-514 'A. Benali' compression is gone)", () => {
    renderCard();
    const data = captured.chart?.data as { name: string; display: string }[];
    expect(data).toHaveLength(3);
    // The redundant « Famille » prefix is stripped, EVERY token kept.
    expect(data.map((d) => d.display)).toEqual([
      "Amine Benali",
      "Yacine Hadj Ali",
      "Sarah Boudiaf",
    ]);
    // The axis reads the full display name.
    expect(captured.xAxis?.dataKey).toBe("display");
    // No compressed "X. Surname" form anywhere in the chart data.
    expect(data.some((d) => /^\w\. /.test(d.display))).toBe(false);
  });

  it("wires the Bar click to onOpenParent and navigates with the clicked row's parentId", () => {
    const onOpenParent = vi.fn();
    renderCard(onOpenParent);
    // The Bar receives the handler + the pointer cursor + the hint.
    expect(typeof captured.bar?.onClick).toBe("function");
    expect(captured.bar?.className).toContain("cursor-pointer");
    expect(screen.getByTestId("pareto-click-hint")).toBeInTheDocument();
    // The recharts datum form (the flat entry).
    const onClick = captured.bar!.onClick as (e: unknown) => void;
    onClick({ parentId: "par-2" });
    expect(onOpenParent).toHaveBeenCalledWith("par-2");
    // The payload-wrapped form (some recharts versions).
    onClick({ payload: { parentId: "par-3" } });
    expect(onOpenParent).toHaveBeenCalledWith("par-3");
  });

  it("never navigates from a row without a parentId (nothing fabricated)", () => {
    const onOpenParent = vi.fn();
    renderCard(onOpenParent);
    const onClick = captured.bar!.onClick as (e: unknown) => void;
    onClick({ parentId: undefined });
    onClick({});
    onClick(undefined);
    expect(onOpenParent).not.toHaveBeenCalled();
  });

  it("without onOpenParent the card degrades to the display-only contract", () => {
    renderCard(undefined);
    expect(captured.bar?.onClick).toBeUndefined();
    expect(captured.bar?.className).toBeUndefined();
    expect(screen.queryByTestId("pareto-click-hint")).not.toBeInTheDocument();
    // The full names still render (readability is unconditional).
    const data = captured.chart?.data as { display: string }[];
    expect(data.map((d) => d.display)).toContain("Amine Benali");
  });

  it("keeps the honest empty state and the reference-mode surfaces", () => {
    captured.chart = undefined;
    render(
      <DebtorsParetoCard topDebtors={[]} totalOutstanding={0} />,
    );
    expect(screen.getByTestId("pareto-empty")).toBeInTheDocument();
    expect(captured.chart).toBeUndefined();
  });
});
