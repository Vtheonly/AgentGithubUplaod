// T-368 — cross-check the live workbook's Résumé against direct SQL aggregates.
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const supa = createClient("https://hkvkefubghbbotgnteir.supabase.co", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTAwNDY4NCwiZXhwIjoyMTAwNTgwNjg0fQ.1CeNAMFfrIw4GQsTr3COLC5TO_uYtN1-oOmCrx1OuzM", { auth: { persistSession: false } });

// SQL ground truth (signed convention: payments negative)
const { data: agg } = await supa.rpc("to_jsonb", {}).single().then(() => ({ data: null })).catch(() => ({ data: null }));
void agg;
const sql = await (async () => {
  // Paginate past the PostgREST 1000-row cap (the same rule the e2e script applies).
  const rows: { entry_type: string; amount: number }[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data } = await supa.from("ledger_entries").select("entry_type, amount").range(from, from + 999);
    const page = (data ?? []) as { entry_type: string; amount: number }[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const charged = rows.filter((r) => r.entry_type === "charge").reduce((s, r) => s + Number(r.amount), 0);
  const paidAbs = rows.filter((r) => r.entry_type === "payment").reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
  const refundAbs = rows.filter((r) => r.entry_type === "refund").reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
  const adjusted = rows.filter((r) => r.entry_type === "adjustment").reduce((s, r) => s + Number(r.amount), 0);
  const balance = rows.reduce((s, r) => s + Number(r.amount), 0);
  return { charged, paidAbs, refundAbs, adjusted, balance, count: rows.length };
})();

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("/home/z/my-project/download/t368-live-export-complet.xlsx");
const ws = wb.worksheets.find((w) => w.name === "Résumé")!;
const cell = (metric: string): number | string => {
  for (let r = 1; r <= ws.rowCount; r++) {
    if (ws.getCell(r, 1).value === metric) return ws.getCell(r, 2).value as number | string;
  }
  return "(absent)";
};

console.log("metric                      workbook        SQL-truth       match");
const checks: Array<[string, number | string, number | string]> = [
  ["Total facturé (charges)", cell("Total facturé (charges)"), sql.charged],
  ["Total encaissé", cell("Total encaissé (paiements journal)"), sql.paidAbs],
  ["Total remboursements", cell("Total remboursements"), sql.refundAbs],
  ["Total ajustements (signé)", cell("Total ajustements (remises/majorations, signé)"), sql.adjusted],
  ["Solde global (signé)", cell("Solde global en attente (journal)"), sql.balance],
  ["Entrées du journal", cell("Entrées de journal"), sql.count],
];
let allOk = true;
for (const [name, wbv, sqlv] of checks) {
  const ok = Number(wbv) === Number(sqlv);
  if (!ok) allOk = false;
  console.log(`${name.padEnd(28)} ${String(wbv).padStart(14)} ${String(sqlv).padStart(15)}   ${ok ? "OK" : "MISMATCH"}`);
}
console.log(allOk ? "ALL SUMMARY TOTALS RECONCILE with the live DB" : "!!! MISMATCHES FOUND");
process.exit(allOk ? 0 : 1);
