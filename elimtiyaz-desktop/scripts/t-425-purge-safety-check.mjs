/**
 * t-425-purge-safety-check.mjs — READ-ONLY: verify the migration-0124 purge
 * targets exactly the Excel-import installments (source_id LIKE 'imp-%').
 * batchRegister ALSO writes source_type='bulk_import' (source_id
 * '{studentCode}:tuition:T{n}') — those wizard-created rows must SURVIVE.
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function main() {
  if (!SERVICE_KEY) { console.error("FATAL: SUPABASE_SERVICE_KEY required"); process.exit(1); }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from("installments")
    .select("id, source_type, source_id, tranche_number, category")
    .eq("tenant_id", TENANT_ID)
    .neq("source_type", "bulk_import");
  if (error) { console.error("read failed:", error.message); process.exit(1); }
  console.log("non-bulk_import installments:", data.length);

  // Count bulk_import rows NOT matching the Excel import's imp- prefix.
  let lastId = "";
  let total = 0, impPrefix = 0, wizardStyle = 0;
  const wizardSamples = [];
  for (;;) {
    let q = db.from("installments")
      .select("id, source_id")
      .eq("tenant_id", TENANT_ID)
      .eq("source_type", "bulk_import")
      .order("id", { ascending: true })
      .limit(1000);
    if (lastId) q = q.gt("id", lastId);
    const { data: page, error: err } = await q;
    if (err) { console.error("page failed:", err.message); process.exit(1); }
    for (const r of page ?? []) {
      total++;
      if ((r.source_id ?? "").startsWith("imp-") || (r.id ?? "").startsWith("imp-")) impPrefix++;
      else { wizardStyle++; if (wizardSamples.length < 5) wizardSamples.push({ id: r.id, source_id: r.source_id }); }
    }
    if ((page ?? []).length < 1000) break;
    lastId = page[page.length - 1].id;
  }
  console.log(`bulk_import total: ${total}  |  Excel-import (imp-): ${impPrefix}  |  wizard-style: ${wizardStyle}`);
  if (wizardSamples.length) console.log("wizard-style samples:", JSON.stringify(wizardSamples, null, 2));
  console.log("PURGE TARGET (imp- rows):", impPrefix, "— these are the derived Excel-import rows the migration clears.");
}
main().catch((e) => { console.error(e); process.exit(1); });
