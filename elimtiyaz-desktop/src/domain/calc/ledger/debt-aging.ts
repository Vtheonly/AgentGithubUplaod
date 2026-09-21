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
import type { Installment, PaymentCategory } from "@/domain/model/payment";
import { daysBetweenFloor } from "../shared/dates";

/* ================================================================== */
/*  Canonical thresholds (§15.1 — existing boundaries, zero new magic)  */
/* ================================================================== */

/**
 * Rule 2 window: a payment within the last 60 days = "actively paying"
 * (the 31_60 aging-bucket edge — end of the "last two months" band).
 */
export const DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS = 60;

/**
 * Rule 4 threshold: debt older than 90 days with payment stopped =
 * sustained delinquency (the 61_90 bucket edge — the same 90-day
 * convention behind `DebtRepository.lockDelinquentAccounts`).
 */
export const DEBT_AGING_SUSTAINED_DAYS = 90;

/**
 * Rule 3 threshold: both debt age AND inactivity beyond 180 days =
 * critical (the 91_180 bucket edge / the 180_plus band).
 */
export const DEBT_AGING_CRITICAL_DAYS = 180;

/** INV-4 epsilon: outstanding at or below this is "resolved". */
export const DEBT_AGING_EPSILON_DZD = 0.001;

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

/** The canonical payment-behavior status level. Presentation colors map
 *  onto this; they are never the logic (INV-16c). */
export type DebtAgingStatusLevel = "green" | "yellow" | "orange" | "red";

/**
 * Canonical machine reason — produced identically by the TS engine and the
 * SQL mirror (0111). The FR explanation is RENDERED from this + the facts
 * by `debtAgingExplanation` so labels live in exactly one place per
 * platform (the PARITY-001 discipline).
 */
export type DebtAgingReasonCode =
  | "resolved" // outstanding <= epsilon (rule 1)
  | "active_payer" // payment within 60 days (rule 2 — dominates 3..5)
  | "critical_delinquency" // debt > 180d AND inactivity > 180d (rule 3)
  | "sustained_delinquency" // debt > 90d AND inactivity > 60d (rule 4)
  | "watch"; // becoming behind/inactive (rule 5)

/** A tenant `academic_years` row, reduced to the attribution window. */
export interface AcademicYearWindow {
  /** The year code/label, e.g. "2025-2026". */
  readonly code: string;
  readonly startDate: string;
  readonly endDate: string;
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
/*  The status evaluation (INV-16) — ordered, thresholds from §15.1     */
/* ================================================================== */

export interface DebtAgingStatusFactors {
  readonly outstandingAmount: number;
  readonly debtAgeDays: number;
  readonly inactivityDays: number;
  /** INV-15 fact, used in the active-payer explanation only. */
  readonly hasSubsequentYearPayments?: boolean;
}

/**
 * The canonical ordered evaluation (financial-rules §15.1):
 *
 *   1. outstanding ≤ 0.001 DZD                        → GREEN  (resolved)
 *   2. inactivity ≤ 60                                → GREEN  (active payer)
 *   3. debtAge > 180 AND inactivity > 180             → RED    (critical)
 *   4. debtAge > 90 AND inactivity > 60               → ORANGE (sustained)
 *   5. otherwise                                      → YELLOW (watch)
 *
 * INV-16a: rule 2 dominates 3–5 — an old balance with continued payment is
 * NOT delinquency (the task's Parent A archetype). INV-16b: never-paid
 * parents default inactivity to debtAge, so they reach RED exactly when the
 * debt passes 180 days. INV-16c: no amount tiers — the amount is displayed,
 * never a status input beyond the epsilon.
 */
export function computeDebtAgingStatus(
  factors: DebtAgingStatusFactors,
): DebtAgingStatus {
  const { outstandingAmount, debtAgeDays, inactivityDays } = factors;
  const subsequent = factors.hasSubsequentYearPayments === true;

  if (outstandingAmount <= DEBT_AGING_EPSILON_DZD) {
    return {
      level: "green",
      reasonCode: "resolved",
      explanationFr: "Soldé — aucune créance en cours.",
    };
  }
  if (inactivityDays <= DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS) {
    return {
      level: "green",
      reasonCode: "active_payer",
      explanationFr:
        `Actif — paiement il y a ${inactivityDays} j malgré un encours` +
        (subsequent
          ? ` ancien (${debtAgeDays} j) ; paiements poursuivis durant les années suivantes.`
          : ` (${debtAgeDays} j).`),
    };
  }
  if (debtAgeDays > DEBT_AGING_CRITICAL_DAYS && inactivityDays > DEBT_AGING_CRITICAL_DAYS) {
    return {
      level: "red",
      reasonCode: "critical_delinquency",
      explanationFr:
        `Critique — dette ancienne (${debtAgeDays} j) et inactivité prolongée (${inactivityDays} j sans paiement).`,
    };
  }
  if (debtAgeDays > DEBT_AGING_SUSTAINED_DAYS && inactivityDays > DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS) {
    return {
      level: "orange",
      reasonCode: "sustained_delinquency",
      explanationFr:
        `Retard soutenu — dette de ${debtAgeDays} j et paiements interrompus depuis ${inactivityDays} j.`,
    };
  }
  return {
    level: "yellow",
    reasonCode: "watch",
    explanationFr:
      `À surveiller — dette de ${debtAgeDays} j, dernier paiement il y a ${inactivityDays} j : le compte devient inactif ou en retard.`,
  };
}

/* ================================================================== */
/*  The per-parent analysis                                            */
/* ================================================================== */

export interface DebtAgingAnalysisInput {
  readonly parentId: string;
  /** The family's REAL installment rows (server waterfall results — never
   *  re-allocated client-side; ADR-002). */
  readonly installments: readonly Installment[];
  /** ALL ledger entries for the family (payment behavior is replayed from
   *  the non-reversed `payment` entries — the computeParentSummary source). */
  readonly ledgerEntries: readonly LedgerEntry[];
  /** The tenant's academic_years rows (may be empty — convention fallback). */
  readonly academicYears?: readonly AcademicYearWindow[];
  /** The evaluation clock (deterministic tests / as-of reports). */
  readonly now?: Date;
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
      academicYear: resolveAcademicYearForDate(ins.dueDate, years),
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
      const paymentYear = resolveAcademicYearForDate(p.at, years);
      if (academicYearStart(paymentYear) > originStart) {
        subsequentYearPaymentCount += 1;
        subsequentYearPaymentTotal += Math.abs(p.amount);
      }
    }
  }

  const affectedStudentIds = [
    ...new Set(obligations.map((o) => o.studentId).filter((s): s is string => s !== null)),
  ];

  const status = computeDebtAgingStatus({
    outstandingAmount,
    debtAgeDays,
    inactivityDays,
    hasSubsequentYearPayments: subsequentYearPaymentCount > 0,
  });

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
  green: "Actif / Soldé",
  yellow: "À surveiller",
  orange: "Retard soutenu",
  red: "Critique",
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
