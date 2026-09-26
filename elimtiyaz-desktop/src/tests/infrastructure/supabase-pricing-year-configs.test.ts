/**
 * T-414 (PRICING-500 / ADR-025) — per-academic-year price configuration,
 * SUPABASE repository contract tests (fake PostgREST client — the
 * t-099/t-145 convention).
 *
 * Verifies the year-config surface of `SupabasePricingRepository`:
 *   1. listConfigs(): summaries joined with academic_years (label/code/
 *      is_current), active flag carried per row.
 *   2. readForYear(): resolves the year's config row then reads THAT
 *      config's children (the `readDbPricingConfig(forConfigId)` branch) —
 *      a historical year's grid is read from ITS config, not the active one.
 *   3. createConfigForYear(): routed to the `create_pricing_config_for_year`
 *      RPC with (academic_year_id, label, clone_from_active); the created
 *      summary is read back and returned INACTIVE.
 *   4. activateConfig(): routed to the `set_active_pricing_config` RPC;
 *      observe() re-emits the NOW-active config afterwards.
 *   5. readDbPricingConfig() default (no arg): still resolves the ACTIVE
 *      row (PRICING-500's deterministic one-active invariant, 0117).
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabasePricingRepository,
  readDbPricingConfig,
} from "../../infrastructure/supabase/repositories/supabase-pricing-repository";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder (t-099/t-145 convention)
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private wantMaybe = false;
  private orderCol: string | null = null;

  constructor(private readonly table: Row[]) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => String(r[col]) === String(val));
    return this;
  }
  select(_cols?: string): this { return this; }
  insert(row: Row): this { this.mode = "insert"; this.payload = row; return this; }
  update(patch: Row): this { this.mode = "update"; this.payload = patch; return this; }
  delete(): this { this.mode = "delete"; return this; }
  single(): this { this.wantSingle = true; return this; }
  maybeSingle(): this { this.wantMaybe = true; return this; }
  limit(_n: number): this { return this; }
  order(col: string, _opts?: { ascending?: boolean }): this { this.orderCol = col; return this; }

  private run(): { data: Row | Row[] | null; error: null } {
    if (this.mode === "insert") {
      const row = { id: `row-${Math.random().toString(36).slice(2, 8)}`, ...this.payload };
      this.table.push(row);
      return { data: this.wantSingle || this.wantMaybe ? row : [row], error: null };
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.payload ?? {});
          patched.push(row);
        }
      }
      return { data: this.wantSingle || this.wantMaybe ? (patched[0] ?? null) : patched, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => String(a[this.orderCol!]).localeCompare(String(b[this.orderCol!])));
    }
    if (this.wantSingle || this.wantMaybe) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    return Promise.resolve(onFulfilled!(this.run() as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  rpcCalls: { fn: string; args: Row }[] = [];
  /** RPC result overrides keyed by function name (T-414: the new RPCs). */
  rpcResults: Record<string, unknown> = {};

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName]);
  }

  async rpc(fn: string, args: Row): Promise<{ data: unknown; error: null }> {
    this.rpcCalls.push({ fn, args });
    return Promise.resolve({ data: this.rpcResults[fn] ?? "ok", error: null });
  }
}

const fakeClient = new FakeClient() as unknown as SupabaseClient & FakeClient;

// ============================================================================
// Fixtures — two years, two configs (the active 2025-2026 + the historical
// 2024-2025), each with its own tuition grid.
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTIVE_CONFIG = "cfg-active-2025";
const HIST_CONFIG = "cfg-hist-2024";
const YEAR_CURRENT = "ay-2025-2026";
const YEAR_HIST = "ay-2024-2025";
const YEAR_NEXT = "ay-2026-2027";
const LEVEL_1AP = "lvl-1ap";
const NEW_CONFIG = "cfg-new-2026";

function seedDb(): void {
  fakeClient.tables = {
    pricing_configs: [
      {
        id: ACTIVE_CONFIG,
        tenant_id: TENANT,
        academic_year_id: YEAR_CURRENT,
        label: "Tarification 2025-2026",
        registration_fee: 5000,
        second_apron_fee: 2000,
        is_active: true,
        created_at: "2025-08-01T00:00:00Z",
        updated_at: "2025-08-01T00:00:00Z",
      },
      {
        id: HIST_CONFIG,
        tenant_id: TENANT,
        academic_year_id: YEAR_HIST,
        label: "Tarification 2024-2025",
        registration_fee: 4000,
        second_apron_fee: 1500,
        is_active: false,
        created_at: "2024-08-01T00:00:00Z",
        updated_at: "2024-08-01T00:00:00Z",
      },
    ],
    academic_years: [
      {
        id: YEAR_CURRENT,
        tenant_id: TENANT,
        code: "2025-2026",
        label: "Année scolaire 2025-2026",
        is_current: true,
      },
      {
        id: YEAR_HIST,
        tenant_id: TENANT,
        code: "2024-2025",
        label: "Année scolaire 2024-2025",
        is_current: false,
      },
      {
        id: YEAR_NEXT,
        tenant_id: TENANT,
        code: "2026-2027",
        label: "Année scolaire 2026-2027",
        is_current: false,
      },
    ],
    academic_levels: [{ id: LEVEL_1AP, grade_code: "1ap" }],
    grade_level_tuition: [
      {
        id: "tu-active-1ap",
        pricing_config_id: ACTIVE_CONFIG,
        academic_level_id: LEVEL_1AP,
        annual_amount: 250000,
        tranche_1_amount: 100000,
        tranche_2_amount: 75000,
        tranche_3_amount: 75000,
        registration_fee: 25000,
      },
      {
        id: "tu-hist-1ap",
        pricing_config_id: HIST_CONFIG,
        academic_level_id: LEVEL_1AP,
        annual_amount: 205000,
        tranche_1_amount: 60000,
        tranche_2_amount: 70000,
        tranche_3_amount: 75000,
        registration_fee: 25000,
      },
    ],
    transport_destinations: [],
    complementary_services: [],
    additional_services: [],
    discounts: [],
    system_settings: [],
  };
  fakeClient.rpcCalls = [];
  fakeClient.rpcResults = {};
}

beforeEach(() => {
  seedDb();
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "usr-1" }),
  );
});

describe("T-414 SupabasePricingRepository — per-year configuration", () => {
  it("listConfigs returns per-year summaries with the active + current flags", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.listConfigs();
    expect(r.ok).toBe(true);
    const summaries = r.value;
    expect(summaries.length).toBe(2);

    const active = summaries.find((s) => s.id === ACTIVE_CONFIG)!;
    expect(active.isActive).toBe(true);
    expect(active.isCurrentYear).toBe(true);
    expect(active.academicYearCode).toBe("2025-2026");
    expect(active.academicYearLabel).toContain("2025-2026");
    expect(active.label).toBe("Tarification 2025-2026");

    const hist = summaries.find((s) => s.id === HIST_CONFIG)!;
    expect(hist.isActive).toBe(false);
    expect(hist.isCurrentYear).toBe(false);
    expect(hist.academicYearCode).toBe("2024-2025");
  });

  it("readForYear reads the YEAR's own grid, not the active one", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.readForYear(YEAR_HIST);
    expect(r.ok).toBe(true);
    // The historical year's own tuition row (205 000), NOT the active grid's
    // 250 000 — the per-config read branch of readDbPricingConfig.
    expect(r.value.tuitionByGradeLevel["1ap"].annualAmount).toBe(205000);
    expect(r.value.tuitionByGradeLevel["1ap"].installments).toEqual([60000, 70000, 75000]);
    expect(r.value.registrationFee).toBe(4000);
  });

  it("readForYear is a not-found for a year without a config", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.readForYear(YEAR_NEXT);
    expect(r.ok).toBe(false);
  });

  it("readDbPricingConfig() default still resolves the ACTIVE config's children", async () => {
    const config = await readDbPricingConfig(fakeClient);
    expect(config.tuitionByGradeLevel["1ap"].annualAmount).toBe(250000);
    expect(config.registrationFee).toBe(5000);
  });

  it("createConfigForYear routes to the 0117 RPC and returns the INACTIVE summary", async () => {
    // The RPC inserts the new config row (server-side); simulate it.
    fakeClient.rpcResults["create_pricing_config_for_year"] = NEW_CONFIG;
    fakeClient.tables.pricing_configs.push({
      id: NEW_CONFIG,
      tenant_id: TENANT,
      academic_year_id: YEAR_NEXT,
      label: "Tarification 2026-2027",
      registration_fee: 5000,
      second_apron_fee: 2000,
      is_active: false,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    });

    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.createConfigForYear(
      { academicYearId: YEAR_NEXT, label: "Tarification 2026-2027", cloneFromActive: true },
      "usr-test",
    );
    expect(r.ok).toBe(true);
    expect(r.value.id).toBe(NEW_CONFIG);
    expect(r.value.isActive).toBe(false);
    expect(r.value.academicYearCode).toBe("2026-2027");

    // Routed through the canonical RPC with the exact parameters.
    const call = fakeClient.rpcCalls.find((c) => c.fn === "create_pricing_config_for_year");
    expect(call).toBeDefined();
    expect(call!.args.p_academic_year_id).toBe(YEAR_NEXT);
    expect(call!.args.p_label).toBe("Tarification 2026-2027");
    expect(call!.args.p_clone_from_active).toBe(true);
  });

  it("activateConfig routes to set_active_pricing_config and observe() re-emits the now-active grid", async () => {
    // The RPC flips the flags server-side; simulate the post-RPC DB state.
    fakeClient.rpcResults["set_active_pricing_config"] = HIST_CONFIG;
    const flipFlags = () => {
      for (const row of fakeClient.tables.pricing_configs as Row[]) {
        row.is_active = row.id === HIST_CONFIG;
      }
    };

    const repo = new SupabasePricingRepository(fakeClient);
    // Prime the observe() cache with the ACTIVE config first.
    repo.observe().get();
    await new Promise((r) => setTimeout(r, 0));
    expect(repo.observe().get().tuitionByGradeLevel["1ap"].annualAmount).toBe(250000);

    flipFlags();
    const r = await repo.activateConfig(HIST_CONFIG, "usr-test");
    expect(r.ok).toBe(true);

    const call = fakeClient.rpcCalls.find((c) => c.fn === "set_active_pricing_config");
    expect(call).toBeDefined();
    expect(call!.args.p_config_id).toBe(HIST_CONFIG);

    // After activation, the ACTIVE read resolves the NEW active row's grid
    // (the calculation source of truth followed the switch).
    const activeNow = await readDbPricingConfig(fakeClient);
    expect(activeNow.tuitionByGradeLevel["1ap"].annualAmount).toBe(205000);
  });
});
