/**
 * BackupTab — AES-256-GCM encrypted backup management (plan §13).
 *
 * Layout:
 *   1. Top card: "Dernière sauvegarde" — last backup timestamp, size, status,
 *      "Sauvegarder maintenant" button.
 *   2. Archives table: date, size, status, vault, retention expiry, with
 *      "Restaurer" + "Supprimer" actions per row. Both actions open a
 *      ConfirmModal (destructive variant) — the user must confirm before
 *      the action is performed.
 *   3. Bottom card: "Purge automatique" — explains 365-day rolling retention,
 *      shows next scheduled run (mock: tomorrow 02:00), "Purger maintenant"
 *      button.
 *
 * RBAC: all action buttons are gated by `Permission.ManageBackups`.
 * Read-only users (e.g. teachers) can see the archives list but cannot
 * trigger any mutation.
 *
 * All UI text is in French per project convention.
 */
import { useState } from "react";
import {
  Database,
  Download,
  Upload,
  Trash2,
  Shield,
  Clock,
  Loader2,
  HardDrive,
} from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import { useToast } from "../../state/toast-context";
import { useObservable } from "../../shared/hooks/use-observable";
import { Permission } from "../../core/rbac/permissions";
import { formatDateTime, formatDate } from "../../core/format/date";
import {
  BACKUP_STATUS_LABELS_FR,
  BACKUP_VAULT_LABELS_FR,
  type BackupArchive,
} from "../../domain/model/backup";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/components/status-chip";
import { EmptyState } from "../../shared/components/state-views";
import { ConfirmModal } from "../../shared/components/unified-modal";
import { cn } from "../../shared/ui/cn";

/** Format a byte count as a human-readable string (KB / MB / GB). */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

/** Tone for a backup status chip. */
function statusTone(status: BackupArchive["status"]): "success" | "warning" | "danger" | "neutral" | "info" {
  switch (status) {
    case "encrypted":
      return "success";
    case "restored":
      return "info";
    case "corrupted":
      return "danger";
    case "purged":
      return "neutral";
  }
}

/** Compute the "next scheduled run" timestamp (tomorrow at 02:00 local). */
function nextScheduledRun(): Date {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(2, 0, 0, 0);
  return next;
}

export function BackupTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const archives = useObservable(() => repos.backups.observe(), []);
  const [runningBackup, setRunningBackup] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupArchive | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupArchive | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [purging, setPurging] = useState(false);

  const canManage = !!session && session.permissions.has(Permission.ManageBackups);
  const actorId = session?.userId ?? "usr-current";
  const actorName = session?.displayName ?? "Session courante";

  const lastBackup = archives.length > 0 ? archives[0] : null;

  async function handleRunBackup() {
    setRunningBackup(true);
    try {
      const r = await repos.backups.runBackup(actorId, actorName);
      if (r.ok) {
        toast.showSuccess(
          "Sauvegarde créée",
          `Archive chiffrée AES-256-GCM (${formatBytes(r.value.sizeBytes)}).`,
        );
      } else {
        toast.showError("Échec de la sauvegarde", r.error.userMessage);
      }
    } finally {
      setRunningBackup(false);
    }
  }

  async function handleRestore() {
    if (!pendingRestore) return;
    setRestoring(true);
    try {
      const r = await repos.backups.restore(pendingRestore.id, actorId, actorName);
      if (r.ok) {
        toast.showSuccess(
          "Restauration réussie",
          `Archive restaurée en ${r.value.durationMs} ms (mock — aucune écriture en base).`,
        );
      } else {
        toast.showError("Restauration échouée", r.error.userMessage);
      }
    } finally {
      setRestoring(false);
      setPendingRestore(null);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const r = await repos.backups.deleteArchive(pendingDelete.id, actorId, actorName);
      if (r.ok) {
        toast.showSuccess("Archive supprimée", `${pendingDelete.id} a été supprimée du coffre.`);
      } else {
        toast.showError("Suppression échouée", r.error.userMessage);
      }
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  async function handlePurge() {
    setPurging(true);
    try {
      const r = await repos.backups.purgeExpired(actorId, actorName);
      if (r.ok) {
        const n = r.value.length;
        if (n === 0) {
          toast.showInfo("Purge", "Aucune archive à purger (toutes dans la fenêtre de rétention).");
        } else {
          toast.showSuccess("Purge terminée", `${n} archive(s) purgée(s).`);
        }
      } else {
        toast.showError("Purge échouée", r.error.userMessage);
      }
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      {/* ---------------------------------------------------------------- */}
      {/*  Top card — last backup summary + run-now button                  */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="size-5 text-primary" />
                Dernière sauvegarde
              </CardTitle>
              <CardDescription>
                Cycle 24h · chiffrement AES-256-GCM · rétention 365 jours (plan §13)
              </CardDescription>
            </div>
            <Button
              onClick={handleRunBackup}
              disabled={!canManage || runningBackup}
              className="min-w-[180px]"
            >
              {runningBackup ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Sauvegarde en cours…
                </>
              ) : (
                <>
                  <Download className="size-4" />
                  Sauvegarder maintenant
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {lastBackup ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryItem
                icon={<Clock className="size-4 text-muted-foreground" />}
                label="Date"
                value={formatDateTime(lastBackup.createdAt)}
              />
              <SummaryItem
                icon={<HardDrive className="size-4 text-muted-foreground" />}
                label="Taille"
                value={formatBytes(lastBackup.sizeBytes)}
              />
              <SummaryItem
                icon={<Shield className="size-4 text-muted-foreground" />}
                label="Statut"
                value={
                  <StatusChip
                    label={BACKUP_STATUS_LABELS_FR[lastBackup.status]}
                    tone={statusTone(lastBackup.status)}
                  />
                }
              />
              <SummaryItem
                icon={<Database className="size-4 text-muted-foreground" />}
                label="Coffre"
                value={BACKUP_VAULT_LABELS_FR[lastBackup.vaultLocation]}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucune sauvegarde n'a encore été effectuée. Cliquez sur « Sauvegarder maintenant »
              pour créer la première.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/*  Archives table                                                   */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="size-5 text-primary" />
            Archives
          </CardTitle>
          <CardDescription>
            Restauration point-in-time. Chaque archive est chiffrée et vérifiée par SHA-256.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {archives.length === 0 ? (
            <EmptyState
              title="Aucune sauvegarde"
              description="Cliquez sur « Sauvegarder maintenant » pour créer la première archive."
              icon={<Database className="size-7 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-xs text-muted-foreground">
                    <th className="text-start font-medium py-2 px-2">Date</th>
                    <th className="text-start font-medium py-2 px-2">Taille</th>
                    <th className="text-start font-medium py-2 px-2">Statut</th>
                    <th className="text-start font-medium py-2 px-2">Coffre</th>
                    <th className="text-start font-medium py-2 px-2">Expiration</th>
                    <th className="text-start font-medium py-2 px-2">Par</th>
                    {canManage && <th className="text-end font-medium py-2 px-2">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {archives.map((archive) => (
                    <tr
                      key={archive.id}
                      className="border-b border-border/50 hover:bg-accent/5"
                    >
                      <td className="py-2 px-2">
                        <div className="font-medium text-foreground">
                          {formatDateTime(archive.createdAt)}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {archive.id}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {formatBytes(archive.sizeBytes)}
                      </td>
                      <td className="py-2 px-2">
                        <StatusChip
                          label={BACKUP_STATUS_LABELS_FR[archive.status]}
                          tone={statusTone(archive.status)}
                        />
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {BACKUP_VAULT_LABELS_FR[archive.vaultLocation]}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {formatDate(archive.retentionExpiresAt)}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {archive.createdBy}
                      </td>
                      {canManage && (
                        <td className="py-2 px-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingRestore(archive)}
                              title="Restaurer cette archive"
                            >
                              <Upload className="size-4" />
                              Restaurer
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingDelete(archive)}
                              title="Supprimer cette archive"
                              className="text-status-danger hover:text-status-danger"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/*  Bottom card — automatic purge                                    */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="size-5 text-primary" />
            Purge automatique
          </CardTitle>
          <CardDescription>
            Rétention roulante 365 jours. Les archives expirées sont purgées automatiquement
            chaque nuit à 02:00. Aucune intervention manuelle requise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Clock className="size-4" />
              <span>
                Prochaine exécution :{" "}
                <span className="font-medium text-foreground">
                  {formatDateTime(nextScheduledRun())}
                </span>
              </span>
            </div>
            <Button
              variant="outline"
              onClick={handlePurge}
              disabled={!canManage || purging}
            >
              {purging ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Purge en cours…
                </>
              ) : (
                <>
                  <Trash2 className="size-4" />
                  Purger maintenant
                </>
              )}
            </Button>
          </div>
          <div className="mt-3 rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <Shield className="inline size-3.5 mr-1 text-info" />
            Toutes les archives sont chiffrées avec AES-256-GCM (authenticated encryption).
            La clé est dérivée du mot de passe via PBKDF2 (100 000 itérations) — aucune donnée
            en clair n'est jamais écrite dans le coffre IndexedDB.
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/*  Confirmation modals                                              */}
      {/* ---------------------------------------------------------------- */}
      <ConfirmModal
        open={pendingRestore !== null}
        onOpenChange={(o) => !o && setPendingRestore(null)}
        title="Restaurer la sauvegarde ?"
        description="Cette action remplacera les données actuelles. Irréversible."
        confirmLabel={restoring ? "Restauration…" : "Restaurer"}
        destructive
        onConfirm={handleRestore}
      />
      <ConfirmModal
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Supprimer l'archive ?"
        description={
          pendingDelete
            ? `L'archive ${pendingDelete.id} sera définitivement supprimée du coffre. Action irréversible.`
            : "L'archive sera définitivement supprimée du coffre."
        }
        confirmLabel={deleting ? "Suppression…" : "Supprimer"}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}

/** Small summary tile used in the top card. */
function SummaryItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1")}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
