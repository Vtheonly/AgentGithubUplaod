/**
 * T-627 — the 0007_tenant_public_settings RPC verification against the
 * LOCAL OFFLINE database (the Rule-3 gate; zero remote egress).
 *
 * Follows the wire-smoke single-backend discipline: seed as postgres,
 * then SET ROLE authenticated + session claims for each caller persona
 * (super_admin → teacher → parent → anon), RESET ROLE between personas.
 *
 * Run: node scripts/schema-test/t627-tenant-public-settings-rpc.mjs   (server on 5433)
 */
import { Client } from "pg";
// T-627 leg-2 repair (§15.83c — the script's own first full run): jsonb
// normalizes key order + whitespace, so a JSON.stringify TEXT comparison of
// a round-tripped value against the original literal is a false negative —
// the value is identical, the serialization differs. Deep-equality on the
// PARSED value is the honest form (the ai check below already used it).
import { isDeepStrictEqual } from "node:util";

const PORT = Number(process.env.LOCAL_PG_PORT || 5433);
const CANONICAL_TENANT = "00000000-0000-0000-0000-000000000001";
const ADMIN_UID = "00000000-0000-0000-0000-00000000e701";
const TEACHER_UID = "00000000-0000-0000-0000-00000000e702";
const PARENT_UID = "00000000-0000-0000-0000-00000000e703";
const claims = (sub, tenantId) =>
  JSON.stringify({ sub, role: "authenticated", app_metadata: { tenant_id: tenantId } });

let failures = 0;
function check(label, ok, detail = "") {
  console.log((ok ? "OK   " : "FAIL ") + label + (detail ? " — " + detail : ""));
  if (!ok) failures++;
}

const c = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", database: "postgres" });
await c.connect();

// ── Phase 1: seed as postgres ──────────────────────────────────────────────
// (a) The migration-time seeds landed for the canonical tenant (the cross
//     join runs at apply time over the then-existing tenants — the
//     debt-seed pattern; tenants created later rely on the reader's honest
//     null defaults + the writer's insert path, both checked below).
const seeds = await c.query(
  `select key, value_type, value from public.system_settings
    where tenant_id = $1 and key in ('ai.provider_config','backup.scheduler_enabled','theme.custom_palettes')`,
  [CANONICAL_TENANT],
);
const seedByKey = Object.fromEntries(seeds.rows.map((r) => [r.key, r]));
check("the three seed rows exist for the canonical tenant", seeds.rows.length === 3, JSON.stringify(Object.keys(seedByKey)));
check("backup.scheduler_enabled seeded TRUE (the pre-collapse default-ON semantics)",
  seedByKey["backup.scheduler_enabled"]?.value === true, JSON.stringify(seedByKey["backup.scheduler_enabled"]?.value));
check("ai.provider_config seeded NULL (never configured)", seedByKey["ai.provider_config"]?.value === null);
check("theme.custom_palettes seeded NULL (never configured)", seedByKey["theme.custom_palettes"]?.value === null);

// (b) A post-migration tenant + the three personas.
const tenant = await c.query(
  `insert into tenants (name, slug, country, default_locale, default_currency, timezone, is_active)
   values ('T627 Tenant', 't627-tenant', 'DZ', 'fr', 'DZD', 'Africa/Algiers', true) returning id`,
);
const tenantId = tenant.rows[0].id;

async function provisionPersona(authUid, email, name, roleCode) {
  await c.query(
    `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) on conflict (id) do nothing`,
    [authUid, email],
  );
  await c.query(
    `update user_profiles set tenant_id = $1, display_name = $2, status = 'active' where auth_user_id = $3`,
    [tenantId, name, authUid],
  );
  const prof = await c.query(`select id from user_profiles where auth_user_id = $1`, [authUid]);
  await c.query(
    `insert into role_assignments (tenant_id, user_profile_id, role_id)
     select $1, $2, r.id from roles r where r.code = $3 limit 1`,
    [tenantId, prof.rows[0].id, roleCode],
  );
  return prof.rows[0].id;
}
const adminProfileId = await provisionPersona(ADMIN_UID, "t627-admin@elimtiyaz.dz", "T627 Admin", "super_admin");
await provisionPersona(TEACHER_UID, "t627-teacher@elimtiyaz.dz", "T627 Teacher", "teacher");
await provisionPersona(PARENT_UID, "t627-parent@elimtiyaz.dz", "T627 Parent", "parent");

// ── Phase 2: the super_admin caller ────────────────────────────────────────
await c.query("set role authenticated");
await c.query("select set_config('request.jwt.claims', $1, false)", [claims(ADMIN_UID, tenantId)]);

// 1. The reader: honest nulls for a tenant with no rows (created post-migration).
const read0 = await c.query("select read_public_settings() as s");
const s0 = read0.rows[0].s;
check("reader returns nulls for an unconfigured tenant (the honest default)",
  s0.aiProviderConfig === null && s0.customThemes === null && s0.backupSchedulerEnabled === null,
  JSON.stringify(s0));

// 2. The save round-trip: all three keys.
const themes = [{ id: "theme-t627", name: "Palette T627", isDark: false, colors: { primary: "#1d4ed8" } }];
const aiCfg = { defaultProvider: "groq", defaultModel: "openai/gpt-oss-20b", temperature: 0.4, topP: 0.9, maxTokens: 2048 };
await c.query("select save_public_setting($1, $2)", ["theme.custom_palettes", JSON.stringify(themes)]);
await c.query("select save_public_setting($1, $2)", ["ai.provider_config", JSON.stringify(aiCfg)]);
await c.query("select save_public_setting($1, $2)", ["backup.scheduler_enabled", JSON.stringify(false)]);

const read1 = await c.query("select read_public_settings() as s");
const s1 = read1.rows[0].s;
check("theme.custom_palettes round-trips (deep-equality — jsonb normalizes key order)",
  isDeepStrictEqual(s1.customThemes, themes), JSON.stringify(s1.customThemes));
check("ai.provider_config round-trips", s1.aiProviderConfig?.defaultModel === "openai/gpt-oss-20b");
check("backup.scheduler_enabled round-trips (false)", s1.backupSchedulerEnabled === false);

// 3. The audit trail: three audited writes with the server-resolved actor.
const audit = await c.query(
  `select count(*)::int as n from audit_logs
    where tenant_id = current_tenant_id() and action = 'system_setting.update'
      and actor_id = $1 and after_json->>'origin' = 'save_public_setting'`,
  [adminProfileId],
);
check("three audited saves with the server-resolved actor", audit.rows[0].n === 3, String(audit.rows[0].n));

// 4. Fail-loud: unknown key + wrong shapes.
try {
  await c.query("select save_public_setting($1, $2)", ["not.a.public.key", JSON.stringify({})]);
  check("unknown key refused", false, "no exception raised");
} catch (e) {
  check("unknown key refused", e.code === "22023", e.code + " " + e.message.slice(0, 60));
}
try {
  await c.query("select save_public_setting($1, $2)", ["backup.scheduler_enabled", JSON.stringify("yes")]);
  check("scheduler flag must be a boolean", false, "no exception raised");
} catch (e) {
  check("scheduler flag must be a boolean", e.code === "22023", e.code + " " + e.message.slice(0, 60));
}
try {
  await c.query("select save_public_setting($1, $2)", ["theme.custom_palettes", JSON.stringify({ not: "an array" })]);
  check("themes must be an array", false, "no exception raised");
} catch (e) {
  check("themes must be an array", e.code === "22023", e.code + " " + e.message.slice(0, 60));
}

// 5. SEC-121 — upsert_setting: the pricing path (super_admin, OWN tenant) preserved.
const pricing = await c.query(
  "select upsert_setting($1, 'system', 'pricing.monthly.1AP', 'Tarif mensuel (1AP)', $2, 'number') as id",
  [tenantId, JSON.stringify(25000)],
);
check("upsert_setting preserved for super_admin + own tenant (the pricing path)",
  /^[0-9a-f-]{36}$/.test(pricing.rows[0].id));
check("the pricing row landed with the actor fallback (updated_by = the caller's profile)",
  (await c.query(`select updated_by from system_settings where tenant_id = current_tenant_id() and key = 'pricing.monthly.1AP'`)).rows[0].updated_by === adminProfileId,
  JSON.stringify((await c.query(`select value from system_settings where tenant_id = current_tenant_id() and key = 'pricing.monthly.1AP'`)).rows[0]?.value));

// 6. SEC-121 — cross-tenant write refused.
try {
  await c.query(
    "select upsert_setting($1, 'system', 'evil.key', 'Evil', $2, 'string')",
    [CANONICAL_TENANT, JSON.stringify("x")],
  );
  check("upsert_setting cross-tenant refused", false, "no exception raised");
} catch (e) {
  check("upsert_setting cross-tenant refused", e.code === "42501", e.code + " " + e.message.slice(0, 60));
}

// ── Phase 3: the teacher caller (the wider staff audience) ─────────────────
await c.query("reset role");
await c.query("set role authenticated");
await c.query("select set_config('request.jwt.claims', $1, false)", [claims(TEACHER_UID, tenantId)]);

const readT = await c.query("select read_public_settings() as s");
const sT = readT.rows[0].s;
check("teacher READS the trio (the staff audience — themes render + scheduler runs on every staff machine)",
  sT.aiProviderConfig?.defaultModel === "openai/gpt-oss-20b" && sT.backupSchedulerEnabled === false);
try {
  await c.query("select save_public_setting($1, $2)", ["backup.scheduler_enabled", JSON.stringify(true)]);
  check("teacher save refused", false, "no exception raised");
} catch (e) {
  check("teacher save refused", e.code === "42501", e.code + " " + e.message.slice(0, 60));
}
try {
  await c.query("select upsert_setting($1, 'system', 'teacher.key', 'Nope', $2, 'string')", [tenantId, JSON.stringify("x")]);
  check("SEC-121: teacher upsert_setting refused (was open before 0007)", false, "no exception raised");
} catch (e) {
  check("SEC-121: teacher upsert_setting refused (was open before 0007)", e.code === "42501", e.code + " " + e.message.slice(0, 60));
}
try {
  await c.query("select upsert_secret_setting($1, 'ai', 'evil.secret', 'Evil', 'ciphertext')", [tenantId]);
  check("SEC-121: teacher upsert_secret_setting refused", false, "no exception raised");
} catch (e) {
  check("SEC-121: teacher upsert_secret_setting refused", e.code === "42501", e.code + " " + e.message.slice(0, 60));
}

// ── Phase 4: the parent caller (portal accounts are NOT the audience) ──────
await c.query("reset role");
await c.query("set role authenticated");
await c.query("select set_config('request.jwt.claims', $1, false)", [claims(PARENT_UID, tenantId)]);
try {
  await c.query("select read_public_settings()");
  check("parent read refused (staff surface)", false, "no exception raised");
} catch (e) {
  check("parent read refused (staff surface)", e.code === "42501", e.code + " " + e.message.slice(0, 60));
}

// ── Phase 5: anon (execute revoked + the body gate) ─────────────────────────
await c.query("reset role");
await c.query("set role anon");
await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "anon" })]);
try {
  await c.query("select read_public_settings()");
  check("anon read refused", false, "no exception raised");
} catch (e) {
  check("anon read refused", e.code === "42501" || /permission/i.test(e.message), e.code + " " + e.message.slice(0, 60));
}
try {
  await c.query("select save_public_setting($1, $2)", ["theme.custom_palettes", JSON.stringify([])]);
  check("anon save refused", false, "no exception raised");
} catch (e) {
  check("anon save refused", e.code === "42501" || /permission/i.test(e.message), e.code + " " + e.message.slice(0, 60));
}

// ── cleanup ────────────────────────────────────────────────────────────────
await c.query("reset role");
await c.query("set session_replication_role = replica");
await c.query("delete from tenants where id = $1", [tenantId]);
await c.query("delete from auth.users where id = any($1)", [[ADMIN_UID, TEACHER_UID, PARENT_UID]]);
await c.query("set session_replication_role = origin");
await c.end();

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
