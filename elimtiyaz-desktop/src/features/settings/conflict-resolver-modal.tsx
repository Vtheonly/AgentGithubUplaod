/**
 * ConflictResolverModal — T-298 (OFFLINE-400, 46th session, 2026-09-11).
 *
 * The 3-way visual resolver for entries parked in `conflict` status by
 * the sync drain's no-silent-overwrite guard. Three columns —
 * BASE (the shared starting point), VOTRE VERSION (User A / the queued
 * local edit), SERVEUR (User B / the concurrent remote edit) — each pair
 * rendered with the T-295 red/green field convention (old value red and
 * struck, new value green). Per-conflict-path choice chips
 * (take-A / take-B / manual value), the live merged preview, and the
 * audit-logged resolution via `resolveConflict` (which fires
 * `sync.conflict_resolved` + the notification in the provider wiring).
 *
 * Every conflict MUST be explicitly chosen — the confirm button stays
 * disabled otherwise (no default winner, ever).
 */

import { useMemo, useState } from "react";
import { GitMerge, User, Server, History } from "lucide-react";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Badge } from "../../shared/ui/badge";
import { Button } from "../../shared/ui/button";
import { cn } from "../../shared/ui/cn";
import { useToast } from "../../app/providers/toast-provider";
import { useSyncActions } from "../../app/providers/sync-provider";
import type { SyncQueueEntry } from "../../infrastructure/sync/sync-types";
import { computeThreeWayForEntrySync } from "../../infrastructure/sync/conflict-detector";
import { resolveThreeWay, type ConflictChoice, type ConflictChoices, type FieldConflict } from "../../domain/calc/diff/three-way";

export interface ConflictResolverModalProps {
  /** The conflict-parked queue entry to resolve (null = closed). */
  entry: SyncQueueEntry | null;
  onOpenChange: (open: boolean) => void;
}

export function ConflictResolverModal({ entry, onOpenChange }: ConflictResolverModalProps) {
  const actions = useSyncActions();
  const toast = useToast();
  const [choices, setChoices] = useState<ConflictChoices>({});
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);

  // Recompute the 3-way from the entry's own three sides (no live fetch —
  // the remote row is persisted on the conflict record).
  const threeWayState = useMemo(() => {
    if (!entry?.conflict) return null;
    return computeThreeWayForEntrySync(entry, entry.conflict.remotePayload);
  }, [entry?.id, entry?.conflict?.detectedAt, entry?.payload, entry?.basePayload]);

  if (!entry || !entry.conflict || !threeWayState) return null;
  const { conflicts, autoMergedPaths, merged } = threeWayState;
  const unchosen = (conflicts as FieldConflict[]).filter((c) => !choices[c.path]);

  const setChoice = (path: string, choice: ConflictChoice) => {
    setChoices((prev) => ({ ...prev, [path]: choice }));
  };

  const manualValueFor = (c: FieldConflict): unknown => {
    const draft = manualDrafts[c.path] ?? "";
    const trimmed = draft.trim();
    if (trimmed === "") return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if (trimmed === "true" || trimmed === "false") return trimmed === "true";
    return trimmed;
  };

  const handleApply = async () => {
    if (unchosen.length > 0 || applying) return;
    setApplying(true);
    try {
      const effectiveChoices: ConflictChoices = { ...choices };
      for (const c of conflicts) {
        const choice = choices[c.path];
        if (choice?.kind === "manual") {
          effectiveChoices[c.path] = { kind: "manual", value: manualValueFor(c) };
        }
      }
      const resolved = await actions.resolveConflict(entry.id, effectiveChoices);
      if (resolved) {
        toast.showSuccess(
          "Conflit résolu",
          "La version fusionnée est reprogrammée pour synchronisation.",
        );
        setChoices({});
        setManualDrafts({});
        onOpenChange(false);
      } else {
        toast.showError("Résolution impossible", "L'entrée n'est plus en conflit (elle a peut-être déjà été résolue).");
      }
    } finally {
      setApplying(false);
    }
  };

  const preview = resolveThreeWay({ merged, conflicts, autoMergedPaths }, choices);

  return (
    <UnifiedModal
      open={!!entry}
      onOpenChange={(o) => {
        if (!o) {
          setChoices({});
          setManualDrafts({});
        }
        onOpenChange(o);
      }}
      variant="dialog"
      size="xl"
      icon={GitMerge}
      iconTone="warning"
      title={
        <span className="flex items-center gap-2 text-base">
          <code className="font-mono text-primary">{entry.entity}</code>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm font-normal">
            édition concurrente — {conflicts.length} champ(s) en conflit
          </span>
        </span>
      }
      description={`Détecté le ${new Date(entry.conflict.detectedAt).toLocaleString()} — l'autre opérateur a modifié le serveur pendant votre édition. Choisissez la valeur de chaque champ conflictuel : aucune valeur n'est appliquée par défaut.`}
      submitLabel={`Appliquer la résolution${unchosen.length > 0 ? ` (${unchosen.length} restant)` : ""}`}
      onSubmit={handleApply}
      submitDisabled={unchosen.length > 0 || applying}
      submitLoading={applying}
      closeOnBackdropClick={false}
    >
      <div className="space-y-4">
        {/* Column legend */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <History className="h-3 w-3" /> Base (départ commun)
          </div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-primary">
            <User className="h-3 w-3" /> Votre version (A)
          </div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-status-warning">
            <Server className="h-3 w-3" /> Serveur (B)
          </div>
        </div>

        {/* One conflict row per path */}
        <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
          {conflicts.map((c) => {
            const choice = choices[c.path];
            return (
              <div
                key={c.path}
                data-testid={`conflict-row-${c.path}`}
                className="rounded border border-border p-2.5 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <code className="text-[11px] font-mono text-muted-foreground">{c.path}</code>
                  {choice && (
                    <Badge variant="outline" className="text-[9px]">
                      {choice.kind === "local" ? "A retenu" : choice.kind === "remote" ? "B retenu" : "manuel"}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {/* BASE column — the shared departure point (muted) */}
                  <div className="rounded bg-muted/40 border border-border/60 p-1.5 min-w-0">
                    <span
                      data-testid={`conflict-base-${c.path}`}
                      className="block text-[11px] font-mono text-muted-foreground break-words"
                    >
                      {c.baseDisplay}
                    </span>
                  </div>
                  {/* LOCAL column — old struck/red → new green */}
                  <div
                    className={cn(
                      "rounded border p-1.5 min-w-0",
                      choice?.kind === "local" ? "border-primary bg-primary/10" : "border-primary/30",
                    )}
                  >
                    {c.localDisplay !== c.baseDisplay && (
                      <span className="block text-[11px] font-mono line-through decoration-status-danger/60 text-status-danger/70 break-words">
                        {c.baseDisplay}
                      </span>
                    )}
                    <span
                      data-testid={`conflict-local-${c.path}`}
                      className="block text-[11px] font-mono text-status-success bg-status-success/10 rounded px-1 break-words"
                    >
                      {c.localDisplay}
                    </span>
                  </div>
                  {/* REMOTE column */}
                  <div
                    className={cn(
                      "rounded border p-1.5 min-w-0",
                      choice?.kind === "remote" ? "border-status-warning bg-status-warning/10" : "border-status-warning/30",
                    )}
                  >
                    {c.remoteDisplay !== c.baseDisplay && (
                      <span className="block text-[11px] font-mono line-through decoration-status-danger/60 text-status-danger/70 break-words">
                        {c.baseDisplay}
                      </span>
                    )}
                    <span
                      data-testid={`conflict-remote-${c.path}`}
                      className="block text-[11px] font-mono text-status-success bg-status-warning/10 rounded px-1 break-words"
                    >
                      {c.remoteDisplay}
                    </span>
                  </div>
                </div>
                {/* Choice chips */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant={choice?.kind === "local" ? "default" : "outline"}
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setChoice(c.path, { kind: "local" })}
                  >
                    Prendre A (votre version)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={choice?.kind === "remote" ? "default" : "outline"}
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setChoice(c.path, { kind: "remote" })}
                  >
                    Prendre B (serveur)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={choice?.kind === "manual" ? "default" : "outline"}
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setChoice(c.path, { kind: "manual", value: manualValueFor(c) })}
                  >
                    Valeur manuelle…
                  </Button>
                  {choice?.kind === "manual" && (
                    <input
                      data-testid={`conflict-manual-${c.path}`}
                      className="h-6 flex-1 min-w-[120px] rounded border border-input bg-background px-2 text-[11px] font-mono"
                      placeholder="valeur fusionnée"
                      value={manualDrafts[c.path] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setManualDrafts((prev) => ({ ...prev, [c.path]: v }));
                        setChoice(c.path, { kind: "manual", value: v });
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Auto-merged paths (transparency) */}
        {autoMergedPaths.length > 0 && (
          <div className="text-[10px] text-muted-foreground leading-snug">
            Fusion automatique (un seul côté a modifié) :{" "}
            <span className="font-mono">{autoMergedPaths.join(", ")}</span>
          </div>
        )}

        {/* Merged preview */}
        <div>
          <p className="text-xs uppercase text-muted-foreground mb-1">Aperçu fusionné</p>
          <pre
            data-testid="conflict-merged-preview"
            className="text-[10px] font-mono bg-muted/40 border border-border rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap break-all"
          >
            {JSON.stringify(preview, null, 2)}
          </pre>
          {unchosen.length > 0 && (
            <p className="text-[10px] text-status-danger mt-1">
              {unchosen.length} champ(s) sans choix — la résolution reste désactivée.
            </p>
          )}
        </div>
      </div>
    </UnifiedModal>
  );
}
