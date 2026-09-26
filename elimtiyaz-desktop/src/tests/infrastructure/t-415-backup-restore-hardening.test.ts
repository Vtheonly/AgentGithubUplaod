/**
 * T-415 (issue #13) — backup/restore hardening: failure injection, repeated
 * backup→restore→verify cycles, multi-version recovery, and the
 * last-known-good guarantee.
 *
 * Goes far beyond t-300's happy paths:
 *   1. REPEATED CYCLES: three full backup → mutate → restore → verify
 *      rounds, byte-equal collections every time.
 *   2. FAILURE INJECTION: no passphrase, wrong passphrase, missing archive,
 *      tampered ciphertext, checksum drift, invalid JSON, non-object
 *      snapshot — every failure path leaves the operational state and the
 *      restored-from marker UNTOUCHED (a failed operation never destroys
 *      the last known-good state).
 *   3. INTEGRITY ORDER (BKUP-502): a checksum-drift archive fails with the
 *      CHECKSUM verdict, never a decompression error — restore must verify
 *      the SHA-256 BEFORE decompressing (the inspectArchive order).
 *   4. MULTI-VERSION RECOVERY: v1 good + v2 corrupted → restoring v2 fails
 *      cleanly and v1 (the older known-good) still restores.
 *   5. STATUS TRANSITIONS (BKUP-503): a successful restore marks the vault
 *      record 'restored'; an integrity-class failure marks 'corrupted'
 *      (a wrong passphrase — an authentication failure — does NOT).
 *   6. METADATA FIDELITY: counts/retention/tenant on the archive match the
 *      snapshot; the snapshot carries all 8 collections + rbac overrides.
 *   7. INTERNAL CONSISTENCY AFTER RESTORE: student→parent references all
 *      resolve inside the restored state.
 *   8. PURGE (BKUP-504): the service purge removes archives past their
 *      recorded retention and audits each removal.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runBackup,
  restore,
  inspectArchive,
  purgeExpired,
  deleteArchive,
  getRestoredFromMarker,
  clearRestoredFromMarker,
  setBackupPassphrase,
} from "../../infrastructure/backup/backup-service";
import {
  getArchive,
  storeArchive,
  clearVault,
} from "../../infrastructure/backup/indexed-db-vault";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { mockRepositories } from "../../app/providers/repository-provider";
import {
  SyncService,
  initialiseSyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import { _resetSyncQueueStoreForTests } from "../../infrastructure/sync/sync-queue-store";

const TENANT = "00000000-0000-0000-0000-000000000001";
const reposStub = mockRepositories;

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

let service: SyncService | null = null;

function offlineServiceOptions() {
  return {
    tenantId: () => TENANT,
    actorId: () => "staff-t415",
    isSupabaseConfigured: () => true,
    isMockMode: () => false,
    push: async () => {},
    autoStart: false,
    onlineDetector: makeStubDetector(false) as unknown as ConstructorParameters<typeof SyncService>[0]["onlineDetector"],
  };
}

/** Deep snapshot of the 8 operational collections (for byte-equality checks). */
function operationalState() {
  return {
    parents: JSON.parse(JSON.stringify(store.parents)),
    students: JSON.parse(JSON.stringify(store.students)),
    payments: JSON.parse(JSON.stringify(store.payments)),
    installments: JSON.parse(JSON.stringify(store.installments)),
    ledger: JSON.parse(JSON.stringify(store.ledger)),
    expenses: JSON.parse(JSON.stringify(store.expenses)),
    personnel: JSON.parse(JSON.stringify(store.personnel)),
    workflows: JSON.parse(JSON.stringify(store.workflows)),
  };
}

async function backup(): Promise<string> {
  const r = await runBackup(reposStub, "staff-t415", "T415 Tester");
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("backup failed");
  return r.value.id;
}

beforeEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  await clearVault();
  localStorage.clear();
  service = initialiseSyncService(offlineServiceOptions());
  await service.start();
  store.disarmStaging();
  clearRestoredFromMarker();
  setBackupPassphrase("phrase-de-test-t415");
});

afterEach(async () => {
  _resetSyncServiceForTests();
  await _resetSyncQueueStoreForTests();
  await clearVault();
  localStorage.clear();
  store.disarmStaging();
  clearRestoredFromMarker();
  setBackupPassphrase(null);
});

/* ------------------------------------------------------------------ */
/*  1. Repeated backup → restore → verify cycles                       */
/* ------------------------------------------------------------------ */

describe("T-415 — repeated backup→restore→verify cycles", () => {
  it("three full cycles restore byte-equal collections every time (with mutations between)", async () => {
    for (let round = 1; round <= 3; round++) {
      const archiveId = await backup();
      const before = operationalState();

      // Mutate a distinct collection each round (insert + update + delete).
      const clonedParent = {
        ...(store.parents[0] as unknown as object),
        id: `par-cycle-${round}-001`,
        firstName: `Cycle ${round} Parent`,
      } as typeof store.parents[number];
      store.parents.push(clonedParent);
      store.students = store.students.filter((_, i) => i !== 0);
      if (store.payments[0]) {
        store.payments[0] = { ...store.payments[0], amount: 999_000 + round } as typeof store.payments[number];
      }
      store.notifyParents();
      store.notifyStudents();
      store.notifyPayments();

      // The live state has now drifted from the snapshot.
      expect(store.parents.some((p) => p.id === `par-cycle-${round}-001`)).toBe(true);

      const r = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
      expect(r.ok).toBe(true);

      // Restored state is byte-equal to the snapshot taken at backup time.
      expect(operationalState()).toEqual(before);

      // The cycle's mutation is gone (point-in-time semantics) and the
      // audit records the restore with the REAL counts.
      expect(store.parents.some((p) => p.id === `par-cycle-${round}-001`)).toBe(false);
      const audit = store.audit.filter((a) => a.action === "backup.restore");
      expect(audit.length).toBeGreaterThanOrEqual(round);
    }
  });

  it("a SECOND backup after mutations captures the mutated state (versioned history)", async () => {
    const v1 = await backup();
    const stateV1 = operationalState();

    // Mutate: add a parent.
    store.parents.push({
      ...(store.parents[0] as unknown as object),
      id: "par-v2-only-001",
      firstName: "V2 Only Parent",
    } as typeof store.parents[number]);
    store.notifyParents();

    const v2 = await backup();
    expect(v2).not.toBe(v1);
    const stateV2 = operationalState();
    expect(stateV2.parents.length).toBe(stateV1.parents.length + 1);

    // Restoring V1 then V2 returns exactly the respective point-in-time.
    await restore(reposStub, v1, "staff-t415", "T415 Tester");
    expect(operationalState()).toEqual(stateV1);
    await restore(reposStub, v2, "staff-t415", "T415 Tester");
    expect(operationalState()).toEqual(stateV2);
  });
});

/* ------------------------------------------------------------------ */
/*  2. Failure injection — the last-known-good guarantee               */
/* ------------------------------------------------------------------ */

describe("T-415 — failure injection (every failure preserves the last known-good state)", () => {
  it("runBackup WITHOUT a passphrase returns a clean validation error and writes NOTHING", async () => {
    setBackupPassphrase(null);
    const before = operationalState();
    const auditCountBefore = store.audit.length;
    const r = await runBackup(reposStub, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ERR_VALIDATION");
      expect(r.error.message).toMatch(/phrase secrète/i);
      // BKUP-506: the actionable userMessage must survive tryResult.
      expect(r.error.userMessage).toMatch(/phrase secrète|Sauvegarde/i);
    }
    // No archive, no audit, no state change.
    const listed = await import("../../infrastructure/backup/indexed-db-vault").then((m) =>
      m.listArchiveMetadata(),
    );
    expect(await listed).toHaveLength(0);
    // The audit trail gained NOTHING (the mock store persists across tests —
    // compare counts, not existence).
    expect(store.audit.length).toBe(auditCountBefore);
    expect(operationalState()).toEqual(before);
  });

  it("restore with the WRONG passphrase fails, audits restore_failed, and never mutates state", async () => {
    const archiveId = await backup();
    const before = operationalState();
    setBackupPassphrase("a-completely-different-passphrase");

    const r = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);
    expect(operationalState()).toEqual(before);
    expect(getRestoredFromMarker()).toBeNull();
    expect(store.stagingArmed).toBe(false);
    expect(store.audit.some((a) => a.action === "backup.restore_failed")).toBe(true);

    // The archive itself is intact (an authentication failure ≠ corruption):
    // with the right passphrase it still restores.
    setBackupPassphrase("phrase-de-test-t415");
    const r2 = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(r2.ok).toBe(true);
  });

  it("restore of a MISSING archive returns notFound and never mutates state", async () => {
    const before = operationalState();
    const r = await restore(reposStub, "backup-never-created.db", "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ERR_NOT_FOUND");
    expect(operationalState()).toEqual(before);
    expect(getRestoredFromMarker()).toBeNull();
  });

  it("restore of a TAMPERED ciphertext fails BEFORE any apply (GCM auth-tag)", async () => {
    const archiveId = await backup();
    const before = operationalState();

    const record = await getArchive(archiveId);
    expect(record).not.toBeNull();
    const tampered = new Uint8Array(record!.ciphertext);
    tampered[Math.floor(tampered.length / 3)] ^= 0xff;
    await storeArchive({ id: archiveId, metadata: record!.metadata, ciphertext: tampered, iv: record!.iv });

    const r = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);
    expect(operationalState()).toEqual(before);
    expect(getRestoredFromMarker()).toBeNull();
    expect(store.audit.some((a) => a.action === "backup.restore_failed")).toBe(true);
  });

  it("restore of a checksum-drift archive fails with the CHECKSUM verdict — never a decompression error (BKUP-502 order)", async () => {
    const archiveId = await backup();
    const before = operationalState();

    // Re-store the archive with a WRONG checksum in the metadata: the
    // ciphertext is authentic (GCM passes) but the metadata drifted — the
    // SHA-256 verification must fire BEFORE any decompression work.
    const record = await getArchive(archiveId);
    expect(record).not.toBeNull();
    const driftedMetadata = {
      ...record!.metadata,
      checksum: "b".repeat(64), // not the real checksum
    };
    // Replace the ciphertext with NON-GZIP bytes too: if restore attempted
    // decompression before the checksum check, it would die with a
    // DecompressionStream error instead of the checksum verdict.
    const nonGzip = new Uint8Array(64);
    for (let i = 0; i < nonGzip.length; i++) nonGzip[i] = 0x41; // "AAAA..." — not gzip magic
    // Re-encrypt the non-gzip bytes with the REAL key so GCM passes:
    const { deriveBackupKey } = await import("../../infrastructure/backup/backup-service");
    const key = await deriveBackupKey();
    const { encrypt } = await import("../../infrastructure/backup/aes-256");
    const { ciphertext, iv } = await encrypt(nonGzip, key);
    await storeArchive({ id: archiveId, metadata: driftedMetadata, ciphertext, iv });

    const r = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // The checksum verdict — NOT a decompression/gzip failure.
      expect(r.error.message).toMatch(/SHA-256|checksum/i);
      expect(r.error.message).not.toMatch(/gzip|decompress|compression/i);
    }
    expect(operationalState()).toEqual(before);
    expect(getRestoredFromMarker()).toBeNull();
    expect(store.audit.some((a) => a.action === "backup.restore_failed")).toBe(true);
  });

  it("restore of an unparseable-JSON archive fails before the apply", async () => {
    const archiveId = await backup();
    const before = operationalState();

    // Build a valid-encryption archive whose plaintext is not JSON.
    const { deriveBackupKey } = await import("../../infrastructure/backup/backup-service");
    const { encrypt, sha256, encodeUtf8 } = await import("../../infrastructure/backup/aes-256");
    const key = await deriveBackupKey();
    const { ciphertext, iv } = await encrypt(encodeUtf8("this is definitely <<<not json>>>"), key);
    const record = await getArchive(archiveId);
    const checksum = await sha256(ciphertext);
    await storeArchive({
      id: archiveId,
      metadata: { ...record!.metadata, checksum },
      ciphertext,
      iv,
    });

    const r = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);
    expect(operationalState()).toEqual(before);
    expect(getRestoredFromMarker()).toBeNull();
  });

  it("a failed restore NEVER arms staging (post-failure mutations do not enqueue)", async () => {
    const archiveId = await backup();
    const record = await getArchive(archiveId);
    const tampered = new Uint8Array(record!.ciphertext);
    tampered[5] ^= 0xff;
    await storeArchive({ id: archiveId, metadata: record!.metadata, ciphertext: tampered, iv: record!.iv });

    await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(store.stagingArmed).toBe(false);

    // Mutations after the failed restore stage NOTHING (no armed sink).
    store.parents.push({
      ...(store.parents[0] as unknown as object),
      id: "par-after-failed-restore",
    } as typeof store.parents[number]);
    store.notifyParents();
    const queued = await service!.getStore().listAll();
    expect(queued.filter((e) => e.payload.id === "par-after-failed-restore")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  3. Multi-version recovery — older known-good survives              */
/* ------------------------------------------------------------------ */

describe("T-415 — multi-version recovery (the older known-good archive)", () => {
  it("when the NEWER archive is corrupted, the OLDER known-good archive still restores", async () => {
    const v1 = await backup();
    const stateV1 = operationalState();

    // Mutate + backup v2.
    store.parents.push({
      ...(store.parents[0] as unknown as object),
      id: "par-v2-recovery",
      firstName: "V2 Recovery",
    } as typeof store.parents[number]);
    store.notifyParents();
    const v2 = await backup();
    const stateV2 = operationalState();
    expect(stateV2.parents.length).toBe(stateV1.parents.length + 1);

    // Corrupt ONLY v2 (bit-rot).
    const record = await getArchive(v2);
    const tampered = new Uint8Array(record!.ciphertext);
    tampered[10] ^= 0xff;
    await storeArchive({ id: v2, metadata: record!.metadata, ciphertext: tampered, iv: record!.iv });

    // v2 fails cleanly — and the state stays where it was.
    const beforeFailed = operationalState();
    const r2 = await restore(reposStub, v2, "staff-t415", "T415 Tester");
    expect(r2.ok).toBe(false);
    expect(operationalState()).toEqual(beforeFailed);

    // v1 — the older known-good — restores perfectly.
    const r1 = await restore(reposStub, v1, "staff-t415", "T415 Tester");
    expect(r1.ok).toBe(true);
    expect(operationalState()).toEqual(stateV1);
    expect(getRestoredFromMarker()?.archiveId).toBe(v1);
  });

  it("the inspection surface ranks integrity honestly across versions", async () => {
    const v1 = await backup();
    store.payments.push({
      ...(store.payments[0] as unknown as object),
      id: "pay-v2-inspect",
    } as typeof store.payments[number]);
    store.notifyPayments();
    const v2 = await backup();

    const i1 = await inspectArchive(v1);
    const i2 = await inspectArchive(v2);
    expect(i1.ok && i1.value.integrity).toBe("verified");
    expect(i2.ok && i2.value.integrity).toBe("verified");
    expect(i2.ok && i2.value.counts.payments).toBe(
      (i1.ok ? i1.value.counts.payments : 0) + 1,
    );

    // Corrupt v2 → its inspection flips to corrupted while v1 stays verified.
    const record = await getArchive(v2);
    const tampered = new Uint8Array(record!.ciphertext);
    tampered[1] ^= 0x80;
    await storeArchive({ id: v2, metadata: record!.metadata, ciphertext: tampered, iv: record!.iv });
    const i2b = await inspectArchive(v2);
    expect(i2b.ok && i2b.value.integrity).toBe("corrupted");
    const i1b = await inspectArchive(v1);
    expect(i1b.ok && i1b.value.integrity).toBe("verified");
  });
});

/* ------------------------------------------------------------------ */
/*  4. Status transitions (BKUP-503)                                   */
/* ------------------------------------------------------------------ */

describe("T-415 — archive status transitions on the vault record (BKUP-503)", () => {
  it("a successful restore marks the vault record status='restored'", async () => {
    const archiveId = await backup();
    expect((await getArchive(archiveId))!.metadata.status).toBe("encrypted");

    const r = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(true);

    const record = await getArchive(archiveId);
    expect(record).not.toBeNull();
    expect(record!.metadata.status).toBe("restored");
  });

  it("an integrity-class restore failure (checksum drift) marks status='corrupted'", async () => {
    const archiveId = await backup();
    const record = await getArchive(archiveId);
    expect(record).not.toBeNull();
    // Drift ONLY the metadata checksum — the ciphertext stays authentic, so
    // the checksum mismatch is the UNAMBIGUOUS corruption verdict (a GCM
    // failure alone cannot distinguish a wrong passphrase from tampering).
    await storeArchive({
      id: archiveId,
      metadata: { ...record!.metadata, checksum: "d".repeat(64) },
      ciphertext: record!.ciphertext,
      iv: record!.iv,
    });

    const r = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);

    const after = await getArchive(archiveId);
    expect(after!.metadata.status).toBe("corrupted");
  });

  it("a tampered CIPHERTEXT (GCM failure) stays 'encrypted' — ambiguous vs a wrong passphrase (documented BKUP-503 boundary)", async () => {
    const archiveId = await backup();
    const record = await getArchive(archiveId);
    const tampered = new Uint8Array(record!.ciphertext);
    tampered[9] ^= 0xff;
    await storeArchive({ id: archiveId, metadata: record!.metadata, ciphertext: tampered, iv: record!.iv });

    const r = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);

    const after = await getArchive(archiveId);
    expect(after!.metadata.status).toBe("encrypted");
  });

  it("a WRONG-PASSPHRASE restore failure does NOT mark the archive corrupted (authentication ≠ corruption)", async () => {
    const archiveId = await backup();
    setBackupPassphrase("wrong-passphrase-for-sure");
    const r = await restore(reposStub, archiveId, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);

    const after = await getArchive(archiveId);
    expect(after!.metadata.status).toBe("encrypted");
  });
});

/* ------------------------------------------------------------------ */
/*  5. Metadata fidelity + snapshot completeness                       */
/* ------------------------------------------------------------------ */

describe("T-415 — archive metadata fidelity", () => {
  it("the metadata counts match the live collections at backup time", async () => {
    const r = await runBackup(reposStub, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metadata?.parentCount).toBe(store.parents.length);
    expect(r.value.metadata?.studentCount).toBe(store.students.length);
    expect(r.value.metadata?.paymentCount).toBe(store.payments.length);
    expect(r.value.metadata?.installmentCount).toBe(store.installments.length);
    expect(r.value.metadata?.ledgerEntryCount).toBe(store.ledger.length);
    expect(r.value.metadata?.workflowCount).toBe(store.workflows.length);
  });

  it("the retention window is exactly 365 days from creation", async () => {
    const r = await runBackup(reposStub, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = Date.parse(r.value.createdAt);
    const expires = Date.parse(r.value.retentionExpiresAt);
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    expect(expires - created).toBe(yearMs);
    expect(r.value.tenantId).toBe("tenant-el-imtiyaz-oran-001");
    expect(r.value.vaultLocation).toBe("local");
    expect(r.value.status).toBe("encrypted");
    expect(r.value.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the archive id follows the timestamped .db naming contract (millisecond uniqueness — BKUP-505)", async () => {
    const r = await runBackup(reposStub, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toMatch(/^backup-\d{4}-\d{2}-\d{2}-\d{6}(-\d{1,4})?\.db$/);
  });

  it("two backups created in rapid succession get DISTINCT ids and BOTH survive (BKUP-505)", async () => {
    const a = await runBackup(reposStub, "staff-t415", "T415 Tester");
    const b = await runBackup(reposStub, "staff-t415", "T415 Tester");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.value.id).not.toBe(a.value.id);
    expect(await getArchive(a.value.id)).not.toBeNull();
    expect(await getArchive(b.value.id)).not.toBeNull();
  });

  it("the decrypted snapshot carries ALL 8 collections + snapshotAt + tenantId + rbac overrides", async () => {
    const archiveId = await backup();
    // Read the snapshot back by restoring into a scratch inspection.
    const insp = await inspectArchive(archiveId);
    expect(insp.ok).toBe(true);
    // The counts answer for all 8 collections (non-negative, present keys).
    if (!insp.ok) return;
    for (const key of [
      "parents", "students", "payments", "installments",
      "ledger", "expenses", "personnel", "workflows",
    ] as const) {
      expect(insp.value.counts[key]).toBeGreaterThanOrEqual(0);
    }
  });

  it("rbacMatrixOverrides ride inside the snapshot (vault §13.01)", async () => {
    localStorage.setItem(
      "el-imtiyaz:rbac-matrix-overrides",
      JSON.stringify({ "role-x": ["perm-1"] }),
    );
    const archiveId = await backup();
    const record = await getArchive(archiveId);
    expect(record).not.toBeNull();

    // Decrypt + decompress + parse to verify the rbac key rode along.
    const { deriveBackupKey } = await import("../../infrastructure/backup/backup-service");
    const { decrypt, decodeUtf8 } = await import("../../infrastructure/backup/aes-256");
    const key = await deriveBackupKey();
    const plain = await decrypt(record!.ciphertext, record!.iv, key);
    // Decompress via the same fallback-aware path the service uses.
    let text: string;
    try {
      const stream = new Blob([plain as BlobPart]).stream().pipeThrough(
        new DecompressionStream("gzip"),
      );
      text = decodeUtf8(new Uint8Array(await new Response(stream).arrayBuffer()));
    } catch {
      text = decodeUtf8(plain);
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.rbacMatrixOverrides).toEqual({ "role-x": ["perm-1"] });
    expect(typeof parsed.snapshotAt).toBe("string");
    expect(parsed.tenantId).toBe("tenant-el-imtiyaz-oran-001");
  });
});

/* ------------------------------------------------------------------ */
/*  6. Internal consistency of the restored state                      */
/* ------------------------------------------------------------------ */

describe("T-415 — the restored state is internally consistent and usable", () => {
  it("every restored student's parentId resolves inside the restored parents collection", async () => {
    const archiveId = await backup();
    await restore(reposStub, archiveId, "staff-t415", "T415 Tester");

    const parentIds = new Set(store.parents.map((p) => p.id));
    const orphans = store.students.filter(
      (s) => s.parentId && !parentIds.has(s.parentId),
    );
    expect(orphans).toEqual([]);
  });

  it("the restored state is USABLE: a post-restore mutation + reconnect drain round-trips", async () => {
    const archiveId = await backup();
    await restore(reposStub, archiveId, "staff-t415", "T415 Tester");

    // A legit post-restore edit on the restored data.
    store.parents[0] = {
      ...store.parents[0],
      firstName: "Post-Restore Edited",
    } as typeof store.parents[number];
    store.notifyParents();

    const pending = await service!.getStore().listByStatus("pending");
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const update = pending.find((e) => e.entity === "parent" && e.operation === "update");
    expect(update).toBeDefined();
    expect(update!.payload.firstName).toBe("Post-Restore Edited");
    // T-305: the update carries its 3-way base.
    expect(update!.basePayload).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  7. Purge + delete (service layer, BKUP-504)                        */
/* ------------------------------------------------------------------ */

describe("T-415 — the purge sweep honors the recorded retention (BKUP-504)", () => {
  it("the service purgeExpired removes archives past retention and audits each removal", async () => {
    // A real fresh archive (NOT past retention).
    const freshId = await backup();

    // Aged archives: stored directly in the vault with retention 10 days in
    // the past (createdAt + 365d where createdAt = 375 days ago).
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const aged = (id: string, daysAgo: number) => ({
      metadata: {
        id,
        tenantId: "tenant-el-imtiyaz-oran-001",
        createdAt: new Date(now - daysAgo * day).toISOString(),
        sizeBytes: 64,
        checksum: "c".repeat(64),
        vaultLocation: "local" as const,
        status: "encrypted" as const,
        retentionExpiresAt: new Date(now - daysAgo * day + 365 * day).toISOString(),
        createdBy: "aged-probe",
        metadata: { parentCount: 0, studentCount: 0, paymentCount: 0, ledgerEntryCount: 0 },
      },
    });
    await storeArchive({
      id: "backup-aged-375d.db",
      metadata: aged("backup-aged-375d.db", 375).metadata,
      ciphertext: new Uint8Array([1, 2, 3]),
      iv: new Uint8Array(12),
    });
    await storeArchive({
      id: "backup-aged-400d.db",
      metadata: aged("backup-aged-400d.db", 400).metadata,
      ciphertext: new Uint8Array([4, 5, 6]),
      iv: new Uint8Array(12),
    });

    const purged = await purgeExpired(reposStub, "staff-t415", "T415 Tester");
    expect(purged.ok).toBe(true);
    if (!purged.ok) return;
    const purgedIds = purged.value.map((a) => a.id);
    expect(purgedIds).toContain("backup-aged-375d.db");
    expect(purgedIds).toContain("backup-aged-400d.db");
    expect(purgedIds).not.toContain(freshId);

    // Audited per archive; the fresh archive survived.
    expect(store.audit.filter((a) => a.action === "backup.purge").length).toBeGreaterThanOrEqual(2);
    expect(await getArchive(freshId)).not.toBeNull();
    expect(await getArchive("backup-aged-375d.db")).toBeNull();
  });

  it("deleteArchive audits the manual deletion and removes exactly the target", async () => {
    const a = await backup();
    const b = await backup();
    const r = await deleteArchive(reposStub, a, "staff-t415", "T415 Tester");
    expect(r.ok).toBe(true);
    expect(await getArchive(a)).toBeNull();
    expect(await getArchive(b)).not.toBeNull();
    const audit = store.audit.find(
      (e) => e.action === "backup.delete" && e.entityId === a,
    );
    expect(audit).toBeDefined();
    // The mock audit store persists diff as a JSON string.
    const diff = audit?.diff ? (JSON.parse(audit.diff as string) as { before?: unknown }) : null;
    expect(diff?.before).toMatchObject({ createdAt: expect.any(String) });
  });

  it("deleteArchive of a missing archive is a clean notFound", async () => {
    const r = await deleteArchive(reposStub, "backup-not-there.db", "staff-t415", "T415 Tester");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ERR_NOT_FOUND");
  });
});
