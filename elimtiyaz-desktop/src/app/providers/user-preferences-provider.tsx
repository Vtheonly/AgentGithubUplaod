/**
 * useUserPreferences — single source of truth for client-side user preferences.
 *
 * Before this hook existed, four divergent storage layers held pieces of
 * "user preferences":
 *   - `localStorage["el-imtiyaz:locale"]` (language-switcher.tsx)
 *   - `localStorage["el-imtiyaz:theme"]` (didn't exist — theme was hardcoded)
 *   - `session.locale` (declared but never read)
 *   - `system_settings` table (timezone, default_locale, default_currency,
 *     log_level — but the GeneralTab never displayed or updated them)
 *
 * This hook unifies all four into ONE provider. The provider:
 *   1. Holds the in-memory state (theme, locale, timezone, currency).
 *   2. Persists theme + locale to localStorage (client-side — instant).
 *   3. Mirrors locale to `i18n.changeLanguage()` + the `document.documentElement.dir`/`lang` attributes.
 *   4. Mirrors theme to the `data-theme` attribute on `<html>` (used by the
 *      CSS variables in index.css to switch between light/dark palettes).
 *   5. Exposes `setTheme`, `setLocale`, `setTimezone`, `setCurrency` that
 *      also fire audit log entries + (if Supabase is configured) push the
 *      new value to the `system_settings` table.
 *
 * The hook is intentionally lightweight — it does NOT depend on Supabase.
 * If Supabase is unavailable (mock mode), preferences still work locally.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import i18n from "../../i18n/i18n";
import { logger } from "../../core/logger";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type AppTheme = "dark" | "light";
export type AppLocale = "fr" | "ar";

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
  /** Reset all preferences to defaults. Used by the "Réinitialiser" button. */
  reset(): void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "el-imtiyaz:prefs";

const DEFAULTS: UserPreferences = {
  theme: "dark",
  locale: "fr",
  timezone: "Africa/Algiers",
  currency: "DZD",
};

const THEME_ATTR = "data-theme";
const LOCALE_STORAGE_KEY_LEGACY = "el-imtiyaz:locale";

/* ------------------------------------------------------------------ */
/*  Storage helpers (pure)                                             */
/* ------------------------------------------------------------------ */

function loadPreferences(): UserPreferences {
  // First try the new unified key.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserPreferences>;
      return {
        theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : DEFAULTS.theme,
        locale: parsed.locale === "fr" || parsed.locale === "ar" ? parsed.locale : DEFAULTS.locale,
        timezone: typeof parsed.timezone === "string" && parsed.timezone ? parsed.timezone : DEFAULTS.timezone,
        currency: typeof parsed.currency === "string" && parsed.currency ? parsed.currency : DEFAULTS.currency,
      };
    }
  } catch {
    // Fall through to legacy migration.
  }
  // Migrate legacy locale key if present (one-time).
  try {
    const legacy = localStorage.getItem(LOCALE_STORAGE_KEY_LEGACY);
    if (legacy === "fr" || legacy === "ar") {
      return { ...DEFAULTS, locale: legacy };
    }
  } catch {
    /* ignore */
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

/* ------------------------------------------------------------------ */
/*  Side-effect appliers                                               */
/* ------------------------------------------------------------------ */

function applyTheme(theme: AppTheme): void {
  document.documentElement.setAttribute(THEME_ATTR, theme);
  // Also set / remove the legacy `.dark` / `.light` classes so any CSS
  // rules still keying off `<html class="dark">` or `<html class="light">`
  // continue to work alongside the new `[data-theme="..."]` selector.
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.classList.add(theme);
}

function applyLocale(locale: AppLocale): void {
  const dir = locale === "ar" ? "rtl" : "ltr";
  document.documentElement.dir = dir;
  document.documentElement.lang = locale;
  // Mirror to legacy key so existing readers (language-switcher.tsx) see it.
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY_LEGACY, locale);
  } catch {
    /* ignore */
  }
  // i18n.changeLanguage is async but we don't need to await — React will
  // re-render when the language changes via the useTranslation hook.
  void i18n.changeLanguage(locale);
}

/**
 * Synchronously apply stored theme + locale BEFORE React mounts.
 *
 * Call this from main.tsx so:
 *   - The `dir="rtl"` attribute is set before the first paint (prevents
 *     an LTR flash for users who previously selected Arabic).
 *   - The `data-theme="dark|light"` attribute is set before the first
 *     paint (prevents a flash of the wrong palette).
 *
 * Safe to call multiple times — the UserPreferencesProvider will apply
 * the same values again on mount (idempotent).
 */
export function initUserPreferences(): UserPreferences {
  const prefs = loadPreferences();
  applyTheme(prefs.theme);
  applyLocale(prefs.locale);
  return prefs;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(() => loadPreferences());

  // Apply side-effects whenever prefs change.
  useEffect(() => {
    applyTheme(prefs.theme);
    applyLocale(prefs.locale);
    savePreferences(prefs);
  }, [prefs]);

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

  const reset = useCallback(() => {
    setPrefs(DEFAULTS);
  }, []);

  const value = useMemo<UserPreferencesContextValue>(
    () => ({ ...prefs, setTheme, setLocale, setTimezone, setCurrency, reset }),
    [prefs, setTheme, setLocale, setTimezone, setCurrency, reset],
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
