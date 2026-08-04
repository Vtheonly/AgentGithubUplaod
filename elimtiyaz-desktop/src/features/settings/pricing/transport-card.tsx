/**
 * Transport card — per-destination (4 destinations) with 3-tranche editor.
 *
 * Extracted from `pricing-tab.tsx` (iteration 6-a). Behavior preserved
 * exactly — only file location + import paths changed.
 */
import { useEffect, useState } from "react";
import { Bus, Save } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { Permission } from "../../../core/rbac/permissions";
import { formatDzd } from "../../../core/format/currency";
import {
  TRANSPORT_DESTINATIONS,
  TRANSPORT_DESTINATION_LABELS_FR,
  type TransportDestination,
} from "../../../domain/model/parent";
import { transportTranchesForDestination } from "../../../domain/model/pricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { FormField } from "../../../shared/ui/form-field";
import { MoneyInput } from "../../../shared/ui/money-input";

type TransportDraft = { annual: number; t1: number; t2: number; t3: number };

export function TransportCard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const config = useRepositories().pricing.observe().get();

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  const ok = (msg: string) => toast.showSuccess(msg);
  const fail = (title: string, msg: string) => toast.showError(title, msg);

  const [transportDrafts, setTransportDrafts] = useState<Record<TransportDestination, TransportDraft>>(() => {
    const out = {} as Record<TransportDestination, TransportDraft>;
    for (const d of TRANSPORT_DESTINATIONS) {
      const p = config.transportByDestination[d] ?? { annualAmount: 0, installments: [0, 0, 0] as const };
      out[d] = { annual: p.annualAmount, t1: p.installments[0], t2: p.installments[1], t3: p.installments[2] };
    }
    return out;
  });

  useEffect(() => {
    const next = {} as Record<TransportDestination, TransportDraft>;
    for (const d of TRANSPORT_DESTINATIONS) {
      const p = config.transportByDestination[d] ?? { annualAmount: 0, installments: [0, 0, 0] as const };
      next[d] = { annual: p.annualAmount, t1: p.installments[0], t2: p.installments[1], t3: p.installments[2] };
    }
    setTransportDrafts(next);
  }, [config]);

  async function saveTransportForDestination(d: TransportDestination) {
    const draft = transportDrafts[d];
    const r = await repos.pricing.updateTransportForDestination(d, draft.annual, [draft.t1, draft.t2, draft.t3], actorId);
    if (r.ok) ok(`Transport ${TRANSPORT_DESTINATION_LABELS_FR[d]} enregistré`);
    else fail("Échec", r.error.userMessage);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bus className="size-5 text-primary" />
          Transport scolaire (4 destinations)
        </CardTitle>
        <CardDescription>
          Chaque destination a son propre découpage en 3 tranches :
          <span className="text-bright"> à l'inscription</span> /
          <span className="text-bright"> 01–15 Déc</span> /
          <span className="text-bright"> 01–15 Mar</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {TRANSPORT_DESTINATIONS.map((d) => {
          const draft = transportDrafts[d];
          const tranches = transportTranchesForDestination(config, d);
          const saved = tranches.map((t) => t.amountDue);
          const isDirty = draft.annual !== (config.transportByDestination[d]?.annualAmount ?? 0)
            || draft.t1 !== saved[0]
            || draft.t2 !== saved[1]
            || draft.t3 !== saved[2];
          return (
            <div key={d} className="rounded-lg border border-border bg-surface-panel/50 p-4">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-bright">{TRANSPORT_DESTINATION_LABELS_FR[d]}</div>
                  <div className="text-xs text-muted">Annuel enregistré : {formatDzd(config.transportByDestination[d]?.annualAmount ?? 0)}</div>
                </div>
                <Badge variant={isDirty ? "warning" : "neutral"}>{isDirty ? "Non enregistré" : "À jour"}</Badge>
                <Button
                  size="sm"
                  variant="default"
                  disabled={!canEdit || !isDirty}
                  onClick={() => saveTransportForDestination(d)}
                >
                  <Save className="size-3.5 mr-1.5" />
                  Enregistrer
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <FormField label="Montant annuel (DA)" required>
                  <MoneyInput
                    value={draft.annual}
                    onChange={(v) => setTransportDrafts({ ...transportDrafts, [d]: { ...draft, annual: v } })}
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField label="Tranche 1 (À l'inscription)">
                  <MoneyInput
                    value={draft.t1}
                    onChange={(v) => setTransportDrafts({ ...transportDrafts, [d]: { ...draft, t1: v } })}
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField label="Tranche 2 (01–15 Déc)">
                  <MoneyInput
                    value={draft.t2}
                    onChange={(v) => setTransportDrafts({ ...transportDrafts, [d]: { ...draft, t2: v } })}
                    disabled={!canEdit}
                  />
                </FormField>
                <FormField label="Tranche 3 (01–15 Mar)">
                  <MoneyInput
                    value={draft.t3}
                    onChange={(v) => setTransportDrafts({ ...transportDrafts, [d]: { ...draft, t3: v } })}
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
