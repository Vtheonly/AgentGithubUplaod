/**
 * AnalyticsTab — the Power BI-style analytics report page (T-255..T-257,
 * 38th session, 2026-09-09 — UI-307; the owner's "more Power BI–type
 * visualizations" mandate).
 *
 * Layout (12-column grid, same dual-stage skeleton as the Overview):
 *   Row 0  slicer bar — method + category chips that CROSS-FILTER every
 *          payments-derived card below (stat strip, mix cards, heatmap,
 *          histogram, and the dashed "filtré" overlay on the trend chart);
 *   Row 1  statistics strip — count / total / mean / median / best month /
 *          volatility over the filtered slice;
 *   Row 2  hero trend explorer (8 cols) + method/category mix pair (4 cols);
 *   Row 3  YoY comparison + amount distribution;
 *   Row 4  collection heatmap (8 cols) + aging composition (4 cols);
 *   Row 5  top-debtors Pareto (6) + aging table continues (6 → the aging
 *          card spans rows 4–5 in the right rail).
 *
 * Data flow (T-088 single-fetch pipeline PRESERVED — the tab never
 * fetches): the page passes the dashboard aggregates (revenue, debtAging,
 * topDebtors), the canonical payments stream, the academic-year range,
 * and the PREVIOUS year's revenue series (loaded by the page for the
 * like-for-like YoY window). The tab's only state is the slicer
 * selection — every derivation is a useMemo of the props.
 */
import { useMemo, useState, useCallback } from "react";
import type { RevenuePoint, DebtByAgingBucket } from "../../../domain/model/operations";
import type { Payment, PaymentMethod, PaymentCategory, DebtSummary } from "../../../domain/model/payment";
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

const ALL_METHODS: PaymentMethod[] = ["cash", "check", "transfer"];

export interface AnalyticsTabProps {
  /** The repository's canonical monthly series for the selected period. */
  revenue: RevenuePoint[];
  /** The PREVIOUS academic year's series (same month window) — YoY. */
  prevRevenue: RevenuePoint[];
  /** Selected academic year code (display). */
  academicYear: string;
  /** The previous academic year code (display; null = unavailable). */
  prevAcademicYear: string | null;
  debtAging: DebtByAgingBucket[];
  topDebtors: DebtSummary[];
  /** The canonical payments stream (page-level subscription). */
  payments: readonly Payment[];
  /** The academic-year date range the aggregates were loaded for. */
  range?: { from: string; to: string };
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
}: AnalyticsTabProps) {
  const [filters, setFilters] = useState<AnalyticsFilterState>(NO_ANALYTICS_FILTERS);

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

  const reset = useCallback(() => setFilters(NO_ANALYTICS_FILTERS), []);

  // The canonical filtered slice — every payments-derived card consumes
  // THIS (one derivation, consistent cross-filtering across the tab).
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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-6" data-testid="analytics-tab">
      {/* Row 0 — the slicer bar (cross-filters the payments-derived cards). */}
      <div className="lg:col-span-12">
        <AnalyticsSlicers
          filters={filters}
          onToggleMethod={toggleMethod}
          onToggleCategory={toggleCategory}
          onReset={reset}
          methods={ALL_METHODS}
          categories={categories}
          filteredCount={slice.length}
          filteredTotal={filteredTotal}
          totalCount={unfilteredCount}
        />
      </div>

      {/* Row 1 — the statistics strip (filtered descriptive statistics). */}
      <div className="lg:col-span-12">
        <StatStrip slice={slice} />
      </div>

      {/* Row 2 — hero trend (8) + mix pair (4). */}
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

      {/* Row 3 — YoY comparison + amount distribution. */}
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

      {/* Row 4 — collection heatmap (8) + aging composition rail (4). */}
      <div className="lg:col-span-8">
        <CollectionHeatmapCard slice={slice} range={range} />
      </div>
      <div className="lg:col-span-4">
        <AgingCompositionCard debtAging={debtAging} />
      </div>

      {/* Row 5 — the debtors Pareto. */}
      <div className="lg:col-span-12">
        <DebtorsParetoCard topDebtors={topDebtors} />
      </div>
    </div>
  );
}
