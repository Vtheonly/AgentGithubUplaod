/**
 * T-483 — the onboarding persistence port (the T-477 audit's "onboarding
 * mock slot — persists nothing" fix): the SupabaseOnboardingRepository
 * pinned as unit tests (the fake-client convention) and source guards.
 *
 * Repository pins:
 *   1. start() INSERTs the tenant-singleton row (personnel_id NULL, the
 *      welcome step, empty data) when none exists.
 *   2. start() on an EXISTING singleton row UPDATEs it in place (restart —
 *      the Postgres NULL-on-conflict trap documented in the repository:
 *      a naive upsert can never conflict-match a NULL column).
 *   3. The step round-trip: advanceTo/completeStep map step NAMES ↔ the
 *      table's step INDICES (ONBOARDING_STEPS), and complete() stamps
 *      completed_at + the full step set.
 *   4. updateData() merges into data_json (never clobbering sibling keys).
 *   5. reset() DELETEs the singleton row + start() recreates it fresh.
 *   6. isComplete() reads the singleton row's completed_at.
 *   7. Persistence across a repository re-instantiation (the cache is
 *      re-seeded from the table).
 *   8. The corrupt-row guards: an out-of-range current_step index folds to
 *      "welcome"; out-of-range completed_steps indices are dropped.
 *
 * Source guards:
 *   9. Migration 0142 exists (the nullable personnel_id + the partial
 *      unique index + the registration).
 *  10. The wiring override exists in supabase-repositories.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseOnboardingRepository } from "../../infrastructure/supabase/repositories/supabase-onboarding-repository";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ONBOARDING_STEPS } from "../../domain/model/workforce";

// ============================================================================
// Fake Supabase client (the t-239/t-481 convention — one table, filters
// recorded, update/insert/delete applied to the in-memory rows)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private wantMaybe = false;

  constructor(
    private readonly table: Row[],
    private readonly onWrite: () => Row | null = () => null,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
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
    this.wantMaybe = true;
    return this;
  }

  private applyId(): string {
    return `ob-${Math.random().toString(36).slice(2, 9)}`;
  }

  private run(): { data: Row | Row[] | null; error: { message: string } | null } {
    if (this.mode === "insert") {
      const row = {
        id: this.applyId(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.payload,
      };
      this.table.push(row);
      return { data: row, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === "update" && this.payload) {
      rows = rows.map((r) => ({ ...r, ...this.payload, id: r.id }));
      // Replace in the table (mutate the shared rows).
      const ids = new Set(rows.map((r) => r.id));
      for (let i = this.table.length - 1; i >= 0; i--) {
        if (ids.has(this.table[i]!.id)) this.table.splice(i, 1);
      }
      this.table.push(...rows);
    }
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
      | ((value: { data: Row | Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    const result = this.run(); // ONCE — run() mutates the table for writes.
    return Promise.resolve(onFulfilled!(result));
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
const ADMIN_ACCOUNT = "cccccccc-0000-0000-0000-0000000000c1";

beforeEach(() => {
  fakeClient.tables = {};
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: ADMIN_ACCOUNT }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

function makeRepo(): SupabaseOnboardingRepository {
  return new SupabaseOnboardingRepository(fakeClient as unknown as SupabaseClient);
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

// ============================================================================
// Repository tests
// ============================================================================

describe("SupabaseOnboardingRepository (T-483)", () => {
  it("1. start() INSERTs the tenant-singleton row when none exists", async () => {
    const repo = makeRepo();
    const res = await repo.start();
    expect(res.ok).toBe(true);
    const rows = fakeClient.tables["onboarding_states"]!;
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row["tenant_id"]).toBe(TENANT);
    expect(row["personnel_id"]).toBeNull(); // the 0142 tenant-singleton row
    expect(row["current_step"]).toBe(0); // the welcome index
    expect(row["completed_steps"]).toEqual([]);
    expect(row["completed_at"]).toBeNull();
    if (res.ok) {
      expect(res.value.currentStep).toBe("welcome");
      expect(res.value.tenantId).toBe(TENANT);
      expect(res.value.completedAt).toBeNull();
    }
  });

  it("2. start() on an EXISTING singleton row UPDATEs it in place (the NULL-on-conflict trap)", async () => {
    const repo = makeRepo();
    await repo.start();
    await repo.complete(); // a finished wizard
    const res2 = await repo.start(); // restart
    expect(res2.ok).toBe(true);
    // Still exactly ONE singleton row — never a second INSERT.
    const rows = fakeClient.tables["onboarding_states"]!;
    expect(rows.length).toBe(1);
    expect(rows[0]!["completed_at"]).toBeNull(); // restarted
    if (res2.ok) expect(res2.value.currentStep).toBe("welcome");
  });

  it("3. the step round-trip: names ↔ indices; complete() stamps the full set", async () => {
    const repo = makeRepo();
    await repo.start();
    const advanced = await repo.advanceTo("departments");
    expect(advanced.ok).toBe(true);
    if (advanced.ok) expect(advanced.value.currentStep).toBe("departments");
    const row = fakeClient.tables["onboarding_states"][0]!;
    expect(row["current_step"]).toBe(1); // the departments index

    const stepped = await repo.completeStep("welcome");
    expect(stepped.ok).toBe(true);
    if (stepped.ok) expect(stepped.value.completedSteps.has("welcome")).toBe(true);

    const done = await repo.complete();
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.value.completedAt).not.toBeNull();
      expect(done.value.currentStep).toBe("done");
      expect(done.value.completedSteps.size).toBe(ONBOARDING_STEPS.length);
    }
    const doneRow = fakeClient.tables["onboarding_states"][0]!;
    expect(doneRow["completed_at"]).not.toBeNull();
    expect((doneRow["completed_steps"] as number[]).length).toBe(ONBOARDING_STEPS.length);
  });

  it("4. updateData() MERGES into data_json (sibling keys preserved)", async () => {
    const repo = makeRepo();
    await repo.start();
    const r1 = await repo.updateData({ employeeCount: 12 });
    expect(r1.ok).toBe(true);
    const r2 = await repo.updateData({ shiftTypes: ["morning"] });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value.data.employeeCount).toBe(12); // the earlier key SURVIVED
      expect(r2.value.data.shiftTypes).toEqual(["morning"]);
    }
  });

  it("5. reset() deletes the singleton row and start() recreates it fresh", async () => {
    const repo = makeRepo();
    await repo.start();
    await repo.updateData({ employeeCount: 99 });
    const res = await repo.reset();
    expect(res.ok).toBe(true);
    const rows = fakeClient.tables["onboarding_states"]!;
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row["completed_at"]).toBeNull();
    // The pre-reset data did NOT survive: the fresh row starts from the
    // emptyData() defaults (employeeCount 0 — NOT the pre-reset 99).
    const data = row["data_json"] as Record<string, unknown>;
    expect(data["employeeCount"]).toBe(0);
  });

  it("6. isComplete() reads the singleton row's completed_at", async () => {
    const repo = makeRepo();
    const before = await repo.isComplete();
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.value).toBe(false);
    await repo.start();
    await repo.complete();
    const after = await repo.isComplete();
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value).toBe(true);
  });

  it("7. persistence across a repository re-instantiation", async () => {
    const repo1 = makeRepo();
    await repo1.start();
    await repo1.advanceTo("working_hours");
    await repo1.completeStep("welcome");
    await settle();
    const repo2 = makeRepo();
    const obs = repo2.observe();
    await settle();
    const state = obs.get();
    expect(state).not.toBeNull();
    expect(state!.currentStep).toBe("working_hours");
    expect(state!.completedSteps.has("welcome")).toBe(true);
  });

  it("8. the corrupt-row guards: out-of-range indices fold safely", async () => {
    fakeClient.tables["onboarding_states"] = [
      {
        id: "ob-corrupt",
        tenant_id: TENANT,
        personnel_id: null,
        current_step: 999, // out of range
        completed_steps: [0, 999, -4], // only index 0 is valid
        started_at: "2026-10-04T10:00:00Z",
        completed_at: null,
        data_json: {},
        created_at: "2026-10-04T10:00:00Z",
        updated_at: "2026-10-04T10:00:00Z",
      },
    ];
    const repo = makeRepo();
    const obs = repo.observe();
    await settle();
    const state = obs.get();
    expect(state).not.toBeNull();
    expect(state!.currentStep).toBe("welcome"); // the fold
    expect(state!.completedSteps.size).toBe(1); // only "welcome" survived
    expect(state!.completedSteps.has("welcome")).toBe(true);
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

describe("T-483 source guards", () => {
  it("9. migration 0142: the nullable personnel_id + the partial unique index + the registration", () => {
    const mig = read("supabase/migrations/0142_onboarding_tenant_singleton.sql");
    expect(mig).toContain("alter column personnel_id drop not null");
    expect(mig).toContain("onboarding_states_tenant_singleton_idx");
    expect(mig).toContain("where personnel_id is null");
    expect(mig).toContain("values ('0142'");
  });

  it("10. the wiring override exists", () => {
    const wiring = read("src/infrastructure/supabase/supabase-repositories.ts");
    expect(wiring).toContain("new SupabaseOnboardingRepository(client)");
    expect(wiring).toContain("onboarding, // T-483");
  });
});
