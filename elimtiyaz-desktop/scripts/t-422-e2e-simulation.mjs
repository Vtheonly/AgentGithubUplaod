/**
 * t-422-e2e-simulation.mjs — READ-ONLY: replicate the CURRENT build's exact
 * finance data path against the live DB, plus dump the live column lists.
 *
 * 1. Live columns of installments / payments / ledger_entries.
 * 2. The installments repo read (select * ordered by due_date — expect the
 *    1000-row PostgREST cap; the current seed is NOT paginated).
 * 3. The payments repo read (paginated by collected_at desc — expect 2198).
 * 4. KPIs exactly as financials-page computes them:
 *    sumPaidPayments, monthlyRevenue, debtSummary outstanding/pastDue.
 * 5. The head-count quirk on installments (empty error message).
 * 6. Retry the count via range-limited select count:exact.
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

const out = (...a) => console.log(...a);
const section = (s) => out(`\n──── ${s} ────`);

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

  // ── 1. Live column lists ───────────────────────────────────────────────
  section("1. LIVE COLUMNS (from one row of each table)");
  for (const t of ["installments", "payments", "ledger_entries"]) {
    const { data, error } = await client.from(t).select("*").eq("tenant_id", TENANT_ID).limit(1);
    if (error) out(`  ${t}: READ ERROR ${error.message}`);
    else if (!data || data.length === 0) out(`  ${t}: EMPTY`);
    else out(`  ${t}:\n    ${Object.keys(data[0]).join(", ")}`);
  }

  // ── 2. Installments repo read (unpaginated, ordered by due_date) ──────
  section("2. INSTALLMENTS repo read (select *, order due_date asc)");
  {
    const t0 = Date.now();
    const { data, error } = await client
      .from("installments")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .order("due_date", { ascending: true });
    if (error) out(`  ERROR: code=${error.code} msg=${error.message}`);
    else {
      out(`  rows=${data.length} in ${Date.now() - t0}ms (5963 exist → truncated at ${data.length})`);
      const byTranche = new Map();
      let sumDue = 0, sumPaid = 0;
      const byStatus = new Map();
      for (const r of data) {
        byTranche.set(r.tranche_number, (byTranche.get(r.tranche_number) ?? 0) + 1);
        byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
        sumDue += Number(r.amount_due ?? 0);
        sumPaid += Number(r.amount_paid ?? 0);
      }
      out(`  [first 1000 rows] by tranche_number=${JSON.stringify([...byTranche.entries()])} by status=${JSON.stringify([...byStatus.entries()])}`);
      out(`  [first 1000 rows] Σdue=${sumDue.toLocaleString()} Σpaid=${sumPaid.toLocaleString()}`);
    }
  }

  // ── 3. Payments repo read (paginated, collected_at desc) ──────────────
  section("3. PAYMENTS repo read (paginated 1000/page, order collected_at desc)");
  {
    const t0 = Date.now();
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .from("payments")
        .select("*")
        .eq("tenant_id", TENANT_ID)
        .order("collected_at", { ascending: false })
        .range(from, from + 999);
      if (error) {
        out(`  ERROR at page ${from}: code=${error.code} msg=${error.message}`);
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    out(`  rows=${rows.length} in ${Date.now() - t0}ms`);
    // KPI: sumPaidPayments — the domain model sums status==='paid' amounts.
    const byStatus = new Map();
    for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    out(`  by status=${JSON.stringify([...byStatus.entries()])}`);
    const sumPaid = rows.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthly = rows
      .filter((r) => r.status === "paid" && String(r.collected_at ?? "") >= monthStart)
      .reduce((s, r) => s + Number(r.amount ?? 0), 0);
    out(`  → KPI Encaissé (cumul) would show: ${sumPaid.toLocaleString()} DZD`);
    out(`  → KPI Revenu mensuel would show: ${monthly.toLocaleString()} DZD (month start ${monthStart.slice(0, 10)})`);
  }

  // ── 4. debtSummary (Créances KPI) on the capped installments read ─────
  section("4. DEBT SUMMARY KPI (installments status != paid, remaining > 0)");
  {
    const { data } = await client
      .from("installments")
      .select("parent_id, amount_due, amount_paid, amount_pending, due_date, status")
      .eq("tenant_id", TENANT_ID)
      .neq("status", "paid")
      .limit(1000);
    const rows = data ?? [];
    out(`  unpaid rows read (LIMIT 1000 → truncated): ${rows.length}`);
    const nowMs = Date.now();
    let outstanding = 0, pastDue = 0;
    for (const r of rows) {
      const remaining = Math.max(0, Number(r.amount_due ?? 0) - Number(r.amount_paid ?? 0) - Number(r.amount_pending ?? 0));
      if (remaining <= 0) continue;
      outstanding += remaining;
      const days = Math.max(0, Math.floor((nowMs - new Date(r.due_date).getTime()) / 86400000));
      if (days > 0) pastDue += remaining;
    }
    out(`  → KPI Encours total créances would show (from the truncated read): ${outstanding.toLocaleString()} DZD (dont échues ${pastDue.toLocaleString()})`);
    out(`  (the RPC's full-table answer is 207,773,800 DZD — the gap is the 1000-row cap)`);
  }

  // ── 5. The head-count quirk ────────────────────────────────────────────
  section("5. installments count quirks");
  {
    const a = await client.from("installments").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID);
    out(`  head+count:exact → count=${a.count} error=${JSON.stringify(a.error)}`);
    const b = await client.from("installments").select("id", { count: "exact" }).eq("tenant_id", TENANT_ID).limit(1);
    out(`  count:exact + limit 1 → count=${b.count} error=${b.error ? b.error.message : "none"}`);
    const c = await client.from("installments").select("id", { count: "planned" }).eq("tenant_id", TENANT_ID).limit(0);
    out(`  count:planned + limit 0 → count=${c.count} error=${c.error ? c.error.message : "none"}`);
  }

  out("\nDONE");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
