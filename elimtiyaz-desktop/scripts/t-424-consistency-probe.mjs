/**
 * t-424-consistency-probe.mjs — READ-ONLY probe of the Statistics-vs-Finance
 * data-consistency question (the owner's report: "Tranche 1 shows not paid in
 * Statistics while the payments show as paid in Finance").
 *
 * Zero writes. Measures, via the service-role REST client:
 *   1. The installments census: rows, by status, by (category, tranche_number).
 *   2. THE CONSISTENCY CENSUS — rows where the `status` column DISAGREES with
 *      the amounts (the INV-4 family):
 *        (a) status <> 'paid' AND amount_paid >= amount_due AND amount_due > 0
 *            (amounts say paid; status says not)
 *        (b) status = 'paid' AND amount_paid < amount_due
 *            (status says paid; amounts say not)
 *        (c) status IS NULL or tranche_number IS NULL
 *   3. Per-wave aggregates BOTH derivations would show:
 *        Statistics wave: paidCount (status='paid') / installmentCount; clearedPct
 *        Finance wave:    pct = Σ paid / Σ due
 *      → side-by-side per (category, tranche_number) — the exact two numbers
 *        the two surfaces render for the same rows.
 *   4. Duplicate installment identities (parent, student, category,
 *      tranche_number) > 1 row — the double-count hypothesis.
 *   5. Payments census: count, Σ amount, status distribution.
 *   6. payment_allocations census: count, Σ allocated.
 *   7. The T-423 acceptance baseline re-check (installments 5,963 etc.) —
 *      is the DB still at the verified state?
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // env — never inline (§15.59d)

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

  // Keyset pagination (§15.63c — the server caps EVERY response at 1,000 rows)
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

  // ---- 1. installments census -------------------------------------------------
  const rows = await readAll("installments",
    "id,parent_id,student_id,category,tranche_number,amount_due,amount_paid,amount_pending,status,due_date,paid_date,label");
  out(`\n== 1. INSTALLMENTS CENSUS ==`);
  out(`total rows: ${rows.length} (T-423 baseline: 5,963)`);
  const alive = rows; // installments carries no deleted_at (0007 schema)
  out(`rows: ${alive.length}`);

  const byStatus = {};
  for (const r of alive) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  out(`by status: ${JSON.stringify(byStatus)}`);

  // ---- 2. THE CONSISTENCY CENSUS ----------------------------------------------
  out(`\n== 2. STATUS-vs-AMOUNTS CONSISTENCY CENSUS (alive rows) ==`);
  const disagreeA = alive.filter(
    (r) => r.status !== "paid" && Number(r.amount_due) > 0 && Number(r.amount_paid) >= Number(r.amount_due),
  );
  const disagreeB = alive.filter(
    (r) => r.status === "paid" && Number(r.amount_paid) < Number(r.amount_due),
  );
  const nullStatus = alive.filter((r) => r.status == null);
  const nullTranche = alive.filter((r) => r.tranche_number == null);
  const negPaid = alive.filter((r) => Number(r.amount_paid) < 0);
  const overpaid = alive.filter((r) => Number(r.amount_paid) > Number(r.amount_due));
  out(`(a) amounts say PAID but status <> 'paid': ${disagreeA.length}`);
  for (const r of disagreeA.slice(0, 12)) {
    out(`    ${r.category} T${r.tranche_number} due=${r.amount_due} paid=${r.amount_paid} pend=${r.amount_pending} status=${r.status} dueDate=${r.due_date}`);
  }
  out(`(b) status='paid' but amount_paid < amount_due: ${disagreeB.length}`);
  for (const r of disagreeB.slice(0, 12)) {
    out(`    ${r.category} T${r.tranche_number} due=${r.amount_due} paid=${r.amount_paid} status=${r.status}`);
  }
  out(`(c) null status: ${nullStatus.length}; null tranche_number: ${nullTranche.length}`);
  out(`(d) negative amount_paid: ${negPaid.length}; overpaid (paid > due): ${overpaid.length}`);

  // ---- 3. per-wave aggregates: BOTH derivations side by side -------------------
  out(`\n== 3. PER-WAVE AGGREGATES — Statistics (status-count) vs Finance (amount-ratio) ==`);
  const waves = new Map();
  for (const r of alive) {
    const key = `${r.category ?? "?"}|T${r.tranche_number ?? "NULL"}`;
    let w = waves.get(key);
    if (!w) { w = { n: 0, paidCount: 0, due: 0, paid: 0, pend: 0, remain: 0 }; waves.set(key, w); }
    w.n += 1;
    w.due += Number(r.amount_due);
    w.paid += Number(r.amount_paid);
    w.pend += Number(r.amount_pending ?? 0);
    if (r.status === "paid") w.paidCount += 1;
    const rem = Math.max(0, Number(r.amount_due) - Number(r.amount_paid) - Number(r.amount_pending ?? 0));
    w.remain += rem;
  }
  out(`wave | rows | paidCount(status) | Σdue | Σpaid | Σpend | Σremaining | Stats clearedPct | Finance pct`);
  for (const [key, w] of [...waves.entries()].sort()) {
    const statsPct = w.n > 0 ? Math.round((w.paidCount / w.n) * 100) : 0;
    const finPct = w.due > 0 ? Math.min(100, Math.round((w.paid / w.due) * 100)) : 0;
    out(
      `${key.padEnd(16)} | ${String(w.n).padStart(4)} | ${String(w.paidCount).padStart(4)} | ${dzd(w.due).padStart(12)} | ${dzd(w.paid).padStart(12)} | ${dzd(w.pend).padStart(9)} | ${dzd(w.remain).padStart(12)} | ${String(statsPct).padStart(3)}% | ${String(finPct).padStart(3)}%`,
    );
  }

  // ---- 4. duplicate installment identities -------------------------------------
  out(`\n== 4. DUPLICATE IDENTITY CENSUS ==`);
  const ident = new Map();
  for (const r of alive) {
    const k = `${r.parent_id}|${r.student_id}|${r.category}|${r.tranche_number}`;
    const list = ident.get(k) ?? [];
    list.push(r);
    ident.set(k, list);
  }
  const dups = [...ident.entries()].filter(([, l]) => l.length > 1);
  out(`distinct identities: ${ident.size}; identities with >1 row: ${dups.length}`);
  for (const [k, l] of dups.slice(0, 8)) {
    out(`    ${k.slice(0, 13)}… rows=${l.length} statuses=[${l.map((r) => r.status).join(",")}] due=[${l.map((r) => r.amount_due).join(",")}]`);
  }

  // ---- 5. payments census -------------------------------------------------------
  out(`\n== 5. PAYMENTS CENSUS ==`);
  const payRows = await readAll("payments",
    "id,amount,method,status,category,installment_id,payment_number,collected_at");
  out(`payments rows: ${payRows.length} (T-423 baseline: 2,198)`);
  const byPayStatus = {};
  for (const p of payRows) byPayStatus[p.status] = (byPayStatus[p.status] ?? 0) + 1;
  out(`by status: ${JSON.stringify(byPayStatus)}`);
  const paySum = payRows.reduce((s, p) => s + Number(p.amount), 0);
  out(`Σ amount: ${dzd(paySum)} DZD (acceptance: Encaissé 162,713,000)`);
  const byMethod = {};
  for (const p of payRows) byMethod[p.method] = (byMethod[p.method] ?? 0) + 1;
  out(`by method: ${JSON.stringify(byMethod)}`);
  const linked = payRows.filter((p) => p.installment_id);
  out(`payments with direct installment_id: ${linked.length}`);
  const byCat = {};
  for (const p of payRows) byCat[p.category ?? "NULL"] = (byCat[p.category ?? "NULL"] ?? 0) + 1;
  out(`by category: ${JSON.stringify(byCat)}`);

  // ---- 6. payment_allocations census --------------------------------------------
  out(`\n== 6. PAYMENT_ALLOCATIONS CENSUS ==`);
  const allocRows = await readAll("payment_allocations",
    "id,payment_id,installment_id,allocated_amount");
  const allocSum = allocRows.reduce((s, a) => s + Number(a.allocated_amount), 0);
  out(`allocation rows: ${allocRows.length}; Σ allocated: ${dzd(allocSum)} DZD`);
  const allocByInst = new Map();
  for (const a of allocRows) allocByInst.set(a.installment_id, (allocByInst.get(a.installment_id) ?? 0) + Number(a.allocated_amount));
  let allocExceedsPaid = 0;
  const instById = new Map(alive.map((r) => [r.id, r]));
  for (const [iid, sum] of allocByInst) {
    const r = instById.get(iid);
    if (r && sum > Number(r.amount_paid) + 1) allocExceedsPaid += 1;
  }
  out(`installments whose Σ allocations exceed amount_paid: ${allocExceedsPaid}`);

  // ---- 7. T-423 acceptance baseline re-check -------------------------------------
  out(`\n== 7. T-423 BASELINE RE-CHECK ==`);
  out(`installments ${rows.length} (expect 5,963) — ${rows.length === 5963 ? "MATCH" : "DRIFT!"}`);
  const led = await db.from("ledger_entries").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID);
  out(`ledger_entries ${led.count} (expect 3,342) — ${led.count === 3342 ? "MATCH" : "DRIFT!"}`);
  const totalRemain = alive.reduce(
    (s, r) => s + Math.max(0, Number(r.amount_due) - Number(r.amount_paid) - Number(r.amount_pending ?? 0)), 0);
  out(`Σ INV-4 remaining (alive): ${dzd(totalRemain)} DZD (acceptance Créances: 207,773,800)`);
  const unpaidDue = alive.filter((r) => r.status !== "paid").reduce((s, r) => s + Math.max(0, Number(r.amount_due) - Number(r.amount_paid) - Number(r.amount_pending ?? 0)), 0);
  out(`Σ INV-4 remaining over status<>'paid' rows: ${dzd(unpaidDue)} DZD`);
}

main().catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
