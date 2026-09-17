// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/tabs/analytics-tab.tsx
// ============================================================================
/**
 * AnalyticsTab — Executive Command Center + exploration hub.
 *
 * The dashboard's analytics surfaces are backed by the reactive repository
 * streams. The Data Lineage inspector is deliberately mounted around this
 * tab so every exposed inspection resolves from those same streams rather
 * than a second/mock dataset.
 */

import { useMemo, useState, useCallback } from "react";
import { Search, BarChart3, Gauge } from "lucide-react";
import type { RevenuePoint, DebtByAgingBucket } from "../../../domain/model/operations";
import type { Payment, PaymentMethod, PaymentCategory, DebtSummary, Installment } from "../../../domain/model/payment";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import {
  applyAnalyticsFilters,
  presentCategories,
  deriveOutstandingDebt,
  NO_ANALYTICS_FILTERS,
  type AnalyticsFilterState,
} from "../components/analytics/analytics-derivations";
import { deriveDiscountErosion, SERVICE_CATEGORIES } from "../components/analytics/executive-statistics";
import { AnalyticsSlicers } from "../components/analytics/analytics-slicers";
import { StatStrip } from "../components/analytics/stat-strip";
import { MethodMixCard, CategoryMixCard } from "../components/analytics/mix-cards";
import { YoYComparisonCard } from "../components/analytics/yoy-comparison-card";
import { AgingCompositionCard } from "../components/analytics/aging-composition-card";
import { DebtorsParetoCard } from "../components/analytics/debtors-pareto-card";
import { ExecutiveDashboard } from "../components/analytics/executive-cards";
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
}: AnalyticsTabProps) {
  const repos = useRepositories();
  const students = useObservable(() => repos.students.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const subjectConfigurations = useObservable(() => repos.subjects.observeConfigurations(), []);
  const assessments = useObservable(() => repos.grades.observeAll(), []);
  const attendance = useObservable(
    () => repos.attendance.observeAll(range?.from ?? "2020-01-01", range?.to ?? "2030-12-31"),
    [range?.from, range?.to],
  );
  const internalInstallments = useObservable(() => repos.installments.observe(), []);
  const installments = installmentsProp ?? internalInstallments;
  const ledger = useObservable(() => repos.ledger.observe(), []);
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
  }, [students, parents, classes, subjects, subjectConfigurations, assessments, attendance, riskDebt]);

  const toggleMethod = useCallback((method: PaymentMethod) => {
    setFilters((prev) => {
      const methods = new Set(prev.methods);
      if (methods.has(method)) methods.delete(method);
      else methods.add(method);
      return { ...prev, methods };
    });
  }, []);

  const toggleCategory = useCallback((category: PaymentCategory) => {
    setFilters((prev) => {
      const categories = new Set(prev.categories);
      if (categories.has(category)) categories.delete(category);
      else categories.add(category);
      return { ...prev, categories };
    });
  }, []);

  const resetFilters = useCallback(() => setFilters(NO_ANALYTICS_FILTERS), []);
  const slice = useMemo(() => applyAnalyticsFilters(payments, range, filters), [payments, range, filters]);
  const unfilteredCount = useMemo(
    () => applyAnalyticsFilters(payments, range, NO_ANALYTICS_FILTERS).length,
    [payments, range],
  );
  const categories = useMemo(() => presentCategories(payments, range), [payments, range]);
  const sliceTotal = useMemo(() => slice.reduce((sum, payment) => sum + payment.amount, 0), [slice]);
  const currentRevenueTotal = useMemo(() => revenue.reduce((sum, point) => sum + point.amount, 0), [revenue]);
  const currentDebtTotal = useMemo(
    () => riskDebt.reduce((sum, debt) => sum + debt.outstandingAmount, 0),
    [riskDebt],
  );
  const studentCount = students.length;
  // T-389 (INSPECT-500): the year-scoped outstanding debt — the SAME
  // derivation the inspector's resolution replays (status ≠ paid + year
  // billing window + INV-4 remaining), so the "Créances {année}" trigger's
  // displayed number and its lineage share ONE definition.
  const yearOutstandingDebt = useMemo(
    () => deriveOutstandingDebt(installments, academicYear),
    [installments, academicYear],
  );
  // T-389 (INSPECT-500): the remise total from the LEDGER adjustment
  // stream (deriveDiscountErosion's identification contract) — replaces
  // the broken `student.remise` read (the field does not exist on Student;
  // the total was always 0).
  const remiseTotal = useMemo(
    () => deriveDiscountErosion(ledger).remiseTotal,
    [ledger],
  );
  const absenceCount = useMemo(
    () => attendance.filter((r) => r.status === "absent_excused" || r.status === "absent_unexcused").length,
    [attendance],
  );

  const inspection = (request: InspectRequest) => request;

  return (
    <DataInspectorProvider academicYear={academicYear} range={range} riskProfiles={riskProfiles}>
      <div className="space-y-4 pb-8" data-testid="analytics-tab">
        <div className="flex items-center justify-between border-b border-border pb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setViewMode("pilotage")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${viewMode === "pilotage" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"}`}>
              <Gauge className="h-3.5 w-3.5" /> Pilotage Exécutif
            </button>
            <button type="button" onClick={() => setViewMode("diagnostic")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${viewMode === "diagnostic" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"}`}>
              <Search className="h-3.5 w-3.5" /> Diagnostic Actif
            </button>
            <button type="button" onClick={() => setViewMode("charts")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${viewMode === "charts" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"}`}>
              <BarChart3 className="h-3.5 w-3.5" /> Flux Financiers (métriques réelles)
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Année active : <strong className="text-foreground font-mono">{academicYear}</strong></span>
            <InspectTrigger request={inspection({ domain: "enrollment", title: "Effectif actif", metric: "student_count", sourceValue: studentCount })} />
          </div>
        </div>

        {viewMode === "pilotage" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-surface-panel/70 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Inspection directe</span>
              <InspectTrigger request={inspection({ domain: "revenue", title: `Revenus ${academicYear}`, metric: "annual_revenue", sourceValue: currentRevenueTotal })} />
              <InspectTrigger request={inspection({ domain: "debt", title: `Créances ${academicYear}`, metric: "outstanding_debt", sourceValue: yearOutstandingDebt, filters: { scope: "academic-year" } })} />
              <InspectTrigger request={inspection({ domain: "debt", title: "Créances toutes années (Pareto)", metric: "outstanding_debt_all_years", sourceValue: currentDebtTotal, filters: { scope: "all" } })} />
              <InspectTrigger request={inspection({ domain: "tranche", title: `Vague 1 — reste dû ${academicYear}`, metric: "tranche_1_remaining", sourceValue: deriveOutstandingDebt(installments.filter((i) => i.trancheNumber === 1), academicYear), filters: { trancheNumber: 1, mode: "remaining", scope: "academic-year" } })} />
              <InspectTrigger request={inspection({ domain: "transport", title: `Restes dûs transport ${academicYear}`, metric: "transport_remaining", sourceValue: deriveOutstandingDebt(installments.filter((i) => i.category === "transport"), academicYear), filters: { transportMode: "remaining" } })} />
              <InspectTrigger request={inspection({ domain: "service", title: "Encaissements services (hors scolarité/transport)", metric: "service_payments", sourceValue: applyAnalyticsFilters(payments, range, { methods: new Set(), categories: new Set(SERVICE_CATEGORIES) }).reduce((s, p) => s + p.amount, 0), filters: { from: range?.from, to: range?.to, categories: SERVICE_CATEGORIES } })} />
              <InspectTrigger request={inspection({ domain: "academic-risk", title: "Élèves à risque pédagogique", metric: "gpa_below_10", sourceValue: riskProfiles.filter((p) => p.gpa !== null && p.gpa < 10).length })} />
              <InspectTrigger request={inspection({ domain: "attendance", title: "Enregistrements de présence", metric: "attendance_records", sourceValue: attendance.length, filters: { attendanceMode: "records" } })} />
              <InspectTrigger request={inspection({ domain: "attendance", title: "Absences enregistrées", metric: "absence_count", sourceValue: absenceCount, filters: { attendanceMode: "absences" } })} />
              <InspectTrigger request={inspection({ domain: "discount", title: "Remises négociées (grand livre)", metric: "discount_total", sourceValue: remiseTotal })} />
            </div>
            <ExecutiveDashboard
              installments={installments}
              ledger={ledger}
              students={students}
              parents={parents}
              classes={classes}
              payments={payments}
              riskProfiles={riskProfiles}
              nowEpochMs={Date.now()}
            />
            <OperationalQueryConsole
              profiles={riskProfiles}
              onOpenStudent={onOpenStudent}
              onOpenParent={onOpenParent}
            />
          </div>
        )}

        {viewMode === "diagnostic" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-surface-panel/70 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Source des matrices</span>
              <InspectTrigger request={inspection({ domain: "academic-risk", title: "Matrice de risque pédagogique", metric: "risk_profiles", sourceValue: riskProfiles.length })} />
              <InspectTrigger request={inspection({ domain: "enrollment", title: "Roster des élèves", metric: "roster", sourceValue: students.length })} />
            </div>
            <OperationalQueryConsole profiles={riskProfiles} onOpenStudent={onOpenStudent} onOpenParent={onOpenParent} />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5"><CrossRiskCard profiles={riskProfiles} /></div>
              <div className="lg:col-span-7"><PivotMatrixCard profiles={riskProfiles} classes={classes} /></div>
            </div>
          </div>
        )}

        {viewMode === "charts" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Ligne de provenance active</span>
              <span className="text-xs font-mono font-semibold text-foreground">{slice.length} PAID · {sliceTotal.toLocaleString("fr-DZ")} DZD</span>
              <InspectTrigger request={inspection({ domain: "revenue", title: "Encaissements filtrés", metric: "filtered_paid_revenue", sourceValue: sliceTotal, filters: { from: range?.from, to: range?.to, methods: [...filters.methods], categories: [...filters.categories] } })} />
            </div>

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

            <div className="space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold text-foreground">Statistiques descriptives</span><InspectTrigger request={inspection({ domain: "revenue", title: "Statistiques sur les paiements filtrés", metric: "payment_stats_total", sourceValue: sliceTotal, filters: { from: range?.from, to: range?.to } })} /></div>
              <StatStrip slice={slice} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-6 space-y-2"><div className="flex justify-end"><InspectTrigger request={inspection({ domain: "payment-method", title: "Mix des méthodes de paiement", metric: "method_mix", sourceValue: sliceTotal })} /></div><MethodMixCard slice={slice} /></div>
              <div className="lg:col-span-6 space-y-2"><div className="flex justify-end"><InspectTrigger request={inspection({ domain: "payment-category", title: "Mix des catégories de paiement", metric: "category_mix", sourceValue: sliceTotal })} /></div><CategoryMixCard slice={slice} /></div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap justify-end gap-2">
                <InspectTrigger request={inspection({ domain: "revenue", title: `Revenus mensuels ${academicYear}`, metric: "monthly_revenue", sourceValue: currentRevenueTotal })} />
                {prevAcademicYear && <InspectTrigger request={inspection({ domain: "revenue", title: `Revenus ${prevAcademicYear}`, metric: "previous_year_revenue", sourceValue: prevRevenue.reduce((sum, point) => sum + point.amount, 0) })} />}
              </div>
              <YoYComparisonCard currentYear={academicYear} previousYear={prevAcademicYear} revenue={revenue} prevRevenue={prevRevenue} />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap justify-end gap-2">
                <InspectTrigger request={inspection({ domain: "debt", title: "Vieillissement des créances (total)", metric: "debt_aging", sourceValue: debtAging.reduce((sum, bucket) => sum + bucket.amount, 0), filters: { scope: "academic-year" } })} />
                <InspectTrigger request={inspection({ domain: "debt", title: "Créances 0–30 j", metric: "debt_aging_0_30", sourceValue: debtAging.find((b) => b.bucket === "0_30")?.amount ?? 0, filters: { agingBucket: "0_30", scope: "academic-year" } })} />
                <InspectTrigger request={inspection({ domain: "debt", title: "Créances 31–60 j", metric: "debt_aging_31_60", sourceValue: debtAging.find((b) => b.bucket === "31_60")?.amount ?? 0, filters: { agingBucket: "31_60", scope: "academic-year" } })} />
                <InspectTrigger request={inspection({ domain: "debt", title: "Créances 61–90 j", metric: "debt_aging_61_90", sourceValue: debtAging.find((b) => b.bucket === "61_90")?.amount ?? 0, filters: { agingBucket: "61_90", scope: "academic-year" } })} />
                <InspectTrigger request={inspection({ domain: "debt", title: "Créances 91–180 j", metric: "debt_aging_91_180", sourceValue: debtAging.find((b) => b.bucket === "91_180")?.amount ?? 0, filters: { agingBucket: "91_180", scope: "academic-year" } })} />
                <InspectTrigger request={inspection({ domain: "debt", title: "Créances > 180 j", metric: "debt_aging_180_plus", sourceValue: debtAging.find((b) => b.bucket === "180_plus")?.amount ?? 0, filters: { agingBucket: "180_plus", scope: "academic-year" } })} />
              </div>
              <AgingCompositionCard debtAging={debtAging} />
            </div>

            <div className="space-y-2">
              <div className="flex justify-end"><InspectTrigger request={inspection({ domain: "debt", title: "Pareto des familles débitrices (toutes années)", metric: "debtors_pareto", sourceValue: currentDebtTotal, filters: { scope: "all" } })} /></div>
              <DebtorsParetoCard topDebtors={riskDebt as DebtSummary[]} />
            </div>
          </div>
        )}
      </div>
    </DataInspectorProvider>
  );
}
