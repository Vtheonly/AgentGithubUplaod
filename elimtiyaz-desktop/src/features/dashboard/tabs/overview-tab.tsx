// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/tabs/overview-tab.tsx
// ============================================================================

/**
 * OverviewTab — The executive operational overview.
 *
 * The dashboard widgets keep their existing data and business logic. The
 * layout editor only controls presentation order and widget dimensions.
 */

import { LayoutDashboard } from "lucide-react";
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
import { DashboardLayoutEditor } from "../dashboard-layout-editor";
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
  editing,
  onEditingChange,
}: {
  data: DashboardData;
  payments: readonly Payment[];
  installments: readonly Installment[];
  range?: { from: string; to: string };
  onDrillDown: (kpi: string) => void;
  onGoToAlerts: () => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
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

  const items = [
    {
      id: "kpis",
      label: "Indicateurs clés",
      w: 12,
      h: 1,
      minW: 6,
      maxW: 12,
      content: (
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
            value={kpis ? `${Math.round(kpis.attendanceRateToday * 100)}%` : "—"}
            tone="primary"
            gradientKey="attendance-today"
            onClick={() => onDrillDown("staff")}
          />
        </div>
      ),
    },
    {
      id: "wave-velocity",
      label: "Vitesse des tranches",
      w: 8,
      h: 2,
      minW: 6,
      maxW: 12,
      minH: 1,
      maxH: 3,
      content: <WaveVelocityCard waves={waves} variant="hero" />,
    },
    {
      id: "recovery-funnel",
      label: "Funnel de recouvrement",
      w: 4,
      h: 2,
      minW: 3,
      maxW: 12,
      minH: 1,
      maxH: 3,
      content: <RecoveryFunnelCard stages={funnelStages} />,
    },
    {
      id: "weekly-rhythm",
      label: "Rythme hebdomadaire",
      w: 4,
      h: 2,
      minW: 3,
      maxW: 12,
      minH: 1,
      maxH: 3,
      content: <WeeklyOperatingRhythm payments={payments} range={range} />,
    },
    {
      id: "calendar",
      label: "Calendrier opérationnel",
      w: 8,
      h: 2,
      minW: 4,
      maxW: 12,
      minH: 1,
      maxH: 4,
      content: <DashboardCalendar />,
    },
    {
      id: "insights",
      label: "Rail contextuel",
      w: 4,
      h: 2,
      minW: 3,
      maxW: 12,
      minH: 1,
      maxH: 4,
      content: (
        <InsightsRail
          achieved={annualRevenue}
          outstanding={outstanding}
          overdueFamilies={overdueFamilies}
          deepOverdueFamilies={deepOverdueFamilies}
          topDebtors={topDebtors}
          onNavigateAlerts={onGoToAlerts}
        />
      ),
    },
  ];

  return (
    <div className="pb-8">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <LayoutDashboard className="h-3.5 w-3.5" />
        <span>Vue opérationnelle personnalisable</span>
      </div>

      <DashboardLayoutEditor
        storageKey="overview"
        items={items}
        editing={editing}
        onSave={() => onEditingChange(false)}
      />
    </div>
  );
}
