/**
 * T-171 — desktop sync-queue recovery regression suite (SYNC-200).
 *
 * The owner reported (screenshot, 2026-09-05): queue = 3 544 synced /
 * 1 170 failed / 0 pending — every failure a `student/insert` from the
 * Excel corpus (390 students × 3 imports, queued 03/08/2026 in mock mode),
 * "Dernière synchro: Jamais", toast "Aucune entrée à synchroniser", and a
 * permanent red 1 170 badge in the topbar. Live-DB forensics: the server
 * `sync_queue` holds exactly the 3 544 synced rows and ZERO rows for the
 * 1 170 failures → the pre-push audit upsert (RLS tenant check) rejected
 * the mock-era placeholder tenant "default" → 5 attempts → terminal fail.
 *
 * This suite pins the T-171 fixes:
 *   1. `retryFailed()` re-queues terminal failures (attempts reset,
 *      lastAttemptAt cleared) and they are then drained (fresh budget).
 *   2. `discardFailed()` removes ONLY failed entries — synced entries'
 *      local audit history survives (unlike `clear()`).
 *   3. The drain RE-SCOPES mock-era placeholder tenants ("default") to the
 *      current session's tenant (UUID) before pushing; foreign-UUID
 *      tenants are NEVER re-scoped (SYNC-102 isolation preserved).
 *   4. `lastSyncAt` is persisted (localStorage) and restored at boot, and
 *      a completed online no-op drain (pushed=0) still updates it.
 *   5. The drain retries the FULL fresh budget after retryFailed
 *      (attempts=0 → 5 more attempts before terminal again).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import { _resetSyncQueueStoreForTests } from "../../infrastructure/sync/sync-queue-store";
import type { SyncQueueEntry } from "../../infrastructure/sync/sync-types";

const TENANT_A = "00000000-0000-0000-0000-000000000001";
const TENANT_B = "00000000-0000-0000-0000-000000000002";
const LAST_SYNC_KEY = "el-imtiyaz.sync.lastSyncAt";

/** Same stub shape as sync-batch.test.ts (structural OnlineDetector). */
function makeStubDetector(online: boolean) {
  return {
    start() {},
    stop() {},
    subscribe() {
      return () => {};
    },
    getState: () => ({
      navigatorOnline: online,
      probeOk: online,
      online,
      changedAt: new Date().toISOString(),
    }),
    probe: async () => online,
  };
}

interface MakeOpts {
  online?: boolean;
  tenant?: string;
  actor?: string;
  maxAttempts?: number;
  push?: (entry: SyncQueueEntry) => Promise<void>;
}

function makeService(opts: MakeOpts = {}) {
  const pushCalls: SyncQueueEntry[] = [];
  const service = new SyncService({
    tenantId: () => opts.tenant ?? TENANT_A,
    actorId: () => opts.actor ?? "staff-1",
    isSupabaseConfigured: () => true,
    isMockMode: () => false,
    maxAttempts: opts.maxAttempts ?? 5,
    push:
      opts.push ??
      (async (entry: SyncQueueEntry) => {
        pushCalls.push(entry);
      }),
    autoStart: false,
    onlineDetector: makeStubDetector(opts.online ?? true) as unknown as ConstructorParameters<typeof SyncService>[0]["onlineDetector"],
  });
  return { service, pushCalls };
}

async function seedEntry(
  service: SyncService,
  overrides: Partial<SyncQueueEntry> = {},
): Promise<string> {
  // enqueue() bakes the CURRENT session tenant/actor; tests that need a
  // different shape (terminal failure, mock-era tenant, foreign actor)
  // patch the store entry directly afterwards — the store is the drain's
  // source of truth.
  const id = await service.enqueue({
    entity: "student",
    operation: "insert",
    payload: { firstName: "Test", lastName: "Student", parentId: TENANT_A },
    isMock: false,
    sourceFile: "Suivis clients 2026_2027.xlsx",
  });
  if (Object.keys(overrides).length > 0) {
    const store = service.getStore();
    const entry = await store.get(id);
    if (entry) await store.update({ ...entry, ...overrides });
  }
  return id;
}

/** Age a pending entry's lastAttemptAt far into the past so the next drain
 * is not blocked by the exponential backoff window (test helper only). */
async function ageBackoff(service: SyncService, id: string): Promise<void> {
  const store = service.getStore();
  const entry = await store.get(id);
  if (entry) {
    await store.update({
      ...entry,
      lastAttemptAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
  }
}

beforeEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  localStorage.clear();
});

afterEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  localStorage.clear();
});

describe("T-171 — retryFailed()", () => {
  it("re-queues terminal-failed entries with a FRESH retry budget (attempts=0, no backoff window)", async () => {
    const { service, pushCalls } = makeService();
    await service.start();

    // Simulate the owner's stuck entries: terminal failure after 5 attempts.
    const ids = await Promise.all([
      seedEntry(service, { status: "failed", attempts: 5, lastError: "row-level security policy", lastAttemptAt: new Date().toISOString() }),
      seedEntry(service, { status: "failed", attempts: 5, lastError: "row-level security policy", lastAttemptAt: new Date().toISOString() }),
    ]);
    // The store is the drain's source of truth (direct store patches do not
    // refresh the in-memory snapshot — only service actions do).
    expect((await service.getStore().listByStatus("failed")).length).toBe(2);

    const requeued = await service.retryFailed();
    expect(requeued).toBe(2);

    let snap = service.getSnapshot();
    expect(snap.failedCount).toBe(0);
    expect(snap.pendingCount).toBe(2);

    // The re-queued entries are drained immediately (no backoff window) —
    // this is the "sync is now working" path the owner never had.
    await service.syncNow();
    expect(pushCalls).toHaveLength(2);
    snap = service.getSnapshot();
    expect(snap.syncedCount).toBe(2);
    expect(snap.failedCount).toBe(0);

    // The failed entries' server-bound payload kept its identity (id, payload).
    expect(pushCalls.map((e) => e.id).sort()).toEqual([...ids].sort());
    expect(pushCalls[0]!.attempts).toBe(0);
  });

  it("retryFailed() returns 0 and is a no-op when nothing failed", async () => {
    const { service } = makeService();
    await service.start();
    const requeued = await service.retryFailed();
    expect(requeued).toBe(0);
    expect(service.getSnapshot().pendingCount).toBe(0);
  });

  it("after retryFailed, a failing entry gets a FULL fresh budget before terminal again", async () => {
    // maxAttempts=2 keeps the test fast; the budget semantics are identical.
    let shouldFail = true;
    const { service } = makeService({
      maxAttempts: 2,
      push: async () => {
        if (shouldFail) throw new Error("transient");
      },
    });
    await service.start();

    const id = await seedEntry(service);
    // Cycle 1: attempts 1 (pending + backoff) then 2 (terminal).
    await service.syncNow();
    await ageBackoff(service, id);
    await service.syncNow();
    expect(service.getSnapshot().failedCount).toBe(1);

    // Retry: fresh budget of 2 again — the first new failure is NOT terminal.
    await service.retryFailed();
    await service.syncNow();
    expect(service.getSnapshot().pendingCount).toBe(1);
    expect(service.getSnapshot().failedCount).toBe(0);
    await ageBackoff(service, id);
    await service.syncNow();
    expect(service.getSnapshot().failedCount).toBe(1);

    // And a retry AFTER the error is fixed succeeds end-to-end.
    shouldFail = false;
    await service.retryFailed();
    await service.syncNow();
    expect(service.getSnapshot().syncedCount).toBe(1);
    expect(service.getSnapshot().failedCount).toBe(0);
  });
});

describe("T-171 — discardFailed()", () => {
  it("removes ONLY failed entries — synced entries survive (unlike clear())", async () => {
    const { service } = makeService();
    await service.start();

    const syncedId = await seedEntry(service);
    await service.syncNow(); // synced
    const failedId = await seedEntry(service, { status: "failed", attempts: 5, lastError: "stale residue" });
    expect((await service.getStore().listByStatus("synced")).length).toBe(1);
    expect((await service.getStore().listByStatus("failed")).length).toBe(1);

    const removed = await service.discardFailed();
    expect(removed).toBe(1);

    const snap = service.getSnapshot();
    expect(snap.failedCount).toBe(0);
    expect(snap.syncedCount).toBe(1); // audit history preserved

    // Store-level check: the synced entry is still there, the failed one is gone.
    const store = service.getStore();
    expect(await store.get(syncedId)).not.toBeNull();
    expect(await store.get(failedId)).toBeNull();
  });

  it("returns 0 and is a no-op when nothing failed", async () => {
    const { service } = makeService();
    await service.start();
    expect(await service.discardFailed()).toBe(0);
  });
});

describe("T-171 — legacy mock-era tenant re-scope at drain", () => {
  it("re-scopes a placeholder tenant ('default') to the current session tenant before pushing", async () => {
    const { service, pushCalls } = makeService();
    await service.start();

    const id = await seedEntry(service, { tenantId: "default" });
    await service.syncNow();

    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0]!.tenantId).toBe(TENANT_A);

    // The store is patched durably — a later drain sees the real tenant.
    const store = service.getStore();
    const patched = await store.get(id);
    expect(patched?.tenantId).toBe(TENANT_A);
  });

  it("NEVER re-scopes a foreign UUID tenant — skipped locally, stays pending (SYNC-102 isolation preserved)", async () => {
    const { service, pushCalls } = makeService({ tenant: TENANT_A });
    await service.start();

    await seedEntry(service, { tenantId: TENANT_B });
    await service.syncNow();

    // Not pushed (the server's sync_queue RLS would reject a foreign tenant
    // under this session's JWT anyway — skipping locally saves the futile
    // attempt-burn), not re-scoped, stays pending for its owner's tenant.
    expect(pushCalls).toHaveLength(0);
    const store = service.getStore();
    const all = await store.listAll();
    expect(all[0]!.tenantId).toBe(TENANT_B);
    expect(all[0]!.status).toBe("pending");
  });

  it("still skips foreign-ACTOR entries (SYNC-102 defense in depth unchanged)", async () => {
    const { service, pushCalls } = makeService({ actor: "staff-1" });
    await service.start();

    await seedEntry(service, { actorId: "staff-2", tenantId: TENANT_A });
    await service.syncNow();
    expect(pushCalls).toHaveLength(0);
  });
});

describe("T-171 — persisted lastSyncAt", () => {
  it("survives service restarts (the 'Dernière synchro: Jamais' defect)", async () => {
    {
      const { service } = makeService();
      await service.start();
      expect(service.getSnapshot().lastSyncAt).toBeNull(); // nothing yet
      await service.syncNow();
      expect(service.getSnapshot().lastSyncAt).not.toBeNull();
      expect(localStorage.getItem(LAST_SYNC_KEY)).not.toBeNull();
    }
    // New service instance = "app restart" (fresh constructor, same storage).
    {
      const { service } = makeService();
      await service.start();
      const restored = service.getSnapshot().lastSyncAt;
      expect(restored).not.toBeNull();
      expect(restored).toBe(localStorage.getItem(LAST_SYNC_KEY));
    }
  });

  it("a completed ONLINE no-op drain (pushed=0) still updates lastSyncAt", async () => {
    const { service } = makeService();
    await service.start();
    const result = await service.syncNow();
    expect(result.pushed).toBe(0);
    // Pre-T-171: lastSyncAt stayed null forever when nothing was pushed —
    // "Jamais" despite a healthy, consistent queue.
    expect(service.getSnapshot().lastSyncAt).not.toBeNull();
  });

  it("offline drains do NOT touch lastSyncAt", async () => {
    const { service } = makeService({ online: false });
    await service.start();
    await service.syncNow();
    expect(service.getSnapshot().lastSyncAt).toBeNull();
    expect(localStorage.getItem(LAST_SYNC_KEY)).toBeNull();
  });

  it("a corrupted persisted value degrades to null (not a crash)", async () => {
    localStorage.setItem(LAST_SYNC_KEY, "not-a-date");
    const { service } = makeService();
    await service.start();
    expect(service.getSnapshot().lastSyncAt).toBeNull();
  });
});

describe("T-171 — sync-provider action surface", () => {
  it("exposes retryFailed + discardFailed on the SyncActions contract (source-scan)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../app/providers/sync-provider.tsx"),
      "utf8",
    );
    expect(src).toContain("retryFailed: () => service.retryFailed()");
    expect(src).toContain("discardFailed: () => service.discardFailed()");
  });

  it("SyncTab renders the recovery actions for failed entries (source-scan)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../features/settings/sync-tab.tsx"),
      "utf8",
    );
    expect(src).toContain("handleRetryFailed");
    expect(src).toContain("handleDiscardFailed");
    expect(src).toContain("Réessayer les échecs");
    // The honest toast: no-op drain + failed entries must NOT say
    // "Aucune entrée à synchroniser" alone.
    expect(src).toMatch(/else if \(status\.failedCount > 0\)/);
    // Row-level error tooltip (the diagnosis affordance).
    expect(src).toContain("title={e.lastError ?");
  });

  it("SyncIndicator offers a retry action for terminal failures (source-scan)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../infrastructure/sync/sync-indicator.tsx"),
      "utf8",
    );
    expect(src).toContain("handleRetryFailed");
    expect(src).toContain("actions.retryFailed()");
  });
});

describe("T-171 — store.deleteMany (single-transaction removal)", () => {
  it("deletes exactly the requested ids and nothing else", async () => {
    const { service } = makeService();
    await service.start();
    const idA = await seedEntry(service);
    const idB = await seedEntry(service);
    const idC = await seedEntry(service);

    const store = service.getStore();
    await store.deleteMany([idA, idC]);

    expect(await store.get(idA)).toBeNull();
    expect(await store.get(idB)).not.toBeNull();
    expect(await store.get(idC)).toBeNull();
  });

  it("no-ops on an empty list", async () => {
    const { service } = makeService();
    await service.start();
    await service.getStore().deleteMany([]);
    expect((await service.getStore().listAll()).length).toBe(0);
  });
});

// Keep vi referenced for future inline mocks in this suite.
void vi;
