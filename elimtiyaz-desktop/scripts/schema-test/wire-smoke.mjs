/**
 * Wire-protocol smoke against the local-pg server (T-625 sanity).
 *
 * ARCHITECTURAL NOTE (single-backend discipline): PGlite multiplexes every
 * socket connection into ONE PostgreSQL session — `SET ROLE` and
 * session-scoped `set_config` leak across clients. The harness therefore
 * follows the one-logical-session discipline the production PostgREST
 * pattern implies: seed as postgres FIRST, then switch the session to the
 * authenticated staff caller (SET ROLE + claims) and run all work under
 * RLS exactly like PostgREST does per request.
 */
import { Client } from "pg";

const AUTH_UID = "00000000-0000-0000-0000-0000000000aa";
const claims = (tenantId) =>
  JSON.stringify({
    sub: AUTH_UID,
    role: "authenticated",
    app_metadata: { tenant_id: tenantId },
  });

const c = new Client({ host: "127.0.0.1", port: 5433, user: "postgres", database: "postgres" });
await c.connect();

// ── Phase 1: seed as postgres (RLS-free) ───────────────────────────────────
const tenant = await c.query(
  `insert into tenants (name, slug, country, default_locale, default_currency, timezone, is_active)
   values ('Wire Smoke Tenant', 'wire-smoke-tenant', 'DZ', 'fr', 'DZD', 'Africa/Algiers', true) returning id`,
);
const tenantId = tenant.rows[0].id;
// The chain's trigger auto-creates a (pending) profile for the auth user —
// update it to the active staff shape instead of inserting a duplicate.
await c.query(
  `insert into auth.users (id, email, email_confirmed_at) values ($1, 'smoke@elimtiyaz.dz', now())
   on conflict (id) do nothing`,
  [AUTH_UID],
);
await c.query(
  `update user_profiles set tenant_id = $1, display_name = 'Smoke Staff', status = 'active'
   where auth_user_id = $2`,
  [tenantId, AUTH_UID],
);
const profile = await c.query(`select id from user_profiles where auth_user_id = $1`, [AUTH_UID]);
await c.query(
  `insert into role_assignments (tenant_id, user_profile_id, role_id)
   select $1, $2, r.id from roles r where r.code = 'super_admin' limit 1`,
  [tenantId, profile.rows[0].id],
);

// ── Phase 2: become the authenticated staff caller ─────────────────────────
await c.query("set role authenticated");
await c.query("select set_config('request.jwt.claims', $1, false)", [claims(tenantId)]);

// 1. current_tenant_id + has_role under claims
const ctx1 = await c.query("select current_tenant_id() as t, has_role('super_admin') as admin, auth.role() as role");
console.log(
  "auth ctx:",
  ctx1.rows[0].t === tenantId && ctx1.rows[0].admin === true && ctx1.rows[0].role === "authenticated" ? "OK" : "FAIL " + JSON.stringify(ctx1.rows[0]),
);

// 2. upsert parent via the canonical RPC
const parent = await c.query(
  `select * from upsert_parent_from_import(
     p_tenant_id := $1, p_parent_code := 'PAR-WS-0001', p_first_name := 'Wire', p_last_name := 'Smoke',
     p_display_name := 'Wire Smoke', p_primary_phone := '+213555000001', p_secondary_phone := null,
     p_email := null, p_occupation := null, p_address := null, p_relationship := null,
     p_preferred_language := 'fr', p_is_active := true, p_activation_code := '123456',
     p_transport_destination := null, p_city_tier := null)`,
  [tenantId],
);
const parentId = parent.rows[0]?.out_parent_id;
console.log("upsert_parent_from_import:", parentId ? "OK (inserted=" + parent.rows[0].out_was_inserted + ")" : "FAIL");

// 3. student upsert + idempotent re-upsert
const student = await c.query(
  `select * from upsert_student_from_import(
     p_tenant_id := $1, p_student_code := 'ELV-WS-0001', p_parent_id := $2,
     p_first_name := 'Enfant', p_last_name := 'Smoke', p_display_name := 'Enfant Smoke',
     p_middle_name := null, p_date_of_birth := '2015-01-01', p_gender := null,
     p_grade_level_id := null, p_class_id := null, p_enrollment_date := null,
     p_enrollment_status := 'active', p_medical_notes := null, p_is_active := true,
     p_grade_level_code := 'ce1', p_transport_tier := null, p_payment_plan := 'tranches',
     p_filiere_code := null, p_specialite_code := null,
     p_origin_type := null, p_previous_school_name := null, p_previous_school_level := null,
     p_previous_academic_year := null, p_origin_notes := null)`,
  [tenantId, parentId],
);
const studentId = student.rows[0]?.out_student_id;
console.log("upsert_student_from_import:", studentId ? "OK" : "FAIL");

const student2 = await c.query(
  `select out_was_inserted from upsert_student_from_import(
     p_tenant_id := $1, p_student_code := 'ELV-WS-0001', p_parent_id := $2,
     p_first_name := 'Enfant', p_last_name := 'Smoke', p_display_name := 'Enfant Smoke',
     p_middle_name := null, p_date_of_birth := '2015-01-01', p_gender := null,
     p_grade_level_id := null, p_class_id := null, p_enrollment_date := null,
     p_enrollment_status := 'active', p_medical_notes := null, p_is_active := true,
     p_grade_level_code := 'ce1', p_transport_tier := null, p_payment_plan := 'tranches',
     p_filiere_code := null, p_specialite_code := null,
     p_origin_type := null, p_previous_school_name := null, p_previous_school_level := null,
     p_previous_academic_year := null, p_origin_notes := null)`,
  [tenantId, parentId],
);
console.log("student re-upsert idempotent:", student2.rows[0].out_was_inserted === false ? "OK" : "FAIL");

// 4. generate_receipt_numbers (SEC-111 guard satisfied via claims tenant)
const rec = await c.query("select * from generate_receipt_numbers($1, 3)", [tenantId]);
console.log("generate_receipt_numbers:", rec.rows.map((r) => r.receipt_number).join(", "));

// 5. RLS visibility
const vis = await c.query("select count(*)::int as n from parents");
console.log("RLS parents visible:", vis.rows[0].n >= 1 ? "OK (" + vis.rows[0].n + ")" : "FAIL");

// 6. atomic collect_and_allocate_payment with a real installment
await c.query("reset role");
await c.query(
  `insert into installments (tenant_id, parent_id, student_id, category, tranche_number, label,
     amount_due, amount_paid, amount_pending, due_date, status, source_type, source_id)
   values ($1, $2, $3, 'tuition', 1, 'Tranche 1', 50000, 0, 0, '2025-12-15', 'unpaid', 'wire-smoke', 'ws-ins-1')`,
  [tenantId, parentId, studentId],
);
await c.query("set role authenticated");
const pay = await c.query(
  `select * from collect_and_allocate_payment(
     p_tenant_id := $1, p_parent_id := $2, p_student_id := $3, p_amount := 30000, p_method := 'cash',
     p_category := null, p_installment_id := null, p_proof_path := null, p_notes := 'wire smoke',
     p_actor_id := $4, p_actor_name := null, p_check_number := null, p_check_bank_name := null,
     p_transfer_reference := null, p_transfer_source_bank := null)`,
  [tenantId, parentId, studentId, profile.rows[0].id],
);
const pr = pay.rows[0];
console.log("collect_and_allocate_payment:", pr ? "OK receipt=" + pr.receipt_number + " alloc=" + pr.total_allocated + " status=" + pr.payment_status : "FAIL");

// 7. SQL compute_parent_summary read
const sum = await c.query("select * from compute_parent_summary($1, now())", [parentId]);
console.log("compute_parent_summary:", "charged=" + sum.rows[0].total_charged + " paid=" + sum.rows[0].total_paid + " outstanding=" + sum.rows[0].total_outstanding);

// 8. ANOTHER tenant is invisible (RLS isolation) — a DIFFERENT auth user
//    (the profile's tenant takes precedence over JWT app_metadata — the
//    documented current_tenant_id resolution order — so isolation is proven
//    with a second user, not by switching claims on the same one).
const AUTH_UID2 = "00000000-0000-0000-0000-0000000000bb";
await c.query("reset role");
const tenant2 = await c.query(
  `insert into tenants (name, slug, country, default_locale, default_currency, timezone, is_active)
   values ('Other Tenant', 'other-tenant', 'DZ', 'fr', 'DZD', 'Africa/Algiers', true) returning id`,
);
await c.query(
  `insert into auth.users (id, email, email_confirmed_at) values ($1, 'smoke2@elimtiyaz.dz', now())
   on conflict (id) do nothing`,
  [AUTH_UID2],
);
await c.query(
  `update user_profiles set tenant_id = $1, display_name = 'Smoke Staff 2', status = 'active'
   where auth_user_id = $2`,
  [tenant2.rows[0].id, AUTH_UID2],
);
await c.query("set role authenticated");
await c.query(
  "select set_config('request.jwt.claims', $1, false)",
  [JSON.stringify({ sub: AUTH_UID2, role: "authenticated", app_metadata: { tenant_id: tenant2.rows[0].id } })],
);
const vis2 = await c.query("select count(*)::int as n from parents");
console.log("RLS tenant isolation:", vis2.rows[0].n === 0 ? "OK" : "FAIL (" + vis2.rows[0].n + " leaked)");

// cleanup: back to postgres (RESET ROLE); replica mode for the append-only
// audit trigger on tenant delete (the DB is throwaway in-memory anyway).
await c.query("reset role");
await c.query("set session_replication_role = replica");
await c.query("delete from tenants where id = any($1)", [[tenantId, tenant2.rows[0].id]]);
await c.query("delete from auth.users where id = any($1)", [[AUTH_UID, AUTH_UID2]]);
await c.query("set session_replication_role = origin");
const leftover = await c.query("select count(*)::int as n from user_profiles where auth_user_id = $1", [AUTH_UID]);
await c.end();
console.log("cleanup:", leftover.rows[0].n === 0 ? "OK" : "NOTE: profile cascade left " + leftover.rows[0].n + " row(s)");
console.log("WIRE SMOKE COMPLETE");
