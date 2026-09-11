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
export type SyncStatus = "pending" | "synced" | "failed" | "skipped_mock" | "conflict";

/**
 * T-298 (OFFLINE-400): the 3-way conflict record attached to a queue entry
 * parked in `conflict` status. Deliberately MINIMAL + JSON-safe (the entry
 * is persisted in IndexedDB via structured clone — the engine's ABSENT
 * symbol must never leak in here): only the CURRENT server row (remote)
 * plus the conflict paths + displays. The base lives on the entry
 * (`basePayload`), the local edit IS the entry `payload` — the resolver
 * recomputes the full 3-way (computeThreeWay) at open time and at resolve
 * time, so no values are duplicated in storage.
 */
export interface SyncConflictRecord {
  /** When the conflict was detected (ISO timestamp). */
  readonly detectedAt: string;
  /** The server row fetched at detection time (the remote/User-B side). */
  readonly remotePayload: Record<string, unknown>;
  /** The conflicting field paths (the resolver's work list). */
  readonly conflictPaths: readonly string[];
  /** Pre-formatted compact displays per path, for the list surfaces. */
  readonly conflictPreviews: readonly { readonly path: string; readonly base: string; readonly local: string; readonly remote: string }[];
}

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
  /**
   * T-298 (OFFLINE-400): the server-row snapshot the local edit started
   * from (the 3-way BASE). Only meaningful for `update` operations; when
   * present, the drain runs 3-way conflict detection before pushing — a
   * field BOTH sides changed never silently overwrites (the entry parks in
   * `conflict` status and the resolver decides).
   */
  readonly basePayload?: Record<string, unknown> | null;
  /**
   * T-298 (OFFLINE-400): the conflict record when this entry is parked in
   * `conflict` status. Cleared when the resolver produces a merged payload.
   */
  conflict?: SyncConflictRecord | null;
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
  /** T-298 (OFFLINE-400): entries parked in `conflict` status awaiting 3-way resolution. */
  conflictCount: number;
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
  /**
   * T-298 (OFFLINE-400): 3-way conflict guard, called by the drain for every
   * `update` entry that carries a `basePayload`, BEFORE the push. Returns a
   * conflict record when the current server row and the queued edit diverge
   * on fields BOTH sides changed (never a silent overwrite); returns null
   * when the push may proceed. The production wiring fetches the remote row
   * per entity kind and runs the pure `computeThreeWay` engine.
   */
  conflictGuard?: (
    entry: SyncQueueEntry,
  ) => Promise<SyncConflictRecord | null>;
  /**
   * T-298 (OFFLINE-400): fired when the guard parks an entry in `conflict`
   * status — the production wiring writes the `sync.conflict_detected`
   * audit entry + creates the user notification.
   */
  onConflictDetected?: (entry: SyncQueueEntry, record: SyncConflictRecord) => void | Promise<void>;
  /**
   * T-298 (OFFLINE-400): fired when the resolver produces a merged payload
   * and the entry re-enters the queue — the production wiring writes the
   * `sync.conflict_resolved` audit entry (with the before/after diff) + the
   * resolution notification.
   */
  onConflictResolved?: (
    entry: SyncQueueEntry,
    resolved: SyncQueueEntry,
    resolution: { readonly chosenPaths: readonly string[]; readonly payload: Record<string, unknown> },
  ) => void | Promise<void>;
  /** Whether to auto-start the online listener + periodic poll. Default true. */
  autoStart?: boolean;
  /** Polling interval in ms when online. Default 30000 (30s). */
  pollIntervalMs?: number;
  /** Polling interval in ms when offline (backoff). Default 120000 (2m). */
  offlinePollIntervalMs?: number;
  /** Max retry attempts before an entry is marked failed. Default 5. */
  maxAttempts?: number;
}
