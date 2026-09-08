/**
 * OverviewTab — the dashboard's 3-zone analytical overview (T-243,
 * 2026-09-09).
 *
 * Source: the owner's AI-review integration blueprint — "Unified 3-Zone
 * Dashboard Architecture" (the 12-column dual-stage grid):
 *
 *   ZONE A (8 cols) — primary analytical stage:
 *     Row 1  4 tight executive sparkline KPI cards
 *     Row 2  hero macro spline (revenue trend, real series)
 *     Row 3  recovery funnel (real debtAging family counts)
 *            + weekly operating rhythm (real payments stream)
 *     Row 4  embedded operational calendar (DashboardCalendar, kept)
 *   ZONE B (4 cols) — contextual command rail:
 *     AI decision card + recovery gauge + "à relancer" feed (InsightsRail)
 *
 * T-088 (2026-08-30) lineage — the single-fetch pipeline is PRESERVED:
 * the data still arrives via one prop from the page (never fetched here),
 * and the drill-down modal receives the SAME data. The page now also
 * subscribes to the canonical payments observable once and passes it down
 * so the weekly rhythm chart reads REAL rows (the calendar already reads
 * the same stream internally).
 *
 * T-088 supersession (owner mandate, documented in UI-306): the review's
 * Tab-1 blueprint explicitly places a PRIMARY TREND CARD on the overview
 * (the "Flux Financiers & Recouvrements" spline). T-088 had removed the
 * overview's revenue BAR chart as a duplicate of the drill-down's Revenue
 * tab; the owner's blueprint restores a TREND view on the overview while
 * the drill-down keeps the DETAIL view (bar + per-month breakdown +
 * departments pie). Demographics/debt-aging detail charts stay
 * drill-down-ONLY — exactly where the review's own §5 also puts them.
 *
 * Data honesty (§15.16, documented in UI-306): every number rendered here
 * comes from the repository contract — kpis, the revenue series, the
 * debt-aging buckets, topDebtors, and the payments stream. No component
 * synthesizes trends, deltas, funnel stages or targets. Cards without a
 * real series render without a sparkline/delta badge.
 */
import { useTranslation } from "react-i18next";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { SparklineKpiCard } from "../components/sparkline-kpi-card";
import { RecoveryFunnelCard, deriveRecoveryFunnel } from "../components/recovery-funnel-card";
import { WeeklyOperatingRhythm } from "../components/weekly-operating-rhythm";
import { InsightsRail } from "../components/insights-rail";
import { DashboardCalendar } from "../dashboard-calendar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { DASHBOARD_THEME, chartPalette } from "../../../shared/ui/dashboard-theme";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
} from "../../../domain/model/operations";
import type { DebtSummary, Payment } from "../../../domain/model/payment";
import { formatDzd, formatDzdPlain } from "../../../core/format/currency";
import type { Demographics } from "./types";

/** Dashboard data passed down from the page (single source of truth). */
export interface DashboardData {
  kpis: DashboardKpi | null;
  revenue: RevenuePoint[];
  debtAging: DebtByAgingBucket[];
  demographics: Demographics;
  topDebtors: DebtSummary[];
}

export function OverviewTab({
  data,
  payments,
  range,
  onDrillDown,
  onGoToAlerts,
}: {
  data: DashboardData;
  /**
   * T-243: the canonical payments stream (one page-level subscription —
   * the same observable the calendar reads). Feeds the weekly rhythm
   * chart with REAL rows; never re-fetched here. Separate prop so the
   * page's aggregate fetch effect never re-runs on stream updates.
   */
  payments: readonly Payment[];
  /** The academic-year date range the KPIs/revenue were loaded for. */
  range?: { from: string; to: string };
  onDrillDown: (kpi: string) => void;
  onGoToAlerts: () => void;
}) {
  const { t } = useTranslation();
  const { kpis, revenue, debtAging, topDebtors } = data;

  // ---- REAL derivations (pure, from the repository contract) --------
  // Annual revenue for the loaded period (Σ of the monthly series).
  const annualRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  // Month-over-month delta + sparkline series — only when a REAL series
  // of at least two points exists (§15.16: no fabricated trends).
  const trendSeries = revenue.length >= 2 ? revenue.map((r) => r.amount) : undefined;
  const last = revenue.length >= 2 ? revenue[revenue.length - 1] : null;
  const prev = revenue.length >= 2 ? revenue[revenue.length - 2] : null;
  const momDelta =
    last && prev && prev.amount > 0
      ? Math.round(((last.amount - prev.amount) / prev.amount) * 100)
      : undefined;
  // Recovery funnel — family counts per aging bucket (debtAging).
  const funnelStages = deriveRecoveryFunnel(debtAging);
  // Rail figures — overdue family census from the aging stream.
  const overdueFamilies = debtAging.reduce((s, b) => s + b.debtorCount, 0);
  const deepOverdueFamilies =
    (debtAging.find((b) => b.bucket === "61_90")?.debtorCount ?? 0) +
    (debtAging.find((b) => b.bucket === "91_180")?.debtorCount ?? 0) +
    (debtAging.find((b) => b.bucket === "180_plus")?.debtorCount ?? 0);
  const outstanding = kpis?.outstandingDebt ?? 0;

  return (
    /* 12-column dual-stage grid — base template declared (t-205/UI-300). */
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-6">
      {/* ================================================================= */}
      {/* ZONE A: PRIMARY ANALYTICAL STAGE (8 columns)                      */}
      {/* ================================================================= */}
      <div className="lg:col-span-8 space-y-4">
        {/* Row 1 — tight executive sparkline KPI cards (review's 4 slots).
            Only the revenue card carries a sparkline + delta: it is the
            only metric with a REAL series in the contract (§15.16). */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SparklineKpiCard
            label={t("dashboard.kpi.totalStudents")}
            value={kpis ? String(kpis.totalStudents) : "—"}
            subValue={kpis ? `${kpis.totalParents} fam.` : undefined}
            tone="primary"
            gradientKey="students"
            onClick={() => onDrillDown("students")}
          />
          <SparklineKpiCard
            label={t("dashboard.kpi.monthlyRevenue")}
            value={kpis ? formatDzd(kpis.monthlyRevenue, { compact: true }) : "—"}
            deltaPercent={momDelta}
            trend={trendSeries}
            tone="success"
            gradientKey="monthly-revenue"
            onClick={() => onDrillDown("monthlyRevenue")}
          />
          <SparklineKpiCard
            label={t("dashboard.kpi.outstandingDebt")}
            value={kpis ? formatDzd(outstanding, { compact: true }) : "—"}
            subValue={
              debtAging.length > 0
                ? `${overdueFamilies} fam. en retard`
                : undefined
            }
            tone="danger"
            gradientKey="outstanding-debt"
            onClick={() => onDrillDown("outstandingDebt")}
          />
          <SparklineKpiCard
            label="Assiduité (aujourd'hui)"
            value={kpis ? `${Math.round(kpis.attendanceRateToday * 100)}%` : "—"}
            tone="primary"
            gradientKey="attendance-today"
            onClick={() => onDrillDown("staff")}
          />
        </div>

        {/* Row 2 — hero macro spline (review's Primary Trend Card). The
            trend view lives here; the DETAIL view (bars + breakdown)
            stays in the drill-down's Revenue tab. */}
        <Card className="border-border bg-surface-panel">
          <CardHeader className="py-2.5 px-4 border-b border-border/50 flex flex-row items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Flux Financiers &amp; Recouvrements
              </CardTitle>
              <CardDescription className="text-xs text-foreground">
                Tendance mensuelle des encaissements (DZD) sur la période
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground shrink-0">
              <span className="flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: chartPalette.primary }}
                />{" "}
                Encaissé
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-3">
            {revenue.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-16">
                Aucun encaissement enregistré sur la période sélectionnée.
              </p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenue} margin={{ top: 10, right: 10, bottom: 0, left: -15 }}>
                    <defs>
                      <linearGradient id="revenueCurveFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartPalette.primary} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={chartPalette.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={DASHBOARD_THEME.gridStroke}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      {...DASHBOARD_THEME.axisTick}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      {...DASHBOARD_THEME.axisTick}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `${Math.round(Number(v) / 1000)}k`}
                    />
                    <Tooltip
                      contentStyle={DASHBOARD_THEME.tooltipStyle}
                      formatter={(val: number) => [
                        `${formatDzdPlain(val)} DZD`,
                        "Encaissé",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke={chartPalette.primary}
                      strokeWidth={2.5}
                      fill="url(#revenueCurveFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Row 3 — conversion pipeline + weekly rhythm (50/50 split). */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <RecoveryFunnelCard stages={funnelStages} />
          <WeeklyOperatingRhythm payments={payments} range={range} />
        </div>

        {/* Row 4 — embedded operational activity calendar (kept from
            T-088: the "what happened today" view, not duplicated). */}
        <DashboardCalendar />
      </div>

      {/* ================================================================= */}
      {/* ZONE B: CONTEXTUAL COMMAND RAIL (4 columns)                       */}
      {/* ================================================================= */}
      <div className="lg:col-span-4">
        <InsightsRail
          achieved={annualRevenue}
          outstanding={outstanding}
          overdueFamilies={overdueFamilies}
          deepOverdueFamilies={deepOverdueFamilies}
          topDebtors={topDebtors}
          onNavigateAlerts={onGoToAlerts}
        />
      </div>
    </div>
  );
}
