/**
 * Characterization tests for `calc/payment/sums.ts`,
 * `calc/payment/installments.ts`, and `calc/payment/revenue.ts`.
 *
 * Locks in the exact behavior of the extracted payment calculations.
 */
import { describe, it, expect } from "vitest";
import {
  sumPaidPayments,
  sumInstallmentsDue,
  sumInstallmentsPaid,
} from "@/domain/calc/payment/sums";
import {
  installmentRemaining,
  totalOutstanding,
  overdueAmount,
  maxDaysOverdue,
  agingBucketFromDays,
} from "@/domain/calc/payment/installments";
import {
  revenueByMonth,
  revenueByCategory,
  monthlyRevenue,
} from "@/domain/calc/payment/revenue";
import type { Payment, Installment, PaymentCategory } from "@/domain/model/payment";

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "p1", tenantId: "t1", receiptNumber: "REC-1", parentId: "par-1",
    studentId: "s1", amount: 1000, method: "cash", status: "paid",
    category: "tuition", installmentId: null, proofUrl: null, notes: null,
    collectedBy: "a1", collectedAt: "2025-09-15T10:00:00.000Z",
    createdAt: "2025-09-15T10:00:00.000Z", updatedAt: "2025-09-15T10:00:00.000Z",
    ...overrides,
  };
}

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: "i1", parentId: "par-1", studentId: "s1", category: "tuition",
    label: "Tranche 1", amountDue: 1000, amountPaid: 0,
    dueDate: "2025-09-15T00:00:00.000Z", paidDate: null, status: "pending",
    ...overrides,
  };
}

describe("calc/payment/sums", () => {
  describe("sumPaidPayments", () => {
    it("returns 0 for an empty list", () => {
      expect(sumPaidPayments([])).toBe(0);
    });
    it("sums only payments with status 'paid'", () => {
      const payments = [
        makePayment({ amount: 1000, status: "paid" }),
        makePayment({ amount: 500, status: "pending" }),
        makePayment({ amount: 300, status: "partial" }),
        makePayment({ amount: 200, status: "paid" }),
      ];
      expect(sumPaidPayments(payments)).toBe(1200); // 1000 + 200
    });
    it("returns 0 when no payments are paid", () => {
      const payments = [
        makePayment({ amount: 1000, status: "pending" }),
        makePayment({ amount: 500, status: "cancelled" }),
      ];
      expect(sumPaidPayments(payments)).toBe(0);
    });
  });

  describe("sumInstallmentsDue", () => {
    it("returns 0 for an empty list", () => {
      expect(sumInstallmentsDue([])).toBe(0);
    });
    it("sums the amountDue field across all installments", () => {
      const installments = [
        makeInstallment({ amountDue: 3000 }),
        makeInstallment({ amountDue: 3000 }),
        makeInstallment({ amountDue: 4000 }),
      ];
      expect(sumInstallmentsDue(installments)).toBe(10000);
    });
  });

  describe("sumInstallmentsPaid", () => {
    it("returns 0 for an empty list", () => {
      expect(sumInstallmentsPaid([])).toBe(0);
    });
    it("sums the amountPaid field across all installments", () => {
      const installments = [
        makeInstallment({ amountPaid: 1000 }),
        makeInstallment({ amountPaid: 2000 }),
        makeInstallment({ amountPaid: 0 }),
      ];
      expect(sumInstallmentsPaid(installments)).toBe(3000);
    });
  });
});

describe("calc/payment/installments", () => {
  describe("installmentRemaining", () => {
    it("returns amountDue - amountPaid when fully unpaid", () => {
      expect(installmentRemaining(makeInstallment({ amountDue: 1000, amountPaid: 0 }))).toBe(1000);
    });
    it("returns the remaining when partially paid", () => {
      expect(installmentRemaining(makeInstallment({ amountDue: 1000, amountPaid: 400 }))).toBe(600);
    });
    it("returns 0 when fully paid", () => {
      expect(installmentRemaining(makeInstallment({ amountDue: 1000, amountPaid: 1000 }))).toBe(0);
    });
    it("clamps at 0 when overpaid (preserves Math.max(0, ...) behavior)", () => {
      expect(installmentRemaining(makeInstallment({ amountDue: 1000, amountPaid: 1500 }))).toBe(0);
    });
  });

  describe("totalOutstanding", () => {
    it("returns 0 for an empty list", () => {
      expect(totalOutstanding([])).toBe(0);
    });
    it("returns sum(amountDue) - sum(amountPaid)", () => {
      const installments = [
        makeInstallment({ amountDue: 1000, amountPaid: 400 }),
        makeInstallment({ amountDue: 2000, amountPaid: 1000 }),
      ];
      expect(totalOutstanding(installments)).toBe(1600); // (1000+2000) - (400+1000)
    });
    it("clamps at 0 when overpaid", () => {
      const installments = [
        makeInstallment({ amountDue: 1000, amountPaid: 1500 }),
      ];
      expect(totalOutstanding(installments)).toBe(0);
    });
  });

  describe("overdueAmount", () => {
    const now = new Date("2025-09-15T00:00:00.000Z");
    it("returns 0 for an empty list", () => {
      expect(overdueAmount([], now)).toBe(0);
    });
    it("returns 0 when all installments are paid", () => {
      const installments = [
        makeInstallment({ status: "paid", amountDue: 1000, amountPaid: 1000, dueDate: "2025-01-01T00:00:00.000Z" }),
      ];
      expect(overdueAmount(installments, now)).toBe(0);
    });
    it("returns 0 when due dates are in the future", () => {
      const installments = [
        makeInstallment({ status: "pending", amountDue: 1000, amountPaid: 0, dueDate: "2025-12-01T00:00:00.000Z" }),
      ];
      expect(overdueAmount(installments, now)).toBe(0);
    });
    it("returns the remaining for overdue unpaid installments", () => {
      const installments = [
        makeInstallment({ status: "pending", amountDue: 1000, amountPaid: 0, dueDate: "2025-01-01T00:00:00.000Z" }),
        makeInstallment({ status: "pending", amountDue: 2000, amountPaid: 500, dueDate: "2025-06-01T00:00:00.000Z" }),
      ];
      expect(overdueAmount(installments, now)).toBe(2500); // 1000 + 1500
    });
    it("returns 0 when due date equals now (strict less-than)", () => {
      const installments = [
        makeInstallment({ status: "pending", amountDue: 1000, amountPaid: 0, dueDate: "2025-09-15T00:00:00.000Z" }),
      ];
      expect(overdueAmount(installments, now)).toBe(0);
    });
  });

  describe("maxDaysOverdue", () => {
    const now = new Date("2025-09-15T00:00:00.000Z");
    it("returns 0 for an empty list", () => {
      expect(maxDaysOverdue([], now)).toBe(0);
    });
    it("returns 0 when all installments are paid", () => {
      const installments = [
        makeInstallment({ status: "paid", dueDate: "2025-01-01T00:00:00.000Z" }),
      ];
      expect(maxDaysOverdue(installments, now)).toBe(0);
    });
    it("returns 0 when due dates are in the future", () => {
      const installments = [
        makeInstallment({ status: "pending", dueDate: "2025-12-01T00:00:00.000Z" }),
      ];
      expect(maxDaysOverdue(installments, now)).toBe(0);
    });
    it("returns the MAX days overdue across multiple overdue installments", () => {
      const installments = [
        makeInstallment({ status: "pending", dueDate: "2025-09-13T00:00:00.000Z" }), // 2 days
        makeInstallment({ status: "pending", dueDate: "2025-09-10T00:00:00.000Z" }), // 5 days
        makeInstallment({ status: "pending", dueDate: "2025-09-14T00:00:00.000Z" }), // 1 day
      ];
      expect(maxDaysOverdue(installments, now)).toBe(5);
    });
    it("floors partial-day differences", () => {
      const installments = [
        makeInstallment({ status: "pending", dueDate: "2025-09-14T12:00:00.000Z" }),
      ];
      // now - dueDate = 12h → floor → 0 days
      expect(maxDaysOverdue(installments, new Date("2025-09-15T00:00:00.000Z"))).toBe(0);
    });
  });

  describe("agingBucketFromDays", () => {
    it("returns '0_30' for 0 days", () => {
      expect(agingBucketFromDays(0)).toBe("0_30");
    });
    it("returns '0_30' for 30 days (boundary inclusive)", () => {
      expect(agingBucketFromDays(30)).toBe("0_30");
    });
    it("returns '31_60' for 31 days", () => {
      expect(agingBucketFromDays(31)).toBe("31_60");
    });
    it("returns '31_60' for 60 days (boundary inclusive)", () => {
      expect(agingBucketFromDays(60)).toBe("31_60");
    });
    it("returns '61_90' for 90 days (boundary inclusive)", () => {
      expect(agingBucketFromDays(90)).toBe("61_90");
    });
    it("returns '91_180' for 91 days", () => {
      expect(agingBucketFromDays(91)).toBe("91_180");
    });
    it("returns '91_180' for 180 days (boundary inclusive)", () => {
      expect(agingBucketFromDays(180)).toBe("91_180");
    });
    it("returns '180_plus' for 181 days", () => {
      expect(agingBucketFromDays(181)).toBe("180_plus");
    });
    it("returns '180_plus' for very large values", () => {
      expect(agingBucketFromDays(365 * 5)).toBe("180_plus");
    });
    it("treats negative inputs as '0_30'", () => {
      // Negative days means the due date is in the future — clamp to 0_30
      expect(agingBucketFromDays(-5)).toBe("0_30");
    });
  });
});

describe("calc/payment/revenue", () => {
  const now = new Date(2025, 5, 15); // June 15, 2025 local

  describe("revenueByMonth", () => {
    it("returns 12 buckets all at 0 when payments list is empty", () => {
      const result = revenueByMonth([], now);
      expect(result).toHaveLength(12);
      for (const b of result) expect(b.amount).toBe(0);
    });
    it("returns 12 buckets all at 0 when no payments are paid", () => {
      const payments = [makePayment({ status: "pending", amount: 1000 })];
      const result = revenueByMonth(payments, now);
      for (const b of result) expect(b.amount).toBe(0);
    });
    it("allocates paid payments to the correct month bucket", () => {
      const payments = [
        makePayment({ status: "paid", amount: 1000, collectedAt: "2025-06-01T00:00:00.000Z" }),
        makePayment({ status: "paid", amount: 500, collectedAt: "2025-05-01T00:00:00.000Z" }),
      ];
      const result = revenueByMonth(payments, now);
      // Last bucket = June 2025 → 1000
      expect(result[11].amount).toBe(1000);
      // Second-to-last = May 2025 → 500
      expect(result[10].amount).toBe(500);
    });
    it("drops payments outside the 12-month window", () => {
      const payments = [
        makePayment({ status: "paid", amount: 9999, collectedAt: "2023-01-01T00:00:00.000Z" }),
      ];
      const result = revenueByMonth(payments, now);
      for (const b of result) expect(b.amount).toBe(0);
    });
    it("labels buckets with FR month abbreviations", () => {
      const result = revenueByMonth([], now);
      expect(result[11].label).toBe("Juin"); // June 2025
    });
  });

  describe("revenueByCategory", () => {
    it("returns empty array when no payments are paid", () => {
      const payments = [makePayment({ status: "pending", amount: 1000, category: "tuition" })];
      const result = revenueByCategory(payments, now);
      expect(result).toEqual([]);
    });
    it("groups current-month paid payments by category", () => {
      const payments = [
        makePayment({ status: "paid", amount: 1000, category: "tuition", collectedAt: "2025-06-01T00:00:00.000Z" }),
        makePayment({ status: "paid", amount: 500, category: "tuition", collectedAt: "2025-06-10T00:00:00.000Z" }),
        makePayment({ status: "paid", amount: 300, category: "transport", collectedAt: "2025-06-15T00:00:00.000Z" }),
      ];
      const result = revenueByCategory(payments, now);
      const tuition = result.find((r) => r.category === "tuition");
      const transport = result.find((r) => r.category === "transport");
      expect(tuition?.amount).toBe(1500);
      expect(transport?.amount).toBe(300);
    });
    it("excludes payments from other months", () => {
      const payments = [
        makePayment({ status: "paid", amount: 1000, category: "tuition", collectedAt: "2025-05-01T00:00:00.000Z" }),
      ];
      const result = revenueByCategory(payments, now);
      expect(result).toEqual([]);
    });
  });

  describe("monthlyRevenue", () => {
    it("returns 0 when no payments are paid", () => {
      const payments = [makePayment({ status: "pending", amount: 1000, collectedAt: "2025-06-01T00:00:00.000Z" })];
      expect(monthlyRevenue(payments, now)).toBe(0);
    });
    it("sums paid payments in the current month", () => {
      const payments = [
        makePayment({ status: "paid", amount: 1000, collectedAt: "2025-06-01T00:00:00.000Z" }),
        makePayment({ status: "paid", amount: 500, collectedAt: "2025-06-15T00:00:00.000Z" }),
      ];
      expect(monthlyRevenue(payments, now)).toBe(1500);
    });
    it("excludes payments from other months", () => {
      const payments = [
        makePayment({ status: "paid", amount: 9999, collectedAt: "2025-05-31T00:00:00.000Z" }),
        makePayment({ status: "paid", amount: 100, collectedAt: "2025-07-01T00:00:00.000Z" }),
      ];
      expect(monthlyRevenue(payments, now)).toBe(0);
    });
  });
});
