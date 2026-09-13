// ============================================================================
// FILE: src/features/dashboard/tabs/analytics-tab.tsx
// ============================================================================
/**
 * AnalyticsTab — the Executive Command Center + the exploration hub.
 *
 * T-339 (61st session, 2026-09-14 — STATS-400): the tab's DEFAULT view is
 * now « Pilotage Exécutif » — the owner-mandated operational decision
 * triggers (tranche-wave velocity, discount erosion, debt triage with the
 * immediate call list, family concentration, transport yield, service
 * yield, sibling index + section imbalance, and the Triple-Risk radar
 * front-and-center) computed by the canonical executive-statistics
 * derivations. The vanity statistics are REMOVED (owner kill list): the
 * payment-amount histogram, the weekday collection heatmap, and the smooth
 * 12-month revenue spline (RevenueTrendExplorer) — school revenue is a
 * staircase of three waves, rendered by the WaveVelocityCard instead.
 *
 * Modes:
 *   1. « Pilotage Exécutif » (DEFAULT): ExecutiveDashboard + the
 *      operational query console (the triple-risk radar list).
 *   2. « Diagnostic Actif »: cross-domain risk matrix + pivot matrix.
 *   3. « Métriques & Flux Financiers »: the surviving REAL charts —
 *      slicers, descriptive statistics strip, YoY like-for-like,
 *      method/category mixes, debtors Pareto, aging composition.
 */

import { useMemo, useState, useCallback } from "react";
import { Search, BarChart3, Gauge } from "lucide-react";
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
import { MethodMixCard, CategoryMixCard } from "../components/analytics/mix-cards";
import { YoYComparisonCard } from "../components/analytics/yoy-comparison-card";
import { AgingCompositionCard } from "../components/analytics/aging-composition-card";
import { DebtorsParetoCard } from "../components/analytics/debtors-pareto-card";
import { ExecutiveDashboard } from "../components/analytics/executive-cards";

// The cross-domain query engine (the Triple-Risk radar source).
import {
  evaluateStudentRiskProfiles,
  type StudentRiskProfile,
} from "../components/analytics/operational-query-engine";
import { OperationalQueryConsole } from "../components/analytics/operational-query-console";
import { PivotMatrixCard } from "../components/analytics/pivot-matrix-card";
import { CrossRiskCard } from "../components/analytics/cross-risk-card";

const ALL_METHODS: PaymentMethod[] = ["cash", "check", "transfer"];

type ViewMode = "pilotage" | "diagnostic" | "charts";

export interface AnalyticsTabProps {
  revenue: RevenuePoint[];
  prevRevenue: RevenuePoint[];
  academicYear: string;
  prevAcademicYear: string | null;
  debtAging: DebtByAgingBucket[];
  /** Top-10 display slice (the drill-down tables). */
  topDebtors: DebtSummary[];
  /**
   * T-351 (DASH-401): the FULL reactive debt-summaries stream. The risk
   * engine must see every debtor family — the previous top-10-only feed
   * evaluated families ranked 11+ as debt 0. The Pareto card also consumes
   * it (derivePareto self-limits to its top N).
   */
  debtSummaries?: readonly DebtSummary[];
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
  debtSummaries,
  payments,
  range,
  onOpenStudent,
  onOpenParent,
}: AnalyticsTabProps) {
  const repos = useRepositories();

  // Load operational datasets for the executive + cross-domain engines.
  // T-339: installments (the wave stream) + ledger (the remise census)
  // join the existing student/parent/class streams.
  const students = useObservable(() => repos.students.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const assessments = useObservable(() => repos.grades.observeForClass(""), []);
  const attendance = useObservable(() => repos.attendance.observeByStudent("", "2020-01-01", "2030-12-31"), []);
  const installments = useObservable(() => repos.installments.observe(), []);
  const ledger = useObservable(() => repos.ledger.observe(), []);

  // Mode switcher: "pilotage" (the executive default) / "diagnostic" / "charts".
  const [viewMode, setViewMode] = useState<ViewMode>("pilotage");

  // Slicer filters state for the charts view
  const [filters, setFilters] = useState<AnalyticsFilterState>(NO_ANALYTICS_FILTERS);

  // Compute live multi-risk profiles across all school dimensions.
  // T-351 (DASH-401): the FULL debt stream (every debtor family), not the
  // top-10 display slice.
  const riskDebt = debtSummaries ?? topDebtors;
  const riskProfiles = useMemo<StudentRiskProfile[]>(() => {
    return evaluateStudentRiskProfiles({
      students,
      parents,
      classes,
      subjects,
      assessments,
      attendance,
      debtSummaries: riskDebt,
    });
  }, [students, parents, classes, subjects, assessments, attendance, riskDebt]);

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

  return (
    <div className="space-y-4 pb-8" data-testid="analytics-tab">
      {/* Top View Mode Navigation */}
      <div className="flex items-center justify-between border-b border-border pb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setViewMode("pilotage")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${
              viewMode === "pilotage"
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-surface-panel border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Gauge className="h-3.5 w-3.5" />
            Pilotage Exécutif
          </button>
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
            Diagnostic Actif
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
            Flux Financiers (métriques réelles)
          </button>
        </div>

        <div className="text-xs text-muted-foreground">
          Année active : <strong className="text-foreground font-mono">{academicYear}</strong>
        </div>
      </div>

      {/* VIEW 0 (DEFAULT): THE EXECUTIVE COMMAND CENTER */}
      {viewMode === "pilotage" && (
        <div className="space-y-4">
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

          {/* The radar's full actionable list — the operational console
              (triple-risk presets, per-student drill-down). */}
          <OperationalQueryConsole
            profiles={riskProfiles}
            onOpenStudent={onOpenStudent}
            onOpenParent={onOpenParent}
          />
        </div>
      )}

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

      {/* VIEW 2: STATISTICAL CHARTS — only the REAL-data survivors of the
          T-339 vanity purge (histogram, heatmap, and the revenue spline
          were REMOVED per the owner's kill list). */}
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
            filteredTotal={slice.reduce((s, p) => s + p.amount, 0)}
            totalCount={unfilteredCount}
          />

          {/* Row 1 — Descriptive statistics strip */}
          <StatStrip slice={slice} />

          {/* Row 2 — Mix Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-6">
              <MethodMixCard slice={slice} />
            </div>
            <div className="lg:col-span-6">
              <CategoryMixCard slice={slice} />
            </div>
          </div>

          {/* Row 3 — YoY Comparison (like-for-like REAL months) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-12">
              <YoYComparisonCard
                currentYear={academicYear}
                previousYear={prevAcademicYear}
                revenue={revenue}
                prevRevenue={prevRevenue}
              />
            </div>
          </div>

          {/* Row 4 — Aging Composition (the debt context) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-12">
              <AgingCompositionCard debtAging={debtAging} />
            </div>
          </div>

          {/* Row 5 — Debtors Pareto (T-351: the full stream — derivePareto
              self-limits to its top N, so the curve reflects the real
              debtor population, not the display slice) */}
          <DebtorsParetoCard topDebtors={riskDebt as DebtSummary[]} />
        </div>
      )}
    </div>
  );
}
