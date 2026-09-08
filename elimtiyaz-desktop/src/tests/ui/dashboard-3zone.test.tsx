/**
 * Dashboard 3-zone integration tests (T-243, 2026-09-09 — UI-306).
 *
 * Supersedes the T-088 `dashboard-restructure.test.tsx` suite: the owner's
 * AI-review blueprint restructures the Overview into the 12-column
 * Zone A (analytical stage) / Zone B (contextual command rail) layout.
 *
 * What is STILL guarded from T-088 (the invariants that survive the
 * redesign):
 *   - The DashboardCalendar stays embedded on the Overview.
 *   - Demographics detail charts stay drill-down-ONLY.
 *   - Every KPI card drills into the SeeDetailsModal sub-tabs.
 *
 * What is NEW here (T-243):
 *   - The 4 sparkline KPI cards render from REAL data only — no
 *     sparkline/delta without a real series (§15.16).
 *   - The macro spline renders the real revenue series, with an honest
 *     empty state when absent.
 *   - `deriveRecoveryFunnel` — the funnel stages derive from REAL
 *     debtAging family counts (no admissions fabrication).
 *   - `deriveWeeklyRhythm` — the weekday × method matrix derives from the
 *     REAL payments stream: Algerian school week (Dim→Jeu), Friday/Saturday
 *     excluded, refunded excluded, academic-year range respected.
 *   - The InsightsRail shows the REAL collection-rate gauge, the overdue
 *     census and the "à relancer" feed, routing to the alerts workspace.
 *
 * Recharts is mocked (jsdom renders ResponsiveContainer at 0×0 — the
 * derivations are tested as pure functions instead). The calendar is
 * mocked as in the T-088 suite (provider-stack isolation).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
// Initialize i18n FIRST — useTranslation() will otherwise throw.
import "../../i18n/i18n";
import { OverviewTab, type DashboardData } from "../../features/dashboard/tabs/overview-tab";
import {
  deriveRecoveryFunnel,
} from "../../features/dashboard/components/recovery-funnel-card";
import {
  deriveWeeklyRhythm,
} from "../../features/dashboard/components/weekly-operating-rhythm";
import type { Payment } from "../../domain/model/payment";

// Mock the DashboardCalendar so we don't need ToastProvider/AuthProvider/
// RepositoryProvider. The OverviewTab's own logic is what we test here.
vi.mock("../../features/dashboard/dashboard-calendar", () => ({
  DashboardCalendar: () => (
    <div data-testid="dashboard-calendar-stub">calendar</div>
  ),
}));

// Mock recharts — jsdom gives ResponsiveContainer a 0×0 box; the data
// derivations are covered by the pure-function suites below. Chart mocks
// wrap children in an <svg> so the real <defs>/<linearGradient> children
// stay in the SVG namespace (no React casing warnings).
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
  AreaChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  BarChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Area: () => <div data-testid="recharts-area" />,
  Bar: () => <div data-testid="recharts-bar" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
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
    monthlyRevenue: 5_400_000,
    outstandingDebt: 4_600_000,
    pendingExpenses: 2,
    attendanceRateToday: 0.94,
    overdueAlerts: 7,
  },
  revenue: [
    { label: "Sep", amount: 5_000_000 },
    { label: "Oct", amount: 6_500_000 },
    { label: "Nov", amount: 5_900_000 },
  ],
  debtAging: [
    { bucket: "0_30" as const, amount: 1_000_000, debtorCount: 5 },
    { bucket: "31_60" as const, amount: 2_000_000, debtorCount: 8 },
    { bucket: "61_90" as const, amount: 500_000, debtorCount: 3 },
    { bucket: "91_180" as const, amount: 700_000, debtorCount: 2 },
    { bucket: "180_plus" as const, amount: 400_000, debtorCount: 2 },
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
    {
      parentId: "p2",
      parentName: "Famille Grave",
      parentPhone: "+213 555 111 111",
      studentCount: 3,
      daysOverdue: 120,
      outstandingAmount: 310_000,
      bucket: "91_180" as const,
    },
  ],
};

/** Payment factory — minimal canonical row. */
function payment(over: Partial<Payment>): Payment {
  return {
    id: over.id ?? "pay-1",
    tenantId: "t1",
    receiptNumber: "REC-2026-000001",
    parentId: "p1",
    studentId: null,
    amount: 10_000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "staff-1",
    collectedAt: "2026-01-11T09:30:00Z", // Sunday
    createdAt: "2026-01-11T09:30:00Z",
    updatedAt: "2026-01-11T09:30:00Z",
    ...over,
  };
}

describe("deriveWeeklyRhythm — REAL payments → weekday × method matrix", () => {
  it("buckets payments into the Algerian school week (Dim→Jeu), excluding Fri/Sat", () => {
    // 2026-01-11 Sun, 01-12 Mon, 01-09 Fri, 01-10 Sat.
    const rows = [
      payment({ id: "a", collectedAt: "2026-01-11T09:00:00Z", amount: 100, method: "cash" }),
      payment({ id: "b", collectedAt: "2026-01-12T09:00:00Z", amount: 200, method: "check" }),
      payment({ id: "c", collectedAt: "2026-01-09T09:00:00Z", amount: 999, method: "cash" }), // Friday
      payment({ id: "d", collectedAt: "2026-01-10T09:00:00Z", amount: 999, method: "cash" }), // Saturday
    ];
    const matrix = deriveWeeklyRhythm(rows);
    expect(matrix.map((d) => d.day)).toEqual(["Dim", "Lun", "Mar", "Mer", "Jeu"]);
    expect(matrix[0]).toEqual({ day: "Dim", cash: 100, check: 0, transfer: 0 });
    expect(matrix[1]).toEqual({ day: "Lun", cash: 0, check: 200, transfer: 0 });
    // Fri/Sat amounts are nowhere in the matrix.
    const total = matrix.reduce((s, d) => s + d.cash + d.check + d.transfer, 0);
    expect(total).toBe(300);
  });

  it("excludes refunded payments (no net movement)", () => {
    const rows = [
      payment({ id: "a", amount: 100 }),
      payment({ id: "b", amount: 50, status: "refunded" }),
    ];
    const matrix = deriveWeeklyRhythm(rows);
    expect(matrix[0].cash).toBe(100);
  });

  it("respects the academic-year date range", () => {
    const rows = [
      payment({ id: "in", collectedAt: "2025-10-05T09:00:00Z", amount: 100 }), // Sunday, in range
      payment({ id: "out", collectedAt: "2026-02-01T09:00:00Z", amount: 999 }), // Sunday, out of range
    ];
    const matrix = deriveWeeklyRhythm(rows, { from: "2025-09-01", to: "2026-01-31" });
    expect(matrix[0].cash).toBe(100);
  });

  it("ignores rows with unparseable collectedAt timestamps", () => {
    const rows = [payment({ id: "bad", collectedAt: "not-a-date" })];
    const matrix = deriveWeeklyRhythm(rows);
    expect(matrix[0].cash).toBe(0);
  });
});

describe("deriveRecoveryFunnel — REAL debtAging → escalation stages", () => {
  it("returns [] when no family is overdue (honest empty state)", () => {
    expect(deriveRecoveryFunnel([])).toEqual([]);
    expect(
      deriveRecoveryFunnel(
        POPULATED_DATA.debtAging.map((b) => ({ ...b, debtorCount: 0 })),
      ),
    ).toEqual([]);
  });

  it("derives the 4 stages from the bucket family counts", () => {
    // 5 + 8 + 3 + 2 + 2 = 20 families overdue.
    const stages = deriveRecoveryFunnel(POPULATED_DATA.debtAging);
    expect(stages).toHaveLength(4);
    expect(stages[0]).toMatchObject({ name: "En retard", count: 20, rateFromPrevious: 100 });
    expect(stages[1]).toMatchObject({ name: "≤ 60 j", count: 13, rateFromPrevious: 65 });
    expect(stages[2]).toMatchObject({ name: "61–90 j", count: 3, rateFromPrevious: 15 });
    expect(stages[3]).toMatchObject({ name: "> 90 j", count: 4, rateFromPrevious: 20 });
  });
});

describe("OverviewTab — T-243 3-zone layout", () => {
  function setup(
    data: DashboardData,
    payments: readonly Payment[] = [],
    range?: { from: string; to: string },
  ) {
    return render(
      <OverviewTab
        data={data}
        payments={payments}
        range={range}
        onDrillDown={() => {}}
        onGoToAlerts={() => {}}
      />,
    );
  }

  it("renders the 4 sparkline KPI cards with REAL values", () => {
    setup(POPULATED_DATA);
    expect(screen.getByText("Élèves")).toBeInTheDocument();
    expect(screen.getByText("389")).toBeInTheDocument();
    expect(screen.getByText("Revenu mensuel")).toBeInTheDocument();
    expect(screen.getByText("Créances en retard")).toBeInTheDocument();
    expect(screen.getByText("Assiduité (aujourd'hui)")).toBeInTheDocument();
    expect(screen.getByText("94%")).toBeInTheDocument();
  });

  it("renders the revenue sparkline + month-over-month delta from the REAL series", () => {
    setup(POPULATED_DATA);
    // Nov 5.9M vs Oct 6.5M → -9% (rounded, real derivation).
    expect(screen.getByText("9%")).toBeInTheDocument();
    // The sparkline SVG is rendered for the revenue card only.
    expect(document.querySelector("svg polyline")).not.toBeNull();
  });

  it("renders NO sparkline/delta when no real series exists (§15.16)", () => {
    setup(EMPTY_DATA);
    // No series → no polyline anywhere.
    expect(document.querySelector("svg polyline")).toBeNull();
  });

  it("renders the hero trend card with an honest empty state when the series is empty", () => {
    setup(EMPTY_DATA);
    expect(screen.getByText("Flux Financiers & Recouvrements")).toBeInTheDocument();
    expect(
      screen.getByText("Aucun encaissement enregistré sur la période sélectionnée."),
    ).toBeInTheDocument();
  });

  it("renders the funnel + weekly rhythm + calendar (Zone A rows 3–4)", () => {
    setup(POPULATED_DATA, [payment({ id: "a", amount: 100 })]);
    expect(screen.getByText("Entonnoir de Recouvrement")).toBeInTheDocument();
    expect(screen.getByText("Rythme d'Encaissement Hebdomadaire")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-calendar-stub")).toBeInTheDocument();
    // Funnel stages from the real aging counts.
    expect(screen.getByText("≤ 60 j")).toBeInTheDocument();
    expect(screen.getByText("> 90 j")).toBeInTheDocument();
  });

  it("renders the weekly rhythm empty state when no payment is in range", () => {
    setup(POPULATED_DATA, [], { from: "2025-09-01", to: "2025-09-30" });
    expect(
      screen.getByText("Aucun encaissement sur la période sélectionnée."),
    ).toBeInTheDocument();
  });

  it("renders the Zone B rail: gauge, AI card and relance feed from REAL data", () => {
    setup(POPULATED_DATA);
    // Gauge: 17.4M encaissé / (17.4M + 4.6M) = 79%.
    expect(screen.getByText("79%")).toBeInTheDocument();
    expect(screen.getByText("Taux de Recouvrement Annuel")).toBeInTheDocument();
    // AI card: 20 familles en retard dont 7 au-delà de 60 jours.
    expect(screen.getByText(/20 familles en retard/)).toBeInTheDocument();
    expect(screen.getByText(/7 au-delà de 60 jours/)).toBeInTheDocument();
    // Relance feed: the two worst families.
    expect(screen.getByText("Famille Test")).toBeInTheDocument();
    expect(screen.getByText("Famille Grave")).toBeInTheDocument();
    expect(screen.getByText("À Relancer en Priorité")).toBeInTheDocument();
  });

  it("renders the rail's honest zero state when nothing is overdue", () => {
    setup(EMPTY_DATA);
    expect(screen.getByText(/Aucune créance en retard/)).toBeInTheDocument();
    expect(screen.getByText("Aucune relance nécessaire.")).toBeInTheDocument();
  });

  it("still guards T-088 invariants: demographics charts stay drill-down-only", () => {
    setup(POPULATED_DATA);
    expect(screen.queryByText("Effectifs par niveau")).not.toBeInTheDocument();
    expect(screen.queryByText("Par genre")).not.toBeInTheDocument();
  });

  it("KPI cards drill into the SeeDetailsModal sub-tabs", () => {
    const onDrillDown = vi.fn();
    render(
      <OverviewTab
        data={POPULATED_DATA}
        payments={[]}
        onDrillDown={onDrillDown}
        onGoToAlerts={() => {}}
      />,
    );
    // Students card → demographics drill-down (the card's clickable
    // container carries the onClick handler).
    const studentsCard = screen.getByText("389").closest('[class*="cursor-pointer"]');
    expect(studentsCard).toBeTruthy();
    (studentsCard as HTMLElement).click();
    expect(onDrillDown).toHaveBeenCalledWith("students");
  });

  it("the relance buttons route to the alerts workspace", () => {
    const onGoToAlerts = vi.fn();
    render(
      <OverviewTab
        data={POPULATED_DATA}
        payments={[]}
        onDrillDown={() => {}}
        onGoToAlerts={onGoToAlerts}
      />,
    );
    const relance = screen.getByText("Famille Test").closest("button");
    expect(relance).toBeTruthy();
    (relance as HTMLButtonElement).click();
    expect(onGoToAlerts).toHaveBeenCalledTimes(1);
  });
});
