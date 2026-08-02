/**
 * Expense domain — plan §08 two-tier approval lifecycle.
 *
 *   Draft → Submitted → Approved/Rejected → Disbursed → Settled (with proof)
 *
 *   - Receipt upload is MANDATORY before close.
 *   - Approver must differ from requester (no self-approval).
 *   - Categories are a controlled list — no free-text.
 *   - AI anomaly flag is a signal, not a verdict (human always decides).
 */
export type ExpenseStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "disbursed"
  | "settled";

export type ExpenseCategory =
  | "utilities"
  | "supplies"
  | "maintenance"
  | "transport"
  | "event"
  | "salary"
  | "tax"
  | "rent"
  | "other";

export interface Expense {
  readonly id: string;
  readonly tenantId: string;
  readonly requestCode: string;
  readonly title: string;
  readonly description: string;
  readonly amount: number;
  readonly category: ExpenseCategory;
  readonly payee: string;
  readonly status: ExpenseStatus;
  readonly submittedBy: string;
  readonly submittedAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly approvalNote: string | null;
  readonly disbursedBy: string | null;
  readonly disbursedAt: string | null;
  readonly proofUrl: string | null;
  readonly proofUploadedBy: string | null;
  readonly proofUploadedAt: string | null;
  readonly anomalyScore: number | null;
  readonly anomalyNote: string | null;
}

export const EXPENSE_STATUS_LABELS_FR: Record<ExpenseStatus, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  approved: "Approuvée",
  rejected: "Rejetée",
  disbursed: "Décaissée",
  settled: "Justifiée",
};

export const EXPENSE_CATEGORY_LABELS_FR: Record<ExpenseCategory, string> = {
  utilities: "Factures (eau/élec/gaz)",
  supplies: "Fournitures",
  maintenance: "Maintenance",
  transport: "Transport",
  event: "Événement",
  salary: "Salaires",
  tax: "Taxes / Impôts",
  rent: "Loyer",
  other: "Autre",
};

export interface SubmitExpenseInput {
  readonly title: string;
  readonly description: string;
  readonly amount: number;
  readonly category: ExpenseCategory;
  readonly payee: string;
}
