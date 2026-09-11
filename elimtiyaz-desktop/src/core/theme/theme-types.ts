// ============================================================================
// FILE: src/core/theme/theme-types.ts
// ============================================================================

export interface ThemeColors {
  // Primary & Brand
  primary: string;           // Hex e.g. #349bd4
  primaryForeground: string; // Text color on primary e.g. #ffffff
  brandGold: string;
  brandCyan: string;
  brandViolet: string;

  // Backgrounds & Surfaces
  surfaceBackground: string; // Main canvas background e.g. #0b0d14
  surfacePanel: string;      // Cards, panels e.g. #111523
  surfaceElevated: string;   // Modals, dropdowns e.g. #181d30
  surfaceHover: string;      // Table & button hover state e.g. #222842

  // Typography & Borders
  textForeground: string;    // Main text e.g. #f8fafc
  textMuted: string;         // Secondary / placeholder e.g. #94a3b8
  borderColor: string;       // Card and input borders e.g. #1e293b

  // Status Alerts
  statusSuccess: string;
  statusWarning: string;
  statusDanger: string;
  statusInfo: string;
}

export interface CustomThemePalette {
  id: string;
  name: string;
  isDark: boolean;
  isBuiltIn?: boolean;
  colors: ThemeColors;
}

// Convert Hex to HSL space-separated string (e.g. "201 68% 52%") for Tailwind
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let c = hex.replace("#", "").trim();
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const num = parseInt(c, 16) || 0;
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hexToHslString(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return `${h} ${s}% ${l}%`;
}

// Built-in presets
export const PRESET_THEMES: CustomThemePalette[] = [
  {
    id: "dark",
    name: "Sombre Minuit (Défaut)",
    isDark: true,
    isBuiltIn: true,
    colors: {
      primary: "#349bd4",
      primaryForeground: "#ffffff",
      brandGold: "#eab308",
      brandCyan: "#3dd6d0",
      brandViolet: "#8b5cf6",
      surfaceBackground: "#0b0d14",
      surfacePanel: "#111523",
      surfaceElevated: "#181d30",
      surfaceHover: "#222842",
      textForeground: "#f8fafc",
      textMuted: "#94a3b8",
      borderColor: "#1e293b",
      statusSuccess: "#10b981",
      statusWarning: "#f59e0b",
      statusDanger: "#ef4444",
      statusInfo: "#0ea5e9",
    },
  },
  {
    id: "light",
    name: "Clair Épuré",
    isDark: false,
    isBuiltIn: true,
    colors: {
      primary: "#2563eb",
      primaryForeground: "#ffffff",
      brandGold: "#d97706",
      brandCyan: "#0891b2",
      brandViolet: "#7c3aed",
      surfaceBackground: "#f8fafc",
      surfacePanel: "#ffffff",
      surfaceElevated: "#f1f5f9",
      surfaceHover: "#e2e8f0",
      textForeground: "#0f172a",
      textMuted: "#64748b",
      borderColor: "#cbd5e1",
      statusSuccess: "#059669",
      statusWarning: "#d97706",
      statusDanger: "#dc2626",
      statusInfo: "#0284c7",
    },
  },
  {
    id: "emerald",
    name: "Forêt Émeraude",
    isDark: true,
    isBuiltIn: true,
    colors: {
      primary: "#10b981",
      primaryForeground: "#ffffff",
      brandGold: "#f59e0b",
      brandCyan: "#14b8a6",
      brandViolet: "#a855f7",
      surfaceBackground: "#06140e",
      surfacePanel: "#0a1f18",
      surfaceElevated: "#0f2e24",
      surfaceHover: "#174234",
      textForeground: "#ecfdf5",
      textMuted: "#6ee7b7",
      borderColor: "#134e3a",
      statusSuccess: "#10b981",
      statusWarning: "#f59e0b",
      statusDanger: "#ef4444",
      statusInfo: "#06b6d4",
    },
  },
  {
    id: "amethyst",
    name: "Améthyste Royale",
    isDark: true,
    isBuiltIn: true,
    colors: {
      primary: "#a855f7",
      primaryForeground: "#ffffff",
      brandGold: "#fbbf24",
      brandCyan: "#38bdf8",
      brandViolet: "#c084fc",
      surfaceBackground: "#0f071c",
      surfacePanel: "#190e2d",
      surfaceElevated: "#23143f",
      surfaceHover: "#321d58",
      textForeground: "#faf5ff",
      textMuted: "#c084fc",
      borderColor: "#3b1e6d",
      statusSuccess: "#34d399",
      statusWarning: "#fbbf24",
      statusDanger: "#f87171",
      statusInfo: "#60a5fa",
    },
  },
  {
    id: "slate_amber",
    name: "Ardoise & Ambre",
    isDark: true,
    isBuiltIn: true,
    colors: {
      primary: "#f59e0b",
      primaryForeground: "#000000",
      brandGold: "#fbbf24",
      brandCyan: "#22d3ee",
      brandViolet: "#818cf8",
      surfaceBackground: "#0f172a",
      surfacePanel: "#1e293b",
      surfaceElevated: "#334155",
      surfaceHover: "#475569",
      textForeground: "#f8fafc",
      textMuted: "#94a3b8",
      borderColor: "#334155",
      statusSuccess: "#10b981",
      statusWarning: "#f59e0b",
      statusDanger: "#f43f5e",
      statusInfo: "#38bdf8",
    },
  },
];