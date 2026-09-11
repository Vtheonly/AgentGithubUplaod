// ============================================================================
// FILE: src/core/theme/theme-engine.ts
// ============================================================================

import {
  PRESET_THEMES,
  hexToHslString,
  type CustomThemePalette,
} from "./theme-types";

const CUSTOM_THEMES_STORAGE_KEY = "el-imtiyaz:custom-themes";

export function loadStoredCustomThemes(): CustomThemePalette[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredCustomThemes(themes: CustomThemePalette[]): void {
  try {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
  } catch {
    // ignore
  }
}

export function findThemeById(
  id: string,
  customThemes: CustomThemePalette[] = [],
): CustomThemePalette {
  const all = [...PRESET_THEMES, ...customThemes];
  return all.find((t) => t.id === id) ?? PRESET_THEMES[0];
}

/**
 * Injects the custom palette directly onto document.documentElement.style,
 * immediately repainting all buttons, cards, text, and inputs.
 */

// Inside src/core/theme/theme-engine.ts

export function applyThemePaletteToDom(palette: CustomThemePalette): void {
  const root = document.documentElement;
  const body = document.body;
  const { colors, isDark } = palette;

  // 1. Toggle dark/light class on <html>
  root.classList.remove("dark", "light");
  root.classList.add(isDark ? "dark" : "light");
  root.setAttribute("data-theme", palette.id);

  // 2. Set direct background color on root and body
  root.style.backgroundColor = colors.surfaceBackground;
  root.style.color = colors.textForeground;
  if (body) {
    body.style.backgroundColor = colors.surfaceBackground;
    body.style.color = colors.textForeground;
  }

  // 3. Update meta theme-color for Electron / browser bar
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", colors.surfaceBackground);
  }

  // 4. Set Hex CSS variables
  root.style.setProperty("--surface-background", colors.surfaceBackground);
  root.style.setProperty("--surface-panel", colors.surfacePanel);
  root.style.setProperty("--surface-elevated", colors.surfaceElevated);
  root.style.setProperty("--surface-hover", colors.surfaceHover);
  root.style.setProperty("--foreground-bright", colors.textForeground);

  root.style.setProperty("--brand-blue", colors.primary);
  root.style.setProperty("--brand-gold", colors.brandGold);
  root.style.setProperty("--brand-cyan", colors.brandCyan);
  root.style.setProperty("--brand-violet", colors.brandViolet);

  root.style.setProperty("--status-success", colors.statusSuccess);
  root.style.setProperty("--status-warning", colors.statusWarning);
  root.style.setProperty("--status-danger", colors.statusDanger);
  root.style.setProperty("--status-info", colors.statusInfo);

  // 5. Set HSL CSS variables for Tailwind / Shadcn UI components
  root.style.setProperty(
    "--background",
    hexToHslString(colors.surfaceBackground),
  );
  root.style.setProperty("--foreground", hexToHslString(colors.textForeground));
  root.style.setProperty("--card", hexToHslString(colors.surfacePanel));
  root.style.setProperty(
    "--card-foreground",
    hexToHslString(colors.textForeground),
  );
  root.style.setProperty("--popover", hexToHslString(colors.surfaceElevated));
  root.style.setProperty(
    "--popover-foreground",
    hexToHslString(colors.textForeground),
  );
  root.style.setProperty("--primary", hexToHslString(colors.primary));
  root.style.setProperty(
    "--primary-foreground",
    hexToHslString(colors.primaryForeground),
  );
  root.style.setProperty("--border", hexToHslString(colors.borderColor));
  root.style.setProperty("--input", hexToHslString(colors.borderColor));
  root.style.setProperty("--ring", hexToHslString(colors.primary));
  root.style.setProperty("--muted", hexToHslString(colors.surfaceElevated));
  root.style.setProperty(
    "--muted-foreground",
    hexToHslString(colors.textMuted),
  );
}
