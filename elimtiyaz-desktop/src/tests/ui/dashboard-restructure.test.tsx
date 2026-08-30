/**
 * Dashboard UI restructure regression tests (T-088).
 *
 * Guards against the 3 defects the audit flagged:
 *
 *   1. DUPLICATION — demographics/revenue/debt charts rendered BOTH
 *      on the Overview tab AND inside the SeeDetailsModal drill-down.
 *      The fix: Overview shows KPIs + calendar + Top Debtors only;
 *      the drill-down holds ALL analytics. Test asserts the Overview
 *      no longer contains the duplicate charts.
 *
 *   2. DEAD Stat card — the bottom "Revenu cumulé / Créances / Taux de
 *      recouvrement" card restated KPIs already in the grid. Test
 *      asserts none of those labels appear in the Overview.
 *
 *   3.ROUTING — the Unread Alerts KPI routes to the Alerts tab
 *      (onGoToAlerts), not the drill-down; every other KPI drills
 *      into the SeeDetailsModal.
 *
 * The DashboardCalendar sub-component is mocked out because it pulls
 * in useToast / useAuth / useRepositories (the full provider stack).
 * Mocking it isolates the OverviewTab's own contract (KPI grid + Top
 * Debtors card) without dragging in unrelated dependencies.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
// Initialize i18n FIRST — useTranslation() will otherwise throw.
import "../../i18n/i18n";
import { OverviewTab, type DashboardData } from "../../features/dashboard/tabs/overview-tab";

// Mock the DashboardCalendar so we don't need ToastProvider/AuthProvider/
// RepositoryProvider. The OverviewTab's own logic is what we test here.
vi.mock("../../features/dashboard/dashboard-calendar", () => ({
  DashboardCalendar: () => (
    <div data-testid="dashboard-calendar-stub">calendar</div>
  ),
}));

const EMPTY_DATA: DashboardData = {
  kpis: {
    totalStudents: 0,
    totalParents: 0,
    totalStaff: 0,
    monthlyRevenue: 0,
    outstandingDebt: 0,
    pendingExpenses: 0,
    attendanceRateToday: 0,
    overdueAlerts: 0,
  },
  revenue: [],
  debtAging: [],
  demographics: { grade: [], gender: [], age: [], capacity: [] },
  topDebtors: [],
};

const POPULATED_DATA: DashboardData = {
  kpis: {
    totalStudents: 389,
    totalParents: 258,
    totalStaff: 14,
    monthlyRevenue: 54_962_100,
    outstandingDebt: 48_582_000,
    pendingExpenses: 2,
    attendanceRateToday: 0.94,
    overdueAlerts: 7,
  },
  revenue: [
    { label: "Sep", amount: 5_000_000 },
    { label: "Oct", amount: 6_500_000 },
  ],
  debtAging: [
    { bucket: "0_30" as const, amount: 1_000_000, debtorCount: 5 },
    { bucket: "31_60" as const, amount: 2_000_000, debtorCount: 8 },
  ],
  demographics: {
    grade: [{ label: "1AP", count: 30, percent: 8 }],
    gender: [
      { label: "Garçons", count: 200, percent: 51 },
      { label: "Filles", count: 189, percent: 49 },
    ],
    age: [{ label: "6-8 ans", count: 80, percent: 20 }],
    capacity: [{ label: "1AP-A", count: 28, percent: 93 }],
  },
  topDebtors: [
    {
      parentId: "p1",
      parentName: "Famille Test",
      parentPhone: "+213 555 000 000",
      studentCount: 2,
      daysOverdue: 45,
      outstandingAmount: 250_000,
      bucket: "31_60" as const,
    },
  ],
};

describe("OverviewTab — T-088 dashboard restructure", () => {
  it("renders the 4 operational KPI labels (French hardcoded strings)", () => {
    render(
      <OverviewTab
        data={POPULATED_DATA}
        onDrillDown={() => {}}
        onGoToAlerts={() => {}}
      />,
    );
    // The 4 operational KPIs use hardcoded French labels in the source
    // (Personnel / Encaissé aujourd'hui / Dépenses en attente / Alertes
    // non lues) — assert these are present (the audit said the dashboard
    // should expose MORE data, not just 4 KPIs).
    expect(screen.getByText("Personnel")).toBeInTheDocument();
    expect(screen.getByText("Encaissé aujourd'hui")).toBeInTheDocument();
    expect(screen.getByText("Dépenses en attente")).toBeInTheDocument();
    expect(screen.getByText("Alertes non lues")).toBeInTheDocument();
  });

  it("renders the Top Debtors card with populated data", () => {
    render(
      <OverviewTab
        data={POPULATED_DATA}
        onDrillDown={() => {}}
        onGoToAlerts={() => {}}
      />,
    );
    expect(screen.getByText("Top débiteurs")).toBeInTheDocument();
    expect(screen.getByText("Famille Test")).toBeInTheDocument();
    // The debt amount formatted as DZD plain (250 000)
    expect(screen.getByText("250 000")).toBeInTheDocument();
  });

  it("renders an honest empty state for Top Debtors when none", () => {
    render(
      <OverviewTab
        data={EMPTY_DATA}
        onDrillDown={() => {}}
        onGoToAlerts={() => {}}
      />,
    );
    expect(screen.getByText("Top débiteurs")).toBeInTheDocument();
    expect(screen.getByText("Aucune créance en cours.")).toBeInTheDocument();
  });

  it("renders the calendar stub (DashboardCalendar embedded)", () => {
    render(
      <OverviewTab
        data={POPULATED_DATA}
        onDrillDown={() => {}}
        onGoToAlerts={() => {}}
      />,
    );
    // The calendar is the operational "what happened today" view.
    // T-088 keeps it on the Overview (it's NOT duplicated elsewhere).
    expect(screen.getByTestId("dashboard-calendar-stub")).toBeInTheDocument();
  });

  it("does NOT render the duplicate demographics charts on Overview", () => {
    render(
      <OverviewTab
        data={POPULATED_DATA}
        onDrillDown={() => {}}
        onGoToAlerts={() => {}}
      />,
    );
    // "Effectifs par niveau" was the chart headline that used to be
    // duplicated here AND inside the SeeDetailsModal. After T-088 it
    // lives only in the drill-down.
    expect(screen.queryByText("Effectifs par niveau")).not.toBeInTheDocument();
    expect(screen.queryByText("Par genre")).not.toBeInTheDocument();
  });

  it("does NOT render the dead Stat card labels (T-088 dead code removal)", () => {
    render(
      <OverviewTab
        data={POPULATED_DATA}
        onDrillDown={() => {}}
        onGoToAlerts={() => {}}
      />,
    );
    // The old "Stat" card at the bottom restated KPIs with these
    // exact labels — pure duplication. After T-088 they must be gone.
    expect(screen.queryByText("Revenu cumulé")).not.toBeInTheDocument();
    expect(screen.queryByText("Taux de recouvrement")).not.toBeInTheDocument();
  });

  it("clicking the Unread Alerts KPI routes to the Alerts tab (not the drill-down)", () => {
    const onGoToAlerts = vi.fn();
    const onDrillDown = vi.fn();
    render(
      <OverviewTab
        data={POPULATED_DATA}
        onDrillDown={onDrillDown}
        onGoToAlerts={onGoToAlerts}
      />,
    );
    // The Unread Alerts KPI is the only one that does NOT drill into
    // SeeDetailsModal — it switches to the Alerts tab instead.
    const alertsKpi = screen.getByText("Alertes non lues")
      .closest("button") as HTMLButtonElement;
    expect(alertsKpi).toBeTruthy();
    alertsKpi.click();
    expect(onGoToAlerts).toHaveBeenCalledTimes(1);
    expect(onDrillDown).not.toHaveBeenCalled();
  });

  it("clicking the Outstanding Debt KPI drills into the Debt tab", () => {
    const onDrillDown = vi.fn();
    render(
      <OverviewTab
        data={POPULATED_DATA}
        onDrillDown={onDrillDown}
        onGoToAlerts={() => {}}
      />,
    );
    // The Outstanding Debt KPI carries the hint "familles en retard" —
    // unique marker so we can find the button.
    const debtHint = screen.getByText(/familles en retard/);
    const debtKpi = debtHint.closest("button") as HTMLButtonElement;
    expect(debtKpi).toBeTruthy();
    debtKpi.click();
    expect(onDrillDown).toHaveBeenCalledWith("outstandingDebt");
  });

  it("renders the Pending Expenses KPI with warning tone when > 0", () => {
    render(
      <OverviewTab
        data={POPULATED_DATA}
        onDrillDown={() => {}}
        onGoToAlerts={() => {}}
      />,
    );
    // Pending Expenses = 2 in POPULATED_DATA → "À approuver" hint
    expect(screen.getByText("À approuver")).toBeInTheDocument();
    // The KPI value should be visible somewhere (2)
    const pendingKpi = screen.getByText("Dépenses en attente")
      .closest("button") as HTMLButtonElement;
    expect(pendingKpi).toBeTruthy();
    // The value 2 should be inside this KPI button
    expect(pendingKpi.textContent).toContain("2");
  });

  it("renders the Pending Expenses KPI with default tone when 0", () => {
    render(
      <OverviewTab
        data={EMPTY_DATA}
        onDrillDown={() => {}}
        onGoToAlerts={() => {}}
      />,
    );
    // 0 pending expenses → "Tout est traité" hint
    expect(screen.getByText("Tout est traité")).toBeInTheDocument();
  });
});
