/**
 * Unit tests for the 5 official `Prices.md` discount evaluators + the
 * master `evaluateAllSystemDiscounts` aggregator.
 *
 * Verifies:
 *   1. Passage de palier: -10,000 DA on cycle transition (5AP→1AM, 4AM→1ère Année).
 *   2. Sibling: -5,000 DA × (N-1) per additional child.
 *   3. Full annual before June 30: 10% OFF (only when paymentPlan === "full_annual").
 *   4. Academic excellence: 10% OFF for rank 1.
 *   5. Seniority >5 years: 5% OFF.
 *   6. Master evaluator returns itemized array of applied discounts only.
 */
import { describe, it, expect } from "vitest";
import {
  evaluatePassageDePalier,
  evaluateSiblingDiscount,
  evaluateEarlyAnnualDiscount,
  evaluateAcademicExcellenceDiscount,
  evaluateSeniorityDiscount,
  PASSAGE_DE_PALIER_AMOUNT,
} from "../../../domain/calc/pricing/discount-rules";
import {
  evaluateAllSystemDiscounts,
  sumDiscounts,
} from "../../../domain/calc/pricing/discount-engine";

describe("Discount Rule 1 — Passage de palier", () => {
  it("returns -10,000 DA when transitioning 5AP → 1AM (Primary → CEM)", () => {
    expect(evaluatePassageDePalier("5ap", "1am")).toBe(PASSAGE_DE_PALIER_AMOUNT);
    expect(evaluatePassageDePalier("5ap", "1am")).toBe(-10_000);
  });

  it("returns -10,000 DA when transitioning 4AM → 1ère Année (CEM → Lycée)", () => {
    expect(evaluatePassageDePalier("4am", "1ere_annee")).toBe(-10_000);
  });

  it("returns 0 for same-cycle progression (e.g. 1AM → 2AM)", () => {
    expect(evaluatePassageDePalier("1am", "2am")).toBe(0);
  });

  it("returns 0 for new enrollment (no previous grade)", () => {
    expect(evaluatePassageDePalier(null, "1ap")).toBe(0);
  });

  it("returns 0 for non-transition cross-cycle jumps (e.g. 3AP → 1AM)", () => {
    expect(evaluatePassageDePalier("3ap", "1am")).toBe(0);
  });
});

describe("Discount Rule 2 — Multi-Child (sibling)", () => {
  it("returns 0 for the first child (childIndex = 1)", () => {
    expect(evaluateSiblingDiscount(1)).toBe(0);
  });

  it("returns -5,000 DA for the second child (childIndex = 2)", () => {
    expect(evaluateSiblingDiscount(2)).toBe(-5_000);
  });

  it("returns -10,000 DA for the third child (childIndex = 3)", () => {
    expect(evaluateSiblingDiscount(3)).toBe(-10_000);
  });

  it("returns -15,000 DA for the fourth child (childIndex = 4)", () => {
    expect(evaluateSiblingDiscount(4)).toBe(-15_000);
  });

  it("respects custom per-child amount override", () => {
    expect(evaluateSiblingDiscount(3, 7_500)).toBe(-15_000);
  });
});

describe("Discount Rule 3 — Full Annual Payment before June 30", () => {
  it("returns 10% of gross tuition when paid before June 30 with full_annual plan", () => {
    const gross = 300_000;
    const savings = evaluateEarlyAnnualDiscount(
      "2026-06-15",
      gross,
      "full_annual",
      2026,
    );
    expect(savings).toBe(30_000); // 10% of 300,000
  });

  it("returns 0 when paymentPlan is 'tranches'", () => {
    const savings = evaluateEarlyAnnualDiscount(
      "2026-06-15",
      300_000,
      "tranches",
      2026,
    );
    expect(savings).toBe(0);
  });

  it("returns 0 when payment is made after June 30", () => {
    const savings = evaluateEarlyAnnualDiscount(
      "2026-07-15",
      300_000,
      "full_annual",
      2026,
    );
    expect(savings).toBe(0);
  });

  it("treats June 30 23:59:59 as the cutoff (inclusive)", () => {
    const savings = evaluateEarlyAnnualDiscount(
      "2026-06-30T23:59:59Z",
      300_000,
      "full_annual",
      2026,
    );
    expect(savings).toBe(30_000);
  });

  it("treats July 1 as past the cutoff", () => {
    const savings = evaluateEarlyAnnualDiscount(
      "2026-07-01T00:00:01Z",
      300_000,
      "full_annual",
      2026,
    );
    expect(savings).toBe(0);
  });
});

describe("Discount Rule 4 — Academic Excellence (Rank 1)", () => {
  it("returns 10% of gross tuition when rank === 1", () => {
    expect(evaluateAcademicExcellenceDiscount(1, 300_000)).toBe(30_000);
  });

  it("returns 0 when rank === 2", () => {
    expect(evaluateAcademicExcellenceDiscount(2, 300_000)).toBe(0);
  });

  it("returns 0 when rank is null (no ranking data)", () => {
    expect(evaluateAcademicExcellenceDiscount(null, 300_000)).toBe(0);
  });
});

describe("Discount Rule 5 — Seniority > 5 years", () => {
  it("returns 5% of gross tuition when enrolled more than 5 years ago", () => {
    const savings = evaluateSeniorityDiscount(
      "2018-09-01", // enrolled ~8 years before 2026-09-01
      "2026-09-01",
      300_000,
    );
    expect(savings).toBe(15_000); // 5% of 300,000
  });

  it("returns 0 when enrolled exactly 5 years ago (boundary, exclusive)", () => {
    const savings = evaluateSeniorityDiscount(
      "2021-09-01", // exactly 5 years before 2026-09-01
      "2026-09-01",
      300_000,
    );
    expect(savings).toBe(0);
  });

  it("returns 0 when enrolled less than 5 years ago", () => {
    const savings = evaluateSeniorityDiscount(
      "2023-09-01", // 3 years before 2026-09-01
      "2026-09-01",
      300_000,
    );
    expect(savings).toBe(0);
  });
});

describe("evaluateAllSystemDiscounts — master evaluator", () => {
  it("returns an empty array when no discounts apply", () => {
    const evals = evaluateAllSystemDiscounts({
      grossTuition: 300_000,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 1,
      paymentPlan: "tranches",
      paymentDate: "2026-09-15",
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01",
      enrollmentDate: "2026-09-01",
      previousRank: null,
    });
    expect(evals).toHaveLength(0);
  });

  it("returns all applicable discounts as signed (negative) entries", () => {
    const evals = evaluateAllSystemDiscounts({
      grossTuition: 300_000,
      previousGradeLevel: "5ap",
      currentGradeLevel: "1am", // passage de palier
      childIndex: 2, // sibling
      paymentPlan: "full_annual",
      paymentDate: "2026-06-15", // early bird
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01",
      enrollmentDate: "2018-09-01", // seniority >5y
      previousRank: 1, // academic excellence
    });
    expect(evals).toHaveLength(5);
    const total = sumDiscounts(evals);
    // Expected:
    //   passage_palier: -10,000
    //   sibling (child 2): -5,000
    //   early annual 10%: -30,000
    //   excellence 10%: -30,000
    //   seniority 5%: -15,000
    // Total: -90,000
    expect(total).toBe(-90_000);
  });

  it("does NOT double-apply the sibling discount (once per child, not per tranche)", () => {
    const evals = evaluateAllSystemDiscounts({
      grossTuition: 300_000,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 3, // 3rd child → -10,000 once
      paymentPlan: "tranches",
      paymentDate: "2026-09-15",
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01",
      enrollmentDate: "2026-09-01",
      previousRank: null,
    });
    expect(evals).toHaveLength(1);
    expect(evals[0].amount).toBe(-10_000);
  });

  it("sumDiscounts returns 0 for an empty array", () => {
    expect(sumDiscounts([])).toBe(0);
  });
});
