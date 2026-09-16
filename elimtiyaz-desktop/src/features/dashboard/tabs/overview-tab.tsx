// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/tabs/overview-tab.tsx
// ============================================================================

/**
 * OverviewTab — The 3-Zone Executive Operational Overview.
 *
 * Architecture:
 *   Zone A (8 cols):
 *     Row 1: 4 Sparkline KPI Cards
 *     Row 2: Wave Velocity Milestone Cockpit
 *     Row 3: Recovery Funnel + Weekly Rhythm
 *     Row 4: Operational Calendar
 *   Zone B (4 cols):
 *     Insights Rail (Smart Copilot + Recovery Gauge + Priority Relances)
 */

import { useTranslation } from "react-i18next";
import { SparklineKpiCard } from "../components/sparkline-kpi-card";
import {
  RecoveryFunnelCard,
  deriveRecoveryFunnel,
} from "../components/recovery-funnel-card";
import { WeeklyOperatingRhythm } from "../components/weekly-operating-rhythm";
import { InsightsRail } from "../components/insights-rail";
import { DashboardCalendar } from "../dashboard-calendar";
import { WaveVelocityCard } from "../components/analytics/executive-cards";
import {
  deriveTrancheWaves,
  deriveDebtTriage,
} from "../components/analytics/executive-statistics";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
} from "../../../domain/model/operations";
import type {
  DebtSummary,
  Payment,
  Installment,
} from "../../../domain/model/payment";
import { formatDzd } from "../../../core/format/currency";
import type { Demographics } from "./types";

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
  payments: readonly Payment[];
  installments: readonly Installment[];
  range?: { from: string; to: string };
  onDrillDown: (kpi: string) => void;
  onGoToAlerts: () => void;
}) {
  const { t } = useTranslation();
  const { kpis, revenue, debtAging, topDebtors } = data;

  const nowEpochMs = Date.now();
  const waves = deriveTrancheWaves(installments, nowEpochMs);
  const triage = deriveDebtTriage(installments, nowEpochMs);
  const chronicAmount =
    triage.buckets.find((b) => b.bucket === "chronic")?.amount ?? 0;
  const chronicFamilies =
    triage.buckets.find((b) => b.bucket === "chronic")?.familyCount ?? 0;

  const annualRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const trendSeries =
    revenue.length >= 2 ? revenue.map((r) => r.amount) : undefined;
  const last = revenue.length >= 2 ? revenue[revenue.length - 1] : null;
  const prev = revenue.length >= 2 ? revenue[revenue.length - 2] : null;
  const momDelta =
    last && prev && prev.amount > 0
      ? Math.round(((last.amount - prev.amount) / prev.amount) * 100)
      : undefined;

  const funnelStages = deriveRecoveryFunnel(debtAging);
  const overdueFamilies = debtAging.reduce((s, b) => s + b.debtorCount, 0);
  const deepOverdueFamilies =
    (debtAging.find((b) => b.bucket === "61_90")?.debtorCount ?? 0) +
    (debtAging.find((b) => b.bucket === "91_180")?.debtorCount ?? 0) +
    (debtAging.find((b) => b.bucket === "180_plus")?.debtorCount ?? 0);
  const outstanding = kpis?.outstandingDebt ?? 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-8">
      {/* ZONE A: PRIMARY ANALYTICAL STAGE (8 COLS) */}
      <div className="lg:col-span-8 space-y-4">
        {/* Row 1: Sparkline KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SparklineKpiCard
            label={t("dashboard.kpi.totalStudents")}
            value={kpis ? String(kpis.totalStudents) : "—"}
            subValue={kpis ? `${kpis.totalParents} foyers` : undefined}
            tone="primary"
            gradientKey="students"
            onClick={() => onDrillDown("students")}
          />
          <SparklineKpiCard
            label={t("dashboard.kpi.monthlyRevenue")}
            value={
              kpis ? formatDzd(kpis.monthlyRevenue, { compact: true }) : "—"
            }
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
              chronicAmount > 0
                ? `${formatDzd(chronicAmount, { compact: true })} urgents (${chronicFamilies} f.)`
                : debtAging.length > 0
                  ? `${overdueFamilies} f. en retard`
                  : undefined
            }
            tone="danger"
            gradientKey="outstanding-debt"
            onClick={() => onDrillDown("outstandingDebt")}
          />
          <SparklineKpiCard
            label="Assiduité Globale"
            value={
              kpis ? `${Math.round(kpis.attendanceRateToday * 100)}%` : "—"
            }
            tone="primary"
            gradientKey="attendance-today"
            onClick={() => onDrillDown("staff")}
          />
        </div>

        {/* Row 2: Milestone Wave Velocity */}
        <WaveVelocityCard waves={waves} variant="hero" />

        {/* Row 3: Funnel & Weekly Rhythm */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RecoveryFunnelCard stages={funnelStages} />
          <WeeklyOperatingRhythm payments={payments} range={range} />
        </div>

        {/* Row 4: Operational Calendar */}
        <DashboardCalendar />
      </div>

      {/* ZONE B: CONTEXTUAL COMMAND RAIL (4 COLS) */}
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
