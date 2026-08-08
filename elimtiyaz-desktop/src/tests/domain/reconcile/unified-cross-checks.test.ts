/**
 * Unit tests for the unified-architecture reconciler cross-checks:
 *   - `crossCheckInstallmentPayments` (UNBACKED_TRANCHE_SATISFACTION)
 *   - `crossCheckClearedBalance` (PAYMENT_LEDGER_MISMATCH)
 *   - `crossCheckParentCredit` (UNBACKED_PARENT_CREDIT)
 *
 * These verify the 3 new invariants added in the unified financial
 * architecture refactor.
 */
import { describe, it, expect } from "vitest";
import {
  crossCheckInstallmentPayments,
  crossCheckClearedBalance,
  crossCheckParentCredit,
} from "../../../domain/calc/reconcile/cross-checks";
import type { LedgerEntry } from "../../../domain/model/ledger";

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: overrides.id ?? "led-1",
    tenantId: overrides.tenantId ?? "tenant-1",
    accountId: overrides.accountId ?? "parent:p1:category:tuition:student:s1",
    parentId: overrides.parentId ?? "p1",
    studentId: overrides.studentId ?? "s1",
    category: overrides.category ?? "tuition",
    amount: overrides.amount ?? 100_000,
    type: overrides.type ?? "charge",
    sourceType: overrides.sourceType ?? "installment",
    sourceId: overrides.sourceId ?? "ins-1",
    method: overrides.method ?? null,
    receiptNumber: overrides.receiptNumber ?? null,
    paymentStatus: overrides.paymentStatus ?? null,
    reversesId: overrides.reversesId ?? null,
    description: overrides.description ?? "test",
    actorId: overrides.actorId ?? "usr-1",
    actorName: overrides.actorName ?? "Test",
    at: overrides.at ?? "2026-09-15T00:00:00.000Z",
    metadata: overrides.metadata ?? Object.freeze({}),
  };
}

describe("crossCheckInstallmentPayments — UNBACKED_TRANCHE_SATISFACTION", () => {
  it("passes when installment.amountPaid is fully backed by cleared payments", () => {
    const installments = [
      {
        id: "ins-1",
        parentId: "p1",
        studentId: "s1",
        category: "tuition",
        amountDue: 100_000,
        amountPaid: 100_000,
        label: "Tranche 1",
        status: "paid",
      },
    ];
    const ledger: LedgerEntry[] = [
      makeLedgerEntry({
        id: "led-1",
        type: "charge",
        amount: 100_000,
        sourceType: "installment",
        sourceId: "ins-1",
      }),
      makeLedgerEntry({
        id: "led-2",
        type: "payment",
        amount: -100_000,
        sourceType: "payment",
        sourceId: "pay-1",
        paymentStatus: "paid",
      }),
    ];
    const violations = crossCheckInstallmentPayments(installments, ledger);
    expect(violations).toHaveLength(0);
  });

  it("emits UNBACKED_TRANCHE_SATISFACTION when tranche is 'paid' but only pending funds exist", () => {
    const installments = [
      {
        id: "ins-1",
        parentId: "p1",
        studentId: "s1",
        category: "tuition",
        amountDue: 100_000,
        amountPaid: 100_000, // marked as paid
        label: "Tranche 1",
        status: "paid",
      },
    ];
    const ledger: LedgerEntry[] = [
      makeLedgerEntry({
        id: "led-1",
        type: "charge",
        amount: 100_000,
        sourceType: "installment",
        sourceId: "ins-1",
      }),
      // Only a PENDING payment — Invariant 4 violation.
      makeLedgerEntry({
        id: "led-2",
        type: "payment",
        amount: -100_000,
        sourceType: "payment",
        sourceId: "pay-1",
        paymentStatus: "pending",
      }),
    ];
    const violations = crossCheckInstallmentPayments(installments, ledger);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("UNBACKED_TRANCHE_SATISFACTION");
    expect(violations[0].severity).toBe("error");
  });

  it("passes when installment.amountPaid is 0 (no backing needed)", () => {
    const installments = [
      {
        id: "ins-1",
        parentId: "p1",
        studentId: "s1",
        category: "tuition",
        amountDue: 100_000,
        amountPaid: 0,
        label: "Tranche 1",
        status: "pending",
      },
    ];
    const ledger: LedgerEntry[] = [
      makeLedgerEntry({ type: "charge", amount: 100_000, sourceId: "ins-1" }),
    ];
    const violations = crossCheckInstallmentPayments(installments, ledger);
    expect(violations).toHaveLength(0);
  });
});

describe("crossCheckClearedBalance — PAYMENT_LEDGER_MISMATCH", () => {
  it("passes when sum of cleared payments equals sum of cleared ledger entries", () => {
    const payments = [
      { id: "pay-1", amount: 100_000, status: "paid" },
      { id: "pay-2", amount: 50_000, status: "paid" },
      { id: "pay-3", amount: 30_000, status: "pending" }, // not counted
    ];
    const ledger: LedgerEntry[] = [
      makeLedgerEntry({
        id: "led-1",
        type: "payment",
        amount: -100_000,
        sourceType: "payment",
        sourceId: "pay-1",
        paymentStatus: "paid",
      }),
      makeLedgerEntry({
        id: "led-2",
        type: "payment",
        amount: -50_000,
        sourceType: "payment",
        sourceId: "pay-2",
        paymentStatus: "paid",
      }),
    ];
    const violations = crossCheckClearedBalance(payments, ledger);
    expect(violations).toHaveLength(0);
  });

  it("emits PAYMENT_LEDGER_MISMATCH when sums disagree", () => {
    const payments = [{ id: "pay-1", amount: 100_000, status: "paid" }];
    const ledger: LedgerEntry[] = [
      makeLedgerEntry({
        id: "led-1",
        type: "payment",
        amount: -90_000, // mismatch!
        sourceType: "payment",
        sourceId: "pay-1",
        paymentStatus: "paid",
      }),
    ];
    const violations = crossCheckClearedBalance(payments, ledger);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("PAYMENT_LEDGER_MISMATCH");
    expect(violations[0].severity).toBe("error");
  });
});

describe("crossCheckParentCredit — UNBACKED_PARENT_CREDIT", () => {
  it("passes when negative balance is backed by a parent_credit adjustment", () => {
    const parentSummaries = [
      {
        parentId: "p1",
        parentName: "Test",
        totalOutstanding: -50_000, // school owes parent
        accounts: [
          {
            accountId: "parent:p1:category:parent_credit",
            category: "parent_credit",
            studentId: null,
            balance: -50_000,
          },
        ],
      },
    ];
    const ledger: LedgerEntry[] = [
      makeLedgerEntry({
        id: "led-1",
        type: "adjustment",
        category: "parent_credit",
        amount: -50_000,
        sourceType: "adjustment",
        sourceId: "adj-1",
        studentId: null,
        accountId: "parent:p1:category:parent_credit",
      }),
    ];
    const violations = crossCheckParentCredit(parentSummaries, ledger);
    expect(violations).toHaveLength(0);
  });

  it("emits UNBACKED_PARENT_CREDIT when negative balance has no parent_credit entry", () => {
    const parentSummaries = [
      {
        parentId: "p1",
        parentName: "Test",
        totalOutstanding: -50_000,
      },
    ];
    const ledger: LedgerEntry[] = []; // no parent_credit entry
    const violations = crossCheckParentCredit(parentSummaries, ledger);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.code === "UNBACKED_PARENT_CREDIT")).toBe(true);
  });

  it("emits UNBACKED_PARENT_CREDIT when a non-parent_credit account has a negative balance", () => {
    const parentSummaries = [
      {
        parentId: "p1",
        parentName: "Test",
        totalOutstanding: -30_000,
        accounts: [
          {
            accountId: "parent:p1:category:tuition:student:s1",
            category: "tuition", // wrong category for a credit
            studentId: "s1",
            balance: -30_000,
          },
        ],
      },
    ];
    const ledger: LedgerEntry[] = [];
    const violations = crossCheckParentCredit(parentSummaries, ledger);
    expect(violations.some((v) => v.code === "UNBACKED_PARENT_CREDIT")).toBe(true);
  });

  it("passes when parent has a positive (or zero) balance", () => {
    const parentSummaries = [
      {
        parentId: "p1",
        parentName: "Test",
        totalOutstanding: 100_000, // parent owes school
      },
    ];
    const ledger: LedgerEntry[] = [];
    const violations = crossCheckParentCredit(parentSummaries, ledger);
    expect(violations).toHaveLength(0);
  });
});
