/**
 * Shared types & constants for the Dashboard sub-tabs.
 *
 * Extracted from `dashboard-page.tsx` (Task 2-a) so that OverviewTab,
 * AlertsTab and ReportsTab can live in their own focused files without
 * duplicating these definitions.
 */

/** Sub-tab identifier used by SeeDetailsModal drill-down navigation. */
export type SeeDetailsTab = "revenue" | "demographics" | "debt" | "departments";

/** Demographics shape returned by `repos.dashboard.demographics()`. */
export interface Demographics {
  grade: { label: string; count: number; percent: number }[];
  gender: { label: string; count: number; percent: number }[];
  age: { label: string; count: number; percent: number }[];
  capacity: { label: string; count: number; percent: number }[];
}

/** Colors per debt-aging bucket, used by the debt-aging chart on OverviewTab. */
/**
 * Aging-tier chart colors — resolved from the design-token CSS variables at
 * RUNTIME (never hard-coded hex strings in components, plan §03). Falls back
 * to the canonical palette values when the DOM is unavailable (SSR/tests).
 */
export const AGING_COLORS: Record<string, string> = {
  "0_30": tokenOr("--status-success", "#3fa66e"),
  "31_60": tokenOr("--status-info", "#6ec1e4"),
  "61_90": tokenOr("--status-warning", "#c8a98c"),
  "91_180": tokenOr("--status-danger", "#c0504d"),
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

/** Academic years selectable via the AcademicYearSelector in the page header. */
export const AVAILABLE_ACADEMIC_YEARS = ["2023-2024", "2024-2025", "2025-2026", "2026-2027"];
