/**
 * t-421-preflight-probe.mjs — timed probes of the three preflight queries
 * (the exact wire forms listImportLedgerSourceKeys / listImportPaymentNumbers /
 * listImportInstallmentIdentities issue), to determine whether the statement
 * timeouts during the 01:12 verification run were transient DB load (the
 * 01:00 scheduled backup) or a persistent condition.
 *
 * Read-only. Usage: node scripts/t-421-preflight-probe.mjs
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

async function main() {
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  if (!signIn?.session) { console.error("sign-in failed"); process.exit(1); }

  const probes = [
    ["ledger source keys p1", async () => {
      const { data, error } = await client
        .from("ledger_entries")
        .select("source_type, source_id")
        .eq("tenant_id", TENANT_ID)
        .eq("source_type", "bulk_import")
        .order("source_id", { ascending: true })
        .range(0, 999);
      return error ? `ERR ${error.message}` : `${(data ?? []).length} rows`;
    }],
    ["payment numbers p1", async () => {
      const { data, error } = await client
        .from("payments")
        .select("payment_number")
        .eq("tenant_id", TENANT_ID)
        .like("payment_number", "IMP-%")
        .order("payment_number", { ascending: true })
        .range(0, 999);
      return error ? `ERR ${error.message}` : `${(data ?? []).length} rows`;
    }],
    ["installment identities p1", async () => {
      const { data, error } = await client
        .from("installments")
        .select("parent_id, student_id, category, tranche_number")
        .eq("tenant_id", TENANT_ID)
        .eq("source_type", "bulk_import")
        .order("source_id", { ascending: true })
        .range(0, 999);
      return error ? `ERR ${error.message}` : `${(data ?? []).length} rows`;
    }],
    ["installments plain count", async () => {
      const { count, error } = await client
        .from("installments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", TENANT_ID);
      return error ? `ERR ${error.message}` : `count=${count}`;
    }],
    ["ledger plain count", async () => {
      const { count, error } = await client
        .from("ledger_entries")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", TENANT_ID);
      return error ? `ERR ${error.message}` : `count=${count}`;
    }],
  ];

  for (let round = 1; round <= 2; round++) {
    console.log(`── probe round ${round} (${new Date().toISOString()}) ──`);
    for (const [label, fn] of probes) {
      const t0 = Date.now();
      const out = await fn();
      console.log(`  ${label.padEnd(28)} ${String(out).padEnd(20)} ${Date.now() - t0}ms`);
    }
  }
  await client.auth.signOut();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
