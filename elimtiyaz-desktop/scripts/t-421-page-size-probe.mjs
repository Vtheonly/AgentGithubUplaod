/**
 * t-421-page-size-probe.mjs — how many rows can ONE preflight page carry?
 * (Determines whether the preflight pagination can use 5,000-row pages —
 * 4 queries total — instead of 1,000-row pages — 13 queries total — which
 * matters a lot when the database is under load: the 01:00 scheduled
 * backup had every financial-table query at 4-6 s during the 01:12
 * verification run.)
 *
 * Read-only. Usage: node scripts/t-421-page-size-probe.mjs
 */
import { createClient } from "@supabase/supabase-js";

const client = createClient(
  "https://vebfehrpzajhstyhinnw.supabase.co",
  "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg",
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data: signIn } = await client.auth.signInWithPassword({
  email: "admin@elimtiyaz.dz",
  password: "elimtiyaz@admin2026",
});
if (!signIn?.session) {
  console.error("sign-in failed");
  process.exit(1);
}

for (const [label, hi] of [["range 0-1999", 1999], ["range 0-4999", 4999], ["range 0-9999", 9999]]) {
  const t0 = Date.now();
  const { data, error } = await client
    .from("ledger_entries")
    .select("source_type, source_id")
    .eq("tenant_id", "00000000-0000-0000-0000-000000000001")
    .eq("source_type", "bulk_import")
    .order("source_id", { ascending: true })
    .range(0, hi);
  console.log(`${label}: ${error ? "ERR " + error.message : `${(data ?? []).length} rows`} in ${Date.now() - t0}ms`);
}
