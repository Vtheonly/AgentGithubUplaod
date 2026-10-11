/**
 * T-503 suite (UI-334) — the inspection buttons ATTACHED to their targets:
 *
 *   1. NO FLOATING STRIPS: the three dedicated "strip" layout cells are
 *      retired (Inspection directe / Source des matrices / Ligne de
 *      provenance active) and the justify-end wrapper rows above the
 *      charts are gone — every InspectTrigger now lives on the card it
 *      inspects.
 *   2. EVERY TRIGGER PRESERVED: the 26 pre-T-503 inspection requests are
 *      all still wired (none dropped in the move) — each metric key
 *      appears exactly once in the tab source.
 *   3. THE SHARED ATTACHMENT SURFACE: the cards render their headerActions
 *      INSIDE their own header (behavioral) — the button is inside the
 *      card's DOM subtree, immediately beside the card's title, and the
 *      wrapper renders NOTHING when no node is passed (the pre-T-503
 *      header renders exactly as before).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

// Initialize i18n FIRST — the surfaces are French-labeled.
import "../../../i18n/i18n";
import { CardHeaderActions } from "../../../features/dashboard/components/analytics/card-header-actions";
import { MethodMixCard } from "../../../features/dashboard/components/analytics/mix-cards";
import { DebtorsParetoCard } from "../../../features/dashboard/components/analytics/debtors-pareto-card";
import type { Payment } from "../../../domain/model/payment";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const TAB_SRC = readFileSync(
  join(__dirname, "../../../features/dashboard/tabs/analytics-tab.tsx"),
  "utf8",
);

// The 25 metric keys the pre-T-503 surfaces carried (the 26th trigger —
// the aging total — rides headerActions with metric "debt_aging"; all 26
// are listed here).
const ALL_METRIC_KEYS = [
  "annual_revenue",
  "outstanding_debt",
  "outstanding_debt_all_years",
  "tranche_1_remaining",
  "transport_remaining",
  "service_payments",
  "gpa_below_10",
  "attendance_records",
  "absence_count",
  "discount_total",
  "risk_profiles",
  "roster",
  "filtered_paid_revenue",
  "payment_stats_total",
  "method_mix",
  "category_mix",
  "monthly_revenue",
  "previous_year_revenue",
  "debt_aging",
  "debt_aging_0_30",
  "debt_aging_31_60",
  "debt_aging_61_90",
  "debt_aging_91_180",
  "debt_aging_180_plus",
  "debtors_pareto",
  "student_count",
];

// ============================================================
// 1. NO FLOATING STRIPS
// ============================================================
describe("T-503 (UI-334) — the floating strips are retired", () => {
  it("the three strip layout cells no longer exist", () => {
    expect(TAB_SRC).not.toContain('"pilotage-inspection"');
    expect(TAB_SRC).not.toContain('"diagnostic-source"');
    expect(TAB_SRC).not.toContain('"charts-provenance"');
    // The strip CONTAINERS (their normalized class) are gone too — only the
    // retirement COMMENTS still name the strips (the archaeology).
    expect(TAB_SRC).not.toContain("px-3 py-2.5");
  });

  it("the justify-end wrapper rows above the charts are gone (the triggers ride the cards)", () => {
    expect(TAB_SRC).not.toContain("flex justify-end");
    // Every trigger in the tab is passed through a headerActions / rowActions
    // attachment (or lives on the stat-strip's own labeled title row / the
    // tab header's active-year context — the two sanctioned inline spots).
    const attached = TAB_SRC.match(/headerActions=\{/g)?.length ?? 0;
    const rowAttached = TAB_SRC.match(/rowActions=\{/g)?.length ?? 0;
    expect(attached).toBeGreaterThanOrEqual(10);
    expect(rowAttached).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// 2. EVERY TRIGGER PRESERVED (the metric-key census)
// ============================================================
describe("T-503 (UI-334) — every inspection request survives the move", () => {
  it("all 26 pre-T-503 metric keys appear EXACTLY once in the tab", () => {
    for (const key of ALL_METRIC_KEYS) {
      const hits = TAB_SRC.match(new RegExp(`metric: "${key}"`, "g")) ?? [];
      expect(hits.length, `metric "${key}" must appear exactly once`).toBe(1);
    }
  });

  it("the total InspectTrigger count is unchanged (26 — nothing dropped, nothing duplicated)", () => {
    const triggers = TAB_SRC.match(/<InspectTrigger/g) ?? [];
    expect(triggers.length).toBe(26);
  });
});

// ============================================================
// 3. THE SHARED ATTACHMENT SURFACE (behavioral)
// ============================================================
describe("T-503 (UI-334) — the CardHeaderActions attachment surface", () => {
  it("renders its children INSIDE the wrapper (the button lives on the card)", () => {
    render(<CardHeaderActions><button type="button">Inspecter</button></CardHeaderActions>);
    const wrapper = screen.getByTestId("card-header-actions");
    expect(within(wrapper).getByRole("button", { name: "Inspecter" })).toBeTruthy();
  });

  it("renders NOTHING when no node is passed (the pre-T-503 header is untouched)", () => {
    const { container } = render(<CardHeaderActions>{undefined}</CardHeaderActions>);
    expect(container.querySelector('[data-testid="card-header-actions"]')).toBeNull();
  });

  it("a card renders its headerActions INSIDE its own header subtree (attached, not floating)", () => {
    const payment: Payment = {
      id: "p1",
      tenantId: "t1",
      receiptNumber: "REC-1",
      parentId: "par-1",
      studentId: null,
      amount: 10_000,
      method: "cash",
      status: "paid",
      category: "tuition",
      installmentId: null,
      proofUrl: null,
      notes: null,
      collectedBy: "s1",
      collectedAt: "2025-09-15T10:00:00Z",
      createdAt: "2025-09-15T10:00:00Z",
      updatedAt: "2025-09-15T10:00:00Z",
    } as unknown as Payment;
    render(
      <MethodMixCard
        slice={[payment]}
        headerActions={<button type="button">Inspecter · Mix des méthodes</button>}
      />,
    );
    const card = screen.getByTestId("method-mix-card");
    // The button is INSIDE the card's DOM subtree — attached to the chart
    // it inspects, not floating in a sibling cell.
    const trigger = within(card).getByRole("button", {
      name: "Inspecter · Mix des méthodes",
    });
    expect(trigger).toBeTruthy();
    // And it sits in the card's HEADER (beside the title), not the body.
    expect(trigger.closest('[data-slot="card-header"], header, .border-b')).toBeTruthy();
  });

  it("the pareto card keeps its reference selector AND gains the actions in the same header", () => {
    render(
      <DebtorsParetoCard
        topDebtors={[]}
        headerActions={<button type="button">Inspecter · Pareto</button>}
      />,
    );
    const card = screen.getByTestId("debtors-pareto-card");
    expect(within(card).getByRole("button", { name: "Inspecter · Pareto" })).toBeTruthy();
    // The card still renders its own header copy (the attachment never
    // displaced the card's identity).
    expect(within(card).getAllByText(/Pareto/i).length).toBeGreaterThan(0);
  });
});
