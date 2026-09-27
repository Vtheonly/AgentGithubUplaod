/**
 * t-422-finance-zeros-probe.mjs — READ-ONLY live forensics for the owner's
 * "Finances page shows all zeros while the Dettes tab shows debts" report.
 *
 * Answers, with zero writes:
 *   1. Census: students/parents (alive vs soft-deleted), ledger_entries,
 *      payments, installments, payment_allocations.
 *   2. installments breakdown: by status, by tranche_number, by category,
 *      due_date range, academic_year (if the column exists).
 *   3. payments breakdown: by status, sums, date range.
 *   4. ledger_entries breakdown: by entry_type, sums.
 *   5. The debt-aging RPC (compute_debt_aging_summary) — row count, Σ outstanding,
 *      origin_academic_year distribution (what the Suivi des Dettes tab shows).
 *   6. Direct PostgREST installments read EXACTLY as the repository does —
 *      capturing any error the repo code swallows.
 *   7. Timeline: created_at histograms (by hour) for the financial tables —
 *      when did the current data land; did a purge happen (audit_logs).
 *   8. academic_years + student_academic_histories census (the historique question).
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
  out(`signed in as ${ADMIN_EMAIL} (${signIn.user.id})`);

  const count = async (table, extra = {}) => {
    let q = client.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID);
    for (const [k, v] of Object.entries(extra)) q = q[k[0] === "!" ? "not" : k](...[].concat(v));
    const { count: c, error } = await q;
    return error ? `ERR ${error.message}` : c;
  };

  // ── 1. Census ──────────────────────────────────────────────────────────
  section("1. CENSUS (vs T-421 verified: students 1137 / parents 741 / ledger 3342 / payments 2198 / installments 5963)");
  for (const t of ["students", "parents"]) {
    const alive = await client.from(t).select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).is("deleted_at", null);
    const dead = await client.from(t).select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).not("deleted_at", null);
    out(`  ${t.padEnd(20)} alive=${alive.count ?? "ERR:" + alive.error?.message} soft-deleted=${dead.count ?? "ERR:" + dead.error?.message}`);
  }
  for (const t of ["ledger_entries", "payments", "installments", "payment_allocations"]) {
    out(`  ${t.padEnd(20)} ${await count(t)}`);
  }

  // ── 2. installments breakdown ──────────────────────────────────────────
  section("2. INSTALLMENTS breakdown");
  {
    const { data: rows, error } = await client
      .from("installments")
      .select("id,status,tranche_number,category,due_date,amount_due,amount_paid,academic_year,created_at")
      .eq("tenant_id", TENANT_ID)
      .order("due_date", { ascending: true })
      .limit(20000);
    if (error) {
      out(`  READ ERROR: ${error.message} (code ${error.code ?? "?"})`);
    } else {
      out(`  rows read: ${rows.length}`);
      const by = (fn) => {
        const m = new Map();
        for (const r of rows) {
          const k = String(fn(r));
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      };
      out(`  by status:        ${JSON.stringify(by((r) => r.status))}`);
      out(`  by tranche_number:${JSON.stringify(by((r) => r.tranche_number))}`);
      out(`  by category:      ${JSON.stringify(by((r) => r.category))}`);
      out(`  by academic_year: ${JSON.stringify(by((r) => r.academic_year))}`);
      out(`  by due_date year: ${JSON.stringify(by((r) => String(r.due_date).slice(0, 4)))}`);
      const sumDue = rows.reduce((s, r) => s + Number(r.amount_due ?? 0), 0);
      const sumPaid = rows.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0);
      out(`  Σ amount_due=${sumDue.toLocaleString()} Σ amount_paid=${sumPaid.toLocaleString()}`);
      if (rows.length) {
        out(`  first due_date=${rows[0].due_date} last due_date=${rows[rows.length - 1].due_date}`);
        out(`  sample row: ${JSON.stringify(rows[0])}`);
      }
    }
  }

  // ── 3. payments breakdown ──────────────────────────────────────────────
  section("3. PAYMENTS breakdown");
  {
    const { data: rows, error } = await client
      .from("payments")
      .select("id,status,category,amount,payment_date,created_at")
      .eq("tenant_id", TENANT_ID)
      .limit(20000);
    if (error) out(`  READ ERROR: ${error.message}`);
    else {
      out(`  rows read: ${rows.length}`);
      const by = (fn) => {
        const m = new Map();
        for (const r of rows) {
          const k = String(fn(r));
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      };
      out(`  by status:   ${JSON.stringify(by((r) => r.status))}`);
      out(`  by category: ${JSON.stringify(by((r) => r.category))}`);
      out(`  by pay year: ${JSON.stringify(by((r) => String(r.payment_date).slice(0, 4)))}`);
      const sum = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      out(`  Σ amount=${sum.toLocaleString()}`);
      if (rows.length) out(`  sample row: ${JSON.stringify(rows[0])}`);
    }
  }

  // ── 4. ledger breakdown ────────────────────────────────────────────────
  section("4. LEDGER_ENTRIES breakdown");
  {
    const { data: rows, error } = await client
      .from("ledger_entries")
      .select("id,entry_type,category,amount,entry_date,created_at")
      .eq("tenant_id", TENANT_ID)
      .limit(20000);
    if (error) out(`  READ ERROR: ${error.message}`);
    else {
      out(`  rows read: ${rows.length}`);
      const by = (fn) => {
        const m = new Map();
        for (const r of rows) {
          const k = String(fn(r));
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      };
      out(`  by entry_type: ${JSON.stringify(by((r) => r.entry_type))}`);
      out(`  by category:   ${JSON.stringify(by((r) => r.category))}`);
      const sum = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      out(`  Σ amount=${sum.toLocaleString()}`);
    }
  }

  // ── 5. The debt-aging RPC (what Suivi des Dettes shows) ───────────────
  section("5. compute_debt_aging_summary (the Dettes tab source)");
  {
    const { data, error } = await client.rpc("compute_debt_aging_summary");
    if (error) out(`  RPC ERROR: ${error.message}`);
    else {
      const rows = data ?? [];
      out(`  debtor rows: ${rows.length}`);
      const sumOut = rows.reduce((s, r) => s + Number(r.outstanding_amount ?? 0), 0);
      out(`  Σ outstanding: ${sumOut.toLocaleString()} DZD`);
      const byYear = new Map();
      for (const r of rows) {
        const k = r.origin_academic_year ?? "null";
        byYear.set(k, (byYear.get(k) ?? 0) + 1);
      }
      out(`  by origin_academic_year: ${JSON.stringify([...byYear.entries()])}`);
      const byStatus = new Map();
      for (const r of rows) byStatus.set(r.status_level, (byStatus.get(r.status_level) ?? 0) + 1);
      out(`  by status_level: ${JSON.stringify([...byStatus.entries()])}`);
      if (rows.length) {
        out(`  top row: ${JSON.stringify({ parent: rows[0].parent_name, out: rows[0].outstanding_amount, year: rows[0].origin_academic_year, oldest: rows[0].oldest_due_date, status: rows[0].status_level })}`);
      }
    }
  }

  // ── 6. The EXACT repository read (what the installments repo does) ────
  section("6. The repo's EXACT installments read (select * ordered by due_date)");
  {
    const { data, error } = await client
      .from("installments")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .order("due_date", { ascending: true });
    if (error) out(`  REPO-READ ERROR: code=${error.code} details=${error.details ?? ""} hint=${error.hint ?? ""} msg=${error.message}`);
    else out(`  rows: ${data.length} (repo maps these into the Tranches tab)`);
  }

  // ── 7. Timeline: when did data land / did a purge run ──────────────────
  section("7. TIMELINE (financial rows by created hour + recent audit)");
  {
    const { data: inst } = await client.from("installments").select("created_at").eq("tenant_id", TENANT_ID).limit(20000);
    const { data: pays } = await client.from("payments").select("created_at").eq("tenant_id", TENANT_ID).limit(20000);
    const { data: ledg } = await client.from("ledger_entries").select("created_at").eq("tenant_id", TENANT_ID).limit(20000);
    const hist = (rows, label) => {
      const m = new Map();
      for (const r of rows ?? []) {
        const h = String(r.created_at).slice(0, 13);
        m.set(h, (m.get(h) ?? 0) + 1);
      }
      const entries = [...m.entries()].sort();
      out(`  ${label}: ${entries.length ? entries.map(([h, n]) => `${h}×${n}`).join(", ") : "NONE"}`);
    };
    hist(inst, "installments");
    hist(pays, "payments   ");
    hist(ledg, "ledger     ");
    const { data: audit } = await client
      .from("audit_logs")
      .select("action,created_at,details")
      .order("created_at", { ascending: false })
      .limit(15);
    out("  last 15 audit_logs:");
    for (const a of audit ?? []) out(`    ${a.created_at}  ${a.action}  ${String(a.details ?? "").slice(0, 90)}`);
  }

  // ── 8. Years + historique ──────────────────────────────────────────────
  section("8. ACADEMIC YEARS + HISTORIQUE");
  {
    const { data: years, error: yErr } = await client.from("academic_years").select("*").limit(20);
    if (yErr) out(`  academic_years ERROR: ${yErr.message}`);
    else out(`  academic_years: ${JSON.stringify(years)}`);
    const sah = await client.from("student_academic_histories").select("id", { count: "exact", head: true });
    out(`  student_academic_histories: ${sah.count ?? "ERR:" + sah.error?.message}`);
    const { data: sahs } = await client.from("student_academic_histories").select("academic_year,created_at").limit(5000);
    if (sahs) {
      const m = new Map();
      for (const r of sahs) m.set(r.academic_year, (m.get(r.academic_year) ?? 0) + 1);
      out(`  histories by academic_year: ${JSON.stringify([...m.entries()])}`);
    }
  }

  out("\nDONE (read-only probe complete)");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
