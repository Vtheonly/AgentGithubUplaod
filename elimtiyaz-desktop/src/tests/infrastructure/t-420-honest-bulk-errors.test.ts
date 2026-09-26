/**
 * T-420 / IMPORT-112 + IMPORT-113 — the honest-error contract on the Supabase
 * bulk financial write paths (104th session, 2026-09-27 — the issue-#20 fix).
 *
 * THE DEFECT (live evidence, docs/recovery/t-420-import-integrity-baseline.md):
 * during the owner's 2026-09-26 18:21 import, the connection pool was
 * exhausted by the realtime refresh storm; the ledger flush's `bulkAppend`
 * THREW, the catch fell back to `appendMany` (which drops every failed
 * `append()` and ALWAYS returned Ok), so 0 of ~3,346 ledger entries were
 * written while the flush believed it had succeeded. The installments path
 * carried the same lossy fallback (0 of ~5,963 rows live). With no charge
 * entries, every account replays to balance 0 — the CRM showed every student
 * "fully paid, no outstanding debt" (the issue-#20 report).
 *
 * What this suite pins (the regression can never come back):
 *
 *   1. LEDGER bulkAppend — a THROWN error (network/pool exception) returns
 *      Err. The lossy appendMany funnel is GONE.
 *   2. LEDGER bulkAppend — the wire form stays IMPORT-107-correct
 *      (ignoreDuplicates, never an onConflict arbiter) and a chunk ERROR
 *      response still returns Err.
 *   3. LEDGER appendMany — any per-entry RPC failure returns Err with the
 *      failing entry's identity (never Ok-with-dropped-rows).
 *   4. INSTALLMENTS bulkImportInstallments — a THROWN error returns Err
 *      (the IMPORT-113 lossy per-row fallback is GONE).
 *   5. END-TO-END — a SupabaseLedgerRepository whose transport throws makes
 *      RepositoryStorageAdapter.commitTransaction() THROW (the import fails
 *      loudly instead of persisting students with no financial data).
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-420-honest-bulk-errors.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseLedgerRepository,
  SupabaseInstallmentRepository,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import {
  RepositoryStorageAdapter,
} from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import type { ImportInstallmentInput, InstallmentRepository, ParentRepository, StudentRepository, PaymentRepository, LedgerRepository } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Installment } from "../../domain/model/payment";

// The tenant the shared repositories resolve from the session fixture.
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

/* ------------------------------------------------------------------ */
/* Fake Supabase clients — the ledger + installments surfaces           */
/* ------------------------------------------------------------------ */

type Row = Record<string, any>;

/**
 * The ledger surface. `mode` simulates the transport conditions observed
 * live (issue #20):
 *  - "ok": healthy — inserts land.
 *  - "chunkError": the .upsert().select() call RESOLVES with an error
 *    payload (a PostgREST-level failure).
 *  - "throw": the .upsert() call itself THROWS (the fetch/network/pool
 *    exception — the exact IMPORT-112 trigger).
 *  - "rpcFails": the upsert_ledger_entry_from_import RPC resolves with an
 *    error for a given sourceId (the appendMany path).
 */
function makeLedgerClient(mode: "ok" | "chunkError" | "throw" | "rpcFails", rpcFailSourceId?: string) {
  const upsertCalls: Array<{ rows: Row[]; options: Record<string, unknown> | undefined }> = [];
  const rpcCalls: string[] = [];
  const inserted: Row[] = [];

  const ledgerTable = {
    select: (cols: string) => {
      if (cols !== "*") throw new Error(`unexpected select ${cols}`);
      // The seed() chain: .select("*").eq().order().limit() → thenable.
      return {
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [...inserted], error: null }),
          }),
        }),
      };
    },
    upsert: (rows: Row[] | Row, options?: Record<string, unknown>) => {
      const list = Array.isArray(rows) ? rows : [rows];
      upsertCalls.push({ rows: list, options });
      if (mode === "throw") {
        // The live shape: the transport itself rejects (pool exhaustion /
        // network timeout) — this is what funneled into the lossy fallback.
        throw new Error("Timed out acquiring connection from connection pool");
      }
      return {
        select: () => {
          if (mode === "chunkError") {
            return Promise.resolve({
              data: null,
              error: { code: "PGRST003", message: "Timed out acquiring connection from connection pool" },
            });
          }
          for (const r of list) inserted.push({ id: `led-${inserted.length + 1}`, ...r });
          return Promise.resolve({ data: [...inserted], error: null });
        },
      };
    },
  };

  const client = {
    from: (table: string) => {
      if (table === "ledger_entries") return ledgerTable;
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push(name);
      if (name === "upsert_ledger_entry_from_import" && mode === "rpcFails") {
        const sid = args.p_source_id as string | null;
        if (sid === rpcFailSourceId) {
          return Promise.resolve({
            data: null,
            error: { code: "PGRST003", message: "Timed out acquiring connection from connection pool" },
          });
        }
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client: client as unknown as SupabaseClient, upsertCalls, rpcCalls };
}

/** The installments surface with a THROWING upsert (the IMPORT-113 trigger). */
function makeThrowingInstallmentClient() {
  const client = {
    from: (table: string) => {
      if (table !== "installments") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
        upsert: () => {
          throw new Error("Timed out acquiring connection from connection pool");
        },
      };
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { client: client as unknown as SupabaseClient };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

const TENANT = "00000000-0000-0000-0000-000000000001";

function entry(n: number): LedgerEntry {
  return {
    id: `imp-entry-${n}`,
    tenantId: TENANT,
    entryNumber: `imp-entry-${n}`,
    parentId: "parent-1",
    studentId: "student-1",
    serviceEnrollmentId: null,
    paymentId: null,
    adjustmentId: null,
    reversesId: null,
    accountId: "student:student-1:tuition",
    type: n % 2 === 0 ? "payment" : "charge",
    amount: n % 2 === 0 ? -10_000 : 100_000,
    category: "tuition",
    description: `entry ${n}`,
    method: "cash",
    receiptNumber: `IMP-student-1-F${n}`,
    paymentStatus: "paid",
    reversesEntryId: null,
    actorId: "actor",
    actorName: "Actor",
    at: new Date().toISOString(),
    sourceType: "bulk_import",
    sourceId: `student-1:F${n}`,
    metadata: { field: `F${n}` },
  } as unknown as LedgerEntry;
}

const INSTALLMENT_INPUT = (n: 1 | 2 | 3): ImportInstallmentInput => ({
  parentId: "parent-1",
  studentId: "student-1",
  category: "tuition",
  trancheNumber: n,
  label: `T${n}`,
  amountDue: 1000,
  amountPaid: 0,
  dueDate: "2026-10-01",
  paidDate: null,
  status: "unpaid",
});

/* ------------------------------------------------------------------ */
/* 1-3 — the ledger repository                                          */
/* ------------------------------------------------------------------ */

describe("T-420 / IMPORT-112 — SupabaseLedgerRepository honest errors", () => {
  it("1 — bulkAppend THROWS → returns Err (the lossy appendMany funnel is gone)", async () => {
    const { client } = makeLedgerClient("throw");
    const repo = new SupabaseLedgerRepository(client);
    const r = await repo.bulkAppend([entry(1), entry(2), entry(3)]);
    // The OLD behavior: catch → appendMany → every RPC fails fast →
    // Ok([]) — SUCCESS WITH ZERO ROWS WRITTEN (the live issue-#20 defect).
    expect(r.ok).toBe(false);
    const err = (r as { error: { message: string } }).error;
    expect(err.message).toContain("bulkAppend");
    expect(err.message).toContain("3");
    expect(err.message).toContain("Timed out acquiring connection");
  });

  it("2 — bulkAppend keeps the IMPORT-107 wire form and honest chunk errors", async () => {
    // Wire form: ignoreDuplicates, never an onConflict arbiter.
    const { client: okClient, upsertCalls } = makeLedgerClient("ok");
    const okRepo = new SupabaseLedgerRepository(okClient);
    const ok = await okRepo.bulkAppend([entry(1)]);
    expect(ok.ok).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].options!.ignoreDuplicates).toBe(true);
    expect("onConflict" in upsertCalls[0].options!).toBe(false);

    // Chunk error response → Err (the pre-existing IMPORT-107 pin, kept).
    const { client: errClient } = makeLedgerClient("chunkError");
    const errRepo = new SupabaseLedgerRepository(errClient);
    const bad = await errRepo.bulkAppend([entry(1)]);
    expect(bad.ok).toBe(false);
    expect((bad as { error: { message: string } }).error.message).toContain("bulkAppend chunk 0");
  });

  it("3 — appendMany with ANY failing RPC → Err naming the first failure (never Ok-with-drops)", async () => {
    const { client, rpcCalls } = makeLedgerClient("rpcFails", "student-1:F2");
    const repo = new SupabaseLedgerRepository(client);
    const r = await repo.appendMany([entry(1), entry(2), entry(3)]);
    // The OLD behavior: Ok([entry1, entry3]) — entry 2 silently vanished.
    expect(r.ok).toBe(false);
    const err = (r as { error: { message: string } }).error;
    expect(err.message).toContain("appendMany");
    expect(err.message).toContain("1/3");
    expect(err.message).toContain("student-1:F2");
    // All three RPCs were attempted (no short-circuit hiding the count).
    expect(rpcCalls).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */
/* 4 — the installments repository                                      */
/* ------------------------------------------------------------------ */

describe("T-420 / IMPORT-113 — SupabaseInstallmentRepository honest errors", () => {
  it("4 — bulkImportInstallments THROWS → returns Err (the lossy per-row fallback is gone)", async () => {
    const { client } = makeThrowingInstallmentClient();
    const repo = new SupabaseInstallmentRepository(client);
    const r = await repo.bulkImportInstallments([INSTALLMENT_INPUT(1), INSTALLMENT_INPUT(2)]);
    // The OLD behavior: catch → loop importInstallment → drops → Ok([]).
    expect(r.ok).toBe(false);
    const err = (r as { error: { message: string } }).error;
    expect(err.message).toContain("bulkImportInstallments");
    expect(err.message).toContain("2");
    expect(err.message).toContain("Timed out acquiring connection");
  });
});

/* ------------------------------------------------------------------ */
/* 5 — end-to-end: the adapter's flush FAILS the import                 */
/* ------------------------------------------------------------------ */

describe("T-420 — end-to-end: a throwing Supabase ledger transport fails the adapter flush", () => {
  it("5 — commitTransaction throws (the import aborts loudly — no silent empty ledger)", async () => {
    // Minimal stubs for the adapter's OTHER dependencies (t-105 convention).
    const parents = {
      search: async () => Ok([]),
      createParent: async () => Ok({ id: "parent-1" }),
    } as unknown as ParentRepository;
    const students = {
      search: async () => Ok([]),
      createStudent: async () => Ok({ id: "student-1" }),
    } as unknown as StudentRepository;
    const payments = {
      collect: async () => Ok({ id: "pay-1" }),
    } as unknown as PaymentRepository;
    const installments = {
      importInstallment: async () => Ok({ id: "inst-1" }),
    } as unknown as InstallmentRepository;

    // The REAL Supabase ledger repository over a THROWING transport.
    const { client } = makeLedgerClient("throw");
    const ledger: LedgerRepository = new SupabaseLedgerRepository(client);

    const adapter = new RepositoryStorageAdapter({
      parents, students, ledger, payments, installments,
      tenantId: TENANT, actorId: "test", actorName: "Test",
    });

    // Buffer one pending ledger entry the way upsertEtatRecord does, then
    // commit — the flush must THROW (the "Échec de l'écriture en base"
    // contract), never resolve.
    const pending = (adapter as unknown as { pendingLedgerEntries: LedgerEntry[] }).pendingLedgerEntries;
    pending.push(entry(1));
    await expect(
      (adapter as unknown as { commitTransaction(): Promise<void> }).commitTransaction(),
    ).rejects.toThrow(/écritures du journal/i);
  });
});
