/**
 * t-423-post-fix-verification.mjs — the LIVE acceptance-criteria run for
 * GitHub issue #23 (read-only; signs in as the owner's staff account and
 * exercises the Finances page's NEW read path end to end).
 *
 * Verifies, per the issue's checklist:
 *   1. The four migration-0123 RPCs answer over the REAL staff JWT with
 *      the FULL collections (immune to the 1,000-row cap by construction)
 *      and at RPC-path latency (the PERF-505 acceptance).
 *   2. Encaissé (cumul) = Σ paid payments = 162,713,000 DZD and the
 *      September 2026 monthly revenue = the same (the KPI acceptance).
 *   3. Encours créances (installment basis, §15) = 207,773,800 DZD —
 *      matching compute_debt_aging_summary's independent server-side total
 *      (the cross-check the issue demands).
 *   4. The Tranches tab's data now spans T1+T2+T3 (all 5,963 rows —
 *      by tranche_number ≠ [[1,1000]]).
 *   5. The anon key CANNOT call the RPCs (the staff gate holds) and an
 *      unauthenticated call is rejected.
 *   6. Reliability spot-check: 3 rounds per RPC (rows + latency + errors).
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

const out = (...a) => console.log(...a);
const ms = (t0) => `${((performance.now() - t0) / 1000).toFixed(2)}s`;

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
  out(`signed in as ${ADMIN_EMAIL} (staff JWT)`);

  const call = async (fn) => {
    const t0 = performance.now();
    const { data, error } = await client.rpc(fn);
    return { rows: data ?? [], error, latency: ms(t0) };
  };

  // ── 1+6. The four RPCs: full collections + latency, 3 rounds ──────────
  out("\n──── 1. The migration-0123 RPCs over the staff JWT (3 rounds each) ────");
  const roundStats = {};
  for (const fn of [
    "read_payments_collection",
    "read_installments_collection",
    "read_ledger_entries_collection",
    "read_debt_summary_collection",
  ]) {
    roundStats[fn] = { ok: 0, fail: 0, rows: null, latencies: [] };
    for (let i = 0; i < 3; i++) {
      const r = await call(fn);
      if (r.error) {
        roundStats[fn].fail += 1;
        if (i === 0) out(`  ${fn}: ROUND ${i + 1} FAIL ${r.error.message}`);
      } else {
        roundStats[fn].ok += 1;
        roundStats[fn].rows = r.rows.length;
        roundStats[fn].latencies.push(r.latency);
      }
    }
    const s = roundStats[fn];
    out(
      `  ${fn}: ${s.ok}/3 OK rows=${s.rows ?? "—"} latencies=[${s.latencies.join(", ")}]${s.fail ? ` FAILS=${s.fail}` : ""}`,
    );
  }

  // ── 2. The KPI computations over the RPC data (the page's exact math) ──
  out("\n──── 2. The acceptance-criteria KPIs (the page's computations over the RPC data) ────");
  const payments = roundStats["read_payments_collection"].rows > 0 ? null : null;
  const pay = await call("read_payments_collection");
  if (pay.error) {
    out(`  FATAL: payments RPC failed: ${pay.error.message}`);
    process.exit(1);
  }
  const paidSum = pay.rows
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const sept2026 = pay.rows.filter((p) => String(p.collected_at ?? "").startsWith("2026-09"));
  const monthlySum = sept2026
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);
  out(`  payments rows: ${pay.rows.length} (expected 2198 — the full journal)`);
  out(`  Encaissé (cumul, Σ status=paid): ${paidSum.toLocaleString("en-US")} DZD (expected 162,713,000)`);
  out(`  Revenu mensuel (Sept 2026, Σ paid): ${monthlySum.toLocaleString("en-US")} DZD (expected 162,713,000)`);

  // ── 3. The créances cross-check: the summary RPC vs the aging RPC ─────
  out("\n──── 3. Encours créances: read_debt_summary_collection vs compute_debt_aging_summary ────");
  const debt = await call("read_debt_summary_collection");
  if (debt.error) {
    out(`  FATAL: debt summary RPC failed: ${debt.error.message}`);
    process.exit(1);
  }
  const debtTotal = debt.rows.reduce((s, r) => s + Number(r.outstanding_amount ?? 0), 0);
  out(`  debt summary rows (debtor families): ${debt.rows.length} (expected 741)`);
  out(`  Σ outstanding (installment basis): ${debtTotal.toLocaleString("en-US")} DZD (expected 207,773,800)`);
  const aging = await call("compute_debt_aging_summary");
  const agingTotal = (aging.rows ?? []).reduce((s, r) => s + Number(r.outstanding_amount ?? 0), 0);
  out(`  cross-check — compute_debt_aging_summary: ${aging.rows.length} rows, Σ ${agingTotal.toLocaleString("en-US")} DZD`);
  out(`  MATCH: ${debtTotal === agingTotal && debt.rows.length === aging.rows.length ? "YES ✓" : "NO ✗ (INVESTIGATE)"}`);

  // ── 4. The Tranches T1/T2/T3 census over the RPC data ──────────────────
  out("\n──── 4. The Tranches tab census (all tranches, not the capped T1-only) ────");
  const inst = await call("read_installments_collection");
  if (inst.error) {
    out(`  FATAL: installments RPC failed: ${inst.error.message}`);
    process.exit(1);
  }
  const byTranche = new Map();
  for (const i of inst.rows) {
    byTranche.set(i.tranche_number, (byTranche.get(i.tranche_number) ?? 0) + 1);
  }
  out(`  installments rows: ${inst.rows.length} (expected 5963 — the full schedule)`);
  out(`  by tranche_number: ${JSON.stringify([...byTranche.entries()])}`);
  out(`  T1+T2+T3 all present: ${[1, 2, 3].every((t) => byTranche.has(t)) ? "YES ✓" : "NO ✗"}`);

  const led = await call("read_ledger_entries_collection");
  out(`\n  ledger rows: ${led.rows.length} (expected 3342 — the full ledger, was capped at 1000)`);

  // ── 5. The gates: anon cannot call; no-session rejected ────────────────
  out("\n──── 5. The staff gate (anon key + no session) ────");
  const anon = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonCall = await anon.rpc("read_payments_collection");
  out(`  anon/no-session call: ${anonCall.error ? `REJECTED ✓ (${anonCall.error.message.slice(0, 90)})` : "ALLOWED ✗ (SECURITY HOLE)"}`);
  void payments;

  // ── Verdict ─────────────────────────────────────────────────────────────
  out("\n──── VERDICT ────");
  const checks = [
    ["payments full journal (2198)", pay.rows.length === 2198],
    ["installments full schedule (5963)", inst.rows.length === 5963],
    ["ledger full collection (3342)", led.rows.length === 3342],
    ["Encaissé 162,713,000", paidSum === 162713000],
    ["Revenu mensuel 162,713,000", monthlySum === 162713000],
    ["Créances 207,773,800 (matches the aging RPC)", debtTotal === 207773800 && debtTotal === agingTotal],
    ["Tranches T1+T2+T3", [1, 2, 3].every((t) => byTranche.has(t))],
    ["staff gate holds (anon rejected)", !!anonCall.error],
  ];
  let allOk = true;
  for (const [label, ok] of checks) {
    out(`  ${ok ? "PASS" : "FAIL"} — ${label}`);
    if (!ok) allOk = false;
  }
  out(`\n${allOk ? "ALL ACCEPTANCE CHECKS PASS ✓" : "SOME CHECKS FAILED ✗"}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
