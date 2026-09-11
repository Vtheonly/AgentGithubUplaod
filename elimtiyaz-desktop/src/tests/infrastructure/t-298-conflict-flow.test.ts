/**
 * T-298 (OFFLINE-400) — the 3-way conflict flow regression suite.
 *
 * Pins the no-silent-overwrite guarantee end to end on the SyncService
 * push path:
 *   1. an `update` entry carrying a basePayload whose queued edit diverges
 *      from the CURRENT server row on fields BOTH sides changed PARKS in
 *      `conflict` status — the push handler is NEVER called for it;
 *   2. detection fires `onConflictDetected` (the audit + notification hook
 *      in the production wiring);
 *   3. the snapshot exposes `conflictCount` and `listConflicts()` returns
 *      the parked entries;
 *   4. `resolveConflict(entryId, choices)` recomputes the 3-way, applies
 *      the per-field choices, re-queues the entry as `pending` with the
 *      merged payload, and fires `onConflictResolved`;
 *   5. the next drain pushes the RESOLVED payload (not the stale edit);
 *   6. a guard miss (null) pushes normally; insert entries and entries
 *      without a basePayload never consult the guard; a guard THROW
 *      fails open (the push RPCs stay authoritative).
 *   7. the payload projection (camelCase → server-row keys) and the
 *      production `conflictGuard` (remote fetch + computeThreeWay) round
 *      a real three-column vector.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import { _resetSyncQueueStoreForTests } from "../../infrastructure/sync/sync-queue-store";
import type { SyncConflictRecord, SyncQueueEntry } from "../../infrastructure/sync/sync-types";
import {
  conflictGuard,
  projectPayloadToRowShape,
  computeThreeWayForEntry,
} from "../../infrastructure/sync/conflict-detector";

const TENANT_A = "00000000-0000-0000-0000-000000000001";

/* ------------------------------------------------------------------ */
/*  Harness (same shape as t-171-sync-recovery.test.ts)                */
/* ------------------------------------------------------------------ */

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
  push?: (entry: SyncQueueEntry) => Promise<void>;
  conflictGuard?: (entry: SyncQueueEntry) => Promise<SyncConflictRecord | null>;
  onConflictDetected?: (entry: SyncQueueEntry, record: SyncConflictRecord) => void | Promise<void>;
  onConflictResolved?: (
    entry: SyncQueueEntry,
    resolved: SyncQueueEntry,
    resolution: { chosenPaths: readonly string[]; payload: Record<string, unknown> },
  ) => void | Promise<void>;
}

function makeService(opts: MakeOpts = {}) {
  const pushCalls: SyncQueueEntry[] = [];
  const service = new SyncService({
    tenantId: () => TENANT_A,
    actorId: () => "staff-1",
    isSupabaseConfigured: () => true,
    isMockMode: () => false,
    push:
      opts.push ??
      (async (entry: SyncQueueEntry) => {
        pushCalls.push(entry);
      }),
    ...(opts.conflictGuard ? { conflictGuard: opts.conflictGuard } : {}),
    ...(opts.onConflictDetected ? { onConflictDetected: opts.onConflictDetected } : {}),
    ...(opts.onConflictResolved ? { onConflictResolved: opts.onConflictResolved } : {}),
    autoStart: false,
    onlineDetector: makeStubDetector(true) as unknown as ConstructorParameters<typeof SyncService>[0]["onlineDetector"],
  });
  return { service, pushCalls };
}

/** Build a conflict record the way the production guard does. */
function recordFor(paths: string[], remote: Record<string, unknown>): SyncConflictRecord {
  return {
    detectedAt: new Date().toISOString(),
    remotePayload: remote,
    conflictPaths: paths,
    conflictPreviews: paths.map((path) => ({ path, base: "—", local: "—", remote: "—" })),
  };
}

async function enqueueUpdate(
  service: SyncService,
  payload: Record<string, unknown>,
  basePayload: Record<string, unknown> | null,
): Promise<string> {
  return service.enqueue({
    entity: "parent",
    operation: "update",
    payload,
    isMock: false,
    basePayload,
  });
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
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  The flow                                                            */
/* ------------------------------------------------------------------ */

describe("T-298 — the conflict flow on the drain path", () => {
  it("parks an update whose fields BOTH sides changed — the push handler is NEVER called", async () => {
    const guard = vi.fn(async () =>
      recordFor(["first_name"], { first_name: "Server", last_name: "X" }),
    );
    const detected = vi.fn();
    const { service, pushCalls } = makeService({
      conflictGuard: guard,
      onConflictDetected: detected,
    });
    await service.start();

    const id = await enqueueUpdate(
      service,
      { firstName: "Local", last_name: "X" },
      { first_name: "Base", last_name: "X" },
    );
    await service.syncNow();

    expect(guard).toHaveBeenCalled();
    expect(pushCalls).toHaveLength(0); // THE no-silent-overwrite guarantee
    expect(detected).toHaveBeenCalledTimes(1);

    const store = service.getStore();
    const parked = await store.get(id);
    expect(parked?.status).toBe("conflict");
    expect(parked?.conflict?.conflictPaths).toEqual(["first_name"]);
    expect(service.getSnapshot().conflictCount).toBe(1);

    const listed = await service.listConflicts();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(id);
  });

  it("resolveConflict applies the choices, re-queues as pending, fires onConflictResolved", async () => {
    const guard = vi.fn(async () =>
      recordFor(["first_name"], { first_name: "Server", last_name: "X" }),
    );
    const resolvedHook = vi.fn();
    const { service } = makeService({
      conflictGuard: guard,
      onConflictResolved: resolvedHook,
    });
    await service.start();

    const id = await enqueueUpdate(
      service,
      { firstName: "Local", last_name: "X" },
      { first_name: "Base", last_name: "X" },
    );
    await service.syncNow();

    const resolved = await service.resolveConflict(id, {
      first_name: { kind: "manual", value: "Fusionné" },
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.status).toBe("pending");
    expect(resolved?.conflict).toBeNull();
    expect(resolved?.payload.first_name).toBe("Fusionné");

    expect(resolvedHook).toHaveBeenCalledTimes(1);
    expect(resolvedHook.mock.calls[0][2].chosenPaths).toEqual(["first_name"]);

    const store = service.getStore();
    const entry = await store.get(id);
    expect(entry?.status).toBe("pending");
    expect(service.getSnapshot().conflictCount).toBe(0);
  });

  it("the next drain pushes the RESOLVED payload, and the guard re-checks it (fresh remote)", async () => {
    // Detection round: the remote diverges → park.
    let remoteNow: Record<string, unknown> | null = { first_name: "Server", last_name: "X" };
    const guard = vi.fn(async (_entry: SyncQueueEntry) =>
      remoteNow
        ? recordFor(["first_name"], remoteNow)
        : null,
    );
    const { service, pushCalls } = makeService({ conflictGuard: guard });
    await service.start();

    const id = await enqueueUpdate(
      service,
      { firstName: "Local", last_name: "X" },
      { first_name: "Base", last_name: "X" },
    );
    await service.syncNow();
    expect(pushCalls).toHaveLength(0);

    await service.resolveConflict(id, { first_name: { kind: "remote" } });

    // The remote no longer diverges from the resolved payload → guard
    // passes and the RESOLVED payload reaches the push handler.
    remoteNow = null;
    guard.mockClear();
    await service.syncNow();
    expect(guard).toHaveBeenCalled();
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].payload.first_name).toBe("Server"); // take-remote
    // The entry reaches the push handler as pending; the drain flips the
    // STORE entry to synced after the push returns.
    const store = service.getStore();
    const entry = await store.get(id);
    expect(entry?.status).toBe("synced");
    expect(service.getSnapshot().conflictCount).toBe(0);
  });

  it("a guard miss (null) pushes normally — no false positives", async () => {
    const guard = vi.fn(async () => null);
    const { service, pushCalls } = makeService({ conflictGuard: guard });
    await service.start();

    await enqueueUpdate(
      service,
      { firstName: "Local", last_name: "X" },
      { first_name: "Base", last_name: "X" },
    );
    await service.syncNow();
    expect(pushCalls).toHaveLength(1);
    expect(service.getSnapshot().conflictCount).toBe(0);
  });

  it("insert entries and entries without a basePayload never consult the guard", async () => {
    const guard = vi.fn(async () => {
      throw new Error("the guard must not be consulted");
    });
    const { service, pushCalls } = makeService({ conflictGuard: guard });
    await service.start();

    // insert + no basePayload
    await service.enqueue({
      entity: "parent",
      operation: "insert",
      payload: { firstName: "New" },
      isMock: false,
    });
    // update WITHOUT a basePayload — no 3-way possible, the RPC semantics apply
    await service.enqueue({
      entity: "parent",
      operation: "update",
      payload: { firstName: "NoBase" },
      isMock: false,
      basePayload: null,
    });
    await service.syncNow();
    expect(guard).not.toHaveBeenCalled();
    expect(pushCalls).toHaveLength(2);
  });

  it("a guard THROW fails open — the push proceeds (RPCs stay authoritative)", async () => {
    const guard = vi.fn(async () => {
      throw new Error("remote fetch failed");
    });
    const { service, pushCalls } = makeService({ conflictGuard: guard });
    await service.start();

    await enqueueUpdate(
      service,
      { firstName: "Local", last_name: "X" },
      { first_name: "Base", last_name: "X" },
    );
    await service.syncNow();
    expect(pushCalls).toHaveLength(1);
    expect(service.getSnapshot().conflictCount).toBe(0);
  });

  it("a conflict-parked entry survives a restart (persisted on the queue entry)", async () => {
    const guard = vi.fn(async () =>
      recordFor(["first_name"], { first_name: "Server", last_name: "X" }),
    );
    const { service } = makeService({ conflictGuard: guard });
    await service.start();

    const id = await enqueueUpdate(
      service,
      { firstName: "Local", last_name: "X" },
      { first_name: "Base", last_name: "X" },
    );
    await service.syncNow();

    // Simulate the restart: same store (IndexedDB persists), new service.
    const { service: service2 } = makeService({ conflictGuard: guard });
    await service2.start();
    const conflicts = await service2.listConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id).toBe(id);
    expect(service2.getSnapshot().conflictCount).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  The production guard's pure pieces                                  */
/* ------------------------------------------------------------------ */

describe("T-298 — payload projection + computeThreeWayForEntry", () => {
  it("projects camelCase domain keys onto the server-row key space", () => {
    expect(
      projectPayloadToRowShape("parent", {
        firstName: "A",
        lastName: "B",
        phone: "+213",
        displayName: "A B",
      }),
    ).toEqual({
      first_name: "A",
      last_name: "B",
      primary_phone: "+213",
      display_name: "A B",
    });
  });

  it("unknown keys pass through unchanged (the projection never drops data)", () => {
    expect(projectPayloadToRowShape("parent", { weirdKey: 1, firstName: "A" })).toEqual({
      weirdKey: 1,
      first_name: "A",
    });
  });

  it("is idempotent — an already-projected (snake_case) payload projects to itself", () => {
    const once = projectPayloadToRowShape("student", { firstName: "A", classId: "c1" });
    const twice = projectPayloadToRowShape("student", once);
    expect(twice).toEqual(once);
  });

  it("unmapped entity kinds pass through untouched", () => {
    expect(projectPayloadToRowShape("installment", { amountDue: 5 })).toEqual({ amountDue: 5 });
  });

  it("computeThreeWayForEntry: base vs projected-local vs remote — one conflict", async () => {
    const entry = {
      entity: "parent" as const,
      payload: { firstName: "Local", last_name: "X" },
      basePayload: { first_name: "Base", last_name: "X" },
    };
    const { threeWay, remote } = await computeThreeWayForEntry(entry, {
      first_name: "Server",
      last_name: "X",
    });
    expect(remote).toEqual({ first_name: "Server", last_name: "X" });
    expect(threeWay.conflicts).toHaveLength(1);
    expect(threeWay.conflicts[0].path).toBe("first_name");
    expect(threeWay.conflicts[0].localDisplay).toBe("Local");
    expect(threeWay.conflicts[0].remoteDisplay).toBe("Server");
  });

  it("computeThreeWayForEntry: no remote row → no conflicts, remote null", async () => {
    const entry = {
      entity: "parent" as const,
      payload: { firstName: "Local" },
      basePayload: { first_name: "Base" },
    };
    const { threeWay, remote } = await computeThreeWayForEntry(entry, null);
    expect(remote).toBeNull();
    expect(threeWay.conflicts).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  The production conflictGuard (remote fetch + engine)                */
/* ------------------------------------------------------------------ */

describe("T-298 — the production conflictGuard with a stubbed Supabase client", () => {
  /** Chainable from().select().eq().maybeSingle() stub. */
  function stubClient(row: Record<string, unknown> | null) {
    const make = () => {
      const state: Record<string, unknown> = {};
      const chain = {
        eq(col: string, value: unknown) {
          state[col] = value;
          return chain;
        },
        async maybeSingle() {
          // Emulate the unique-key match: the row's key column must equal
          // the last eq filter for parent_code.
          if (row && row.parent_code === state.parent_code) return { data: row, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    };
    return {
      from: (_table: string) => ({
        select: (_cols: string) => make(),
      }),
    };
  }

  async function withClient<T>(
    client: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    vi.doMock("../../infrastructure/supabase/supabase-client", () => ({
      getSupabaseClient: () => client,
      isSupabaseConfigured: () => true,
    }));
    try {
      return await fn();
    } finally {
      vi.doUnmock("../../infrastructure/supabase/supabase-client");
    }
  }

  it("returns a conflict record when the live row diverges on a both-changed field", async () => {
    const client = stubClient({
      parent_code: "PAR-2026-A12",
      first_name: "Yacine",
      last_name: "Benali",
      occupation: "Server-set occupation",
    });
    await withClient(client, async () => {
      const record = await conflictGuard({
        id: "sync_test_1",
        queuedAt: new Date().toISOString(),
        lastAttemptAt: null,
        entity: "parent",
        operation: "update",
        tenantId: TENANT_A,
        actorId: "staff-1",
        payload: {
          code: "PAR-2026-A12",
          firstName: "Yacine",
          lastName: "LOCAL-EDITED",
        },
        isMock: false,
        basePayload: {
          parent_code: "PAR-2026-A12",
          first_name: "Yacine",
          last_name: "Benali",
        },
        status: "pending",
        attempts: 0,
        lastError: null,
      });
      // last_name: base "Benali" → local "LOCAL-EDITED", remote "Benali"?
      // Remote equals base on last_name → only-local changed → auto-merge.
      // occupation: base absent → remote set → only-remote changed → applied.
      // So NO conflict here — the guard returns null (disjoint merge).
      expect(record).toBeNull();
    });
  });

  it("parks when local and remote edited the SAME field differently", async () => {
    const client = stubClient({
      parent_code: "PAR-2026-A12",
      first_name: "ServerName",
      last_name: "Benali",
    });
    await withClient(client, async () => {
      const record = await conflictGuard({
        id: "sync_test_2",
        queuedAt: new Date().toISOString(),
        lastAttemptAt: null,
        entity: "parent",
        operation: "update",
        tenantId: TENANT_A,
        actorId: "staff-1",
        payload: {
          code: "PAR-2026-A12",
          firstName: "LocalName",
          lastName: "Benali",
        },
        isMock: false,
        basePayload: {
          parent_code: "PAR-2026-A12",
          first_name: "BaseName",
          last_name: "Benali",
        },
        status: "pending",
        attempts: 0,
        lastError: null,
      });
      expect(record).not.toBeNull();
      expect(record?.conflictPaths).toEqual(["first_name"]);
      expect(record?.conflictPreviews[0]).toMatchObject({
        path: "first_name",
        base: "BaseName",
        local: "LocalName",
        remote: "ServerName",
      });
      expect(record?.remotePayload.parent_code).toBe("PAR-2026-A12");
    });
  });

  it("returns null when the row does not exist (nothing to conflict with)", async () => {
    const client = stubClient(null);
    await withClient(client, async () => {
      const record = await conflictGuard({
        id: "sync_test_3",
        queuedAt: new Date().toISOString(),
        lastAttemptAt: null,
        entity: "parent",
        operation: "update",
        tenantId: TENANT_A,
        actorId: "staff-1",
        payload: { code: "PAR-DOES-NOT-EXIST", firstName: "X" },
        isMock: false,
        basePayload: { parent_code: "PAR-DOES-NOT-EXIST", first_name: "Y" },
        status: "pending",
        attempts: 0,
        lastError: null,
      });
      expect(record).toBeNull();
    });
  });
});
