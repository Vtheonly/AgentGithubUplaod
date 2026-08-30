/**
 * T-013 — markCleared single-atomic-path regression suite
 * (BUSINESS-101 + BUSINESS-104).
 *
 * Problem: when the canonical `mark_payment_cleared` RPC failed, the desktop
 * fell back to a row-update shim (`markClearedFallback`) that (a) wrote NO
 * audit entries and discarded the actor identity (`void actorId`), and
 * (b) swallowed per-installment update errors while still decrementing the
 * `remaining` budget — cascading over-allocation.
 *
 * Fixed (T-011 pattern): the fallback is REMOVED — the canonical migration
 * chain (ADR-001) is always applied live, so an RPC failure surfaces as Err
 * with the financial state untouched.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePaymentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";

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


describe("T-013 — SupabasePaymentRepository.markCleared() atomic-only (BUSINESS-101/104)", () => {
  it("returns Err when the canonical RPC fails and performs NO row updates (fallback removed)", async () => {
    const tables: Record<string, FakeTable> = {
      payments: new FakeTable(),
      installments: new FakeTable(),
    };
    const installmentsBefore = JSON.stringify(tables.installments.rows);
    const client = makeFakeClient({
      tables,
      rpcHandlers: {
        mark_payment_cleared: () => ({ data: null, error: { code: "P0001", message: "payment not in pending state" } }),
      },
    });
    const repo = new SupabasePaymentRepository(client);
    const result = await repo.markCleared("pay-1", "actor-1", "Actor One");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("payment not in pending state");
    }
    // The removed fallback must not have touched any installment rows.
    expect(JSON.stringify(tables.installments.rows)).toBe(installmentsBefore);
  });

  it("keeps the success path: payment re-fetched and cached after the RPC", async () => {
    const tables: Record<string, FakeTable> = { payments: new FakeTable(), installments: new FakeTable() };
    tables.payments.rows.push({ ...paymentRowFor("pay-1"), status: "paid" });
    const client = makeFakeClient({
      tables,
      rpcHandlers: {
        mark_payment_cleared: () => ({ data: null, error: null }),
      },
    });
    const repo = new SupabasePaymentRepository(client);
    const result = await repo.markCleared("pay-1", "actor-1", "Actor One");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("paid");
    }
  });
});
