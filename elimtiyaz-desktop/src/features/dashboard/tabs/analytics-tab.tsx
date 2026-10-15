// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/tabs/analytics-tab.tsx
// ============================================================================

import { useMemo, useState, useCallback } from "react";
import { Search, BarChart3, Gauge } from "lucide-react";
import type { RevenuePoint, DebtByAgingBucket } from "../../../domain/model/operations";
import type {
  Payment,
  PaymentMethod,
  PaymentCategory,
  DebtSummary,
  Installment,
} from "../../../domain/model/payment";
import { PAYMENT_CATEGORY_LABELS_FR } from "../../../domain/model/payment";
import type { DebtAgingThresholds } from "../../../domain/calc/ledger/debt-aging";
import {
  ThresholdsConfigTrigger,
  type ThresholdsConfigApi,
  type ThresholdsConfigScope,
} from "../../settings/contextual-thresholds-config";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { parentDisplayName } from "../../../domain/model/parent";
import {
  applyAnalyticsFilters,
  presentCategories,
  deriveOutstandingDebt,
  NO_ANALYTICS_FILTERS,
  type AnalyticsFilterState,
} from "../components/analytics/analytics-derivations";
import {
  deriveDiscountErosion,
  deriveTrancheWaves,
  deriveDebtTriage,
  deriveFamilyConcentration,
  deriveTransportYield,
  deriveServiceYield,
  deriveEnrollmentDynamics,
  deriveTripleRiskSummary,
  derivePayrollCostTrend,
  SERVICE_CATEGORIES,
} from "../components/analytics/executive-statistics";
import {
  derivePooledTrancheWaves,
  deriveNonWaveSummary,
} from "../../../domain/calc/payment/tranche-waves";
import {
  WaveVelocityCard,
  DiscountErosionCard,
  DebtTriageCard,
  FamilyConcentrationCard,
  TransportYieldCard,
  ServiceYieldCard,
  EnrollmentDynamicsCard,
  TripleRiskSummaryCard,
} from "../components/analytics/executive-cards";
import { AnalyticsSlicers } from "../components/analytics/analytics-slicers";
import { StatStrip } from "../components/analytics/stat-strip";
import { MethodMixCard, CategoryMixCard } from "../components/analytics/mix-cards";
import { YoYComparisonCard } from "../components/analytics/yoy-comparison-card";
import { AgingCompositionCard } from "../components/analytics/aging-composition-card";
import { DebtorsParetoCard } from "../components/analytics/debtors-pareto-card";
import { PayrollCostTrendCard } from "../components/analytics/payroll-cost-trend-card";
import { computePayrollForecast } from "../../../domain/calc/payroll/payroll-forecast";
import {
  evaluateStudentRiskProfiles,
  type StudentRiskProfile,
} from "../components/analytics/operational-query-engine";
import { OperationalQueryConsole } from "../components/analytics/operational-query-console";
import {
  DataInspectorProvider,
  InspectTrigger,
  type InspectRequest,
} from "../components/analytics/data-inspector";
import { DashboardLayoutEditor, type DashboardLayoutItem } from "../dashboard-layout-editor";
import { InfoTip } from "../components/analytics/info-tip";

const ALL_METHODS: PaymentMethod[] = ["cash", "check", "transfer"];
type ViewMode = "pilotage" | "diagnostic" | "charts";

export interface AnalyticsTabProps {
  revenue: RevenuePoint[];
  prevRevenue: RevenuePoint[];
  academicYear: string;
  prevAcademicYear: string | null;
  debtAging: DebtByAgingBucket[];
  topDebtors: DebtSummary[];
  debtSummaries?: readonly DebtSummary[];
  payments: readonly Payment[];
  installments?: readonly Installment[];
  range?: { from: string; to: string };
  onOpenParent?: (parentId: string) => void;
  editing?: boolean;
  debtThresholds?: DebtAgingThresholds;
  thresholdsConfig?: ThresholdsConfigApi | null;
}

const WAVE_METER_SCOPE: ThresholdsConfigScope = {
  title: "Vagues de tranches",
  params: ["gracePeriodDays"],
  hint: "Les compteurs « En retard / À échoir » de ce composant suivent le délai de grâce configuré.",
};
const DEBT_TRIAGE_SCOPE: ThresholdsConfigScope = {
  title: "Triage des créances",
  params: ["gracePeriodDays", "yellowDays", "redDays"],
  hint: "La ventilation par degré d'urgence et la file d'appel suivent la hiérarchie de seuils en jours configurée.",
};
const OPERATIONAL_CONSOLE_SCOPE: ThresholdsConfigScope = {
  title: "Console d'Investigation",
  params: ["severeDebtDzd"],
  hint: "La requête rapide « Créances Critiques » suit ce seuil (encours familial configuré).",
};

export function AnalyticsTab({
  revenue,
  prevRevenue,
  academicYear,
  prevAcademicYear,
  debtAging,
  topDebtors,
  debtSummaries,
  payments,
  installments: installmentsProp,
  range,
  onOpenParent,
  editing = false,
  debtThresholds,
  thresholdsConfig,
}: AnalyticsTabProps) {
  const repos = useRepositories();
  const students = useObservable(() => repos.students.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const subjectConfigurations = useObservable(
    () => repos.subjects.observeConfigurations(),
    [],
  );
  const assessments = useObservable(() => repos.grades.observeAll(), []);
  const attendance = useObservable(
    () =>
      repos.attendance.observeAll(
        range?.from ?? "2020-01-01",
        range?.to ?? "2030-12-31",
      ),
    [range?.from, range?.to],
  );
  const internalInstallments = useObservable(() => repos.installments.observe(), []);
  const installments = installmentsProp ?? internalInstallments;
  const internalDebtThresholds = useObservable(() => repos.debt.observeThresholds(), []);
  const debtThresholdsActive = debtThresholds ?? internalDebtThresholds;
  const ledger = useObservable(() => repos.ledger.observe(), []);

  const payrollPersonnel = useObservable(
    () =>
      repos.personnel?.observe?.() ?? {
        subscribe: () => () => {},
        get: () => [],
      },
    [],
  );
  const salaryPayments = useObservable(
    () =>
      repos.personnel?.observeSalaryPayments?.() ?? {
        subscribe: () => () => {},
        get: () => [],
      },
    [],
  );

  const [viewMode, setViewMode] = useState<ViewMode>("pilotage");
  const [filters, setFilters] = useState<AnalyticsFilterState>(NO_ANALYTICS_FILTERS);
  const [consoleCategory, setConsoleCategory] = useState<string>("all");

  const riskDebt = debtSummaries ?? topDebtors;

  const parentNameMap = useMemo(
    () => new Map(parents.map((p) => [p.id, parentDisplayName(p)])),
    [parents],
  );

  const enrichedDebtors = useMemo(
    () =>
      riskDebt.map((d) => ({
        ...d,
        parentName: parentNameMap.get(d.parentId) || d.parentName || `Famille ${d.parentId.slice(-6)}`,
      })),
    [riskDebt, parentNameMap],
  );

  const riskProfiles = useMemo<StudentRiskProfile[]>(() => {
    return evaluateStudentRiskProfiles({
      students,
      parents,
      classes,
      subjects,
      subjectConfigurations,
      assessments,
      attendance,
      debtSummaries: riskDebt,
    });
  }, [
    students,
    parents,
    classes,
    subjects,
    subjectConfigurations,
    assessments,
    attendance,
    riskDebt,
  ]);

  const waveNow = useMemo(() => Date.now(), [installments]);
  const waves = useMemo(
    () => deriveTrancheWaves(installments, waveNow, debtThresholdsActive),
    [installments, waveNow, debtThresholdsActive],
  );
  const pooledWaves = useMemo(
    () => derivePooledTrancheWaves(installments, waveNow, debtThresholdsActive),
    [installments, waveNow, debtThresholdsActive],
  );
  const nonWaveSummary = useMemo(
    () => deriveNonWaveSummary(installments, waveNow, debtThresholdsActive),
    [installments, waveNow, debtThresholdsActive],
  );
  const triage = useMemo(
    () => deriveDebtTriage(installments, Date.now(), debtThresholdsActive),
    [installments, debtThresholdsActive],
  );
  const concentration = useMemo(
    () =>
      deriveFamilyConcentration({
        installments,
        parents,
        students,
        nowEpochMs: Date.now(),
      }),
    [installments, parents, students],
  );
  const transport = useMemo(
    () => deriveTransportYield({ students, installments }),
    [students, installments],
  );
  const services = useMemo(
    () =>
      deriveServiceYield(
        applyAnalyticsFilters(payments, range, NO_ANALYTICS_FILTERS),
        PAYMENT_CATEGORY_LABELS_FR,
      ),
    [payments, range],
  );
  const dynamics = useMemo(
    () => deriveEnrollmentDynamics({ students, parents, classes }),
    [students, parents, classes],
  );
  const riskSummary = useMemo(
    () => deriveTripleRiskSummary(riskProfiles),
    [riskProfiles],
  );
  const payrollForecast = useMemo(
    () =>
      computePayrollForecast({
        personnel: payrollPersonnel,
        salaryPayments,
        now: new Date(),
      }),
    [payrollPersonnel, salaryPayments],
  );
  const payrollTrend = useMemo(
    () => derivePayrollCostTrend(payrollForecast),
    [payrollForecast],
  );

  const toggleMethod = useCallback((method: PaymentMethod) => {
    setFilters((prev) => {
      const methods = new Set(prev.methods);
      if (methods.has(method)) methods.delete(method);
      else methods.add(method);
      return { ...prev, methods };
    });
  }, []);

  const toggleCategory = useCallback((category: PaymentCategory | null) => {
    setFilters((prev) => {
      const categories = new Set<PaymentCategory | null>(prev.categories);
      if (categories.has(category)) categories.delete(category);
      else categories.add(category);
      return { ...prev, categories };
    });
  }, []);

  const resetFilters = useCallback(() => setFilters(NO_ANALYTICS_FILTERS), []);
  const slice = useMemo(
    () => applyAnalyticsFilters(payments, range, filters),
    [payments, range, filters],
  );
  const unfilteredCount = useMemo(
    () => applyAnalyticsFilters(payments, range, NO_ANALYTICS_FILTERS).length,
    [payments, range],
  );
  const categories = useMemo(
    () => presentCategories(payments, range),
    [payments, range],
  );
  const sliceTotal = useMemo(
    () => slice.reduce((sum, payment) => sum + payment.amount, 0),
    [slice],
  );
  const currentRevenueTotal = useMemo(
    () => revenue.reduce((sum, point) => sum + point.amount, 0),
    [revenue],
  );
  const currentDebtTotal = useMemo(
    () => riskDebt.reduce((sum, debt) => sum + debt.outstandingAmount, 0),
    [riskDebt],
  );
  const studentCount = students.length;
  const yearOutstandingDebt = useMemo(
    () => deriveOutstandingDebt(installments, academicYear),
    [installments, academicYear],
  );
  const trancheOneRemaining = useMemo(
    () =>
      deriveOutstandingDebt(
        installments.filter((item) => item.trancheNumber === 1),
        academicYear,
      ),
    [installments, academicYear],
  );
  const transportRemaining = useMemo(
    () =>
      deriveOutstandingDebt(
        installments.filter((item) => item.category === "transport"),
        academicYear,
      ),
    [installments, academicYear],
  );
  const servicePayments = useMemo(
    () =>
      applyAnalyticsFilters(payments, range, {
        methods: new Set(),
        categories: new Set(SERVICE_CATEGORIES),
      }).reduce((sum, payment) => sum + payment.amount, 0),
    [payments, range],
  );
  const remiseTotal = useMemo(
    () => deriveDiscountErosion(ledger).remiseTotal,
    [ledger],
  );
  const absenceCount = useMemo(
    () =>
      attendance.filter(
        (record) =>
          record.status === "absent_excused" ||
          record.status === "absent_unexcused",
      ).length,
    [attendance],
  );

  const inspection = (request: InspectRequest) => request;

  const pilotageItems: DashboardLayoutItem[] = [
    {
      id: "pilotage-risk",
      label: "Radar de vigilance multi-critères",
      x: 0,
      y: 0,
      w: 4,
      h: 12,
      minW: 3,
      maxW: 12,
      minH: 10,
      maxH: 24,
      content: (
        <TripleRiskSummaryCard
          summary={riskSummary}
          profiles={riskProfiles}
          headerActions={
            <>
              <InspectTrigger request={inspection({ domain: "academic-risk", title: "Élèves à risque pédagogique", metric: "gpa_below_10", sourceValue: riskProfiles.filter((profile) => profile.gpa !== null && profile.gpa < 10).length })} />
              <InspectTrigger request={inspection({ domain: "attendance", title: "Enregistrements de présence", metric: "attendance_records", sourceValue: attendance.length, filters: { attendanceMode: "records" } })} />
              <InspectTrigger request={inspection({ domain: "attendance", title: "Absences enregistrées", metric: "absence_count", sourceValue: absenceCount, filters: { attendanceMode: "absences" } })} />
            </>
          }
        />
      ),
    },
    {
      id: "pilotage-waves",
      label: "Vélocité de recouvrement par vague",
      x: 4,
      y: 0,
      w: 8,
      h: 18,
      minW: 4,
      maxW: 12,
      minH: 14,
      maxH: 30,
      content: (
        <WaveVelocityCard
          waves={waves}
          pooled={pooledWaves}
          nonWave={nonWaveSummary}
          nowEpochMs={waveNow}
          headerActions={
            <>
              <InspectTrigger request={inspection({ domain: "revenue", title: `Revenus ${academicYear}`, metric: "annual_revenue", sourceValue: currentRevenueTotal })} />
              <InspectTrigger request={inspection({ domain: "tranche", title: `Vague 1 — reste dû ${academicYear}`, metric: "tranche_1_remaining", sourceValue: trancheOneRemaining, filters: { trancheNumber: 1, mode: "remaining", scope: "academic-year" } })} />
              <ThresholdsConfigTrigger scope={WAVE_METER_SCOPE} config={thresholdsConfig} />
            </>
          }
        />
      ),
    },
    {
      id: "pilotage-debt",
      label: "Triage des créances",
      x: 0,
      y: 19,
      w: 7,
      h: 12,
      minW: 4,
      maxW: 12,
      minH: 10,
      maxH: 24,
      content: (
        <DebtTriageCard
          triage={triage}
          parents={parents}
          headerActions={
            <>
              <InspectTrigger request={inspection({ domain: "debt", title: `Créances ${academicYear}`, metric: "outstanding_debt", sourceValue: yearOutstandingDebt, filters: { scope: "academic-year" } })} />
              <ThresholdsConfigTrigger scope={DEBT_TRIAGE_SCOPE} config={thresholdsConfig} />
            </>
          }
        />
      ),
    },
    {
      id: "pilotage-discount",
      label: "Érosion des remises",
      x: 7,
      y: 19,
      w: 5,
      h: 12,
      minW: 4,
      maxW: 12,
      minH: 8,
      maxH: 24,
      content: (
        <DiscountErosionCard
          ledger={ledger}
          headerActions={<InspectTrigger request={inspection({ domain: "discount", title: "Remises négociées (grand livre)", metric: "discount_total", sourceValue: remiseTotal })} />}
        />
      ),
    },
    {
      id: "pilotage-family",
      label: "Concentration du risque familial",
      x: 0,
      y: 32,
      w: 7,
      h: 11,
      minW: 4,
      maxW: 12,
      minH: 8,
      maxH: 24,
      content: (
        <FamilyConcentrationCard
          concentration={concentration}
          headerActions={<InspectTrigger request={inspection({ domain: "debt", title: "Créances toutes années (Pareto)", metric: "outstanding_debt_all_years", sourceValue: currentDebtTotal, filters: { scope: "all" } })} />}
        />
      ),
    },
    {
      id: "pilotage-enrollment",
      label: "Dynamique des effectifs et fratries",
      x: 7,
      y: 32,
      w: 5,
      h: 11,
      minW: 4,
      maxW: 12,
      minH: 8,
      maxH: 24,
      content: <EnrollmentDynamicsCard dynamics={dynamics} />,
    },
    {
      id: "pilotage-transport",
      label: "Rendement transport",
      x: 0,
      y: 44,
      w: 7,
      h: 10,
      minW: 4,
      maxW: 12,
      minH: 8,
      maxH: 24,
      content: (
        <TransportYieldCard
          transport={transport}
          headerActions={<InspectTrigger request={inspection({ domain: "transport", title: `Restes dûs transport ${academicYear}`, metric: "transport_remaining", sourceValue: transportRemaining, filters: { transportMode: "remaining" } })} />}
        />
      ),
    },
    {
      id: "pilotage-services",
      label: "Revenus services spécialisés",
      x: 7,
      y: 44,
      w: 5,
      h: 10,
      minW: 4,
      maxW: 12,
      minH: 8,
      maxH: 24,
      content: (
        <ServiceYieldCard
          services={services}
          headerActions={<InspectTrigger request={inspection({ domain: "service", title: "Encaissements services (hors scolarité/transport)", metric: "service_payments", sourceValue: servicePayments, filters: { from: range?.from, to: range?.to, categories: SERVICE_CATEGORIES } })} />}
        />
      ),
    },
  ];

  const diagnosticItems: DashboardLayoutItem[] = [
    {
      id: "diagnostic-console",
      label: "Console d'Investigation Opérationnelle",
      x: 0,
      y: 0,
      w: 12,
      h: 48,
      minW: 6,
      maxW: 12,
      minH: 32,
      maxH: 80,
      content: (
        <OperationalQueryConsole
          profiles={riskProfiles}
          severeDebtDzd={debtThresholdsActive.severeDebtDzd}
          selectedCategory={consoleCategory}
          onSelectedCategoryChange={setConsoleCategory}
          riskSummary={riskSummary}
          classes={classes}
          riskHeaderActions={
            <InspectTrigger request={inspection({
              domain: "academic-risk",
              title: "Matrice de risque pédagogique",
              metric: "risk_profiles",
              sourceValue: riskProfiles.length,
            })} />
          }
          headerActions={
            <>
              <InspectTrigger request={inspection({ domain: "enrollment", title: "Roster des élèves", metric: "roster", sourceValue: students.length })} />
              <ThresholdsConfigTrigger scope={OPERATIONAL_CONSOLE_SCOPE} config={thresholdsConfig} />
            </>
          }
        />
      ),
    },
  ];

  const chartItems: DashboardLayoutItem[] = [
    {
      id: "charts-slicers",
      label: "Filtres statistiques",
      x: 0,
      y: 0,
      w: 12,
      h: 5,
      minW: 6,
      maxW: 12,
      minH: 4,
      maxH: 12,
      content: (
        <AnalyticsSlicers
          filters={filters}
          onToggleMethod={toggleMethod}
          onToggleCategory={toggleCategory}
          onReset={resetFilters}
          methods={ALL_METHODS}
          categories={categories}
          filteredCount={slice.length}
          filteredTotal={sliceTotal}
          totalCount={unfilteredCount}
          headerActions={<InspectTrigger request={inspection({ domain: "revenue", title: "Encaissements filtrés", metric: "filtered_paid_revenue", sourceValue: sliceTotal, filters: { from: range?.from, to: range?.to, methods: [...filters.methods], categories: [...filters.categories] } })} />}
        />
      ),
    },
    {
      id: "charts-stat-strip",
      label: "Statistiques descriptives",
      x: 0,
      y: 6,
      w: 12,
      h: 6,
      minW: 6,
      maxW: 12,
      minH: 4,
      maxH: 12,
      content: (
        <div className="h-full space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Statistiques descriptives</span>
            <InspectTrigger request={inspection({ domain: "revenue", title: "Statistiques sur les paiements filtrés", metric: "payment_stats_total", sourceValue: sliceTotal, filters: { from: range?.from, to: range?.to } })} />
          </div>
          <StatStrip slice={slice} />
        </div>
      ),
    },
    {
      id: "charts-method-mix",
      label: "Mix des méthodes de paiement",
      x: 0,
      y: 13,
      w: 6,
      h: 11,
      minW: 4,
      maxW: 12,
      minH: 8,
      maxH: 20,
      content: (
        <MethodMixCard
          slice={slice}
          headerActions={<InspectTrigger request={inspection({ domain: "payment-method", title: "Mix des méthodes de paiement", metric: "method_mix", sourceValue: sliceTotal })} />}
        />
      ),
    },
    {
      id: "charts-category-mix",
      label: "Mix des catégories de paiement",
      x: 6,
      y: 13,
      w: 6,
      h: 11,
      minW: 4,
      maxW: 12,
      minH: 8,
      maxH: 20,
      content: (
        <CategoryMixCard
          slice={slice}
          headerActions={<InspectTrigger request={inspection({ domain: "payment-category", title: "Mix des catégories de paiement", metric: "category_mix", sourceValue: sliceTotal })} />}
        />
      ),
    },
    {
      id: "charts-yoy",
      label: "Comparaison annuelle des revenus",
      x: 0,
      y: 25,
      w: 12,
      h: 11,
      minW: 6,
      maxW: 12,
      minH: 8,
      maxH: 20,
      content: (
        <YoYComparisonCard
          currentYear={academicYear}
          previousYear={prevAcademicYear}
          revenue={revenue}
          prevRevenue={prevRevenue}
          headerActions={
            <>
              <InspectTrigger request={inspection({ domain: "revenue", title: `Revenus mensuels ${academicYear}`, metric: "monthly_revenue", sourceValue: currentRevenueTotal })} />
              {prevAcademicYear && (
                <InspectTrigger request={inspection({ domain: "revenue", title: `Revenus ${prevAcademicYear}`, metric: "previous_year_revenue", sourceValue: prevRevenue.reduce((sum, point) => sum + point.amount, 0) })} />
              )}
            </>
          }
        />
      ),
    },
    {
      id: "charts-aging",
      label: "Vieillissement des créances",
      x: 0,
      y: 37,
      w: 12,
      h: 12,
      minW: 6,
      maxW: 12,
      minH: 9,
      maxH: 24,
      content: (
        <AgingCompositionCard
          debtAging={debtAging}
          headerActions={<InspectTrigger request={inspection({ domain: "debt", title: "Vieillissement des créances (total)", metric: "debt_aging", sourceValue: debtAging.reduce((sum, bucket) => sum + bucket.amount, 0), filters: { scope: "academic-year" } })} />}
          rowActions={{
            "0_30": <InspectTrigger request={inspection({ domain: "debt", title: "Créances 0–30 j", metric: "debt_aging_0_30", sourceValue: debtAging.find((bucket) => bucket.bucket === "0_30")?.amount ?? 0, filters: { agingBucket: "0_30", scope: "academic-year" } })} />,
            "31_60": <InspectTrigger request={inspection({ domain: "debt", title: "Créances 31–60 j", metric: "debt_aging_31_60", sourceValue: debtAging.find((bucket) => bucket.bucket === "31_60")?.amount ?? 0, filters: { agingBucket: "31_60", scope: "academic-year" } })} />,
            "61_90": <InspectTrigger request={inspection({ domain: "debt", title: "Créances 61–90 j", metric: "debt_aging_61_90", sourceValue: debtAging.find((bucket) => bucket.bucket === "61_90")?.amount ?? 0, filters: { agingBucket: "61_90", scope: "academic-year" } })} />,
            "91_180": <InspectTrigger request={inspection({ domain: "debt", title: "Créances 91–180 j", metric: "debt_aging_91_180", sourceValue: debtAging.find((bucket) => bucket.bucket === "91_180")?.amount ?? 0, filters: { agingBucket: "91_180", scope: "academic-year" } })} />,
            "180_plus": <InspectTrigger request={inspection({ domain: "debt", title: "Créances > 180 j", metric: "debt_aging_180_plus", sourceValue: debtAging.find((bucket) => bucket.bucket === "180_plus")?.amount ?? 0, filters: { agingBucket: "180_plus", scope: "academic-year" } })} />,
          }}
        />
      ),
    },
    {
      id: "charts-pareto",
      label: "Pareto des familles débitrices",
      x: 0,
      y: 50,
      w: 12,
      h: 13,
      minW: 6,
      maxW: 12,
      minH: 10,
      maxH: 24,
      content: (
        <DebtorsParetoCard
          topDebtors={enrichedDebtors as DebtSummary[]}
          totalOutstanding={currentDebtTotal}
          onOpenParent={onOpenParent}
          headerActions={<InspectTrigger request={inspection({ domain: "debt", title: "Pareto des familles débitrices (toutes années)", metric: "debtors_pareto", sourceValue: currentDebtTotal, filters: { scope: "all" } })} />}
        />
      ),
    },
    {
      id: "charts-payroll-trend",
      label: "Coûts du Personnel — Réalisé vs Projeté & Besoin de Financement",
      x: 0,
      y: 64,
      w: 12,
      h: 15,
      minW: 6,
      maxW: 12,
      minH: 12,
      maxH: 26,
      content: (
        <div className="h-full space-y-2">
          <PayrollCostTrendCard trend={payrollTrend} />
        </div>
      ),
    },
  ];

  return (
    <DataInspectorProvider
      academicYear={academicYear}
      range={range}
      riskProfiles={riskProfiles}
    >
      <div className="space-y-4 pb-8" data-testid="analytics-tab">
        <div className="flex items-center justify-between border-b border-border pb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setViewMode("pilotage")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${viewMode === "pilotage" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"}`}
            >
              <Gauge className="h-3.5 w-3.5" /> Pilotage Exécutif
            </button>
            <InfoTip tip="viewMode.pilotage" size={11} className="ml-0.5" />
            <button
              type="button"
              onClick={() => setViewMode("diagnostic")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${viewMode === "diagnostic" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"}`}
            >
              <Search className="h-3.5 w-3.5" /> Diagnostic Actif
            </button>
            <InfoTip tip="viewMode.diagnostic" size={11} className="ml-0.5" />
            <button
              type="button"
              onClick={() => setViewMode("charts")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${viewMode === "charts" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"}`}
            >
              <BarChart3 className="h-3.5 w-3.5" /> Flux Financiers (métriques réelles)
            </button>
            <InfoTip tip="viewMode.charts" size={11} className="ml-0.5" />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-0.5">
              Année active: <strong className="text-foreground font-mono">{academicYear}</strong>
              <InfoTip tip="header.academicYear" size={11} />
            </span>
            <InspectTrigger
              request={inspection({
                domain: "enrollment",
                title: "Effectif actif",
                metric: "student_count",
                sourceValue: studentCount,
              })}
            />
          </div>
        </div>

        {viewMode === "pilotage" && (
          <DashboardLayoutEditor
            storageKey="statistics:pilotage"
            items={pilotageItems}
            editing={editing}
          />
        )}

        {viewMode === "diagnostic" && (
          <DashboardLayoutEditor
            storageKey="statistics:diagnostic"
            items={diagnosticItems}
            editing={editing}
          />
        )}

        {viewMode === "charts" && (
          <DashboardLayoutEditor
            storageKey="statistics:charts"
            items={chartItems}
            editing={editing}
          />
        )}
      </div>
    </DataInspectorProvider>
  );
}