import type { AcademicLevel, GradeLevel, Student } from "../../model/student";
import {
  DEFAULT_PASSING_GRADE,
  type AcademicCycle,
  type AcademicHistoryEntry,
  type Assessment,
  type PromotionDecision,
  type Subject,
} from "../../model/academic";
import { evaluateStudentTermPerformance, rankClassPerformance } from "./gpa";

export interface PromotionCandidate {
  readonly student: Student;
  readonly yearlyGpa: number | null;
  readonly suggestedDecision: PromotionDecision;
  readonly isPassing: boolean;
  readonly nextGradeLevel: GradeLevel | null;
  readonly nextAcademicLevel: AcademicLevel | null;
  readonly nextGradeYear: number | null;
  readonly overrideDecision?: PromotionDecision;
  readonly note?: string;
}

export interface PromotionReviewQueue {
  readonly academicYear: string;
  readonly targetAcademicYear: string;
  readonly passingThreshold: number;
  readonly candidates: readonly PromotionCandidate[];
  readonly totalEligibleCount: number;
  readonly totalPromotedCount: number;
  readonly totalRetainedCount: number;
}

/**
 * Next grade progression map following the Algerian National Education System:
 * Primary (5 yrs): prescolaire_1 -> prescolaire_2 -> 1ap -> 2ap -> 3ap -> 4ap -> 5ap -> 1am
 * CEM (4 yrs)    : 1am -> 2am -> 3am -> 4am -> 1ere_annee
 * Lycée (3 yrs)  : 1ere_annee -> 2eme_annee -> 3eme_annee -> GRADUATED
 */
export function getNextGradeProgression(current: GradeLevel): {
  nextGradeCode: GradeLevel | null;
  nextLevel: AcademicLevel | null;
  nextGradeYear: number | null;
  nextCycle: AcademicCycle | null;
  isGraduation: boolean;
} {
  switch (current) {
    case "prescolaire_1":
      return { nextGradeCode: "prescolaire_2", nextLevel: "primaire", nextGradeYear: 0, nextCycle: "prescolaire", isGraduation: false };
    case "prescolaire_2":
      return { nextGradeCode: "1ap", nextLevel: "primaire", nextGradeYear: 1, nextCycle: "primaire", isGraduation: false };
    case "1ap":
      return { nextGradeCode: "2ap", nextLevel: "primaire", nextGradeYear: 2, nextCycle: "primaire", isGraduation: false };
    case "2ap":
      return { nextGradeCode: "3ap", nextLevel: "primaire", nextGradeYear: 3, nextCycle: "primaire", isGraduation: false };
    case "3ap":
      return { nextGradeCode: "4ap", nextLevel: "primaire", nextGradeYear: 4, nextCycle: "primaire", isGraduation: false };
    case "4ap":
      return { nextGradeCode: "5ap", nextLevel: "primaire", nextGradeYear: 5, nextCycle: "primaire", isGraduation: false };
    case "5ap":
      // Cycle Transition: Primary Grade 5 -> Middle School (CEM Year 1)
      return { nextGradeCode: "1am", nextLevel: "cem", nextGradeYear: 1, nextCycle: "cem", isGraduation: false };
    case "1am":
      return { nextGradeCode: "2am", nextLevel: "cem", nextGradeYear: 2, nextCycle: "cem", isGraduation: false };
    case "2am":
      return { nextGradeCode: "3am", nextLevel: "cem", nextGradeYear: 3, nextCycle: "cem", isGraduation: false };
    case "3am":
      return { nextGradeCode: "4am", nextLevel: "cem", nextGradeYear: 4, nextCycle: "cem", isGraduation: false };
    case "4am":
      // Cycle Transition: Middle School Year 4 -> High School (Lycée Year 1)
      return { nextGradeCode: "1ere_annee", nextLevel: "lycee", nextGradeYear: 1, nextCycle: "lycee", isGraduation: false };
    case "1ere_annee":
      return { nextGradeCode: "2eme_annee", nextLevel: "lycee", nextGradeYear: 2, nextCycle: "lycee", isGraduation: false };
    case "2eme_annee":
      return { nextGradeCode: "3eme_annee", nextLevel: "lycee", nextGradeYear: 3, nextCycle: "lycee", isGraduation: false };
    case "3eme_annee":
      // Final Graduation from Scolarité
      return { nextGradeCode: null, nextLevel: null, nextGradeYear: null, nextCycle: null, isGraduation: true };
    default:
      return { nextGradeCode: null, nextLevel: null, nextGradeYear: null, nextCycle: null, isGraduation: false };
  }
}

/**
 * Evaluates promotion candidates for a class or student list.
 * Decoupled from payment collection.
 */
export function buildPromotionReviewQueue(input: {
  students: readonly Student[];
  assessments: readonly Assessment[];
  subjects: readonly Subject[];
  academicYear: string;
  targetAcademicYear: string;
  passingThreshold?: number;
}): PromotionReviewQueue {
  const threshold = input.passingThreshold ?? DEFAULT_PASSING_GRADE;

  const perStudentEvals = input.students.map((student) => {
    const studentAssessments = input.assessments.filter((a) => a.studentId === student.id);
    return evaluateStudentTermPerformance(student.id, studentAssessments, input.subjects, threshold);
  });

  const ranked = rankClassPerformance(perStudentEvals);
  const rankMap = new Map(ranked.map((r) => [r.studentId, r]));

  const candidates: PromotionCandidate[] = input.students.map((student) => {
    const evalResult = rankMap.get(student.id);
    const gpa = evalResult?.gpa ?? null;
    const isPass = gpa !== null && gpa >= threshold;

    const progression = getNextGradeProgression(student.gradeLevel);

    let suggestedDecision: PromotionDecision;
    if (gpa === null) {
      suggestedDecision = "repeated"; // Default retain if no grades entered
    } else if (progression.isGraduation && isPass) {
      suggestedDecision = "graduated";
    } else if (isPass) {
      suggestedDecision = "promoted";
    } else {
      suggestedDecision = "repeated";
    }

    return {
      student,
      yearlyGpa: gpa,
      isPassing: isPass,
      suggestedDecision,
      nextGradeLevel: suggestedDecision === "promoted" ? progression.nextGradeCode : student.gradeLevel,
      nextAcademicLevel: suggestedDecision === "promoted" ? progression.nextLevel : student.level,
      nextGradeYear: suggestedDecision === "promoted" ? progression.nextGradeYear : student.gradeYear,
    };
  });

  const promotedCount = candidates.filter((c) => c.suggestedDecision === "promoted" || c.suggestedDecision === "graduated").length;
  const retainedCount = candidates.filter((c) => c.suggestedDecision === "repeated").length;

  return {
    academicYear: input.academicYear,
    targetAcademicYear: input.targetAcademicYear,
    passingThreshold: threshold,
    candidates,
    totalEligibleCount: candidates.length,
    totalPromotedCount: promotedCount,
    totalRetainedCount: retainedCount,
  };
}

/**
 * Creates the immutable Academic History Entry to append to a student's permanent profile.
 */
export function createAcademicHistoryEntry(
  candidate: PromotionCandidate,
  academicYear: string,
  className: string | null,
  finalDecision: PromotionDecision,
  narrative?: string | null,
): AcademicHistoryEntry {
  const cycle: AcademicCycle = candidate.student.level === "primaire"
    ? (candidate.student.gradeLevel.startsWith("prescolaire") ? "prescolaire" : "primaire")
    : (candidate.student.level as AcademicCycle);

  return {
    studentId: candidate.student.id,
    academicYear,
    cycle,
    level: candidate.student.level,
    gradeCode: candidate.student.gradeLevel,
    gradeYear: candidate.student.gradeYear,
    classId: candidate.student.classId,
    className,
    gpa: candidate.yearlyGpa ?? 0,
    rank: null,
    decision: finalDecision,
    narrative: narrative ?? null,
  };
}