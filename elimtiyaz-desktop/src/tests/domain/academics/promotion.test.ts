import { describe, it, expect } from "vitest";
import {
  getNextGradeProgression,
  buildPromotionReviewQueue,
  createAcademicHistoryEntry,
  type PromotionCandidate,
} from "../../../domain/calc/academics/promotion";
import type { Student } from "../../../domain/model/student";
import type { Assessment, Subject } from "../../../domain/model/academic";

describe("Academic Year-End Promotion Engine", () => {
  describe("getNextGradeProgression", () => {
    it("should correctly advance primary grades within the cycle", () => {
      const res = getNextGradeProgression("1ap");
      expect(res.nextGradeCode).toBe("2ap");
      expect(res.nextLevel).toBe("primaire");
      expect(res.nextGradeYear).toBe(2);
      expect(res.isGraduation).toBe(false);
    });

    it("should handle Primary Grade 5 -> Middle School (CEM 1) cycle transition", () => {
      const res = getNextGradeProgression("5ap");
      expect(res.nextGradeCode).toBe("1am");
      expect(res.nextLevel).toBe("cem");
      expect(res.nextGradeYear).toBe(1);
      expect(res.nextCycle).toBe("cem");
      expect(res.isGraduation).toBe(false);
    });

    it("should handle Middle School 4 -> High School (Lycée 1) cycle transition", () => {
      const res = getNextGradeProgression("4am");
      expect(res.nextGradeCode).toBe("1ere_annee");
      expect(res.nextLevel).toBe("lycee");
      expect(res.nextGradeYear).toBe(1);
      expect(res.nextCycle).toBe("lycee");
      expect(res.isGraduation).toBe(false);
    });

    it("should trigger graduation when finishing High School 3rd year", () => {
      const res = getNextGradeProgression("3eme_annee");
      expect(res.nextGradeCode).toBeNull();
      expect(res.isGraduation).toBe(true);
    });
  });

  describe("buildPromotionReviewQueue", () => {
    const mockStudents: Student[] = [
      {
        id: "stu-001",
        tenantId: "tenant-1",
        code: "ELV-001",
        parentId: "par-1",
        firstName: "Amine",
        lastName: "Benali",
        gender: "male",
        birthDate: "2015-01-01",
        enrollmentDate: "2022-09-01",
        level: "primaire",
        gradeYear: 4,
        gradeLevel: "4ap",
        classId: "cls-1",
        photoUrl: null,
        medicalNotes: null,
        transportTier: null,
        status: "active",
        paymentPlan: "tranches",
        createdAt: "2022-09-01",
        updatedAt: "2025-09-01",
      },
      {
        id: "stu-002",
        tenantId: "tenant-1",
        code: "ELV-002",
        parentId: "par-2",
        firstName: "Yasmine",
        lastName: "Cherif",
        gender: "female",
        birthDate: "2015-05-12",
        enrollmentDate: "2022-09-01",
        level: "primaire",
        gradeYear: 4,
        gradeLevel: "4ap",
        classId: "cls-1",
        photoUrl: null,
        medicalNotes: null,
        transportTier: null,
        status: "active",
        paymentPlan: "tranches",
        createdAt: "2022-09-01",
        updatedAt: "2025-09-01",
      },
    ];

    const mockSubjects: Subject[] = [
      { id: "sub-1", tenantId: "tenant-1", code: "MATH", name: "Maths", nameAr: null, cycle: "primaire", level: "primaire", coefficient: 4, passingGrade: 10, isExtracurricular: false, isActive: true, teacherId: null, teacherName: null, academicYearId: "ay-2025-2026", academicYearCode: "2025-2026" },
    ];

    const mockAssessments: Assessment[] = [
      // Amine Benali -> Avg 14.0 (Pass)
      { id: "a1", studentId: "stu-001", classId: "cls-1", subjectId: "sub-1", term: "T1", academicYear: "2025-2026", devoir1: 14, devoir2: 14, examen: 14, subjectAverage: 14, coefficient: 4, enteredBy: "teacher-1", enteredAt: "2025-12-01" },
      // Yasmine Cherif -> Avg 8.0 (Fail)
      { id: "a2", studentId: "stu-002", classId: "cls-1", subjectId: "sub-1", term: "T1", academicYear: "2025-2026", devoir1: 8, devoir2: 8, examen: 8, subjectAverage: 8, coefficient: 4, enteredBy: "teacher-1", enteredAt: "2025-12-01" },
    ];

    it("should correctly evaluate candidates against the passing threshold (10.00)", () => {
      const queue = buildPromotionReviewQueue({
        students: mockStudents,
        assessments: mockAssessments,
        subjects: mockSubjects,
        academicYear: "2025-2026",
        targetAcademicYear: "2026-2027",
        passingThreshold: 10.0,
      });

      expect(queue.totalEligibleCount).toBe(2);
      expect(queue.totalPromotedCount).toBe(1);
      expect(queue.totalRetainedCount).toBe(1);

      const candidateAmine = queue.candidates.find((c) => c.student.id === "stu-001");
      const candidateYasmine = queue.candidates.find((c) => c.student.id === "stu-002");

      expect(candidateAmine?.suggestedDecision).toBe("promoted");
      expect(candidateAmine?.nextGradeLevel).toBe("5ap");

      expect(candidateYasmine?.suggestedDecision).toBe("repeated");
      expect(candidateYasmine?.nextGradeLevel).toBe("4ap"); // Stays in current grade
    });
  });

  describe("createAcademicHistoryEntry", () => {
    it("should construct an immutable transcript history record", () => {
      const mockCandidate: PromotionCandidate = {
        student: {
          id: "stu-001",
          tenantId: "tenant-1",
          code: "ELV-001",
          parentId: "par-1",
          firstName: "Amine",
          lastName: "Benali",
          gender: "male",
          birthDate: "2015-01-01",
          enrollmentDate: "2022-09-01",
          level: "primaire",
          gradeYear: 4,
          gradeLevel: "4ap",
          classId: "cls-1",
          photoUrl: null,
          medicalNotes: null,
          transportTier: null,
          status: "active",
          paymentPlan: "tranches",
          createdAt: "2022-09-01",
          updatedAt: "2025-09-01",
        },
        yearlyGpa: 14.5,
        isPassing: true,
        suggestedDecision: "promoted",
        nextGradeLevel: "5ap",
        nextAcademicLevel: "primaire",
        nextGradeYear: 5,
      };

      const entry = createAcademicHistoryEntry(
        mockCandidate,
        "2025-2026",
        "4ème Année A",
        "promoted",
        "Excellent travail ce trimestre."
      );

      expect(entry.studentId).toBe("stu-001");
      expect(entry.academicYear).toBe("2025-2026");
      expect(entry.gpa).toBe(14.5);
      expect(entry.decision).toBe("promoted");
      expect(entry.className).toBe("4ème Année A");
      expect(entry.narrative).toBe("Excellent travail ce trimestre.");
    });
  });
});