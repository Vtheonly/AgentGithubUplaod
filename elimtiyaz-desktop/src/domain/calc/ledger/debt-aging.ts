/**
 * Cross-year debt aging & payment-behavior tracking — T-405 (2026-09-22).
 *
 * THE canonical debt-status calculation, per docs/domain/financial-rules.md §15.
 *
 * PRINCIPLE (the T-405 rule, AGENTS.md):
 *   This module is an ANALYSIS layer on top of the existing Finance system.
 *   It does NOT create a second ledger, a second balance formula, a second
 *   payment history, or a second allocation engine. Every input is an
 *   existing canonical fact:
 *
 *     - outstanding per obligation = the INV-4 family formula on REAL
 *       installment rows (`clampNonNegative(amount_due − amount_paid −
 *       amount_pending)`) — the SAME number the Créances tab
 *       (`DebtRepository.observeSummary`) shows;
 *     - payment behavior = the parent's NON-REVERSED `payment` ledger
 *       entries (the same replay source as `computeParentSummary`);
 *     - academic-year attribution = the `academic_years` rows, with the
 *       Algerian school-year calendar convention as fallback (INV-14).
 *
 * WHAT IT ADDS (and nothing else):
 *   - origin academic year + original due date of the OLDEST outstanding
 *     obligation (never rewritten by later payments);
 *   - debt age measured from that due date (never reset by partial
 *     payments — age is a property of the obligation);
 *   - last payment, inactivity, subsequent-year payment activity (INV-15);
 *   - the ordered payment-behavior status evaluation (INV-16) with its
 *   - canonical reason code — Green/Yellow/Orange/Red are PRESENTATION of
 *     this one calculation (INV-16c/16d).
 *
 * The SQL mirror is migration 0111 `compute_debt_aging_summary` — it must
 * produce identical factors + reason codes (pinned by verify_t-405.sql).
 */

import type { LedgerEntry } from "@/domain/model/ledger";
import type { Installment, Payment, PaymentCategory } from "@/domain/model/payment";
import { daysBetweenFloor } from "../shared/dates";

/* ================================================================== */
/*  Canonical thresholds (§15.1 — configurable since T-429 / issue #25)  */
/* ================================================================== */

/**
 * T-429 (DEBT-100, issues #24/#25 Track 5): the configurable debt-aging
 * thresholds — seeded to `public.system_settings` (category `debt`) by
 * migration 0125 and editable from the system-settings admin UI
 * ("Configuration des Créances"). The constants below are the DEFAULTS
 * (the documented values the owner's audit specified); the live values
 * are read from the settings table at analysis time.
 *
 * The hierarchy (strict, no gaps — §15.1 as amended by T-429):
 *   1. outstanding ≤ 0.001                       → GREEN  (Soldé)
 *   2. debtAgeDays ≤ gracePeriodDays (5)         → GREEN  (À échoir / En cours)
 *   3. debtAgeDays ≤ threshold_yellow_days (15)  → YELLOW (À surveiller)
 *   4. debtAgeDays ≤ threshold_red_days (60)     → ORANGE (Retard soutenu)
 *   5. debtAgeDays >  threshold_red_days (60)     → RED    (Critique / Contentieux)
 */
export interface DebtAgingThresholds {
  /** Days past due still counted as "en cours" (the tolerance window). */
  readonly gracePeriodDays: number;
  /** Past this many days late the account is "À surveiller" (yellow). */
  readonly yellowDays: number;
  /** Past this many days late the account is "Critique / Contentieux" (red). */
  readonly redDays: number;
  /**
   * A payment within the last N days marks the parent a "payeur actif"
   * — an ANNOTATION on the explanation, NEVER a status input (the
   * T-429 decoupling: a recent payment must not mask past-due debt).
   */
  readonly activePayerGraceDays: number;
  /**
   * T-469 (DEBT-103, migration 0138): the AMOUNT dimension's yellow edge —
   * an outstanding at or above this is "montant à surveiller". A SEPARATE
   * canonical dimension from the day-based status: a 3 000 DZD debt 100
   * days late is day-RED/amount-green; a 90 000 DZD debt 2 days late is
   * day-green/amount-red — both facts matter, neither masks the other.
   * OPTIONAL + additive: every pre-0138 consumer compiles unchanged.
   */
  readonly amountYellowDzd?: number;
  /**
   * T-469 (DEBT-103): the AMOUNT dimension's red edge — an outstanding
   * above this is "montant critique".
   */
  readonly amountRedDzd?: number;
  /**
   * T-469 (DEBT-103): the configurable per-level MESSAGE templates
   * (migration 0138's `debt.level_message_*` settings). EMPTY/absent = the
   * canonical engine's reason-code explanation STANDS — a configured
   * message EXTENDS the explanation, never replaces it.
   */
  readonly levelMessages?: Partial<Record<DebtAgingStatusLevel, string>>;
  /**
   * T-502 (DEBT-104): the SEVERE-DEBT edge — the family outstanding at or
   * above this is a "Créance Critique" in the Console
   * d'Investigation Opérationnelle (the severe-debt quick query). A
   * SEPARATE dimension from the amount bands above (the console's
   * operational triage edge, not the aging display's band); configurable
   * via `debt.severe_debt_dzd` (migration 0150, default 40 000 — the
   * previously hardcoded value, preserved as the documented default).
   * OPTIONAL + additive: every pre-0147 consumer compiles unchanged.
   */
  readonly severeDebtDzd?: number;
}

/** The owner-specified defaults (migration 0125's seed values; the 0138
 * amount edges + the empty-message default; the 0147 severe-debt edge). */
export const DEFAULT_DEBT_AGING_THRESHOLDS: DebtAgingThresholds = {
  gracePeriodDays: 5,
  yellowDays: 15,
  redDays: 60,
  activePayerGraceDays: 15,
  amountYellowDzd: 20_000,
  amountRedDzd: 60_000,
  levelMessages: {},
  // T-502 (DEBT-104): the severe-debt quick query's edge — 40 000 DZD, the
  // exact value the console hardcoded pre-0147 (the default preserves the
  // existing behavior by construction).
  severeDebtDzd: 40_000,
};

/**
 * Legacy pre-T-429 window (the 60-day active-payer GREEN rule) — retained
 * as a documented historical reference ONLY; the rule itself is REMOVED
 * (DEBT-100/issue #24 Track 2 item 3: "A recent payment must not mask
 * accounts that remain millions of dinars past due").
 */
export const DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS = 60;

/** INV-4 epsilon: outstanding at or below this is "resolved". */
export const DEBT_AGING_EPSILON_DZD = 0.001;

/* ================================================================== */
/*  T-469 (DEBT-103) — the AMOUNT classification + the level messages   */
/* ================================================================== */

/** The amount-band level (the AMOUNT dimension — a 3-band green/yellow/red). */
export type DebtAmountLevel = "green" | "yellow" | "red";

/** The amount-band labels (FR — the §15.3 one-wording rule). */
export const DEBT_AMOUNT_LEVEL_LABELS_FR: Record<DebtAmountLevel, string> = {
  green: "Montant maîtrisé",
  yellow: "Montant à surveiller",
  red: "Montant critique",
};

/**
 * T-469 (DEBT-103): the canonical AMOUNT classification — the SAME
 * thresholds object the day-based status engine consumes (migration 0138's
 * `debt.amount_threshold_yellow_dzd` / `debt.amount_threshold_red_dzd`), so
 * every surface (Créances, Year Tracking, filters, dashboards) evaluates
 * the amount band from ONE configuration — never a page-local hardcode.
 *
 * The bands (strict, no gaps — the INV-16a discipline applied to amounts):
 *   1. amount <  amountYellowDzd (0 = disabled)  → GREEN
 *   2. amount >= amountYellowDzd                 → YELLOW
 *   3. amount >  amountRedDzd                    → RED
 *
 * A SEPARATE dimension from the day-based aging status: a small very-late
 * debt is day-RED/amount-green; a large freshly-missed one is
 * day-green/amount-red — both facts matter, neither masks the other.
 */
export function classifyOutstandingAmount(
  amount: number,
  thresholds: Pick<DebtAgingThresholds, "amountYellowDzd" | "amountRedDzd">,
): DebtAmountLevel {
  const yellow = thresholds.amountYellowDzd;
  const red = thresholds.amountRedDzd;
  // 0 (or absent) = the edge is DISABLED — no amount crosses it.
  if (typeof red === "number" && red > 0 && amount > red) return "red";
  if (typeof yellow === "number" && yellow > 0 && amount >= yellow) return "yellow";
  return "green";
}

/**
 * T-469 (DEBT-103): the configured per-level message (migration 0138's
 * `debt.level_message_*` settings) — NULL when not configured, in which
 * case the canonical reason-code explanation STANDS (the message EXTENDS
 * the explanation, never replaces it). One resolver for every surface.
 */
export function configuredLevelMessage(
  level: DebtAgingStatusLevel,
  thresholds: Pick<DebtAgingThresholds, "levelMessages">,
): string | null {
  const message = thresholds.levelMessages?.[level]?.trim();
  return message ? message : null;
}

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

/** The canonical payment-behavior status level. Presentation colors map
 *  onto this; they are never the logic (INV-16c). */
export type DebtAgingStatusLevel = "green" | "yellow" | "orange" | "red";

/**
 * Canonical machine reason — produced identically by the TS engine and the
 * SQL mirror (0111 as amended by 0125). The FR explanation is RENDERED
 * from this + the facts by the engine so labels live in exactly one place
 * per platform (the PARITY-001 discipline).
 */
export type DebtAgingReasonCode =
  | "resolved" // outstanding <= epsilon (tier 1)
  | "not_due" // nothing past due beyond the grace window (tier 2)
  | "watch" // past due, within the yellow threshold (tier 3)
  | "sustained_delinquency" // past due, between yellow and red (tier 4)
  | "critical_delinquency" // past due beyond the red threshold (tier 5)

/** A tenant `academic_years` row, reduced to the attribution window.
 *  T-436: `id` (optional, additive) enables the persisted-attribution
 *  precedence (INV-18a) — consumers that pass only the window trio keep
 *  the INV-14 date behavior unchanged. */
export interface AcademicYearWindow {
  /** The year code/label, e.g. "2025-2026". */
  readonly code: string;
  readonly startDate: string;
  readonly endDate: string;
  /** The `academic_years.id` — present when the caller can supply it. */
  readonly id?: string;
}

/** One outstanding obligation (an unpaid installment), aging-attributed. */
export interface DebtAgingObligation {
  readonly installmentId: string;
  readonly studentId: string | null;
  readonly category: PaymentCategory;
  readonly label: string;
  /** Canonical INV-4 family remaining: max(0, due − paid − pending). */
  readonly remaining: number;
  /** Original due date — the aging basis (INV-4: from the due date). */
  readonly dueDate: string;
  /** INV-14 attribution of the due date. */
  readonly academicYear: string;
  /** Floor days from dueDate to `now` (0 when not yet due). */
  readonly daysOverdue: number;
}

/** The computed status: level + reason + rendered explanation. */
export interface DebtAgingStatus {
  readonly level: DebtAgingStatusLevel;
  readonly reasonCode: DebtAgingReasonCode;
  readonly explanationFr: string;
}

/** The full per-parent cross-year debt-aging record (§15 contract). */
export interface DebtAgingAnalysis {
  readonly parentId: string;
  /** Σ canonical remaining over unpaid installments — the Finance-tab number. */
  readonly outstandingAmount: number;
  /** Due date of the OLDEST outstanding obligation (null when resolved). */
  readonly oldestDueDate: string | null;
  /** Days from oldestDueDate to `now`. NEVER reset by partial payments. */
  readonly debtAgeDays: number;
  /** INV-14 year of the oldest outstanding obligation (null when resolved). */
  readonly originAcademicYear: string | null;
  /** MAX(at) over non-reversed payment entries (null when never paid). */
  readonly lastPaymentAt: string | null;
  /** Days from lastPaymentAt to `now` (null when never paid). */
  readonly daysSinceLastPayment: number | null;
  /** §15: last-payment recency; never-paid defaults to debtAgeDays (INV-16b). */
  readonly inactivityDays: number;
  /** INV-15: payments in academic years STRICTLY after the origin year. */
  readonly subsequentYearPaymentCount: number;
  /** Σ amounts of those subsequent-year payments (absolute DZD). */
  readonly subsequentYearPaymentTotal: number;
  readonly hasSubsequentYearPayments: boolean;
  readonly obligations: readonly DebtAgingObligation[];
  /** Distinct student ids carrying outstanding obligations. */
  readonly affectedStudentIds: readonly string[];
  readonly status: DebtAgingStatus;
  /** ISO timestamp of the `now` the analysis was computed at. */
  readonly computedAt: string;
}

/* ================================================================== */
/*  Academic-year attribution (INV-14)                                 */
/* ================================================================== */

/**
 * Attribute a date to an academic year.
 *
 * Priority (financial-rules §15, INV-14):
 *   1. a tenant `academic_years` row whose [start_date, end_date] contains
 *      the date → that row's code;
 *   2. otherwise the Algerian school-year calendar convention: July–December
 *      belongs to `YYYY-(YYYY+1)`, January–June to `(YYYY-1)-YYYY`.
 *
 * The live tenant carries only 2026-2027 — historical due dates (the legacy
 * corpus and any carried-forward debt) resolve through the convention, which
 * is deterministic and never rewrites history.
 */
export function resolveAcademicYearForDate(
  isoDate: string,
  years: readonly AcademicYearWindow[] = [],
): string {
  const t = new Date(isoDate).getTime();
  if (Number.isFinite(t)) {
    for (const y of years) {
      const start = new Date(y.startDate).getTime();
      const end = new Date(y.endDate).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && t >= start && t <= end) {
        return y.code;
      }
    }
  }
  const d = Number.isFinite(t) ? new Date(t) : new Date(isoDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1..12
  // July(7)..December(12) → the school year STARTS this calendar year.
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/** Numeric sort key of a "YYYY-YYYY" code (the start year). */
export function academicYearStart(code: string): number {
  const parsed = Number.parseInt(code.slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/* ================================================================== */
/*  Persisted-attribution precedence (T-436 / ADR-030 — INV-18a)       */
/* ================================================================== */

/** How a row's academic year was resolved (INV-18a — a presentation fact). */
export type AttributionSource = "persisted" | "due_date" | "payment_date";

/** The resolved academic-year attribution of one financial row. */
export interface AcademicYearAttribution {
  /** The year code ("2025-2026") — the rendered label everywhere. */
  readonly code: string;
  /** The `academic_years` row id when resolved via the persisted column. */
  readonly id: string | null;
  readonly source: AttributionSource;
}

/**
 * T-436 (INV-18a — the ONE precedence): attribute an INSTALLMENT (a
 * charge) to an academic year — the persisted `academicYearId`
 * (migration 0127) first, then the INV-14 rule on `dueDate`. A
 * persisted attribution NEVER changes with a due-date edit (INV-18b —
 * DATA-051's fix): `updateDueDate` rewrites the date only, and this
 * function keeps returning the persisted year. An unresolvable id
 * (a year row that disappeared) falls back to the date rule.
 */
export function attributeInstallmentAcademicYear(
  installment: { readonly dueDate: string; readonly academicYearId?: string | null },
  years: readonly AcademicYearWindow[] = [],
): AcademicYearAttribution {
  if (installment.academicYearId) {
    for (const y of years) {
      if (y.id && y.id === installment.academicYearId) {
        return { code: y.code, id: y.id, source: "persisted" };
      }
    }
  }
  return {
    code: resolveAcademicYearForDate(installment.dueDate, years),
    id: null,
    source: "due_date",
  };
}

/**
 * T-436 (INV-18): attribute a PAYMENT to the academic year it was MADE
 * in — the same precedence on `collectedAt` (persisted first, INV-14
 * fallback). The payment's year is DISTINCT from the settlement-target
 * year its allocations carry (financial-rules §17.1).
 */
export function attributePaymentAcademicYear(
  payment: { readonly collectedAt: string; readonly academicYearId?: string | null },
  years: readonly AcademicYearWindow[] = [],
): AcademicYearAttribution {
  if (payment.academicYearId) {
    for (const y of years) {
      if (y.id && y.id === payment.academicYearId) {
        return { code: y.code, id: y.id, source: "persisted" };
      }
    }
  }
  return {
    code: resolveAcademicYearForDate(payment.collectedAt, years),
    id: null,
    source: "payment_date",
  };
}

/* ================================================================== */
/*  The status evaluation (INV-16) — ordered, thresholds from §15.1     */
/* ================================================================== */

export interface DebtAgingStatusFactors {
  readonly outstandingAmount: number;
  readonly debtAgeDays: number;
  /** INV-15 fact — an ANNOTATION since T-429 (never a status input). */
  readonly inactivityDays: number;
  /** INV-15 fact, used in the active-payer annotation only. */
  readonly hasSubsequentYearPayments?: boolean;
}

/**
 * The canonical ordered evaluation (financial-rules §15.1 as amended by
 * T-429 / DEBT-100 / issues #24/#25 Track 5):
 *
 *   1. outstanding ≤ 0.001 DZD             → GREEN  (Soldé)
 *   2. debtAgeDays ≤ grace (default 5)     → GREEN  (À échoir / En cours)
 *   3. debtAgeDays ≤ yellow (default 15)   → YELLOW (À surveiller)
 *   4. debtAgeDays ≤ red (default 60)      → ORANGE (Retard soutenu)
 *   5. debtAgeDays > red (default 60)      → RED    (Critique / Contentieux)
 *
 * The status is PURELY due-date-based aging over the INV-4 remaining —
 * the T-429 decoupling removed the pre-T-429 rule 2 (inactivity ≤ 60 →
 * GREEN): a recent payment ANNOTATES the explanation ("payeur actif",
 * within `activePayerGraceDays`) but never masks past-due debt. INV-16c
 * (no amount tiers) and INV-16d (the explanation contract) are preserved.
 */
export function computeDebtAgingStatus(
  factors: DebtAgingStatusFactors,
  thresholds: DebtAgingThresholds = DEFAULT_DEBT_AGING_THRESHOLDS,
): DebtAgingStatus {
  const { outstandingAmount, debtAgeDays, inactivityDays } = factors;
  const subsequent = factors.hasSubsequentYearPayments === true;
  // The active-payer annotation (presentation only — DEBT-100's
  // decoupling: never a status input, never a masking rule).
  const activePayer = inactivityDays <= thresholds.activePayerGraceDays;
  const activePayerNote = activePayer
    ? ` Payeur actif — dernier paiement il y a ${inactivityDays} j` +
      (subsequent ? " ; paiements poursuivis sur les années suivantes." : ".")
    : "";

  if (outstandingAmount <= DEBT_AGING_EPSILON_DZD) {
    return {
      level: "green",
      reasonCode: "resolved",
      explanationFr: "Soldé — aucune créance en cours.",
    };
  }
  if (debtAgeDays <= thresholds.gracePeriodDays) {
    return {
      level: "green",
      reasonCode: "not_due",
      explanationFr:
        `À échoir — l'échéance n'est pas dépassée au-delà du délai de grâce ` +
        `(${thresholds.gracePeriodDays} j ; dette de ${debtAgeDays} j).` +
        activePayerNote,
    };
  }
  if (debtAgeDays <= thresholds.yellowDays) {
    return {
      level: "yellow",
      reasonCode: "watch",
      explanationFr:
        `À surveiller — échéance dépassée de ${debtAgeDays} j (seuil de ` +
        `${thresholds.yellowDays} j ; dernière activité de paiement il y a ` +
        `${inactivityDays} j).` + activePayerNote,
    };
  }
  if (debtAgeDays <= thresholds.redDays) {
    return {
      level: "orange",
      reasonCode: "sustained_delinquency",
      explanationFr:
        `Retard soutenu — échéance dépassée de ${debtAgeDays} j (entre les ` +
        `seuils ${thresholds.yellowDays} et ${thresholds.redDays} j ; dernier ` +
        `paiement il y a ${inactivityDays} j).` + activePayerNote,
    };
  }
  return {
    level: "red",
    reasonCode: "critical_delinquency",
    explanationFr:
      `Critique — échéance dépassée de ${debtAgeDays} j au-delà du seuil de ` +
      `${thresholds.redDays} j ; dernier paiement il y a ${inactivityDays} j.` +
      activePayerNote,
  };
}

/* ================================================================== */
/*  The per-parent analysis                                            */
/* ================================================================== */

/**
 * The per-parent analysis input — T-436: `installments` and (new,
 * optional) `payments` carry the persisted academic-year attribution
 * (ADR-030); the ledger entries stay the payment-behavior replay source.
 */
export interface DebtAgingAnalysisInput {
  readonly parentId: string;
  /** The family's REAL installment rows (server waterfall results — never
   *  re-allocated client-side; ADR-002). */
  readonly installments: readonly Installment[];
  /** The family's payment rows — enables the persisted payment-year
   *  attribution (T-436); when absent the ledger entry dates are used
   *  (the pre-T-436 behavior, byte-identical). */
  readonly payments?: readonly Payment[];
  /** ALL ledger entries for the family (payment behavior is replayed from
   *  the non-reversed `payment` entries — the computeParentSummary source). */
  readonly ledgerEntries: readonly LedgerEntry[];
  /** The tenant's academic_years rows (may be empty — convention fallback). */
  readonly academicYears?: readonly AcademicYearWindow[];
  /** The evaluation clock (deterministic tests / as-of reports). */
  readonly now?: Date;
  /**
   * T-429 (DEBT-100): the configurable thresholds — read from the
   * `system_settings` (category `debt`) rows by the caller; the DEFAULTS
   * apply when absent (the migration-0125 seed values).
   */
  readonly thresholds?: DebtAgingThresholds;
}

/**
 * Compute the full cross-year debt-aging record for one parent.
 *
 * Pure and deterministic: same inputs + same `now` → same record. The
 * outstanding amount is byte-identical to the Créances tab's number for the
 * family (same formula, same rows). Returns an analysis even when the debt
 * is resolved (status GREEN / resolved) — callers filter what they show.
 */
export function computeDebtAgingAnalysis(input: DebtAgingAnalysisInput): DebtAgingAnalysis {
  const now = input.now ?? new Date();
  const years = input.academicYears ?? [];

  // ── Obligations: unpaid installments with the canonical remaining ──
  const obligations: DebtAgingObligation[] = [];
  let outstandingAmount = 0;
  for (const ins of input.installments) {
    if (ins.parentId !== input.parentId) continue;
    const remaining = Math.max(
      0,
      ins.amountDue - ins.amountPaid - ins.amountPending,
    );
    if (remaining <= 0) continue;
    outstandingAmount += remaining;
    obligations.push({
      installmentId: ins.id,
      studentId: ins.studentId,
      category: ins.category,
      label: ins.label,
      remaining,
      dueDate: ins.dueDate,
      // T-436 (INV-18a): the obligation's year now resolves through the
      // ONE precedence — the persisted `academicYearId` first (frozen at
      // write time; a due-date edit can no longer re-attribute it), the
      // INV-14 date rule as the documented fallback. Byte-identical to
      // the old value for every row without a persisted id.
      academicYear: attributeInstallmentAcademicYear(ins, years).code,
      daysOverdue: daysBetweenFloor(ins.dueDate, now),
    });
  }
  // Oldest outstanding obligation drives age + origin year (§15).
  obligations.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.installmentId.localeCompare(b.installmentId)));
  const oldest = obligations[0] ?? null;

  // ── Payment behavior: non-reversed payment entries ──
  // Reversal exclusion mirrors computeAccountBalance's reversedIds logic.
  const parentEntries = input.ledgerEntries.filter((e) => e.parentId === input.parentId);
  const reversedIds = new Set(
    parentEntries.filter((e) => e.reversesId).map((e) => e.reversesId!),
  );
  const paymentEntries = parentEntries
    .filter((e) => e.type === "payment" && !reversedIds.has(e.id))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)));

  // T-436: the parent's payment rows, indexed by id — lets a payment
  // entry resolve its persisted payment-year attribution (INV-18).
  const parentPaymentsById = new Map(
    (input.payments ?? [])
      .filter((p) => p.parentId === input.parentId)
      .map((p) => [p.id, p]),
  );

  const lastPaymentAt = paymentEntries.length > 0 ? paymentEntries[paymentEntries.length - 1].at : null;
  const daysSinceLastPayment = lastPaymentAt ? daysBetweenFloor(lastPaymentAt, now) : null;

  // ── Debt age: from the ORIGINAL due date; never reset by payments ──
  const debtAgeDays = oldest ? daysBetweenFloor(oldest.dueDate, now) : 0;

  // ── Inactivity (§15): last-payment recency; never-paid → debt age ──
  const inactivityDays = daysSinceLastPayment ?? debtAgeDays;

  // ── Subsequent-year payment activity (INV-15) ──
  let subsequentYearPaymentCount = 0;
  let subsequentYearPaymentTotal = 0;
  if (oldest) {
    const originStart = academicYearStart(oldest.academicYear);
    for (const p of paymentEntries) {
      // T-436 (INV-18): the payment's year uses the same precedence
      // (persisted `payments.academic_year_id` first, INV-14 on the
      // payment date as fallback).
      const sourcePayment = parentPaymentsById.get(p.sourceId ?? "");
      const paymentYear = sourcePayment
        ? attributePaymentAcademicYear(sourcePayment, years).code
        : resolveAcademicYearForDate(p.at, years);
      if (academicYearStart(paymentYear) > originStart) {
        subsequentYearPaymentCount += 1;
        subsequentYearPaymentTotal += Math.abs(p.amount);
      }
    }
  }

  const affectedStudentIds = [
    ...new Set(obligations.map((o) => o.studentId).filter((s): s is string => s !== null)),
  ];

  const status = computeDebtAgingStatus(
    {
      outstandingAmount,
      debtAgeDays,
      inactivityDays,
      hasSubsequentYearPayments: subsequentYearPaymentCount > 0,
    },
    input.thresholds,
  );

  return {
    parentId: input.parentId,
    outstandingAmount,
    oldestDueDate: oldest?.dueDate ?? null,
    debtAgeDays,
    originAcademicYear: oldest?.academicYear ?? null,
    lastPaymentAt,
    daysSinceLastPayment,
    inactivityDays,
    subsequentYearPaymentCount,
    subsequentYearPaymentTotal,
    hasSubsequentYearPayments: subsequentYearPaymentCount > 0,
    obligations,
    affectedStudentIds,
    status,
    computedAt: now.toISOString(),
  };
}

/* ================================================================== */
/*  Presentation labels (§15.3 — one wording per platform)             */
/* ================================================================== */

export const DEBT_AGING_STATUS_LABELS_FR: Record<DebtAgingStatusLevel, string> = {
  green: "Soldé / À échoir",
  yellow: "À surveiller",
  orange: "Retard soutenu",
  red: "Critique / Contentieux",
};

/** StatusChip tone mapping for the shared UI chip (presentation only). */
export const DEBT_AGING_STATUS_TONE: Record<
  DebtAgingStatusLevel,
  "success" | "warning" | "danger" | "neutral"
> = {
  green: "success",
  yellow: "warning",
  orange: "warning",
  red: "danger",
};
