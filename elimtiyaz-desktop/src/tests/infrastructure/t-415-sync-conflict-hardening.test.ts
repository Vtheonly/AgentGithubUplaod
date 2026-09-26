/**
 * T-415 (issue #13) — sync/conflict hardening: the realistic scenario matrix.
 *
 * The issue-#13 mandate: "Two people changing the same or related records…
 * interrupted synchronization… failed synchronization followed by retry…
 * partial synchronization… version conflicts… stale local data… network
 * failures during synchronization… Verify that conflicts are detected,
 * handled deterministically, and recoverable without silent data loss."
 *
 * Coverage beyond t-298/t-305/t-171:
 *   1. TWO OPERATORS, same field  → park + resolve (local/remote/manual).
 *   2. TWO OPERATORS, DIFFERENT fields → the pushed payload carries the
 *      MERGED row (SYNC-108: the local edit + the remote operator's other-
 *      field edit — never a silent revert of the remote's work).
 *   3. Related records (parent + student) drain independently.
 *   4. Interrupted drain: a mid-drain push failure doesn't block the rest.
 *   5. Partial sync: one permanently-failing entry, others synced.
 *   6. Failed → retryFailed → success; REPEATED failure/recovery cycles.
 *   7. Version conflict: the remote moves AGAIN after a resolve → re-park.
 *   8. Stale local (remote unchanged) + convergent edits → push proceeds.
 *   9. Backoff window: a just-failed entry is skipped until the window.
 *  10. Offline + Supabase-unconfigured drains: queue preserved, nothing
 *      pushed, lastSyncAt untouched.
 *  11. The mock invariant on the drain path.
 *  12. The parked conflict entry survives structured-clone (IndexedDB).
 *  13. Audit hooks fire with the right payloads (detected + resolved).
 *  14. The pure 3-way engine matrix: determinism, nesting, arrays,
 *      added-vs-added, edit-vs-absent, choice application.
 *  15. The production guard semantics via a mocked supabase client
 *      (fetchRemoteRow key filters + the mergedPayload verdict).
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SyncService,
  initialiseSyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import { _resetSyncQueueStoreForTests } from "../../infrastructure/sync/sync-queue-store";
import type { SyncConflictRecord, ConflictGuardVerdict, SyncQueueEntry } from "../../infrastructure/sync/sync-types";
import {
  conflictGuard,
  computeThreeWayForEntry,
  projectPayloadToRowShape,
} from "../../infrastructure/sync/conflict-detector";
import {
  computeThreeWay,
  resolveThreeWay,
} from "../../domain/calc/diff/three-way";
import { deepEqual } from "../../domain/calc/diff/field-diff";

const TENANT_A = "00000000-0000-0000-0000-000000000001";

/* ------------------------------------------------------------------ */
/*  Harness                                                            */
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

interface GuardOutcome {
  conflict: SyncConflictRecord | null;
  mergedPayload?: Record<string, unknown> | null;
}

interface MakeOpts {
  online?: boolean;
  supabaseConfigured?: boolean;
  push?: (entry: SyncQueueEntry) => Promise<void>;
  guard?: (entry: SyncQueueEntry) => Promise<SyncConflictRecord | ConflictGuardVerdict | null>;
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
    actorId: () => "staff-t415",
    isSupabaseConfigured: () => opts.supabaseConfigured ?? true,
    isMockMode: () => false,
    push:
      opts.push ??
      (async (entry: SyncQueueEntry) => {
        pushCalls.push(entry);
      }),
    ...(opts.guard ? { conflictGuard: opts.guard } : {}),
    ...(opts.onConflictDetected ? { onConflictDetected: opts.onConflictDetected } : {}),
    ...(opts.onConflictResolved ? { onConflictResolved: opts.onConflictResolved } : {}),
    autoStart: false,
    onlineDetector: makeStubDetector(opts.online ?? true) as unknown as ConstructorParameters<
      typeof SyncService
    >[0]["onlineDetector"],
  });
  return { service, pushCalls };
}

/** The production-shaped guard over an in-memory "server table". */
function makeServerGuard(server: Map<string, Record<string, unknown>>) {
  return async (entry: SyncQueueEntry): Promise<SyncConflictRecord | ConflictGuardVerdict | null> => {
    const key = String(entry.payload.parent_code ?? entry.payload.code ?? entry.payload.id ?? "");
    const remote = server.get(key) ?? null;
    const { threeWay } = await computeThreeWayForEntry(entry, remote ?? undefined);
    if (!remote) return null;
    if (threeWay.conflicts.length === 0) {
      // SYNC-108 semantics — mirror of the production guard's verdict.
      const merged = threeWay.merged as Record<string, unknown> | null;
      const localProjected = projectPayloadToRowShape(entry.entity, entry.payload);
      if (merged && typeof merged === "object" && !deepEqual(merged, localProjected)) {
        return { conflict: null, mergedPayload: merged };
      }
      return null;
    }
    return {
      detectedAt: new Date().toISOString(),
      remotePayload: remote,
      conflictPaths: threeWay.conflicts.map((c) => c.path),
      conflictPreviews: threeWay.conflicts.map((c) => ({
        path: c.path,
        base: c.baseDisplay,
        local: c.localDisplay,
        remote: c.remoteDisplay,
      })),
    };
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
/*  1 + 2. Two operators — the same field vs different fields          */
/* ------------------------------------------------------------------ */

describe("T-415 — two operators on the same record", () => {
  it("SAME field: the conflict parks, the push NEVER fires, the audit hook carries the paths; resolve=LOCAL pushes the local value", async () => {
    const server = new Map([
      ["PAR-001", { parent_code: "PAR-001", first_name: "Nadia", last_name: "Base" }],
    ]);
    const detected: Array<{ entryId: string; paths: string[] }> = [];
    const { service, pushCalls } = makeService({
      guard: makeServerGuard(server),
      onConflictDetected: (entry, record) => {
        detected.push({ entryId: entry.id, paths: [...record.conflictPaths] });
      },
    });
    await service.start();

    // Operator B edits the server row's phone WHILE operator A is offline.
    server.set("PAR-001", { parent_code: "PAR-001", first_name: "Nadia", last_name: "REMOTE-Edit" });

    const entryId = await enqueueUpdate(
      service,
      { parent_code: "PAR-001", first_name: "Nadia", last_name: "LOCAL-Edit" },
      { parent_code: "PAR-001", first_name: "Nadia", last_name: "Base" },
    );

    const r = await service.syncNow();
    expect(r.pushed).toBe(0);
    expect(pushCalls).toHaveLength(0); // NEVER a silent overwrite

    const conflicts = await service.listConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id).toBe(entryId);
    expect(conflicts[0].conflict?.conflictPaths).toContain("last_name");

    // The audit hook fired with the entry + the paths.
    expect(detected).toHaveLength(1);
    expect(detected[0].entryId).toBe(entryId);
    expect(detected[0].paths).toContain("last_name");

    // Resolve LOCAL → the next drain pushes the local value.
    const resolved = await service.resolveConflict(entryId, { last_name: { kind: "local" } });
    expect(resolved).not.toBeNull();
    expect(resolved!.payload.last_name).toBe("LOCAL-Edit");
    expect(resolved!.status).toBe("pending");

    const r2 = await service.syncNow();
    expect(r2.pushed).toBe(1);
    expect(pushCalls[0].payload.last_name).toBe("LOCAL-Edit");
    expect(await service.listConflicts()).toHaveLength(0);
  });

  it("SAME field: resolve=REMOTE pushes the remote value; resolve=MANUAL pushes the manual value", async () => {
    const server = new Map([
      ["PAR-002", { parent_code: "PAR-002", first_name: "Nadia", last_name: "Base" }],
    ]);
    const resolvedAudits: string[] = [];
    const { service, pushCalls } = makeService({
      guard: makeServerGuard(server),
      onConflictResolved: (_e, resolved) => {
        resolvedAudits.push(String(resolved.payload.last_name));
      },
    });
    await service.start();

    server.set("PAR-002", { parent_code: "PAR-002", first_name: "Nadia", last_name: "REMOTE1" });
    const entryId = await enqueueUpdate(
      service,
      { parent_code: "PAR-002", first_name: "Nadia", last_name: "LOCAL1" },
      { parent_code: "PAR-002", first_name: "Nadia", last_name: "Base" },
    );
    await service.syncNow();
    expect(await service.listConflicts()).toHaveLength(1);

    // REMOTE choice.
    const r1 = await service.resolveConflict(entryId, { last_name: { kind: "remote" } });
    expect(r1!.payload.last_name).toBe("REMOTE1");
    await service.syncNow();
    expect(pushCalls.at(-1)!.payload.last_name).toBe("REMOTE1");
    expect(resolvedAudits).toContain("REMOTE1");

    // A fresh conflict resolved with a MANUAL value.
    server.set("PAR-002", { parent_code: "PAR-002", first_name: "Nadia", last_name: "REMOTE2" });
    const entry2 = await enqueueUpdate(
      service,
      { parent_code: "PAR-002", first_name: "Nadia", last_name: "LOCAL2" },
      { parent_code: "PAR-002", first_name: "Nadia", last_name: "REMOTE1" },
    );
    await service.syncNow();
    expect(await service.listConflicts()).toHaveLength(1);
    const r2 = await service.resolveConflict(entry2, { last_name: { kind: "manual", value: "MANUAL2" } });
    expect(r2!.payload.last_name).toBe("MANUAL2");
    await service.syncNow();
    expect(pushCalls.at(-1)!.payload.last_name).toBe("MANUAL2");
    expect(resolvedAudits).toContain("MANUAL2");
  });

  it("DIFFERENT fields (SYNC-108): the pushed payload carries the MERGED row — the remote operator's edit is never silently reverted", async () => {
    const server = new Map([
      ["PAR-003", { parent_code: "PAR-003", first_name: "Amine", last_name: "Boudiaf", profession: "Engineer" }],
    ]);
    const { service, pushCalls } = makeService({ guard: makeServerGuard(server) });
    await service.start();

    // Operator B edits the server row's FIRST_NAME while operator A edits
    // the LAST_NAME — two DIFFERENT fields of the same record.
    server.set("PAR-003", { parent_code: "PAR-003", first_name: "AMINE-REMOTE", last_name: "Boudiaf", profession: "Engineer" });

    await enqueueUpdate(
      service,
      // Local row: last_name edited; every other field still at its BASE value (stale).
      { parent_code: "PAR-003", first_name: "Amine", last_name: "BOUDIAF-LOCAL", profession: "Engineer" },
      { parent_code: "PAR-003", first_name: "Amine", last_name: "Boudiaf", profession: "Engineer" },
    );

    const r = await service.syncNow();
    expect(r.pushed).toBe(1);
    expect(pushCalls).toHaveLength(1);

    // THE GUARANTEE: the pushed row carries BOTH the local last_name edit AND
    // the remote first_name edit — pushing the bare local payload would have
    // silently reverted the first_name to "Amine" (the base value).
    expect(pushCalls[0].payload.last_name).toBe("BOUDIAF-LOCAL");
    expect(pushCalls[0].payload.first_name).toBe("AMINE-REMOTE");
    expect(await service.listConflicts()).toHaveLength(0);
  });

  it("DIFFERENT fields with no remote change: the push carries the local payload unchanged (no spurious merge)", async () => {
    const server = new Map([
      ["PAR-004", { parent_code: "PAR-004", first_name: "Sara", last_name: "Belaid" }],
    ]);
    const { service, pushCalls } = makeService({ guard: makeServerGuard(server) });
    await service.start();

    await enqueueUpdate(
      service,
      { parent_code: "PAR-004", first_name: "Sara", last_name: "BELAID-LOCAL" },
      { parent_code: "PAR-004", first_name: "Sara", last_name: "Belaid" },
    );
    const r = await service.syncNow();
    expect(r.pushed).toBe(1);
    expect(pushCalls[0].payload.last_name).toBe("BELAID-LOCAL");
  });

  it("related records (a parent edit + a student edit) drain independently — no cross-entry interference", async () => {
    const { service, pushCalls } = makeService();
    await service.start();

    await service.enqueue({
      entity: "parent",
      operation: "update",
      payload: { parent_code: "PAR-010", first_name: "Edited" },
      isMock: false,
      basePayload: { parent_code: "PAR-010", first_name: "Original" },
    });
    await service.enqueue({
      entity: "student",
      operation: "update",
      payload: { student_code: "ELV-010", first_name: "Edited" },
      isMock: false,
      basePayload: { student_code: "ELV-010", first_name: "Original" },
    });

    const r = await service.syncNow();
    expect(r.pushed).toBe(2);
    const kinds = pushCalls.map((e) => e.entity).sort();
    expect(kinds).toEqual(["parent", "student"]);
  });
});

/* ------------------------------------------------------------------ */
/*  4 + 5 + 6. Interrupted / partial / failed-then-retried drains      */
/* ------------------------------------------------------------------ */

describe("T-415 — interrupted and partial synchronization", () => {
  it("a mid-drain push failure does NOT block the remaining entries (per-entry isolation)", async () => {
    const pushedCodes: string[] = [];
    const { service } = makeService({
      push: async (entry) => {
        const code = String(entry.payload.parent_code);
        if (code === "PAR-B") throw new Error("ECONNRESET — connection lost mid-drain");
        pushedCodes.push(code);
      },
    });
    await service.start();

    for (const code of ["PAR-A", "PAR-B", "PAR-C", "PAR-D"]) {
      await service.enqueue({
        entity: "parent",
        operation: "insert",
        payload: { parent_code: code },
        isMock: false,
      });
    }

    const r = await service.syncNow();
    expect(r.pushed).toBe(3);
    expect([...pushedCodes].sort()).toEqual(["PAR-A", "PAR-C", "PAR-D"]);

    // The failed entry: attempts incremented, honest lastError, still pending.
    const pending = await service.getStore().listByStatus("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.parent_code).toBe("PAR-B");
    expect(pending[0].attempts).toBe(1);
    expect(pending[0].lastError).toMatch(/ECONNRESET/);
  });

  it("partial sync: a permanently-failing entry exhausts maxAttempts → failed, while the others are synced", async () => {
    const failAlways = true;
    const pushedCodes: string[] = [];
    const { service } = makeService({
      push: async (entry) => {
        const code = String(entry.payload.parent_code);
        if (failAlways && code === "PAR-BAD") {
          throw new Error("500 — server rejected the row");
        }
        pushedCodes.push(code);
      },
    });
    await service.start();

    await service.enqueue({ entity: "parent", operation: "insert", payload: { parent_code: "PAR-GOOD-1" }, isMock: false });
    await service.enqueue({ entity: "parent", operation: "insert", payload: { parent_code: "PAR-BAD" }, isMock: false });
    await service.enqueue({ entity: "parent", operation: "insert", payload: { parent_code: "PAR-GOOD-2" }, isMock: false });

    // Five consecutive drains exhaust the retry budget of the bad entry.
    for (let i = 0; i < 5; i++) {
      // Reset the backoff window between drains by rewinding lastAttemptAt.
      const pending = await service.getStore().listByStatus("pending");
      for (const e of pending) {
        await service.getStore().update({
          ...e,
          lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
        });
      }
      await service.syncNow();
    }

    const failed = await service.getStore().listByStatus("failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].payload.parent_code).toBe("PAR-BAD");
    expect(failed[0].attempts).toBeGreaterThanOrEqual(5);
    expect(failed[0].lastError).toMatch(/500/);

    const synced = await service.getStore().listByStatus("synced");
    expect(synced.map((e) => e.payload.parent_code).sort()).toEqual(["PAR-GOOD-1", "PAR-GOOD-2"]);

    const snap = service.getSnapshot();
    expect(snap.failedCount).toBe(1);
    expect(snap.syncedCount).toBe(2);
    expect(pushedCodes.filter((c) => c !== "PAR-BAD").length).toBeGreaterThanOrEqual(2);
  });

  it("failed → retryFailed → success: the recovery path re-queues with a fresh backoff budget", async () => {
    let shouldFail = true;
    let pushCount = 0;
    const { service } = makeService({
      push: async (entry) => {
        if (shouldFail && entry.payload.parent_code === "PAR-RETRY") {
          throw new Error("503 — Supabase temporarily unavailable");
        }
        pushCount++;
      },
    });
    await service.start();

    await service.enqueue({ entity: "parent", operation: "insert", payload: { parent_code: "PAR-RETRY" }, isMock: false });

    // Exhaust to terminal failure.
    for (let i = 0; i < 5; i++) {
      const pending = await service.getStore().listByStatus("pending");
      for (const e of pending) {
        await service.getStore().update({
          ...e,
          lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
        });
      }
      await service.syncNow();
    }
    expect(await service.getStore().listByStatus("failed")).toHaveLength(1);

    // Supabase recovers + the operator hits retry.
    shouldFail = false;
    const requeued = await service.retryFailed();
    expect(requeued).toBe(1);

    const pending = await service.getStore().listByStatus("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(0);
    expect(pending[0].lastAttemptAt).toBeNull();

    const r = await service.syncNow();
    expect(r.pushed).toBe(1);
    expect(await service.getStore().listByStatus("failed")).toHaveLength(0);
    expect(pushCount).toBeGreaterThanOrEqual(1);
  });

  it("REPEATED failure/recovery cycles: three transient failures, each followed by a safe re-attempt, then success — never terminal", async () => {
    let failureBudget = 3; // three transient network flaps, then recovery
    const { service } = makeService({
      push: async () => {
        if (failureBudget > 0) {
          failureBudget--;
          throw new Error("transient network flap");
        }
      },
    });
    await service.start();

    await service.enqueue({ entity: "parent", operation: "insert", payload: { parent_code: "PAR-CYCLE" }, isMock: false });

    // Three failing drains — each failure is recorded honestly, the entry
    // stays pending (attempts 1..3, never reaching the terminal 5).
    for (let round = 1; round <= 3; round++) {
      await service.syncNow();
      const pending = await service.getStore().listByStatus("pending");
      expect(pending).toHaveLength(1);
      expect(pending[0].attempts).toBe(round);
      expect(pending[0].lastError).toMatch(/network flap/);
      expect(await service.getStore().listByStatus("failed")).toHaveLength(0);
      // Rewind the backoff window for the next round.
      await service.getStore().update({
        ...pending[0],
        lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
      });
    }

    // The network recovers — the fourth drain succeeds.
    const r = await service.syncNow();
    expect(r.pushed).toBe(1);
    expect(await service.getStore().listByStatus("synced")).toHaveLength(1);
    expect(await service.getStore().listByStatus("failed")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  7. Version conflict — the remote moves again after a resolve       */
/* ------------------------------------------------------------------ */

describe("T-415 — version conflicts (the remote moves again)", () => {
  it("after a resolve, a FURTHER remote change on the same path re-parks — never an infinite loop, never a silent overwrite", async () => {
    const server = new Map([
      ["PAR-500", { parent_code: "PAR-500", first_name: "v0", last_name: "Base" }],
    ]);
    const { service, pushCalls } = makeService({ guard: makeServerGuard(server) });
    await service.start();

    // Conflict #1.
    server.set("PAR-500", { parent_code: "PAR-500", first_name: "v0", last_name: "R1" });
    const entryId = await enqueueUpdate(
      service,
      { parent_code: "PAR-500", first_name: "v0", last_name: "L1" },
      { parent_code: "PAR-500", first_name: "v0", last_name: "Base" },
    );
    await service.syncNow();
    expect(await service.listConflicts()).toHaveLength(1);
    expect(pushCalls).toHaveLength(0);

    // Resolve → push.
    await service.resolveConflict(entryId, { last_name: { kind: "local" } });
    const r1 = await service.syncNow();
    expect(r1.pushed).toBe(1);
    expect(pushCalls[0].payload.last_name).toBe("L1");

    // The remote moves AGAIN on the same path (operator B's second edit).
    server.set("PAR-500", { parent_code: "PAR-500", first_name: "v0", last_name: "R2" });
    const entry2 = await enqueueUpdate(
      service,
      { parent_code: "PAR-500", first_name: "v0", last_name: "L2" },
      { parent_code: "PAR-500", first_name: "v0", last_name: "L1" },
    );
    await service.syncNow();
    const conflicts = await service.listConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id).toBe(entry2);
    expect(pushCalls).toHaveLength(1); // still only the first push

    // The second resolve (remote this time) pushes the remote's value.
    await service.resolveConflict(entry2, { last_name: { kind: "remote" } });
    const r2 = await service.syncNow();
    expect(r2.pushed).toBe(1);
    expect(pushCalls[1].payload.last_name).toBe("R2");
    expect(await service.listConflicts()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  8 + 9. Stale local / convergent / backoff                          */
/* ------------------------------------------------------------------ */

describe("T-415 — stale-local and backoff semantics", () => {
  it("stale local data (remote unchanged since base): the push proceeds normally", async () => {
    const server = new Map([
      ["PAR-600", { parent_code: "PAR-600", first_name: "Same", last_name: "Base" }],
    ]);
    const { service, pushCalls } = makeService({ guard: makeServerGuard(server) });
    await service.start();

    await enqueueUpdate(
      service,
      { parent_code: "PAR-600", first_name: "Same", last_name: "LOCAL-ONLY" },
      { parent_code: "PAR-600", first_name: "Same", last_name: "Base" },
    );
    const r = await service.syncNow();
    expect(r.pushed).toBe(1);
    expect(pushCalls[0].payload.last_name).toBe("LOCAL-ONLY");
    expect(await service.listConflicts()).toHaveLength(0);
  });

  it("convergent edits (both operators made the SAME change): no conflict, one push", async () => {
    const server = new Map([
      ["PAR-601", { parent_code: "PAR-601", first_name: "Nadia", last_name: "Base" }],
    ]);
    const { service, pushCalls } = makeService({ guard: makeServerGuard(server) });
    await service.start();

    server.set("PAR-601", { parent_code: "PAR-601", first_name: "Nadia", last_name: "CONVERGED" });
    await enqueueUpdate(
      service,
      { parent_code: "PAR-601", first_name: "Nadia", last_name: "CONVERGED" },
      { parent_code: "PAR-601", first_name: "Nadia", last_name: "Base" },
    );
    const r = await service.syncNow();
    expect(r.pushed).toBe(1);
    expect(pushCalls[0].payload.last_name).toBe("CONVERGED");
  });

  it("the backoff window: a just-failed entry is SKIPPED by an immediate re-drain (no hot loop)", async () => {
    let calls = 0;
    const { service } = makeService({
      push: async () => {
        calls++;
        throw new Error("flaky");
      },
    });
    await service.start();

    await service.enqueue({ entity: "parent", operation: "insert", payload: { parent_code: "PAR-BACKOFF" }, isMock: false });
    await service.syncNow();
    const attemptsAfterFirst = calls;

    // Immediate second drain: the entry is inside its backoff window.
    await service.syncNow();
    expect(calls).toBe(attemptsAfterFirst); // no new attempt

    const pending = await service.getStore().listByStatus("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  10 + 11. Offline / unconfigured / mock invariant                   */
/* ------------------------------------------------------------------ */

describe("T-415 — offline, unconfigured, and the mock invariant", () => {
  it("OFFLINE drain: nothing pushed, the queue is preserved, lastSyncAt untouched", async () => {
    const { service, pushCalls } = makeService({ online: false });
    await service.start();

    await service.enqueue({ entity: "parent", operation: "insert", payload: { parent_code: "PAR-OFF" }, isMock: false });
    const r = await service.syncNow();
    expect(r.pushed).toBe(0);
    expect(pushCalls).toHaveLength(0);
    expect(await service.getStore().listByStatus("pending")).toHaveLength(1);
    expect(service.getSnapshot().lastSyncAt).toBeNull();
  });

  it("Supabase UNCONFIGURED: even online, the drain refuses to push", async () => {
    const { service, pushCalls } = makeService({ online: true, supabaseConfigured: false });
    await service.start();

    await service.enqueue({ entity: "parent", operation: "insert", payload: { parent_code: "PAR-NOCFG" }, isMock: false });
    const r = await service.syncNow();
    expect(r.pushed).toBe(0);
    expect(pushCalls).toHaveLength(0);
    expect(await service.getStore().listByStatus("pending")).toHaveLength(1);
  });

  it("a mock entry that somehow reached pending is skipped on the drain (defense in depth)", async () => {
    const { service, pushCalls } = makeService();
    await service.start();

    // enqueue marks isMock → skipped_mock immediately. Simulate the legacy
    // corruption path: a pending isMock entry straight into the store.
    const entry: SyncQueueEntry = {
      id: "sync-mock-leak-1",
      queuedAt: new Date().toISOString(),
      lastAttemptAt: null,
      entity: "parent",
      operation: "insert",
      tenantId: TENANT_A,
      actorId: "staff-t415",
      payload: { parent_code: "PAR-MOCK-LEAK" },
      isMock: true,
      status: "pending",
      attempts: 0,
      lastError: null,
    };
    await service.getStore().addBatch([entry]);
    const r = await service.syncNow();
    expect(r.pushed).toBe(0);
    expect(pushCalls).toHaveLength(0);
    const skipped = await service.getStore().listByStatus("skipped_mock");
    expect(skipped).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  12. Persistence semantics of the parked conflict                   */
/* ------------------------------------------------------------------ */

describe("T-415 — the parked conflict survives persistence", () => {
  it("a conflict entry round-trips structuredClone (the IndexedDB write path) byte-safely", async () => {
    const server = new Map([
      ["PAR-700", { parent_code: "PAR-700", first_name: "Base", last_name: "X", notes: { a: 1, b: [1, 2] } }],
    ]);
    const { service } = makeService({ guard: makeServerGuard(server) });
    await service.start();

    server.set("PAR-700", { parent_code: "PAR-700", first_name: "Base", last_name: "Y", notes: { a: 1, b: [1, 2] } });
    const entryId = await enqueueUpdate(
      service,
      { parent_code: "PAR-700", first_name: "Base", last_name: "Z", notes: { a: 1, b: [1, 2] } },
      { parent_code: "PAR-700", first_name: "Base", last_name: "X", notes: { a: 1, b: [1, 2] } },
    );
    await service.syncNow();

    const conflicts = await service.listConflicts();
    expect(conflicts).toHaveLength(1);
    // The exact persistence semantics of the sync-queue store (structured
    // clone): the parked entry (with its conflict record) must survive.
    const cloned = structuredClone(conflicts[0]);
    expect(cloned.id).toBe(entryId);
    expect(cloned.conflict?.conflictPaths).toEqual(conflicts[0].conflict?.conflictPaths);
    expect(cloned.conflict?.remotePayload).toEqual(conflicts[0].conflict?.remotePayload);
    expect(cloned.basePayload).toEqual(conflicts[0].basePayload);
  });
});

/* ------------------------------------------------------------------ */
/*  14. The pure 3-way engine matrix                                   */
/* ------------------------------------------------------------------ */

describe("T-415 — the pure 3-way engine (determinism + shapes)", () => {
  it("deterministic: identical inputs produce identical conflicts/merged trees", () => {
    const base = { a: 1, nested: { x: "b", y: [1, 2] } };
    const local = { a: 2, nested: { x: "b", y: [1, 2] } };
    const remote = { a: 3, nested: { x: "b", y: [1, 2] } };
    const r1 = computeThreeWay(base, local, remote);
    const r2 = computeThreeWay(base, local, remote);
    expect(r1.conflicts).toEqual(r2.conflicts);
    expect(r1.merged).toEqual(r2.merged);
    expect(r1.conflicts.map((c) => c.path)).toEqual(["a"]);
  });

  it("nested objects merge field-by-field (a deep same-path conflict surfaces at the leaf)", () => {
    const base = { addr: { city: "Oran", zip: "31000" } };
    const local = { addr: { city: "Blida", zip: "31000" } };
    const remote = { addr: { city: "Alger", zip: "31000" } };
    const r = computeThreeWay(base, local, remote);
    expect(r.conflicts.map((c) => c.path)).toEqual(["addr.city"]);
    expect(r.merged).toEqual({ addr: { city: "Oran", zip: "31000" } }); // base placeholder
  });

  it("same-length arrays recurse index-wise; length changes conflict as the whole array", () => {
    const base = { tags: ["a", "b"] };
    const localSame = { tags: ["a", "X"] };
    const remoteSame = { tags: ["a", "b"] };
    expect(computeThreeWay(base, localSame, remoteSame).conflicts).toHaveLength(0);
    expect(computeThreeWay(base, localSame, remoteSame).merged).toEqual({ tags: ["a", "X"] });

    // Same NEW length on both sides → index-wise: index 2 conflicts (both
    // added different values at the same index).
    const localLen3 = { tags: ["a", "X", "c"] };
    const remoteLen3 = { tags: ["a", "X", "d"] };
    const rIdx = computeThreeWay(base, localLen3, remoteLen3);
    expect(rIdx.conflicts.map((c) => c.path)).toEqual(["tags[2]"]);

    // DIFFERENT lengths (local grew to 3, remote dropped to 1) → the whole
    // array is one conflict.
    const localLen = { tags: ["a", "X", "c"] };
    const remoteLen = { tags: ["a"] };
    const r = computeThreeWay(base, localLen, remoteLen);
    expect(r.conflicts.map((c) => c.path)).toEqual(["tags"]);
  });

  it("added-vs-added (both added different values) conflicts; edit-vs-absent conflicts", () => {
    const base = { kept: 1 };
    const local = { kept: 1, added: "local" };
    const remote = { kept: 1, added: "remote" };
    expect(computeThreeWay(base, local, remote).conflicts.map((c) => c.path)).toEqual(["added"]);

    // Edit-vs-DELETED: the base HAS the field, the remote dropped it, the
    // local edited it — a genuine both-sides-changed conflict.
    const baseWithGone = { kept: 1, gone: "base" };
    const localEdit = { kept: 1, gone: "edited" };
    const remoteGone = { kept: 1 };
    expect(computeThreeWay(baseWithGone, localEdit, remoteGone).conflicts.map((c) => c.path)).toEqual(["gone"]);
    // Local-ADDED (neither the base nor the remote ever had it) — no
    // conflict, the addition simply rides through.
    expect(computeThreeWay(base, { kept: 1, added: "x" }, { kept: 1 }).conflicts).toHaveLength(0);
  });

  it("resolveThreeWay: local / remote / manual choices apply; OMITTED choices keep the base placeholder (never a silent win)", () => {
    const base = { x: "base", y: "base", z: "base" };
    const local = { x: "local", y: "local", z: "base" };
    const remote = { x: "remote", y: "base", z: "remote" };
    const r = computeThreeWay(base, local, remote);
    // Conflicts: x (both changed) and y? — y: local changed, remote didn't →
    // auto-merged local. z: remote changed, local didn't → auto remote.
    expect(r.conflicts.map((c) => c.path)).toEqual(["x"]);

    const resolved = resolveThreeWay(r, {
      x: { kind: "manual", value: "MANUAL" },
    }) as Record<string, unknown>;
    expect(resolved).toEqual({ x: "MANUAL", y: "local", z: "remote" });

    // Omitted choice → the base placeholder survives.
    const unresolved = resolveThreeWay(r, {}) as Record<string, unknown>;
    expect(unresolved).toEqual({ x: "base", y: "local", z: "remote" });
  });
});

/* ------------------------------------------------------------------ */
/*  15. The production guard through a mocked supabase client          */
/* ------------------------------------------------------------------ */

describe("T-415 — the production conflictGuard (mocked client)", () => {
  // ONE hoisted factory + settable state (multiple vi.mock calls on the
  // same module would collide — the last factory wins).
  const mockState = vi.hoisted(() => ({
    client: null as unknown,
  }));
  vi.mock("../../infrastructure/supabase/supabase-client", () => ({
    getSupabaseClient: () => {
      if (mockState.client === null) throw new Error("client not configured");
      return mockState.client;
    },
  }));

  function setClient(row: Record<string, unknown> | null) {
    mockState.client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
    };
  }

  it("fetchRemoteRow keys by the entity's unique column (parent_code) and returns the row", async () => {
    const remoteRow = { parent_code: "PAR-800", first_name: "Nadia", last_name: "X" };
    setClient(remoteRow);
    const { fetchRemoteRow } = await import("../../infrastructure/sync/conflict-detector");
    const row = await fetchRemoteRow("parent", { parent_code: "PAR-800" });
    expect(row).toEqual(remoteRow);
  });

  it("the guard returns a conflict record when both sides changed the same field", async () => {
    setClient({ parent_code: "PAR-801", first_name: "REMOTE", phone: "0550" });
    const { conflictGuard } = await import("../../infrastructure/sync/conflict-detector");
    const record = await conflictGuard({
      id: "e1",
      queuedAt: new Date().toISOString(),
      lastAttemptAt: null,
      entity: "parent",
      operation: "update",
      tenantId: TENANT_A,
      actorId: "staff-t415",
      payload: { parent_code: "PAR-801", first_name: "LOCAL", last_name: "X" },
      isMock: false,
      basePayload: { parent_code: "PAR-801", first_name: "BASE", last_name: "X" },
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    expect(record).not.toBeNull();
    const rec = record as SyncConflictRecord;
    expect(rec.conflictPaths).toContain("first_name");
    expect(rec.remotePayload).toMatchObject({ first_name: "REMOTE" });
  });

  it("the guard returns the MERGED payload verdict when the two sides edited DIFFERENT fields (SYNC-108)", async () => {
    setClient({ parent_code: "PAR-802", first_name: "Nadia", last_name: "REMOTE-LN", profession: "Doctor" });
    const { conflictGuard } = await import("../../infrastructure/sync/conflict-detector");
    const outcome = await conflictGuard({
      id: "e2",
      queuedAt: new Date().toISOString(),
      lastAttemptAt: null,
      entity: "parent",
      operation: "update",
      tenantId: TENANT_A,
      actorId: "staff-t415",
      payload: { parent_code: "PAR-802", first_name: "Nadia-LOCAL", last_name: "Base-LN", profession: "Doctor" },
      isMock: false,
      basePayload: { parent_code: "PAR-802", first_name: "Nadia", last_name: "Base-LN", profession: "Doctor" },
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    // The verdict: no conflict + the merged payload (local phone + remote city).
    const verdict = outcome as unknown as { conflict: null; mergedPayload: Record<string, unknown> };
    expect(verdict.conflict).toBeNull();
    expect(verdict.mergedPayload).toBeDefined();
    expect(verdict.mergedPayload.first_name).toBe("Nadia-LOCAL");
    expect(verdict.mergedPayload.last_name).toBe("REMOTE-LN");
  });

  it("a remote fetch error fails OPEN (null — the push RPCs stay authoritative)", async () => {
    mockState.client = null; // getSupabaseClient throws
    const { conflictGuard } = await import("../../infrastructure/sync/conflict-detector");
    const record = await conflictGuard({
      id: "e3",
      queuedAt: new Date().toISOString(),
      lastAttemptAt: null,
      entity: "parent",
      operation: "update",
      tenantId: TENANT_A,
      actorId: "staff-t415",
      payload: { parent_code: "PAR-803", first_name: "X" },
      isMock: false,
      basePayload: { parent_code: "PAR-803", first_name: "B" },
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    expect(record).toBeNull();
  });
});
