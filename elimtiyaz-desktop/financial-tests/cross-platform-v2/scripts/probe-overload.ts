/**
 * Quick probe: verify the collect_and_allocate_payment overload situation
 * on the real migration chain (0001→0039).
 *
 * 0034 creates the canonical 14-arg version.
 * 0039 creates a SECOND 17-arg overload whose body is the buggy 0026 shape.
 * PostgREST resolves by named arguments — desktop sends 17 named args.
 */
import { Client } from "pg";

const db = new Client({
  host: "/tmp", port: 55432, user: "postgres", database: "elimtiyaz_equiv", ssl: false,
});

async function main() {
  await db.connect();

  // 1. Which overloads exist?
  const overloads = await db.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'collect_and_allocate_payment'
    order by p.oid
  `);
  console.log("=== collect_and_allocate_payment overloads ===");
  for (const r of overloads.rows) console.log(`  (${r.args.split(",").length} args)`);

  // 2. Seed: tenant + parent + 2 installments
  const tenant = (await db.query(`insert into tenants (name, slug) values ('Probe Tenant', 'probe-tenant-' || floor(random()*1000000)::text) returning id`)).rows[0].id;
  const parent = (await db.query(
    `insert into parents (tenant_id, parent_code, first_name, last_name, primary_phone)
     values ($1, 'PAR-2025-PROBE', 'Amine', 'Probe', '0550000001') returning id`, [tenant])).rows[0].id;
  const student = (await db.query(
    `insert into students (tenant_id, student_code, parent_id, first_name, last_name, grade_level_code, enrollment_date, date_of_birth, gender)
     values ($1, 'ELV-2025-0001', $2, 'Khaled', 'Probe', '5ap', current_date, '2013-05-10', 'male') returning id`, [tenant, parent])).rows[0].id;
  await db.query(`
    insert into installments (tenant_id, parent_id, student_id, category, tranche_number, label, amount_due, amount_paid, due_date, status)
    values
      ($1, $2, $3, 'tuition', 1, 'T1', 40000, 0, '2025-09-15', 'unpaid'),
      ($1, $2, $3, 'tuition', 2, 'T2', 30000, 0, '2025-12-15', 'unpaid')`,
    [tenant, parent, student]);

  // 3. Call the 17-arg overload (what desktop actually sends — all named args)
  console.log("\n=== 17-arg call (desktop production payload) ===");
  try {
    const r = await db.query(`
      select * from collect_and_allocate_payment(
        p_tenant_id := $1::uuid, p_parent_id := $2::uuid, p_student_id := $3::uuid,
        p_amount := 50000, p_method := 'cash', p_category := 'tuition',
        p_installment_id := null, p_proof_path := null, p_notes := null,
        p_actor_id := null, p_actor_name := 'probe',
        p_check_number := null, p_check_bank_name := null,
        p_check_issue_date := null, p_check_clearance_date := null,
        p_transfer_reference := null, p_transfer_source_bank := null
      )`, [tenant, parent, student]);
    console.log("  SUCCESS:", JSON.stringify(r.rows[0]).slice(0, 200));
  } catch (e) {
    console.log("  FAILED:", (e as Error).message);
  }

  // 4. State after the failed/successful call?
  const pays = await db.query(`select count(*)::int n from payments`);
  const ins = await db.query(`select amount_paid, status from installments order by tranche_number`);
  const led = await db.query(`select count(*)::int n from ledger_entries`);
  console.log(`\n  payments=${pays.rows[0].n}  ledger_entries=${led.rows[0].n}`);
  for (const i of ins.rows) console.log(`  installment: paid=${i.amount_paid} status=${i.status}`);

  // 5. Call the 14-arg canonical version
  console.log("\n=== 14-arg call (canonical 0034) ===");
  try {
    const r = await db.query(`
      select * from collect_and_allocate_payment(
        p_tenant_id := $1::uuid, p_parent_id := $2::uuid, p_student_id := $3::uuid,
        p_amount := 50000::numeric, p_method := 'cash'::text, p_category := 'tuition'::text,
        p_installment_id := null::uuid, p_proof_path := null::text, p_notes := null::text,
        p_actor_id := null::uuid, p_actor_name := 'probe'::text,
        p_check_number := null::text, p_check_bank_name := null::text,
        p_transfer_reference := null::text
      )`, [tenant, parent, student]);
    console.log("  SUCCESS:", JSON.stringify(r.rows[0]).slice(0, 200));
  } catch (e) {
    console.log("  FAILED:", (e as Error).message);
  }
  const ins2 = await db.query(`select amount_paid, status from installments order by tranche_number`);
  const led2 = await db.query(`select count(*)::int n from ledger_entries`);
  const pays2 = await db.query(`select count(*)::int n from payments`);
  console.log(`\n  payments=${pays2.rows[0].n}  ledger_entries=${led2.rows[0].n}`);
  for (const i of ins2.rows) console.log(`  installment: paid=${i.amount_paid} status=${i.status}`);

  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
