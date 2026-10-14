// ============================================================================
// FILE: src/features/academics/hooks/use-class-placement-studio.ts
// ============================================================================
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
import { normalizeTrackCode } from "../../../domain/model/filiere";
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
import {
  placementDraftKey,
  readPlacementDraft,
  writePlacementDraft,
  clearPlacementDraft,
  PLACEMENT_DRAFT_VERSION,
} from "../placement/placement-draft-storage";

/** What the hook exposes about a restored draft (the UI-346 reprise banner). */
export interface RestoredPlacementDraftInfo {
  readonly savedAt: string;
  readonly assignmentCount: number;
  readonly draftSectionCount: number;
}

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

  // ------------------------------------------------------------------
  // UI-346 (T-532, GitHub issue #32 §4 — the "Free List"): the draft
  // persistence. The studio's working state survives navigation, tab
  // switches and application restarts — keyed per tenant + target year +
  // target grade so concurrent contexts never collide. The restore is
  // RE-VALIDATED against the live data (below); finalize and the explicit
  // reset CLEAR the draft (a completed workflow leaves nothing stale).
  // ------------------------------------------------------------------
  const tenantKey = session?.tenantId ?? "default";
  const draftKey = useMemo(
    () => placementDraftKey(tenantKey, targetYearCode, targetGradeLevel),
    [tenantKey, targetYearCode, targetGradeLevel],
  );
  /** The latest-ref pattern: the save effect writes under the CURRENT key
   * even when the context change and the state change land in the same
   * commit. */
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  /** Gate: nothing is written before the restore for the current key has
   * settled (else the initial empty state would clobber the draft). */
  const draftReadyRef = useRef(false);
  /** True while a restored draft awaits its re-validation pass (STATE, not a
   * ref: the validation must run in the commit AFTER the restored values
   * land — a ref flips synchronously and let the validation effect run in
   * the SAME commit with the PRE-restore closure, dropping every assignment
   * to a drafted section as a "vanished class"). */
  const [pendingValidation, setPendingValidation] = useState(false);
  const [restoredDraftInfo, setRestoredDraftInfo] =
    useState<RestoredPlacementDraftInfo | null>(null);

  // The RESTORE — runs on every context (key) change: a draft for the new
  // context replaces the in-memory state; NO draft means a FRESH session
  // for that context (the previous context's leftovers never bleed in —
  // its work was persisted under its own key at its last mutation).
  useEffect(() => {
    draftReadyRef.current = false;
    const draft = readPlacementDraft(draftKey);
    const hasWork =
      !!draft &&
      (draft.assignedMap.length > 0 ||
        draft.customClassDrafts.length > 0 ||
        draft.modifiedClassPatches.length > 0);
    if (draft && hasWork) {
      setAssignedMap(new Map(draft.assignedMap));
      setCustomClassDrafts(draft.customClassDrafts.map((d) => ({ ...d })));
      setModifiedClassPatches(new Map(draft.modifiedClassPatches));
      setRestoredDraftInfo({
        savedAt: draft.savedAt,
        assignmentCount: draft.assignedMap.filter(([, cId]) => cId !== null).length,
        draftSectionCount: draft.customClassDrafts.length,
      });
      setPendingValidation(true);
    } else {
      setAssignedMap(new Map());
      setCustomClassDrafts([]);
      setModifiedClassPatches(new Map());
      setRestoredDraftInfo(null);
      setPendingValidation(false);
    }
    draftReadyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // The SAVE — every state mutation persists the working draft under the
  // CURRENT context key; an emptied state (post-finalize / post-reset)
  // CLEARS the draft instead of writing an empty husk.
  useEffect(() => {
    if (!draftReadyRef.current) return;
    const key = draftKeyRef.current;
    const hasWork =
      assignedMap.size > 0 ||
      customClassDrafts.length > 0 ||
      modifiedClassPatches.size > 0;
    if (!hasWork) {
      clearPlacementDraft(key);
      return;
    }
    writePlacementDraft(key, {
      version: PLACEMENT_DRAFT_VERSION,
      targetYearCode,
      targetGradeLevel,
      assignedMap: Array.from(assignedMap.entries()),
      customClassDrafts,
      modifiedClassPatches: Array.from(modifiedClassPatches.entries()),
      savedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedMap, customClassDrafts, modifiedClassPatches]);

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
        // T-401: the section's classification (existing class → its own;
        // the patch layer deliberately does not change classification).
        filiereCode: c.filiereCode ?? null,
        specialiteCode: c.specialiteCode ?? null,
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

  // The RE-VALIDATION (UI-346) — once per restore, gated on the students
  // cache having loaded (an empty pool while loading must never drop a
  // draft): students no longer eligible drop out; assignments to classes
  // that no longer exist (or are inactive) drop back to the reserve
  // HONESTLY — never a silent ghost; patches for deleted classes drop.
  useEffect(() => {
    if (!pendingValidation) return;
    if (allStudents.length === 0) return;
    const poolIds = new Set(rawCandidatePool.map((c) => c.studentId));
    const validClassIds = new Set<string>([
      ...existingTargetClasses.map((c) => c.id),
      ...customClassDrafts.map((d) => d.id),
    ]);
    let droppedStudents = 0;
    let droppedClassTargets = 0;
    const nextAssignments = new Map<string, string | null>();
    for (const [studentId, classId] of assignedMap.entries()) {
      if (!poolIds.has(studentId)) {
        droppedStudents += 1;
        continue;
      }
      if (classId !== null && !validClassIds.has(classId)) {
        droppedClassTargets += 1;
        continue;
      }
      nextAssignments.set(studentId, classId);
    }
    const nextPatches = new Map<string, Partial<ClassDraft>>();
    for (const [classId, patch] of modifiedClassPatches.entries()) {
      if (existingTargetClasses.some((c) => c.id === classId)) {
        nextPatches.set(classId, patch);
      }
    }
    setAssignedMap(nextAssignments);
    setModifiedClassPatches(nextPatches);
    setPendingValidation(false);
    // Nothing survived the re-validation → there is no reprise to announce.
    if (
      nextAssignments.size === 0 &&
      customClassDrafts.length === 0 &&
      nextPatches.size === 0
    ) {
      setRestoredDraftInfo(null);
    }
    if (droppedStudents > 0 || droppedClassTargets > 0) {
      const parts: string[] = [];
      if (droppedStudents > 0) {
        parts.push(`${droppedStudents} élève(s) sorti(s) du registre éligible`);
      }
      if (droppedClassTargets > 0) {
        parts.push(`${droppedClassTargets} affectation(s) vers une classe disparue`);
      }
      toast.showInfo(
        "Session reprise — ajustements",
        `${parts.join(" · ")} : ces éléments obsolètes ont été écartés de la reprise.`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingValidation, rawCandidatePool, existingTargetClasses, customClassDrafts, allStudents.length, assignedMap, modifiedClassPatches]);

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
      /** T-401: the new section's academic stream (null = untagged). */
      filiereCode?: string | null;
      /** T-401: the new section's spécialité (null = none). */
      specialiteCode?: string | null;
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
        // T-401: the drafted classification (normalized: "general" → untagged).
        filiereCode: normalizeTrackCode(input.filiereCode),
        specialiteCode: normalizeTrackCode(input.specialiteCode),
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
    setRestoredDraftInfo(null);
    // UI-346: a deliberate reset DISCARDS the persisted draft — the
    // operator explicitly chose to start this context over.
    clearPlacementDraft(draftKeyRef.current);
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
      // T-370 (ACAD-500): ONE atomic repository call — the whole batch
      // (section creations + existing-section patches + student assignments
      // + the class.placement_finalize audit entry) commits or rolls back
      // together server-side. This replaces the 08f7f13 sequential
      // classes+students loop whose defects were: students pointed at
      // "draft-cls-…" ids that never existed (the created classes' real ids
      // were discarded), every repository Result silently swallowed, and
      // the existing-class patches computed but never persisted.
      const newDraftIds = new Set(
        classDrafts.filter((d) => d.isNew).map((d) => d.id),
      );

      const newClassesPayload = classDrafts
        .filter((d) => d.isNew)
        .map((d) => ({
          clientDraftId: d.id,
          code: `CLS-${d.gradeCode.toUpperCase()}-${d.section.replace(/\s+/g, "").toUpperCase()}-${Date.now().toString(36).slice(-3)}`,
          name: d.name,
          gradeCode: d.gradeCode,
          section: d.section,
          // T-401: the drafted classification (0107 server-side validated).
          filiereCode: d.filiereCode,
          specialiteCode: d.specialiteCode,
          room: d.room,
          capacity: d.capacity,
          homeroomTeacherId: d.homeroomTeacherId,
          homeroomTeacherName: d.homeroomTeacherName,
        }));

      // Patches to EXISTING classes only (the repository contract requires
      // real class ids here — a draft id is a contract violation the server
      // rejects).
      const classesUpdatesPayload = Array.from(
        modifiedClassPatches.entries(),
      )
        .filter(([id]) => !newDraftIds.has(id))
        .map(([id, patch]) => ({
          id,
          ...(patch.room !== undefined ? { room: patch.room } : {}),
          ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
          ...(patch.homeroomTeacherId !== undefined
            ? { homeroomTeacherId: patch.homeroomTeacherId }
            : {}),
          ...(patch.homeroomTeacherName !== undefined
            ? { homeroomTeacherName: patch.homeroomTeacherName }
            : {}),
        }));

      const studentAssignmentsPayload = candidatePool
        .filter((c) => c.assignedClassId !== null)
        .map((c) => ({
          studentId: c.studentId,
          targetClassId: c.assignedClassId!,
          gradeLevel: targetGradeLevel,
          level: academicLevelFromGradeLevel(targetGradeLevel),
          gradeYear: gradeYearFromGradeLevel(targetGradeLevel),
        }));

      const result = await repos.classPlacement.finalizePlacements({
        targetAcademicYearId: targetYearEntity?.id ?? null,
        targetAcademicYearCode: targetYearCode,
        newClasses: newClassesPayload,
        classesToUpdate: classesUpdatesPayload,
        studentAssignments: studentAssignmentsPayload,
        performedBy: session.userId,
        performedByName: session.displayName,
      });

      if (!result.ok) {
        // Honest failure surfacing (the WEAK-019/DATA-013 family rule): the
        // batch either committed atomically or NOTHING landed — never a
        // partial success with a congratulatory toast.
        toast.showError(
          "Échec de la constitution des classes",
          result.error.userMessage,
        );
        return;
      }

      toast.showSuccess(
        "Constitution des classes validée",
        `${result.value.assignedStudentsCount} élève(s) affecté(s), ` +
          `${result.value.createdClassesCount} section(s) créée(s) pour l'année ${targetYearCode}.`,
      );
      setAssignedMap(new Map());
      setCustomClassDrafts([]);
      setModifiedClassPatches(new Map());
      setRestoredDraftInfo(null);
      // UI-346: a FINALIZED workflow leaves no stale draft behind — the
      // committed constitution is now the server's truth (students.class_id).
      clearPlacementDraft(draftKeyRef.current);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    session,
    classDrafts,
    candidatePool,
    assignedMap,
    targetGradeLevel,
    targetYearEntity,
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
    /** UI-346 (T-532): non-null right after a draft restore — the reprise
     * banner's data (the draft's age + the restored work's size). */
    restoredDraftInfo,
  };
}
// TEMP DEBUG
