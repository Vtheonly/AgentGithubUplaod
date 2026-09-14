// ============================================================================
// FILE: src/features/academics/hooks/use-class-placement-studio.ts
// ============================================================================
import { useState, useMemo, useCallback } from "react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import type { GradeLevel } from "../../../domain/model/student";
import {
  academicLevelFromGradeLevel,
  gradeYearFromGradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS_FR,
} from "../../../domain/model/student";
import type { AcademicClass } from "../../../domain/model/academic";
import {
  buildPlacementCandidatesPool,
  computeClassCompositionSummary,
  analyzeCohortBalance,
  autoBalancePlacements,
  validatePlacementFinalization,
  type PlacementCandidate,
  type ClassDraft,
  type ClassCompositionSummary,
  type BalanceAnalysisResult,
  type PlacementPoolSummary,
} from "../../../domain/calc/academics/class-placement";

export function useClassPlacementStudio(initialGradeLevel: GradeLevel = "1ap") {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const allStudents = useObservable(() => repos.students.observe(), []);
  const allClasses = useObservable(() => repos.classes.observe(), []);
  const allAcademicYears = useObservable(
    () => repos.academicYears.observeAll(),
    [],
  );
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const allAssessments = useObservable(() => repos.grades.observeAll(), []);
  const allPersonnel = useObservable(() => repos.personnel.observe(), []);

  // Determine current & default target academic year
  const currentYear = useMemo(
    () => allAcademicYears.find((y) => y.isCurrent) ?? allAcademicYears[0],
    [allAcademicYears],
  );

  const defaultTargetYearCode = useMemo(() => {
    if (!currentYear) return "2026-2027";
    const m = /^(\d{4})-(\d{4})$/.exec(currentYear.code);
    return m ? `${Number(m[2])}-${Number(m[2]) + 1}` : "2026-2027";
  }, [currentYear]);

  const [targetYearCode, setTargetYearCode] = useState<string>(
    defaultTargetYearCode,
  );
  const [targetGradeLevel, setTargetGradeLevel] =
    useState<GradeLevel>(initialGradeLevel);

  // In-session temporary assignments map: studentId -> classId (or null for unassigned)
  const [assignedMap, setAssignedMap] = useState<Map<string, string | null>>(
    new Map(),
  );

  // In-session newly created class drafts
  const [customClassDrafts, setCustomClassDrafts] = useState<ClassDraft[]>([]);

  // In-session modified existing classes (room, homeroom teacher, capacity)
  const [modifiedClassPatches, setModifiedClassPatches] = useState<
    Map<string, Partial<ClassDraft>>
  >(new Map());

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Target academic year entity (if exists)
  const targetYearEntity = useMemo(
    () => allAcademicYears.find((y) => y.code === targetYearCode) ?? null,
    [allAcademicYears, targetYearCode],
  );

  const targetYearId = targetYearEntity?.id ?? `ay-${targetYearCode}`;

  // Existing classes in repository matching target year and target grade
  const existingTargetClasses = useMemo(() => {
    return allClasses.filter(
      (c) =>
        (c.academicYear === targetYearCode ||
          c.academicYearId === targetYearId) &&
        c.gradeCode === targetGradeLevel &&
        c.isActive,
    );
  }, [allClasses, targetYearCode, targetYearId, targetGradeLevel]);

  // Combined ClassDrafts for current grade level (existing + newly drafted sections)
  const classDrafts = useMemo<ClassDraft[]>(() => {
    const drafts: ClassDraft[] = existingTargetClasses.map((c) => {
      const patch = modifiedClassPatches.get(c.id);
      return {
        id: c.id,
        name: patch?.name ?? c.name,
        section: patch?.section ?? c.section,
        gradeCode: c.gradeCode,
        level: c.level,
        gradeYear: c.gradeYear,
        academicYearId: c.academicYearId,
        academicYearCode: c.academicYear,
        room: patch?.room !== undefined ? patch.room : c.room,
        capacity: patch?.capacity !== undefined ? patch.capacity : c.capacity,
        homeroomTeacherId:
          patch?.homeroomTeacherId !== undefined
            ? patch.homeroomTeacherId
            : c.homeroomTeacherId,
        homeroomTeacherName:
          patch?.homeroomTeacherName !== undefined
            ? patch.homeroomTeacherName
            : c.homeroomTeacherName,
        notes: patch?.notes !== undefined ? patch.notes : c.notes,
        isNew: false,
      };
    });

    const newDraftsForGrade = customClassDrafts.filter(
      (d) =>
        d.gradeCode === targetGradeLevel &&
        d.academicYearCode === targetYearCode,
    );

    return [...drafts, ...newDraftsForGrade];
  }, [
    existingTargetClasses,
    modifiedClassPatches,
    customClassDrafts,
    targetGradeLevel,
    targetYearCode,
  ]);

  // Build the complete candidate pool of eligible students for this grade
  const rawCandidatePool = useMemo(() => {
    return buildPlacementCandidatesPool({
      students: allStudents,
      targetGradeLevel,
      targetAcademicYear: targetYearCode,
      existingTargetClasses,
      previousAcademicYearCode: currentYear?.code,
      previousClasses: allClasses,
      assessments: allAssessments,
      subjects: allSubjects,
    });
  }, [
    allStudents,
    targetGradeLevel,
    targetYearCode,
    existingTargetClasses,
    currentYear?.code,
    allClasses,
    allAssessments,
    allSubjects,
  ]);

  // Merge in-session assignment state with raw candidate pool
  const candidatePool = useMemo<PlacementCandidate[]>(() => {
    return rawCandidatePool.map((c) => {
      if (assignedMap.has(c.studentId)) {
        const sessionAssigned = assignedMap.get(c.studentId) ?? null;
        return {
          ...c,
          assignedClassId: sessionAssigned,
        };
      }
      return c;
    });
  }, [rawCandidatePool, assignedMap]);

  const unassignedCandidates = useMemo(
    () => candidatePool.filter((c) => c.assignedClassId === null),
    [candidatePool],
  );

  const getAssignedCandidatesForClass = useCallback(
    (classId: string) => {
      return candidatePool.filter((c) => c.assignedClassId === classId);
    },
    [candidatePool],
  );

  // Composition metrics per class
  const classSummaries = useMemo<ClassCompositionSummary[]>(() => {
    return classDrafts.map((draft) => {
      const assigned = candidatePool.filter(
        (c) => c.assignedClassId === draft.id,
      );
      return computeClassCompositionSummary(draft, assigned);
    });
  }, [classDrafts, candidatePool]);

  // Equilibrium & Balance Analysis
  const balanceAnalysis = useMemo<BalanceAnalysisResult>(() => {
    return analyzeCohortBalance(classSummaries);
  }, [classSummaries]);

  // Pool high-level summary
  const poolSummary = useMemo<PlacementPoolSummary>(() => {
    const totalAssigned = candidatePool.filter(
      (c) => c.assignedClassId !== null,
    ).length;
    const promotedTotal = candidatePool.filter(
      (c) => c.provenance === "promoted",
    ).length;
    const repeatingTotal = candidatePool.filter(
      (c) => c.provenance === "repeating",
    ).length;
    const newStudentTotal = candidatePool.filter(
      (c) => c.provenance === "new_student" || c.provenance === "transferred",
    ).length;

    return {
      targetGradeLevel,
      targetAcademicYear: targetYearCode,
      totalEligibleCount: candidatePool.length,
      totalAssignedCount: totalAssigned,
      totalUnassignedCount: unassignedCandidates.length,
      promotedTotal,
      repeatingTotal,
      newStudentTotal,
      classSummaries,
      balanceAnalysis,
    };
  }, [
    candidatePool,
    targetGradeLevel,
    targetYearCode,
    unassignedCandidates.length,
    classSummaries,
    balanceAnalysis,
  ]);

  // Actions
  const assignStudent = useCallback((studentId: string, classId: string) => {
    setAssignedMap((prev) => new Map(prev).set(studentId, classId));
  }, []);

  const unassignStudent = useCallback((studentId: string) => {
    setAssignedMap((prev) => new Map(prev).set(studentId, null));
  }, []);

  const moveStudent = useCallback((studentId: string, toClassId: string) => {
    setAssignedMap((prev) => new Map(prev).set(studentId, toClassId));
  }, []);

  const bulkAssignStudents = useCallback(
    (studentIds: readonly string[], classId: string) => {
      setAssignedMap((prev) => {
        const next = new Map(prev);
        studentIds.forEach((id) => next.set(id, classId));
        return next;
      });
    },
    [],
  );

  const bulkUnassignStudents = useCallback((studentIds: readonly string[]) => {
    setAssignedMap((prev) => {
      const next = new Map(prev);
      studentIds.forEach((id) => next.set(id, null));
      return next;
    });
  }, []);

  const createClassDraft = useCallback(
    (input: {
      name?: string;
      section: string;
      room?: string | null;
      capacity?: number | null;
      homeroomTeacherId?: string | null;
      homeroomTeacherName?: string | null;
      notes?: string | null;
    }) => {
      const level = academicLevelFromGradeLevel(targetGradeLevel);
      const gradeYear = gradeYearFromGradeLevel(targetGradeLevel);
      const derivedName = input.name?.trim()
        ? input.name.trim()
        : `${GRADE_LEVEL_LABELS_FR[targetGradeLevel]} - ${input.section}`;

      const newDraft: ClassDraft = {
        id: `draft-cls-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: derivedName,
        section: input.section,
        gradeCode: targetGradeLevel,
        level,
        gradeYear,
        academicYearId: targetYearId,
        academicYearCode: targetYearCode,
        room: input.room ?? null,
        capacity: input.capacity ?? null,
        homeroomTeacherId: input.homeroomTeacherId ?? null,
        homeroomTeacherName: input.homeroomTeacherName ?? null,
        notes: input.notes ?? null,
        isNew: true,
      };

      setCustomClassDrafts((prev) => [...prev, newDraft]);
      toast.showSuccess(
        "Section ajoutée",
        `« ${derivedName} » est prête pour l'affectation.`,
      );
    },
    [targetGradeLevel, targetYearId, targetYearCode, toast],
  );

  const updateClassDraft = useCallback(
    (classId: string, patch: Partial<ClassDraft>) => {
      setCustomClassDrafts((prev) =>
        prev.map((d) => (d.id === classId ? { ...d, ...patch } : d)),
      );
      setModifiedClassPatches((prev) => {
        const existing = prev.get(classId) ?? {};
        return new Map(prev).set(classId, { ...existing, ...patch });
      });
    },
    [],
  );

  const removeClassDraft = useCallback((classId: string) => {
    setCustomClassDrafts((prev) => prev.filter((d) => d.id !== classId));
    // Unassign any students who were placed in this class
    setAssignedMap((prev) => {
      const next = new Map(prev);
      for (const [sId, cId] of next.entries()) {
        if (cId === classId) next.set(sId, null);
      }
      return next;
    });
  }, []);

  const applyAutoBalance = useCallback(
    (strategy: "balanced" | "gender_first" | "gpa_first" = "balanced") => {
      if (classDrafts.length <= 1) {
        toast.showInfo(
          "Équilibrage impossible",
          "Créez au moins 2 sections pour lancer la répartition automatique.",
        );
        return;
      }
      const mapping = autoBalancePlacements(
        candidatePool,
        classDrafts,
        strategy,
      );
      setAssignedMap((prev) => {
        const next = new Map(prev);
        for (const [studentId, classId] of mapping.entries()) {
          next.set(studentId, classId);
        }
        return next;
      });
      toast.showSuccess(
        "Équilibrage automatique appliqué",
        `${mapping.size} élève(s) répartis de façon homogène entre les ${classDrafts.length} sections.`,
      );
    },
    [classDrafts, candidatePool, toast],
  );

  const resetSessionAssignments = useCallback(() => {
    setAssignedMap(new Map());
    setCustomClassDrafts([]);
    setModifiedClassPatches(new Map());
    toast.showInfo(
      "Session réinitialisée",
      "Toutes les affectations temporaires ont été réinitialisées.",
    );
  }, [toast]);

  // Final commit to repository
  const finalizePlacements = useCallback(async () => {
    if (!session) {
      toast.showError("Erreur d'authentification", "Vous devez être connecté.");
      return;
    }

    const validation = validatePlacementFinalization({
      classes: classDrafts,
      candidates: candidatePool,
      assignedMap: new Map<string, string>(
        [...assignedMap.entries()].filter(
          (entry): entry is [string, string] => entry[1] !== null,
        ),
      ),
    });

    if (!validation.isValid) {
      toast.showError("Validation échouée", validation.errors[0]);
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Prepare new classes payload
      const newClassesPayload = classDrafts
        .filter((d) => d.isNew)
        .map((d) => ({
          code: `CLS-${d.gradeCode.toUpperCase()}-${d.section.replace(/\s+/g, "").toUpperCase()}-${Date.now().toString(36).slice(-3)}`,
          name: d.name,
          gradeCode: d.gradeCode,
          level: d.level,
          gradeYear: d.gradeYear,
          section: d.section,
          room: d.room,
          capacity: d.capacity,
          homeroomTeacherId: d.homeroomTeacherId,
          homeroomTeacherName: d.homeroomTeacherName,
          notes: d.notes,
        }));

      // 2. Prepare classes updates
      const classesUpdatesPayload = Array.from(
        modifiedClassPatches.entries(),
      ).map(([id, patch]) => ({
        id,
        room: patch.room,
        capacity: patch.capacity,
        homeroomTeacherId: patch.homeroomTeacherId,
        homeroomTeacherName: patch.homeroomTeacherName,
        notes: patch.notes,
      }));

      // 3. Prepare student assignments
      const studentAssignmentsPayload = candidatePool
        .filter((c) => c.assignedClassId !== null)
        .map((c) => ({
          studentId: c.studentId,
          targetClassId: c.assignedClassId!,
          gradeLevel: targetGradeLevel,
          level: academicLevelFromGradeLevel(targetGradeLevel),
          gradeYear: gradeYearFromGradeLevel(targetGradeLevel),
        }));

      // Repo has no dedicated classPlacement slot — persist via classes + students.
      for (const newCls of newClassesPayload) {
        await repos.classes.createClass({
          academicYearId: targetYearId,
          academicLevelId: `al-${newCls.gradeCode}`,
          code: newCls.code,
          name: newCls.name,
          gradeCode: newCls.gradeCode,
          level: newCls.level,
          gradeYear: newCls.gradeYear,
          section: newCls.section,
          room: newCls.room,
          capacity: newCls.capacity,
          homeroomTeacherId: newCls.homeroomTeacherId,
          homeroomTeacherName: newCls.homeroomTeacherName,
          notes: newCls.notes,
          academicYear: targetYearCode,
          isActive: true,
        } as any);
      }

      for (const assign of studentAssignmentsPayload) {
        await repos.students.updateStudent(assign.studentId, {
          classId: assign.targetClassId,
          gradeLevel: assign.gradeLevel,
          level: assign.level,
          gradeYear: assign.gradeYear,
        });
      }
      const result = {
        ok: true as const,
        value: {
          createdClasses: [],
          updatedStudentsCount: studentAssignmentsPayload.length,
        },
      };

      void result;
      toast.showSuccess(
        "Constitution des classes validée",
        `${studentAssignmentsPayload.length} élève(s) ont été affectés aux classes de l'année ${targetYearCode}.`,
      );
      setAssignedMap(new Map());
      setCustomClassDrafts([]);
      setModifiedClassPatches(new Map());
    } finally {
      setIsSubmitting(false);
    }
  }, [
    session,
    classDrafts,
    candidatePool,
    assignedMap,
    targetGradeLevel,
    targetYearId,
    targetYearCode,
    modifiedClassPatches,
    repos,
    toast,
  ]);

  return {
    targetYearCode,
    setTargetYearCode,
    targetGradeLevel,
    setTargetGradeLevel,
    availableGradeLevels: GRADE_LEVELS,
    availableYears: allAcademicYears,
    personnel: allPersonnel,
    classDrafts,
    candidatePool,
    unassignedCandidates,
    getAssignedCandidatesForClass,
    classSummaries,
    balanceAnalysis,
    poolSummary,
    assignStudent,
    unassignStudent,
    moveStudent,
    bulkAssignStudents,
    bulkUnassignStudents,
    createClassDraft,
    updateClassDraft,
    removeClassDraft,
    applyAutoBalance,
    resetSessionAssignments,
    finalizePlacements,
    isSubmitting,
  };
}
