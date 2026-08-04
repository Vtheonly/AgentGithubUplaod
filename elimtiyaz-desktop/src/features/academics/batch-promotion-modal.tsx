import { useState } from "react";
import {
  GraduationCap,
  CheckCircle2,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { useBatchPromotion } from "./hooks/use-batch-promotion";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import {
  PROMOTION_DECISION_LABELS_FR,
  type PromotionDecision,
} from "../../domain/model/academic";
import type { PromotionCandidate } from "../../domain/calc/academics/promotion";

export function BatchPromotionModal({
  classId,
  open,
  onOpenChange,
}: {
  classId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const {
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
  } = useBatchPromotion(classId);

  const [filter, setFilter] = useState<"all" | "promoted" | "repeated">("all");

  const filteredCandidates = candidates.filter((c: PromotionCandidate) => {
    if (filter === "promoted")
      return (
        c.suggestedDecision === "promoted" ||
        c.suggestedDecision === "graduated"
      );
    if (filter === "repeated") return c.suggestedDecision === "repeated";
    return true;
  });

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      variant="dialog"
      icon={GraduationCap}
      iconTone="primary"
      title="Passage d'année — Promotion de classe"
      description={`Évaluation de la promotion vers l'année ${targetYear}. La promotion académique est strictement séparée du recouvrement financier.`}
      submitLabel={`Confirmer la promotion (${reviewQueue.totalPromotedCount} admis)`}
      submitIcon={CheckCircle2}
      submitLoading={isSubmitting}
      submitDisabled={candidates.length === 0}
      onSubmit={executePromotion}
      footerLeading={
        <Button
          variant="ghost"
          size="sm"
          onClick={resetOverrides}
          className="text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Réinitialiser les décisions
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Controls & Threshold Header */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-muted/20 rounded-lg border border-border">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Année cible</Label>
            <Input
              value={targetYear}
              onChange={(e) => setTargetYear(e.target.value)}
              placeholder="2026-2027"
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center justify-between">
              <span>Seuil de passage</span>
              <span className="font-mono font-bold text-primary">
                {threshold.toFixed(2)} / 20
              </span>
            </Label>
            <Input
              type="number"
              min={0}
              max={20}
              step={0.25}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value) || 0)}
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Filtrer la liste
            </Label>
            <Select
              value={filter}
              onValueChange={(v) =>
                setFilter(v as "all" | "promoted" | "repeated")
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  Tous les élèves ({candidates.length})
                </SelectItem>
                <SelectItem value="promoted">
                  Admis ({reviewQueue.totalPromotedCount})
                </SelectItem>
                <SelectItem value="repeated">
                  Redoublants ({reviewQueue.totalRetainedCount})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary Counter Banner */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-2.5 rounded-md border border-border bg-card">
            <p className="text-[10px] uppercase text-muted-foreground">
              Éligibles
            </p>
            <p className="text-xl font-mono font-bold text-foreground mt-0.5">
              {reviewQueue.totalEligibleCount}
            </p>
          </div>
          <div className="p-2.5 rounded-md border border-status-success/30 bg-status-success/5">
            <p className="text-[10px] uppercase text-status-success font-semibold">
              Promus / Admis
            </p>
            <p className="text-xl font-mono font-bold text-status-success mt-0.5">
              {reviewQueue.totalPromotedCount}
            </p>
          </div>
          <div className="p-2.5 rounded-md border border-status-warning/30 bg-status-warning/5">
            <p className="text-[10px] uppercase text-status-warning font-semibold">
              Redoublants
            </p>
            <p className="text-xl font-mono font-bold text-status-warning mt-0.5">
              {reviewQueue.totalRetainedCount}
            </p>
          </div>
        </div>

        {/* Candidates Review Table */}
        <div className="border border-border rounded-md overflow-hidden max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground sticky top-0 bg-popover z-10">
              <tr>
                <th className="text-left p-2.5">Élève</th>
                <th className="text-center p-2.5">Moyenne annuelle</th>
                <th className="text-center p-2.5">Décision suggérée</th>
                <th className="text-center p-2.5">Prochain niveau</th>
                <th className="text-right p-2.5">Ajustement manuel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredCandidates.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-xs text-muted-foreground"
                  >
                    Aucun élève dans cette catégorie.
                  </td>
                </tr>
              ) : (
                filteredCandidates.map((c: PromotionCandidate) => {
                  const decisionKey = c.suggestedDecision as PromotionDecision;
                  return (
                    <tr key={c.student.id} className="hover:bg-accent/5">
                      <td className="p-2.5">
                        <p className="font-medium text-foreground">
                          {c.student.firstName} {c.student.lastName}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {c.student.code}
                        </p>
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold">
                        {c.yearlyGpa !== null ? (
                          <span
                            className={
                              c.isPassing
                                ? "text-status-success"
                                : "text-status-danger"
                            }
                          >
                            {c.yearlyGpa.toFixed(2)} / 20
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-center">
                        <StatusChip
                          label={PROMOTION_DECISION_LABELS_FR[decisionKey]}
                          tone={
                            c.suggestedDecision === "promoted" ||
                            c.suggestedDecision === "graduated"
                              ? "success"
                              : "warning"
                          }
                        />
                      </td>
                      <td className="p-2.5 text-center text-xs font-mono text-muted-foreground">
                        {c.nextGradeLevel
                          ? c.nextGradeLevel.toUpperCase()
                          : "Diplômé"}
                      </td>
                      <td className="p-2.5 text-right">
                        <Select
                          value={c.overrideDecision ?? c.suggestedDecision}
                          onValueChange={(v) =>
                            setStudentDecisionOverride(
                              c.student.id,
                              v as PromotionDecision,
                            )
                          }
                        >
                          <SelectTrigger className="h-7 w-32 ml-auto text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="promoted">Promu(e)</SelectItem>
                            <SelectItem value="repeated">Redouble</SelectItem>
                            <SelectItem value="graduated">
                              Diplômé(e)
                            </SelectItem>
                            <SelectItem value="transferred">
                              Transféré(e)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="text-[11px] text-muted-foreground bg-muted/20 p-2.5 rounded-md border border-border flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <span>
            Les élèves promus passeront automatiquement au niveau supérieur.
            L'historique académique sera enregistré de façon permanente dans
            leur dossier (`Student.academicHistory`). Les créances et soldes
            financiers restent rattachés à leurs années respectives.
          </span>
        </div>
      </div>
    </UnifiedModal>
  );
}
