/**
 * cross-platform-v2 — Backend adapter: local PostgreSQL bootstrap.
 *
 * Creates the test database on the local PostgreSQL server, applies the
 * Supabase environment shim, then applies the REAL production migration chain:
 *
 *   1. Desktop chain:  supabase/migrations/0001…0039 (0015–0017 never existed)
 *   2. Portal patches: elimtiyaz-website/supabase/migrations/0026…0028
 *      renumbered to 9001…9003 (their numbers collide with the desktop chain;
 *      portal 0025 device_tokens is SKIPPED — the desktop 0027 shape
 *      (user_id) is what every RPC uses, per the backend audit).
 *
 * The Android repo's stale copies of 0034/0035 are intentionally NOT applied —
 * the desktop chain carries the newer "FRESH-DB FIX" versions.
 *
 * Every migration runs inside a transaction; a failure aborts with the exact
 * file + error so migration-level divergence becomes a recorded discrepancy.
 *
 * Environment:
 *   PGHOST (default /tmp)  PGPORT (default 55432)  PGUSER (default postgres)
 *   PGDATABASE (default elimtiyaz_equiv)  PGSSLMODE=disable
 */
import { Client } from "pg";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DESKTOP_ROOT = path.resolve(__dirname, "../../../..");
const MIGRATIONS_DIR = path.join(DESKTOP_ROOT, "supabase", "migrations");
const WEBSITE_ROOT = path.resolve(DESKTOP_ROOT, "../../../../elimtiyaz-website");
const WEBSITE_MIGRATIONS = path.join(WEBSITE_ROOT, "supabase", "migrations");
const SHIM = path.join(__dirname, "supabase-shim.sql");

export const PG_CONFIG = {
  host: process.env.PGHOST ?? "/tmp",
  port: Number(process.env.PGPORT ?? 55432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "",
  ssl: false as const,
};

export const TEST_DB = process.env.PGDATABASE ?? "elimtiyaz_equiv";

/** Ordered list of {file, label} applied by bootstrap(). */
export function migrationChain(): Array<{ file: string; label: string }> {
  const chain: Array<{ file: string; label: string }> = [];
  const desktopFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const f of desktopFiles) {
    chain.push({ file: path.join(MIGRATIONS_DIR, f), label: `desktop/${f}` });
  }
  // Portal patches — renumbered 9001/9002/9003 to avoid the number collision
  // with the desktop 0026–0028. 0025_device_tokens is deliberately skipped.
  const portalPatches: Array<[string, string]> = [
    ["0026_attendance_justification_columns.sql", "portal/0026→9001"],
    ["0027_portal_parent_rls_policies.sql", "portal/0027→9002"],
    ["0028_notification_preferences.sql", "portal/0028→9003"],
  ];
  for (const [file, label] of portalPatches) {
    const p = path.join(WEBSITE_MIGRATIONS, file);
    if (fs.existsSync(p)) chain.push({ file: p, label });
  }
  return chain;
}

export interface BootstrapResult {
  database: string;
  applied: string[];
  failed: { label: string; error: string }[];
  objectCounts: Record<string, number>;
}

/** Drop & recreate the test DB, apply shim + full migration chain. */
export async function bootstrapBackend(database = TEST_DB): Promise<BootstrapResult> {
  // Connect to the maintenance DB to (re)create the test database.
  const admin = new Client({ ...PG_CONFIG, database: "postgres" });
  await admin.connect();
  await admin.query(`drop database if exists "${database}" with (force)`);
  await admin.query(`create database "${database}"`);
  await admin.end();

  const db = new Client({ ...PG_CONFIG, database });
  await db.connect();

  const applied: string[] = [];
  const failed: { label: string; error: string }[] = [];

  try {
    await db.query(fs.readFileSync(SHIM, "utf8"));
    applied.push("shim");
  } catch (e) {
    failed.push({ label: "shim", error: String(e) });
    await db.end();
    return { database, applied, failed, objectCounts: {} };
  }

  for (const { file, label } of migrationChain()) {
    const sql = fs.readFileSync(file, "utf8");
    try {
      await db.query("begin");
      await db.query(sql);
      await db.query("commit");
      applied.push(label);
    } catch (e) {
      await db.query("rollback");
      // A migration that fails on vanilla PG (e.g. Supabase-only syntax) is
      // RECORDED, not silently skipped — the suite reports it as divergence.
      failed.push({ label, error: String((e as Error).message).slice(0, 500) });
    }
  }

  // Post-migration object census (for the report).
  const counts: Record<string, number> = {};
  const census = await db.query(`
    select 'tables' kind, count(*) n from pg_tables where schemaname='public'
    union all select 'functions', count(*) from information_schema.routines where routine_schema='public'
    union all select 'triggers', count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname not in ('pg_catalog','information_schema')
    union all select 'matviews', count(*) from pg_matviews where schemaname='public'
    union all select 'views', count(*) from pg_views where schemaname='public'
  `);
  for (const row of census.rows) counts[row.kind] = Number(row.n);

  await db.end();
  return { database, applied, failed, objectCounts: counts };
}

// CLI usage: npx tsx adapters/backend/bootstrap.ts
if (process.argv[1] && process.argv[1].endsWith("bootstrap.ts")) {
  bootstrapBackend()
    .then((r) => {
      console.log(`\nBackend bootstrap: ${r.database}`);
      console.log(`  applied: ${r.applied.length} migrations`);
      for (const f of r.failed) console.log(`  FAILED: ${f.label} — ${f.error}`);
      console.log(`  objects: ${JSON.stringify(r.objectCounts)}`);
      process.exit(r.failed.length > 0 ? 1 : 0);
    })
    .catch((e) => {
      console.error("Bootstrap crashed:", e);
      process.exit(2);
    });
}
