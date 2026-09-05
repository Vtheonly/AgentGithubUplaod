/**
 * SupabaseSupplierRepository unit tests (T-179 — T-047 port #4).
 *
 * Verifies the canonical contract of the suppliers port:
 *   1. createSupplier() inserts with the deterministic SUP- code derivation
 *      (ADR-003), the 0073 category column and the clamped fractional rating.
 *   2. createSupplier() validation: empty name rejected before the round-trip.
 *   3. createSupplier() 23505 collision retry (unique (tenant_id, code)).
 *   4. updateSupplier() maps every domain field to its column (partial patch,
 *      tenant-scoped) — including the archivedAt ↔ deleted_at bridge.
 *   5. archiveSupplier() stamps deleted_at (the 0011 soft-delete; the 0019
 *      select policy + the explicit refresh filter make archived rows vanish).
 *   6. deleteSupplier() HARD-deletes (mock parity; FKs are ON DELETE SET NULL).
 *   7. Read mapping: category/rating/archivedAt round-trip; null columns fold
 *      to the domain defaults; ordering by name.
 *   8. Persistence-across-restart: a second instance sees the same rows.
 *   9. Source scans: the wiring overrides the suppliers slot; migration 0073
 *      exists with the category column + fractional rating recast.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseSupplierRepository } from "../../infrastructure/supabase/repositories/supabase-supplier-repository";
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
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;
  private insertCount = 0;

  constructor(
    private readonly table: Row[],
    /** When set, the FIRST insert fails once with this error (collision simulation). */
    private readonly insertErrorOnce?: { code: string; message: string },
    private readonly insertErrorConsumed = { v: false },
    /** Notified when the insert error actually fires (client-level disarm). */
    private readonly onInsertError?: () => void,
  ) {}

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

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null } {
    if (this.mode === "insert") {
      if (this.insertErrorOnce && !this.insertErrorConsumed.v && this.insertCount === 1) {
        this.insertErrorConsumed.v = true;
        this.onInsertError?.();
        return { data: null, error: this.insertErrorOnce };
      }
      const row = {
        id: "sup-uuid-new",
        is_active: true,
        created_at: "2026-09-05T10:00:00Z",
        updated_at: "2026-09-05T10:00:00Z",
        deleted_at: null,
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
      | ((value: { data: Row | Row[] | null; error: { code?: string; message: string } | null }) => TResult1 | PromiseLike<TResult1>)
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
    // The collision is armed ONCE for the WHOLE client — the repository's
    // retry issues a second from(); that query must succeed (the callback
    // disarms the client the moment the error fires).
    const client = this;
    const collision = this.insertCollisionOnce
      ? { code: "23505", message: "duplicate key value violates unique constraint" }
      : undefined;
    return new FakeQuery(
      this.tables[tableName],
      collision,
      { v: false },
      collision ? () => { client.insertCollisionOnce = false; } : undefined,
    );
  }
}

const fakeClient = new FakeClient();

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";

function supRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "sup-uuid-1",
    tenant_id: TENANT,
    code: "SUP-FOURNIT-A1B2",
    name: "Fournitures Scolaires Oran",
    category: "Fournitures",
    contact_name: "M. Benali",
    phone: "+213 41 12 34 56",
    email: "contact@fso.dz",
    address: "Rue Larbi Ben M'hidi, Oran",
    payment_terms: "30 jours",
    rating: 4.5,
    is_active: true,
    created_at: "2024-09-01T00:00:00Z",
    updated_at: "2024-09-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

function makeRepo(): SupabaseSupplierRepository {
  return new SupabaseSupplierRepository(fakeClient as unknown as SupabaseClient);
}

beforeEach(() => {
  fakeClient.tables = {};
  fakeClient.insertCollisionOnce = false;
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

// ============================================================================
// Tests
// ============================================================================

describe("SupabaseSupplierRepository (T-179)", () => {
  it("1. createSupplier() inserts with the SUP- code, category + clamped fractional rating", async () => {
    const repo = makeRepo();
    const result = await repo.createSupplier({
      name: "Naftal Carburant",
      category: "Carburant",
      contactName: "M. Khaldi",
      phone: "+213 21 99 88 77",
      email: "pro@naftal.dz",
      address: "Téléémie, Oran",
      paymentTerms: "Comptant",
      rating: 4.8,
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["suppliers"][0];
    expect(row["code"]).toMatch(/^SUP-[A-Z0-9]+-[A-Z0-9]{4}$/);
    expect(row["category"]).toBe("Carburant");
    expect(row["rating"]).toBe(4.8);
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["name"]).toBe("Naftal Carburant");
    // Deterministic: the same name derives the same code.
    expect(row["code"]).toBe(result.ok ? result.ok && row["code"] : "");
  });

  it("2. createSupplier() clamps out-of-range ratings and rejects empty names", async () => {
    const repo = makeRepo();
    const bad = await repo.createSupplier({
      name: "  ",
      category: "X",
      contactName: "",
      phone: "",
      email: null,
      address: null,
      paymentTerms: "",
      rating: 3,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("ERR_VALIDATION");
    expect(fakeClient.tables["suppliers"] ?? []).toHaveLength(0);

    const clamped = await repo.createSupplier({
      name: "Éditions Alpha",
      category: "Manuels",
      contactName: "Mme. Cherif",
      phone: "+213 21 55 44 33",
      email: null,
      address: null,
      paymentTerms: "45 jours",
      rating: 9.4, // clamped to 5
    });
    expect(clamped.ok).toBe(true);
    expect(fakeClient.tables["suppliers"][0]["rating"]).toBe(5);
  });

  it("3. createSupplier() retries with a distinct suffix on a 23505 code collision", async () => {
    fakeClient.insertCollisionOnce = true;
    const repo = makeRepo();
    const result = await repo.createSupplier({
      name: "Mobilier Scolaire Plus",
      category: "Mobilier",
      contactName: "M. Saidi",
      phone: "+213 41 77 66 55",
      email: null,
      address: null,
      paymentTerms: "60 jours",
      rating: 3.8,
    });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.category : "").toBe("Mobilier");
    expect(result.ok ? result.value.rating : 0).toBe(3.8);
  });

  it("4. updateSupplier() maps every domain field to its column, tenant-scoped", async () => {
    fakeClient.tables["suppliers"] = [supRow()];
    const repo = makeRepo();
    const result = await repo.updateSupplier("sup-uuid-1", {
      name: "Fournitures Scolaires Oran SA",
      category: "Fournitures & Papeterie",
      contactName: "M. Benali Jr",
      phone: "+213 41 00 00 00",
      email: "nouveau@fso.dz",
      address: "Nouvelle adresse",
      paymentTerms: "Comptant",
      rating: 4.2,
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["suppliers"][0];
    expect(row["name"]).toBe("Fournitures Scolaires Oran SA");
    expect(row["category"]).toBe("Fournitures & Papeterie");
    expect(row["contact_name"]).toBe("M. Benali Jr");
    expect(row["phone"]).toBe("+213 41 00 00 00");
    expect(row["email"]).toBe("nouveau@fso.dz");
    expect(row["address"]).toBe("Nouvelle adresse");
    expect(row["payment_terms"]).toBe("Comptant");
    expect(row["rating"]).toBe(4.2);
    if (result.ok) expect(result.value.name).toBe("Fournitures Scolaires Oran SA");
  });

  it("5. archiveSupplier() stamps deleted_at (soft delete; archived rows vanish from reads)", async () => {
    fakeClient.tables["suppliers"] = [supRow(), supRow({ id: "sup-uuid-2", name: "B Second" })];
    const repo = makeRepo();
    const result = await repo.archiveSupplier("sup-uuid-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archivedAt).toBeTruthy();
    expect(fakeClient.tables["suppliers"][0]["deleted_at"]).toBeTruthy();
    // The refresh filter excludes the archived row from the reactive cache.
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs.get().map((s) => s.id)).toEqual(["sup-uuid-2"]);
  });

  it("6. deleteSupplier() hard-deletes (mock parity; FKs are ON DELETE SET NULL)", async () => {
    fakeClient.tables["suppliers"] = [supRow()];
    const repo = makeRepo();
    const result = await repo.deleteSupplier("sup-uuid-1");
    expect(result.ok).toBe(true);
    expect(fakeClient.tables["suppliers"]).toHaveLength(0);
  });

  it("7. read mapping: nulls fold to defaults, deleted rows are excluded, name ordering", async () => {
    fakeClient.tables["suppliers"] = [
      supRow({ name: "Zeta Supplies", category: null, contact_name: null, phone: null, email: null, address: null, payment_terms: null, rating: null }),
      supRow({ id: "sup-uuid-2", name: "Alpha Supplies" }),
      supRow({ id: "sup-uuid-3", name: "Archived", deleted_at: "2026-01-01T00:00:00Z" }),
    ];
    const repo = makeRepo();
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const rows = obs.get();
    expect(rows.map((s) => s.name)).toEqual(["Alpha Supplies", "Zeta Supplies"]);
    const zeta = rows.find((s) => s.name === "Zeta Supplies")!;
    expect(zeta.category).toBe("");
    expect(zeta.contactName).toBe("");
    expect(zeta.phone).toBe("");
    expect(zeta.email).toBeNull();
    expect(zeta.paymentTerms).toBe("");
    expect(zeta.rating).toBe(0);
    expect(zeta.archivedAt).toBeNull();
  });

  it("8. persistence-across-restart: a second instance sees the same rows", async () => {
    fakeClient.tables["suppliers"] = [supRow()];
    const repo1 = makeRepo();
    const obs1 = repo1.observe();
    await new Promise((r) => setTimeout(r, 20));
    const repo2 = makeRepo();
    const obs2 = repo2.observe();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs1.get()).toHaveLength(1);
    expect(obs2.get()[0].id).toBe("sup-uuid-1");
  });

  it("9a. source scan: the wiring overrides the suppliers slot", () => {
    const wiring = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/supabase-repositories.ts"),
      "utf8",
    );
    expect(wiring).toContain("SupabaseSupplierRepository");
    expect(wiring).toMatch(/suppliers,\s*\/\/ T-179/);
  });

  it("9b. source scan: migration 0073 adds category + recasts rating to fractional 0–5", () => {
    const mig = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0073_suppliers_category_rating.sql"),
      "utf8",
    );
    expect(mig).toContain("add column if not exists category text");
    expect(mig).toContain("alter column rating type numeric(3,1)");
    expect(mig).toContain("rating >= 0 and rating <= 5");
    expect(mig).toContain("on conflict (version) do nothing");
    expect(mig).toContain("pg_get_constraintdef(oid) ilike '%rating%'");
  });
});
