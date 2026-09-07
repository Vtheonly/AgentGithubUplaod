/**
 * SupabaseInventoryRepository unit tests (T-240 — T-047 port #9).
 *
 * Verifies the canonical contract of the inventory port:
 *   1. createItem() inserts tenant-scoped with upper-cased sku, the domain
 *      category union validated client-side, quantity/reorder clamped ≥ 0.
 *   2. transact() computes before/after (clamped at 0), updates the item
 *      quantity, and inserts the append-only transaction row with the 0084
 *      frozen quantity_before/quantity_after + performed_by_name and the
 *      domain transaction-type union VERBATIM (the 0011 CHECK).
 *   3. transact() validation: delta=0 rejected (DB CHECK quantity <> 0),
 *      non-UUID item rejected, unknown type rejected.
 *   4. deleteItem() is a SOFT delete (deleted_at) — the row disappears
 *      from reads (the 0011 select-policy convention).
 *   5. scan() finds by sku and adds a 'scan' movement; unknown sku creates
 *      the item first (the mock's find-or-create semantics).
 *   6. Read mapping: label ↔ name, category union folds to 'autre',
 *      transaction before/after + actor names, derived filters.
 *   7. Persistence-across-restart.
 *   8. Source scans: wiring + the 0084 frozen columns.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseInventoryRepository } from "../../infrastructure/supabase/repositories/supabase-inventory-repository";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder (t-099/t-145 convention)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private maybe = false;
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(private readonly table: Row[]) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
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
    this.maybe = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null } {
    if (this.mode === "insert") {
      const row = {
        id: `row-${Math.random().toString(36).slice(2, 8)}`,
        is_active: true,
        quantity_reserved: 0,
        created_at: "2026-09-07T10:00:00Z",
        updated_at: "2026-09-07T10:00:00Z",
        deleted_at: null,
        transaction_at: "2026-09-07T10:00:00Z",
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
    if (this.maybe) return { data: rows[0] ?? null, error: null };
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
const WORKER = "ffffffff-0000-0000-0000-0000000000f1";

beforeEach(() => {
  fakeClient.tables = {};
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: WORKER }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

function itemRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "11111111-0000-0000-0000-000000000001",
    tenant_id: TENANT,
    sku: "SKU-EDU-001",
    name: "Cahiers 200 pages",
    description: null,
    category: "fournitures",
    unit: "piece",
    quantity_on_hand: 150,
    quantity_reserved: 0,
    reorder_level: 40,
    reorder_quantity: 100,
    unit_cost: 45,
    location: "WH-A/Shelf-1",
    is_active: true,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

function makeRepo(): SupabaseInventoryRepository {
  return new SupabaseInventoryRepository(fakeClient as unknown as SupabaseClient);
}

// ============================================================================
// Tests
// ============================================================================

describe("SupabaseInventoryRepository (T-240)", () => {
  it("1. createItem() inserts tenant-scoped, upper-cased sku, clamped quantities", async () => {
    const repo = makeRepo();
    const result = await repo.createItem({
      sku: "sku-edu-002",
      label: "Stylos bleus",
      category: "fournitures",
      unit: "box",
      quantityOnHand: 30,
      reorderLevel: -5,
      unitCost: 12.5,
      location: "WH-B",
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["inventory_items"][0];
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["sku"]).toBe("SKU-EDU-002");
    expect(row["name"]).toBe("Stylos bleus");
    expect(row["quantity_on_hand"]).toBe(30);
    expect(row["reorder_level"]).toBe(0); // clamped
    expect(result.ok && result.value.label).toBe("Stylos bleus");
  });

  it("2. transact() updates the item + writes the frozen before/after audit row", async () => {
    fakeClient.tables["inventory_items"] = [itemRow()];
    const repo = makeRepo();
    const tx = await repo.transact({
      itemId: "11111111-0000-0000-0000-000000000001",
      type: "dispatch",
      delta: -50,
      reason: "Distrib classes",
      actorId: WORKER,
      actorName: "Rachid Magasinier",
      reference: "PR-2026-0001",
    });
    expect(tx.ok).toBe(true);
    expect(fakeClient.tables["inventory_items"][0]["quantity_on_hand"]).toBe(100);
    const txRow = fakeClient.tables["inventory_transactions"][0];
    expect(txRow["item_id"]).toBe("11111111-0000-0000-0000-000000000001");
    expect(txRow["transaction_type"]).toBe("dispatch");
    expect(txRow["quantity"]).toBe(-50);
    expect(txRow["quantity_before"]).toBe(150);
    expect(txRow["quantity_after"]).toBe(100);
    expect(txRow["performed_by_name"]).toBe("Rachid Magasinier");
    expect(tx.ok && tx.value.quantityAfter).toBe(100);
    expect(tx.ok && tx.value.itemSku).toBe("SKU-EDU-001");
  });

  it("3. transact() validation: delta 0 / non-UUID item / unknown type rejected", async () => {
    fakeClient.tables["inventory_items"] = [itemRow()];
    const repo = makeRepo();
    const r1 = await repo.transact({ itemId: "11111111-0000-0000-0000-000000000001", type: "adjust", delta: 0, reason: null, actorId: WORKER, actorName: "R", reference: null });
    expect(r1.ok).toBe(false);
    const r2 = await repo.transact({ itemId: "item-mock-1", type: "adjust", delta: 5, reason: null, actorId: WORKER, actorName: "R", reference: null });
    expect(r2.ok).toBe(false);
    const r3 = await repo.transact({ itemId: "11111111-0000-0000-0000-000000000001", type: "teleport" as never, delta: 5, reason: null, actorId: WORKER, actorName: "R", reference: null });
    expect(r3.ok).toBe(false);
    expect(fakeClient.tables["inventory_transactions"] ?? []).toHaveLength(0);
  });

  it("4. deleteItem() is a SOFT delete — the row vanishes from reads", async () => {
    fakeClient.tables["inventory_items"] = [itemRow()];
    const repo = makeRepo();
    const del = await repo.deleteItem("11111111-0000-0000-0000-000000000001");
    expect(del.ok).toBe(true);
    expect(fakeClient.tables["inventory_items"][0]["deleted_at"]).toBeTruthy();
    const obs = repo.observeItems();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs.get()).toHaveLength(0); // the is(deleted_at, null) filter
  });

  it("5. scan() finds by sku (adds a scan movement) or creates the item", async () => {
    fakeClient.tables["inventory_items"] = [itemRow()];
    const repo = makeRepo();
    const known = await repo.scan({
      sku: "sku-edu-001", label: "Cahiers", category: "fournitures", unit: "piece",
      quantity: 25, actorId: WORKER, actorName: "Rachid",
    });
    expect(known.ok).toBe(true);
    expect(known.ok && known.value.quantityOnHand).toBe(175);
    expect(fakeClient.tables["inventory_transactions"][0]["transaction_type"]).toBe("scan");

    const unknown = await repo.scan({
      sku: "SKU-NEW-9", label: "Gommes", category: "fournitures", unit: "piece",
      quantity: 10, actorId: WORKER, actorName: "Rachid",
    });
    expect(unknown.ok).toBe(true);
    expect(fakeClient.tables["inventory_items"].map((r) => r["sku"])).toContain("SKU-NEW-9");
  });

  it("6. read mapping: label↔name, category folds to autre, tx actor fields", async () => {
    fakeClient.tables["inventory_items"] = [
      itemRow({ id: "i-a", category: "unknown_cat", quantity_on_hand: "12.5" }),
    ];
    fakeClient.tables["inventory_transactions"] = [
      {
        id: "tx-1", tenant_id: TENANT, item_id: "i-a", transaction_type: "damage",
        quantity: -3, unit_cost: 45, total_cost: 135, reference_type: null, reference_id: null,
        performed_by: WORKER, performed_by_name: "Rachid", note: "Avarie eau",
        transaction_at: "2026-09-07T09:00:00Z", created_at: "2026-09-07T09:00:00Z",
        quantity_before: 15, quantity_after: 12,
      },
    ];
    const repo = makeRepo();
    const items = repo.observeItems();
    const txs = repo.observeTransactions();
    await new Promise((r) => setTimeout(r, 20));
    expect(items.get()).toHaveLength(1);
    expect(items.get()[0].category).toBe("autre");
    expect(items.get()[0].quantityOnHand).toBe(12.5);
    expect(items.get()[0].label).toBe("Cahiers 200 pages");
    expect(txs.get()).toHaveLength(1);
    expect(txs.get()[0].type).toBe("damage");
    expect(txs.get()[0].delta).toBe(-3);
    expect(txs.get()[0].quantityBefore).toBe(15);
    expect(txs.get()[0].quantityAfter).toBe(12);
    expect(txs.get()[0].actorName).toBe("Rachid");
    expect(txs.get()[0].reason).toBe("Avarie eau");
    const byItem = repo.observeTransactionsByItem("i-a").get();
    expect(byItem).toHaveLength(1);
  });

  it("7. persistence-across-restart + source scans", async () => {
    fakeClient.tables["inventory_items"] = [itemRow()];
    const repo1 = makeRepo();
    repo1.observeItems();
    await new Promise((r) => setTimeout(r, 20));
    const repo2 = makeRepo();
    const obs = repo2.observeItems();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs.get()).toHaveLength(1);

    const wiring = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/supabase-repositories.ts"),
      "utf8",
    );
    expect(wiring).toContain("inventory, // T-240");
    const migration = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0084_operations_display_names.sql"),
      "utf8",
    );
    expect(migration).toContain("quantity_before");
    expect(migration).toContain("quantity_after");
    expect(migration).toContain("performed_by_name");
  });
});
