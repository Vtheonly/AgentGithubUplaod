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
import type { DebtAgingThresholds } from "../../../domain/calc/ledger/debt-aging";
// T-507 (UI-338): the contextual thresholds-config trigger — the small
// attached control that opens the scoped editor (renders NOTHING when the
// config api is absent — provider-less test renders stay byte-identical).
import {
  ThresholdsConfigTrigger,
  type ThresholdsConfigApi,
  type ThresholdsConfigScope,
} from "../../settings/contextual-thresholds-config";
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
// T-447 (STATS-401): the canonical POOLED all-categories derivation + the
// non-wave summary — the parity objects the main wave cards render (the
// SAME rows the Finance Tranches strip consumes).
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
// T-447 (UI-325): the bilingual explainability tooltips (the glossary lives
// in src/i18n/stats-tips.ts — dictionary-only, never JSX text).
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
  onOpenStudent?: (studentId: string) => void;
  onOpenParent?: (parentId: string) => void;
  /** Optional since the T-404 packaging-gate typecheck repair (2026-09-22). */
  editing?: boolean;
  /**
   * T-443 (DEBT-101): the tenant's ACTIVE debt-aging thresholds. Absent →
   * the tab reads `repos.debt.observeThresholds()` itself (the embedded
   * default when even that is unavailable is the documented DEFAULTS).
   */
  debtThresholds?: DebtAgingThresholds;
  /**
   * T-507 (UI-338): the contextual-config api (the dashboard page's host —
   * the live-preview triggers ride the wave/triage/console headers).
   * Absent → no trigger renders (the pure-prop contract).
   */
  thresholdsConfig?: ThresholdsConfigApi | null;
}

/* ── T-507 (UI-338): the per-component config scopes ──
 * ONLY the parameters each component's derivations actually consume (the
 * compact-modal requirement): the wave meters → the grace period; the
 * triage → the day hierarchy; the console's quick query → the severe edge. */
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
  onOpenStudent,
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
  // T-443 (DEBT-101): the ACTIVE debt-aging thresholds — the prop wins (the
  // dashboard page's single read), else this tab's own subscription (the
  // same repository stream; the subject's seed value IS the documented
  // DEFAULTS until the light reader lands).
  const internalDebtThresholds = useObservable(() => repos.debt.observeThresholds(), []);
  const debtThresholdsActive = debtThresholds ?? internalDebtThresholds;
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
  // T-503 (UI-335): the diagnostic view's shared quadrant→console filter —
  // the CrossRiskCard quadrants drive the OperationalQueryConsole's
  // category filter (the card's caption finally does what it promises).
  const [consoleCategory, setConsoleCategory] = useState<string>("all");

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

  // T-447 (STATS-401): ONE clock for the wave/triage/concentration
  // derivations — computed once per data change so the phase AND the
  // days-late agree (§15.54d: the card receives this value, never its own
  // Date.now()). The `installments` dep is DELIBERATE (re-pin the clock
  // when the data changes — the derivation memo's own freshness anchor);
  // eslint's exhaustive-deps cannot see that intent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const waveNow = useMemo(() => Date.now(), [installments]);
  const waves = useMemo(
    () => deriveTrancheWaves(installments, waveNow, debtThresholdsActive),
    [installments, waveNow, debtThresholdsActive],
  );
  // T-447: the canonical pooled all-categories T1/T2/T3 analysis (the
  // main wave cards) + the non-wave summary (FI etc.) — derived from the
  // SAME rows at the SAME clock as the per-category detail above.
  // T-502 (STATS-403): all three derivations consume the ACTIVE debt
  // thresholds — the wave meters' "En retard" verdicts follow the
  // CONFIGURED grace period (the same `debt.grace_period_days` the
  // triage/stages apply), so a configuration change moves the meter
  // counts and the stage counts TOGETHER.
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
  // T-447 (STATS-402 ledger #1 — the audit's scope defect): the services
  // card consumed the RAW all-years payments stream while every sibling
  // installment card is year-scoped and the tab's own "Encaissements
  // services" InspectTrigger is range-scoped — the card and its own
  // inspector trigger disagreed by every payment outside the active
  // range. Now the card consumes the SAME range-scoped paid slice
  // (applyAnalyticsFilters — the ONE cross-filtering engine).
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
    // T-503 (UI-334): the « Inspection directe » STRIP is RETIRED — every
    // inspection button now lives ON the card it inspects (the optional
    // headerActions surface every analytics card accepts), so the
    // relationship between a button and its target is immediately obvious
    // and the buttons stay attached through drags/resizes/hides.
    {
      id: "pilotage-risk",
      label: "Radar de vigilance multi-critères",
      x: 0,
      y: 0,
      w: 4,
      h: 8,
      minW: 3,
      maxW: 12,
      minH: 6,
      maxH: 16,
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
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 18,
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
              {/* T-507 (UI-338): the config trigger ON the wave meters. */}
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
      y: 9,
      w: 7,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 18,
      content: (
        <DebtTriageCard
          triage={triage}
          parents={parents}
          headerActions={
            <>
              <InspectTrigger request={inspection({ domain: "debt", title: `Créances ${academicYear}`, metric: "outstanding_debt", sourceValue: yearOutstandingDebt, filters: { scope: "academic-year" } })} />
              {/* T-507 (UI-338): the config trigger ON the triage. */}
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
      y: 9,
      w: 5,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 18,
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
      y: 18,
      w: 7,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 20,
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
      y: 18,
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
      y: 27,
      w: 7,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 20,
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
      y: 27,
      w: 5,
      h: 8,
      minW: 4,
      maxW: 12,
      minH: 6,
      maxH: 20,
      content: (
        <ServiceYieldCard
          services={services}
          headerActions={<InspectTrigger request={inspection({ domain: "service", title: "Encaissements services (hors scolarité/transport)", metric: "service_payments", sourceValue: servicePayments, filters: { from: range?.from, to: range?.to, categories: SERVICE_CATEGORIES } })} />}
        />
      ),
    },
    // T-503 (UI-335): the DUPLICATE console mount is RETIRED — the
    // OperationalQueryConsole belongs to the Diagnostic view (its own
    // label reads "Console de diagnostic opérationnel"); mounting it in
    // BOTH modes rendered the same Triple-Risque table twice per mode
    // switch (the owner's "two instances in each dashboard mode"). The
    // pilotage view keeps its executive RADAR (TripleRiskSummaryCard);
    // the full interactive console stays one mount in Diagnostic.
  ];

  const diagnosticItems: DashboardLayoutItem[] = [
    // T-503 (UI-334): the « Source des matrices » strip is RETIRED — the
    // two triggers moved onto the surfaces they inspect (the cross-risk
    // matrix + the console's roster).
    {
      id: "diagnostic-console",
      label: "Console de diagnostic opérationnel",
      x: 0,
      y: 0,
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
          // T-502 (DEBT-104): the CONFIGURED severe-debt edge — the
          // « Créances Critiques » quick query follows the tenant's
          // debt.severe_debt_dzd setting (migration 0147).
          severeDebtDzd={debtThresholdsActive.severeDebtDzd}
          // T-503 (UI-335): the shared quadrant→console filter (the
          // CrossRiskCard quadrants above drive this console's category).
          selectedCategory={consoleCategory}
          onSelectedCategoryChange={setConsoleCategory}
          // T-503 (UI-334): the roster inspection lives ON the console (the
          // console IS the student roster) — and T-507 (UI-338): the config
          // trigger for the severe-debt quick query rides the same surface.
          headerActions={
            <>
              <InspectTrigger request={inspection({ domain: "enrollment", title: "Roster des élèves", metric: "roster", sourceValue: students.length })} />
              <ThresholdsConfigTrigger scope={OPERATIONAL_CONSOLE_SCOPE} config={thresholdsConfig} />
            </>
          }
        />
      ),
    },
    {
      id: "diagnostic-cross-risk",
      label: "Matrice croisée de risque",
      x: 0,
      y: 15,
      w: 5,
      h: 10,
      minW: 4,
      maxW: 12,
      minH: 7,
      maxH: 20,
      content: (
        // T-503 (UI-335): the CANONICAL summary (one derivation shared
        // with the pilotage radar) + the quadrant clicks wired to the
        // console's category filter.
        <CrossRiskCard
          summary={riskSummary}
          onSelectCategory={setConsoleCategory}
          headerActions={<InspectTrigger request={inspection({ domain: "academic-risk", title: "Matrice de risque pédagogique", metric: "risk_profiles", sourceValue: riskProfiles.length })} />}
        />
      ),
    },
    {
      id: "diagnostic-pivot",
      label: "Matrice pivot pédagogique",
      x: 5,
      y: 15,
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
    // T-503 (UI-334): the « Ligne de provenance active » strip is RETIRED —
    // the provenance trigger rides the slicer panel whose filters define
    // it, and every chart's trigger lives on the chart itself.
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
          // T-503 (UI-334): the provenance inspection rides the slicers
          // (the panel that defines the active filter).
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
      y: 12,
      w: 6,
      h: 9,
      minW: 4,
      maxW: 12,
      minH: 7,
      maxH: 18,
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
      y: 12,
      w: 6,
      h: 9,
      minW: 4,
      maxW: 12,
      minH: 7,
      maxH: 18,
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
      y: 22,
      w: 12,
      h: 9,
      minW: 6,
      maxW: 12,
      minH: 7,
      maxH: 18,
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
      y: 32,
      w: 12,
      h: 10,
      minW: 6,
      maxW: 12,
      minH: 8,
      maxH: 20,
      content: (
        // T-503 (UI-334): the total's trigger lives on the card's header;
        // each bucket's trigger lives ON ITS OWN TABLE ROW (the exact
        // bucket it inspects — the old floating strip carried all six).
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
      y: 43,
      w: 12,
      h: 10,
      minW: 6,
      maxW: 12,
      minH: 8,
      maxH: 20,
      content: (
        <DebtorsParetoCard
          topDebtors={riskDebt as DebtSummary[]}
          // T-467 (DASH-411): the WHOLE dataset's total outstanding (the
          // T-351 full-stream wiring) — the whole-dataset reference mode's
          // honest denominator.
          totalOutstanding={currentDebtTotal}
          headerActions={<InspectTrigger request={inspection({ domain: "debt", title: "Pareto des familles débitrices (toutes années)", metric: "debtors_pareto", sourceValue: currentDebtTotal, filters: { scope: "all" } })} />}
        />
      ),
    },
    {
      id: "charts-payroll-trend",
      label: "Coûts du Personnel — Réalisé vs Projeté & Besoin de Financement",
      x: 0,
      y: 53,
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
