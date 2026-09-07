/**
 * SupabasePurchaseRequestRepository unit tests (T-238 — T-047 port #7).
 *
 * Verifies the canonical contract of the purchaseRequests port:
 *   1. createPurchaseRequest() inserts tenant-scoped with the PR-YYYY-NNNN
 *      request_number (count-then-insert), the domain status/priority
 *      unions, lines jsonb, the computed total, requester_id + the 0084
 *      frozen requested_by_name, and the 0011 default status 'draft'.
 *   2. Validation: non-UUID requester/supplier/department (mock-era ids)
 *      rejected BEFORE the round-trip; empty title/lines rejected;
 *      unknown priority rejected (mirrors the 0011 CHECK).
 *   3. updateStatus() writes the transition columns in ONE update
 *      (approved → approved_by/approved_at/approved_by_name;
 *      ordered → ordered_at; received → received_at; cancelled/rejected →
 *      rejected_reason), tenant-scoped.
 *   4. cancel() delegates to updateStatus('cancelled') with the reason.
 *   5. Read mapping: requestCode ↔ request_number, unknown status folds
 *      to draft, numeric string coercion, requestedByName degrades to —.
 *   6. Derived filters (observeByRequester / observeByStatus) work off the
 *      shared reactive cache.
 *   7. 23505 collision retry (count-then-insert re-counts).
 *   8. Persistence-across-restart: a second instance sees the same rows.
 *   9. Source scans: the wiring overrides the purchaseRequests slot; the
 *      0084 migration declares the frozen-name columns.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePurchaseRequestRepository } from "../../infrastructure/supabase/repositories/supabase-purchase-request-repository";
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
    /** When set, the FIRST insert fails once with this error (collision simulation). */
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
        id: "pr-uuid-new",
        status: "draft",
        priority: "medium",
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
const BUYER = "bbbbbbbb-0000-0000-0000-0000000000b1";
const MANAGER = "cccccccc-0000-0000-0000-0000000000c1";
const SUPPLIER = "dddddddd-0000-0000-0000-0000000000d1";

beforeEach(() => {
  fakeClient.tables = {};
  fakeClient.insertCollisionOnce = false;
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: BUYER }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

function prRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "pr-uuid-1",
    tenant_id: TENANT,
    request_number: "PR-2026-0001",
    title: "Fournitures rentrée",
    description: "Cahiers + stylos",
    requester_id: BUYER,
    requested_by_name: "Yacine Acheteur",
    department_id: null,
    status: "draft",
    priority: "high",
    expected_delivery_date: null,
    total_amount: 12500,
    lines: [
      { id: "l1", description: "Cahiers", quantity: 250, unit: "pièce", estimatedUnitPrice: 40 },
      { id: "l2", description: "Stylos", quantity: 500, unit: "pièce", estimatedUnitPrice: 5 },
    ],
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    rejected_reason: null,
    supplier_id: SUPPLIER,
    ordered_at: null,
    received_at: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function makeRepo(): SupabasePurchaseRequestRepository {
  return new SupabasePurchaseRequestRepository(fakeClient as unknown as SupabaseClient);
}

// ============================================================================
// Tests
// ============================================================================

describe("SupabasePurchaseRequestRepository (T-238)", () => {
  it("1. createPurchaseRequest() inserts tenant-scoped PR-YYYY-NNNN with frozen name + computed total", async () => {
    const repo = makeRepo();
    const result = await repo.createPurchaseRequest({
      title: "Manuels scolaires",
      description: "Commande annuelle",
      priority: "urgent",
      supplierId: SUPPLIER,
      departmentId: null,
      lines: [
        { id: "l1", description: "Manuel maths", quantity: 100, unit: "pièce", estimatedUnitPrice: 450 },
        { id: "l2", description: "Manuel arabe", quantity: 100, unit: "pièce", estimatedUnitPrice: 380 },
      ],
      requestedBy: BUYER,
      requestedByName: "Yacine Acheteur",
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["purchase_requests"][0];
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["requester_id"]).toBe(BUYER);
    expect(row["requested_by_name"]).toBe("Yacine Acheteur");
    expect(row["status"]).toBe("draft");
    expect(row["priority"]).toBe("urgent");
    expect(row["total_amount"]).toBe(83000);
    expect(String(row["request_number"])).toMatch(/^PR-\d{4}-\d{4}$/);
    expect(result.ok && result.value.requestCode).toBe(row["request_number"]);
    expect(result.ok && result.value.requestedByName).toBe("Yacine Acheteur");
  });

  it("2. validation short-circuits mock-era ids + empty payloads BEFORE the table", async () => {
    const repo = makeRepo();
    const r1 = await repo.createPurchaseRequest({
      title: "X", description: "", priority: "low", supplierId: null, departmentId: null,
      lines: [{ id: "l", description: "a", quantity: 1, unit: "u", estimatedUnitPrice: 10 }],
      requestedBy: "buyer-mock-1", requestedByName: "Y",
    });
    expect(r1.ok).toBe(false);
    expect(fakeClient.tables["purchase_requests"] ?? []).toHaveLength(0);

    const r2 = await repo.createPurchaseRequest({
      title: "Sans lignes", description: "", priority: "low", supplierId: null, departmentId: null,
      lines: [], requestedBy: BUYER, requestedByName: "Y",
    });
    expect(r2.ok).toBe(false);

    const r3 = await repo.createPurchaseRequest({
      title: "Priorité inconnue", description: "", priority: "asap" as never, supplierId: null, departmentId: null,
      lines: [{ id: "l", description: "a", quantity: 1, unit: "u", estimatedUnitPrice: 10 }],
      requestedBy: BUYER, requestedByName: "Y",
    });
    expect(r3.ok).toBe(false);
    expect(fakeClient.tables["purchase_requests"] ?? []).toHaveLength(0);
  });

  it("3. updateStatus() writes the transition columns in ONE update", async () => {
    fakeClient.tables["purchase_requests"] = [prRow()];
    const repo = makeRepo();
    const approved = await repo.updateStatus("pr-uuid-1", "approved", MANAGER, "Nadia Manager", "Bon prix");
    expect(approved.ok).toBe(true);
    const row = fakeClient.tables["purchase_requests"][0];
    expect(row["status"]).toBe("approved");
    expect(row["approved_by"]).toBe(MANAGER);
    expect(row["approved_by_name"]).toBe("Nadia Manager");
    expect(row["approved_at"]).toBeTruthy();
    expect(row["rejected_reason"]).toBe("Bon prix");

    const ordered = await repo.updateStatus("pr-uuid-1", "ordered", MANAGER, "Nadia Manager");
    expect(ordered.ok).toBe(true);
    expect(fakeClient.tables["purchase_requests"][0]["ordered_at"]).toBeTruthy();

    const received = await repo.updateStatus("pr-uuid-1", "received", MANAGER, "Nadia Manager");
    expect(received.ok).toBe(true);
    expect(fakeClient.tables["purchase_requests"][0]["received_at"]).toBeTruthy();
  });

  it("4. cancel() delegates to updateStatus('cancelled') carrying the reason", async () => {
    fakeClient.tables["purchase_requests"] = [prRow()];
    const repo = makeRepo();
    const cancelled = await repo.cancel("pr-uuid-1", "Budget reporté", MANAGER, "Nadia Manager");
    expect(cancelled.ok).toBe(true);
    const row = fakeClient.tables["purchase_requests"][0];
    expect(row["status"]).toBe("cancelled");
    expect(row["rejected_reason"]).toBe("Budget reporté");
    expect(cancelled.ok && cancelled.value.cancellationReason).toBe("Budget reporté");
  });

  it("5. read mapping: unknown status folds to draft; numeric strings coerce; name degrades", async () => {
    fakeClient.tables["purchase_requests"] = [
      prRow({ status: "some_future_status", total_amount: "12500.50", requested_by_name: null }),
    ];
    const repo = makeRepo();
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const list = obs.get();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("draft");
    expect(list[0].totalAmount).toBe(12500.5);
    expect(list[0].requestedByName).toBe("—");
    expect(list[0].lines).toHaveLength(2);
    expect(list[0].lines[0].quantity).toBe(250);
  });

  it("6. observeByRequester / observeByStatus filter the shared cache", async () => {
    fakeClient.tables["purchase_requests"] = [
      prRow({ id: "pr-a", requester_id: BUYER, status: "submitted" }),
      prRow({ id: "pr-b", requester_id: MANAGER, status: "approved" }),
    ];
    const repo = makeRepo();
    repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const mine = repo.observeByRequester(BUYER).get();
    expect(mine.map((r) => r.id)).toEqual(["pr-a"]);
    const approved = repo.observeByStatus("approved").get();
    expect(approved.map((r) => r.id)).toEqual(["pr-b"]);
  });

  it("7. 23505 collision retried with a re-counted number", async () => {
    fakeClient.tables["purchase_requests"] = [prRow()];
    fakeClient.insertCollisionOnce = true;
    const repo = makeRepo();
    const result = await repo.createPurchaseRequest({
      title: "Après collision", description: "", priority: "low", supplierId: null, departmentId: null,
      lines: [{ id: "l", description: "a", quantity: 1, unit: "u", estimatedUnitPrice: 10 }],
      requestedBy: BUYER, requestedByName: "Yacine Acheteur",
    });
    expect(result.ok).toBe(true);
    expect(fakeClient.tables["purchase_requests"]).toHaveLength(2);
    const numbers = fakeClient.tables["purchase_requests"].map((r) => r["request_number"]);
    // The retry re-counts (1 existing + attempt bump) — distinct from the collided PR-2026-0002.
    expect(new Set(numbers).size).toBe(2);
  });

  it("8. persistence-across-restart: a second instance sees the same rows", async () => {
    fakeClient.tables["purchase_requests"] = [prRow()];
    const repo1 = makeRepo();
    repo1.observe();
    await new Promise((r) => setTimeout(r, 20));
    const repo2 = makeRepo();
    const obs = repo2.observe();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs.get()).toHaveLength(1);
    expect(obs.get()[0].requestCode).toBe("PR-2026-0001");
  });

  it("9. source scans: wiring overrides the slot; 0084 declares the frozen columns", () => {
    const wiring = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/supabase-repositories.ts"),
      "utf8",
    );
    expect(wiring).toContain("purchaseRequests, // T-238");
    const migration = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0084_operations_display_names.sql"),
      "utf8",
    );
    expect(migration).toContain("requested_by_name");
    expect(migration).toContain("approved_by_name");
  });
});
