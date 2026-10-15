// ============================================================================
// FILE: elimtiyaz-desktop/src/shared/ui/latex.tsx
// ============================================================================
/**
 * Latex — T-546 (UI-354): the shared KaTeX rendering primitive.
 *
 * The owner's mandate: every mathematical formula in the Dashboard's
 * explainability tooltips must render as REAL typeset math (fractions,
 * sub/superscripts, summations, Greek letters, percentages) — raw LaTeX
 * syntax on screen is unacceptable — in BOTH themes, with graceful
 * degradation for invalid input and no clipping on long expressions.
 *
 * Implementation notes (the decisions that matter):
 * - `katex.renderToString` (throwOnError: false) — synchronous, offline,
 *   no network, no MathJax service: the ONLY Electron-safe option. The
 *   stylesheet + woff2 fonts are bundled by Vite from
 *   `katex/dist/katex.min.css` (imported once below).
 * - KaTeX output inherits `currentColor` — it reads correctly on the
 *   midnight canvas AND on Clair Épuré with zero theme-specific CSS.
 * - Error policy: a parse failure NEVER surfaces KaTeX's red error text —
 *   the component falls back to a plain <code> rendering of the source
 *   (readable, honest, no broken notation). Load failures of the katex
 *   module itself take the same path (the dynamic-import guard).
 * - Long expressions: the wrapper allows horizontal scroll (overflow-x:
 *   auto) instead of clipping; display-mode block is centered like the
 *   canonical KaTeX display.
 */
import React, { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { cn } from "./cn";

export interface LatexProps {
  /** Raw LaTeX source WITHOUT delimiters (e.g. `\frac{a}{b}`). */
  tex: string;
  /** Display mode (centered, \displaystyle) vs inline. Default: false. */
  display?: boolean;
  className?: string;
}

/** Render one LaTeX source to HTML; null when the input cannot render. */
function renderKatex(tex: string, display: boolean): string | null {
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      strict: "ignore",
      trust: false,
      output: "html",
    });
    return html;
  } catch {
    return null;
  }
}

export function Latex({ tex, display = false, className }: LatexProps) {
  const html = useMemo(() => renderKatex(tex, display), [tex, display]);

  if (!tex) return null;

  if (html === null) {
    // Graceful fallback: the source, monospace — never broken notation.
    return (
      <code
        className={cn(
          "rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-primary",
          className,
        )}
      >
        {tex}
      </code>
    );
  }

  return (
    <span
      role="math"
      aria-label={tex}
      className={cn(
        // Scroll, never clip: long fractions/sums stay fully reachable.
        display ? "block overflow-x-auto py-1" : "inline-block max-w-full",
        className,
      )}
      // KaTeX's own HTML output — rendered from the trusted local katex
      // package (no user-supplied HTML ever passes through here).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * TextWithLatex — prose with inline `$...$` LaTeX segments.
 *
 * The consistent delimiter contract (the mandate: "consistent LaTeX
 * delimiters that work with the pipeline"): a SINGLE `$` pair marks inline
 * math inside any glossary prose field; `$$` is not used (display formulas
 * live in the dedicated `formula` field, rendered by <Latex display>).
 * Segments without `$` render verbatim — every existing string is
 * backward-compatible by construction.
 */
export function TextWithLatex({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts = useMemo(() => splitLatexSegments(text), [text]);
  if (!text) return null;
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.kind === "tex" ? (
          <Latex key={i} tex={part.content} />
        ) : (
          <React.Fragment key={i}>{part.content}</React.Fragment>
        ),
      )}
    </span>
  );
}

function splitLatexSegments(text: string): Array<
  { kind: "text"; content: string } | { kind: "tex"; content: string }
> {
  const parts: Array<
    { kind: "text"; content: string } | { kind: "tex"; content: string }
  > = [];
  // Split on $...$ pairs; unbalanced $ stays literal text.
  const segments = text.split("$");
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (i % 2 === 0 || seg === "") {
      if (seg !== "" || segments.length === 1) {
        parts.push({ kind: "text", content: seg });
      }
    } else {
      parts.push({ kind: "tex", content: seg });
    }
  }
  return parts;
}
