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
  Search,
} from "lucide-react";
// T-475: the canonical inspection-button design (the owner's UI consistency
// mandate — every inspection button in the app renders through this class).
import { INSPECT_TRIGGER_CLASS } from "../dashboard/components/analytics/data-inspector-core";
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
  getRestoredFromMarker,
  clearRestoredFromMarker,
} from "../../infrastructure/backup/backup-service";
import {
  readRunLog,
  checkVaultCapacity,
  isSchedulerEnabled,
  setSchedulerEnabled,
  nextScheduledRunAt,
  type BackupRunLogEntry,
  type StorageCapacity,
} from "../../infrastructure/backup/backup-scheduler";
import { isSupabaseConfigured, getSupabaseClient } from "../../infrastructure/supabase/supabase-client";
import { ExportDialog } from "./export-dialog";
import { FolderOpen, HardDriveDownload, FileArchive, FileUp, MapPin } from "lucide-react";
// T-505 (BKUP-511): the file-based backup workflows — the Excel checkpoint
// (the warmed ZIP-of-Excel) + the restore-from-file ladder.
import { buildBackupCheckpoint } from "../../infrastructure/backup/backup-checkpoint";
import {
  pickBackupFileViaDialog,
  inspectBackupFile,
  importBackupArchive,
  type BackupFileInspection,
  type InspectedBackupArchive,
} from "../../infrastructure/backup/backup-file-restore";
import {
  getLastBackupSourceDir,
  setLastBackupSourceDir,
  getLastBackupDestinationDir,
  setLastBackupDestinationDir,
} from "../../infrastructure/backup/backup-locations";
import {
  hasBackupFilePickerBridge,
  hasDirectoryPickerBridge,
  saveExportWithPicker,
} from "../../infrastructure/export/export-target";
import { describeWarmupReport } from "../../infrastructure/export/export-warmup";
import {
  BACKUP_STATUS_LABELS_FR,
  BACKUP_VAULT_LABELS_FR,
  type ArchiveInspection,
  type BackupArchive,
  type RestoredFromMarker,
} from "../../domain/model/backup";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Switch } from "../../shared/ui/switch";
import { StatusChip } from "../../shared/ui/status-chip";
import { EmptyState } from "../../shared/layout/state-views";
import { ConfirmModal, UnifiedModal } from "../../shared/ui/unified-modal";
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
  // T-300 (OFFLINE-400): the offline point-in-time inspector + the
  // restored-from mode banner.
  const [inspection, setInspection] = useState<ArchiveInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [restoredFrom, setRestoredFrom] = useState<RestoredFromMarker | null>(() =>
    getRestoredFromMarker(),
  );
  // VAULT §13.02 / §13.06 — passphrase state + daemon run log + capacity.
  const [passphraseReady, setPassphraseReady] = useState(hasBackupPassphrase());
  const [passphraseInput, setPassphraseInput] = useState("");
  const [runLog, setRunLog] = useState<BackupRunLogEntry[]>([]);
  const [capacity, setCapacity] = useState<StorageCapacity | null>(null);
  // T-301 (OFFLINE-400): the persisted scheduler on/off preference.
  const [schedulerEnabled, setSchedulerEnabledState] = useState(() => isSchedulerEnabled());
  // T-382 (BKUP-500): the Sync/Export area's archive-export dialog.
  const [exportOpen, setExportOpen] = useState(false);
  // T-505 (BKUP-511): the file-based backup workflows.
  const [checkpointing, setCheckpointing] = useState(false);
  const [fileInspecting, setFileInspecting] = useState(false);
  const [fileInspection, setFileInspection] = useState<BackupFileInspection | null>(null);
  const [selectedFileArchive, setSelectedFileArchive] = useState<InspectedBackupArchive | null>(null);
  const [fileRestoring, setFileRestoring] = useState(false);
  const [confirmFileRestore, setConfirmFileRestore] = useState(false);
  // T-505: the remembered locations (persisted; refreshed on every change).
  const [lastSourceDir, setLastSourceDirState] = useState<string | null>(() => getLastBackupSourceDir());
  const [lastDestDir, setLastDestDirState] = useState<string | null>(() => getLastBackupDestinationDir());

  const canPickBackupFile = hasBackupFilePickerBridge();
  const canPickDirectory = hasDirectoryPickerBridge();

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
      // T-505 (BKUP-512): the SAFETY BACKUP before ANY restore — the owner's
      // explicit requirement ("create a safety backup of the current data
      // whenever appropriate"). A failed safety backup REFUSES the restore:
      // the current data is preserved untouched.
      const safety = await repos.backups.runBackup(actorId, actorName);
      if (!safety.ok) {
        toast.showError(
          "Restauration refusée — sauvegarde de sécurité impossible",
          `La sauvegarde préalable de l'état actuel a échoué (${safety.error.userMessage}). Aucune donnée n'a été modifiée.`,
        );
        return;
      }
      const r = await repos.backups.restore(pendingRestore.id, actorId, actorName);
      if (r.ok) {
        setRestoredFrom(getRestoredFromMarker());
        toast.showSuccess(
          "Restauration appliquée",
          `État opérationnel remplacé en ${r.value.durationMs} ms (sauvegarde de sécurité préalable : ${safety.value.id}). Les modifications suivantes sont mises en file et synchronisées à la reconnexion.`,
        );
      } else {
        toast.showError("Restauration échouée", r.error.userMessage);
      }
    } finally {
      setRestoring(false);
      setPendingRestore(null);
    }
  }

  /** T-300: inspect an archive offline (decrypt + verify, NO restore). */
  async function handleInspect(archive: BackupArchive) {
    setInspecting(true);
    try {
      const r = await repos.backups.inspectArchive(archive.id);
      if (r.ok) {
        setInspection(r.value);
      } else {
        toast.showError("Inspection échouée", r.error.userMessage);
      }
    } finally {
      setInspecting(false);
    }
  }

  /** T-300: close the restored-from mode (clears the marker). */
  function handleClearRestoredFrom() {
    clearRestoredFromMarker();
    setRestoredFrom(null);
    toast.showInfo(
      "Mode restauré fermé",
      "L'indicateur de restauration a été effacé. La file de synchronisation conserve les modifications mises en attente.",
    );
  }

  /** T-301: toggle the automatic scheduler (persisted; read at every tick). */
  function handleToggleScheduler(enabled: boolean) {
    setSchedulerEnabled(enabled);
    setSchedulerEnabledState(enabled);
    if (enabled) {
      toast.showSuccess(
        "Planification activée",
        `La sauvegarde automatique reprend — prochaine exécution ${formatDateTime(nextScheduledRunAt())}.`,
      );
    } else {
      toast.showWarning(
        "Planification désactivée",
        "Aucune sauvegarde automatique ne s'exécutera. Les sauvegardes manuelles restent disponibles.",
      );
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

  /**
   * T-505 (BKUP-511, the owner's task 1): build the ZIP-of-Excel backup
   * checkpoint (the WARMED 13-sheet workbook — BKUP-510's fix guarantees it
   * never silently carries a cold/degraded cache) and let the owner choose
   * the destination through the native save dialog (the remembered
   * destination opens the dialog where they left off).
   */
  async function handleCheckpoint() {
    setCheckpointing(true);
    try {
      const built = await buildBackupCheckpoint(repos, actorId, actorName);
      if (!built.ok) {
        toast.showError("Échec du point de contrôle", built.error.userMessage);
        return;
      }
      const result = await saveExportWithPicker(
        built.value.bytes,
        built.value.fileName,
        built.value.mime,
        lastDestDir ?? undefined,
      );
      if (result.canceled) {
        toast.showInfo("Point de contrôle annulé", "Aucun fichier écrit — la boîte de dialogue a été fermée.");
        return;
      }
      if (result.saved) {
        if (result.path) {
          const dir = result.path.slice(0, Math.max(result.path.lastIndexOf("/"), result.path.lastIndexOf("\\")));
          if (dir) {
            setLastBackupDestinationDir(dir);
            setLastDestDirState(dir);
          }
        }
        toast.showSuccess(
          "Point de contrôle Excel enregistré",
          `${built.value.fileName} — ${built.value.summary}. Emplacement : ${result.path ?? "le dossier de téléchargement du navigateur"}. Récupération : réimportez le classeur via l'import Excel.`,
        );
        const degraded = built.value.warmup.filter((w) => w.status === "degraded");
        if (degraded.length > 0) {
          toast.showWarning(
            "Sources de données dégradées",
            `Le point de contrôle a été construit avec l'état dernier-connu de : ${degraded.map((d) => d.source).join(", ")} (${describeWarmupReport(built.value.warmup)}).`,
          );
        }
      }
    } catch (e) {
      toast.showError("Échec du point de contrôle", e instanceof Error ? e.message : String(e));
    } finally {
      setCheckpointing(false);
    }
  }

  /**
   * T-505 (BKUP-511, the owner's tasks 3+4): browse the computer with the
   * NATIVE file dialog, validate the picked file (the ladder), and show the
   * pre-restore inspection (filename, location, dates, contents) — the
   * owner then selects WHICH archive to restore.
   */
  async function handlePickBackupFile() {
    setFileInspecting(true);
    try {
      const file = await pickBackupFileViaDialog();
      if (!file) return; // canceled — a clean outcome
      const dir = file.path.slice(0, Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\")));
      if (dir) {
        setLastBackupSourceDir(dir);
        setLastSourceDirState(dir);
      }
      const inspection = inspectBackupFile(file);
      setFileInspection(inspection);
      setSelectedFileArchive(null);
      if (inspection.kind === "invalid") {
        toast.showWarning(
          "Fichier non restaurable",
          inspection.integrityNote ?? "Le fichier sélectionné n'est pas une sauvegarde restaurable.",
        );
      } else if (inspection.kind === "excel-zip") {
        toast.showInfo("Export Excel détecté", inspection.integrityNote ?? "");
      }
    } catch (e) {
      toast.showError("Échec de la sélection", e instanceof Error ? e.message : String(e));
    } finally {
      setFileInspecting(false);
    }
  }

  /**
   * T-505: the explicit default-destination chooser (the native directory
   * dialog — never a hardcoded backup directory; changeable any time).
   */
  async function handleChooseDestination() {
    try {
      const bridge = typeof window !== "undefined" ? window.elImtiyazDesktop : undefined;
      if (typeof bridge?.pickDirectory !== "function") {
        toast.showInfo("Indisponible hors Electron", "Le sélecteur de dossier nécessite l'application de bureau.");
        return;
      }
      const result = await bridge.pickDirectory("Dossier de destination des exports", lastDestDir ?? undefined);
      if (result.error) {
        toast.showError("Échec du sélecteur", result.error);
        return;
      }
      if (result.canceled || !result.directory) return;
      setLastBackupDestinationDir(result.directory);
      setLastDestDirState(result.directory);
      toast.showSuccess("Dossier mémorisé", `Les exports s'ouvriront par défaut sur : ${result.directory}.`);
    } catch (e) {
      toast.showError("Échec du sélecteur", e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * T-505: THE RESTORE-FROM-FILE execution — the owner's confirmed flow:
   * (1) the SAFETY BACKUP of the current state (the owner's explicit
   * requirement — if it fails, the restore is REFUSED and the current data
   * is preserved); (2) the import into the vault (checksum-gated); (3) the
   * EXISTING restore path (decrypt → verify → apply → stage → marker →
   * audit). A failure at any step leaves the current data intact.
   */
  async function handleFileRestore() {
    if (!selectedFileArchive) return;
    setFileRestoring(true);
    try {
      // 1. The safety backup of the CURRENT state.
      const safety = await repos.backups.runBackup(actorId, actorName);
      if (!safety.ok) {
        toast.showError(
          "Restauration refusée — sauvegarde de sécurité impossible",
          `La sauvegarde préalable de l'état actuel a échoué (${safety.error.userMessage}). Aucune donnée n'a été modifiée.`,
        );
        return;
      }
      // 2. The checksum-gated import into the vault.
      const imported = await importBackupArchive(selectedFileArchive);
      if (!imported.ok) {
        toast.showError("Restauration annulée — fichier invalide", imported.error);
        return;
      }
      // 3. The EXISTING restore path (no parallel implementation).
      const r = await repos.backups.restore(imported.archiveId, actorId, actorName);
      if (r.ok) {
        setRestoredFrom(getRestoredFromMarker());
        setFileInspection(null);
        setSelectedFileArchive(null);
        toast.showSuccess(
          "Restauration depuis fichier appliquée",
          `Archive ${imported.archiveId} restaurée en ${r.value.durationMs} ms. Une sauvegarde de sécurité de l'état précédent (${safety.value.id}) a été créée au préalable. Les modifications suivantes sont mises en file et synchronisées à la reconnexion.`,
        );
      } else {
        toast.showError("Restauration échouée", r.error.userMessage);
      }
    } catch (e) {
      toast.showError("Restauration échouée", e instanceof Error ? e.message : String(e));
    } finally {
      setFileRestoring(false);
      setConfirmFileRestore(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      {/* T-300 (OFFLINE-400): the restored-from mode banner — the app runs
          on the restored snapshot; post-restore mutations queue for the
          reconnect drain. */}
      {restoredFrom && (
        <div
          data-testid="restored-from-banner"
          className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 flex items-start gap-2"
        >
          <Clock className="h-4 w-4 mt-0.5 text-status-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              Mode restauré — {restoredFrom.archiveId}
            </p>
            <p className="text-xs text-muted-foreground">
              État opérationnel restauré le {formatDateTime(restoredFrom.restoredAt)} par {restoredFrom.restoredBy} ·{" "}
              {restoredFrom.counts.parents} parents, {restoredFrom.counts.students} élèves, {restoredFrom.counts.payments} paiements.
              Les modifications effectuées depuis sont mises en file et seront synchronisées à la reconnexion (sans perte).
            </p>
          </div>
          {canManage && (
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={handleClearRestoredFrom}>
              Fermer le mode
            </Button>
          )}
        </div>
      )}
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
      {/*  T-301 (OFFLINE-400) — the toggleable automatic scheduler           */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-5 text-primary" />
                Planification automatique
              </CardTitle>
              <CardDescription>
                Sauvegarde quotidienne à ~02:00 (coffre §13.01). Le réglage est persistant — la désactivation ne touche ni les sauvegardes manuelles ni les restaurations.
              </CardDescription>
            </div>
            {canManage && (
              <Switch
                checked={schedulerEnabled}
                onCheckedChange={handleToggleScheduler}
                aria-label="Activer la planification automatique"
                data-testid="backup-scheduler-toggle"
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Clock className="size-4" />
              <span>
                Prochaine exécution planifiée :{" "}
                <span className="font-medium text-foreground">
                  {schedulerEnabled ? formatDateTime(nextScheduledRunAt()) : "—"}
                </span>
              </span>
            </div>
            <Badge variant={schedulerEnabled ? "success" : "neutral"} data-testid="backup-scheduler-state">
              {schedulerEnabled ? "Active" : "Désactivée"}
            </Badge>
          </div>
          {!schedulerEnabled && (
            <p className="mt-2 text-xs text-muted-foreground">
              Le planificateur est en veille — aucune sauvegarde automatique ne s'exécutera tant que le réglage reste désactivé. L'historique des exécutions et la restauration point-in-time restent opérationnels.
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
      {/* ---------------------------------------------------------------- */}
      {/*  T-382 (BKUP-500) — the Sync/Export area: archive export with     */}
      {/*  destination + format choice (the owner's mandate).               */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDriveDownload className="size-5 text-primary" />
            Export / Synchronisation
          </CardTitle>
          <CardDescription>
            Exportez le coffre hors de l'application : choisissez le format (archive complète ou
            fichiers Excel seulement) puis l'emplacement dans la boîte de dialogue
            d'enregistrement — l'archive reste chiffrée AES-256-GCM.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => setExportOpen(true)}
            disabled={!canManage}
            className="min-w-[260px]"
            data-testid="backup-export-button"
          >
            <FolderOpen className="size-4" />
            Exporter l'archive…
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Deux formats au choix : <strong>Archive complète</strong> (structure du coffre + tous
            les fichiers associés : sauvegardes chiffrées, vecteurs d'initialisation, manifeste) ou{" "}
            <strong>Fichiers Excel seulement</strong> (le classeur complet 13 feuilles dans un ZIP).
          </p>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/*  T-505 (BKUP-511) — the LOCAL BACKUP FILES card: the owner's       */}
      {/*  file-based workflows (the ZIP-of-Excel checkpoint + the           */}
      {/*  restore-from-file ladder + the remembered locations).             */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileArchive className="size-5 text-primary" />
            Sauvegarde locale — fichiers
          </CardTitle>
          <CardDescription>
            Point de contrôle Excel (ZIP téléchargeable, récupérable via l'import) et restauration depuis un
            fichier de sauvegarde conservé où vous voulez (clé USB, disque externe…) — les boîtes de dialogue
            natives du système, aucun emplacement imposé.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Button
              onClick={handleCheckpoint}
              disabled={!canManage || checkpointing}
              className="justify-start"
              data-testid="backup-excel-checkpoint-button"
            >
              {checkpointing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Point de contrôle en cours…
                </>
              ) : (
                <>
                  <FileArchive className="size-4" />
                  Point de contrôle Excel (ZIP)…
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handlePickBackupFile}
              disabled={!canManage || fileInspecting || !canPickBackupFile}
              className="justify-start"
              data-testid="backup-restore-from-file-button"
              title={
                canPickBackupFile
                  ? "Parcourir l'ordinateur et restaurer depuis un fichier de sauvegarde"
                  : "Nécessite l'application de bureau Electron (le sélecteur de fichiers natif)"
              }
            >
              {fileInspecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Lecture du fichier…
                </>
              ) : (
                <>
                  <FileUp className="size-4" />
                  Parcourir et restaurer depuis un fichier…
                </>
              )}
            </Button>
          </div>
          {!canPickBackupFile && (
            <p className="text-xs text-muted-foreground">
              La restauration depuis un fichier nécessite l'application de bureau — le sélecteur de fichiers
              natif n'est pas disponible dans cette exécution navigateur.
            </p>
          )}
          {/* The remembered locations — surfaced + changeable at any time. */}
          <div
            className="rounded-md border border-border bg-muted/20 p-3 text-xs space-y-1.5"
            data-testid="backup-locations-panel"
          >
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="size-3.5" />
              <span className="font-medium">Emplacements mémorisés</span>
              <span className="text-muted-foreground/70">(entre les sessions — modifiables à tout moment)</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-muted-foreground">
                Dernier dossier source :{" "}
                <code className="font-mono text-[11px] text-foreground">{lastSourceDir ?? "—"}</code>
              </span>
              <span className="text-muted-foreground">
                Dernier dossier de destination :{" "}
                <code className="font-mono text-[11px] text-foreground">{lastDestDir ?? "—"}</code>
              </span>
            </div>
            <div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={handleChooseDestination}
                disabled={!canManage || !canPickDirectory}
                data-testid="backup-choose-destination-button"
              >
                <FolderOpen className="size-3.5" />
                Choisir le dossier de destination par défaut…
              </Button>
            </div>
          </div>
          <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            <Shield className="inline size-3.5 mr-1 text-info" />
            Le point de contrôle Excel est construit depuis l'état CHAUD des données (toutes les sources sont
            rechargées avant la construction — les sources dégradées sont signalées). La restauration depuis un
            fichier valide d'abord le fichier (format, manifeste, checksums), affiche son contenu avant
            exécution, exige votre confirmation, et crée une sauvegarde de sécurité de l'état actuel avant
            toute modification.
          </div>
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
                            {/* T-475 — the canonical inspection-button design
                                (INSPECT_TRIGGER_CLASS): the SAME visual language
                                as every data-inspector trigger in the app. The
                                handler, the data-testid, and the disabled
                                gating are unchanged — a UI-only change. */}
                            <button
                              type="button"
                              onClick={() => void handleInspect(archive)}
                              disabled={inspecting}
                              title="Inspecter le contenu (déchiffrer sans restaurer)"
                              aria-label="Inspecter le contenu (déchiffrer sans restaurer)"
                              data-testid={`inspect-${archive.id}`}
                              className={INSPECT_TRIGGER_CLASS}
                            >
                              <Search className="h-3.5 w-3.5 shrink-0" />
                              {/* T-502 (UI-333): no truncate — the shared
                                  class sizes the button to its label. */}
                              <span>Inspecter</span>
                            </button>
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
        description={
          pendingRestore
            ? `Cette action remplacera l'état opérationnel local par le contenu de l'archive ${pendingRestore.id} (${pendingRestore.metadata?.parentCount ?? 0} parents, ${pendingRestore.metadata?.studentCount ?? 0} élèves, ${pendingRestore.metadata?.paymentCount ?? 0} paiements). Une sauvegarde de sécurité de l'état actuel sera créée au préalable. Les modifications suivantes seront mises en file et synchronisées à la reconnexion.`
            : "Cette action remplacera l'état opérationnel local par le contenu de l'archive (les modifications suivantes seront mises en file et synchronisées à la reconnexion). Irréversible."
        }
        confirmLabel={restoring ? "Restauration…" : "Restaurer"}
        destructive
        onConfirm={handleRestore}
      />

      {/* T-300 (OFFLINE-400): the offline point-in-time inspector — decrypt +
          verify + parse WITHOUT restoring; corrupted archives render the
          honest status; a verified inspection offers the restore. */}
      <UnifiedModal
        open={inspection !== null}
        onOpenChange={(o) => !o && setInspection(null)}
        variant="dialog"
        size="lg"
        icon={Download}
        iconTone="primary"
        title={
          <span className="flex items-center gap-2 text-base">
            Inspection — <code className="font-mono text-primary text-sm">{inspection?.archiveId}</code>
          </span>
        }
        description={
          inspection
            ? `Instantané du ${formatDateTime(inspection.snapshotAt)} — contenu déchiffré sans restauration.`
            : undefined
        }
        hideCancel
        submitLabel="Fermer"
        onSubmit={() => setInspection(null)}
      >
        {inspection && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge
                variant={inspection.integrity === "verified" ? "success" : "danger"}
                data-testid="inspection-integrity"
              >
                {inspection.integrity === "verified" ? "Intégrité vérifiée" : "Corrompue"}
              </Badge>
              {inspection.integrityNote && (
                <span className="text-xs text-muted-foreground">{inspection.integrityNote}</span>
              )}
            </div>
            {inspection.integrity === "verified" && (
              <>
                <div className="grid grid-cols-4 gap-2">
                  <InspectionCount label="Parents" value={inspection.counts.parents} />
                  <InspectionCount label="Élèves" value={inspection.counts.students} />
                  <InspectionCount label="Paiements" value={inspection.counts.payments} />
                  <InspectionCount label="Tranches" value={inspection.counts.installments} />
                  <InspectionCount label="Écritures" value={inspection.counts.ledger} />
                  <InspectionCount label="Dépenses" value={inspection.counts.expenses} />
                  <InspectionCount label="Personnel" value={inspection.counts.personnel} />
                  <InspectionCount label="Workflows" value={inspection.counts.workflows} />
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const meta = archives.find((a) => a.id === inspection.archiveId);
                      setInspection(null);
                      if (meta) setPendingRestore(meta);
                    }}
                  >
                    <Upload className="size-4" />
                    Restaurer ce point-in-time
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </UnifiedModal>
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

      {/* T-382 (BKUP-500): the archive export — destination + format chosen
          BEFORE the export starts (the owner's mandated workflow). */}
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        origin="backups"
        defaultFormat="entire-archive"
      />

      {/* ---------------------------------------------------------------- */}
      {/*  T-505 (BKUP-511) — the restore-from-file inspection modal: the   */}
      {/*  owner sees the file's identity + contents and SELECTS which      */}
      {/*  archive to restore (never a single auto-picked one).             */}
      {/* ---------------------------------------------------------------- */}
      <UnifiedModal
        open={fileInspection !== null}
        onOpenChange={(o) => {
          if (!o) {
            setFileInspection(null);
            setSelectedFileArchive(null);
          }
        }}
        variant="dialog"
        size="lg"
        icon={FileUp}
        iconTone="primary"
        title={
          <span className="flex items-center gap-2 text-base">
            Fichier de sauvegarde — <code className="font-mono text-primary text-sm">{fileInspection?.fileName}</code>
          </span>
        }
        description={
          fileInspection
            ? `${fileInspection.filePath} · ${formatBytes(fileInspection.sizeBytes)}${
                fileInspection.lastModified ? ` · modifié le ${formatDateTime(fileInspection.lastModified)}` : ""
              }${fileInspection.exportedAt ? ` · exporté le ${formatDateTime(fileInspection.exportedAt)}` : ""}`
            : undefined
        }
        submitLabel={
          fileRestoring ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Restauration…
            </>
          ) : selectedFileArchive ? (
            <>
              <Upload className="size-4" />
              Restaurer l'archive sélectionnée
            </>
          ) : (
            "Sélectionnez une archive"
          )
        }
        submitDisabled={!selectedFileArchive || fileRestoring}
        onSubmit={() => setConfirmFileRestore(true)}
      >
        {fileInspection && (
          <div className="space-y-3">
            {fileInspection.kind === "invalid" && (
              <div className="rounded-md border border-status-danger/40 bg-status-danger/10 p-3 text-xs text-status-danger">
                {fileInspection.integrityNote ?? "Le fichier n'est pas une sauvegarde restaurable."}
              </div>
            )}
            {fileInspection.kind === "excel-zip" && (
              <div className="rounded-md border border-info/40 bg-info/5 p-3 text-xs text-muted-foreground">
                {fileInspection.integrityNote}
              </div>
            )}
            {fileInspection.kind === "entire-archive-zip" && (
              <>
                <p className="text-xs text-muted-foreground">
                  Export « Archive complète » — {fileInspection.archives.length} archive(s) chiffrée(s)
                  AES-256-GCM à l'intérieur. Sélectionnez celle à restaurer :
                </p>
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {fileInspection.archives.map((a) => {
                    const selected = selectedFileArchive?.archiveId === a.archiveId;
                    return (
                      <button
                        key={a.archiveId}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={a.integrity !== "verified"}
                        data-testid={`file-archive-${a.archiveId}`}
                        onClick={() => setSelectedFileArchive(a)}
                        className={cn(
                          "w-full text-left rounded-lg border p-2.5 transition-colors",
                          a.integrity !== "verified"
                            ? "border-status-danger/30 bg-status-danger/5 opacity-70 cursor-not-allowed"
                            : selected
                              ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                              : "border-border hover:border-primary/40 bg-background",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-3 rounded-full border shrink-0",
                              selected ? "border-primary bg-primary" : "border-border",
                            )}
                          />
                          <code className="font-mono text-[11px] text-foreground">{a.archiveId}</code>
                          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                            {formatBytes(a.sizeBytes)}
                          </span>
                        </div>
                        <div className="mt-1 pl-5 text-[11px] text-muted-foreground">
                          Créée le {formatDateTime(a.createdAt)} par {a.createdBy} · {a.counts.parents} parents ·{" "}
                          {a.counts.students} élèves · {a.counts.payments} paiements · {a.counts.installments} tranches
                        </div>
                        {a.integrity !== "verified" && a.integrityNote && (
                          <div className="mt-1 pl-5 text-[11px] text-status-danger">{a.integrityNote}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selectedFileArchive && (
                  <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-status-warning">
                    Une sauvegarde de sécurité de l'état ACTUEL sera créée avant la restauration, et votre
                    confirmation sera exigée — rien n'est modifié sans cela.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </UnifiedModal>

      {/* T-505: the restore-from-file confirmation — the destructive gate. */}
      <ConfirmModal
        open={confirmFileRestore}
        onOpenChange={(o) => !o && setConfirmFileRestore(false)}
        title="Restaurer depuis le fichier ?"
        description={
          selectedFileArchive
            ? `L'état opérationnel local sera remplacé par l'archive ${selectedFileArchive.archiveId} (${selectedFileArchive.counts.parents} parents, ${selectedFileArchive.counts.students} élèves, ${selectedFileArchive.counts.payments} paiements). Une sauvegarde de sécurité de l'état actuel sera créée au préalable. Les modifications suivantes seront mises en file et synchronisées à la reconnexion.`
            : "La restauration remplace l'état opérationnel local."
        }
        confirmLabel={fileRestoring ? "Restauration…" : "Restaurer"}
        destructive
        onConfirm={handleFileRestore}
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

/** T-300: one count tile inside the archive inspection modal. */
function InspectionCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
      <div className="text-lg font-mono font-semibold text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
