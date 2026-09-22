/**
 * T-411 (95th session, 2026-09-23) — ADR-023 / BUSINESS-106 / BUSINESS-107
 * regression suite.
 *
 * Pins the three Phase-1 repairs at the engine level:
 *
 * 1. BUSINESS-106 (CRITICAL, engine side): a NULL category filter is the
 *    canonical CROSS-CATEGORY scope — the waterfall allocates across every
 *    category (financial-rules §4), never into a decorative single
 *    category. The desktop contracts (`PaymentLineItem.category`,
 *    `CollectPaymentInput.category`, `Payment.category`) are nullable.
 *
 * 2. BUSINESS-107 (cleared branch, INV-4): the CLEARED-branch capacity is
 *    `due − paid − pending` — a pending cheque on a tranche reduces the
 *    capacity for a subsequent CASH payment, so `paid + pending ≤ due`
 *    can never be violated by the allocator.
 *
 * 3. BUSINESS-107 (clearance overflow): `clearPendingAllocation` caps the
 *    pending→paid move at `due − paid` and reports the excess as
 *    `overflowCredit` (booked as parent_credit by the repositories /
 *    migration 0115) — the excess can no longer silently vanish.
 */
import { describe, it, expect } from "vitest";
import {
  allocatePaymentToInstallments,
} from "../../../domain/calc/payment/waterfall-allocator";
import {
  clearPendingAllocation,
} from "../../../domain/calc/payment/clearance";
import {
  paymentCategoryLabelFr,
  PAYMENT_CATEGORY_LABELS_FR,
  type Installment,
  type PaymentLineItem,
  type CollectPaymentInput,
  type Payment,
} from "../../../domain/model/payment";

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: overrides.parentId ?? "p-1",
    studentId: null,
    category: overrides.category ?? "tuition",
    label: overrides.label ?? "Tranche 1",
    amountDue: overrides.amountDue ?? 100_000,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2025-09-15",
    paidDate: overrides.paidDate ?? null,
    status: overrides.status ?? "pending",
  };
}

describe("T-411 / ADR-023 — cross-category collection (BUSINESS-106, engine side)", () => {
  it("a NULL category filter allocates across EVERY category (tuition + transport)", () => {
    const installments = [
      makeInstallment({ id: "t1", category: "tuition", amountDue: 80_000, dueDate: "2025-09-15" }),
      makeInstallment({ id: "x1", category: "transport", amountDue: 20_000, dueDate: "2025-09-10" }),
    ];
    // The transport tranche is older — the cross-category waterfall must
    // reach it, which a "tuition"/"other" filter never could.
    const result = allocatePaymentToInstallments(installments, 100_000, null);
    expect(result.unallocatedAmount).toBe(0);
    const byId = new Map(result.allocations.map((a) => [a.installmentId, a.allocatedAmount]));
    expect(byId.get("x1")).toBe(20_000);
    expect(byId.get("t1")).toBe(80_000);
  });

  it("a cross-category overpayment books the excess as unallocated (parent_credit path)", () => {
    const installments = [
      makeInstallment({ id: "t1", category: "tuition", amountDue: 50_000 }),
      makeInstallment({ id: "x1", category: "transport", amountDue: 10_000 }),
    ];
    const result = allocatePaymentToInstallments(installments, 70_000, null);
    expect(result.totalAllocated).toBe(60_000);
    expect(result.unallocatedAmount).toBe(10_000);
  });

  it("a concrete category filter still restricts allocation (T-060 semantics preserved)", () => {
    const installments = [
      makeInstallment({ id: "t1", category: "tuition", amountDue: 80_000 }),
      makeInstallment({ id: "x1", category: "transport", amountDue: 20_000 }),
    ];
    const result = allocatePaymentToInstallments(installments, 100_000, "tuition");
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].installmentId).toBe("t1");
    expect(result.unallocatedAmount).toBe(20_000);
  });

  it("the consolidated-debt line-item contract carries category: null (type-level pin)", () => {
    // The exact shape the four consolidated entry points construct
    // (Créances, Suivi des Dettes, CRM drawer, Diagnostic console).
    const lineItem: PaymentLineItem = {
      itemId: "debt-p-1",
      category: null,
      label: "Solde familial consolidé (toutes catégories)",
      grossAmount: 90_000,
      discountAmount: 0,
      netAmount: 90_000,
      alreadyPaidAmount: 0,
      remainingAmount: 90_000,
    };
    expect(lineItem.category).toBeNull();

    const input: CollectPaymentInput = {
      parentId: "p-1",
      studentId: null,
      amount: 90_000,
      method: "cash",
      category: null,
      installmentId: null,
    };
    expect(input.category).toBeNull();
  });

  it("paymentCategoryLabelFr renders null as Multi-services and concrete categories verbatim", () => {
    expect(paymentCategoryLabelFr(null)).toBe("Multi-services");
    expect(paymentCategoryLabelFr(undefined)).toBe("Multi-services");
    expect(paymentCategoryLabelFr("tuition")).toBe(PAYMENT_CATEGORY_LABELS_FR.tuition);
    expect(paymentCategoryLabelFr("transport")).toBe(PAYMENT_CATEGORY_LABELS_FR.transport);
  });

  it("a multi-service Payment row is representable (read-model parity with the nullable column)", () => {
    const payment = {
      id: "pay-1",
      category: null,
      method: "cash",
    } as unknown as Payment;
    expect(payment.category).toBeNull();
    expect(paymentCategoryLabelFr(payment.category)).toBe("Multi-services");
  });
});

describe("T-411 / BUSINESS-107 — cleared-branch INV-4 capacity (due − paid − pending)", () => {
  it("a pending cheque reduces the capacity for a subsequent CASH payment", () => {
    // The audit's FA-03 chain: cheque 50k pending on a 100k tranche, then
    // cash 100k arrives. Pre-fix: capacity 100k → paid=100k + pending=50k
    // (over-allocated). Post-fix: capacity 50k → the other 50k overflows
    // to unallocated (parent_credit), and the tranche is never over-booked.
    const ins = makeInstallment({ amountDue: 100_000, amountPaid: 0, amountPending: 50_000 });
    const result = allocatePaymentToInstallments([ins], 100_000, "tuition", "paid");
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].allocatedAmount).toBe(50_000);
    expect(result.allocations[0].newAmountPaid).toBe(50_000);
    expect(result.allocations[0].newAmountPending).toBe(50_000);
    // paid + pending === due — the invariant the old cleared branch broke.
    expect(
      result.allocations[0].newAmountPaid + result.allocations[0].newAmountPending,
    ).toBe(ins.amountDue);
    // The un-collected half becomes credit, never a phantom allocation.
    expect(result.unallocatedAmount).toBe(50_000);
  });

  it("a fully-pending-covered tranche is skipped by a later cleared payment", () => {
    const ins = makeInstallment({ amountDue: 100_000, amountPaid: 0, amountPending: 100_000 });
    const result = allocatePaymentToInstallments([ins], 40_000, "tuition", "paid");
    expect(result.allocations).toHaveLength(0);
    expect(result.unallocatedAmount).toBe(40_000);
  });

  it("an untouched tranche keeps the classic due − paid cleared capacity", () => {
    const ins = makeInstallment({ amountDue: 100_000, amountPaid: 30_000, amountPending: 0 });
    const result = allocatePaymentToInstallments([ins], 100_000, "tuition", "paid");
    expect(result.allocations[0].allocatedAmount).toBe(70_000);
    expect(result.allocations[0].newStatus).toBe("paid");
  });

  it("the pending branch still subtracts pending (A-0042 regression guard)", () => {
    const ins = makeInstallment({ amountDue: 100_000, amountPaid: 0, amountPending: 40_000 });
    const result = allocatePaymentToInstallments([ins], 80_000, "tuition", "pending");
    expect(result.allocations[0].allocatedAmount).toBe(60_000);
    expect(result.allocations[0].newAmountPending).toBe(100_000);
  });
});

describe("T-411 / BUSINESS-107 — clearance overflow guard (mark_payment_cleared parity)", () => {
  it("caps the pending→paid move at due − paid and reports the overflow", () => {
    // Legacy over-allocated shape (the pre-0115 bug's residue): a 100k
    // tranche with paid=80k and pending=40k (paid + pending > due). A
    // 40k cheque clears: only 20k can move; the other 20k MUST surface as
    // overflowCredit (booked parent_credit) instead of vanishing.
    const ins = makeInstallment({
      amountDue: 100_000,
      amountPaid: 80_000,
      amountPending: 40_000,
      status: "pending_clearance",
    });
    const result = clearPendingAllocation([ins], 40_000, "tuition", new Date("2025-10-01"));
    expect(result.clears).toHaveLength(1);
    expect(result.clears[0].clearedAmount).toBe(20_000);
    expect(result.clears[0].newAmountPaid).toBe(100_000);
    expect(result.clears[0].newAmountPending).toBe(20_000);
    expect(result.overflowCredit).toBe(20_000);
    expect(result.totalCleared).toBe(20_000);
  });

  it("a healthy clearance moves the full pending amount with zero overflow", () => {
    const ins = makeInstallment({
      amountDue: 100_000,
      amountPaid: 0,
      amountPending: 50_000,
      status: "pending_clearance",
    });
    const result = clearPendingAllocation([ins], 50_000, "tuition", new Date("2025-10-01"));
    expect(result.clears[0].clearedAmount).toBe(50_000);
    expect(result.clears[0].newAmountPaid).toBe(50_000);
    expect(result.clears[0].newStatus).toBe("partial");
    expect(result.overflowCredit).toBe(0);
  });

  it("a NULL category filter clears across categories (ADR-023 parity)", () => {
    const installments = [
      makeInstallment({
        id: "t1",
        category: "tuition",
        amountDue: 80_000,
        amountPaid: 30_000,
        amountPending: 50_000,
        status: "pending_clearance",
      }),
      makeInstallment({
        id: "x1",
        category: "transport",
        amountDue: 20_000,
        amountPaid: 0,
        amountPending: 20_000,
        status: "pending_clearance",
      }),
    ];
    const result = clearPendingAllocation(installments, 70_000, null, new Date("2025-10-01"));
    expect(result.totalCleared).toBe(70_000);
    expect(result.overflowCredit).toBe(0);
    const byId = new Map(result.clears.map((c) => [c.installmentId, c.clearedAmount]));
    expect(byId.get("t1")).toBe(50_000);
    expect(byId.get("x1")).toBe(20_000);
  });
});
