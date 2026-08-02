/**
 * Characterization tests for `calc/ledger/balance.ts`.
 *
 * Locks in the exact behavior of `computeAccountBalance` and
 * `computeParentSummary` BEFORE the refactor. All expectations were
 * captured from the original implementation in `domain/model/ledger.ts`.
 *
 * Coverage target: 100% lines + branches.
 */
import { describe, it, expect } from "vitest";
import {
  computeAccountBalance,
  computeParentSummary,
} from "@/domain/calc/ledger/balance";
import { buildOverdueDueDateMap } from "@/domain/calc/ledger/overdue";
import {
  createChargeEntry,
  createPaymentEntry,
  createAdjustmentEntry,
  createRefundEntry,
  createReversalEntry,
} from "@/domain/calc/ledger/entries";
import type { LedgerEntry } from "@/domain/model/ledger";
import type { PaymentCategory } from "@/domain/model/payment";

const TENANT = "tenant-test";
const NOW = new Date("2025-09-15T10:00:00Z");
const PAST = new Date("2025-06-01T10:00:00Z");
const FUTURE = new Date("2025-12-01T10:00:00Z");

function charge(
  parentId: string,
  studentId: string | null,
  category: PaymentCategory,
  amount: number,
  at: Date,
  sourceId = "src-1",
): LedgerEntry {
  return createChargeEntry({
    tenantId: TENANT,
    parentId,
    studentId,
    category,
    amount,
    sourceType: "installment",
    sourceId,
    description: `Charge ${amount}`,
    actorId: "actor-1",
    actorName: "Actor One",
    at: at.toISOString(),
  });
}

function payment(
  parentId: string,
  studentId: string | null,
  category: PaymentCategory,
  amount: number,
  at: Date,
  status: "paid" | "pending" = "paid",
  sourceId = "pay-1",
): LedgerEntry {
  return createPaymentEntry({
    tenantId: TENANT,
    parentId,
    studentId,
    category,
    amount,
    method: "cash",
    receiptNumber: `REC-${sourceId}`,
    paymentStatus: status,
    sourceType: "payment",
    sourceId,
    description: `Payment ${amount}`,
    actorId: "actor-1",
    actorName: "Actor One",
    at: at.toISOString(),
  });
}

describe("calc/ledger/balance — computeAccountBalance", () => {
  it("returns zero balance for an account with no entries", () => {
    const result = computeAccountBalance([], "parent:p1:category:tuition", NOW);
    expect(result.balance).toBe(0);
    expect(result.entryCount).toBe(0);
    expect(result.lastActivityAt).toBeNull();
    expect(result.parentId).toBe("");
    expect(result.studentId).toBeNull();
    expect(result.category).toBe("other");
  });

  it("sums signed amounts to compute the balance", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      payment("p1", null, "tuition", 600, PAST),
    ];
    const result = computeAccountBalance(entries, "parent:p1:category:tuition", NOW);
    expect(result.balance).toBe(400); // 1000 - 600
    expect(result.totalCharged).toBe(1000);
    expect(result.totalPaid).toBe(600);
  });

  it("excludes entries for other accounts", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      charge("p1", null, "transport", 500, PAST),
    ];
    const result = computeAccountBalance(entries, "parent:p1:category:tuition", NOW);
    expect(result.balance).toBe(1000);
    expect(result.entryCount).toBe(1);
  });

  it("excludes entries after the `now` cutoff (as-of query)", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      charge("p1", null, "tuition", 500, FUTURE),
    ];
    const result = computeAccountBalance(entries, "parent:p1:category:tuition", NOW);
    expect(result.balance).toBe(1000); // future entry excluded
    expect(result.entryCount).toBe(1);
  });

  it("includes entry at exactly the `now` cutoff (≤ comparison, preserved)", () => {
    const atNow = NOW.toISOString();
    const entries = [charge("p1", null, "tuition", 1000, NOW)];
    const result = computeAccountBalance(entries, "parent:p1:category:tuition", NOW);
    expect(result.entryCount).toBe(1);
    expect(result.balance).toBe(1000);
  });

  it("sorts entries by timestamp then by id for stability", () => {
    // Two entries at the same timestamp — sort by id
    const e1 = charge("p1", null, "tuition", 100, PAST);
    const e2 = charge("p1", null, "tuition", 200, PAST);
    const entries = [e2, e1]; // out of order
    const result = computeAccountBalance(entries, "parent:p1:category:tuition", NOW);
    expect(result.entryCount).toBe(2);
    expect(result.balance).toBe(300);
  });

  it("tracks typed totals separately (charged, paid, cleared, pending, adjusted, refunded)", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      payment("p1", null, "tuition", 400, PAST, "paid"),
      payment("p1", null, "tuition", 200, PAST, "pending"),
      createAdjustmentEntry({
        tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
        amount: -100, reason: "Discount", sourceType: "adjustment", sourceId: "adj-1",
        actorId: "actor-1", actorName: "Actor One", at: PAST.toISOString(),
      }),
      createRefundEntry({
        tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
        amount: 50, sourceId: "ref-1", description: "Refund",
        actorId: "actor-1", actorName: "Actor One", at: PAST.toISOString(),
      }),
    ];
    const result = computeAccountBalance(entries, "parent:p1:category:tuition", NOW);
    expect(result.totalCharged).toBe(1000);
    expect(result.totalPaid).toBe(600); // 400 + 200 (paid + pending)
    expect(result.totalCleared).toBe(400); // paid only
    expect(result.totalPending).toBe(200); // pending only
    expect(result.totalAdjusted).toBe(-100);
    expect(result.totalRefunded).toBe(50);
  });

  it("excludes reversed entries from typed totals but keeps their contribution to balance", () => {
    const original = charge("p1", null, "tuition", 1000, PAST);
    const reversal = createReversalEntry(original, {
      reason: "Correction", actorId: "actor-1", actorName: "Actor One",
      at: PAST.toISOString(),
    });
    const entries = [original, reversal];
    const result = computeAccountBalance(entries, "parent:p1:category:tuition", NOW);
    expect(result.balance).toBe(0); // 1000 + (-1000)
    expect(result.totalCharged).toBe(0); // original excluded because reversed
    expect(result.entryCount).toBe(2);
  });

  it("tracks the latest activity timestamp", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      payment("p1", null, "tuition", 500, NOW),
    ];
    const result = computeAccountBalance(entries, "parent:p1:category:tuition", NOW);
    expect(result.lastActivityAt).toBe(NOW.toISOString());
  });

  it("handles negative balance (overpayment / credit)", () => {
    const entries = [
      charge("p1", null, "tuition", 500, PAST),
      payment("p1", null, "tuition", 800, PAST),
    ];
    const result = computeAccountBalance(entries, "parent:p1:category:tuition", NOW);
    expect(result.balance).toBe(-300); // parent overpaid by 300
  });
});

describe("calc/ledger/balance — computeParentSummary", () => {
  it("returns zero totals for a parent with no entries", () => {
    const result = computeParentSummary([], "p1", "Parent One", new Map(), NOW);
    expect(result.parentId).toBe("p1");
    expect(result.parentName).toBe("Parent One");
    expect(result.totalOutstanding).toBe(0);
    expect(result.totalOverdue).toBe(0);
    expect(result.accounts).toEqual([]);
    expect(result.entryCount).toBe(0);
    expect(result.lastActivityAt).toBeNull();
  });

  it("aggregates balances across multiple accounts", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      charge("p1", null, "transport", 500, PAST),
      payment("p1", null, "tuition", 400, PAST),
    ];
    const result = computeParentSummary(entries, "p1", "Parent One", new Map(), NOW);
    expect(result.accounts).toHaveLength(2); // tuition + transport accounts
    expect(result.totalOutstanding).toBe(1100); // (1000-400) + 500
    expect(result.totalCharged).toBe(1500);
    expect(result.totalPaid).toBe(400);
    expect(result.entryCount).toBe(3);
  });

  it("only includes entries for the specified parent", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      charge("p2", null, "tuition", 2000, PAST),
    ];
    const result = computeParentSummary(entries, "p1", "Parent One", new Map(), NOW);
    expect(result.totalCharged).toBe(1000); // only p1
    expect(result.accounts).toHaveLength(1);
  });

  it("classifies accounts as overdue when balance > 0 and dueDate < now", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST), // overdue (past due)
    ];
    const dueDateMap = buildOverdueDueDateMap(entries);
    const result = computeParentSummary(entries, "p1", "Parent One", dueDateMap, NOW);
    expect(result.totalOverdue).toBe(1000);
  });

  it("does not classify as overdue when balance is 0", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      payment("p1", null, "tuition", 1000, PAST),
    ];
    const dueDateMap = buildOverdueDueDateMap(entries);
    const result = computeParentSummary(entries, "p1", "Parent One", dueDateMap, NOW);
    expect(result.totalOverdue).toBe(0); // balance is 0
  });

  it("does not classify as overdue when dueDate is in the future", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, FUTURE),
    ];
    const dueDateMap = buildOverdueDueDateMap(entries);
    const result = computeParentSummary(entries, "p1", "Parent One", dueDateMap, NOW);
    expect(result.totalOverdue).toBe(0); // due in the future
  });

  it("does not classify as overdue when no dueDate map is provided", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
    ];
    const result = computeParentSummary(entries, "p1", "Parent One", new Map(), NOW);
    expect(result.totalOverdue).toBe(0); // no due date info
  });

  it("aggregates overdue across multiple overdue accounts", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      charge("p1", null, "transport", 500, PAST),
    ];
    const dueDateMap = buildOverdueDueDateMap(entries);
    const result = computeParentSummary(entries, "p1", "Parent One", dueDateMap, NOW);
    expect(result.totalOverdue).toBe(1500); // both accounts overdue
  });

  it("tracks the latest activity across all accounts", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      payment("p1", null, "transport", 200, NOW),
    ];
    const result = computeParentSummary(entries, "p1", "Parent One", new Map(), NOW);
    expect(result.lastActivityAt).toBe(NOW.toISOString());
  });

  it("aggregates typed totals across all accounts", () => {
    const entries = [
      charge("p1", null, "tuition", 1000, PAST),
      payment("p1", null, "tuition", 400, PAST, "paid"),
      payment("p1", null, "tuition", 100, PAST, "pending"),
      createAdjustmentEntry({
        tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
        amount: -50, reason: "Discount", sourceType: "adjustment", sourceId: "adj-1",
        actorId: "actor-1", actorName: "Actor One", at: PAST.toISOString(),
      }),
    ];
    const result = computeParentSummary(entries, "p1", "Parent One", new Map(), NOW);
    expect(result.totalCharged).toBe(1000);
    expect(result.totalPaid).toBe(500); // 400 + 100
    expect(result.totalCleared).toBe(400);
    expect(result.totalPending).toBe(100);
    expect(result.totalAdjusted).toBe(-50);
    expect(result.totalRefunded).toBe(0);
  });
});
