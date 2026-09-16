// ============================================================================
// FILE: elimtiyaz-desktop/src/shared/ui/dashboard-theme.ts
// ============================================================================

/**
 * DASHBOARD_THEME — Unified design tokens and styling configuration for
 * dashboard analytics and Recharts visualizations.
 *
 * Provides single-source-of-truth tokens for chart strokes, fills, tooltips,
 * axis typography, and ambient card glows.
 */

function token(name: string, fallback: string): string {
  try {
    if (typeof document === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** Palette for chart strokes/fills — mirrors index.css brand & status tokens */
export const chartPalette = {
  primary: token("--brand-blue", "#349bd4"),
  primaryDeep: token("--brand-blue-deep", "#216d9b"),
  primaryLight: token("--brand-blue-light", "#52b6eb"),
  cyan: token("--brand-cyan", "#3dd6d0"),
  violet: token("--brand-violet", "#8b5cf6"),
  gold: token("--brand-gold", "#eab308"),
  coral: token("--brand-coral", "#f43f5e"),
  slate: token("--brand-slate", "#3b464c"),
  success: token("--status-success", "#10b981"),
  danger: token("--status-danger", "#ef4444"),
  warning: token("--status-warning", "#f59e0b"),
  info: token("--status-info", "#0ea5e9"),
};

/** Shared Recharts styling configuration */
export const DASHBOARD_THEME = {
  gridStroke: "rgba(255, 255, 255, 0.06)",
  axisTick: {
    fill: "hsl(var(--muted-foreground))",
    fontSize: 11,
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    letterSpacing: "-0.02em",
  } as const,
  tooltipStyle: {
    backgroundColor: "var(--surface-elevated, #181d30)",
    border: "1px solid hsl(var(--border) / 0.8)",
    borderRadius: "10px",
    color: "var(--foreground-bright, #f8fafc)",
    fontSize: "12px",
    padding: "8px 12px",
    boxShadow:
      "0 12px 28px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)",
    backdropFilter: "blur(12px)",
  } as const,
  barRadius: [4, 4, 0, 0] as [number, number, number, number],
  horizontalBarRadius: [0, 4, 4, 0] as [number, number, number, number],
};
