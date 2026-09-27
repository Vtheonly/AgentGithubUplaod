/**
 * t-425-no-4th-tranche-probe.mjs — READ-ONLY probe of the live tranche
 * structure ahead of the official 3-tranche correction (the owner's
 * confirmation: there is NO 4th tranche — the model is Registration (FI) +
 * T1 (V1) + T2 (2V) + T3 (v3) for tuition, T1/T2/T3 for transport).
 *
 * Zero writes. Measures, via the service-role REST client:
 *   1. The installments census by (category, tranche_number, source_type):
 *      count, Σdue, Σpaid, label samples, due-date samples.
 *   2. The tuition T4 population (the rows the correction will eliminate).
 *   3. The registration-fee coverage: how many students carry a tuition row
 *      at all (the FI-as-T1 population today).
 *   4. Payment links + allocations referencing installments (purge safety
 *      re-verification — FKs are ON DELETE SET NULL).
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const out = (...a) => console.log(...a);
const dzd = (n) => new Intl.NumberFormat("fr-DZ").format(Math.round(n));

async function main() {
  if (!SERVICE_KEY) {
    console.error("FATAL: SUPABASE_SERVICE_KEY env var required (service role)");
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function readAll(table, cols, extraFilter) {
    const all = [];
    let lastId = "";
    for (;;) {
      let q = db.from(table).select(cols).eq("tenant_id", TENANT_ID).order("id", { ascending: true }).limit(1000);
      if (extraFilter) q = extraFilter(q);
      if (lastId) q = q.gt("id", lastId);
      const { data, error } = await q;
      if (error) { console.error(`${table} read failed:`, error.message); process.exit(1); }
      all.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
      lastId = data[data.length - 1].id;
    }
    return all;
  }

  out("=== T-425 probe — the live tranche structure (READ-ONLY) ===\n");

  const rows = await readAll(
    "installments",
    "id, parent_id, student_id, category, tranche_number, label, amount_due, amount_paid, amount_pending, due_date, status, source_type, source_id",
  );
  out(`installments total: ${rows.length}`);

  // 1. Census by (category, tranche_number, source_type)
  const census = new Map();
  for (const r of rows) {
    const key = `${r.category}|T${r.tranche_number ?? "NULL"}|${r.source_type ?? "NULL"}`;
    let c = census.get(key);
    if (!c) { c = { n: 0, due: 0, paid: 0, labels: new Set(), dues: new Set() }; census.set(key, c); }
    c.n += 1; c.due += Number(r.amount_due ?? 0); c.paid += Number(r.amount_paid ?? 0);
    c.labels.add(r.label); c.dues.add(String(r.due_date ?? "").slice(0, 10));
  }
  out("\n--- census by (category | tranche | source_type) ---");
  for (const [key, c] of [...census.entries()].sort()) {
    out(`${key.padEnd(40)} n=${String(c.n).padStart(5)}  Σdue=${dzd(c.due).padStart(14)}  Σpaid=${dzd(c.paid).padStart(14)}`);
    out(`    labels: ${[...c.labels].slice(0, 3).join(" / ")}`);
    out(`    dues:   ${[...c.dues].slice(0, 4).join(", ")}`);
  }

  // 2. Tuition T4 population
  const t4 = rows.filter((r) => r.category === "tuition" && r.tranche_number === 4);
  out(`\ntuition T4 rows (to be eliminated): ${t4.length}  Σdue=${dzd(t4.reduce((s, r) => s + Number(r.amount_due ?? 0), 0))}`);

  // 3. Students with tuition rows / with T1
  const students = new Set(rows.filter((r) => r.category === "tuition").map((r) => r.student_id));
  out(`students with tuition rows: ${students.size}`);

  // 4. Purge safety: payments referencing installments + allocations
  const payLinks = await readAll("payments", "id, installment_id");
  out(`\npayments total: ${payLinks.length}; with installment_id: ${payLinks.filter((p) => p.installment_id).length}`);
  let allocCount = 0;
  try {
    const allocs = await readAll("payment_allocations", "id, installment_id");
    allocCount = allocs.filter((a) => a.installment_id).length;
  } catch { /* table may not exist */ }
  out(`payment_allocations referencing installments: ${allocCount}`);

  out("\n=== probe complete (no writes performed) ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
