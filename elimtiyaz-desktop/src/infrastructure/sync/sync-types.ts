/**
 * Sync types — shared shapes for the sync layer.
 *
 * The sync layer's job is to push Excel-imported data to Supabase when
 * the desktop has internet access, and queue changes locally when
 * offline. Mock data is NEVER synced — every record carries a `mock`
 * flag that the sync layer checks before queueing.
 */

/** Syncable entity kinds — mirrors the high-level domain aggregates. */
export type SyncEntityKind =
  | "parent"
  | "student"
  | "payment"
  | "installment"
  | "expense"
  | "invoice"
  | "ledger_entry"
  | "personnel"
  | "attendance"
  | "grade"
  | "homework"
  | "audit_log"
  | "notification"
  | "calendar_event"
  | "other";

/** Operation kind that triggered the sync entry. */
export type SyncOperation = "insert" | "update" | "delete";

/** Lifecycle states for a sync queue entry. */
export type SyncStatus = "pending" | "synced" | "failed" | "skipped_mock";

/**
 * A single entry in the sync queue. Each entry represents one logical
 * mutation that needs to be pushed (or has been pushed) to Supabase.
 */
export interface SyncQueueEntry {
  /** Stable unique ID (uuid or timestamp+random). */
  readonly id: string;
  /** When the entry was queued (ISO timestamp). */
  readonly queuedAt: string;
  /** When the entry was last attempted (ISO timestamp, or null). */
  lastAttemptAt: string | null;
  /** Entity kind — drives which repository + table is targeted. */
  readonly entity: SyncEntityKind;
  /** Operation kind. */
  readonly operation: SyncOperation;
  /** Tenant ID — never sync across tenants. */
  readonly tenantId: string;
  /** Actor that triggered the change (user ID or "system"). */
  readonly actorId: string;
  /**
   * The payload to push. Shape depends on `entity` + `operation`.
   * For `delete`, this is just `{ id }`.
   */
  readonly payload: Record<string, unknown>;
  /**
   * Whether this record originated from mock data. Mock records are
   * NEVER pushed to Supabase — the sync layer auto-marks them as
   * "skipped_mock" and excludes them from all sync attempts.
   */
  readonly isMock: boolean;
  /** Source file name when the record was Excel-imported. */
  readonly sourceFile?: string;
  /** Import run ID when the record was Excel-imported. */
  readonly importRunId?: string;
  /** Current status. */
  status: SyncStatus;
  /** Number of failed sync attempts (used for backoff). */
  attempts: number;
  /** Last error message (when status === "failed"). */
  lastError: string | null;
}

/**
 * Snapshot of the sync queue's state — exposed to the UI via React context.
 */
export interface SyncStatusSnapshot {
  /** Whether the desktop currently has internet access. */
  online: boolean;
  /** Whether Supabase is configured (URL + anon key set). */
  supabaseConfigured: boolean;
  /** Whether a sync is currently in progress. */
  syncing: boolean;
  /** Number of pending entries (waiting to be synced). */
  pendingCount: number;
  /** Number of entries that have been synced successfully. */
  syncedCount: number;
  /** Number of entries that failed permanently. */
  failedCount: number;
  /** Number of mock entries that were skipped. */
  skippedMockCount: number;
  /** CACHE-102: the queue is running on the in-memory fallback (IndexedDB unavailable) — pending changes will be lost on app close. */
  queueUsingFallback: boolean;
  /** ISO timestamp of the last successful sync, or null. */
  lastSyncAt: string | null;
  /** ISO timestamp of the last sync attempt, or null. */
  lastAttemptAt: string | null;
  /** Last error message (human-readable). */
  lastError: string | null;
}

/** Handler that pushes one queue entry to Supabase. */
export type SyncPushHandler = (entry: SyncQueueEntry) => Promise<void>;

/** Options for constructing a SyncService. */
export interface SyncServiceOptions {
  /** Tenant ID — stamped onto every queued entry. */
  tenantId: () => string;
  /** Actor ID — stamped onto every queued entry. */
  actorId: () => string;
  /** Returns true if Supabase is configured. */
  isSupabaseConfigured: () => boolean;
  /** Returns true if mock mode is active (mock data flagging). */
  isMockMode: () => boolean;
  /** Pushes one entry to Supabase. Throws on failure. */
  push: SyncPushHandler;
  /** Whether to auto-start the online listener + periodic poll. Default true. */
  autoStart?: boolean;
  /** Polling interval in ms when online. Default 30000 (30s). */
  pollIntervalMs?: number;
  /** Polling interval in ms when offline (backoff). Default 120000 (2m). */
  offlinePollIntervalMs?: number;
  /** Max retry attempts before an entry is marked failed. Default 5. */
  maxAttempts?: number;
}
