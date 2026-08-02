/**
 * SyncTab — Settings tab for monitoring + managing the sync queue.
 *
 * Surfaces the SyncService state in a human-friendly way:
 *   - Status card (online/offline + Supabase configured)
 *   - Queue summary (pending / synced / failed / skipped mock)
 *   - Last sync timestamp + last error
 *   - Manual "Sync now" button
 *   - Manual "Check connection" probe button
 *   - Queue table (first 50 entries)
 *   - "Clear queue" admin action (with confirmation)
 *
 * Built with the same shadcn-style primitives as every other tab.
 */
import { useEffect, useState } from "react";
import { RefreshCw, Trash2, AlertCircle, CheckCircle2, Clock, CloudOff, Cloud } from "lucide-react";
import { useSyncStatus, useSyncActions } from "../../app/providers/sync-provider";
import { getSyncService } from "../../infrastructure/sync/sync-service";
import type { SyncQueueEntry } from "../../infrastructure/sync/sync-types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import { useToast } from "../../app/providers/toast-provider";
import { formatDateTime } from "../../core/format/date";

export function SyncTab() {
  const status = useSyncStatus();
  const actions = useSyncActions();
  const toast = useToast();
  const [entries, setEntries] = useState<SyncQueueEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Refresh the queue entries whenever the snapshot changes.
  useEffect(() => {
    if (!status) return;
    void (async () => {
      try {
        const all = await getSyncService().getStore().listAll();
        // Sort: pending first, then failed, then synced, then skipped_mock.
        const order: Record<string, number> = { pending: 0, failed: 1, synced: 2, skipped_mock: 3 };
        all.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        setEntries(all.slice(0, 50));
      } catch (err) {
        console.error("[SyncTab] Failed to load entries:", err);
      }
    })();
  }, [status]);

  if (!status) {
    return <div className="text-sm text-muted-foreground">Chargement…</div>;
  }

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const result = await actions.syncNow();
      if (result.pushed > 0) {
        toast.showSuccess("Synchronisation terminée", `${result.pushed} entrée(s) synchronisée(s).`);
      } else if (result.failed > 0) {
        toast.showError("Échecs de synchronisation", `${result.failed} entrée(s) en échec.`);
      } else {
        toast.showInfo("Synchronisation", "Aucune entrée à synchroniser.");
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      const ok = await actions.probeNow();
      if (ok) {
        toast.showSuccess("Connexion", "Le réseau est accessible.");
      } else {
        toast.showError("Connexion", "Aucune connexion réseau détectée.");
      }
    } finally {
      setProbing(false);
    }
  };

  const handleClear = async () => {
    await actions.clearQueue();
    setConfirmClear(false);
    toast.showSuccess("File d'attente", "Toutes les entrées ont été supprimées.");
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Status card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {status.online ? (
              <Cloud className="h-4 w-4 text-status-success" />
            ) : (
              <CloudOff className="h-4 w-4 text-muted-foreground" />
            )}
            État de la synchronisation
          </CardTitle>
          <CardDescription>
            Les données importées depuis Excel sont synchronisées avec Supabase lorsque le réseau est disponible.
            Les données mock sont exclues de toute synchronisation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <StatusRow
              label="Réseau"
              value={status.online ? "En ligne" : "Hors ligne"}
              tone={status.online ? "success" : "muted"}
            />
            <StatusRow
              label="Supabase"
              value={status.supabaseConfigured ? "Configuré" : "Non configuré"}
              tone={status.supabaseConfigured ? "success" : "warning"}
            />
            <StatusRow
              label="Synchronisation"
              value={status.syncing ? "En cours…" : "Inactive"}
              tone={status.syncing ? "info" : "muted"}
            />
            <StatusRow
              label="Dernière synchro"
              value={status.lastSyncAt ? formatDateTime(status.lastSyncAt) : "Jamais"}
              tone="muted"
            />
          </div>
          {status.lastError && (
            <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-3 text-xs text-status-danger flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{status.lastError}</span>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSyncNow}
              disabled={syncing || status.syncing || !status.online || !status.supabaseConfigured}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing || status.syncing ? "animate-spin" : ""}`} />
              Synchroniser maintenant
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleProbe}
              disabled={probing}
            >
              {probing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
              Vérifier la connexion
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Queue summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">File d'attente</CardTitle>
          <CardDescription>
            Les entrées sont traitées automatiquement lorsque le réseau est disponible.
            Les données mock sont marquées « exclue » et ne sont jamais envoyées à Supabase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <QueueStat label="En attente" value={status.pendingCount} tone="warning" icon={<Clock className="h-3.5 w-3.5" />} />
            <QueueStat label="Synchronisées" value={status.syncedCount} tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
            <QueueStat label="Échecs" value={status.failedCount} tone="danger" icon={<AlertCircle className="h-3.5 w-3.5" />} />
            <QueueStat label="Exclues (mock)" value={status.skippedMockCount} tone="muted" icon={<Trash2 className="h-3.5 w-3.5" />} />
          </div>

          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              File d'attente vide. Les nouvelles données importées depuis Excel apparaîtront ici.
            </p>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">Statut</th>
                    <th className="text-left p-2">Entité</th>
                    <th className="text-left p-2">Opération</th>
                    <th className="text-left p-2">Source</th>
                    <th className="text-left p-2">Mock</th>
                    <th className="text-right p-2">Tentatives</th>
                    <th className="text-left p-2">Mis en file</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="p-2">
                        <StatusChip
                          label={statusLabel(e.status)}
                          tone={statusTone(e.status)}
                        />
                      </td>
                      <td className="p-2 font-mono">{e.entity}</td>
                      <td className="p-2 font-mono">{e.operation}</td>
                      <td className="p-2 truncate max-w-[160px]" title={e.sourceFile ?? ""}>
                        {e.sourceFile ?? "—"}
                      </td>
                      <td className="p-2">
                        {e.isMock ? <Badge variant="secondary">mock</Badge> : <Badge variant="outline">réel</Badge>}
                      </td>
                      <td className="p-2 text-right font-mono">{e.attempts}</td>
                      <td className="p-2 text-muted-foreground">{formatDateTime(e.queuedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end mt-3">
            <Button size="sm" variant="outline" onClick={() => setConfirmClear(true)} disabled={entries.length === 0}>
              <Trash2 className="h-3.5 w-3.5" />
              Vider la file
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Vider la file d'attente ?"
        description="Toutes les entrées en attente, synchronisées et en échec seront supprimées. Cette action est irréversible."
        confirmLabel="Vider"
        destructive
        onConfirm={handleClear}
      />
    </div>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "danger" | "info" | "muted" }) {
  const toneClass = {
    success: "text-status-success",
    warning: "text-status-warning",
    danger: "text-status-danger",
    info: "text-status-info",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

function QueueStat({ label, value, tone, icon }: { label: string; value: number; tone: "success" | "warning" | "danger" | "muted"; icon: React.ReactNode }) {
  const toneClass = {
    success: "text-status-success border-status-success/30 bg-status-success/5",
    warning: "text-status-warning border-status-warning/30 bg-status-warning/5",
    danger: "text-status-danger border-status-danger/30 bg-status-danger/5",
    muted: "text-muted-foreground border-border bg-muted/10",
  }[tone];
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-mono font-semibold mt-1">{value}</div>
    </div>
  );
}

function statusLabel(s: SyncQueueEntry["status"]): string {
  return {
    pending: "En attente",
    synced: "Synchronisée",
    failed: "Échec",
    skipped_mock: "Exclue (mock)",
  }[s];
}

function statusTone(s: SyncQueueEntry["status"]): "success" | "warning" | "danger" | "neutral" {
  return {
    pending: "warning",
    synced: "success",
    failed: "danger",
    skipped_mock: "neutral",
  }[s] as "success" | "warning" | "danger" | "neutral";
}
