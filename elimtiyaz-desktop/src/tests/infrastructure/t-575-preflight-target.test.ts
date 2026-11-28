/**
 * T-575 — the one-command target preflight verification suite
 * (scripts/preflight-target.mjs wired into build-windows.mjs as the
 * PREFLIGHT OF RECORD — the OPS-016 unlock).
 *
 * Gates (the t-573 suite's conventions):
 *  A. THE CONSOLIDATED-BASELINE CONSTANTS pinned to the charter's
 *     audit-of-record table (MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md
 *     Part 2 / RELOAD-GUIDE §A.2).
 *  B. THE CENSUS SQL SHAPES asserted against the §A.2 gate SQL.
 *  C. evaluateCensus RED-then-GREEN on EVERY axis — including the exact 54001
 *     shape (helpers secdef=3) and the schema-empty shape (the NEW project's
 *     honest today-state).
 *  D. THE T-446 STRIP/REFUSE CONVENTION on the REAL verify_t-376.sql.
 *  E. THE t-376 VERDICTS: 12/12 vs flipped vs wrong-count (the script's real
 *     check-id battery pinned against the source).
 *  F. THE EF 1:1 CENSUS against the REAL config.toml/functions tree + drifted
 *     fixtures BOTH directions (the ARCH-046 gate).
 *  G. THE APPEND-ONLY GUARD run for real.
 *  H. runManagementQuery FAIL-CLOSED MATRIX (no token → zero network I/O).
 *  I. THE AUTHENTICATED REST SMOKE LANES (publishable always; --jwt optional).
 *  J. THE ORCHESTRATION GREEN / RED / FAIL-CLOSED paths (network stubbed,
 *     real repo files).
 *  K. THE build-windows.mjs WIRING PIN (the preflight of record after the
 *     T-573 readiness probe; the token never packaged).
 *  L. THE NO-SECRETS-COMMITTED SCAN over the touched script surfaces.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// The preflight tool runs as PLAIN NODE (.mjs — build-windows.mjs imports it at
// packaging time; scripts/ is outside the root tsconfig's include, so tsc
// cannot see the .d.mts sibling). The type surface below is pinned by these
// gates themselves; vitest executes the real module.
// @ts-ignore -- .mjs outside the include tree (see scripts/preflight-target.d.mts)
import {
  CENSUS_SQL,
  CONSOLIDATED_BASELINE,
  MANAGEMENT_TOKEN_ENV,
  MANAGEMENT_USER_AGENT,
  RLS_HELPERS,
  censusFunctionsTree,
  deriveTargetRef,
  evaluateCensus,
  evaluateFunctionsCensus,
  evaluateMigrationsLayout,
  evaluateT376,
  parseFunctionsTomlEntries,
  prepareManagementSql,
  probeAuthenticatedRest,
  runAppendOnlyGuard,
  runManagementQuery,
  runPreflight,
  rowsToCensus,
} from "../../../scripts/preflight-target.mjs";

const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NEW_PROJECT_URL = "https://gvuvibcsfjhwcjikgxql.supabase.co";
const OLD_PROJECT_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const TEST_PUBLIC_KEY = "sb_publishable_0000000000000000000000000000test";
const TEST_MANAGEMENT_TOKEN = "sbp_local-test-token";

// ============================================================================
// A. The consolidated-baseline constants — pinned to the charter's
//    audit-of-record table (Part 2) + the §A.2 verification gate.
// ============================================================================

describe("T-575 A — the consolidated-baseline constants (the charter's audit of record)", () => {
  it("pins every census axis to the charter Part-2 table", () => {
    // T-590..T-593 / Session 35: the Stage-A chain (0002..0005) moved the
    // census to the whole applied chain.
    expect(CONSOLIDATED_BASELINE.migrationCount).toBe(5);
    expect(CONSOLIDATED_BASELINE.migrationVersion).toBe("0005");
    expect(CONSOLIDATED_BASELINE.publicTables).toBe(99);
    expect(CONSOLIDATED_BASELINE.views).toBe(14);
    expect(CONSOLIDATED_BASELINE.matviews).toBe(5);
    expect(CONSOLIDATED_BASELINE.buckets).toBe(11);
    expect(CONSOLIDATED_BASELINE.functions).toBe(157);
    expect(CONSOLIDATED_BASELINE.rlsEnabledTables).toBe(99);
    expect(CONSOLIDATED_BASELINE.t376Checks).toBe(12);
  });

  it("pins the policy split (242 public + 22 storage = the final live set, drops included)", () => {
    expect(CONSOLIDATED_BASELINE.publicPolicies).toBe(242);
    expect(CONSOLIDATED_BASELINE.storagePolicies).toBe(22);
    expect(CONSOLIDATED_BASELINE.publicPolicies + CONSOLIDATED_BASELINE.storagePolicies).toBe(264);
  });

  it("pins the trigger split (89 public + the auth.users mirror = 90)", () => {
    expect(CONSOLIDATED_BASELINE.publicTriggers).toBe(89);
    expect(CONSOLIDATED_BASELINE.authMirrorTriggers).toBe(1);
    expect(CONSOLIDATED_BASELINE.publicTriggers + CONSOLIDATED_BASELINE.authMirrorTriggers).toBe(90);
  });

  it("pins the EXACT five mv_* matview names (the §A.2 gate's `pg_matviews` expectation)", () => {
    expect([...CONSOLIDATED_BASELINE.matviewNames].sort()).toEqual([
      "mv_dashboard_kpis",
      "mv_debt_aging",
      "mv_grade_summary",
      "mv_revenue_by_month",
      "mv_top_debtors",
    ]);
  });

  it("pins the five RLS helpers (the §A.2 54001-gate SQL's exact IN-list) and the token convention", () => {
    expect([...RLS_HELPERS].sort()).toEqual([
      "current_tenant_id",
      "current_user_profile_id",
      "has_any_role",
      "has_permission",
      "has_role",
    ]);
    expect(MANAGEMENT_TOKEN_ENV).toBe("SUPABASE_ACCESS_TOKEN");
    expect(MANAGEMENT_USER_AGENT).toBe("curl/8.5.0");
  });
});

// ============================================================================
// B. The census SQL shapes — asserted against the §A.2 gate SQL.
// ============================================================================

describe("T-575 B — the census SQL carries the §A.2 gate shapes", () => {
  it("every axis query keeps its §A.2 gate-SQL shape", () => {
    expect(CENSUS_SQL.migrations).toContain("supabase_migrations.schema_migrations");
    expect(CENSUS_SQL.publicTables).toContain("information_schema.tables");
    expect(CENSUS_SQL.publicTables).toContain("table_schema = 'public'");
    expect(CENSUS_SQL.views).toContain("pg_views");
    expect(CENSUS_SQL.views).toContain("schemaname = 'public'");
    expect(CENSUS_SQL.matviews).toContain("pg_matviews");
    expect(CENSUS_SQL.matviews).toContain("schemaname = 'public'");
    expect(CENSUS_SQL.buckets).toContain("storage.buckets");
    expect(CENSUS_SQL.publicPolicies).toContain("pg_policies");
    expect(CENSUS_SQL.publicPolicies).toContain("schemaname = 'public'");
    expect(CENSUS_SQL.storagePolicies).toContain("pg_policies");
    expect(CENSUS_SQL.storagePolicies).toContain("schemaname = 'storage'");
    expect(CENSUS_SQL.rlsEnabled).toContain("relrowsecurity");
  });

  it("the helpers query names all five RLS helpers with the §A.2 prosecdef/proconfig shape", () => {
    for (const helper of RLS_HELPERS) {
      expect(CENSUS_SQL.rlsHelpers).toContain(`'${helper}'`);
    }
    expect(CENSUS_SQL.rlsHelpers).toContain("prosecdef");
    expect(CENSUS_SQL.rlsHelpers).toContain("proconfig");
  });
});

// ============================================================================
// C. evaluateCensus — RED-then-GREEN on every axis.
// ============================================================================

const BASELINE_VIEWS = Array.from({ length: 14 }, (_, i) => `v_baseline_${i}`);

function baselineCensus() {
  return {
    migrations: { count: 5, version: "0005" },
    publicTables: 99,
    views: [...BASELINE_VIEWS],
    matviews: [...CONSOLIDATED_BASELINE.matviewNames],
    buckets: 11,
    publicPolicies: 242,
    storagePolicies: 22,
    functions: 157,
    publicTriggers: 89,
    authMirrorTriggers: 1,
    rlsEnabled: 99,
    rlsHelpers: RLS_HELPERS.map((proname) => ({
      proname,
      prosecdef: true,
      proconfig: "search_path=public,extra=setting" as string | null,
    })),
  };
}

describe("T-575 C — evaluateCensus (RED-then-GREEN on every axis)", () => {
  it("GREEN: the baseline-shaped observation passes every axis", () => {
    const verdict = evaluateCensus(baselineCensus());
    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.axes.map((a: { id: string }) => a.id)).toEqual([
      "migrations-count",
      "migrations-version",
      "public-tables",
      "views",
      "matviews-count",
      "matviews-names",
      "buckets",
      "public-policies",
      "storage-policies",
      "functions",
      "public-triggers",
      "auth-mirror-trigger",
      "rls-enabled",
      "rls-helpers-secdef-search-path",
    ]);
  });

  const flips: Array<[string, (c: ReturnType<typeof baselineCensus>) => void, string, number]> = [
    ["public-tables", (c) => { c.publicTables = 100; }, "public-tables", 1],
    ["views", (c) => { c.views.pop(); }, "views", 1],
    // A dropped matview fails BOTH the count and the exact-name-set axes:
    ["matviews-count", (c) => { c.matviews.pop(); }, "matviews-count", 2],
    ["matviews-names", (c) => { c.matviews[0] = "mv_wrong_name"; }, "matviews-names", 1],
    ["buckets", (c) => { c.buckets = 10; }, "buckets", 1],
    ["public-policies", (c) => { c.publicPolicies = 241; }, "public-policies", 1],
    ["storage-policies", (c) => { c.storagePolicies = 21; }, "storage-policies", 1],
    ["functions", (c) => { c.functions = 146; }, "functions", 1],
    ["public-triggers", (c) => { c.publicTriggers = 88; }, "public-triggers", 1],
    ["auth-mirror-trigger", (c) => { c.authMirrorTriggers = 2; }, "auth-mirror-trigger", 1],
    ["rls-enabled", (c) => { c.rlsEnabled = 98; }, "rls-enabled", 1],
  ];
  for (const [label, mutate, axisId, failureCount] of flips) {
    it(`RED: a drifted ${label} axis fails and NAMES the axis`, () => {
      const observed = baselineCensus();
      mutate(observed);
      const verdict = evaluateCensus(observed);
      expect(verdict.ok).toBe(false);
      expect(verdict.failures.join(" ")).toContain(axisId);
      expect(verdict.failures.length).toBe(failureCount);
    });
  }

  it("RED: the migration lane fails on a drifted count, a drifted version, or a multi-row table", () => {
    const twoRows = baselineCensus();
    (twoRows.migrations as { count: number }).count = 2;
    expect(evaluateCensus(twoRows).failures.join(" ")).toContain("migrations-count");

    const wrongVersion = baselineCensus();
    (wrongVersion.migrations as { version: string }).version = "0002";
    expect(evaluateCensus(wrongVersion).failures.join(" ")).toContain("migrations-version");
  });

  it("RED: THE EXACT 54001 SHAPE — helpers with secdef on only 3 of 5 — fails naming the 54001 family", () => {
    const observed = baselineCensus();
    observed.rlsHelpers = RLS_HELPERS.map((proname, index) => ({
      proname,
      prosecdef: index < 3,
      proconfig: "search_path=public",
    }));
    const verdict = evaluateCensus(observed);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(" ")).toContain("rls-helpers-secdef-search-path");
    expect(verdict.failures.join(" ")).toContain("54001");
    expect(verdict.failures.join(" ")).toContain("3/5");
  });

  // T-614/P2 (Session 40): the MEASURED full-chain census (the charter Rule-3
  // from-scratch validation — docs/recovery/t-a2-chain-from-scratch-validation-
  // 2026-11-22.md) observes 157 public functions. The pre-Stage-A constant 147
  // would have false-REDed the preflight of record at the owner's apply
  // window (the C-29 family: constants lagging the chain). Pinned both ways:
  // the measured observation passes; the stale 147 observation FAILS.
  it("T-614/P2: the MEASURED 157 observation is GREEN; the stale 147 observation REDs the functions axis", () => {
    const measured = baselineCensus();
    measured.functions = 157;
    expect(evaluateCensus(measured).ok).toBe(true);

    const stale = baselineCensus();
    stale.functions = 147;
    const verdict = evaluateCensus(stale);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(" ")).toContain("functions");
    expect(verdict.failures.join(" ")).toContain("147");
  });

  it("RED: an unpinned search_path on even ONE helper fails (the 54001 recursion trap)", () => {
    const observed = baselineCensus();
    observed.rlsHelpers[0] = { proname: observed.rlsHelpers[0].proname, prosecdef: true, proconfig: null };
    const verdict = evaluateCensus(observed);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(" ")).toContain("pinned 4/5");
  });

  it("RED: THE SCHEMA-EMPTY SHAPE (the NEW project's honest today-state) fails on the census axes", () => {
    const empty = {
      migrations: { count: 0 },
      publicTables: 0,
      views: [],
      matviews: [],
      buckets: 0,
      publicPolicies: 0,
      storagePolicies: 0,
      functions: 0,
      publicTriggers: 0,
      authMirrorTriggers: 0,
      rlsEnabled: 0,
      rlsHelpers: [],
    };
    const verdict = evaluateCensus(empty);
    expect(verdict.ok).toBe(false);
    // A schema-empty target answers every census query — and is NOT parity:
    expect(verdict.failures.length).toBeGreaterThanOrEqual(13);
    expect(verdict.failures.join(" ")).toContain("rls-helpers-secdef-search-path");
  });

  it("rowsToCensus reduces raw query rows (string counts coerced; helpers normalized)", () => {
    const reduced = rowsToCensus({
      migrations: [{ version: "0001" }],
      publicTables: [{ n: "99" }],
      views: [{ viewname: "v_a" }, { viewname: "v_b" }],
      matviews: CONSOLIDATED_BASELINE.matviewNames.map((name: string) => ({ matviewname: name })),
      buckets: [{ n: 11 }],
      publicPolicies: [{ n: "242" }],
      storagePolicies: [{ n: "22" }],
      functions: [{ n: "157" }],
      publicTriggers: [{ n: "89" }],
      authMirrorTriggers: [{ n: "1" }],
      rlsEnabled: [{ n: "99" }],
      rlsHelpers: [
        { proname: "has_role", prosecdef: true, proconfig: null },
        { proname: "has_permission", prosecdef: "true", proconfig: "search_path=public" },
      ],
    });
    expect(reduced.publicTables).toBe(99);
    expect(reduced.publicPolicies).toBe(242);
    expect(reduced.views).toEqual(["v_a", "v_b"]);
    expect(reduced.matviews).toHaveLength(5);
    expect(reduced.rlsHelpers[0].prosecdef).toBe(true);
    expect(reduced.rlsHelpers[0].proconfig).toBeNull();
    expect(reduced.rlsHelpers[1].prosecdef).toBe(true);
    expect(reduced.rlsHelpers[1].proconfig).toBe("search_path=public");
  });
});

// ============================================================================
// D. The T-446 strip/REFUSE convention — on the REAL verify_t-376.sql.
// ============================================================================

const realT376Sql = readFileSync(join(repoDir, "scripts", "verify_t-376.sql"), "utf8");

describe("T-575 D — prepareManagementSql (the T-446 strip/REFUSE convention)", () => {
  it("strips the trailing ROLLBACK from the REAL script while keeping BEGIN + the results SELECT", () => {
    const prepared = prepareManagementSql(realT376Sql);
    expect(prepared).toMatch(/begin\s*;/i);
    expect(prepared).not.toMatch(/rollback\s*;?\s*$/i);
    expect(prepared).toContain("t376_results");
    expect(prepared).toContain("ROLLBACK"); // the interior BEGIN/ROLLBACK-safe doc note stays honest
  });

  it("REFUSES unwrapped SQL (no BEGIN) — never submit non-transactional scripts", () => {
    expect(() => prepareManagementSql("select 1;")).toThrow(/REFUSED/);
    expect(() => prepareManagementSql("update tenants set name = 'x';")).toThrow(/REFUSED/);
  });

  it("REFUSES empty / non-string payloads", () => {
    expect(() => prepareManagementSql("")).toThrow(/REFUSED/);
    expect(() => prepareManagementSql("   \n -- only a comment\n")).toThrow(/REFUSED/);
  });
});

// ============================================================================
// E. The t-376 verdicts — 12/12 vs flipped vs wrong-count, against the REAL
//    script's check-id battery.
// ============================================================================

const T376_CHECK_IDS = [
  "A1-helper-count-secdef",
  "A2-helper-search-path-pinned",
  "A3-helper-owner-bypassrls",
  "B1-select-own-fast-path",
  "B2-rls-still-forced",
  "C1-profile-helper-no-recursion",
  "C2-own-profile-visible",
  "C3-tenant-resolved",
  "C4-super-admin-role",
  "C5-tenant-scoped-read",
  "D1-unbound-sub-sees-nothing",
  "D2-anon-sees-nothing",
];

function t376Rows(flipIndex: number | null, count = T376_CHECK_IDS.length) {
  return T376_CHECK_IDS.slice(0, count).map((check_id, index) => ({
    check_id,
    ok: flipIndex === null || index !== flipIndex,
    detail: `${check_id} detail`,
  }));
}

describe("T-575 E — evaluateT376 (the 12/12 verdict)", () => {
  it("the REAL script carries exactly the 12-check battery (A/B/C/D) the verdict pins", () => {
    for (const checkId of T376_CHECK_IDS) {
      expect(realT376Sql).toContain(checkId);
    }
    const insertions = realT376Sql.match(/INSERT INTO t376_results/g) ?? [];
    expect(insertions.length).toBe(12);
  });

  it("GREEN: 12/12 rows all ok → the parity verdict", () => {
    const verdict = evaluateT376(t376Rows(null));
    expect(verdict.ok).toBe(true);
    expect(verdict.passed).toBe(12);
    expect(verdict.total).toBe(12);
    expect(verdict.detail).toContain("12/12");
  });

  it("RED: one flipped row fails NAMING the check_id; a wrong count fails with the honest count", () => {
    const flipped = evaluateT376(t376Rows(4)); // B2-rls-still-forced
    expect(flipped.ok).toBe(false);
    expect(flipped.failures.join(" ")).toContain("B2-rls-still-forced");

    const short = evaluateT376(t376Rows(null, 11));
    expect(short.ok).toBe(false);
    expect(short.failures.join(" ")).toContain("11");
    expect(short.failures.join(" ")).toContain("12");

    // String booleans from JSON edges are normalized, not silently failed.
    const stringy = t376Rows(null).map((row) => ({ ...row, ok: row.ok ? "true" : "false" }));
    expect(evaluateT376(stringy).ok).toBe(true);
  });
});

// ============================================================================
// F. The EF 1:1 census — against the REAL config.toml/functions tree.
// ============================================================================

const realToml = readFileSync(join(repoDir, "supabase", "config.toml"), "utf8");
const realTree = censusFunctionsTree(join(repoDir, "supabase", "functions")) ?? [];

describe("T-575 F — the ARCH-046 EF 1:1 census (the real repo surfaces)", () => {
  it("the REAL config.toml ↔ functions/ tree censuses 1:1 (16 entries = 16 dirs, _shared excluded — T-584 grew the fleet to 16)", () => {
    const tomlNames = parseFunctionsTomlEntries(realToml);
    // T-584 (the scheduled automation runner) added workflow-scheduled-runner
    // WITH its config entry — the 1:1 invariant holds at 16 (15 was the
    // pre-T-584 count).
    expect(tomlNames.length).toBe(16);
    expect(tomlNames).toContain("bind-activation-code");
    expect(tomlNames).toContain("workflow-scheduled-runner");
    expect(realTree.length).toBe(16);
    expect(realTree).not.toContain("_shared");
    const verdict = evaluateFunctionsCensus(tomlNames, realTree);
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("1:1");
  });

  it("RED: drift in BOTH directions is named — a deployed dir missing from config.toml, and a config entry missing its dir", () => {
    const tomlDrift = evaluateFunctionsCensus(
      parseFunctionsTomlEntries(realToml).filter((name: string) => name !== "collect-payment"),
      realTree,
    );
    expect(tomlDrift.ok).toBe(false);
    expect(tomlDrift.failures.join(" ")).toContain("[functions.collect-payment]");

    const treeDrift = evaluateFunctionsCensus(
      parseFunctionsTomlEntries(realToml),
      realTree.filter((name: string) => name !== "refund-payment"),
    );
    expect(treeDrift.ok).toBe(false);
    expect(treeDrift.failures.join(" ")).toContain("supabase/functions/refund-payment/");
  });
});

// ============================================================================
// G. The append-only guard — run for real.
// ============================================================================

describe("T-575 G — the append-only migration guard (OPS-020, charter rule 5)", () => {
  it("the guard passes for real against the repo's migrations layout", () => {
    const verdict = runAppendOnlyGuard({ cwd: repoDir });
    expect(verdict.ok).toBe(true);
  });
});

// ============================================================================
// H. runManagementQuery — the fail-closed matrix.
// ============================================================================

describe("T-575 H — runManagementQuery (fail-closed + the §11.1 wire shape)", () => {
  it("FAILS CLOSED on a missing token BEFORE any network I/O, naming the operator env var", async () => {
    const fetchMock = vi.fn();
    const verdict = await runManagementQuery({
      projectRef: "gvuvibcsfjhwcjikgxql",
      accessToken: "",
      query: "select 1",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.kind).toBe("fail-closed");
    expect(verdict.detail).toContain(MANAGEMENT_TOKEN_ENV);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on a missing ref or a missing query (zero network)", async () => {
    const fetchMock = vi.fn();
    const noRef = await runManagementQuery({ projectRef: "", accessToken: TEST_MANAGEMENT_TOKEN, query: "select 1", fetchImpl: fetchMock as unknown as typeof fetch });
    expect(noRef.kind).toBe("fail-closed");
    const noQuery = await runManagementQuery({ projectRef: "gvuvibcsfjhwcjikgxql", accessToken: TEST_MANAGEMENT_TOKEN, query: "", fetchImpl: fetchMock as unknown as typeof fetch });
    expect(noQuery.kind).toBe("fail-closed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401/403 → the auth verdict; other non-200 → the http verdict; transport throws → the network verdict", async () => {
    const statusFetch = (status: number) =>
      vi.fn(async () => new Response("{}", { status })) as unknown as typeof fetch;
    const auth = await runManagementQuery({ projectRef: "gvuvibcsfjhwcjikgxql", accessToken: TEST_MANAGEMENT_TOKEN, query: "select 1", fetchImpl: statusFetch(401) });
    expect(auth.kind).toBe("auth");
    expect(auth.detail).toContain("fresh sbp_");

    const forbidden = await runManagementQuery({ projectRef: "gvuvibcsfjhwcjikgxql", accessToken: TEST_MANAGEMENT_TOKEN, query: "select 1", fetchImpl: statusFetch(403) });
    expect(forbidden.kind).toBe("auth");

    const serverError = await runManagementQuery({ projectRef: "gvuvibcsfjhwcjikgxql", accessToken: TEST_MANAGEMENT_TOKEN, query: "select 1", fetchImpl: statusFetch(500) });
    expect(serverError.kind).toBe("http");

    const transport = await runManagementQuery({
      projectRef: "gvuvibcsfjhwcjikgxql",
      accessToken: TEST_MANAGEMENT_TOKEN,
      query: "select 1",
      fetchImpl: (vi.fn(async () => { throw new Error("DNS gone"); })) as unknown as typeof fetch,
    });
    expect(transport.kind).toBe("network");
  });

  it("the wire shape is the §11.1 convention: Bearer token, curl UA, JSON body, the /database/query endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("https://api.supabase.com/v1/projects/gvuvibcsfjhwcjikgxql/database/query");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TEST_MANAGEMENT_TOKEN}`);
      expect(headers["User-Agent"]).toBe(MANAGEMENT_USER_AGENT);
      expect(JSON.parse(String(init?.body))).toEqual({ query: "select 1" });
      return new Response(JSON.stringify([{ ok: true }]), { status: 200 });
    });
    const verdict = await runManagementQuery({
      projectRef: "gvuvibcsfjhwcjikgxql",
      accessToken: TEST_MANAGEMENT_TOKEN,
      query: "select 1",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.rows).toEqual([{ ok: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("unwraps both response shapes (a bare row array and { rows: [...] })", async () => {
    const arrayFetch = vi.fn(async () => new Response(JSON.stringify([{ n: 1 }]), { status: 200 })) as unknown as typeof fetch;
    const wrappedFetch = vi.fn(async () => new Response(JSON.stringify({ rows: [{ n: 2 }] }), { status: 200 })) as unknown as typeof fetch;
    const bare = await runManagementQuery({ projectRef: "gvuvibcsfjhwcjikgxql", accessToken: TEST_MANAGEMENT_TOKEN, query: "select 1", fetchImpl: arrayFetch });
    const wrapped = await runManagementQuery({ projectRef: "gvuvibcsfjhwcjikgxql", accessToken: TEST_MANAGEMENT_TOKEN, query: "select 1", fetchImpl: wrappedFetch });
    expect(bare.rows).toEqual([{ n: 1 }]);
    expect(wrapped.rows).toEqual([{ n: 2 }]);
  });
});

// ============================================================================
// I. The authenticated REST smoke lanes.
// ============================================================================

describe("T-575 I — probeAuthenticatedRest (the §A.2 smoke lanes)", () => {
  const restUrl = `${NEW_PROJECT_URL}/rest/v1/tenants?select=id&limit=1`;

  it("the publishable lane runs ALWAYS (200 → ok; exactly one lane without --jwt)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(restUrl);
      expect((init?.headers as Record<string, string>).apikey).toBe(TEST_PUBLIC_KEY);
      return new Response("[]", { status: 200 });
    });
    const verdict = await probeAuthenticatedRest({ targetUrl: NEW_PROJECT_URL, publicKey: TEST_PUBLIC_KEY, fetchImpl: fetchMock as unknown as typeof fetch });
    expect(verdict.ok).toBe(true);
    expect(verdict.lanes).toHaveLength(1);
    expect(verdict.lanes[0].lane).toBe("publishable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("402 → the egress-quota verdict pointing at the owner-side G2 action; 401/500 → fail", async () => {
    const quotaFetch = vi.fn(async () => new Response("{}", { status: 402 })) as unknown as typeof fetch;
    const quota = await probeAuthenticatedRest({ targetUrl: NEW_PROJECT_URL, publicKey: TEST_PUBLIC_KEY, fetchImpl: quotaFetch });
    expect(quota.ok).toBe(false);
    expect(quota.lanes[0].detail).toContain("exceed_egress_quota");

    const unauthFetch = vi.fn(async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const unauth = await probeAuthenticatedRest({ targetUrl: NEW_PROJECT_URL, publicKey: TEST_PUBLIC_KEY, fetchImpl: unauthFetch });
    expect(unauth.ok).toBe(false);
    expect(unauth.lanes[0].detail).toContain("401");
  });

  it("the --jwt lane runs only when a JWT is supplied (Bearer + apikey, a second lane)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      if (headers.Authorization) {
        expect(headers.Authorization).toBe("Bearer staff-jwt-123");
        return new Response("[]", { status: 200 });
      }
      return new Response("[]", { status: 200 });
    });
    const twoLanes = await probeAuthenticatedRest({
      targetUrl: NEW_PROJECT_URL,
      publicKey: TEST_PUBLIC_KEY,
      jwt: "staff-jwt-123",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(twoLanes.lanes.map((lane: { lane: string }) => lane.lane)).toEqual(["publishable", "jwt"]);
    expect(twoLanes.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const jwt500 = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      return new Response("{}", { status: headers.Authorization ? 500 : 200 });
    });
    const red = await probeAuthenticatedRest({ targetUrl: NEW_PROJECT_URL, publicKey: TEST_PUBLIC_KEY, jwt: "staff-jwt-123", fetchImpl: jwt500 as unknown as typeof fetch });
    expect(red.ok).toBe(false);
    expect(red.lanes.find((lane: { lane: string }) => lane.lane === "jwt")?.detail).toContain("500");
  });
});

// ============================================================================
// J. The orchestration — GREEN / RED / FAIL-CLOSED (network stubbed).
// ============================================================================

type QueryOverrides = { publicPolicies?: string; t376Flip?: number };

function rowsForQuery(query: string, overrides: QueryOverrides = {}): Array<Record<string, unknown>> {
  if (query.includes("t376_results")) {
    return T376_CHECK_IDS.map((check_id, index) => ({
      check_id,
      ok: overrides.t376Flip === null || index !== overrides.t376Flip,
      detail: `${check_id}`,
    }));
  }
  if (query.includes("proname, prosecdef")) {
    return RLS_HELPERS.map((proname: string) => ({ proname, prosecdef: true, proconfig: "search_path=public" }));
  }
  if (query.includes("pg_policies") && query.includes("'storage'")) return [{ n: "22" }];
  if (query.includes("pg_policies")) return [{ n: overrides.publicPolicies ?? "242" }];
  if (query.includes("pg_views")) return Array.from({ length: 14 }, (_, i) => ({ viewname: `v_${i}` }));
  if (query.includes("pg_matviews")) return CONSOLIDATED_BASELINE.matviewNames.map((name: string) => ({ matviewname: name }));
  if (query.includes("storage.buckets")) return [{ n: "11" }];
  if (query.includes("information_schema.tables")) return [{ n: "99" }];
  if (query.includes("pg_trigger") && query.includes("'auth'")) return [{ n: "1" }];
  if (query.includes("pg_trigger")) return [{ n: "89" }];
  if (query.includes("relrowsecurity")) return [{ n: "99" }];
  // T-590..T-593 / Session 35: the applied chain is 0001..0005 (the Stage-A
  // SQL beside the consolidated baseline).
  if (query.includes("supabase_migrations.schema_migrations")) return [
    { version: "0001" }, { version: "0002" }, { version: "0003" }, { version: "0004" }, { version: "0005" },
  ];
  if (query.includes("pg_proc")) return [{ n: "157" }];
  return [];
}

function makeStubFetch(overrides: QueryOverrides = {}) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? String(init.body) : "";
    calls.push({ url, body });
    if (url.includes("api.supabase.com/v1/projects/")) {
      const query = JSON.parse(body).query as string;
      return new Response(JSON.stringify(rowsForQuery(query, overrides)), { status: 200 });
    }
    return new Response("[]", { status: 200 }); // the REST smoke lane
  });
  return { fetchImpl, calls };
}

describe("T-575 J — runPreflight (the orchestration, network boundary stubbed)", () => {
  it("GREEN: the baseline-answering target passes every lane (local lanes run against the REAL repo)", async () => {
    const { fetchImpl, calls } = makeStubFetch();
    const verdict = await runPreflight({
      targetUrl: NEW_PROJECT_URL,
      publicKey: TEST_PUBLIC_KEY,
      processEnv: { SUPABASE_ACCESS_TOKEN: TEST_MANAGEMENT_TOKEN },
      repoDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.projectRef).toBe("gvuvibcsfjhwcjikgxql");
    expect(verdict.failures).toEqual([]);
    for (const lane of verdict.lanes) {
      expect(lane.ok).toBe(true);
    }
    expect(verdict.summary).toContain("GREEN");
    // 12 census queries + the prepared t-376 script + the REST smoke:
    expect(calls.length).toBe(14);
    expect(calls.some((call) => call.url.includes("/rest/v1/tenants"))).toBe(true);
    // The t-376 lane went through the T-446 convention (no trailing ROLLBACK):
    const t376Call = calls.find((call) => call.body.includes("t376_results"));
    expect(t376Call).toBeDefined();
    expect(t376Call!.body).not.toMatch(/query":"[\s\S]*rollback\s*;?\s*"\s*}\s*$/);
  });

  it("RED: a drifted policies axis rejects the target and names the axis (\"N/N applied\" is NOT parity)", async () => {
    const { fetchImpl } = makeStubFetch({ publicPolicies: "241" });
    const verdict = await runPreflight({
      targetUrl: NEW_PROJECT_URL,
      publicKey: TEST_PUBLIC_KEY,
      processEnv: { SUPABASE_ACCESS_TOKEN: TEST_MANAGEMENT_TOKEN },
      repoDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(" ")).toContain("public-policies");
  });

  it("RED: a flipped t-376 check rejects the target naming the check_id", async () => {
    const { fetchImpl } = makeStubFetch({ t376Flip: 4 });
    const verdict = await runPreflight({
      targetUrl: NEW_PROJECT_URL,
      publicKey: TEST_PUBLIC_KEY,
      processEnv: { SUPABASE_ACCESS_TOKEN: TEST_MANAGEMENT_TOKEN },
      repoDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(" ")).toContain("B2-rls-still-forced");
  });

  it("FAILS CLOSED on an absent management token with ZERO network I/O (local lanes still run)", async () => {
    const { fetchImpl, calls } = makeStubFetch();
    const verdict = await runPreflight({
      targetUrl: NEW_PROJECT_URL,
      publicKey: TEST_PUBLIC_KEY,
      processEnv: {},
      repoDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(" ")).toContain(MANAGEMENT_TOKEN_ENV);
    expect(verdict.failures.join(" ")).toContain("FAILS CLOSED");
    expect(calls.length).toBe(0);
    // the local repo lanes still executed and passed:
    expect(verdict.lanes.find((lane) => lane.id === "append-only-guard")?.ok).toBe(true);
  });

  it("a non-supabase target URL is rejected at the ref-derivation gate (zero network)", async () => {
    const { fetchImpl, calls } = makeStubFetch();
    const verdict = await runPreflight({
      targetUrl: "https://relay.example.org",
      publicKey: TEST_PUBLIC_KEY,
      processEnv: { SUPABASE_ACCESS_TOKEN: TEST_MANAGEMENT_TOKEN },
      repoDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(" ")).toContain("target-ref");
    expect(calls.length).toBe(0);
  });
});

// ============================================================================
// K. The build-windows.mjs wiring pin — the preflight of record.
// ============================================================================

const packagerSource = readFileSync(join(repoDir, "scripts", "build-windows.mjs"), "utf8");

describe("T-575 K — the build-windows.mjs wiring (the preflight of record)", () => {
  it("imports the tool and invokes runPreflight AFTER the T-573 readiness probe and BEFORE any build step", () => {
    expect(packagerSource).toMatch(/import\s*\{[^}]*runPreflight[^}]*\}\s*from\s*["']\.\/preflight-target\.mjs["']/);
    const readiness = packagerSource.indexOf("await verifyTargetReadiness(");
    const preflight = packagerSource.indexOf("await runPreflight({");
    const buildStart = packagerSource.indexOf("rmSync(releaseDir");
    expect(readiness).toBeGreaterThan(-1);
    expect(preflight).toBeGreaterThan(readiness);
    expect(buildStart).toBeGreaterThan(preflight);
    // The deep gate fails the pack CLOSED with the parity doctrine in the message:
    expect(packagerSource).toContain("if (!preflight.ok)");
    expect(packagerSource).toContain("is NOT parity");
  });

  it("the management token never flows into the build environment (OPERATOR-only, never packaged)", () => {
    const codeLines = packagerSource
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"));
    const tokenLines = codeLines.filter((line) => line.includes("SUPABASE_ACCESS_TOKEN"));
    expect(tokenLines).toEqual(["delete buildEnv.SUPABASE_ACCESS_TOKEN;"]);
  });
});

// ============================================================================
// L. The no-secrets-committed scan over the touched script surfaces.
// ============================================================================

describe("T-575 L — the no-secrets-committed scan (the t-573/t-552 convention)", () => {
  it("no secret-class key material (sb_secret_ / sbp_ real shapes) is committed in the touched scripts", () => {
    const scanned = [
      "scripts/preflight-target.mjs",
      "scripts/preflight-target.d.mts",
      "scripts/build-windows.mjs",
      "scripts/package-target.mjs",
    ];
    for (const relative of scanned) {
      const text = readFileSync(join(repoDir, relative), "utf8");
      expect(text).not.toMatch(/sb_secret_[A-Za-z0-9]{16,}/);
      expect(text).not.toMatch(/sbp_[a-f0-9]{32,}/);
    }
  });
});

// ============================================================================
// The migrations-layout lane + the target-ref derivation (pure).
// ============================================================================

describe("T-575 M — the migrations layout lane + deriveTargetRef", () => {
  it("the REAL migrations dir passes the layout lane; drifted fixtures fail", () => {
    const realFiles = readdirSync(join(repoDir, "supabase", "migrations")).filter((name) => name.endsWith(".sql"));
    const real = evaluateMigrationsLayout(realFiles);
    expect(real.ok).toBe(true);
    // T-590..T-593 / Session 35: the append-only chain grew — the Stage-A
    // SQL ships beside the baseline (0002..0005); the baseline still leads.
    // T-588 / Session 56: 0006_rbac_matrix_persistence joins the chain.
    expect(real.files).toEqual([
      "0001_initial_consolidated_schema.sql",
      "0002_stage_a_dashboard_aggregation.sql",
      "0003_read_reconcile_inputs.sql",
      "0004_pull_installments_for_sync.sql",
      "0005_sync_apply_batch.sql",
      "0006_rbac_matrix_persistence.sql",
    ]);

    expect(evaluateMigrationsLayout(["0002_next.sql"]).ok).toBe(false); // the baseline is missing
    expect(evaluateMigrationsLayout(["0000_smuggled_before.sql", "0001_initial_consolidated_schema.sql"]).ok).toBe(false); // something sorts before it
    expect(evaluateMigrationsLayout(["0001_initial_consolidated_schema.sql", "0002_successor.sql"]).ok).toBe(true); // the append-only future is fine
  });

  it("deriveTargetRef: the new + factory refs derive; non-supabase/http/garbage → null (fail-closed)", () => {
    expect(deriveTargetRef(NEW_PROJECT_URL)).toBe("gvuvibcsfjhwcjikgxql");
    expect(deriveTargetRef(OLD_PROJECT_URL)).toBe("vebfehrpzajhstyhinnw");
    expect(deriveTargetRef("https://relay.example.org")).toBeNull();
    expect(deriveTargetRef("http://gvuvibcsfjhwcjikgxql.supabase.co")).toBeNull();
    expect(deriveTargetRef("not a url")).toBeNull();
    expect(deriveTargetRef(undefined)).toBeNull();
  });
});
