/**
 * SyncService — the heart of the offline-first sync layer.
 *
 * Responsibilities:
 *   1. Queue Excel-imported mutations (insert/update/delete) locally.
 *   2. NEVER queue mock data — auto-mark them as `skipped_mock` so the
 *      UI can show "X records excluded as mock".
 *   3. Detect online/offline transitions (delegates to OnlineDetector).
 *   4. When online + Supabase configured: drain the pending queue,
 *      pushing each entry via the registered `push` handler.
 *   5. Auto-sync triggers:
 *        - On app startup (if online + configured).
 *        - When the network comes back online (transition offline → online).
 *        - When new entries are queued (debounced 2s).
 *        - On manual `syncNow()` call.
 *   6. Retry with exponential backoff on push failures. After
 *      `maxAttempts` retries, an entry is marked `failed` and surfaces
 *      in the UI.
 *   7. Emit status snapshots via `subscribe()` so the UI (topbar
 *      indicator, settings page) can render the current state.
 *
 * CRITICAL INVARIANT: mock data is NEVER pushed to Supabase. The
 * `enqueue()` method checks the `isMock` flag at queue time AND the
 * `drain()` method re-checks before each push (defense in depth).
 */

import type {
  SyncEntityKind,
  SyncOperation,
  SyncQueueEntry,
  SyncServiceOptions,
  SyncStatusSnapshot,
} from "./sync-types";
import { getSyncQueueStore } from "./sync-queue-store";
import { getOnlineDetector, OnlineDetector, type OnlineState } from "./online-detector";

const DEBOUNCE_MS = 2_000;
const BACKOFF_BASE_MS = 1_000;

export interface SyncServiceConstructorOptions extends SyncServiceOptions {
  /**
   * Optional OnlineDetector override. Tests inject a stubbed detector
   * so they can control the online state without touching `navigator`.
   * Production code leaves this undefined — the singleton detector
   * is used.
   */
  onlineDetector?: OnlineDetector;
}

export class SyncService {
  private readonly opts: Required<SyncServiceOptions>;
  private readonly store = getSyncQueueStore();
  private readonly detector: OnlineDetector;
  private snapshot: SyncStatusSnapshot;
  private listeners = new Set<(s: SyncStatusSnapshot) => void>();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private started = false;

  constructor(opts: SyncServiceConstructorOptions) {
    const { onlineDetector, ...rest } = opts;
    this.opts = {
      autoStart: true,
      pollIntervalMs: 30_000,
      offlinePollIntervalMs: 120_000,
      maxAttempts: 5,
      ...rest,
    };
    this.detector = onlineDetector ?? getOnlineDetector();
    this.snapshot = {
      online: false,
      supabaseConfigured: false,
      syncing: false,
      pendingCount: 0,
      syncedCount: 0,
      failedCount: 0,
      skippedMockCount: 0,
      lastSyncAt: null,
      lastAttemptAt: null,
      lastError: null,
    };
  }

  /** Initialise storage + start listeners. Safe to call multiple times. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.store.init();
    this.detector.start();
    this.detector.subscribe(() => this.handleOnlineChange());
    // Initial snapshot.
    await this.refreshSnapshot();
    if (this.opts.autoStart) {
      this.schedulePoll();
      // Try an immediate drain in case the app started online.
      void this.drain();
    }
  }

  /** Stop all timers + listeners. Used in tests + app shutdown. */
  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.detector.stop();
    this.started = false;
  }

  /**
   * Enqueue a mutation for sync.
   *
   * MOCK DATA INVARIANT: when `isMock` is true, the entry is recorded
   * with status `skipped_mock` and is NEVER pushed to Supabase. The
   * entry still counts toward the snapshot so the UI can show "X
   * records excluded as mock".
   *
   * @returns the created queue entry's ID.
   */
  async enqueue(input: {
    entity: SyncEntityKind;
    operation: SyncOperation;
    payload: Record<string, unknown>;
    isMock: boolean;
    sourceFile?: string;
    importRunId?: string;
  }): Promise<string> {
    const id = generateId();
    const now = new Date().toISOString();
    const entry: SyncQueueEntry = {
      id,
      queuedAt: now,
      lastAttemptAt: null,
      entity: input.entity,
      operation: input.operation,
      tenantId: this.opts.tenantId(),
      actorId: this.opts.actorId(),
      payload: input.payload,
      isMock: input.isMock,
      sourceFile: input.sourceFile,
      importRunId: input.importRunId,
      status: input.isMock ? "skipped_mock" : "pending",
      attempts: 0,
      lastError: null,
    };
    await this.store.add(entry);
    await this.refreshSnapshot();

    // Trigger a drain (debounced) — but only for non-mock entries.
    if (!entry.isMock) {
      this.scheduleDebouncedDrain();
    }
    return id;
  }

  /**
   * Enqueue MULTIPLE mutations in ONE shot — used by the Excel import
   * path which would otherwise call `enqueue()` ~1,170 times in a tight
   * loop (parent + student + ledger_entry per row × ~390 rows).
   *
   * Why this matters: every `enqueue()` call calls `refreshSnapshot()`
   * which emits a snapshot to every subscriber. With 1,170 calls, every
   * subscriber (SyncIndicator, SyncTab, anywhere `useSyncStatus()` is
   * used) re-renders 1,170 times during a single Excel commit. The UI
   * freezes for seconds and the user sees a flood of "sync
   * notifications" — even though only the FINAL count matters.
   *
   * Batching cuts all of that to:
   *   - ONE IndexedDB transaction (much faster than N round-trips).
   *   - ONE `refreshSnapshot()` call (ONE React re-render per consumer).
   *   - ONE debounced drain schedule.
   *
   * @returns the created queue entry IDs in order.
   */
  async enqueueBatch(
    inputs: ReadonlyArray<{
      entity: SyncEntityKind;
      operation: SyncOperation;
      payload: Record<string, unknown>;
      isMock: boolean;
      sourceFile?: string;
      importRunId?: string;
    }>,
  ): Promise<string[]> {
    if (inputs.length === 0) return [];
    const tenantId = this.opts.tenantId();
    const actorId = this.opts.actorId();
    // Build all entries up-front so we can write them in a single
    // IndexedDB transaction. Generating IDs + timestamps here (not in
    // a loop inside the store) keeps the store's `addBatch` pure.
    const now = new Date().toISOString();
    const entries: SyncQueueEntry[] = inputs.map((input) => {
      const id = generateId();
      return {
        id,
        queuedAt: now,
        lastAttemptAt: null,
        entity: input.entity,
        operation: input.operation,
        tenantId,
        actorId,
        payload: input.payload,
        isMock: input.isMock,
        sourceFile: input.sourceFile,
        importRunId: input.importRunId,
        status: input.isMock ? "skipped_mock" : "pending",
        attempts: 0,
        lastError: null,
      };
    });
    await this.store.addBatch(entries);
    // ONE snapshot refresh for the whole batch — instead of N.
    await this.refreshSnapshot();

    // Schedule ONE debounced drain (not N). The drain itself already
    // processes all pending entries in a single pass, so multiple
    // schedules would just dedupe to the same timer.
    const hasNonMock = entries.some((e) => !e.isMock);
    if (hasNonMock) {
      this.scheduleDebouncedDrain();
    }
    return entries.map((e) => e.id);
  }

  /**
   * Manually trigger a sync drain. Returns when the drain completes
   * (success or failure). Safe to call when offline — it'll no-op.
   */
  async syncNow(): Promise<{ pushed: number; failed: number; skippedMock: number }> {
    return this.drain({ force: true });
  }

  /** Subscribe to snapshot changes (UI indicator, settings page). */
  subscribe(fn: (s: SyncStatusSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  /** Current snapshot (immutable copy). */
  getSnapshot(): SyncStatusSnapshot {
    return { ...this.snapshot };
  }

  /** Clear all queue entries — used by tests + the "Reset sync" button. */
  async clearQueue(): Promise<void> {
    await this.store.clear();
    await this.refreshSnapshot();
  }

  /** Expose the underlying store (for tests + advanced UI). */
  getStore() {
    return this.store;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private scheduleDebouncedDrain(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.drain();
    }, DEBOUNCE_MS);
  }

  private schedulePoll(): void {
    const interval = this.snapshot.online
      ? this.opts.pollIntervalMs
      : this.opts.offlinePollIntervalMs;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      void this.drain();
    }, interval);
  }

  private async handleOnlineChange(): Promise<void> {
    await this.refreshSnapshot();
    // Online transition → trigger an immediate drain.
    if (this.snapshot.online && this.snapshot.pendingCount > 0) {
      void this.drain();
    }
    // Re-schedule the poller with the right interval.
    this.schedulePoll();
  }

  private async refreshSnapshot(): Promise<void> {
    const onlineState = this.detector.getState();
    const all = await this.store.listAll();
    const supabaseConfigured = this.opts.isSupabaseConfigured();
    this.snapshot = {
      online: onlineState.online,
      supabaseConfigured,
      syncing: this.draining,
      pendingCount: all.filter((e) => e.status === "pending").length,
      syncedCount: all.filter((e) => e.status === "synced").length,
      failedCount: all.filter((e) => e.status === "failed").length,
      skippedMockCount: all.filter((e) => e.status === "skipped_mock").length,
      lastSyncAt: this.snapshot.lastSyncAt,
      lastAttemptAt: this.snapshot.lastAttemptAt,
      lastError: this.snapshot.lastError,
    };
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.getSnapshot());
  }

  /**
   * Drain pending entries. Each entry is pushed via the registered
   * `push` handler. Failures increment `attempts` and apply exponential
   * backoff. After `maxAttempts`, the entry is marked `failed`.
   *
   * MOCK INVARIANT: even though `enqueue()` marks mock entries as
   * `skipped_mock` at queue time, we re-check here as defense in depth.
   * If somehow a mock entry ended up with status `pending`, the drain
   * will skip it (and mark it `skipped_mock`) without calling `push`.
   */
  private async drain(opts: { force?: boolean } = {}): Promise<{ pushed: number; failed: number; skippedMock: number }> {
    if (this.draining) return { pushed: 0, failed: 0, skippedMock: 0 };
    const onlineState = this.detector.getState();
    const supabaseReady = this.opts.isSupabaseConfigured();
    if (!opts.force && (!onlineState.online || !supabaseReady)) {
      return { pushed: 0, failed: 0, skippedMock: 0 };
    }
    if (!onlineState.online || !supabaseReady) {
      // Even force=true can't drain when offline or unconfigured.
      return { pushed: 0, failed: 0, skippedMock: 0 };
    }

    this.draining = true;
    await this.refreshSnapshot();
    let pushed = 0;
    let failed = 0;
    let skippedMock = 0;

    try {
      const pending = await this.store.listByStatus("pending");
      for (const entry of pending) {
        // DEFENSE IN DEPTH: never push mock data, even if it ended up
        // in pending status (e.g. due to a bug in enqueue).
        if (entry.isMock) {
          const patched: SyncQueueEntry = { ...entry, status: "skipped_mock" };
          await this.store.update(patched);
          skippedMock++;
          continue;
        }

        // Skip entries that are still in backoff window.
        if (entry.lastAttemptAt) {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(2, entry.attempts);
          const nextAllowedAt = new Date(entry.lastAttemptAt).getTime() + backoffMs;
          if (Date.now() < nextAllowedAt) continue;
        }

        try {
          await this.opts.push(entry);
          const patched: SyncQueueEntry = {
            ...entry,
            status: "synced",
            lastAttemptAt: new Date().toISOString(),
            lastError: null,
          };
          await this.store.update(patched);
          pushed++;
        } catch (err) {
          const attempts = entry.attempts + 1;
          const failed_permanently = attempts >= this.opts.maxAttempts;
          const patched: SyncQueueEntry = {
            ...entry,
            status: failed_permanently ? "failed" : "pending",
            attempts,
            lastAttemptAt: new Date().toISOString(),
            lastError: err instanceof Error ? err.message : String(err),
          };
          await this.store.update(patched);
          if (failed_permanently) failed++;
        }
      }
      if (pushed > 0) {
        this.snapshot.lastSyncAt = new Date().toISOString();
      }
      this.snapshot.lastAttemptAt = new Date().toISOString();
      this.snapshot.lastError = null;
    } catch (err) {
      this.snapshot.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.draining = false;
      await this.refreshSnapshot();
    }
    return { pushed, failed, skippedMock };
  }
}

/** Generate a sortable unique ID for queue entries. */
function generateId(): string {
  return `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Singleton instance — lazily constructed on first use. */
let _instance: SyncService | null = null;

export function getSyncService(opts?: SyncServiceOptions): SyncService {
  if (!_instance) {
    if (!opts) {
      throw new Error("SyncService must be initialised with options on first call.");
    }
    _instance = new SyncService(opts);
  }
  return _instance;
}

export function initialiseSyncService(opts: SyncServiceOptions): SyncService {
  if (_instance) {
    console.warn("[SyncService] Already initialised — returning existing instance.");
    return _instance;
  }
  _instance = new SyncService(opts);
  return _instance;
}

/** Test-only: reset the singleton. */
export function _resetSyncServiceForTests(): void {
  if (_instance) _instance.stop();
  _instance = null;
}
