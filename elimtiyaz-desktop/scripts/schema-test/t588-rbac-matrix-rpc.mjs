/**
 * T-588 — the 0006_rbac_matrix_persistence RPC verification against the
 * LOCAL OFFLINE database (the Rule-3 gate; zero remote egress).
 *
 * Follows the wire-smoke single-backend discipline: seed as postgres,
 * then SET ROLE authenticated + session claims for the staff caller.
 *
 * Run: node scripts/schema-test/t588-rbac-matrix-rpc.mjs   (server on 5433)
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.LOCAL_PG_PORT || 5433);
const AUTH_UID = "00000000-0000-0000-0000-0000000000cc";
const claims = (tenantId) =>
  JSON.stringify({ sub: AUTH_UID, role: "authenticated", app_metadata: { tenant_id: tenantId } });

let failures = 0;
function check(label, ok, detail = "") {
  console.log((ok ? "OK   " : "FAIL ") + label + (detail ? " — " + detail : ""));
  if (!ok) failures++;
}

const c = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", database: "postgres" });
await c.connect();

// ── Phase 1: seed as postgres ──────────────────────────────────────────────
const tenant = await c.query(
  `insert into tenants (name, slug, country, default_locale, default_currency, timezone, is_active)
   values ('T588 Tenant', 't588-tenant', 'DZ', 'fr', 'DZD', 'Africa/Algiers', true) returning id`,
);
const tenantId = tenant.rows[0].id;
await c.query(
  `insert into auth.users (id, email, email_confirmed_at) values ($1, 't588@elimtiyaz.dz', now())
   on conflict (id) do nothing`,
  [AUTH_UID],
);
await c.query(
  `update user_profiles set tenant_id = $1, display_name = 'T588 Admin', status = 'active'
   where auth_user_id = $2`,
  [tenantId, AUTH_UID],
);
await c.query(
  `insert into role_assignments (tenant_id, user_profile_id, role_id)
   select $1, $2, r.id from roles r where r.code = 'super_admin' limit 1`,
  [tenantId, (await c.query(`select id from user_profiles where auth_user_id = $1`, [AUTH_UID])).rows[0].id],
);

// ── Phase 2: become the authenticated super_admin caller ──────────────────
await c.query("set role authenticated");
await c.query("select set_config('request.jwt.claims', $1, false)", [claims(tenantId)]);

// 1. the effective matrix reads (baseline)
const before = await c.query("select read_rbac_effective_matrix() as m");
const mBefore = before.rows[0].m;
const teacherBefore = mBefore.teacher ?? [];
check("read_rbac_effective_matrix returns every role", Object.keys(mBefore).length === 11,
  Object.keys(mBefore).join(","));
check("teacher baseline carries a legacy-catalog grant (view_students)", teacherBefore.includes("view_students"));
check("teacher baseline carries manage_clubs? (expected false pre-save)", !teacherBefore.includes("manage_clubs"));
const teacherHasUseAi = teacherBefore.includes("use_ai");
check("teacher baseline has use_ai (expected true)", teacherHasUseAi, String(teacherHasUseAi));

// 2. save: grant manage_clubs (absent default), deny use_ai (present default),
//    list view_roster as granted (== default → override cleanup path)
const payload = {
  teacher: {
    granted: ["manage_clubs", "view_roster"],
    denied: ["use_ai"],
  },
};
const save = await c.query("select save_rbac_matrix($1) as r", [JSON.stringify(payload)]);
const saved = save.rows[0].r;
check("save_rbac_matrix diff counts", saved.saved === 2 && saved.removed === 0, JSON.stringify(saved));

// 3. the effective matrix reflects the save; the LEGACY grant survives
const after = await c.query("select read_rbac_effective_matrix() as m");
const teacherAfter = after.rows[0].m.teacher;
check("grant applied (manage_clubs now effective)", teacherAfter.includes("manage_clubs"));
check("deny applied (use_ai no longer effective)", !teacherAfter.includes("use_ai"));
check("legacy unlisted code untouched (view_students still effective)", teacherAfter.includes("view_students"));
check("default-equal code needs no override row (view_roster effective via default)", teacherAfter.includes("view_roster"));

// 4. the overrides table under RLS (select policy)
const rows = await c.query(
  `select p.code, o.action from tenant_role_overrides o join permissions p on p.id = o.permission_id
   where o.tenant_id = current_tenant_id() and o.role_id = (select id from roles where code = 'teacher')
   order by p.code`,
);
const byCode = Object.fromEntries(rows.rows.map((r) => [r.code, r.action]));
check("override rows = exactly the diff (2 rows)", rows.rows.length === 2, JSON.stringify(byCode));
check("manage_clubs override action = grant", byCode.manage_clubs === "grant");
check("use_ai override action = deny", byCode.use_ai === "deny");

// 5. idempotent re-save of the SAME matrix → saved=0, removed=0
const save2 = await c.query("select save_rbac_matrix($1) as r", [JSON.stringify(payload)]);
check("re-save is a pure no-op", save2.rows[0].r.saved === 0 && save2.rows[0].r.removed === 0, JSON.stringify(save2.rows[0].r));

// 6. saving the DEFAULT state removes the overrides (revert path)
const revert = {
  teacher: { granted: ["use_ai", "view_roster"], denied: ["manage_clubs"] },
};
const save3 = await c.query("select save_rbac_matrix($1) as r", [JSON.stringify(revert)]);
check("revert-to-default removes both override rows", save3.rows[0].r.removed === 2, JSON.stringify(save3.rows[0].r));
const rowsAfterRevert = await c.query(
  `select count(*)::int as n from tenant_role_overrides where tenant_id = current_tenant_id()`,
);
check("override table empty after revert", rowsAfterRevert.rows[0].n === 0);

// 7. contradiction refused (granted ∩ denied)
try {
  await c.query("select save_rbac_matrix($1)", [JSON.stringify({ teacher: { granted: ["use_ai"], denied: ["use_ai"] } })]);
  check("contradiction refused", false, "no exception raised");
} catch (e) {
  check("contradiction refused", e.code === "22P02", e.code + " " + e.message.slice(0, 60));
}

// 8. unknown permission code refused (fail-loud)
try {
  await c.query("select save_rbac_matrix($1)", [JSON.stringify({ teacher: { granted: ["not_a_real_code"], denied: [] } })]);
  check("unknown permission refused", false, "no exception raised");
} catch (e) {
  check("unknown permission refused", e.code === "23503", e.code + " " + e.message.slice(0, 60));
}

// 9. malformed payload refused
try {
  await c.query("select save_rbac_matrix($1)", [JSON.stringify({ teacher: ["use_ai"] })]);
  check("malformed payload refused", false, "no exception raised");
} catch (e) {
  check("malformed payload refused", !!e.code, e.code + " " + e.message.slice(0, 60));
}

// 10. non-super_admin refused (a teacher-only caller on the same session
//     via RESET ROLE + reseed + new claims — the wire-smoke discipline)
const AUTH_UID2 = "00000000-0000-0000-0000-0000000000dd";
await c.query("reset role");
await c.query(
  `insert into auth.users (id, email, email_confirmed_at) values ($1, 't588b@elimtiyaz.dz', now())
   on conflict (id) do nothing`,
  [AUTH_UID2],
);
await c.query(
  `update user_profiles set tenant_id = $1, display_name = 'T588 Teacher', status = 'active'
   where auth_user_id = $2`,
  [tenantId, AUTH_UID2],
);
await c.query(
  `insert into role_assignments (tenant_id, user_profile_id, role_id)
   select $1, $2, r.id from roles r where r.code = 'teacher' limit 1`,
  [tenantId, (await c.query(`select id from user_profiles where auth_user_id = $1`, [AUTH_UID2])).rows[0].id],
);
await c.query("set role authenticated");
await c.query(
  "select set_config('request.jwt.claims', $1, false)",
  [JSON.stringify({ sub: AUTH_UID2, role: "authenticated", app_metadata: { tenant_id: tenantId } })],
);
try {
  await c.query("select save_rbac_matrix($1)", [JSON.stringify({ teacher: { granted: ["use_ai"], denied: [] } })]);
  check("non-super_admin save refused", false, "no exception raised");
} catch (e) {
  check("non-super_admin save refused", e.code === "42501", e.code + " " + e.message.slice(0, 60));
}
try {
  await c.query("select reset_rbac_matrix()");
  check("non-super_admin reset refused", false, "no exception raised");
} catch (e) {
  check("non-super_admin reset refused", e.code === "42501", e.code + " " + e.message.slice(0, 60));
}

// 11. back to super_admin: reset clears everything
await c.query("reset role");
await c.query("set role authenticated");
await c.query("select set_config('request.jwt.claims', $1, false)", [claims(tenantId)]);
await c.query("select save_rbac_matrix($1)", [JSON.stringify(payload)]); // leave 2 rows behind
const reset = await c.query("select reset_rbac_matrix() as r");
check("reset_rbac_matrix removes the tenant set", reset.rows[0].r.removed === 2, JSON.stringify(reset.rows[0].r));
const finalM = (await c.query("select read_rbac_effective_matrix() as m")).rows[0].m;
check("effective matrix back to defaults after reset",
  JSON.stringify(finalM.teacher.slice().sort()) === JSON.stringify(teacherBefore.slice().sort()));

// 12. the current_user_permissions() parity: the super_admin's own set must
//     respond to a self-deny on a NON-repairable code path — global admins
//     get everything, so instead verify the resolver on the TEACHER caller:
//     re-become the teacher, save is refused, but a super_admin deny on
//     'teacher' role's use_ai must reflect in the teacher's own set.
await c.query("reset role");
await c.query("set role authenticated");
await c.query(
  "select set_config('request.jwt.claims', $1, false)",
  [JSON.stringify({ sub: AUTH_UID2, role: "authenticated", app_metadata: { tenant_id: tenantId } })],
);
const teacherPerms = await c.query("select current_user_permissions() as p");
check("teacher resolver baseline (use_ai present, pre-override)",
  teacherPerms.rows[0].p.includes("use_ai"));
await c.query("reset role");
await c.query("set role authenticated");
await c.query("select set_config('request.jwt.claims', $1, false)", [claims(tenantId)]);
await c.query("select save_rbac_matrix($1)", [JSON.stringify({ teacher: { granted: [], denied: ["use_ai"] } })]);
await c.query("reset role");
await c.query("set role authenticated");
await c.query(
  "select set_config('request.jwt.claims', $1, false)",
  [JSON.stringify({ sub: AUTH_UID2, role: "authenticated", app_metadata: { tenant_id: tenantId } })],
);
const teacherPerms2 = await c.query("select current_user_permissions() as p");
check("ENFORCEMENT PARITY: teacher's current_user_permissions drops use_ai after the deny override",
  !teacherPerms2.rows[0].p.includes("use_ai"));

// ── cleanup ────────────────────────────────────────────────────────────────
await c.query("reset role");
await c.query("set session_replication_role = replica");
await c.query("delete from tenants where id = $1", [tenantId]);
await c.query("delete from auth.users where id = any($1)", [[AUTH_UID, AUTH_UID2]]);
await c.query("set session_replication_role = origin");
await c.end();

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
