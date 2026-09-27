/**
 * t-421-wire-semantics.mjs — RESIDUE-FREE live experiment: what does
 * `.upsert(rows, { ignoreDuplicates: true })` (the EXACT wire form the
 * import's bulkAppend / bulkCollect / bulkImportInstallments use) actually
 * arbitrate on PostgREST?
 *
 * Background (the 23:00–23:06 failure): re-import flush died with
 *   ledger chunk @2000  → ledger_entries_source_uidx (PARTIAL unique idx)
 *   payments 1501–2000  → payments_tenant_id_payment_number_key (plain uq)
 *   installments        → 409 in the browser console (silently dropped Err)
 *
 * Hypotheses:
 *   H1 (PK-targeted arbiter): PostgREST emits `ON CONFLICT (id) DO NOTHING`
 *       when no on_conflict param is given → NON-PK unique violations raise.
 *   H2 (targetless): `ON CONFLICT DO NOTHING` → all cross-row conflicts
 *       suppressed, but WITHIN-statement duplicates still raise.
 *
 * Experiment design (zero-residue by construction):
 *   T1 cross-run, single row: upsert ONE ledger row whose (tenant, source_type,
 *      source_id) ALREADY EXISTS (fresh entry_number, probe description).
 *      → 200 + 0 rows returned = suppressed (H2 for cross-run)
 *      → 409 = NOT suppressed (H1) — and nothing is written either way.
 *   T2 within-statement, two rows: upsert TWO rows BOTH conflicting with the
 *      SAME existing identity (fresh entry_numbers).
 *      → 200 + 0 = within-statement dupes suppressed
 *      → 409 = within-statement dupes raise (H2's within-statement gap)
 *   T3 payments cross-run: one row with an EXISTING payment_number.
 *   T4 installments cross-run: one row with an EXISTING identity tuple.
 *
 * No row can ever land: suppressed inserts insert nothing; 409s abort the
 * statement. Existing rows are never modified (resolution=ignore-duplicates
 * never updates).
 *
 * Usage: node scripts/t-421-wire-semantics.mjs
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
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  if (signInErr || !signIn.session) {
    console.error(`FATAL: sign-in failed: ${signInErr?.message}`);
    process.exit(1);
  }
  const PROBE = `T421WIRE-${Date.now()}`;

  // ── Pick one existing bulk_import ledger entry as the conflict target ──
  const { data: led } = await client
    .from("ledger_entries")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .eq("source_type", "bulk_import")
    .neq("entry_type", "reversal")
    .limit(1);
  if (!led || led.length === 0) {
    console.error("FATAL: no bulk_import ledger entry found to conflict with");
    process.exit(1);
  }
  const L = led[0];
  console.log(`conflict target (ledger): source_id=${L.source_id} entry_type=${L.entry_type}\n`);

  const probeLedgerRow = (n) => ({
    tenant_id: L.tenant_id,
    entry_number: `${PROBE}-${n}`,
    parent_id: L.parent_id,
    student_id: L.student_id,
    account_id: L.account_id,
    entry_type: L.entry_type,
    amount: L.amount,
    category: L.category,
    description: `${PROBE} probe ${n} (no-op if suppressed)`,
    entry_date: L.entry_date,
    source_type: L.source_type,
    source_id: L.source_id, // ← the EXISTING identity
    method: L.method,
    receipt_number: L.receipt_number,
    payment_status: L.payment_status,
    reverses_id: null,
    actor_id: L.actor_id,
    actor_name: L.actor_name,
    at: L.at,
    metadata: { probe: PROBE },
  });

  // T1 — cross-run single-row conflict
  {
    const { data, error } = await client
      .from("ledger_entries")
      .upsert([probeLedgerRow(1)], { ignoreDuplicates: true })
      .select();
    console.log(`T1 ledger cross-run (1 row, existing source identity):`);
    console.log(`   → ${error ? `HTTP-ERR ${error.code ?? ""} ${error.message}` : `OK, ${data?.length ?? 0} row(s) returned`}`);
  }

  // T2 — within-statement duplicate (both rows conflict with the SAME existing identity)
  {
    const { data, error } = await client
      .from("ledger_entries")
      .upsert([probeLedgerRow(2), probeLedgerRow(3)], { ignoreDuplicates: true })
      .select();
    console.log(`T2 ledger within-statement (2 rows, same source identity):`);
    console.log(`   → ${error ? `HTTP-ERR ${error.code ?? ""} ${error.message}` : `OK, ${data?.length ?? 0} row(s) returned`}`);
  }
  console.log();

  // T3 — payments cross-run
  {
    const { data: pay } = await client
      .from("payments")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .like("payment_number", "IMP-%")
      .limit(1);
    if (pay && pay.length > 0) {
      const P = pay[0];
      const row = {
        tenant_id: P.tenant_id,
        payment_number: P.payment_number, // ← the EXISTING identity
        receipt_number: P.receipt_number,
        parent_id: P.parent_id,
        student_id: P.student_id,
        amount: P.amount,
        method: P.method,
        category: P.category,
        status: P.status,
        proof_path: null,
        collected_at: P.collected_at,
        collected_by: P.collected_by,
        notes: `${PROBE} probe (no-op if suppressed)`,
        expected_amount: P.expected_amount ?? 0,
        excess_amount: P.excess_amount ?? 0,
        excess_remark: null,
      };
      const { data, error } = await client
        .from("payments")
        .upsert([row], { ignoreDuplicates: true })
        .select("id");
      console.log(`T3 payments cross-run (1 row, existing payment_number ${P.payment_number}):`);
      console.log(`   → ${error ? `HTTP-ERR ${error.code ?? ""} ${error.message}` : `OK, ${data?.length ?? 0} row(s) returned`}`);
    } else {
      console.log(`T3 payments: no IMP- payment found to conflict with (skipped)`);
    }
  }

  // T4 — installments cross-run
  {
    const { data: inst } = await client
      .from("installments")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .eq("source_type", "bulk_import")
      .limit(1);
    if (inst && inst.length > 0) {
      const I = inst[0];
      const row = {
        tenant_id: I.tenant_id,
        parent_id: I.parent_id,     // ← existing identity tuple
        student_id: I.student_id,
        category: I.category,
        tranche_number: I.tranche_number,
        label: `${PROBE} probe (no-op if suppressed)`,
        amount_due: I.amount_due,
        amount_paid: I.amount_paid,
        due_date: I.due_date,
        paid_date: I.paid_date,
        status: I.status,
        academic_cycle: I.academic_cycle,
        payment_plan: I.payment_plan,
        is_custom_schedule: I.is_custom_schedule ?? false,
        custom_schedule_note: null,
        source_type: "bulk_import",
        source_id: I.source_id,
      };
      const { data, error } = await client
        .from("installments")
        .upsert([row], { ignoreDuplicates: true })
        .select("id");
      console.log(`T4 installments cross-run (1 row, existing identity ${I.source_id}):`);
      console.log(`   → ${error ? `HTTP-ERR ${error.code ?? ""} ${error.message}` : `OK, ${data?.length ?? 0} row(s) returned`}`);
    } else {
      console.log(`T4 installments: no bulk_import installment found (skipped)`);
    }
  }

  // T5 — control: does specifying on_conflict change anything? (PK columns)
  {
    const { data, error } = await client
      .from("ledger_entries")
      .upsert([probeLedgerRow(5)], { ignoreDuplicates: true, onConflict: "tenant_id,source_type,source_id" })
      .select();
    console.log(`\nT5 ledger cross-run WITH onConflict=tenant_id,source_type,source_id:`);
    console.log(`   → ${error ? `HTTP-ERR ${error.code ?? ""} ${error.message}` : `OK, ${data?.length ?? 0} row(s) returned`}`);
  }

  // Verification: no probe residue, and the target row is unmodified.
  {
    const { count } = await client
      .from("ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID)
      .like("entry_number", `${PROBE}%`);
    const { data: orig } = await client
      .from("ledger_entries")
      .select("description")
      .eq("id", L.id)
      .maybeSingle();
    console.log(`\nresidue check: probe rows landed = ${count ?? 0} (expect 0); target row description unchanged = ${orig?.description === L.description}`);
  }

  await client.auth.signOut();
  console.log("\nwire-semantics experiment complete (residue-free).");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
