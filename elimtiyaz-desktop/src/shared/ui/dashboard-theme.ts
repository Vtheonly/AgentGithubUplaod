// ============================================================================
// FILE: elimtiyaz-desktop/src/shared/ui/dashboard-theme.ts
// ============================================================================

/**
 * DASHBOARD_THEME — Unified design tokens and styling configuration for
 * dashboard analytics and Recharts visualizations.
 *
 * Provides single-source-of-truth tokens for chart strokes, fills, tooltips,
 * axis typography, and ambient card glows.
 *
 * T-546 (UI-352) — LIVE TOKEN ACCESS, the stale-capture fix: the previous
 * module-level consts read `getComputedStyle` ONCE at import time, freezing
 * every chart onto the BOOT theme — switching to Clair Épuré (or any custom
 * palette) never reached the charts, and the hex FALLBACKS were the
 * midnight-tuned values (status-success #10b981 on white = 2.3:1). Every
 * member of `chartPalette` and `DASHBOARD_THEME` is now a GETTER that
 * re-resolves the CSS variable on each ACCESS — the export shapes are
 * byte-compatible (`chartPalette.primary`, `DASHBOARD_THEME.gridStroke`
 * keep compiling; consumers need no change), and the values always reflect
 * the ACTIVE palette. The fallbacks remain the midnight hexes (the jsdom
 * test environment has no theme applied — parity with the previous
 * snapshots) and are the PARITY-CONTRACT twins of index.css/:root.
 */

/** Resolve a CSS custom property with a canonical fallback (the ONE shared
 *  resolver — tabs/types.ts AGING_COLORS and sparkline-kpi-card.tsx reuse
 *  it; the former local `tokenOr` twin was consolidated here per §6/§9). */
export function resolveToken(name: string, fallback: string): string {
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

/** Is the app currently on a DARK palette? (the engine toggles
 *  documentElement.dark/.light + data-theme on every apply). */
export function isDarkThemeActive(): boolean {
  try {
    if (typeof document === "undefined") return true;
    const root = document.documentElement;
    return !root.classList.contains("light");
  } catch {
    return true;
  }
}

/** HSL-channel token → concrete color for SVG attributes (presentation
 *  attributes do NOT support var()/hsl(var()) — resolve in JS). */
function hslTokenOr(varName: string, fallback: string): string {
  const channels = resolveToken(varName, fallback);
  // `--muted-foreground` and friends hold "h s% l%" channel triplets.
  return channels.startsWith("hsl") ? channels : `hsl(${channels})`;
}

/** Palette for chart strokes/fills — mirrors index.css brand & status tokens.
 *  Live getters: each access re-reads the ACTIVE palette (T-546). */
export const chartPalette: Record<
  "primary" | "primaryDeep" | "primaryLight" | "cyan" | "violet" | "gold" | "coral" | "slate" | "success" | "danger" | "warning" | "info",
  string
> = {
  get primary() {
    return resolveToken("--brand-blue", "#349bd4");
  },
  get primaryDeep() {
    return resolveToken("--brand-blue-deep", "#216d9b");
  },
  get primaryLight() {
    return resolveToken("--brand-blue-light", "#52b6eb");
  },
  get cyan() {
    return resolveToken("--brand-cyan", "#3dd6d0");
  },
  get violet() {
    return resolveToken("--brand-violet", "#8b5cf6");
  },
  get gold() {
    return resolveToken("--brand-gold", "#eab308");
  },
  get coral() {
    return resolveToken("--brand-coral", "#f43f5e");
  },
  get slate() {
    return resolveToken("--brand-slate", "#3b464c");
  },
  get success() {
    return resolveToken("--status-success", "#10b981");
  },
  get danger() {
    return resolveToken("--status-danger", "#ef4444");
  },
  get warning() {
    return resolveToken("--status-warning", "#f59e0b");
  },
  get info() {
    return resolveToken("--status-info", "#0ea5e9");
  },
};

/** Shared Recharts styling configuration — theme-aware getters (T-546). */
export const DASHBOARD_THEME = {
  /** CartesianGrid stroke — VISIBLE on both canvases: the old
   *  rgba(255,255,255,0.06) was white-on-white in Clair Épuré. */
  get gridStroke(): string {
    return isDarkThemeActive()
      ? "rgba(255, 255, 255, 0.08)"
      : "rgba(15, 23, 42, 0.12)";
  },
  /** Axis ticks — the fill is RESOLVED in JS (SVG presentation attributes
   *  cannot parse hsl(var()); the old literal silently degraded). */
  get axisTick(): {
    fill: string;
    fontSize: number;
    fontFamily: string;
    letterSpacing: string;
  } {
    return {
      fill: hslTokenOr("--muted-foreground", "217 19% 65%"),
      fontSize: 11,
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
      letterSpacing: "-0.02em",
    };
  },
  /** Recharts tooltip surface — rides the themed popover/border tokens; the
   *  shadow softens on light (the midnight rgba(0,0,0,0.6) read as mud). */
  get tooltipStyle(): Record<string, string> {
    return {
      backgroundColor: "var(--surface-elevated, #181d30)",
      border: "1px solid hsl(var(--border) / 0.8)",
      borderRadius: "10px",
      color: "var(--foreground-bright, #f8fafc)",
      fontSize: "12px",
      padding: "8px 12px",
      boxShadow: isDarkThemeActive()
        ? "0 12px 28px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)"
        : "0 12px 24px -6px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.04)",
      backdropFilter: "blur(12px)",
    };
  },
  barRadius: [4, 4, 0, 0] as [number, number, number, number],
  horizontalBarRadius: [0, 4, 4, 0] as [number, number, number, number],
};
