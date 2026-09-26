/**
 * T-415 (BKUP-501) — the SupabaseBackupRepository contract tests.
 *
 * Pins the server-side metadata mirror (the migration-0013 pipeline the
 * desktop never wired):
 *   1. runBackup: the local vault archive is created AND a metadata row is
 *      mirrored into backup_archives (archive_id_text, tenant, checksum,
 *      vault_location='indexeddb', status='encrypted', retention, counts).
 *   2. observe(): reads the SERVER table — real rows, newest-first, NO
 *      fake demo seeds; the row maps to the domain shape (id =
 *      archive_id_text, indexeddb → local, …).
 *   3. restore: the server row transitions status='restored' with
 *      restored_at (+restored_by when the actor is a UUID).
 *   4. a checksum-class corruption: the server row transitions
 *      'corrupted' (the vault's verdict propagates).
 *   5. deleteArchive: the server row is REMOVED.
 *   6. purgeExpired: the server row is marked 'purged' (the 0022 RPC
 *      semantics — the row remains as recovery information).
 *   7. THE RELIABILITY GUARANTEE: a Supabase mirror FAILURE (or a missing
 *      tenant context) NEVER fails the local backup/restore — the vault is
 *      the authority, the mirror is best-effort.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseBackupRepository } from "../../infrastructure/supabase/repositories/supabase-backup-repository";
import { setBackupPassphrase } from "../../infrastructure/backup/backup-service";
import { getArchive, clearVault } from "../../infrastructure/backup/indexed-db-vault";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { mockRepositories } from "../../app/providers/repository-provider";

// ============================================================================
// The lazy getSupabaseRepositories() import inside the repository is mocked
// to the mock barrel — the snapshot then reads the mockStore streams (the
// same content the mock backup repository snapshots), keeping the vault-side
// assertions deterministic.
// ============================================================================
vi.mock("../../infrastructure/supabase/supabase-repositories", () => ({
  // Call-time lazy import: the factory itself must stay sync (an async
  // factory importing repository-provider deadlocks the circular chain —
  // the provider statically imports THIS mocked module). The barrel is
  // resolved on first getSupabaseRepositories() call, after every module
  // finished initializing.
  getSupabaseRepositories: async () => {
    const { mockRepositories } = await import("../../app/providers/repository-provider");
    return mockRepositories;
  },
}));

// ============================================================================
// Fake Supabase client — minimal PostgREST builder (t-099/t-145 convention)
// ============================================================================
type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private orderCol: string | null = null;

  constructor(
    private readonly table: Row[],
    private readonly failure: { message: string } | null,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => String(r[col]) === String(val));
    return this;
  }
  select(_cols?: string): this {
    return this;
  }
  insert(row: Row): this {
    this.mode = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row): this {
    this.mode = "update";
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.mode = "delete";
    return this;
  }
  private ascending = true;
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.ascending = opts?.ascending ?? true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { message: string } | null } {
    if (this.failure) return { data: null, error: this.failure };
    if (this.mode === "insert") {
      const row = { id: `row-${Math.random().toString(36).slice(2, 8)}`, ...this.payload };
      this.table.push(row);
      return { data: [row], error: null };
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.payload ?? {});
          patched.push(row);
        }
      }
      return { data: patched, error: null };
    }
    if (this.mode === "delete") {
      const doomed = this.table.filter((r) => this.filters.every((f) => f(r)));
      for (const row of doomed) {
        const idx = this.table.indexOf(row);
        if (idx >= 0) this.table.splice(idx, 1);
      }
      return { data: doomed, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[this.orderCol!]).localeCompare(String(b[this.orderCol!]));
        return this.ascending ? cmp : -cmp;
      });
    }
    return { data: rows, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onFulfilled?: ((value: { data: Row | Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.run()).then(onFulfilled ?? (undefined as never), onRejected ?? (undefined as never));
  }
}

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR_UUID = "00000000-0000-0000-0000-0000000000aa";

function makeClient(failure: { message: string } | null = null) {
  const backupTable: Row[] = [];
  const client = {
    from: (table: string) => {
      if (table !== "backup_archives") throw new Error(`unexpected table ${table}`);
      return new FakeQuery(backupTable, failure);
    },
  };
  return { client: client as unknown as SupabaseClient, backupTable };
}

function setSession(tenantId: string | null) {
  if (tenantId === null) localStorage.removeItem("el-imtiyaz.session");
  else localStorage.setItem("el-imtiyaz.session", JSON.stringify({ tenantId }));
}

beforeEach(async () => {
  await clearVault();
  localStorage.clear();
  setSession(TENANT);
  setBackupPassphrase("phrase-de-test-t415");
});

afterEach(async () => {
  await clearVault();
  localStorage.clear();
  setBackupPassphrase(null);
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  1 + 2. runBackup mirrors + observe reads the server                */
/* ------------------------------------------------------------------ */

describe("T-415 — SupabaseBackupRepository (BKUP-501)", () => {
  it("runBackup creates the local vault archive AND mirrors the metadata row", async () => {
    const { client, backupTable } = makeClient();
    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10)); // constructor refresh settles

    const result = await repo.runBackup(ACTOR_UUID, "T415 Mirror Tester");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The local vault archive exists (ciphertext NEVER goes to the server).
    const record = await getArchive(result.value.id);
    expect(record).not.toBeNull();
    expect(record!.ciphertext.length).toBeGreaterThan(0);

    // The server metadata row.
    expect(backupTable).toHaveLength(1);
    const row = backupTable[0];
    expect(row.archive_id_text).toBe(result.value.id);
    expect(row.tenant_id).toBe(TENANT);
    expect(row.file_name).toBe(result.value.id);
    expect(row.size_bytes).toBe(result.value.sizeBytes);
    expect(row.checksum_sha256).toBe(result.value.checksum);
    expect(row.vault_location).toBe("indexeddb");
    expect(row.status).toBe("encrypted");
    expect(row.retention_expires_at).toBe(result.value.retentionExpiresAt);
    expect(row.created_by).toBe(ACTOR_UUID);
    expect(row.metadata.createdByName).toBe("T415 Mirror Tester");
    expect(row.metadata.schemaVersion).toBe(1);
    expect(row.metadata.parentCount).toBe(store.parents.length);
    // THE §13.03 GUARANTEE: no ciphertext column ever carries bytes.
    expect(Object.keys(row)).not.toContain("ciphertext");
  });

  it("observe() reads the SERVER table (newest-first, NO fake demo seeds)", async () => {
    const { client, backupTable } = makeClient();
    // Pre-existing server rows (another machine's backups) — created_at DESC.
    backupTable.push(
      {
        id: "srv-1",
        tenant_id: TENANT,
        archive_id_text: "backup-2026-09-25-020000.db",
        file_name: "backup-2026-09-25-020000.db",
        size_bytes: 1024,
        checksum_sha256: "a".repeat(64),
        vault_location: "indexeddb",
        status: "encrypted",
        retention_expires_at: "2027-09-25T02:00:00.000Z",
        created_by: ACTOR_UUID,
        created_at: "2026-09-25T02:00:00.000Z",
        updated_at: "2026-09-25T02:00:00.000Z",
        restored_at: null,
        restored_by: null,
        purge_at: null,
        metadata: { parentCount: 5, createdByName: "Night Scheduler" },
      },
      {
        id: "srv-2",
        tenant_id: TENANT,
        archive_id_text: "backup-2026-09-26-020000-500.db",
        file_name: "backup-2026-09-26-020000-500.db",
        size_bytes: 2048,
        checksum_sha256: "b".repeat(64),
        vault_location: "offsite_vault",
        status: "restored",
        retention_expires_at: "2027-09-26T02:00:00.000Z",
        created_by: null,
        created_at: "2026-09-26T02:00:00.000Z",
        updated_at: "2026-09-26T06:00:00.000Z",
        restored_at: "2026-09-26T06:00:00.000Z",
        restored_by: ACTOR_UUID,
        purge_at: null,
        metadata: {},
      },
    );

    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10));
    const list = repo.observe().get();

    // Real rows only — the 3 mock-era demo seeds are gone.
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.id)).toEqual([
      "backup-2026-09-26-020000-500.db",
      "backup-2026-09-25-020000.db",
    ]);
    // The domain mapping.
    expect(list[0].status).toBe("restored");
    expect(list[0].vaultLocation).toBe("offsite");
    expect(list[1].vaultLocation).toBe("local");
    expect(list[1].createdBy).toBe("Night Scheduler");
    expect(list[1].metadata?.parentCount).toBe(5);
    expect(list[1].sizeBytes).toBe(1024);
  });

  it("an empty server table observes as the honest EMPTY list (no demo seeds)", async () => {
    const { client } = makeClient();
    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10));
    expect(repo.observe().get()).toEqual([]);
  });

  /* ---------------------------------------------------------------- */
  /*  3 + 4. The status transitions mirrored                           */
  /* ---------------------------------------------------------------- */

  it("a successful restore transitions the server row to 'restored' with restored_at/by", async () => {
    const { client, backupTable } = makeClient();
    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10));

    const created = await repo.runBackup(ACTOR_UUID, "T415 Tester");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await repo.restore(created.value.id, ACTOR_UUID, "T415 Tester");
    expect(r.ok).toBe(true);

    expect(backupTable).toHaveLength(1);
    expect(backupTable[0].status).toBe("restored");
    expect(backupTable[0].restored_at).toEqual(expect.any(String));
    expect(backupTable[0].restored_by).toBe(ACTOR_UUID);
    // The local vault record agrees (BKUP-503).
    expect((await getArchive(created.value.id))!.metadata.status).toBe("restored");
  });

  it("a checksum-class corruption propagates 'corrupted' to the server row", async () => {
    const { client, backupTable } = makeClient();
    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10));

    const created = await repo.runBackup(ACTOR_UUID, "T415 Tester");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Drift the vault metadata's checksum — the unambiguous corruption class.
    const record = await getArchive(created.value.id);
    const { storeArchive } = await import("../../infrastructure/backup/indexed-db-vault");
    await storeArchive({
      id: created.value.id,
      metadata: { ...record!.metadata, checksum: "e".repeat(64) },
      ciphertext: record!.ciphertext,
      iv: record!.iv,
    });

    const r = await repo.restore(created.value.id, ACTOR_UUID, "T415 Tester");
    expect(r.ok).toBe(false);
    expect(backupTable[0].status).toBe("corrupted");
    expect((await getArchive(created.value.id))!.metadata.status).toBe("corrupted");
  });

  /* ---------------------------------------------------------------- */
  /*  5 + 6. Delete + purge                                            */
  /* ---------------------------------------------------------------- */

  it("deleteArchive removes the server row (a manual action removes the record)", async () => {
    const { client, backupTable } = makeClient();
    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10));

    const created = await repo.runBackup(ACTOR_UUID, "T415 Tester");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(backupTable).toHaveLength(1);

    const r = await repo.deleteArchive(created.value.id, ACTOR_UUID, "T415 Tester");
    expect(r.ok).toBe(true);
    expect(backupTable).toHaveLength(0);
    expect(await getArchive(created.value.id)).toBeNull();
  });

  it("purgeExpired marks the server row 'purged' (the 0022 RPC semantics)", async () => {
    const { client, backupTable } = makeClient();
    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10));

    const created = await repo.runBackup(ACTOR_UUID, "T415 Tester");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Age the archive past its recorded retention (BKUP-504 semantics).
    const day = 24 * 60 * 60 * 1000;
    const record = await getArchive(created.value.id);
    const { storeArchive } = await import("../../infrastructure/backup/indexed-db-vault");
    await storeArchive({
      id: created.value.id,
      metadata: {
        ...record!.metadata,
        createdAt: new Date(Date.now() - 400 * day).toISOString(),
        retentionExpiresAt: new Date(Date.now() - 35 * day).toISOString(),
      },
      ciphertext: record!.ciphertext,
      iv: record!.iv,
    });

    const purged = await repo.purgeExpired(ACTOR_UUID, "T415 Tester");
    expect(purged.ok).toBe(true);
    if (!purged.ok) return;
    expect(purged.value.map((a) => a.id)).toContain(created.value.id);

    // The local record is GONE; the server row remains as 'purged' history.
    expect(await getArchive(created.value.id)).toBeNull();
    expect(backupTable).toHaveLength(1);
    expect(backupTable[0].status).toBe("purged");
  });

  /* ---------------------------------------------------------------- */
  /*  7. The reliability guarantee — the mirror never blocks           */
  /* ---------------------------------------------------------------- */

  it("a Supabase mirror FAILURE never fails the local backup (the vault is the authority)", async () => {
    const { client, backupTable } = makeClient({ message: "503 — Supabase temporarily unavailable" });
    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10));

    const result = await repo.runBackup(ACTOR_UUID, "T415 Outage Tester");
    expect(result.ok).toBe(true); // THE GUARANTEE
    if (!result.ok) return;
    expect(result.value.sizeBytes).toBeGreaterThan(0);
    // The local vault archive exists; the server mirror stayed empty.
    expect(await getArchive(result.value.id)).not.toBeNull();
    expect(backupTable).toHaveLength(0);
  });

  it("a missing tenant context skips the mirror — the local backup still succeeds", async () => {
    setSession(null);
    const { client, backupTable } = makeClient();
    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10));

    const result = await repo.runBackup(ACTOR_UUID, "T415 No-Tenant Tester");
    expect(result.ok).toBe(true);
    expect(await getArchive(result.value.id)).not.toBeNull();
    expect(backupTable).toHaveLength(0);
  });

  it("a non-UUID actor mirrors created_by as null (the column contract)", async () => {
    const { client, backupTable } = makeClient();
    const repo = new SupabaseBackupRepository(client);
    await new Promise((r) => setTimeout(r, 10));

    const result = await repo.runBackup("staff-t415-local-id", "Local Actor");
    expect(result.ok).toBe(true);
    expect(backupTable[0].created_by).toBeNull();
    expect(backupTable[0].metadata.createdByName).toBe("Local Actor");
  });
});
