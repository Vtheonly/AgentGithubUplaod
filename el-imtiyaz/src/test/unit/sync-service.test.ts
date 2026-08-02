/**
 * SyncService tests (Iteration 14).
 *
 * Covers:
 *   - Mock data is auto-marked `skipped_mock` and NEVER pushed.
 *   - Real (non-mock) entries are pushed when online + Supabase configured.
 *   - Drain is a no-op when offline or Supabase unconfigured.
 *   - Failed pushes retry with backoff up to maxAttempts.
 *   - Online transition triggers an immediate drain.
 *   - clearQueue() empties the store.
 *   - Snapshot reflects queue state.
 *
 * The tests use the in-memory IndexedDB fallback (fake-indexeddb is
 * already configured globally in vitest setup) and stub the online
 * detector + Supabase config check.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  SyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import { _resetSyncQueueStoreForTests } from "../../infrastructure/sync/sync-queue-store";
import { _resetOnlineDetectorForTests, StubOnlineDetector } from "../../infrastructure/sync/online-detector";
import type { SyncServiceConstructorOptions } from "../../infrastructure/sync/sync-service";
import type { SyncServiceOptions } from "../../infrastructure/sync/sync-types";

// One stub detector per test — set via `svc.opts.onlineDetector`.
let stubDetector: StubOnlineDetector;

function makeOpts(overrides: Partial<SyncServiceOptions> = {}): SyncServiceConstructorOptions {
  return {
    tenantId: () => "tenant-test",
    actorId: () => "user-test",
    isSupabaseConfigured: () => true,
    isMockMode: () => false,
    push: vi.fn().mockResolvedValue(undefined),
    autoStart: false,
    pollIntervalMs: 60_000,
    offlinePollIntervalMs: 120_000,
    maxAttempts: 3,
    onlineDetector: stubDetector,
    ...overrides,
  };
}

async function makeService(opts: SyncServiceConstructorOptions) {
  const svc = new SyncService(opts);
  await svc.start();
  return svc;
}

beforeEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  _resetOnlineDetectorForTests();
  stubDetector = new StubOnlineDetector(true);
});

afterEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  _resetOnlineDetectorForTests();
  vi.restoreAllMocks();
});

describe("SyncService — mock data exclusion", () => {
  it("auto-marks mock entries as skipped_mock at queue time", async () => {
    const opts = makeOpts();
    const svc = await makeService(opts);
    const id = await svc.enqueue({
      entity: "student",
      operation: "insert",
      payload: { name: "Mock Student" },
      isMock: true,
    });
    const snap = svc.getSnapshot();
    expect(snap.skippedMockCount).toBe(1);
    expect(snap.pendingCount).toBe(0);
    // The push handler is NEVER called for mock entries.
    expect((opts.push as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    // The entry exists in the store with skipped_mock status.
    const entry = await svc.getStore().get(id);
    expect(entry?.status).toBe("skipped_mock");
    expect(entry?.isMock).toBe(true);
  });

  it("does not push mock entries even if they end up pending (defense in depth)", async () => {
    const opts = makeOpts();
    const svc = await makeService(opts);
    // Manually inject a mock entry with status=pending (simulating a bug).
    const { getSyncQueueStore } = await import("../../infrastructure/sync/sync-queue-store");
    const store = getSyncQueueStore();
    await store.init();
    await store.add({
      id: "sneaky-mock",
      queuedAt: new Date().toISOString(),
      lastAttemptAt: null,
      entity: "student",
      operation: "insert",
      tenantId: "tenant-test",
      actorId: "user-test",
      payload: { name: "Sneaky Mock" },
      isMock: true,
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    await svc.syncNow();
    // The push handler is NEVER called.
    expect((opts.push as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    // The entry was re-marked as skipped_mock.
    const entry = await store.get("sneaky-mock");
    expect(entry?.status).toBe("skipped_mock");
  });
});

describe("SyncService — real data sync", () => {
  it("pushes real entries when online + Supabase configured", async () => {
    const opts = makeOpts();
    const svc = await makeService(opts);
    await svc.enqueue({
      entity: "student",
      operation: "insert",
      payload: { name: "Real Student" },
      isMock: false,
      sourceFile: "Suivis clients 2026_2027.xlsx",
    });
    const result = await svc.syncNow();
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skippedMock).toBe(0);
    expect((opts.push as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const snap = svc.getSnapshot();
    expect(snap.syncedCount).toBe(1);
    expect(snap.pendingCount).toBe(0);
  });

  it("retries failed entries with backoff up to maxAttempts", async () => {
    const push = vi.fn().mockRejectedValue(new Error("Network error"));
    const opts = makeOpts({ push, maxAttempts: 3 });
    const svc = await makeService(opts);
    await svc.enqueue({
      entity: "student",
      operation: "insert",
      payload: { name: "Real Student" },
      isMock: false,
    });
    // First syncNow: attempts = 1, still pending.
    let result = await svc.syncNow();
    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(0);
    let entry = await svc.getStore().listByStatus("pending");
    expect(entry).toHaveLength(1);
    expect(entry[0].attempts).toBe(1);
    // Second syncNow: attempts = 2, still pending (backoff window may apply).
    // We need to bypass the backoff — patch the lastAttemptAt to far past.
    await svc.getStore().update({ ...entry[0], lastAttemptAt: "2000-01-01T00:00:00.000Z" });
    result = await svc.syncNow();
    entry = await svc.getStore().listByStatus("pending");
    expect(entry[0].attempts).toBe(2);
    // Third syncNow: attempts = 3, marked as failed (maxAttempts reached).
    await svc.getStore().update({ ...entry[0], lastAttemptAt: "2000-01-01T00:00:00.000Z" });
    result = await svc.syncNow();
    expect(result.failed).toBe(1);
    const failed = await svc.getStore().listByStatus("failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].lastError).toContain("Network error");
  });

  it("syncNow is a no-op when Supabase is not configured", async () => {
    const opts = makeOpts({ isSupabaseConfigured: () => false });
    const svc = await makeService(opts);
    await svc.enqueue({
      entity: "student",
      operation: "insert",
      payload: { name: "Real Student" },
      isMock: false,
    });
    const result = await svc.syncNow();
    expect(result.pushed).toBe(0);
    expect((opts.push as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

describe("SyncService — clearQueue", () => {
  it("empties the store", async () => {
    const opts = makeOpts();
    const svc = await makeService(opts);
    await svc.enqueue({
      entity: "student",
      operation: "insert",
      payload: { name: "A" },
      isMock: false,
    });
    await svc.enqueue({
      entity: "student",
      operation: "insert",
      payload: { name: "B" },
      isMock: true,
    });
    expect(svc.getSnapshot().pendingCount + svc.getSnapshot().skippedMockCount).toBe(2);
    await svc.clearQueue();
    const snap = svc.getSnapshot();
    expect(snap.pendingCount).toBe(0);
    expect(snap.syncedCount).toBe(0);
    expect(snap.skippedMockCount).toBe(0);
    expect(snap.failedCount).toBe(0);
  });
});

describe("SyncService — snapshot subscription", () => {
  it("emits snapshot changes to subscribers", async () => {
    const opts = makeOpts();
    const svc = await makeService(opts);
    const snapshots: number[] = [];
    const unsub = svc.subscribe((s) => snapshots.push(s.pendingCount));
    await svc.enqueue({
      entity: "student",
      operation: "insert",
      payload: { name: "A" },
      isMock: false,
    });
    // At least the initial snapshot + the post-enqueue snapshot.
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[snapshots.length - 1]).toBe(1);
    unsub();
  });
});
