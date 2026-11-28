/**
 * T-626 probe — import the REAL workbook ONCE into a fresh local offline
 * database and diff the landed DEVIS_ANNUEL entries against the workbook's
 * documented identity projection (first-wins per resolved student), NAME BY
 * NAME, to localize any mismatch.
 *
 * Usage: npx tsx scripts/schema-test/probe-import-parity.mjs [port]
 */
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import { ImportEngine } from "../../src/infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../../src/infrastructure/excel/import-engine/storage/repository-adapter";
import { splitFullName } from "../../src/infrastructure/excel/import-engine/mappers/name-splitter";
import {
  PgParentRepo,
  PgStudentRepo,
  PgLedgerRepo,
  PgPaymentRepo,
  PgInstallmentRepo,
} from "../../src/tests/_helpers/local-pg-repos";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.argv[2] ?? 5437);
// argv[3] (optional): the workbook path — defaults to 2027-2026.xlsx; pass the
// Suivis clients 2026_2027.xlsx path for the OLD-format run.
const XLSX = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(__dirname, "../../../Excel/2027-2026.xlsx");

const client = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", database: "postgres" });
await client.connect();
// Single-backend discipline: a previous run may have left the shared
// PGlite session in the authenticated role — reset before seeding.
await client.query("reset role");

// seed
const AUTH_UID = "00000000-0000-0000-0000-0000000000dd";
const tenant = await client.query(
  `insert into tenants (name, slug, country, default_locale, default_currency, timezone, is_active)
   values ('T-626 Probe', $1, 'DZ', 'fr', 'DZD', 'Africa/Algiers', true) returning id`,
  [`probe-${Date.now() % 1000000}`],
);
const tenantId = String(tenant.rows[0].id);
await client.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'probe@elimtiyaz.dz', now()) on conflict (id) do nothing`, [AUTH_UID]);
await client.query(`update user_profiles set tenant_id = $1, display_name = 'Probe Staff', status = 'active' where auth_user_id = $2`, [tenantId, AUTH_UID]);
const profile = await client.query(`select id from user_profiles where auth_user_id = $1`, [AUTH_UID]);
const profileId = String(profile.rows[0].id);
await client.query(`insert into role_assignments (tenant_id, user_profile_id, role_id) select $1, $2, r.id from roles r where r.code = 'super_admin' limit 1`, [tenantId, profileId]);
await client.query("set role authenticated");
await client.query("select set_config('request.jwt.claims', $1, false)", [
  JSON.stringify({ sub: AUTH_UID, role: "authenticated", app_metadata: { tenant_id: tenantId } }),
]);

// import #1
const ctxRepos = { client, tenantId, profileId };
const storage = new RepositoryStorageAdapter({
  parents: new PgParentRepo(ctxRepos),
  students: new PgStudentRepo(ctxRepos),
  ledger: new PgLedgerRepo(ctxRepos),
  payments: new PgPaymentRepo(ctxRepos),
  installments: new PgInstallmentRepo(ctxRepos),
  tenantId,
  actorId: profileId,
  actorName: "Probe Staff",
});
const engine = new ImportEngine({ storage, auditSink: { async logAction() {} } });
const bytes = new Uint8Array(fs.readFileSync(XLSX));
const t0 = Date.now();
const ctx = await engine.importFile(bytes, XLSX, { dryRun: false });
console.log(`import #1 done in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(ctx.stats));
// The re-import leg (PROBE_TWICE=1): the same workbook through the same
// engine against the same database — must be a pure idempotent no-op.
if (process.env.PROBE_TWICE === "1") {
  const c1 = await client.query(
    `select (select count(*) from parents where tenant_id = $1) p,
            (select count(*) from students where tenant_id = $1) s,
            (select count(*) from ledger_entries where tenant_id = $1) l,
            (select count(*) from payments where tenant_id = $1) pay,
            (select count(*) from installments where tenant_id = $1) ins`,
    [tenantId],
  );
  const ctx2 = await engine.importFile(bytes, XLSX, { dryRun: false });
  console.log("import #2 stats:", JSON.stringify(ctx2.stats));
  const c2 = await client.query(
    `select (select count(*) from parents where tenant_id = $1) p,
            (select count(*) from students where tenant_id = $1) s,
            (select count(*) from ledger_entries where tenant_id = $1) l,
            (select count(*) from payments where tenant_id = $1) pay,
            (select count(*) from installments where tenant_id = $1) ins`,
    [tenantId],
  );
  const stable = JSON.stringify(c1.rows[0]) === JSON.stringify(c2.rows[0]);
  console.log("re-import counts stable:", stable ? "YES" : "NO", JSON.stringify(c2.rows[0]));
  if (!stable || ctx2.stats.rowsRejected > 0) process.exitCode = 1;
}

// DB per-student devis
const { rows: dbRows } = await client.query(
  `select s.display_name, sum(le.amount)::float8 total, count(*)::int n
   from ledger_entries le join students s on s.id = le.student_id
   where le.tenant_id = $1 and le.metadata->>'field' = 'DEVIS_ANNUEL'
   group by 1`,
  [tenantId],
);
const dbByName = new Map(dbRows.map((r) => [r.display_name, { total: r.total, n: r.n }]));

// Workbook projection (documented identity semantics)
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const ws = wb.getWorksheet("ETAT 20262027");
const val = (row, col) => {
  const v = row.getCell(col).value;
  return typeof v === "object" && v != null && "result" in v ? v.result : v;
};
const families = new Map();
const projByName = new Map();
let merges = 0;
for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const nom = String(val(row, 6) ?? "").trim();
  if (!nom) continue;
  const nemRaw = String(val(row, 4) ?? "").trim();
  const phone = nemRaw.split(/[/,;]/)[0]?.trim() || "(inconnu)";
  const parts = splitFullName(nom);
  const famKey = phone !== "(inconnu)" ? `tel:${phone}` : `fam:${parts.lastName}`;
  if (!families.has(famKey)) families.set(famKey, []);
  const fam = families.get(famKey);
  const existing = fam.find((s) => s.displayName === nom) ?? fam.find((s) => s.firstName === parts.firstName && s.lastName === parts.lastName);
  if (existing) {
    merges++;
    continue;
  }
  fam.push({ displayName: nom, firstName: parts.firstName, lastName: parts.lastName });
  const devis = Number(val(row, 12) ?? 0) || 0;
  const cur = projByName.get(nom) ?? { total: 0, n: 0 };
  cur.total += devis;
  cur.n += 1;
  projByName.set(nom, cur);
}

console.log("projected merges (same family + student):", merges);
let mismatches = 0;
for (const [name, proj] of projByName) {
  const db = dbByName.get(name);
  if (!db) {
    console.log(`MISSING IN DB: ${name} — projected ${proj.total}`);
    mismatches++;
  } else if (Math.abs(db.total - proj.total) > 1) {
    console.log(`DIFF: ${name} — projected ${proj.total} (n=${proj.n}) vs DB ${db.total} (n=${db.n})`);
    mismatches++;
  }
}
for (const [name, db] of dbByName) {
  if (!projByName.has(name)) {
    console.log(`EXTRA IN DB: ${name} — ${db.total}`);
    mismatches++;
  }
}
console.log("mismatched names:", mismatches);
const dbTotal = dbRows.reduce((s, r) => s + r.total, 0);
const projTotal = [...projByName.values()].reduce((s, v) => s + v.total, 0);
console.log(`DB total: ${dbTotal} | projection total: ${projTotal} | diff: ${dbTotal - projTotal}`);
await client.end();
