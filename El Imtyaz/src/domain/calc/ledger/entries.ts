/**
 * Ledger entry factories — enforce invariants at construction time.
 *
 * Extracted from `domain/model/ledger.ts`. Each factory validates its inputs
 * and produces an immutable `LedgerEntry` with the correct signed amount
 * and derived `accountId`.
 *
 * Invariants (preserved verbatim):
 *   - `charge`     → amount MUST be positive (debit)
 *   - `payment`    → amount MUST be positive input; entry stores `-amount` (credit)
 *   - `adjustment` → amount MUST be non-zero (signed); reason required
 *   - `refund`     → amount MUST be positive input; entry stores `-amount`
 *   - `reversal`   → amount = `-original.amount`; reason required
 *
 * ID generation: `led-{ISO timestamp}-{random 8 chars}`. The random suffix
 * preserves the original non-deterministic strategy — tests that need
 * deterministic IDs should stub `Math.random` or override `at`.
 */
import type { LedgerEntry, LedgerSourceType } from "@/domain/model/ledger";
import type { PaymentCategory } from "@/domain/model/payment";
import type { PaymentMethod, PaymentStatus } from "@/domain/model/payment";
import { deriveAccountId } from "./account-id";

/** Generate a random ledger entry ID (preserves original strategy). */
function generateLedgerId(at?: string): string {
  return `led-${at ?? new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Freeze metadata to enforce immutability (preserves original behavior). */
function freezeMetadata(
  metadata?: Record<string, string | number | boolean | null>,
): Readonly<Record<string, string | number | boolean | null>> {
  return Object.freeze({ ...(metadata ?? {}) });
}

/**
 * Factory for charge entries (tuition tranche invoiced, etc.).
 * Charges are always positive (debit).
 */
export function createChargeEntry(input: {
  tenantId: string;
  parentId: string;
  studentId: string | null;
  category: PaymentCategory;
  amount: number;
  sourceType: LedgerSourceType;
  sourceId: string;
  description: string;
  actorId: string;
  actorName: string;
  at?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): LedgerEntry {
  if (input.amount <= 0) {
    throw new Error(`Charge amount must be positive, got ${input.amount}`);
  }
  if (!input.description.trim()) {
    throw new Error("Charge description is required");
  }
  return {
    id: generateLedgerId(input.at),
    tenantId: input.tenantId,
    accountId: deriveAccountId(input.parentId, input.category, input.studentId),
    parentId: input.parentId,
    studentId: input.studentId,
    category: input.category,
    amount: input.amount,
    type: "charge",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: input.description,
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.at ?? new Date().toISOString(),
    metadata: freezeMetadata(input.metadata),
  };
}

/**
 * Factory for payment entries. Payments are always negative (credit).
 * The `amount` parameter is the positive amount received; the entry's
 * signed amount is `-amount`.
 */
export function createPaymentEntry(input: {
  tenantId: string;
  parentId: string;
  studentId: string | null;
  category: PaymentCategory;
  amount: number;
  method: PaymentMethod;
  receiptNumber: string;
  paymentStatus: PaymentStatus;
  sourceType: LedgerSourceType;
  sourceId: string;
  description: string;
  actorId: string;
  actorName: string;
  at?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): LedgerEntry {
  if (input.amount <= 0) {
    throw new Error(`Payment amount must be positive, got ${input.amount}`);
  }
  if (!input.description.trim()) {
    throw new Error("Payment description is required");
  }
  return {
    id: generateLedgerId(input.at),
    tenantId: input.tenantId,
    accountId: deriveAccountId(input.parentId, input.category, input.studentId),
    parentId: input.parentId,
    studentId: input.studentId,
    category: input.category,
    amount: -input.amount, // payments are credits
    type: "payment",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    method: input.method,
    receiptNumber: input.receiptNumber,
    paymentStatus: input.paymentStatus,
    reversesId: null,
    description: input.description,
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.at ?? new Date().toISOString(),
    metadata: freezeMetadata(input.metadata),
  };
}

/**
 * Factory for adjustment entries. Adjustments can be positive (penalty)
 * or negative (discount/waiver).
 */
export function createAdjustmentEntry(input: {
  tenantId: string;
  parentId: string;
  studentId: string | null;
  category: PaymentCategory;
  amount: number; // signed: + for debit, - for credit
  reason: string;
  sourceType: LedgerSourceType;
  sourceId: string;
  actorId: string;
  actorName: string;
  at?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): LedgerEntry {
  if (input.amount === 0) {
    throw new Error("Adjustment amount cannot be zero");
  }
  if (!input.reason.trim()) {
    throw new Error("Adjustment reason is required");
  }
  return {
    id: generateLedgerId(input.at),
    tenantId: input.tenantId,
    accountId: deriveAccountId(input.parentId, input.category, input.studentId),
    parentId: input.parentId,
    studentId: input.studentId,
    category: input.category,
    amount: input.amount,
    type: "adjustment",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: input.reason,
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.at ?? new Date().toISOString(),
    metadata: freezeMetadata(input.metadata),
  };
}

/**
 * Factory for refund entries. Refunds are always negative (money out).
 */
export function createRefundEntry(input: {
  tenantId: string;
  parentId: string;
  studentId: string | null;
  category: PaymentCategory;
  amount: number;
  sourceId: string;
  description: string;
  actorId: string;
  actorName: string;
  at?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): LedgerEntry {
  if (input.amount <= 0) {
    throw new Error(`Refund amount must be positive, got ${input.amount}`);
  }
  return {
    id: generateLedgerId(input.at),
    tenantId: input.tenantId,
    accountId: deriveAccountId(input.parentId, input.category, input.studentId),
    parentId: input.parentId,
    studentId: input.studentId,
    category: input.category,
    amount: -input.amount,
    type: "refund",
    sourceType: "refund",
    sourceId: input.sourceId,
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: input.description,
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.at ?? new Date().toISOString(),
    metadata: freezeMetadata(input.metadata),
  };
}

/**
 * Factory for reversal entries. A reversal negates a prior entry.
 * The reversal's amount is the negative of the reversed entry's amount
 * (so the net contribution to the balance is zero).
 */
export function createReversalEntry(
  original: LedgerEntry,
  input: {
    reason: string;
    actorId: string;
    actorName: string;
    at?: string;
  },
): LedgerEntry {
  if (!input.reason.trim()) {
    throw new Error("Reversal reason is required");
  }
  return {
    id: generateLedgerId(input.at),
    tenantId: original.tenantId,
    accountId: original.accountId,
    parentId: original.parentId,
    studentId: original.studentId,
    category: original.category,
    amount: -original.amount, // negate the original
    type: "reversal",
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    method: original.method,
    receiptNumber: original.receiptNumber,
    paymentStatus: original.paymentStatus,
    reversesId: original.id,
    description: `REVERSAL of ${original.id}: ${input.reason}`,
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.at ?? new Date().toISOString(),
    metadata: freezeMetadata({ reversedEntryId: original.id, reason: input.reason }),
  };
}
