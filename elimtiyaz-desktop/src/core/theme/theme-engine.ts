// ============================================================================
// FILE: src/core/theme/theme-engine.ts
// ============================================================================

import {
  PRESET_THEMES,
  hexToHslString,
  type CustomThemePalette,
} from "./theme-types";

const CUSTOM_THEMES_STORAGE_KEY = "el-imtiyaz:custom-themes";

/**
 * T-546 (UI-352): hex → "r g b" channel triplet for the Tailwind
 * `rgb(var(--x-rgb) / <alpha-value>)` utilities. Every hex token the engine
 * sets on :root gets a twin `-rgb` channel variable so the compiled
 * status/brand/surface utilities follow the ACTIVE palette at runtime
 * (opacity modifiers included) instead of the build-time midnight hexes.
 */
function hexToRgbChannels(hex: string): string {
  let c = hex.replace("#", "").trim();
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const num = parseInt(c, 16);
  if (Number.isNaN(num)) return "";
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `${r} ${g} ${b}`;
}

/** Set one hex token + its `-rgb` channel twin on the root element. */
function setHexTokenPair(
  root: HTMLElement,
  hexName: string,
  hexValue: string,
): void {
  root.style.setProperty(hexName, hexValue);
  const channels = hexToRgbChannels(hexValue);
  if (channels) {
    root.style.setProperty(`${hexName}-rgb`, channels);
  }
}

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

  // 4. Set Hex CSS variables — T-546: each hex token now carries its
  //    `-rgb` channel twin (consumed by the Tailwind utilities) so the
  //    compiled classes follow the active palette, not the boot palette.
  setHexTokenPair(root, "--surface-background", colors.surfaceBackground);
  setHexTokenPair(root, "--surface-panel", colors.surfacePanel);
  setHexTokenPair(root, "--surface-elevated", colors.surfaceElevated);
  setHexTokenPair(root, "--surface-hover", colors.surfaceHover);
  root.style.setProperty("--foreground-bright", colors.textForeground);

  setHexTokenPair(root, "--brand-blue", colors.primary);
  setHexTokenPair(root, "--brand-gold", colors.brandGold);
  setHexTokenPair(root, "--brand-cyan", colors.brandCyan);
  setHexTokenPair(root, "--brand-violet", colors.brandViolet);

  setHexTokenPair(root, "--status-success", colors.statusSuccess);
  setHexTokenPair(root, "--status-warning", colors.statusWarning);
  setHexTokenPair(root, "--status-danger", colors.statusDanger);
  setHexTokenPair(root, "--status-info", colors.statusInfo);

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
