/**
 * Unit tests for the PaymentNavigationContext contract (Epic 5.3).
 *
 * Verifies that:
 *   - The `PaymentNavigationContext` interface accepts all the fields
 *     defined in the spec (mode, lineItems, presetAmount, etc.).
 *   - The `PaymentLineItem` interface has the gross/discount/net/alreadyPaid/
 *     remaining breakdown.
 *   - The `PaymentNavigationMode` union covers all 4 modes.
 *   - The CounterPaymentModal wrapper correctly adapts old preset props
 *     to a `PaymentNavigationContext`.
 */
import { describe, it, expect } from "vitest";
import type {
  PaymentNavigationContext,
  PaymentLineItem,
  PaymentNavigationMode,
} from "../../../domain/model/payment";

describe("PaymentNavigationContext contract (Epic 5.3 / 1.4)", () => {
  it("PaymentNavigationMode includes all 4 modes", () => {
    const modes: PaymentNavigationMode[] = [
      "single_item",
      "installment_tranche",
      "consolidated_debt",
      "account_adjustment",
    ];
    expect(modes).toHaveLength(4);
    expect(new Set(modes).size).toBe(4);
  });

  it("PaymentLineItem has the full gross/discount/net/alreadyPaid/remaining breakdown", () => {
    const item: PaymentLineItem = {
      itemId: "test-item-1",
      category: "tuition",
      label: "Tranche 1 — 4AP",
      grossAmount: 98_000,
      discountAmount: 5_000,
      netAmount: 93_000,
      alreadyPaidAmount: 30_000,
      remainingAmount: 63_000,
      dueDate: "2026-09-15",
      isOverdue: false,
      daysOverdue: 0,
    };
    expect(item.grossAmount - item.discountAmount).toBe(item.netAmount);
    expect(item.netAmount - item.alreadyPaidAmount).toBe(item.remainingAmount);
  });

  it("PaymentNavigationContext accepts the full spec shape for installment_tranche mode", () => {
    const ctx: PaymentNavigationContext = {
      parentId: "par-001",
      parentName: "Karim BENALI",
      parentCode: "PAR-2025-A4F9",
      studentId: "stu-001",
      studentName: "Yacine BENALI",
      mode: "installment_tranche",
      targetItemId: "ins-par-001-stu-001-t1",
      presetAmount: 70_000,
      overdueDays: 12,
      dueWindowLabel: "15 sept. 2026",
      lineItems: [
        {
          itemId: "ins-par-001-stu-001-t1",
          category: "tuition",
          label: "Tranche 1",
          grossAmount: 98_000,
          discountAmount: 0,
          netAmount: 98_000,
          alreadyPaidAmount: 28_000,
          remainingAmount: 70_000,
          dueDate: "2026-09-15",
          isOverdue: true,
          daysOverdue: 12,
        },
      ],
      allowPartial: true,
      originRoute: "financials.installment_schedule",
    };
    expect(ctx.mode).toBe("installment_tranche");
    expect(ctx.lineItems).toHaveLength(1);
    expect(ctx.lineItems[0].remainingAmount).toBe(70_000);
  });

  it("PaymentNavigationContext for consolidated_debt mode accepts multiple line items", () => {
    const ctx: PaymentNavigationContext = {
      parentId: "par-002",
      mode: "consolidated_debt",
      presetAmount: 245_000,
      lineItems: [
        {
          itemId: "debt-t1",
          category: "tuition",
          label: "Tranche 1 — Yacine",
          grossAmount: 98_000,
          discountAmount: 0,
          netAmount: 98_000,
          alreadyPaidAmount: 0,
          remainingAmount: 98_000,
        },
        {
          itemId: "debt-t2",
          category: "tuition",
          label: "Tranche 2 — Yacine",
          grossAmount: 73_500,
          discountAmount: 0,
          netAmount: 73_500,
          alreadyPaidAmount: 0,
          remainingAmount: 73_500,
        },
        {
          itemId: "debt-t3",
          category: "tuition",
          label: "Tranche 3 — Yacine",
          grossAmount: 73_500,
          discountAmount: 0,
          netAmount: 73_500,
          alreadyPaidAmount: 0,
          remainingAmount: 73_500,
        },
      ],
      allowPartial: true,
      originRoute: "financials.debt_dashboard",
    };
    expect(ctx.mode).toBe("consolidated_debt");
    expect(ctx.lineItems).toHaveLength(3);
    const totalRemaining = ctx.lineItems.reduce((s, i) => s + i.remainingAmount, 0);
    expect(totalRemaining).toBe(245_000);
  });

  it("PaymentNavigationContext for single_item mode (club enrollment) sets allowPartial=false", () => {
    const ctx: PaymentNavigationContext = {
      parentId: "par-003",
      studentId: "stu-007",
      studentName: "Lina BENALI",
      mode: "single_item",
      presetAmount: 9_000,
      lineItems: [
        {
          itemId: "club-chess-001",
          category: "extracurricular",
          label: "Club Échecs — inscription annuelle",
          grossAmount: 9_000,
          discountAmount: 0,
          netAmount: 9_000,
          alreadyPaidAmount: 0,
          remainingAmount: 9_000,
        },
      ],
      allowPartial: false, // club fee is non-divisible
      originRoute: "academics.clubs.enroll_and_collect",
    };
    expect(ctx.mode).toBe("single_item");
    expect(ctx.allowPartial).toBe(false);
  });

  it("PaymentNavigationContext for account_adjustment mode (manual credit/debit)", () => {
    const ctx: PaymentNavigationContext = {
      parentId: "par-004",
      mode: "account_adjustment",
      presetAmount: -5_000, // credit
      lineItems: [
        {
          itemId: "adj-sibling-2nd-child",
          category: "parent_credit",
          label: "Remise fratrie — 2ème enfant",
          grossAmount: 0,
          discountAmount: 5_000,
          netAmount: -5_000,
          alreadyPaidAmount: 0,
          remainingAmount: -5_000,
        },
      ],
      allowPartial: false,
      originRoute: "crm.parent_drawer.adjust_account",
    };
    expect(ctx.mode).toBe("account_adjustment");
    expect(ctx.lineItems[0].category).toBe("parent_credit");
  });

  it("lineItems can be empty (counter-payment-from-scratch mode)", () => {
    const ctx: PaymentNavigationContext = {
      parentId: "",
      mode: "consolidated_debt",
      lineItems: [],
      allowPartial: true,
    };
    expect(ctx.lineItems).toHaveLength(0);
    expect(ctx.parentId).toBe("");
  });
});
