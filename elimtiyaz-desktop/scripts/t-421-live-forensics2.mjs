/**
 * t-421-live-forensics2.mjs — READ-ONLY pass 2: write timelines.
 *
 * Pass 1 established: alive students 1137, ledger 3342 / payments 2198 /
 * installments 5963 — exactly the verified post-run-1 state. But at least
 * one installment row has created_at 2026-09-27T00:00:45 (AFTER the failed
 * run 2 at 23:06) — was there a third import? Did it write new rows while
 * old ones vanished? Histogram every table's created_at around the three
 * windows:
 *   run 1 (OK):      2026-09-26T23:00:13Z – 23:00:35Z
 *   run 2 (FAILED):  2026-09-26T23:00:40Z – 23:06:18Z
 *   run 3 (?):       2026-09-26T23:59:xx  – 00:00:45Z
 *
 * Usage: node scripts/t-421-live-forensics2.mjs
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

async function main() {
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  if (signInErr || !signIn.session) {
    console.error(`FATAL: sign-in failed: ${signInErr?.message}`);
    process.exit(1);
  }
  console.log(`signed in as ${ADMIN_EMAIL}\n`);

  const windows = [
    ["run1 23:00:13–23:00:40", "2026-09-26T23:00:00", "2026-09-26T23:00:40"],
    ["run2 23:00:40–23:06:30", "2026-09-26T23:00:40", "2026-09-26T23:06:30"],
    ["gap   23:06:30–23:59:00", "2026-09-26T23:06:30", "2026-09-26T23:59:00"],
    ["run3? 23:59:00–00:05:00", "2026-09-26T23:59:00", "2026-09-27T00:05:00"],
    ["after 00:05:00", "2026-09-27T00:05:00", "2026-09-27T23:59:59"],
  ];

  for (const [table, tsCol] of [
    ["students", "created_at"],
    ["parents", "created_at"],
    ["ledger_entries", "created_at"],
    ["payments", "created_at"],
    ["installments", "created_at"],
  ]) {
    console.log(`── ${table}.${tsCol} histogram ──`);
    for (const [label, from, to] of windows) {
      const { count, error } = await client
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", TENANT_ID)
        .gte(tsCol, from)
        .lt(tsCol, to);
      console.log(`  ${label.padEnd(26)} ${String(error ? "ERR " + error.message : count).padStart(6)}`);
    }
    // Everything BEFORE run 1 (pre-existing rows):
    const { count: pre } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID)
      .lt(tsCol, "2026-09-26T23:00:00");
    console.log(`  ${"pre-run1 (before 23:00)".padEnd(26)} ${String(pre ?? "?").padStart(6)}`);
    console.log();
  }

  // updated_at on installments (run 3 would bump it if merge-duplicates)
  console.log("── installments.updated_at histogram ──");
  for (const [label, from, to] of windows.slice(1)) {
    const { count, error } = await client
      .from("installments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID)
      .gte("updated_at", from)
      .lt("updated_at", to);
    console.log(`  ${label.padEnd(26)} ${String(error ? "ERR " + error.message : count).padStart(6)}`);
  }
  console.log();

  // ledger source_id sample: what do the imported source_ids look like?
  console.log("── ledger_entries source samples (bulk_import) ──");
  const { data: ledSample } = await client
    .from("ledger_entries")
    .select("source_type, source_id, created_at")
    .eq("tenant_id", TENANT_ID)
    .eq("source_type", "bulk_import")
    .order("created_at", { ascending: false })
    .limit(5);
  if (ledSample) for (const r of ledSample) console.log(`  ${String(r.created_at).slice(0, 19)}  ${r.source_id}`);

  // payments payment_number sample
  console.log("\n── payments number samples (latest 5) ──");
  const { data: paySample } = await client
    .from("payments")
    .select("payment_number, receipt_number, created_at")
    .eq("tenant_id", TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(5);
  if (paySample) for (const r of paySample) console.log(`  ${String(r.created_at).slice(0, 19)}  pn=${r.payment_number}  rn=${r.receipt_number}`);

  // students created in run-3 window — are there NEW students?
  console.log("\n── students created 23:59–00:05 (run 3?) ──");
  const { data: s3 } = await client
    .from("students")
    .select("id, display_name, student_code, created_at")
    .eq("tenant_id", TENANT_ID)
    .gte("created_at", "2026-09-26T23:59:00")
    .lt("created_at", "2026-09-27T00:05:00")
    .limit(8);
  if (s3 && s3.length > 0) for (const s of s3) console.log(`  ${String(s.created_at).slice(0, 19)}  ${s.display_name} (${s.student_code})`);
  else console.log("  (none)");

  // import run audit table?
  for (const t of ["import_runs", "import_run", "import_audit"]) {
    const { error } = await client.from(t).select("id", { count: "exact", head: true }).limit(1);
    console.log(`table ${t}: ${error ? "n/a" : "EXISTS"}`);
  }

  await client.auth.signOut();
  console.log("\nforensics pass 2 complete (read-only).");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
