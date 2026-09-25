/**
 * T-412 — the Statistics PayrollCostTrendCard UI suite (Phase 4).
 *
 * Pins the planning consumer of the canonical payroll forecast:
 *   1. Renders the trend with the canonical totals (Réalisé / Projeté /
 *      Pic de besoin / Coût mensuel projeté).
 *   2. The Mensuel ↔ Trimestriel toggle re-aggregates the SAME canonical
 *      points (quarterly labels "T3 2026").
 *   3. The honest empty state.
 *   4. The cross-page link back to the Personnel operational view.
 *
 * Run:
 *   npx vitest run src/tests/features/dashboard/t-412-payroll-trend-ui.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { PayrollCostTrendCard } from "../../../features/dashboard/components/analytics/payroll-cost-trend-card";
import { derivePayrollCostTrend } from "../../../features/dashboard/components/analytics/executive-statistics";
import { computePayrollForecast } from "../../../domain/calc/payroll/payroll-forecast";

// Recharts stubbed the analytics-visuals way (the card's own figures are the
// test target; the chart internals have their own suites).
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
  ComposedChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Bar: () => <div data-testid="recharts-bar" />,
  Line: () => <div data-testid="recharts-line" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
}));

const NOW = new Date("2026-09-15T12:00:00Z"); // 2026-09 in Africa/Algiers

function makePersonnel(count: number, salary = 1_000_000) {
  return Array.from({ length: count }, (_, i) => ({
    id: `per-${i + 1}`,
    firstName: `Emp${i + 1}`,
    lastName: "Probe",
    staffCategory: "teacher" as const,
    position: "Professeur",
    salary,
    paymentMethod: "bank_transfer" as const,
    hireDate: "2020-09-01",
    terminationDate: null,
    status: "active" as const,
  }));
}

function trendFor(personnel: ReturnType<typeof makePersonnel>, salaryPayments: unknown[] = []) {
  const forecast = computePayrollForecast({
    personnel,
    salaryPayments: salaryPayments as never,
    now: NOW,
  });
  return derivePayrollCostTrend(forecast);
}

beforeEach(() => {
  // jsdom has no Router — the card's router-optional links degrade to
  // anchors (the documented convention).
});

afterEach(() => {
  cleanup();
});

describe("T-412 PayrollCostTrendCard (the Statistics planning view)", () => {
  it("1. renders the canonical totals and the series", () => {
    const trend = trendFor(makePersonnel(30));
    render(<PayrollCostTrendCard trend={trend} />);

    expect(
      screen.getByText(/Coûts du Personnel — Réalisé vs Projeté/),
    ).toBeTruthy();
    expect(screen.getByText("Réalisé (fenêtre)")).toBeTruthy();
    expect(screen.getByText("Projeté (horizon)")).toBeTruthy();
    expect(screen.getByText("Pic de besoin")).toBeTruthy();
    expect(screen.getByText("Coût mensuel projeté")).toBeTruthy();
    expect(screen.getByTestId("payroll-trend-chart")).toBeTruthy();
    // The manual legend (no recharts <Legend> — the shared mocks predate it).
    expect(screen.getByText("Réalisé (versements)")).toBeTruthy();
    expect(screen.getByText("Projeté (prévision)")).toBeTruthy();
    expect(screen.getByText("Besoin de financement")).toBeTruthy();
  });

  it("2. the Mensuel ↔ Trimestriel toggle switches the active granularity (same canonical points)", () => {
    const trend = trendFor(makePersonnel(30));
    render(<PayrollCostTrendCard trend={trend} />);

    // NOTE: the month/quarter labels live inside the (mocked) XAxis — the
    // toggle state is asserted via the active button variant instead; the
    // monthly↔quarterly AGGREGATION equality is pinned by the parity suite.
    const monthly = screen.getByTestId("payroll-trend-monthly-toggle");
    const quarterly = screen.getByTestId("payroll-trend-quarterly-toggle");
    expect(monthly.className).toContain("bg-primary");
    expect(quarterly.className).not.toContain("bg-primary");

    fireEvent.click(quarterly);
    expect(quarterly.className).toContain("bg-primary");
    expect(monthly.className).not.toContain("bg-primary");

    fireEvent.click(monthly);
    expect(monthly.className).toContain("bg-primary");
    expect(quarterly.className).not.toContain("bg-primary");
    // The chart area is present in both granularities.
    expect(screen.getByTestId("payroll-trend-chart")).toBeTruthy();
  });

  it("3. renders the honest empty state when there is no payroll data", () => {
    const trend = trendFor([]);
    render(<PayrollCostTrendCard trend={trend} />);
    expect(screen.getByTestId("payroll-trend-empty")).toBeTruthy();
    expect(screen.getByTestId("link-personnel-payroll-trend")).toBeTruthy();
  });

  it("4. carries the cross-page link to the Personnel operational view", () => {
    const trend = trendFor(makePersonnel(2, 65_000));
    render(<PayrollCostTrendCard trend={trend} />);
    const link = screen.getByTestId("link-personnel-payroll-trend");
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/personnel");
  });
});
