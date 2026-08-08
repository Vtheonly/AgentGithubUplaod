/**
 * Unit tests for the Waterfall Allocation Engine.
 *
 * Verifies that `allocatePaymentToInstallments()`:
 *   - Distributes a payment across multiple installments oldest-first.
 *   - Handles partial payments (installment becomes "partial").
 *   - Handles overpayments (excess becomes unallocatedAmount).
 *   - Handles exact-fit payments (installment becomes "paid").
 *   - Respects the category filter.
 *   - Skips already-paid installments.
 *   - Returns an empty allocation when amount <= 0.
 *   - Maintains the invariant:
 *       sum(allocatedAmount) + unallocatedAmount === paymentAmount
 */
import { describe, it, expect } from "vitest";
import {
  allocatePaymentToInstallments,
  currentTrancheLabel,
  isOverpayment,
  revertPaymentAllocation,
  reevaluateInstallmentStatus,
} from "../../../domain/calc/payment/installments";
import type { Installment } from "../../../domain/model/payment";

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: "p-1",
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

describe("Waterfall Allocation Engine — allocatePaymentToInstallments", () => {
  it("returns an empty allocation when paymentAmount <= 0", () => {
    const installments = [makeInstallment()];
    const result = allocatePaymentToInstallments(installments, 0);
    expect(result.allocations).toHaveLength(0);
    expect(result.unallocatedAmount).toBe(0);
    expect(result.totalAllocated).toBe(0);
  });

  it("fully satisfies a single installment with an exact-fit payment", () => {
    const installments = [makeInstallment({ amountDue: 100_000, amountPaid: 0 })];
    const result = allocatePaymentToInstallments(installments, 100_000);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].allocatedAmount).toBe(100_000);
    expect(result.allocations[0].newAmountPaid).toBe(100_000);
    expect(result.allocations[0].newStatus).toBe("paid");
    expect(result.allocations[0].fullySatisfied).toBe(true);
    expect(result.unallocatedAmount).toBe(0);
    expect(result.totalAllocated).toBe(100_000);
  });

  it("handles a partial payment — installment becomes 'partial'", () => {
    const installments = [makeInstallment({ amountDue: 100_000, amountPaid: 0 })];
    const result = allocatePaymentToInstallments(installments, 30_000);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].allocatedAmount).toBe(30_000);
    expect(result.allocations[0].newAmountPaid).toBe(30_000);
    expect(result.allocations[0].newStatus).toBe("partial");
    expect(result.allocations[0].fullySatisfied).toBe(false);
    expect(result.unallocatedAmount).toBe(0);
  });

  it("flows excess to the next installment (waterfall)", () => {
    const installments = [
      makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 0, dueDate: "2025-09-15" }),
      makeInstallment({ id: "t2", label: "Tranche 2", amountDue: 80_000, amountPaid: 0, dueDate: "2025-12-15" }),
    ];
    const result = allocatePaymentToInstallments(installments, 150_000);
    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0].installmentId).toBe("t1");
    expect(result.allocations[0].allocatedAmount).toBe(100_000);
    expect(result.allocations[0].newStatus).toBe("paid");
    expect(result.allocations[1].installmentId).toBe("t2");
    expect(result.allocations[1].allocatedAmount).toBe(50_000);
    expect(result.allocations[1].newStatus).toBe("partial");
    expect(result.unallocatedAmount).toBe(0);
    expect(result.totalAllocated).toBe(150_000);
  });

  it("returns overpayment as unallocatedAmount (parent credit)", () => {
    const installments = [
      makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 0 }),
    ];
    const result = allocatePaymentToInstallments(installments, 150_000);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].allocatedAmount).toBe(100_000);
    expect(result.unallocatedAmount).toBe(50_000);
    expect(result.totalAllocated).toBe(100_000);
  });

  it("respects the category filter", () => {
    const installments = [
      makeInstallment({ id: "tu-1", category: "tuition", amountDue: 100_000, amountPaid: 0 }),
      makeInstallment({ id: "tr-1", category: "transport", amountDue: 30_000, amountPaid: 0 }),
    ];
    const result = allocatePaymentToInstallments(installments, 100_000, "tuition");
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].installmentId).toBe("tu-1");
  });

  it("skips already-paid installments", () => {
    const installments = [
      makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 100_000, status: "paid" }),
      makeInstallment({ id: "t2", label: "Tranche 2", amountDue: 80_000, amountPaid: 0, dueDate: "2025-12-15" }),
    ];
    const result = allocatePaymentToInstallments(installments, 80_000);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].installmentId).toBe("t2");
    expect(result.allocations[0].newStatus).toBe("paid");
  });

  it("respects chronological order (oldest due date first)", () => {
    // Tranche 2 has an earlier due date than Tranche 1 — should be satisfied first.
    const installments = [
      makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 0, dueDate: "2025-12-15" }),
      makeInstallment({ id: "t2", label: "Tranche 2", amountDue: 80_000, amountPaid: 0, dueDate: "2025-09-15" }),
    ];
    const result = allocatePaymentToInstallments(installments, 80_000);
    expect(result.allocations[0].installmentId).toBe("t2");
    expect(result.allocations[0].allocatedAmount).toBe(80_000);
    expect(result.allocations[0].newStatus).toBe("paid");
  });

  it("maintains the invariant: sum(allocated) + unallocated === paymentAmount", () => {
    const installments = [
      makeInstallment({ id: "t1", amountDue: 60_000, amountPaid: 0, dueDate: "2025-09-15" }),
      makeInstallment({ id: "t2", label: "Tranche 2", amountDue: 40_000, amountPaid: 5_000, dueDate: "2025-12-15" }),
      makeInstallment({ id: "t3", label: "Tranche 3", amountDue: 50_000, amountPaid: 0, dueDate: "2026-03-15" }),
    ];
    const payment = 75_000;
    const result = allocatePaymentToInstallments(installments, payment);
    const sumAllocated = result.allocations.reduce((s, a) => s + a.allocatedAmount, 0);
    expect(sumAllocated + result.unallocatedAmount).toBe(payment);
  });

  it("respects a partial pre-payment on the oldest tranche", () => {
    const installments = [
      makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 30_000, dueDate: "2025-09-15" }),
    ];
    const result = allocatePaymentToInstallments(installments, 70_000);
    expect(result.allocations[0].allocatedAmount).toBe(70_000);
    expect(result.allocations[0].newAmountPaid).toBe(100_000);
    expect(result.allocations[0].newStatus).toBe("paid");
  });
});

describe("Waterfall Allocation Engine — currentTrancheLabel", () => {
  it("returns the label of the oldest unpaid installment", () => {
    const installments = [
      makeInstallment({ id: "t1", label: "Tranche 1", amountDue: 100_000, amountPaid: 100_000, status: "paid" }),
      makeInstallment({ id: "t2", label: "Tranche 2", amountDue: 80_000, amountPaid: 0, dueDate: "2025-12-15" }),
    ];
    expect(currentTrancheLabel(installments)).toBe("Tranche 2");
  });

  it("returns null when all installments are paid", () => {
    const installments = [
      makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 100_000, status: "paid" }),
    ];
    expect(currentTrancheLabel(installments)).toBeNull();
  });
});

describe("Waterfall Allocation Engine — isOverpayment", () => {
  it("returns true when payment exceeds total remaining", () => {
    const installments = [
      makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 0 }),
    ];
    expect(isOverpayment(installments, 150_000)).toBe(true);
  });

  it("returns false when payment fits within remaining balance", () => {
    const installments = [
      makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 0 }),
    ];
    expect(isOverpayment(installments, 100_000)).toBe(false);
    expect(isOverpayment(installments, 50_000)).toBe(false);
  });
});

describe("Waterfall Allocation Engine — pending vs cleared (Invariant 4)", () => {
  it("marks tranche as 'paid' for a CLEARED cash payment", () => {
    const installments = [makeInstallment({ amountDue: 100_000, amountPaid: 0 })];
    const result = allocatePaymentToInstallments(installments, 100_000, "tuition", "paid");
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].newStatus).toBe("paid");
    expect(result.allocations[0].newAmountPaid).toBe(100_000);
    expect(result.allocations[0].newAmountPending).toBe(0);
    expect(result.allocations[0].cleared).toBe(true);
    expect(result.allocations[0].fullySatisfied).toBe(true);
  });

  it("does NOT mark tranche as 'paid' for an UNCLEARED check (pending)", () => {
    const installments = [makeInstallment({ amountDue: 100_000, amountPaid: 0 })];
    const result = allocatePaymentToInstallments(installments, 100_000, "tuition", "pending");
    expect(result.allocations).toHaveLength(1);
    // Critical Invariant 4 assertion: pending funds NEVER mark a tranche as "paid".
    expect(result.allocations[0].newStatus).toBe("pending_clearance");
    expect(result.allocations[0].newAmountPaid).toBe(0); // amountPaid unchanged
    expect(result.allocations[0].newAmountPending).toBe(100_000); // funds land in amountPending
    expect(result.allocations[0].cleared).toBe(false);
    expect(result.allocations[0].fullySatisfied).toBe(false);
  });

  it("still conserves the total: sum(allocated) + unallocated === paymentAmount for pending", () => {
    const installments = [
      makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 0, dueDate: "2026-09-15" }),
      makeInstallment({ id: "t2", amountDue: 50_000, amountPaid: 0, dueDate: "2026-12-15" }),
    ];
    const result = allocatePaymentToInstallments(installments, 120_000, "tuition", "pending");
    const totalAlloc = result.allocations.reduce((s, a) => s + a.allocatedAmount, 0);
    expect(totalAlloc + result.unallocatedAmount).toBe(120_000);
  });

  it("defaults to 'paid' status when paymentStatus is omitted (backward compat)", () => {
    const installments = [makeInstallment({ amountDue: 100_000, amountPaid: 0 })];
    const result = allocatePaymentToInstallments(installments, 100_000);
    expect(result.allocations[0].cleared).toBe(true);
    expect(result.allocations[0].newStatus).toBe("paid");
  });
});

describe("Reverse-Waterfall Allocation (LIFO) — revertPaymentAllocation", () => {
  it("reverts the newest satisfied tranche first (LIFO)", () => {
    const installments = [
      {
        ...makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 100_000, status: "paid" as const, dueDate: "2026-09-15" }),
      },
      {
        ...makeInstallment({ id: "t2", amountDue: 100_000, amountPaid: 100_000, status: "paid" as const, dueDate: "2026-12-15" }),
      },
      {
        ...makeInstallment({ id: "t3", amountDue: 100_000, amountPaid: 100_000, status: "paid" as const, dueDate: "2027-03-15" }),
      },
    ];
    // Reverse 50,000 — should come out of t3 (newest) first.
    const result = revertPaymentAllocation(installments, 50_000);
    expect(result.reverts).toHaveLength(1);
    expect(result.reverts[0].installmentId).toBe("t3");
    expect(result.reverts[0].revertedAmount).toBe(50_000);
    expect(result.reverts[0].newAmountPaid).toBe(50_000);
    expect(result.reverts[0].newStatus).toBe("partial");
    expect(result.reverts[0].reopened).toBe(true);
    expect(result.totalReverted).toBe(50_000);
  });

  it("reverts across multiple tranches in LIFO order when reversal exceeds one tranche", () => {
    const installments = [
      {
        ...makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 100_000, status: "paid" as const, dueDate: "2026-09-15" }),
      },
      {
        ...makeInstallment({ id: "t2", amountDue: 100_000, amountPaid: 100_000, status: "paid" as const, dueDate: "2026-12-15" }),
      },
      {
        ...makeInstallment({ id: "t3", amountDue: 100_000, amountPaid: 100_000, status: "paid" as const, dueDate: "2027-03-15" }),
      },
    ];
    // Reverse 150,000 — should fully drain t3 (100k) + partially drain t2 (50k).
    const result = revertPaymentAllocation(installments, 150_000);
    expect(result.reverts).toHaveLength(2);
    expect(result.reverts[0].installmentId).toBe("t3");
    expect(result.reverts[0].revertedAmount).toBe(100_000);
    expect(result.reverts[0].newAmountPaid).toBe(0);
    // Now (2026-08-08) is BEFORE 2027-03-15, so the tranche should be "pending", not "overdue".
    expect(result.reverts[0].newStatus).toBe("pending");
    expect(result.reverts[1].installmentId).toBe("t2");
    expect(result.reverts[1].revertedAmount).toBe(50_000);
    expect(result.reverts[1].newAmountPaid).toBe(50_000);
    expect(result.reverts[1].newStatus).toBe("partial");
    expect(result.totalReverted).toBe(150_000);
  });

  it("conserves the reversal amount exactly: sum(reverted) === min(reversal, totalRevertible)", () => {
    const installments = [
      {
        ...makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 30_000, status: "partial" as const, dueDate: "2026-09-15" }),
      },
    ];
    // Revert 50,000 — only 30,000 is revertible.
    const result = revertPaymentAllocation(installments, 50_000);
    expect(result.totalReverted).toBe(30_000);
    expect(result.unrevertedAmount).toBe(20_000);
  });

  it("reverts from amountPending when originalWasPending is true (bounced check)", () => {
    const installments = [
      {
        ...makeInstallment({ id: "t1", amountDue: 100_000, amountPaid: 0, amountPending: 100_000, status: "pending_clearance" as const, dueDate: "2026-09-15" }),
      },
    ];
    const result = revertPaymentAllocation(installments, 100_000, undefined, true);
    expect(result.reverts).toHaveLength(1);
    expect(result.reverts[0].newAmountPending).toBe(0);
    expect(result.reverts[0].newAmountPaid).toBe(0); // unchanged
    expect(result.totalReverted).toBe(100_000);
  });

  it("returns an empty result when reversalAmount <= 0", () => {
    const installments = [makeInstallment({ amountDue: 100_000, amountPaid: 50_000 })];
    const result = revertPaymentAllocation(installments, 0);
    expect(result.reverts).toHaveLength(0);
    expect(result.totalReverted).toBe(0);
  });

  it("reevaluateInstallmentStatus correctly classifies paid/partial/overdue/pending", () => {
    const past = "2025-01-01";
    const future = "2027-12-31";
    expect(reevaluateInstallmentStatus(100, 100, future)).toBe("paid");
    expect(reevaluateInstallmentStatus(50, 100, future)).toBe("partial");
    expect(reevaluateInstallmentStatus(0, 100, past)).toBe("overdue");
    expect(reevaluateInstallmentStatus(0, 100, future)).toBe("pending");
  });
});
