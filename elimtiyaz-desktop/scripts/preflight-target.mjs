#!/usr/bin/env node
/**
 * preflight-target.mjs — T-575 (the OPS-016 unlock): the ONE-COMMAND target
 * preflight, wired into `build-windows.mjs` as the PREFLIGHT OF RECORD.
 *
 * T-573 probes target READINESS (reachable + key accepted + tenants table
 * answers). This tool proves target PARITY against the consolidated baseline
 * of record — "N/N migrations applied" is NOT functional parity
 * (AGENTS_supabase.md rule; the previous relocation's failure mode was the
 * 54001 wall):
 *
 *   REMOTE lanes (Management-API SQL, the §11.1/T-446 convention):
 *     - the census axes pinned to the charter's audit-of-record table
 *       (Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md
 *       Part 2 / SUPABASE-RELOCATION-AND-RELOAD-GUIDE.md §A.2 — as moved by
 *       the Stage-A chain, T-590..T-593 / Session 35: 5 migrations
 *       `0001`..`0005` (the consolidated baseline + the Stage-A
 *       aggregation/projection/delta/batch SQL; the census constants track
 *       the append-only chain — the charter's own design) / 99 public
 *       tables / 14 views / 5 matviews (the exact mv_*
 *       names) / 11 buckets / 242 public + 22 storage policies / 147
 *       functions / 89 public + 1 auth-mirror triggers / 99 RLS-enabled
 *       tables;
 *     - the 5 RLS helpers' SECURITY DEFINER + search_path parity (the 54001
 *       regression family);
 *     - `scripts/verify_t-376.sql` 12/12 through the T-446 convention
 *       (trailing-ROLLBACK-stripped, BEGIN/ROLLBACK-safe);
 *     - the authenticated REST smoke (the publishable-key lane always + the
 *       --jwt lane when supplied).
 *
 *   LOCAL repo lanes (no network):
 *     - the ARCH-046 `[functions.*]` ↔ `supabase/functions/` 1:1 census;
 *     - the append-only migration guard (`scripts/check-migrations-append-only.sh`)
 *       run for real;
 *     - `0001` present with nothing sorting before it.
 *
 * Charter rule 3 (OPS-020) honored: this tool is verification-ONLY — there is
 * NO apply path (the apply stays §A.2's `supabase db push` behind the local
 * from-scratch validation gate).
 *
 * The management access token is read from the OPERATOR's environment
 * (`SUPABASE_ACCESS_TOKEN`, the apply_*_live.sh convention) — NEVER by the
 * packager beyond passing `process.env` through, NEVER packaged; an absent
 * token fails CLOSED.
 *
 * OPS-015 live-lock fence: the remote lanes execute only inside a real
 * packaging run (the t-573 precedent for probe lanes) — this module is a PURE
 * module (no side effects at import time) so the t-575 suite can exercise the
 * full logic with the network boundary stubbed.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ────────────────────────────────────────────────────────────────────────────
// The consolidated baseline of record — pinned to the charter's audit-of-record
// table (MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md Part 2, re-proven S26)
// and the RELOAD-GUIDE §A.2 verification gate.
// ────────────────────────────────────────────────────────────────────────────

export const CONSOLIDATED_BASELINE = Object.freeze({
  // T-590..T-593 / Session 35: the Stage-A chain ships 0002..0005 beside the
  // consolidated baseline — the census tracks the WHOLE applied chain (the
  // pre-Stage-A record of 1/0001 is superseded; the append-only discipline
  // itself is what the guard verifies).
  migrationCount: 5,
  migrationVersion: "0005",
  publicTables: 99,
  views: 14,
  matviews: 5,
  matviewNames: Object.freeze([
    "mv_dashboard_kpis",
    "mv_debt_aging",
    "mv_grade_summary",
    "mv_revenue_by_month",
    "mv_top_debtors",
  ]),
  buckets: 11,
  publicPolicies: 242,
  storagePolicies: 22,
  // T-614/P2 (Session 40): 147 was the 0001-only S26 value — the Stage-A
  // chain adds 10 NEW public functions (read_dashboard_kpis/_revenue_by_month/
  // _debt_aging/_demographics [0002], read_reconcile_inputs [0003],
  // pull_installments_for_sync [0004], sync_safe_uuid/sync_j/
  // fn_deterministic_student_code/sync_apply_batch [0005];
  // refresh_materialized_view is an OR-REPLACE of 0001's). 157 is MEASURED by
  // the charter Rule-3 from-scratch census of the full chain
  // (docs/recovery/t-a2-chain-from-scratch-validation-2026-11-22.md) — the
  // C-29 family (pre-Stage-A constants lagging the chain) closed on the
  // function axis.
  functions: 157,
  publicTriggers: 89,
  authMirrorTriggers: 1,
  rlsEnabledTables: 99,
  t376Checks: 12,
});

/** The five RLS helpers whose SECURITY DEFINER + search_path parity is the 54001 gate. */
export const RLS_HELPERS = Object.freeze([
  "current_user_profile_id",
  "current_tenant_id",
  "has_role",
  "has_any_role",
  "has_permission",
]);

export const MANAGEMENT_TOKEN_ENV = "SUPABASE_ACCESS_TOKEN";
export const MANAGEMENT_QUERY_ENDPOINT = "https://api.supabase.com/v1/projects";
/** The §11.1 convention: the Management API Cloudflare edge 403s the python-urllib UA — send the curl UA. */
export const MANAGEMENT_USER_AGENT = "curl/8.5.0";

// ────────────────────────────────────────────────────────────────────────────
// The census SQL — the §A.2 gate SQL, one axis per query (kept recognizable:
// the same information_schema/pg_catalog shapes the guide pins).
// ────────────────────────────────────────────────────────────────────────────

export const CENSUS_SQL = Object.freeze({
  migrations:
    "select version from supabase_migrations.schema_migrations order by version",
  publicTables:
    "select count(*) as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
  views:
    "select viewname from pg_views where schemaname = 'public' order by viewname",
  matviews:
    "select matviewname from pg_matviews where schemaname = 'public' order by matviewname",
  buckets:
    "select count(*) as n from storage.buckets",
  publicPolicies:
    "select count(*) as n from pg_policies where schemaname = 'public'",
  storagePolicies:
    "select count(*) as n from pg_policies where schemaname = 'storage'",
  functions:
    "select count(*) as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public'",
  publicTriggers:
    "select count(*) as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and not t.tgisinternal",
  authMirrorTriggers:
    "select count(*) as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'auth' and not t.tgisinternal",
  rlsEnabled:
    "select count(*) as n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relrowsecurity",
  rlsHelpers: `select proname, prosecdef, array_to_string(proconfig, ',') as proconfig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname in ('${RLS_HELPERS.join("','")}') order by proname`,
});

// ────────────────────────────────────────────────────────────────────────────
// Pure evaluation helpers (unit-tested by the t-575 suite).
// ────────────────────────────────────────────────────────────────────────────

function axis(axes, failures, id, expected, observed, ok, detail) {
  const entry = { id, expected, observed, ok, detail };
  axes.push(entry);
  if (!ok) failures.push(`${id}: ${detail}`);
  return entry;
}

/**
 * evaluateCensus — RED/GREEN verdict on every census axis.
 *
 * @param {object} observed the normalized observation:
 *   migrations: { count: number, version?: string }
 *   publicTables: number, views: string[], matviews: string[], buckets: number,
 *   publicPolicies: number, storagePolicies: number, functions: number,
 *   publicTriggers: number, authMirrorTriggers: number, rlsEnabled: number,
 *   rlsHelpers: Array<{ proname: string, prosecdef: boolean, proconfig?: string | null }>
 * @returns {{ ok: boolean, axes: object[], failures: string[] }}
 */
export function evaluateCensus(observed) {
  const axes = [];
  const failures = [];
  const B = CONSOLIDATED_BASELINE;
  const o = observed ?? {};

  const migrations = o.migrations ?? { count: 0 };
  axis(
    axes, failures, "migrations-count",
    B.migrationCount, migrations.count,
    Number(migrations.count) === B.migrationCount,
    `supabase_migrations rows = ${migrations.count} (expected ${B.migrationCount} — the consolidated baseline + the Stage-A chain; the 152-file chain is frozen history, never registered)`,
  );
  const version = typeof migrations.version === "string" ? migrations.version : "(none)";
  axis(
    axes, failures, "migrations-version",
    B.migrationVersion, version,
    version === B.migrationVersion,
    `head version = ${version} (expected ${B.migrationVersion})`,
  );

  const scalar = (id, expected, observedValue, label) =>
    axis(axes, failures, id, expected, observedValue,
      Number(observedValue) === expected, `${label} = ${observedValue} (expected ${expected})`);

  scalar("public-tables", B.publicTables, o.publicTables, "public tables");
  const views = Array.isArray(o.views) ? o.views : [];
  axis(axes, failures, "views", B.views, views.length,
    views.length === B.views, `public views = ${views.length} (expected ${B.views})`);
  const matviews = Array.isArray(o.matviews) ? o.matviews : [];
  axis(axes, failures, "matviews-count", B.matviews, matviews.length,
    matviews.length === B.matviews, `public matviews = ${matviews.length} (expected ${B.matviews})`);
  axis(axes, failures, "matviews-names", B.matviewNames.join(","), matviews.slice().sort().join(","),
    matviews.slice().sort().join(",") === B.matviewNames.join(","),
    `matview set = [${matviews.slice().sort().join(", ")}] (expected the exact mv_* five)`);
  scalar("buckets", B.buckets, o.buckets, "storage buckets");
  scalar("public-policies", B.publicPolicies, o.publicPolicies, "public policies");
  scalar("storage-policies", B.storagePolicies, o.storagePolicies, "storage policies");
  scalar("functions", B.functions, o.functions, "public functions");
  scalar("public-triggers", B.publicTriggers, o.publicTriggers, "public triggers");
  scalar("auth-mirror-trigger", B.authMirrorTriggers, o.authMirrorTriggers, "auth.users mirror trigger");
  scalar("rls-enabled", B.rlsEnabledTables, o.rlsEnabled, "RLS-enabled public tables");

  // The 54001 regression family: the five RLS helpers must exist, carry
  // SECURITY DEFINER, and pin search_path=public.
  const helpers = Array.isArray(o.rlsHelpers) ? o.rlsHelpers : [];
  const secdefCount = helpers.filter((h) => h && h.prosecdef === true).length;
  const pinnedCount = helpers.filter(
    (h) => typeof h.proconfig === "string" && h.proconfig.includes("search_path=public"),
  ).length;
  const helperNames = helpers.map((h) => h?.proname).filter(Boolean).sort().join(",");
  const helpersOk =
    helperNames === RLS_HELPERS.slice().sort().join(",") &&
    secdefCount === RLS_HELPERS.length &&
    pinnedCount === RLS_HELPERS.length;
  axis(
    axes, failures, "rls-helpers-secdef-search-path",
    `${RLS_HELPERS.length}/${RLS_HELPERS.length} secdef+pinned`,
    `${secdefCount}/${helpers.length} secdef, ${pinnedCount}/${helpers.length} pinned`,
    helpersOk,
    helpersOk
      ? "the five RLS helpers carry SECURITY DEFINER + search_path=public (the 54001 gate holds)"
      : `helpers = [${helperNames}] · secdef ${secdefCount}/${RLS_HELPERS.length} · search_path-pinned ${pinnedCount}/${RLS_HELPERS.length} — THE 54001 SHAPE (a helper without SECURITY DEFINER or an unpinned search_path recurses every authenticated read into the 54001 stack-depth wall)`,
  );

  return { ok: failures.length === 0, axes, failures };
}

/**
 * rowsToCensus — reduce raw Management-API query rows (each census axis
 * answered by one query) into the normalized observation evaluateCensus takes.
 * Count-style rows arrive as [{ n: 99 }] (n may be string or number — coerced).
 *
 * @param {Record<string, Array<Record<string, unknown>>>} responses
 */
export function rowsToCensus(responses) {
  const r = responses ?? {};
  const count = (rows) => {
    const first = Array.isArray(rows) ? rows[0] : undefined;
    return Number(first?.n ?? 0);
  };
  const names = (rows, key) =>
    (Array.isArray(rows) ? rows : []).map((row) => String(row?.[key] ?? "")).filter(Boolean);
  const migrationRows = Array.isArray(r.migrations) ? r.migrations : [];
  const helpers = (Array.isArray(r.rlsHelpers) ? r.rlsHelpers : []).map((row) => ({
    proname: String(row?.proname ?? ""),
    prosecdef: row?.prosecdef === true || row?.prosecdef === "true" || row?.prosecdef === "t",
    proconfig: row?.proconfig == null ? null : String(row.proconfig),
  }));
  return {
    // T-590..T-593 / Session 35: the chain grew — the SQL orders by version
    // ASCENDING, so the HEAD (the latest applied migration) is the LAST row
    // (rows[0] was the oldest; with the pre-Stage-A single-row chain the two
    // coincided).
    migrations: { count: migrationRows.length, version: migrationRows[migrationRows.length - 1]?.version },
    publicTables: count(r.publicTables),
    views: names(r.views, "viewname"),
    matviews: names(r.matviews, "matviewname"),
    buckets: count(r.buckets),
    publicPolicies: count(r.publicPolicies),
    storagePolicies: count(r.storagePolicies),
    functions: count(r.functions),
    publicTriggers: count(r.publicTriggers),
    authMirrorTriggers: count(r.authMirrorTriggers),
    rlsEnabled: count(r.rlsEnabled),
    rlsHelpers: helpers,
  };
}

/**
 * evaluateT376 — the verify_t-376.sql verdict: exactly 12 result rows, all ok.
 *
 * @param {Array<{ check_id?: string, ok?: boolean | string, detail?: string }>} rows
 */
export function evaluateT376(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const bad = list.filter((row) => !(row?.ok === true || row?.ok === "true" || row?.ok === "t"));
  const expected = CONSOLIDATED_BASELINE.t376Checks;
  const ok = list.length === expected && bad.length === 0;
  const failures = [];
  if (list.length !== expected) {
    failures.push(`t-376 row count = ${list.length} (expected ${expected} — the script's full A/B/C/D battery)`);
  }
  for (const row of bad) {
    failures.push(`t-376 check FAILED: ${row?.check_id ?? "(unknown)"} — ${row?.detail ?? ""}`);
  }
  return {
    ok,
    passed: list.length - bad.length,
    total: list.length,
    failures,
    detail: ok
      ? `verify_t-376 ${list.length}/${expected} PASS (SECURITY DEFINER parity + the fast-path policy + the authenticated happy paths + the anon/unbound regression paths)`
      : failures.join("; "),
  };
}

/**
 * prepareManagementSql — the T-446 convention: take a BEGIN/ROLLBACK-safe
 * verification script and strip the TRAILING ROLLBACK so the Management-API
 * SQL endpoint executes it and returns the results SELECT. Scripts WITHOUT the
 * BEGIN wrapper are REFUSED (the wrapper is what makes arbitrary verification
 * SQL safe to submit — never run unwrapped SQL through this path).
 *
 * @param {string} sql
 * @returns {string} the stripped SQL
 * @throws {Error} on empty/non-string input or a missing BEGIN wrapper
 */
export function prepareManagementSql(sql) {
  if (typeof sql !== "string" || !sql.trim()) {
    throw new Error("REFUSED: the management SQL payload is empty");
  }
  // Strip the leading comment header (the §11.1 doc-note convention) before
  // asserting the wrapper — the REAL verify_t-376.sql opens with a license of
  // `--` commentary above its BEGIN;.
  const strippedComments = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "");
  if (!strippedComments.trim()) {
    throw new Error("REFUSED: the management SQL payload contains no statements");
  }
  if (!/^begin\b/i.test(strippedComments.trim())) {
    throw new Error(
      "REFUSED: the T-446 convention requires the BEGIN/ROLLBACK-safe wrapper (unwrapped SQL is never submitted)",
    );
  }
  return sql.trim().replace(/rollback\s*;?\s*$/i, "").trim();
}

/**
 * runManagementQuery — one Management-API SQL round trip (the §11.1
 * convention: Bearer token, curl UA, JSON {"query"} body). FAIL-CLOSED on a
 * missing ref/token/query BEFORE any network I/O.
 *
 * @param {object} input { projectRef, accessToken, query, fetchImpl? }
 */
export async function runManagementQuery({ projectRef, accessToken, query, fetchImpl = fetch }) {
  if (!projectRef || typeof projectRef !== "string") {
    return { ok: false, kind: "fail-closed", status: 0, rows: [], detail: "missing project ref (derive it from the target URL)" };
  }
  if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
    return {
      ok: false, kind: "fail-closed", status: 0, rows: [],
      detail: `missing management token — export ${MANAGEMENT_TOKEN_ENV} (read from the OPERATOR environment, never packaged)`,
    };
  }
  if (!query || typeof query !== "string") {
    return { ok: false, kind: "fail-closed", status: 0, rows: [], detail: "missing SQL payload" };
  }
  let response;
  try {
    response = await fetchImpl(`${MANAGEMENT_QUERY_ENDPOINT}/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        "Content-Type": "application/json",
        "User-Agent": MANAGEMENT_USER_AGENT,
      },
      body: JSON.stringify({ query }),
    });
  } catch (error) {
    return {
      ok: false, kind: "network", status: 0, rows: [],
      detail: `management query transport failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      kind: response.status === 401 || response.status === 403 ? "auth" : "http",
      status: response.status,
      rows: [],
      detail:
        response.status === 401 || response.status === 403
          ? `HTTP ${response.status} — the management token was rejected (a fresh sbp_ access token is required)`
          : `HTTP ${response.status} from the Management-API SQL endpoint`,
    };
  }
  const body = await response.json().catch(() => null);
  const rows = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : [];
  return { ok: true, kind: "ok", status: response.status, rows, detail: "management query executed" };
}

/**
 * probeAuthenticatedRest — the §A.2 authenticated REST smoke:
 * GET /rest/v1/tenants?select=id&limit=1 against the TARGET.
 * The publishable-key lane runs ALWAYS; the --jwt lane only when a JWT is
 * supplied (200 expected — never 401/500/402).
 *
 * @param {object} input { targetUrl, publicKey, jwt?, fetchImpl? }
 */
export async function probeAuthenticatedRest({ targetUrl, publicKey, jwt, fetchImpl = fetch }) {
  const lanes = [];
  const url = `${String(targetUrl).replace(/\/+$/, "")}/rest/v1/tenants?select=id&limit=1`;
  const oneLane = async (lane, headers) => {
    let response;
    try {
      response = await fetchImpl(url, { method: "GET", headers });
    } catch (error) {
      return { lane, ok: false, status: 0, detail: `REST smoke transport failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (response.status === 402) {
      return {
        lane, ok: false, status: 402,
        detail: "HTTP 402 — the target project is egress-quota-blocked (exceed_egress_quota); lift the cap (the owner-side G2 action) before packaging",
      };
    }
    if (!response.ok) {
      return { lane, ok: false, status: response.status, detail: `HTTP ${response.status} from the target REST gateway (expected 200 — not 401/500)` };
    }
    return { lane, ok: true, status: response.status, detail: "200 — the authenticated REST gateway answers" };
  };
  lanes.push(await oneLane("publishable", { apikey: publicKey }));
  if (jwt && typeof jwt === "string" && jwt.trim()) {
    lanes.push(await oneLane("jwt", { apikey: publicKey, Authorization: `Bearer ${jwt.trim()}` }));
  }
  return { ok: lanes.every((lane) => lane.ok), lanes };
}

// ────────────────────────────────────────────────────────────────────────────
// The LOCAL repo lanes.
// ────────────────────────────────────────────────────────────────────────────

/** Parse the `[functions.<name>]` entries out of supabase/config.toml (the ARCH-046 census side). */
export function parseFunctionsTomlEntries(text) {
  if (typeof text !== "string") return [];
  const names = [];
  for (const match of text.matchAll(/^\[functions\.([a-z0-9-]+)\]\s*$/gm)) {
    names.push(match[1]);
  }
  return names;
}

/** Census the edge-function directories under supabase/functions/ (minus the _shared module). */
export function censusFunctionsTree(functionsDir) {
  try {
    return readdirSync(functionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
      .map((entry) => entry.name);
  } catch {
    return null;
  }
}

/**
 * evaluateFunctionsCensus — the ARCH-046 permanent 1:1 census gate: the
 * config.toml `[functions.*]` entries and the functions/ tree must match
 * EXACTLY in both directions.
 */
export function evaluateFunctionsCensus(tomlNames, treeNames) {
  const toml = Array.isArray(tomlNames) ? tomlNames : [];
  const tree = Array.isArray(treeNames) ? treeNames : [];
  const missingInToml = tree.filter((name) => !toml.includes(name));
  const missingInTree = toml.filter((name) => !tree.includes(name));
  const ok = toml.length > 0 && tree.length > 0 && missingInToml.length === 0 && missingInTree.length === 0;
  return {
    ok,
    tomlCount: toml.length,
    treeCount: tree.length,
    failures: [
      ...missingInToml.map((name) => `config.toml is missing the [functions.${name}] entry for the deployed directory`),
      ...missingInTree.map((name) => `supabase/functions/${name}/ exists on disk but has no [functions.${name}] config.toml entry`),
    ],
    detail: ok
      ? `the [functions.*] ↔ functions/ census is 1:1 (${toml.length} entries = ${tree.length} directories, _shared excluded)`
      : `EF census drift (config.toml ${toml.length} entries vs functions/ ${tree.length} directories)`,
  };
}

/** The migrations/ layout lane: `0001` present, nothing sorting before it. */
export function evaluateMigrationsLayout(fileNames) {
  const files = Array.isArray(fileNames) ? fileNames.slice().sort() : [];
  const baseline = "0001_initial_consolidated_schema.sql";
  const failures = [];
  if (!files.includes(baseline)) {
    failures.push(`migrations/ is missing the consolidated baseline ${baseline}`);
  }
  if (files.length > 0 && files[0] < baseline) {
    failures.push(`a migration sorts BEFORE the consolidated baseline: ${files[0]}`);
  }
  return {
    ok: failures.length === 0,
    files,
    failures,
    detail: failures.length === 0
      ? `migrations/ layout OK (${files.join(", ") || "empty"} — the consolidated baseline leads)`
      : failures.join("; "),
  };
}

/** Run the append-only migration guard for real (charter rule 5 / OPS-020). */
export function runAppendOnlyGuard({ cwd, execImpl = execFileSync } = {}) {
  try {
    const stdout = execImpl("bash", ["scripts/check-migrations-append-only.sh"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: String(stdout), failures: [], detail: String(stdout).trim().split("\n").pop() || "guard OK" };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      failures: [`the append-only migration guard FAILED: ${error instanceof Error ? error.message : String(error)}`],
      detail: `guard exit non-zero: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Derive the Supabase project ref from a *.supabase.co target URL (null otherwise). */
export function deriveTargetRef(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (!parsed.hostname.endsWith(".supabase.co")) return null;
    const ref = parsed.hostname.slice(0, -".supabase.co".length);
    return /^[a-z0-9]{20}$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// The orchestration — the preflight of record.
// ────────────────────────────────────────────────────────────────────────────

function defaultRepoDir() {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..");
}

/**
 * runPreflight — the ONE-COMMAND target preflight. Local repo lanes always
 * run; remote lanes run only when the management token is present (absent =
 * FAIL-CLOSED with zero network I/O).
 *
 * @param {object} options {
 *   targetUrl, publicKey, jwt?, processEnv?, repoDir?, fetchImpl?, execImpl?,
 * }
 */
export async function runPreflight(options = {}) {
  const {
    targetUrl,
    publicKey,
    jwt,
    processEnv = {},
    repoDir = defaultRepoDir(),
    fetchImpl = fetch,
    execImpl = execFileSync,
  } = options;

  const lanes = [];
  const failures = [];
  const lane = (id, verdict) => {
    lanes.push({ id, ...verdict });
    if (verdict.ok !== true) failures.push(`${id}: ${verdict.failures?.join("; ") ?? verdict.detail ?? "failed"}`);
    return verdict;
  };

  // 1 ── The local repo lanes.
  const migrationsDir = join(repoDir, "supabase", "migrations");
  let migrationFiles = null;
  try {
    migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
  } catch {
    failures.push("migrations-layout: cannot read supabase/migrations/");
  }
  lane("migrations-layout", evaluateMigrationsLayout(migrationFiles ?? []));

  let tomlNames = [];
  try {
    tomlNames = parseFunctionsTomlEntries(readFileSync(join(repoDir, "supabase", "config.toml"), "utf8"));
  } catch {
    failures.push("ef-census: cannot read supabase/config.toml");
  }
  const treeNames = censusFunctionsTree(join(repoDir, "supabase", "functions"));
  lane("ef-census", evaluateFunctionsCensus(tomlNames, treeNames ?? []));

  lane("append-only-guard", runAppendOnlyGuard({ cwd: repoDir, execImpl }));

  // 2 ── The target ref + the operator token (fail-closed).
  const projectRef = deriveTargetRef(targetUrl);
  if (!projectRef) {
    return {
      ok: false,
      lanes,
      failures: [...failures, `target-ref: "${String(targetUrl)}" is not an https://<20-char-ref>.supabase.co target URL`],
      summary: "preflight FAILED (the target URL does not name a Supabase project ref)",
    };
  }
  const accessToken = (processEnv?.[MANAGEMENT_TOKEN_ENV] ?? "").trim();
  if (!accessToken) {
    return {
      ok: false,
      lanes,
      failures: [
        ...failures,
        `management-token: ${MANAGEMENT_TOKEN_ENV} is absent — the preflight of record FAILS CLOSED (the token is read from the OPERATOR environment, never by the packager, never packaged)`,
      ],
      summary: `preflight FAILED CLOSED for ${projectRef} — export ${MANAGEMENT_TOKEN_ENV}`,
    };
  }

  // 3 ── The remote census lanes (Management-API SQL, the T-446 convention).
  const responses = {};
  for (const [key, query] of Object.entries(CENSUS_SQL)) {
    const verdict = await runManagementQuery({ projectRef, accessToken, query, fetchImpl });
    responses[key] = verdict.ok ? verdict.rows : null;
    if (!verdict.ok) {
      failures.push(`census-${key}: ${verdict.detail}`);
      lanes.push({ id: `census-${key}`, ok: false, detail: verdict.detail, failures: [verdict.detail] });
    }
  }
  if (failures.length === 0 || Object.values(responses).some((rows) => rows !== null)) {
    // Evaluate whatever came back — a schema-empty target answers every census
    // query fine (with zeros) and must FAIL the parity verdict honestly.
    const filled = {};
    for (const [key, rows] of Object.entries(responses)) {
      filled[key] = rows ?? [];
    }
    const census = evaluateCensus(rowsToCensus(filled));
    lane("census-parity", census);
  }

  // 4 ── verify_t-376 12/12 through the T-446 convention.
  try {
    const t376Sql = readFileSync(join(repoDir, "scripts", "verify_t-376.sql"), "utf8");
    const prepared = prepareManagementSql(t376Sql);
    const verdict = await runManagementQuery({ projectRef, accessToken, query: prepared, fetchImpl });
    if (!verdict.ok) {
      lane("t-376", { ok: false, failures: [verdict.detail], detail: verdict.detail });
    } else {
      lane("t-376", evaluateT376(verdict.rows));
    }
  } catch (error) {
    lane("t-376", {
      ok: false,
      failures: [`t-376 lane failed: ${error instanceof Error ? error.message : String(error)}`],
      detail: String(error),
    });
  }

  // 5 ── The authenticated REST smoke.
  const rest = await probeAuthenticatedRest({ targetUrl, publicKey, jwt, fetchImpl });
  lane("rest-smoke", { ok: rest.ok, lanes: rest.lanes, failures: rest.lanes.filter((l) => !l.ok).map((l) => `${l.lane}: ${l.detail}`) });

  return {
    ok: failures.length === 0,
    projectRef,
    lanes,
    failures,
    summary: `target ${projectRef}: ${lanes.filter((l) => l.ok).length}/${lanes.length} lanes green — the consolidated-baseline parity verdict is ${failures.length === 0 ? "GREEN" : "RED"}`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// The CLI (the ONE-COMMAND contract). Pure-module guard: importing the module
// (the packager, the t-575 suite) never triggers anything.
// ────────────────────────────────────────────────────────────────────────────

async function cliMain(argv) {
  const args = argv.slice(2);
  const read = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const targetUrl = read("--target-url");
  const jwt = read("--jwt");
  const repoDir = read("--repo-dir");
  let publicKey = read("--key") ?? read("--public-key");
  if (!targetUrl) {
    console.error("usage: preflight-target.mjs --target-url https://<ref>.supabase.co [--key <publishable key>] [--jwt <staff jwt>] [--repo-dir <elimtiyaz-desktop>]");
    console.error(`       the management token comes from the environment (${MANAGEMENT_TOKEN_ENV}); absent = FAIL-CLOSED.`);
    process.exit(2);
  }
  if (!publicKey) {
    // The packager's own resolution chain is not re-implemented here — a
    // missing CLI key is an honest usage error (the packager always resolves one).
    console.error("preflight-target: --key <publishable key> is required for the REST smoke lane.");
    process.exit(2);
  }
  const verdict = await runPreflight({
    targetUrl,
    publicKey,
    jwt,
    repoDir: repoDir ?? defaultRepoDir(),
    processEnv: process.env,
  });
  for (const lane of verdict.lanes) {
    console.log(`  [${lane.ok ? "PASS" : "FAIL"}] ${lane.id}${lane.detail ? ` — ${lane.detail}` : ""}`);
  }
  if (verdict.failures.length > 0) {
    console.error(`\npreflight-target: FAILED (${verdict.failures.length} problem${verdict.failures.length === 1 ? "" : "s"}):`);
    for (const failure of verdict.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`\npreflight-target: OK — ${verdict.summary}`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await cliMain(process.argv);
}
