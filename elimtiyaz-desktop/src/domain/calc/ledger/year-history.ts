/**
 * Year Tracking — the canonical year-by-year financial history engine
 * (T-436, 2026-09-29; docs/domain/financial-rules.md §17; ADR-030).
 *
 * THE canonical read-side derivation of "who owed what, for what, in
 * WHICH academic year, and how their financial state changed from one
 * year to the next" — the owner's Year-Tracking issue. It is an
 * ANALYSIS layer on TOP of the existing finance system (the §15.53a
 * rule): it creates NO second ledger, NO second balance formula, NO
 * second allocation engine, NO second pricing system. Every input is
 * an existing canonical fact:
 *
 *   - the year a charge BELONGS to   = the installment's persisted
 *     `academicYearId` (migration 0127), else the INV-14 date rule
 *     (debt-aging.ts) — the ONE precedence (INV-18a);
 *   - the year a payment was MADE in = the payment's persisted
 *     `academicYearId`, else INV-14 on `collectedAt`;
 *   - the year a payment SETTLES     = the allocation's persisted
 *     `academicYearId` (denormalized from the allocated installment at
 *     allocation time), else the ALLOCATED INSTALLMENT's attributed
 *     year — settlement is read from `payment_allocations`, never
 *     inferred from amounts or dates (INV-18d);
 *   - every amount = a stored column (`amount_due`, `amount_paid`,
 *     `amount_pending`, `allocated_amount`) or the INV-4 remaining
 *     (`clampNonNegative(due − paid − pending)`) — the SAME numbers the
 *     Créances / Debt Aging surfaces show (INV-20a). Historical prices
 *     are the stored `amount_due` (INV-19a — never re-priced); the
 *     year's pricing configuration is REFERENCED via ADR-025
 *     (`PricingConfigSummary`), never re-derived.
 *
 * Pure and deterministic: same inputs + same clock → same records
 * (INV-20b). The desktop TS engine is the reference implementation
 * (AGENTS.md §8); the UI is a consumer, never a re-implementation.
 */

import type { Installment, Payment, PaymentAllocation } from "@/domain/model/payment";
import type { LedgerEntry } from "@/domain/model/ledger";
import type { PricingConfigSummary } from "@/domain/model/pricing";
import {
  resolveAcademicYearForDate,
  academicYearStart,
  attributeInstallmentAcademicYear,
  attributePaymentAcademicYear,
  type AcademicYearWindow,
  type AcademicYearAttribution,
} from "./debt-aging";

// Re-export the attribution contract so consumers can import the whole
// Year-Tracking vocabulary from ONE module (the §15.3 single-wording rule
// applied to types).
export type { AcademicYearAttribution } from "./debt-aging";

/** INV-4 epsilon — outstanding at or below this is settled. */
export const YEAR_HISTORY_EPSILON_DZD = 0.001;

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

/**
 * How a row's academic year was resolved (INV-18a — a presentation fact).
 * Extends the debt-aging vocabulary with "allocation" — an allocation's
 * target year resolved through its ALLOCATED INSTALLMENT (INV-18d).
 */
export type AttributionSource =
  | "persisted"
  | "due_date"
  | "payment_date"
  | "allocation";

/**
 * The as-of basis a year-end outstanding was computed on (INV-20b
 * honesty): "allocations" = the exact per-charge settlement replay;
 * "paid_date_heuristic" = legacy rows without allocation records
 * (settlement assumed at the charge's paid_date).
 */
export type YearEndBasis = "allocations" | "paid_date_heuristic" | "mixed";

/** One charge (installment) inside a year record. */
export interface YearChargeItem {
  readonly installmentId: string;
  readonly studentId: string | null;
  readonly category: Installment["category"];
  readonly label: string;
  readonly trancheNumber?: 0 | 1 | 2 | 3;
  /** The price actually applied when the charge was created (INV-19a). */
  readonly amountDue: number;
  /** Cleared funds applied (the server waterfall's number — ADR-002). */
  readonly amountPaid: number;
  /** Uncleared non-cash funds sitting on the charge (INV-4). */
  readonly amountPending: number;
  /** INV-4 remaining: clampNonNegative(due − paid − pending). */
  readonly remaining: number;
  readonly dueDate: string;
  readonly paidDate: string | null;
  readonly status: Installment["status"];
  readonly attribution: AcademicYearAttribution;
  /**
   * INV-20 settlement status, evaluated at the CALLER's clock on the
   * STORED amounts (the current truth): "fully_paid" (+ settledAt — the
   * paidDate, or the completing allocation's payment date when the
   * allocation records exist), "partially_paid", "pending_clearance"
   * (uncleared non-cash funds sit on the charge — INV-4: not a
   * settlement), or "outstanding".
   */
  readonly settlement: "fully_paid" | "partially_paid" | "pending_clearance" | "outstanding";
  readonly settledAt: string | null;
}

/** One payment made during a year (attributed by payment-made year). */
export interface YearPaymentItem {
  readonly paymentId: string | null;
  readonly ledgerEntryId: string;
  readonly amount: number;
  readonly at: string;
  readonly method: string | null;
  readonly receiptNumber: string | null;
  readonly attribution: AcademicYearAttribution;
}

/** A payment made in a LATER year settling THIS year's debt (INV-18d). */
export interface CrossYearSettlementItem {
  readonly paymentId: string | null;
  readonly ledgerEntryId: string | null;
  /** The year the payment was MADE in (strictly later than the target). */
  readonly paymentYear: string;
  readonly at: string | null;
  readonly installmentId: string;
  readonly chargeLabel: string | null;
  readonly category: string | null;
  readonly allocatedAmount: number;
  /** The year whose debt was settled (this record's year). */
  readonly targetYear: string;
}

/** One balance-evolution event (INV-20 — the chronological stream). */
export interface BalanceEvolutionEvent {
  readonly at: string;
  readonly kind: "charge" | "payment";
  readonly amount: number;
  readonly label: string;
  /** Running outstanding AFTER the event (Σ charges − Σ payments; a
   *  NEGATIVE value is a credit position — ADR-010's raw-balance rule,
   *  presented, never clamped). */
  readonly runningOutstanding: number;
}

/** One academic year's financial record for the parent. */
export interface AcademicYearFinancialRecord {
  /** The year code ("2025-2026"). */
  readonly academicYear: string;
  readonly academicYearId: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly isOpen: boolean;
  /** What they were supposed to pay — every charge attributed to the year. */
  readonly charges: readonly YearChargeItem[];
  readonly totalCharged: number;
  /** Cleared funds the waterfall applied to THIS year's charges (stored). */
  readonly totalPaidOnCharges: number;
  readonly totalPendingOnCharges: number;
  /**
   * Σ as-of INV-4 remaining over the year's charges AT the year's end
   * date (closed year) or the caller's clock (open year) — INV-20b. The
   * balance the person carried OUT of that academic year. Basis flagged
   * below (allocation replay when the records exist; the documented
   * paid-date heuristic for legacy rows).
   */
  readonly yearEndOutstanding: number;
  readonly yearEndBasis: YearEndBasis;
  /**
   * The previous year's year-end outstanding, still unpaid when this
   * year began (the "re-enrolled while owing" figure — a PRESENTATION
   * of the prior record, never a new balance).
   */
  readonly carriedForwardFromPriorYear: number;
  /** Payments made during this year (payment-made attribution). */
  readonly paymentsMadeInYear: readonly YearPaymentItem[];
  readonly paymentsMadeInYearTotal: number;
  /**
   * Payments made in LATER years that settled THIS year's debt (visible
   * on the receiving year — INV-18c).
   */
  readonly settlementsReceivedFromLaterYears: readonly CrossYearSettlementItem[];
  readonly settlementsReceivedFromLaterYearsTotal: number;
  /** This year's ADR-025 pricing configuration reference (INV-19b). */
  readonly pricingConfig: PricingConfigSummary | null;
  /** Distinct student ids carrying charges this year. */
  readonly affectedStudentIds: readonly string[];
  /**
   * Derived flags (INV-20): a year whose year-end outstanding > 0 whose
   * FOLLOWING year has no charges = "left owing"; following year HAS
   * charges = "re-enrolled owing". Honest presentation facts.
   */
  readonly leftOwing: boolean;
  readonly reEnrolledOwing: boolean;
  /** The chronological balance stream within the year (INV-20). */
  readonly balanceEvolution: readonly BalanceEvolutionEvent[];
}

/** The complete year-by-year financial history of one parent. */
export interface ParentYearHistory {
  readonly parentId: string;
  /** Years ordered by start (oldest first). */
  readonly years: readonly AcademicYearFinancialRecord[];
  /** Σ current INV-4 remaining over every year — the Finance-tab number. */
  readonly totalOutstandingNow: number;
  /**
   * Outstanding on PREVIOUS years (every year before the latest with
   * charges) still unpaid at the caller's clock — the "old debt still
   * owed" figure (INV-18c).
   */
  readonly priorYearOutstandingStillOwed: number;
  readonly computedAt: string;
}

/** The pricing-config lookup the engine consumes (ADR-025 summaries). */
export type PricingConfigIndex = ReadonlyMap<string, PricingConfigSummary>;

/** The engine input — canonical collections + the tenant year windows. */
export interface YearHistoryInput {
  readonly parentId: string;
  /** The family's REAL installment rows (server waterfall truth). */
  readonly installments: readonly Installment[];
  /** The family's payment rows (payment-made year attribution). */
  readonly payments?: readonly Payment[];
  /**
   * The family's payment allocations (settlement truth — INV-18d).
   * Optional: legacy rows without allocations keep honest per-charge
   * facts via amountPaid (the paid-date heuristic); the exact cross-year
   * settlement detail requires them.
   */
  readonly allocations?: readonly PaymentAllocation[];
  /** The family's ledger entries (payment behavior / balance evolution). */
  readonly ledgerEntries: readonly LedgerEntry[];
  /** The tenant's academic_years rows (may be empty — convention fallback). */
  readonly academicYears?: readonly (AcademicYearWindow & { id?: string })[];
  /** Per-year pricing configurations keyed by year CODE (ADR-025). */
  readonly pricingConfigs?: PricingConfigIndex;
  /** The evaluation clock (determinism / as-of reports — INV-20b). */
  readonly now?: Date;
}

/* ================================================================== */
/*  Internal helpers                                                   */
/* ================================================================== */

/** INV-4 family remaining — the same clamp every surface applies. */
function inv4Remaining(ins: Installment): number {
  return Math.max(0, ins.amountDue - ins.amountPaid - ins.amountPending);
}

interface YearMeta {
  readonly start: number;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly id: string | null;
}

function yearMetaOf(
  code: string,
  years: readonly (AcademicYearWindow & { id?: string })[],
): YearMeta {
  for (const y of years) {
    if (y.code === code) {
      const start = new Date(y.startDate).getTime();
      const end = new Date(y.endDate).getTime();
      return {
        start: Number.isFinite(start) ? start : academicYearStart(code),
        startDate: Number.isFinite(start) ? y.startDate : null,
        endDate: Number.isFinite(end) ? y.endDate : null,
        id: y.id ?? null,
      };
    }
  }
  return { start: academicYearStart(code), startDate: null, endDate: null, id: null };
}

/**
 * T-439 (CALC-003): the canonical payment-status classification for
 * allocation replays — the SAME three states `financial-query-engine.ts`
 * (the T-424 canonical) uses for its cleared/pending split:
 *
 *   - `paid` → cleared funds;
 *   - `pending` | `pending_clearance` → committed-but-uncleared (an
 *     uncleared cheque — NOT a settlement, INV-4);
 *   - `unpaid` (what migration 0039's `mark_payment_bounced` sets — the
 *     RPC rolls back the installment's amounts but NEVER deletes the
 *     payment's `payment_allocations` rows), `refunded`, `cancelled` →
 *     NEITHER: the funds are not real money against the charge.
 *
 * A missing payment record (FK-impossible live; mock fixtures always
 * pair them) keeps the replay's legacy behavior: the allocation's own
 * `createdAt` is its clock and the row counts as cleared (unchanged
 * pre-T-439 behavior — the defect being fixed here is the STATUS
 * misclassification, not the orphan edge).
 */
function allocationFundClass(p: Payment | undefined): "paid" | "pending" | "none" {
  if (!p) return "paid";
  if (p.status === "paid") return "paid";
  if (p.status === "pending" || p.status === "pending_clearance") return "pending";
  return "none"; // unpaid (bounced per 0039) / refunded / cancelled
}

/**
 * The as-of paid/pending split of ONE charge at a clock, using the
 * allocation records when they exist (the exact replay) and the paid-date
 * heuristic otherwise (legacy rows predating payment_allocations).
 */
function paidUpToClock(
  ins: Installment,
  clock: Date,
  chargeAllocations: readonly PaymentAllocation[],
  paymentById: ReadonlyMap<string, Payment>,
): { paid: number; pending: number; exact: boolean } {
  if (chargeAllocations.length > 0) {
    let paid = 0;
    let pending = 0;
    for (const a of chargeAllocations) {
      const p = a.paymentId ? paymentById.get(a.paymentId) : undefined;
      const at = p ? new Date(p.collectedAt).getTime() : new Date(a.createdAt).getTime();
      if (!Number.isFinite(at) || at > clock.getTime()) continue;
      // T-439 (CALC-003): classify by STATUS — a bounced (unpaid),
      // refunded or cancelled payment's retained allocation rows are
      // NOT funds; an uncleared cheque (pending_clearance) is committed,
      // never cleared (the canonical financial-query-engine split).
      const funds = allocationFundClass(p);
      if (funds === "none") continue;
      if (funds === "pending") pending += a.allocatedAmount;
      else paid += a.allocatedAmount;
    }
    return { paid, pending, exact: true };
  }
  // Legacy heuristic: the charge's stored settlement state is placed at
  // its paid_date (the only date fact a legacy row carries).
  const settledByThen = ins.paidDate != null && new Date(ins.paidDate).getTime() <= clock.getTime();
  return { paid: settledByThen ? ins.amountPaid : 0, pending: 0, exact: false };
}

/* ================================================================== */
/*  The engine                                                         */
/* ================================================================== */

/**
 * Compute the complete year-by-year financial history for one parent.
 *
 * The records are keyed by the ATTRIBUTED year code, ordered by the
 * year's numeric start. Charge attribution follows INV-18a (persisted →
 * INV-14); payments attribute by their made-in year; allocations link
 * settlement facts across years (INV-18d). All amounts are stored
 * columns or the INV-4 remaining — never re-allocated, never re-priced
 * (INV-20a).
 */
export function computeParentYearHistory(input: YearHistoryInput): ParentYearHistory {
  const now = input.now ?? new Date();
  const years = input.academicYears ?? [];

  // ── Charge attribution (INV-18a) ──
  const parentInstallments = input.installments.filter((i) => i.parentId === input.parentId);
  const chargeAttributions = new Map<string, AcademicYearAttribution>();
  for (const ins of parentInstallments) {
    chargeAttributions.set(ins.id, attributeInstallmentAcademicYear(ins, years));
  }

  // ── Payment attribution (payment-made year) ──
  const parentPayments = (input.payments ?? []).filter((p) => p.parentId === input.parentId);
  const paymentById = new Map(parentPayments.map((p) => [p.id, p]));
  const paymentAttributions = new Map<string, AcademicYearAttribution>();
  for (const p of parentPayments) {
    paymentAttributions.set(p.id, attributePaymentAcademicYear(p, years));
  }

  // ── Ledger payment replay (the §15 source — non-reversed payments) ──
  const parentEntries = input.ledgerEntries.filter((e) => e.parentId === input.parentId);
  const reversedIds = new Set(
    parentEntries.filter((e) => e.reversesId).map((e) => e.reversesId!),
  );
  const paymentEntries = parentEntries
    .filter((e) => e.type === "payment" && !reversedIds.has(e.id))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)));

  // ── Allocation indexes (settlement truth — INV-18d) ──
  const parentInstallmentIds = new Set(parentInstallments.map((i) => i.id));
  const parentAllocations = (input.allocations ?? []).filter(
    (a) =>
      (a.installmentId != null && parentInstallmentIds.has(a.installmentId)) ||
      (a.paymentId != null && paymentById.has(a.paymentId)),
  );
  const allocationsByInstallment = new Map<string, PaymentAllocation[]>();
  for (const a of parentAllocations) {
    if (!a.installmentId) continue;
    const list = allocationsByInstallment.get(a.installmentId) ?? [];
    list.push(a);
    allocationsByInstallment.set(a.installmentId, list);
  }

  // ── Group charges by attributed year ──
  const chargesByYear = new Map<string, Installment[]>();
  for (const ins of parentInstallments) {
    const attr = chargeAttributions.get(ins.id)!;
    const list = chargesByYear.get(attr.code) ?? [];
    list.push(ins);
    chargesByYear.set(attr.code, list);
  }

  // ── Payments made per year (ledger replay + persisted attribution) ──
  const paymentsMadeByYear = new Map<string, YearPaymentItem[]>();
  for (const e of paymentEntries) {
    const sourcePayment = e.sourceId ? paymentById.get(e.sourceId) : undefined;
    const attr: AcademicYearAttribution = sourcePayment
      ? paymentAttributions.get(sourcePayment.id)!
      : {
          code: resolveAcademicYearForDate(e.at, years),
          id: null,
          source: "payment_date",
        };
    const item: YearPaymentItem = {
      paymentId: sourcePayment?.id ?? null,
      ledgerEntryId: e.id,
      amount: Math.abs(e.amount),
      at: e.at,
      method: e.method ?? null,
      receiptNumber: e.receiptNumber ?? null,
      attribution: attr,
    };
    const list = paymentsMadeByYear.get(attr.code) ?? [];
    list.push(item);
    paymentsMadeByYear.set(attr.code, list);
  }

  // ── Cross-year settlements (INV-18d — allocations only) ──
  const settlementsReceivedByYear = new Map<string, CrossYearSettlementItem[]>();
  for (const a of parentAllocations) {
    if (!a.installmentId) continue;
    const chargeAttr = chargeAttributions.get(a.installmentId);
    if (!chargeAttr) continue;
    const paymentAttr = a.paymentId ? paymentAttributions.get(a.paymentId) : undefined;
    if (!paymentAttr) continue;
    const targetStart = academicYearStart(chargeAttr.code);
    const paidStart = academicYearStart(paymentAttr.code);
    if (!Number.isFinite(targetStart) || !Number.isFinite(paidStart)) continue;
    if (paidStart <= targetStart) continue; // same-year settlement — not cross-year
    const sourcePayment = a.paymentId ? paymentById.get(a.paymentId) : undefined;
    // T-439 (CALC-003): only CLEARED money settles old debt (INV-4 —
    // "uncleared funds are NOT a settlement"): a bounced (unpaid)
    // next-year cheque — whose allocation rows 0039 never deletes —
    // must not fabricate a settlement, and an uncleared one is
    // committed but has not settled anything yet.
    if (allocationFundClass(sourcePayment) !== "paid") continue;
    const sourceEntry = paymentEntries.find((e) => e.sourceId === a.paymentId);
    const item: CrossYearSettlementItem = {
      paymentId: a.paymentId,
      ledgerEntryId: sourceEntry?.id ?? null,
      paymentYear: paymentAttr.code,
      at: sourcePayment?.collectedAt ?? sourceEntry?.at ?? null,
      installmentId: a.installmentId,
      chargeLabel: a.label,
      category: a.category,
      allocatedAmount: a.allocatedAmount,
      targetYear: chargeAttr.code,
    };
    const received = settlementsReceivedByYear.get(chargeAttr.code) ?? [];
    received.push(item);
    settlementsReceivedByYear.set(chargeAttr.code, received);
  }

  // ── The ordered year codes (charges + payments; unknown codes by start) ──
  const allYearCodes = new Set<string>([
    ...chargesByYear.keys(),
    ...[...paymentsMadeByYear.keys()],
  ]);
  const orderedCodes = [...allYearCodes].sort((a, b) => {
    const sa = yearMetaOf(a, years).start;
    const sb = yearMetaOf(b, years).start;
    return sa - sb;
  });

  // ── Build the per-year records ──
  const records: AcademicYearFinancialRecord[] = [];
  let priorYearEndOutstanding = 0;
  for (let i = 0; i < orderedCodes.length; i += 1) {
    const code = orderedCodes[i];
    const meta = yearMetaOf(code, years);
    const isOpen = meta.endDate
      ? new Date(meta.endDate).getTime() >= now.getTime()
      : true;
    // INV-20b: closed years are evaluated at their END date; the open
    // year (and unknown-window years) at the caller's clock.
    const yearClock = meta.endDate && !isOpen ? new Date(meta.endDate) : now;

    const yearCharges = (chargesByYear.get(code) ?? [])
      .slice()
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id.localeCompare(b.id)));

    // The year-end as-of split per charge (exact when allocations exist).
    let anyExact = false;
    let anyHeuristic = false;
    let yearEndOutstanding = 0;
    const chargeItems: YearChargeItem[] = yearCharges.map((ins) => {
      const attr = chargeAttributions.get(ins.id)!;
      const chargeAllocations = allocationsByInstallment.get(ins.id) ?? [];
      const asOf = paidUpToClock(ins, yearClock, chargeAllocations, paymentById);
      if (asOf.exact) anyExact = true;
      else anyHeuristic = true;
      yearEndOutstanding += Math.max(
        0,
        ins.amountDue - asOf.paid - asOf.pending,
      );

      // Current settlement (the stored truth at the caller's clock).
      // INV-4: uncleared funds (amountPending) are NOT a settlement —
      // a pending-only charge stays "outstanding" until clearance.
      const remaining = inv4Remaining(ins);
      let settlement: YearChargeItem["settlement"];
      let settledAt: string | null = ins.paidDate ?? null;
      if (remaining <= YEAR_HISTORY_EPSILON_DZD && (ins.amountPaid > 0 || ins.amountDue <= YEAR_HISTORY_EPSILON_DZD)) {
        settlement = "fully_paid";
        // The exact completing moment when the allocation records exist:
        // the LAST in-window allocation's payment date.
        if (chargeAllocations.length > 0) {
          const times = chargeAllocations
            .map((a) => {
              const p = a.paymentId ? paymentById.get(a.paymentId) : undefined;
              // T-439 (CALC-003): a bounced/refunded/cancelled
              // payment's allocation is not a completing moment.
              if (allocationFundClass(p) === "none") return Number.NaN;
              return p ? new Date(p.collectedAt).getTime() : new Date(a.createdAt).getTime();
            })
            .filter((t) => Number.isFinite(t))
            .sort((x, y) => x - y);
          if (times.length > 0) {
            settledAt = new Date(times[times.length - 1]).toISOString();
          }
        }
      } else if (ins.amountPaid > 0) {
        settlement = "partially_paid";
      } else if (ins.amountPending > 0) {
        // INV-4: uncleared non-cash funds are committed but NOT a
        // settlement — the charge awaits clearance (the DB's own
        // `pending_clearance` status vocabulary).
        settlement = "pending_clearance";
      } else {
        settlement = "outstanding";
      }

      return {
        installmentId: ins.id,
        studentId: ins.studentId,
        category: ins.category,
        label: ins.label,
        trancheNumber: ins.trancheNumber,
        amountDue: ins.amountDue,
        amountPaid: ins.amountPaid,
        amountPending: ins.amountPending,
        remaining,
        dueDate: ins.dueDate,
        paidDate: ins.paidDate,
        status: ins.status,
        attribution: attr,
        settlement,
        settledAt: settlement === "fully_paid" ? settledAt : null,
      };
    });

    const chargedInYear = yearCharges.reduce((s, ins) => s + ins.amountDue, 0);

    const paymentsMade = (paymentsMadeByYear.get(code) ?? [])
      .slice()
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.ledgerEntryId.localeCompare(b.ledgerEntryId)));

    const settlementsReceived = (settlementsReceivedByYear.get(code) ?? [])
      .slice()
      .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.installmentId.localeCompare(b.installmentId));

    // Balance evolution (INV-20): the year's charges + the payments made
    // in the year, chronological, running outstanding starting from the
    // carried-forward balance.
    const rawEvents: BalanceEvolutionEvent[] = [];
    for (const c of chargeItems) {
      rawEvents.push({
        at: c.dueDate,
        kind: "charge",
        amount: c.amountDue,
        label: c.label,
        runningOutstanding: 0,
      });
    }
    for (const p of paymentsMade) {
      rawEvents.push({
        at: p.at,
        kind: "payment",
        amount: p.amount,
        label: p.receiptNumber ?? "Paiement",
        runningOutstanding: 0,
      });
    }
    rawEvents.sort((a, b) => {
      if (a.at < b.at) return -1;
      if (a.at > b.at) return 1;
      // Same timestamp: the charge lands first (the obligation exists,
      // then money moves against it).
      return a.kind === b.kind ? 0 : a.kind === "charge" ? -1 : 1;
    });
    const events: BalanceEvolutionEvent[] = [];
    let running = priorYearEndOutstanding;
    for (const ev of rawEvents) {
      // NOT clamped: an intermediate negative is a temporary credit
      // position (ADR-010's raw-balance convention); the final value
      // reconciles exactly with Σ charges − Σ payments.
      running = ev.kind === "charge" ? running + ev.amount : running - ev.amount;
      events.push({ ...ev, runningOutstanding: running });
    }

    const affectedStudentIds = [
      ...new Set(chargeItems.map((c) => c.studentId).filter((s): s is string => s !== null)),
    ];

    // The derived flags (INV-20): does a FOLLOWING year exist with charges?
    // "left owing" requires a CLOSED year (you can only know someone left
    // after the year ends with no successor); an open final year with
    // debt carries neither flag — the honest presentation.
    const nextCode = orderedCodes[i + 1];
    const nextYearHasCharges = nextCode != null && (chargesByYear.get(nextCode)?.length ?? 0) > 0;
    const stillOwedAtEnd = yearEndOutstanding > YEAR_HISTORY_EPSILON_DZD;

    const yearEndBasis: YearEndBasis = anyExact
      ? anyHeuristic
        ? "mixed"
        : "allocations"
      : "paid_date_heuristic";

    records.push({
      academicYear: code,
      academicYearId: meta.id ?? chargeAttributions.get(yearCharges[0]?.id ?? "")?.id ?? null,
      startDate: meta.startDate,
      endDate: meta.endDate,
      isOpen,
      charges: chargeItems,
      totalCharged: chargedInYear,
      totalPaidOnCharges: yearCharges.reduce((s, ins) => s + ins.amountPaid, 0),
      totalPendingOnCharges: yearCharges.reduce((s, ins) => s + ins.amountPending, 0),
      yearEndOutstanding,
      yearEndBasis,
      carriedForwardFromPriorYear: priorYearEndOutstanding,
      paymentsMadeInYear: paymentsMade,
      paymentsMadeInYearTotal: paymentsMade.reduce((s, p) => s + p.amount, 0),
      settlementsReceivedFromLaterYears: settlementsReceived,
      settlementsReceivedFromLaterYearsTotal: settlementsReceived.reduce((s, x) => s + x.allocatedAmount, 0),
      pricingConfig: input.pricingConfigs?.get(code) ?? null,
      affectedStudentIds,
      leftOwing: stillOwedAtEnd && !nextYearHasCharges && !isOpen,
      reEnrolledOwing: stillOwedAtEnd && nextYearHasCharges,
      balanceEvolution: events,
    });

    // Carry forward (the owner's cross-year chain): this year's unpaid
    // balance at ITS year end becomes the next year's carried-in debt.
    priorYearEndOutstanding = stillOwedAtEnd ? yearEndOutstanding : 0;
  }

  const totalOutstandingNow = parentInstallments.reduce((s, ins) => s + inv4Remaining(ins), 0);
  // Prior-year outstanding still owed TODAY: every year EXCEPT the
  // latest one that has charges (the current year is not "prior").
  let lastYearWithChargesIdx = -1;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (records[i].charges.length > 0) {
      lastYearWithChargesIdx = i;
      break;
    }
  }
  const priorYearOutstandingStillOwed = records
    .filter((_, idx) => idx < lastYearWithChargesIdx)
    .reduce((s, r) => s + r.charges.reduce((acc, c) => acc + c.remaining, 0), 0);

  return {
    parentId: input.parentId,
    years: records,
    totalOutstandingNow,
    priorYearOutstandingStillOwed,
    computedAt: now.toISOString(),
  };
}
