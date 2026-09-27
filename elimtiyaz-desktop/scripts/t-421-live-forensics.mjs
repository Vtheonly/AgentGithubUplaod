/**
 * t-421-live-forensics.mjs — READ-ONLY live forensics for the re-import
 * failure (issue #20 follow-up, 2026-09-26 23:00–23:06 UTC):
 *
 *   run_muizt2b8_3bf9e2 (23:00:13) — OK: 1139 imported / 0 updated
 *   run_muiztmwv_0cdf99 (23:00:40) — FLUSH FAILURE:
 *     ledger chunk @2000  → ledger_entries_source_uidx duplicate
 *     payments rows 1501–2000 → payments_tenant_id_payment_number_key duplicate
 *     → rollback compensated createdStudentIds/createdParentIds
 *   afterwards: GET /rest/v1/installments?...&order=due_date.asc → 500 × N
 *
 * THIS SCRIPT WRITES NOTHING. It answers:
 *   1. Are run-1's students still alive, or did run-2's compensating rollback
 *      SOFT-DELETE them (createStudent's upsert RPC returns EXISTING ids on
 *      re-import — out_was_inserted is ignored by the adapter)?
 *   2. Same question for parents.
 *   3. Current ledger / payments / installments counts vs the verified
 *      post-run-1 state (3,342 / 2,198 / 5,963).
 *   4. What EXACTLY does the failing installments GET return (status + body)?
 *   5. What do the audit_logs say about both runs?
 *   6. Are there duplicate (alive) students by display_name?
 *
 * Usage (from elimtiyaz-desktop/):
 *   node scripts/t-421-live-forensics.mjs
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

const fmt = (label, n) => `  ${label.padEnd(46)} ${String(n).padStart(7)}`;

async function main() {
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  if (signInErr || !signIn.session) {
    console.error(`FATAL: sign-in failed: ${signInErr?.message ?? "no session"}`);
    process.exit(1);
  }
  const token = signIn.session.access_token;
  console.log(`signed in as ${ADMIN_EMAIL} (${signIn.user.id})\n`);

  // ── 1. Student / parent census: alive vs soft-deleted ──────────────────
  for (const [table, label] of [["students", "STUDENTS"], ["parents", "PARENTS"]]) {
    console.log(`── ${label} ──`);
    const alive = await client.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).is("deleted_at", null);
    const dead = await client.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).not("deleted_at", null);
    console.log(fmt("alive (deleted_at IS NULL)", alive.count ?? `ERR ${alive.error?.message}`));
    console.log(fmt("soft-deleted (deleted_at NOT NULL)", dead.count ?? `ERR ${dead.error?.message}`));
    // when were they soft-deleted?
    const { data: deadSample } = await client
      .from(table)
      .select("deleted_at")
      .not("deleted_at", null)
      .order("deleted_at", { ascending: false })
      .limit(2000);
    if (deadSample && deadSample.length > 0) {
      const byMinute = new Map();
      for (const r of deadSample) {
        const m = String(r.deleted_at).slice(0, 16);
        byMinute.set(m, (byMinute.get(m) ?? 0) + 1);
      }
      const minutes = [...byMinute.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12);
      console.log("  soft-deletes by minute (most recent first):");
      for (const [m, n] of minutes) console.log(`    ${m}  ×${n}`);
    }
    console.log();
  }

  // ── 2. Financial counts vs the verified post-run-1 state ───────────────
  console.log("── FINANCIAL COUNTS (expected post-run-1: ledger 3342 / payments 2198 / installments 5963) ──");
  for (const [table, label, expected] of [
    ["ledger_entries", "ledger_entries", 3342],
    ["payments", "payments", 2198],
    ["installments", "installments", 5963],
  ]) {
    const { count, error } = await client.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID);
    if (error) console.log(fmt(`${label} (expected ${expected})`, `ERR ${error.message}`));
    else {
      console.log(fmt(`${label} (expected ${expected})`, count));
      console.log(fmt(`  → delta`, (count ?? 0) - expected));
    }
  }
  console.log();

  // ── 3. The exact failing installments GET (capture the 500 body) ───────
  console.log("── THE FAILING INSTALLMENTS GET (raw) ──");
  const getUrl = `${SUPABASE_URL}/rest/v1/installments?select=*&tenant_id=eq.${TENANT_ID}&order=due_date.asc`;
  const res = await fetch(getUrl, {
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
  });
  const bodyText = (await res.text()).slice(0, 800);
  console.log(`  GET ${getUrl.replace(SUPABASE_URL, "")}`);
  console.log(`  → HTTP ${res.status}`);
  console.log(`  → body: ${bodyText || "(empty)"}`);
  console.log();

  // Variants to isolate the 500's trigger:
  const variants = [
    ["no order", `${SUPABASE_URL}/rest/v1/installments?select=*&tenant_id=eq.${TENANT_ID}`],
    ["order id", `${SUPABASE_URL}/rest/v1/installments?select=*&tenant_id=eq.${TENANT_ID}&order=id.asc`],
    ["order due_date desc", `${SUPABASE_URL}/rest/v1/rest/v1/x`],
    ["limit 1 + order due_date", `${SUPABASE_URL}/rest/v1/installments?select=id,due_date&tenant_id=eq.${TENANT_ID}&order=due_date.asc&limit=1`],
  ];
  console.log("  isolating variants:");
  for (const [label, url] of variants) {
    if (!url.includes("/rest/v1/installments")) continue; // skip the bogus one
    const r = await fetch(url, { headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` } });
    const t = (await r.text()).slice(0, 200);
    console.log(`    ${label.padEnd(24)} → ${r.status} ${r.status >= 400 ? t : "(ok)"}`);
  }
  console.log();

  // ── 4. Audit log entries for the two runs ──────────────────────────────
  console.log("── AUDIT LOGS: import events (latest 12) ──");
  const { data: audits } = await client
    .from("audit_logs")
    .select("action, entity_id, occurred_at, note")
    .ilike("action", "import%")
    .order("occurred_at", { ascending: false })
    .limit(12);
  if (audits && audits.length > 0) {
    for (const a of audits) console.log(`  ${a.occurred_at}  ${a.action.padEnd(22)} ${a.entity_id ?? ""} ${String(a.note ?? "").slice(0, 80)}`);
  } else {
    console.log("  (no import% audit rows visible)");
  }
  console.log();

  // ── 5. Duplicate alive students (same display_name) ────────────────────
  console.log("── ALIVE STUDENT DUPLICATES by display_name ──");
  const { data: dup } = await client.rpc("pg_catalog", {}).then(() => null).catch(() => null);
  // RPC approach unavailable — use a plain select and aggregate client-side.
  const { data: aliveStudents } = await client
    .from("students")
    .select("id, display_name, student_code, created_at")
    .eq("tenant_id", TENANT_ID)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (aliveStudents) {
    const byName = new Map();
    for (const s of aliveStudents) {
      const k = String(s.display_name ?? "").trim().toLowerCase();
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(s);
    }
    const dups = [...byName.values()].filter((l) => l.length > 1);
    console.log(fmt("alive students fetched", aliveStudents.length));
    console.log(fmt("display_name groups with >1 alive student", dups.length));
    for (const g of dups.slice(0, 8)) {
      console.log(`    "${g[0].display_name}" ×${g.length} — codes: ${g.map((s) => s.student_code).join(", ")}`);
    }
  }
  console.log();

  // ── 6. Sample soft-deleted students with their financial links ─────────
  console.log("── SAMPLE SOFT-DELETED STUDENTS (are they run-1's real students?) ──");
  const { data: deadStudents } = await client
    .from("students")
    .select("id, display_name, student_code, created_at, deleted_at")
    .eq("tenant_id", TENANT_ID)
    .not("deleted_at", null)
    .order("deleted_at", { ascending: false })
    .limit(6);
  if (deadStudents && deadStudents.length > 0) {
    for (const s of deadStudents) {
      const led = await client.from("ledger_entries").select("id", { count: "exact", head: true }).eq("student_id", s.id);
      const inst = await client.from("installments").select("id", { count: "exact", head: true }).eq("student_id", s.id);
      console.log(
        `  ${s.display_name} (${s.student_code}) created=${String(s.created_at).slice(0, 19)} deleted=${String(s.deleted_at).slice(0, 19)} ledger=${led.count ?? "?"} installments=${inst.count ?? "?"}`,
      );
    }
  } else {
    console.log("  (none)");
  }

  await client.auth.signOut();
  console.log("\nforensics complete (read-only).");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
