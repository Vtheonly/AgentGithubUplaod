/**
 * Backup service — orchestrates the run/restore/purge pipeline.
 *
 * Pipeline:
 *   1. Serialize: snapshot current mock state (parents, students, payments,
 *      ledger entries, expenses, personnel) to JSON.
 *   2. Compress: gzip via `CompressionStream('gzip')` (built into modern
 *      browsers + Node 18+).
 *   3. Encrypt: AES-256-GCM with a fresh random 12-byte IV.
 *   4. Checksum: SHA-256 hex of the ciphertext (defense-in-depth alongside
 *      the GCM auth tag — used to detect bit-rot in the vault itself).
 *   5. Store: write to the IndexedDB vault.
 *   6. Audit: log `backup.run` (or `backup.restore`, `backup.purge`,
 *      `backup.delete`) so every operation is traceable.
 *
 * The service is environment-agnostic — it accepts a `Repositories` object
 * so the same code works in the mock layer and in the production Supabase
 * adapter (which would call a server-side function for the actual backup).
 */
import type { Repositories } from "../../app/providers/repository-provider";
import type { Result } from "../../core/result";
import { Ok, Err, tryResult } from "../../core/result";
import { Errors } from "../../core/app-error";
import type {
  ArchiveInspection,
  ArchiveSnapshotCounts,
  BackupArchive,
  BackupRestoreResult,
  RestoredFromMarker,
} from "../../domain/model/backup";
import { BACKUP_RETENTION_DAYS } from "../../domain/model/backup";
import { logger } from "../../core/logger";
import {
  generateKey,
  encrypt,
  decrypt,
  sha256,
  encodeUtf8,
  decodeUtf8,
} from "./aes-256";
import { backupFileName } from "../../core/format/id";
import {
  storeArchive,
  getArchive,
  listArchiveMetadata,
  deleteArchive as vaultDelete,
  purgeExpired as vaultPurge,
} from "./indexed-db-vault";
import { store as mockStore } from "../mock/repositories/mock-store";

/** localStorage key for the backup passphrase (mock-only; production uses a secrets manager). */
export const BACKUP_PASSPHRASE_KEY = "el-imtiyaz:backup-passphrase";

/** T-300 (OFFLINE-400): the restored-from marker's localStorage key. */
export const RESTORED_FROM_KEY = "el-imtiyaz:restored-from";

/** Read the restored-from marker (null when not restored). */
export function getRestoredFromMarker(): RestoredFromMarker | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(RESTORED_FROM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RestoredFromMarker;
    if (typeof parsed.archiveId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Clear the restored-from marker (explicit close of the restored mode). */
export function clearRestoredFromMarker(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(RESTORED_FROM_KEY);
  } catch {
    /* ignore */
  }
}

/** Write the restored-from marker (internal — restore() sets it). */
function setRestoredFromMarker(marker: RestoredFromMarker): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(RESTORED_FROM_KEY, JSON.stringify(marker));
    }
  } catch {
    /* quota/private-mode — the in-session state still works. */
  }
}

/** Count the rows of one snapshot collection (tolerant of absent keys). */
function snapshotCounts(parsed: Record<string, unknown> | null): ArchiveSnapshotCounts {
  const n = (key: string): number =>
    Array.isArray(parsed?.[key]) ? (parsed[key] as unknown[]).length : 0;
  return {
    parents: n("parents"),
    students: n("students"),
    payments: n("payments"),
    installments: n("installments"),
    ledger: n("ledger"),
    expenses: n("expenses"),
    personnel: n("personnel"),
    workflows: n("workflows"),
  };
}

/** Salt for PBKDF2 — fixed per tenant in the mock; production would use a per-tenant secret. */
const BACKUP_SALT = encodeUtf8("el-imtiyaz-backup-salt-v1");

/**
 * VAULT §13.02 — the AES key is stored SEPARATELY from the backup files and
 * is NEVER hard-coded in the backup script. The passphrase MUST be set by
 * the administrator (Settings → Sauvegarde) before the first backup; it is
 * read at runtime from the secrets store (localStorage in the mock,
 * Supabase secrets / HSM in production).
 */
export function getBackupPassphrase(): string | null {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(BACKUP_PASSPHRASE_KEY);
      if (stored && stored.length > 0) return stored;
    }
  } catch {
    /* localStorage may be unavailable in some environments. */
  }
  return null;
}

/** Set (or clear) the backup passphrase at runtime. */
export function setBackupPassphrase(passphrase: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (passphrase && passphrase.length > 0) {
      localStorage.setItem(BACKUP_PASSPHRASE_KEY, passphrase);
    } else {
      localStorage.removeItem(BACKUP_PASSPHRASE_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** Whether a backup passphrase has been configured. */
export function hasBackupPassphrase(): boolean {
  return getBackupPassphrase() !== null;
}

/** Derive the AES-256-GCM CryptoKey from the configured passphrase. */
export async function deriveBackupKey(): Promise<CryptoKey> {
  const passphrase = getBackupPassphrase();
  if (!passphrase) {
    throw Errors.validation(
      "Aucune phrase secrète de sauvegarde configurée",
      "Configurez la phrase secrète (Settings → Sauvegarde) avant de lancer une sauvegarde. La clé AES-256 ne doit jamais être codée en dur (plan §13.02).",
    );
  }
  return generateKey(passphrase, BACKUP_SALT);
}

/**
 * VAULT §13.01 — the snapshot captures the COMPLETE operational state: the
 * data collections (the mock-layer equivalent of the PostgreSQL dump) PLUS
 * the system configuration state (workflow schemas, RBAC matrix,
 * pricing/academic configuration). AI provider config is out of scope.
 */
function snapshotState(repos: Repositories): Record<string, unknown> {
  // RBAC matrix overrides persist in localStorage (Settings → RBAC).
  let rbacMatrixOverrides: unknown = null;
  try {
    const raw = localStorage.getItem("el-imtiyaz:rbac-matrix-overrides");
    if (raw) rbacMatrixOverrides = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {
    snapshotAt: new Date().toISOString(),
    tenantId: "tenant-el-imtiyaz-oran-001",
    // Operational data (mock-layer "PostgreSQL dump").
    parents: repos.parents.observe().get(),
    students: repos.students.observe().get(),
    payments: repos.payments.observe().get(),
    installments: repos.installments.observe().get(),
    ledger: repos.ledger.observe().get(),
    expenses: repos.expenses.observe().get(),
    personnel: repos.personnel.observe().get(),
    // System configuration state (vault §13.01 item 2).
    workflows: repos.workflows.observe().get(),
    rbacMatrixOverrides,
  };
}

/**
 * Gzip-compress a Uint8Array via the CompressionStream API.
 *
 * Falls back gracefully in environments without CompressionStream (e.g. some
 * test runners) by returning the input unchanged with a `compressed: false`
 * marker. Production browsers all support CompressionStream (Chrome 80+,
 * Firefox 113+, Safari 16.4+).
 */
async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  if (
    typeof CompressionStream === "undefined" ||
    typeof Blob === "undefined" ||
    typeof Blob.prototype.stream !== "function"
  ) {
    logger.warn("backup.compress", {
      reason: "CompressionStream unavailable — storing uncompressed",
    });
    return data;
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Gzip-decompress a Uint8Array via the DecompressionStream API. */
async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  if (
    typeof DecompressionStream === "undefined" ||
    typeof Blob === "undefined" ||
    typeof Blob.prototype.stream !== "function"
  ) {
    return data;
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Build a BackupArchive metadata object. */
function buildArchiveMetadata(
  id: string,
  ciphertextBytes: number,
  checksum: string,
  createdBy: string,
  metadata: BackupArchive["metadata"],
): BackupArchive {
  const now = new Date();
  const expires = new Date(now.getTime() + BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return {
    id,
    tenantId: "tenant-el-imtiyaz-oran-001",
    createdAt: now.toISOString(),
    sizeBytes: ciphertextBytes,
    checksum,
    vaultLocation: "local",
    status: "encrypted",
    retentionExpiresAt: expires.toISOString(),
    createdBy,
    metadata,
  };
}

/**
 * Run a new backup.
 *
 * Steps per plan §13.02:
 *   serialize → gzip → AES-256-GCM encrypt → SHA-256 checksum →
 *   store in IndexedDB vault → audit log → return metadata.
 */
export async function runBackup(
  repos: Repositories,
  actorId: string,
  actorName: string,
): Promise<Result<BackupArchive>> {
  return tryResult(async () => {
    logger.info("backup.run.start", { actorId, actorName });

    // 1. Serialize
    const snapshot = snapshotState(repos);
    const jsonBytes = encodeUtf8(JSON.stringify(snapshot));

    // 2. Compress
    const compressed = await gzipCompress(jsonBytes);

    // 3. Encrypt
    const key = await deriveBackupKey();
    const { ciphertext, iv } = await encrypt(compressed, key);

    // 4. Checksum
    const checksum = await sha256(ciphertext);

    // 5. Store — VAULT §13.02: archive named `backup-YYYY-MM-DD-HHMMSS.db`.
    const archiveId = backupFileName();
    const metadata = buildArchiveMetadata(
      archiveId,
      ciphertext.byteLength,
      checksum,
      actorName,
      {
        parentCount: (snapshot.parents as unknown[] | undefined)?.length ?? 0,
        studentCount: (snapshot.students as unknown[] | undefined)?.length ?? 0,
        paymentCount: (snapshot.payments as unknown[] | undefined)?.length ?? 0,
        ledgerEntryCount: (snapshot.ledger as unknown[] | undefined)?.length ?? 0,
        installmentCount: (snapshot.installments as unknown[] | undefined)?.length ?? 0,
        workflowCount: (snapshot.workflows as unknown[] | undefined)?.length ?? 0,
      },
    );
    await storeArchive({ id: archiveId, metadata, ciphertext, iv });

    // 6. Audit
    const auditResult = await repos.audit.log({
      action: "backup.run",
      entityType: "backup",
      entityId: archiveId,
      actorId,
      actorName,
      tenantId: metadata.tenantId,
      diff: {
        before: null,
        after: {
          sizeBytes: metadata.sizeBytes,
          checksum: metadata.checksum,
          vaultLocation: metadata.vaultLocation,
        },
      },
      note: `Sauvegarde chiffrée AES-256-GCM (${metadata.sizeBytes} octets)`,
    });
    if (!auditResult.ok) {
      logger.warn("backup.run.audit_failed", { error: auditResult.error.code });
    }

    logger.info("backup.run.success", {
      archiveId,
      sizeBytes: metadata.sizeBytes,
      checksum,
    });
    return metadata;
  });
}

/**
 * T-300 (OFFLINE-400): inspect an archive OFFLINE — decrypt + verify +
 * parse WITHOUT restoring (the point-in-time selector's read path; no
 * state mutation). A corrupted archive (GCM auth-tag or checksum failure)
 * returns integrity: "corrupted" instead of a thrown error, so the
 * selector renders the honest status.
 */
export async function inspectArchive(
  archiveId: string,
): Promise<Result<ArchiveInspection>> {
  return tryResult(async () => {
    const record = await getArchive(archiveId);
    if (!record) {
      throw Errors.notFound("BackupArchive", archiveId);
    }

    const key = await deriveBackupKey();

    // 1. Decrypt — GCM auth-tag failure → the corrupted verdict.
    let decrypted: Uint8Array;
    try {
      decrypted = await decrypt(record.ciphertext, record.iv, key);
    } catch {
      return {
        archiveId,
        snapshotAt: record.metadata.createdAt,
        tenantId: record.metadata.tenantId,
        counts: snapshotCounts(null),
        integrity: "corrupted",
        integrityNote: "Échec du déchiffrement (auth tag GCM invalide — archive potentiellement corrompue)",
      } satisfies ArchiveInspection;
    }

    // 2. Checksum — bit-rot → the corrupted verdict.
    const actualChecksum = await sha256(record.ciphertext);
    if (actualChecksum !== record.metadata.checksum) {
      return {
        archiveId,
        snapshotAt: record.metadata.createdAt,
        tenantId: record.metadata.tenantId,
        counts: snapshotCounts(null),
        integrity: "corrupted",
        integrityNote: "Checksum SHA-256 invalide — bit-rot détecté",
      } satisfies ArchiveInspection;
    }

    // 3. Decompress + parse (no mutation — the inspection is read-only).
    const decompressed = await gzipDecompress(decrypted);
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(decodeUtf8(decompressed)) as Record<string, unknown>;
    } catch {
      return {
        archiveId,
        snapshotAt: record.metadata.createdAt,
        tenantId: record.metadata.tenantId,
        counts: snapshotCounts(null),
        integrity: "corrupted",
        integrityNote: "JSON illisible après déchiffrement",
      } satisfies ArchiveInspection;
    }

    return {
      archiveId,
      snapshotAt: typeof parsed?.snapshotAt === "string" ? parsed.snapshotAt : record.metadata.createdAt,
      tenantId: record.metadata.tenantId,
      counts: snapshotCounts(parsed),
      integrity: "verified",
      integrityNote: null,
    } satisfies ArchiveInspection;
  });
}

/**
 * Restore an archive by id — T-300 (OFFLINE-400): the restore is REAL.
 *
 * Steps: fetch from vault → decrypt (GCM) → verify checksum → parse →
 * APPLY the snapshot to the local operational state (the offline
 * operating mode — the mock layer the app runs on when Supabase is
 * unreachable; every replaced stream notifies so open screens re-render
 * on the restored point-in-time) → ARM post-restore sync staging (the
 * EXISTING SyncService queue — mutations after this point enqueue and
 * drain safely on reconnect; no parallel queue) → set the restored-from
 * marker → audit log with the REAL before/after counts.
 */
export async function restore(
  repos: Repositories,
  archiveId: string,
  actorId: string,
  actorName: string,
): Promise<Result<BackupRestoreResult>> {
  const startedAt = Date.now();
  return tryResult(async () => {
    logger.info("backup.restore.start", { archiveId, actorId });

    const record = await getArchive(archiveId);
    if (!record) {
      throw Errors.notFound("BackupArchive", archiveId);
    }

    const key = await deriveBackupKey();

    // 1. Decrypt — throws if GCM auth tag fails.
    let decrypted: Uint8Array;
    try {
      decrypted = await decrypt(record.ciphertext, record.iv, key);
    } catch (err) {
      // Mark the archive as corrupted via an audit entry, then surface the error.
      await repos.audit.log({
        action: "backup.restore_failed",
        entityType: "backup",
        entityId: archiveId,
        actorId,
        actorName,
        tenantId: record.metadata.tenantId,
        note: "Échec du déchiffrement (auth tag GCM invalide — archive potentiellement corrompue)",
      });
      throw Errors.validation(
        "AES-GCM auth tag verification failed",
        "L'archive est corrompue ou a été modifiée.",
        { cause: err },
      );
    }

    // 2. Decompress
    const decompressed = await gzipDecompress(decrypted);

    // 3. Verify SHA-256 of the ciphertext
    const actualChecksum = await sha256(record.ciphertext);
    if (actualChecksum !== record.metadata.checksum) {
      await repos.audit.log({
        action: "backup.restore_failed",
        entityType: "backup",
        entityId: archiveId,
        actorId,
        actorName,
        tenantId: record.metadata.tenantId,
        note: "Checksum SHA-256 invalide — bit-rot détecté",
      });
      throw Errors.validation(
        `SHA-256 mismatch: expected ${record.metadata.checksum}, got ${actualChecksum}`,
        "L'archive est corrompue (checksum invalide).",
      );
    }

    // 4. Parse
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(decodeUtf8(decompressed)) as Record<string, unknown>;
    } catch (err) {
      throw Errors.validation(
        "Failed to parse restored JSON",
        "L'archive est illisible (JSON invalide).",
        { cause: err },
      );
    }
    if (!parsed || typeof parsed !== "object") {
      throw Errors.validation(
        "Restored snapshot is not an object",
        "L'archive ne contient pas un instantané exploitable.",
      );
    }

    // 5. T-300 — APPLY: the restored snapshot replaces the local
    // operational state (the offline operating mode). The before/after
    // counts ride the audit diff; every replaced stream notifies.
    const beforeCounts = snapshotCounts({
      parents: mockStore.parents,
      students: mockStore.students,
      payments: mockStore.payments,
      installments: mockStore.installments,
      ledger: mockStore.ledger,
      expenses: mockStore.expenses,
      personnel: mockStore.personnel,
      workflows: mockStore.workflows,
    });
    mockStore.replaceOperationalState(parsed);
    const afterCounts = snapshotCounts(parsed);

    // 6. T-300 — ARM post-restore sync staging: mutations from here on
    // enqueue into the EXISTING sync queue (never a parallel queue) and
    // drain safely on reconnect (idempotent upsert RPCs — the Tier-4
    // equivalence already pins this).
    try {
      const { getSyncService } = await import("../sync/sync-service");
      const syncService = getSyncService();
      mockStore.armStaging({
        enqueue: (mutation) => {
          // Real restored data — never the skipped_mock path.
          void syncService.enqueue({ ...mutation, isMock: false });
        },
      });
    } catch (err) {
      // The SyncService singleton is not initialised in this environment
      // (headless test without the provider) — the restore still applied;
      // staging re-arms on the next restore with the service present.
      logger.warn("backup.restore.staging_unavailable", {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    // 7. T-300 — the restored-from marker (the mode indicator until
    // cleared by an explicit close or a successful reconnect-and-drain).
    setRestoredFromMarker({
      archiveId,
      restoredAt: new Date().toISOString(),
      restoredBy: actorName,
      counts: afterCounts,
    });

    // 8. Audit — with the REAL applied counts.
    const durationMs = Date.now() - startedAt;
    await repos.audit.log({
      action: "backup.restore",
      entityType: "backup",
      entityId: archiveId,
      actorId,
      actorName,
      tenantId: record.metadata.tenantId,
      diff: {
        before: beforeCounts,
        after: { ...afterCounts, durationMs, sizeBytes: record.metadata.sizeBytes },
      },
      note: `Restauration point-in-time APPLIQUÉE: ${afterCounts.parents} parents, ${afterCounts.students} élèves, ${afterCounts.payments} paiements, ${afterCounts.ledger} écritures. Les modifications suivantes sont mises en file et synchronisées à la reconnexion.`,
    });

    logger.info("backup.restore.success", { archiveId, durationMs, afterCounts });

    return {
      archiveId,
      restoredAt: new Date().toISOString(),
      restoredBy: actorName,
      durationMs,
      success: true,
    };
  });
}

/**
 * Purge all archives whose retention window has expired.
 *
 * Writes an audit entry per purged archive so the purge is fully traceable
 * (which archive was purged, when, and by whom).
 */
export async function purgeExpired(
  repos: Repositories,
  actorId: string,
  actorName: string,
): Promise<Result<BackupArchive[]>> {
  return tryResult(async () => {
    const beforeList = await listArchiveMetadata();
    const purgedIds = await vaultPurge(BACKUP_RETENTION_DAYS);
    if (purgedIds.length === 0) {
      logger.info("backup.purge.empty", { actorId });
      return [];
    }
    const purgedArchives = beforeList.filter((a) => purgedIds.includes(a.id));

    for (const archive of purgedArchives) {
      await repos.audit.log({
        action: "backup.purge",
        entityType: "backup",
        entityId: archive.id,
        actorId,
        actorName,
        tenantId: archive.tenantId,
        diff: {
          before: {
            createdAt: archive.createdAt,
            sizeBytes: archive.sizeBytes,
            retentionExpiresAt: archive.retentionExpiresAt,
          },
          after: null,
        },
        note: "Purge automatique (rétention 365 jours expirée)",
      });
    }

    logger.info("backup.purge.success", {
      actorId,
      purgedCount: purgedArchives.length,
    });
    return purgedArchives;
  });
}

/**
 * Delete a single archive by id (manual). Writes an audit entry.
 *
 * Differs from purge in that it is a manual user action targeting a specific
 * archive, not an automated retention sweep.
 */
export async function deleteArchive(
  repos: Repositories,
  archiveId: string,
  actorId: string,
  actorName: string,
): Promise<Result<void>> {
  return tryResult(async () => {
    const record = await getArchive(archiveId);
    if (!record) {
      throw Errors.notFound("BackupArchive", archiveId);
    }
    await vaultDelete(archiveId);
    await repos.audit.log({
      action: "backup.delete",
      entityType: "backup",
      entityId: archiveId,
      actorId,
      actorName,
      tenantId: record.metadata.tenantId,
      diff: {
        before: {
          createdAt: record.metadata.createdAt,
          sizeBytes: record.metadata.sizeBytes,
        },
        after: null,
      },
      note: "Suppression manuelle de l'archive",
    });
    logger.info("backup.delete.success", { archiveId, actorId });
  });
}
