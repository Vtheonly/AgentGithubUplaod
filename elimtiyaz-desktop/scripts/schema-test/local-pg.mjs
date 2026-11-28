#!/usr/bin/env node
/**
 * local-pg.mjs — the LOCAL OFFLINE Supabase harness (T-625).
 *
 * Boots a PGlite (PostgreSQL 18.7 wasm, in-memory) instance with the five
 * contrib extensions, applies the 0000_local_compat prologue + the canonical
 * migration chain 0001..0005 BYTE-UNTouched (the ONE documented exception:
 * the `create extension pgjwt` statement is skipped in-memory — pgjwt is
 * created-never-called in the chain; the charter's skip-guard), prints the
 * Rule-3 census, and serves the PostgreSQL WIRE PROTOCOL on a local TCP
 * port so the existing `pg`-Client tooling (financial-tests/equivalence
 * runners, vitest integration tests, psql) works UNMODIFIED.
 *
 * ZERO network I/O beyond 127.0.0.1 (OPS-015/G2-safe by construction —
 * no Supabase project is contacted, ever).
 *
 * Modes:
 *   census                       apply the chain, print the census, exit.
 *   start [--port N] [--fresh]   apply + serve; write .local-pg.json
 *                                (port/pid); stays in foreground (run it
 *                                backgrounded — the ready file is the
 *                                handshake).
 *   stop                         read .local-pg.json, stop the server.
 *
 * Flags:
 *   --fresh       (start/census) use a brand-new in-memory instance — the
 *                 default. Data lives only for the server's lifetime.
 *   --persist DIR (start) keep the database on disk in DIR across restarts.
 *   --port N      TCP port (default 5433 — the backend_runner default).
 *   --quiet       census: summary lines only.
 *
 * Usage (the canonical session flow):
 *   node scripts/schema-test/local-pg.mjs census
 *   node scripts/schema-test/local-pg.mjs start --fresh --port 5433 &
 *   npx tsx financial-tests/equivalence/backend/backend_runner.ts
 *   npx vitest run src/tests/integration/real-excel-import-local-pg.test.ts
 *   node scripts/schema-test/local-pg.mjs stop
 */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pg_stat_statements } from "@electric-sql/pglite/contrib/pg_stat_statements";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");
const PROLOGUE = path.join(__dirname, "0000_local_compat.sql");
const STATE_FILE = path.join(__dirname, ".local-pg.json");

// ── argv ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const mode = argv[0] ?? "census";
const flag = (name, def = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[i + 1]) : def;
};
const PORT = Number(flag("port", "5433"));
const QUIET = flag("quiet", false);
const PERSIST_DIR = typeof flag("persist-dir") === "string" ? flag("persist-dir") : null;

// ── Statement splitter (dollar-quote + string + comment aware) ─────────────
/**
 * Splits a SQL file into executable statements. Handles:
 *  - $$…$$ dollar quoting incl. named tags ($body$…$body$)
 *  - single-quoted strings with '' escaping
 *  - -- line comments and /* block *​/ comments
 *  - statements with no trailing semicolon (returned as the final chunk
 *    when non-empty after comment stripping)
 */
export function splitSql(sql) {
  const stmts = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  let inSquote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;
  while (i < n) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    const three = sql.slice(i, i + 3);
    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (two === "*/") {
        buf += sql[i + 1];
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        buf += sql.slice(i, i + dollarTag.length);
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }
    if (inSquote) {
      buf += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          buf += "'";
          i += 2;
          continue;
        }
        inSquote = false;
      }
      i += 1;
      continue;
    }
    // plain context
    if (two === "--") {
      inLineComment = true;
      buf += "--";
      i += 2;
      continue;
    }
    if (two === "/*") {
      inBlockComment = true;
      buf += "/*";
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSquote = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (ch === ";") {
      stmts.push(buf);
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim().length > 0) stmts.push(buf);
  return stmts;
}

/** True when a statement's non-comment content is empty. */
function isEffectivelyEmpty(stmt) {
  return stmt.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim().length === 0;
}

// ── Chain application ──────────────────────────────────────────────────────
const PGJWT_RE = /^\s*create\s+extension\s+if\s+not\s+exists\s+pgjwt\b/i;

async function applyFile(db, file, label) {
  const sql = fs.readFileSync(file, "utf-8");
  const stmts = splitSql(sql);
  let applied = 0;
  let skipped = 0;
  for (const stmt of stmts) {
    if (isEffectivelyEmpty(stmt)) continue;
    if (PGJWT_RE.test(stmt)) {
      // The charter's documented skip-guard: pgjwt has no wasm tarball and
      // is created-never-called in the chain. The FILE stays byte-untouched.
      skipped += 1;
      continue;
    }
    try {
      await db.exec(stmt + "\n;");
    } catch (e) {
      // `alter publication` on runtimes without logical replication: the
      // charter records the membership axis as runtime-dependent. Fail loud
      // for anything else.
      if (/publication/i.test(stmt) && /publication .* does not support|wal_level|logical replication/i.test(String(e.message))) {
        skipped += 1;
        continue;
      }
      const preview = stmt.replace(/\s+/g, " ").slice(0, 160);
      throw new Error(`[${label}] statement failed: ${e.message}\n  >>> ${preview}`);
    }
    applied += 1;
  }
  return { applied, skipped };
}

// ── Census (the Rule-3 axes) ───────────────────────────────────────────────
async function census(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  const scalar = async (sql) => Number((await q(sql))[0]?.n ?? 0);
  const out = {};
  out.pgVersion = (await q("select version()"))[0].version.split(" (")[0];
  out.tables = await scalar("select count(*) n from pg_tables where schemaname='public'");
  out.views = await scalar("select count(*) n from pg_views where schemaname='public'");
  out.matviews = await scalar("select count(*) n from pg_matviews where schemaname='public'");
  out.functions = await scalar("select count(*) n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'");
  out.triggers = await scalar(
    "select count(*) n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public'",
  );
  out.policies = await scalar(
    "select count(*) n from pg_policies p join pg_class c on c.oid = p.tablename::regclass where p.schemaname='public'",
  );
  out.rlsTables = await scalar(
    "select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity",
  );
  out.indexes = await scalar(
    "select count(*) n from pg_indexes where schemaname='public'",
  );
  out.fks = await scalar(
    "select count(*) n from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where c.contype='f' and n.nspname='public'",
  );
  out.sequences = await scalar(
    "select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname='public'",
  );
  out.roles = await scalar("select count(*) n from roles");
  out.permissions = await scalar("select count(*) n from permissions");
  out.rolePermissions = await scalar("select count(*) n from role_permissions");
  out.tenants = await scalar("select count(*) n from tenants");
  out.academicLevels = await scalar("select count(*) n from academic_levels");
  out.academicYears = await scalar("select count(*) n from academic_years");
  out.subjects = await scalar("select count(*) n from subjects");
  out.subjectConfigurations = await scalar("select count(*) n from subject_configurations");
  out.filieres = await scalar("select count(*) n from filieres");
  out.gradeLevelTuition = await scalar("select count(*) n from grade_level_tuition");
  out.discounts = await scalar("select count(*) n from discounts");
  out.additionalServices = await scalar("select count(*) n from additional_services");
  out.complementaryServices = await scalar("select count(*) n from complementary_services");
  out.transportDestinations = await scalar("select count(*) n from transport_destinations");
  out.systemSettings = await scalar("select count(*) n from system_settings");
  out.expenseCategories = await scalar("select count(*) n from expense_categories");
  out.departments = await scalar("select count(*) n from departments");
  out.buckets = await scalar("select count(*) n from storage.buckets");
  out.migrationsRegistered = await scalar("select count(*) n from supabase_migrations.schema_migrations");
  // The 54001 gate: the five RLS helpers must be SECURITY DEFINER + search_path=public.
  out.rlsHelpersSecdef = (
    await q(
      `select p.proname,
              p.prosecdef,
              array_to_string(coalesce(p.proconfig,'{}'),'|') cfg
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
         and p.proname in ('current_tenant_id','current_user_profile_id','has_any_role','has_permission','has_role')
       order by p.proname`,
    )
  ).map((r) => `${r.proname}:${r.prosecdef === true ? "secdef" : "PLAIN"}:${(r.cfg || "").includes("search_path=public") ? "sp" : "NOSP"}`);
  return out;
}

// ── Boot + apply ───────────────────────────────────────────────────────────
async function bootAndApply() {
  const t0 = Date.now();
  const db = PERSIST_DIR
    ? new PGlite({
        extensions: { pgcrypto, pg_trgm, btree_gist, uuid_ossp, pg_stat_statements },
        loadDataDir: PERSIST_DIR,
      })
    : new PGlite({
        extensions: { pgcrypto, pg_trgm, btree_gist, uuid_ossp, pg_stat_statements },
      });

  // 1. The prologue.
  const prologue = await applyFile(db, PROLOGUE, "0000_local_compat");
  // 2. The chain, in order.
  const chainFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  const perFile = [];
  for (const f of chainFiles) {
    const r = await applyFile(db, path.join(MIGRATIONS_DIR, f), f);
    perFile.push({ file: f, applied: r.applied, skipped: r.skipped });
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  return { db, prologue, perFile, chainFiles, elapsed };
}

function printCensus(c) {
  const rows = Object.entries(c).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]);
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(`  ${k.padEnd(w)}  ${v}`);
}

// ── Main dispatch ──────────────────────────────────────────────────────────
async function main() {
  if (mode === "stop") {
    if (!fs.existsSync(STATE_FILE)) {
      console.log("local-pg: no state file (not running?)");
      process.exit(0);
    }
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    try {
      process.kill(st.pid, "SIGTERM");
      console.log(`local-pg: SIGTERM -> pid ${st.pid} (port ${st.port})`);
    } catch {
      console.log(`local-pg: pid ${st.pid} already gone`);
    }
    fs.rmSync(STATE_FILE, { force: true });
    process.exit(0);
  }

  const { db, prologue, perFile, chainFiles, elapsed } = await bootAndApply();
  console.log(
    `local-pg: prologue ${prologue.applied} stmts · chain ${chainFiles.length} files ${perFile.reduce((s, f) => s + f.applied, 0)} stmts (${perFile.reduce((s, f) => s + f.skipped, 0)} skipped: pgjwt/publication guards) in ${elapsed}s`,
  );
  if (!QUIET) {
    for (const f of perFile) console.log(`  ${f.file}  ${f.applied} applied, ${f.skipped} skipped`);
  }

  const c = await census(db);
  console.log("— census —");
  printCensus(c);

  if (mode === "census") {
    await db.close();
    process.exit(0);
  }
  if (mode !== "start") {
    console.error(`local-pg: unknown mode '${mode}' (census|start|stop)`);
    await db.close();
    process.exit(2);
  }

  // start: serve the wire protocol.
  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: "127.0.0.1",
    maxConnections: 100,
    idleTimeout: 0,
  });
  await server.start();
  fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: process.pid, port: PORT, startedAt: new Date().toISOString() }, null, 2));
  console.log(`local-pg: READY — postgresql://postgres@127.0.0.1:${PORT}/postgres (pid ${process.pid}, state ${STATE_FILE})`);

  const shutdown = async () => {
    try {
      await server.stop();
    } catch {}
    try {
      await db.close();
    } catch {}
    fs.rmSync(STATE_FILE, { force: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Safety: exit if state file is removed externally (`stop` on another host user).
  setInterval(() => {
    if (!fs.existsSync(STATE_FILE)) shutdown();
  }, 2000).unref();
}

main().catch((e) => {
  console.error("local-pg: FATAL —", e.message);
  if (process.env.LOCAL_PG_DEBUG) console.error(e.stack);
  process.exit(1);
});
