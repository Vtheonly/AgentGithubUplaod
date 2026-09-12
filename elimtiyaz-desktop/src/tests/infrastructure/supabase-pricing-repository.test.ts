/**
 * SupabasePricingRepository unit tests (T-307 — T-047 Group-B port #1,
 * 48th session).
 *
 * Verifies the canonical contract of the pricing port:
 *   1. observe()/readDbPricingConfig(): the domain PricingConfig builds from
 *      the 0006 tables (grade tuition joined via academic_levels.grade_code,
 *      transport by code, services, discounts with the fixed_amount sign
 *      convention), with SEED fallback per missing key (the 14-row grid
 *      always renders whole).
 *   2. updateTuitionForGradeLevel(): validation parity with the mock
 *      (tranches-sum ±1 DZD, no negatives), UPDATE of the existing row,
 *      INSERT when the grade row is missing, and the observe() stream
 *      re-emits after the write.
 *   3. updateRegistration()/updateLatePenalty()/updateSecondApronFee():
 *      UPDATE the pricing_configs row (second apron keeps its negative
 *      validation).
 *   4. updateMonthly(): routed through the audited upsert_setting RPC
 *      (system_settings — the 0006 tables carry no monthly columns).
 *   5. addDiscount/removeDiscount: DB stores positive amounts; fixed
 *      discounts map back NEGATIVE on read (the domain convention);
 *      non-UUID ids rejected.
 *   6. Source scans: the pricing slot is wired in getSupabaseRepositories()
 *      and the batchRegister billing block reads the DB config (the T-307
 *      drift fix — no hardcoded defaultPricingConfig call site remains).
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabasePricingRepository,
  readDbPricingConfig,
} from "../../infrastructure/supabase/repositories/supabase-pricing-repository";
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
  private wantMaybe = false;

  constructor(private readonly table: Row[]) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => String(r[col]) === String(val));
    return this;
  }
  like(col: string, _pattern: string): this {
    this.likeCol = col;
    return this;
  }
  private likeCol = "";
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
  limit(_n: number): this {
    return this;
  }

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
    if (this.mode === "delete") {
      const remaining = this.table.filter((r) => !this.filters.every((f) => f(r)));
      this.table.length = 0;
      this.table.push(...remaining);
      return { data: null, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.likeCol) {
      // like('key', 'pricing.monthly.%') — prefix match
      rows = rows.filter((r) => String(r[this.likeCol] ?? "").startsWith("pricing.monthly."));
    }
    if (this.wantSingle) return { data: rows[0] ?? null, error: null };
    if (this.wantMaybe) return { data: rows[0] ?? null, error: null };
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

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName]);
  }

  rpc(fn: string, args: Row): Promise<{ data: unknown; error: null }> {
    this.rpcCalls.push({ fn, args });
    return Promise.resolve({ data: "ok", error: null });
  }
}

const fakeClient = new FakeClient() as unknown as SupabaseClient & FakeClient;

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const CONFIG_ID = "cfg-0001";
const LEVEL_1AP = "lvl-1ap";
const LEVEL_3AM = "lvl-3am";
const DISC_SENIORITY = "11111111-1111-4111-8111-111111111111";

function seedDb(): void {
  fakeClient.tables = {
    pricing_configs: [
      {
        id: CONFIG_ID,
        tenant_id: TENANT,
        registration_fee: 5000,
        late_penalty_per_day: 100,
        second_apron_fee: 2000,
        is_active: true,
      },
    ],
    academic_levels: [
      { id: LEVEL_1AP, grade_code: "1ap" },
      { id: LEVEL_3AM, grade_code: "3am" },
    ],
    grade_level_tuition: [
      {
        id: "tu-1ap",
        pricing_config_id: CONFIG_ID,
        academic_level_id: LEVEL_1AP,
        annual_amount: 205000,
        tranche_1_amount: 60000,
        tranche_2_amount: 70000,
        tranche_3_amount: 75000,
      },
    ],
    transport_destinations: [
      {
        id: "td-01",
        pricing_config_id: CONFIG_ID,
        code: "ville_boumerdes",
        annual_amount: 40000,
        tranche_1_amount: 20000,
        tranche_2_amount: 10000,
        tranche_3_amount: 10000,
      },
    ],
    complementary_services: [
      {
        id: "cs-01",
        pricing_config_id: CONFIG_ID,
        code: "psychology",
        label_fr: "Séances de psychologie (20 séances)",
        semester_amount: 10000,
        annual_amount: 20000,
        is_active: true,
      },
    ],
    additional_services: [],
    discounts: [
      {
        id: "dc-01",
        pricing_config_id: CONFIG_ID,
        code: "passage_palier",
        label_fr: "Passage de palier",
        discount_type: "fixed_amount",
        amount: 10000,
        is_active: true,
      },
      {
        id: DISC_SENIORITY,
        pricing_config_id: CONFIG_ID,
        code: "seniority_5y",
        label_fr: "Ancienneté > 5 ans",
        discount_type: "percentage",
        amount: 5,
        is_active: true,
      },
    ],
    system_settings: [
      { key: "pricing.monthly.cem", value: 6800, category: "system", tenant_id: TENANT },
    ],
    academic_years: [{ id: "ay-01", tenant_id: TENANT, is_current: true }],
  };
}

beforeEach(() => {
  seedDb();
  fakeClient.rpcCalls = [];
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "usr-1" }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

// ============================================================================
// 1. Read mapping
// ============================================================================

describe("T-307 — readDbPricingConfig mapping", () => {
  it("builds the tuition grid from grade_level_tuition (joined via academic_levels)", async () => {
    const config = await readDbPricingConfig(fakeClient);
    expect(config.tuitionByGradeLevel["1ap"]).toEqual({
      annualAmount: 205000,
      installments: [60000, 70000, 75000],
    });
    expect(config.registrationFee).toBe(5000);
    expect(config.latePenaltyPerDay).toBe(100);
    expect(config.secondApronFee).toBe(2000);
  });

  it("falls back to the SEED config for grades absent from the DB (the grid always renders whole)", async () => {
    const config = await readDbPricingConfig(fakeClient);
    // 3am has no row in the fixture → REAL seed value (330 000 — CALC-001;
    // the fictional 355 000 is retired).
    expect(config.tuitionByGradeLevel["3am"].annualAmount).toBe(330000);
    // Missing transport destination → seed value.
    expect(config.transportByDestination["autres"].annualAmount).toBe(55000);
    // CALC-001: per-grade FI falls back to the real matrix.
    expect(config.registrationFeeByGrade["1am"]).toBe(25000);
    expect(config.registrationFeeByGrade["3eme_annee"]).toBe(30000);
  });

  it("maps discounts with the domain sign convention (fixed NEGATIVE, percentage POSITIVE)", async () => {
    const config = await readDbPricingConfig(fakeClient);
    const fixed = config.discounts.find((d) => d.discountCode === "passage_palier")!;
    expect(fixed.amount).toBe(-10000);
    expect(fixed.discountType).toBe("fixed_amount");
    const pct = config.discounts.find((d) => d.discountCode === "seniority_5y")!;
    expect(pct.amount).toBe(5);
    expect(pct.discountType).toBe("percentage");
  });

  it("keeps seed entries for services the DB lacks (additional_services is empty live)", async () => {
    const config = await readDbPricingConfig(fakeClient);
    // The DB has no additional services → the REAL seed services render
    // (CALC-001: PSY/ORTH/E-PLANT/Ratrapage/AUTISTE replace the fictional
    // canteen/uniform/books/chess catalog).
    expect(config.additionalServices.length).toBeGreaterThanOrEqual(7);
    expect(config.additionalServices.some((s) => s.qualifier === "psy1")).toBe(true);
    expect(config.additionalServices.some((s) => s.qualifier === "ratrapage")).toBe(true);
    // Complementary: DB psychology takes precedence over the seed duplicate.
    const psy = config.complementaryServices.filter((s) => s.qualifier === "psychology");
    expect(psy.length).toBe(1);
    expect(psy[0].semesterAmount).toBe(10000);
  });

  it("reads monthlyByLevel from system_settings (seed defaults where unset)", async () => {
    const config = await readDbPricingConfig(fakeClient);
    expect(config.monthlyByLevel.cem).toBe(6800); // from system_settings
    expect(config.monthlyByLevel.primaire).toBe(6000); // seed default
  });
});

// ============================================================================
// 2. updateTuitionForGradeLevel — the owner's "price" surface
// ============================================================================

describe("T-307 — updateTuitionForGradeLevel", () => {
  it("rejects tranches that do not sum to the annual amount (mock validation parity)", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.updateTuitionForGradeLevel("1ap", 200000, [50000, 50000, 50000], "usr-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("doit égaler");
  });

  it("rejects negative tranches", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.updateTuitionForGradeLevel("1ap", 200000, [-1, 100000, 100001], "usr-1");
    expect(r.ok).toBe(false);
  });

  it("UPDATES the existing grade row and re-emits on observe()", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    repo.observe(); // arm the cache
    const r = await repo.updateTuitionForGradeLevel("1ap", 210000, [70000, 70000, 70000], "usr-1");
    expect(r.ok).toBe(true);
    const row = fakeClient.tables["grade_level_tuition"].find((t: Row) => t.id === "tu-1ap")!;
    expect(row.annual_amount).toBe(210000);
    expect(row.tranche_1_amount).toBe(70000);
    // The stream re-emits the DB value.
    const observed = repo.observe().get();
    expect(observed.tuitionByGradeLevel["1ap"].annualAmount).toBe(210000);
  });

  it("INSERTs the grade row when the DB lacks it (upsert semantics)", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.updateTuitionForGradeLevel("3am", 360000, [120000, 120000, 120000], "usr-1");
    expect(r.ok).toBe(true);
    const inserted = fakeClient.tables["grade_level_tuition"].find(
      (t: Row) => t.academic_level_id === LEVEL_3AM,
    );
    expect(inserted).toBeTruthy();
    expect(inserted!.annual_amount).toBe(360000);
  });

  it("rejects an unknown grade level", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.updateTuitionForGradeLevel("9ap" as never, 100000, [40000, 30000, 30000], "usr-1");
    expect(r.ok).toBe(false);
  });
});

// ============================================================================
// 3. Top-level fees + monthly
// ============================================================================

describe("T-307 — top-level fees and monthly", () => {
  it("updateRegistration UPDATEs pricing_configs.registration_fee", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.updateRegistration(6000, "usr-1");
    expect(r.ok).toBe(true);
    expect(fakeClient.tables["pricing_configs"][0].registration_fee).toBe(6000);
  });

  it("updateLatePenalty UPDATEs pricing_configs.late_penalty_per_day", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.updateLatePenalty(150, "usr-1");
    expect(r.ok).toBe(true);
    expect(fakeClient.tables["pricing_configs"][0].late_penalty_per_day).toBe(150);
  });

  it("updateSecondApronFee rejects negatives (mock parity) and updates on valid input", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const bad = await repo.updateSecondApronFee(-1, "usr-1");
    expect(bad.ok).toBe(false);
    const good = await repo.updateSecondApronFee(2500, "usr-1");
    expect(good.ok).toBe(true);
    expect(fakeClient.tables["pricing_configs"][0].second_apron_fee).toBe(2500);
  });

  it("updateMonthly routes through the audited upsert_setting RPC", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.updateMonthly("lycee", 7900, "usr-1");
    expect(r.ok).toBe(true);
    expect(fakeClient.rpcCalls.length).toBe(1);
    expect(fakeClient.rpcCalls[0].fn).toBe("upsert_setting");
    expect(fakeClient.rpcCalls[0].args.p_key).toBe("pricing.monthly.lycee");
    expect(fakeClient.rpcCalls[0].args.p_value).toBe(7900);
    expect(fakeClient.rpcCalls[0].args.p_category).toBe("system");
  });
});

// ============================================================================
// 4. Transport + services + discounts writes
// ============================================================================

describe("T-307 — transport, services and discounts writes", () => {
  it("updateTransportForDestination UPDATEs the row by code", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.updateTransportForDestination("ville_boumerdes", 45000, [20000, 12500, 12500], "usr-1");
    expect(r.ok).toBe(true);
    const row = fakeClient.tables["transport_destinations"][0];
    expect(row.annual_amount).toBe(45000);
  });

  it("addComplementaryService INSERTs with semester/annual amounts; validates parity", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const bad = await repo.addComplementaryService(
      { label: "X", qualifier: "x", semesterAmount: 12000, annualAmount: 10000 },
      "usr-1",
    );
    expect(bad.ok).toBe(false); // annual < semester
    const good = await repo.addComplementaryService(
      { label: "Orthophonie+", qualifier: "ortho_plus", semesterAmount: 11000, annualAmount: 22000 },
      "usr-1",
    );
    expect(good.ok).toBe(true);
    const inserted = fakeClient.tables["complementary_services"].find(
      (c: Row) => c.code === "ortho_plus",
    );
    expect(inserted!.annual_amount).toBe(22000);
  });

  it("addDiscount stores POSITIVE amounts in the DB (read mapping negates fixed)", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.addDiscount(
      { label: "Early bird 2027", amount: -7000, discountType: "fixed_amount", discountCode: "early_bird" },
      "usr-1",
    );
    expect(r.ok).toBe(true);
    const inserted = fakeClient.tables["discounts"].find((d: Row) => d.code === "early_bird");
    expect(inserted!.amount).toBe(7000); // positive in the DB
  });

  it("removeDiscount rejects non-UUID ids (seed-fallback rows are not deletable server-side)", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.removeDiscount("disc-passage-palier", "usr-1");
    expect(r.ok).toBe(false);
  });

  it("removeDiscount DELETEs by UUID", async () => {
    const repo = new SupabasePricingRepository(fakeClient);
    const r = await repo.removeDiscount(DISC_SENIORITY, "usr-1");
    expect(r.ok).toBe(true);
    expect(fakeClient.tables["discounts"].length).toBe(1);
  });
});

// ============================================================================
// 5. Source scans — the wiring + the drift fix
// ============================================================================

describe("T-307 — source scans (wiring + billing drift fix)", () => {
  const repoRoot = path.resolve(__dirname, "../../..");

  it("getSupabaseRepositories() overrides the pricing slot", () => {
    const src = fs.readFileSync(
      path.join(repoRoot, "src/infrastructure/supabase/supabase-repositories.ts"),
      "utf-8",
    );
    expect(src).toMatch(/const pricing = new SupabasePricingRepository\(client\)/);
    expect(src).toMatch(/^\s{4}pricing,\s*\/\/ T-307/m);
  });

  it("the batchRegister billing block reads the DB config — NO hardcoded defaultPricingConfig call site remains", () => {
    const src = fs.readFileSync(
      path.join(
        repoRoot,
        "src/infrastructure/supabase/repositories/supabase-shared-repositories.ts",
      ),
      "utf-8",
    );
    expect(src).toMatch(/billingConfig = await readDbPricingConfig\(this\.client\)/);
    expect(src).toMatch(/tuitionForGradeLevel\(billingConfig,/);
    expect(src).toMatch(/transportTranchesForDestination\(billingConfig,/);
    expect(src).toMatch(/billingConfig\.registrationFee/);
    // The three former hardcoded call sites are gone:
    expect(src).not.toMatch(/tuitionForGradeLevel\(defaultPricingConfig,/);
    expect(src).not.toMatch(/transportTranchesForDestination\(defaultPricingConfig,/);
    expect(src).not.toMatch(/defaultPricingConfig\.registrationFee/);
  });

  it("the migration wires the audit triggers on the pricing tables (T-306 companion)", () => {
    const mig = fs.readFileSync(
      path.join(repoRoot, "supabase/migrations/0086_crm_pricing_mutation_audit.sql"),
      "utf-8",
    );
    for (const table of [
      "parents",
      "students",
      "pricing_configs",
      "grade_level_tuition",
      "transport_destinations",
      "complementary_services",
      "additional_services",
      "discounts",
    ]) {
      expect(mig).toMatch(new RegExp(`create trigger ${table}_audit_row_change`));
    }
    // The financial RPC-covered tables are NOT triggered (no double audit).
    expect(mig).not.toMatch(/on public\.(payments|installments|ledger_entries)\b/);
    // The broken 0006 touch triggers on the pricing children are dropped.
    expect(mig).toMatch(/drop trigger if exists grade_level_tuition_touch_updated_at/);
    expect(mig).toMatch(/drop trigger if exists transport_destinations_touch_updated_at/);
  });
});
