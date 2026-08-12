#!/usr/bin/env node
/**
 * Clean-Slate Reset Script — truncates ALL imported data from Supabase
 * so you can test the Excel import + sync flow from a clean state.
 *
 * Usage:
 *   node scripts/clean-slate-reset.mjs
 *
 * Requires the Supabase URL + anon key to be set in either:
 *   - Environment variables: SUPABASE_URL + SUPABASE_ANON_KEY
 *   - The desktop app's local config (localStorage JSON)
 *
 * What this script does:
 *   1. Connects to Supabase using the anon key.
 *   2. Truncates (or DELETEs) all rows from:
 *      - ledger_entries
 *      - payments
 *      - installments
 *      - students
 *      - parents
 *      - sync_queue
 *      - audit_logs
 *   3. Prints a summary of what was deleted.
 *
 * What it does NOT do:
 *   - Drop tables or migrations (the schema is preserved).
 *   - Delete tenants, users, classes, subjects, pricing config (those are
 *     reference data, not import data).
 *   - Reset the sync queue in IndexedDB (that's client-side; use the
 *     "Clear sync queue" button in Settings → Sync tab).
 *
 * After running this script:
 *   1. The Supabase DB is empty of all imported data.
 *   2. Re-run the Excel import — it should insert fresh records.
 *   3. Re-run the sync — it should be idempotent (no duplicates).
 *   4. Run the sync AGAIN — verify nothing is duplicated.
 */

// Load fetch polyfill if needed (Node 18+ has global fetch).
const fetch = globalThis.fetch;

// Read Supabase config from env vars or local config file.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_ANON_KEY environment variables must be set.");
  console.error("");
  console.error("Example:");
  console.error("  SUPABASE_URL=https://your-project.supabase.co \\");
  console.error("  SUPABASE_ANON_KEY=your-anon-key \\");
  console.error("  node scripts/clean-slate-reset.mjs");
  process.exit(1);
}

// The tenant ID to scope the DELETE operations. If not provided, ALL
// tenants' data is deleted. The default tenant ID used by the desktop
// app is the seed tenant from migration 0023.
const TENANT_ID = process.env.TENANT_ID || "00000000-0000-0000-0000-000000000001";

const TABLES_TO_RESET = [
  "ledger_entries",
  "payments",
  "installments",
  "students",
  "parents",
  "sync_queue",
  "audit_logs",
  "notifications",
  "expenses",
];

async function deleteAllFromTable(tableName) {
  const url = `${SUPABASE_URL}/rest/v1/${tableName}?tenant_id=eq.${TENANT_ID}`;
  const headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
  // First, count the rows.
  const countUrl = `${SUPABASE_URL}/rest/v1/${tableName}?tenant_id=eq.${TENANT_ID}&select=id&limit=1`;
  const countRes = await fetch(countUrl, {
    method: "GET",
    headers: { ...headers, "Prefer": "count=exact" },
  });
  if (!countRes.ok) {
    const text = await countRes.text();
    console.warn(`  ⚠ Could not count ${tableName}: ${countRes.status} ${text}`);
    return { table: tableName, deleted: 0, error: countRes.status };
  }
  const contentRange = countRes.headers.get("content-range");
  const total = contentRange ? parseInt(contentRange.split("/")[1] ?? "0", 10) : 0;

  if (total === 0) {
    console.log(`  ✓ ${tableName}: 0 rows (already empty)`);
    return { table: tableName, deleted: 0 };
  }

  // DELETE all rows for this tenant.
  const delRes = await fetch(url, {
    method: "DELETE",
    headers,
  });
  if (!delRes.ok) {
    const text = await delRes.text();
    console.warn(`  ⚠ Could not delete from ${tableName}: ${delRes.status} ${text}`);
    return { table: tableName, deleted: 0, error: delRes.status };
  }
  console.log(`  ✓ ${tableName}: deleted ${total} row(s)`);
  return { table: tableName, deleted: total };
}

async function main() {
  console.log("================================================================");
  console.log("  CLEAN-SLATE RESET — Supabase Data Wipe");
  console.log("================================================================");
  console.log(`  Supabase URL: ${SUPABASE_URL}`);
  console.log(`  Tenant ID:    ${TENANT_ID}`);
  console.log("");
  console.log("  This will DELETE all imported data (parents, students, payments,");
  console.log("  ledger entries, installments, sync_queue, audit_logs) for the");
  console.log("  specified tenant. The schema is preserved.");
  console.log("");
  console.log("  Tables to reset:");
  for (const t of TABLES_TO_RESET) {
    console.log(`    - ${t}`);
  }
  console.log("");

  const results = [];
  for (const table of TABLES_TO_RESET) {
    const r = await deleteAllFromTable(table);
    results.push(r);
  }

  console.log("");
  console.log("================================================================");
  console.log("  RESET COMPLETE");
  console.log("================================================================");
  let totalDeleted = 0;
  for (const r of results) {
    totalDeleted += r.deleted;
    console.log(`  ${r.table}: ${r.deleted} row(s) deleted${r.error ? ` (error: ${r.error})` : ""}`);
  }
  console.log("");
  console.log(`  TOTAL: ${totalDeleted} row(s) deleted`);
  console.log("");
  console.log("  Next steps:");
  console.log("    1. Open the desktop app.");
  console.log("    2. Go to Settings → Sync → Clear sync queue (clears IndexedDB).");
  console.log("    3. Go to CRM → Inscription groupée → Import Excel.");
  console.log("    4. Select the Suivis clients 2026_2027.xlsx file.");
  console.log("    5. Preview → Commit.");
  console.log("    6. Verify the dashboard shows the imported data.");
  console.log("    7. Re-import the SAME file — verify NO duplicates are created.");
  console.log("    8. Go to Settings → Sync → Sync Now — verify idempotency.");
  console.log("================================================================");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
