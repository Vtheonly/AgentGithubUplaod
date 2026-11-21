// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/use-analytics-data.ts
// ============================================================================
/**
 * E6.9 (DUP-029, D-U1): the dashboard's Analytics view-model — the
 * previous-year comparison lane, extracted from dashboard-page.tsx.
 *
 * Owns (previously inline in the page component):
 *   - the loadable-previous-year resolution (only a year that actually
 *     exists in the canonical academic_years repository is comparable);
 *   - the shifted-window previous-year revenue fetch (the year-over-year
 *     comparison series — the SAME calendar window one year back, so a
 *     "Sep–Nov" selection never compares against a full prior year).
 *
 * The hook is the D-U1 view-model the T-596 overhaul composes onto.
 */
import { useEffect, useState } from "react";
import { useRepositories } from "../../app/providers/repository-provider";
import type { RevenuePoint } from "../../domain/model/operations";
import type { AcademicYearRange } from "./academic-year-selector";
import {
  previousAcademicYear,
  shiftIsoYearBack,
} from "./components/analytics/analytics-derivations";

export interface AnalyticsViewModel {
  /** The previous year's revenue over the SAME shifted window ([] when the
   *  previous year is not in the repository — never fabricated). */
  prevRevenue: RevenuePoint[];
  /** The comparable previous year's code (null = no YoY lane). */
  prevAcademicYear: string | null;
}

export function useAnalyticsData(
  yearRange: AcademicYearRange,
  availableYears: readonly string[],
): AnalyticsViewModel {
  const repos = useRepositories();
  const [prevRevenue, setPrevRevenue] = useState<RevenuePoint[]>([]);

  const prevYearCode = previousAcademicYear(yearRange.academicYear);
  const loadablePrevYear =
    prevYearCode && availableYears.includes(prevYearCode)
      ? prevYearCode
      : null;

  useEffect(() => {
    const currentRange = yearRange.range;
    if (!loadablePrevYear || !currentRange) {
      setPrevRevenue([]);
      return;
    }
    void (async () => {
      const shifted = {
        from: shiftIsoYearBack(currentRange.from),
        to: shiftIsoYearBack(currentRange.to),
      };
      const prev = await repos.dashboard.revenueForRange(
        loadablePrevYear,
        shifted,
      );
      setPrevRevenue(prev.ok ? prev.value : []);
    })();
  }, [repos.dashboard, loadablePrevYear, yearRange.range]);

  return { prevRevenue, prevAcademicYear: loadablePrevYear };
}
