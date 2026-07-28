/**
 * IndexedDB vault — local encrypted archive storage.
 *
 * Plan §13.02: the local vault is an IndexedDB database named
 * "el-imtiyaz-backup-vault" with a single object store "archives" keyed by
 * `id`. Each entry stores { id, metadata, ciphertext, iv }.
 *
 * The metadata is duplicated into a separate read-path so list operations
 * don't have to deserialize the ciphertext. The ciphertext is fetched
 * on-demand by the service layer during restore.
 *
 * The vault is desktop-only: it requires a real IndexedDB implementation
 * (browsers, or `fake-indexeddb` in tests). If IndexedDB is unavailable
 * (e.g. in a Node-only environment without the polyfill), every call
 * throws a clear error so the caller can degrade gracefully.
 */
import type { BackupArchive } from "../../domain/model/backup";
import { BACKUP_RETENTION_DAYS } from "../../domain/model/backup";
import { logger } from "../../core/logging/logger";

const DB_NAME = "el-imtiyaz-backup-vault";
const DB_VERSION = 1;
const STORE_NAME = "archives";

/** On-disk record shape: metadata + raw crypto bytes. */
export interface VaultRecord {
  readonly id: string;
  readonly metadata: BackupArchive;
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
}

/** A list-only view of a vault record (no ciphertext). */
export interface VaultMetadataOnly {
  readonly id: string;
  readonly metadata: BackupArchive;
}

/**
 * Open (or create) the backup vault database.
 *
 * The schema is set up in the `onupgradeneeded` callback so the database
 * self-initializes on first open. Throws a clear error if IndexedDB is not
 * available in the current environment.
 */
export function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error(
          "IndexedDB is unavailable in this environment. The backup vault requires IndexedDB (browser) or the `fake-indexeddb` polyfill (Node/test).",
        ),
      );
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "metadata.createdAt", { unique: false });
        store.createIndex("retentionExpiresAt", "metadata.retentionExpiresAt", {
          unique: false,
        });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };
    request.onerror = () => {
      reject(
        new Error(
          `Failed to open backup vault: ${request.error?.message ?? "unknown error"}`,
        ),
      );
    };
  });
}

/** Store (or replace) an archive record in the vault. */
export async function storeArchive(record: VaultRecord): Promise<void> {
  const db = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            `Failed to store archive ${record.id}: ${tx.error?.message ?? "unknown error"}`,
          ),
        );
    });
  } finally {
    db.close();
  }
}

/** Fetch a single archive record (with ciphertext) by id. Returns null if missing. */
export async function getArchive(
  id: string,
): Promise<VaultRecord | null> {
  const db = await openVault();
  try {
    return await new Promise<VaultRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => {
        resolve((req.result as VaultRecord | undefined) ?? null);
      };
      req.onerror = () =>
        reject(
          new Error(
            `Failed to fetch archive ${id}: ${req.error?.message ?? "unknown error"}`,
          ),
        );
    });
  } finally {
    db.close();
  }
}

/** List all archive metadata (no ciphertext) — used for the settings table. */
export async function listArchiveMetadata(): Promise<BackupArchive[]> {
  const db = await openVault();
  try {
    return await new Promise<BackupArchive[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const records = (req.result as VaultRecord[] | undefined) ?? [];
        const metas = records.map((r) => r.metadata);
        // Sort newest-first by createdAt descending.
        metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
        resolve(metas);
      };
      req.onerror = () =>
        reject(
          new Error(
            `Failed to list archives: ${req.error?.message ?? "unknown error"}`,
          ),
        );
    });
  } finally {
    db.close();
  }
}

/** Delete a single archive by id. No-op if the archive does not exist. */
export async function deleteArchive(id: string): Promise<void> {
  const db = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            `Failed to delete archive ${id}: ${tx.error?.message ?? "unknown error"}`,
          ),
        );
    });
  } finally {
    db.close();
  }
}

/**
 * Purge all archives whose retentionExpiresAt is in the past.
 *
 * Default retention window is 365 days (BACKUP_RETENTION_DAYS). For tests,
 * the `maxAgeDays` parameter can be overridden (e.g. set to 0 to purge
 * everything immediately, or to a small negative value to purge nothing).
 *
 * Returns the IDs of the purged archives so the service layer can write
 * an audit entry per archive.
 */
export async function purgeExpired(maxAgeDays: number = BACKUP_RETENTION_DAYS): Promise<string[]> {
  const db = await openVault();
  try {
    const all = await new Promise<VaultRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as VaultRecord[] | undefined) ?? []);
      req.onerror = () => reject(req.error ?? new Error("purgeExpired: getAll failed"));
    });

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const toPurge = all.filter((r) => {
      const expiresAt = Date.parse(r.metadata.retentionExpiresAt);
      if (Number.isNaN(expiresAt)) return false;
      return expiresAt < cutoff;
    });

    if (toPurge.length === 0) return [];

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const r of toPurge) store.delete(r.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("purgeExpired: delete failed"));
    });

    const purgedIds = toPurge.map((r) => r.id);
    logger.info("backup.vault.purgeExpired", {
      purgedCount: purgedIds.length,
      maxAgeDays,
    });
    return purgedIds;
  } finally {
    db.close();
  }
}

/** Drop the entire vault. Used by tests to reset state between cases. */
export async function clearVault(): Promise<void> {
  const db = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("clearVault: clear failed"));
    });
  } finally {
    db.close();
  }
}
