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
//
// REFACTOR NOTE (iteration 1): The implementation now lives in
// `@/domain/calc/ledger/account-id.ts`. The export below is a thin
// re-export so existing imports from `@/domain/model/ledger` keep working.

export { deriveAccountId } from "../calc/ledger/account-id";

/* ================================================================== */
/*  Balance computation — the ONLY way to compute a balance            */
/* ================================================================== */
//
// REFACTOR NOTE (iteration 1): The implementation now lives in
// `@/domain/calc/ledger/balance.ts`. The exports below are thin
// re-exports so existing imports from `@/domain/model/ledger` keep working.

export {
  computeAccountBalance,
  computeParentSummary,
} from "../calc/ledger/balance";

/* ================================================================== */
/*  Entry construction — factories enforce invariants                  */
/* ================================================================== */
//
// REFACTOR NOTE (iteration 1): The implementations now live in
// `@/domain/calc/ledger/entries.ts`. The exports below are thin
// re-exports so existing imports from `@/domain/model/ledger` keep working.

export {
  createChargeEntry,
  createPaymentEntry,
  createAdjustmentEntry,
  createRefundEntry,
  createReversalEntry,
} from "../calc/ledger/entries";

/**
 * Days overdue for a parent's worst (max) overdue charge entry.
 * Returns 0 if no charge entries are overdue.
 *
 * Ledger-aware version of `maxDaysOverdue` in payment.ts.
 */
// REFACTOR NOTE (iteration 1): The implementation now lives in
// `@/domain/calc/ledger/overdue.ts`.
export {
  maxDaysOverdueFromLedger,
  buildOverdueDueDateMap,
} from "../calc/ledger/overdue";

/* ================================================================== */
/*  Convenience: derive installment-level charges from pricing config  */
/* ================================================================== */
//
// REFACTOR NOTE (iteration 1): The implementations now live in
// `@/domain/calc/ledger/charges.ts`. The exports below are thin
// re-exports so existing imports from `@/domain/model/ledger` keep working.

export {
  buildTuitionChargeEntries,
  buildTransportChargeEntry,
  buildTransportChargeEntriesForDestination,
} from "../calc/ledger/charges";

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
