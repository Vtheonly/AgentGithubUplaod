/**
 * T-012 — bulkCollect fail-fast regression suite (BUSINESS-100).
 *
 * Problem: `SupabasePaymentRepository.bulkCollect()` logged failed chunks and
 * CONTINUED, returning Ok(partially-inserted) — silently violating the Excel
 * importer's "aucune donnée financière n'a été partiellement appliquée en
 * silence" contract (commitTransaction's own guarantee). The importer adapter
 * ignored the repository's Result, so the failure never surfaced.
 *
 * Fixed: bulkCollect fails fast on the first chunk error (Err identifying the
 * failing row range, nothing partially returned, no retry loop), and
 * `flushPendingBatches` honors the Err to cancel the import transaction.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePaymentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";

type Row = Record<string, any>;

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


describe("T-012 — SupabasePaymentRepository.bulkCollect() fail-fast (BUSINESS-100)", () => {
  it("returns Err identifying the failing rows instead of Ok(partial)", async () => {
    const tables: Record<string, FakeTable> = { payments: new FakeTable() };
    const client = makeFakeClient({
      tables,
      rpcHandlers: {},
      insertError: { code: "23503", message: "insert or update on table \"payments\" violates foreign key constraint" },
    });
    const repo = new SupabasePaymentRepository(client);
    const inputs = [
      { input: { ...baseInput, receiptNumber: "PAY-R1" }, collectedBy: "staff-1" },
      { input: { ...baseInput, receiptNumber: "PAY-R2" }, collectedBy: "staff-1" },
    ];
    const result = await repo.bulkCollect(inputs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("rows 1–2");
      expect(result.error.message).toContain("foreign key");
    }
    // Nothing was silently inserted.
    expect(tables.payments.rows).toHaveLength(0);
  });

  it("keeps the happy path: all rows inserted and returned", async () => {
    const tables: Record<string, FakeTable> = { payments: new FakeTable() };
    const client = makeFakeClient({ tables, rpcHandlers: {}, insertError: null });
    const repo = new SupabasePaymentRepository(client);
    const inputs = [
      { input: { ...baseInput, receiptNumber: "PAY-R1" }, collectedBy: "staff-1" },
      { input: { ...baseInput, receiptNumber: "PAY-R2" }, collectedBy: "staff-1" },
    ];
    const result = await repo.bulkCollect(inputs);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
    expect(tables.payments.rows).toHaveLength(2);
  });
});

describe("T-012 — importer flushPendingBatches honors the bulkCollect Err (BUSINESS-100 consumer side)", () => {
  function makeAdapterWith(paymentsDeps: unknown) {
    const noopRepo = {
      async upsertParent() {
        return { ok: true, value: null } as never;
      },
    };
    return new RepositoryStorageAdapter({
      parents: noopRepo as never,
      students: noopRepo as never,
      payments: paymentsDeps as never,
      tenantId: "00000000-0000-0000-0000-000000000001",
      actorId: "staff-1",
      actorName: "Staff One",
    });
  }

  it("throws (canceling the import) when bulkCollect returns Err", async () => {
    const adapter = makeAdapterWith({
      bulkCollect: async () => ({
        ok: false,
        error: { message: "bulkCollect: insert of payment rows 1–2 failed: FK violation — le lot a été annulé (aucune écriture partielle)." },
      }),
    });
    // Queue two payments directly into the pending buffer (private field —
    // the public upsert path is heavy; the flush behaviour is what we test).
    const pending = (adapter as unknown as { pendingPayments: unknown[] }).pendingPayments;
    pending.push(
      { input: { ...baseInput, receiptNumber: "PAY-R1" }, collectedBy: "staff-1" },
      { input: { ...baseInput, receiptNumber: "PAY-R2" }, collectedBy: "staff-1" },
    );
    await expect((adapter as unknown as { flushPendingBatches: () => Promise<void> }).flushPendingBatches())
      .rejects
      .toThrow(/paiements \(2\).*foreign key|bulkCollect.*annulé|FK violation/s);
  });

  it("does not throw when bulkCollect returns Ok", async () => {
    const adapter = makeAdapterWith({
      bulkCollect: async () => ({ ok: true, value: [] }),
    });
    const pending = (adapter as unknown as { pendingPayments: unknown[] }).pendingPayments;
    pending.push({ input: { ...baseInput, receiptNumber: "PAY-R1" }, collectedBy: "staff-1" });
    await expect((adapter as unknown as { flushPendingBatches: () => Promise<void> }).flushPendingBatches())
      .resolves
      .toBeUndefined();
  });
});

// ============================================================================
// T-013 — markCleared single atomic path
// ============================================================================

