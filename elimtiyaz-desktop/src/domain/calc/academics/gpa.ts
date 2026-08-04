import {
  computeSubjectAverage,
  computeOverallGpa,
  isPassing,
  validateScore,
  DEFAULT_PASSING_GRADE,
  type Assessment,
  type Subject,
} from "../../model/academic";

export interface StudentGpaResult {
  readonly studentId: string;
  readonly gpa: number | null;
  readonly isPassing: boolean;
  readonly evaluatedAssessmentsCount: number;
  readonly missingAssessmentsCount: number;
}

export interface StudentRankResult extends StudentGpaResult {
  readonly rank: number | null;
  readonly totalStudentsInClass: number;
}

/**
 * Calculates GPA and evaluates passing status for a single student given their assessments.
 */
export function evaluateStudentTermPerformance(
  studentId: string,
  assessments: readonly Assessment[],
  subjects: readonly Subject[],
  passingThreshold = DEFAULT_PASSING_GRADE,
): StudentGpaResult {
  const studentAssessments = assessments.filter((a) => a.studentId === studentId);
  
  const mapped = studentAssessments.map((a) => {
    const subject = subjects.find((s) => s.id === a.subjectId);
    return {
      subjectAverage: a.subjectAverage ?? computeSubjectAverage(a.devoir1, a.devoir2, a.examen),
      coefficient: a.coefficient || subject?.coefficient || 1,
      isExtracurricular: subject?.isExtracurricular ?? false,
    };
  });

  const gpa = computeOverallGpa(mapped);
  const evaluatedCount = mapped.filter((m) => m.subjectAverage !== null).length;
  const missingCount = mapped.filter((m) => m.subjectAverage === null).length;

  return {
    studentId,
    gpa,
    isPassing: gpa !== null ? isPassing(gpa, passingThreshold) : false,
    evaluatedAssessmentsCount: evaluatedCount,
    missingAssessmentsCount: missingCount,
  };
}

/**
 * Computes class rankings based on overall GPAs.
 * Ranks are assigned in descending order of GPA. Ties share the same rank.
 */
export function rankClassPerformance(
  studentPerformances: readonly StudentGpaResult[],
): StudentRankResult[] {
  const valid = studentPerformances
    .filter((p): p is StudentGpaResult & { gpa: number } => p.gpa !== null)
    .sort((a, b) => b.gpa - a.gpa);

  const total = studentPerformances.length;
  const rankMap = new Map<string, number>();

  let currentRank = 1;
  for (let i = 0; i < valid.length; i++) {
    if (i > 0 && valid[i].gpa < valid[i - 1].gpa) {
      currentRank = i + 1;
    }
    rankMap.set(valid[i].studentId, currentRank);
  }

  return studentPerformances.map((p) => ({
    ...p,
    rank: p.gpa !== null ? (rankMap.get(p.studentId) ?? null) : null,
    totalStudentsInClass: total,
  }));
}

/**
 * Validates a complete set of marks for a single subject assessment entry.
 */
export function validateAssessmentInput(input: {
  devoir1?: number | null;
  devoir2?: number | null;
  examen?: number | null;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (input.devoir1 != null && !validateScore(input.devoir1)) {
    errors.push("Le Devoir 1 doit être une note valide comprise entre 0 et 20.");
  }
  if (input.devoir2 != null && !validateScore(input.devoir2)) {
    errors.push("Le Devoir 2 doit être une note valide comprise entre 0 et 20.");
  }
  if (input.examen != null && !validateScore(input.examen)) {
    errors.push("L'Examen doit être une note valide comprise entre 0 et 20.");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}