// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/tabs/analytics-tab.tsx
// ============================================================================
/**
 * AnalyticsTab — Statistics / Executive Command Center + exploration hub.
 *
 * Every visible statistics widget is a first-class DashboardLayoutEditor item.
 * The layout layer controls presentation only; repository data and business
 * derivations remain unchanged.
 */

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
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
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
// T-412 — the Statistics planning view of the canonical payroll forecast
// (ADR-024): the SAME computation as Personnel and Finance.
import { PayrollCostTrendCard } from "../components/analytics/payroll-cost-trend-card";
import { computePayrollForecast } from "../../../domain/calc/payroll/payroll-forecast";
import {
  evaluateStudentRiskProfiles,
  type StudentRiskProfile,
} from "../components/analytics/operational-query-engine";
import { OperationalQueryConsole } from "../components/analytics/operational-query-console";
import { PivotMatrixCard } from "../components/analytics/pivot-matrix-card";
import { CrossRiskCard } from "../components/analytics/cross-risk-card";
import {
  DataInspectorProvider,
  InspectTrigger,
  type InspectRequest,
} from "../components/analytics/data-inspector";
import { DashboardLayoutEditor, type DashboardLayoutItem } from "../dashboard-layout-editor";

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
  onOpenStudent?: (studentId: string) => void;
  onOpenParent?: (parentId: string) => void;
  /** Optional since the T-404 packaging-gate typecheck repair (2026-09-22). */
  editing?: boolean;
}

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
  onOpenStudent,
  onOpenParent,
  editing = false,
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
  const ledger = useObservable(() => repos.ledger.observe(), []);
  // T-412 (ADR-024): the canonical payroll forecast's two input streams
  // (the T-411 observeAllocations optional-method pattern — fakes/test
  // repos without the payroll surface get a constant-empty stream and the
  // trend card renders its honest empty state).
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

  const riskDebt = debtSummaries ?? topDebtors;
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

  const waves = useMemo(
    () => deriveTrancheWaves(installments, Date.now()),
    [installments],
  );
  const triage = useMemo(
    () => deriveDebtTriage(installments, Date.now()),
    [installments],
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
    () => deriveServiceYield(payments, PAYMENT_CATEGORY_LABELS_FR),
    [payments],
  );
  const dynamics = useMemo(
    () => deriveEnrollmentDynamics({ students, parents, classes }),
    [students, parents, classes],
  );
  const riskSummary = useMemo(
    () => deriveTripleRiskSummary(riskProfiles),
    [riskProfiles],
  );
  // T-412 — ONE canonical forecast → the Statistics trend projection (the
  // Personnel waves and the Finance treasury block read the same object).
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
      id: "pilotage-inspection",
      label: "Inspection directe",
      x: 0,
      y: 0,
      w: 12,
      h: 4,
      minW: 6,
      maxW: 12,
      minH: 3,
      maxH: 8,
      content: (
        <div className="h-full flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-surface-panel/70 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
            Inspection directe
          </span>
          <InspectTrigger request={inspection({ domain: "revenue", title: `Revenus ${academicYear}`, metric: "annual_revenue", sourceValue: currentRevenueTotal })} />
          <InspectTrigger request={inspection({ domain: "debt", title: `Créances ${academicYear}`, metric: "outstanding_debt", sourceValue: yearOutstandingDebt, filters: { scope: "academic-year" } })} />
          <InspectTrigger request={inspection({ domain: "debt", title: "Créances toutes années (Pareto)", metric: "outstanding_debt_all_years", sourceValue: currentDebtTotal, filters: { scope: "all" } })} />
          <InspectTrigger request={inspection({ domain: "tranche", title: `Vague 1 — reste dû ${academicYear}`, metric: "tranche_1_remaining", sourceValue: trancheOneRemaining, filters: { trancheNumber: 1, mode: "remaining", scope: "academic-year" } })} />
          <InspectTrigger request={inspection({ domain: "transport", title: `Restes dûs transport ${academicYear}`, metric: "transport_remaining", sourceValue: transportRemaining, filters: { transportMode: "remaining" } })} />
          <InspectTrigger request={inspection({ domain: "service", title: "Encaissements services (hors scolarité/transport)", metric: "service_payments", sourceValue: servicePayments, filters: { from: range?.from, to: range?.to, categories: SERVICE_CATEGORIES } })} />
          <InspectTrigger request={inspection({ domain: "academic-risk", title: "Élèves à risque pédagogique", metric: "gpa_below_10", sourceValue: riskProfiles.filter((profile) => profile.gpa !== null && profile.gpa < 10).length })} />
          <InspectTrigger request={inspection({ domain: "attendance", title: "Enregistrements de présence", metric: "attendance_records", sourceValue: attendance.length, filters: { attendanceMode: "records" } })} />
          <InspectTrigger request={inspection({ domain: "attendance", title: "Absences enregistrées", metric: "absence_count", sourceValue: absenceCount, filters: { attendanceMode: "absences" } })} />
          <InspectTrigger request={inspection({ domain: "discount", title: "Remises négociées (grand livre)", metric: "discount_total", sourceValue: remiseTotal })} />
        </div>
      ),
    },
    {
      id: "pilotage-risk",
      label: "Radar de vigilance multi-critères",
      x: 0,
      y: 5,
      w: 4,
      h: 8,
      minW: 3,
      maxW: 12,
      minH: 6,
      maxH: 16,
      content: <TripleRiskSummaryCard summary={riskSummary} profiles={riskProfiles} />,
    },
    {
      id: "pilotage-waves",
      label: "Vélocité de recouvrement par vague",
      x: 4,
      y: 5,
      w: 8,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 18,
      content: <WaveVelocityCard waves={waves} />,
    },
    {
      id: "pilotage-debt",
      label: "Triage des créances",
      x: 0,
      y: 14,
      w: 7,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 18,
      content: <DebtTriageCard triage={triage} parents={parents} />,
    },
    {
      id: "pilotage-discount",
      label: "Érosion des remises",
      x: 7,
      y: 14,
      w: 5,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 18,
      content: <DiscountErosionCard ledger={ledger} />,
    },
    {
      id: "pilotage-family",
      label: "Concentration du risque familial",
      x: 0,
      y: 23,
      w: 7,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 20,
      content: <FamilyConcentrationCard concentration={concentration} />,
    },
    {
      id: "pilotage-enrollment",
      label: "Dynamique des effectifs et fratries",
      x: 7,
      y: 23,
      w: 5,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 20,
      content: <EnrollmentDynamicsCard dynamics={dynamics} />,
    },
    {
      id: "pilotage-transport",
      label: "Rendement transport",
      x: 0,
      y: 32,
      w: 7,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 20,
      content: <TransportYieldCard transport={transport} />,
    },
    {
      id: "pilotage-services",
      label: "Revenus services spécialisés",
      x: 7,
      y: 32,
      w: 5,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 20,
      content: <ServiceYieldCard services={services} />,
    },
    {
      id: "pilotage-queries",
      label: "Console de requêtes opérationnelles",
      x: 0,
      y: 41,
      w: 12,
      h: 14,
      minW: 6,
      maxW: 12,
      minH: 8,
      maxH: 24,
      content: (
        <OperationalQueryConsole
          profiles={riskProfiles}
          onOpenStudent={onOpenStudent}
          onOpenParent={onOpenParent}
        />
      ),
    },
  ];

  const diagnosticItems: DashboardLayoutItem[] = [
    {
      id: "diagnostic-source",
      label: "Source des matrices",
      x: 0,
      y: 0,
      w: 12,
      h: 4,
      minW: 6,
      maxW: 12,
      minH: 3,
      maxH: 8,
      content: (
        <div className="h-full flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-surface-panel/70 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
            Source des matrices
          </span>
          <InspectTrigger request={inspection({ domain: "academic-risk", title: "Matrice de risque pédagogique", metric: "risk_profiles", sourceValue: riskProfiles.length })} />
          <InspectTrigger request={inspection({ domain: "enrollment", title: "Roster des élèves", metric: "roster", sourceValue: students.length })} />
        </div>
      ),
    },
    {
      id: "diagnostic-console",
      label: "Console de diagnostic opérationnel",
      x: 0,
      y: 5,
      w: 12,
      h: 14,
      minW: 6,
      maxW: 12,
      minH: 8,
      maxH: 24,
      content: (
        <OperationalQueryConsole
          profiles={riskProfiles}
          onOpenStudent={onOpenStudent}
          onOpenParent={onOpenParent}
        />
      ),
    },
    {
      id: "diagnostic-cross-risk",
      label: "Matrice croisée de risque",
      x: 0,
      y: 20,
      w: 5,
      h: 10,
      minW: 4,
      maxW: 12,
      minH: 7,
      maxH: 20,
      content: <CrossRiskCard profiles={riskProfiles} />,
    },
    {
      id: "diagnostic-pivot",
      label: "Matrice pivot pédagogique",
      x: 5,
      y: 20,
      w: 7,
      h: 10,
      minW: 4,
      maxW: 12,
      minH: 7,
      maxH: 20,
      content: <PivotMatrixCard profiles={riskProfiles} classes={classes} />,
    },
  ];

  const chartItems: DashboardLayoutItem[] = [
    {
      id: "charts-provenance",
      label: "Ligne de provenance active",
      x: 0,
      y: 0,
      w: 12,
      h: 4,
      minW: 6,
      maxW: 12,
      minH: 3,
      maxH: 8,
      content: (
        <div className="h-full flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
            Ligne de provenance active
          </span>
          <span className="text-xs font-mono font-semibold text-foreground">
            {slice.length} PAID · {sliceTotal.toLocaleString("fr-DZ")} DZD
          </span>
          <InspectTrigger request={inspection({ domain: "revenue", title: "Encaissements filtrés", metric: "filtered_paid_revenue", sourceValue: sliceTotal, filters: { from: range?.from, to: range?.to, methods: [...filters.methods], categories: [...filters.categories] } })} />
        </div>
      ),
    },
    {
      id: "charts-slicers",
      label: "Filtres statistiques",
      x: 0,
      y: 5,
      w: 12,
      h: 5,
      minW: 6,
      maxW: 12,
      minH: 4,
      maxH: 10,
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
        />
      ),
    },
    {
      id: "charts-stat-strip",
      label: "Statistiques descriptives",
      x: 0,
      y: 11,
      w: 12,
      h: 5,
      minW: 6,
      maxW: 12,
      minH: 4,
      maxH: 10,
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
      y: 17,
      w: 6,
      h: 9,
      minW: 4,
      maxW: 12,
      minH: 7,
      maxH: 18,
      content: (
        <div className="h-full space-y-2">
          <div className="flex justify-end">
            <InspectTrigger request={inspection({ domain: "payment-method", title: "Mix des méthodes de paiement", metric: "method_mix", sourceValue: sliceTotal })} />
          </div>
          <MethodMixCard slice={slice} />
        </div>
      ),
    },
    {
      id: "charts-category-mix",
      label: "Mix des catégories de paiement",
      x: 6,
      y: 17,
      w: 6,
      h: 9,
      minW: 4,
      maxW: 12,
      minH: 7,
      maxH: 18,
      content: (
        <div className="h-full space-y-2">
          <div className="flex justify-end">
            <InspectTrigger request={inspection({ domain: "payment-category", title: "Mix des catégories de paiement", metric: "category_mix", sourceValue: sliceTotal })} />
          </div>
          <CategoryMixCard slice={slice} />
        </div>
      ),
    },
    {
      id: "charts-yoy",
      label: "Comparaison annuelle des revenus",
      x: 0,
      y: 27,
      w: 12,
      h: 9,
      minW: 6,
      maxW: 12,
      minH: 7,
      maxH: 18,
      content: (
        <div className="h-full space-y-2">
          <div className="flex flex-wrap justify-end gap-2">
            <InspectTrigger request={inspection({ domain: "revenue", title: `Revenus mensuels ${academicYear}`, metric: "monthly_revenue", sourceValue: currentRevenueTotal })} />
            {prevAcademicYear && (
              <InspectTrigger request={inspection({ domain: "revenue", title: `Revenus ${prevAcademicYear}`, metric: "previous_year_revenue", sourceValue: prevRevenue.reduce((sum, point) => sum + point.amount, 0) })} />
            )}
          </div>
          <YoYComparisonCard
            currentYear={academicYear}
            previousYear={prevAcademicYear}
            revenue={revenue}
            prevRevenue={prevRevenue}
          />
        </div>
      ),
    },
    {
      id: "charts-aging",
      label: "Vieillissement des créances",
      x: 0,
      y: 37,
      w: 12,
      h: 10,
      minW: 6,
      maxW: 12,
      minH: 8,
      maxH: 20,
      content: (
        <div className="h-full space-y-2">
          <div className="flex flex-wrap justify-end gap-2">
            <InspectTrigger request={inspection({ domain: "debt", title: "Vieillissement des créances (total)", metric: "debt_aging", sourceValue: debtAging.reduce((sum, bucket) => sum + bucket.amount, 0), filters: { scope: "academic-year" } })} />
            <InspectTrigger request={inspection({ domain: "debt", title: "Créances 0–30 j", metric: "debt_aging_0_30", sourceValue: debtAging.find((bucket) => bucket.bucket === "0_30")?.amount ?? 0, filters: { agingBucket: "0_30", scope: "academic-year" } })} />
            <InspectTrigger request={inspection({ domain: "debt", title: "Créances 31–60 j", metric: "debt_aging_31_60", sourceValue: debtAging.find((bucket) => bucket.bucket === "31_60")?.amount ?? 0, filters: { agingBucket: "31_60", scope: "academic-year" } })} />
            <InspectTrigger request={inspection({ domain: "debt", title: "Créances 61–90 j", metric: "debt_aging_61_90", sourceValue: debtAging.find((bucket) => bucket.bucket === "61_90")?.amount ?? 0, filters: { agingBucket: "61_90", scope: "academic-year" } })} />
            <InspectTrigger request={inspection({ domain: "debt", title: "Créances 91–180 j", metric: "debt_aging_91_180", sourceValue: debtAging.find((bucket) => bucket.bucket === "91_180")?.amount ?? 0, filters: { agingBucket: "91_180", scope: "academic-year" } })} />
            <InspectTrigger request={inspection({ domain: "debt", title: "Créances > 180 j", metric: "debt_aging_180_plus", sourceValue: debtAging.find((bucket) => bucket.bucket === "180_plus")?.amount ?? 0, filters: { agingBucket: "180_plus", scope: "academic-year" } })} />
          </div>
          <AgingCompositionCard debtAging={debtAging} />
        </div>
      ),
    },
    {
      id: "charts-pareto",
      label: "Pareto des familles débitrices",
      x: 0,
      y: 48,
      w: 12,
      h: 10,
      minW: 6,
      maxW: 12,
      minH: 8,
      maxH: 20,
      content: (
        <div className="h-full space-y-2">
          <div className="flex justify-end">
            <InspectTrigger request={inspection({ domain: "debt", title: "Pareto des familles débitrices (toutes années)", metric: "debtors_pareto", sourceValue: currentDebtTotal, filters: { scope: "all" } })} />
          </div>
          <DebtorsParetoCard topDebtors={riskDebt as DebtSummary[]} />
        </div>
      ),
    },
    {
      id: "charts-payroll-trend",
      label: "Coûts du Personnel — Réalisé vs Projeté & Besoin de Financement",
      x: 0,
      y: 58,
      w: 12,
      h: 11,
      minW: 6,
      maxW: 12,
      minH: 8,
      maxH: 22,
      content: (
        <div className="h-full space-y-2">
          {/* T-412 — the canonical monthly/quarterly personnel-cost &
              funding-requirement trend (same calculation as Personnel and
              Finance). No InspectTrigger here: the inspector's domain union
              is a closed lineage contract (data-inspector-lineage.ts) — the
              card labels its own figures and the parity suite pins the
              values instead. */}
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
            <button
              type="button"
              onClick={() => setViewMode("diagnostic")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${viewMode === "diagnostic" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"}`}
            >
              <Search className="h-3.5 w-3.5" /> Diagnostic Actif
            </button>
            <button
              type="button"
              onClick={() => setViewMode("charts")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${viewMode === "charts" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"}`}
            >
              <BarChart3 className="h-3.5 w-3.5" /> Flux Financiers (métriques réelles)
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Année active: <strong className="text-foreground font-mono">{academicYear}</strong>
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
