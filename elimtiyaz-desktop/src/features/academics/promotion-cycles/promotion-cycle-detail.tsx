/**
 * T-403 — the cycle detail: the class worklist + the whole-cycle actions.
 *
 * The reviewer works through the source year's classes ONE AT A TIME
 * (Examiner → review → confirm). A processed class stays auditable and
 * reopenable while the cycle is not completed. Completing the cycle
 * requires every class processed / exception / skipped — the button shows
 * what is missing otherwise. The class-formation handoff (Constitution des
 * classes) is the downstream step after completion.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  GraduationCap,
  RotateCcw,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import {
  PROMOTION_CYCLE_STATUS_LABELS_FR,
  PROMOTION_CYCLE_CLASS_STATUS_LABELS_FR,
  type PromotionCycle,
  type PromotionCycleClass,
} from "../../../domain/model/promotion-cycle";
import { PromotionClassReviewModal } from "./promotion-class-review-modal";

function classStatusTone(status: PromotionCycleClass["status"]): string {
  switch (status) {
    case "processed":
      return "bg-success/15 text-success";
    case "exception":
    case "in_review":
      return "bg-warning/15 text-warning";
    case "skipped":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted/60 text-foreground";
  }
}

export function PromotionCycleDetail({
  cycle,
  onBack,
  onCycleUpdated,
}: {
  cycle: PromotionCycle;
  onBack: () => void | Promise<void>;
  onCycleUpdated: (cycle: PromotionCycle) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const [classes, setClasses] = useState<readonly PromotionCycleClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<PromotionCycleClass | null>(null);
  const [completing, setCompleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await repos.promotionCycles.getCycleClasses(cycle.id);
    if (result.ok) setClasses(result.value);
    else toast.showError("Échec du chargement", result.error.userMessage);
    setLoading(false);
  }, [repos, cycle.id, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isClosed = cycle.status === "completed" || cycle.status === "cancelled";
  const allResolved =
    classes.length > 0 &&
    classes.every(
      (c) => c.status === "processed" || c.status === "exception" || c.status === "skipped",
    );
  const processedCount = classes.filter((c) => c.status === "processed").length;

  async function completeCycle() {
    if (!session) return;
    setCompleting(true);
    try {
      const result = await repos.promotionCycles.completeCycle(
        cycle.id,
        session.userId,
        session.displayName,
      );
      if (result.ok) {
        toast.showSuccess(
          "Cycle terminé",
          `Le cycle ${cycle.sourceAcademicYear} → ${cycle.targetAcademicYear} est terminé. Passez à la constitution des classes.`,
        );
        await onBack();
      } else {
        toast.showError("Terminaison impossible", result.error.userMessage);
      }
    } finally {
      setCompleting(false);
    }
  }

  async function reopenClass(row: PromotionCycleClass) {
    if (!session) return;
    const result = await repos.promotionCycles.reopenClass(
      cycle.id,
      row.classId,
      null,
      session.userId,
      session.displayName,
    );
    if (result.ok) {
      toast.showSuccess("Classe rouverte", `« ${row.className} » est de nouveau en révision.`);
      await refresh();
    } else {
      toast.showError("Réouverture impossible", result.error.userMessage);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void onBack()}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Cycles
            </Button>
            <div>
              <p className="text-sm font-bold flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-primary" />
                Cycle {cycle.sourceAcademicYear} → {cycle.targetAcademicYear}
                <Badge variant="secondary" className="text-[10px]">
                  {PROMOTION_CYCLE_STATUS_LABELS_FR[cycle.status]}
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                {processedCount}/{classes.length} classe(s) traitée(s)
                {cycle.studentsAwaiting > 0 ? ` · ${cycle.studentsAwaiting} élève(s) en attente de décision` : ""}
                {cycle.promotedCount + cycle.repeatingCount > 0
                  ? ` · ${cycle.promotedCount} promu(s), ${cycle.repeatingCount} redoublant(s), ${cycle.deferredCount} dérogation(s)`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {cycle.status === "completed" ? (
              <Badge variant="secondary" className="bg-success/15 text-success">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Cycle terminé
              </Badge>
            ) : isClosed ? (
              <Badge variant="secondary">Cycle annulé</Badge>
            ) : (
              <Button
                size="sm"
                variant="default"
                onClick={() => void completeCycle()}
                disabled={completing || !allResolved}
                title={
                  allResolved
                    ? "Terminer le cycle"
                    : "Toutes les classes doivent être traitées (ou en dérogation / ignorées) avant de terminer le cycle"
                }
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Terminer le cycle
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Chargement des classes…</p>
          ) : classes.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Aucune classe active pour l'année {cycle.sourceAcademicYear} — le cycle peut être
              terminé directement.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left text-muted-foreground">
                  <th className="p-2.5 font-medium">Classe</th>
                  <th className="p-2.5 font-medium">Niveau</th>
                  <th className="p-2.5 font-medium">Statut</th>
                  <th className="p-2.5 font-medium">En attente</th>
                  <th className="p-2.5 font-medium">P / R / D</th>
                  <th className="p-2.5 font-medium">Traité par</th>
                  <th className="p-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((row) => (
                  <tr key={row.id} className="border-t border-border hover:bg-accent/5">
                    <td className="p-2.5">
                      <span className="font-medium">{row.className}</span>
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">{row.classCode}</span>
                    </td>
                    <td className="p-2.5 font-mono">{row.gradeCode}</td>
                    <td className="p-2.5">
                      <Badge variant="secondary" className={`text-[10px] ${classStatusTone(row.status)}`}>
                        {PROMOTION_CYCLE_CLASS_STATUS_LABELS_FR[row.status]}
                      </Badge>
                    </td>
                    <td className="p-2.5 font-mono">
                      {row.status === "processed" || row.status === "skipped" ? "—" : (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          {row.studentsAwaiting}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 font-mono text-muted-foreground">
                      {row.promotedCount} / {row.repeatingCount} / {row.deferredCount}
                    </td>
                    <td className="p-2.5 text-muted-foreground">
                      {row.processedByName ?? "—"}
                      {row.processedAt ? ` · ${new Date(row.processedAt).toLocaleDateString("fr-FR")}` : ""}
                    </td>
                    <td className="p-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {(row.status === "pending" || row.status === "in_review") && !isClosed && (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            onClick={() => setReviewing(row)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Examiner
                          </Button>
                        )}
                        {(row.status === "processed" || row.status === "exception" || row.status === "skipped") &&
                          !isClosed && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => void reopenClass(row)}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" />
                              Rouvrir
                            </Button>
                          )}
                        {isClosed && <span className="text-muted-foreground">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {cycle.status === "completed" && (
        <Card>
          <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              Le cycle est terminé — l'étape suivante est la constitution des classes de
              l'année {cycle.targetAcademicYear} (la répartition consomme le résultat de la
              promotion sans réparation manuelle).
            </p>
            <a href="#/academics?tab=classes" className="text-xs">
              <Button size="sm" variant="outline">
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                Constitution des classes
              </Button>
            </a>
          </CardContent>
        </Card>
      )}

      {!allResolved && !isClosed && classes.length > 0 && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <XCircle className="h-3.5 w-3.5" />
          Le bouton « Terminer le cycle » s'activera quand toutes les classes seront
          traitées — classes restantes :{" "}
          {classes
            .filter((c) => c.status !== "processed" && c.status !== "exception" && c.status !== "skipped")
            .map((c) => c.className)
            .join(", ")}
        </p>
      )}

      {reviewing && (
        <PromotionClassReviewModal
          cycle={cycle}
          cycleClass={reviewing}
          open={!!reviewing}
          onOpenChange={(o) => {
            if (!o) setReviewing(null);
          }}
          onConfirmed={() => {
            void refresh();
            // Re-read the cycle aggregates after a class confirmation.
            repos.promotionCycles.listCycles().then((result) => {
              if (result.ok) {
                const updated = result.value.find((c) => c.id === cycle.id);
                if (updated) onCycleUpdated(updated);
              }
            });
          }}
        />
      )}
    </div>
  );
}
