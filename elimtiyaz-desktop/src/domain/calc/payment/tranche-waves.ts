/**
 * T-424 (DATA-042) — THE canonical tranche-wave derivation.
 *
 * One grouping + one math for EVERY surface that renders per-wave tranche
 * state. The Statistics tab (executive-statistics.ts) and the Finance
 * Tranches tab (installment-schedule-tab.tsx) each carried their own
 * `deriveTrancheWaves` with DIFFERENT semantics (status-count clearedPct +
 * NULL-tranche-coerced-into-wave-1 on one side; amounts-only pct with every
 * non-1..3 wave excluded on the other) — the same rows rendered different
 * numbers per surface, the owner's Statistics-vs-Finance contradiction at
 * the display layer.
 *
 * The canonical rules (both surfaces derive their view models from these
 * rows — they may PRESENT differently, never COMPUTE differently):
 *
 *   1. Waves are `(category, trancheNumber)` pairs with trancheNumber in
 *      1..3 — T-425 (the owner's confirmed official model): tuition is
 *      EXACTLY 3 tranches; there is NO 4th tranche (the old "4ème TRANCHE"
 *      was the deleted BON receipt template's error). Tranche 0 (the
 *      registration fee FI), NULL and out-of-range rows (legacy T4
 *      included) are NON-WAVE rows — excluded everywhere, never silently
 *      coerced into wave 1.
 *   2. `settledCount` follows the canonical `isInstallmentSettled`
 *      predicate (INV-4), never a per-surface status check.
 *   3. `remainingTotal` is the INV-4 remaining summed over the wave's rows
 *      (settled rows contribute 0 by construction).
 *   4. Amounts are rounded per-row exactly once (the DZD integer domain).
 *
 * T-447 (STATS-401, 2026-09-30 — the owner's parity mandate: "Finance and
 * Statistics tranches must represent exactly the same thing… the main
 * T1/T2/T3 analysis must include ALL revenue/commitment categories, not
 * tuition only… Total Due = Paid + Pending + Remaining… match to the exact
 * dinar"): this module now owns THREE derivations, all sharing ONE
 * grouping core so no surface can re-implement the math:
 *
 *   a. `deriveTrancheWaveStats`   — the per-(category × wave) rows (the
 *      T-424 contract, byte-identical behavior — the detail breakdown).
 *   b. `derivePooledTrancheWaves` — the per-wave ALL-CATEGORY pool (the
 *      ONE calculation the Statistics main cards and the Finance strip
 *      both consume — the exact-dinar parity object). Family counts are
 *      SET UNIONS across categories (a family owing tuition T1 AND
 *      transport T1 counts once), never sums of per-category counts.
 *   c. `deriveNonWaveSummary`     — the FI (tranche 0) / unnumbered /
 *      out-of-range rows grouped by (kind × category) — the categories the
 *      wave model excludes BY DESIGN, surfaced explicitly so the analysis
 *      covers every revenue/commitment category with nothing silently
 *      dropped.
 *
 * The reconciliation invariant every pooled row carries (the mandate's
 * "Total Due = Paid + Pending + Remaining", exact per row):
 *
 *   dueTotal + overCoverageTotal = paidTotal + pendingTotal + remainingTotal
 *
 * where `overCoverageTotal` = Σ per-row max(0, paid + pending − due) — the
 * uncleared+cleared funds exceeding the row's due (parent credit sitting
 * ON the row). When it is 0 (the normal case) the identity is the mandate's
 * plain form; when it is not, the reconciliation line states it so the
 * identity never silently breaks.
 */
import type { Installment, PaymentCategory } from "../../model/payment";
import { installmentRemaining, isInstallmentSettled } from "./queries";
// T-502 (STATS-403): the configured debt-aging thresholds — the SAME
// object the aging engine + the triage consume (one configuration, every
// overdue verdict). Import is type+default only (no cycle: debt-aging
// never imports this module).
import {
  DEFAULT_DEBT_AGING_THRESHOLDS,
  type DebtAgingThresholds,
} from "../ledger/debt-aging";
import { daysBetweenFloor } from "../shared/dates";

/** The canonical per-wave statistics (one row per category × tranche 1..3). */
export interface TrancheWaveStats {
  readonly category: PaymentCategory;
  readonly wave: 1 | 2 | 3;
  /** Rows in the wave (non-wave rows never reach here). */
  readonly installmentCount: number;
  /** Rows settled per the canonical predicate. */
  readonly settledCount: number;
  /** Distinct families carrying a row in the wave. */
  readonly familyCount: number;
  /** Distinct families with an unsettled row that still owes (> 0 remaining). */
  readonly debtorFamilyCount: number;
  /**
   * T-427 (DATA-048, issues #24/#25 Track 2 item 1): distinct families
   * with an unsettled, STILL-OWING row whose due date is STRICTLY PAST —
   * the wave's actually-late families. `debtorFamilyCount` counts every
   * owing family regardless of due date (a future T2/T3 tranche's
   * current balance is "non soldée", NOT "en retard"); presentations
   * that label a count "en retard" must use THIS field.
   */
  readonly overdueDebtorFamilyCount: number;
  readonly dueTotal: number;
  readonly paidTotal: number;
  readonly pendingTotal: number;
  readonly remainingTotal: number;
  /** Earliest due date in the wave, epoch ms (null when no row carries one). */
  readonly dueDateMin: number | null;
  /**
   * T-435 (UI-317): LATEST due date in the wave, epoch ms (null when no
   * row carries one). Together with `dueDateMin` this is the wave's due
   * DATE RANGE — the spread the wave cards must render so a wave whose
   * rows drifted off the official schedule (the per-row échéance editor,
   * mid-year custom schedules) is AUDITABLE at a glance instead of
   * collapsing to its earliest date. min === max on the official
   * schedule (every row of a wave carries the same date); the range
   * display degenerates to the single date then.
   */
  readonly dueDateMax: number | null;
  /** Any unsettled row already past due (the wave's "overdue" phase input). */
  readonly anyUnsettledOverdue: boolean;
  /** Any unsettled row not yet due (the wave's "not_due" phase input). */
  readonly anyUnsettledFuture: boolean;
}

/**
 * T-447 (STATS-401) — the canonical POOLED per-wave statistics: one row per
 * tranche 1..3, EVERY billing category pooled (the all-categories T1/T2/T3
 * analysis). This is the object both the Statistics main wave cards and the
 * Finance Tranches strip consume — one calculation, two presentations.
 */
export interface PooledTrancheWave {
  readonly wave: 1 | 2 | 3;
  /** Rows pooled into the wave (every category). */
  readonly installmentCount: number;
  /** Rows settled per the canonical predicate (every category). */
  readonly settledCount: number;
  /** Distinct families with ANY row in the wave (union across categories). */
  readonly familyCount: number;
  /** Distinct families with an unsettled owing row (union across categories). */
  readonly debtorFamilyCount: number;
  /** Distinct families with an unsettled owing PAST-DUE row (union). */
  readonly overdueDebtorFamilyCount: number;
  readonly dueTotal: number;
  readonly paidTotal: number;
  /** Σ amountPending — the uncleared non-cash funds (the "En cours" leg). */
  readonly pendingTotal: number;
  readonly remainingTotal: number;
  /**
   * Σ per-row max(0, amountPaid + amountPending − amountDue) — the funds
   * sitting on rows beyond their due (parent credit ON the row). The
   * reconciliation identity:
   *   dueTotal + overCoverageTotal = paidTotal + pendingTotal + remainingTotal
   * holds EXACTLY per row and therefore per wave.
   */
  readonly overCoverageTotal: number;
  /** round(paidTotal / dueTotal × 100) — PARITY-001, never clamped. */
  readonly collectedPct: number;
  readonly dueDateMin: number | null;
  readonly dueDateMax: number | null;
  readonly anyUnsettledOverdue: boolean;
  readonly anyUnsettledFuture: boolean;
  /**
   * The wave's per-category breakdown (the canonical stats rows of THIS
   * wave, stable order: tuition → transport → others, then category name).
   * Every category with a row in the wave appears — the audit trail that
   * no revenue category is silently excluded.
   */
  readonly perCategory: readonly TrancheWaveStats[];
}

/**
 * T-447 — the non-wave rows grouped by (kind × category). The wave model
 * excludes these BY DESIGN (rule 1); the mandate requires the analysis to
 * COVER them explicitly (FI first — the registration fee is category
 * "tuition", tranche 0).
 */
export type NonWaveKind = "fi" | "unnumbered" | "out_of_range";

export interface NonWaveCategoryStats {
  readonly kind: NonWaveKind;
  readonly category: PaymentCategory;
  readonly installmentCount: number;
  readonly settledCount: number;
  readonly familyCount: number;
  readonly debtorFamilyCount: number;
  readonly overdueDebtorFamilyCount: number;
  readonly dueTotal: number;
  readonly paidTotal: number;
  readonly pendingTotal: number;
  readonly remainingTotal: number;
  readonly overCoverageTotal: number;
  readonly dueDateMin: number | null;
  readonly dueDateMax: number | null;
  readonly anyUnsettledOverdue: boolean;
}

function tsOf(dueDate: string): number | null {
  const t = new Date(dueDate).getTime();
  return Number.isFinite(t) ? t : null;
}

/** PARITY-001: round(part / total × 100), never clamped, 0 on empty total. */
function pctOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// ============================================================================
// The ONE grouping core (T-447) — shared by every derivation in this module
// ============================================================================

/**
 * The internal accumulator the grouping core produces per
 * (category × wave 1..3) key. Richer than `TrancheWaveStats` (it keeps the
 * family SETS, so pooled derivations can take true unions) — never exported;
 * every public derivation maps it to its own read-only view.
 */
interface WaveAcc {
  category: PaymentCategory;
  /** 1..3 for wave accs; 0 is the internal sentinel for non-wave groups. */
  wave: number;
  installmentCount: number;
  settledCount: number;
  families: Set<string>;
  debtorFamilies: Set<string>;
  overdueDebtorFamilies: Set<string>;
  dueTotal: number;
  paidTotal: number;
  pendingTotal: number;
  remainingTotal: number;
  overCoverageTotal: number;
  dueDateMin: number | null;
  dueDateMax: number | null;
  anyUnsettledOverdue: boolean;
  anyUnsettledFuture: boolean;
}

function newWaveAcc(category: PaymentCategory, wave: number): WaveAcc {
  return {
    category,
    wave,
    installmentCount: 0,
    settledCount: 0,
    families: new Set<string>(),
    debtorFamilies: new Set<string>(),
    overdueDebtorFamilies: new Set<string>(),
    dueTotal: 0,
    paidTotal: 0,
    pendingTotal: 0,
    remainingTotal: 0,
    overCoverageTotal: 0,
    dueDateMin: null,
    dueDateMax: null,
    anyUnsettledOverdue: false,
    anyUnsettledFuture: false,
  };
}

function accumulateWaveRow(
  acc: WaveAcc,
  i: Installment,
  nowEpochMs: number,
  gracePeriodDays: number,
): void {
  acc.installmentCount += 1;
  acc.families.add(i.parentId);
  acc.dueTotal += Math.round(i.amountDue);
  acc.paidTotal += Math.round(i.amountPaid);
  acc.pendingTotal += Math.round(i.amountPending ?? 0);
  const overCoverage =
    Math.round(i.amountPaid) + Math.round(i.amountPending ?? 0) - Math.round(i.amountDue);
  if (overCoverage > 0) acc.overCoverageTotal += overCoverage;
  const dueTs = tsOf(i.dueDate);
  if (dueTs !== null && (acc.dueDateMin === null || dueTs < acc.dueDateMin)) {
    acc.dueDateMin = dueTs;
  }
  // T-435 (UI-317): the range's other bound — the LATEST due date in
  // the wave (the spread's far edge; equals dueDateMin on the official
  // schedule where every row of a wave shares one date).
  if (dueTs !== null && (acc.dueDateMax === null || dueTs > acc.dueDateMax)) {
    acc.dueDateMax = dueTs;
  }
  // Rule 3 — INV-4 remaining over every row (settled rows add 0).
  const remaining = installmentRemaining(i);
  acc.remainingTotal += remaining;
  // Rule 2 — the canonical settled predicate.
  if (isInstallmentSettled(i)) {
    acc.settledCount += 1;
  } else {
    if (remaining > 0) acc.debtorFamilies.add(i.parentId);
    // T-427 (DATA-048) + T-502 (STATS-403): an owing family whose row is
    // past due BEYOND THE CONFIGURED GRACE PERIOD is "en retard"; a
    // future-dated owing family is only "non soldée", and a row inside
    // the grace window is still "en cours" (the acceptable period — the
    // SAME tier-2 green rule the canonical debt-aging engine applies:
    // debtAgeDays <= gracePeriodDays → GREEN "À échoir / En cours").
    // The grace value is the tenant's CONFIGURED threshold
    // (`debt.grace_period_days`, default 5) — never a wave-local rule.
    const daysLate = dueTs !== null ? daysBetweenFloor(i.dueDate, new Date(nowEpochMs)) : 0;
    const isPastDueBeyondGrace = dueTs !== null && daysLate > gracePeriodDays;
    if (remaining > 0 && isPastDueBeyondGrace) {
      acc.overdueDebtorFamilies.add(i.parentId);
    }
    if (dueTs !== null) {
      // T-502 (STATS-403): the wave's "overdue" phase input follows the
      // SAME configured grace period — a row a few days past due (within
      // the tolerance window) keeps the wave "En cours"; only a row
      // past due beyond the grace period flips it "En retard". A row
      // inside the grace window is NEITHER overdue NOR future (the
      // honest middle band → the "in_window" phase downstream).
      if (isPastDueBeyondGrace) acc.anyUnsettledOverdue = true;
      else if (dueTs >= nowEpochMs) acc.anyUnsettledFuture = true;
    }
  }
}

/** Map an accumulator to the public per-category stats row (T-424 contract). */
function accToStats(acc: WaveAcc): TrancheWaveStats {
  return {
    category: acc.category,
    wave: acc.wave as 1 | 2 | 3,
    installmentCount: acc.installmentCount,
    settledCount: acc.settledCount,
    familyCount: acc.families.size,
    debtorFamilyCount: acc.debtorFamilies.size,
    overdueDebtorFamilyCount: acc.overdueDebtorFamilies.size,
    dueTotal: acc.dueTotal,
    paidTotal: acc.paidTotal,
    pendingTotal: acc.pendingTotal,
    remainingTotal: acc.remainingTotal,
    dueDateMin: acc.dueDateMin,
    dueDateMax: acc.dueDateMax,
    anyUnsettledOverdue: acc.anyUnsettledOverdue,
    anyUnsettledFuture: acc.anyUnsettledFuture,
  };
}

/** The stable category order for breakdowns: tuition → transport → others. */
function categoryRank(category: PaymentCategory): number {
  return category === "tuition" ? 0 : category === "transport" ? 1 : 2;
}

/**
 * Group the installments into canonical (category, wave) accumulators.
 *
 * @param installments the tranche rows (any scope — the caller's filtering
 *   is part of its presentation, e.g. the Statistics tab's academic-year
 *   window; the grouping math is not).
 * @param nowEpochMs the "now" the overdue/future flags evaluate against.
 * @param gracePeriodDays T-502 (STATS-403): the CONFIGURED grace period
 *   (days past due still inside the acceptable window) — from
 *   `debt.grace_period_days`. Rows past due within this window are NOT
 *   overdue. Defaults to the documented DEFAULTS (5) — the same fallback
 *   convention `deriveDebtTriage` applies.
 */
function groupWaves(
  installments: readonly Installment[],
  nowEpochMs: number,
  gracePeriodDays: number = DEFAULT_DEBT_AGING_THRESHOLDS.gracePeriodDays,
): Map<string, WaveAcc> {
  const byWave = new Map<string, WaveAcc>();
  for (const i of installments) {
    // Rule 1 — non-wave rows are excluded, never coerced. T-425: the
    // official model has EXACTLY 3 tranches — tranche 0 (the registration
    // fee), NULL and out-of-range numbers (the legacy phantom T4 included)
    // never form a wave.
    const n = i.trancheNumber;
    if (n !== 1 && n !== 2 && n !== 3) continue;
    const wave = n;
    const key = `${i.category}#${wave}`;
    let acc = byWave.get(key);
    if (!acc) {
      acc = newWaveAcc(i.category, wave);
      byWave.set(key, acc);
    }
    accumulateWaveRow(acc, i, nowEpochMs, gracePeriodDays);
  }
  return byWave;
}

/**
 * Group the installments into canonical (category, wave) statistics.
 *
 * @param installments the tranche rows (any scope — the caller's filtering
 *   is part of its presentation, e.g. the Statistics tab's academic-year
 *   window; the grouping math is not).
 * @param nowEpochMs the "now" the overdue/future flags evaluate against.
 * @param thresholds T-502 (STATS-403): the tenant's ACTIVE debt-aging
 *   thresholds — the grace period governs the overdue/future flags
 *   (rows past due within the grace window are NOT overdue). Defaults to
 *   the documented DEFAULTS, the same fallback `deriveDebtTriage` uses.
 */
export function deriveTrancheWaveStats(
  installments: readonly Installment[],
  nowEpochMs: number,
  thresholds: Pick<DebtAgingThresholds, "gracePeriodDays"> = DEFAULT_DEBT_AGING_THRESHOLDS,
): TrancheWaveStats[] {
  const byWave = groupWaves(installments, nowEpochMs, thresholds.gracePeriodDays);
  return [...byWave.values()].map(accToStats);
}

// ============================================================================
// T-447 (STATS-401) — the pooled all-categories derivation
// ============================================================================

/** A zero-row pooled wave (the presentation layers' "no rows billed" state). */
export function emptyPooledWave(wave: 1 | 2 | 3): PooledTrancheWave {
  return {
    wave,
    installmentCount: 0,
    settledCount: 0,
    familyCount: 0,
    debtorFamilyCount: 0,
    overdueDebtorFamilyCount: 0,
    dueTotal: 0,
    paidTotal: 0,
    pendingTotal: 0,
    remainingTotal: 0,
    overCoverageTotal: 0,
    collectedPct: 0,
    dueDateMin: null,
    dueDateMax: null,
    anyUnsettledOverdue: false,
    anyUnsettledFuture: false,
    perCategory: [],
  };
}

function poolAccs(wave: 1 | 2 | 3, accs: WaveAcc[]): PooledTrancheWave {
  // SET UNIONS across categories — a family owing tuition T1 AND transport
  // T1 is ONE family in the pooled row (summing per-category counts would
  // double-count them; the mandate's "match to the exact dinar" applies to
  // the money AND the family counts).
  const families = new Set<string>();
  const debtorFamilies = new Set<string>();
  const overdueDebtorFamilies = new Set<string>();
  let installmentCount = 0;
  let settledCount = 0;
  let dueTotal = 0;
  let paidTotal = 0;
  let pendingTotal = 0;
  let remainingTotal = 0;
  let overCoverageTotal = 0;
  let dueDateMin: number | null = null;
  let dueDateMax: number | null = null;
  let anyUnsettledOverdue = false;
  let anyUnsettledFuture = false;
  for (const acc of accs) {
    installmentCount += acc.installmentCount;
    settledCount += acc.settledCount;
    for (const f of acc.families) families.add(f);
    for (const f of acc.debtorFamilies) debtorFamilies.add(f);
    for (const f of acc.overdueDebtorFamilies) overdueDebtorFamilies.add(f);
    dueTotal += acc.dueTotal;
    paidTotal += acc.paidTotal;
    pendingTotal += acc.pendingTotal;
    remainingTotal += acc.remainingTotal;
    overCoverageTotal += acc.overCoverageTotal;
    if (acc.dueDateMin !== null && (dueDateMin === null || acc.dueDateMin < dueDateMin)) {
      dueDateMin = acc.dueDateMin;
    }
    if (acc.dueDateMax !== null && (dueDateMax === null || acc.dueDateMax > dueDateMax)) {
      dueDateMax = acc.dueDateMax;
    }
    anyUnsettledOverdue = anyUnsettledOverdue || acc.anyUnsettledOverdue;
    anyUnsettledFuture = anyUnsettledFuture || acc.anyUnsettledFuture;
  }
  const perCategory = accs
    .map(accToStats)
    .sort(
      (a, b) =>
        categoryRank(a.category) - categoryRank(b.category) ||
        a.category.localeCompare(b.category),
    );
  return {
    wave,
    installmentCount,
    settledCount,
    familyCount: families.size,
    debtorFamilyCount: debtorFamilies.size,
    overdueDebtorFamilyCount: overdueDebtorFamilies.size,
    dueTotal,
    paidTotal,
    pendingTotal,
    remainingTotal,
    overCoverageTotal,
    // PARITY-001 — the ONE percentage formula (round, never clamped):
    // the same convention as the per-category waves so a pooled rate above
    // 100% is honest (over-covered rows) rather than silently capped.
    collectedPct: pctOf(paidTotal, dueTotal),
    dueDateMin,
    dueDateMax,
    anyUnsettledOverdue,
    anyUnsettledFuture,
    perCategory,
  };
}

/**
 * T-447 (STATS-401) — the canonical POOLED T1/T2/T3 analysis: every
 * billing category's rows pooled per wave index. THE calculation the
 * Statistics main wave cards and the Finance Tranches strip both consume
 * (each keeps its own PRESENTATION — labels, layout, target highlight —
 * never its own math).
 *
 * Only waves with at least one row are returned (honest-empty discipline);
 * the presentation layers fill the fixed T1/T2/T3 slots via
 * `emptyPooledWave(wave)` when a wave has no rows.
 *
 * @param installments the tranche rows (any scope — same contract as
 *   `deriveTrancheWaveStats`).
 * @param nowEpochMs the "now" the overdue/future flags evaluate against
 *   (§15.54d — explicit, never Date.now() inside).
 * @param thresholds T-502 (STATS-403): the tenant's ACTIVE debt-aging
 *   thresholds — the grace period governs the pooled waves' overdue
 *   flags + the overdue family counts (the SAME configuration the
 *   triage/stages consume; default = the documented DEFAULTS).
 */
export function derivePooledTrancheWaves(
  installments: readonly Installment[],
  nowEpochMs: number,
  thresholds: Pick<DebtAgingThresholds, "gracePeriodDays"> = DEFAULT_DEBT_AGING_THRESHOLDS,
): PooledTrancheWave[] {
  const byWave = groupWaves(installments, nowEpochMs, thresholds.gracePeriodDays);
  const byIndex = new Map<number, WaveAcc[]>();
  for (const acc of byWave.values()) {
    const list = byIndex.get(acc.wave) ?? [];
    list.push(acc);
    byIndex.set(acc.wave, list);
  }
  return ([1, 2, 3] as const)
    .filter((wave) => byIndex.has(wave))
    .map((wave) => poolAccs(wave, byIndex.get(wave)!));
}

// ============================================================================
// T-447 — the non-wave summary (FI + unnumbered + out-of-range rows)
// ============================================================================

function nonWaveKindOf(trancheNumber: number | null | undefined): NonWaveKind {
  if (trancheNumber === 0) return "fi";
  if (trancheNumber === null || trancheNumber === undefined) return "unnumbered";
  return "out_of_range";
}

const NON_WAVE_KIND_RANK: Record<NonWaveKind, number> = { fi: 0, unnumbered: 1, out_of_range: 2 };

/**
 * T-447 — the non-wave rows (tranche 0 / unnumbered / out-of-range — the
 * rows rule 1 excludes from every wave), grouped by (kind × category) so
 * the analysis surfaces them explicitly instead of silently dropping them:
 * the registration fee (FI — category "tuition", tranche 0) first, then
 * unnumbered commitments ("Année complète" / custom schedule lines), then
 * legacy out-of-range rows (the pre-T-425 phantom T4).
 *
 * Same stat fields as a wave row; `kind` distinguishes WHY the row is
 * non-wave. Only (kind × category) groups with at least one row are
 * returned.
 *
 * T-502 (STATS-403): accepts the tenant's thresholds — the FI section's
 * overdue flags follow the SAME configured grace period as the waves
 * (the registration fee's "en retard" verdict can no longer disagree
 * with the wave meters' on the same clock + configuration).
 */
export function deriveNonWaveSummary(
  installments: readonly Installment[],
  nowEpochMs: number,
  thresholds: Pick<DebtAgingThresholds, "gracePeriodDays"> = DEFAULT_DEBT_AGING_THRESHOLDS,
): NonWaveCategoryStats[] {
  interface NonWaveAcc extends WaveAcc {
    kind: NonWaveKind;
  }
  const groups = new Map<string, NonWaveAcc>();
  for (const i of installments) {
    const n = i.trancheNumber;
    if (n === 1 || n === 2 || n === 3) continue;
    const kind = nonWaveKindOf(n);
    const key = `${kind}#${i.category}`;
    let acc: NonWaveAcc | undefined = groups.get(key);
    if (!acc) {
      acc = { ...newWaveAcc(i.category, 0), kind };
      groups.set(key, acc);
    }
    accumulateWaveRow(acc, i, nowEpochMs, thresholds.gracePeriodDays);
  }
  return [...groups.values()]
    .map((acc) => ({
      kind: acc.kind,
      category: acc.category,
      installmentCount: acc.installmentCount,
      settledCount: acc.settledCount,
      familyCount: acc.families.size,
      debtorFamilyCount: acc.debtorFamilies.size,
      overdueDebtorFamilyCount: acc.overdueDebtorFamilies.size,
      dueTotal: acc.dueTotal,
      paidTotal: acc.paidTotal,
      pendingTotal: acc.pendingTotal,
      remainingTotal: acc.remainingTotal,
      overCoverageTotal: acc.overCoverageTotal,
      dueDateMin: acc.dueDateMin,
      dueDateMax: acc.dueDateMax,
      anyUnsettledOverdue: acc.anyUnsettledOverdue,
    }))
    .sort(
      (a, b) =>
        NON_WAVE_KIND_RANK[a.kind] - NON_WAVE_KIND_RANK[b.kind] ||
        categoryRank(a.category) - categoryRank(b.category) ||
        a.category.localeCompare(b.category),
    );
}
