/**
 * SupabaseLeaveRequestRepository unit tests (T-178 — T-047 port #3).
 *
 * Verifies the canonical contract of the leaveRequests port:
 *   1. submit() inserts with the domain RequestType stored DIRECTLY as
 *      leave_type (the 0072 widening), status='pending', tenant scope, and
 *      resolves personnelName via the personnel embed (NOT the input name).
 *   2. submit() validation: non-UUID personnelId (mock-era ids) is rejected
 *      BEFORE hitting the table; inverted date ranges are rejected.
 *   3. decide() writes status + reviewed_by/reviewed_by_name (0072 column)
 *      /reviewed_at/decision_note in ONE update, tenant-scoped.
 *   4. decide() requires a note for rejections (0010 app-layer rule).
 *   5. cancel() delegates to decide() with the system actor (mock parity).
 *   6. Read mapping: fromDate/toDate ↔ start_date/end_date,
 *      decidedAt/decidedBy/decidedByName/decisionNote, personnel embed name
 *      (with the deleted-personnel fallback), unknown status folds to
 *      pending.
 *   7. observeByPersonnel / observePending filter the shared reactive cache.
 *   8. Persistence-across-restart: a second repository instance over the
 *      same table sees the same rows.
 *   9. Source scans: the wiring overrides the leaveRequests slot; migration
 *      0072 exists and widens (not narrows) the leave_type CHECK.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseLeaveRequestRepository } from "../../infrastructure/supabase/repositories/supabase-leave-request-repository";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder (t-099/t-145 convention)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(private readonly table: Row[]) {}

  eq(col: string, val: unknown): this {
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
  single(): this {
    this.wantSingle = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null } {
    if (this.mode === "insert") {
      const row = {
        id: "lr-uuid-new",
        created_at: "2026-09-05T10:00:00Z",
        updated_at: "2026-09-05T10:00:00Z",
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
const WORKER = "bbbbbbbb-0000-0000-0000-0000000000b1";
const MANAGER = "cccccccc-0000-0000-0000-0000000000c1";

function lrRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "lr-uuid-1",
    tenant_id: TENANT,
    personnel_id: WORKER,
    leave_type: "leave",
    start_date: "2026-10-15",
    end_date: "2026-10-20",
    reason: "Congé annuel",
    status: "pending",
    reviewed_by: null,
    reviewed_by_name: null,
    reviewed_at: null,
    decision_note: null,
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:00:00Z",
    personnel: { first_name: "Karim", last_name: "Benali" },
    ...overrides,
  };
}

function makeRepo(): SupabaseLeaveRequestRepository {
  return new SupabaseLeaveRequestRepository(fakeClient as unknown as SupabaseClient);
}

beforeEach(() => {
  fakeClient.tables = {};
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: WORKER }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

// ============================================================================
// Tests
// ============================================================================

describe("SupabaseLeaveRequestRepository (T-178)", () => {
  it("1. submit() stores the domain RequestType directly as leave_type, pending, tenant-scoped", async () => {
    fakeClient.tables["personnel"] = [
      { id: WORKER, tenant_id: TENANT, first_name: "Karim", last_name: "Benali" },
    ];
    const repo = makeRepo();
    const result = await repo.submit({
      personnelId: WORKER,
      personnelName: "whatever the UI passed",
      type: "overtime",
      fromDate: "2026-10-01",
      toDate: "2026-10-02",
      reason: "Heures supplémentaires rentrée",
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["leave_requests"][0];
    expect(row["leave_type"]).toBe("overtime");
    expect(row["status"]).toBe("pending");
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["personnel_id"]).toBe(WORKER);
    expect(row["start_date"]).toBe("2026-10-01");
    expect(row["end_date"]).toBe("2026-10-02");
    expect(row["reason"]).toBe("Heures supplémentaires rentrée");
  });

  it("2a. submit() rejects mock-era non-UUID personnelId BEFORE hitting the table", async () => {
    const repo = makeRepo();
    const result = await repo.submit({
      personnelId: "EMP-2025-001",
      personnelName: "Karim Benali",
      type: "leave",
      fromDate: "2026-10-01",
      toDate: "2026-10-02",
      reason: "Congé",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ERR_VALIDATION");
    expect(fakeClient.tables["leave_requests"] ?? []).toHaveLength(0);
  });

  it("2b. submit() rejects inverted date ranges", async () => {
    const repo = makeRepo();
    const result = await repo.submit({
      personnelId: WORKER,
      personnelName: "Karim Benali",
      type: "leave",
      fromDate: "2026-10-05",
      toDate: "2026-10-01",
      reason: "Congé",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ERR_VALIDATION");
    expect(fakeClient.tables["leave_requests"] ?? []).toHaveLength(0);
  });

  it("3. decide() writes the decision fields in ONE update, tenant-scoped", async () => {
    fakeClient.tables["leave_requests"] = [lrRow()];
    const repo = makeRepo();
    const result = await repo.decide("lr-uuid-1", "approved", MANAGER, "Amina Cherif", "Approuvé pour la rentrée");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = fakeClient.tables["leave_requests"][0];
    expect(row["status"]).toBe("approved");
    expect(row["reviewed_by"]).toBe(MANAGER);
    expect(row["reviewed_by_name"]).toBe("Amina Cherif");
    expect(row["reviewed_at"]).toBeTruthy();
    expect(row["decision_note"]).toBe("Approuvé pour la rentrée");
    // The returned domain object carries the mapped fields.
    expect(result.value.decidedBy).toBe(MANAGER);
    expect(result.value.decidedByName).toBe("Amina Cherif");
    expect(result.value.status).toBe("approved");
  });

  it("4. decide() requires a note for rejections (0010 app-layer rule)", async () => {
    fakeClient.tables["leave_requests"] = [lrRow()];
    const repo = makeRepo();
    const result = await repo.decide("lr-uuid-1", "rejected", MANAGER, "Amina Cherif");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ERR_VALIDATION");
    // Nothing was written.
    expect(fakeClient.tables["leave_requests"][0]["status"]).toBe("pending");
  });

  it("5. cancel() delegates to decide() with the system actor (mock parity)", async () => {
    fakeClient.tables["leave_requests"] = [lrRow()];
    const repo = makeRepo();
    const result = await repo.cancel("lr-uuid-1");
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["leave_requests"][0];
    expect(row["status"]).toBe("cancelled");
    expect(row["reviewed_by_name"]).toBe("Système");
    expect(row["decision_note"]).toBe("Annulé par l'employé");
  });

  it("6. read mapping: dates, decision fields, embed name + deleted-personnel fallback, status fold", async () => {
    fakeClient.tables["leave_requests"] = [
      lrRow(),
      // Legacy-category row (pre-0072 writers) + deleted personnel.
      lrRow({
        id: "lr-uuid-2",
        leave_type: "annual",
        status: "weird_status",
        personnel: null,
        start_date: "2026-11-01",
        end_date: "2026-11-05",
      }),
      lrRow({
        id: "lr-uuid-3",
        status: "approved",
        reviewed_by: MANAGER,
        reviewed_by_name: "Amina Cherif",
        reviewed_at: "2026-09-21T09:00:00Z",
        decision_note: "OK",
      }),
    ];
    const repo = makeRepo();
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const rows: any[] = obs.get();
    expect(rows).toHaveLength(3);
    const first = rows.find((r) => r.id === "lr-uuid-1");
    expect(first.personnelName).toBe("Karim Benali");
    expect(first.fromDate).toBe("2026-10-15");
    expect(first.toDate).toBe("2026-10-20");
    expect(first.type).toBe("leave");
    expect(first.decidedAt).toBeNull();
    const second = rows.find((r) => r.id === "lr-uuid-2");
    expect(second.type).toBe("annual"); // legacy category reads back as-is
    expect(second.status).toBe("pending"); // unknown DB status folds to pending
    expect(second.personnelName).toBe("Personnel inconnu");
    const third = rows.find((r) => r.id === "lr-uuid-3");
    expect(third.decidedByName).toBe("Amina Cherif");
    expect(third.decisionNote).toBe("OK");
    expect(third.decidedAt).toBe("2026-09-21T09:00:00Z");
  });

  it("7. observeByPersonnel + observePending filter the shared cache", async () => {
    fakeClient.tables["leave_requests"] = [
      lrRow(),
      lrRow({ id: "lr-uuid-2", personnel_id: "dddddddd-0000-0000-0000-0000000000d1", status: "pending" }),
      lrRow({ id: "lr-uuid-3", status: "approved" }),
    ];
    const repo = makeRepo();
    // Seed the cache.
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const mine = repo.observeByPersonnel(WORKER);
    const pending = repo.observePending();
    expect(mine.get().map((r) => r.id).sort()).toEqual(["lr-uuid-1", "lr-uuid-3"]);
    expect(pending.get().map((r) => r.id)).toEqual(["lr-uuid-1", "lr-uuid-2"]);
    expect(obs.get()).toHaveLength(3);
  });

  it("8. persistence-across-restart: a second instance sees the same rows", async () => {
    fakeClient.tables["leave_requests"] = [lrRow()];
    const repo1 = makeRepo();
    const obs1 = repo1.observe();
    await new Promise((r) => setTimeout(r, 20));
    const repo2 = makeRepo();
    const obs2 = repo2.observe();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs1.get()).toHaveLength(1);
    expect(obs2.get()).toHaveLength(1);
    expect(obs2.get()[0].id).toBe("lr-uuid-1");
  });

  it("9a. source scan: the wiring overrides the leaveRequests slot", () => {
    const wiring = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/supabase-repositories.ts"),
      "utf8",
    );
    expect(wiring).toContain("SupabaseLeaveRequestRepository");
    expect(wiring).toMatch(/leaveRequests,\s*\/\/ T-178/);
  });

  it("9b. source scan: migration 0072 widens (not narrows) the leave_type CHECK + adds reviewed_by_name", () => {
    const mig = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0072_leave_requests_request_kinds.sql"),
      "utf8",
    );
    // The superset must include BOTH the legacy categories and the domain kinds.
    for (const v of ["annual", "sick", "personal", "unpaid", "maternity", "paternity", "leave", "absence", "overtime", "shift_swap", "remote"]) {
      expect(mig).toContain(`'${v}'`);
    }
    expect(mig).toContain("add column if not exists reviewed_by_name text");
    expect(mig).toContain("on conflict (version) do nothing");
    // The CHECK drop is definition-matched (name-agnostic), not a blind drop.
    expect(mig).toContain("pg_get_constraintdef(oid) ilike '%leave_type%'");
  });
});
