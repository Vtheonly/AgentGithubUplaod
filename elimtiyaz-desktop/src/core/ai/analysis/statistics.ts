// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/analysis/statistics.ts
// ============================================================================
/**
 * Pure descriptive-statistics engine (T-273, 42nd session — AI-311b).
 *
 * SCOPE DISCIPLINE (ADR-016 §2 — the §15.5 boundary): these functions are
 * GENERIC MATH over numeric vectors. They NEVER re-derive a financial or
 * academic business figure: the vectors they consume are canonical
 * outputs (payment `amount`s, ledger summary totals, GPAs from
 * `evaluateStudentTermPerformance`, attendance rates from
 * `calculateAttendanceRate`). Statistical ENRICHMENT over canonical
 * streams — never a parallel derivation of a business number.
 *
 * Every function is pure and total (empty inputs return explicit
 * empty-state results, never NaN/Infinity/throws) so the tool layer can
 * surface them to the model without defensive try/catch gymnastics.
 */

export interface OutlierPoint {
  readonly index: number;
  readonly value: number;
  /** z-score vs the series mean (informative; the fences do the gating). */
  readonly score: number;
  readonly side: "above" | "below";
}

export interface DescriptiveStats {
  readonly count: number;
  readonly sum: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly stddev: number | null;
  readonly q1: number | null;
  readonly q3: number | null;
  readonly iqr: number | null;
  readonly outliers: readonly OutlierPoint[];
}

/** The empty state — explicit, never NaN. */
export const EMPTY_STATS: DescriptiveStats = {
  count: 0,
  sum: 0,
  mean: null,
  median: null,
  min: null,
  max: null,
  stddev: null,
  q1: null,
  q3: null,
  iqr: null,
  outliers: [],
};

/**
 * Linear-interpolation quantile (the R-7 / numpy-default method) —
 * deterministic across platforms, the standard for box plots.
 */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base] + rest * (sorted[Math.min(base + 1, sorted.length - 1)] - sorted[base]);
}

/**
 * Full descriptive statistics + Tukey outlier detection (1.5×IQR fences).
 * Values are rounded to `decimals` (default 2) for wire cleanliness.
 */
export function computeDescriptiveStats(
  values: readonly number[],
  decimals = 2,
): DescriptiveStats {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return EMPTY_STATS;

  const sum = clean.reduce((s, v) => s + v, 0);
  const mean = sum / clean.length;
  const sorted = [...clean].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : null;

  const variance = clean.reduce((s, v) => s + (v - mean) ** 2, 0) / clean.length;
  const stddev = Math.sqrt(variance);

  // Tukey fences: an outlier is strictly outside [q1 - 1.5·IQR, q3 + 1.5·IQR].
  const outliers: OutlierPoint[] = [];
  if (iqr !== null && q1 !== null && q3 !== null) {
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    clean.forEach((v, index) => {
      if (v < lo || v > hi) {
        outliers.push({
          index,
          value: Number(v.toFixed(decimals)),
          score: Number((stddev > 0 ? Math.abs((v - mean) / stddev) : 0).toFixed(2)),
          side: v > hi ? "above" : "below",
        });
      }
    });
  }

  const r = (x: number | null): number | null => (x === null ? null : Number(x.toFixed(decimals)));
  return {
    count: clean.length,
    sum: Number(sum.toFixed(decimals)),
    mean: r(mean),
    median: r(median),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stddev: r(stddev),
    q1: r(q1),
    q3: r(q3),
    iqr: r(iqr),
    outliers: outliers.slice(0, 25), // capped for the wire
  };
}

/* ------------------------------------------------------------------ */
/*  Trend analysis                                                     */
/* ------------------------------------------------------------------ */

export interface TrendResult {
  readonly slope: number | null;
  /** Direction judged at ±5% of the mean per step (flat band). */
  readonly direction: "rising" | "falling" | "flat";
  /** Coefficient of determination of the linear fit (0..1). */
  readonly r2: number | null;
  readonly totalChange: number | null;
  readonly totalChangePercent: number | null;
}

/**
 * Ordinary least-squares linear fit over an ordered series (index = x).
 * Returns the slope per step, direction, R² and total change.
 */
export function computeTrend(values: readonly number[]): TrendResult {
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n < 2) {
    return { slope: null, direction: "flat", r2: null, totalChange: null, totalChangePercent: null };
  }

  const meanX = (n - 1) / 2;
  const meanY = clean.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (clean[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;

  // R²
  const intercept = meanY - slope * meanX;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * i;
    ssRes += (clean[i] - pred) ** 2;
    ssTot += (clean[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  const band = Math.abs(meanY) * 0.05; // ±5% of the mean per step = "flat"
  const direction: TrendResult["direction"] =
    slope > band ? "rising" : slope < -band ? "falling" : "flat";

  const first = clean[0];
  const last = clean[n - 1];
  const totalChange = last - first;
  const totalChangePercent = first !== 0 ? (totalChange / Math.abs(first)) * 100 : null;

  return {
    slope: Number(slope.toFixed(2)),
    direction,
    r2: Number(r2.toFixed(3)),
    totalChange: Number(totalChange.toFixed(2)),
    totalChangePercent:
      totalChangePercent === null ? null : Number(totalChangePercent.toFixed(1)),
  };
}

/**
 * Simple trailing moving average. Entries before the first full window
 * are null (honest leading gaps — never back-filled).
 */
export function movingAverage(values: readonly number[], window: number): (number | null)[] {
  if (window < 1) return values.map(() => null);
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += values[j];
    out.push(Number((sum / window).toFixed(2)));
  }
  return out;
}

/**
 * Period-over-period growth (percent). The first entry is null (no
 * predecessor). Zero predecessors yield null (undefined, never Infinity).
 */
export function periodGrowthPercent(values: readonly number[]): (number | null)[] {
  return values.map((v, i) => {
    if (i === 0) return null;
    const prev = values[i - 1];
    if (prev === 0) return null;
    return Number((((v - prev) / Math.abs(prev)) * 100).toFixed(1));
  });
}

/* ------------------------------------------------------------------ */
/*  Distribution bucketing (histograms)                                */
/* ------------------------------------------------------------------ */

export interface Bucket {
  readonly label: string;
  readonly count: number;
}

/**
 * Bucket a value vector into labeled ranges (half-open [min, max) except
 * the last bucket which closes inclusive). Buckets must be sorted by min.
 */
export function bucketize(
  values: readonly number[],
  buckets: readonly { label: string; min: number; max: number }[],
): Bucket[] {
  return buckets.map((b, idx) => ({
    label: b.label,
    count: values.filter(
      (v) =>
        v >= b.min &&
        (idx === buckets.length - 1 ? v <= b.max : v < b.max),
    ).length,
  }));
}

/**
 * Standard DZD amount buckets for payment/expense analysis (the school's
 * real tuition tranche scale — a full year ≈ 700k DZD, tranches ≈ 40/30/30).
 */
export const DZD_AMOUNT_BUCKETS: readonly { label: string; min: number; max: number }[] = [
  { label: "< 10k", min: 0, max: 10_000 },
  { label: "10k–50k", min: 10_000, max: 50_000 },
  { label: "50k–100k", min: 50_000, max: 100_000 },
  { label: "100k–250k", min: 100_000, max: 250_000 },
  { label: "250k–500k", min: 250_000, max: 500_000 },
  { label: "≥ 500k", min: 500_000, max: Number.MAX_SAFE_INTEGER },
];

/**
 * GPA distribution buckets (0–20 scale, the canonical Algerian scale —
 * pass mark 10, "excellent" conventionally 16+).
 */
export const GPA_BUCKETS: readonly { label: string; min: number; max: number }[] = [
  { label: "0–5 (critique)", min: 0, max: 5 },
  { label: "5–8 (fragile)", min: 5, max: 8 },
  { label: "8–10 (insuffisant)", min: 8, max: 10 },
  { label: "10–12 (passable)", min: 10, max: 12 },
  { label: "12–14 (bien)", min: 12, max: 14 },
  { label: "14–16 (très bien)", min: 14, max: 16 },
  { label: "16–20 (excellent)", min: 16, max: 20.001 },
];
