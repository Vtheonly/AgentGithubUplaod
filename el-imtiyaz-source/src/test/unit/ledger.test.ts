/**
 * Comprehensive tests for the ledger-based accounting engine.
 *
 * Tests cover:
 *   - Entry construction invariants (charge > 0, payment < 0, etc.)
 *   - Account balance computation
 *   - Parent summary aggregation
 *   - Reversal semantics (immutable, negates original)
 *   - Reconciliation (orphan reversals, double reversals, duplicate IDs, etc.)
 *   - Cross-checks (payments ↔ ledger, installments ↔ ledger)
 *   - Property-based tests (random ledger states always reconcile)
 *   - Stress tests (10k entries)
 *   - Edge cases (empty ledger, single entry, negative balance / overpayment)
 *   - Determinism (same inputs → same outputs)
 */
import { describe, it, expect } from "vitest";
import {
  type LedgerEntry,
  deriveAccountId,
  computeAccountBalance,
  computeParentSummary,
  createChargeEntry,
  createPaymentEntry,
  createAdjustmentEntry,
  createRefundEntry,
  createReversalEntry,
  buildTuitionChargeEntries,
  buildTransportChargeEntry,
  buildOverdueDueDateMap,
  maxDaysOverdueFromLedger,
} from "../../domain/model/ledger";
import type { PaymentCategory } from "../../domain/model/payment";
import { tuitionTranches } from "../../domain/model/pricing";
import { defaultPricingConfig } from "../../infrastructure/mock/pricing-seed";
import {
  reconcileLedger,
  checkDuplicateIds,
  checkRequiredFields,
  checkSignedAmountConvention,
  checkAccountIdsMatch,
  checkReversalIntegrity,
  checkDuplicateReceiptNumbers,
  checkTenantConsistency,
  crossCheckPayments,
  crossCheckInstallments,
  crossCheckBalanceSum,
} from "../../domain/reconciliation/reconcile";

const TENANT = "tenant-test-001";
const NOW = new Date("2025-09-15T10:00:00Z");
const PAST = new Date("2025-06-01T10:00:00Z");
const FUTURE = new Date("2025-12-01T10:00:00Z");

const cat = (c: PaymentCategory) => c;

function makeCharge(
  parentId: string,
  studentId: string | null,
  category: PaymentCategory,
  amount: number,
  at: Date,
  sourceId: string,
  description = "test charge",
): LedgerEntry {
  return createChargeEntry({
    tenantId: TENANT,
    parentId,
    studentId,
    category,
    amount,
    sourceType: "installment",
    sourceId,
    description,
    actorId: "usr-test-001",
    actorName: "Test User",
    at: at.toISOString(),
  });
}

function makePayment(
  parentId: string,
  studentId: string | null,
  category: PaymentCategory,
  amount: number,
  at: Date,
  sourceId: string,
  status: "paid" | "pending" = "paid",
  receiptNumber = "REC-2025-000001",
): LedgerEntry {
  return createPaymentEntry({
    tenantId: TENANT,
    parentId,
    studentId,
    category,
    amount,
    method: "cash",
    receiptNumber,
    paymentStatus: status,
    sourceType: "payment",
    sourceId,
    description: `Payment ${receiptNumber}`,
    actorId: "usr-test-001",
    actorName: "Test User",
    at: at.toISOString(),
  });
}

function makeAdjustment(
  parentId: string,
  amount: number,
  reason: string,
  at: Date,
  sourceId: string,
): LedgerEntry {
  return createAdjustmentEntry({
    tenantId: TENANT,
    parentId,
    studentId: null,
    category: "tuition",
    amount,
    reason,
    sourceType: "adjustment",
    sourceId,
    actorId: "usr-test-001",
    actorName: "Test User",
    at: at.toISOString(),
  });
}

describe("Ledger — entry construction invariants", () => {
  it("charges must have positive amount", () => {
    expect(() => makeCharge("p1", "s1", "tuition", 0, NOW, "i1")).toThrow();
    expect(() => makeCharge("p1", "s1", "tuition", -100, NOW, "i1")).toThrow();
  });

  it("payments must have positive amount parameter (entry stores as negative)", () => {
    expect(() => makePayment("p1", "s1", "tuition", 0, NOW, "pay1")).toThrow();
    expect(() => makePayment("p1", "s1", "tuition", -100, NOW, "pay1")).toThrow();
    const e = makePayment("p1", "s1", "tuition", 1000, NOW, "pay1");
    expect(e.amount).toBe(-1000); // stored as negative
  });

  it("adjustments can be positive (debit) or negative (credit) but not zero", () => {
    expect(() => makeAdjustment("p1", 0, "x", NOW, "a1")).toThrow();
    const debit = makeAdjustment("p1", 500, "penalty", NOW, "a1");
    expect(debit.amount).toBe(500);
    const credit = makeAdjustment("p1", -500, "waiver", NOW, "a2");
    expect(credit.amount).toBe(-500);
  });

  it("refunds must have positive amount (stored as negative)", () => {
    expect(() =>
      createRefundEntry({
        tenantId: TENANT,
        parentId: "p1",
        studentId: null,
        category: "tuition",
        amount: 0,
        sourceId: "r1",
        description: "refund",
        actorId: "u1",
        actorName: "U",
      }),
    ).toThrow();
    const r = createRefundEntry({
      tenantId: TENANT,
      parentId: "p1",
      studentId: null,
      category: "tuition",
      amount: 1000,
      sourceId: "r1",
      description: "refund",
      actorId: "u1",
      actorName: "U",
    });
    expect(r.amount).toBe(-1000);
  });

  it("charges require non-empty description", () => {
    expect(() =>
      createChargeEntry({
        tenantId: TENANT,
        parentId: "p1",
        studentId: "s1",
        category: "tuition",
        amount: 100,
        sourceType: "installment",
        sourceId: "i1",
        description: "   ",
        actorId: "u1",
        actorName: "U",
      }),
    ).toThrow();
  });

  it("adjustments require non-empty reason", () => {
    expect(() =>
      createAdjustmentEntry({
        tenantId: TENANT,
        parentId: "p1",
        studentId: null,
        category: "tuition",
        amount: 100,
        reason: "",
        sourceType: "adjustment",
        sourceId: "a1",
        actorId: "u1",
        actorName: "U",
      }),
    ).toThrow();
  });
});

describe("Ledger — account ID derivation", () => {
  it("is deterministic — same inputs produce same ID", () => {
    const id1 = deriveAccountId("p1", "tuition", "s1");
    const id2 = deriveAccountId("p1", "tuition", "s1");
    expect(id1).toBe(id2);
  });

  it("changes when category changes", () => {
    const id1 = deriveAccountId("p1", "tuition", "s1");
    const id2 = deriveAccountId("p1", "transport", "s1");
    expect(id1).not.toBe(id2);
  });

  it("changes when student changes", () => {
    const id1 = deriveAccountId("p1", "tuition", "s1");
    const id2 = deriveAccountId("p1", "tuition", "s2");
    expect(id1).not.toBe(id2);
  });

  it("handles null studentId (parent-level account)", () => {
    const id = deriveAccountId("p1", "tuition", null);
    expect(id).toBe("parent:p1:category:tuition");
  });

  it("includes student in ID when provided", () => {
    const id = deriveAccountId("p1", "tuition", "s1");
    expect(id).toContain("student:s1");
  });
});

describe("Ledger — balance computation", () => {
  it("empty ledger → zero balance", () => {
    const balance = computeAccountBalance([], "any-account");
    expect(balance.balance).toBe(0);
    expect(balance.entryCount).toBe(0);
    expect(balance.lastActivityAt).toBeNull();
  });

  it("single charge → balance = charge amount", () => {
    const charge = makeCharge("p1", "s1", "tuition", 18000, NOW, "i1");
    const balance = computeAccountBalance([charge], charge.accountId);
    expect(balance.balance).toBe(18000);
    expect(balance.totalCharged).toBe(18000);
    expect(balance.totalPaid).toBe(0);
  });

  it("charge + payment → balance = charge - payment", () => {
    const charge = makeCharge("p1", "s1", "tuition", 18000, NOW, "i1");
    const payment = makePayment("p1", "s1", "tuition", 10000, NOW, "pay1");
    const balance = computeAccountBalance([charge, payment], charge.accountId);
    expect(balance.balance).toBe(8000);
    expect(balance.totalCharged).toBe(18000);
    expect(balance.totalPaid).toBe(10000);
  });

  it("fully paid → balance = 0", () => {
    const charge = makeCharge("p1", "s1", "tuition", 18000, NOW, "i1");
    const payment = makePayment("p1", "s1", "tuition", 18000, NOW, "pay1");
    const balance = computeAccountBalance([charge, payment], charge.accountId);
    expect(balance.balance).toBe(0);
  });

  it("overpayment → negative balance (credit)", () => {
    const charge = makeCharge("p1", "s1", "tuition", 10000, NOW, "i1");
    const payment = makePayment("p1", "s1", "tuition", 15000, NOW, "pay1");
    const balance = computeAccountBalance([charge, payment], charge.accountId);
    expect(balance.balance).toBe(-5000);
  });

  it("pending payments count separately from cleared", () => {
    const charge = makeCharge("p1", "s1", "tuition", 18000, NOW, "i1");
    const cleared = makePayment("p1", "s1", "tuition", 8000, NOW, "pay1", "paid", "REC-1");
    const pending = makePayment("p1", "s1", "tuition", 8000, NOW, "pay2", "pending", "REC-2");
    const balance = computeAccountBalance([charge, cleared, pending], charge.accountId);
    expect(balance.totalPaid).toBe(16000); // includes both
    expect(balance.totalCleared).toBe(8000);
    expect(balance.totalPending).toBe(8000);
    expect(balance.balance).toBe(2000); // 18000 - 16000
  });

  it("adjustments affect balance but are tracked separately", () => {
    // Use the same studentId so the adjustment applies to the same account as the charge.
    const charge = makeCharge("p1", "s1", "tuition", 18000, NOW, "i1");
    const credit = createAdjustmentEntry({
      tenantId: TENANT,
      parentId: "p1",
      studentId: "s1", // same student as the charge
      category: "tuition",
      amount: -2000,
      reason: "waiver",
      sourceType: "adjustment",
      sourceId: "a1",
      actorId: "u1",
      actorName: "U",
      at: NOW.toISOString(),
    });
    const balance = computeAccountBalance([charge, credit], charge.accountId);
    expect(balance.balance).toBe(16000);
    expect(balance.totalCharged).toBe(18000);
    expect(balance.totalAdjusted).toBe(-2000);
  });

  it("refunds reduce balance and tracked separately", () => {
    const charge = makeCharge("p1", "s1", "tuition", 18000, NOW, "i1");
    const refund = createRefundEntry({
      tenantId: TENANT,
      parentId: "p1",
      studentId: "s1",
      category: "tuition",
      amount: 5000,
      sourceId: "r1",
      description: "overpayment refund",
      actorId: "u1",
      actorName: "U",
      at: NOW.toISOString(),
    });
    const balance = computeAccountBalance([charge, refund], charge.accountId);
    expect(balance.balance).toBe(13000);
    expect(balance.totalRefunded).toBe(5000);
  });

  it("lastActivityAt tracks most recent entry", () => {
    const old = makeCharge("p1", "s1", "tuition", 1000, PAST, "i1");
    const recent = makePayment("p1", "s1", "tuition", 1000, NOW, "pay1");
    const balance = computeAccountBalance([old, recent], old.accountId);
    expect(balance.lastActivityAt).toBe(recent.at);
  });

  it("as-of queries exclude future entries", () => {
    const past = makeCharge("p1", "s1", "tuition", 1000, PAST, "i1");
    const future = makePayment("p1", "s1", "tuition", 500, FUTURE, "pay1");
    const asOf = new Date("2025-08-01T00:00:00Z");
    const balance = computeAccountBalance([past, future], past.accountId, asOf);
    expect(balance.balance).toBe(1000); // future payment excluded
    expect(balance.entryCount).toBe(1);
  });
});

describe("Ledger — parent summary aggregation", () => {
  it("empty parent → all zeros", () => {
    const summary = computeParentSummary([], "p1", "Test");
    expect(summary.totalOutstanding).toBe(0);
    expect(summary.totalCharged).toBe(0);
    expect(summary.totalPaid).toBe(0);
    expect(summary.accounts).toHaveLength(0);
  });

  it("aggregates across multiple accounts", () => {
    const tuition = makeCharge("p1", "s1", "tuition", 18000, NOW, "i1");
    const transport = makeCharge("p1", "s1", "transport", 6000, NOW, "i2");
    const tuitionPayment = makePayment("p1", "s1", "tuition", 10000, NOW, "pay1");
    const summary = computeParentSummary([tuition, transport, tuitionPayment], "p1", "Test");
    expect(summary.totalCharged).toBe(24000);
    expect(summary.totalPaid).toBe(10000);
    expect(summary.totalOutstanding).toBe(14000);
    expect(summary.accounts).toHaveLength(2); // tuition + transport accounts
  });

  it("overdue classification uses due date map", () => {
    const pastCharge = makeCharge("p1", "s1", "tuition", 18000, PAST, "i1");
    const dueDates = new Map([[pastCharge.accountId, PAST]]);
    const summary = computeParentSummary([pastCharge], "p1", "Test", dueDates, NOW);
    expect(summary.totalOutstanding).toBe(18000);
    expect(summary.totalOverdue).toBe(18000); // past-due + unpaid
  });

  it("future-due charges are NOT overdue", () => {
    // The charge's `at` is the bookkeeping date (when it was created).
    // The due date is stored in metadata and used by buildOverdueDueDateMap.
    // For this test, the charge was created in the PAST but is due in the FUTURE.
    const futureDueCharge = {
      ...makeCharge("p1", "s1", "tuition", 18000, PAST, "i1"),
      metadata: Object.freeze({ dueDate: FUTURE.toISOString() }),
    } as LedgerEntry;
    // The due date map says this account's charge is due in the future.
    const dueDates = new Map([[futureDueCharge.accountId, FUTURE]]);
    const summary = computeParentSummary([futureDueCharge], "p1", "Test", dueDates, NOW);
    expect(summary.totalOutstanding).toBe(18000);
    expect(summary.totalOverdue).toBe(0); // not yet due
  });
});

describe("Ledger — reversal semantics", () => {
  it("reversal negates the original entry's amount", () => {
    const original = makeCharge("p1", "s1", "tuition", 5000, NOW, "i1");
    const reversal = createReversalEntry(original, {
      reason: "mistake",
      actorId: "u1",
      actorName: "U",
    });
    expect(reversal.amount).toBe(-5000);
    expect(reversal.reversesId).toBe(original.id);
    expect(reversal.type).toBe("reversal");
  });

  it("reversed entries contribute 0 net balance", () => {
    const original = makeCharge("p1", "s1", "tuition", 5000, NOW, "i1");
    const reversal = createReversalEntry(original, {
      reason: "mistake",
      actorId: "u1",
      actorName: "U",
    });
    const balance = computeAccountBalance([original, reversal], original.accountId);
    expect(balance.balance).toBe(0);
    // When an entry is reversed, its contribution to typed totals is also
    // excluded — the reversal fully cancels the original. This is by design:
    // a reversed charge should not inflate totalCharged.
    expect(balance.totalCharged).toBe(0);
    expect(balance.entryCount).toBe(2); // both entries are still in the ledger
  });

  it("reversal of a payment restores the balance", () => {
    const charge = makeCharge("p1", "s1", "tuition", 10000, NOW, "i1");
    const payment = makePayment("p1", "s1", "tuition", 10000, NOW, "pay1");
    const reversal = createReversalEntry(payment, {
      reason: "check bounced",
      actorId: "u1",
      actorName: "U",
    });
    const balance = computeAccountBalance([charge, payment, reversal], charge.accountId);
    expect(balance.balance).toBe(10000); // charge unpaid after reversal
  });

  it("reversal requires a reason", () => {
    const original = makeCharge("p1", "s1", "tuition", 5000, NOW, "i1");
    expect(() =>
      createReversalEntry(original, { reason: "", actorId: "u1", actorName: "U" }),
    ).toThrow();
  });
});

describe("Ledger — pricing-derived charges", () => {
  it("buildTuitionChargeEntries produces 3 tranches from pricing config", () => {
    const entries = buildTuitionChargeEntries({
      tenantId: TENANT,
      parentId: "p1",
      studentId: "s1",
      level: "cem",
      config: defaultPricingConfig,
      academicYear: "2025-2026",
      trancheDueDates: ["2025-09-15", "2025-12-15", "2026-03-15"],
      actorId: "u1",
      actorName: "U",
      sourceId: "src-1",
    });
    expect(entries).toHaveLength(3);
    const total = entries.reduce((s, e) => s + e.amount, 0);
    expect(total).toBe(defaultPricingConfig.tuitionByLevel.cem);
  });

  it("buildTransportChargeEntry uses pricing config tier", () => {
    const entry = buildTransportChargeEntry({
      tenantId: TENANT,
      parentId: "p1",
      studentId: "s1",
      tier: "t2",
      config: defaultPricingConfig,
      academicYear: "2025-2026",
      dueDate: "2025-09-15",
      actorId: "u1",
      actorName: "U",
      sourceId: "src-2",
    });
    expect(entry.amount).toBe(defaultPricingConfig.transportByTier.t2);
    expect(entry.category).toBe("transport");
  });

  it("sibling discounts are applied when provided", () => {
    const sibling10 = defaultPricingConfig.discounts.find((d) => d.qualifier === "sibling_10")!;
    const entries = buildTuitionChargeEntries({
      tenantId: TENANT,
      parentId: "p1",
      studentId: "s1",
      level: "cem",
      config: defaultPricingConfig,
      academicYear: "2025-2026",
      trancheDueDates: ["2025-09-15", "2025-12-15", "2026-03-15"],
      actorId: "u1",
      actorName: "U",
      sourceId: "src-1",
      discounts: [sibling10],
    });
    const tuition = defaultPricingConfig.tuitionByLevel.cem;
    // Discount is applied per-tranche, then each tranche is rounded.
    // Per-tranche rounding may differ from rounding the total.
    const expectedPerTranche = tuitionTranches(tuition).map((t) =>
      Math.round(t.amountDue * 0.9),
    );
    const expectedTotal = expectedPerTranche.reduce((s, a) => s + a, 0);
    const actualTotal = entries.reduce((s, e) => s + e.amount, 0);
    expect(actualTotal).toBe(expectedTotal);
    // Sanity: the discount should reduce the total by ~10%.
    expect(actualTotal).toBeLessThan(tuition);
    expect(actualTotal).toBeGreaterThan(tuition * 0.85);
  });
});

describe("Ledger — maxDaysOverdueFromLedger", () => {
  it("returns 0 when no charges", () => {
    expect(maxDaysOverdueFromLedger([], NOW)).toBe(0);
  });

  it("returns 0 when charges are future-dated", () => {
    const future = makeCharge("p1", "s1", "tuition", 1000, FUTURE, "i1");
    expect(maxDaysOverdueFromLedger([future], NOW)).toBe(0);
  });

  it("returns days since oldest past-due charge", () => {
    const old = makeCharge("p1", "s1", "tuition", 1000, PAST, "i1");
    const days = maxDaysOverdueFromLedger([old], NOW);
    expect(days).toBeGreaterThan(0);
    // PAST = 2025-06-01, NOW = 2025-09-15 → 106 days
    expect(days).toBe(106);
  });
});

describe("Ledger — buildOverdueDueDateMap", () => {
  it("returns empty map for no charges", () => {
    const map = buildOverdueDueDateMap([]);
    expect(map.size).toBe(0);
  });

  it("includes only charge entries", () => {
    const charge = makeCharge("p1", "s1", "tuition", 1000, PAST, "i1");
    const payment = makePayment("p1", "s1", "tuition", 500, NOW, "pay1");
    const map = buildOverdueDueDateMap([charge, payment]);
    expect(map.size).toBe(1);
    expect(map.has(charge.accountId)).toBe(true);
  });

  it("uses latest charge's date per account", () => {
    const older = makeCharge("p1", "s1", "tuition", 1000, PAST, "i1");
    const newer = makeCharge("p1", "s1", "tuition", 2000, NOW, "i2");
    const map = buildOverdueDueDateMap([older, newer]);
    const date = map.get(older.accountId);
    expect(date?.getTime()).toBe(NOW.getTime());
  });
});

/* ================================================================== */
/*  Reconciliation engine                                              */
/* ================================================================== */

describe("Reconciliation — duplicate IDs", () => {
  it("detects duplicate entry IDs", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const dup = { ...e, amount: 9999 } as LedgerEntry;
    const violations = checkDuplicateIds([e, dup]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("DUPLICATE_ENTRY_ID");
    expect(violations[0].severity).toBe("error");
  });

  it("passes when all IDs are unique", () => {
    const e1 = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const e2 = makeCharge("p1", "s2", "tuition", 1000, NOW, "i2");
    expect(checkDuplicateIds([e1, e2])).toHaveLength(0);
  });
});

describe("Reconciliation — required fields", () => {
  it("detects missing description", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const bad = { ...e, description: "" } as LedgerEntry;
    const violations = checkRequiredFields([bad]);
    expect(violations.some((v) => v.code === "MISSING_DESCRIPTION")).toBe(true);
  });

  it("warns on missing actorId (anonymous operations forbidden)", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const bad = { ...e, actorId: "" } as LedgerEntry;
    const violations = checkRequiredFields([bad]);
    expect(violations.some((v) => v.code === "MISSING_ACTOR_ID" && v.severity === "warning")).toBe(true);
  });

  it("passes on well-formed entries", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    expect(checkRequiredFields([e])).toHaveLength(0);
  });
});

describe("Reconciliation — signed amount convention", () => {
  it("flags charge with non-positive amount", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const bad = { ...e, amount: -100 } as LedgerEntry;
    const violations = checkSignedAmountConvention([bad]);
    expect(violations.some((v) => v.code === "CHARGE_NOT_POSITIVE")).toBe(true);
  });

  it("flags payment with non-negative amount", () => {
    const e = makePayment("p1", "s1", "tuition", 1000, NOW, "pay1");
    const bad = { ...e, amount: 100 } as LedgerEntry;
    const violations = checkSignedAmountConvention([bad]);
    expect(violations.some((v) => v.code === "PAYMENT_NOT_NEGATIVE")).toBe(true);
  });

  it("flags refund with non-negative amount", () => {
    const e = createRefundEntry({
      tenantId: TENANT,
      parentId: "p1",
      studentId: null,
      category: "tuition",
      amount: 1000,
      sourceId: "r1",
      description: "x",
      actorId: "u1",
      actorName: "U",
    });
    const bad = { ...e, amount: 100 } as LedgerEntry;
    const violations = checkSignedAmountConvention([bad]);
    expect(violations.some((v) => v.code === "REFUND_NOT_NEGATIVE")).toBe(true);
  });

  it("flags zero adjustment", () => {
    const e = makeAdjustment("p1", 100, "x", NOW, "a1");
    const bad = { ...e, amount: 0 } as LedgerEntry;
    const violations = checkSignedAmountConvention([bad]);
    expect(violations.some((v) => v.code === "ADJUSTMENT_ZERO")).toBe(true);
  });
});

describe("Reconciliation — account ID consistency", () => {
  it("flags mismatched accountId", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const bad = { ...e, accountId: "wrong-account" } as LedgerEntry;
    const violations = checkAccountIdsMatch([bad]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("ACCOUNT_ID_MISMATCH");
  });

  it("passes when accountId matches derived", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    expect(checkAccountIdsMatch([e])).toHaveLength(0);
  });
});

describe("Reconciliation — reversal integrity", () => {
  it("flags orphan reversal (references non-existent original)", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const orphan = {
      ...e,
      id: "led-x",
      type: "reversal" as const,
      reversesId: "led-nonexistent",
      amount: -1000,
    } as LedgerEntry;
    const violations = checkReversalIntegrity([e, orphan]);
    expect(violations.some((v) => v.code === "ORPHAN_REVERSAL")).toBe(true);
  });

  it("flags double reversal (same original reversed twice)", () => {
    const original = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const r1 = createReversalEntry(original, { reason: "x", actorId: "u", actorName: "U" });
    const r2 = createReversalEntry(original, { reason: "y", actorId: "u", actorName: "U" });
    // Override IDs to make them different (createReversalEntry uses random IDs).
    const r2WithDiffId = { ...r2, id: "led-different" } as LedgerEntry;
    const violations = checkReversalIntegrity([original, r1, r2WithDiffId]);
    expect(violations.some((v) => v.code === "DOUBLE_REVERSAL")).toBe(true);
  });

  it("flags reversal with wrong amount (doesn't negate original)", () => {
    const original = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const badReversal = {
      ...original,
      id: "led-x",
      type: "reversal" as const,
      reversesId: original.id,
      amount: -500, // should be -1000
    } as LedgerEntry;
    const violations = checkReversalIntegrity([original, badReversal]);
    expect(violations.some((v) => v.code === "REVERSAL_AMOUNT_MISMATCH")).toBe(true);
  });

  it("passes on valid reversal", () => {
    const original = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const reversal = createReversalEntry(original, { reason: "x", actorId: "u", actorName: "U" });
    expect(checkReversalIntegrity([original, reversal])).toHaveLength(0);
  });
});

describe("Reconciliation — duplicate receipt numbers", () => {
  it("flags duplicate receipt numbers", () => {
    const e1 = makePayment("p1", "s1", "tuition", 1000, NOW, "pay1", "paid", "REC-001");
    const e2 = makePayment("p1", "s1", "tuition", 1000, NOW, "pay2", "paid", "REC-001");
    const violations = checkDuplicateReceiptNumbers([e1, e2]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("DUPLICATE_RECEIPT_NUMBER");
  });

  it("passes when receipt numbers are unique", () => {
    const e1 = makePayment("p1", "s1", "tuition", 1000, NOW, "pay1", "paid", "REC-001");
    const e2 = makePayment("p1", "s1", "tuition", 1000, NOW, "pay2", "paid", "REC-002");
    expect(checkDuplicateReceiptNumbers([e1, e2])).toHaveLength(0);
  });

  it("ignores null receipt numbers", () => {
    const charge = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const adj = makeAdjustment("p1", 100, "x", NOW, "a1");
    expect(checkDuplicateReceiptNumbers([charge, adj])).toHaveLength(0);
  });
});

describe("Reconciliation — tenant consistency", () => {
  it("flags entries from different tenants", () => {
    const e1 = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const e2 = { ...e1, id: "led-x", tenantId: "other-tenant" } as LedgerEntry;
    const violations = checkTenantConsistency([e1, e2]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("TENANT_MISMATCH");
  });

  it("passes on empty ledger", () => {
    expect(checkTenantConsistency([])).toHaveLength(0);
  });
});

describe("Reconciliation — full report", () => {
  it("passes on a clean ledger", () => {
    const entries = [
      makeCharge("p1", "s1", "tuition", 18000, NOW, "i1"),
      makePayment("p1", "s1", "tuition", 10000, NOW, "pay1", "paid", "REC-001"),
    ];
    const report = reconcileLedger(entries);
    expect(report.passed).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it("fails on a corrupted ledger", () => {
    const e1 = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const bad = { ...e1, id: e1.id, amount: -100 } as LedgerEntry; // duplicate ID + negative charge
    const report = reconcileLedger([e1, bad]);
    expect(report.passed).toBe(false);
    expect(report.summary.errors).toBeGreaterThan(0);
  });

  it("includes accountCount", () => {
    const entries = [
      makeCharge("p1", "s1", "tuition", 1000, NOW, "i1"),
      makeCharge("p1", "s1", "transport", 500, NOW, "i2"),
    ];
    const report = reconcileLedger(entries);
    expect(report.accountCount).toBe(2);
  });
});

describe("Reconciliation — cross-checks", () => {
  it("crossCheckPayments flags missing ledger entry", () => {
    const payments = [{ id: "pay-001", amount: 1000, status: "paid", receiptNumber: "REC-001" }];
    const violations = crossCheckPayments(payments, []);
    expect(violations.some((v) => v.code === "PAYMENT_WITHOUT_LEDGER_ENTRY")).toBe(true);
  });

  it("crossCheckPayments flags amount mismatch", () => {
    const ledgerEntry = makePayment("p1", "s1", "tuition", 1500, NOW, "pay-001", "paid", "REC-001");
    const payments = [{ id: "pay-001", amount: 1000, status: "paid", receiptNumber: "REC-001" }];
    const violations = crossCheckPayments(payments, [ledgerEntry]);
    expect(violations.some((v) => v.code === "PAYMENT_AMOUNT_MISMATCH")).toBe(true);
  });

  it("crossCheckInstallments flags missing charge entry", () => {
    const installments = [{
      id: "ins-001",
      parentId: "p1",
      studentId: "s1",
      category: "tuition",
      amountDue: 18000,
      label: "Tranche 1",
    }];
    const violations = crossCheckInstallments(installments, []);
    expect(violations.some((v) => v.code === "INSTALLMENT_WITHOUT_LEDGER_ENTRY")).toBe(true);
  });

  it("crossCheckBalanceSum flags sum mismatch", () => {
    const entries = [makeCharge("p1", "s1", "tuition", 1000, NOW, "i1")];
    const balances = [{ balance: 999 }]; // should be 1000
    const violations = crossCheckBalanceSum(entries, balances);
    expect(violations.some((v) => v.code === "BALANCE_SUM_MISMATCH")).toBe(true);
  });

  it("crossCheckBalanceSum passes on matching sums", () => {
    const entries = [
      makeCharge("p1", "s1", "tuition", 1000, NOW, "i1"),
      makePayment("p1", "s1", "tuition", 600, NOW, "pay1"),
    ];
    const balances = [{ balance: 400 }]; // 1000 - 600
    expect(crossCheckBalanceSum(entries, balances)).toHaveLength(0);
  });
});

/* ================================================================== */
/*  Property-based tests                                               */
/* ================================================================== */

describe("Ledger — property-based tests", () => {
  // Use a seeded PRNG for reproducibility.
  function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  function generateRandomLedger(seed: number, count: number): LedgerEntry[] {
    const rand = seededRandom(seed);
    const entries: LedgerEntry[] = [];
    const parents = ["p1", "p2", "p3"];
    const students = ["s1", "s2", "s3"];
    const categories: PaymentCategory[] = ["tuition", "transport", "canteen"];
    let idCounter = 0;
    for (let i = 0; i < count; i++) {
      const parentId = parents[Math.floor(rand() * parents.length)];
      const studentId = students[Math.floor(rand() * students.length)];
      const category = categories[Math.floor(rand() * categories.length)];
      const type = rand() < 0.5 ? "charge" : "payment";
      const amount = Math.max(1, Math.floor(rand() * 10000));
      const at = new Date(PAST.getTime() + rand() * (NOW.getTime() - PAST.getTime()));
      idCounter++;
      const id = `led-prop-${idCounter}`;
      if (type === "charge") {
        entries.push({
          ...makeCharge(parentId, studentId, category, amount, at, `src-${idCounter}`),
          id,
        });
      } else {
        entries.push({
          ...makePayment(parentId, studentId, category, amount, at, `src-${idCounter}`, "paid", `REC-${idCounter}`),
          id,
        });
      }
    }
    return entries;
  }

  it("random ledger always reconciles as clean (no structural errors)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const entries = generateRandomLedger(seed, 100);
      const report = reconcileLedger(entries);
      // The generator produces well-formed entries, so the report should pass.
      expect(report.passed, `seed ${seed} should pass`).toBe(true);
    }
  });

  it("sum of all account balances always equals sum of all entry amounts", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const entries = generateRandomLedger(seed, 100);
      const accountIds = new Set(entries.map((e) => e.accountId));
      const balances = Array.from(accountIds).map((accId) => computeAccountBalance(entries, accId));
      const balanceSum = balances.reduce((s, b) => s + b.balance, 0);
      const entrySum = entries.reduce((s, e) => s + e.amount, 0);
      expect(Math.abs(balanceSum - entrySum)).toBeLessThan(0.01);
    }
  });

  it("replaying the ledger twice produces the same balance (determinism)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const entries = generateRandomLedger(seed, 50);
      const accountIds = new Set(entries.map((e) => e.accountId));
      for (const accId of accountIds) {
        const b1 = computeAccountBalance(entries, accId);
        const b2 = computeAccountBalance(entries, accId);
        expect(b1.balance).toBe(b2.balance);
        expect(b1.entryCount).toBe(b2.entryCount);
      }
    }
  });
});

/* ================================================================== */
/*  Stress tests                                                       */
/* ================================================================== */

describe("Ledger — stress tests", () => {
  it("handles 10,000 entries without crashing", () => {
    const start = Date.now();
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < 10_000; i++) {
      const parentId = `p${i % 100}`;
      const studentId = `s${i % 200}`;
      const isCharge = i % 2 === 0;
      const at = new Date(PAST.getTime() + (i * 86_400_000));
      if (isCharge) {
        entries.push({
          ...makeCharge(parentId, studentId, "tuition", 1000, at, `i${i}`),
          id: `led-${i}`,
        });
      } else {
        entries.push({
          ...makePayment(parentId, studentId, "tuition", 500, at, `pay${i}`, "paid", `REC-${i}`),
          id: `led-${i}`,
        });
      }
    }
    const accountIds = new Set(entries.map((e) => e.accountId));
    const balances = Array.from(accountIds).map((accId) => computeAccountBalance(entries, accId));
    const elapsed = Date.now() - start;
    // Should complete in under 5 seconds.
    expect(elapsed).toBeLessThan(5000);
    // Each account should have a non-NaN balance.
    for (const b of balances) {
      expect(Number.isFinite(b.balance)).toBe(true);
    }
  });

  it("reconciliation completes on 5,000 entries in under 3 seconds", () => {
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < 5_000; i++) {
      const at = new Date(PAST.getTime() + (i * 86_400_000));
      entries.push({
        ...makeCharge(`p${i % 50}`, `s${i % 100}`, "tuition", 1000, at, `i${i}`),
        id: `led-${i}`,
      });
    }
    const start = Date.now();
    const report = reconcileLedger(entries);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
    expect(report.entryCount).toBe(5_000);
  });
});

/* ================================================================== */
/*  Edge cases                                                         */
/* ================================================================== */

describe("Ledger — edge cases", () => {
  it("single entry ledger", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const report = reconcileLedger([e]);
    expect(report.passed).toBe(true);
    expect(report.entryCount).toBe(1);
    expect(report.accountCount).toBe(1);
  });

  it("entries out of chronological order still compute correctly", () => {
    const c1 = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    const c2 = makeCharge("p1", "s1", "tuition", 500, PAST, "i2");
    const balance = computeAccountBalance([c1, c2], c1.accountId);
    expect(balance.balance).toBe(1500);
    // lastActivityAt should be the most recent (NOW), not the last in the array.
    expect(balance.lastActivityAt).toBe(c1.at);
  });

  it("zero-amount entries are forbidden (charges)", () => {
    expect(() => makeCharge("p1", "s1", "tuition", 0, NOW, "i1")).toThrow();
  });

  it("entries with same timestamp but different IDs are sorted by ID", () => {
    const a = { ...makeCharge("p1", "s1", "tuition", 100, NOW, "i1"), id: "led-a" };
    const b = { ...makeCharge("p1", "s1", "tuition", 200, NOW, "i2"), id: "led-b" };
    const balance = computeAccountBalance([b, a], a.accountId);
    // Both contribute to balance regardless of order.
    expect(balance.balance).toBe(300);
  });

  it("metadata is frozen (immutable)", () => {
    const e = makeCharge("p1", "s1", "tuition", 1000, NOW, "i1");
    expect(Object.isFrozen(e.metadata)).toBe(true);
  });
});
