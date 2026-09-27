/**
 * t-423-class-sweep-probe.mjs — READ-ONLY census of every unpaginated
 * whole-tenant seed read (the §15.63c sweep the T-422 fix pass owes).
 *
 * Measures, with zero writes:
 *   1. The students seed's EXACT read (select * order last_name, no limit)
 *      — how many rows actually come back vs the alive census (the cap).
 *   2. The parents seed's EXACT read (select * order last_name, no limit).
 *   3. student_documents / student_academic_histories whole-tenant counts
 *      (the embedded fetchers).
 *   4. The unpaid-installments read the debt seedSummary performs
 *      (select 5 cols neq status paid) — rows returned vs exist.
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

const out = (...a) => console.log(...a);

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
  out(`signed in as ${ADMIN_EMAIL}`);

  // 1. The students seed's exact read — the returned row count IS what the
  //    CRM students cache holds (no limit, no range → PostgREST caps at 1000).
  const stu = await client
    .from("students")
    .select("id")
    .eq("tenant_id", TENANT_ID)
    .is("deleted_at", null)
    .order("last_name", { ascending: true });
  out(`\nstudents seed read: returned ${stu.data?.length ?? "ERR:" + stu.error?.message} rows (alive census expected 1137)`);

  const par = await client
    .from("parents")
    .select("id")
    .eq("tenant_id", TENANT_ID)
    .is("deleted_at", null)
    .order("last_name", { ascending: true });
  out(`parents  seed read: returned ${par.data?.length ?? "ERR:" + par.error?.message} rows (alive census expected 741)`);

  // 3. Embedded fetchers' tables.
  for (const t of ["student_documents", "student_academic_histories"]) {
    const r = await client
      .from(t)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);
    out(`${t}: count=${r.count ?? "ERR:" + r.error?.message}`);
  }

  // 4. The seedSummary unpaid-installments read.
  const unpaid = await client
    .from("installments")
    .select("parent_id, amount_due, amount_paid, amount_pending, due_date")
    .eq("tenant_id", TENANT_ID)
    .neq("status", "paid");
  out(`\nseedSummary unpaid-installments read: returned ${unpaid.data?.length ?? "ERR:" + unpaid.error?.message} rows`);
  const full = await client
    .from("installments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID);
  out(`installments total (head count): ${full.count ?? "ERR:" + full.error?.message}`);
  const unpaidCount = await client
    .from("installments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID)
    .neq("status", "paid");
  out(`installments unpaid (head count): ${unpaidCount.count ?? "ERR:" + unpaidCount.error?.message}`);

  // 5. The students read the seedSummary does for per-parent counts.
  const stuLight = await client
    .from("students")
    .select("parent_id")
    .eq("tenant_id", TENANT_ID);
  out(`seedSummary students read: returned ${stuLight.data?.length ?? "ERR:" + stuLight.error?.message} rows (of 1137+)`);

  out("\nDONE (read-only)");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
