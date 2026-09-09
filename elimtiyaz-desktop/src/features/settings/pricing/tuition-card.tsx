/**
 * Tuition card — per-grade-level (14 grades) with 3-tranche editor.
 *
 * Extracted from `pricing-tab.tsx` (iteration 6-a).
 *
 * T-250 (2026-09-09, 37th session) — the owner's AI-review Screen-6
 * overhaul: the 14 stacked cards (a multi-thousand-pixel scroll wall) are
 * replaced by ONE consolidated matrix table — Niveau | Annuel | T1 | T2 |
 * T3 | Équilibre | Enregistrer — with a live per-row balance check and the
 * 1-click "Auto-calculer 40 % / 30 % / 30 %" header tool.
 *
 * Data-honesty adaptation (documented in UI-306, §15.16 family): the
 * review's sample auto-recomputes the 40/30/30 split whenever the ANNUAL
 * value changes. This school's official 2026-2027 fee schedule carries
 * NON-EQUAL per-grade splits (T1 ≠ T2 ≠ T3 for most grades — see
 * `domain/model/pricing.ts`), so silently re-deriving the split on annual
 * edit would CLOBBER the official grid. The split therefore changes only
 * through (a) explicit per-tranche edits or (b) the explicit header tool.
 * The tool rounds T1/T2 and parks the remainder in T3 (exact conservation).
 *
 * Save path unchanged: `repos.pricing.updateTuitionForGradeLevel` per row.
 */
import { useEffect, useState } from "react";
import { BookOpen, Save, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { Permission } from "../../../core/rbac/permissions";
import { formatDzd, formatDzdPlain } from "../../../core/format/currency";
import {
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS_FR,
  type GradeLevel,
} from "../../../domain/model/student";
import { tuitionTranchesForGrade } from "../../../domain/model/pricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { MoneyInput } from "../../../shared/ui/money-input";

type TuitionDraft = { annual: number; t1: number; t2: number; t3: number };

export function TuitionCard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const config = useRepositories().pricing.observe().get();

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  const [tuitionDrafts, setTuitionDrafts] = useState<Record<GradeLevel, TuitionDraft>>(() => {
    const out = {} as Record<GradeLevel, TuitionDraft>;
    for (const g of GRADE_LEVELS) {
      const p = config.tuitionByGradeLevel[g] ?? { annualAmount: 0, installments: [0, 0, 0] as const };
      out[g] = { annual: p.annualAmount, t1: p.installments[0], t2: p.installments[1], t3: p.installments[2] };
    }
    return out;
  });

  useEffect(() => {
    const next = {} as Record<GradeLevel, TuitionDraft>;
    for (const g of GRADE_LEVELS) {
      const p = config.tuitionByGradeLevel[g] ?? { annualAmount: 0, installments: [0, 0, 0] as const };
      next[g] = { annual: p.annualAmount, t1: p.installments[0], t2: p.installments[1], t3: p.installments[2] };
    }
    setTuitionDrafts(next);
  }, [config]);

  /** T-250 — explicit 40/30/30 tool: T1/T2 rounded, T3 = remainder. */
  function autoComputeAllTranches() {
    const next = { ...tuitionDrafts };
    for (const g of GRADE_LEVELS) {
      const ann = next[g].annual;
      const t1 = Math.round(ann * 0.4);
      const t2 = Math.round(ann * 0.3);
      const t3 = ann - t1 - t2;
      next[g] = { annual: ann, t1, t2, t3 };
    }
    setTuitionDrafts(next);
    toast.showSuccess(
      "Répartition 40 / 30 / 30 calculée",
      "Vérifiez les valeurs puis enregistrez les paliers concernés.",
    );
  }

  async function saveTuitionForGrade(g: GradeLevel) {
    const d = tuitionDrafts[g];
    const r = await repos.pricing.updateTuitionForGradeLevel(g, d.annual, [d.t1, d.t2, d.t3], actorId);
    if (r.ok) toast.showSuccess(`Scolarité ${GRADE_LEVEL_LABELS_FR[g]} enregistrée`);
    else toast.showError("Échec de l'enregistrement", r.error.userMessage);
  }

  return (
    <Card>
      <CardHeader className="pb-3 border-b border-border/60 flex flex-row items-start justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <BookOpen className="size-4 text-primary" />
            Grille Tarifaire de Scolarité (14 niveaux)
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Montants annuels et répartition par tranches — T1 : 15 sept. (à l'inscription) ·
            T2 : 15 déc. · T3 : 15 mars. La grille officielle est souvent non-équivalente :
            le bouton 40 / 30 / 30 est un OUTIL explicite, jamais appliqué automatiquement.
          </CardDescription>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={autoComputeAllTranches} className="text-xs shrink-0">
            <Sparkles className="size-3.5 mr-1 text-primary" />
            Auto-calculer 40 % · 30 % · 30 %
          </Button>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground text-left uppercase">
              <tr>
                <th className="p-3 font-semibold">Niveau</th>
                <th className="p-3 font-semibold w-40">Montant annuel (DZD)</th>
                <th className="p-3 font-semibold w-36">Tranche 1 (15 sept.)</th>
                <th className="p-3 font-semibold w-36">Tranche 2 (15 déc.)</th>
                <th className="p-3 font-semibold w-36">Tranche 3 (15 mars)</th>
                <th className="p-3 font-semibold text-center">Équilibre</th>
                {canEdit && <th className="p-3 font-semibold text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {GRADE_LEVELS.map((g) => {
                const draft = tuitionDrafts[g];
                const saved = tuitionTranchesForGrade(config, g).map((t) => t.amountDue);
                const savedAnnual = config.tuitionByGradeLevel[g]?.annualAmount ?? 0;
                const isDirty =
                  draft.annual !== savedAnnual ||
                  draft.t1 !== saved[0] ||
                  draft.t2 !== saved[1] ||
                  draft.t3 !== saved[2];
                const sum = draft.t1 + draft.t2 + draft.t3;
                const isBalanced = sum === draft.annual;
                return (
                  <tr key={g} className="hover:bg-accent/5">
                    <td className="p-3 font-semibold text-foreground whitespace-nowrap">
                      {GRADE_LEVEL_LABELS_FR[g]}
                      {isDirty && (
                        <span
                          className="ml-1.5 inline-block size-1.5 rounded-full bg-status-warning align-middle"
                          title="Non enregistré"
                        />
                      )}
                    </td>
                    <td className="p-3">
                      <MoneyInput
                        value={draft.annual}
                        onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, annual: v } })}
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="p-3">
                      <MoneyInput
                        value={draft.t1}
                        onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, t1: v } })}
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="p-3">
                      <MoneyInput
                        value={draft.t2}
                        onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, t2: v } })}
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="p-3">
                      <MoneyInput
                        value={draft.t3}
                        onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, t3: v } })}
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="p-3 text-center">
                      {isBalanced ? (
                        <span
                          className="inline-flex items-center gap-1 text-status-success font-semibold"
                          title={`Somme des tranches : ${formatDzdPlain(sum)} DZD`}
                        >
                          <CheckCircle2 className="size-3.5" /> OK
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-status-danger font-semibold"
                          title={`Somme des tranches : ${formatDzdPlain(sum)} DZD ≠ annuel ${formatDzdPlain(draft.annual)} DZD (écart : ${formatDzdPlain(Math.abs(sum - draft.annual))})`}
                        >
                          <AlertCircle className="size-3.5" /> Écart
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant={isDirty ? "default" : "ghost"}
                          disabled={!isDirty || !isBalanced}
                          onClick={() => void saveTuitionForGrade(g)}
                          title={
                            isBalanced
                              ? `Enregistrer ${formatDzd(draft.annual)} / an`
                              : "Corrigez l'écart avant d'enregistrer"
                          }
                        >
                          <Save className="size-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2.5 text-[11px] text-muted-foreground border-t border-border/40">
          L'enregistrement est bloqué tant que la somme des tranches ne correspond pas au
          montant annuel (conservation exacte au dinar). 14 paliers · grille officielle
          2026-2027.
        </p>
      </CardContent>
    </Card>
  );
}
