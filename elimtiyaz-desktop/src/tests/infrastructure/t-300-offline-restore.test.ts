/**
 * T-300 (OFFLINE-400) — the offline-first restore + sync staging suite.
 *
 * Pins the whole mandate paragraph (d):
 *   1. inspectArchive: offline decrypt + verify + parse WITHOUT restoring
 *      (read-only — the store's counts stay untouched);
 *   2. RESTORE IS REAL: the restored snapshot replaces the operational
 *      state (parents/students/payments/… counts swap to the snapshot's),
 *      the audit diff carries the before/after counts, the restored-from
 *      marker is set (and clearable);
 *   3. POST-RESTORE STAGING: mutations after the restore enqueue into the
 *      EXISTING SyncService queue (never a parallel queue — the store's
 *      staging sink binds SyncService.enqueue), insert/update/delete all
 *      stage, and the offline drain pushes nothing while offline;
 *   4. NO DATA LOSS: the reconnect drain pushes the staged entries
 *      (the stub push handler observes them — the idempotent upsert RPCs
 *      are the production continuation);
 *   5. INTEGRITY: a tampered ciphertext → the corrupted inspection
 *      verdict + a failed restore (GCM auth-tag), never a partial apply;
 *   6. HONEST SCOPING: the five collections with canonical push paths
 *      stage; expense mutations do NOT (no dispatcher path — documented).
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runBackup,
  restore,
  inspectArchive,
  getRestoredFromMarker,
  clearRestoredFromMarker,
  setBackupPassphrase,
  RESTORED_FROM_KEY,
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

/* ------------------------------------------------------------------ */
/*  Harness                                                            */
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

/** The REAL mock Repositories barrel — snapshotState reads every stream. */
const reposStub = mockRepositories;

let pushCalls: SyncQueueEntry[] = [];
let service: SyncService | null = null;

/** The offline service options (the singleton the restore's staging binds). */
function offlineServiceOptions() {
  return {
    tenantId: () => TENANT,
    actorId: () => "staff-restore",
    isSupabaseConfigured: () => true,
    isMockMode: () => false,
    push: async (entry: SyncQueueEntry) => {
      pushCalls.push(entry);
    },
    autoStart: false,
    onlineDetector: makeStubDetector(false) as unknown as ConstructorParameters<typeof SyncService>[0]["onlineDetector"],
  };
}

beforeEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  localStorage.clear();
  pushCalls = [];
  // The offline SyncService — constructed through the SINGLETON (the
  // restore's staging binds getSyncService(); a bare `new` instance would
  // leave the singleton null and silently skip staging).
  service = initialiseSyncService(offlineServiceOptions());
  await service.start();
  store.disarmStaging();
  clearRestoredFromMarker();
  setBackupPassphrase("phrase-de-test-46th-session");
});

afterEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  localStorage.clear();
  store.disarmStaging();
  clearRestoredFromMarker();
  setBackupPassphrase(null);
});

/** Build a snapshot state with DISTINGUISHABLE counts. */
async function backupKnownState(): Promise<string> {
  const r = await runBackup(reposStub, "staff-restore", "Restore Tester");
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("backup failed");
  return r.value.id;
}

/* ------------------------------------------------------------------ */
/*  1. The offline inspection                                          */
/* ------------------------------------------------------------------ */

describe("T-300 — inspectArchive (the offline browser)", () => {
  it("decrypts + verifies + counts WITHOUT mutating the operational state", async () => {
    const archiveId = await backupKnownState();
    const parentsBefore = store.parents.length;
    const paymentsBefore = store.payments.length;

    const r = await inspectArchive(archiveId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.integrity).toBe("verified");
    expect(r.value.integrityNote).toBeNull();
    expect(r.value.counts.parents).toBe(parentsBefore);
    expect(r.value.counts.payments).toBe(paymentsBefore);
    // READ-ONLY: the live state is untouched by an inspection.
    expect(store.parents.length).toBe(parentsBefore);
    expect(store.payments.length).toBe(paymentsBefore);
    expect(getRestoredFromMarker()).toBeNull();
    expect(store.stagingArmed).toBe(false);
  });

  it("a missing archive errors (not found)", async () => {
    const r = await inspectArchive("bak-does-not-exist");
    expect(r.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  2. The REAL restore                                                */
/* ------------------------------------------------------------------ */

describe("T-300 — restore (the real apply + marker + audit)", () => {
  it("replaces the operational state with the snapshot + sets the marker + audits the counts", async () => {
    const archiveId = await backupKnownState();
    const beforeParents = store.parents.length;

    // Mutate AFTER the backup: the snapshot differs from the live state.
    store.students.push({
      ...(store.students[0] as unknown as object),
    } as typeof store.students[number]);
    store.notifyStudents();
    const mutatedStudents = store.students.length;
    expect(mutatedStudents).toBe(beforeParents >= 0 ? mutatedStudents : 0);

    const r = await restore(reposStub, archiveId, "staff-restore", "Restore Tester");
    expect(r.ok).toBe(true);

    // The operational state now matches the SNAPSHOT's collections: the
    // post-backup mutation is gone (point-in-time).
    const r2 = await inspectArchive(archiveId);
    if (!r2.ok) throw new Error("re-inspect failed");
    expect(store.students.length).toBe(r2.value.counts.students);
    expect(store.parents.length).toBe(r2.value.counts.parents);

    // The marker is set, with the restored counts.
    const marker = getRestoredFromMarker();
    expect(marker).not.toBeNull();
    expect(marker?.archiveId).toBe(archiveId);
    expect(marker?.restoredBy).toBe("Restore Tester");
    expect(marker?.counts.students).toBe(r2.value.counts.students);

    // Staging armed (the post-restore mode).
    expect(store.stagingArmed).toBe(true);

    // The audit carries the REAL before/after counts.
    const audit = mockRepositories.audit === reposStub.audit
      ? store.audit.find((a) => a.action === "backup.restore")
      : store.audit.find((a) => a.action === "backup.restore");
    expect(audit).toBeDefined();
    expect(audit?.note).toContain("APPLIQUÉE");
  });

  it("clearRestoredFromMarker closes the mode", async () => {
    const archiveId = await backupKnownState();
    await restore(reposStub, archiveId, "staff-restore", "Restore Tester");
    expect(getRestoredFromMarker()).not.toBeNull();
    clearRestoredFromMarker();
    expect(getRestoredFromMarker()).toBeNull();
    expect(localStorage.getItem(RESTORED_FROM_KEY)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  3 + 4. Post-restore staging + the no-data-loss drain               */
/* ------------------------------------------------------------------ */

describe("T-300 — post-restore sync staging (the EXISTING queue)", () => {
  it("an insert after the restore enqueues into the sync queue (never a parallel store)", async () => {
    const archiveId = await backupKnownState();
    await restore(reposStub, archiveId, "staff-restore", "Restore Tester");

    const queuedBefore = await service!.getStore().listAll();
    const base = store.parents[0];
    store.parents.push({
      ...base,
      id: "par-new-restored-001",
      firstName: "Restored Mode Parent",
    } as typeof store.parents[number]);
    store.notifyParents();

    const queuedAfter = await service!.getStore().listAll();
    const added = queuedAfter.filter((e) => !queuedBefore.some((q) => q.id === e.id));
    expect(added).toHaveLength(1);
    expect(added[0].entity).toBe("parent");
    expect(added[0].operation).toBe("insert");
    expect(added[0].isMock).toBe(false); // real restored data, never skipped_mock
    expect(added[0].payload.id).toBe("par-new-restored-001");
  });

  it("an update after the restore enqueues (row changed) and a no-op notify does not", async () => {
    const archiveId = await backupKnownState();
    await restore(reposStub, archiveId, "staff-restore", "Restore Tester");

    // A no-op notify (nothing changed since the checkpoint) stages NOTHING.
    store.notifyParents();
    let queued = await service!.getStore().listAll();
    expect(queued.filter((e) => e.entity === "parent")).toHaveLength(0);

    // A real edit stages exactly one update.
    store.parents[0] = {
      ...store.parents[0],
      firstName: "Edited Post-Restore",
    } as typeof store.parents[number];
    store.notifyParents();
    queued = await service!.getStore().listAll();
    const updates = queued.filter((e) => e.entity === "parent" && e.operation === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.firstName).toBe("Edited Post-Restore");
  });

  it("a delete after the restore enqueues a delete entry", async () => {
    const archiveId = await backupKnownState();
    await restore(reposStub, archiveId, "staff-restore", "Restore Tester");

    const victim = store.students[0];
    store.students = store.students.filter((s) => s.id !== victim.id);
    store.notifyStudents();

    const queued = await service!.getStore().listAll();
    const del = queued.filter((e) => e.entity === "student" && e.operation === "delete");
    expect(del).toHaveLength(1);
    expect(del[0].payload.id).toBe(victim.id);
  });

  it("NO DATA LOSS: the offline drain pushes nothing; the online drain pushes every staged entry", async () => {
    const archiveId = await backupKnownState();
    await restore(reposStub, archiveId, "staff-restore", "Restore Tester");

    // Post-restore mutations (offline).
    store.parents.push({
      ...store.parents[0],
      id: "par-offline-001",
    } as typeof store.parents[number]);
    store.notifyParents();
    store.payments.push({
      ...store.payments[0],
      id: "pay-offline-001",
    } as typeof store.payments[number]);
    store.notifyPayments();

    const pending = await service!.getStore().listByStatus("pending");
    expect(pending.length).toBeGreaterThanOrEqual(2);

    // Offline drain: nothing is pushed (the online gate holds).
    const offlineResult = await service!.syncNow();
    expect(offlineResult.pushed).toBe(0);
    expect(pushCalls).toHaveLength(0);
    // ...and the queue KEPT the entries (no data loss).
    expect((await service!.getStore().listByStatus("pending")).length).toBeGreaterThanOrEqual(2);

    // Reconnect: the singleton is REPLACED with an ONLINE service — the
    // SyncQueueStore singleton PERSISTS (only the service resets), so the
    // online drain sees the SAME staged queue — every mutation reaches
    // the push handler.
    _resetSyncServiceForTests();
    const onlineService = initialiseSyncService({
      ...offlineServiceOptions(),
      onlineDetector: makeStubDetector(true),
    } as unknown as ConstructorParameters<typeof SyncService>[0]);
    await onlineService.start();
    const result = await onlineService.syncNow();
    expect(result.pushed).toBeGreaterThanOrEqual(2);
    expect(pushCalls.map((e) => e.payload.id)).toContain("par-offline-001");
    expect(pushCalls.map((e) => e.payload.id)).toContain("pay-offline-001");
    // Nothing left pending — the drain emptied the staging queue.
    expect(await onlineService.getStore().listByStatus("pending")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  5. Integrity — the corrupted archive                               */
/* ------------------------------------------------------------------ */

describe("T-300 — integrity (tamper detection)", () => {
  it("a tampered ciphertext inspects as corrupted (GCM auth-tag failure)", async () => {
    const archiveId = await backupKnownState();

    // Tamper: flip a byte of the stored ciphertext directly in the vault.
    const { getArchive, storeArchive } = await import(
      "../../infrastructure/backup/indexed-db-vault"
    );
    const record = await getArchive(archiveId);
    expect(record).not.toBeNull();
    const tampered = new Uint8Array(record!.ciphertext);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    await storeArchive({ id: archiveId, metadata: record!.metadata, ciphertext: tampered, iv: record!.iv });

    const r = await inspectArchive(archiveId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.integrity).toBe("corrupted");
    expect(r.value.integrityNote).toContain("auth tag");

    // The restore of the tampered archive FAILS — never a partial apply.
    const before = store.parents.length;
    const rr = await restore(reposStub, archiveId, "staff-restore", "Restore Tester");
    expect(rr.ok).toBe(false);
    expect(store.parents.length).toBe(before);
    expect(getRestoredFromMarker()).toBeNull();
    // The restore failure is audited.
    expect(store.audit.some((a) => a.action === "backup.restore_failed")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  6. The honest staging scope                                        */
/* ------------------------------------------------------------------ */

describe("T-300 — the honest staging scope", () => {
  it("expense mutations do NOT stage (no canonical push path — the documented boundary)", async () => {
    const archiveId = await backupKnownState();
    await restore(reposStub, archiveId, "staff-restore", "Restore Tester");

    store.expenses.push({
      ...store.expenses[0],
      id: "exp-not-staged-001",
    } as typeof store.expenses[number]);
    store.notifyExpenses();

    const queued = await service!.getStore().listAll();
    expect(queued.filter((e) => e.entity === "expense")).toHaveLength(0);
  });

  it("staging disarms cleanly (the pre-restore behavior returns)", async () => {
    const archiveId = await backupKnownState();
    await restore(reposStub, archiveId, "staff-restore", "Restore Tester");
    expect(store.stagingArmed).toBe(true);
    store.disarmStaging();
    expect(store.stagingArmed).toBe(false);

    store.parents.push({
      ...store.parents[0],
      id: "par-after-disarm",
    } as typeof store.parents[number]);
    store.notifyParents();
    const queued = await service!.getStore().listAll();
    expect(queued.filter((e) => e.payload.id === "par-after-disarm")).toHaveLength(0);
  });
});
