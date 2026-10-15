/**
 * Shared types & constants for the Dashboard sub-tabs.
 *
 * Extracted from `dashboard-page.tsx` (Task 2-a) so that OverviewTab,
 * AlertsTab and ReportsTab can live in their own focused files without
 * duplicating these definitions.
 */

import { resolveToken } from "../../../shared/ui/dashboard-theme";

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

/**
 * Aging-tier chart colors — resolved from the design-token CSS variables at
 * RUNTIME (never hard-coded hex strings in components, plan §03). Falls back
 * to the canonical palette values when the DOM is unavailable (SSR/tests).
 *
 * T-546 (UI-352): the map is now a LIVE Proxy — every bucket lookup re-reads
 * the ACTIVE palette (the old module-load snapshot froze the aging chart
 * onto the boot theme; Clair Épuré kept the midnight hues). The former local
 * `tokenOr` twin was consolidated into the shared `resolveToken`
 * (src/shared/ui/dashboard-theme.ts) per the Existing-Implementation-First
 * rule — one resolver, not two.
 */
export const AGING_COLORS: Record<string, string> = new Proxy(
  {} as Record<string, string>,
  {
    get(_target, prop: string | symbol): string | undefined {
      if (typeof prop !== "string") return undefined;
      switch (prop) {
        case "0_30":
          return resolveToken("--status-success", "#10b981");
        case "31_60":
          return resolveToken("--status-info", "#0ea5e9");
        case "61_90":
          return resolveToken("--status-warning", "#f59e0b");
        case "91_180":
          return resolveToken("--status-danger", "#ef4444");
        case "180_plus":
          return resolveToken("--brand-brown", "#836c68");
        default:
          return undefined;
      }
    },
  },
);

// T-408 (ACAD-509): AVAILABLE_ACADEMIC_YEARS — the hardcoded four-year
// selector list — is REMOVED. The selectable years derive from the CANONICAL
// academic_years repository in DashboardPage (the current year defaults the
// selection); a static list offered years the live database never contained.
