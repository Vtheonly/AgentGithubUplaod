/**
 * Ledger-based accounting engine — plan §07 (revised in iteration 5).
 *
 * PRINCIPLE: Every financial operation produces one or more immutable
 * `LedgerEntry` records. Balances are NEVER stored as a number — they
 * are ALWAYS computed by replaying the ledger. This guarantees:
 *
 *   1. Complete audit trail — every DZD has a traceable origin.
 *   2. Determinism — replaying the ledger always yields the same balance.
 *   3. No ambiguity — there is exactly one way to compute any balance.
 *   4. Reversibility — corrections are new entries with `reversesId`, never
 *      mutations to existing entries.
 *   5. Reconcilability — the sum of all entries' signed amounts is always
 *      equal to the sum of all account balances.
 *
 * ACCOUNT MODEL
 * -------------
 * Every ledger entry references an `accountId`. Accounts are scoped per
 * parent (and optionally per student) and per category. The account ID
 * is derived, not stored — it is `parent:{parentId}:category:{category}`
 * (or with `:student:{studentId}` when student-scoped).
 *
 * ENTRY DIRECTION
 * ---------------
 * A `LedgerEntry.amount` is ALWAYS signed:
 *   - Positive = debit (charge added to the parent's account — what they OWE)
 *   - Negative = credit (payment received or adjustment applied — REDUCES what they owe)
 *
 * The "outstanding balance" of an account = `sum(entries.amount)`.
 * A positive balance means the parent owes money.
 * A negative balance means the school owes the parent (overpayment / credit).
 *
 * ENTRY TYPES
 * -----------
 *   - `charge`         — tuition tranche invoiced, transport fee, additional service
 *   - `payment`        — cash/check/transfer received at the counter
 *   - `adjustment`     — discretionary credit (discount, waiver) or debit (penalty)
 *   - `refund`         — money returned to the parent
 *   - `reversal`       — negates a prior entry (linked via `reversesId`)
 *   - `transfer`       — moves value between accounts (e.g. reallocate a payment
 *                        from "unallocated" to a specific tranche)
 *
 * Each entry references a `sourceType` and `sourceId` so the UI can deep-link
 * from a balance back to the originating payment/expense/installment.
 */
import type { PaymentMethod, PaymentCategory, PaymentStatus } from "./payment";
import type { AcademicLevel } from "./student";

/** Types of financial events that produce ledger entries. */
export type LedgerEntryType =
  | "charge" // parent is invoiced for tuition/transport/service
  | "payment" // parent pays at counter (cash/check/transfer)
  | "adjustment" // discretionary credit or debit
  | "refund" // school returns money to parent
  | "reversal" // negates a prior entry
  | "transfer"; // moves value between accounts (e.g., allocate payment to tranche)

/** What kind of entity is the source of this entry. */
export type LedgerSourceType =
  | "installment"
  | "payment"
  | "expense"
  | "adjustment"
  | "refund"
  | "bulk_import"
  | "manual_entry";

/**
 * Immutable ledger entry. Once written, NEVER modified. Corrections
 * are new `reversal` entries that reference the original via `reversesId`.
 */
export interface LedgerEntry {
  /** Globally unique, monotonic — `led-{YYYYMMDD}-{seq}`. */
  readonly id: string;
  readonly tenantId: string;
  /** Derived account ID — see module docstring. */
  readonly accountId: string;
  readonly parentId: string;
  readonly studentId: string | null;
  readonly category: PaymentCategory;
  /** Signed amount in DZD. Positive = debit (parent owes more). Negative = credit. */
  readonly amount: number;
  readonly type: LedgerEntryType;
  readonly sourceType: LedgerSourceType;
  readonly sourceId: string;
  /** For payment entries: the method used. null for non-payment entries. */
  readonly method: PaymentMethod | null;
  /** For payment entries: the receipt number. null otherwise. */
  readonly receiptNumber: string | null;
  /** For payment entries: current clearing status. null for non-payment entries. */
  readonly paymentStatus: PaymentStatus | null;
  /** If this entry reverses another, the reversed entry's ID. */
  readonly reversesId: string | null;
  /** Human-readable explanation — always populated, never blank. */
  readonly description: string;
  /** The user (or system) who caused this entry. */
  readonly actorId: string;
  readonly actorName: string;
  /** UTC ISO timestamp. */
  readonly at: string;
  /** Arbitrary metadata for context (e.g. tranche number, check number). */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Computed balance for an account. Always derived — never stored.
 */
export interface AccountBalance {
  readonly accountId: string;
  readonly parentId: string;
  readonly studentId: string | null;
  readonly category: PaymentCategory;
  /** Sum of all entries' signed amounts. Positive = parent owes. */
  readonly balance: number;
  /** Sum of charge entries only (gross amount ever invoiced). */
  readonly totalCharged: number;
  /** Sum of payment entries only (gross amount ever paid — includes uncleared). */
  readonly totalPaid: number;
  /** Sum of adjustment entries (credits are negative). */
  readonly totalAdjusted: number;
  /** Sum of refund entries (always negative — money out). */
  readonly totalRefunded: number;
  /** Sum of cleared payments only (status === "paid"). */
  readonly totalCleared: number;
  /** Sum of pending payments (status === "pending"). */
  readonly totalPending: number;
  /** Count of entries that contributed to this balance. */
  readonly entryCount: number;
  /** Timestamp of the most recent entry. */
  readonly lastActivityAt: string | null;
}

/**
 * Aggregate balance for a parent across all their accounts.
 */
export interface ParentLedgerSummary {
  readonly parentId: string;
  readonly parentName: string;
  /** Total across all accounts — what the parent currently owes. */
  readonly totalOutstanding: number;
  /** Overdue only: balance on accounts whose latest charge is past due. */
  readonly totalOverdue: number;
  readonly totalCharged: number;
  readonly totalPaid: number;
  readonly totalCleared: number;
  readonly totalPending: number;
  readonly totalAdjusted: number;
  readonly totalRefunded: number;
  readonly accounts: readonly AccountBalance[];
  readonly entryCount: number;
  readonly lastActivityAt: string | null;
}

/* ================================================================== */
/*  Account ID derivation — single source of truth                    */
/* ================================================================== */

/**
 * Derive the canonical account ID for a parent + (optional) student + category.
 *
 * Account IDs are deterministic — the same inputs always produce the same ID.
 * This means balances can be looked up without a separate "accounts" table.
 */
export function deriveAccountId(
  parentId: string,
  category: PaymentCategory,
  studentId: string | null = null,
): string {
  // Use a delimiter that cannot appear in IDs themselves.
  const parts = ["parent", parentId, "category", category];
  if (studentId) parts.push("student", studentId);
  return parts.join(":");
}

/* ================================================================== */
/*  Balance computation — the ONLY way to compute a balance            */
/* ================================================================== */

/**
 * Compute the balance for a single account by replaying its ledger entries.
 *
 * This is the SINGLE SOURCE OF TRUTH for balance computation. Every UI
 * surface that displays a balance MUST call this function (or
 * `computeParentSummary` for parent-level aggregates).
 *
 * @param entries ALL ledger entries for the account (any order — sorted internally)
 * @param now     Optional `Date` for "as-of" queries (excludes entries after `now`)
 */
export function computeAccountBalance(
  entries: readonly LedgerEntry[],
  accountId: string,
  now: Date = new Date(),
): AccountBalance {
  const relevant = entries
    .filter((e) => e.accountId === accountId)
    .filter((e) => new Date(e.at).getTime() <= now.getTime())
    .sort((a, b) => {
      // Sort by timestamp, then by id for stability.
      const t = new Date(a.at).getTime() - new Date(b.at).getTime();
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });

  let balance = 0;
  let totalCharged = 0;
  let totalPaid = 0;
  let totalAdjusted = 0;
  let totalRefunded = 0;
  let totalCleared = 0;
  let totalPending = 0;
  let lastActivityAt: string | null = null;

  // Detect reversal chains: an entry with `reversesId` cancels out the
  // reversed entry's contribution to the typed totals (but NOT to the
  // balance — the reversal's signed amount already does that).
  const reversedIds = new Set(
    relevant.filter((e) => e.reversesId).map((e) => e.reversesId!),
  );

  for (const e of relevant) {
    balance += e.amount;
    if (reversedIds.has(e.id)) continue; // skip typed-total for reversed entries

    switch (e.type) {
      case "charge":
        totalCharged += e.amount;
        break;
      case "payment":
        totalPaid += Math.abs(e.amount); // payments are negative; totalPaid is positive
        if (e.paymentStatus === "paid") totalCleared += Math.abs(e.amount);
        else if (e.paymentStatus === "pending") totalPending += Math.abs(e.amount);
        break;
      case "adjustment":
        totalAdjusted += e.amount; // adjustments can be + or -
        break;
      case "refund":
        totalRefunded += Math.abs(e.amount); // refunds are negative
        break;
      case "reversal":
        // Reversals are already accounted for via the reversed entry's exclusion.
        break;
      case "transfer":
        // Transfers are intra-account moves; net zero on balance, no typed total.
        break;
    }
    if (lastActivityAt === null || e.at > lastActivityAt) lastActivityAt = e.at;
  }

  // Derive parent/student/category from the first entry (or default).
  const first = relevant[0];
  return {
    accountId,
    parentId: first?.parentId ?? "",
    studentId: first?.studentId ?? null,
    category: first?.category ?? "other",
    balance,
    totalCharged,
    totalPaid,
    totalCleared,
    totalPending,
    totalAdjusted,
    totalRefunded,
    entryCount: relevant.length,
    lastActivityAt,
  };
}

/**
 * Compute the aggregate balance for a parent across all their accounts.
 *
 * Pulls every entry for the parent, groups by accountId, computes per-account
 * balances, then aggregates. This is what the Parent Detail Drawer's
 * "Finances" tab and the Financials → Debt tab MUST use.
 */
export function computeParentSummary(
  entries: readonly LedgerEntry[],
  parentId: string,
  parentName: string,
  overdueCategoryDueDates: ReadonlyMap<string, Date> = new Map(),
  now: Date = new Date(),
): ParentLedgerSummary {
  const parentEntries = entries.filter((e) => e.parentId === parentId);
  const accountIds = new Set(parentEntries.map((e) => e.accountId));
  const accounts: AccountBalance[] = [];
  for (const accId of accountIds) {
    accounts.push(computeAccountBalance(parentEntries, accId, now));
  }

  // Aggregate.
  let totalOutstanding = 0;
  let totalOverdue = 0;
  let totalCharged = 0;
  let totalPaid = 0;
  let totalCleared = 0;
  let totalPending = 0;
  let totalAdjusted = 0;
  let totalRefunded = 0;
  let entryCount = 0;
  let lastActivityAt: string | null = null;

  for (const acc of accounts) {
    totalOutstanding += acc.balance;
    totalCharged += acc.totalCharged;
    totalPaid += acc.totalPaid;
    totalCleared += acc.totalCleared;
    totalPending += acc.totalPending;
    totalAdjusted += acc.totalAdjusted;
    totalRefunded += acc.totalRefunded;
    entryCount += acc.entryCount;
    if (lastActivityAt === null || (acc.lastActivityAt && acc.lastActivityAt > lastActivityAt)) {
      lastActivityAt = acc.lastActivityAt;
    }

    // Overdue: balance > 0 AND the latest charge on this account is past due.
    const dueDate = overdueCategoryDueDates.get(acc.accountId);
    if (acc.balance > 0.001 && dueDate && dueDate.getTime() < now.getTime()) {
      totalOverdue += acc.balance;
    }
  }

  return {
    parentId,
    parentName,
    totalOutstanding,
    totalOverdue,
    totalCharged,
    totalPaid,
    totalCleared,
    totalPending,
    totalAdjusted,
    totalRefunded,
    accounts,
    entryCount,
    lastActivityAt,
  };
}

/* ================================================================== */
/*  Entry construction — factories enforce invariants                  */
/* ================================================================== */

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
    id: `led-${input.at ?? new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`,
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
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
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
    id: `led-${input.at ?? new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`,
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
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
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
    id: `led-${input.at ?? new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`,
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
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
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
    id: `led-${input.at ?? new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`,
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
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
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
    id: `led-${input.at ?? new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`,
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
    metadata: Object.freeze({ reversedEntryId: original.id, reason: input.reason }),
  };
}

/**
 * Days overdue for a parent's worst (max) overdue charge entry.
 * Returns 0 if no charge entries are overdue.
 *
 * Ledger-aware version of `maxDaysOverdue` in payment.ts.
 */
export function maxDaysOverdueFromLedger(
  entries: readonly LedgerEntry[],
  now: Date = new Date(),
): number {
  const nowMs = now.getTime();
  const days = entries
    .filter((e) => e.type === "charge")
    .filter((e) => new Date(e.at).getTime() < nowMs)
    .map((e) => Math.floor((nowMs - new Date(e.at).getTime()) / 86_400_000));
  return days.length === 0 ? 0 : Math.max(...days);
}

/**
 * Build the `overdueCategoryDueDates` map for `computeParentSummary`.
 *
 * For each account, finds the latest charge entry's `at` timestamp and
 * uses that as the "due date" for overdue classification.
 */
export function buildOverdueDueDateMap(
  entries: readonly LedgerEntry[],
): ReadonlyMap<string, Date> {
  const map = new Map<string, Date>();
  for (const e of entries) {
    if (e.type !== "charge") continue;
    const existing = map.get(e.accountId);
    const current = new Date(e.at);
    if (!existing || current.getTime() > existing.getTime()) {
      map.set(e.accountId, current);
    }
  }
  return map;
}

/* ================================================================== */
/*  Convenience: derive installment-level charges from pricing config  */
/* ================================================================== */

import { tuitionForLevel, transportForTier, tuitionTranches, applyDiscount, type PricingConfig, type PricingEntry } from "./pricing";

/**
 * Build the charge entries for a 3-tranche tuition schedule.
 *
 * @returns 3 `charge` entries (one per tranche) with due dates.
 */
export function buildTuitionChargeEntries(input: {
  tenantId: string;
  parentId: string;
  studentId: string;
  level: AcademicLevel;
  config: PricingConfig;
  academicYear: string;
  trancheDueDates: readonly [string, string, string]; // ISO dates for T1/T2/T3
  actorId: string;
  actorName: string;
  sourceId: string;
  discounts?: readonly PricingEntry[]; // applied to each tranche
}): LedgerEntry[] {
  const tuition = tuitionForLevel(input.config, input.level);
  const tranches = tuitionTranches(tuition);
  return tranches.map((t, i) => {
    let amount = t.amountDue;
    if (input.discounts && input.discounts.length > 0) {
      for (const d of input.discounts) {
        if (d.discountType) {
          amount = applyDiscount(amount, { amount: d.amount, discountType: d.discountType });
        }
      }
    }
    return createChargeEntry({
      tenantId: input.tenantId,
      parentId: input.parentId,
      studentId: input.studentId,
      category: "tuition",
      amount,
      sourceType: "installment",
      sourceId: `${input.sourceId}-t${i + 1}`,
      description: `Scolarité ${input.academicYear} — Tranche ${i + 1} (${input.level})`,
      actorId: input.actorId,
      actorName: input.actorName,
      at: input.trancheDueDates[i],
      metadata: { tranche: i + 1, level: input.level, baseAmount: tuition },
    });
  });
}

/**
 * Build the charge entry for a transport fee.
 */
export function buildTransportChargeEntry(input: {
  tenantId: string;
  parentId: string;
  studentId: string | null;
  tier: "t1" | "t2" | "t3";
  config: PricingConfig;
  academicYear: string;
  dueDate: string;
  actorId: string;
  actorName: string;
  sourceId: string;
}): LedgerEntry {
  const amount = transportForTier(input.config, input.tier);
  return createChargeEntry({
    tenantId: input.tenantId,
    parentId: input.parentId,
    studentId: input.studentId,
    category: "transport",
    amount,
    sourceType: "installment",
    sourceId: input.sourceId,
    description: `Transport ${input.academicYear} — Zone ${input.tier.toUpperCase()}`,
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.dueDate,
    metadata: { tier: input.tier },
  });
}

/* ================================================================== */
/*  Labels (FR)                                                        */
/* ================================================================== */

export const LEDGER_ENTRY_TYPE_LABELS_FR: Record<LedgerEntryType, string> = {
  charge: "Facturation",
  payment: "Encaissement",
  adjustment: "Ajustement",
  refund: "Remboursement",
  reversal: "Extourne",
  transfer: "Virement interne",
};

export const LEDGER_SOURCE_TYPE_LABELS_FR: Record<LedgerSourceType, string> = {
  installment: "Tranche",
  payment: "Paiement",
  expense: "Dépense",
  adjustment: "Ajustement de compte",
  refund: "Remboursement",
  bulk_import: "Import Excel",
  manual_entry: "Saisie manuelle",
};
