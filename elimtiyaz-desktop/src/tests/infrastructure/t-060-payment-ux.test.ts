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
 * WEAK-005 → CALC-001 supersession (2026-09-12): the T-060 "fix" captured
 * previousGradeLevel/previousRank to feed the `passage_palier` (−10,000 DZD)
 * and `highest_average` (−10%) rules — but those rules NEVER EXISTED at the
 * school (verified against `Suivis clients  2026_2027.xlsx`: the 10 000 DZD
 * remises were two 5 000 sibling components). The ghost fields are now
 * REMOVED and this suite pins their absence + the REAL remise model
 * (negotiated remise input, deducted from the V2 tranche).
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

  it("CALC-001: the ghost fields are GONE — no passage_palier / highest_average codes exist", () => {
    // The workbook proves those rules never existed; the wizard no longer
    // collects them and the engine can never fire them.
    const billing = computeBilling(billingInput([{ ...baseStudent }]));
    const per = billing.perStudent[0];
    expect(per.discounts.find((d) => d.code === "passage_palier")).toBeUndefined();
    expect(per.discounts.find((d) => d.code === "highest_average")).toBeUndefined();
    expect(per.discounts.find((d) => d.code === "seniority_5y")).toBeUndefined();
  });

  it("CALC-001: the negotiated remise is deducted from the V2 tranche (workbook rule)", () => {
    // 1AM (1AAM): scolarité 305 000, V2 sticker 122 000, 2V = v3 = 91 500.
    // With a 50 000 remise: V2 = 122 000 − 50 000 = 72 000, 2V/v3 unchanged
    // (ETAT row l39 BENZAOUI FATIMA — exact replay).
    const billing = computeBilling(billingInput([
      { ...baseStudent, remise: "50000" },
    ]));
    const per = billing.perStudent[0];
    expect(per.tranches[0].amountDue).toBe(72_000); // V2 − remise
    expect(per.tranches[1].amountDue).toBe(91_500); // 2V fixed
    expect(per.tranches[2].amountDue).toBe(91_500); // v3 fixed
    expect(per.devis).toBe(305_000 - 50_000); // FI excluded (includeRegistration=false)
  });

  it("CALC-001: the sticker-price case (SEDIKI rows) charges the FULL devis", () => {
    const billing = computeBilling(billingInput([
      { ...baseStudent, remise: "50000", chargeStickerPrice: true },
    ]));
    const per = billing.perStudent[0];
    // Devis follows the sticker (remise recorded but NOT deducted)…
    expect(per.devis).toBe(305_000);
    // …while the V2 tranche still gets the remise.
    expect(per.tranches[0].amountDue).toBe(72_000);
    expect(per.tranches[1].amountDue).toBe(91_500);
  });
});
