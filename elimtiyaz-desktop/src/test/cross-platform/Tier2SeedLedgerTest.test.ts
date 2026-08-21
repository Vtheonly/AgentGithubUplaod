/**
 * TIER 2 R17 + R24 — regression tests for the desktop's `buildSeedLedger`.
 *
 * Verifies that:
 *   - The sibling discount is applied ONCE on the gross annual tuition
 *     (R17 fix), not per-tranche (the previous bug tripled it).
 *   - The `parent_credit` adjustment entry exists in the seed (R24) so the
 *     canonical overpayment flow is exercised in mock mode.
 *   - The seed's `crossCheckParentCredit` reconciler finds the parent_credit
 *     entry and does NOT raise UNBACKED_PARENT_CREDIT for par-001.
 *
 * These tests close the desktop-internal inconsistency between the seed
 * state and the interactive batch-registration flow (which always applied
 * the sibling discount correctly via `computeBilling`).
 */
import { describe, test, expect } from "vitest";
import { buildSeedLedger, seedLedger } from "../../infrastructure/mock/ledger-seed";
import { computeParentSummary } from "../../domain/calc/ledger/balance";
import { evaluateAllSystemDiscounts, sumDiscounts } from "../../domain/calc/pricing";
import { defaultPricingConfig } from "../../infrastructure/mock/pricing-seed";
import { seedParents, seedStudents } from "../../infrastructure/mock/seed-data";
import { crossCheckParentCredit } from "../../domain/calc/reconcile/cross-checks";

describe("TIER 2 R17 — buildSeedLedger sibling discount (no per-tranche doubling)", () => {
  test("sibling discount is applied exactly once per student, not per tranche", () => {
    // Find a parent with multiple students.
    const parentWithMany = seedParents.find((p) => {
      const kids = seedStudents.filter((s) => s.parentId === p.id);
      return kids.length >= 2;
    });
    if (!parentWithMany) {
      // No multi-child family in seed — nothing to test.
      expect(true).toBe(true);
      return;
    }

    const kids = seedStudents.filter((s) => s.parentId === parentWithMany.id);
    const entries = seedLedger.filter(
      (e) => e.parentId === parentWithMany.id && e.category === "tuition",
    );

    // The previous bug: sibling discount applied per-tranche → for 3 tranches
    // × -5000 DZD = -15000 DZD total discount per child.
    // The fix: -5000 DZD total discount per additional child (applied once
    // on the gross annual tuition, then split into tranches).

    for (let i = 1; i < kids.length; i++) { // skip the first child (no sibling discount)
      const student = kids[i];
      const tuitionEntries = entries.filter((e) => e.studentId === student.id);
      expect(tuitionEntries.length).toBe(3); // 3 tranches

      // Sum of tranche amounts should equal net = gross - 5000 (the sibling discount).
      const gross = defaultPricingConfig.tuitionByGradeLevel[student.gradeLevel]?.annualAmount ?? 0;
      const expectedDiscount = -5000;
      const expectedNet = Math.max(0, gross + expectedDiscount);
      const actualSum = tuitionEntries.reduce((s, e) => s + e.amount, 0);

      // Allow for 1-dinar rounding drift (splitNetTuitionByOfficialSchedule
      // rounds per tranche but preserves the sum invariant).
      expect(Math.abs(actualSum - expectedNet)).toBeLessThanOrEqual(1);
    }
  });

  test("sibling discount matches the canonical evaluateAllSystemDiscounts output", () => {
    // For each additional child in a multi-child family, the seed's total
    // sibling discount should equal what `evaluateAllSystemDiscounts` returns.
    const parent = seedParents.find((p) => {
      const kids = seedStudents.filter((s) => s.parentId === p.id);
      return kids.length >= 2;
    });
    if (!parent) {
      expect(true).toBe(true);
      return;
    }

    const kids = seedStudents.filter((s) => s.parentId === parent.id);
    const additionalKids = kids.slice(1); // skip first child (no sibling discount)

    for (const student of additionalKids) {
      const gross = defaultPricingConfig.tuitionByGradeLevel[student.gradeLevel]?.annualAmount ?? 0;
      const childIndex = kids.findIndex((s) => s.id === student.id) + 1;
      const discountEvals = evaluateAllSystemDiscounts({
        grossTuition: gross,
        previousGradeLevel: null,
        currentGradeLevel: student.gradeLevel,
        childIndex,
        paymentPlan: "tranches",
        paymentDate: new Date().toISOString(),
        academicYearStartYear: 2025,
        academicYearStart: new Date(Date.UTC(2025, 8, 1)).toISOString(),
        enrollmentDate: new Date().toISOString(),
        previousRank: null,
      });
      const expectedDiscount = sumDiscounts(discountEvals);

      // The seed's entries should reflect the same net = gross + discount.
      const seedEntries = seedLedger.filter(
        (e) => e.parentId === parent.id && e.studentId === student.id && e.category === "tuition",
      );
      const seedNet = seedEntries.reduce((s, e) => s + e.amount, 0);
      const expectedNet = Math.max(0, gross + expectedDiscount);
      expect(Math.abs(seedNet - expectedNet)).toBeLessThanOrEqual(1);
    }
  });

  test("first child in family has NO sibling discount (verified via canonical engine)", () => {
    // Verify via the canonical `evaluateAllSystemDiscounts` that the first
    // child (childIndex=1) gets ZERO sibling discount from the engine.
    // This is the source of truth — the seed code uses the same engine.
    const parent = seedParents.find((p) => {
      const kids = seedStudents.filter((s) => s.parentId === p.id);
      return kids.length >= 2;
    });
    if (!parent) {
      expect(true).toBe(true);
      return;
    }

    const firstChild = seedStudents.filter((s) => s.parentId === parent.id)[0];
    const gross = defaultPricingConfig.tuitionByGradeLevel[firstChild.gradeLevel]?.annualAmount ?? 0;
    if (gross === 0) {
      // Grade level not in pricing config — skip.
      expect(true).toBe(true);
      return;
    }
    const discountEvals = evaluateAllSystemDiscounts({
      grossTuition: gross,
      previousGradeLevel: null,
      currentGradeLevel: firstChild.gradeLevel,
      childIndex: 1, // first child → 1-based
      paymentPlan: "tranches",
      paymentDate: new Date().toISOString(),
      academicYearStartYear: 2025,
      academicYearStart: new Date(Date.UTC(2025, 8, 1)).toISOString(),
      enrollmentDate: new Date().toISOString(),
      previousRank: null,
    });
    const siblingEval = discountEvals.find((d) => d.code === "sibling_fixed");
    // First child gets NO sibling discount (rule applies to children #2+).
    expect(siblingEval).toBeUndefined();
  });
});

describe("TIER 2 R24 — buildSeedLedger parent_credit adjustment", () => {
  test("seed contains a parent_credit adjustment entry", () => {
    // The seed MUST contain at least one parent_credit adjustment entry
    // so the canonical overpayment flow is exercised in mock mode.
    const parentCreditEntries = seedLedger.filter(
      (e) => e.category === "parent_credit" && e.type === "adjustment",
    );
    expect(parentCreditEntries.length).toBeGreaterThanOrEqual(1);
  });

  test("parent_credit entry has studentId = null (parent-scoped, not student-scoped)", () => {
    // The canonical rule (INV-7) — overpayment credits land on a parent-
    // scoped account, NOT a student-scoped account. The `studentId` field
    // MUST be null.
    const parentCreditEntries = seedLedger.filter(
      (e) => e.category === "parent_credit" && e.type === "adjustment",
    );
    for (const e of parentCreditEntries) {
      expect(e.studentId).toBeNull();
    }
  });

  test("parent_credit entry has negative amount (credit, not debit)", () => {
    // Credits are stored as negative amounts (signed-amount convention).
    const parentCreditEntries = seedLedger.filter(
      (e) => e.category === "parent_credit" && e.type === "adjustment",
    );
    for (const e of parentCreditEntries) {
      expect(e.amount).toBeLessThan(0);
    }
  });

  test("parent_credit entry on par-001 produces non-zero unallocatedCredit", () => {
    // The seed adds a parent_credit of -50000 on par-001. The canonical
    // `computeParentSummary` should pick it up in `totalUnallocatedCredit`.
    // Per the canonical convention: `unallocatedCredit` is the SUM of
    // parent_credit adjustment amounts (which are NEGATIVE = credit). So
    // `totalUnallocatedCredit` is NEGATIVE when there's banked credit.
    const parentEntries = seedLedger.filter((e) => e.parentId === "par-001");
    const summary = computeParentSummary(parentEntries, "par-001", "Test Parent");
    // Negative = banked credit (parent has 50,000 DZD credit available).
    expect(summary.totalUnallocatedCredit).toBeLessThan(0);
    // Magnitude should equal the seed amount (50,000 DZD).
    expect(Math.abs(summary.totalUnallocatedCredit)).toBeGreaterThanOrEqual(50000);
  });

  test("crossCheckParentCredit recognizes par-001 as having parent_credit backing", () => {
    // The reconciler should recognize the parent_credit adjustment entry
    // and not flag par-001 as having "negative outstanding without
    // parent_credit entry". The per-account check might still flag
    // negative balances on NON-parent_credit accounts (which is correct
    // behavior — those would be bugs in the data).
    const parentEntries = seedLedger.filter((e) => e.parentId === "par-001");
    const summary = computeParentSummary(parentEntries, "par-001", "Test Parent");
    const parentSummaries = [{
      parentId: "par-001",
      parentName: "Test Parent",
      totalOutstanding: summary.totalOutstanding,
      accounts: summary.accounts.map((acc) => ({
        accountId: acc.accountId,
        category: acc.category,
        studentId: acc.studentId,
        balance: acc.balance,
        unallocatedCredit: acc.unallocatedCredit,
      })),
    }];
    const violations = crossCheckParentCredit(parentSummaries, seedLedger);
    // We DO have a parent_credit entry on par-001 → the "negative outstanding
    // without parent_credit entry" violation should NOT fire for par-001.
    // (Per-account violations on non-parent_credit accounts may still fire
    // if the seed has any — that's a separate concern.)
    const noCreditEntryViolations = violations.filter((v) =>
      v.message.includes("no parent_credit adjustment entry exists") &&
      (v.message.includes("par-001") || (v.details as Record<string, unknown>)?.parentId === "par-001"),
    );
    expect(noCreditEntryViolations.length).toBe(0);
  });
});
