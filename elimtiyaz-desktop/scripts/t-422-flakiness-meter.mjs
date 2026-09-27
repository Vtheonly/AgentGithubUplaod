/**
 * t-422-flakiness-meter.mjs — READ-ONLY: measure the live read reliability
 * for the three finance paths, 5 rounds each:
 *   A. payments paginated seed (the repo's exact loop — 1000/page by collected_at desc)
 *   B. installments single read (select * order by due_date)
 *   C. compute_debt_aging_summary RPC (the Dettes tab path)
 * Records: rows, latency, error code. No writes.
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PW });
  if (signInErr) {
    console.error("FATAL sign-in:", signInErr.message);
    process.exit(1);
  }

  const rounds = 5;
  console.log(`A. PAYMENTS paginated seed (repo loop), ${rounds} rounds:`);
  for (let i = 1; i <= rounds; i++) {
    const t0 = Date.now();
    let rows = 0;
    let failure = null;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .from("payments")
        .select("*")
        .eq("tenant_id", TENANT_ID)
        .order("collected_at", { ascending: false })
        .range(from, from + 999);
      if (error) {
        failure = `${error.code ?? "?"} ${error.message}`;
        break;
      }
      rows += (data ?? []).length;
      if (!data || data.length < 1000) break;
    }
    const ms = Date.now() - t0;
    console.log(`   round ${i}: ${failure ? `FAIL after ${rows} rows → ${failure}` : `OK rows=${rows}`} (${(ms / 1000).toFixed(1)}s)`);
  }

  console.log(`\nB. INSTALLMENTS single read (repo query), ${rounds} rounds:`);
  for (let i = 1; i <= rounds; i++) {
    const t0 = Date.now();
    const { data, error } = await client
      .from("installments")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .order("due_date", { ascending: true });
    const ms = Date.now() - t0;
    console.log(`   round ${i}: ${error ? `FAIL ${error.code} ${error.message}` : `OK rows=${data.length}`} (${(ms / 1000).toFixed(1)}s)`);
  }

  console.log(`\nC. compute_debt_aging_summary RPC (Dettes path), ${rounds} rounds:`);
  for (let i = 1; i <= rounds; i++) {
    const t0 = Date.now();
    const { data, error } = await client.rpc("compute_debt_aging_summary");
    const ms = Date.now() - t0;
    console.log(`   round ${i}: ${error ? `FAIL ${error.code} ${error.message}` : `OK rows=${(data ?? []).length}`} (${(ms / 1000).toFixed(1)}s)`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
