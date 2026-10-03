/**
 * SupabaseWarehouseTaskRepository unit tests (T-479 — the WORKFORCE-507 fix).
 *
 * Verifies the canonical contract of the warehouse-tasks port:
 *   1. observeReceipts()/observeDispatches() map the canonical rows to the
 *      domain shapes: supplierName via the suppliers(name) embed (NULL →
 *      "—"), purchaseRequestCode via purchase_requests(request_number),
 *      expected/received quantities = Σ over items_json lines.
 *   2. Read-side status folds: DB 'delivered' dispatch → domain
 *      'dispatched'; unknown statuses → 'pending'/'pending'.
 *   3. receiveReceipt() = the FULL receipt: every items_json line's
 *      received_qty := its expected_qty, status 'received', received_at +
 *      received_by stamped; already-received/cancelled refused.
 *   4. prepareDispatch()/dispatchDispatch() write the lifecycle (the 0139
 *      'preparing' value; dispatched_at + dispatched_by stamped); terminal
 *      rows refused by the status filter.
 *   5. Validation: a non-UUID actor id is refused BEFORE the table (the
 *      T-178 mock-era-id guard).
 *   6. createReceipt()/createDispatch() insert tenant-scoped rows; an
 *      unresolvable supplier name degrades to a NULL FK + the name kept
 *      in `note` (never silent loss).
 *   7. Persistence-across-restart (a fresh repository instance reads the
 *      same rows — the mock's wipe-on-restart defect, gone).
 *   8. Source scans: the wiring override + the 0139 migration + the seed
 *      arrays' absence from the Supabase path.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseWarehouseTaskRepository } from "../../infrastructure/supabase/repositories/supabase-warehouse-task-repository";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder (t-099/t-145/t-239
// convention; `in` + `ilike` added for this repository's guards/lookups)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(private readonly table: Row[]) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }
  ilike(col: string, pattern: string): this {
    const needle = pattern.replace(/%/g, "").toLowerCase();
    this.filters.push((r) => String(r[col] ?? "").toLowerCase() === needle);
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
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
  single(): this {
    this.wantSingle = true;
    return this;
  }
  maybeSingle(): this {
    this.wantMaybeSingle = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null } {
    if (this.mode === "insert") {
      const row = {
        id: "wht-uuid-new",
        tenant_id: "irrelevant",
        status: "pending",
        created_at: "2026-10-04T10:00:00Z",
        updated_at: "2026-10-04T10:00:00Z",
        ...this.payload,
      };
      this.table.push(row);
      return { data: row, error: null };
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.payload ?? {});
          patched.push(row);
        }
      }
      if (this.wantSingle) {
        if (patched.length === 0) return { data: null, error: { message: "no rows (PGRST116)" } };
        return { data: patched[0], error: null };
      }
      return { data: patched, error: null };
    }
    if (this.mode === "delete") {
      const remaining = this.table.filter((r) => !this.filters.every((f) => f(r)));
      this.table.length = 0;
      this.table.push(...remaining);
      return { data: null, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[this.orderCol] ?? "").localeCompare(String(b[this.orderCol] ?? ""));
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle) {
      if (rows.length === 0) return { data: null, error: { message: "no rows (PGRST116)" } };
      return { data: rows[0], error: null };
    }
    if (this.wantMaybeSingle) {
      return { data: rows.length > 0 ? rows[0] : null, error: null };
    }
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { code?: string; message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    return Promise.resolve(onFulfilled!(this.run() as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName]);
  }
}

const fakeClient = new FakeClient();

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const WAREHOUSE_ACTOR = "dddddddd-0000-0000-0000-0000000000d1";
const SUPPLIER_ID = "ssssssss-0000-0000-0000-0000000000s1";
const PR_ID = "pppppppp-0000-0000-0000-0000000000p1";

beforeEach(() => {
  fakeClient.tables = {};
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: WAREHOUSE_ACTOR }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

function receiptRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "rcp-uuid-1",
    tenant_id: TENANT,
    purchase_request_id: PR_ID,
    supplier_id: SUPPLIER_ID,
    expected_at: "2026-10-01T09:00:00Z",
    received_at: null,
    received_by: null,
    items_json: [
      { sku: "STY-BLE", name: "Stylos bleus", expected_qty: 20, received_qty: 0, condition: null },
      { sku: "CAH-A4", name: "Cahiers A4", expected_qty: 40, received_qty: 0, condition: null },
    ],
    status: "pending",
    note: null,
    created_at: "2026-09-28T08:00:00Z",
    updated_at: "2026-09-28T08:00:00Z",
    suppliers: { name: "Fournitures Scolaires Oran" },
    purchase_requests: { request_number: "PR-2026-000123" },
    ...overrides,
  };
}

function dispatchRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "dsp-uuid-1",
    tenant_id: TENANT,
    destination: "Site annexe Hydra",
    items_json: [
      { sku: "MAN-MATH", name: "Manuels Maths CEM1", quantity: 50, note: null },
    ],
    scheduled_at: "2026-10-02T08:00:00Z",
    dispatched_at: null,
    dispatched_by: null,
    delivery_id: null,
    status: "pending",
    note: null,
    created_at: "2026-09-30T08:00:00Z",
    updated_at: "2026-09-30T08:00:00Z",
    ...overrides,
  };
}

function makeRepo(): SupabaseWarehouseTaskRepository {
  return new SupabaseWarehouseTaskRepository(fakeClient as unknown as SupabaseClient);
}

/** Let the async seed()/refresh() promises settle (the t-239 convention). */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

// ============================================================================
// Tests
// ============================================================================

describe("SupabaseWarehouseTaskRepository (T-479 / WORKFORCE-507)", () => {
  it("1. observeReceipts() maps embeds + Σ items_json to the domain shape", async () => {
    fakeClient.tables["pending_receipts"] = [receiptRow()];
    const repo = makeRepo();
    const obs = repo.observeReceipts();
    await settle();
    const cached = obs.get();
    expect(cached.length).toBe(1);
    const r = cached[0];
    expect(r.supplierName).toBe("Fournitures Scolaires Oran");
    expect(r.purchaseRequestCode).toBe("PR-2026-000123");
    expect(r.expectedQuantity).toBe(60); // 20 + 40
    expect(r.receivedQuantity).toBe(0);
    expect(r.status).toBe("pending");
    expect(r.expectedAt).toBe("2026-10-01T09:00:00Z");
  });

  it("2a. a NULL supplier_id degrades to '—' and a NULL PR to null (honest folds)", async () => {
    fakeClient.tables["pending_receipts"] = [
      receiptRow({ supplier_id: null, purchase_request_id: null, suppliers: null, purchase_requests: null }),
    ];
    const repo = makeRepo();
    const obs = repo.observeReceipts();
    await settle();
    const r = obs.get()[0];
    expect(r.supplierName).toBe("—");
    expect(r.purchaseRequestCode).toBeNull();
  });

  it("2b. dispatch read folds: DB 'delivered' → domain 'dispatched'; unknown → 'pending'", async () => {
    fakeClient.tables["pending_dispatches"] = [
      dispatchRow({ id: "dsp-a", status: "delivered", dispatched_at: "2026-10-01T10:00:00Z" }),
      dispatchRow({ id: "dsp-b", status: "weird-future-value" }),
    ];
    const repo = makeRepo();
    const obs = repo.observeDispatches();
    await settle();
    const rows = obs.get();
    expect(rows.find((d) => d.id === "dsp-a")?.status).toBe("dispatched");
    expect(rows.find((d) => d.id === "dsp-a")?.dispatchedAt).toBe("2026-10-01T10:00:00Z");
    expect(rows.find((d) => d.id === "dsp-b")?.status).toBe("pending");
    // itemLabel/quantity from the items_json lines (Σ quantity).
    expect(rows[0].itemLabel).toBe("Manuels Maths CEM1");
    expect(rows[0].quantity).toBe(50);
    // requestedAt ↔ created_at (mapping note 5).
    expect(rows[0].requestedAt).toBe("2026-09-30T08:00:00Z");
  });

  it("3. receiveReceipt() = the FULL receipt (every line received, actor + timestamps stamped)", async () => {
    fakeClient.tables["pending_receipts"] = [receiptRow()];
    const repo = makeRepo();
    const result = await repo.receiveReceipt("rcp-uuid-1", WAREHOUSE_ACTOR, "Karim Magasinier");
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["pending_receipts"][0];
    expect(row["status"]).toBe("received");
    expect(row["received_by"]).toBe(WAREHOUSE_ACTOR);
    expect(row["received_at"]).toBeTruthy();
    const lines = row["items_json"] as { expected_qty: number; received_qty: number }[];
    expect(lines.every((l) => l.received_qty === l.expected_qty)).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("received");
      expect(result.value.receivedQuantity).toBe(60);
    }
  });

  it("3b. receiveReceipt() refuses an already-received row", async () => {
    fakeClient.tables["pending_receipts"] = [receiptRow({ status: "received" })];
    const repo = makeRepo();
    const result = await repo.receiveReceipt("rcp-uuid-1", WAREHOUSE_ACTOR, "Karim");
    expect(result.ok).toBe(false);
  });

  it("4. prepareDispatch()/dispatchDispatch() write the lifecycle (0139's 'preparing')", async () => {
    fakeClient.tables["pending_dispatches"] = [dispatchRow()];
    const repo = makeRepo();
    const prepared = await repo.prepareDispatch("dsp-uuid-1", WAREHOUSE_ACTOR, "Karim");
    expect(prepared.ok).toBe(true);
    expect(fakeClient.tables["pending_dispatches"][0]["status"]).toBe("preparing");
    if (prepared.ok) expect(prepared.value.status).toBe("preparing");

    const dispatched = await repo.dispatchDispatch("dsp-uuid-1", WAREHOUSE_ACTOR, "Karim");
    expect(dispatched.ok).toBe(true);
    const row = fakeClient.tables["pending_dispatches"][0];
    expect(row["status"]).toBe("dispatched");
    expect(row["dispatched_by"]).toBe(WAREHOUSE_ACTOR);
    expect(row["dispatched_at"]).toBeTruthy();
  });

  it("4b. dispatchDispatch() refuses a terminal row (the status filter)", async () => {
    fakeClient.tables["pending_dispatches"] = [
      dispatchRow({ status: "dispatched", dispatched_at: "2026-10-01T10:00:00Z", dispatched_by: WAREHOUSE_ACTOR }),
    ];
    const repo = makeRepo();
    const result = await repo.dispatchDispatch("dsp-uuid-1", WAREHOUSE_ACTOR, "Karim");
    expect(result.ok).toBe(false);
  });

  it("5. a non-UUID actor id is refused BEFORE any table round-trip (T-178 guard)", async () => {
    fakeClient.tables["pending_receipts"] = [receiptRow()];
    fakeClient.tables["pending_dispatches"] = [dispatchRow()];
    const repo = makeRepo();
    const r1 = await repo.receiveReceipt("rcp-uuid-1", "per-001", "Mock Era");
    const r2 = await repo.prepareDispatch("dsp-uuid-1", "per-001", "Mock Era");
    const r3 = await repo.dispatchDispatch("dsp-uuid-1", "per-001", "Mock Era");
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
    expect(fakeClient.tables["pending_receipts"][0]["status"]).toBe("pending");
    expect(fakeClient.tables["pending_dispatches"][0]["status"]).toBe("pending");
  });

  it("6. createReceipt() resolves FKs by lookup; an unresolvable name degrades to note-preserved", async () => {
    fakeClient.tables["suppliers"] = [
      { id: SUPPLIER_ID, tenant_id: TENANT, name: "Éditions Alpha" },
    ];
    fakeClient.tables["purchase_requests"] = [
      { id: PR_ID, tenant_id: TENANT, request_number: "PR-2026-000777" },
    ];
    const repo = makeRepo();
    // Resolvable supplier + PR.
    const okResult = await repo.createReceipt({
      supplierName: "Éditions Alpha",
      purchaseRequestCode: "PR-2026-000777",
      expectedQuantity: 200,
      expectedAt: "2026-10-10T09:00:00Z",
    });
    expect(okResult.ok).toBe(true);
    const row = fakeClient.tables["pending_receipts"][0];
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["supplier_id"]).toBe(SUPPLIER_ID);
    expect(row["purchase_request_id"]).toBe(PR_ID);
    expect(row["status"]).toBe("pending");
    expect((row["items_json"] as { expected_qty: number }[])[0].expected_qty).toBe(200);

    // Unresolvable supplier: NULL FK + the name preserved in note.
    const degraded = await repo.createReceipt({
      supplierName: "Nouveau Fournisseur Inconnu",
      purchaseRequestCode: null,
      expectedQuantity: 5,
      expectedAt: "2026-10-11T09:00:00Z",
    });
    expect(degraded.ok).toBe(true);
    const row2 = fakeClient.tables["pending_receipts"][1];
    expect(row2["supplier_id"]).toBeNull();
    expect(String(row2["note"])).toContain("Nouveau Fournisseur Inconnu");
  });

  it("6b. createDispatch() inserts a tenant-scoped pending row with the item line", async () => {
    const repo = makeRepo();
    const result = await repo.createDispatch({
      destination: "Classe 5A",
      itemLabel: "Stylos bleus (lot 50)",
      quantity: 5,
      requestedAt: "2026-10-04T08:00:00Z",
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["pending_dispatches"][0];
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["destination"]).toBe("Classe 5A");
    expect(row["status"]).toBe("pending");
    expect(row["scheduled_at"]).toBe("2026-10-04T08:00:00Z");
    expect((row["items_json"] as { name: string }[])[0].name).toBe("Stylos bleus (lot 50)");
  });

  it("7. persistence across a repository re-instantiation (the mock's wipe defect, gone)", async () => {
    fakeClient.tables["pending_receipts"] = [receiptRow()];
    fakeClient.tables["pending_dispatches"] = [dispatchRow()];
    const first = makeRepo();
    await first.receiveReceipt("rcp-uuid-1", WAREHOUSE_ACTOR, "Karim");
    // A "restart": a brand-new repository instance over the same store.
    const second = new SupabaseWarehouseTaskRepository(fakeClient as unknown as SupabaseClient);
    const obs = second.observeReceipts();
    await settle();
    const receipts = obs.get();
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe("received");
    expect(receipts[0].receivedQuantity).toBe(60);
  });

  it("8. source scans: the wiring override + the 0139 migration + no seed arrays on the Supabase path", () => {
    const wiring = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/supabase-repositories.ts"),
      "utf8",
    );
    // The override exists (the slot no longer falls through to the mock).
    expect(wiring.includes("const warehouseTasks = new SupabaseWarehouseTaskRepository(client);")).toBe(true);
    expect(wiring.includes("warehouseTasks, // T-479")).toBe(true);

    const repoSource = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/repositories/supabase-warehouse-task-repository.ts"),
      "utf8",
    );
    // The Supabase repository never imports the mock operations layer (the
    // seed arrays are mentioned only in the header's history note).
    expect(repoSource.includes('from "../../mock/operations')).toBe(false);
    expect(repoSource.includes("import { SEED_RECEIPTS")).toBe(false);
    expect(repoSource.includes("import { SEED_DISPATCHES")).toBe(false);

    // The 0139 migration widens the dispatch CHECK with 'preparing'.
    const migration = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0139_pending_dispatches_preparing_status.sql"),
      "utf8",
    );
    expect(migration.includes("'pending', 'preparing', 'dispatched', 'delivered', 'cancelled'")).toBe(true);
    expect(migration.includes("drop constraint pending_dispatches_status_check")).toBe(true);
  });
});
