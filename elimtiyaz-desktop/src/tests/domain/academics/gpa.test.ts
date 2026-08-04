import { describe, it, expect } from "vitest";
import {
  computeSubjectAverage,
  computeOverallGpa,
  isPassing,
  validateScore,
  type Assessment,
  type Subject,
} from "../../../domain/model/academic";
import {
  evaluateStudentTermPerformance,
  rankClassPerformance,
  validateAssessmentInput,
} from "../../../domain/calc/academics/gpa";

describe("Academic GPA & Score Calculations Engine", () => {
  describe("computeSubjectAverage", () => {
    it("should calculate correct weighted subject average: (D1 + D2 + 2*Examen) / 4", () => {
      // (14 + 16 + 2*18) / 4 = (14 + 16 + 36) / 4 = 66 / 4 = 16.5
      const avg = computeSubjectAverage(14, 16, 18);
      expect(avg).toBe(16.5);
    });

    it("should handle partial null entries gracefully defaulting missing tests to 0", () => {
      // (12 + 0 + 2*15) / 4 = 42 / 4 = 10.5
      const avg = computeSubjectAverage(12, null, 15);
      expect(avg).toBe(10.5);
    });

    it("should return null if all test scores are null", () => {
      const avg = computeSubjectAverage(null, null, null);
      expect(avg).toBeNull();
    });
  });

  describe("computeOverallGpa", () => {
    it("should calculate weighted overall GPA based on subject coefficients", () => {
      const items = [
        { subjectAverage: 16.5, coefficient: 4 }, // 66.0
        { subjectAverage: 14.0, coefficient: 3 }, // 42.0
        { subjectAverage: 12.0, coefficient: 2 }, // 24.0
      ];
      // Total Weighted = 132.0, Total Coef = 9 -> 132 / 9 = 14.67
      const gpa = computeOverallGpa(items);
      expect(gpa).toBe(14.67);
    });

    it("should exclude extracurricular subjects from Scolarité GPA calculation", () => {
      const items = [
        { subjectAverage: 15.0, coefficient: 4, isExtracurricular: false }, // 60.0
        { subjectAverage: 20.0, coefficient: 2, isExtracurricular: true },  // EXCLUDED
      ];
      const gpa = computeOverallGpa(items);
      expect(gpa).toBe(15.0);
    });

    it("should return null if no graded scolarité subjects exist", () => {
      const items = [
        { subjectAverage: null, coefficient: 3, isExtracurricular: false },
        { subjectAverage: 18.0, coefficient: 1, isExtracurricular: true },
      ];
      expect(computeOverallGpa(items)).toBeNull();
    });
  });

  describe("isPassing & validateScore", () => {
    it("should correctly evaluate passing grade threshold", () => {
      expect(isPassing(10.0, 10.0)).toBe(true);
      expect(isPassing(9.99, 10.0)).toBe(false);
      expect(isPassing(12.0, 12.0)).toBe(true);
    });

    it("should validate score bounds 0 to 20", () => {
      expect(validateScore(0)).toBe(true);
      expect(validateScore(20)).toBe(true);
      expect(validateScore(15.5)).toBe(true);
      expect(validateScore(-1)).toBe(false);
      expect(validateScore(20.5)).toBe(false);
      expect(validateScore(NaN)).toBe(false);
    });
  });

  describe("rankClassPerformance", () => {
    it("should rank students in descending order of overall GPA and handle ties", () => {
      const performances = [
        { studentId: "stu-001", gpa: 14.5, isPassing: true, evaluatedAssessmentsCount: 3, missingAssessmentsCount: 0 },
        { studentId: "stu-002", gpa: 17.0, isPassing: true, evaluatedAssessmentsCount: 3, missingAssessmentsCount: 0 },
        { studentId: "stu-003", gpa: 14.5, isPassing: true, evaluatedAssessmentsCount: 3, missingAssessmentsCount: 0 },
        { studentId: "stu-004", gpa: 9.0, isPassing: false, evaluatedAssessmentsCount: 3, missingAssessmentsCount: 0 },
      ];

      const ranked = rankClassPerformance(performances);

      const stu2 = ranked.find((r) => r.studentId === "stu-002");
      const stu1 = ranked.find((r) => r.studentId === "stu-001");
      const stu3 = ranked.find((r) => r.studentId === "stu-003");
      const stu4 = ranked.find((r) => r.studentId === "stu-004");

      expect(stu2?.rank).toBe(1);
      expect(stu1?.rank).toBe(2);
      expect(stu3?.rank).toBe(2); // Shared rank 2 for tie
      expect(stu4?.rank).toBe(4);
    });
  });

  describe("validateAssessmentInput", () => {
    it("should report errors when scores are out of bounds", () => {
      const res = validateAssessmentInput({ devoir1: 22, devoir2: -5, examen: 15 });
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBe(2);
    });

    it("should validate clean inputs", () => {
      const res = validateAssessmentInput({ devoir1: 15, devoir2: 14, examen: 16 });
      expect(res.isValid).toBe(true);
      expect(res.errors.length).toBe(0);
    });
  });
});