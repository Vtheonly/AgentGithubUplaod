/**
 * Characterization tests for `calc/reconcile/` (checks + cross-checks + orchestrator).
 *
 * Locks in the exact behavior of every reconciliation function so the
 * refactor is provably behavior-preserving.
 */
import { describe, it, expect } from "vitest";
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
} from "@/domain/calc/reconcile";
import {
  createChargeEntry,
  createPaymentEntry,
  createAdjustmentEntry,
  createRefundEntry,
  createReversalEntry,
} from "@/domain/calc/ledger/entries";
import type { LedgerEntry } from "@/domain/model/ledger";

const TENANT = "tenant-1";

function makeValidCharge(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const base = createChargeEntry({
    tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
    amount: 1000, sourceType: "installment", sourceId: "src-1",
    description: "Test charge", actorId: "a1", actorName: "Actor",
    at: "2025-09-15T00:00:00.000Z",
  });
  return { ...base, ...overrides };
}

function makeValidPayment(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  const base = createPaymentEntry({
    tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
    amount: 500, method: "cash", receiptNumber: "REC-001", paymentStatus: "paid",
    sourceType: "payment", sourceId: "pay-1",
    description: "Test payment", actorId: "a1", actorName: "Actor",
    at: "2025-09-15T00:00:00.000Z",
  });
  return { ...base, ...overrides };
}

describe("calc/reconcile — checkDuplicateIds", () => {
  it("returns no violations when all IDs are unique", () => {
    const entries = [makeValidCharge(), makeValidPayment()];
    expect(checkDuplicateIds(entries)).toEqual([]);
  });
  it("flags duplicate IDs with an error", () => {
    const e1 = makeValidCharge();
    const e2 = makeValidPayment({ ...e1, amount: -200 } as Partial<LedgerEntry>);
    const violations = checkDuplicateIds([e1, e2]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("DUPLICATE_ENTRY_ID");
    expect(violations[0].severity).toBe("error");
    expect(violations[0].entryId).toBe(e1.id);
  });
  it("counts the correct duplicate count in the message", () => {
    const e1 = makeValidCharge();
    const e2 = { ...e1, amount: 200 } as LedgerEntry;
    const e3 = { ...e1, amount: 300 } as LedgerEntry;
    const violations = checkDuplicateIds([e1, e2, e3]);
    expect(violations[0].message).toContain("3 times");
  });
  it("returns no violations for an empty list", () => {
    expect(checkDuplicateIds([])).toEqual([]);
  });
});

describe("calc/reconcile — checkRequiredFields", () => {
  it("returns no violations for a fully populated entry", () => {
    expect(checkRequiredFields([makeValidCharge()])).toEqual([]);
  });
  it("flags missing id, tenantId, accountId, parentId", () => {
    const e = makeValidCharge({
      id: "", tenantId: "", accountId: "", parentId: "",
    } as Partial<LedgerEntry>);
    const violations = checkRequiredFields([e]);
    const codes = violations.map((v) => v.code);
    expect(codes).toContain("MISSING_ID");
    expect(codes).toContain("MISSING_TENANT_ID");
    expect(codes).toContain("MISSING_ACCOUNT_ID");
    expect(codes).toContain("MISSING_PARENT_ID");
  });
  it("flags invalid (NaN) amount", () => {
    const e = makeValidCharge({ amount: NaN } as Partial<LedgerEntry>);
    const violations = checkRequiredFields([e]);
    expect(violations.some((v) => v.code === "INVALID_AMOUNT")).toBe(true);
  });
  it("flags missing type, sourceType, sourceId", () => {
    const e = makeValidCharge({
      type: "" as LedgerEntry["type"],
      sourceType: "" as LedgerEntry["sourceType"],
      sourceId: "",
    } as Partial<LedgerEntry>);
    const violations = checkRequiredFields([e]);
    const codes = violations.map((v) => v.code);
    expect(codes).toContain("MISSING_TYPE");
    expect(codes).toContain("MISSING_SOURCE_TYPE");
    expect(codes).toContain("MISSING_SOURCE_ID");
  });
  it("flags missing or blank description", () => {
    const e = makeValidCharge({ description: "   " } as Partial<LedgerEntry>);
    const violations = checkRequiredFields([e]);
    expect(violations.some((v) => v.code === "MISSING_DESCRIPTION")).toBe(true);
  });
  it("flags missing actorId and actorName as WARNINGS (not errors)", () => {
    const e = makeValidCharge({
      actorId: "", actorName: "",
    } as Partial<LedgerEntry>);
    const violations = checkRequiredFields([e]);
    const actorIdV = violations.find((v) => v.code === "MISSING_ACTOR_ID");
    const actorNameV = violations.find((v) => v.code === "MISSING_ACTOR_NAME");
    expect(actorIdV?.severity).toBe("warning");
    expect(actorNameV?.severity).toBe("warning");
  });
  it("flags missing timestamp", () => {
    const e = makeValidCharge({ at: "" } as Partial<LedgerEntry>);
    const violations = checkRequiredFields([e]);
    expect(violations.some((v) => v.code === "MISSING_TIMESTAMP")).toBe(true);
  });
});

describe("calc/reconcile — checkSignedAmountConvention", () => {
  it("passes for a valid charge (positive) and payment (negative)", () => {
    const entries = [makeValidCharge({ amount: 1000 }), makeValidPayment({ amount: -500 })];
    expect(checkSignedAmountConvention(entries)).toEqual([]);
  });
  it("flags a charge with non-positive amount", () => {
    const e = makeValidCharge({ amount: 0 } as Partial<LedgerEntry>);
    const v = checkSignedAmountConvention([e]);
    expect(v[0].code).toBe("CHARGE_NOT_POSITIVE");
  });
  it("flags a payment with non-negative amount", () => {
    const e = makeValidPayment({ amount: 100 } as Partial<LedgerEntry>);
    const v = checkSignedAmountConvention([e]);
    expect(v[0].code).toBe("PAYMENT_NOT_NEGATIVE");
  });
  it("flags a refund with non-negative amount", () => {
    const refund = createRefundEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 100, sourceId: "r1", description: "R",
      actorId: "a", actorName: "A",
    });
    const tampered = { ...refund, amount: 100 } as LedgerEntry; // force positive
    const v = checkSignedAmountConvention([tampered]);
    expect(v[0].code).toBe("REFUND_NOT_NEGATIVE");
  });
  it("flags an adjustment with amount = 0", () => {
    const adj = createAdjustmentEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 100, reason: "Test", sourceType: "adjustment", sourceId: "adj",
      actorId: "a", actorName: "A",
    });
    const tampered = { ...adj, amount: 0 } as LedgerEntry;
    const v = checkSignedAmountConvention([tampered]);
    expect(v[0].code).toBe("ADJUSTMENT_ZERO");
  });
  it("passes for any reversal or transfer amount (no check)", () => {
    const reversal = createReversalEntry(makeValidCharge(), {
      reason: "Test", actorId: "a", actorName: "A",
    });
    const transfer = { ...makeValidCharge(), type: "transfer" as const, amount: 0 };
    expect(checkSignedAmountConvention([reversal, transfer])).toEqual([]);
  });
});

describe("calc/reconcile — checkAccountIdsMatch", () => {
  it("passes when accountId matches the derived ID", () => {
    expect(checkAccountIdsMatch([makeValidCharge()])).toEqual([]);
  });
  it("flags a mismatch between accountId and the derived ID", () => {
    const e = makeValidCharge({ accountId: "wrong-account" } as Partial<LedgerEntry>);
    const v = checkAccountIdsMatch([e]);
    expect(v[0].code).toBe("ACCOUNT_ID_MISMATCH");
    expect(v[0].details?.expected).toBeDefined();
    expect(v[0].details?.actual).toBe("wrong-account");
  });
});

describe("calc/reconcile — checkReversalIntegrity", () => {
  it("passes when a reversal references an existing entry and negates its amount", () => {
    const original = makeValidCharge({ amount: 1000 });
    const reversal = createReversalEntry(original, {
      reason: "Test", actorId: "a", actorName: "A",
    });
    expect(checkReversalIntegrity([original, reversal])).toEqual([]);
  });
  it("flags a reversal referencing a non-existent original (ORPHAN_REVERSAL)", () => {
    const reversal = createReversalEntry(makeValidCharge(), {
      reason: "Test", actorId: "a", actorName: "A",
    });
    const v = checkReversalIntegrity([reversal]);
    expect(v[0].code).toBe("ORPHAN_REVERSAL");
  });
  it("flags a reversal whose amount does not negate the original", () => {
    const original = makeValidCharge({ amount: 1000 });
    const reversal = createReversalEntry(original, {
      reason: "Test", actorId: "a", actorName: "A",
    });
    const tampered = { ...reversal, amount: -500 } as LedgerEntry;
    const v = checkReversalIntegrity([original, tampered]);
    expect(v.some((x) => x.code === "REVERSAL_AMOUNT_MISMATCH")).toBe(true);
  });
  it("flags a reversal whose accountId differs from the original", () => {
    const original = makeValidCharge();
    const reversal = createReversalEntry(original, {
      reason: "Test", actorId: "a", actorName: "A",
    });
    const tampered = { ...reversal, accountId: "different-account" } as LedgerEntry;
    const v = checkReversalIntegrity([original, tampered]);
    expect(v.some((x) => x.code === "REVERSAL_ACCOUNT_MISMATCH")).toBe(true);
  });
  it("flags when the same original is reversed more than once (DOUBLE_REVERSAL)", () => {
    const original = makeValidCharge();
    const r1 = createReversalEntry(original, { reason: "R1", actorId: "a", actorName: "A" });
    const r2 = createReversalEntry(original, { reason: "R2", actorId: "a", actorName: "A" });
    const v = checkReversalIntegrity([original, r1, r2]);
    expect(v.some((x) => x.code === "DOUBLE_REVERSAL")).toBe(true);
  });
});

describe("calc/reconcile — checkDuplicateReceiptNumbers", () => {
  it("passes when receipt numbers are unique or absent", () => {
    const entries = [
      makeValidPayment({ receiptNumber: "REC-001" }),
      makeValidPayment({ receiptNumber: "REC-002" }),
      makeValidCharge({ receiptNumber: null }),
    ];
    expect(checkDuplicateReceiptNumbers(entries)).toEqual([]);
  });
  it("flags duplicate receipt numbers", () => {
    const e1 = makeValidPayment({ receiptNumber: "REC-DUP" });
    const e2 = makeValidPayment({ receiptNumber: "REC-DUP" });
    const v = checkDuplicateReceiptNumbers([e1, e2]);
    expect(v[0].code).toBe("DUPLICATE_RECEIPT_NUMBER");
    expect(v[0].message).toContain("REC-DUP");
  });
  it("skips entries with null receipt number", () => {
    const entries = [
      makeValidCharge({ receiptNumber: null }),
      makeValidCharge({ receiptNumber: null }),
    ];
    expect(checkDuplicateReceiptNumbers(entries)).toEqual([]);
  });
});

describe("calc/reconcile — checkTenantConsistency", () => {
  it("passes when all entries share the same tenantId", () => {
    expect(checkTenantConsistency([makeValidCharge(), makeValidPayment()])).toEqual([]);
  });
  it("passes for an empty list (preserves early return)", () => {
    expect(checkTenantConsistency([])).toEqual([]);
  });
  it("flags entries with a different tenantId than the first", () => {
    const e1 = makeValidCharge({ tenantId: "tenant-A" } as Partial<LedgerEntry>);
    const e2 = makeValidCharge({ tenantId: "tenant-B" } as Partial<LedgerEntry>);
    const v = checkTenantConsistency([e1, e2]);
    expect(v[0].code).toBe("TENANT_MISMATCH");
  });
});

describe("calc/reconcile — reconcileLedger (orchestrator)", () => {
  it("returns a passed report for an empty ledger", () => {
    const report = reconcileLedger([]);
    expect(report.passed).toBe(true);
    expect(report.entryCount).toBe(0);
    expect(report.accountCount).toBe(0);
    expect(report.summary.errors).toBe(0);
    expect(report.violations).toEqual([]);
  });
  it("returns a passed report for a valid ledger", () => {
    const entries = [makeValidCharge(), makeValidPayment()];
    const report = reconcileLedger(entries);
    expect(report.passed).toBe(true);
    expect(report.summary.errors).toBe(0);
  });
  it("returns a failed report when there are errors", () => {
    const bad = makeValidCharge({ amount: -100 } as Partial<LedgerEntry>);
    const report = reconcileLedger([bad]);
    expect(report.passed).toBe(false);
    expect(report.summary.errors).toBeGreaterThan(0);
  });
  it("counts distinct accounts in accountCount", () => {
    const e1 = makeValidCharge({ accountId: "acc-1" } as Partial<LedgerEntry>);
    const e2 = makeValidCharge({ accountId: "acc-2" } as Partial<LedgerEntry>);
    const report = reconcileLedger([e1, e2]);
    expect(report.accountCount).toBe(2);
  });
  it("aggregates errors + warnings + infos in the summary", () => {
    const e = makeValidCharge({ actorId: "", actorName: "" } as Partial<LedgerEntry>);
    const report = reconcileLedger([e]);
    expect(report.summary.warnings).toBeGreaterThanOrEqual(2); // missing actorId + actorName
  });
  it("sets checkedAt to a valid ISO timestamp", () => {
    const report = reconcileLedger([]);
    expect(new Date(report.checkedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("calc/reconcile — crossCheckPayments", () => {
  it("flags a payment with no matching ledger entry (warning)", () => {
    const payments = [{ id: "pay-1", amount: 500, status: "paid", receiptNumber: "REC-1" }];
    const v = crossCheckPayments(payments, []);
    expect(v[0].code).toBe("PAYMENT_WITHOUT_LEDGER_ENTRY");
    expect(v[0].severity).toBe("warning");
  });
  it("passes when the payment matches a ledger entry exactly", () => {
    const entry = makeValidPayment({ amount: -500, sourceId: "pay-1", paymentStatus: "paid" });
    const payments = [{ id: "pay-1", amount: 500, status: "paid", receiptNumber: "REC-001" }];
    expect(crossCheckPayments(payments, [entry])).toEqual([]);
  });
  it("flags an amount mismatch (error)", () => {
    const entry = makeValidPayment({ amount: -500, sourceId: "pay-1", paymentStatus: "paid" });
    const payments = [{ id: "pay-1", amount: 999, status: "paid", receiptNumber: "REC-001" }];
    const v = crossCheckPayments(payments, [entry]);
    expect(v[0].code).toBe("PAYMENT_AMOUNT_MISMATCH");
    expect(v[0].severity).toBe("error");
  });
  it("flags a status mismatch (warning)", () => {
    const entry = makeValidPayment({ amount: -500, sourceId: "pay-1", paymentStatus: "paid" });
    const payments = [{ id: "pay-1", amount: 500, status: "pending", receiptNumber: "REC-001" }];
    const v = crossCheckPayments(payments, [entry]);
    expect(v[0].code).toBe("PAYMENT_STATUS_MISMATCH");
    expect(v[0].severity).toBe("warning");
  });
});

describe("calc/reconcile — crossCheckInstallments", () => {
  it("flags an installment with no matching charge entry (warning)", () => {
    const installments = [{
      id: "i1", parentId: "p1", studentId: null, category: "tuition",
      amountDue: 1000, label: "Tranche 1",
    }];
    const v = crossCheckInstallments(installments, []);
    expect(v[0].code).toBe("INSTALLMENT_WITHOUT_LEDGER_ENTRY");
  });
  it("passes when the installment matches a charge entry exactly", () => {
    const entry = makeValidCharge({ amount: 1000, sourceType: "installment", sourceId: "i1" });
    const installments = [{
      id: "i1", parentId: "p1", studentId: null, category: "tuition",
      amountDue: 1000, label: "Tranche 1",
    }];
    expect(crossCheckInstallments(installments, [entry])).toEqual([]);
  });
  it("flags an amount mismatch (error)", () => {
    const entry = makeValidCharge({ amount: 1000, sourceType: "installment", sourceId: "i1" });
    const installments = [{
      id: "i1", parentId: "p1", studentId: null, category: "tuition",
      amountDue: 2000, label: "Tranche 1",
    }];
    const v = crossCheckInstallments(installments, [entry]);
    expect(v[0].code).toBe("INSTALLMENT_AMOUNT_MISMATCH");
    expect(v[0].severity).toBe("error");
  });
});

describe("calc/reconcile — crossCheckBalanceSum", () => {
  it("passes when the sum of entries equals the sum of balances", () => {
    const entries = [makeValidCharge({ amount: 1000 }), makeValidPayment({ amount: -600 })];
    const balances = [{ balance: 400 }]; // 1000 - 600
    expect(crossCheckBalanceSum(entries, balances)).toEqual([]);
  });
  it("flags a mismatch beyond the 0.01 tolerance", () => {
    const entries = [makeValidCharge({ amount: 1000 })];
    const balances = [{ balance: 999 }];
    const v = crossCheckBalanceSum(entries, balances);
    expect(v[0].code).toBe("BALANCE_SUM_MISMATCH");
  });
  it("passes when the difference is within the 0.01 tolerance", () => {
    const entries = [makeValidCharge({ amount: 1000 })];
    const balances = [{ balance: 1000.005 }];
    expect(crossCheckBalanceSum(entries, balances)).toEqual([]);
  });
  it("aggregates multiple balances correctly", () => {
    const entries = [
      makeValidCharge({ amount: 1000, accountId: "acc-1" } as Partial<LedgerEntry>),
      makeValidCharge({ amount: 500, accountId: "acc-2" } as Partial<LedgerEntry>),
    ];
    const balances = [{ balance: 1000 }, { balance: 500 }];
    expect(crossCheckBalanceSum(entries, balances)).toEqual([]);
  });
});
