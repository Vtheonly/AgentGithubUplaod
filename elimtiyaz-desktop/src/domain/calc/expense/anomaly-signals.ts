/**
 * Expense anomaly signal derivation — T-411 (DATA-027, 95th session).
 *
 * CANONICAL module (AGENTS.md §15.53a: a needed derivation is REGISTERED,
 * not embedded beside the UI). Pure and total; consumes the expenses
 * stream and derives the plan §11.07 signals from REAL data:
 *
 *   1. duplicate      — another expense with the same payee and a near-
 *                       identical amount (± 100 DA) within the last 48 h.
 *   2. new_vendor     — the payee appears on NO other expense (any status).
 *   3. budget_overrun — the amount is ≥ 3× the mean of the category's
 *                       OTHER expenses (minimum 3 samples — no verdict
 *                       from thin evidence).
 *
 * Thresholds (48 h / ±100 DA / 3× / ≥3 samples) are engine-local and
 * documented HERE (the audit's INV-16c spirit: no page-local constants).
 * A signal is a SIGNAL, never a verdict — the human decides.
 *
 * Replaces `buildMockSignals` (the fabricated 3 hardcoded signals that
 * rendered identically for EVERY expense and fed the AI prompt as
 * "Signaux détectés" — audit FA-11 / DATA-027).
 */
import type { Expense } from "../../model/expense";

/** Duplicate window (hours). */
const DUPLICATE_WINDOW_MS = 48 * 3600 * 1000;
/** Duplicate amount tolerance (DZD). */
const DUPLICATE_AMOUNT_EPSILON = 100;
/** Budget-overrun multiplier over the category mean. */
const BUDGET_OVERRUN_FACTOR = 3;
/** Minimum category sample size before an overrun signal can fire. */
const BUDGET_OVERRUN_MIN_SAMPLES = 3;

export interface ExpenseAnomalySignal {
  readonly type: "duplicate" | "new_vendor" | "budget_overrun";
  readonly description: string;
  readonly severity: "high" | "medium" | "low";
}

export function deriveExpenseAnomalySignals(
  expense: Expense,
  allExpenses: readonly Expense[],
): ExpenseAnomalySignal[] {
  const signals: ExpenseAnomalySignal[] = [];
  const others = allExpenses.filter((e) => e.id !== expense.id);

  // 1. duplicate — same payee, near-identical amount, within 48 h.
  const expenseTime = new Date(expense.submittedAt).getTime();
  const duplicate = others.find((e) => {
    if (e.payee !== expense.payee) return false;
    if (Math.abs(e.amount - expense.amount) > DUPLICATE_AMOUNT_EPSILON) return false;
    const t = new Date(e.submittedAt).getTime();
    const dt = Math.abs(t - expenseTime);
    return dt <= DUPLICATE_WINDOW_MS;
  });
  if (duplicate) {
    signals.push({
      type: "duplicate",
      description:
        `Une dépense du même bénéficiaire et d'un montant quasi identique ` +
        `(${duplicate.amount.toLocaleString("fr-FR")} DA — « ${duplicate.title} ») ` +
        `existe à moins de 48 h d'intervalle.`,
      severity: "high",
    });
  }

  // 2. new_vendor — the payee has no history at all.
  const payeeHistory = others.filter((e) => e.payee === expense.payee);
  if (payeeHistory.length === 0) {
    signals.push({
      type: "new_vendor",
      description: `Le bénéficiaire « ${expense.payee} » n'apparaît sur aucune autre dépense de l'établissement.`,
      severity: "medium",
    });
  }

  // 3. budget_overrun — ≥ 3× the category's mean (≥ 3 other samples).
  const categoryOthers = others.filter((e) => e.category === expense.category);
  if (categoryOthers.length >= BUDGET_OVERRUN_MIN_SAMPLES) {
    const mean =
      categoryOthers.reduce((s, e) => s + e.amount, 0) / categoryOthers.length;
    if (mean > 0 && expense.amount >= mean * BUDGET_OVERRUN_FACTOR) {
      signals.push({
        type: "budget_overrun",
        description:
          `Montant ${expense.amount.toLocaleString("fr-FR")} DA ≥ ${BUDGET_OVERRUN_FACTOR}× ` +
          `la moyenne de la catégorie « ${expense.category} » ` +
          `(${Math.round(mean).toLocaleString("fr-FR")} DA sur ${categoryOthers.length} dépenses).`,
        severity: "medium",
      });
    }
  }

  return signals;
}
