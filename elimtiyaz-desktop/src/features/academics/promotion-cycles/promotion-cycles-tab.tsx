/**
 * T-403 — the Batch Promotion Cycles table (the dedicated area).
 *
 * One row per (tenant, source academic year): source → target year, the
 * cycle status, the aggregated counts (classes processed / total, students
 * awaiting, promoted, repeating, deferred), the audit fields, and the
 * actions (open / continue / inspect). Creating a cycle surfaces the NEXT
 * academic year as the primary source (the year being completed).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { GraduationCap, Plus, RefreshCcw, RotateCcw, CheckCircle2, XCircle, Eye, Users } from "lucide-react";
import { Card, CardContent } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import {
  PROMOTION_CYCLE_STATUS_LABELS_FR,
  type PromotionCycle,
  type PromotionCycleStatus,
} from "../../../domain/model/promotion-cycle";
import { PromotionCycleDetail } from "./promotion-cycle-detail";

function statusTone(status: PromotionCycleStatus): string {
  switch (status) {
    case "completed":
      return "bg-success/15 text-success";
    case "cancelled":
      return "bg-muted text-muted-foreground";
    case "partially_processed":
      return "bg-primary/15 text-primary";
    case "in_review":
      return "bg-warning/15 text-warning";
    default:
      return "bg-muted/60 text-foreground";
  }
}

export function PromotionCyclesTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const academicYears = useObservable(() => repos.academicYears.observeAll(), []);
  const [cycles, setCycles] = useState<readonly PromotionCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<PromotionCycle | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await repos.promotionCycles.listCycles();
    if (result.ok) setCycles(result.value);
    else toast.showError("Échec du chargement", result.error.userMessage);
    setLoading(false);
  }, [repos, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The next academic year = the CURRENT year being completed (the primary
  // source for a fresh cycle); the target is derived (+1).
  const currentYear = academicYears.find((y) => y.isCurrent);
  const defaultSourceYear = currentYear?.code ?? currentYear?.label ?? "2026-2027";
  const nextTargetYear = (() => {
    const m = /^(\d{4})-(\d{4})$/.exec(defaultSourceYear);
    return m ? `${m[2]}-${Number(m[2]) + 1}` : "2027-2028";
  })();

  const existingSources = useMemo(
    () => new Set(cycles.filter((c) => c.status !== "cancelled").map((c) => c.sourceAcademicYear)),
    [cycles],
  );

  async function createCycle() {
    if (!session) return;
    setCreating(true);
    try {
      const result = await repos.promotionCycles.openOrCreateCycle({
        sourceAcademicYear: defaultSourceYear,
        targetAcademicYear: nextTargetYear,
        performedBy: session.userId,
        performedByName: session.displayName,
      });
      if (result.ok) {
        toast.showSuccess(
          "Cycle de promotion créé",
          `${result.value.sourceAcademicYear} → ${result.value.targetAcademicYear} : ${result.value.classesTotal} classe(s) à examiner.`,
        );
        await refresh();
        setSelected(result.value);
      } else {
        toast.showError("Échec de la création", result.error.userMessage);
      }
    } finally {
      setCreating(false);
    }
  }

  if (selected) {
    return (
      <PromotionCycleDetail
        cycle={selected}
        onBack={async () => {
          setSelected(null);
          await refresh();
        }}
        onCycleUpdated={(updated) => setSelected(updated)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Cycles de promotion par année scolaire</p>
            <p>
              Chaque année se traite comme UN cycle : chaque classe est examinée puis
              confirmée une à une (jamais en un seul clic global).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1" />
              Actualiser
            </Button>
            <Button size="sm" onClick={() => void createCycle()} disabled={creating || existingSources.has(defaultSourceYear)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {existingSources.has(defaultSourceYear)
                ? `Cycle ${defaultSourceYear} déjà ouvert`
                : `Nouveau cycle — ${defaultSourceYear} → ${nextTargetYear}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Chargement des cycles…</p>
          ) : cycles.length === 0 ? (
            <div className="p-8 text-center">
              <GraduationCap className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Aucun cycle de promotion</p>
              <p className="text-xs text-muted-foreground mt-1">
                Créez le cycle de l'année courante (« {defaultSourceYear} → {nextTargetYear} »)
                pour commencer la revue classe par classe.
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left text-muted-foreground">
                  <th className="p-2.5 font-medium">Année source</th>
                  <th className="p-2.5 font-medium">Année cible</th>
                  <th className="p-2.5 font-medium">Statut</th>
                  <th className="p-2.5 font-medium">Classes</th>
                  <th className="p-2.5 font-medium">Élèves en attente</th>
                  <th className="p-2.5 font-medium">Promus / Redoublants / Dérogations</th>
                  <th className="p-2.5 font-medium">Dernière activité</th>
                  <th className="p-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-accent/5">
                    <td className="p-2.5 font-mono">{c.sourceAcademicYear}</td>
                    <td className="p-2.5 font-mono">{c.targetAcademicYear}</td>
                    <td className="p-2.5">
                      <Badge variant="secondary" className={`text-[10px] ${statusTone(c.status)}`}>
                        {PROMOTION_CYCLE_STATUS_LABELS_FR[c.status]}
                      </Badge>
                    </td>
                    <td className="p-2.5">
                      <span className="font-mono font-medium">{c.classesProcessed}</span>
                      <span className="text-muted-foreground"> / {c.classesTotal}</span>
                    </td>
                    <td className="p-2.5 font-mono">
                      {c.status === "completed" || c.status === "cancelled" ? "—" : (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          {c.studentsAwaiting}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 font-mono">
                      {c.promotedCount} / {c.repeatingCount} / {c.deferredCount}
                    </td>
                    <td className="p-2.5 text-muted-foreground">
                      {c.completedAt
                        ? `Terminé le ${new Date(c.completedAt).toLocaleDateString("fr-FR")}${c.completedByName ? ` par ${c.completedByName}` : ""}`
                        : new Date(c.updatedAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="p-2.5 text-right">
                      <Button
                        size="sm"
                        variant={c.status === "partially_processed" ? "default" : "outline"}
                        className="h-7 text-xs"
                        onClick={() => setSelected(c)}
                      >
                        {c.status === "partially_processed" ? (
                          <>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Continuer
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Ouvrir
                          </>
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Un cycle ne peut être terminé que lorsque TOUTES ses classes sont traitées (ou
        explicitement en dérogation / ignorées).
        <XCircle className="h-3.5 w-3.5 ml-2" />
        L'archivage de l'historique est append-only : annuler un cycle n'efface jamais
        les décisions déjà confirmées.
      </p>
    </div>
  );
}
