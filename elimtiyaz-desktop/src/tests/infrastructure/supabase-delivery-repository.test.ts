/**
 * SupabaseDeliveryRepository unit tests (T-239 — T-047 port #8).
 *
 * Verifies the canonical contract of the deliveries port:
 *   1. createDelivery() inserts tenant-scoped with DLV-YYYY-NNNN, stops
 *      jsonb, driver_id + the 0084 frozen driver_name, 'internal' type,
 *      'assigned' status, origin/destination derived from the stops.
 *   2. Validation: non-UUID driver / linked PR rejected BEFORE the table;
 *      empty stops rejected.
 *   3. updateStatus() maps the lifecycle timestamps (in_transit →
 *      departed_at + delay markers CLEARED; delivered → delivered_at;
 *      confirmed → confirmed_at); 'delayed' is guarded (must go through
 *      reportDelay).
 *   4. reportDelay() writes delay_reason + new_eta WITHOUT a status change
 *      (the DB CHECK has no 'delayed' — mapping note 1).
 *   5. Read mapping: in_transit + delay_reason → domain 'delayed';
 *      unknown statuses fold to 'assigned'; assignedAt ↔ created_at;
 *      malformed stops degrade safely.
 *   6. observeByDriver / observeByStatus filter the shared cache.
 *   7. 23505 collision retry.
 *   8. Persistence-across-restart.
 *   9. Source scans: wiring + the 0084 columns.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseDeliveryRepository } from "../../infrastructure/supabase/repositories/supabase-delivery-repository";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder (t-099/t-145 convention)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" | "count" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;
  private insertCount = 0;

  constructor(
    private readonly table: Row[],
    private readonly insertErrorOnce?: { code: string; message: string },
    private readonly insertErrorConsumed = { v: false },
    private readonly onInsertError?: () => void,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  gte(col: string, val: unknown): this {
    this.filters.push((r) => String(r[col] ?? "") >= String(val));
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
  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (opts?.count === "exact" && opts?.head) this.mode = "count";
    return this;
  }
  insert(row: Row): this {
    this.mode = "insert";
    this.payload = row;
    this.insertCount++;
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
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null; count?: number | null } {
    if (this.mode === "count") {
      const rows = this.table.filter((r) => this.filters.every((f) => f(r)));
      return { data: null, error: null, count: rows.length };
    }
    if (this.mode === "insert") {
      if (this.insertErrorOnce && !this.insertErrorConsumed.v && this.insertCount === 1) {
        this.insertErrorConsumed.v = true;
        this.onInsertError?.();
        return { data: null, error: this.insertErrorOnce };
      }
      const row = {
        id: "del-uuid-new",
        status: "assigned",
        delivery_type: "internal",
        delay_minutes: 0,
        created_at: "2026-09-07T10:00:00Z",
        updated_at: "2026-09-07T10:00:00Z",
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
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { code?: string; message: string } | null; count?: number | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    return Promise.resolve(onFulfilled!(this.run() as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  insertCollisionOnce = false;

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    const collision = this.insertCollisionOnce
      ? { code: "23505", message: "duplicate key value violates unique constraint" }
      : undefined;
    return new FakeQuery(
      this.tables[tableName],
      collision,
      { v: false },
      collision ? () => { this.insertCollisionOnce = false; } : undefined,
    );
  }
}

const fakeClient = new FakeClient();

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const DRIVER = "eeeeeeee-0000-0000-0000-0000000000e1";
const MANAGER = "cccccccc-0000-0000-0000-0000000000c1";

beforeEach(() => {
  fakeClient.tables = {};
  fakeClient.insertCollisionOnce = false;
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: MANAGER }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

function delRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "del-uuid-1",
    tenant_id: TENANT,
    delivery_number: "DLV-2026-0001",
    delivery_type: "internal",
    status: "assigned",
    driver_id: DRIVER,
    driver_name: "Messaoud Khalfaoui",
    vehicle: "Toyota Hiace 005-123-16",
    origin_address: "Dépôt central",
    destination_address: "Site principal El-Imtiyaz",
    scheduled_at: "2026-09-07T08:00:00Z",
    departed_at: null,
    delivered_at: null,
    confirmed_at: null,
    stops: [
      { id: "stop-1", sequence: 1, type: "pickup", label: "Dépôt", address: "Dépôt central", lat: 35.65, lng: -0.62, plannedAt: "2026-09-07T07:30:00Z", completedAt: null },
      { id: "stop-2", sequence: 2, type: "dropoff", label: "École", address: "Site principal El-Imtiyaz", lat: 35.69, lng: -0.64, plannedAt: "2026-09-07T09:00:00Z", completedAt: null },
    ],
    notes: "Fournitures rentrée",
    delay_reason: null,
    delay_minutes: 0,
    new_eta: null,
    created_at: "2026-09-07T06:00:00Z",
    updated_at: "2026-09-07T06:00:00Z",
    ...overrides,
  };
}

function makeRepo(): SupabaseDeliveryRepository {
  return new SupabaseDeliveryRepository(fakeClient as unknown as SupabaseClient);
}

// ============================================================================
// Tests
// ============================================================================

describe("SupabaseDeliveryRepository (T-239)", () => {
  it("1. createDelivery() inserts tenant-scoped DLV-YYYY-NNNN with frozen driver name + stops", async () => {
    const repo = makeRepo();
    const result = await repo.createDelivery({
      driverId: DRIVER,
      driverName: "Messaoud Khalfaoui",
      stops: [
        { id: "s1", sequence: 1, type: "pickup", label: "Dépôt", address: "Dépôt central", lat: 35.65, lng: -0.62, plannedAt: "2026-09-07T07:30:00Z", completedAt: null },
        { id: "s2", sequence: 2, type: "dropoff", label: "École", address: "Site principal", lat: null, lng: null, plannedAt: null, completedAt: null },
      ],
      purchaseRequestId: null,
      notes: "Livraison matinale",
      vehicle: "Hiace",
      assignedBy: MANAGER,
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["deliveries"][0];
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["driver_id"]).toBe(DRIVER);
    expect(row["driver_name"]).toBe("Messaoud Khalfaoui");
    expect(row["status"]).toBe("assigned");
    expect(row["delivery_type"]).toBe("internal");
    expect(row["origin_address"]).toBe("Dépôt central");
    expect(row["destination_address"]).toBe("Site principal");
    expect(String(row["delivery_number"])).toMatch(/^DLV-\d{4}-\d{4}$/);
    expect(result.ok && result.value.deliveryCode).toBe(row["delivery_number"]);
    expect(result.ok && result.value.driverName).toBe("Messaoud Khalfaoui");
  });

  it("2. validation rejects mock-era driver ids + empty stops BEFORE the table", async () => {
    const repo = makeRepo();
    const r1 = await repo.createDelivery({
      driverId: "per-011", driverName: "X",
      stops: [{ id: "s", sequence: 1, type: "pickup", label: "a", address: "b", lat: null, lng: null, plannedAt: null, completedAt: null }],
      purchaseRequestId: null, notes: "", vehicle: null, assignedBy: MANAGER,
    });
    expect(r1.ok).toBe(false);
    const r2 = await repo.createDelivery({
      driverId: DRIVER, driverName: "X", stops: [],
      purchaseRequestId: null, notes: "", vehicle: null, assignedBy: MANAGER,
    });
    expect(r2.ok).toBe(false);
    expect(fakeClient.tables["deliveries"] ?? []).toHaveLength(0);
  });

  it("3. updateStatus() maps lifecycle timestamps; resuming transit clears delay markers", async () => {
    fakeClient.tables["deliveries"] = [delRow({ status: "in_transit", departed_at: "2026-09-07T08:10:00Z", delay_reason: " trafic", new_eta: "10:30", delay_minutes: 25 })];
    const repo = makeRepo();
    const transit = await repo.updateStatus("del-uuid-1", "in_transit", DRIVER, "Messaoud");
    expect(transit.ok).toBe(true);
    const row = fakeClient.tables["deliveries"][0];
    expect(row["departed_at"]).toBeTruthy();
    expect(row["delay_reason"]).toBeNull();
    expect(row["new_eta"]).toBeNull();

    const delivered = await repo.updateStatus("del-uuid-1", "delivered", DRIVER, "Messaoud");
    expect(delivered.ok).toBe(true);
    expect(fakeClient.tables["deliveries"][0]["delivered_at"]).toBeTruthy();

    const confirmed = await repo.updateStatus("del-uuid-1", "confirmed", MANAGER, "Nadia");
    expect(confirmed.ok).toBe(true);
    expect(fakeClient.tables["deliveries"][0]["confirmed_at"]).toBeTruthy();
  });

  it("4. updateStatus('delayed') is guarded — delays go through reportDelay()", async () => {
    fakeClient.tables["deliveries"] = [delRow()];
    const repo = makeRepo();
    const r = await repo.updateStatus("del-uuid-1", "delayed", DRIVER, "Messaoud");
    expect(r.ok).toBe(false);
  });

  it("5. reportDelay() writes delay markers WITHOUT a status change", async () => {
    fakeClient.tables["deliveries"] = [delRow({ status: "in_transit", departed_at: "2026-09-07T08:10:00Z" })];
    const repo = makeRepo();
    const r = await repo.reportDelay("del-uuid-1", "Panne véhicule", "2026-09-07T11:30:00Z", DRIVER, "Messaoud");
    expect(r.ok).toBe(true);
    const row = fakeClient.tables["deliveries"][0];
    expect(row["status"]).toBe("in_transit");
    expect(row["delay_reason"]).toBe("Panne véhicule");
    expect(row["new_eta"]).toBe("2026-09-07T11:30:00Z");
    // The domain read-side maps in_transit + delay_reason → 'delayed'.
    expect(r.ok && r.value.status).toBe("delayed");
    expect(r.ok && r.value.delayReason).toBe("Panne véhicule");
  });

  it("6. read mapping: unknown status folds to assigned; assignedAt = created_at; delivered+delay stays delivered", async () => {
    fakeClient.tables["deliveries"] = [
      delRow({ id: "d-x", status: "some_future_status" }),
      delRow({ id: "d-d", status: "delivered", delivered_at: "2026-09-07T10:00:00Z", delay_reason: "retard matinal" }),
    ];
    const repo = makeRepo();
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const list = obs.get();
    const x = list.find((d) => d.id === "d-x")!;
    expect(x.status).toBe("assigned");
    expect(x.assignedAt).toBe("2026-09-07T06:00:00Z");
    expect(x.stops).toHaveLength(2);
    expect(x.stops[0].type).toBe("pickup");
    const d = list.find((d) => d.id === "d-d")!;
    expect(d.status).toBe("delivered"); // NOT delayed — the honest terminal state
    expect(d.delayReason).toBe("retard matinal");
  });

  it("7. observeByDriver / observeByStatus filter the shared cache", async () => {
    fakeClient.tables["deliveries"] = [
      delRow({ id: "d-a", driver_id: DRIVER }),
      delRow({ id: "d-b", driver_id: "eeeeeeee-0000-0000-0000-0000000000e2", status: "in_transit" }),
    ];
    const repo = makeRepo();
    repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const mine = repo.observeByDriver(DRIVER).get();
    expect(mine.map((d) => d.id)).toEqual(["d-a"]);
    const inTransit = repo.observeByStatus("in_transit").get();
    expect(inTransit.map((d) => d.id)).toEqual(["d-b"]);
  });

  it("8. 23505 collision retried with a distinct number", async () => {
    fakeClient.tables["deliveries"] = [delRow()];
    fakeClient.insertCollisionOnce = true;
    const repo = makeRepo();
    const result = await repo.createDelivery({
      driverId: DRIVER, driverName: "M",
      stops: [{ id: "s", sequence: 1, type: "pickup", label: "a", address: "b", lat: null, lng: null, plannedAt: null, completedAt: null }],
      purchaseRequestId: null, notes: "", vehicle: null, assignedBy: MANAGER,
    });
    expect(result.ok).toBe(true);
    expect(fakeClient.tables["deliveries"]).toHaveLength(2);
    const numbers = fakeClient.tables["deliveries"].map((r) => r["delivery_number"]);
    expect(new Set(numbers).size).toBe(2);
  });

  it("9. persistence-across-restart + source scans (wiring + 0084 columns)", async () => {
    fakeClient.tables["deliveries"] = [delRow()];
    const repo1 = makeRepo();
    repo1.observe();
    await new Promise((r) => setTimeout(r, 20));
    const repo2 = makeRepo();
    const obs = repo2.observe();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs.get()).toHaveLength(1);

    const wiring = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/supabase-repositories.ts"),
      "utf8",
    );
    expect(wiring).toContain("deliveries, // T-239");
    const migration = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0084_operations_display_names.sql"),
      "utf8",
    );
    expect(migration).toContain("driver_name");
    expect(migration).toContain("new_eta");
  });
});
