/**
 * Payment & Financial domain — plan §07 (revised in the Unified Financial
 * Architecture refactor).
 *
 * Payment methods: Cash / Check / Transfer (3 only).
 * Payment lifecycle:
 *   pending → partial → paid (or overdue / refunded / cancelled)
 *   pending_clearance — uncleared non-cash funds sitting on an installment
 *                        without yet satisfying debt (Invariant 4).
 * Non-cash requires proof scan (mandatory).
 * Tuition = 3 tranches OR 1 full-annual installment (per `paymentPlan`).
 * Transport = destination-based 3 tranches.
 * Discretionary Account Adjustments replace deprecated scholarships (§07.04).
 *
 * UNIFIED FINANCIAL ARCHITECTURE (this revision):
 *   - `PaymentCategory` now covers every billable service in the platform:
 *     tuition, transport, canteen, uniform, books, extracurricular,
 *     therapy_psychology, therapy_speech, second_apron, parent_credit, other.
 *   - `Installment` now tracks `amountPending` (uncleared non-cash funds)
 *     separately from `amountPaid` (cleared funds) so tranches are NEVER
 *     marked "paid" by a check that has not yet cleared the bank.
 *   - `Installment` now carries `academicCycle`, `paymentPlan`, and custom
 *     schedule metadata so the schedule generator + UI can reason about
 *     the official `Prices.md` cycle rules.
 *   - `PaymentNavigationContext` + `PaymentLineItem` define the universal
 *     payload consumed by `UnifiedPaymentModal` — every payment entry point
 *     in the app (topbar bell, debt dashboard, parent/student drawers,
 *     installment grid, clubs, therapy, canteen) constructs one of these
 *     and hands it to the modal.
 *
 * `AcademicCycle` is imported from `./academic` (the canonical source) and
 * re-exported here so existing callers importing from `./payment` continue
 * to work.
 */
import type { AcademicCycle } from "./academic";

export type { AcademicCycle };

export type PaymentMethod = "cash" | "check" | "transfer";

/**
 * Payment lifecycle statuses.
 *
 * `pending_clearance` is reserved for *installments* (not payments themselves)
 * to represent "an uncleared check/transfer is sitting on this tranche but
 * has not yet satisfied the debt". Payments themselves still use `pending`
 * until bank clearance transitions them to `paid`.
 *
 * `unpaid` is the installment-specific status for a tranche that has had
 * NO payment activity (no cleared funds, no pending check). The DB
 * `installments.status` check constraint (migration 0007) allows `unpaid`,
 * and the bulk Excel importer uses it for tranches with `amountDue > 0`
 * and `amountPaid === 0`. Payments themselves never use `unpaid`.
 */
export type PaymentStatus =
  | "pending"
  | "partial"
  | "paid"
  | "overdue"
  | "refunded"
  | "cancelled"
  | "pending_clearance"
  | "unpaid";

/**
 * Canonical billable categories — used by `payments.category`,
 * `ledger_entries.category`, `installments.category`.
 *
 * `parent_credit` is special: it represents an overpayment / advance credit
 * balance held at the parent level (no specific student). It is the only
 * category whose account ID is intentionally student-scoped-null.
 */
export type PaymentCategory =
  | "tuition"
  | "transport"
  | "canteen"
  | "uniform"
  | "books"
  | "extracurricular"
  | "therapy_psychology"
  | "therapy_speech"
  | "second_apron"
  | "parent_credit"
  | "other";

/**
 * Explicit payment-plan selection — drives whether the billing engine
 * generates 1 full-annual charge/installment or 3 tranches.
 *
 * - `"full_annual"`  → ONE charge + ONE installment for the net annual fee.
 *                     Enables the 10% early-bird discount when paid ≤ June 30.
 * - `"tranches"`     → THREE charges + THREE installments per `Prices.md`
 *                     cycle-specific schedule (default).
 */
export type PaymentPlan = "full_annual" | "tranches";

export interface Payment {
  readonly id: string;
  readonly tenantId: string;
  readonly receiptNumber: string; // REC-2025-000123
  readonly parentId: string;
  readonly studentId: string | null;
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly category: PaymentCategory;
  readonly installmentId: string | null;
  readonly proofUrl: string | null;
  readonly notes: string | null;
  readonly collectedBy: string;
  readonly collectedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * METHOD-SPECIFIC FIELDS (plan §07.01 — mirrors the backend `payments`
   * columns from migration 0007). Required for non-cash payments:
   * check → checkNumber + checkBankName (+ issue/clearance dates),
   * transfer → transferReference (+ source bank).
   */
  readonly checkNumber?: string | null;
  readonly checkBankName?: string | null;
  readonly checkIssueDate?: string | null;
  readonly checkClearanceDate?: string | null;
  readonly transferReference?: string | null;
  readonly transferSourceBank?: string | null;
  /**
   * PAYMENT BREAKDOWN: the total expected amount for the charges this
   * payment covers. When `amount > expectedAmount`, the difference is
   * `excessAmount` (overpayment). 0 when not set (legacy payments).
   */
  readonly expectedAmount?: number;
  /**
   * PAYMENT BREAKDOWN: the amount paid ABOVE the expectedAmount.
   * 0 when fully allocated or when expectedAmount is not set.
   */
  readonly excessAmount?: number;
  /**
   * PAYMENT BREAKDOWN: remark/note explaining an overpayment.
   * Example: "Parent paid 360,000 instead of 300,000 — excess 60,000
   * held as parent credit for next year."
   */
  readonly excessRemark?: string | null;
}

/**
 * PAYMENT BREAKDOWN: a single allocation of a payment to a charge/installment.
 *
 * A 300,000 payment can be split into multiple allocations:
 *   - 250,000 → tuition charge (category: "tuition")
 *   - 50,000  → transport charge (category: "transport")
 *
 * The sum of all allocations for a payment should equal the payment's
 * `amount` (or `expectedAmount` when there's an overpayment).
 */
export interface PaymentAllocation {
  readonly id: string;
  readonly paymentId: string;
  readonly chargeId: string | null;
  readonly installmentId: string | null;
  readonly category: PaymentCategory;
  readonly allocatedAmount: number;
  readonly label: string | null;
  readonly createdAt: string;
}

export interface Installment {
  readonly id: string;
  readonly parentId: string;
  readonly studentId: string | null;
  readonly category: PaymentCategory;
  readonly label: string; // "Tranche 1" / "Tranche 2" / "Tranche 3" / "Année complète"
  readonly amountDue: number;
  /** Cleared funds applied to this tranche (cash, cleared check, cleared transfer). */
  readonly amountPaid: number;
  /**
   * Uncleared non-cash funds sitting on this tranche (pending check/transfer).
   *
   * Invariant 4 (Cleared Funds Only):
   *   A tranche may be marked `"paid"` ONLY when `amountPaid >= amountDue`.
   *   Uncleared funds live in `amountPending` and transition into
   *   `amountPaid` when the underlying payment's status moves
   *   `"pending"` → `"paid"`.
   */
  readonly amountPending: number;
  readonly dueDate: string;
  readonly paidDate: string | null;
  readonly status: PaymentStatus;
  /**
   * The education cycle the installment was generated for. Drives the
   * default due-date template (Primaire / CEM / Lycée each follow the
   * official `Prices.md` schedule: Sept 15 / Dec 15 / Mar 15).
   */
  readonly academicCycle?: AcademicCycle;
  /**
   * Whether this installment represents a 100% full-annual payment or a
   * single tranche of a 3-part schedule. Drives charge-entry generation
   * (1 vs 3 entries) and slider rendering.
   */
  readonly paymentPlan?: PaymentPlan;
  /**
   * True when the due date has been manually overridden per parent.
   * False when the installment follows the standard cycle template.
   */
  readonly isCustomSchedule?: boolean;
  /** Optional note describing the custom payment agreement (e.g. "Échelonnement exceptionnel"). */
  readonly customScheduleNote?: string | null;
  /** Backward-compat alias for `isCustomSchedule` (older code reads `customSchedule`). */
  readonly customSchedule?: boolean;
}

/**
 * Education cycle — used to drive cycle-based installment templates.
 * Each cycle can have its own default tranche dates and amounts.
 *
 * Canonical definition lives in `./academic` (re-exported at the top of this
 * file). `AcademicCycleLegacy` is the only cycle-related type still defined
 * here because it is payment-specific (legacy alias that drops `prescolaire`).
 */

/** Legacy alias — `primaire` historically included preschool. New code
 * should distinguish `prescolaire` when it matters for pricing. */
export type AcademicCycleLegacy = "primaire" | "cem" | "lycee";

export const ACADEMIC_CYCLE_LABELS_FR: Record<AcademicCycle, string> = {
  prescolaire: "Préscolaire",
  primaire: "Primaire",
  cem: "CEM / Collège",
  lycee: "Lycée",
};

/**
 * Default tranche due-date templates per cycle (month-of-year, 1-indexed).
 *
 * These are the *starting point* for new installments; per-parent
 * overrides are applied via `InstallmentRepository.updateDueDate`.
 *
 * Source: legacy Excel workflow — September / December / March is the
 * historical default. CEM and Lycée shift the 3rd tranche later because
 * their school year ends later.
 *
 * UNIFIED ARCHITECTURE NOTE: The canonical, official schedule per
 * `Prices.md` is Sept 15 / Dec 15 / Mar 15 for ALL cycles (Primaire,
 * CEM, Lycée) AND for Transport. The legacy month offsets below are kept
 * only for backward compatibility with existing seed data; new code MUST
 * use `getOfficialTuitionDueDates` / `getOfficialTransportDueDates`
 * from `domain/calc/pricing/` which always return the Sept 15 / Dec 15 /
 * Mar 15 schedule.
 */
export const DEFAULT_CYCLE_TRANCHE_MONTHS: Record<AcademicCycle, readonly [number, number, number]> = {
  prescolaire: [9, 12, 3], // Sept / Dec / March
  primaire: [9, 12, 3],   // Sept / Dec / March
  cem: [9, 12, 4],         // Sept / Dec / April
  lycee: [9, 1, 5],        // Sept / Jan / May
};

/**
 * Input for updating an installment's due date (per-parent override).
 * Used by the flexible installment schedule editor.
 */
export interface UpdateInstallmentDueDateInput {
  readonly installmentId: string;
  readonly dueDate: string;
  readonly note?: string | null;
  readonly actorId: string;
  readonly actorName: string;
}

export interface AccountAdjustment {
  readonly id: string;
  readonly parentId: string;
  readonly amount: number; // + credit / - debit
  readonly reason: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly receiptRef: string | null;
}

export interface ParentFinancialProfile {
  readonly parentId: string;
  readonly parentName: string;
  readonly totalDue: number;
  readonly totalPaid: number;
  readonly totalOutstanding: number;
  /**
   * Σ of `adjustment`/`parent_credit` ledger entries (≤ 0) — the canonical
   * `computeParentSummary.totalUnallocatedCredit`. T-104/ADR-010: the
   * "Crédit parent" display derives from this + `totalOutstanding` via
   * `displayParentCredit` (the raw balance double-counts credit for
   * canonical-path overpayments — DATA-009).
   */
  readonly totalUnallocatedCredit: number;
  readonly overdueAmount: number;
  readonly installments: readonly Installment[];
  readonly recentPayments: readonly Payment[];
  readonly adjustments: readonly AccountAdjustment[];
}

export type AgingBucket = "0_30" | "31_60" | "61_90" | "91_180" | "180_plus";

export interface DebtSummary {
  readonly parentId: string;
  readonly parentName: string;
  readonly parentPhone: string;
  readonly studentCount: number;
  readonly outstandingAmount: number;
  readonly daysOverdue: number;
  readonly bucket: AgingBucket;
}

export interface Receipt {
  readonly id: string;
  readonly paymentId: string;
  readonly receiptNumber: string;
  readonly pdfUrl: string | null;
  readonly generatedAt: string;
  readonly generatedBy: string;
}

export const PAYMENT_METHOD_LABELS_FR: Record<PaymentMethod, string> = {
  cash: "Espèces",
  check: "Chèque",
  transfer: "Virement",
};

export const PAYMENT_STATUS_LABELS_FR: Record<PaymentStatus, string> = {
  pending: "En attente",
  partial: "Partiel",
  paid: "Payé",
  overdue: "En retard",
  refunded: "Remboursé",
  cancelled: "Annulé",
  pending_clearance: "En cours d'encaissement",
  unpaid: "Non payé",
};

export const PAYMENT_CATEGORY_LABELS_FR: Record<PaymentCategory, string> = {
  tuition: "Scolarité",
  transport: "Transport",
  canteen: "Cantine",
  uniform: "Uniforme",
  books: "Livres",
  extracurricular: "Activité parascolaire",
  therapy_psychology: "Psychologie",
  therapy_speech: "Orthophonie",
  second_apron: "2ème Tablier",
  parent_credit: "Crédit Parent",
  other: "Autre",
};

export const AGING_BUCKET_LABELS_FR: Record<AgingBucket, string> = {
  "0_30": "0–30 j",
  "31_60": "31–60 j",
  "61_90": "61–90 j",
  "91_180": "91–180 j",
  "180_plus": "180+ j",
};

/* ================================================================== */
/*  Universal Payment Navigation Context (UnifiedPaymentModal input)  */
/* ================================================================== */

/**
 * Adaptive slider operational mode — drives how `AdaptivePaymentSlider`
 * renders its track and snap points, and how `UnifiedPaymentModal`
 * validates the submission.
 *
 * - `"single_item"`         → Paying for one non-divisible item (club, uniform,
 *                             2nd apron, single therapy session/package).
 * - `"installment_tranche"` → Paying toward one or more scheduled tuition /
 *                             transport tranches for a specific student.
 * - `"consolidated_debt"`   → Paying a custom amount toward the family's
 *                             total accumulated overdue debt across all services.
 * - `"account_adjustment"`  → Administrative credit (discount/waiver) or debit
 *                             (penalty) applied directly to the account.
 */
export type PaymentNavigationMode =
  | "single_item"
  | "installment_tranche"
  | "consolidated_debt"
  | "account_adjustment";

/**
 * A single billable line item inside a `PaymentNavigationContext`.
 *
 * Each line item carries its own gross/discount/net/already-paid/remaining
 * breakdown so the modal can render a precise summary card without
 * duplicating financial math in the UI (Zero-Logic Rule).
 */
export interface PaymentLineItem {
  readonly itemId: string;
  readonly category: PaymentCategory;
  readonly label: string;
  readonly grossAmount: number;
  readonly discountAmount: number;
  readonly netAmount: number;
  readonly alreadyPaidAmount: number;
  readonly remainingAmount: number;
  readonly dueDate?: string;
  readonly isOverdue?: boolean;
  readonly daysOverdue?: number;
}

/**
 * The universal payload every payment entry point constructs and hands to
 * `UnifiedPaymentModal`. Replaces ad-hoc preset props on the old
 * `CounterPaymentModal`.
 *
 * Constructing a context is cheap and pure — no financial math happens here.
 * The modal reads the context, calls into `domain/calc/` for previews,
 * and dispatches the final collection via `PaymentRepository.collect()`.
 */
export interface PaymentNavigationContext {
  readonly parentId: string;
  readonly parentName?: string;
  readonly parentCode?: string;
  readonly studentId?: string | null;
  readonly studentName?: string;
  readonly mode: PaymentNavigationMode;
  /** Target installment / line-item id, when applicable. */
  readonly targetItemId?: string;
  /** Pre-filled payment amount (e.g. remaining tranche debt). */
  readonly presetAmount?: number;
  readonly overdueDays?: number;
  readonly dueWindowLabel?: string;
  readonly lineItems: readonly PaymentLineItem[];
  /** Whether partial payments are permitted for this item. */
  readonly allowPartial?: boolean;
  /** Originating route (for back-navigation / analytics). */
  readonly originRoute?: string;
}

export interface CollectPaymentInput {
  readonly parentId: string;
  readonly studentId: string | null;
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly category: PaymentCategory;
  readonly installmentId: string | null;
  readonly proofUrl?: string | null;
  readonly notes?: string | null;
  /** Check # (required when method = "check" — plan §07.01 + migration 0007 trigger). */
  readonly checkNumber?: string | null;
  /** Bank name (required when method = "check"). */
  readonly checkBankName?: string | null;
  /** Check issue date (ISO, optional). */
  readonly checkIssueDate?: string | null;
  /** Check expiry / clearance date (ISO, optional). */
  readonly checkClearanceDate?: string | null;
  /** Transaction reference ID (required when method = "transfer"). */
  readonly transferReference?: string | null;
  /** Source bank (recommended when method = "transfer"). */
  readonly transferSourceBank?: string | null;
  /**
   * Optional deterministic receipt / payment number used by the bulk Excel
   * importer to make re-imports idempotent at the `payments` table level.
   *
   * When omitted, the repository generates one (`REC-YYYY-NNNNNN` for mock,
   * `PAY-YYYY-NNNNNN` for Supabase). When provided, the repository uses it
   * verbatim as the payment_number — so re-importing the same Excel row
   * hits the same identity key and the upsert RPC performs an UPDATE
   * instead of INSERTing a duplicate.
   */
  readonly receiptNumber?: string;
  /**
   * Optional ISO timestamp for the payment's `collected_at`. Used by the
   * bulk importer to preserve the original Excel import date so the
   * dashboard's revenue-by-month chart shows the payment in the right
   * bucket. When omitted, the repository uses `now()`.
   */
  readonly collectedAt?: string;
}

export function proofRequiredFor(method: PaymentMethod): boolean {
  return method !== "cash";
}

/* ================================================================== */
/*  Discretionary Account Adjustment reason codes (plan §07.04)        */
/* ================================================================== */

/**
 * CONTROLLED LIST of adjustment reason codes — no free text allowed
 * (vault §07.04: "Admin selects an approval reason code from a controlled
 * list (no free-text)").
 *
 * This list mirrors VERBATIM the backend `account_adjustments.reason_code`
 * CHECK constraint (migration 0007) so the desktop, the SQL layer and the
 * Android app share the same controlled vocabulary. The scholarship system
 * was replaced by these audited adjustments — `scholarship_replacement` is
 * the explicit code for legacy scholarship-style relief.
 */
export const ADJUSTMENT_REASON_CODES = [
  "sibling_discount",
  "staff_family",
  "early_payment",
  "passage_palier",
  "seniority_5y",
  "highest_average",
  "full_annual",
  "scholarship_replacement",
  "hardship",
  "correction",
  "late_fee_waiver",
  "other",
] as const;

export type AdjustmentReasonCode = (typeof ADJUSTMENT_REASON_CODES)[number];

export const ADJUSTMENT_REASON_LABELS_FR: Record<AdjustmentReasonCode, string> = {
  sibling_discount: "Réduction fratrie",
  staff_family: "Famille du personnel",
  early_payment: "Paiement anticipé",
  passage_palier: "Passage de palier",
  seniority_5y: "Ancienneté 5 ans",
  highest_average: "Meilleure moyenne",
  full_annual: "Paiement annuel complet",
  scholarship_replacement: "Remplacement bourse (supprimée)",
  hardship: "Difficulté sociale",
  correction: "Correction d'erreur",
  late_fee_waiver: "Annulation pénalité de retard",
  other: "Autre (préciser en note)",
};

/** Type guard — validates that a free-form string is a legal reason code. */
export function isAdjustmentReasonCode(value: string): value is AdjustmentReasonCode {
  return (ADJUSTMENT_REASON_CODES as readonly string[]).includes(value);
}

/* ================================================================== */
/*  Single-source-of-truth calculation helpers                         */
/*                                                                    */
/*  Every balance, debt, payment total, or remaining amount in the    */
/*  application MUST be computed through one of these helpers.        */
/*  Hardcoding the same formula in 2+ places is forbidden.            */
/*                                                                    */
/*  REFACTOR NOTE (iteration 1): The implementations now live in      */
/*  `@/domain/calc/payment/`. The exports below are thin re-exports   */
/*  so existing imports from `@/domain/model/payment` keep working.   */
/*  Once all call sites migrate to `@/domain/calc`, these re-exports  */
/*  can be removed.                                                   */
/* ================================================================== */

export {
  sumPaidPayments,
  sumInstallmentsDue,
  sumInstallmentsPaid,
  sumInstallmentsPending,
} from "../calc/payment/sums";

export {
  installmentRemaining,
  totalOutstanding,
  overdueAmount,
  maxDaysOverdue,
  agingBucketFromDays,
} from "../calc/payment/queries";

export {
  revenueByMonth,
  revenueByCategory,
  monthlyRevenue,
} from "../calc/payment/revenue";
