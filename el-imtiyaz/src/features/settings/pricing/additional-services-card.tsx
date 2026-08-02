/**
 * Additional services card — Cantine, uniforme, livres, clubs, etc.
 *
 * Trash icons defer the actual removal to the orchestrator via
 * `onRequestRemoval` (which opens the ConfirmModal).
 *
 * Extracted from `pricing-tab.tsx` (iteration 6-a). Behavior preserved
 * exactly — only file location + import paths changed.
 */
import { useState } from "react";
import { Package, Plus, Trash2 } from "lucide-react";
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

export function AdditionalServicesCard({ onRequestRemoval }: { onRequestRemoval: RequestRemoval }) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const config = useRepositories().pricing.observe().get();

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  const fail = (title: string, msg: string) => toast.showError(title, msg);
  const ok = (msg: string) => toast.showSuccess(msg);

  const [newService, setNewService] = useState<{ label: string; amount: number }>({ label: "", amount: 0 });

  async function addService() {
    if (!newService.label.trim()) { fail("Champ manquant", "Libellé requis"); return; }
    const r = await repos.pricing.addAdditionalService(newService, actorId);
    if (r.ok) {
      ok("Service additionnel ajouté");
      setNewService({ label: "", amount: 0 });
    } else fail("Échec", r.error.userMessage);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="size-5 text-primary" />
          Services additionnels
        </CardTitle>
        <CardDescription>
          Cantine, uniforme, livres, clubs, etc. — tarifs libres configurables par l'administrateur.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {config.additionalServices.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-panel/50 p-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium text-bright">{s.label}</div>
                <div className="text-xs text-muted">Identifiant : {s.qualifier}</div>
              </div>
              <Badge variant="success">{formatDzd(s.amount)}</Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canEdit}
                onClick={() => onRequestRemoval({ kind: "service", id: s.id, label: s.label })}
              >
                <Trash2 className="size-4 text-status-danger" />
              </Button>
            </div>
          ))}
          {config.additionalServices.length === 0 && (
            <div className="text-sm text-muted italic">Aucun service additionnel configuré.</div>
          )}
        </div>

        {canEdit && (
          <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
            <div className="text-sm font-medium">Ajouter un service additionnel</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <FormField label="Libellé" required>
                <Input
                  value={newService.label}
                  onChange={(e) => setNewService({ ...newService, label: e.target.value })}
                  placeholder="Ex. Sortie scolaire"
                />
              </FormField>
              <FormField label="Montant (DA)" required>
                <MoneyInput value={newService.amount} onChange={(v) => setNewService({ ...newService, amount: v })} />
              </FormField>
              <Button size="sm" variant="default" onClick={addService}>
                <Plus className="size-3.5 mr-1.5" />
                Ajouter
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
