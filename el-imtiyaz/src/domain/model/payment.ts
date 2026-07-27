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
