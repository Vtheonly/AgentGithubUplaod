/**
 * Payment & Financial domain — plan §07.
 *
 * Payment methods: Cash / Check / Transfer (3 only).
 * Payment lifecycle: pending → partial → paid (or overdue / refunded / cancelled).
 * Non-cash requires proof scan (mandatory).
 * Tuition = 3 tranches; Transport = tier-based.
 * Discretionary Account Adjustments replace deprecated scholarships (§07.04).
 */
export type PaymentMethod = "cash" | "check" | "transfer";
export type PaymentStatus = "pending" | "partial" | "paid" | "overdue" | "refunded" | "cancelled";

export type PaymentCategory =
  | "tuition"
  | "transport"
  | "canteen"
  | "uniform"
  | "books"
  | "extracurricular"
  | "other";

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
}

export interface Installment {
  readonly id: string;
  readonly parentId: string;
  readonly studentId: string | null;
  readonly category: PaymentCategory;
  readonly label: string; // "Tranche 1" / "Tranche 2" / "Tranche 3"
  readonly amountDue: number;
  readonly amountPaid: number;
  readonly dueDate: string;
  readonly paidDate: string | null;
  readonly status: PaymentStatus;
  /**
   * Iteration 9 — flexible installment schedules (plan §07.03 expansion).
   *
   * The education cycle the installment was generated for. Drives the
   * default due-date template (Primaire / CEM / Lycée each have their own
   * pattern), but the actual `dueDate` can be overridden per parent to
   * accommodate custom payment agreements.
   */
  readonly academicCycle?: AcademicCycle;
  /**
   * True when the due date has been manually overridden per parent.
   * False when the installment follows the standard cycle template.
   */
  readonly customSchedule?: boolean;
  /** Optional note describing the custom payment agreement (e.g. "Échelonnement exceptionnel"). */
  readonly customScheduleNote?: string | null;
}

/**
 * Education cycle — used to drive cycle-based installment templates.
 * Each cycle can have its own default tranche dates and amounts.
 */
export type AcademicCycle = "primaire" | "cem" | "lycee";

export const ACADEMIC_CYCLE_LABELS_FR: Record<AcademicCycle, string> = {
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
 * historical default; CEM and Lycée shift the 3rd tranche later because
 * their school year ends later.
 */
export const DEFAULT_CYCLE_TRANCHE_MONTHS: Record<AcademicCycle, readonly [number, number, number]> = {
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
};

export const PAYMENT_CATEGORY_LABELS_FR: Record<PaymentCategory, string> = {
  tuition: "Scolarité",
  transport: "Transport",
  canteen: "Cantine",
  uniform: "Uniforme",
  books: "Livres",
  extracurricular: "Activité parascolaire",
  other: "Autre",
};

export const AGING_BUCKET_LABELS_FR: Record<AgingBucket, string> = {
  "0_30": "0–30 j",
  "31_60": "31–60 j",
  "61_90": "61–90 j",
  "91_180": "91–180 j",
  "180_plus": "180+ j",
};

export function agingBucketFromDays(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 30) return "0_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  if (daysOverdue <= 180) return "91_180";
  return "180_plus";
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
}

export function proofRequiredFor(method: PaymentMethod): boolean {
  return method !== "cash";
}

/* ================================================================== */
/*  Single-source-of-truth calculation helpers                         */
/*                                                                    */
/*  Every balance, debt, payment total, or remaining amount in the    */
/*  application MUST be computed through one of these helpers.        */
/*  Hardcoding the same formula in 2+ places is forbidden.            */
/* ================================================================== */

/**
 * Sum of `amount` for payments whose status is "paid".
 *
 * Excludes pending/unpaid checks and transfers — a payment is only
 * counted as revenue once it has cleared. Use this everywhere the
 * "total collected" or "total paid" metric is displayed.
 */
export function sumPaidPayments(payments: readonly Payment[]): number {
  return payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Sum of `amountDue` across installments. This is the gross amount
 * the parent owes (independent of what has been paid).
 */
export function sumInstallmentsDue(installments: readonly Installment[]): number {
  return installments.reduce((sum, i) => sum + i.amountDue, 0);
}

/**
 * Sum of `amountPaid` across installments. This is the amount
 * allocated against installments — it INCLUDES uncleared checks because
 * `counter-payment` calls `installments.markPaid()` after `payments.collect()`
 * regardless of payment status. Use this for tranche progress display.
 */
export function sumInstallmentsPaid(installments: readonly Installment[]): number {
  return installments.reduce((sum, i) => sum + i.amountPaid, 0);
}

/**
 * Remaining amount on a single installment: `amountDue - amountPaid`.
 * Never negative.
 */
export function installmentRemaining(installment: Installment): number {
  return Math.max(0, installment.amountDue - installment.amountPaid);
}

/**
 * Total remaining balance for a parent across all installments.
 * Equals `sumInstallmentsDue - sumInstallmentsPaid`.
 */
export function totalOutstanding(installments: readonly Installment[]): number {
  return Math.max(0, sumInstallmentsDue(installments) - sumInstallmentsPaid(installments));
}

/**
 * Overdue amount: the portion of the outstanding balance whose
 * installment due date has already passed AND the installment is not
 * fully paid. Uses real date comparison (not a clone of totalOutstanding).
 *
 * `now` is injectable for testability.
 */
export function overdueAmount(
  installments: readonly Installment[],
  now: Date = new Date(),
): number {
  const nowMs = now.getTime();
  return installments
    .filter((i) => i.status !== "paid" && new Date(i.dueDate).getTime() < nowMs)
    .reduce((sum, i) => sum + installmentRemaining(i), 0);
}

/**
 * Days overdue for a parent's worst (max) overdue installment.
 * Returns 0 if no installments are overdue.
 */
export function maxDaysOverdue(
  installments: readonly Installment[],
  now: Date = new Date(),
): number {
  const nowMs = now.getTime();
  const days = installments
    .filter((i) => i.status !== "paid" && new Date(i.dueDate).getTime() < nowMs)
    .map((i) => Math.floor((nowMs - new Date(i.dueDate).getTime()) / 86_400_000));
  return days.length === 0 ? 0 : Math.max(...days);
}

/**
 * Aggregate revenue from a list of payments grouped by month.
 * Returns 12 entries (oldest → newest) keyed by month label.
 *
 * Each entry: `{ label: "Jan", amount: 123456 }`.
 * Months with no paid payments return `amount: 0`.
 */
export function revenueByMonth(
  payments: readonly Payment[],
  now: Date = new Date(),
): ReadonlyArray<{ label: string; amount: number }> {
  const monthLabels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
  // Build buckets for the last 12 months (including current), oldest first.
  const buckets: Array<{ label: string; year: number; month: number; amount: number }> = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    buckets.push({
      label: monthLabels[d.getMonth()],
      year: d.getFullYear(),
      month: d.getMonth(),
      amount: 0,
    });
  }
  // Allocate paid payments to buckets.
  for (const p of payments) {
    if (p.status !== "paid") continue;
    const d = new Date(p.collectedAt);
    const y = d.getFullYear();
    const m = d.getMonth();
    const bucket = buckets.find((b) => b.year === y && b.month === m);
    if (bucket) bucket.amount += p.amount;
  }
  return buckets.map((b) => ({ label: b.label, amount: b.amount }));
}

/**
 * Aggregate paid payments by category for the current month.
 * Used by the Dashboard → See Details → Departments tab.
 */
export function revenueByCategory(
  payments: readonly Payment[],
  now: Date = new Date(),
): ReadonlyArray<{ category: PaymentCategory; amount: number }> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const totals = new Map<PaymentCategory, number>();
  for (const p of payments) {
    if (p.status !== "paid") continue;
    const t = new Date(p.collectedAt).getTime();
    if (t < monthStart || t >= monthEnd) continue;
    totals.set(p.category, (totals.get(p.category) ?? 0) + p.amount);
  }
  return Array.from(totals.entries()).map(([category, amount]) => ({ category, amount }));
}

/**
 * Total revenue (sum of paid payments) collected in the current month.
 */
export function monthlyRevenue(payments: readonly Payment[], now: Date = new Date()): number {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  return payments
    .filter((p) => p.status === "paid")
    .filter((p) => {
      const t = new Date(p.collectedAt).getTime();
      return t >= monthStart && t < monthEnd;
    })
    .reduce((sum, p) => sum + p.amount, 0);
}
