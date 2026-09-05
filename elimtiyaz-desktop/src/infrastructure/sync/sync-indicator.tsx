/**
 * SyncIndicator — topbar widget showing the sync queue state.
 *
 * Renders a compact icon + tooltip that reflects the current sync
 * status. Clicking it navigates to Settings → Synchronisation tab
 * where the user can see the full queue, retry failed entries, and
 * trigger a manual sync.
 *
 * States:
 *   - Offline (grey cloud-off icon)
 *   - Online + Supabase not configured (grey cloud icon, "Mock")
 *   - Online + Supabase configured, 0 pending (green check)
 *   - Online + Supabase configured, N pending (yellow cloud-upload, badge)
 *   - Syncing (animated spinner)
 *   - Has failures (red alert, badge with count)
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Cloud, CloudOff, CloudUpload, Check, AlertCircle, Loader2, RefreshCw, RotateCcw,
} from "lucide-react";
import { useSyncStatus, useSyncActions } from "../../app/providers/sync-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../shared/ui/tooltip";
import { Button } from "../../shared/ui/button";
import { cn } from "../../shared/ui/cn";

export function SyncIndicator() {
  const status = useSyncStatus();
  const actions = useSyncActions();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  if (!status) return null;

  const {
    online, supabaseConfigured, syncing: isServiceSyncing,
    pendingCount, failedCount, skippedMockCount, lastSyncAt,
    queueUsingFallback,
  } = status;

  const handleSyncNow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncing(true);
    try {
      await actions.syncNow();
    } finally {
      setSyncing(false);
    }
  };

  // T-171 (SYNC-200): one-click rescue for terminal-failed entries — the
  // badge previously showed the failure count forever with no action.
  const handleRetryFailed = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await actions.retryFailed();
    } finally {
      setRetrying(false);
    }
  };

  const handleClick = () => {
    navigate("/settings?tab=sync");
  };

  // Choose icon + tone based on state.
  let Icon = Cloud;
  let tone = "text-muted-foreground";
  const label = "Synchronisation";
  let description: string;

  if (!online) {
    Icon = CloudOff;
    tone = "text-muted-foreground";
    description = "Hors ligne — les changements seront synchronisés au retour du réseau.";
  } else if (queueUsingFallback) {
    // CACHE-102: the queue is in-memory (IndexedDB unavailable) — surface it
    // instead of letting the indicator lie ("synced") while pending changes
    // silently die with the process.
    Icon = AlertCircle;
    tone = "text-status-warning";
    description =
      "File d'attente EN MÉMOIRE (IndexedDB indisponible) — les changements en attente seront PERDUS à la fermeture de l'application.";
  } else if (!supabaseConfigured) {
    Icon = Cloud;
    tone = "text-muted-foreground";
    description = "Mode mock — Supabase non configuré. Aucune donnée ne sera synchronisée.";
  } else if (failedCount > 0) {
    Icon = AlertCircle;
    tone = "text-status-danger";
    description = `${failedCount} synchronisation(s) en échec. Cliquez pour voir les détails.`;
  } else if (isServiceSyncing || syncing) {
    Icon = Loader2;
    tone = "text-primary";
    description = "Synchronisation en cours…";
  } else if (pendingCount > 0) {
    Icon = CloudUpload;
    tone = "text-status-warning";
    description = `${pendingCount} changement(s) en attente de synchronisation.`;
  } else {
    Icon = Check;
    tone = "text-status-success";
    description = lastSyncAt
      ? `Synchronisé — dernière synchro ${new Date(lastSyncAt).toLocaleTimeString()}.`
      : "Synchronisé.";
  }

  const showBadge = pendingCount > 0 || failedCount > 0;
  const badgeCount = pendingCount + failedCount;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
          aria-label={label}
        >
          <Icon
            className={cn(
              "h-4 w-4",
              tone,
              (isServiceSyncing || syncing) && "animate-spin",
            )}
          />
          {showBadge && (
            <span
              className={cn(
                "absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white",
                failedCount > 0 ? "bg-status-danger" : "bg-status-warning",
              )}
            >
              {badgeCount}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="w-72">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Icon className={cn("h-3.5 w-3.5", tone)} />
            <span className="text-xs font-medium">{label}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-snug">{description}</p>
          <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
            <span className="text-muted-foreground">En attente:</span>
            <span className="text-end">{pendingCount}</span>
            <span className="text-muted-foreground">Synchronisées:</span>
            <span className="text-end">{status.syncedCount}</span>
            <span className="text-muted-foreground">Échecs:</span>
            <span className="text-end text-status-danger">{failedCount}</span>
            <span className="text-muted-foreground">Exclues (mock):</span>
            <span className="text-end text-muted-foreground">{skippedMockCount}</span>
          </div>
          {supabaseConfigured && online && pendingCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              onClick={handleSyncNow}
              disabled={syncing || isServiceSyncing}
            >
              <RefreshCw className={cn("h-3 w-3", (syncing || isServiceSyncing) && "animate-spin")} />
              Synchroniser maintenant
            </Button>
          )}
          {/* T-171 (SYNC-200): retry action for terminal failures. */}
          {supabaseConfigured && online && failedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              onClick={handleRetryFailed}
              disabled={retrying || syncing || isServiceSyncing}
            >
              <RotateCcw className={cn("h-3 w-3", retrying && "animate-spin")} />
              Réessayer les {failedCount} échec(s)
            </Button>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
