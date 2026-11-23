/**
 * T-583 — startup acceleration (EXECUTION-PLAN §4 / BUG-054 / E1.8).
 *
 * What this suite pins:
 *
 *   A. THE SPLASH (≤1 s + dismissible):
 *      - SPLASH_DURATION_MS is 1000 (the 2,200 ms gate is gone);
 *      - a pointerdown dismisses the splash IMMEDIATELY (onDone fires at
 *        the 150 ms micro-fade, long before the duration timer).
 *
 *   B. ROUTE-LEVEL LAZY (the 11 pages + the shell):
 *      - app-shell.tsx declares every feature page through React.lazy
 *        (source pins — the lazy() wrapper is the contract);
 *      - app.tsx lazy-loads AppShell (the authenticated shell leaves the
 *        eager entry graph) and mounts it inside Suspense.
 *
 *   C. THE EAGER-GRAPH HEAVY-LIB CUT (source guards):
 *      - data-inspector-core.tsx: NO static exceljs / pdf-lib imports
 *        (both are dynamic inside the export handlers);
 *      - ai-copilot-provider.tsx: NO static receipt-pdf / export-engine
 *        imports (dynamic inside downloadArtifact).
 *
 *   D. THE DEVTOOLS AUTOFILL GATE (E1.8 completion):
 *      - app.tsx gates TestDataAutofill behind import.meta.env.DEV and
 *        imports it LAZILY (the engine never enters the production eager
 *        bundle — nor even a production chunk reference, since the gate
 *        keeps the component from ever mounting).
 *
 *   E. THE LAZY ar/en DICTIONARIES (behavioral, through the REAL i18n):
 *      - fr is bundled at init (hasResourceBundle true);
 *      - ar/en are NOT bundled at init;
 *      - changeLanguage("en"/"ar") resolves through the lazy backend and
 *        t() returns the locale's OWN glossary text (the t-447 parity
 *        contract survives the lazy conversion unchanged).
 *
 * Run:
 *   npx vitest run src/tests/features/t-583-startup-acceleration.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import * as React from "react";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SplashScreen, SPLASH_DURATION_MS } from "../../features/auth/splash-screen";
import i18next from "../../i18n/i18n";
import { STAT_TIPS_EN, STAT_TIPS_AR, STAT_TIPS_FR } from "../../i18n/stats-tips";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../../");
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

/* ---------------- A — the splash ---------------- */

describe("T-583 A — the splash is ≤1 s and dismissible", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("A1: the default duration is ONE second (the 2,200 ms gate is gone)", () => {
    expect(SPLASH_DURATION_MS).toBe(1000);
  });

  it("A2: onDone fires at the duration (jsdom — no canvas, the timer path)", () => {
    const onDone = vi.fn();
    render(<SplashScreen onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SPLASH_DURATION_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("A3: a pointerdown dismisses the splash IMMEDIATELY (before the duration)", () => {
    const onDone = vi.fn();
    const { container } = render(<SplashScreen onDone={onDone} />);
    const surface = container.firstChild as HTMLElement;
    act(() => {
      fireEvent.pointerDown(surface);
    });
    // The micro-fade window — onDone must fire here, NOT at 1,000 ms.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

/* ---------------- B — route-level lazy ---------------- */

describe("T-583 B — route-level React.lazy (the 11 pages + the shell)", () => {
  const shell = read("app/app-shell.tsx");

  const PAGES = [
    "dashboard-page",
    "crm-page",
    "academics-page",
    "class-detail-page",
    "roll-call-screen",
    "grade-entry-screen",
    "financials-page",
    "personnel-page",
    "workflow-page",
    "settings-page",
    "profile-page",
  ] as const;

  it("B1: every feature page is declared through React.lazy", () => {
    for (const page of PAGES) {
      // The lazy declaration pattern: lazy(() => import("../features/<x>").then(...))
      const lazyPattern = new RegExp(
        `lazy\\(\\(\\) => import\\(["'\\.]*/features/[^"'\\)]*${page}["']`,
      );
      expect(lazyPattern.test(shell), `${page} must be lazy-imported`).toBe(true);
    }
  });

  it("B2: NO static page import remains in app-shell.tsx", () => {
    // The pre-T-583 shape: import { DashboardPage } from "../features/dashboard/dashboard-page";
    expect(/\{\s*\w+Page\s*\}\s*from\s*["'][^"']*features\//.test(shell)).toBe(false);
    expect(/\{\s*(RollCallScreen|GradeEntryScreen)\s*\}\s*from/.test(shell)).toBe(false);
  });

  it("B3: the routes render inside a Suspense boundary with the shared loading state", () => {
    expect(shell).toContain("<Suspense");
    expect(shell).toContain("LoadingState");
  });

  it("B4: app.tsx lazy-loads the authenticated shell (it leaves the eager graph)", () => {
    const app = read("app/app.tsx");
    expect(/lazy\(\(\) => import\(["']\.\/app-shell["']\)/.test(app)).toBe(true);
    expect(app).not.toMatch(
      /import \{ AppShell \} from ["']\.\/app-shell["']/,
    );
    expect(app).toContain("<Suspense fallback={<LoadingState />}>");
  });
});

/* ---------------- C — the heavy-lib eager cut ---------------- */

describe("T-583 C — exceljs / pdf-lib leave the eager boot graph", () => {
  it("C1: data-inspector-core.tsx has NO static exceljs / pdf-lib import", () => {
    const src = read("features/dashboard/components/analytics/data-inspector-core.tsx");
    // Static import forms (import x from / import { x } from):
    expect(src).not.toMatch(/^import\s+ExcelJS\s+from\s+["']exceljs["']/m);
    expect(src).not.toMatch(/^import\s*\{[^}]*\}\s*from\s+["']pdf-lib["']/m);
    // The dynamic forms ARE present (the export handlers own them).
    expect(src).toContain('await import("exceljs")');
    expect(src).toContain('await import("pdf-lib")');
  });

  it("C2: ai-copilot-provider.tsx has NO static receipt-pdf / export-engine import", () => {
    const src = read("app/providers/ai-copilot-provider.tsx");
    expect(src).not.toMatch(/^import\s*\{[^}]*\}\s*from\s+["'][^"']*receipt-pdf["'];/m);
    expect(src).not.toMatch(
      /^import\s*\{[^}]*\}\s*from\s+["'][^"']*excel\/export-engine["'];/m,
    );
    // The dynamic forms ARE present inside downloadArtifact.
    expect(src).toContain('await import("../../infrastructure/receipt-pdf")');
    expect(src).toContain('await import("../../infrastructure/excel/export-engine")');
  });
});

/* ---------------- D — the devtools autofill gate ---------------- */

describe("T-583 D — the Ctrl+O autofill is a dev-build affordance (E1.8)", () => {
  it("D1: app.tsx gates TestDataAutofill behind import.meta.env.DEV + lazy import", () => {
    const app = read("app/app.tsx");
    expect(app).toContain("import.meta.env.DEV ?");
    expect(app).toMatch(
      /lazy\(\s*\(\) => import\(["'][^"']*use-test-data-autofill["']\)/,
    );
    // The static mount is gone.
    expect(app).not.toMatch(
      /^import \{ TestDataAutofill \} from ["'][^"']*use-test-data-autofill["'];/m,
    );
  });
});

/* ---------------- E — the lazy ar/en dictionaries ---------------- */

describe("T-583 E — the lazy ar/en dictionaries resolve through the real i18n", () => {
  const key = "statsTips.waveVelocity.card.title";

  it("E1: fr is bundled at init; ar/en are NOT (they ride the backend)", () => {
    expect(i18next.hasResourceBundle("fr", "translation")).toBe(true);
    expect(i18next.hasResourceBundle("en", "translation")).toBe(false);
    expect(i18next.hasResourceBundle("ar", "translation")).toBe(false);
  });

  it("E2: changeLanguage('en') resolves the EN dictionary through the backend", async () => {
    await i18next.changeLanguage("en");
    expect(i18next.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18next.t(key)).toBe(STAT_TIPS_EN.waveVelocity.card.title);
    expect(i18next.t(key)).not.toBe(STAT_TIPS_FR.waveVelocity.card.title);
  });

  it("E3: changeLanguage('ar') resolves the AR dictionary through the backend", async () => {
    await i18next.changeLanguage("ar");
    expect(i18next.hasResourceBundle("ar", "translation")).toBe(true);
    expect(i18next.t(key)).toBe(STAT_TIPS_AR.waveVelocity.card.title);
    // Back to the boot language — the FR bundle is untouched.
    await i18next.changeLanguage("fr");
    expect(i18next.t(key)).toBe(STAT_TIPS_FR.waveVelocity.card.title);
  });
});
