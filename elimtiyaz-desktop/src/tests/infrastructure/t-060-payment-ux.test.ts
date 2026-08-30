/**
 * T-060 — payment collection UX correctness (BUSINESS-005 + WEAK-005).
 *
 * BUSINESS-005: the UnifiedPaymentModal's waterfall preview used a
 * "tuition/transport = filter, other categories = no filter" ternary while
 * the actual collection sends p_category (exact match server-side, migration
 * 0040). For canteen/uniform/books/therapy_psychology/other the preview
 * showed allocations across ALL categories while the collection filtered to
 * the chosen one — the preview lied. Fixed: the modal applies the SAME exact
 * category filter and hands the allocator the SAME concrete categoryFilter.
 *
 * WEAK-005: the batch-registration form never captured
 * previousGradeLevel/previousRank, so the `passage_palier` (−10,000 DZD) and
 * `highest_average` (−10%) discount rules were silently disabled (always
 * null inputs). Fixed: step 2 captures both fields; computeBilling passes
 * them to the deterministic engine; the submitted CreateStudentInput carries
 * them so the mock's persisted billing matches the preview.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { allocatePaymentToInstallments } from "../../domain/calc/payment/waterfall-allocator";
import { computeBilling } from "../../features/crm/batch-registration/compute-billing";
import { defaultPricingConfig } from "../../infrastructure/mock/pricing-seed";
import type { Installment } from "../../domain/model/payment";
import type { Step2Student, BillingInput } from "../../features/crm/batch-registration/types";
import { EMPTY_STUDENT } from "../../features/crm/batch-registration/types";

const MODAL_PATH = "src/features/financials/unified-payment-modal.tsx";

function installment(overrides: Partial<Installment>): Installment {
  return {
    id: overrides.id ?? "ins-1",
    tenantId: "t-1",
    parentId: "p-1",
    studentId: "s-1",
    category: "tuition",
    trancheNumber: 1,
    label: "Tranche 1",
    amountDue: 100_000,
    amountPaid: 0,
    amountPending: 0,
    status: "unpaid",
    dueDate: "2026-09-15",
    paidDate: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Installment;
}

// ============================================================================
// BUSINESS-005 — preview ≡ actual allocation for every category choice
// ============================================================================

describe("T-060 — the allocator's category semantics match the SQL RPC (BUSINESS-005)", () => {
  const mixed: Installment[] = [
    installment({ id: "t1", category: "tuition", amountDue: 100_000 }),
    installment({ id: "t2", category: "tuition", amountDue: 100_000 }),
    installment({ id: "c1", category: "canteen", amountDue: 50_000 }),
    installment({ id: "u1", category: "uniform", amountDue: 20_000 }),
  ];

  it("allocates ONLY within the chosen category (canteen payment never touches tuition tranches)", () => {
    const result = allocatePaymentToInstallments(mixed, 60_000, "canteen");
    expect(result.allocations.every((a) => a.installmentId === "c1")).toBe(true);
    expect(result.totalAllocated).toBe(50_000); // capped at the canteen tranche
    expect(result.unallocatedAmount).toBe(10_000); // excess stays unallocated
  });

  it("treats an undefined filter as cross-category (the SQL p_category IS NULL case)", () => {
    const result = allocatePaymentToInstallments(mixed, 60_000, undefined);
    expect(result.allocations.map((a) => a.installmentId)).toContain("t1");
    expect(result.allocations.map((a) => a.installmentId)).toContain("c1");
    expect(result.unallocatedAmount).toBe(0);
  });

  it("the modal no longer contains the divergent tuition/transport ternary (source-scan guard)", () => {
    const source = readFileSync(MODAL_PATH, "utf-8");
    expect(source).not.toContain('category === "tuition" || category === "transport" ? i.category === category : true');
    // And the preview passes the CONCRETE category to the allocator.
    expect(source).toContain("allocatePaymentToInstallments(eligible, amount, category)");
  });
});

// ============================================================================
// WEAK-005 — passage_palier + highest_average discounts can now fire
// ============================================================================

describe("T-060 — batch registration captures the discount inputs (WEAK-005)", () => {
  const baseStudent: Step2Student = {
    ...EMPTY_STUDENT,
    firstName: "Test",
    lastName: "Élève",
    level: "cem",
    gradeYear: 1, // → gradeLevel "1am" → 330,000 DZD gross
  };

  function billingInput(students: Step2Student[]): BillingInput {
    return { students, pricing: defaultPricingConfig, includeRegistration: false, includeTransport: false };
  }

  it("a 5AP → 1AM transition applies the passage_palier discount (−10,000 DZD)", () => {
    const billing = computeBilling(billingInput([
      { ...baseStudent, previousGradeLevel: "5ap" },
    ]));
    const per = billing.perStudent[0];
    const passage = per.discounts.find((d) => d.code === "passage_palier");
    expect(passage).toBeDefined();
    expect(passage!.amount).toBe(-10_000);
    // Net = gross − 10,000.
    expect(per.netTuition).toBe(330_000 - 10_000);
  });

  it("a rank-1 student applies the highest_average discount (−10%)", () => {
    const gross = 330_000;
    const billing = computeBilling(billingInput([
      { ...baseStudent, previousRank: "1" },
    ]));
    const per = billing.perStudent[0];
    const excellence = per.discounts.find((d) => d.code === "highest_average");
    expect(excellence).toBeDefined();
    // Discounts are SIGNED (negative) — matches passage_palier's −10,000.
    expect(excellence!.amount).toBe(-Math.round(gross * 0.10 * 100) / 100);
  });

  it("both discounts stack when both inputs qualify", () => {
    const billing = computeBilling(billingInput([
      { ...baseStudent, previousGradeLevel: "5ap", previousRank: "1" },
    ]));
    const per = billing.perStudent[0];
    const codes = per.discounts.filter((d) => d.amount < 0).map((d) => d.code);
    expect(codes).toContain("passage_palier");
    expect(codes).toContain("highest_average");
  });

  it("absent inputs leave both rules at zero (no accidental discounts)", () => {
    const billing = computeBilling(billingInput([{ ...baseStudent }]));
    const per = billing.perStudent[0];
    expect(per.discounts.find((d) => d.code === "passage_palier")?.amount ?? 0).toBe(0);
    expect(per.discounts.find((d) => d.code === "highest_average")?.amount ?? 0).toBe(0);
  });
});
