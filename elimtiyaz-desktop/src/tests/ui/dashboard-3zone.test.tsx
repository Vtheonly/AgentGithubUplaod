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
 *   - `deriveRecoveryFunnel` — the funnel stages derive from the CANONICAL
 *     triage over the CONFIGURED thresholds (T-469: no hardcoded aging
 *     edges, no admissions fabrication).
 *   - `deriveWeeklyRhythm` — the weekday × method matrix derives from the
 *     REAL payments stream: Algerian school week (Dim→Jeu), Friday/Saturday
 *     excluded, refunded excluded, academic-year range respected.
 *   - The InsightsRail shows the REAL collection-rate gauge, the overdue
 *     census and the "à relancer" feed, routing to the alerts workspace.
 *
 * T-469 REALIGNMENT (2026-10-03): the render assertions were STALE against
 * the current intentional UI — the owner's 32be0c8 "okay" dashboard rewrite
 * renamed the funnel card / the rail gauge, T-426 renamed the debt KPI
 * ("Créances en retard" → "Encours total annuel"), and the sparkline moved
 * from <polyline> to a bezier <path>. The suite had been RED on main since;
 * this repair re-pins the SAME invariants onto the current texts (TEST-501
 * in the problem registry — never a silent green).
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
import { deriveDebtTriage } from "../../features/dashboard/components/analytics/executive-statistics";
import {
  deriveWeeklyRhythm,
} from "../../features/dashboard/components/weekly-operating-rhythm";
import type { Payment, Installment } from "../../domain/model/payment";

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
    overdueAmount: 0,
    pendingExpenses: 0,
    attendanceRateToday: 0,
    overdueAlerts: 0,
  },
  revenue: [],
  debtAging: [],
  demographics: { grade: [], gender: [], age: [] },
  topDebtors: [],
};

const POPULATED_DATA: DashboardData = {
  kpis: {
    totalStudents: 389,
    totalParents: 258,
    totalStaff: 14,
    monthlyRevenue: 5_400_000,
    outstandingDebt: 4_600_000,
    overdueAmount: 1_200_000,
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

describe("deriveRecoveryFunnel — the canonical triage → config-driven escalation stages (T-469)", () => {
  /** Installments whose worst days deliberately straddle the CONFIGURED
   *  edges (5/15/60 defaults): 2 not-due, 3 in-grace/current, 4 beyond
   *  yellow, 2 beyond red — 11 debtor families. */
  const TRIAGE_INSTALLMENTS: Installment[] = [
    // 2 families, not yet due (Sept->next-year due dates).
    ins("t-notdue-1", "p-notdue-1", 10_000, "2027-06-15"),
    ins("t-notdue-2", "p-notdue-2", 10_000, "2027-06-15"),
    // 3 families, past due within the yellow edge (days 1..15).
    ins("t-current-1", "p-current-1", 10_000, past(3)),
    ins("t-current-2", "p-current-2", 10_000, past(7)),
    ins("t-current-3", "p-current-3", 10_000, past(10)),
    // 4 families, beyond yellow but within red (days 16..60).
    ins("t-rem-1", "p-rem-1", 10_000, past(20)),
    ins("t-rem-2", "p-rem-2", 10_000, past(30)),
    ins("t-rem-3", "p-rem-3", 10_000, past(40)),
    ins("t-rem-4", "p-rem-4", 10_000, past(50)),
    // 2 families, beyond red (days > 60).
    ins("t-chronic-1", "p-chronic-1", 10_000, past(75)),
    ins("t-chronic-2", "p-chronic-2", 10_000, past(100)),
  ];
  const TRIAGE = deriveDebtTriage(TRIAGE_INSTALLMENTS, Date.now());

  function ins(id: string, parentId: string, amountDue: number, dueDate: string): Installment {
    return {
      id, parentId, studentId: `${parentId}-s`, category: "tuition", label: "Tranche 1",
      trancheNumber: 1, amountDue, amountPaid: 0, amountPending: 0, dueDate, paidDate: null,
      status: "unpaid", academicCycle: "primaire", paymentPlan: "tranches",
      isCustomSchedule: false, customSchedule: false, customScheduleNote: null,
    };
  }
  function past(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  }

  it("returns [] when no family has outstanding (honest empty state)", () => {
    expect(deriveRecoveryFunnel(deriveDebtTriage([], Date.now()))).toEqual([]);
  });

  it("derives the 4 stages from the CONFIGURED threshold edges (5/15/60)", () => {
    const stages = deriveRecoveryFunnel(TRIAGE);
    expect(stages).toHaveLength(4);
    // 11 debtor families total.
    expect(stages[0]).toMatchObject({ name: "Débiteurs (encours > 0)", count: 11, rateFromPrevious: 100 });
    // Past due (days > 0): 3 + 4 + 2 = 9.
    expect(stages[1]).toMatchObject({ name: "En retard (échus)", count: 9, rateFromPrevious: 82 });
    // Beyond yellow (15 j): 4 + 2 = 6 — the label carries the configured edge.
    expect(stages[2]).toMatchObject({ count: 6, rateFromPrevious: 55 });
    expect(stages[2].name).toContain("15");
    // Beyond red (60 j): 2.
    expect(stages[3]).toMatchObject({ count: 2, rateFromPrevious: 18 });
    expect(stages[3].name).toContain("60");
  });

  it("the edges FOLLOW the configured thresholds (30/90 — the configurable mandate)", () => {
    // The TRIAGE itself is re-derived under the configured edges — the
    // funnel consumes its buckets + its OWN labels (never a relabel under
    // foreign edges — the mismatch trap the first draft caught).
    const triage3090 = deriveDebtTriage(TRIAGE_INSTALLMENTS, Date.now(), {
      gracePeriodDays: 5, yellowDays: 30, redDays: 90, activePayerGraceDays: 15,
    });
    const stages = deriveRecoveryFunnel(triage3090);
    // Beyond yellow (30 j): the 40/50-day + chronic rows = 4.
    expect(stages[2]).toMatchObject({ count: 4 });
    expect(stages[2].name).toContain("30");
    // Beyond red (90 j): only the 100-day row = 1.
    expect(stages[3]).toMatchObject({ count: 1 });
    expect(stages[3].name).toContain("90");
  });
});

describe("OverviewTab — T-243 3-zone layout", () => {
  /** T-339: a live-shaped 3-wave installment fixture (tuition T1/T2/T3). */
  const baseInstallment: Installment = {
    id: "w-base",
    parentId: "p1",
    studentId: "s1",
    category: "tuition",
    label: "Tranche 1",
    trancheNumber: 1,
    amountDue: 0,
    amountPaid: 0,
    amountPending: 0,
    dueDate: "2025-09-15",
    paidDate: null,
    status: "unpaid",
    academicCycle: "primaire",
    paymentPlan: "tranches",
    isCustomSchedule: false,
    customSchedule: false,
    customScheduleNote: null,
  };
  const WAVES: Installment[] = [
    { ...baseInstallment, id: "w-t1-a", trancheNumber: 1, label: "INSCRIPTION (FI)", amountDue: 100_000, amountPaid: 100_000, status: "paid", dueDate: "2025-09-15" },
    { ...baseInstallment, id: "w-t1-b", trancheNumber: 1, label: "INSCRIPTION (FI)", amountDue: 100_000, amountPaid: 50_000, status: "partial", dueDate: "2025-09-15" },
    { ...baseInstallment, id: "w-t2-a", trancheNumber: 2, label: "2EME TRANCHE (V2)", amountDue: 80_000, amountPaid: 80_000, status: "paid", dueDate: "2025-12-15" },
    { ...baseInstallment, id: "w-t2-b", trancheNumber: 2, label: "2EME TRANCHE (V2)", amountDue: 80_000, amountPaid: 0, status: "unpaid", dueDate: "2025-12-15" },
    { ...baseInstallment, id: "w-t3-a", trancheNumber: 3, label: "3ème TRANCHE (2V)", amountDue: 80_000, amountPaid: 0, status: "unpaid", dueDate: "2026-03-15" },
  ];

  function setup(
    data: DashboardData,
    payments: readonly Payment[] = [],
    range?: { from: string; to: string },
    installments: readonly Installment[] = WAVES,
  ) {
    return render(
      <OverviewTab
        data={data}
        payments={payments}
        installments={installments}
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
    // T-426/T-469: the debt KPI is the TOTAL receivables ("Encours total
    // annuel") — "Créances en retard" was the pre-T-426 mislabel.
    expect(screen.getByText("Encours total annuel")).toBeInTheDocument();
    expect(screen.getByText("Assiduité Globale")).toBeInTheDocument();
    expect(screen.getByText("94%")).toBeInTheDocument();
  });

  it("renders the revenue sparkline + month-over-month delta from the REAL series", () => {
    setup(POPULATED_DATA);
    // Nov 5.9M vs Oct 6.5M → -9% (rounded, real derivation).
    expect(screen.getByText("9%")).toBeInTheDocument();
    // The sparkline SVG is rendered for the revenue card only — the bezier
    // <path> sparkline in its fixed 92×36 viewBox (T-469: the old
    // <polyline> selector went stale when the smooth path landed).
    expect(document.querySelector('svg[width="92"]')).not.toBeNull();
    expect(document.querySelector('svg[width="92"] path')).not.toBeNull();
  });

  it("renders NO sparkline/delta when no real series exists (§15.16)", () => {
    setup(EMPTY_DATA);
    // No series → no 92×36 sparkline SVG anywhere (the rail gauge's svg is
    // a different, viewBox-only element — this selector is sparkline-only).
    expect(document.querySelector('svg[width="92"]')).toBeNull();
  });

  it("renders the hero Wave Velocity meters from the REAL installment waves (T-339)", () => {
    setup(POPULATED_DATA);
    // The staircase hero replaces the removed smooth spline.
    expect(screen.getByTestId("wave-velocity-card")).toBeInTheDocument();
    expect(screen.getByTestId("wave-meter-1")).toBeInTheDocument();
    expect(screen.getByTestId("wave-meter-2")).toBeInTheDocument();
    expect(screen.getByTestId("wave-meter-3")).toBeInTheDocument();
    // T1: 150000/200000 collected = 75% (value-based, real derivation).
    expect(screen.getByTestId("wave-meter-1").textContent).toContain("75%");
  });

  it("renders the hero's honest empty state when no tranche is billed", () => {
    setup(EMPTY_DATA, [], undefined, []);
    expect(screen.getByTestId("wave-velocity-empty")).toBeInTheDocument();
  });

  it("renders the funnel + weekly rhythm + calendar (Zone A rows 3–4)", () => {
    setup(POPULATED_DATA, [payment({ id: "a", amount: 100 })]);
    // T-469/TEST-501: the owner's "okay" rewrite renamed the card; the
    // stages now derive from the canonical triage (the WAVES fixture: one
    // family, worst tranche ~383 days → chronic) and carry the CONFIGURED
    // edges in their labels.
    expect(screen.getByText("Entonnoir de Dérive des Créances")).toBeInTheDocument();
    expect(screen.getByText("Rythme d'Encaissement Hebdomadaire")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-calendar-stub")).toBeInTheDocument();
    // Funnel stages from the canonical triage over the real installments.
    expect(screen.getByText("Débiteurs (encours > 0)")).toBeInTheDocument();
    expect(screen.getByText("En retard (échus)")).toBeInTheDocument();
    expect(screen.getByText(/Au-delà du seuil jaune — Retard 15–60 j/)).toBeInTheDocument();
    expect(screen.getByText(/Critique — Retard > 60 j/)).toBeInTheDocument();
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
    // T-469/TEST-501: the owner's "okay" rewrite renamed the gauge card.
    expect(screen.getByText("Objectif de Recouvrement")).toBeInTheDocument();
    // AI card: 20 familles en retard dont 7 critiques (> 60 j). The count
    // sits inside <strong> nodes (split text — match each element's own
    // text, never a cross-element phrase).
    expect(screen.getByText("20 familles")).toBeInTheDocument();
    expect(screen.getByText(/cumulent un retard/)).toBeInTheDocument();
    expect(screen.getByText(/7 critiques \(> 60 j\)/)).toBeInTheDocument();
    // Relance feed: the two worst families (each also named once in the AI
    // card's "Priorité haute" line — hence the plural query).
    expect(screen.getAllByText("Famille Test").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Famille Grave").length).toBeGreaterThan(0);
    expect(screen.getByText("À Relancer en Priorité")).toBeInTheDocument();
  });

  it("renders the rail's honest zero state when nothing is overdue", () => {
    setup(EMPTY_DATA);
    // T-469/TEST-501: the owner's "okay" rewrite reworded both zero states.
    expect(screen.getByText(/Recouvrement optimal/)).toBeInTheDocument();
    expect(screen.getByText(/Aucun retard enregistré/)).toBeInTheDocument();
    expect(screen.getByText("Aucun dossier en attente de relance.")).toBeInTheDocument();
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
        installments={WAVES}
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
        installments={WAVES}
        onDrillDown={() => {}}
        onGoToAlerts={onGoToAlerts}
      />,
    );
    // T-469/TEST-501: the debtor row is no longer itself a button — the
    // rail's primary CTA (and the per-row "Ouvrir le dossier" arrow) route
    // to the alerts workspace.
    const relance = screen
      .getByText("Gérer les Relances Prioritaires")
      .closest("button");
    expect(relance).toBeTruthy();
    (relance as HTMLButtonElement).click();
    expect(onGoToAlerts).toHaveBeenCalledTimes(1);
  });
});
