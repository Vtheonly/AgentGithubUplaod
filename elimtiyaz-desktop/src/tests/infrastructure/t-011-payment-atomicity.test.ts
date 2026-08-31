/**
 * T-011 / T-012 / T-013 — payment write-path atomicity regression suite.
 *
 * Problems covered:
 *  - BUSINESS-002 (T-011): SupabasePaymentRepository.collect() silently fell
 *    back to `upsert_payment_from_import` (no ledger, no waterfall, no audit)
 *    whenever the atomic `collect_and_allocate_payment` RPC failed. The
 *    fallback is REMOVED: an RPC failure now returns Err and writes nothing.
 *  - BUSINESS-100 (T-012): bulkCollect() logged failed chunks and continued,
 *    returning Ok(partial). It now fails fast with Err identifying the
 *    failing row range, and the Excel importer's flushPendingBatches honors
 *    the Err so the import transaction is canceled ("aucune donnée
 *    financière n'a été partiellement appliquée en silence").
 *  - BUSINESS-101 + BUSINESS-104 (T-013): markClearedFallback() wrote no
 *    audit entries, discarded the actor identity and swallowed
 *    per-installment update errors (cascading over-allocation). The fallback
 *    is REMOVED: markCleared() delegates to the canonical
 *    `mark_payment_cleared` RPC only; an RPC failure returns Err and the
 *    financial state is untouched.
 *
 * The Supabase client is a hand-rolled fake exposing exactly the surface
 * these repositories use (rpc + from().select/insert/update with
 * eq/order/maybeSingle), mirroring the established fake-client pattern of
 * supabase-repositories.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePaymentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";

// T-053 (TENANT-103): getTenantId() no longer falls back to the demo tenant —
// tests that exercise tenant-scoped repositories set an explicit working
// tenant (the value the old fallback used to inject implicitly).
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});


type Row = Record<string, any>;

// ============================================================================
// Minimal fake Supabase client
// ============================================================================

type RpcHandler = (args: Row) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;

class FakeTable {
  rows: Row[] = [];
}

class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private payload: Row | Row[] | null = null;
  private isInsert = false;
  private wantRows = false;

  constructor(
    private readonly table: FakeTable,
    private readonly exec: () => { data: unknown; error: unknown },
  ) {}

  select(_cols?: string) {
    this.wantRows = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.payload = payload;
    this.isInsert = true;
    return this;
  }
  update(_payload: Row) {
    // Not used by the code paths under test anymore (fallback removed);
    // kept for surface compatibility.
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  order(_col: string, _opts?: { ascending?: boolean }) {
    return this;
  }
  maybeSingle() {
    return Promise.resolve(this.execSelectOne());
  }

  private execInsert(): { data: unknown; error: unknown } {
    const outcome = this.exec();
    if (outcome.error) return { data: null, error: outcome.error };
    const items = Array.isArray(this.payload) ? this.payload : [this.payload];
    const inserted = items.map((item, i) => ({
      id: item.id ?? `pay-${i}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...item,
    }));
    if (this.wantRows) this.table.rows.push(...inserted);
    return { data: this.wantRows ? inserted : null, error: null };
  }

  private execSelectOne(): { data: unknown; error: unknown } {
    const matched = this.table.rows.filter((r) => this.filters.every((f) => f(r)));
    return { data: matched[0] ?? null, error: null };
  }

  then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
    return Promise.resolve(this.execInsert()).then(resolve);
  }
}

function makeFakeClient(opts: {
  rpcHandlers: Record<string, RpcHandler>;
  tables: Record<string, FakeTable>;
  /** When set, every insert on this table fails with this error. */
  insertError?: { code: string; message: string } | null;
}) {
  return {
    rpc(fn: string, args: Row) {
      const handler = opts.rpcHandlers[fn];
      if (!handler) {
        return Promise.resolve({ data: null, error: { code: "404", message: `function ${fn} not found` } });
      }
      return Promise.resolve(handler(args));
    },
    from(table: string) {
      const t = opts.tables[table] ?? (opts.tables[table] = new FakeTable());
      return new FakeQuery(t, () => (opts.insertError ? { data: null, error: opts.insertError } : { data: null, error: null }));
    },
  } as unknown as SupabaseClient;
}

const COLLECT_OK = {
  payment_id: "11111111-1111-1111-1111-111111111111",
  receipt_number: "REC-2026-000123",
  payment_status: "paid",
  total_allocated: 1000,
  unallocated_credit: 0,
  allocations: [],
};

function paymentRowFor(id: string): Row {
  return {
    id,
    tenant_id: "00000000-0000-0000-0000-000000000001",
    payment_number: "PAY-1",
    receipt_number: "REC-2026-000123",
    parent_id: "p-1",
    student_id: "s-1",
    amount: 1000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installment_id: null,
    proof_path: null,
    notes: null,
    collected_by: "staff-1",
    collected_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const baseInput = {
  parentId: "p-1",
  studentId: "s-1",
  amount: 1000,
  method: "cash" as const,
  category: "tuition" as const,
  installmentId: null,
};

// ============================================================================
// T-011 — collect() single atomic path
// ============================================================================

describe("T-011 — SupabasePaymentRepository.collect() atomic-only (BUSINESS-002)", () => {
  it("returns Err and never calls upsert_payment_from_import when the atomic RPC fails", async () => {
    const rpcCalls: string[] = [];
    const tables: Record<string, FakeTable> = { payments: new FakeTable() };
    const client = makeFakeClient({
      tables,
      rpcHandlers: {
        collect_and_allocate_payment: () => {
          rpcCalls.push("collect_and_allocate_payment");
          return { data: null, error: { code: "P0001", message: "RLS denial simulated" } };
        },
        upsert_payment_from_import: () => {
          rpcCalls.push("upsert_payment_from_import");
          return { data: [{ out_payment_id: "fallback-id", out_payment_number: "PAY-X", out_was_inserted: true }], error: null };
        },
      },
    });
    const repo = new SupabasePaymentRepository(client);
    const result = await repo.collect(baseInput, "staff-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("RLS denial simulated");
    }
    // The silent fallback must be GONE: the legacy upsert RPC is never invoked.
    expect(rpcCalls).toEqual(["collect_and_allocate_payment"]);
    // Zero rows written.
    expect(tables.payments.rows).toHaveLength(0);
  });

  it("keeps the success path: atomic RPC result is fetched, mapped and cached", async () => {
    const tables: Record<string, FakeTable> = { payments: new FakeTable() };
    tables.payments.rows.push(paymentRowFor(COLLECT_OK.payment_id));
    const client = makeFakeClient({
      tables,
      rpcHandlers: {
        collect_and_allocate_payment: () => ({ data: [COLLECT_OK], error: null }),
      },
    });
    const repo = new SupabasePaymentRepository(client);
    const result = await repo.collect(baseInput, "staff-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(COLLECT_OK.payment_id);
      expect(result.value.receiptNumber).toBe("REC-2026-000123");
    }
  });
});

// ============================================================================
// T-012 — bulkCollect fail-fast
// ============================================================================

