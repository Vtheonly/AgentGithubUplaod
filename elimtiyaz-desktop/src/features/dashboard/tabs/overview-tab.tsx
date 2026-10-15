// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/tabs/overview-tab.tsx
// ============================================================================

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
import {
  derivePooledTrancheWaves,
  deriveNonWaveSummary,
} from "../../../domain/calc/payment/tranche-waves";
import type { DebtAgingThresholds } from "../../../domain/calc/ledger/debt-aging";
import {
  ThresholdsConfigTrigger,
  type ThresholdsConfigApi,
  type ThresholdsConfigScope,
} from "../../settings/contextual-thresholds-config";
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

const WAVE_METER_SCOPE: ThresholdsConfigScope = {
  title: "Vagues de tranches",
  params: ["gracePeriodDays"],
  hint: "Les compteurs « En retard / À échoir » de ce composant suivent le délai de grâce configuré.",
};
const RECOVERY_FUNNEL_SCOPE: ThresholdsConfigScope = {
  title: "Entonnoir de recouvrement",
  params: [
    "gracePeriodDays",
    "yellowDays",
    "redDays",
    "amountYellowDzd",
    "amountRedDzd",
  ],
  hint: "L’escalade des phases suit la hiérarchie de seuils en jours configurée ; les bandes de montant par foyer suivent les seuils DZD configurés.",
};

export function OverviewTab({
  data,
  payments,
  installments,
  range,
  onDrillDown,
  onGoToAlerts,
  editing = false,
  debtThresholds,
  thresholdsConfig,
}: {
  data: DashboardData;
  payments: readonly Payment[];
  installments: readonly Installment[];
  range?: { from: string; to: string };
  onDrillDown: (kpi: string) => void;
  onGoToAlerts: () => void;
  editing?: boolean;
  debtThresholds?: DebtAgingThresholds;
  thresholdsConfig?: ThresholdsConfigApi | null;
}) {
  const { t } = useTranslation();
  const { kpis, revenue, debtAging, topDebtors } = data;

  const nowEpochMs = Date.now();
  const waves = deriveTrancheWaves(installments, nowEpochMs, debtThresholds);
  const pooledWaves = derivePooledTrancheWaves(installments, nowEpochMs, debtThresholds);
  const nonWaveSummary = deriveNonWaveSummary(installments, nowEpochMs, debtThresholds);
  const triage = deriveDebtTriage(installments, nowEpochMs, debtThresholds);
  const chronicAmount = triage.buckets.find((b) => b.bucket === "chronic")?.amount ?? 0;
  const chronicFamilies = triage.buckets.find((b) => b.bucket === "chronic")?.familyCount ?? 0;
  const annualRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const trendSeries = revenue.length >= 2 ? revenue.map((r) => r.amount) : undefined;
  const last = revenue.length >= 2 ? revenue[revenue.length - 1] : null;
  const prev = revenue.length >= 2 ? revenue[revenue.length - 2] : null;
  const momDelta = last && prev && prev.amount > 0 ? Math.round(((last.amount - prev.amount) / prev.amount) * 100) : undefined;
  const funnelStages = deriveRecoveryFunnel(triage);
  const overdueFamilies = debtAging.reduce((s, b) => s + b.debtorCount, 0);
  const deepOverdueFamilies =
    (debtAging.find((b) => b.bucket === "61_90")?.debtorCount ?? 0) +
    (debtAging.find((b) => b.bucket === "91_180")?.debtorCount ?? 0) +
    (debtAging.find((b) => b.bucket === "180_plus")?.debtorCount ?? 0);
  const outstanding = kpis?.outstandingDebt ?? 0;
  const overdueNow = kpis?.overdueAmount ?? 0;

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
          tip="overview.students"
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
          tip="overview.revenue"
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
      label: "Encours total annuel",
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
          tip="overview.debt"
          value={kpis ? formatDzd(outstanding, { compact: true }) : "—"}
          subValue={
            overdueNow > 0
              ? `${formatDzd(overdueNow, { compact: true })} en retard · ${overdueFamilies} f.`
              : chronicAmount > 0
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
          tip="overview.attendance"
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
      h: 12,
      minW: 5,
      maxW: 12,
      minH: 10,
      maxH: 22,
      content: (
        <WaveVelocityCard
          waves={waves}
          pooled={pooledWaves}
          nonWave={nonWaveSummary}
          nowEpochMs={nowEpochMs}
          variant="hero"
          headerActions={
            <ThresholdsConfigTrigger scope={WAVE_METER_SCOPE} config={thresholdsConfig} />
          }
        />
      ),
    },
    {
      id: "recovery-funnel",
      label: "Funnel de recouvrement",
      x: 8,
      y: 5,
      w: 4,
      h: 12,
      minW: 3,
      maxW: 12,
      minH: 8,
      maxH: 22,
      content: (
        <RecoveryFunnelCard
          stages={funnelStages}
          installments={installments}
          debtThresholds={debtThresholds}
          headerActions={
            <ThresholdsConfigTrigger scope={RECOVERY_FUNNEL_SCOPE} config={thresholdsConfig} />
          }
        />
      ),
    },
    {
      id: "weekly-rhythm",
      label: "Rythme hebdomadaire",
      x: 0,
      y: 18,
      w: 4,
      h: 10,
      minW: 3,
      maxW: 12,
      minH: 8,
      maxH: 18,
      content: <WeeklyOperatingRhythm payments={payments} range={range} />,
    },
    {
      id: "calendar",
      label: "Calendrier opérationnel",
      x: 4,
      y: 18,
      w: 8,
      h: 10,
      minW: 4,
      maxW: 12,
      minH: 8,
      maxH: 22,
      content: <DashboardCalendar />,
    },
    {
      id: "insights",
      label: "Rail contextuel",
      x: 0,
      y: 29,
      w: 12,
      h: 14,
      minW: 4,
      maxW: 12,
      minH: 10,
      maxH: 26,
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