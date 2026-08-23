
/**
 * Full-Stack Integration Test - Sync Round-Trip (Android <-> Supabase <-> Desktop).
 *
 * Exercises the REAL execution path end-to-end against a live PostgreSQL
 * running the full migration chain (0001-0037):
 *
 *   1. Android-style push: upsert_parent/student/installment/ledger_entry/
 *      payment_from_import RPCs called with MOBILE-LOCAL string refs
 *      (`PAR-${year}-A1B2C3`, "ins-local-1", "led-local-1") - the ref-tolerant
 *      resolvers from migration 0037 must map them onto server UUIDs.
 *   2. Server-side state: canonical invariants verified directly in SQL.
 *   3. Desktop-style pull: pull_ledger_entries_for_sync must rewrite
 *      reverses_id into the SERVER UUID space so reversal pairing survives
 *      the round-trip.
 *
 * Run:  npx tsx financial-tests/equivalence/integration/sync_round_trip.ts
 */
import { Client } from "pg";
import { execSync } from "node:child_process";

const DB = process.env.EQ_DB ?? "elimtiyaz_integration";
const HOST = process.env.EQ_HOST ?? "/tmp";
const PORT = Number(process.env.EQ_PORT ?? 5433);
const USER = process.env.EQ_USER ?? "postgres";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed += 1;
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail !== undefined ? ` - ${JSON.stringify(detail)}` : ""}`);
  }
}

async function main() {
  console.log("-- Provisioning fresh database with migrations 0001-0037 --");
  execSync(
    `node /home/z/my-project/scripts/apply_migrations.js ` +
    `/home/z/my-project/repos/AgentGithubUplaod/elimtiyaz-desktop/supabase/migrations ${DB}`,
    { stdio: "pipe", env: { ...process.env, NODE_PATH: "/home/z/my-project/tools/pgclient/node_modules" } },
  );

  const client = new Client({ host: HOST, port: PORT, user: USER, database: DB });
  await client.connect();

  const tenant = await client.query<{ id: string }>(
    `INSERT INTO public.tenants (name, slug, country, default_locale, default_currency, timezone, is_active)
     VALUES ('Integration Test', 'int-test', 'DZ', 'fr', 'DZD', 'Africa/Algiers', true) RETURNING id`,
  );
  const tenantId = tenant.rows[0].id;
  const year = new Date().getFullYear();

  console.log("-- 1. Android-style push (local refs, centimes-to-DZD at the boundary) --");

  const parentPush = await client.query(
    `SELECT * FROM public.upsert_parent_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
       NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
       'fr'::text, true, 'ville_boumerdes'::text, 'inner'::text, $7::text)`,
    [tenantId, `PAR-${year}-A1B2C3`, "Karim", "Benali", "Famille Benali",
      "+213555123456", "849201"],
  );
  const parentId = parentPush.rows[0].out_parent_id as string;
  check("parent upsert with local-code identity -> server UUID", Boolean(parentId));
  check("parent upsert is insert on first push", parentPush.rows[0].out_was_inserted === true);

  const parentPush2 = await client.query(
    `SELECT * FROM public.upsert_parent_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
       NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
       'fr'::text, true, 'ville_boumerdes'::text, 'inner'::text, $7::text)`,
    [tenantId, `PAR-${year}-A1B2C3`, "Karim", "Benali", "Famille Benali",
      "+213555123456", "849201"],
  );
  check("re-push matches the same parent (idempotency)", parentPush2.rows[0].out_parent_id === parentId);
  check("re-push reports was_inserted=false", parentPush2.rows[0].out_was_inserted === false);

  const act = await client.query(
    `SELECT code, parent_id FROM public.activation_codes WHERE tenant_id = $1 AND code = '849201'`,
    [tenantId],
  );
  check("activation_codes row created from p_activation_code", act.rowCount === 1 && act.rows[0].parent_id === parentId);

  const studentPush = await client.query(
    `SELECT * FROM public.upsert_student_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
       NULL::text, NULL::date, 'M'::text, NULL::uuid, NULL::uuid, NULL::date,
       'active'::text, NULL::text, true,
       '4ap'::text, 'inner'::text, 'tranches'::text)`,
    [tenantId, `ELV-${year}-D4E5F6`, `PAR-${year}-A1B2C3`, "Yacine", "Benali", "Yacine Benali"],
  );
  const studentId = studentPush.rows[0].out_student_id as string;
  check("student upsert resolves the parent LOCAL ref", Boolean(studentId));
  const studentRow = await client.query<{ parent_id: string; grade_level_code: string; payment_plan: string }>(
    `SELECT parent_id, grade_level_code, payment_plan FROM public.students WHERE id = $1`,
    [studentId],
  );
  check("student linked to the resolved parent UUID", studentRow.rows[0].parent_id === parentId);
  check("student preserves 0028 fields (grade_level_code / payment_plan)",
    studentRow.rows[0].grade_level_code === "4ap" && studentRow.rows[0].payment_plan === "tranches");

  let suspendedOk = false;
  try {
    await client.query(
      `SELECT * FROM public.upsert_student_from_import(
         $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
         NULL::text, NULL::date, 'M'::text, NULL::uuid, NULL::uuid, NULL::date,
         'suspended'::text, NULL::text, true,
         '4ap'::text, 'inner'::text, 'tranches'::text)`,
      [tenantId, `ELV-${year}-D4E5F6`, `PAR-${year}-A1B2C3`, "Yacine", "Benali", "Yacine Benali"],
    );
    suspendedOk = true;
  } catch {
    suspendedOk = false;
  }
  check("enrollment_status 'suspended' accepted (0037 CHECK fix)", suspendedOk);

  const insPush = await client.query(
    `SELECT * FROM public.upsert_installment_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
       $7::numeric, $8::numeric, $9::numeric, $10::date, $11::date,
       $12::text, $13::text, $14::text)`,
    [tenantId, `PAR-${year}-A1B2C3`, "ins-local-1", `ELV-${year}-D4E5F6`, "tuition", "Tranche 1",
      39400, 0, 0, `${year}-09-15`, null, "unpaid", null, null],
  );
  const installmentId = insPush.rows[0].installment_id as string;
  check("installment upsert with local refs", Boolean(installmentId));
  const insPush2 = await client.query(
    `SELECT * FROM public.upsert_installment_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
       $7::numeric, $8::numeric, $9::numeric, $10::date, $11::date,
       $12::text, $13::text, $14::text)`,
    [tenantId, `PAR-${year}-A1B2C3`, "ins-local-1", `ELV-${year}-D4E5F6`, "tuition", "Tranche 1",
      39400, 1000, 0, `${year}-09-15`, null, "partial", null, null],
  );
  check("installment re-push is idempotent (same row)", insPush2.rows[0].installment_id === installmentId);
  const insRow = await client.query<{ amount_paid: string; status: string }>(
    `SELECT amount_paid, status FROM public.installments WHERE id = $1`, [installmentId],
  );
  check("installment update persisted (amount_paid 1000 DZD, partial)",
    Number(insRow.rows[0].amount_paid) === 1000 && insRow.rows[0].status === "partial");

  await client.query(
    `SELECT * FROM public.upsert_ledger_entry_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::numeric,
       $8::text, $9::text, $10::text, $11::text,
       NULL::text, NULL::text, NULL::text, NULL::text,
       $12::text, $13::text, $14::timestamptz, $15::jsonb)`,
    [tenantId, "led-local-1", `PAR-${year}-A1B2C3`, null,
      `parent:${parentId}:category:tuition`, "charge", 3940000, "tuition",
      "Scolarite T1", "installment", "reg-1", "u1", "Alice",
      `${year}-09-15T00:00:00Z`, "{}"],
  );
  const paymentPush = await client.query(
    `SELECT * FROM public.upsert_payment_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::uuid, $6::text,
       $7::numeric, $8::text, $9::text, $10::text,
       NULL::text, NULL::text, NULL::date, NULL::date, NULL::text, NULL::text,
       NULL::text, NULL::timestamptz, NULL::uuid, NULL::text, NULL::uuid)`,
    [tenantId, "REC-2026-000042", `PAR-${year}-A1B2C3`, null, null, null,
      1500000, "cash", "tuition", "paid"],
  );
  const paymentId = paymentPush.rows[0].payment_id as string;
  check("payment upsert with local parent ref", Boolean(paymentId));

  await client.query(
    `SELECT * FROM public.upsert_ledger_entry_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::numeric,
       $8::text, $9::text, $10::text, $11::text,
       NULL::text, NULL::text, NULL::text, NULL::text,
       $12::text, $13::text, $14::timestamptz, $15::jsonb)`,
    [tenantId, "led-local-credit", `PAR-${year}-A1B2C3`, null,
      `parent:${parentId}:category:parent_credit`, "adjustment", -100000, "parent_credit",
      "Credit parent (trop-percu)", "adjustment", "adj-1", "u1", "Alice",
      `${year}-10-01T00:00:00Z`, "{}"],
  );

  console.log("-- 2. Server-side canonical state (compute_parent_summary) --");
  const summary = await client.query<{
    total_outstanding: string; total_unallocated_credit: string; account_count: number;
  }>(
    `SELECT * FROM public.compute_parent_summary($1, now())`, [parentId],
  );
  const s = summary.rows[0];
  // NOTE: SQL amounts are DZD. At this point the ledger holds: charge
  // 3,940,000 + parent_credit adjustment -100,000 (the payments-TABLE row
  // from upsert_payment_from_import creates no ledger entry; the payment
  // LEDGER entries are pushed in section 3 below).
  check("total_outstanding = 3 940 000 - 100 000 = 3 840 000 DZD",
    Number(s.total_outstanding) === 3840000, s.total_outstanding);
  check("total_unallocated_credit = -100 000 DZD (parent_credit recognized)",
    Number(s.total_unallocated_credit) === -100000, s.total_unallocated_credit);
  check("account_count = 2 (tuition + parent_credit)", s.account_count === 2, s.account_count);

  console.log("-- 3. Desktop-style pull (reversal linkage + full state) --");

  await client.query(
    `SELECT * FROM public.upsert_ledger_entry_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::numeric,
       $8::text, $9::text, $10::text, $11::text, $12::text, $13::text, $14::text,
       NULL::text, $15::text, $16::text, $17::timestamptz, $18::jsonb)`,
    [tenantId, "led-local-pay", `PAR-${year}-A1B2C3`, null,
      `parent:${parentId}:category:tuition`, "payment", -500000, "tuition",
      "Encaissement", "payment", "pay-local-1", "cash", "REC-1",
      "paid", "u1", "Alice", `${year}-10-02T00:00:00Z`, "{}"],
  );
  await client.query(
    `SELECT * FROM public.upsert_ledger_entry_from_import(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::numeric,
       $8::text, $9::text, $10::text, $11::text,
       NULL::text, NULL::text, NULL::text,
       $12::text, $13::text, $14::text, $15::timestamptz, $16::jsonb)`,
    [tenantId, "led-local-rev", `PAR-${year}-A1B2C3`, null,
      `parent:${parentId}:category:tuition`, "reversal", 500000, "tuition",
      "Remboursement", "payment", "pay-local-1",
      "led-local-pay", "u1", "Alice", `${year}-10-03T00:00:00Z`, "{}"],
  );

  const pulled = await client.query<{ json: unknown }>(
    `SELECT public.pull_ledger_entries_for_sync($1) AS json`, [tenantId],
  );
  const entries = (pulled.rows[0].json as unknown as Array<{
    id: string; entry_number: string; reverses_id: string | null; entry_type: string; amount: string;
  }>);
  const reversal = entries.find((e) => e.entry_number === "led-local-rev");
  const original = entries.find((e) => e.entry_number === "led-local-pay");
  check("pull returns the reversal entry", Boolean(reversal));
  check("pull returns the original payment entry", Boolean(original));
  check("reverses_id REWRITTEN to the original server UUID (0037 fix)",
    Boolean(original && reversal && reversal.reverses_id === original.id),
    { reverses_id: reversal?.reverses_id, original_id: original?.id });
  check("reversal did NOT overwrite the original (separate rows)",
    entries.filter((e) => e.entry_type === "payment" || e.entry_type === "reversal").length === 2);

  const bal = await client.query<{ total_paid: string }>(
    `SELECT total_paid FROM public.compute_account_balance($1, now())`,
    [`parent:${parentId}:category:tuition`],
  );
  // The only payment ledger entries are the -500,000 payment and its
  // +500,000 reversal -> the reversed original is excluded from typed totals
  // and the reversal itself is not a payment -> total_paid = 0.
  check("reversed payment excluded from total_paid (NOT EXISTS fix)",
    Number(bal.rows[0].total_paid) === 0, bal.rows[0].total_paid);

  await client.end();

  console.log();
  console.log(`Integration result: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
