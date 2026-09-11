// ============================================================================
// FILE: src/features/dashboard/tabs/analytics-tab.tsx
// ============================================================================
/**
 * AnalyticsTab — The Actionable Decision Support & Exploration Hub.
 *
 * Offers two operational modes:
 *   1. « Exploration & Diagnostic Actif » :
 *      - Operational Query Console (instant interrogation & search)
 *      - Cross-Domain Risk Matrix (combining grades + attendance + fees)
 *      - Multi-Dimensional Pivot Matrix (PowerBI-style slice-and-dice)
 *   2. « Métriques & Flux Financiers » :
 *      - Slicers bar (cross-filters live charts)
 *      - Descriptive Statistics Strip
 *      - Hero Revenue Trend Explorer
 *      - Payment Mix & Category breakdown
 *      - Collection Heatmap & YoY comparison
 *      - Debtors Pareto & Aging Composition
 */

import { useMemo, useState, useCallback } from "react";
import { Search, BarChart3, Layers, Filter } from "lucide-react";
import type { RevenuePoint, DebtByAgingBucket } from "../../../domain/model/operations";
import type { Payment, PaymentMethod, PaymentCategory, DebtSummary } from "../../../domain/model/payment";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import {
  applyAnalyticsFilters,
  presentCategories,
  NO_ANALYTICS_FILTERS,
  type AnalyticsFilterState,
} from "../components/analytics/analytics-derivations";
import { AnalyticsSlicers } from "../components/analytics/analytics-slicers";
import { StatStrip } from "../components/analytics/stat-strip";
import { RevenueTrendExplorer } from "../components/analytics/revenue-trend-explorer";
import { MethodMixCard, CategoryMixCard } from "../components/analytics/mix-cards";
import { CollectionHeatmapCard } from "../components/analytics/collection-heatmap-card";
import { AmountHistogramCard } from "../components/analytics/amount-histogram-card";
import { YoYComparisonCard } from "../components/analytics/yoy-comparison-card";
import { AgingCompositionCard } from "../components/analytics/aging-composition-card";
import { DebtorsParetoCard } from "../components/analytics/debtors-pareto-card";

// New Diagnostic & Query Engine components
import {
  evaluateStudentRiskProfiles,
  type StudentRiskProfile,
} from "../components/analytics/operational-query-engine";
import { OperationalQueryConsole } from "../components/analytics/operational-query-console";
import { PivotMatrixCard } from "../components/analytics/pivot-matrix-card";
import { CrossRiskCard } from "../components/analytics/cross-risk-card";

const ALL_METHODS: PaymentMethod[] = ["cash", "check", "transfer"];

export interface AnalyticsTabProps {
  revenue: RevenuePoint[];
  prevRevenue: RevenuePoint[];
  academicYear: string;
  prevAcademicYear: string | null;
  debtAging: DebtByAgingBucket[];
  topDebtors: DebtSummary[];
  payments: readonly Payment[];
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
  payments,
  range,
  onOpenStudent,
  onOpenParent,
}: AnalyticsTabProps) {
  const repos = useRepositories();

  // Load operational datasets for the deep cross-domain query engine
  const students = useObservable(() => repos.students.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const assessments = useObservable(() => repos.grades.observeForClass(""), []);
  const attendance = useObservable(() => repos.attendance.observeByStudent("", "2020-01-01", "2030-12-31"), []);

  // Mode switcher: "diagnostic" vs "charts"
  const [viewMode, setViewMode] = useState<"diagnostic" | "charts">("diagnostic");

  // Slicer filters state for the charts view
  const [filters, setFilters] = useState<AnalyticsFilterState>(NO_ANALYTICS_FILTERS);

  // Compute live multi-risk profiles across all school dimensions
  const riskProfiles = useMemo<StudentRiskProfile[]>(() => {
    return evaluateStudentRiskProfiles({
      students,
      parents,
      classes,
      subjects,
      assessments,
      attendance,
      debtSummaries: topDebtors,
    });
  }, [students, parents, classes, subjects, assessments, attendance, topDebtors]);

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
  const filteredTotal = useMemo(() => slice.reduce((s, p) => s + p.amount, 0), [slice]);

  return (
    <div className="space-y-4 pb-8" data-testid="analytics-tab">
      {/* Top View Mode Navigation */}
      <div className="flex items-center justify-between border-b border-border pb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode("diagnostic")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${
              viewMode === "diagnostic"
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            Diagnostic Actif & Questions Directes
          </button>

          <button
            type="button"
            onClick={() => setViewMode("charts")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${
              viewMode === "charts"
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Flux Financiers & Visualisations Power BI
          </button>
        </div>

        <div className="text-xs text-muted-foreground">
          Année active : <strong className="text-foreground font-mono">{academicYear}</strong>
        </div>
      </div>

      {/* VIEW 1: DIAGNOSTIC & OPERATIONAL QUERY CONSOLE */}
      {viewMode === "diagnostic" && (
        <div className="space-y-4">
          {/* Main Query Console */}
          <OperationalQueryConsole
            profiles={riskProfiles}
            onOpenStudent={onOpenStudent}
            onOpenParent={onOpenParent}
          />

          {/* Secondary Analytical Row: Vulnerability Radar + Multi-Dimensional Pivot Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5">
              <CrossRiskCard profiles={riskProfiles} />
            </div>

            <div className="lg:col-span-7">
              <PivotMatrixCard profiles={riskProfiles} classes={classes} />
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: STATISTICAL & POWER BI FINANCIAL FLOW CHARTS */}
      {viewMode === "charts" && (
        <div className="space-y-4">
          {/* Row 0 — Slicers bar */}
          <AnalyticsSlicers
            filters={filters}
            onToggleMethod={toggleMethod}
            onToggleCategory={toggleCategory}
            onReset={resetFilters}
            methods={ALL_METHODS}
            categories={categories}
            filteredCount={slice.length}
            filteredTotal={filteredTotal}
            totalCount={unfilteredCount}
          />

          {/* Row 1 — Descriptive statistics strip */}
          <StatStrip slice={slice} />

          {/* Row 2 — Trend Explorer + Mix Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8">
              <RevenueTrendExplorer
                revenue={revenue}
                filteredSlice={slice}
                filters={filters}
              />
            </div>
            <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
              <MethodMixCard slice={slice} />
              <CategoryMixCard slice={slice} />
            </div>
          </div>

          {/* Row 3 — YoY Comparison + Amount Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-6">
              <YoYComparisonCard
                currentYear={academicYear}
                previousYear={prevAcademicYear}
                revenue={revenue}
                prevRevenue={prevRevenue}
              />
            </div>
            <div className="lg:col-span-6">
              <AmountHistogramCard slice={slice} />
            </div>
          </div>

          {/* Row 4 — Collection Heatmap + Aging Composition */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8">
              <CollectionHeatmapCard slice={slice} range={range} />
            </div>
            <div className="lg:col-span-4">
              <AgingCompositionCard debtAging={debtAging} />
            </div>
          </div>

          {/* Row 5 — Debtors Pareto */}
          <DebtorsParetoCard topDebtors={topDebtors} />
        </div>
      )}
    </div>
  );
}