// ============================================================================
// FILE: src/domain/calc/academics/class-placement.ts
// ============================================================================
/**
 * Class Formation & Student Placement Calculation Engine.
 *
 * PEDAGOGICAL & BUSINESS PRINCIPLES:
 * 1. Heterogeneous Cohorts (Cohortes Hétérogènes):
 *    When preparing a new academic year, classes at a target grade level (e.g. "3AP" or "1AM")
 *    are composed of diverse student profiles:
 *      - Promoted students from the previous grade level (e.g. 2AP -> 3AP).
 *      - Repeating students who failed the current grade level in the previous year (e.g. repeated 3AP).
 *      - Newly registered or transferred students entering at this grade level.
 *      - Students reassigned from another section of the same grade level.
 *    The engine NEVER assumes a naive 1-to-1 migration from a single old class to a single new class.
 *
 * 2. Strict Historical Immutability (Non-Rétroactivité & Préservation d'Historique):
 *    A student's previous academic history (grades, assessments, attendances, and AcademicHistoryEntry records)
 *    belongs permanently to the previous academic year. Assigning a student to a new class in the upcoming
 *    academic year updates their active placement pointers (`classId`, `gradeLevel`, `level`, `gradeYear`)
 *    without mutating, deleting, or overwriting historical transcripts.
 *
 * 3. 4-Dimensional Cohort Equilibrium (Équilibre & Parité Pédagogique):
 *    To prevent "ghettoization" (concentrating all struggling students or all repeaters in one section),
 *    the engine analyzes and balances sections across 4 key dimensions:
 *      - Headcount Parity (Equal class sizes ±2 students).
 *      - Gender Parity (Balanced boys vs girls distribution).
 *      - Repeater Dispersion (Spreading repeating students evenly across sections).
 *      - Academic Strength Spread (Serpentine GPA distribution to ensure balanced averages).
 *
 * 4. Pure Functional Design:
 *    All calculations, provenance evaluations, summaries, and balancing algorithms are 100% pure functions,
 *    deterministic, and free of side-effects.
 */

import type {
  Student,
  GradeLevel,
  AcademicLevel,
  Gender,
} from "../../model/student";
import {
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS_FR,
  academicLevelFromGradeLevel,
  gradeYearFromGradeLevel,
} from "../../model/student";
import type { AcademicClass, Assessment, Subject } from "../../model/academic";
import { computeOverallGpa, computeSubjectAverage } from "../../model/academic";
import { getNextGradeProgression } from "./promotion";

/** Provenance origin of a student for the upcoming academic year placement. */
export type StudentPlacementProvenance =
  | "promoted"
  | "repeating"
  | "new_student"
  | "transferred"
  | "administrative";

export const PROVENANCE_LABELS_FR: Record<StudentPlacementProvenance, string> =
  {
    promoted: "Promu(e)",
    repeating: "Redoublant(e)",
    new_student: "Nouvel inscrit",
    transferred: "Transféré(e)",
    administrative: "Affectation administrative",
  };

export const PROVENANCE_DESCRIPTIONS_FR: Record<
  StudentPlacementProvenance,
  string
> = {
  promoted:
    "Admis(e) au niveau supérieur suite aux résultats de l'année précédente.",
  repeating:
    "Maintien dans le niveau suite aux résultats de l'année précédente.",
  new_student: "Nouvelle inscription sans historique académique interne.",
  transferred: "Élève transféré depuis un autre établissement scolaire.",
  administrative: "Placement manuel ou dérogation administrative accordée.",
};

/** Candidate student eligible for placement in a target grade level. */
export interface PlacementCandidate {
  readonly student: Student;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentCode: string;
  readonly gender: Gender;
  readonly provenance: StudentPlacementProvenance;
  readonly originGradeLevel: GradeLevel | null;
  readonly originClassName: string | null;
  readonly previousGpa: number | null;
  readonly previousRank: number | null;
  readonly isPassing: boolean | null;
  readonly currentClassId: string | null;
  /** Class ID assigned during the active placement session (null = unassigned). */
  readonly assignedClassId: string | null;
  readonly notes?: string | null;
}

/** Working draft of a class for the target academic year. */
export interface ClassDraft {
  readonly id: string;
  readonly name: string;
  readonly section: string;
  readonly gradeCode: GradeLevel;
  readonly level: AcademicLevel;
  readonly gradeYear: number;
  readonly academicYearId: string;
  readonly academicYearCode: string;
  readonly room: string | null;
  readonly capacity: number | null;
  readonly homeroomTeacherId: string | null;
  readonly homeroomTeacherName: string | null;
  readonly notes: string | null;
  readonly isNew: boolean;
}

/** Composition metrics for a single section. */
export interface ClassCompositionSummary {
  readonly classId: string;
  readonly className: string;
  readonly section: string;
  readonly gradeCode: GradeLevel;
  readonly totalAssigned: number;
  readonly capacity: number | null;
  readonly fillRatePct: number | null;
  readonly promotedCount: number;
  readonly repeatingCount: number;
  readonly newStudentCount: number;
  readonly boysCount: number;
  readonly girlsCount: number;
  readonly genderRatioBoysPct: number;
  readonly averagePreviousGpa: number | null;
  readonly gpaMin: number | null;
  readonly gpaMax: number | null;
}

/** Diagnostic analysis of balance across all sections of a grade level. */
export interface BalanceAnalysisResult {
  readonly isBalanced: boolean;
  readonly balanceScore: number; // 0 to 100
  readonly warnings: readonly string[];
  readonly recommendations: readonly string[];
}

/** Summary of the entire grade level placement pool. */
export interface PlacementPoolSummary {
  readonly targetGradeLevel: GradeLevel;
  readonly targetAcademicYear: string;
  readonly totalEligibleCount: number;
  readonly totalAssignedCount: number;
  readonly totalUnassignedCount: number;
  readonly promotedTotal: number;
  readonly repeatingTotal: number;
  readonly newStudentTotal: number;
  readonly classSummaries: readonly ClassCompositionSummary[];
  readonly balanceAnalysis: BalanceAnalysisResult;
}

/**
 * Returns the immediate predecessor grade in the progression pipeline.
 * Inverse of `getNextGradeProgression`.
 *
 * Example:
 *   3AP -> 2AP
 *   1AM (CEM 1) -> 5AP (Primaire 5)
 *   1ere_annee (Lycée 1) -> 4AM (CEM 4)
 */
export function getPreviousGrade(grade: GradeLevel): GradeLevel | null {
  switch (grade) {
    case "prescolaire_1":
      return null;
    case "prescolaire_2":
      return "prescolaire_1";
    case "1ap":
      return "prescolaire_2";
    case "2ap":
      return "1ap";
    case "3ap":
      return "2ap";
    case "4ap":
      return "3ap";
    case "5ap":
      return "4ap";
    case "1am":
      return "5ap";
    case "2am":
      return "1am";
    case "3am":
      return "2am";
    case "4am":
      return "3am";
    case "1ere_annee":
      return "4am";
    case "2eme_annee":
      return "1ere_annee";
    case "3eme_annee":
      return "2eme_annee";
    default:
      return null;
  }
}

/**
 * Evaluates the provenance and historical academic data of a student
 * relative to a target grade level.
 */
export function determineStudentProvenance(
  student: Student,
  targetGrade: GradeLevel,
  previousYearCode?: string,
): {
  provenance: StudentPlacementProvenance;
  originGradeLevel: GradeLevel | null;
  previousGpa: number | null;
  previousRank: number | null;
  originClassName: string | null;
  isPassing: boolean | null;
} {
  const history = student.academicHistory ?? [];

  // Look for the most relevant history entry
  const relevantEntry = previousYearCode
    ? (history.find((h) => h.academicYear === previousYearCode) ??
      history[history.length - 1])
    : history[history.length - 1];

  if (relevantEntry) {
    const isPass =
      relevantEntry.decision === "promoted" ||
      relevantEntry.decision === "graduated";

    if (relevantEntry.decision === "repeated") {
      return {
        provenance: "repeating",
        originGradeLevel: relevantEntry.gradeCode,
        previousGpa: relevantEntry.gpa,
        previousRank: relevantEntry.rank,
        originClassName: relevantEntry.className,
        isPassing: false,
      };
    }

    if (relevantEntry.decision === "promoted") {
      const nextProgression = getNextGradeProgression(relevantEntry.gradeCode);
      if (nextProgression.nextGradeCode === targetGrade) {
        return {
          provenance: "promoted",
          originGradeLevel: relevantEntry.gradeCode,
          previousGpa: relevantEntry.gpa,
          previousRank: relevantEntry.rank,
          originClassName: relevantEntry.className,
          isPassing: true,
        };
      }
    }

    if (relevantEntry.decision === "transferred") {
      return {
        provenance: "transferred",
        originGradeLevel: relevantEntry.gradeCode,
        previousGpa: relevantEntry.gpa,
        previousRank: relevantEntry.rank,
        originClassName: relevantEntry.className,
        isPassing: isPass,
      };
    }
  }

  // If no history entry exists, evaluate current student attributes
  const prevGradeOfTarget = getPreviousGrade(targetGrade);
  if (student.gradeLevel === prevGradeOfTarget) {
    return {
      provenance: "promoted",
      originGradeLevel: prevGradeOfTarget,
      previousGpa: null,
      previousRank: null,
      originClassName: null,
      isPassing: true,
    };
  }

  if (student.gradeLevel === targetGrade) {
    return {
      provenance: "new_student",
      originGradeLevel: targetGrade,
      previousGpa: null,
      previousRank: null,
      originClassName: null,
      isPassing: null,
    };
  }

  return {
    provenance: "administrative",
    originGradeLevel: student.gradeLevel,
    previousGpa: null,
    previousRank: null,
    originClassName: null,
    isPassing: null,
  };
}

/**
 * Builds the comprehensive candidate pool for a specific grade level in the target academic year.
 * Gathers promoted students from predecessor grade, repeating students, and new registrations.
 */
export function buildPlacementCandidatesPool(params: {
  readonly students: readonly Student[];
  readonly targetGradeLevel: GradeLevel;
  readonly targetAcademicYear: string;
  readonly existingTargetClasses: readonly AcademicClass[];
  readonly previousAcademicYearCode?: string;
  readonly previousClasses?: readonly AcademicClass[];
  readonly assessments?: readonly Assessment[];
  readonly subjects?: readonly Subject[];
}): PlacementCandidate[] {
  const {
    students,
    targetGradeLevel,
    targetAcademicYear,
    existingTargetClasses,
    previousAcademicYearCode,
    previousClasses = [],
    assessments = [],
    subjects = [],
  } = params;

  const prevGrade = getPreviousGrade(targetGradeLevel);
  const targetClassIds = new Set(existingTargetClasses.map((c) => c.id));
  const prevClassMap = new Map(previousClasses.map((c) => [c.id, c.name]));

  const candidates: PlacementCandidate[] = [];

  for (const s of students) {
    if (s.status !== "active") continue;

    // Check if the student is eligible for targetGradeLevel
    const history = s.academicHistory ?? [];
    const latestHistory = previousAcademicYearCode
      ? (history.find((h) => h.academicYear === previousAcademicYearCode) ??
        history[history.length - 1])
      : history[history.length - 1];

    let isEligible = false;

    if (latestHistory) {
      // 1. Promoted into target grade
      if (
        latestHistory.decision === "promoted" &&
        getNextGradeProgression(latestHistory.gradeCode).nextGradeCode ===
          targetGradeLevel
      ) {
        isEligible = true;
      }
      // 2. Repeating target grade
      else if (
        latestHistory.decision === "repeated" &&
        latestHistory.gradeCode === targetGradeLevel
      ) {
        isEligible = true;
      }
      // 3. Transferred or registered with target grade
      else if (s.gradeLevel === targetGradeLevel) {
        isEligible = true;
      }
    } else {
      // No history recorded yet: check student's current gradeLevel or lower grade
      if (
        s.gradeLevel === targetGradeLevel ||
        (prevGrade && s.gradeLevel === prevGrade)
      ) {
        isEligible = true;
      }
    }

    if (!isEligible) continue;

    const {
      provenance,
      originGradeLevel,
      previousGpa,
      previousRank,
      originClassName,
      isPassing,
    } = determineStudentProvenance(
      s,
      targetGradeLevel,
      previousAcademicYearCode,
    );

    // If GPA wasn't stored on history, calculate it from assessments if available
    let resolvedGpa = previousGpa;
    if (resolvedGpa === null && assessments.length > 0 && subjects.length > 0) {
      const studentAssessments = assessments.filter(
        (a) => a.studentId === s.id,
      );
      if (studentAssessments.length > 0) {
        const mapped = studentAssessments.map((a) => ({
          subjectAverage:
            a.subjectAverage ??
            computeSubjectAverage(a.devoir1, a.devoir2, a.examen),
          coefficient: a.coefficient || 1,
          isExtracurricular:
            subjects.find((sub) => sub.id === a.subjectId)?.isExtracurricular ??
            false,
        }));
        resolvedGpa = computeOverallGpa(mapped);
      }
    }

    // Determine current assignment in target year
    const assignedClassId =
      s.classId && targetClassIds.has(s.classId) ? s.classId : null;
    const resolvedOriginClassName =
      originClassName ??
      (s.classId && prevClassMap.get(s.classId)
        ? prevClassMap.get(s.classId)!
        : null);

    candidates.push({
      student: s,
      studentId: s.id,
      studentName:
        `${s.firstName} ${s.lastName}`.trim() || s.displayName || s.id,
      studentCode: s.code,
      gender: s.gender,
      provenance,
      originGradeLevel,
      originClassName: resolvedOriginClassName,
      previousGpa: resolvedGpa,
      previousRank,
      isPassing,
      currentClassId: s.classId,
      assignedClassId,
      notes: s.medicalNotes,
    });
  }

  // Sort candidates: unassigned first, then by provenance (repeaters, then promoted by GPA desc)
  return candidates.sort((a, b) => {
    if (a.assignedClassId === null && b.assignedClassId !== null) return -1;
    if (a.assignedClassId !== null && b.assignedClassId === null) return 1;
    if (a.provenance === "repeating" && b.provenance !== "repeating") return -1;
    if (a.provenance !== "repeating" && b.provenance === "repeating") return 1;
    return (b.previousGpa ?? 0) - (a.previousGpa ?? 0);
  });
}

/**
 * Computes composition metrics and gender breakdown for a specific section draft.
 */
export function computeClassCompositionSummary(
  classDraft: ClassDraft,
  assignedCandidates: readonly PlacementCandidate[],
): ClassCompositionSummary {
  const totalAssigned = assignedCandidates.length;
  const capacity = classDraft.capacity;
  const fillRatePct =
    capacity && capacity > 0
      ? Math.round((totalAssigned / capacity) * 100)
      : null;

  const promotedCount = assignedCandidates.filter(
    (c) => c.provenance === "promoted",
  ).length;
  const repeatingCount = assignedCandidates.filter(
    (c) => c.provenance === "repeating",
  ).length;
  const newStudentCount = assignedCandidates.filter(
    (c) =>
      c.provenance === "new_student" ||
      c.provenance === "transferred" ||
      c.provenance === "administrative",
  ).length;

  const boysCount = assignedCandidates.filter(
    (c) => c.gender === "male",
  ).length;
  const girlsCount = assignedCandidates.filter(
    (c) => c.gender === "female",
  ).length;
  const genderRatioBoysPct =
    totalAssigned > 0 ? Math.round((boysCount / totalAssigned) * 100) : 50;

  const gpas = assignedCandidates
    .map((c) => c.previousGpa)
    .filter((g): g is number => g !== null && Number.isFinite(g));

  const averagePreviousGpa =
    gpas.length > 0
      ? Number((gpas.reduce((sum, g) => sum + g, 0) / gpas.length).toFixed(2))
      : null;

  const gpaMin = gpas.length > 0 ? Math.min(...gpas) : null;
  const gpaMax = gpas.length > 0 ? Math.max(...gpas) : null;

  return {
    classId: classDraft.id,
    className: classDraft.name,
    section: classDraft.section,
    gradeCode: classDraft.gradeCode,
    totalAssigned,
    capacity,
    fillRatePct,
    promotedCount,
    repeatingCount,
    newStudentCount,
    boysCount,
    girlsCount,
    genderRatioBoysPct,
    averagePreviousGpa,
    gpaMin,
    gpaMax,
  };
}

/**
 * Analyzes parity, size balance, repeater concentration, and GPA spread across multiple sections.
 */
export function analyzeCohortBalance(
  summaries: readonly ClassCompositionSummary[],
): BalanceAnalysisResult {
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (summaries.length <= 1) {
    return {
      isBalanced: true,
      balanceScore: 100,
      warnings: [],
      recommendations: ["Section unique configurée pour ce niveau."],
    };
  }

  let score = 100;

  // 1. Headcount spread check
  const headcounts = summaries.map((s) => s.totalAssigned);
  const minCount = Math.min(...headcounts);
  const maxCount = Math.max(...headcounts);
  const spread = maxCount - minCount;

  if (spread >= 5) {
    score -= Math.min(30, spread * 5);
    warnings.push(
      `Déséquilibre d'effectif significatif : écart de ${spread} élèves entre les sections (${minCount} vs ${maxCount}).`,
    );
    recommendations.push(
      "Répartir les élèves pour harmoniser la taille des groupes (écart recommandé ≤ 2 élèves).",
    );
  }

  // 2. Repeater concentration check
  const repeaterCounts = summaries.map((s) => s.repeatingCount);
  const totalRepeaters = repeaterCounts.reduce((a, b) => a + b, 0);
  if (totalRepeaters >= 2) {
    const maxRepeaters = Math.max(...repeaterCounts);
    const minRepeaters = Math.min(...repeaterCounts);
    if (
      maxRepeaters - minRepeaters >= 3 ||
      (summaries.length >= 2 && maxRepeaters / totalRepeaters >= 0.75)
    ) {
      score -= 25;
      warnings.push(
        `Concentration de redoublants détectée : une section regroupe ${maxRepeaters} sur ${totalRepeaters} élèves redoublants.`,
      );
      recommendations.push(
        "Disperser les élèves redoublants de manière homogène entre les classes pour faciliter l'accompagnement pédagogique.",
      );
    }
  }

  // 3. Gender parity check
  for (const s of summaries) {
    if (s.totalAssigned >= 6) {
      if (s.genderRatioBoysPct > 75 || s.genderRatioBoysPct < 25) {
        score -= 20;
        warnings.push(
          `Déséquilibre fille/garçon en ${s.className} (${s.boysCount} 👦 / ${s.girlsCount} 👧 — ${s.genderRatioBoysPct}% garçons).`,
        );
        recommendations.push(
          `Rééquilibrer la mixité fille/garçon de la classe ${s.className}.`,
        );
        break;
      }
    }
  }

  // 4. Academic average spread check
  const gpas = summaries
    .map((s) => s.averagePreviousGpa)
    .filter((g): g is number => g !== null);
  if (gpas.length >= 2) {
    const minGpa = Math.min(...gpas);
    const maxGpa = Math.max(...gpas);
    const gpaSpread = maxGpa - minGpa;
    if (gpaSpread >= 2.0) {
      score -= 20;
      warnings.push(
        `Écart académique entre sections : différence de ${gpaSpread.toFixed(2)} pts sur les moyennes précédentes (${minGpa.toFixed(2)} vs ${maxGpa.toFixed(2)}).`,
      );
      recommendations.push(
        "Appliquer une répartition serpentine des moyennes pour harmoniser le niveau global des classes.",
      );
    }
  }

  score = Math.max(0, Math.min(100, score));

  return {
    isBalanced: score >= 75 && warnings.length === 0,
    balanceScore: score,
    warnings,
    recommendations,
  };
}

/**
 * Intelligent multi-criteria Serpentine Auto-Balancing Algorithm.
 *
 * Algorithm Strategy:
 * 1. Distributes repeating students equally across all sections.
 * 2. Distributes promoted boys in Serpentine GPA order (highest to lowest across classes 0..K-1, then K-1..0).
 * 3. Distributes promoted girls in reverse Serpentine GPA order to maintain simultaneous GPA & gender balance.
 * 4. Distributes newly enrolled / unranked students to equalize remaining headcounts.
 *
 * Returns a Map of `studentId -> classId`.
 */
export function autoBalancePlacements(
  candidates: readonly PlacementCandidate[],
  classes: readonly ClassDraft[],
  strategy: "balanced" | "gender_first" | "gpa_first" = "balanced",
): Map<string, string> {
  const result = new Map<string, string>();
  const K = classes.length;

  if (K === 0 || candidates.length === 0) return result;
  if (K === 1) {
    // Single class: all students go to this class
    candidates.forEach((c) => result.set(c.studentId, classes[0].id));
    return result;
  }

  // Track class load for even distribution
  const classBuckets: string[][] = Array.from({ length: K }, () => []);

  // 1. Separate candidates by provenance & gender
  const repeaters = candidates.filter((c) => c.provenance === "repeating");
  const promotedBoys = candidates
    .filter((c) => c.provenance === "promoted" && c.gender === "male")
    .sort((a, b) => (b.previousGpa ?? 0) - (a.previousGpa ?? 0));
  const promotedGirls = candidates
    .filter((c) => c.provenance === "promoted" && c.gender === "female")
    .sort((a, b) => (b.previousGpa ?? 0) - (a.previousGpa ?? 0));
  const otherCandidates = candidates.filter(
    (c) => c.provenance !== "repeating" && c.provenance !== "promoted",
  );

  // Phase A: Distribute repeaters evenly across classes
  let classPointer = 0;
  for (const r of repeaters) {
    classBuckets[classPointer].push(r.studentId);
    classPointer = (classPointer + 1) % K;
  }

  // Phase B: Serpentine distribution of Promoted Boys by GPA
  let forward = true;
  let boyPointer = 0;
  for (const b of promotedBoys) {
    classBuckets[boyPointer].push(b.studentId);
    if (strategy === "gender_first") {
      boyPointer = (boyPointer + 1) % K;
    } else {
      if (forward) {
        if (boyPointer === K - 1) forward = false;
        else boyPointer++;
      } else {
        if (boyPointer === 0) forward = true;
        else boyPointer--;
      }
    }
  }

  // Phase C: Reverse Serpentine distribution of Promoted Girls by GPA
  let girlPointer = K - 1;
  let girlForward = false;
  for (const g of promotedGirls) {
    classBuckets[girlPointer].push(g.studentId);
    if (strategy === "gender_first") {
      girlPointer = (girlPointer - 1 + K) % K;
    } else {
      if (!girlForward) {
        if (girlPointer === 0) girlForward = true;
        else girlPointer--;
      } else {
        if (girlPointer === K - 1) girlForward = false;
        else girlPointer++;
      }
    }
  }

  // Phase D: Distribute remaining candidates (new students, transfers) to smallest bucket
  for (const other of otherCandidates) {
    // Find bucket with smallest current size
    let minIdx = 0;
    for (let i = 1; i < K; i++) {
      if (classBuckets[i].length < classBuckets[minIdx].length) {
        minIdx = i;
      }
    }
    classBuckets[minIdx].push(other.studentId);
  }

  // Build final mapping
  for (let i = 0; i < K; i++) {
    const classId = classes[i].id;
    for (const studentId of classBuckets[i]) {
      result.set(studentId, classId);
    }
  }

  return result;
}

/**
 * Validates the draft configuration before persisting to repository.
 */
export function validatePlacementFinalization(params: {
  readonly classes: readonly ClassDraft[];
  readonly candidates: readonly PlacementCandidate[];
  readonly assignedMap: ReadonlyMap<string, string>;
}): { isValid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (params.classes.length === 0) {
    errors.push(
      "Au moins une classe doit être définie pour enregistrer la répartition.",
    );
  }

  // Check unique section names
  const sectionNames = new Set<string>();
  for (const c of params.classes) {
    if (!c.name.trim()) {
      errors.push("Chaque classe doit avoir un nom valide.");
    }
    if (sectionNames.has(c.name.toLowerCase().trim())) {
      errors.push(`Deux classes portent le même nom : « ${c.name} »`);
    }
    sectionNames.add(c.name.toLowerCase().trim());
  }

  // Count unassigned
  let unassignedCount = 0;
  for (const cand of params.candidates) {
    if (
      !params.assignedMap.has(cand.studentId) &&
      cand.assignedClassId === null
    ) {
      unassignedCount++;
    }
  }

  if (unassignedCount > 0) {
    warnings.push(
      `${unassignedCount} élève(s) éligible(s) restent non affecté(s) à une classe. Ils pourront être placés ultérieurement.`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
