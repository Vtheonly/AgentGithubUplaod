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
import { useState, useEffect } from "react";
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
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Permission } from "../../core/rbac/permissions";
import { formatDateTime, formatDate, formatRelative } from "../../core/format/date";
import {
  getSystemConfigService,
} from "../../infrastructure/system-config";
import {
  hasBackupPassphrase,
  setBackupPassphrase,
} from "../../infrastructure/backup/backup-service";
import {
  readRunLog,
  checkVaultCapacity,
  type BackupRunLogEntry,
  type StorageCapacity,
} from "../../infrastructure/backup/backup-scheduler";
import { isSupabaseConfigured, getSupabaseClient } from "../../infrastructure/supabase/supabase-client";
import {
  BACKUP_STATUS_LABELS_FR,
  BACKUP_VAULT_LABELS_FR,
  type BackupArchive,
} from "../../domain/model/backup";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { EmptyState } from "../../shared/layout/state-views";
import { ConfirmModal } from "../../shared/ui/unified-modal";
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

/**
 * Backup config snapshot — read from `system_settings` category="backup".
 * Falls back to seeded defaults (365 / 24 / "02:00") when Supabase is not
 * configured or the settings are missing. Iteration 15 fix — previously
 * these values were hardcoded throughout the BackupTab.
 */
interface BackupConfig {
  retentionDays: number;
  scheduleHours: number;
  scheduleTime: string; // "HH:MM"
  passphraseConfigured: boolean;
}

const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  retentionDays: 365,
  scheduleHours: 24,
  scheduleTime: "02:00",
  passphraseConfigured: false,
};

function useBackupConfig(): BackupConfig {
  const [cfg, setCfg] = useState<BackupConfig>(DEFAULT_BACKUP_CONFIG);
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const service = getSystemConfigService(getSupabaseClient());
    void (async () => {
      const result = await service.listByCategory("backup");
      if (!result.ok) return;
      const next: BackupConfig = { ...DEFAULT_BACKUP_CONFIG };
      for (const s of result.value) {
        if (s.key === "backup.retention_days" && typeof s.value === "number") {
          next.retentionDays = s.value;
        } else if (s.key === "backup.schedule_hours" && typeof s.value === "number") {
          next.scheduleHours = s.value;
        } else if (s.key === "backup.schedule_time" && typeof s.value === "string") {
          next.scheduleTime = s.value;
        } else if (s.key === "backup.passphrase" && s.is_sensitive) {
          next.passphraseConfigured = s.is_configured;
        }
      }
      setCfg(next);
    })();
  }, []);
  return cfg;
}

/**
 * Compute the next scheduled run timestamp based on the configured
 * schedule_time (e.g. "02:00") + schedule_hours interval.
 */
function nextScheduledRun(cfg: BackupConfig): Date {
  const [h, m] = cfg.scheduleTime.split(":").map((x) => parseInt(x, 10));
  const now = new Date();
  const next = new Date(now);
  next.setHours(isNaN(h) ? 2 : h, isNaN(m) ? 0 : m, 0, 0);
  // If today's scheduled time has passed, advance by schedule_hours.
  while (next.getTime() <= now.getTime()) {
    next.setHours(next.getHours() + cfg.scheduleHours);
  }
  return next;
}

export function BackupTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const backupCfg = useBackupConfig();

  const archives = useObservable(() => repos.backups.observe(), []);
  const [runningBackup, setRunningBackup] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupArchive | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupArchive | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [purging, setPurging] = useState(false);
  // VAULT §13.02 / §13.06 — passphrase state + daemon run log + capacity.
  const [passphraseReady, setPassphraseReady] = useState(hasBackupPassphrase());
  const [passphraseInput, setPassphraseInput] = useState("");
  const [runLog, setRunLog] = useState<BackupRunLogEntry[]>([]);
  const [capacity, setCapacity] = useState<StorageCapacity | null>(null);

  useEffect(() => {
    setRunLog(readRunLog());
    void checkVaultCapacity().then(setCapacity);
  }, []);

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
      setRunLog(readRunLog());
      setCapacity(await checkVaultCapacity());
    } finally {
      setRunningBackup(false);
    }
  }

  /** VAULT §13.02 — set the backup passphrase (never hard-coded). */
  function handleSavePassphrase() {
    const trimmed = passphraseInput.trim();
    if (trimmed.length < 8) {
      toast.showWarning(
        "Phrase secrète trop courte",
        "Utilisez au moins 8 caractères. Elle protège la clé AES-256 de toutes les archives.",
      );
      return;
    }
    setBackupPassphrase(trimmed);
    setPassphraseReady(true);
    setPassphraseInput("");
    toast.showSuccess(
      "Phrase secrète configurée",
      "La clé de chiffrement est maintenant dérivée de votre phrase secrète (stockée séparément des archives). Conservez-la précieusement — sans elle, aucune restauration n'est possible.",
    );
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
                Cycle {backupCfg.scheduleHours}h · chiffrement AES-256-GCM · rétention {backupCfg.retentionDays} jours (plan §13)
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
      {/*  VAULT §13.02 — passphrase configuration (never hard-coded)      */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="size-5 text-primary" />
            Clé de chiffrement (phrase secrète)
          </CardTitle>
          <CardDescription>
            La clé AES-256 est dérivée de votre phrase secrète, stockée SÉPARÉMENT des archives —
            jamais codée en dur (plan §13.02).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {passphraseReady ? (
            <div className="flex items-center gap-2 text-sm">
              <StatusChip label="Configurée" tone="success" />
              <span className="text-muted-foreground text-xs">
                Sauvegardes chiffrées avec la clé dérivée de la phrase secrète enregistrée.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5 text-xs text-status-warning">
                Aucune phrase secrète configurée — les sauvegardes sont désactivées jusqu'à
                configuration de la clé. Saisissez une phrase secrète (min. 8 caractères).
              </div>
              {canManage && (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={passphraseInput}
                    onChange={(e) => setPassphraseInput(e.target.value)}
                    placeholder="Phrase secrète de sauvegarde"
                    className="flex-1 h-9 rounded-md border border-border bg-background px-3 text-sm"
                  />
                  <Button onClick={handleSavePassphrase} disabled={!passphraseInput.trim()}>
                    Enregistrer la clé
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/*  VAULT §13.06 — vault capacity + daemon run log                  */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="size-5 text-primary" />
            Coffre & journal du démon
          </CardTitle>
          <CardDescription>
            Espace du coffre (alerte à 80%) · historique des exécutions planifiées et manuelles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {capacity?.usedPercent != null ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Espace utilisé : {formatBytes(capacity.usageBytes ?? 0)} / {formatBytes(capacity.quotaBytes ?? 0)}
                </span>
                <span className={capacity.alert ? "font-semibold text-status-danger" : "text-muted-foreground"}>
                  {capacity.usedPercent}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${capacity.alert ? "bg-status-danger" : "bg-status-success"}`}
                  style={{ width: `${Math.min(100, capacity.usedPercent)}%` }}
                />
              </div>
              {capacity.alert && (
                <p className="text-[11px] text-status-danger">
                  Capacité critique — purgez les anciennes archives ou exportez-les vers le coffre hors-site.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Estimation d'espace non disponible dans cet environnement.
            </p>
          )}
          {runLog.length > 0 ? (
            <div className="rounded-md border border-border max-h-56 overflow-y-auto">
              <ul className="divide-y divide-border text-xs">
                {runLog.map((entry, i) => (
                  <li key={`${entry.at}-${i}`} className="flex items-center gap-2 px-3 py-2">
                    <StatusChip
                      label={entry.status === "success" ? "OK" : "Échec"}
                      tone={entry.status === "success" ? "success" : "danger"}
                    />
                    <span className="text-muted-foreground font-mono text-[10px]">
                      {formatDateTime(entry.at)}
                    </span>
                    <span className="text-muted-foreground">
                      {entry.trigger === "scheduled" ? "planifiée (02:00)" : "manuelle"}
                    </span>
                    {entry.sizeBytes != null && (
                      <span className="text-muted-foreground font-mono">{formatBytes(entry.sizeBytes)}</span>
                    )}
                    <span className="text-muted-foreground">{entry.durationMs} ms</span>
                    {entry.error && (
                      <span className="ml-auto truncate text-status-danger" title={entry.error}>
                        {entry.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Aucune exécution enregistrée pour l'instant. La prochaine sauvegarde planifiée : {formatRelative(nextScheduledRun(backupCfg).toISOString())}.
            </p>
          )}
        </CardContent>
      </Card>
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
            Rétention roulante {backupCfg.retentionDays} jours. Les archives expirées sont purgées automatiquement
            chaque cycle de {backupCfg.scheduleHours}h à {backupCfg.scheduleTime}. Aucune intervention manuelle requise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Clock className="size-4" />
              <span>
                Prochaine exécution :{" "}
                <span className="font-medium text-foreground">
                  {formatDateTime(nextScheduledRun(backupCfg))}
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
