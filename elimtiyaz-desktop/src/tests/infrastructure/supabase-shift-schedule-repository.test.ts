/**
 * T-484 — the shifts/schedules Supabase port (the WORKFORCE-102 standing
 * list's last two desktop slots): the canonical 0010 adapters pinned as
 * unit tests (the fake-client convention) + the domain-model + drawer +
 * wiring source guards.
 *
 * Repository pins:
 *   1. SupabaseShiftRepository.createShift writes the canonical 0010 §2
 *      shape (code/name/start_time/end_time/grace_period_minutes/
 *      color_hex/is_active + tenant_id).
 *   2. The validation guards: end ≤ start refused; the blank code refused.
 *   3. updateShift maps the domain fields to the snake_case patch.
 *   4. SupabaseScheduleRepository.upsertSchedule writes the canonical
 *      0010 §3 shape with the (tenant_id, personnel_id, date) conflict
 *      target — the per-day unique.
 *   5. The T-373 non-uuid guard: observeByPersonnel("") is a stable empty
 *      stream (no server round-trip).
 *   6. The week window: observeByWeek scopes [weekStart, weekStart+6].
 *   7. Read mapping: the full row → domain round-trip.
 *   8. The UUID/date validation guards on upsertSchedule.
 *
 * Source guards:
 *   9. The domain model is the canonical shape (no weekday/shiftType/
 *      breakMinutes/weekStart/shiftIds on the entities).
 *  10. The mock is rebuilt on the same canonical shape (the 0010 unique
 *      enforced in upsertSchedule).
 *  11. The drawer's tab renders the per-day rows (the old shapes absent).
 *  12. The wiring override exists for both slots.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseShiftRepository,
  SupabaseScheduleRepository,
  weekWindow,
} from "../../infrastructure/supabase/repositories/supabase-shift-schedule-repositories";
import { mockShiftRepository, mockScheduleRepository } from "../../infrastructure/mock/workforce";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Fake Supabase client (the t-239/t-481 convention)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private wantMaybe = false;
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;
  private conflictTarget: string | null = null;

  constructor(
    private readonly table: Row[],
    private readonly errors: Record<string, { code?: string; message: string }>,
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
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }): this {
    this.mode = "upsert";
    this.payload = row;
    this.conflictTarget = opts?.onConflict ?? null;
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
    this.wantMaybe = true;
    return this;
  }

  get lastConflictTarget(): string | null {
    return this.conflictTarget;
  }

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null } {
    if (this.mode === "insert" || this.mode === "upsert") {
      // The (tenant_id, code) unique for shifts / the (tenant_id,
      // personnel_id, date) unique for schedules — the fake honors the
      // conflictTarget when provided (an upsert UPDATES the matched row).
      if (this.mode === "upsert" && this.conflictTarget) {
        const cols = this.conflictTarget.split(",");
        const match = this.table.find((r) =>
          cols.every((c) => r[c.trim()] === this.payload![c.trim()]),
        );
        if (match) {
          Object.assign(match, this.payload, { id: match.id });
          return { data: match, error: null };
        }
      }
      const dupe = this.table.find(
        (r) =>
          this.payload &&
          ((this.table === fakeClient.tables["shifts"] && r["code"] === this.payload["code"]) ||
            (this.table === fakeClient.tables["schedules"] &&
              r["personnel_id"] === this.payload["personnel_id"] &&
              r["date"] === this.payload["date"])),
      );
      if (this.mode === "insert" && dupe) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        };
      }
      const row = {
        id: `row-${Math.random().toString(36).slice(2, 9)}`,
        ...this.payload,
      };
      this.table.push(row);
      return { data: row, error: null };
    }
    if (this.mode === "update" && this.payload) {
      let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
      rows = rows.map((r) => ({ ...r, ...this.payload, id: r.id }));
      const ids = new Set(rows.map((r) => r.id));
      for (let i = this.table.length - 1; i >= 0; i--) {
        if (ids.has(this.table[i]!.id)) this.table.splice(i, 1);
      }
      this.table.push(...rows);
      if (this.wantSingle) {
        if (rows.length === 0)
          return { data: null, error: { message: "no rows (PGRST116)" } };
        return { data: rows[0]!, error: null };
      }
      return { data: rows, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[this.orderCol] ?? "").localeCompare(String(b[this.orderCol] ?? ""));
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    if (this.mode === "delete") {
      const ids = new Set(rows.map((r) => r.id));
      for (let i = this.table.length - 1; i >= 0; i--) {
        if (ids.has(this.table[i]!.id)) this.table.splice(i, 1);
      }
      return { data: rows, error: null };
    }
    if (this.wantSingle || this.wantMaybe) {
      if (rows.length === 0) {
        return this.wantMaybe
          ? { data: null, error: null }
          : { data: null, error: { message: "no rows (PGRST116)" } };
      }
      return { data: rows[0]!, error: null };
    }
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { code?: string; message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    const result = this.run(); // ONCE — run() mutates the table for writes.
    return Promise.resolve(onFulfilled!(result));
  }
}

const fakeClient = {
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, { code?: string; message: string }>,
  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName], this.errors);
  },
};

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const PERSONNEL_ID = "eeeeeeee-0000-0000-0000-0000000000e1";
const SHIFT_ID = "ab12ab12-0000-0000-0000-0000000000ab";
const ACCOUNT = "cccccccc-0000-0000-0000-0000000000c1";

beforeEach(() => {
  fakeClient.tables = {};
  fakeClient.errors = {};
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: ACCOUNT }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

// ============================================================================
// Repository tests
// ============================================================================

describe("SupabaseShiftRepository (T-484)", () => {
  it("1. createShift writes the canonical 0010 §2 shape", async () => {
    const repo = new SupabaseShiftRepository(fakeClient as unknown as SupabaseClient);
    const res = await repo.createShift({
      code: "MORNING",
      name: "Matin standard",
      startTime: "08:00",
      endTime: "12:00",
      gracePeriodMinutes: 10,
      colorHex: "#1d4ed8",
      isActive: true,
    });
    expect(res.ok).toBe(true);
    const row = fakeClient.tables["shifts"]![0]!;
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["code"]).toBe("MORNING");
    expect(row["name"]).toBe("Matin standard");
    expect(row["start_time"]).toBe("08:00");
    expect(row["end_time"]).toBe("12:00");
    expect(row["grace_period_minutes"]).toBe(10);
    expect(row["color_hex"]).toBe("#1d4ed8");
    expect(row["is_active"]).toBe(true);
    if (res.ok) {
      expect(res.value.code).toBe("MORNING");
      expect(res.value.gracePeriodMinutes).toBe(10);
      expect(res.value.colorHex).toBe("#1d4ed8");
    }
  });

  it("2. the validation guards: end ≤ start + blank code refused BEFORE the table", async () => {
    const repo = new SupabaseShiftRepository(fakeClient as unknown as SupabaseClient);
    const bad = await repo.createShift({
      code: "BAD",
      name: "Inversé",
      startTime: "17:00",
      endTime: "08:00",
      gracePeriodMinutes: 0,
      colorHex: null,
      isActive: true,
    });
    expect(bad.ok).toBe(false);
    const blank = await repo.createShift({
      code: "  ",
      name: "Sans code",
      startTime: "08:00",
      endTime: "12:00",
      gracePeriodMinutes: 0,
      colorHex: null,
      isActive: true,
    });
    expect(blank.ok).toBe(false);
    expect(fakeClient.tables["shifts"]).toBeUndefined(); // no round-trip
  });

  it("3. updateShift maps the domain fields to the snake_case patch", async () => {
    fakeClient.tables["shifts"] = [
      {
        id: SHIFT_ID,
        tenant_id: TENANT,
        code: "MORNING",
        name: "Matin standard",
        start_time: "08:00",
        end_time: "12:00",
        grace_period_minutes: 10,
        color_hex: null,
        is_active: true,
      },
    ];
    const repo = new SupabaseShiftRepository(fakeClient as unknown as SupabaseClient);
    const res = await repo.updateShift(SHIFT_ID, {
      name: "Matin allégé",
      gracePeriodMinutes: 15,
      isActive: false,
    });
    expect(res.ok).toBe(true);
    const row = fakeClient.tables["shifts"]![0]!;
    expect(row["name"]).toBe("Matin allégé");
    expect(row["grace_period_minutes"]).toBe(15);
    expect(row["is_active"]).toBe(false);
    expect(row["code"]).toBe("MORNING"); // untouched
    if (res.ok) expect(res.value.name).toBe("Matin allégé");
  });
});

describe("SupabaseScheduleRepository (T-484)", () => {
  function seedScheduleTable(): void {
    fakeClient.tables["schedules"] = [
      {
        id: "sched-1",
        tenant_id: TENANT,
        personnel_id: PERSONNEL_ID,
        shift_id: SHIFT_ID,
        date: "2026-10-05", // a Monday
        start_time: null,
        end_time: null,
        note: null,
      },
      {
        id: "sched-2",
        tenant_id: TENANT,
        personnel_id: PERSONNEL_ID,
        shift_id: null,
        date: "2026-10-15", // outside the week
        start_time: "09:00",
        end_time: "13:00",
        note: "Ajusté",
      },
    ];
  }

  it("4. upsertSchedule writes the canonical 0010 §3 shape with the per-day conflict target", async () => {
    const repo = new SupabaseScheduleRepository(fakeClient as unknown as SupabaseClient);
    const res = await repo.upsertSchedule({
      personnelId: PERSONNEL_ID,
      shiftId: SHIFT_ID,
      date: "2026-10-06",
      startTime: null,
      endTime: null,
      note: "Rentrée",
    });
    expect(res.ok).toBe(true);
    const row = fakeClient.tables["schedules"]![0]!;
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["personnel_id"]).toBe(PERSONNEL_ID);
    expect(row["shift_id"]).toBe(SHIFT_ID);
    expect(row["date"]).toBe("2026-10-06");
    expect(row["note"]).toBe("Rentrée");
    if (res.ok) {
      expect(res.value.personnelId).toBe(PERSONNEL_ID);
      expect(res.value.date).toBe("2026-10-06");
    }
  });

  it("4b. the upsert target is (tenant_id, personnel_id, date) — the same day UPDATES", async () => {
    seedScheduleTable();
    const repo = new SupabaseScheduleRepository(fakeClient as unknown as SupabaseClient);
    const res = await repo.upsertSchedule({
      personnelId: PERSONNEL_ID,
      shiftId: SHIFT_ID,
      date: "2026-10-05", // the EXISTING day
      startTime: "08:30",
      endTime: "12:30",
      note: "Ajusté",
    });
    expect(res.ok).toBe(true);
    expect(fakeClient.tables["schedules"]!.length).toBe(2); // no duplicate
    const row = fakeClient.tables["schedules"]!.find((r) => r["date"] === "2026-10-05")!;
    expect(row["start_time"]).toBe("08:30");
    expect(row["note"]).toBe("Ajusté");
  });

  it("5. the T-373 non-uuid guard: observeByPersonnel('') is a stable empty stream", () => {
    const repo = new SupabaseScheduleRepository(fakeClient as unknown as SupabaseClient);
    const obs = repo.observeByPersonnel("");
    expect(obs.get()).toEqual([]);
    // No table was ever touched.
    expect(fakeClient.tables["schedules"]).toBeUndefined();
  });

  it("6. the week window: observeByWeek scopes [weekStart, weekStart+6]", async () => {
    seedScheduleTable();
    const repo = new SupabaseScheduleRepository(fakeClient as unknown as SupabaseClient);
    const obs = repo.observeByWeek("2026-10-05");
    await settle();
    const rows = obs.get();
    expect(rows.length).toBe(1);
    expect(rows[0]!.date).toBe("2026-10-05"); // the 10-15 row is outside
    // The pure helper pinned too (the Sunday boundary).
    expect(weekWindow("2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("7. read mapping: the full row → domain round-trip", async () => {
    seedScheduleTable();
    const repo = new SupabaseScheduleRepository(fakeClient as unknown as SupabaseClient);
    const obs = repo.observeByPersonnel(PERSONNEL_ID);
    await settle();
    const rows = obs.get();
    expect(rows.length).toBe(2);
    const override = rows.find((r) => r.date === "2026-10-15")!;
    expect(override.shiftId).toBeNull();
    expect(override.startTime).toBe("09:00");
    expect(override.endTime).toBe("13:00");
    expect(override.note).toBe("Ajusté");
  });

  it("8. the UUID/date validation guards on upsertSchedule", async () => {
    const repo = new SupabaseScheduleRepository(fakeClient as unknown as SupabaseClient);
    const badPersonnel = await repo.upsertSchedule({
      personnelId: "per-teacher1", // a mock-era id
      shiftId: null,
      date: "2026-10-06",
      startTime: null,
      endTime: null,
      note: null,
    });
    expect(badPersonnel.ok).toBe(false);
    const badDate = await repo.upsertSchedule({
      personnelId: PERSONNEL_ID,
      shiftId: null,
      date: "06/10/2026",
      startTime: null,
      endTime: null,
      note: null,
    });
    expect(badDate.ok).toBe(false);
    expect(fakeClient.tables["schedules"]).toBeUndefined(); // never reached the table
  });
});

describe("the mock parity (T-484)", () => {
  // NOTE: the mock repositories are SINGLETONS seeded with the canonical
  // templates (MORNING/AFTERNOON/SAT_MORNING) — the test uses a fresh code
  // and relies on the per-file module isolation for the empty schedules.
  it("10. the mock upsert enforces the SAME (personnel, date) unique", async () => {
    const created = await mockShiftRepository.createShift({
      code: "TEST_T484",
      name: "Test template",
      startTime: "08:00",
      endTime: "12:00",
      gracePeriodMinutes: 0,
      colorHex: null,
      isActive: true,
    });
    expect(created.ok).toBe(true);
    const dupe = await mockShiftRepository.createShift({
      code: "TEST_T484", // the tenant-unique code
      name: "Encore",
      startTime: "10:00",
      endTime: "12:00",
      gracePeriodMinutes: 0,
      colorHex: null,
      isActive: true,
    });
    expect(dupe.ok).toBe(false); // the (tenant, code) unique surfaces

    const first = await mockScheduleRepository.upsertSchedule({
      personnelId: "per-teacher1",
      shiftId: created.ok ? created.value.id : null,
      date: "2026-10-06",
      startTime: null,
      endTime: null,
      note: null,
    });
    expect(first.ok).toBe(true);
    const second = await mockScheduleRepository.upsertSchedule({
      personnelId: "per-teacher1",
      shiftId: null,
      date: "2026-10-06", // the SAME day
      startTime: "09:00",
      endTime: "13:00",
      note: "Ajusté",
    });
    expect(second.ok).toBe(true);
    const rows = mockScheduleRepository
      .observeByPersonnel("per-teacher1")
      .get();
    expect(rows.length).toBe(1); // UPDATED in place, never duplicated
    expect(rows[0]!.startTime).toBe("09:00");
    expect(rows[0]!.note).toBe("Ajusté");
  });
});

// ============================================================================
// Source guards (the t-480 convention)
// ============================================================================

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf-8");
}

describe("T-484 source guards", () => {
  it("9. the domain model is the canonical 0010 shape", () => {
    const model = read("src/domain/model/workforce.ts");
    expect(model).toContain("readonly code: string;");
    expect(model).toContain("readonly gracePeriodMinutes: number;");
    expect(model).toContain("readonly colorHex: string | null;");
    expect(model).toContain("readonly shiftId: string | null;");
    expect(model).toContain("readonly date: string; // YYYY-MM-DD");
    // The pre-T-484 shapes are GONE from the entities.
    expect(model).not.toContain("readonly breakMinutes: number;");
    expect(model).not.toContain("readonly shiftIds: readonly string[];");
    expect(model).not.toContain("readonly weeklyHoursTarget: number;\n}");
  });

  it("11. the drawer's tab renders the per-day rows (the old shapes absent)", () => {
    const drawer = read("src/features/personnel/management/employee-profile-drawer.tsx");
    expect(drawer).toContain("thisWeeksSchedules");
    expect(drawer).toContain("Planification de la semaine");
    expect(drawer).not.toContain("SHIFT_TYPE_LABELS_FR");
    expect(drawer).not.toContain("WEEKDAY_LABELS_FR");
    expect(drawer).not.toContain("scheduledShiftIds");
    expect(drawer).not.toContain("s.shiftIds");
  });

  it("12. the wiring override exists for both slots", () => {
    const wiring = read("src/infrastructure/supabase/supabase-repositories.ts");
    expect(wiring).toContain("new SupabaseShiftRepository(client)");
    expect(wiring).toContain("new SupabaseScheduleRepository(client)");
    expect(wiring).toContain("shifts, // T-484");
    expect(wiring).toContain("schedules, // T-484");
  });
});
