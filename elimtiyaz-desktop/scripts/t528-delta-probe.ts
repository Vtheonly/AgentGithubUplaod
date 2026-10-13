/**
 * t528-delta-probe.ts — names the ONE data-driven confirmed_mismatch finding
 * beyond the 2,198 pay-no-ledger class on the post-fix live run (the new
 * account registered TODAY at 12:40 added a 5,000 DZD payment + a fee charge
 * + installments to the corpus between the T-511 and T-528 censuses).
 * Read-only, SELECT-only, env-token. Usage:
 *   SUPABASE_ACCESS_TOKEN=<token> npx tsx scripts/t528-delta-probe.ts
 */
import * as process from "node:process";

const PROJECT_REF = "vebfehrpzajhstyhinnw";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN not exported (the §15.14 env-only convention)");
  process.exit(1);
}

async function sql(query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as Record<string, unknown>[];
}

function show(title: string, rows: Record<string, unknown>[]): void {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const r of rows) console.log(JSON.stringify(r));
}

async function main(): Promise<void> {
  // The new family's payment(s) and their ledger twins
  show(
    "the new account's payments + ledger twins",
    await sql(`
      SELECT p.id, p.amount, p.method, p.status, p.collected_at::date AS day,
             p.receipt_number, p.student_id IS NOT NULL AS has_student,
             (SELECT count(*) FROM ledger_entries le
               WHERE le.entry_type='payment' AND le.source_type='payment'
                 AND le.source_id = p.id::text)::int AS ledger_twins
        FROM payments p
       WHERE p.parent_id = 'e3506a7c-8bb9-4d5d-b668-3477a90de1d9'`),
  );
  // The new family's full ledger set (types + sources)
  show(
    "the new account's ledger entries by type/source",
    await sql(`
      SELECT entry_type, source_type, count(*)::int AS n,
             sum(amount)::bigint AS total
        FROM ledger_entries
       WHERE parent_id = 'e3506a7c-8bb9-4d5d-b668-3477a90de1d9'
       GROUP BY 1, 2 ORDER BY 1, 2`),
  );
  // The debt summary vs the ledger replay for the new parent
  show(
    "the new account's debt summary vs ledger replay",
    await sql(`
      SELECT (SELECT outstanding_amount FROM parent_debt_summaries
               WHERE parent_id = 'e3506a7c-8bb9-4d5d-b668-3477a90de1d9') AS server_outstanding,
             (SELECT sum(amount) FROM ledger_entries
               WHERE parent_id = 'e3506a7c-8bb9-4d5d-b668-3477a90de1d9') AS ledger_sum`),
  );
  // Payments with >1 ledger twin (the pay-multi-ledger class) — corpus-wide
  show(
    "payments with >1 ledger twin (corpus-wide)",
    await sql(`
      SELECT p.id, p.amount, p.receipt_number,
             (SELECT count(*) FROM ledger_entries le
               WHERE le.entry_type='payment' AND le.source_type='payment'
                 AND le.source_id = p.id::text)::int AS twins
        FROM payments p
       WHERE (SELECT count(*) FROM ledger_entries le
               WHERE le.entry_type='payment' AND le.source_type='payment'
                 AND le.source_id = p.id::text) > 1
       LIMIT 5`),
  );
  // Orphan ledger payment entries (the orphan-ledger class) — corpus-wide
  show(
    "orphan ledger payment entries (corpus-wide)",
    await sql(`
      SELECT count(*)::int AS orphan_ledger_entries
        FROM ledger_entries le
       WHERE le.entry_type='payment' AND le.source_type='payment'
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id::text = le.source_id)`),
  );
  console.log("\nDONE — read-only.");
}

main().catch((e) => {
  console.error("PROBE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
