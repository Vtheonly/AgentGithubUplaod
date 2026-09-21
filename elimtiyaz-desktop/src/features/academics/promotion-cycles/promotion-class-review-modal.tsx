/**
 * T-403 — the per-class review step of the promotion cycle.
 *
 * THE human-in-the-loop unit: load the class's students + academic
 * information, show the proposed destination + decision (the SAME canonical
 * engine as the batch flow — buildPromotionReviewQueue, never a second
 * algorithm), let the reviewer override individual decisions, warn when
 * notes are incomplete, and require the explicit class confirmation.
 *
 * The confirmation goes through repos.promotionCycles.confirmClass →
 * fn_confirm_promotion_cycle_class → execute_batch_promotion (ONE business
 * path). The server's [NOTES_INCOMPLETES] two-phase ack surfaces as the
 * task-mandated blocking warning.
 */
import { useEffect, useMemo, useState } from "react";
import { GraduationCap, AlertTriangle, Users } from "lucide-react";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { FormField } from "../../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import {
  buildPromotionReviewQueue,
  buildPromotionDecisionPayload,
  type PromotionCandidate,
} from "../../../domain/calc/academics/promotion";
import {
  PROMOTION_DECISION_LABELS_FR,
  DEFAULT_PASSING_GRADE,
  type PromotionDecision,
} from "../../../domain/model/academic";
import {
  findStudentsWithIncompleteNotes,
  incompleteNotesWarning,
  type PromotionCycle,
  type PromotionCycleClass,
} from "../../../domain/model/promotion-cycle";

export function PromotionClassReviewModal({
  cycle,
  cycleClass,
  open,
  onOpenChange,
  onConfirmed,
}: {
  cycle: PromotionCycle;
  cycleClass: PromotionCycleClass;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirmed?: () => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const students = useObservable(
    () => repos.students.observeByClass(cycleClass.classId),
    [cycleClass.classId],
  );
  const assessments = useObservable(
    () => repos.grades.observeForClass(cycleClass.classId),
    [cycleClass.classId],
  );
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const cls = useObservable(
    () => repos.classes.observeById(cycleClass.classId),
    [cycleClass.classId],
  );

  const sourceAcademicYear = cycle.sourceAcademicYear;
  const targetAcademicYear = cycle.targetAcademicYear;

  const [threshold, setThreshold] = useState<number>(DEFAULT_PASSING_GRADE);
  const [overrides, setOverrides] = useState<Map<string, PromotionDecision>>(new Map());
  const [confirming, setConfirming] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    // Reset the review state whenever the class changes.
    setOverrides(new Map());
    setWarning(null);
    setThreshold(DEFAULT_PASSING_GRADE);
  }, [cycleClass.classId, cycle.id]);

  const reviewQueue = useMemo(
    () =>
      buildPromotionReviewQueue({
        students,
        assessments,
        subjects,
        academicYear: sourceAcademicYear,
        targetAcademicYear,
        passingThreshold: threshold,
      }),
    [students, assessments, subjects, sourceAcademicYear, targetAcademicYear, threshold],
  );

  const candidates: PromotionCandidate[] = useMemo(
    () =>
      reviewQueue.candidates.map((c) => {
        const override = overrides.get(c.student.id);
        if (!override) return c;
        return { ...c, overrideDecision: override, suggestedDecision: override };
      }),
    [reviewQueue, overrides],
  );

  // The client-side pre-visualization of the incomplete-notes warning (the
  // server enforces the same rule — the two-phase ack).
  const incomplete = useMemo(
    () => findStudentsWithIncompleteNotes(students, assessments as never, sourceAcademicYear),
    [students, assessments, sourceAcademicYear],
  );

  const setStudentDecisionOverride = (studentId: string, decision: PromotionDecision) => {
    setOverrides((prev) => new Map(prev).set(studentId, decision));
  };

  async function confirm(ackIncompleteNotes: boolean) {
    if (!session) {
      toast.showError("Erreur d'authentification", "Vous devez être connecté.");
      return;
    }
    setConfirming(true);
    setWarning(null);
    try {
      const decisions = buildPromotionDecisionPayload(
        candidates.map((c) => ({
          candidate: c,
          finalDecision: c.overrideDecision ?? c.suggestedDecision,
        })),
        sourceAcademicYear,
      );

      const result = await repos.promotionCycles.confirmClass({
        cycleId: cycle.id,
        classId: cycleClass.classId,
        decisions,
        acknowledgeIncompleteNotes: ackIncompleteNotes,
        performedBy: session.userId,
        performedByName: session.displayName,
      });

      if (result.ok) {
        toast.showSuccess(
          "Classe confirmée",
          `« ${cycleClass.className} » : ${result.value.promoted} promu(s), ${result.value.repeated} redoublant(s), ${result.value.deferred} dérogation(s).`,
        );
        onOpenChange(false);
        onConfirmed?.();
      } else {
        // The OPS-320 honesty convention: the technical message carries the
        // server marker; the FR userMessage is the fallback.
        const msg = result.error.message || result.error.userMessage || "";
        if (msg.includes("[NOTES_INCOMPLETES]")) {
          // The task-mandated blocking warning — the explicit confirmation.
          setWarning(msg.replace("[NOTES_INCOMPLETES] ", ""));
        } else {
          toast.showError("Échec de la confirmation", msg);
        }
      }
    } finally {
      setConfirming(false);
    }
  }

  const isProcessed = cycleClass.status === "processed";

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="dialog"
      size="xl"
      icon={GraduationCap}
      iconTone="primary"
      title={`Examen de la classe — ${cycleClass.className}`}
      description={`Cycle de promotion ${sourceAcademicYear} → ${targetAcademicYear} · ${candidates.length} élève(s) à décider`}
      submitLabel={isProcessed ? "Classe déjà traitée" : "Confirmer la classe"}
      submitIcon={GraduationCap}
      onSubmit={() => confirm(false)}
      submitLoading={confirming}
      submitDisabled={confirming || isProcessed}
    >
      <div className="space-y-3">
        {/* The threshold control (the same review lever as the batch flow). */}
        <div className="flex items-end gap-3 flex-wrap">
          <FormField
            label="Seuil de passage"
            hint="Moyenne minimale pour la proposition « Admis »"
            className="w-44"
          >
            <Input
              type="number"
              min={0}
              max={20}
              step={0.25}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value) || 0)}
            />
          </FormField>
          <div className="text-xs text-muted-foreground pb-2">
            Année archivée : <span className="font-mono">{sourceAcademicYear}</span> →
            destination : <span className="font-mono">{targetAcademicYear}</span>
          </div>
        </div>

        {/* The incomplete-notes warning (client-side pre-visualization). */}
        {incomplete.length > 0 && !warning && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{incompleteNotesWarning(incomplete)}</p>
              <p className="text-muted-foreground mt-1">
                Les moyennes manquantes ne sont jamais traitées comme zéro — la décision
                proposée pour ces élèves est « Redoublement » tant que les notes ne sont
                pas complètes.
              </p>
            </div>
          </div>
        )}

        {/* The server-enforced blocking warning (the two-phase ack). */}
        {warning && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <p className="font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Les notes ne sont pas toutes renseignées
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{warning}</p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => confirm(true)}
                disabled={confirming}
              >
                Oui, continuer la confirmation
              </Button>
              <Button size="sm" variant="outline" onClick={() => setWarning(null)}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        {/* The decision table. */}
        <div className="rounded-lg border border-border overflow-hidden max-h-[45vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr className="text-left text-muted-foreground">
                <th className="p-2 font-medium">Élève</th>
                <th className="p-2 font-medium">Moyenne annuelle</th>
                <th className="p-2 font-medium">Rang</th>
                <th className="p-2 font-medium">Destination</th>
                <th className="p-2 font-medium">Décision</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const decision = c.overrideDecision ?? c.suggestedDecision;
                const hasIncomplete = incomplete.some((s) => s.id === c.student.id);
                return (
                  <tr key={c.student.id} className="border-t border-border">
                    <td className="p-2">
                      <span className="font-medium">
                        {c.student.displayName ?? `${c.student.firstName} ${c.student.lastName}`}
                      </span>
                      {hasIncomplete && (
                        <Badge variant="outline" className="ml-2 text-[10px] border-warning/50 text-warning">
                          notes incomplètes
                        </Badge>
                      )}
                    </td>
                    <td className="p-2 font-mono">
                      {c.yearlyGpa != null ? c.yearlyGpa.toFixed(2) : "— à paraître"}
                    </td>
                    <td className="p-2 font-mono">{c.isPassing ? "Admis" : "Non admis"}</td>
                    <td className="p-2">
                      {c.nextGradeLevel ? (
                        <Badge variant="outline">{c.nextGradeLevel}</Badge>
                      ) : (
                        <Badge variant="secondary">Fin de scolarité</Badge>
                      )}
                    </td>
                    <td className="p-2 w-44">
                      <Select
                        value={decision}
                        onValueChange={(v) =>
                          setStudentDecisionOverride(c.student.id, v as PromotionDecision)
                        }
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(PROMOTION_DECISION_LABELS_FR) as PromotionDecision[]).map(
                            (d) => (
                              <SelectItem key={d} value={d}>
                                {PROMOTION_DECISION_LABELS_FR[d]}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
              {candidates.length === 0 && (
                <tr className="border-t border-border">
                  <td colSpan={5} className="p-4 text-center text-muted-foreground">
                    <Users className="h-4 w-4 inline mr-1" />
                    Aucun élève actif dans cette classe.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          La confirmation traite la classe entière dans UNE transaction (historique
          append-only + niveau suivant + désaffectation de la classe). Les décisions
          individuelles restent modifiables avant la confirmation ; après confirmation,
          la classe peut être rouverte tant que le cycle n'est pas terminé.
          {cls ? "" : ""}
        </p>
      </div>
    </UnifiedModal>
  );
}
