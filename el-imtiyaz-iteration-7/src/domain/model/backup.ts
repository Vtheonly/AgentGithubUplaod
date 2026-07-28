/**
 * Backup domain model — iteration 7 (plan §13).
 *
 * 24-hour backup cycle, AES-256-GCM encryption (Web Crypto API), local
 * IndexedDB vault + offsite vault stub, 365-day rolling retention,
 * point-in-time restore UI.
 *
 * Per plan §13.03: backups MUST NOT live inside Supabase. The desktop
 * terminal is the only node that runs backup routines. Mobile is strictly
 * prohibited from generating/downloading/storing backups.
 */

export type BackupStatus = "encrypted" | "restored" | "corrupted" | "purged";

export type BackupVaultLocation = "local" | "offsite";

export interface BackupArchive {
  readonly id: string;
  readonly tenantId: string;
  readonly createdAt: string;
  readonly sizeBytes: number;
  /** SHA-256 hex checksum of the ciphertext (64 chars). */
  readonly checksum: string;
  readonly vaultLocation: BackupVaultLocation;
  readonly status: BackupStatus;
  /** ISO timestamp — when the archive falls out of the 365-day retention window. */
  readonly retentionExpiresAt: string;
  readonly createdBy: string;
  readonly metadata?: {
    parentCount: number;
    studentCount: number;
    paymentCount: number;
    ledgerEntryCount: number;
  };
}

export interface BackupRestoreResult {
  readonly archiveId: string;
  readonly restoredAt: string;
  readonly restoredBy: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
}

export const BACKUP_STATUS_LABELS_FR: Record<BackupStatus, string> = {
  encrypted: "Chiffré",
  restored: "Restauré",
  corrupted: "Corrompu",
  purged: "Purgé",
};

export const BACKUP_VAULT_LABELS_FR: Record<BackupVaultLocation, string> = {
  local: "Coffre local",
  offsite: "Coffre externe",
};

/** Retention window in days — per plan §13.03. */
export const BACKUP_RETENTION_DAYS = 365;

/** Backup schedule (24h cycle, 02:00 AM local per plan §13.01). */
export const BACKUP_SCHEDULE_HOURS = 24;

/** PBKDF2 iteration count for AES-256-GCM key derivation (plan §13.02). */
export const BACKUP_PBKDF2_ITERATIONS = 100_000;

/** AES-256-GCM IV length in bytes (12 is the standard for GCM). */
export const BACKUP_GCM_IV_LENGTH = 12;

/** localStorage key for the backup passphrase (mock — production uses a separate secrets manager). */
export const BACKUP_PASSPHRASE_KEY = "el-imtiyaz:backup-passphrase";
