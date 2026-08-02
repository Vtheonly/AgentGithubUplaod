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
export const AGING_COLORS: Record<string, string> = {
  "0_30": "#3FA66E",
  "31_60": "#6EC1E4",
  "61_90": "#C8A98C",
  "91_180": "#C0504D",
  "180_plus": "#836C68",
};

/** Academic years selectable via the AcademicYearSelector in the page header. */
export const AVAILABLE_ACADEMIC_YEARS = ["2023-2024", "2024-2025", "2025-2026", "2026-2027"];
