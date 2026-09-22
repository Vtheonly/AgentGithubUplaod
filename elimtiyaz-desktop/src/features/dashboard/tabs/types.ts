/**
 * Shared types & constants for the Dashboard sub-tabs.
 *
 * Extracted from `dashboard-page.tsx` (Task 2-a) so that OverviewTab,
 * AlertsTab and ReportsTab can live in their own focused files without
 * duplicating these definitions.
 */

/** Sub-tab identifier used by SeeDetailsModal drill-down navigation. */
export type SeeDetailsTab = "revenue" | "demographics" | "debt" | "departments";

/**
 * Demographics shape returned by `repos.dashboard.demographics()`.
 *
 * T-339 (STATS-400): the `capacity` fill-rate slice was REMOVED (no fake
 * ceilings — the section-imbalance derivation replaced the gauges).
 */
export interface Demographics {
  grade: { label: string; count: number; percent: number }[];
  gender: { label: string; count: number; percent: number }[];
  age: { label: string; count: number; percent: number }[];
}

/** Colors per debt-aging bucket, used by the debt-aging chart on OverviewTab. */
/**
 * Aging-tier chart colors — resolved from the design-token CSS variables at
 * RUNTIME (never hard-coded hex strings in components, plan §03). Falls back
 * to the canonical palette values when the DOM is unavailable (SSR/tests).
 */
export const AGING_COLORS: Record<string, string> = {
  "0_30": tokenOr("--status-success", "#10b981"),
  "31_60": tokenOr("--status-info", "#0ea5e9"),
  "61_90": tokenOr("--status-warning", "#f59e0b"),
  "91_180": tokenOr("--status-danger", "#ef4444"),
  "180_plus": tokenOr("--brand-brown", "#836c68"),
};

/** Resolve a CSS design token with a canonical fallback. */
function tokenOr(name: string, fallback: string): string {
  try {
    if (typeof document === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

// T-408 (ACAD-509): AVAILABLE_ACADEMIC_YEARS — the hardcoded four-year
// selector list — is REMOVED. The selectable years derive from the CANONICAL
// academic_years repository in DashboardPage (the current year defaults the
// selection); a static list offered years the live database never contained.
