/**
 * ExperimentalTab — Settings → Expérimental (T-438 / IDENT-101 / ADR-032).
 *
 * The ONLY activation path for experimental capabilities (identity-rules
 * §9.2): every capability is OFF by default, the toggle is per-desktop-local
 * (never the server feature_flags — INV-56), and the tab carries the
 * experimental disclaimer.
 *
 * For the ER-PMAE capability, the tab also hosts the REVIEW SURFACES:
 *   - the duplicate-candidates review queue (the proposals with their
 *     evidence — approve/reject each; NOTHING merges without this explicit
 *     confirmation — INV-50);
 *   - the merge history with the UNMERGE action (INV-54's restoration).
 */
import { useEffect, useMemo, useState } from "react";
import { FlaskConical, AlertTriangle, Check, X, Undo2, ShieldAlert } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  EXPERIMENTAL_CAPABILITIES,
  EXPERIMENTAL_ER_PMAE_KEY,
  isExperimentalEnabled,
  setExperimentalEnabled,
} from "../../infrastructure/experimental/experimental-flags";
import type { ErMatchProposal } from "../../domain/identity/types";
import type { ErAggregationEvent } from "../../domain/identity/types";

const BAND_LABELS_FR: Record<string, string> = {
  definite: "Correspondance certaine",
  probable: "Correspondance probable",
  review: "À vérifier",
  separate: "Distinct",
};

const BAND_TONES: Record<string, "success" | "info" | "warning" | "danger"> = {
  definite: "success",
  probable: "info",
  review: "warning",
  separate: "danger",
};

export function ExperimentalTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const c of EXPERIMENTAL_CAPABILITIES) initial[c.key] = isExperimentalEnabled(c.key);
    return initial;
  });
  const [proposals, setProposals] = useState<readonly ErMatchProposal[]>([]);
  const [events, setEvents] = useState<readonly ErAggregationEvent[]>([]);
  const [busy, setBusy] = useState(false);

  const erEnabled = flags[EXPERIMENTAL_ER_PMAE_KEY] === true;

  // The ER review surfaces subscribe ONLY when the flag is ON (INV-40: zero
  // ER reads when disabled).
  useEffect(() => {
    if (!erEnabled) {
      setProposals([]);
      setEvents([]);
      return;
    }
    const p = repos.identityResolution.observeProposals();
    const e = repos.identityResolution.observeEvents();
    setProposals(p.get());
    setEvents(e.get());
    const un1 = p.subscribe(setProposals);
    const un2 = e.subscribe(setEvents);
    return () => {
      un1();
      un2();
    };
  }, [erEnabled, repos.identityResolution]);

  const pending = useMemo(() => proposals.filter((p) => p.status === "proposed"), [proposals]);
  const mergeEvents = useMemo(
    () => events.filter((e) => e.eventType === "MERGE_EXECUTED"),
    [events],
  );
  const undoneEventIds = useMemo(
    () =>
      new Set(
        events
          .filter((e) => e.eventType === "MERGE_UNDONE")
          .map((e) => (e.payload as { reversesEventId?: string }).reversesEventId),
      ),
    [events],
  );

  function toggle(key: string, next: boolean): void {
    setExperimentalEnabled(key, next);
    setFlags((f) => ({ ...f, [key]: next }));
  }

  async function decide(proposal: ErMatchProposal, decision: "approve" | "reject"): Promise<void> {
    if (!session) return;
    setBusy(true);
    try {
      const res = await repos.identityResolution.decideProposal({
        proposalId: proposal.id,
        decision,
        actorId: session.userId,
        actorName: session.displayName,
        rationale: decision === "approve" ? "Approuvé depuis Paramètres → Expérimental" : "Rejeté depuis Paramètres → Expérimental",
      });
      if (res.ok) {
        toast.showSuccess(
          decision === "approve"
            ? "Rapprochement approuvé — la liaison d'identité est enregistrée."
            : "Rapprochement rejeté — la paire ne sera plus proposée.",
        );
      } else {
        toast.showError(`Décision impossible : ${res.error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function unmerge(event: ErAggregationEvent): Promise<void> {
    if (!session) return;
    setBusy(true);
    try {
      const res = await repos.identityResolution.unmergeParents({
        eventId: event.id,
        actorId: session.userId,
        actorName: session.displayName,
        rationale: "Annulation depuis Paramètres → Expérimental",
      });
      if (res.ok) {
        toast.showSuccess("Fusion annulée — l'état antérieur est restauré (mappage complet rejoué).");
      } else {
        toast.showError(`Annulation impossible : ${res.error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Fonctionnalités expérimentales
          </CardTitle>
          <CardDescription>
            Capacités en cours d'évaluation — désactivées par défaut. L'activation est locale à ce
            poste et réversible à tout moment ; elle n'affecte jamais les autres opérateurs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs text-muted-foreground">
              Ces fonctionnalités sont classées <strong>expérimentales</strong> : elles peuvent
              évoluer ou être retirées. Leurs effets restent isolés, réversibles et audités — mais
              elles ne doivent pas être activées sur un poste de production sans compréhension de
              leur portée.
            </p>
          </div>
          {EXPERIMENTAL_CAPABILITIES.map((cap) => (
            <div
              key={cap.key}
              className="flex items-start justify-between gap-4 rounded-md border border-border p-4"
            >
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-foreground">{cap.labelFr}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{cap.descriptionFr}</p>
                <p className="pt-1 font-mono text-[10px] text-muted-foreground">{cap.key}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusChip
                  label={flags[cap.key] ? "Activé" : "Désactivé"}
                  tone={flags[cap.key] ? "warning" : "info"}
                />
                <Button
                  variant={flags[cap.key] ? "outline" : "default"}
                  size="sm"
                  onClick={() => toggle(cap.key, !flags[cap.key])}
                  aria-pressed={flags[cap.key]}
                  aria-label={`Activer ou désactiver ${cap.labelFr}`}
                >
                  {flags[cap.key] ? "Désactiver" : "Activer"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {erEnabled ? (
        <>
          {/* The duplicate-candidates review queue (INV-50's decision surface) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4" />
                Rapprochements proposés ({pending.length})
              </CardTitle>
              <CardDescription>
                Liaisons d'identité détectées par le moteur ER-PMAE en attente de décision.
                Aucune fusion n'a lieu sans votre confirmation explicite ; un rejet installe une
                contrainte négative permanente (la paire ne sera plus proposée).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Aucun rapprochement en attente. Lancez un import Excel avec la fonctionnalité
                  activée : l'analyse proposera les doublons détectés avant toute écriture.
                </p>
              ) : (
                <ul className="space-y-2">
                  {pending.map((p) => (
                    <li key={p.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {p.aObservationId}
                        </Badge>
                        <span className="text-xs text-muted-foreground">→</span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {p.bObservationId}
                        </Badge>
                        <StatusChip
                          label={`${BAND_LABELS_FR[p.score.band] ?? p.score.band} · ${(p.score.confidence * 100).toFixed(0)} %`}
                          tone={BAND_TONES[p.score.band] ?? "info"}
                        />
                      </div>
                      <ul className="mt-2 space-y-1">
                        {p.score.evidence.slice(0, 4).map((ev, i) => (
                          <li key={i} className="text-xs text-muted-foreground">
                            • {ev.detail}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void decide(p, "approve")}>
                          <Check className="mr-1 h-3 w-3" /> Approuver
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void decide(p, "reject")}
                        >
                          <X className="mr-1 h-3 w-3" /> Rejeter
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* The merge history with the unmerge actions (INV-54) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Undo2 className="h-4 w-4" />
                Historique des fusions ({mergeEvents.length})
              </CardTitle>
              <CardDescription>
                Chaque fusion enregistre le mappage complet des lignes déplacées ; l'annulation
                rejoue ce mappage à l'identique (l'état antérieur exact est restauré, le parent
                fusionné est rétabli).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mergeEvents.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Aucune fusion exécutée à ce jour.
                </p>
              ) : (
                <ul className="space-y-2">
                  {mergeEvents.map((e) => {
                    const undone = undoneEventIds.has(e.id);
                    return (
                      <li
                        key={e.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                        style={undone ? { opacity: 0.55 } : undefined}
                      >
                        <div className="space-y-0.5">
                          <p className="text-xs font-medium">
                            Fusion {new Date(e.createdAt).toLocaleString("fr-FR")} — {e.actorName}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            cible {e.canonicalId.slice(0, 8)}… ← fusionné {e.mergedAwayId?.slice(0, 8)}…
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusChip
                            label={undone ? "Annulée" : "Active"}
                            tone={undone ? "info" : "success"}
                          />
                          {!undone && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void unmerge(e)}>
                              <Undo2 className="mr-1 h-3 w-3" /> Annuler la fusion
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-xs text-muted-foreground">
              Activez « Agrégation &amp; Résolution d'Identité (ER-PMAE) » ci-dessus pour afficher
              les files de révision et l'historique des fusions. Aucune donnée ER n'est lue tant
              que la fonctionnalité est désactivée.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
