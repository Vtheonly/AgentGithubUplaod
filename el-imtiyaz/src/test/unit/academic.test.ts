/**
 * Unit tests for academic grade computation.
 *
 * Covers the three pure functions exported from `domain/model/academic.ts`:
 *   - computeSubjectAverage — (D1 + D2 + 2·Examen) / 4
 *   - computeOverallGpa     — Σ(subject_avg × coef) / Σ(coef)
 *   - isPassing / validateScore
 *
 * Plan §06.02: subject_average = (D1 + D2 + 2·Examen) / 4 (each 0..20).
 */
import { describe, it, expect } from "vitest";
import {
  computeSubjectAverage,
  computeOverallGpa,
  isPassing,
  validateScore,
} from "../../domain/model/academic";

describe("computeSubjectAverage", () => {
  it("returns null when all three scores are null", () => {
    expect(computeSubjectAverage(null, null, null)).toBeNull();
  });

  it("treats null scores as 0 (per implementation contract)", () => {
    // Only D1 = 16 → (16 + 0 + 0) / 4 = 4
    expect(computeSubjectAverage(16, null, null)).toBe(4);
    // Only D2 = 12 → (0 + 12 + 0) / 4 = 3
    expect(computeSubjectAverage(null, 12, null)).toBe(3);
    // Only Examen = 20 → (0 + 0 + 40) / 4 = 10
    expect(computeSubjectAverage(null, null, 20)).toBe(10);
  });

  it("weights Examen 2× per the plan formula", () => {
    // D1=10, D2=10, Examen=10 → (10 + 10 + 20) / 4 = 10
    expect(computeSubjectAverage(10, 10, 10)).toBe(10);
    // D1=12, D2=14, Examen=18 → (12 + 14 + 36) / 4 = 15.5
    expect(computeSubjectAverage(12, 14, 18)).toBe(15.5);
  });

  it("produces 0 when all three scores are 0", () => {
    expect(computeSubjectAverage(0, 0, 0)).toBe(0);
  });

  it("produces 20 when all three scores are 20", () => {
    // (20 + 20 + 40) / 4 = 20
    expect(computeSubjectAverage(20, 20, 20)).toBe(20);
  });

  it("handles fractional scores correctly", () => {
    // D1=8.5, D2=11.5, Examen=14 → (8.5 + 11.5 + 28) / 4 = 12
    expect(computeSubjectAverage(8.5, 11.5, 14)).toBe(12);
  });
});

describe("computeOverallGpa", () => {
  it("returns null when no assessments have a subject average", () => {
    expect(
      computeOverallGpa([
        { subjectAverage: null, coefficient: 3 },
        { subjectAverage: null, coefficient: 2 },
      ]),
    ).toBeNull();
  });

  it("returns null when the array is empty", () => {
    expect(computeOverallGpa([])).toBeNull();
  });

  it("ignores assessments with null subject average", () => {
    const gpa = computeOverallGpa([
      { subjectAverage: 12, coefficient: 3 },
      { subjectAverage: null, coefficient: 2 },
      { subjectAverage: 14, coefficient: 4 },
    ]);
    // (12·3 + 14·4) / (3 + 4) = (36 + 56) / 7 = 92/7 ≈ 13.142857...
    expect(gpa).toBeCloseTo(92 / 7, 5);
  });

  it("computes the weighted average across multiple subjects", () => {
    const gpa = computeOverallGpa([
      { subjectAverage: 10, coefficient: 2 },
      { subjectAverage: 14, coefficient: 3 },
      { subjectAverage: 18, coefficient: 1 },
    ]);
    // (10·2 + 14·3 + 18·1) / (2 + 3 + 1) = (20 + 42 + 18) / 6 = 80/6 ≈ 13.33
    expect(gpa).toBeCloseTo(80 / 6, 5);
  });

  it("handles a single assessment", () => {
    expect(computeOverallGpa([{ subjectAverage: 15, coefficient: 1 }])).toBe(15);
  });

  it("handles zero coefficients gracefully", () => {
    expect(
      computeOverallGpa([{ subjectAverage: 15, coefficient: 0 }]),
    ).toBeNull();
  });

  it("extracurricular subjects can be excluded by simply not passing them", () => {
    // Plan §05.07: club grades NEVER bleed into Scolarité GPA. The function
    // is pure — the caller is responsible for filtering extracurriculars out
    // before invoking. We just verify the function does no implicit inclusion.
    const scolariteOnly = computeOverallGpa([
      { subjectAverage: 12, coefficient: 3 },
    ]);
    expect(scolariteOnly).toBe(12);
  });
});

describe("isPassing", () => {
  it("returns true when gpa equals the default passing grade (10.0)", () => {
    expect(isPassing(10)).toBe(true);
  });

  it("returns true when gpa is above the passing grade", () => {
    expect(isPassing(15.5)).toBe(true);
  });

  it("returns false when gpa is below the passing grade", () => {
    expect(isPassing(9.99)).toBe(false);
  });

  it("supports a custom passing grade", () => {
    expect(isPassing(12, 12)).toBe(true);
    expect(isPassing(11.9, 12)).toBe(false);
  });
});

describe("validateScore", () => {
  it("accepts scores in the valid 0..20 range", () => {
    expect(validateScore(0)).toBe(true);
    expect(validateScore(10)).toBe(true);
    expect(validateScore(20)).toBe(true);
    expect(validateScore(15.5)).toBe(true);
  });

  it("rejects negative scores", () => {
    expect(validateScore(-0.01)).toBe(false);
    expect(validateScore(-10)).toBe(false);
  });

  it("rejects scores above 20", () => {
    expect(validateScore(20.01)).toBe(false);
    expect(validateScore(21)).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(validateScore(NaN)).toBe(false);
    expect(validateScore(Infinity)).toBe(false);
    expect(validateScore(-Infinity)).toBe(false);
  });
});
