/**
 * DASHBOARD_THEME — shared Recharts styling config for the dashboard
 * analytics surfaces (T-243, 2026-09-09).
 *
 * Source: the owner's AI-review integration blueprint ("The Design Tokens:
 * Matching your index.css Exactly"), adapted to the repo's rules:
 *   - Surfaces/semantic colors come from the design-token CSS variables
 *     (`src/index.css`, plan §03) with canonical fallbacks — never a second
 *     hard-coded palette. Same pattern as `see-details-modal.tsx`'s
 *     `useChartPalette` (token first, hex fallback for SSR/tests).
 *   - The Recharts tooltip style pins the dark-surface panel tokens so
 *     tooltips match card chrome in both themes.
 *
 * One source of truth for every chart on the dashboard tabs — the overview
 * spline, the weekly rhythm bars and any future chart import from here, so
 * axis ticks, gridlines and tooltips cannot drift between cards (the
 * "Frankenstein collage" failure mode the review warns about).
 */

/** Resolve a design-token CSS variable at runtime, with a canonical fallback. */
function token(name: string, fallback: string): string {
  try {
    if (typeof document === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** Palette for chart strokes/fills — mirrors index.css brand + status tokens
 *  (T-246 midnight refresh; keep in parity with src/index.css). */
export const chartPalette = {
  primary: token("--brand-blue", "#349bd4"),
  primaryDeep: token("--brand-blue-deep", "#216d9b"),
  cyan: token("--brand-cyan", "#3dd6d0"),
  violet: token("--brand-violet", "#8b5cf6"),
  gold: token("--brand-gold", "#eab308"),
  slate: token("--brand-slate", "#3b464c"),
  success: token("--status-success", "#10b981"),
  danger: token("--status-danger", "#ef4444"),
  info: token("--status-info", "#0ea5e9"),
};

/** Recharts shared config — gridlines, axis ticks, tooltip chrome. */
export const DASHBOARD_THEME = {
  // Low-contrast gridlines per the review's harmonization rules.
  gridStroke: "rgba(255, 255, 255, 0.05)",
  axisTick: {
    fill: "hsl(var(--muted-foreground))",
    fontSize: 11,
    fontFamily: "JetBrains Mono, monospace",
  } as const,
  tooltipStyle: {
    backgroundColor: "var(--surface-panel)",
    border: "1px solid hsl(var(--border))",
    borderRadius: "10px",
    color: "var(--foreground-bright)",
    fontSize: "12px",
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
  } as const,
};
