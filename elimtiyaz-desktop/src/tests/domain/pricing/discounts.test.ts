/**
 * Unit tests for the REAL 2026/2027 discount rules + the master
 * `evaluateAllSystemDiscounts` aggregator.
 *
 * CALC-001/002 (2026-09-12): the previous suite pinned the FIVE fictional
 * `Prices.md` rules (passage_palier −10 000, highest_average −10%,
 * seniority_5y −5%, 10% early, 40/30/30). Verified against the actual
 * workbook (`Suivis clients  2026_2027.xlsx`), only TWO rules are real:
 *
 *   1. Sibling: −5 000 DZD × (N−1) (default component — the J-column
 *      decompositions carry `+5000` per additional child).
 *   2. Full annual before June 30: −5% of the SCOLARITÉ ONLY (the Devis
 *      sheet formula `=+SUM(F15:F26)*0.05` — never of FI or transport).
 *
 * The removed rules are pinned BELOW: they must never fire again.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateSiblingDiscount,
  evaluateEarlyAnnualDiscount,
  EARLY_ANNUAL_RATE,
  SIBLING_PER_CHILD_AMOUNT,
} from "../../../domain/calc/pricing/discount-rules";
import {
  evaluateAllSystemDiscounts,
  sumDiscounts,
} from "../../../domain/calc/pricing/discount-engine";

describe("Discount Rule 1 — Multi-Child (sibling, real default component)", () => {
  it("returns 0 for the first child (childIndex = 1)", () => {
    expect(evaluateSiblingDiscount(1)).toBe(0);
  });

  it("returns -5,000 DA for the second child (childIndex = 2)", () => {
    expect(evaluateSiblingDiscount(2)).toBe(-5_000);
  });

  it("returns -10,000 DA for the third child (childIndex = 3)", () => {
    expect(evaluateSiblingDiscount(3)).toBe(-10_000);
  });

  it("respects custom per-child amount override", () => {
    expect(evaluateSiblingDiscount(3, 7_500)).toBe(-15_000);
  });

  it("SIBLING_PER_CHILD_AMOUNT is the workbook default (5 000 DZD)", () => {
    expect(SIBLING_PER_CHILD_AMOUNT).toBe(5_000);
  });
});

describe("Discount Rule 2 — Full Annual Payment before June 30 (−5% SCOLARITÉ)", () => {
  it("returns 5% of the scolarité when paid before June 30 with full_annual plan", () => {
    // Workbook evidence: MAHAMED OUSSAID — 5% of 460 000 = 23 000
    // (Devis formula =+SUM(F15:F26)*0.05 → 23000).
    const savings = evaluateEarlyAnnualDiscount(
      "2026-06-15",
      460_000,
      "full_annual",
      2026,
    );
    expect(savings).toBe(23_000);
  });

  it("returns 0 when paymentPlan is 'tranches'", () => {
    const savings = evaluateEarlyAnnualDiscount(
      "2026-06-15",
      460_000,
      "tranches",
      2026,
    );
    expect(savings).toBe(0);
  });

  it("returns 0 when payment is made after June 30", () => {
    const savings = evaluateEarlyAnnualDiscount(
      "2026-07-15",
      460_000,
      "full_annual",
      2026,
    );
    expect(savings).toBe(0);
  });

  it("treats June 30 23:59:59 as the cutoff (inclusive)", () => {
    const savings = evaluateEarlyAnnualDiscount(
      "2026-06-30T23:59:59Z",
      460_000,
      "full_annual",
      2026,
    );
    expect(savings).toBe(23_000);
  });

  it("treats July 1 as past the cutoff", () => {
    const savings = evaluateEarlyAnnualDiscount(
      "2026-07-01T00:00:01Z",
      460_000,
      "full_annual",
      2026,
    );
    expect(savings).toBe(0);
  });

  it("EARLY_ANNUAL_RATE is 5% (the Devis Nb 01 note), NOT the old 10%", () => {
    expect(EARLY_ANNUAL_RATE).toBe(0.05);
  });
});

describe("CALC-001 — the fictional rules must never fire", () => {
  it("passage_palier never fires, even on the 5AP→1AM cycle transition", () => {
    // The old rule deducted −10 000 DZD here. The workbook proves those
    // 10 000 DZD remises were two 5 000 sibling components.
    const evals = evaluateAllSystemDiscounts({
      grossScolarite: 330_000,
      previousGradeLevel: "5ap",
      currentGradeLevel: "1am",
      childIndex: 1,
      paymentPlan: "tranches",
      paymentDate: "2026-09-15",
      academicYearStartYear: 2026,
    });
    expect(evals).toHaveLength(0);
  });

  it("highest_average (rank 1) never fires", () => {
    const evals = evaluateAllSystemDiscounts({
      grossScolarite: 330_000,
      childIndex: 1,
      paymentPlan: "tranches",
      paymentDate: "2026-09-15",
      academicYearStartYear: 2026,
      previousRank: 1,
    });
    expect(evals).toHaveLength(0);
  });

  it("seniority (>5 years enrollment) never fires", () => {
    const evals = evaluateAllSystemDiscounts({
      grossScolarite: 330_000,
      childIndex: 1,
      paymentPlan: "tranches",
      paymentDate: "2026-09-15",
      academicYearStartYear: 2026,
      enrollmentDate: "2018-09-01",
      academicYearStart: "2026-09-01",
    });
    expect(evals).toHaveLength(0);
  });
});

describe("evaluateAllSystemDiscounts — master evaluator", () => {
  it("returns an empty array when no discounts apply", () => {
    const evals = evaluateAllSystemDiscounts({
      grossScolarite: 330_000,
      childIndex: 1,
      paymentPlan: "tranches",
      paymentDate: "2026-09-15",
      academicYearStartYear: 2026,
    });
    expect(evals).toHaveLength(0);
  });

  it("fires sibling + early payment together (5% on scolarité)", () => {
    const evals = evaluateAllSystemDiscounts({
      grossScolarite: 300_000,
      childIndex: 2, // sibling −5 000
      paymentPlan: "full_annual",
      paymentDate: "2026-06-15", // early 5% of scolarité
      academicYearStartYear: 2026,
    });
    expect(evals).toHaveLength(2);
    const total = sumDiscounts(evals);
    // sibling: −5 000 ; early: −15 000 (5% of 300 000) → −20 000
    expect(total).toBe(-20_000);
  });

  it("does NOT double-apply the sibling discount (once per child, not per tranche)", () => {
    const evals = evaluateAllSystemDiscounts({
      grossScolarite: 300_000,
      childIndex: 3, // 3rd child → −10 000 once
      paymentPlan: "tranches",
      paymentDate: "2026-09-15",
      academicYearStartYear: 2026,
    });
    expect(evals).toHaveLength(1);
    expect(evals[0].amount).toBe(-10_000);
  });

  it("accepts the deprecated grossTuition alias (cross-platform fixtures)", () => {
    const evals = evaluateAllSystemDiscounts({
      grossTuition: 300_000,
      childIndex: 1,
      paymentPlan: "full_annual",
      paymentDate: "2026-06-15",
      academicYearStartYear: 2026,
    });
    expect(evals).toHaveLength(1);
    expect(evals[0].amount).toBe(-15_000); // 5% of 300 000
  });

  it("sumDiscounts returns 0 for an empty array", () => {
    expect(sumDiscounts([])).toBe(0);
  });
});
