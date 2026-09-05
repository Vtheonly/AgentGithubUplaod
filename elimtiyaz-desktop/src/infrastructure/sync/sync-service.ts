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
 *   8. T-171 (SYNC-200) recovery surface: `retryFailed()` re-queues
 *      terminal-failed entries (attempts reset so they get a full fresh
 *      backoff budget), `discardFailed()` removes residue whose data is
 *      already server-side, and `lastSyncAt` is PERSISTED so "Dernière
 *      synchro" survives app restarts and reflects a healthy no-op drain.
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

/**
 * T-171 (SYNC-200): persisted "last successful sync" timestamp.
 *
 * The pre-T-171 `lastSyncAt` lived ONLY in the in-memory snapshot: every
 * app restart reset it to null, so the settings page showed "Dernière
 * synchro: Jamais" even for a queue whose 3 544 entries were all synced
 * server-side. localStorage survives Electron renderer restarts; the
 * access is wrapped so environments without it degrade to the old
 * in-memory behaviour.
 */
const LAST_SYNC_STORAGE_KEY = "el-imtiyaz.sync.lastSyncAt";

function loadPersistedLastSyncAt(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LAST_SYNC_STORAGE_KEY);
    return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

function persistLastSyncAt(iso: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LAST_SYNC_STORAGE_KEY, iso);
    }
  } catch {
    // Quota/private-mode — the in-memory value still works this session.
  }
}

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
      queueUsingFallback: false,
      // T-171: restore the persisted timestamp (was always null at boot).
      lastSyncAt: loadPersistedLastSyncAt(),
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

  /**
   * T-171 (SYNC-200): re-queue every TERMINAL-failed entry for a fresh
   * retry cycle.
   *
   * Why this exists: the pre-T-171 drain listed only `pending` entries, so
   * an entry that exhausted `maxAttempts` (5) was dead forever — "Synchroniser
   * maintenant" answered "Aucune entrée à synchroniser" while the topbar
   * badge showed the failures (the owner's 1 170-badge report). Retry resets
   * `attempts` (full fresh backoff budget) and clears `lastAttemptAt` (the
   * backoff window re-opens immediately); `lastError` is kept as history
   * until the next attempt outcome overwrites it.
   *
   * @returns the number of entries re-queued.
   */
  async retryFailed(): Promise<number> {
    const failed = await this.store.listByStatus("failed");
    if (failed.length === 0) return 0;
    for (const entry of failed) {
      const patched: SyncQueueEntry = {
        ...entry,
        status: "pending",
        attempts: 0,
        lastAttemptAt: null,
      };
      await this.store.update(patched);
    }
    await this.refreshSnapshot();
    // The re-queued entries are immediately drainable (no backoff window).
    this.scheduleDebouncedDrain();
    return failed.length;
  }

  /**
   * T-171 (SYNC-200): permanently REMOVE every terminal-failed entry.
   *
   * For STALE residue — e.g. the owner's 1 170 mock-era student entries whose
   * data is already present server-side (live-verified: 390 students, no
   * duplicate codes) — retrying can never succeed (mock-era payloads carry
   * local-store IDs that fail server FK validation). Discarding is the
   * honest remedy; the caller must confirm with the user (destructive).
   *
   * @returns the number of entries removed.
   */
  async discardFailed(): Promise<number> {
    const failed = await this.store.listByStatus("failed");
    if (failed.length === 0) return 0;
    await this.store.deleteMany(failed.map((e) => e.id));
    await this.refreshSnapshot();
    return failed.length;
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
      queueUsingFallback: this.store.isUsingFallback(),
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
      const currentActor = this.opts.actorId();
      const currentTenant = this.opts.tenantId();
      for (const entry of pending) {
        // T-171 (SYNC-200) — LEGACY TENANT RE-SCOPE: entries enqueued while
        // the app ran in MOCK mode carry the placeholder tenantId "default"
        // (the sync-provider's no-session fallback). Once Supabase is
        // configured, the pre-push `sync_queue` audit upsert (RLS:
        // tenant_id = current_tenant_id()) REJECTS them — the entry fails
        // before any entity RPC runs, exhausts its 5 attempts and sticks as
        // a terminal failure (the owner's 1 170-badge report). Re-scoping a
        // NON-UUID placeholder to the CURRENT session's tenant is safe: the
        // data was imported by THIS user on THIS machine; only the placeholder
        // was baked in. Foreign UUID tenants are handled below (skipped,
        // never re-scoped — multi-tenant isolation, SYNC-102 semantics).
        let entryToPush = entry;
        if (
          entry.tenantId &&
          !isUuidString(entry.tenantId) &&
          isUuidString(currentTenant)
        ) {
          entryToPush = { ...entry, tenantId: currentTenant };
          await this.store.update(entryToPush);
        }

        // Foreign REAL tenants are skipped, never re-scoped and never
        // pushed under this session's JWT: the server's sync_queue RLS
        // (tenant_id = current_tenant_id()) would reject them anyway —
        // skipping locally saves the futile attempt-burn. They stay
        // pending for an owner of that tenant.
        if (
          isUuidString(entryToPush.tenantId ?? "") &&
          entryToPush.tenantId !== currentTenant
        ) {
          continue;
        }

        // SYNC-102 (defense in depth): never push another user's entries
        // under the CURRENT session's JWT (confused-deputy writes with the
        // wrong actor identity). Foreign entries stay pending for their
        // owner. Sign-out additionally clears the whole queue (see the
        // auth provider), so this only fires on process-lifetime leaks.
        if (
          currentActor !== "system" &&
          entryToPush.actorId &&
          entryToPush.actorId !== currentActor
        ) {
          continue;
        }

        // DEFENSE IN DEPTH: never push mock data, even if it ended up
        // in pending status (e.g. due to a bug in enqueue).
        if (entryToPush.isMock) {
          const patched: SyncQueueEntry = { ...entryToPush, status: "skipped_mock" };
          await this.store.update(patched);
          skippedMock++;
          continue;
        }

        // Skip entries that are still in backoff window.
        if (entryToPush.lastAttemptAt) {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(2, entryToPush.attempts);
          const nextAllowedAt = new Date(entryToPush.lastAttemptAt).getTime() + backoffMs;
          if (Date.now() < nextAllowedAt) continue;
        }

        try {
          await this.opts.push(entryToPush);
          const patched: SyncQueueEntry = {
            ...entryToPush,
            status: "synced",
            lastAttemptAt: new Date().toISOString(),
            lastError: null,
          };
          await this.store.update(patched);
          pushed++;
        } catch (err) {
          const attempts = entryToPush.attempts + 1;
          const failed_permanently = attempts >= this.opts.maxAttempts;
          const patched: SyncQueueEntry = {
            ...entryToPush,
            status: failed_permanently ? "failed" : "pending",
            attempts,
            lastAttemptAt: new Date().toISOString(),
            lastError: err instanceof Error ? err.message : String(err),
          };
          await this.store.update(patched);
          if (failed_permanently) failed++;
        }
      }
      // T-171 (SYNC-200): a completed ONLINE drain is a successful sync even
      // when it pushed 0 rows (the queue was already consistent — the daily
      // no-op pass). The pre-T-171 code set lastSyncAt only when pushed > 0,
      // so the settings page could show "Jamais" forever. Persisted so it
      // survives restarts.
      const completedAt = new Date().toISOString();
      this.snapshot.lastSyncAt = completedAt;
      persistLastSyncAt(completedAt);
      this.snapshot.lastAttemptAt = completedAt;
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

/**
 * T-171: minimal UUID shape check (8-4-4-4-12 hex). Used ONLY to detect the
 * mock-era placeholder tenant ("default", "tenant-test", …) so the drain can
 * re-scope legacy entries to the real session tenant. NOT a security check —
 * RLS on the server remains the authority for tenant isolation.
 */
function isUuidString(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
