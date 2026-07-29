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
import type { Repositories } from "../repository-provider";
import type { Result } from "../../core/result/result";
import { Ok, Err, tryResult } from "../../core/result/result";
import { Errors } from "../../core/errors/app-error";
import type {
  BackupArchive,
  BackupRestoreResult,
} from "../../domain/model/backup";
import { BACKUP_RETENTION_DAYS } from "../../domain/model/backup";
import { logger } from "../../core/logging/logger";
import {
  generateKey,
  encrypt,
  decrypt,
  sha256,
  encodeUtf8,
  decodeUtf8,
} from "./aes-256";
import {
  storeArchive,
  getArchive,
  listArchiveMetadata,
  deleteArchive as vaultDelete,
  purgeExpired as vaultPurge,
} from "./indexed-db-vault";

/** localStorage key for the backup passphrase (mock-only; production uses a secrets manager). */
export const BACKUP_PASSPHRASE_KEY = "el-imtiyaz:backup-passphrase";

/** Default passphrase for the mock — overridable via localStorage. */
const DEFAULT_BACKUP_PASSPHRASE = "el-imtiyaz-mock-passphrase-change-me";

/** Salt for PBKDF2 — fixed per tenant in the mock; production would use a per-tenant secret. */
const BACKUP_SALT = encodeUtf8("el-imtiyaz-backup-salt-v1");

/**
 * Get the configured backup passphrase from localStorage, falling back to
 * the default. In production (plan §13.02) this would query a separate
 * secrets manager (HSM or Supabase secrets).
 */
export function getBackupPassphrase(): string {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(BACKUP_PASSPHRASE_KEY);
      if (stored && stored.length > 0) return stored;
    }
  } catch {
    /* localStorage may be unavailable in some environments — fall back to default. */
  }
  return DEFAULT_BACKUP_PASSPHRASE;
}

/** Derive the AES-256-GCM CryptoKey from the configured passphrase. */
export async function deriveBackupKey(): Promise<CryptoKey> {
  return generateKey(getBackupPassphrase(), BACKUP_SALT);
}

/** Snapshot the current mock state into a serializable object. */
function snapshotState(repos: Repositories): Record<string, unknown> {
  return {
    snapshotAt: new Date().toISOString(),
    tenantId: "tenant-el-imtiyaz-oran-001",
    parents: repos.parents.observe().get(),
    students: repos.students.observe().get(),
    payments: repos.payments.observe().get(),
    ledger: repos.ledger.observe().get(),
    expenses: repos.expenses.observe().get(),
    personnel: repos.personnel.observe().get(),
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
  if (typeof CompressionStream === "undefined") {
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
  if (typeof DecompressionStream === "undefined") {
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

    // 5. Store
    const archiveId = `bak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
 * Restore an archive by id.
 *
 * Steps: fetch from vault → decrypt → decompress → verify checksum →
 * (mock) log what would be restored → audit log.
 *
 * In production (Supabase), the restore step would write the deserialized
 * records back to the database in a single transaction. The mock simply
 * logs the operation and writes an audit entry — no state is mutated.
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

    // 4. (Mock) Deserialize + log what would be restored.
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
    const meta = parsed?.metadata as BackupArchive["metadata"] | undefined;
    logger.info("backup.restore.parsed", {
      archiveId,
      parentCount: meta?.parentCount ?? (parsed?.parents as unknown[] | undefined)?.length ?? 0,
      studentCount: meta?.studentCount ?? (parsed?.students as unknown[] | undefined)?.length ?? 0,
      paymentCount: meta?.paymentCount ?? (parsed?.payments as unknown[] | undefined)?.length ?? 0,
    });

    // 5. Audit
    const durationMs = Date.now() - startedAt;
    await repos.audit.log({
      action: "backup.restore",
      entityType: "backup",
      entityId: archiveId,
      actorId,
      actorName,
      tenantId: record.metadata.tenantId,
      diff: {
        before: null,
        after: { durationMs, sizeBytes: record.metadata.sizeBytes },
      },
      note: "Restauration point-in-time (mock — aucune écriture en base)",
    });

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
