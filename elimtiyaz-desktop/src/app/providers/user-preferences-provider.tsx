// ============================================================================
// FILE: src/app/providers/user-preferences-provider.tsx
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import i18n from "../../i18n/i18n";
import { logger } from "../../core/logger";
import {
  applyThemePaletteToDom,
  findThemeById,
  loadStoredCustomThemes,
  saveStoredCustomThemes,
} from "../../core/theme/theme-engine";
import type { CustomThemePalette } from "../../core/theme/theme-types";

export type AppTheme = string; // can be "dark", "light", "emerald", "amethyst", or custom ID
export type AppLocale = "fr" | "ar" | "en";

export interface UserPreferences {
  theme: AppTheme;
  locale: AppLocale;
  timezone: string;
  currency: string;
}

export interface UserPreferencesContextValue extends UserPreferences {
  setTheme(theme: AppTheme): void;
  setLocale(locale: AppLocale): void;
  setTimezone(timezone: string): void;
  setCurrency(currency: string): void;
  customThemes: CustomThemePalette[];
  saveCustomTheme(palette: CustomThemePalette): void;
  deleteCustomTheme(id: string): void;
  /**
   * T-627 (C-25): merge the TENANT's custom-palette list over the device
   * cache — the tenant list WINS on id collision (the tenant row is the
   * branding truth; the device store is the offline cache) and the merged
   * list MIRRORS BACK to the device store so offline boots render the
   * last-known tenant palettes (the T-448 dashboard-layout offline-cache
   * pattern). Called once per session by the TenantThemeHydrator (inside
   * the repository tree — this provider sits above RepositoryProvider and
   * cannot read the repository itself).
   */
  hydrateCustomThemes(tenantThemes: CustomThemePalette[]): void;
  reset(): void;
}

const STORAGE_KEY = "el-imtiyaz:prefs";

const DEFAULTS: UserPreferences = {
  // T-589 (D-19): light is the app-wide primary — Clair Épuré boots by default.
  theme: "light",
  locale: "fr",
  timezone: "Africa/Algiers",
  currency: "DZD",
};

function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserPreferences>;
      return {
        theme: typeof parsed.theme === "string" ? parsed.theme : DEFAULTS.theme,
        locale: parsed.locale === "fr" || parsed.locale === "ar" || parsed.locale === "en" ? parsed.locale : DEFAULTS.locale,
        timezone: typeof parsed.timezone === "string" ? parsed.timezone : DEFAULTS.timezone,
        currency: typeof parsed.currency === "string" ? parsed.currency : DEFAULTS.currency,
      };
    }
  } catch {
    // fallback
  }
  return DEFAULTS;
}

function savePreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (err) {
    logger.warn("Failed to persist user preferences", { err });
  }
}

function applyLocale(locale: AppLocale): void {
  const dir = locale === "ar" ? "rtl" : "ltr";
  document.documentElement.dir = dir;
  document.documentElement.lang = locale;
  void i18n.changeLanguage(locale);
}

export function initUserPreferences(): UserPreferences {
  const prefs = loadPreferences();
  const custom = loadStoredCustomThemes();
  const palette = findThemeById(prefs.theme, custom);
  applyThemePaletteToDom(palette);
  applyLocale(prefs.locale);
  return prefs;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(() => loadPreferences());
  const [customThemes, setCustomThemes] = useState<CustomThemePalette[]>(() =>
    loadStoredCustomThemes()
  );

  // Apply visual theme to DOM
  useEffect(() => {
    const palette = findThemeById(prefs.theme, customThemes);
    applyThemePaletteToDom(palette);
    applyLocale(prefs.locale);
    savePreferences(prefs);
  }, [prefs, customThemes]);

  const setTheme = useCallback((theme: AppTheme) => {
    setPrefs((prev) => (prev.theme === theme ? prev : { ...prev, theme }));
  }, []);

  const setLocale = useCallback((locale: AppLocale) => {
    setPrefs((prev) => (prev.locale === locale ? prev : { ...prev, locale }));
  }, []);

  const setTimezone = useCallback((timezone: string) => {
    setPrefs((prev) => (prev.timezone === timezone ? prev : { ...prev, timezone }));
  }, []);

  const setCurrency = useCallback((currency: string) => {
    setPrefs((prev) => (prev.currency === currency ? prev : { ...prev, currency }));
  }, []);

  const saveCustomTheme = useCallback((palette: CustomThemePalette) => {
    setCustomThemes((prev) => {
      const idx = prev.findIndex((t) => t.id === palette.id);
      const next = idx >= 0 ? prev.map((t, i) => (i === idx ? palette : t)) : [...prev, palette];
      saveStoredCustomThemes(next);
      return next;
    });
    setTheme(palette.id);
  }, [setTheme]);

  const deleteCustomTheme = useCallback((id: string) => {
    setCustomThemes((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveStoredCustomThemes(next);
      return next;
    });
    // T-589: deleting the active custom theme falls back to the light default.
    setPrefs((prev) => (prev.theme === id ? { ...prev, theme: "light" } : prev));
  }, []);

  // T-627 (C-25): the tenant-list hydration — tenant wins on id collision,
  // merged list mirrors back to the device store (offline boots render the
  // last-known tenant palettes).
  const hydrateCustomThemes = useCallback((tenantThemes: CustomThemePalette[]) => {
    setCustomThemes((prev) => {
      const tenantById = new Map(tenantThemes.map((t) => [t.id, t]));
      const kept = prev.filter((t) => !tenantById.has(t.id));
      const merged = [...kept, ...tenantThemes];
      saveStoredCustomThemes(merged);
      return merged;
    });
  }, []);

  const reset = useCallback(() => {
    setPrefs(DEFAULTS);
  }, []);

  const value = useMemo<UserPreferencesContextValue>(
    () => ({
      ...prefs,
      setTheme,
      setLocale,
      setTimezone,
      setCurrency,
      customThemes,
      saveCustomTheme,
      deleteCustomTheme,
      hydrateCustomThemes,
      reset,
    }),
    [prefs, setTheme, setLocale, setTimezone, setCurrency, customThemes, saveCustomTheme, deleteCustomTheme, hydrateCustomThemes, reset]
  );

  return (
    <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>
  );
}

export function useUserPreferences(): UserPreferencesContextValue {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) {
    throw new Error("useUserPreferences must be used inside <UserPreferencesProvider>");
  }
  return ctx;
}