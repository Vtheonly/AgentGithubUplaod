/**
 * T-305 (47th session) — the conflict-guard ARMING regression suite.
 *
 * The 46th session shipped the 3-way no-silent-overwrite guard (T-298) but
 * its only enqueue producer passed NO basePayload — the guard could never
 * fire in production traffic (the honest residual: "the only current
 * enqueue call site is the insert-heavy Excel import; update-path screens
 * should pass basePayload to arm the guard").
 *
 * This suite pins the arming fix in the production UPDATE producer — the
 * offline operating mode's staging pass (MockStore.stageAndNotify, the path
 * every offline edit flows through after a restore):
 *
 *   1. an offline EDIT enqueues its update entry WITH the pre-edit row
 *      snapshot as `basePayload` (the 3-way BASE — field-level values, not
 *      a placeholder);
 *   2. insert and delete entries NEVER carry a base (nothing to diverge
 *      from / nothing to merge — the guard contract);
 *   3. consecutive edits produce one entry each with its OWN correct base
 *      (A→B carries base A; B→C carries base B);
 *   4. THE GUARD FIRES: an armed update whose server row diverges on a
 *      field BOTH sides changed parks in `conflict` status — the push
 *      handler is NEVER called (the production conflictGuard shape is
 *      exercised through the same computeThreeWayForEntry contract the
 *      real guard uses);
 *   5. an armed update with NO divergence pushes normally (the base
 *      presence alone never blocks a healthy drain).
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runBackup,
  restore,
  clearRestoredFromMarker,
  setBackupPassphrase,
} from "../../infrastructure/backup/backup-service";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { mockRepositories } from "../../app/providers/repository-provider";
import {
  SyncService,
  initialiseSyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import { _resetSyncQueueStoreForTests } from "../../infrastructure/sync/sync-queue-store";
import type { SyncQueueEntry } from "../../infrastructure/sync/sync-types";
import {
  computeThreeWayForEntry,
} from "../../infrastructure/sync/conflict-detector";

/* ------------------------------------------------------------------ */
/*  Harness (t-300 shape — the singleton the restore's staging binds)  */
/* ------------------------------------------------------------------ */

const TENANT = "00000000-0000-0000-0000-000000000001";

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

const reposStub = mockRepositories;

let pushCalls: SyncQueueEntry[] = [];
let service: SyncService | null = null;
/** The fake "server rows" the stub guard consults (production shape). */
let serverRows: Map<string, Record<string, unknown>> = new Map();

/**
 * A production-shaped conflictGuard: the SAME computeThreeWayForEntry the
 * real guard calls — base = entry.basePayload, local = the projected
 * payload, remote = the fake server row (keyed by the row's code). This
 * exercises the guard contract the arming fix is meant to satisfy, without
 * a live Supabase fetch.
 */
async function stubGuard(entry: SyncQueueEntry) {
  const code = (entry.payload.code as string) ?? (entry.payload.parent_code as string);
  if (!code) return null;
  const remote = serverRows.get(code);
  if (!remote) return null;
  const { threeWay } = await computeThreeWayForEntry(entry, remote);
  if (threeWay.conflicts.length === 0) return null;
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
}

function offlineServiceOptions() {
  return {
    tenantId: () => TENANT,
    actorId: () => "staff-305",
    isSupabaseConfigured: () => true,
    isMockMode: () => false,
    push: async (entry: SyncQueueEntry) => {
      pushCalls.push(entry);
    },
    autoStart: false,
    conflictGuard: stubGuard,
    onlineDetector: makeStubDetector(false) as unknown as ConstructorParameters<typeof SyncService>[0]["onlineDetector"],
  };
}

beforeEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  localStorage.clear();
  pushCalls = [];
  serverRows = new Map();
  service = initialiseSyncService(offlineServiceOptions());
  await service.start();
  store.disarmStaging();
  clearRestoredFromMarker();
  setBackupPassphrase("phrase-de-test-47th-session");
});

afterEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  localStorage.clear();
  store.disarmStaging();
  clearRestoredFromMarker();
  setBackupPassphrase(null);
});

/** Restore a known backup so the offline operating mode + staging arm. */
async function armOfflineMode(): Promise<void> {
  const r = await runBackup(reposStub, "staff-305", "T305 Tester");
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("backup failed");
  const rr = await restore(reposStub, r.value.id, "staff-305", "T305 Tester");
  expect(rr.ok).toBe(true);
}

/** The online service over the SAME persisted queue (the reconnect drain). */
async function reconnectAndDrain(): Promise<SyncService> {
  _resetSyncServiceForTests();
  const online = initialiseSyncService({
    ...offlineServiceOptions(),
    onlineDetector: makeStubDetector(true),
  } as unknown as ConstructorParameters<typeof SyncService>[0]);
  await online.start();
  return online;
}

/* ------------------------------------------------------------------ */
/*  1. The arming itself                                               */
/* ------------------------------------------------------------------ */

describe("T-305 — the staging producer arms the conflict guard", () => {
  it("an offline EDIT enqueues its update WITH the pre-edit row as basePayload", async () => {
    await armOfflineMode();

    const target = store.parents[0];
    const preEdit = { ...target };
    store.parents[0] = { ...target, firstName: "Edited While Offline" } as typeof store.parents[number];
    store.notifyParents();

    const queued = await service!.getStore().listAll();
    const updates = queued.filter((e) => e.entity === "parent" && e.operation === "update");
    expect(updates).toHaveLength(1);
    // THE ARMING: the base payload is the pre-edit row snapshot — the exact
    // 3-way BASE the guard needs, at field level.
    expect(updates[0].basePayload).not.toBeNull();
    expect(updates[0].basePayload!.firstName).toBe(preEdit.firstName);
    expect(updates[0].payload.firstName).toBe("Edited While Offline");
    expect(updates[0].conflict).toBeNull();
  });

  it("insert and delete entries NEVER carry a basePayload", async () => {
    await armOfflineMode();

    store.parents.push({
      ...store.parents[0],
      id: "par-armed-insert-001",
      firstName: "Armed Insert",
    } as typeof store.parents[number]);
    store.notifyParents();

    const victim = store.students[0];
    store.students = store.students.filter((s) => s.id !== victim.id);
    store.notifyStudents();

    const queued = await service!.getStore().listAll();
    const inserts = queued.filter((e) => e.operation === "insert");
    const deletes = queued.filter((e) => e.operation === "delete");
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(deletes).toHaveLength(1);
    for (const e of [...inserts, ...deletes]) {
      expect(e.basePayload).toBeNull();
    }
  });

  it("consecutive edits produce one entry each with its OWN base", async () => {
    await armOfflineMode();

    const target = store.parents[0];
    const stateA = { ...target };
    store.parents[0] = { ...target, firstName: "Edit One" } as typeof store.parents[number];
    store.notifyParents();

    const stateB = { ...store.parents[0] };
    store.parents[0] = { ...store.parents[0], lastName: "Edit Two" } as typeof store.parents[number];
    store.notifyParents();

    const queued = await service!.getStore().listAll();
    const updates = queued.filter((e) => e.entity === "parent" && e.operation === "update");
    expect(updates).toHaveLength(2);
    // Identify by CONTENT (both entries share the same millisecond
    // queuedAt — the store's list order is not guaranteed).
    const editOne = updates.find((e) => e.payload.firstName === "Edit One" && e.payload.lastName !== "Edit Two");
    const editTwo = updates.find((e) => e.payload.lastName === "Edit Two");
    expect(editOne).toBeDefined();
    expect(editTwo).toBeDefined();
    // First edit: base = A, local changed firstName.
    expect(editOne!.basePayload!.firstName).toBe(stateA.firstName);
    // Second edit: base = B (post-first-edit), local changed lastName.
    expect(editTwo!.basePayload!.firstName).toBe(stateB.firstName);
    expect(editTwo!.basePayload!.lastName).toBe(stateB.lastName);
    expect(editTwo!.payload.lastName).toBe("Edit Two");
  });
});

/* ------------------------------------------------------------------ */
/*  2. The guard actually fires on armed production traffic            */
/* ------------------------------------------------------------------ */

describe("T-305 — the armed guard fires (no silent overwrite)", () => {
  it("a diverging server row parks the armed update in conflict — push NEVER called", async () => {
    await armOfflineMode();

    const target = store.parents[0];
    const code = (target as unknown as { code?: string }).code;
    expect(code).toBeTruthy();
    store.parents[0] = { ...target, firstName: "Local Edit" } as typeof store.parents[number];
    store.notifyParents();

    // The server row moved while this device was offline — SAME field.
    serverRows.set(code!, {
      ...(store.parents[0] as unknown as Record<string, unknown>),
      firstName: "Server Edit",
    });

    const online = await reconnectAndDrain();
    const result = await online.syncNow();

    // The armed entry PARKED — nothing was pushed for it.
    expect(result.pushed).toBe(0);
    expect(pushCalls.filter((e) => e.entity === "parent")).toHaveLength(0);
    const conflicts = await online.listConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].entity).toBe("parent");
    expect(conflicts[0].conflict).not.toBeNull();
    expect(conflicts[0].conflict!.conflictPaths).toContain("firstName");
    // The remote payload rides the record (the resolver's User-B side).
    expect(conflicts[0].conflict!.remotePayload.firstName).toBe("Server Edit");
  });

  it("an armed update with NO divergence pushes normally on reconnect", async () => {
    await armOfflineMode();

    const target = store.parents[0];
    const code = (target as unknown as { code?: string }).code;
    // The server row equals the base (nobody else touched it).
    serverRows.set(code!, { ...(target as unknown as Record<string, unknown>) });
    // NOTE: the staged payload (post-edit) diverges from base ONLY on the
    // local side — one-side change auto-merges, no conflict.
    store.parents[0] = { ...target, firstName: "Only Local Changed" } as typeof store.parents[number];
    store.notifyParents();

    const online = await reconnectAndDrain();
    const result = await online.syncNow();

    expect(result.pushed).toBeGreaterThanOrEqual(1);
    expect(pushCalls.some((e) => e.entity === "parent" && e.payload.firstName === "Only Local Changed")).toBe(true);
    expect(await online.listConflicts()).toHaveLength(0);
  });
});
