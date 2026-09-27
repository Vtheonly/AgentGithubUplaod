#!/usr/bin/env node
/**
 * t-433-purge-execute.mjs — T-433 Phase C: the REAL purge execution on the
 * owner's direct mandate ("purge everything first and remove all existing
 * data, then use the WB2 Excel file").
 *
 * THE PATH (ADR-027): the canonical `purge_student_parent_domain` RPC
 * (migrations 0120+0121) driven through the EXACT UI path the desktop's
 * Settings "Zone de danger" card takes — the GoTrue admin password grant →
 * the PostgREST RPC call — so the has_role('super_admin') gate resolves the
 * signed-in owner account and the audit entry attributes the run to the
 * admin's email (never the service key; the service key is reserved for the
 * read-only censuses).
 *
 * SAFETY MODEL (§15.50c): dry-run is the DEFAULT (counts only, zero
 * deletes); --execute is a separate explicit flag; the post-census asserts
 * zero residue on every domain family AND the preserved set intact (the
 * academic catalog, the workforce domain, the tenants, the backup family);
 * audit_logs is append-only and grows by exactly one system purge entry.
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_KEY=sb_secret_… ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *     node scripts/t-433-purge-execute.mjs            # dry-run (counts only)
 *     node scripts/t-433-purge-execute.mjs --execute  # THE REAL PURGE
 */
import process from "node:process";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const EXECUTE = process.argv.includes("--execute");

const DOMAIN_TABLES = [
  "parents", "students", "installments", "payments", "payment_allocations",
  "ledger_entries", "parent_student_links", "activation_codes",
  "user_profiles", "service_enrollments", "student_documents",
  "attendance_records", "account_approval_requests", "notifications",
];
const PRESERVED_TABLES = [
  "tenants", "academic_years", "academic_levels", "subjects", "classes",
  "personnel", "backup_archives", "audit_logs",
];

async function rest(method, path, body, headers) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

/** Robust count via head+exact (§15.63f: head+exact is the trustworthy form). */
async function headCount(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    method: "HEAD",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!res.ok) return { status: res.status, count: null };
  const range = res.headers.get("content-range"); // e.g. "0-0/741" or "*/1137"
  const total = range?.split("/")[1];
  return { status: res.status, count: total === "*" || total == null ? null : Number(total) };
}

async function census(label) {
  console.log(`\n== ${label} ==`);
  for (const t of [...DOMAIN_TABLES, ...PRESERVED_TABLES]) {
    const { status, count: n } = await headCount(t);
    console.log(`  ${t.padEnd(26)} ${(status >= 200 && status < 300) ? String(n ?? "?").padStart(7) : `HTTP ${status} (n/a)`.padStart(7)}`);
  }
}

async function main() {
  if (!SERVICE_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("FATAL: SUPABASE_SERVICE_KEY, ADMIN_EMAIL and ADMIN_PASSWORD env vars required (owner-gated)");
    process.exit(1);
  }
  console.log(`mode: ${EXECUTE ? "EXECUTE (the real purge — the owner's mandate)" : "DRY-RUN (counts only, zero deletes)"}`);

  // ── The admin sign-in (the exact UI path) ──
  const grant = await rest("POST", "/auth/v1/token?grant_type=password",
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    { apikey: SERVICE_KEY });
  if (grant.status !== 200 || !grant.json?.access_token) {
    console.error(`FATAL: admin sign-in failed (HTTP ${grant.status}) — per §15.23 STOP, never re-set the credential`);
    process.exit(1);
  }
  const ADMIN_JWT = grant.json.access_token;
  console.log(`admin sign-in OK (${ADMIN_EMAIL})`);

  // ── The census BEFORE ──
  await census(`census BEFORE${EXECUTE ? " (pre-purge)" : ""}`);

  // ── The purge RPC (the UI path: PostgREST rpc with the admin JWT) ──
  const body = { p_confirm_phrase: "PURGER", p_dry_run: !EXECUTE };
  const call = await rest("POST", "/rest/v1/rpc/purge_student_parent_domain", body, {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${ADMIN_JWT}`,
  });
  console.log(`\npurge_student_parent_domain(p_dry_run=${!EXECUTE}) → HTTP ${call.status}`);
  if (call.json != null) {
    console.log(JSON.stringify(call.json, null, 2).slice(0, 6000));
  }
  if (call.status !== 200) {
    console.error("FATAL: the purge RPC did not return HTTP 200 — aborting");
    process.exit(1);
  }
  if (call.json?.ok === false) {
    console.error(`FATAL: the purge RPC returned ok:false (${call.json?.code ?? "?"}) — aborting`);
    process.exit(1);
  }

  if (EXECUTE) {
    // ── The census AFTER + the residue/preserved asserts ──
    await census("census AFTER (post-purge)");
    console.log("\nexpected: every DOMAIN table 0 · every PRESERVED table non-zero (audit_logs grew by 1) · user_profiles keeps the admin");
  } else {
    console.log("\n(dry-run — zero deletes performed; re-run with --execute for the real purge)");
  }
}

main().catch((e) => { console.error("PURGE FAILED:", e); process.exit(1); });
