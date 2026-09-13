/**
 * OverviewTab — the dashboard's 3-zone analytical overview (T-243,
 * 2026-09-09).
 *
 * T-339 (61st session, 2026-09-14 — STATS-400): the hero macro SPLINE
 * (the smooth 12-month revenue curve) was REMOVED per the owner's vanity
 * kill list — school revenue is a STAIRCASE of three seasonal waves
 * (Sept / Déc / Mars), and a smooth curve over the quiet months causes
 * fake panic. The hero is now the WaveVelocityCard (the tranche-wave
 * collection meters vs the invoiced targets) computed from the canonical
 * installments stream by deriveTrancheWaves. The debt KPI is
 * contextualized the same way: the raw outstanding number now carries
 * its chronic (> 45 j) share from the debt-triage derivation, so a new
 * billing cycle no longer reads as bad debt.
 *
 * Source: the owner's AI-review integration blueprint — "Unified 3-Zone
 * Dashboard Architecture" (the 12-column dual-stage grid):
 *
 *   ZONE A (8 cols) — primary analytical stage:
 *     Row 1  4 tight executive sparkline KPI cards
 *     Row 2  hero Wave Velocity (tranche collection meters — the staircase)
 *     Row 3  recovery funnel (real debtAging family counts)
 *            + weekly operating rhythm (real payments stream)
 *     Row 4  embedded operational calendar (DashboardCalendar, kept)
 *   ZONE B (4 cols) — contextual command rail:
 *     AI decision card + recovery gauge + "à relancer" feed (InsightsRail)
 *
 * T-088 (2026-08-30) lineage — the single-fetch pipeline is PRESERVED:
 * the data still arrives via one prop from the page (never fetched here).
 *
 * Data honesty (§15.16, documented in UI-306): every number rendered here
 * comes from the repository contract — kpis, the revenue series, the
 * debt-aging buckets, topDebtors, the payments stream, and (T-339) the
 * installments stream. No component synthesizes trends, deltas, funnel
 * stages or targets. Cards without a real series render without a
 * sparkline/delta badge.
 */
import { useTranslation } from "react-i18next";
import { SparklineKpiCard } from "../components/sparkline-kpi-card";
import { RecoveryFunnelCard, deriveRecoveryFunnel } from "../components/recovery-funnel-card";
import { WeeklyOperatingRhythm } from "../components/weekly-operating-rhythm";
import { InsightsRail } from "../components/insights-rail";
import { DashboardCalendar } from "../dashboard-calendar";
import { WaveVelocityCard } from "../components/analytics/executive-cards";
import { deriveTrancheWaves, deriveDebtTriage } from "../components/analytics/executive-statistics";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
} from "../../../domain/model/operations";
import type { DebtSummary, Payment, Installment } from "../../../domain/model/payment";
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
  installments,
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
  /**
   * T-339: the canonical installments stream — feeds the Wave Velocity
   * hero (deriveTrancheWaves) and the debt KPI's chronic-share
   * contextualization (deriveDebtTriage). Same page-level subscription
   * pattern as the payments stream.
   */
  installments: readonly Installment[];
  /** The academic-year date range the KPIs/revenue were loaded for. */
  range?: { from: string; to: string };
  onDrillDown: (kpi: string) => void;
  onGoToAlerts: () => void;
}) {
  const { t } = useTranslation();
  const { kpis, revenue, debtAging, topDebtors } = data;

  // ---- REAL derivations (pure, from the repository contract) --------
  // T-339: the wave staircase + the debt triage from the installments
  // stream (executive-statistics.ts — the ONE canonical derivation).
  const nowEpochMs = Date.now();
  const waves = deriveTrancheWaves(installments, nowEpochMs);
  const triage = deriveDebtTriage(installments, nowEpochMs);
  const chronicAmount = triage.buckets.find((b) => b.bucket === "chronic")?.amount ?? 0;
  const chronicFamilies = triage.buckets.find((b) => b.bucket === "chronic")?.familyCount ?? 0;
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
              // T-339: the raw debt number now carries its CHRONIC share
              // (> 45 j) — the actionable split that separates bad debt
              // from the current billing cycle.
              chronicAmount > 0
                ? `${formatDzd(chronicAmount, { compact: true })} critiques > 45 j · ${chronicFamilies} fam.`
                : debtAging.length > 0
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

        {/* Row 2 — the hero Wave Velocity meters (T-339: the spline was
            REMOVED — the staircase of the three seasonal waves vs their
            invoiced targets is the real revenue picture). The DETAIL view
            (per-month bars + breakdown) stays in the drill-down's Revenue
            tab. */}
        <WaveVelocityCard waves={waves} variant="hero" />

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
