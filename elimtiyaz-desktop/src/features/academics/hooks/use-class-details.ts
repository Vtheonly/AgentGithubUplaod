import { useState, useMemo } from "react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import {
  buildPromotionReviewQueue,
  type PromotionCandidate,
} from "../../../domain/calc/academics/promotion";
import type { PromotionDecision } from "../../../domain/model/academic";
import { DEFAULT_PASSING_GRADE } from "../../../domain/model/academic";

export function useBatchPromotion(classId: string) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const students = useObservable(
    () => repos.students.observeByClass(classId),
    [classId],
  );
  const assessments = useObservable(
    () => repos.grades.observeForClass(classId),
    [classId],
  );
  const subjects = useObservable(() => repos.subjects.observe(), []);

  const [threshold, setThreshold] = useState<number>(DEFAULT_PASSING_GRADE);
  const [targetYear, setTargetYear] = useState<string>("2026-2027");
  const [overrides, setOverrides] = useState<Map<string, PromotionDecision>>(
    new Map(),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Compute the queue dynamically using the domain promotion engine
  const reviewQueue = useMemo(() => {
    return buildPromotionReviewQueue({
      students,
      assessments,
      subjects,
      academicYear: "2025-2026",
      targetAcademicYear: targetYear,
      passingThreshold: threshold,
    });
  }, [students, assessments, subjects, targetYear, threshold]);

  const candidates = useMemo(() => {
    return reviewQueue.candidates.map((c) => {
      const override = overrides.get(c.student.id);
      if (!override) return c;
      return {
        ...c,
        overrideDecision: override,
        suggestedDecision: override,
      };
    });
  }, [reviewQueue, overrides]);

  const setStudentDecisionOverride = (
    studentId: string,
    decision: PromotionDecision,
  ) => {
    setOverrides((prev) => new Map(prev).set(studentId, decision));
  };

  const resetOverrides = () => setOverrides(new Map());

  const executePromotion = async () => {
    if (!session) {
      toast.showError("Erreur d'authentification", "Vous devez être connecté.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = candidates.map((c) => ({
        candidate: c,
        finalDecision: c.overrideDecision ?? c.suggestedDecision,
      }));

      const result = await repos.promotion.executeBatchPromotion({
        candidates: payload,
        targetAcademicYear: targetYear,
        performedBy: session.userId,
        performedByName: session.displayName,
      });

      if (result.ok) {
        toast.showSuccess(
          "Promotion effectuée",
          `${result.value.updatedCount} élève(s) promus vers l'année ${targetYear}.`,
        );
        resetOverrides();
      } else {
        toast.showError("Échec de la promotion", result.error.userMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    threshold,
    setThreshold,
    targetYear,
    setTargetYear,
    candidates,
    reviewQueue,
    setStudentDecisionOverride,
    resetOverrides,
    executePromotion,
    isSubmitting,
  };
}
