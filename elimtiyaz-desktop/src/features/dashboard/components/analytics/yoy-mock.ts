// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/yoy-mock.ts
// ============================================================================
/**
 * yoy-mock — T-513 (STATS-405): the year-over-year DEMO MODE's pure
 * generator, the owner's three-issue mandate (issue 1).
 *
 * THE MANDATE: "I want to add a mock mode to the year-over-year comparison
 * feature so I can test and preview comparisons between the current year
 * (N) and the previous year (N-1). […] The mock mode must be clearly
 * identified and must not modify, overwrite, or interfere with real data."
 *
 * WHY THIS FILE EXISTS SEPARATELY from analytics-derivations.ts: that
 * file's charter is "NOTHING is synthesized (§15.16 discipline)" — every
 * function there consumes REAL repository data. This module is the ONE
 * sanctioned exception class the owner explicitly ordered, and it lives
 * in its own file so the derivations layer's charter stays literally
 * true. The §15.16 rule itself is respected in its exact letter: it
 * forbids synthesizing client-side "when REAL rows exist" — the demo
 * mode is offered ONLY on the inverse condition (the previous-year
 * series is EMPTY), it is opt-in, rendered with an unmissable amber
 * DONNÉES SIMULÉES badge, and it NEVER enters a repository, a write
 * path, or any persisted state (display-only, component-local).
 *
 * THE GENERATION MODEL (deterministic, realistic, honest):
 *   - every month's simulated N−1 amount = the REAL current-year month's
 *     amount × a per-month multiplier in [0.80, 1.20] derived from a
 *     stable hash of the month label — the school year's REAL wave
 *     structure (the three-wave staircase: Sept/Oct/Nov installments)
 *     therefore carries into the simulated year, which is what makes the
 *     preview realistic instead of noise;
 *   - amounts are rounded to the nearest 500 DZD (school tranche money is
 *     round money — the fixture corpora all use 500/1 000-multiples);
 *   - a REAL month with 0 encaissé simulates 0 (the honest absence — no
 *     base, no fabricated history; deriveYearOverYear then reports its
 *     documented null Δ%, never a fabricated trend);
 *   - same input → same output, ALWAYS (pure function, input never
 *     mutated) so the regression suite pins exact values.
 */
import type { RevenuePoint } from "../../../../domain/model/operations";

/** The demo series' rounding granularity (DZD). */
const ROUND_TO_DZD = 500;

/** The multiplier band: [MOCK_MIN, MOCK_MAX] inclusive, per month. */
const MOCK_MIN = 0.8;
const MOCK_MAX = 1.2;
/** The number of discrete multiplier steps inside the band. */
const MOCK_STEPS = 41; // 0.80, 0.805, … 1.20 → a 0.5% granularity

/**
 * Stable non-cryptographic string hash (FNV-1a, 32-bit). Chosen for
 * determinism across engines/versions — Math.random() would make the
 * preview untestable and unreproducible (§15.6: no verification without
 * recorded evidence — a random mock could never be pinned).
 */
function hashLabel(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The deterministic per-label multiplier (0.80–1.20, step 0.5%). */
export function mockMultiplierFor(label: string): number {
  const step = hashLabel(`n-1:${label}`) % MOCK_STEPS;
  return MOCK_MIN + (step * (MOCK_MAX - MOCK_MIN)) / (MOCK_STEPS - 1);
}

/**
 * Derive the SIMULATED previous-year (N−1) series from the REAL
 * current-year (N) series — the demo mode's whole data source.
 *
 * Pure: the input array is never mutated; the output is a fresh array of
 * fresh objects (the caller may hand it to deriveYearOverYear directly).
 * Empty input → empty output (nothing to preview).
 */
export function deriveMockPrevYearRevenue(
  current: readonly RevenuePoint[],
): RevenuePoint[] {
  return current.map((p) => {
    // A real zero stays zero — the honest absence (see the header).
    if (p.amount <= 0) return { label: p.label, amount: 0 };
    const simulated = p.amount * mockMultiplierFor(p.label);
    return {
      label: p.label,
      amount: Math.max(
        ROUND_TO_DZD,
        Math.round(simulated / ROUND_TO_DZD) * ROUND_TO_DZD,
      ),
    };
  });
}
