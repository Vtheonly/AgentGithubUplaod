/**
 * SupabaseBackupRepository — T-415 (BKUP-501): the server-side metadata
 * mirror for the local backup vault.
 *
 * Migration 0013 built the complete server half of the backup metadata
 * pipeline — `backup_archives` ("Postgres must NEVER see the plaintext or
 * the ciphertext — only the metadata needed for retention, integrity
 * verification (checksum), and audit"), 0019's tenant/admin RLS, 0022's
 * `purge_expired_backups` RPC and the weekly purge EF — but the desktop
 * never wrote its half: zero call sites touched the table, backup
 * discovery/indexing/versions/recovery information existed nowhere but the
 * local device, and in Supabase mode the Settings list showed 3 in-memory
 * fake seed archives instead of any real record. This repository wires the
 * desktop's half.
 *
 * ARCHITECTURE (plan §13.03 preserved — ciphertext NEVER leaves the vault):
 *   - The CIPHERTEXT and every crypto operation stay 100 % local: the same
 *     backup-service functions the mock repository delegates to (IndexedDB
 *     vault + AES-256-GCM + audit log). Supabase holds ONLY metadata.
 *   - The server metadata mirror is BEST-EFFORT: a Supabase outage never
 *     blocks a backup/restore (issue #13's "Supabase becomes temporarily
 *     unavailable" requirement — the local vault is the reliability
 *     authority, the mirror is the discovery/recovery-information index).
 *     Every mirror failure is logged and swallowed; the local operation's
 *     Result is untouched.
 *   - `observe()` reads the SERVER table (the discovery surface): in
 *     Supabase mode the Settings → Sauvegarde list shows real metadata rows
 *     ordered newest-first — the 3 fake demo seeds disappear (honest empty
 *     state until the first real backup).
 *
 * Status transitions mirror the vault's (BKUP-503): runBackup inserts
 * 'encrypted', a successful restore updates 'restored' + restored_at/by,
 * the vault's corruption verdicts propagate, purge marks 'purged' (the
 * 0022 RPC semantics), a manual delete removes the row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BackupRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { SubjectBehavior } from "../../mock/subject-behavior";
import type {
  ArchiveInspection,
  BackupArchive,
  BackupRestoreResult,
} from "../../../domain/model/backup";
import {
  runBackup as runBackupService,
  restore as restoreService,
  inspectArchive as inspectArchiveService,
  purgeExpired as purgeExpiredService,
  deleteArchive as deleteArchiveService,
  deriveBackupKey,
} from "../../backup/backup-service";
import { getArchive } from "../../backup/indexed-db-vault";
import { logger } from "../../../core/logger";
import { getTenantId, isUuid } from "./supabase-shared-repositories";

/** The server row shape (migration 0013 §C.1). */
interface BackupArchiveRow {
  id: string;
  tenant_id: string;
  archive_id_text: string;
  file_name: string;
  size_bytes: number;
  checksum_sha256: string;
  vault_location: "indexeddb" | "local_drive" | "offsite_vault";
  status: "encrypted" | "restored" | "corrupted" | "purged";
  retention_expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  restored_at: string | null;
  restored_by: string | null;
  purge_at: string | null;
  metadata: Record<string, unknown>;
}

/** Vault-location mapping: the domain's two values ↔ the server's three. */
const VAULT_LOCATION_TO_DOMAIN: Record<BackupArchiveRow["vault_location"], BackupArchive["vaultLocation"]> = {
  indexeddb: "local",
  local_drive: "local",
  offsite_vault: "offsite",
};

const DOMAIN_TO_VAULT_LOCATION: Record<BackupArchive["vaultLocation"], BackupArchiveRow["vault_location"]> = {
  local: "indexeddb",
  offsite: "offsite_vault",
};

/** Server row → domain BackupArchive. */
function rowToArchive(row: BackupArchiveRow): BackupArchive {
  const meta = (row.metadata ?? {}) as BackupArchive["metadata"] & { createdByName?: string };
  return {
    id: row.archive_id_text,
    tenantId: row.tenant_id,
    createdAt: row.created_at,
    sizeBytes: row.size_bytes,
    checksum: row.checksum_sha256,
    vaultLocation: VAULT_LOCATION_TO_DOMAIN[row.vault_location] ?? "local",
    status: row.status,
    retentionExpiresAt: row.retention_expires_at ?? row.created_at,
    createdBy: meta.createdByName ?? row.created_by ?? "system",
    metadata: meta,
  };
}

export class SupabaseBackupRepository implements BackupRepository {
  private archives$: SubjectBehavior<BackupArchive[]>;

  constructor(private readonly client: SupabaseClient) {
    this.archives$ = new SubjectBehavior<BackupArchive[]>([]);
    // Seed the discovery surface from the server table (best-effort — a
    // failure leaves the honest empty list; every operation re-refreshes).
    void this.refreshFromServer();
  }

  observe(): Observable<BackupArchive[]> {
    return this.archives$;
  }

  observeById(id: string): Observable<BackupArchive | null> {
    return new SubjectBehavior(
      this.archives$.get().find((a: BackupArchive) => a.id === id) ?? null,
    );
  }

  /**
   * Run a backup: the local vault pipeline (serialize → gzip → AES-256-GCM
   * → checksum → IndexedDB → audit), then the server metadata mirror.
   * The mirror is best-effort — a Supabase outage never fails the backup.
   */
  async runBackup(actorId: string, actorName: string): Promise<Result<BackupArchive>> {
    const repos = await this.snapshotRepositories();
    const result = await runBackupService(repos, actorId, actorName);
    if (result.ok) {
      await this.mirrorInsert(result.value, actorId, actorName);
      await this.refreshFromServer();
    }
    return result;
  }

  /**
   * Restore an archive: the local vault pipeline (decrypt → verify →
   * apply → arm staging → marker → audit), then the status transition
   * mirrored server-side (whatever the vault now says — 'restored' on
   * success, 'corrupted' on the unambiguous integrity classes).
   */
  async restore(archiveId: string, actorId: string, actorName: string): Promise<Result<BackupRestoreResult>> {
    const repos = await this.snapshotRepositories();
    const result = await restoreService(repos, archiveId, actorId, actorName);
    // Mirror the vault's CURRENT status — covers both the 'restored'
    // success transition and the 'corrupted' integrity verdicts.
    await this.mirrorVaultStatus(archiveId, result.ok ? actorId : null);
    if (result.ok) await this.refreshFromServer();
    return result;
  }

  /** T-300: the offline point-in-time selector's read path (pure local). */
  async inspectArchive(archiveId: string): Promise<Result<ArchiveInspection>> {
    return inspectArchiveService(archiveId);
  }

  /** Manual delete: the local vault removal + the server row removal. */
  async deleteArchive(archiveId: string, actorId: string, actorName: string): Promise<Result<void>> {
    const repos = await this.snapshotRepositories();
    const result = await deleteArchiveService(repos, archiveId, actorId, actorName);
    if (result.ok) {
      await this.mirrorDelete(archiveId);
      await this.refreshFromServer();
    }
    return result;
  }

  /**
   * Retention sweep: the local vault purge + the server rows marked
   * 'purged' (the 0022 `purge_expired_backups` RPC semantics — the rows
   * remain as recovery/audit information).
   */
  async purgeExpired(actorId: string, actorName: string): Promise<Result<BackupArchive[]>> {
    const repos = await this.snapshotRepositories();
    const result = await purgeExpiredService(repos, actorId, actorName);
    if (result.ok) {
      for (const purged of result.value) {
        await this.mirrorPurge(purged.id);
      }
      await this.refreshFromServer();
    }
    return result;
  }

  async getEncryptionKey(): Promise<Result<CryptoKey>> {
    try {
      const key = await deriveBackupKey();
      return Ok(key);
    } catch (err) {
      return Err(Errors.unknown(err));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  The server-side metadata mirror (best-effort, never blocking)      */
  /* ------------------------------------------------------------------ */

  private async mirrorInsert(
    archive: BackupArchive,
    actorId: string,
    actorName: string,
  ): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) {
      logger.warn("backup.mirror.skipped_no_tenant", { archiveId: archive.id });
      return;
    }
    try {
      const { error } = await this.client.from("backup_archives").insert({
        tenant_id: tenantId,
        archive_id_text: archive.id,
        file_name: archive.id,
        size_bytes: archive.sizeBytes,
        checksum_sha256: archive.checksum,
        vault_location: DOMAIN_TO_VAULT_LOCATION[archive.vaultLocation],
        status: archive.status,
        retention_expires_at: archive.retentionExpiresAt,
        created_by: isUuid(actorId) ? actorId : null,
        restored_at: null,
        restored_by: null,
        metadata: {
          ...(archive.metadata ?? {}),
          createdByName: actorName,
          schemaVersion: 1,
        },
      });
      if (error) {
        logger.warn("backup.mirror.insert_failed", {
          archiveId: archive.id,
          error: error.message,
        });
      }
    } catch (err) {
      logger.warn("backup.mirror.insert_threw", {
        archiveId: archive.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Mirror the vault record's CURRENT status onto the server row. */
  private async mirrorVaultStatus(archiveId: string, restoredBy: string | null): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) return;
    try {
      const record = await getArchive(archiveId);
      if (!record) return; // Not a vault archive (e.g. a foreign-machine row).
      const patch: Record<string, unknown> = { status: record.metadata.status };
      if (record.metadata.status === "restored") {
        patch.restored_at = new Date().toISOString();
        if (restoredBy && isUuid(restoredBy)) patch.restored_by = restoredBy;
      }
      const { error } = await this.client
        .from("backup_archives")
        .update(patch)
        .eq("archive_id_text", archiveId)
        .eq("tenant_id", tenantId);
      if (error) {
        logger.warn("backup.mirror.status_failed", { archiveId, error: error.message });
      }
    } catch (err) {
      logger.warn("backup.mirror.status_threw", {
        archiveId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async mirrorDelete(archiveId: string): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) return;
    try {
      const { error } = await this.client
        .from("backup_archives")
        .delete()
        .eq("archive_id_text", archiveId)
        .eq("tenant_id", tenantId);
      if (error) {
        logger.warn("backup.mirror.delete_failed", { archiveId, error: error.message });
      }
    } catch (err) {
      logger.warn("backup.mirror.delete_threw", {
        archiveId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async mirrorPurge(archiveId: string): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) return;
    try {
      const { error } = await this.client
        .from("backup_archives")
        .update({ status: "purged" })
        .eq("archive_id_text", archiveId)
        .eq("tenant_id", tenantId);
      if (error) {
        logger.warn("backup.mirror.purge_failed", { archiveId, error: error.message });
      }
    } catch (err) {
      logger.warn("backup.mirror.purge_threw", {
        archiveId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Refresh the discovery surface from the server table (best-effort). */
  private async refreshFromServer(): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) return; // No tenant context — the honest empty list stands.
    try {
      const { data, error } = await this.client
        .from("backup_archives")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) {
        logger.warn("backup.mirror.list_failed", { error: error.message });
        return;
      }
      const rows = (data ?? []) as unknown as BackupArchiveRow[];
      this.archives$.set(rows.map(rowToArchive));
    } catch (err) {
      logger.warn("backup.mirror.list_threw", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * The Repositories barrel the backup-service functions operate on: in
   * Supabase mode this is the SUPABASE barrel — runBackup's snapshot reads
   * the live repositories' reactive caches (the app's current data view)
   * and the audit trail lands in the SERVER's audit_logs (via the Supabase
   * audit repository), not the in-memory mock journal. Lazy dynamic import
   * to avoid the module-load cycle (the factory imports this class).
   *
   * KNOWN BOUNDARY (documented in the T-415 registry entry): the reactive
   * caches seed asynchronously on first observe() — a backup taken on a
   * cold app (before any screen subscribed) snapshots empty collections.
   * The archive's metadata counts (parentCount/…) honestly expose that
   * (the Settings list + inspectArchive show 0) — the detection surface,
   * pinned by the t-415 metadata-fidelity tests.
   */
  private async snapshotRepositories(): Promise<
    import("../../../app/providers/repository-provider").Repositories
  > {
    const { getSupabaseRepositories } = await import("../supabase-repositories");
    return getSupabaseRepositories();
  }
}
