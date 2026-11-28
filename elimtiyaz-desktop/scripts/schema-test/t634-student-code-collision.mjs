/** T-634: forced cross-family code collision, on local offline PostgreSQL
 * only. BEGIN/ROLLBACK leaves no fixture or audit residue. */
import { Client } from "pg";
const c = new Client({ host: "127.0.0.1", port: Number(process.env.LOCAL_PG_PORT ?? 5437), user: "postgres", database: "postgres" });
await c.connect();
let failed = 0, passed = 0;
const check = (name, yes) => { console.log(`${yes ? "PASS" : "FAIL"} ${name}`); yes ? passed++ : failed++; };
try {
  await c.query("reset role; begin");
  const { rows: tenants } = await c.query(`insert into tenants (name,slug,country,default_locale,default_currency,timezone,is_active)
    values ('Collision verification','t634-collision','DZ','fr','DZD','Africa/Algiers',true) returning id`);
  const tenant = tenants[0].id;
  const uid = "00000000-0000-0000-0000-00000000e634";
  await c.query(`insert into auth.users(id,email,email_confirmed_at) values ($1,'t634@elimtiyaz.dz',now())`, [uid]);
  await c.query(`update user_profiles set tenant_id=$1,status='active' where auth_user_id=$2`, [tenant,uid]);
  await c.query(`insert into role_assignments(tenant_id,user_profile_id,role_id)
    select $1,p.id,r.id from user_profiles p cross join roles r where p.auth_user_id=$2 and r.code='super_admin'`, [tenant,uid]);
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:uid,role:'authenticated',app_metadata:{tenant_id:tenant}})]);
  const parent = async (code, phone, last) => (await c.query(`select out_parent_id id from upsert_parent_from_import(
    p_tenant_id := $1,p_parent_code := $2,p_first_name := 'Test',p_last_name := $3,
    p_primary_phone := $4,p_display_name := $3,p_activation_code := $2)`, [tenant,code,last,phone])).rows[0].id;
  const a = await parent('PAR-2026-AAAAAA','+213555006341','FamilyA');
  const b = await parent('PAR-2026-BBBBBB','+213555006342','FamilyB');
  const upsert = async (pid, first, code='ELV-2026-ABCDEF') => (await c.query(`select * from upsert_student_from_import(
    p_tenant_id := $1,p_student_code := $2,p_parent_id := $3,p_first_name := $4,p_last_name := 'Test',
    p_display_name := $4,p_grade_level_code := '2ap')`, [tenant,code,pid,first])).rows[0];
  const first = await upsert(a,'Original');
  await c.query(`insert into ledger_entries(entry_number,tenant_id,parent_id,student_id,account_id,entry_type,amount,category,description,entry_date,source_type,source_id,at)
    values ('T634-CHARGE',$1::uuid,$2::uuid,$3::uuid,'parent:'||$2::text||':category:tuition','charge',240000,'tuition','Real obligation retained',now(),'manual_entry','T634',now())`, [tenant,a,first.out_student_id]);
  const second = await upsert(b,'Distinct');
  check('different families retain distinct student ids', first.out_student_id !== second.out_student_id);
  check('collision chooses another canonical-format code', /^ELV-2026-[0-9A-F]{6}$/.test(second.out_student_code) && first.out_student_code !== second.out_student_code);
  let original = (await c.query('select parent_id,first_name from students where id=$1',[first.out_student_id])).rows[0];
  check('original parent and name remain unchanged', original.parent_id === a && original.first_name === 'Original');
  const repeat = await upsert(b,'Distinct');
  check('re-import resolves the same alternate student', repeat.out_student_id === second.out_student_id && !repeat.out_was_inserted);
  check('re-import preserves the alternate code', repeat.out_student_code === second.out_student_code);
  const originalAgain = await upsert(a,'Original');
  check('the original code remains idempotent', originalAgain.out_student_id === first.out_student_id && !originalAgain.out_was_inserted);
  const renamed = await upsert(a,'Renamed');
  check('same-family explicit code updates still rename', renamed.out_student_id === first.out_student_id);
  const fallback = await upsert(b,'Distinct','ELV-2026-FEDCBA');
  check('same-family name fallback remains idempotent', fallback.out_student_id === second.out_student_id && !fallback.out_was_inserted);
  const counts = (await c.query('select count(*)::int n from students where tenant_id=$1',[tenant])).rows[0];
  check('exactly two children remain after every re-import', counts.n===2);
  const charge = (await c.query(`select s.parent_id,e.amount::float8 amount from ledger_entries e join students s on s.id=e.student_id where e.entry_number='T634-CHARGE'`)).rows[0];
  check('the original 240000 DZD obligation still belongs to its original family', charge.parent_id===a && charge.amount===240000);
} finally {
  await c.query("rollback; reset role");
  await c.end();
}
console.log(`T634 ${passed} passed / ${failed} failed`);
if (failed) process.exitCode=1;
