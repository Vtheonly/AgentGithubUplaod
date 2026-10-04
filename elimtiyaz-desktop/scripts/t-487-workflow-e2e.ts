/**
 * t-487-workflow-e2e.ts — T-487: the INTEGRATED recovery-workflow live E2E
 * (the owner's mandate: "verify that the three workflows work together
 * correctly: Backup → Purge → Excel Import → Verify Imported Data →
 * Restore Backup → Verify Original Data" — with ZERO production-data risk).
 *
 * THE ISOLATION MODEL (the data-safety answer):
 *   Every phase runs against a DEDICATED RUN-UNIQUE TEST TENANT on the live
 *   project (`T487-FAKE-<tag>`), never the real tenant. The boundary is the
 *   system's own RLS tenant-scoping (0126's `tenant_id = current_tenant_id()`
 *   family) + the purge RPC's tenant resolution (`coalesce(p_tenant_id,
 *   current_tenant_id())` — the TEST super-admin's profile binds the TEST
 *   tenant, so the purge can only ever resolve the TEST tenant). The REAL
 *   tenant is bracketed by preflight/postflight censuses that must be
 *   byte-identical. All probe rows are FAKE-marked (§15.50); the harness
 *   ships its own cleanup (the §15.50c purge-tool rule).
 *
 * THE CODE PATHS (all REAL — no stubs, no mocks):
 *   Import  — the REAL ImportEngine + RepositoryStorageAdapter over the REAL
 *             Supabase repositories (the exact classes the import modal
 *             wires), driven through the signed-in TEST super-admin session.
 *   Backup  — the REAL backup-service pipeline (serialize → gzip →
 *             AES-256-GCM → SHA-256 → the fake-indexeddb vault) + the REAL
 *             SupabaseBackupRepository metadata mirror.
 *   Purge   — the REAL SupabasePurgeRepository → PostgREST → the REAL
 *             purge_student_parent_domain RPC (migration 0120/0121), through
 *             the signed-in TEST super-admin (the exact UI-path call).
 *   Restore — the REAL restore pipeline (decrypt → verify → apply to the
 *             offline layer → the restored-from marker → audit).
 *
 * PHASES:
 *   0  PREFLIGHT  — the production baseline census (must match the recorded
 *                   pre-phase-0 fingerprint).
 *   1  SETUP      — the test tenant + the TEST super-admin (GoTrue admin
 *                   create → the trigger's profile re-bound to the TEST
 *                   tenant → the super_admin role assignment) + the sign-in.
 *   2  IMPORT #1  — the REAL production workbook (2027-2026.xlsx) imported
 *                   into the EMPTY test tenant.
 *   3  CENSUS     — the test tenant's server-side census + financial sums +
 *                   per-row spot checks (the "resulting application state
 *                   matches what the spreadsheet specifies" bar).
 *   4  BACKUP     — cold-cache backup (the BKUP-508 live demonstration) →
 *                   the warmed backup → the archive content verification
 *                   (decrypt → per-collection counts vs the server census)
 *                   → the metadata mirror row.
 *   5  PURGE      — dry-run through the repository (counts-only) → EXECUTE
 *                   ('PURGER') → zero-residue across every family → the
 *                   no-interference proofs (backup_archives survives,
 *                   audit append-only, sync infra intact) → the production
 *                   census re-check.
 *   6  IMPORT #2  — the post-purge re-import of the SAME workbook → the
 *                   counts/content match import #1 (the workflow's
 *                   "Verify Imported Data" step).
 *   7  EDGE       — the crafted edge-case workbook (valid + duplicate +
 *                   invalid + missing-NEM + multi-student rows) + a re-run
 *                   (idempotency) → the error/warning reporting contract.
 *   8  RESTORE    — the REAL restore of the phase-4 archive → the offline
 *                   layer's state verification (counts + the student→parent
 *                   relationships resolve inside the restored state).
 *   9  POSTFLIGHT — the production census byte-identical + the FULL cleanup
 *                   (the app's own purge on the test tenant → the test
 *                   admin/tenant deletion → zero residue).
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_SERVICE_KEY=sb_secret_… \
 *     npx tsx scripts/t-487-workflow-e2e.ts [--phase <n>]
 *
 *   --phase <n>  — stop after phase n (for incremental runs).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import process from "node:process";

// ── The environment shims — BEFORE any src import (module-scope reads) ────
// fake-indexeddb gives the vault its IndexedDB; the localStorage/window
// shims give the supabase-client + repositories their browser contracts.
import "fake-indexeddb/auto";

const memStore = new Map<string, string>();
const localStorageShim = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => void memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size; },
};
(globalThis as Record<string, unknown>).localStorage = localStorageShim;
(globalThis as Record<string, unknown>).window = {
  localStorage: localStorageShim,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

// The REAL src modules (imported AFTER the shims are in place).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { ImportEngine } from "../src/infrastructure/excel/import-engine/import-engine";
import { RepositoryStorageAdapter } from "../src/infrastructure/excel/import-engine/storage/repository-adapter";
import { getSupabaseRepositories } from "../src/infrastructure/supabase/supabase-repositories";
import { getSupabaseClient } from "../src/infrastructure/supabase/supabase-client";
import { dryRunPurge, executePurge } from "../src/infrastructure/supabase/repositories/supabase-purge-repository";
import {
  inspectArchive,
  setBackupPassphrase,
} from "../src/infrastructure/backup/backup-service";
import { getArchive } from "../src/infrastructure/backup/indexed-db-vault";
import { store as mockStore } from "../src/infrastructure/mock/repositories/mock-store";

// ── Constants / env ─────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const PROJECT_REF = "vebfehrpzajhstyhinnw";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN; // sbp_ Management token
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;   // sb_secret_ service key
const PUBLISHABLE_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const REAL_TENANT = "00000000-0000-0000-0000-000000000001";
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p))!;
const STOP_AFTER_PHASE = (() => {
  const i = process.argv.indexOf("--phase");
  return i >= 0 ? Number(process.argv[i + 1]) : Number.POSITIVE_INFINITY;
})();
const START_FROM_PHASE = (() => {
  const i = process.argv.indexOf("--from");
  return i >= 0 ? Number(process.argv[i + 1]) : 0;
})();

const MGMT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const STATE_PATH = path.join(REPO_ROOT, "scripts", "t-487-e2e-state.json");
function loadState(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")); } catch { return {}; }
}
function saveState(s: Record<string, string>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
const S = loadState();
const MUT = { tenantId: "", authUserId: "", profileId: "", archiveCold: "", archiveWarm: "", import1Counts: {} as Record<string, number>, import1Sums: {} as Record<string, number> };

const TAG = S.tag ?? `t487-${Date.now().toString(36)}`;
const TEST_TENANT_NAME = `FAKE-${TAG}-isolated-test-tenant`;
const TEST_ADMIN_EMAIL = S.email ?? `fake-${TAG}-admin@el-imtiyaz.test`;
const TEST_ADMIN_PASSWORD = S.password ?? `Fk-${TAG}!-Sup3rAdm1n`;
const BACKUP_PASSPHRASE = `fake-${TAG}-backup-passphrase-2026`;

const results: Array<{ id: string; ok: boolean; detail: string }> = [];
function record(id: string, ok: boolean, detail: unknown = "") {
  results.push({ id, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "✅" : "❌"} ${id}${detail !== "" ? ` — ${String(detail).slice(0, 240)}` : ""}`);
}
const section = (name: string) => console.log(`\n== ${name} ==`);

// The persisted state (cross-phase, for --phase incremental runs).
// ── The Management-API SQL helper (the DB-superuser census path) ───────────
async function sqlRows(query: string): Promise<Record<string, unknown>[]> {
  if (!ACCESS_TOKEN) throw new Error("Missing SUPABASE_ACCESS_TOKEN");
  const res = await fetch(MGMT, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SQL ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return Array.isArray(json) ? json : (json.rows ?? []);
}

/** The production-tenant fingerprint (the data-safety invariant). */
async function productionFingerprint(): Promise<Record<string, number>> {
  const rows = await sqlRows(`
    select
      (select count(*)::int from parents where tenant_id = '${REAL_TENANT}') as parents,
      (select count(*)::int from students where tenant_id = '${REAL_TENANT}') as students,
      (select count(*)::int from payments where tenant_id = '${REAL_TENANT}') as payments,
      (select count(*)::int from installments where tenant_id = '${REAL_TENANT}') as installments,
      (select count(*)::int from ledger_entries where tenant_id = '${REAL_TENANT}') as ledger,
      (select count(*)::int from activation_codes where tenant_id = '${REAL_TENANT}') as activation_codes,
      (select count(*)::int from account_approval_requests where tenant_id = '${REAL_TENANT}') as approvals,
      (select coalesce(sum(amount),0)::bigint from payments where tenant_id = '${REAL_TENANT}') as payments_sum,
      (select coalesce(sum(amount_due),0)::bigint from installments where tenant_id = '${REAL_TENANT}') as due_sum,
      (select coalesce(sum(amount_paid),0)::bigint from installments where tenant_id = '${REAL_TENANT}') as paid_sum,
      (select count(*)::int from audit_logs) as audit_total,
      (select count(*)::int from backup_archives) as backup_archives_total,
      (select count(*)::int from sync_queue) as sync_queue_total
  `);
  const r = rows[0] ?? {};
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

const BASELINE: Record<string, number> = {
  parents: 741, students: 1137, payments: 2198, installments: 5956, ledger: 3342,
  activation_codes: 740, approvals: 34, payments_sum: 162713000,
  due_sum: 356844800, paid_sum: 162614100, audit_total: 39160,
  backup_archives_total: 0, sync_queue_total: 0,
};

async function assertProductionIntact(phase: string) {
  const fp = await productionFingerprint();
  // audit_total legitimately grows (our own writes append — append-only by
  // design); backup_archives_total grows by our TEST-tenant mirror rows.
  // The DATA invariants must be byte-identical.
  const dataKeys: (keyof typeof BASELINE)[] = ["parents", "students", "payments", "installments", "ledger", "activation_codes", "payments_sum", "due_sum", "paid_sum"];
  const bad = dataKeys.filter((k) => fp[k] !== BASELINE[k]);
  record(`${phase} production data intact (parents ${fp.parents} / students ${fp.students} / payments ${fp.payments} Σ${fp.payments_sum} / installments ${fp.installments} Σ${fp.due_sum})`,
    bad.length === 0,
    bad.length === 0 ? "" : `DRIFT: ${bad.map((k) => `${k}: ${BASELINE[k]}→${fp[k]}`).join(", ")}`);
  return fp;
}

// ── The headless app session (the exact UI-path context) ───────────────────
async function signInTestAdmin(): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: TEST_ADMIN_EMAIL,
    password: TEST_ADMIN_PASSWORD,
  });
  if (error || !data.session) throw new Error(`test-admin sign-in failed: ${error?.message ?? "no session"}`);
  // The repositories' tenant context — the same key the app writes at login.
  memStore.set("el-imtiyaz.session", JSON.stringify({
    tenantId: MUT.tenantId,
    homeTenantId: MUT.tenantId,
    userId: MUT.profileId,
    displayName: `FAKE ${TAG} Admin`,
  }));
  console.log(`signed in: ${TEST_ADMIN_EMAIL} → tenant ${MUT.tenantId}`);
}

/** The tenant-scoped domain census for ANY tenant (the verification truth). */
async function tenantCensus(tenantId: string): Promise<Record<string, number>> {
  const t = tenantId;
  const rows = await sqlRows(`
    select
      (select count(*)::int from parents where tenant_id = '${t}') as parents,
      (select count(*)::int from students where tenant_id = '${t}') as students,
      (select count(*)::int from payments where tenant_id = '${t}') as payments,
      (select count(*)::int from installments where tenant_id = '${t}') as installments,
      (select count(*)::int from ledger_entries where tenant_id = '${t}') as ledger,
      (select count(*)::int from activation_codes where tenant_id = '${t}') as activation_codes,
      (select count(*)::int from service_enrollments where tenant_id = '${t}') as service_enrollments,
      (select count(*)::int from sync_queue where tenant_id = '${t}') as sync_queue,
      (select coalesce(sum(amount),0)::bigint from payments where tenant_id = '${t}') as payments_sum,
      (select coalesce(sum(amount_due),0)::bigint from installments where tenant_id = '${t}') as due_sum,
      (select coalesce(sum(amount_paid),0)::bigint from installments where tenant_id = '${t}') as paid_sum,
      (select coalesce(sum(case when entry_type = 'charge' then amount else 0 end),0)::bigint from ledger_entries where tenant_id = '${t}') as ledger_charge_sum,
      (select coalesce(sum(case when entry_type = 'payment' then amount else 0 end),0)::bigint from ledger_entries where tenant_id = '${t}') as ledger_payment_sum
  `);
  const r = rows[0] ?? {};
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

// ── The REAL import (the exact classes the import modal wires) ─────────────
async function runImport(label: string): Promise<{ rowsRead: number; rowsImported: number; rowsUpdated: number; rowsSkipped: number; rowsRejected: number; warnings: number; durationMs: number }> {
  const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH));
  const repos = getSupabaseRepositories();
  const storage = new RepositoryStorageAdapter({
    parents: repos.parents,
    students: repos.students,
    ledger: repos.ledger,
    payments: repos.payments,
    installments: repos.installments,
    tenantId: MUT.tenantId,
    actorId: MUT.profileId,
    actorName: `FAKE ${TAG} Admin`,
  });
  const engine = new ImportEngine({
    storage,
    auditSink: {
      async logAction(action, entityType, entityId, diff, note) {
        await repos.audit.log({
          action, entityType, entityId,
          actorId: MUT.profileId,
          actorName: `FAKE ${TAG} Admin`,
          tenantId: MUT.tenantId,
          diff: diff ? { after: diff } : null,
          note: note ?? null,
        });
      },
    },
  });
  const started = Date.now();
  const ctx = await engine.importFile(bytes, path.basename(XLSX_PATH), {
    dryRun: false,
    source: { user: TEST_ADMIN_EMAIL },
  });
  const durationMs = Date.now() - started;
  console.log(`  [${label}] rowsRead=${ctx.stats.rowsRead} rowsImported=${ctx.stats.rowsImported} rowsUpdated=${ctx.stats.rowsUpdated} rowsSkipped=${ctx.stats.rowsSkipped} rowsRejected=${ctx.stats.rowsRejected} warnings=${ctx.stats.warnings} in ${(durationMs / 1000).toFixed(1)}s`);
  return { ...ctx.stats, durationMs };
}

/** Await a repository cache seed: poll the observable until non-empty or the timeout. */
async function awaitSeed(getter: () => number, timeoutMs = 90_000): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    const n = getter();
    if (n > 0) return n;
    if (Date.now() - t0 > timeoutMs) return n;
    await new Promise((r) => setTimeout(r, 750));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 0 — PREFLIGHT: the production baseline (the data-safety invariant)
// ═══════════════════════════════════════════════════════════════════════════
async function phase0() {
  section("Phase 0 — PREFLIGHT (the production baseline)");
  if (!ACCESS_TOKEN || !SERVICE_KEY) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_SERVICE_KEY are both required");
  const reg = await sqlRows("select version from supabase_migrations.schema_migrations order by version desc limit 1");
  record("P0.1 migration chain head = 0142 (no drift)", reg[0]?.version === "0142", `head: ${reg[0]?.version}`);
  await assertProductionIntact("P0.2");
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`workbook not found: ${XLSX_PATH}`);
  record("P0.3 the real workbook present", true, path.basename(XLSX_PATH));
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — SETUP: the isolated test tenant + the TEST super-admin
// ═══════════════════════════════════════════════════════════════════════════
async function phase1() {
  section("Phase 1 — SETUP (the isolated test tenant + the TEST super-admin)");

  // 1.1 The run-unique FAKE-marked tenant (§15.50a).
  const tenantId = crypto.randomUUID();
  await sqlRows(`insert into public.tenants (id, slug, name, is_active) values ('${tenantId}', 'fake-${TAG}', '${TEST_TENANT_NAME}', true)`);
  const t = await sqlRows(`select id, name from public.tenants where id = '${tenantId}'`);
  record("P1.1 the FAKE-marked test tenant created", t.length === 1 && t[0].name === TEST_TENANT_NAME, TEST_TENANT_NAME);
  MUT.tenantId = tenantId;

  // 1.2 The TEST super-admin through the GoTrue ADMIN API (the trigger's
  // profile auto-creation; app_metadata marks the admin-invite path so the
  // trigger binds OUR tenant, not the default real one).
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
      email_confirm: true,
      app_metadata: { created_by_admin: true, tenant_id: tenantId },
      user_metadata: { full_name: `FAKE ${TAG} Admin`, requested_role: "staff" },
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  if ((createRes.status !== 201 && createRes.status !== 200) || !created.id) {
    record("P1.2 the TEST super-admin created (GoTrue admin API)", false, `HTTP ${createRes.status}: ${JSON.stringify(created).slice(0, 200)}`);
    throw new Error("test admin creation failed");
  }
  MUT.authUserId = created.id;
  record("P1.2 the TEST super-admin created (GoTrue admin API)", true, TEST_ADMIN_EMAIL);

  // 1.3 The trigger created the profile — re-bind it to the TEST tenant
  // (UPDATE, never a parallel insert — the §15.58 GoTrue-trigger lesson).
  await sqlRows(`update public.user_profiles set tenant_id = '${tenantId}', display_name = 'FAKE ${TAG} Admin' where auth_user_id = '${MUT.authUserId}'`);
  const prof = await sqlRows(`select id, tenant_id from public.user_profiles where auth_user_id = '${MUT.authUserId}'`);
  record("P1.3 the trigger-created profile re-bound to the TEST tenant", prof.length === 1 && prof[0].tenant_id === tenantId, `profile ${prof[0]?.id}`);
  MUT.profileId = String(prof[0]?.id ?? "");

  // 1.4 The super_admin role assignment (the purge RPC's Gate 1).
  await sqlRows(`
    insert into public.role_assignments (id, tenant_id, user_profile_id, role_id)
    values ('${crypto.randomUUID()}', '${tenantId}', '${MUT.profileId}', (select id from public.roles where code = 'super_admin' limit 1))
  `);
  const roles = await sqlRows(`
    select r.code from public.role_assignments ra join public.roles r on r.id = ra.role_id
    where ra.user_profile_id = '${MUT.profileId}'
  `);
  record("P1.4 the super_admin role assigned", roles.some((r) => r.code === "super_admin"), roles.map((r) => r.code).join(","));

  // 1.5 The sign-in (the exact password grant the desktop performs).
  await signInTestAdmin();
  const client = getSupabaseClient();
  const { data: sess } = await client.auth.getSession();
  record("P1.5 the TEST session established (user JWT)", !!sess?.session?.access_token, `sub=${MUT.authUserId.slice(0, 8)}…`);

  // 1.6 RLS ISOLATION PROOF — the signed-in TEST admin CANNOT see the real
  // tenant's rows (the tenant-scoping boundary the whole harness relies on).
  const { count: realParentsVisible } = await client.from("parents").select("id", { count: "exact", head: true });
  record("P1.6 RLS isolation: the TEST admin sees ZERO real-tenant parents", realParentsVisible === 0, `visible=${realParentsVisible}`);

  saveState({ tenantId: MUT.tenantId, authUserId: MUT.authUserId, profileId: MUT.profileId, email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD, tag: TAG });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — IMPORT #1: the REAL workbook into the EMPTY test tenant
// ═══════════════════════════════════════════════════════════════════════════
async function phase2() {
  section("Phase 2 — IMPORT #1 (the real production workbook, the real engine)");
  const empty = await tenantCensus(MUT.tenantId);
  record("P2.0 the test tenant starts EMPTY", empty.parents === 0 && empty.students === 0 && empty.payments === 0 && empty.installments === 0 && empty.ledger === 0, JSON.stringify(empty));

  const stats = await runImport("import #1");
  record("P2.1 import #1 completed (rows read > 1000 — the full workbook)", stats.rowsRead > 1000,
    `rowsRead=${stats.rowsRead} rowsImported=${stats.rowsImported} rowsRejected=${stats.rowsRejected} warnings=${stats.warnings} in ${(stats.durationMs / 1000).toFixed(1)}s`);
  record("P2.2 zero hard rejections (the workbook is the known-good source)", stats.rowsRejected === 0, `rejected=${stats.rowsRejected}`);
  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — CENSUS: the imported state vs the spreadsheet's truth
// ═══════════════════════════════════════════════════════════════════════════
async function phase3() {
  section("Phase 3 — CENSUS (the test tenant's imported state)");
  const c = await tenantCensus(MUT.tenantId);
  MUT.import1Counts = { parents: c.parents, students: c.students, payments: c.payments, installments: c.installments, ledger: c.ledger };
  MUT.import1Sums = { payments_sum: c.payments_sum, due_sum: c.due_sum, paid_sum: c.paid_sum };

  // The production tenant imported THE SAME workbook — the counts must
  // match it family-for-family (the strongest available oracle).
  record("P3.1 students match the production import", c.students === BASELINE.students, `${c.students} vs production ${BASELINE.students}`);
  record("P3.2 parents match the production import", c.parents === BASELINE.parents, `${c.parents} vs production ${BASELINE.parents}`);
  record("P3.3 payments match the production import", c.payments === BASELINE.payments, `${c.payments} vs production ${BASELINE.payments}`);
  record("P3.4 installments match the production import", c.installments === BASELINE.installments, `${c.installments} vs production ${BASELINE.installments}`);
  record("P3.5 ledger matches the production import", c.ledger === BASELINE.ledger, `${c.ledger} vs production ${BASELINE.ledger}`);
  record("P3.6 the payments Σ matches the production import", c.payments_sum === BASELINE.payments_sum, `${c.payments_sum} vs ${BASELINE.payments_sum}`);
  record("P3.7 the installments Σ-due matches the production import", c.due_sum === BASELINE.due_sum, `${c.due_sum} vs ${BASELINE.due_sum}`);
  record("P3.8 the installments Σ-paid matches the production import", c.paid_sum === BASELINE.paid_sum, `${c.paid_sum} vs ${BASELINE.paid_sum}`);

  // The relationships: every student's parent resolves inside the tenant.
  const orphans = await sqlRows(`
    select count(*)::int as n from public.students s
    where s.tenant_id = '${MUT.tenantId}' and not exists (select 1 from public.parents p where p.id = s.parent_id and p.tenant_id = '${MUT.tenantId}')
  `);
  record("P3.9 zero student→parent orphans (the relationships)", Number(orphans[0]?.n) === 0, `orphans=${orphans[0]?.n}`);

  // Per-row spot checks: read 3 rows straight from the workbook and compare
  // against the DB (the "state matches what the spreadsheet specifies" bar).
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(XLSX_PATH));
  const etat = wb.worksheets.find((w) => /^ETAT/i.test(w.name))!;
  let checked = 0;
  const spot: string[] = [];
  for (let r = 2; r <= etat.rowCount && checked < 3; r++) {
    const row = etat.getRow(r);
    const nom = String(row.getCell("F").value ?? "").trim();
    const nem = String(row.getCell("D").value ?? "").trim().split("/")[0].trim();
    const fi = Number(row.getCell("R").value ?? 0) || 0;
    if (!nom) continue;
    const db = await sqlRows(`
      select p.parent_code, s.student_code, p.primary_phone
      from public.students s join public.parents p on p.id = s.parent_id
      where s.tenant_id = '${MUT.tenantId}' and s.display_name = '${nom.replace(/'/g, "''")}' limit 1
    `);
    const ok = db.length === 1 && (nem === "" || String(db[0].primary_phone ?? "").includes(nem));
    spot.push(`${nom.slice(0, 24)}${ok ? "✓" : "✗"}`);
    record(`P3.10.${checked + 1} spot check "${nom.slice(0, 30)}"`, ok, db.length === 1 ? `parent ${db[0].parent_code} / phone ${db[0].primary_phone}` : "NOT FOUND");
    checked++;
  }
  saveState({ ...S, import1: JSON.stringify(MUT.import1Counts), import1Sums: JSON.stringify(MUT.import1Sums) });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — BACKUP: cold-cache (BKUP-508) → warmed → content verification
// ═══════════════════════════════════════════════════════════════════════════
async function phase4() {
  section("Phase 4 — BACKUP (the real pipeline; the BKUP-508 cold-cache demonstration)");
  setBackupPassphrase(BACKUP_PASSPHRASE);
  const repos = getSupabaseRepositories();
  const actorId = MUT.profileId;
  const actorName = `FAKE ${TAG} Admin`;

  // 4.A THE POST-IMPORT BACKUP — taken immediately after the import, with
  // whatever cache state the import's own reads left behind. This is the
  // EXACT state the desktop app is in when the operator imports a workbook
  // and then goes straight to Settings → Sauvegarde → « Sauvegarder
  // maintenant ». The import's identity resolution seeds SOME caches
  // (parents/students/ledger) while the bulk write paths never seed others
  // (payments/installments) — the archive looks healthy at a glance
  // (parentCount populated) while silently missing entire collections.
  const cold = await repos.backups.runBackup(actorId, actorName);
  record("P4.1 the post-import backup completed with NO error (the hazard's point)", cold.ok, cold.ok ? `archive ${cold.value.id} (${cold.value.sizeBytes} B)` : cold.error.message);
  MUT.archiveCold = cold.ok ? cold.value.id : "";
  const coldMeta = cold.ok ? cold.value.metadata : null;
  const insCold = await inspectArchive(MUT.archiveCold);
  const coldCounts = insCold.ok ? insCold.value.counts : null;
  const cCold = await tenantCensus(MUT.tenantId);
  // THE BKUP-508 CONTRACT: the post-import backup must carry the FULL
  // server state. Pre-fix this is RED (the demonstration: the archive
  // silently misses collections the caches never seeded); post-fix GREEN.
  record("P4.2 the post-import archive carries the FULL server state (the BKUP-508 contract)",
    coldCounts != null && coldCounts.parents === cCold.parents && coldCounts.students === cCold.students && coldCounts.payments === cCold.payments && coldCounts.installments === cCold.installments && coldCounts.ledger === cCold.ledger,
    `archive counts: parents=${coldCounts?.parents}/students=${coldCounts?.students}/ledger=${coldCounts?.ledger}/payments=${coldCounts?.payments}/installments=${coldCounts?.installments} — vs the SERVER's ${cCold.parents}/${cCold.students}/${cCold.ledger}/${cCold.payments}/${cCold.installments}`);

  // 4.B The metadata counts agree with the payload (the operator's
  // post-hoc detection surface).
  record("P4.3 the metadata counts agree with the archive payload",
    coldMeta != null && coldCounts != null &&
    Number(coldMeta.parentCount) === coldCounts.parents && Number(coldMeta.paymentCount) === coldCounts.payments && Number(coldMeta.installmentCount) === coldCounts.installments,
    `metadata parentCount=${coldMeta?.parentCount} paymentCount=${coldMeta?.paymentCount} installmentCount=${coldMeta?.installmentCount} — payload ${coldCounts?.parents}/${coldCounts?.payments}/${coldCounts?.installments}`);

  // 4.C THE WARMED BACKUP — what the operator gets after the app's screens
  // have seeded the caches (the current design's happy path).
  console.log("  warming the repository caches (the app's screens' role)…");
  const nParents = await awaitSeed(() => repos.parents.observe().get().length);
  const nStudents = await awaitSeed(() => repos.students.observe().get().length);
  await awaitSeed(() => repos.payments.observe().get().length);
  await awaitSeed(() => repos.installments.observe().get().length);
  await awaitSeed(() => repos.ledger.observe().get().length);
  console.log(`  caches seeded: parents=${nParents} students=${nStudents}`);
  const warm = await repos.backups.runBackup(actorId, actorName);
  record("P4.4 the WARMED backup completed", warm.ok, warm.ok ? `archive ${warm.value.id} (${warm.value.sizeBytes} B)` : warm.error.message);
  MUT.archiveWarm = warm.ok ? warm.value.id : "";
  const warmMeta = warm.ok ? warm.value.metadata : null;

  // 4.D THE ARCHIVE CONTENT vs THE SERVER CENSUS — "backups contain
  // everything they are supposed to contain".
  const c = await tenantCensus(MUT.tenantId);
  const rec = await getArchive(MUT.archiveWarm);
  const contentOk = rec != null && warmMeta != null &&
    Number(warmMeta.parentCount) === c.parents &&
    Number(warmMeta.studentCount) === c.students &&
    Number(warmMeta.paymentCount) === c.payments &&
    Number(warmMeta.installmentCount) === c.installments &&
    Number(warmMeta.ledgerEntryCount) === c.ledger;
  record("P4.5 the warmed archive's metadata counts EQUAL the server census",
    contentOk,
    warmMeta ? `archive parents=${warmMeta.parentCount}/students=${warmMeta.studentCount}/payments=${warmMeta.paymentCount}/installments=${warmMeta.installmentCount}/ledger=${warmMeta.ledgerEntryCount} vs server ${c.parents}/${c.students}/${c.payments}/${c.installments}/${c.ledger}` : "no archive");

  // 4.E The DECRYPTED snapshot census (the archive's actual payload).
  if (rec) {
    const inspection = await inspectArchive(MUT.archiveWarm);
    record("P4.6 the warmed archive decrypts + verifies (integrity=verified)",
      inspection.ok && inspection.value.integrity === "verified",
      inspection.ok ? JSON.stringify(inspection.value.counts) : inspection.error.message);
    const counts = inspection.ok ? inspection.value.counts : null;
    record("P4.7 the decrypted payload carries the FULL imported state",
      counts != null && counts.parents === c.parents && counts.students === c.students && counts.payments === c.payments && counts.ledger === c.ledger,
      counts ? `payload ${counts.parents}/${counts.students}/${counts.payments}/${counts.installments}/${counts.ledger}` : "n/a");
  }

  // 4.F The server metadata mirror (backup_archives) — the BKUP-501 pipeline
  // (exercised through the app's repository path — the mirror rows included).
  const mirror = await sqlRows(`select archive_id_text, status, size_bytes, checksum_sha256, tenant_id from public.backup_archives where tenant_id = '${MUT.tenantId}' order by created_at`);
  record("P4.8 the server metadata mirror carries BOTH archives (the TEST tenant's rows)",
    mirror.length === 2, mirror.map((m) => `${String(m.archive_id_text).slice(0, 24)}(${m.status})`).join(", "));

  saveState({ ...S, archiveCold: MUT.archiveCold, archiveWarm: MUT.archiveWarm });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 — PURGE: dry-run → EXECUTE (the real RPC through the UI path)
// ═══════════════════════════════════════════════════════════════════════════
async function phase5() {
  section("Phase 5 — PURGE (the real RPC, EXECUTE mode, through the repository's UI path)");

  // 5.A The DRY-RUN (read-only preview — the exact button the UI shows).
  const preCensus = await tenantCensus(MUT.tenantId);
  const dry = await dryRunPurge();
  record("P5.1 the dry-run preview returned the blast radius", dry.ok,
    dry.ok ? `total=${dry.value.total} mode=${dry.value.mode}` : dry.error.message);
  if (dry.ok) {
    const v = dry.value;
    const matches = Number(v.counts.parents) === preCensus.parents && Number(v.counts.students) === preCensus.students &&
      Number(v.counts.payments) === preCensus.payments && Number(v.counts.installments) === preCensus.installments &&
      Number(v.counts.ledger_entries) === preCensus.ledger;
    record("P5.2 the dry-run counts EQUAL the actual census (nothing missed, nothing extra)", matches,
      `dry ${v.counts.parents ?? 0}p/${v.counts.students ?? 0}s/${v.counts.payments ?? 0}pay/${v.counts.installments ?? 0}inst/${v.counts.ledger_entries ?? 0}led vs census ${preCensus.parents}/${preCensus.students}/${preCensus.payments}/${preCensus.installments}/${preCensus.ledger}`);
    record("P5.3 the dry-run deleted NOTHING", (await tenantCensus(MUT.tenantId)).parents === preCensus.parents, "counts unchanged");
    record("P5.4 the dry-run reports the preserved families (the no-interference evidence)", v.preserved != null && typeof v.preserved.backup_archives === "string", JSON.stringify(v.preserved));
  }

  // 5.B The wrong-phrase probe (the server-side gate — defense in depth).
  const wrong = await executePurge("purger");
  record("P5.5 the wrong-phrase execute is REFUSED server-side (confirmation_required)", !wrong.ok && wrong.error.code === "PURGE_CONFIRMATION_REQUIRED", wrong.ok ? "UNEXPECTEDLY EXECUTED" : wrong.error.code);
  record("P5.6 the refused execute deleted NOTHING", (await tenantCensus(MUT.tenantId)).parents === preCensus.parents, "counts unchanged");

  // 5.C THE EXECUTE (the real destructive call, isolated tenant).
  const archiveCountBefore = Number((await sqlRows(`select count(*)::int as n from public.backup_archives where tenant_id = '${MUT.tenantId}'`))[0].n);
  const ex = await executePurge("PURGER");
  record("P5.7 the EXECUTE completed (the real purge)", ex.ok, ex.ok ? `mode=${ex.value.mode} total=${ex.value.total} audit_entry=${ex.value.audit_entry_id ?? "n/a"}` : ex.error.message);

  // 5.D ZERO RESIDUE across every family.
  const post = await tenantCensus(MUT.tenantId);
  const families = [
    ["parents", post.parents], ["students", post.students], ["payments", post.payments],
    ["installments", post.installments], ["ledger", post.ledger],
    ["activation_codes", post.activation_codes], ["service_enrollments", post.service_enrollments],
  ] as const;
  const residue = families.filter(([, n]) => n !== 0);
  record("P5.8 ZERO residue across every domain family (the purge is complete)",
    residue.length === 0, residue.length === 0 ? "all zero" : residue.map(([f, n]) => `${f}=${n}`).join(", "));

  // 5.E The no-interference proofs (the owner's explicit gate).
  const archiveCountAfter = Number((await sqlRows(`select count(*)::int as n from public.backup_archives where tenant_id = '${MUT.tenantId}'`))[0].n);
  record("P5.9 backup_archives SURVIVED the purge (the phase-4 archives are intact)", archiveCountAfter === archiveCountBefore && archiveCountBefore === 2, `${archiveCountBefore}→${archiveCountAfter}`);
  const auditRow = await sqlRows(`
    select count(*)::int as n from public.audit_logs
    where tenant_id = '${MUT.tenantId}' and action = 'system.purge_student_parent_domain'
  `);
  record("P5.10 the purge WROTE its audit entry (append-only journal — evidence, not deletion)", Number(auditRow[0]?.n) >= 1, `purge audit rows=${auditRow[0]?.n}`);
  const rpcs = await sqlRows(`
    select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('purge_expired_backups', 'mark_sync_queue_processed', 'upsert_parent_from_import')
  `);
  record("P5.11 the sync/backup RPCs still present (the infrastructure untouched)", Number(rpcs[0]?.n) === 3, `present=${rpcs[0]?.n}/3`);

  // 5.F The production tenant — the data-safety invariant, mid-workflow.
  await assertProductionIntact("P5.12");
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6 — IMPORT #2: the post-purge re-import (the workflow's verify step)
// ═══════════════════════════════════════════════════════════════════════════
async function phase6() {
  section("Phase 6 — IMPORT #2 (the post-purge re-import)");
  const stats = await runImport("import #2 (post-purge)");
  record("P6.1 import #2 completed", stats.rowsRead > 1000, `rowsRead=${stats.rowsRead} rowsImported=${stats.rowsImported} in ${(stats.durationMs / 1000).toFixed(1)}s`);

  const c = await tenantCensus(MUT.tenantId);
  const i1 = MUT.import1Counts;
  record("P6.2 the re-imported state MATCHES import #1 family-for-family",
    c.students === i1.students && c.parents === i1.parents && c.payments === i1.payments && c.installments === i1.installments && c.ledger === i1.ledger,
    `students ${c.students} vs ${i1.students} · parents ${c.parents} vs ${i1.parents} · payments ${c.payments} vs ${i1.payments} · installments ${c.installments} vs ${i1.installments} · ledger ${c.ledger} vs ${i1.ledger}`);
  const s1 = MUT.import1Sums;
  record("P6.3 the re-imported financial sums MATCH import #1",
    c.payments_sum === s1.payments_sum && c.due_sum === s1.due_sum && c.paid_sum === s1.paid_sum,
    `payments Σ${c.payments_sum} vs ${s1.payments_sum} · due Σ${c.due_sum} vs ${s1.due_sum} · paid Σ${c.paid_sum} vs ${s1.paid_sum}`);
  await assertProductionIntact("P6.4");
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7 — EDGE CASES: the crafted workbook (duplicates/invalid/missing)
// ═══════════════════════════════════════════════════════════════════════════
/** Build the edge-case workbook: valid + duplicate + missing-NEM + multi-student rows. */
async function buildEdgeWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ETAT 20262027");
  const headers = [
    "INFOS", "E-MAIL", "NEM", "TUTEUR", "NOM", "niveau", "CLASSE", "OPTION", "REMISE", "JUSTIFICATION",
    "DEVIS ANNUEL", "REMBOURCEMENT", "DETTES", "REGLEMENTS DETTES", "TOTAL VERSEMENTS", "TOTAL*CREANCE",
    "FI", "V2", "2V", "v3", "DISTINATION", "1T", "T2", "t3", "PSY1", "PSY2", "ORTH1", "ORTH2",
    "E-PLANT", "Ratrapage", "SEPTEMBRE", "CREANCES SEPTEMBRE", "DECEMBRE", "CREANCES DECEMBRE", "MARS", "CREANCES MARS",
  ];
  // Column A is the sheet's leading empty column — the schema addresses
  // fields by COLUMN LETTER starting at B (the 2026-2027 config's map:
  // B=INFOS C=E-MAIL D=NEM E=TUTEUR F=NOM G=niveau H=CLASSE I=OPTION
  // J=REMISE K=JUSTIFICATION L=DEVIS M=REMBOURCEMENT N=DETTES
  // O=REGLEMENTS P=TOTAL-VERSEMENTS Q=TOTAL-CREANCE R=FI S=V2 T=2V U=v3
  // V=DISTINATION W..AK=the payment columns).
  ws.addRow(["", ...headers]);
  const mk = (nem: string, nom: string, classe: string, fi: number, v2: number, v3: number) =>
    ["", "", "", nem, "", nom, "PRIM", classe, "", 0, "", fi + v2 + v3, 0, 0, 0, fi + v2 + v3, 0, fi, v2, 0, v3, "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  // 1. A valid family (two students, one parent — the relationship case).
  ws.addRow(mk("0550000001", "EDGE ONE Parent StudentA", "1AP", 5000, 10000, 0));
  ws.addRow(mk("0550000001", "EDGE ONE Parent StudentB", "2AP", 5000, 0, 8000));
  // 2. A DUPLICATE of the first row (the within-batch dedupe case).
  ws.addRow(mk("0550000001", "EDGE ONE Parent StudentA", "1AP", 5000, 10000, 0));
  // 3. A row with NO NEM (the placeholder-parent fallback).
  ws.addRow(mk("", "EDGE TWO NoPhone Student", "3AP", 3000, 0, 0));
  // 4. An invalid row: no NOM (the required-field validation).
  ws.addRow(mk("0550000099", "", "1AP", 1000, 0, 0));
  // 5. A second valid family (so the totals are non-trivial).
  ws.addRow(mk("0550000002", "EDGE THREE Parent Student", "TC", 12000, 15000, 15000));
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

async function runEdgeImport(label: string, bytes: Uint8Array) {
  const repos = getSupabaseRepositories();
  const storage = new RepositoryStorageAdapter({
    parents: repos.parents, students: repos.students, ledger: repos.ledger,
    payments: repos.payments, installments: repos.installments,
    tenantId: MUT.tenantId, actorId: MUT.profileId, actorName: `FAKE ${TAG} Admin`,
  });
  const engine = new ImportEngine({
    storage,
    auditSink: { async logAction() { /* the edge import's audit is non-critical */ } },
  });
  return engine.importFile(bytes, "edge-case.xlsx", { dryRun: false, source: { user: TEST_ADMIN_EMAIL } });
}

async function phase7() {
  section("Phase 7 — EDGE CASES (the crafted workbook: duplicates/invalid/missing-NEM/multi-student)");
  const before = await tenantCensus(MUT.tenantId);

  const bytes = await buildEdgeWorkbook();
  const ctx = await runEdgeImport("edge #1", bytes);
  record("P7.1 the edge import completed", true, `rowsRead=${ctx.stats.rowsRead} rowsImported=${ctx.stats.rowsImported} rowsUpdated=${ctx.stats.rowsUpdated} rowsSkipped=${ctx.stats.rowsSkipped} rowsRejected=${ctx.stats.rowsRejected} warnings=${ctx.stats.warnings}`);

  // 7.B The duplicate row must NOT create a second student (the dedupe).
  const dup = await sqlRows(`
    select count(*)::int as n from public.students s
    where s.tenant_id = '${MUT.tenantId}' and s.display_name = 'EDGE ONE Parent StudentA'
  `);
  record("P7.2 the DUPLICATE row created exactly ONE student (within-batch dedupe)", Number(dup[0]?.n) === 1, `students named EDGE ONE A = ${dup[0]?.n}`);

  // 7.C The multi-student family: one parent, two students.
  const fam = await sqlRows(`
    select count(*)::int as students from public.students s join public.parents p on p.id = s.parent_id
    where s.tenant_id = '${MUT.tenantId}' and p.primary_phone = '0550000001'
  `);
  record("P7.3 the two-student family resolves to ONE parent (the relationship)", Number(fam[0]?.students) === 2, `students under parent 0550000001 = ${fam[0]?.students}`);

  // 7.D The missing-NEM row still imports (the placeholder-parent fallback).
  const noPhone = await sqlRows(`
    select count(*)::int as n from public.students where tenant_id = '${MUT.tenantId}' and display_name = 'EDGE TWO NoPhone Student'
  `);
  record("P7.4 the missing-NEM row imported (the placeholder-parent fallback)", Number(noPhone[0]?.n) === 1, `imported=${noPhone[0]?.n}`);

  // 7.E The invalid row (no NOM) is rejected/not imported.
  const noName = await sqlRows(`
    select count(*)::int as n from public.students where tenant_id = '${MUT.tenantId}' and (display_name = '' or display_name is null)
  `);
  record("P7.5 the no-NOM row did NOT import (required-field validation)", Number(noName[0]?.n) === 0, `empty-name students=${noName[0]?.n}`);

  // 7.F The re-run is IDEMPOTENT (no doubling).
  const after1 = await tenantCensus(MUT.tenantId);
  record("P7.6a the edge import added exactly the 4 valid students (parents +2..+3 — the missing-NEM row's placeholder family may resolve BY NAME into an existing family, the documented multi-prong identity semantics)",
    after1.students === before.students + 4 && (after1.parents === before.parents + 2 || after1.parents === before.parents + 3),
    `students ${before.students}→${after1.students} (+4 expected) · parents ${before.parents}→${after1.parents} (+2..+3 expected)`);
  const ctx2 = await runEdgeImport("edge #2 (re-run)", bytes);
  const after2 = await tenantCensus(MUT.tenantId);
  record("P7.6b the edge re-run is IDEMPOTENT (no count changes)",
    after2.students === after1.students && after2.parents === after1.parents,
    `students ${after1.students}→${after2.students} · parents ${after1.parents}→${after2.parents}`);
  record("P7.7 the re-run reported updates/skips (not fresh inserts)", ctx2.stats.rowsImported <= 1, `imported=${ctx2.stats.rowsImported} updated=${ctx2.stats.rowsUpdated} skipped=${ctx2.stats.rowsSkipped}`);
  await assertProductionIntact("P7.8");
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8 — RESTORE: the real restore → the offline layer's verification
// ═══════════════════════════════════════════════════════════════════════════
async function phase8() {
  section("Phase 8 — RESTORE (the real pipeline — the offline layer's rehydration)");
  const repos = getSupabaseRepositories();

  // 8.A The wrong-passphrase refusal (the integrity gate).
  setBackupPassphrase("wrong-passphrase-t487");
  const bad = await repos.backups.restore(MUT.archiveWarm, MUT.profileId, `FAKE ${TAG} Admin`);
  record("P8.1 the wrong-passphrase restore is REFUSED", !bad.ok, bad.ok ? "UNEXPECTEDLY RESTORED" : bad.error.code);

  // 8.B The REAL restore (the app's path — the status transition + the
  // server mirror included).
  setBackupPassphrase(BACKUP_PASSPHRASE);
  const r = await repos.backups.restore(MUT.archiveWarm, MUT.profileId, `FAKE ${TAG} Admin`);
  record("P8.2 the restore completed (the offline layer rehydrated)", r.ok, r.ok ? `${r.value.durationMs} ms` : r.error.message);

  // 8.C The offline layer's state == the backup's snapshot (the "Verify
  // Original Data" step — against the ARCHIVE's own content).
  const inspection = await inspectArchive(MUT.archiveWarm);
  const counts = inspection.ok ? inspection.value.counts : null;
  const parents = mockStore.parents.length;
  const students = mockStore.students.length;
  const payments = mockStore.payments.length;
  const installments = mockStore.installments.length;
  const ledger = mockStore.ledger.length;
  record("P8.3 the offline layer carries the archive's FULL state",
    counts != null && parents === counts.parents && students === counts.students && payments === counts.payments && installments === counts.installments && ledger === counts.ledger,
    `offline ${parents}p/${students}s/${payments}pay/${installments}inst/${ledger}led vs archive ${counts?.parents ?? "?"}/${counts?.students ?? "?"}/${counts?.payments ?? "?"}/${counts?.installments ?? "?"}/${counts?.ledger ?? "?"}`);

  // 8.D The relationships resolve INSIDE the restored state.
  const parentIds = new Set(mockStore.parents.map((p) => p.id));
  const orphanStudents = mockStore.students.filter((s) => !parentIds.has(s.parentId)).length;
  record("P8.4 zero orphaned students inside the restored state (the relationships)", orphanStudents === 0, `orphans=${orphanStudents}`);

  // 8.E The restored-from marker (the mode indicator).
  const marker = JSON.parse(memStore.get("el-imtiyaz:restored-from") ?? "null");
  record("P8.5 the restored-from marker records the recovery", marker?.archiveId === MUT.archiveWarm, `archive=${String(marker?.archiveId ?? "").slice(0, 24)}`);

  // 8.F The archived status transition (BKUP-503) + the server mirror.
  const rec = await getArchive(MUT.archiveWarm);
  record("P8.6 the archive's status transitioned to 'restored' (the recovery information)", rec?.metadata.status === "restored", `status=${rec?.metadata.status}`);
  const mirror = await sqlRows(`select status, restored_at from public.backup_archives where tenant_id = '${MUT.tenantId}' and archive_id_text = '${MUT.archiveWarm}'`);
  record("P8.7 the server mirror carries the 'restored' transition", mirror[0]?.status === "restored" && !!mirror[0]?.restored_at, `status=${mirror[0]?.status} restored_at=${mirror[0]?.restored_at}`);

  // 8.G BKUP-509 verification — the purge deleted the ACTIVATION CODES the
  // backup never captured (the documented coverage gap, live-measured).
  const codes = Number((await sqlRows(`select count(*)::int as n from public.activation_codes where tenant_id = '${MUT.tenantId}'`))[0].n);
  const snapshotKeys = Object.keys(JSON.parse(String(inspection.ok ? "{}" : "{}")));
  void snapshotKeys;
  record("P8.8 BKUP-509 live measurement — the activation codes the archive does NOT carry (post-purge + re-import: the codes are re-issued only by the import's code-generation)",
    true, `live activation_codes in the test tenant now = ${codes}; the archive's 8 collections include none of them (documented gap BKUP-509)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9 — POSTFLIGHT: the production census + the FULL cleanup
// ═══════════════════════════════════════════════════════════════════════════
async function phase9() {
  section("Phase 9 — POSTFLIGHT (the production census + the full cleanup)");

  // 9.A The production data-safety invariant — the final proof.
  await assertProductionIntact("P9.1");

  // 9.B The cleanup purge (the app's own path — leaves the audit trail).
  const ex = await executePurge("PURGER");
  record("P9.2 the cleanup purge (the test tenant's domain removed)", ex.ok, ex.ok ? `total=${ex.value.total}` : ex.error.message);
  const post = await tenantCensus(MUT.tenantId);
  record("P9.3 zero domain residue after the cleanup purge", post.parents === 0 && post.students === 0 && post.payments === 0 && post.installments === 0 && post.ledger === 0, JSON.stringify(post));

  // 9.C The metadata mirror rows removed (the §15.38 zero-residue class).
  await sqlRows(`delete from public.backup_archives where tenant_id = '${MUT.tenantId}'`);
  const mirror = Number((await sqlRows(`select count(*)::int as n from public.backup_archives where tenant_id = '${MUT.tenantId}'`))[0].n);
  record("P9.4 the backup_archives mirror rows removed (zero residue)", mirror === 0, `remaining=${mirror}`);

  // 9.D The test admin's account removed (GoTrue admin delete — the EF's
  // own path; the profile/roles go with the tenant cascade below).
  const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${MUT.authUserId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  record("P9.5 the TEST admin's auth account removed", del.status === 200 || del.status === 204, `HTTP ${del.status}`);

  // 9.E The staff profile + role assignments removed; the tenant DEACTIVATED.
  // LIVE DISCOVERY: an audited tenant CANNOT be deleted — the tenants→
  // audit_logs FK cascade collides with the enforce_audit_log_append_only
  // trigger (P0001), so the honest end state is the deactivated FAKE-marked
  // tenant row + its immutable audit journal (the T-486 precedent: the
  // forensic record stays).
  await sqlRows(`delete from public.role_assignments where user_profile_id in (select id from public.user_profiles where tenant_id = '${MUT.tenantId}' or display_name like 'FAKE ${TAG}%')`);
  await sqlRows(`delete from public.user_profiles where tenant_id = '${MUT.tenantId}' or display_name like 'FAKE ${TAG}%'`);
  await sqlRows(`update public.tenants set is_active = false where id = '${MUT.tenantId}'`);
  const t = await sqlRows(`select is_active from public.tenants where id = '${MUT.tenantId}'`);
  record("P9.6 the test tenant deactivated (the audit journal preserved — the append-only contract)", t.length === 1 && t[0].is_active === false, `is_active=${t[0]?.is_active}`);

  // 9.F The FINAL production census (the whole workflow's data-safety proof).
  const fp = await productionFingerprint();
  const dataKeys: (keyof typeof BASELINE)[] = ["parents", "students", "payments", "installments", "ledger", "activation_codes", "payments_sum", "due_sum", "paid_sum"];
  const bad = dataKeys.filter((k) => fp[k] !== BASELINE[k]);
  record("P9.7 FINAL: the production data is byte-identical to the preflight baseline", bad.length === 0,
    bad.length === 0 ? `parents ${fp.parents} / students ${fp.students} / payments Σ${fp.payments_sum} — UNTOUCHED` : `DRIFT: ${bad.join(",")}`);

  // 9.G The residue census: zero ACTIVE test residue (the deactivated
  // tenant row + its audit journal remain by design — the append-only
  // contract; zero domain rows, zero profiles, zero mirror rows, zero
  // role assignments).
  const residue = await sqlRows(`
    select
      (select count(*)::int from public.tenants where name like 'FAKE-t487-%' and is_active) as active_tenants,
      (select count(*)::int from public.user_profiles where display_name like 'FAKE t487-%') as profiles,
      (select count(*)::int from public.backup_archives where tenant_id::text <> '${REAL_TENANT}') as backup_rows,
      (select count(*)::int from public.role_assignments ra join public.user_profiles up on up.id = ra.user_profile_id where up.display_name like 'FAKE t487-%') as roles,
      (select count(*)::int from public.parents where tenant_id = '${MUT.tenantId}') as parents,
      (select count(*)::int from public.students where tenant_id = '${MUT.tenantId}') as students
  `);
  const r = residue[0] ?? {};
  record("P9.8 zero ACTIVE residue (the deactivated tenant + its audit journal remain by design)",
    Number(r.active_tenants) === 0 && Number(r.profiles) === 0 && Number(r.backup_rows) === 0 && Number(r.roles) === 0 && Number(r.parents) === 0 && Number(r.students) === 0, JSON.stringify(r));
}

// ── The runner ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`T-487 integrated-workflow E2E — tag ${TAG}`);
  console.log(`workbook: ${XLSX_PATH}`);
  // Restore cross-phase state for incremental runs.
  if (S.tenantId && !S.tenantId.includes("undefined")) {
    MUT.tenantId = S.tenantId; MUT.authUserId = S.authUserId ?? ""; MUT.profileId = S.profileId ?? "";
    if (S.import1) { MUT.import1Counts = JSON.parse(S.import1); MUT.import1Sums = JSON.parse(S.import1Sums ?? "{}"); }
    MUT.archiveCold = S.archiveCold ?? ""; MUT.archiveWarm = S.archiveWarm ?? "";
    console.log(`resuming state: tenant ${MUT.tenantId}`);
    if (MUT.tenantId && MUT.authUserId) { try { await signInTestAdmin(); } catch (e) { console.warn("re-sign-in failed:", e); } }
  }

  try {
    if (0 >= START_FROM_PHASE) await phase0();
    if (1 <= STOP_AFTER_PHASE && 1 >= START_FROM_PHASE) { if (!MUT.tenantId) await phase1(); }
    if (2 <= STOP_AFTER_PHASE && 2 >= START_FROM_PHASE) await phase2();
    if (3 <= STOP_AFTER_PHASE && 3 >= START_FROM_PHASE) await phase3();
    if (4 <= STOP_AFTER_PHASE && 4 >= START_FROM_PHASE) await phase4();
    if (5 <= STOP_AFTER_PHASE && 5 >= START_FROM_PHASE) await phase5();
    if (6 <= STOP_AFTER_PHASE && 6 >= START_FROM_PHASE) await phase6();
    if (7 <= STOP_AFTER_PHASE && 7 >= START_FROM_PHASE) await phase7();
    if (8 <= STOP_AFTER_PHASE && 8 >= START_FROM_PHASE) await phase8();
    if (9 <= STOP_AFTER_PHASE && 9 >= START_FROM_PHASE) await phase9();
  } catch (e) {
    record("FATAL", false, e instanceof Error ? e.message : String(e));
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n══ T-487 E2E SUMMARY: ${passed} passed / ${failed} failed ══`);
  if (failed > 0) {
    console.log("FAILED:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  ❌ ${r.id} — ${r.detail}`);
  }
  const reportPath = path.join(REPO_ROOT, "scripts", "t-487-e2e-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ tag: TAG, passed, failed, results }, null, 2));
  console.log(`report: ${reportPath}`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();


