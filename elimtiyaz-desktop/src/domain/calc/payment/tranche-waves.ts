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
 */
import type { Installment, PaymentCategory } from "../../model/payment";
import { installmentRemaining, isInstallmentSettled } from "./queries";

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

function tsOf(dueDate: string): number | null {
  const t = new Date(dueDate).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Group the installments into canonical (category, wave) statistics.
 *
 * @param installments the tranche rows (any scope — the caller's filtering
 *   is part of its presentation, e.g. the Statistics tab's academic-year
 *   window; the grouping math is not).
 * @param nowEpochMs the "now" the overdue/future flags evaluate against.
 */
export function deriveTrancheWaveStats(
  installments: readonly Installment[],
  nowEpochMs: number,
): TrancheWaveStats[] {
  interface Acc {
    category: PaymentCategory;
    wave: 1 | 2 | 3;
    installmentCount: number;
    settledCount: number;
    families: Set<string>;
    debtorFamilies: Set<string>;
    overdueDebtorFamilies: Set<string>;
    dueTotal: number;
    paidTotal: number;
    pendingTotal: number;
    remainingTotal: number;
    dueDateMin: number | null;
    dueDateMax: number | null;
    anyUnsettledOverdue: boolean;
    anyUnsettledFuture: boolean;
  }
  const byWave = new Map<string, Acc>();
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
      acc = {
        category: i.category,
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
        dueDateMin: null,
        dueDateMax: null,
        anyUnsettledOverdue: false,
        anyUnsettledFuture: false,
      };
      byWave.set(key, acc);
    }
    acc.installmentCount += 1;
    acc.families.add(i.parentId);
    acc.dueTotal += Math.round(i.amountDue);
    acc.paidTotal += Math.round(i.amountPaid);
    acc.pendingTotal += Math.round(i.amountPending ?? 0);
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
      // T-427 (DATA-048): an owing family whose row is PAST DUE is
      // "en retard"; a future-dated owing family is only "non soldée"
      // — the overdue wave-card count must never include future waves'
      // current balances (the issues-#24/#25 Track-2 finding).
      if (
        remaining > 0 &&
        dueTs !== null &&
        dueTs < nowEpochMs
      ) {
        acc.overdueDebtorFamilies.add(i.parentId);
      }
      if (dueTs !== null) {
        if (dueTs < nowEpochMs) acc.anyUnsettledOverdue = true;
        else acc.anyUnsettledFuture = true;
      }
    }
  }
  return [...byWave.values()].map((acc) => ({
    category: acc.category,
    wave: acc.wave,
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
  }));
}
