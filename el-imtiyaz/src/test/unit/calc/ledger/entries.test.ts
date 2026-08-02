/**
 * Characterization tests for `calc/ledger/entries.ts`.
 *
 * Verifies that each entry factory enforces its invariant and produces
 * an immutable `LedgerEntry` with the correct signed amount and
 * derived accountId. Behavior preserved verbatim from pre-refactor.
 */
import { describe, it, expect } from "vitest";
import {
  createChargeEntry,
  createPaymentEntry,
  createAdjustmentEntry,
  createRefundEntry,
  createReversalEntry,
} from "@/domain/calc/ledger/entries";
import { deriveAccountId } from "@/domain/calc/ledger/account-id";
import type { LedgerEntry } from "@/domain/model/ledger";

const TENANT = "tenant-1";

function makeCharge(amount = 1000): LedgerEntry {
  return createChargeEntry({
    tenantId: TENANT, parentId: "p1", studentId: "s1", category: "tuition",
    amount, sourceType: "installment", sourceId: "src-1",
    description: "Test charge", actorId: "a1", actorName: "Actor",
  });
}

describe("calc/ledger/entries — createChargeEntry", () => {
  it("creates a charge with positive signed amount", () => {
    const e = makeCharge(1500);
    expect(e.amount).toBe(1500);
    expect(e.type).toBe("charge");
    expect(e.method).toBeNull();
    expect(e.receiptNumber).toBeNull();
    expect(e.paymentStatus).toBeNull();
    expect(e.reversesId).toBeNull();
  });
  it("derives the accountId from parent + category + student", () => {
    const e = makeCharge();
    expect(e.accountId).toBe(deriveAccountId("p1", "tuition", "s1"));
  });
  it("preserves tenantId, parentId, studentId, category, sourceType, sourceId", () => {
    const e = makeCharge();
    expect(e.tenantId).toBe(TENANT);
    expect(e.parentId).toBe("p1");
    expect(e.studentId).toBe("s1");
    expect(e.category).toBe("tuition");
    expect(e.sourceType).toBe("installment");
    expect(e.sourceId).toBe("src-1");
  });
  it("freezes the metadata object", () => {
    const e = createChargeEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 100, sourceType: "installment", sourceId: "src",
      description: "Test", actorId: "a1", actorName: "A",
      metadata: { foo: "bar" },
    });
    expect(Object.isFrozen(e.metadata)).toBe(true);
  });
  it("uses an empty frozen object when no metadata is provided", () => {
    const e = makeCharge();
    expect(Object.isFrozen(e.metadata)).toBe(true);
    expect(Object.keys(e.metadata)).toHaveLength(0);
  });
  it("rejects zero or negative amount", () => {
    expect(() => makeCharge(0)).toThrow("Charge amount must be positive");
    expect(() => makeCharge(-100)).toThrow("Charge amount must be positive");
  });
  it("rejects empty description", () => {
    expect(() =>
      createChargeEntry({
        tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
        amount: 100, sourceType: "installment", sourceId: "src",
        description: "   ", actorId: "a1", actorName: "A",
      }),
    ).toThrow("Charge description is required");
  });
  it("uses the provided `at` timestamp when given", () => {
    const at = "2025-01-01T00:00:00.000Z";
    const e = createChargeEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 100, sourceType: "installment", sourceId: "src",
      description: "Test", actorId: "a1", actorName: "A", at,
    });
    expect(e.at).toBe(at);
  });
  it("generates an ID starting with 'led-'", () => {
    const e = makeCharge();
    expect(e.id.startsWith("led-")).toBe(true);
  });
});

describe("calc/ledger/entries — createPaymentEntry", () => {
  it("creates a payment with NEGATIVE signed amount (credit)", () => {
    const e = createPaymentEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 500, method: "cash", receiptNumber: "REC-001", paymentStatus: "paid",
      sourceType: "payment", sourceId: "pay-1",
      description: "Payment", actorId: "a1", actorName: "A",
    });
    expect(e.amount).toBe(-500);
    expect(e.type).toBe("payment");
    expect(e.method).toBe("cash");
    expect(e.receiptNumber).toBe("REC-001");
    expect(e.paymentStatus).toBe("paid");
  });
  it("rejects zero or negative amount input", () => {
    expect(() =>
      createPaymentEntry({
        tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
        amount: 0, method: "cash", receiptNumber: "REC", paymentStatus: "paid",
        sourceType: "payment", sourceId: "pay",
        description: "P", actorId: "a", actorName: "A",
      }),
    ).toThrow("Payment amount must be positive");
  });
  it("rejects empty description", () => {
    expect(() =>
      createPaymentEntry({
        tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
        amount: 100, method: "cash", receiptNumber: "REC", paymentStatus: "paid",
        sourceType: "payment", sourceId: "pay",
        description: "", actorId: "a", actorName: "A",
      }),
    ).toThrow("Payment description is required");
  });
});

describe("calc/ledger/entries — createAdjustmentEntry", () => {
  it("creates a positive adjustment (penalty) with signed amount", () => {
    const e = createAdjustmentEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 200, reason: "Late penalty", sourceType: "adjustment", sourceId: "adj-1",
      actorId: "a1", actorName: "A",
    });
    expect(e.amount).toBe(200);
    expect(e.type).toBe("adjustment");
    expect(e.description).toBe("Late penalty");
  });
  it("creates a negative adjustment (discount) with signed amount", () => {
    const e = createAdjustmentEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: -100, reason: "Sibling discount", sourceType: "adjustment", sourceId: "adj-2",
      actorId: "a1", actorName: "A",
    });
    expect(e.amount).toBe(-100);
  });
  it("rejects zero amount", () => {
    expect(() =>
      createAdjustmentEntry({
        tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
        amount: 0, reason: "Zero", sourceType: "adjustment", sourceId: "adj",
        actorId: "a", actorName: "A",
      }),
    ).toThrow("Adjustment amount cannot be zero");
  });
  it("rejects empty reason", () => {
    expect(() =>
      createAdjustmentEntry({
        tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
        amount: 100, reason: "  ", sourceType: "adjustment", sourceId: "adj",
        actorId: "a", actorName: "A",
      }),
    ).toThrow("Adjustment reason is required");
  });
});

describe("calc/ledger/entries — createRefundEntry", () => {
  it("creates a refund with NEGATIVE signed amount", () => {
    const e = createRefundEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 300, sourceId: "ref-1", description: "Refund",
      actorId: "a1", actorName: "A",
    });
    expect(e.amount).toBe(-300);
    expect(e.type).toBe("refund");
    expect(e.sourceType).toBe("refund");
    expect(e.method).toBeNull();
  });
  it("rejects zero or negative amount input", () => {
    expect(() =>
      createRefundEntry({
        tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
        amount: -50, sourceId: "ref", description: "R",
        actorId: "a", actorName: "A",
      }),
    ).toThrow("Refund amount must be positive");
  });
});

describe("calc/ledger/entries — createReversalEntry", () => {
  it("creates a reversal that negates the original's amount", () => {
    const original = makeCharge(1000);
    const reversal = createReversalEntry(original, {
      reason: "Correction", actorId: "a1", actorName: "A",
    });
    expect(reversal.amount).toBe(-1000);
    expect(reversal.type).toBe("reversal");
    expect(reversal.reversesId).toBe(original.id);
    expect(reversal.accountId).toBe(original.accountId);
    expect(reversal.parentId).toBe(original.parentId);
    expect(reversal.studentId).toBe(original.studentId);
    expect(reversal.category).toBe(original.category);
    expect(reversal.description).toContain("REVERSAL of");
    expect(reversal.description).toContain(original.id);
    expect(reversal.description).toContain("Correction");
  });
  it("preserves the original's method, receiptNumber, paymentStatus, sourceType, sourceId", () => {
    const original = createPaymentEntry({
      tenantId: TENANT, parentId: "p1", studentId: null, category: "tuition",
      amount: 500, method: "check", receiptNumber: "REC-9", paymentStatus: "pending",
      sourceType: "payment", sourceId: "pay-9",
      description: "P", actorId: "a", actorName: "A",
    });
    const reversal = createReversalEntry(original, {
      reason: "NSF", actorId: "a", actorName: "A",
    });
    expect(reversal.method).toBe("check");
    expect(reversal.receiptNumber).toBe("REC-9");
    expect(reversal.paymentStatus).toBe("pending");
    expect(reversal.sourceType).toBe("payment");
    expect(reversal.sourceId).toBe("pay-9");
  });
  it("stores reversedEntryId + reason in frozen metadata", () => {
    const original = makeCharge();
    const reversal = createReversalEntry(original, {
      reason: "Test", actorId: "a", actorName: "A",
    });
    expect(Object.isFrozen(reversal.metadata)).toBe(true);
    expect(reversal.metadata.reversedEntryId).toBe(original.id);
    expect(reversal.metadata.reason).toBe("Test");
  });
  it("rejects empty reason", () => {
    const original = makeCharge();
    expect(() =>
      createReversalEntry(original, { reason: "", actorId: "a", actorName: "A" }),
    ).toThrow("Reversal reason is required");
  });
});
