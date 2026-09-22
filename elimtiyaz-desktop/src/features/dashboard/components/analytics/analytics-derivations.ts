/**
 * analytics-derivations — the pure derivation layer for the Analytics tab
 * (T-255..T-257, 38th session, 2026-09-09 — UI-307).
 *
 * The owner's mandate: "more Power BI–type visualizations — interactive
 * charts, statistics, comparisons, trends and other data visualizations
 * wherever they make sense." Every function below is a PURE transform
 * of the repository contract (the payments stream, the dashboard KPI series,
 * the aging buckets, the top-debtors summary). NOTHING is synthesized
 * (§15.16 discipline — same as T-243..T-252): if the input rows are empty
 * the output is empty, and the cards render their honest empty states.
 *
 * T-339 (61st session, 2026-09-14 — STATS-400, the vanity purge): the
 * payment-amount histogram (deriveAmountHistogram + AMOUNT_BINS), the
 * weekday×month collection heatmap (deriveCollectionHeatmap), the smooth
 * 12-month revenue spline (deriveRevenueTrend + deriveFilteredMonthly +
 * RevenueTrendPoint) were REMOVED per the owner's kill list — they are
 * generic e-commerce visuals that carry zero school-specific intelligence
 * (fixed-price tranches make the histogram a single spike; parents pay
 * when the tranche is DUE, not on a lucky weekday; school revenue is a
 * three-wave staircase, not a smooth curve — the WaveVelocityCard in
 * executive-cards.tsx renders the staircase). The surviving derivations
 * (stats strip, method/category mixes, Pareto, aging composition, YoY)
 * consume REAL repository data only.
 *
 * THE ENCAISSÉ DEFINITION (consistency contract):
 *   The dashboard repository's `revenueForRange` counts payments with
 *   `status === "paid"`, bucketed by the calendar month of `collectedAt`
 *   within the academic-year range (see MockDashboardRepository /
 *   SupabaseDashboardRepository). The Analytics tab's MONETARY aggregates
 *   use the SAME definition so the stat strip reconciles with the KPI
 *   cards. (The weekly-rhythm chart on Overview keeps its own
 *   counter-activity convention — skip-refunded — documented in T-243;
 *   the two views answer different questions.)
 *
 * All functions are exported for the analytics-visuals test suite.
 */
import type { RevenuePoint, DebtByAgingBucket } from "../../../../domain/model/operations";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  paymentCategoryLabelFr,
  AGING_BUCKET_LABELS_FR,
  type Payment,
  type PaymentMethod,
  type PaymentCategory,
  type AgingBucket,
  type Installment,
} from "../../../../domain/model/payment";
// T-389 (INSPECT-500): the INV-4 canonical per-installment remaining —
// reused (never re-implemented) so the inspector's debt math is the
// executive-statistics math is the KPI math.
import { installmentRemaining } from "./executive-statistics";

/** French month labels, Jan→Déc (canonical order; matches the repository series). */
export const MONTH_LABELS_FR = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
  "Juil", "Août", "Sep", "Oct", "Nov", "Déc",
] as const;

/** Month label → 0-based calendar month index. */
const MONTH_INDEX_BY_LABEL: Record<string, number> = Object.fromEntries(
  MONTH_LABELS_FR.map((label, index) => [label, index]),
);

/** The Algerian school week — Dimanche à Jeudi (T-243 convention). */
export const SCHOOL_WEEK_ROWS: { key: string; jsDay: number }[] = [
  { key: "Dim", jsDay: 0 },
  { key: "Lun", jsDay: 1 },
  { key: "Mar", jsDay: 2 },
  { key: "Mer", jsDay: 3 },
  { key: "Jeu", jsDay: 4 },
];

// ============================================================================
// Range helpers
// ============================================================================

/** Parse an ISO date (yyyy-mm-dd…) into a UTC timestamp; null when invalid. */
function tsOf(iso: string): number | null {
  const t = Date.parse(iso.length > 10 ? iso : `${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Is the payment inside the range window [from 00:00, to 00:00) (UTC)?
 *
 * T-389 (INSPECT-500): the upper bound is EXCLUSIVE at the to-date's
 * midnight — the documented house convention every dashboard aggregate
 * already uses (`SupabaseDashboardRepository.revenueForRange`'s
 * `.lt(collected_at, toT00:00)`, the mock's `t < toMs`, and
 * `buildWindowAnchoredBuckets`'s `cursor < toMs`). The previous
 * inclusive-to-23:59:59 reading counted payments collected ON the `to`
 * date that every KPI excludes — a permanent false "Écart" in the data
 * inspector and a one-day drift between the stat strip and the KPI cards
 * this module is documented to reconcile with (the ENCAISSÉ DEFINITION
 * contract above). All AcademicYearSelector presets emit half-open
 * windows ([from, next-period-start)), so the exclusive bound is the
 * correct reading of every range this tab receives.
 */
export function inRange(p: Payment, range?: { from: string; to: string }): boolean {
  if (!range) return true;
  const from = tsOf(range.from);
  const to = tsOf(range.to);
  const t = Date.parse(p.collectedAt);
  if (Number.isNaN(t)) return false;
  if (from !== null && t < from) return false;
  if (to !== null && t >= to) return false;
  return true;
}

/**
 * Shift an ISO yyyy-mm-dd back one calendar year (leap-day safe: Feb 29 →
 * Feb 28). Used by the page to load the PREVIOUS academic year's revenue
 * for the same month window (an honest like-for-like YoY comparison).
 */
export function shiftIsoYearBack(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const year = parseInt(m[1], 10) - 1;
  const month = m[2];
  const day = month === "02" && m[3] === "29" ? "28" : m[3];
  return `${year}-${month}-${day}`;
}

/** "2025-2026" → "2024-2025" (null when the pattern doesn't match). */
export function previousAcademicYear(code: string): string | null {
  const m = /^(\d{4})-(\d{4})$/.exec(code);
  if (!m) return null;
  return `${parseInt(m[1], 10) - 1}-${parseInt(m[2], 10) - 1}`;
}

// ============================================================================
// T-353 (DASH-403) — academic-year scoping for the installment-derived stats
// ============================================================================

/**
 * The billing window of an academic year: [Sept 1 of the start year,
 * Sept 1 of the following year). "2025-2026" → 2025-09-01 → 2026-09-01.
 * Null when the code doesn't parse (no scoping possible).
 */
export function academicYearWindow(
  academicYear: string,
): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{4})$/.exec(academicYear);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  return { from: `${start}-09-01`, to: `${start + 1}-09-01` };
}

/**
 * T-353 (DASH-403): the installments that BELONG to the given academic
 * year, by billing window (dueDate ∈ [Sept 1 start, Sept 1 next)). The
 * `installments` table carries NO academic_year column — `due_date` is
 * the only year signal — so every installment-derived statistic (wave
 * velocity, debt triage, family concentration, transport yield) must be
 * scoped through THIS filter before derivation. Unparsed year codes (or
 * a null window) return the stream UNCHANGED (honest: cannot scope).
 */
export function installmentsForAcademicYear<T extends { dueDate: string }>(
  installments: readonly T[],
  academicYear: string,
): T[] {
  const window = academicYearWindow(academicYear);
  if (!window) return [...installments];
  const from = tsOf(`${window.from}T00:00:00Z`);
  const to = tsOf(`${window.to}T00:00:00Z`);
  if (from === null || to === null) return [...installments];
  return installments.filter((i) => {
    const due = tsOf(i.dueDate);
    if (due === null) return false;
    return due >= from && due < to;
  });
}

// ============================================================================
// T-389 (INSPECT-500) — the outstanding-debt derivation shared by the
// dashboard KPI semantics and the data inspector
// ============================================================================

/**
 * T-389 (INSPECT-500): the outstanding debt under the EXACT semantics the
 * dashboard's KPI card and the aging chart use (`buildInstallmentsQuery`):
 * installments with `status !== "paid"`, scoped to the academic year's
 * billing window (dueDate ∈ [Sept 1, Sept 1 next)) when an academicYear is
 * given, summed by the INV-4 remaining (amountDue − amountPaid −
 * amountPending, clamped at 0 — uncleared pending funds reduce the
 * outstanding). `academicYear: null` = ALL years (the debt-summaries
 * stream's scoping — used by the Pareto card).
 *
 * This is the ONE definition both the displayed trigger value and the
 * inspector's resolution consume, so the "Écart" can only be a real data
 * drift, never a definitional one.
 */
export function deriveOutstandingDebt(
  installments: readonly Installment[],
  academicYear: string | null,
): number {
  const scoped = academicYear
    ? installmentsForAcademicYear(installments, academicYear)
    : [...installments];
  return scoped
    .filter((i) => i.status !== "paid")
    .reduce((sum, i) => sum + installmentRemaining(i), 0);
}

// ============================================================================
// Slicer filtering (the cross-filtering engine)
// ============================================================================

export interface AnalyticsFilterState {
  /** Empty set = ALL methods included (no method filter). */
  methods: ReadonlySet<PaymentMethod>;
  /** Empty set = ALL categories included (no category filter). ADR-023:
   *  null = the multi-service bucket (a payment collected across the whole
   *  balance — its own toggleable chip, like any concrete category). */
  categories: ReadonlySet<PaymentCategory | null>;
}

export const NO_ANALYTICS_FILTERS: AnalyticsFilterState = {
  methods: new Set(),
  categories: new Set(),
};

export function hasActiveFilters(f: AnalyticsFilterState): boolean {
  return f.methods.size > 0 || f.categories.size > 0;
}

/**
 * The canonical analytics slice: PAID payments, inside the range, matching
 * the slicer selections. Every payments-derived card consumes THIS output
 * so the whole tab cross-filters consistently (Power BI slicer semantics).
 */
export function applyAnalyticsFilters(
  payments: readonly Payment[],
  range: { from: string; to: string } | undefined,
  filters: AnalyticsFilterState,
): Payment[] {
  return payments.filter((p) => {
    if (p.status !== "paid") return false;
    if (!inRange(p, range)) return false;
    if (filters.methods.size > 0 && !filters.methods.has(p.method)) return false;
    // ADR-023: null = the multi-service bucket — a Set that includes null
    // passes multi-service payments; an active filter without it excludes them.
    if (filters.categories.size > 0 && !filters.categories.has(p.category)) return false;
    return true;
  });
}

/** Categories actually present in the unfiltered paid slice (slicer chips). */
export function presentCategories(
  payments: readonly Payment[],
  range: { from: string; to: string } | undefined,
): (PaymentCategory | null)[] {
  const set = new Set<PaymentCategory | null>();
  for (const p of applyAnalyticsFilters(payments, range, NO_ANALYTICS_FILTERS)) {
    set.add(p.category);
  }
  // ADR-023: null = multi-service — labeled via the canonical helper.
  return [...set].sort((a, b) => paymentCategoryLabelFr(a).localeCompare(paymentCategoryLabelFr(b), "fr"));
}

// ============================================================================
// T-255 — statistics strip (Power BI "card" row)
// ============================================================================

export interface PaymentStats {
  count: number;
  total: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  bestMonth: { label: string; amount: number } | null;
}

/** Median of a SORTED numeric array (even lengths average the two middles). */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Descriptive statistics over the (already filtered) paid payments —
 * count, total, mean, median, standard deviation, min/max, best month
 * (calendar month of collectedAt with the highest encaissé).
 */
export function derivePaymentStats(
  slice: readonly Payment[],
): PaymentStats {
  const amounts = slice.map((p) => p.amount);
  const total = amounts.reduce((s, a) => s + a, 0);
  const count = amounts.length;
  const sorted = [...amounts].sort((a, b) => a - b);
  const mean = count > 0 ? Math.round(total / count) : 0;
  const variance = count > 1
    ? amounts.reduce((s, a) => s + (a - mean) * (a - mean), 0) / (count - 1)
    : 0;
  const stdDev = Math.round(Math.sqrt(variance));

  // Best month — REAL calendar-month aggregation of the same slice.
  const byMonth = new Map<number, number>();
  for (const p of slice) {
    const t = Date.parse(p.collectedAt);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    byMonth.set(key, (byMonth.get(key) ?? 0) + p.amount);
  }
  let bestMonth: PaymentStats["bestMonth"] = null;
  for (const [key, amount] of byMonth) {
    if (!bestMonth || amount > bestMonth.amount) {
      const monthIndex = ((key % 12) + 12) % 12;
      bestMonth = { label: MONTH_LABELS_FR[monthIndex], amount };
    }
  }

  return {
    count,
    total,
    mean,
    median: medianOf(sorted),
    stdDev,
    min: count > 0 ? sorted[0] : 0,
    max: count > 0 ? sorted[count - 1] : 0,
    bestMonth,
  };
}

// ============================================================================
// T-256 — method / category mix (donut + ranked bars)
// ============================================================================

export interface MixSlice {
  key: string;
  label: string;
  amount: number;
  count: number;
  percent: number;
}

/** Mix derivation shared by the method donut and the category ranking. */
function deriveMix<K extends string | null>(
  slice: readonly Payment[],
  keyOf: (p: Payment) => K,
  labelOf: (k: K) => string,
): MixSlice[] {
  const agg = new Map<K, { amount: number; count: number }>();
  for (const p of slice) {
    const k = keyOf(p);
    const cur = agg.get(k) ?? { amount: 0, count: 0 };
    cur.amount += p.amount;
    cur.count += 1;
    agg.set(k, cur);
  }
  const total = [...agg.values()].reduce((s, v) => s + v.amount, 0);
  return [...agg.entries()]
    .map(([key, v]) => ({
      key: key ?? "__multi__",
      label: labelOf(key),
      amount: v.amount,
      count: v.count,
      percent: total > 0 ? Math.round((v.amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/** Payment-method mix over the filtered slice (Espèces / Chèque / Virement). */
export function deriveMethodMix(slice: readonly Payment[]): MixSlice[] {
  return deriveMix(slice, (p) => p.method, (k) => PAYMENT_METHOD_LABELS_FR[k]);
}

/**
 * Payment-category mix (Scolarité, Transport, …) over the filtered slice.
 * `topN` merges the tail into "Autres (N)" so the ranking stays readable.
 */
export function deriveCategoryMix(
  slice: readonly Payment[],
  topN = 6,
): MixSlice[] {
  const all = deriveMix(slice, (p) => p.category, (k) => paymentCategoryLabelFr(k));
  if (all.length <= topN) return all;
  const head = all.slice(0, topN);
  const tail = all.slice(topN);
  const tailAmount = tail.reduce((s, v) => s + v.amount, 0);
  const tailCount = tail.reduce((s, v) => s + v.count, 0);
  const total = all.reduce((s, v) => s + v.amount, 0);
  return [
    ...head,
    {
      key: "__tail__",
      label: `Autres (${tail.length})`,
      amount: tailAmount,
      count: tailCount,
      percent: total > 0 ? Math.round((tailAmount / total) * 100) : 0,
    },
  ];
}

// ============================================================================
// T-257 — top-debtors Pareto (80/20)
// ============================================================================

export interface ParetoDatum {
  name: string;
  amount: number;
  cumPercent: number;
}

/**
 * Pareto derivation over the top-debtors summary: bars sorted by
 * outstanding amount (desc — the summary arrives pre-sorted; re-sorted
 * defensively) + the cumulative share of the displayed total.
 */
export function derivePareto(
  topDebtors: { parentName: string; outstandingAmount: number }[],
  topN = 8,
): ParetoDatum[] {
  const sorted = [...topDebtors]
    .filter((d) => d.outstandingAmount > 0)
    .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
    .slice(0, topN);
  const total = sorted.reduce((s, d) => s + d.outstandingAmount, 0);
  let cum = 0;
  return sorted.map((d) => {
    cum += d.outstandingAmount;
    return {
      name: d.parentName,
      amount: d.outstandingAmount,
      cumPercent: total > 0 ? Math.round((cum / total) * 100) : 0,
    };
  });
}

// ============================================================================
// T-257 — aging composition (100% stacked)
// ============================================================================

export interface AgingSegment {
  bucket: AgingBucket;
  label: string;
  amount: number;
  debtorCount: number;
  /** Share of the total outstanding, in percent (rounded). */
  share: number;
}

/** The aging composition as normalized segments (the 100% stacked bar). */
export function deriveAgingComposition(debtAging: readonly DebtByAgingBucket[]): AgingSegment[] {
  const order: AgingBucket[] = ["0_30", "31_60", "61_90", "91_180", "180_plus"];
  const present = new Map(debtAging.map((b) => [b.bucket, b]));
  const total = debtAging.reduce((s, b) => s + b.amount, 0);
  return order
    .filter((bucket) => present.has(bucket))
    .map((bucket) => {
      const b = present.get(bucket)!;
      return {
        bucket,
        label: AGING_BUCKET_LABELS_FR[bucket],
        amount: b.amount,
        debtorCount: b.debtorCount,
        share: total > 0 ? Math.round((b.amount / total) * 100) : 0,
      };
    })
    .filter((s) => s.amount > 0 || s.debtorCount > 0);
}

// ============================================================================
// T-257 — year-over-year comparison (like-for-like months)
// ============================================================================

export interface YoYPoint {
  label: string;
  current: number;
  previous: number;
  deltaPercent: number | null;
}

export interface YoYSummary {
  points: YoYPoint[];
  totalCurrent: number;
  totalPrevious: number;
  deltaPercent: number | null;
}

/**
 * Align the current-year monthly series with the PREVIOUS year's series
 * (the page loads it for the same month window, shifted back one year) by
 * month label. Delta is null where the previous amount is 0 (a divide-by-
 * zero is not a −100% trend — §15.16 honesty).
 */
export function deriveYearOverYear(
  current: readonly RevenuePoint[],
  previous: readonly RevenuePoint[],
): YoYSummary {
  const prevByLabel = new Map(previous.map((p) => [p.label, p.amount]));
  const points: YoYPoint[] = current.map((c) => {
    const prev = prevByLabel.get(c.label) ?? 0;
    return {
      label: c.label,
      current: c.amount,
      previous: prev,
      deltaPercent: prev > 0 ? Math.round(((c.amount - prev) / prev) * 100) : null,
    };
  });
  const totalCurrent = points.reduce((s, p) => s + p.current, 0);
  const totalPrevious = points.reduce((s, p) => s + p.previous, 0);
  return {
    points,
    totalCurrent,
    totalPrevious,
    deltaPercent: totalPrevious > 0
      ? Math.round(((totalCurrent - totalPrevious) / totalPrevious) * 100)
      : null,
  };
}
