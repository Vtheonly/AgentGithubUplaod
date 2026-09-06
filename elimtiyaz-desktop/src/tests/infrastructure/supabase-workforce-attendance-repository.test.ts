/**
 * SupabaseWorkforceAttendanceRepository unit tests (T-217 — T-047 port #6).
 *
 * Verifies the canonical contract of the workforceAttendance port:
 *   1. recordEvent() inserts the domain AttendanceEventType union VERBATIM
 *      (0010 CHECK), tenant-scoped, with the punch instant SERVER-side
 *      (event_at is never client-supplied — the input `date` is advisory
 *      only and is not persisted).
 *   2. recordEvent() validation: non-UUID personnelId (mock-era ids) is
 *      rejected BEFORE hitting the table (T-178 precedent); a missing
 *      tenant context fails loud (T-053 rule).
 *   3. recordEvent() maps metadata.lat/lng to the latitude/longitude
 *      columns and DROPS metadata.ip (no column — documented divergence;
 *      the UI never sets it).
 *   4. recordEvent() stamps recorded_by from the session profile id.
 *   5. Read mapping: date = UTC calendar date of event_at, timestamp =
 *      event_at, eventType union with the clock_in fold for impossible
 *      rows, metadata {lat,lng} rebuilt from the columns.
 *   6. observeByDate / observeByPersonnel filter the shared reactive cache.
 *   7. latestFor() stays SYNCHRONOUS (the worker dashboard's clock-state
 *      memo) — and reflects a just-recorded punch via the append-to-cache
 *      behavior WITHOUT awaiting the refresh.
 *   8. Persistence-across-restart: a second repository instance over the
 *      same table sees the same rows.
 *   9. Source scans: the wiring overrides the workforceAttendance slot;
 *      the provider interface types it as the WORKFORCE AttendanceRepository
 *      (aliased — three same-named interfaces exist); migration 0010
 *      declares the table with the domain union CHECK.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseWorkforceAttendanceRepository } from "../../infrastructure/supabase/repositories/supabase-workforce-attendance-repository";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder (t-099/t-145 convention)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" = "select";
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
  single(): this {
    this.wantSingle = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null } {
    if (this.mode === "insert") {
      // The DB defaults: id + event_at (server-side punch instant) +
      // created_at (0010 table definition).
      const row = {
        id: "att-uuid-new",
        event_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        ...this.payload,
      };
      this.table.push(row);
      return { data: row, error: null };
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

function attRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "att-uuid-1",
    tenant_id: TENANT,
    personnel_id: WORKER,
    event_type: "clock_in",
    event_at: "2026-09-07T08:00:00.000Z",
    latitude: null,
    longitude: null,
    note: null,
    recorded_by: null,
    created_at: "2026-09-07T08:00:00.000Z",
    ...overrides,
  };
}

function makeRepo(): SupabaseWorkforceAttendanceRepository {
  return new SupabaseWorkforceAttendanceRepository(fakeClient as unknown as SupabaseClient);
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

describe("SupabaseWorkforceAttendanceRepository (T-217)", () => {
  it("1. recordEvent() stores the domain union verbatim, tenant-scoped, server-side instant", async () => {
    const repo = makeRepo();
    const result = await repo.recordEvent({
      personnelId: WORKER,
      date: "2026-09-07",
      eventType: "break_start",
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["workforce_attendance_events"][0];
    expect(row["event_type"]).toBe("break_start");
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["personnel_id"]).toBe(WORKER);
    // The punch instant is server-side — the client never sends a date.
    expect(row["event_at"]).toBeTruthy();
    expect(row["date"]).toBeUndefined();
  });

  it("2a. recordEvent() rejects mock-era non-UUID personnelId BEFORE hitting the table", async () => {
    const repo = makeRepo();
    const result = await repo.recordEvent({
      personnelId: "per-001",
      date: "2026-09-07",
      eventType: "clock_in",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ERR_VALIDATION");
    expect(fakeClient.tables["workforce_attendance_events"] ?? []).toHaveLength(0);
  });

  it("2b. recordEvent() fails loud without a tenant context (T-053)", async () => {
    localStorage.removeItem("el-imtiyaz.session");
    const repo = makeRepo();
    const result = await repo.recordEvent({
      personnelId: WORKER,
      date: "2026-09-07",
      eventType: "clock_in",
    });
    expect(result.ok).toBe(false);
    expect(fakeClient.tables["workforce_attendance_events"] ?? []).toHaveLength(0);
  });

  it("3. recordEvent() maps lat/lng columns and DROPS metadata.ip (no column)", async () => {
    const repo = makeRepo();
    const result = await repo.recordEvent({
      personnelId: WORKER,
      date: "2026-09-07",
      eventType: "clock_out",
      metadata: { lat: 36.75, lng: 3.47, ip: "10.0.0.1" },
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["workforce_attendance_events"][0];
    expect(row["latitude"]).toBe(36.75);
    expect(row["longitude"]).toBe(3.47);
    expect(row["ip"]).toBeUndefined();
    // The returned domain event rebuilds metadata from the columns.
    if (!result.ok) return;
    expect(result.value.metadata).toEqual({ lat: 36.75, lng: 3.47 });
  });

  it("4. recordEvent() stamps recorded_by from the session profile id", async () => {
    const repo = makeRepo();
    await repo.recordEvent({
      personnelId: WORKER,
      date: "2026-09-07",
      eventType: "clock_in",
    });
    const row = fakeClient.tables["workforce_attendance_events"][0];
    expect(row["recorded_by"]).toBe(WORKER);
  });

  it("5. read mapping: date = UTC date of event_at, timestamp = event_at, union + fold", async () => {
    fakeClient.tables["workforce_attendance_events"] = [
      attRow({ id: "att-a", event_type: "clock_in", event_at: "2026-09-06T07:55:00.000Z" }),
      attRow({ id: "att-b", event_type: "break_end", event_at: "2026-09-07T13:05:00.000Z", latitude: 36.7, longitude: 3.4 }),
      attRow({ id: "att-c", event_type: "not_a_real_type", event_at: "2026-09-08T09:00:00.000Z" }),
    ];
    const repo = makeRepo();
    const obs = repo.observeByDate("2026-09-07");
    await new Promise((r) => setTimeout(r, 20));
    const events = obs.get();
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-09-07");
    expect(events[0].timestamp).toBe("2026-09-07T13:05:00.000Z");
    expect(events[0].eventType).toBe("break_end");
    expect(events[0].metadata).toEqual({ lat: 36.7, lng: 3.4 });
    // The impossible row folds to clock_in (never reachable via the CHECK).
    const all = repo.observeByPersonnel(WORKER, "2026-09-01", "2026-09-30");
    expect(all.get()).toHaveLength(3);
    expect(all.get().map((e) => e.eventType)).toContain("clock_in");
  });

  it("6. observeByDate + observeByPersonnel filter the shared cache", async () => {
    fakeClient.tables["workforce_attendance_events"] = [
      attRow({ id: "att-a", event_at: "2026-09-06T08:00:00.000Z" }),
      attRow({ id: "att-b", event_at: "2026-09-07T08:00:00.000Z" }),
      attRow({ id: "att-c", personnel_id: "dddddddd-0000-0000-0000-0000000000d1", event_at: "2026-09-07T09:00:00.000Z" }),
    ];
    const repo = makeRepo();
    repo.observeByDate("2026-09-07");
    await new Promise((r) => setTimeout(r, 20));
    const today = repo.observeByDate("2026-09-07").get();
    expect(today.map((e) => e.id)).toEqual(["att-b", "att-c"]);
    const mine = repo.observeByPersonnel(WORKER, "2026-09-01", "2026-09-30").get();
    expect(mine.map((e) => e.id)).toEqual(["att-a", "att-b"]);
  });

  it("7. latestFor() is synchronous and reflects a just-recorded punch", async () => {
    // The punch instant is the REAL clock (the fake insert stamps
    // new Date()) — derive the fixture date from it, not a hard-coded
    // calendar day (the container clock and the session timezone differ).
    const today = new Date().toISOString().slice(0, 10);
    fakeClient.tables["workforce_attendance_events"] = [
      attRow({
        id: "att-early",
        event_type: "clock_in",
        event_at: `${today}T07:00:00.000Z`,
      }),
    ];
    const repo = makeRepo();
    repo.observeByDate(today);
    await new Promise((r) => setTimeout(r, 20));
    // Synchronous peek BEFORE the punch.
    const before = repo.latestFor(WORKER, today);
    expect(before?.eventType).toBe("clock_in");
    // Record a punch; latestFor must see it without awaiting refresh.
    const result = await repo.recordEvent({
      personnelId: WORKER,
      date: today,
      eventType: "break_start",
    });
    expect(result.ok).toBe(true);
    const after = repo.latestFor(WORKER, today);
    expect(after?.eventType).toBe("break_start");
    expect(after?.id).toBe(result.ok ? result.value.id : null);
  });

  it("8. persistence-across-restart: a second instance sees the same rows", async () => {
    fakeClient.tables["workforce_attendance_events"] = [attRow()];
    const repo1 = makeRepo();
    repo1.observeByDate("2026-09-07");
    await new Promise((r) => setTimeout(r, 20));
    const repo2 = makeRepo();
    const obs2 = repo2.observeByPersonnel(WORKER, "2026-09-01", "2026-09-30");
    await new Promise((r) => setTimeout(r, 20));
    expect(obs2.get()).toHaveLength(1);
    expect(obs2.get()[0].id).toBe("att-uuid-1");
  });

  it("9a. source scan: the wiring overrides the workforceAttendance slot", () => {
    const wiring = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/supabase-repositories.ts"),
      "utf8",
    );
    expect(wiring).toContain("SupabaseWorkforceAttendanceRepository");
    expect(wiring).toMatch(/workforceAttendance,\s*\/\/ T-217/);
  });

  it("9b. source scan: the provider types the slot with the WORKFORCE interface (aliased)", () => {
    const provider = fs.readFileSync(
      path.resolve(__dirname, "../../app/providers/repository-provider.tsx"),
      "utf8",
    );
    // The alias import guards the three-same-named-interfaces trap.
    expect(provider).toContain("AttendanceRepository as WorkforceAttendanceRepository");
    expect(provider).toMatch(/workforceAttendance: WorkforceAttendanceRepository/);
    // The slot's OLD typeof-mock declaration is gone (the comment that
    // documents the change may legitimately mention it — match the
    // declaration shape specifically).
    expect(provider).not.toMatch(/workforceAttendance: typeof mockWorkforceAttendanceRepository/);
  });

  it("9c. source scan: migration 0010 declares the table with the domain union CHECK", () => {
    const migration = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0010_workforce.sql"),
      "utf8",
    );
    expect(migration).toContain("create table public.workforce_attendance_events");
    for (const t of ["clock_in", "break_start", "break_end", "clock_out"]) {
      expect(migration).toContain(`'${t}'`);
    }
  });
});
