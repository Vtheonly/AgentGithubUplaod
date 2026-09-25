// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/tabs/overview-tab.tsx
// ============================================================================

/**
 * OverviewTab — executive operational overview.
 *
 * Every visible dashboard widget is a first-class layout item. The layout
 * editor owns only presentation state; all existing data and business logic
 * remain unchanged.
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
import { deriveTrancheWaves, deriveDebtTriage } from "../components/analytics/executive-statistics";
import type { DashboardKpi, RevenuePoint, DebtByAgingBucket } from "../../../domain/model/operations";
import type { DebtSummary, Payment, Installment } from "../../../domain/model/payment";
import { formatDzd } from "../../../core/format/currency";
import { DashboardLayoutEditor, type DashboardLayoutItem } from "../dashboard-layout-editor";
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
  editing = false,
}: {
  data: DashboardData;
  payments: readonly Payment[];
  installments: readonly Installment[];
  range?: { from: string; to: string };
  onDrillDown: (kpi: string) => void;
  onGoToAlerts: () => void;
  /** Optional since the T-404 packaging-gate typecheck repair (2026-09-22). */
  editing?: boolean;
}) {
  const { t } = useTranslation();
  const { kpis, revenue, debtAging, topDebtors } = data;

  const nowEpochMs = Date.now();
  const waves = deriveTrancheWaves(installments, nowEpochMs);
  const triage = deriveDebtTriage(installments, nowEpochMs);
  const chronicAmount = triage.buckets.find((b) => b.bucket === "chronic")?.amount ?? 0;
  const chronicFamilies = triage.buckets.find((b) => b.bucket === "chronic")?.familyCount ?? 0;
  const annualRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const trendSeries = revenue.length >= 2 ? revenue.map((r) => r.amount) : undefined;
  const last = revenue.length >= 2 ? revenue[revenue.length - 1] : null;
  const prev = revenue.length >= 2 ? revenue[revenue.length - 2] : null;
  const momDelta = last && prev && prev.amount > 0 ? Math.round(((last.amount - prev.amount) / prev.amount) * 100) : undefined;
  const funnelStages = deriveRecoveryFunnel(debtAging);
  const overdueFamilies = debtAging.reduce((s, b) => s + b.debtorCount, 0);
  const deepOverdueFamilies =
    (debtAging.find((b) => b.bucket === "61_90")?.debtorCount ?? 0) +
    (debtAging.find((b) => b.bucket === "91_180")?.debtorCount ?? 0) +
    (debtAging.find((b) => b.bucket === "180_plus")?.debtorCount ?? 0);
  const outstanding = kpis?.outstandingDebt ?? 0;

  const items: DashboardLayoutItem[] = [
    {
      id: "kpi-students",
      label: "Élèves / foyers",
      x: 0,
      y: 0,
      w: 3,
      h: 4,
      minW: 2,
      maxW: 6,
      minH: 3,
      maxH: 8,
      content: (
        <SparklineKpiCard
          label={t("dashboard.kpi.totalStudents")}
          value={kpis ? String(kpis.totalStudents) : "—"}
          subValue={kpis ? `${kpis.totalParents} foyers` : undefined}
          tone="primary"
          gradientKey="students"
          onClick={() => onDrillDown("students")}
        />
      ),
    },
    {
      id: "kpi-revenue",
      label: "Chiffre d’affaires mensuel",
      x: 3,
      y: 0,
      w: 3,
      h: 4,
      minW: 2,
      maxW: 6,
      minH: 3,
      maxH: 8,
      content: (
        <SparklineKpiCard
          label={t("dashboard.kpi.monthlyRevenue")}
          value={kpis ? formatDzd(kpis.monthlyRevenue, { compact: true }) : "—"}
          deltaPercent={momDelta}
          trend={trendSeries}
          tone="success"
          gradientKey="monthly-revenue"
          onClick={() => onDrillDown("monthlyRevenue")}
        />
      ),
    },
    {
      id: "kpi-debt",
      label: "Créances ouvertes",
      x: 6,
      y: 0,
      w: 3,
      h: 4,
      minW: 2,
      maxW: 6,
      minH: 3,
      maxH: 8,
      content: (
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
      ),
    },
    {
      id: "kpi-attendance",
      label: "Assiduité globale",
      x: 9,
      y: 0,
      w: 3,
      h: 4,
      minW: 2,
      maxW: 6,
      minH: 3,
      maxH: 8,
      content: (
        <SparklineKpiCard
          label="Assiduité Globale"
          value={kpis ? `${Math.round(kpis.attendanceRateToday * 100)}%` : "—"}
          tone="primary"
          gradientKey="attendance-today"
          onClick={() => onDrillDown("staff")}
        />
      ),
    },
    {
      id: "wave-velocity",
      label: "Vitesse des tranches",
      x: 0,
      y: 5,
      w: 8,
      h: 8,
      minW: 5,
      maxW: 12,
      minH: 6,
      maxH: 16,
      content: <WaveVelocityCard waves={waves} variant="hero" />,
    },
    {
      id: "recovery-funnel",
      label: "Funnel de recouvrement",
      x: 8,
      y: 5,
      w: 4,
      h: 8,
      minW: 3,
      maxW: 12,
      minH: 6,
      maxH: 16,
      content: <RecoveryFunnelCard stages={funnelStages} />,
    },
    {
      id: "weekly-rhythm",
      label: "Rythme hebdomadaire",
      x: 0,
      y: 14,
      w: 4,
      h: 8,
      minW: 3,
      maxW: 12,
      minH: 6,
      maxH: 16,
      content: <WeeklyOperatingRhythm payments={payments} range={range} />,
    },
    {
      id: "calendar",
      label: "Calendrier opérationnel",
      x: 4,
      y: 14,
      w: 8,
      h: 8,
      minW: 4,
      maxW: 12,
      // h: 8 is the collision-free budget: the row below (insights, y=23)
      // starts right after this widget, and the calendar's own sheet must
      // fit in the 8 rows × 32px + 12px gaps box without spilling into it.
      minH: 8,
      maxH: 20,
      content: <DashboardCalendar />,
    },
    {
      id: "insights",
      label: "Rail contextuel",
      x: 0,
      y: 23,
      w: 12,
      h: 7,
      minW: 4,
      maxW: 12,
      minH: 5,
      maxH: 20,
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
      <DashboardLayoutEditor storageKey="overview" items={items} editing={editing} />
    </div>
  );
}
