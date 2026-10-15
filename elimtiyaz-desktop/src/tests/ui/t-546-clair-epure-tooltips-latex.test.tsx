/**
 * T-546 (UI-352 · UI-353 · UI-354) — the Clair Épuré + tooltip-math
 * regression suite. Pins the three legs of the owner's mandate:
 *
 *   1. LIGHT-THEME TOKEN SYSTEM (UI-352):
 *      - the Clair Épuré palette's border token is the strengthened slate
 *        (#94a3b8) and the index.css `.light` block carries the SAME value
 *        plus the channel twins + the 0% card-border strength;
 *      - the tailwind utilities map to the `rgb(var(--x-rgb) / <alpha>)`
 *        channel variables (the systemic rewiring that retired the
 *        !important override block);
 *      - the chart token mirrors are LIVE (each access re-reads the DOM
 *        token — the stale module-load capture is gone);
 *      - AGING_COLORS is a live proxy;
 *      - gridStroke/tooltip shadow flip with the active theme;
 *      - the SVG hardcoded whites were replaced by themed classes
 *        (source-scan: dag-canvas + insights-rail).
 *
 *   2. THE SHARED TOOLTIP CONTRACT (UI-353):
 *      - TooltipContent no longer carries overflow-hidden, sits at z-[70]
 *        (above the z-50 modal layer) and passes collisionPadding.
 *
 *   3. LATEX RENDERING (UI-354):
 *      - <Latex> renders real KaTeX markup (fractions, sub/superscripts),
 *        never the raw source;
 *      - invalid LaTeX falls back to a plain <code> rendering (no
 *        katex-error, no broken notation);
 *      - display mode produces the centered block;
 *      - <TextWithLatex> splits $...$ segments inline;
 *      - EVERY glossary formula in all three locales renders clean under
 *        throwOnError (the escaping-repair pin);
 *      - InfoTip renders the formula block (label + typeset math) for an
 *        entry that carries one.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import katex from "katex";

import {
  chartPalette,
  DASHBOARD_THEME,
  isDarkThemeActive,
} from "../../shared/ui/dashboard-theme";
import { AGING_COLORS } from "../../features/dashboard/tabs/types";
import { PRESET_THEMES } from "../../core/theme/theme-types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../shared/ui/tooltip";
import { Latex, TextWithLatex } from "../../shared/ui/latex";
import { InfoTip } from "../../features/dashboard/components/analytics/info-tip";
import {
  STAT_TIPS_FR,
  STAT_TIPS_EN,
  STAT_TIPS_AR,
  type StatsTipDictionary,
} from "../../i18n/stats-tips";
import "../../i18n/i18n";

const APP = resolvePath(__dirname, "../..");

function readModule(rel: string): string {
  return readFileSync(resolvePath(APP, rel), "utf-8");
}

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The light-theme token system (UI-352)
// ---------------------------------------------------------------------------

describe("T-546 (UI-352) — the Clair Épuré token system", () => {
  it("the light palette's border token is the strengthened slate #94a3b8", () => {
    const light = PRESET_THEMES.find((t) => t.id === "light");
    expect(light).toBeDefined();
    expect(light?.colors.borderColor).toBe("#94a3b8");
    // The light status accents keep the darker white-surface variants.
    expect(light?.colors.statusSuccess).toBe("#059669");
    expect(light?.colors.statusDanger).toBe("#dc2626");
  });

  it("index.css: the .light block aligns border/status with the palette, carries the channel twins and the 0% card-border strength", () => {
    const css = readModule("index.css");
    // The light block (scoped slice between .light and the closing brace).
    const lightStart = css.indexOf('.light,');
    expect(lightStart).toBeGreaterThan(0);
    const lightBlock = css.slice(lightStart, css.indexOf("}", css.indexOf("--ring", lightStart)));
    expect(lightBlock).toContain("--status-success: #059669;");
    expect(lightBlock).toContain("--brand-blue: #2563eb;");
    expect(lightBlock).toContain("--brand-blue-rgb: 37 99 235;");
    expect(lightBlock).toContain("--surface-panel-rgb: 255 255 255;");
    expect(lightBlock).toContain("--border: 215 20% 62%;"); // #94a3b8 aligned
    expect(lightBlock).toContain("--card-border-strength: 0%;");
    expect(lightBlock).toContain("--brand-blue-light: #60a5fa;");
    // The root (dark) keeps the softened card chrome.
    expect(css).toContain("--card-border-strength: 60%;");
    // The retired override block is gone (the systemic rewiring replaced it).
    expect(css).not.toContain(".bg-surface-panel {");
    expect(css).not.toContain("color-mix(\n    in srgb,\n    var(--surface-panel) 95%");
    // The focus ring rides the themed brand token.
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline: 2px solid var\(--brand-blue\)/s);
  });

  it("tailwind.config.cjs maps status/brand/surface utilities to the rgb channel variables", () => {
    const cfg = readModule("../tailwind.config.cjs");
    expect(cfg).toContain('"rgb(var(--status-success-rgb) / <alpha-value>)"');
    expect(cfg).toContain('"rgb(var(--brand-blue-rgb) / <alpha-value>)"');
    expect(cfg).toContain('"rgb(var(--surface-panel-rgb) / <alpha-value>)"');
    // The static midnight hexes are gone from the utility mapping.
    expect(cfg).not.toContain('success: "#10b981"');
    expect(cfg).not.toContain('panel: "#111523"');
  });

  it("the theme engine sets the -rgb channel twins for every hex token (custom palettes drive the utilities)", () => {
    const engine = readModule("core/theme/theme-engine.ts");
    expect(engine).toContain("hexToRgbChannels");
    expect(engine).toContain('setHexTokenPair(root, "--status-success"');
    expect(engine).toContain('setHexTokenPair(root, "--brand-blue"');
    expect(engine).toContain('setHexTokenPair(root, "--surface-panel"');
  });

  it("chartPalette is LIVE: each access re-reads the DOM token (the stale module-load capture is gone)", () => {
    const fakeVars: Record<string, string> = {};
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => fakeVars[name] ?? "",
    } as unknown as CSSStyleDeclaration);

    fakeVars["--brand-blue"] = "#111111";
    expect(chartPalette.primary).toBe("#111111");
    // The LIVE property: a token change AFTER first access is observed.
    fakeVars["--brand-blue"] = "#222222";
    expect(chartPalette.primary).toBe("#222222");
    // Falls back to the canonical midnight hex when the DOM has nothing.
    delete fakeVars["--brand-blue"];
    expect(chartPalette.primary).toBe("#349bd4");
    // The status accents resolve live too.
    fakeVars["--status-success"] = "#059669";
    expect(chartPalette.success).toBe("#059669");
  });

  it("AGING_COLORS is a live proxy reading the active palette per bucket", () => {
    const fakeVars: Record<string, string> = {};
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => fakeVars[name] ?? "",
    } as unknown as CSSStyleDeclaration);

    fakeVars["--status-success"] = "#059669";
    expect(AGING_COLORS["0_30"]).toBe("#059669");
    fakeVars["--status-success"] = "#10b981";
    expect(AGING_COLORS["0_30"]).toBe("#10b981");
    // The canonical fallback holds when the DOM is silent.
    delete fakeVars["--status-success"];
    expect(AGING_COLORS["0_30"]).toBe("#10b981");
    expect(AGING_COLORS["91_180"]).toBe("#ef4444");
    expect(AGING_COLORS["180_plus"]).toBe("#836c68");
  });

  it("gridStroke and the tooltip shadow are theme-aware; isDarkThemeActive follows the html class", () => {
    document.documentElement.className = "";
    expect(isDarkThemeActive()).toBe(true);
    expect(DASHBOARD_THEME.gridStroke).toBe("rgba(255, 255, 255, 0.08)");

    document.documentElement.className = "light";
    expect(isDarkThemeActive()).toBe(false);
    expect(DASHBOARD_THEME.gridStroke).toBe("rgba(15, 23, 42, 0.12)");
    expect(DASHBOARD_THEME.tooltipStyle.boxShadow).toContain("rgba(15, 23, 42, 0.18)");

    document.documentElement.className = "dark";
    expect(DASHBOARD_THEME.tooltipStyle.boxShadow).toContain("rgba(0, 0, 0, 0.6)");
  });

  it("the SVG hardcoded whites are gone: the DAG dot grid and the gauge track use themed classes", () => {
    const dag = readModule("features/workflow/dag-canvas.tsx");
    expect(dag).not.toContain('fill="rgba(255,255,255,0.08)"');
    expect(dag).toContain('className="fill-border opacity-70"');

    const rail = readModule("features/dashboard/components/insights-rail.tsx");
    expect(rail).not.toContain('stroke="rgba(255, 255, 255, 0.08)"');
    expect(rail).toContain('className="stroke-border"');
    expect(rail).toContain("stopColor={chartPalette.primary}");
    expect(rail).toContain("stopColor={chartPalette.success}");
  });

  it("the sparkline tone stroke rides the live tokens (source contract)", () => {
    const spark = readModule("features/dashboard/components/sparkline-kpi-card.tsx");
    expect(spark).not.toContain("const STROKE_BY_TONE");
    expect(spark).toContain('resolveToken("--brand-blue", "#349bd4")');
    expect(spark).toContain('resolveToken("--status-success", "#10b981")');
  });
});

// ---------------------------------------------------------------------------
// 2. The shared tooltip contract (UI-353)
// ---------------------------------------------------------------------------

describe("T-546 (UI-353) — the shared TooltipContent contract", () => {
  it("renders without internal clipping, above the modal layer, with collision padding", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">trigger</button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Long explainability body that must never be clipped internally</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByText("trigger"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.className).not.toContain("overflow-hidden");
    expect(tooltip.className).toContain("z-[70]");
  });
});

// ---------------------------------------------------------------------------
// 3. LaTeX rendering (UI-354)
// ---------------------------------------------------------------------------

describe("T-546 (UI-354) — the <Latex> primitive", () => {
  it("renders real KaTeX markup for a fraction — never the raw source", () => {
    const { container } = render(<Latex tex="\frac{a}{b}" />);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).not.toContain("\\frac");
    // A fraction renders the stacked numerator/denominator structure.
    expect(container.querySelector(".mfrac")).not.toBeNull();
  });

  it("renders subscripts, superscripts, summations and Greek letters", () => {
    const { container } = render(
      <Latex tex="\sigma = \sum_{i=1}^{N} (a_i - \bar{a})^2 \times 100\%" />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelectorAll(".msupsub").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("σ");
  });

  it("falls back to a plain <code> rendering on invalid LaTeX — no broken notation, no katex-error", () => {
    const { container } = render(<Latex tex="\frac{a" />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("code")).not.toBeNull();
    expect(container.textContent).toContain("\\frac{a");
    expect(container.innerHTML).not.toContain("katex-error");
  });

  it("display mode renders the centered block", () => {
    const { container } = render(<Latex tex="T = \sum a_i" display />);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("TextWithLatex splits $...$ segments and renders them as inline math", () => {
    const { container } = render(
      <TextWithLatex text="Panier moyen : $\bar{a} = \frac{1}{N}\sum a_i$ sur la tranche" />,
    );
    expect(screen.getByText(/Panier moyen/)).toBeTruthy();
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).not.toContain("\\bar");
  });

  it("every glossary formula in FR/EN/AR renders clean under throwOnError (the escaping-repair pin)", () => {
    const trees: Array<[string, StatsTipDictionary]> = [
      ["FR", STAT_TIPS_FR],
      ["EN", STAT_TIPS_EN],
      ["AR", STAT_TIPS_AR],
    ];
    let formulas = 0;
    for (const [locale, tree] of trees) {
      for (const [group, entries] of Object.entries(tree)) {
        if (group === "_meta") continue;
        for (const [leaf, entry] of Object.entries(
          entries as Record<string, { formula?: string }>,
        )) {
          if (!entry?.formula) continue;
          formulas += 1;
          for (const displayMode of [false, true]) {
            const html = katex.renderToString(entry.formula, {
              displayMode: displayMode,
              throwOnError: true,
              strict: "ignore",
              output: "html",
            });
            expect(html, `${locale}:${group}.${leaf} (display=${displayMode})`).not.toContain(
              "katex-error",
            );
          }
        }
      }
    }
    // The mandated coverage: 22 entries × 3 locales.
    expect(formulas).toBe(66);
  });
});

describe("T-546 (UI-354) — InfoTip renders the formula block", () => {
  it("a formula-carrying entry renders the label, the typeset math and the variables legend", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <InfoTip tip="statStrip.total" />
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByTestId("stat-tip-statStrip-total"));
    const tooltip = await screen.findByRole("tooltip");

    // The formula block exists and carries real KaTeX markup.
    const formulaBlock = screen.getByTestId("stat-tip-formula-statStrip-total");
    expect(formulaBlock.querySelector(".katex")).not.toBeNull();
    // The section label (dictionary string, never hardcoded JSX).
    expect(tooltip.textContent).toContain("Formule :");
    expect(tooltip.textContent).toContain("Variables :");
    // The formula itself is typeset, not raw source.
    expect(formulaBlock.textContent).not.toContain("\\sum");
    // The variables legend renders its inline math.
    expect(formulaBlock.querySelectorAll(".katex").length).toBeGreaterThan(1);
  });

  it("the wave collection rate renders the mandate's fraction shape", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <InfoTip tip="waveVelocity.collectedPct" />
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByTestId("stat-tip-waveVelocity-collectedPct"));
    const formulaBlock = await screen.findByTestId(
      "stat-tip-formula-waveVelocity-collectedPct",
    );
    expect(formulaBlock.querySelector(".mfrac")).not.toBeNull();
    expect(formulaBlock.textContent).toContain("100");
  });

  it("an entry without a formula renders the classic body and NO formula block (backward compatible)", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <InfoTip tip="slicers.methods" />
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByTestId("stat-tip-slicers-methods"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Slicers Mode de paiement");
    expect(screen.queryByTestId("stat-tip-formula-slicers-methods")).toBeNull();
  });

  it("the prose fields support inline $...$ LaTeX (mixed rendering)", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <InfoTip tip="statStrip.median" />
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByTestId("stat-tip-statStrip-median"));
    const tooltip = await screen.findByRole("tooltip");
    // The vars legend carries $a_{(k)}$ inline math — rendered, not raw.
    expect(tooltip.querySelectorAll(".katex").length).toBeGreaterThan(0);
    expect(tooltip.textContent).not.toContain("$a_{(k)}$");
  });
});
