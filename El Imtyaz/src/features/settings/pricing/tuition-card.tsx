/**
 * Tuition card — per-grade-level (14 grades) with 3-tranche editor.
 *
 * Extracted from `pricing-tab.tsx` (iteration 6-a). Behavior preserved
 * exactly — only file location + import paths changed.
 */
import { useEffect, useState } from "react";
import { BookOpen, Save } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { Permission } from "../../../core/rbac/permissions";
import { formatDzd } from "../../../core/format/currency";
import {
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS_FR,
  type GradeLevel,
} from "../../../domain/model/student";
import { tuitionTranchesForGrade } from "../../../domain/model/pricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { FormField } from "../../../shared/ui/form-field";
import { MoneyInput } from "../../../shared/ui/money-input";

type TuitionDraft = { annual: number; t1: number; t2: number; t3: number };

export function TuitionCard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const config = useRepositories().pricing.observe().get();

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  const ok = (msg: string) => toast.showSuccess(msg);
  const fail = (title: string, msg: string) => toast.showError(title, msg);

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

  async function saveTuitionForGrade(g: GradeLevel) {
    const d = tuitionDrafts[g];
    const r = await repos.pricing.updateTuitionForGradeLevel(g, d.annual, [d.t1, d.t2, d.t3], actorId);
    if (r.ok) ok(`Scolarité ${GRADE_LEVEL_LABELS_FR[g]} enregistrée`);
    else fail("Échec", r.error.userMessage);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="size-5 text-primary" />
          Scolarité par palier (14 niveaux)
        </CardTitle>
        <CardDescription>
          Tarifs annuels 2026-2027 — chaque palier a son propre découpage en 3 tranches (inscription / janvier / avril).
          Les montants doivent correspondre à la grille officielle de l'établissement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {GRADE_LEVELS.map((g) => {
          const draft = tuitionDrafts[g];
          const tranches = tuitionTranchesForGrade(config, g);
          const saved = tranches.map((t) => t.amountDue);
          const isDirty = draft.annual !== (config.tuitionByGradeLevel[g]?.annualAmount ?? 0)
            || draft.t1 !== saved[0]
            || draft.t2 !== saved[1]
            || draft.t3 !== saved[2];
          return (
            <div key={g} className="rounded-lg border border-border bg-surface-panel/50 p-4">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex-1 min-w-[140px]">
                  <div className="font-medium text-bright">{GRADE_LEVEL_LABELS_FR[g]}</div>
                  <div className="text-xs text-muted">Annuel enregistré : {formatDzd(config.tuitionByGradeLevel[g]?.annualAmount ?? 0)}</div>
                </div>
                <Badge variant={isDirty ? "warning" : "neutral"}>{isDirty ? "Non enregistré" : "À jour"}</Badge>
                <Button
                  size="sm"
                  variant="default"
                  disabled={!canEdit || !isDirty}
                  onClick={() => saveTuitionForGrade(g)}
                >
                  <Save className="size-3.5 mr-1.5" />
                  Enregistrer
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <FormField label="Montant annuel (DA)" required>
                  <MoneyInput
                    value={draft.annual}
                    onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, annual: v } })}
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField label="Tranche 1 (Sept–Déc)">
                  <MoneyInput
                    value={draft.t1}
                    onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, t1: v } })}
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField label="Tranche 2 (Jan–Mar)">
                  <MoneyInput
                    value={draft.t2}
                    onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, t2: v } })}
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField label="Tranche 3 (Avr–Juin)">
                  <MoneyInput
                    value={draft.t3}
                    onChange={(v) => setTuitionDrafts({ ...tuitionDrafts, [g]: { ...draft, t3: v } })}
                    disabled={!canEdit}
                  />
                </FormField>
              </div>
              <div className="text-xs text-muted mt-2">
                Somme des tranches : {formatDzd(draft.t1 + draft.t2 + draft.t3)}
                {Math.abs(draft.t1 + draft.t2 + draft.t3 - draft.annual) > 1 && (
                  <span className="text-status-danger ml-2"> La somme ne correspond pas au montant annuel</span>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
