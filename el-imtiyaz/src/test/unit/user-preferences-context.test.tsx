/**
 * Iteration 15 — Tests for the UserPreferencesContext (app/providers/user-preferences-provider.tsx).
 *
 * This context is the SINGLE source of truth for client-side preferences:
 *   - theme (dark | light)
 *   - locale (fr | ar)
 *   - timezone
 *   - currency
 *
 * Before this iteration, four divergent storage layers held pieces of
 * these preferences (localStorage["el-imtiyaz:locale"], session.locale
 * declared but never read, system_settings.default_locale, hardcoded
 * theme in index.html). This context consolidates them.
 *
 * Tests cover:
 *   1. Default values when no prior state exists.
 *   2. setTheme / setLocale / setTimezone / setCurrency mutate the
 *      exposed state.
 *   3. Side-effects fire on the document element (data-theme, dir, lang).
 *   4. State persists across mount/unmount cycles via localStorage.
 *   5. reset() restores the defaults.
 *   6. Legacy locale key is migrated on first read.
 *   7. initUserPreferences() applies theme + locale synchronously.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, act, cleanup } from "@testing-library/react";
import * as React from "react";
import {
  UserPreferencesProvider,
  useUserPreferences,
  initUserPreferences,
  type AppTheme,
  type AppLocale,
} from "../../app/providers/user-preferences-provider";

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "el-imtiyaz:prefs";
const LEGACY_LOCALE_KEY = "el-imtiyaz:locale";

function clearStorage() {
  localStorage.clear();
}

function renderHookWithProvider<P>(hook: () => P): { result: { current: P }; unmount: () => void; rerender: () => void } {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <UserPreferencesProvider>{children}</UserPreferencesProvider>
  );
  return renderHook(hook, { wrapper });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Iteration 15 — UserPreferencesContext", () => {
  beforeEach(() => {
    clearStorage();
    // Reset document attributes so each test starts clean.
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.dir = "";
    document.documentElement.lang = "";
  });

  afterEach(() => {
    cleanup();
    clearStorage();
  });

  it("exposes default values when no prior state exists", () => {
    const { result } = renderHookWithProvider(() => useUserPreferences());
    expect(result.current.theme).toBe("dark");
    expect(result.current.locale).toBe("fr");
    expect(result.current.timezone).toBe("Africa/Algiers");
    expect(result.current.currency).toBe("DZD");
  });

  it("setTheme() updates the exposed theme", () => {
    const { result } = renderHookWithProvider(() => useUserPreferences());
    act(() => result.current.setTheme("light"));
    expect(result.current.theme).toBe("light");
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
  });

  it("setLocale() updates the exposed locale", () => {
    const { result } = renderHookWithProvider(() => useUserPreferences());
    act(() => result.current.setLocale("ar"));
    expect(result.current.locale).toBe("ar");
    act(() => result.current.setLocale("fr"));
    expect(result.current.locale).toBe("fr");
  });

  it("setTimezone() updates the exposed timezone", () => {
    const { result } = renderHookWithProvider(() => useUserPreferences());
    act(() => result.current.setTimezone("Europe/Paris"));
    expect(result.current.timezone).toBe("Europe/Paris");
  });

  it("setCurrency() updates the exposed currency", () => {
    const { result } = renderHookWithProvider(() => useUserPreferences());
    act(() => result.current.setCurrency("EUR"));
    expect(result.current.currency).toBe("EUR");
  });

  it("applies data-theme attribute + .dark class to <html> on theme change", () => {
    const { result } = renderHookWithProvider(() => useUserPreferences());
    act(() => result.current.setTheme("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => result.current.setTheme("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("applies dir + lang attributes to <html> on locale change", () => {
    const { result } = renderHookWithProvider(() => useUserPreferences());
    act(() => result.current.setLocale("ar"));
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");

    act(() => result.current.setLocale("fr"));
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("persists preferences to localStorage so they survive remount", () => {
    const { result, unmount } = renderHookWithProvider(() => useUserPreferences());
    act(() => {
      result.current.setTheme("light");
      result.current.setLocale("ar");
      result.current.setTimezone("Europe/Paris");
      result.current.setCurrency("EUR");
    });
    unmount();

    // Re-mount — should pick up the saved state.
    const { result: result2 } = renderHookWithProvider(() => useUserPreferences());
    expect(result2.current.theme).toBe("light");
    expect(result2.current.locale).toBe("ar");
    expect(result2.current.timezone).toBe("Europe/Paris");
    expect(result2.current.currency).toBe("EUR");
  });

  it("migrates legacy localStorage locale key on first read", () => {
    localStorage.setItem(LEGACY_LOCALE_KEY, "ar");
    // No "el-imtiyaz:prefs" key yet — should fall back to legacy migration.
    const { result } = renderHookWithProvider(() => useUserPreferences());
    expect(result.current.locale).toBe("ar");
    // Other defaults remain.
    expect(result.current.theme).toBe("dark");
    expect(result.current.currency).toBe("DZD");
  });

  it("reset() restores all defaults", () => {
    const { result } = renderHookWithProvider(() => useUserPreferences());
    act(() => {
      result.current.setTheme("light");
      result.current.setLocale("ar");
      result.current.setTimezone("Europe/Paris");
      result.current.setCurrency("EUR");
    });
    expect(result.current.theme).toBe("light");
    expect(result.current.currency).toBe("EUR");

    act(() => result.current.reset());
    expect(result.current.theme).toBe("dark");
    expect(result.current.locale).toBe("fr");
    expect(result.current.timezone).toBe("Africa/Algiers");
    expect(result.current.currency).toBe("DZD");
  });

  it("ignores invalid persisted JSON and falls back to defaults", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    const { result } = renderHookWithProvider(() => useUserPreferences());
    expect(result.current.theme).toBe("dark");
    expect(result.current.locale).toBe("fr");
  });

  it("ignores invalid persisted values and falls back to defaults", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: "purple",         // invalid — must be "dark" or "light"
      locale: "klingon",        // invalid — must be "fr" or "ar"
      timezone: "",             // invalid — empty
      currency: 42,             // invalid — not a string
    }));
    const { result } = renderHookWithProvider(() => useUserPreferences());
    expect(result.current.theme).toBe("dark");
    expect(result.current.locale).toBe("fr");
    expect(result.current.timezone).toBe("Africa/Algiers");
    expect(result.current.currency).toBe("DZD");
  });

  it("initUserPreferences() applies theme + locale synchronously before React mounts", () => {
    // Seed the storage so initUserPreferences reads a non-default value.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: "light",
      locale: "ar",
      timezone: "Europe/Paris",
      currency: "EUR",
    }));
    // At this point <html> has no data-theme/dir/lang attributes.
    expect(document.documentElement.getAttribute("data-theme")).toBe(null);
    expect(document.documentElement.dir).toBe("");

    const prefs = initUserPreferences();
    expect(prefs.theme).toBe("light");
    expect(prefs.locale).toBe("ar");

    // The side-effects should now be applied.
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
  });

  it("initUserPreferences() is idempotent (safe to call multiple times)", () => {
    initUserPreferences();
    const dir1 = document.documentElement.dir;
    const theme1 = document.documentElement.getAttribute("data-theme");
    initUserPreferences();
    expect(document.documentElement.dir).toBe(dir1);
    expect(document.documentElement.getAttribute("data-theme")).toBe(theme1);
  });

  it("useUserPreferences throws when used outside the provider", () => {
    // Suppress the console.error that React will emit when the hook throws.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useUserPreferences())).toThrow(
      /must be used inside <UserPreferencesProvider>/,
    );
    spy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  Type-level sanity (compile-time only — no runtime assertions).    */
/* ------------------------------------------------------------------ */

// These compile-time checks ensure the public types haven't drifted.
// If they don't compile, the test file fails to typecheck.
const _typeCheckTheme: AppTheme = "dark";
const _typeCheckLocale: AppLocale = "fr";
void _typeCheckTheme;
void _typeCheckLocale;
