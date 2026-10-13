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

/**
 * VAULT §08.02 — Tier-1 request urgency (Low / Medium / High).
 * Drives review prioritization in the approver's queue.
 */
export type ExpenseUrgency = "low" | "medium" | "high";

export const EXPENSE_URGENCY_LABELS_FR: Record<ExpenseUrgency, string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
};

export const EXPENSE_URGENCY_TONE: Record<ExpenseUrgency, "success" | "warning" | "danger"> = {
  low: "success",
  medium: "warning",
  high: "danger",
};

/**
 * T-521 (issue #29 / WORKFORCE-518): where an attachment's bytes were
 * captured — the canonical `expense_attachments.source` CHECK set (migration
 * 0153). The desktop picker writes "desktop"; the Android scanner writes
 * "mobile_camera" (TakePicture) or "mobile_gallery" (GetContent).
 */
export type ExpenseAttachmentSource = "desktop" | "mobile_camera" | "mobile_gallery";

export const EXPENSE_ATTACHMENT_SOURCE_LABELS_FR: Record<ExpenseAttachmentSource, string> = {
  desktop: "Ordinateur",
  mobile_camera: "Scanner mobile",
  mobile_gallery: "Galerie mobile",
};

/**
 * T-521 (issue #29 / WORKFORCE-518): ONE supporting image attached to an
 * expense — the canonical `expense_attachments` row (migration 0153). The
 * bytes live in the private `expense-receipts` bucket (migration 0018) at
 * `storagePath`; the metadata (name, mime, size, uploader, source) is the
 * single source of truth shared by desktop Finance, desktop Staff/Personnel,
 * and the Android scanner.
 */
export interface ExpenseAttachment {
  readonly id: string;
  readonly tenantId: string;
  readonly expenseId: string;
  readonly storageBucket: "expense-receipts" | "payment-proofs";
  readonly storagePath: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedBy: string | null;
  readonly uploadedAt: string;
  readonly source: ExpenseAttachmentSource;
}

export interface Expense {
  readonly id: string;
  readonly tenantId: string;
  readonly requestCode: string;
  readonly title: string;
  readonly description: string;
  readonly amount: number;
  readonly category: ExpenseCategory;
  /** VAULT §08.02 — Tier-1 request urgency (Low / Medium / High). */
  readonly urgency: ExpenseUrgency;
  readonly payee: string;
  readonly status: ExpenseStatus;
  readonly submittedBy: string;
  readonly submittedAt: string;
  /**
   * T-521 (issue #29 / WORKFORCE-520): the staff member accountable for the
   * spend — DISTINCT from `submittedBy` (the requester) and `approvedBy` (the
   * decider). Null on historical rows: those are FLAGGED for review in the
   * UI ("à renseigner"), never fabricated.
   */
  readonly responsibleProfileId: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly approvalNote: string | null;
  readonly disbursedBy: string | null;
  readonly disbursedAt: string | null;
  readonly proofUrl: string | null;
  readonly proofUploadedBy: string | null;
  readonly proofUploadedAt: string | null;
  /**
   * VAULT §08.05 (Tier 3) — the ACTUAL final spent amount, entered by staff
   * at settlement alongside the receipt proof. May differ from the
   * requested `amount`; the financial officer verifies it against the
   * disbursed funds before the ticket closes.
   */
  readonly finalSpentAmount: number | null;
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
  /** VAULT §08.02 — urgency (Low / Medium / High), default "medium". */
  readonly urgency?: ExpenseUrgency;
  /**
   * T-521 (issue #29 / WORKFORCE-520): the accountable staff member — a
   * user_profiles id, DISTINCT from the submitter. Optional: omitting leaves
   * the row NULL (flagged for review, never fabricated).
   */
  readonly responsibleProfileId?: string | null;
}

/**
 * T-521 (issue #29): the editable fields of an EXISTING expense — only
 * accepted while the ticket is still `draft`/`submitted` (the pre-approval
 * window; the 0064 state machine owns the lifecycle after that).
 */
export interface UpdateExpenseInput {
  readonly title?: string;
  readonly description?: string;
  readonly amount?: number;
  readonly category?: ExpenseCategory;
  readonly payee?: string;
  readonly urgency?: ExpenseUrgency;
  readonly responsibleProfileId?: string | null;
}

/**
 * T-521 (issue #29 / WORKFORCE-518): the file payload for a new attachment.
 * `blob` carries the bytes (a browser File in the app; a Blob in tests) —
 * the repository uploads it through the ONE media vault (expense-receipts
 * bucket in Supabase mode, the in-memory vault in mock mode) and registers
 * the canonical metadata row.
 */
export interface ExpenseAttachmentFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly blob: Blob;
}
