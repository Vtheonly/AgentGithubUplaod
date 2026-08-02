/**
 * Complementary services card — Psychology, speech therapy, etc.
 *
 * Each service offers a semester formula and an annual formula.
 * Trash icons defer the actual removal to the orchestrator via
 * `onRequestRemoval` (which opens the ConfirmModal).
 *
 * Extracted from `pricing-tab.tsx` (iteration 6-a). Behavior preserved
 * exactly — only file location + import paths changed.
 */
import { useState } from "react";
import { Stethoscope, Plus, Trash2 } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { Permission } from "../../../core/rbac/permissions";
import { formatDzd } from "../../../core/format/currency";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { Input } from "../../../shared/ui/input";
import { FormField } from "../../../shared/ui/form-field";
import { MoneyInput } from "../../../shared/ui/money-input";
import type { RequestRemoval } from "./types";

export function ComplementaryServicesCard({ onRequestRemoval }: { onRequestRemoval: RequestRemoval }) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const config = useRepositories().pricing.observe().get();

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  const fail = (title: string, msg: string) => toast.showError(title, msg);
  const ok = (msg: string) => toast.showSuccess(msg);

  const [newComplementary, setNewComplementary] = useState<{ label: string; qualifier: string; semesterAmount: number; annualAmount: number }>({
    label: "",
    qualifier: "",
    semesterAmount: 0,
    annualAmount: 0,
  });

  async function addComplementary() {
    if (!newComplementary.label.trim()) { fail("Champ manquant", "Libellé requis"); return; }
    if (!newComplementary.qualifier.trim()) { fail("Champ manquant", "Identifiant (qualifier) requis"); return; }
    const r = await repos.pricing.addComplementaryService(newComplementary, actorId);
    if (r.ok) {
      ok("Service complémentaire ajouté");
      setNewComplementary({ label: "", qualifier: "", semesterAmount: 0, annualAmount: 0 });
    } else fail("Échec", r.error.userMessage);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="size-5 text-primary" />
          Services complémentaires (semestriel & annuel)
        </CardTitle>
        <CardDescription>
          Psychologie, orthophonie — chaque service propose une formule semestrielle et une formule annuelle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {config.complementaryServices.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-panel/50 p-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium text-bright">{s.label}</div>
                <div className="text-xs text-muted">Identifiant : {s.qualifier}</div>
              </div>
              <Badge variant="info">Semestre : {formatDzd(s.semesterAmount)}</Badge>
              <Badge variant="success">Annuel : {formatDzd(s.annualAmount)}</Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canEdit}
                onClick={() => onRequestRemoval({ kind: "complementary", id: s.id, label: s.label })}
              >
                <Trash2 className="size-4 text-status-danger" />
              </Button>
            </div>
          ))}
          {config.complementaryServices.length === 0 && (
            <div className="text-sm text-muted italic">Aucun service complémentaire configuré.</div>
          )}
        </div>

        {canEdit && (
          <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
            <div className="text-sm font-medium">Ajouter un service complémentaire</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <FormField label="Libellé" required>
                <Input
                  value={newComplementary.label}
                  onChange={(e) => setNewComplementary({ ...newComplementary, label: e.target.value })}
                  placeholder="Ex. Séances de psychologie (20 séances)"
                />
              </FormField>
              <FormField label="Identifiant (qualifier)" required>
                <Input
                  value={newComplementary.qualifier}
                  onChange={(e) => setNewComplementary({ ...newComplementary, qualifier: e.target.value })}
                  placeholder="Ex. psychology"
                />
              </FormField>
              <FormField label="Montant semestriel (DA)">
                <MoneyInput
                  value={newComplementary.semesterAmount}
                  onChange={(v) => setNewComplementary({ ...newComplementary, semesterAmount: v })}
                />
              </FormField>
              <FormField label="Montant annuel (DA)">
                <MoneyInput
                  value={newComplementary.annualAmount}
                  onChange={(v) => setNewComplementary({ ...newComplementary, annualAmount: v })}
                />
              </FormField>
            </div>
            <Button size="sm" variant="default" onClick={addComplementary}>
              <Plus className="size-3.5 mr-1.5" />
              Ajouter
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
