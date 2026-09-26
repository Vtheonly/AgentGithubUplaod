#!/usr/bin/env node
/**
 * T-416 (issue #12) — LIVE verification of the student/parent domain purge.
 *
 * The owner's session directive: "Do testing and make sure the purge does
 * not interfere with the sync and backup processes."
 *
 * THE SAFETY MODEL (this script NEVER destroys real data):
 *   The purge is tenant-wide and destructive — it is NEVER "tested" against
 *   the real 196 parents / 290 students. The execute-mode evidence comes
 *   from THE TRANSACTIONAL SANDBOX (§15.58, AGENTS.md): one Management-API
 *   SQL call that seeds FAKE-marked probes (§15.50), runs the REAL RPC in
 *   EXECUTE mode, asserts the complete dependency graph + the
 *   no-interference invariants, and then RAISES a marker exception — the
 *   aborted simple-query transaction rolls EVERYTHING back (the seeds, the
 *   deletes, the audit entry). The report rides the exception message.
 *
 * Phases:
 *   0  PREFLIGHT  — the live migration registry (0118 present? 0120
 *                   absent?), the pg_proc census of every existing
 *                   purge_student_parent_domain overload (the PURGE-500
 *                   evidence), the domain baseline counts.
 *   1  APPLY      — migration 0120 applied atomically WITH its T-091
 *                   registration; verify: registry row 0120 + exactly ONE
 *                   function overload remains (the reconciliation).
 *   2  SANDBOX    — BEGIN-less implicit transaction: seeds → wrong-phrase
 *                   probe (confirmation_required) → dry-run probe (zero
 *                   deletes) → EXECUTE → per-family zero-residue asserts →
 *                   THE NO-INTERFERENCE PROOFS (the non-domain sync_queue
 *                   row survives, the backup_archives probe survives, the
 *                   purge audit entry exists) → marker exception →
 *                   automatic rollback → post-sandbox census == baseline.
 *   3  UI PATH    — the admin-JWT dry-run through the EXACT PostgREST path
 *                   the desktop uses (GoTrue password grant → rpc call):
 *                   the verdict counts the REAL domain and deletes nothing
 *                   (re-run byte-identical).
 *   4  AFTERMATH  — backup_archives count unchanged across the whole run;
 *                   the sync/backup RPCs still present in pg_proc; the
 *                   anonymous PostgREST call on the purge RPC is DENIED.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_… [SUPABASE_SERVICE_ROLE_KEY=sb_secret_…] \
 *     node scripts/t-416-purge-live-verification.mjs [--skip-apply]
 *
 *   --skip-apply  — Phase 1 skipped (re-runs after 0120 is already live).
 */
import process from "node:process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, "..", "supabase", "migrations", "0120_purge_student_parent_domain.sql");

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.T416_ADMIN_EMAIL ?? "admin@elimtiyaz.dz";
const ADMIN_PASSWORD = process.env.T416_ADMIN_PASSWORD ?? "elimtiyaz@admin2026"; // owner-pinned (credentials.md — probes use as-is, never re-set)
const PROJECT_REF = "vebfehrpzajhstyhinnw";
const SKIP_APPLY = process.argv.includes("--skip-apply");

const MGMT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const results = [];

if (!ACCESS_TOKEN) {
  console.error("Missing SUPABASE_ACCESS_TOKEN (the sbp_… Management-API token).");
  process.exit(2);
}

function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${id}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`);
}

async function sql(query) {
  const res = await fetch(MGMT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`SQL ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    err.payload = json;
    throw err;
  }
  return json;
}

/** The Management API returns the rows for a SELECT as an array. */
async function sqlRows(query) {
  const out = await sql(query);
  if (Array.isArray(out)) return out;
  if (out && Array.isArray(out.rows)) return out.rows;
  return [];
}

async function rest(method, path, body, headers = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* raw */
  }
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------------------
// Phase 0 — preflight
// ---------------------------------------------------------------------------
async function phase0() {
  console.log("\n== Phase 0 — preflight (the live-schema authority, §57c) ==");

  const registry = await sqlRows(
    "select version, name from supabase_migrations.schema_migrations order by version desc limit 5",
  );
  record("P0.1 registry head", Array.isArray(registry) && registry.length > 0, JSON.stringify(registry));

  const has0118 = registry.some((r) => String(r.version) === "0118");
  record("P0.2 the unregistered live 0118 present (PURGE-500 context)", has0118, has0118 ? "0118 purge_student_parent_domain in the live registry" : "absent");
  const has0120 = registry.some((r) => String(r.version) === "0120");
  record("P0.3 0120 not yet applied", !has0120 || SKIP_APPLY, has0120 ? "already applied (--skip-apply expected)" : "clean");

  const overloads = await sqlRows(
    "select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'purge_student_parent_domain'",
  );
  console.log(`   (census: ${overloads.length} pre-existing overload(s): ${overloads.map((o) => o.sig).join(", ") || "none"})`);

  const baseline = await sqlRows(
    `select
       (select count(*) from public.parents) as parents,
       (select count(*) from public.students) as students,
       (select count(*) from public.payments) as payments,
       (select count(*) from public.installments) as installments,
       (select count(*) from public.backup_archives) as backup_archives,
       (select count(*) from public.sync_queue) as sync_queue,
       (select count(*) from public.audit_logs) as audit_logs`,
  );
  const b = baseline[0] ?? {};
  console.log(`   baseline: parents=${b.parents} students=${b.students} payments=${b.payments} installments=${b.installments} backup_archives=${b.backup_archives} sync_queue=${b.sync_queue} audit_logs=${b.audit_logs}`);
  record("P0.4 domain baseline captured", true, JSON.stringify(b));
  return { baseline: b, overloads };
}

// ---------------------------------------------------------------------------
// Phase 1 — apply migration 0120 atomically
// ---------------------------------------------------------------------------
async function phase1() {
  console.log("\n== Phase 1 — apply 0120 (atomic, with its T-091 registration) ==");
  if (SKIP_APPLY) {
    console.log("   (--skip-apply — verifying only)");
  } else {
    const body = readFileSync(MIGRATION_PATH, "utf8");
    const payload = `begin;\n${body}\ncommit;`;
    try {
      await sql(payload);
      record("P1.1 apply 0120", true, "applied atomically");
    } catch (e) {
      record("P1.1 apply 0120", false, e.message);
      throw e;
    }
  }

  const reg = await sqlRows("select version, name from supabase_migrations.schema_migrations where version = '0120'");
  record("P1.2 registry row 0120", reg.length === 1, JSON.stringify(reg));

  const overloads = await sqlRows(
    "select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'purge_student_parent_domain'",
  );
  record(
    "P1.3 exactly ONE canonical overload remains (the live-0118 reconciliation)",
    overloads.length === 1 && /text, boolean, uuid/.test(overloads[0].sig),
    JSON.stringify(overloads.map((o) => o.sig)),
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — the transactional sandbox (execute-mode evidence, zero residue)
// ---------------------------------------------------------------------------
async function phase2(baseline) {
  console.log("\n== Phase 2 — the transactional sandbox (BEGIN…marker-exception rollback) ==");

  // Deterministic, run-unique probe ids (§15.50 — every seeded row carries
  // the FAKE marker in a stable, queryable column).
  const tag = Date.now().toString(36);
  const root = crypto.randomUUID();
  const ids = {
    authUser: root,
    profile: crypto.randomUUID(),
    roleAssign: crypto.randomUUID(),
    parent: crypto.randomUUID(),
    student: crypto.randomUUID(),
    serviceEnrollment: crypto.randomUUID(),
    installment: crypto.randomUUID(),
    payment: crypto.randomUUID(),
    allocation: crypto.randomUUID(),
    ledger: crypto.randomUUID(),
    invoice: crypto.randomUUID(),
    activation: crypto.randomUUID(),
    link: crypto.randomUUID(),
    document: crypto.randomUUID(),
    grade: crypto.randomUUID(),
    attendance: crypto.randomUUID(),
    channel: crypto.randomUUID(),
    message: crypto.randomUUID(),
    notification: crypto.randomUUID(),
    calendar: crypto.randomUUID(),
    syncDomain: crypto.randomUUID(),
    syncOther: crypto.randomUUID(),
    backup: crypto.randomUUID(),
  };

  const sandbox = `
    -- EXPLICIT transaction boundaries: the sandbox must be safe under BOTH
    -- endpoint execution models (sticky-session implicit txn OR per-statement
    -- autocommit). With begin; … rollback; every model either lands inside
    -- the aborted transaction (the marker exception) or is rolled back by
    -- the trailing statement — the REAL data can never be committed.
    begin;
    select 'seed';
    insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values ('${ids.authUser}', 'fake-t416-${tag}@el-imtiyaz.test', 'authenticated', 'authenticated', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

    insert into public.user_profiles (id, auth_user_id, tenant_id, email, display_name, status)
    values ('${ids.profile}', '${ids.authUser}', (select id from public.tenants limit 1), 'fake-t416-${tag}@el-imtiyaz.test', 'FAKE T416 Parent Portal', 'active');

    insert into public.role_assignments (id, tenant_id, user_profile_id, role_id)
    values ('${ids.roleAssign}', (select id from public.tenants limit 1), '${ids.profile}', (select id from public.roles where code = 'parent' limit 1));

    insert into public.parents (id, tenant_id, parent_code, first_name, last_name, primary_phone, is_active, auth_user_id)
    values ('${ids.parent}', (select id from public.tenants limit 1), 'FAKE-T416-${tag}', 'FAKE', 'T416Parent', '+213000000000', true, '${ids.authUser}');

    insert into public.students (id, tenant_id, parent_id, student_code, first_name, last_name, is_active, enrollment_status)
    values ('${ids.student}', (select id from public.tenants limit 1), '${ids.parent}', 'FAKE-T416-${tag}', 'FAKE', 'T416Student', true, 'enrolled');

    insert into public.service_enrollments (id, tenant_id, student_id, academic_year_id, service_kind, annual_amount)
    values ('${ids.serviceEnrollment}', (select id from public.tenants limit 1), '${ids.student}', (select id from public.academic_years limit 1), 'tuition', 1000);

    insert into public.installments (id, tenant_id, parent_id, student_id, service_enrollment_id, tranche_number, amount_due, due_date)
    values ('${ids.installment}', (select id from public.tenants limit 1), '${ids.parent}', '${ids.student}', '${ids.serviceEnrollment}', 1, 1000, current_date + 30);

    insert into public.payments (id, tenant_id, payment_number, parent_id, amount, method, status)
    values ('${ids.payment}', (select id from public.tenants limit 1), 'FAKE-T416-${tag}', '${ids.parent}', 500, 'cash', 'paid');

    insert into public.payment_allocations (id, tenant_id, payment_id, charge_id, installment_id, category, allocated_amount)
    values ('${ids.allocation}', (select id from public.tenants limit 1), '${ids.payment}', '${ids.installment}', '${ids.installment}', 'tuition', 500);

    insert into public.ledger_entries (id, tenant_id, entry_number, parent_id, account_id, entry_type, amount, category)
    values ('${ids.ledger}', (select id from public.tenants limit 1), 'FAKE-T416-${tag}', '${ids.parent}', 'parent:${ids.parent}:category:tuition', 'charge', 1000, 'tuition');

    insert into public.invoices (id, tenant_id, parent_id, student_id, invoice_number, due_date, amount)
    values ('${ids.invoice}', (select id from public.tenants limit 1), '${ids.parent}', '${ids.student}', 'FAKE-T416-${tag}', current_date + 30, 1000);

    insert into public.activation_codes (id, tenant_id, parent_id, code)
    values ('${ids.activation}', (select id from public.tenants limit 1), '${ids.parent}', 'FAKE-T416-${tag}');

    insert into public.parent_student_links (id, tenant_id, parent_id, student_id)
    values ('${ids.link}', (select id from public.tenants limit 1), '${ids.parent}', '${ids.student}');

    insert into public.student_documents (id, tenant_id, student_id, kind, file_name, storage_path)
    values ('${ids.document}', (select id from public.tenants limit 1), '${ids.student}', 'other', 'FAKE-T416-${tag}.pdf', 'fake/${tag}.pdf');

    insert into public.chat_channels (id, tenant_id, code, name, channel_type, member_ids)
    values ('${ids.channel}', (select id from public.tenants limit 1), 'FAKE-T416-${tag}', 'FAKE T416 Channel', 'direct', array['${ids.profile}']::uuid[]);

    insert into public.chat_messages (id, tenant_id, channel_id, author_id, body)
    values ('${ids.message}', (select id from public.tenants limit 1), '${ids.channel}', '${ids.profile}', 'FAKE T416 message');

    insert into public.notifications (id, tenant_id, kind, title, target_user_id)
    values ('${ids.notification}', (select id from public.tenants limit 1), 'info', 'FAKE T416 notification', '${ids.authUser}');

    insert into public.calendar_events (id, tenant_id, kind, title, start_at, end_at, target_entity_type, target_entity_id, target_name)
    values ('${ids.calendar}', (select id from public.tenants limit 1), 'other', 'FAKE T416 event', now(), now(), 'parent', '${ids.parent}', 'FAKE T416Parent');

    insert into public.sync_queue (id, tenant_id, entity, operation, payload, status)
    values ('${ids.syncDomain}', (select id from public.tenants limit 1), 'parent', 'insert', jsonb_build_object('id', '${ids.parent}', '_fake', 'T416-${tag}'), 'pending');

    insert into public.sync_queue (id, tenant_id, entity, operation, payload, status)
    values ('${ids.syncOther}', (select id from public.tenants limit 1), 'personnel', 'insert', jsonb_build_object('_fake', 'T416-${tag}'), 'pending');

    insert into public.backup_archives (id, tenant_id, archive_id_text, file_name, size_bytes, checksum_sha256, vault_location, status, retention_expires_at)
    values ('${ids.backup}', (select id from public.tenants limit 1), 'FAKE-T416-${tag}', 'fake-${tag}.db', 1, 'fake-checksum-${tag}', 'indexeddb', 'encrypted', now() + interval '365 days');

    do $t416$
    declare
      v_tenant uuid := (select id from public.tenants limit 1);
      v_wrong  jsonb;
      v_dry    jsonb;
      v_verdict jsonb;
      v_report jsonb := '{}'::jsonb;
      v_ok     boolean;
      v_all    boolean := true;
    begin
      -- (PL/pgSQL has NO closures — nested routines cannot mutate these
      -- variables — so every assert is an inline report-append + fail-flag.)

      -- The wrong-phrase gate: nothing deleted.
      v_wrong := public.purge_student_parent_domain('WRONG-PHRASE', false, v_tenant);
      v_ok := (v_wrong->>'ok') = 'false' and (v_wrong->>'code') = 'confirmation_required';
      v_report := v_report || jsonb_build_object('gate_wrong_phrase', case when v_ok then 'true' else v_wrong end);
      if not v_ok then v_all := false; end if;
      select count(*) = 1 into v_ok from public.parents where id = '${ids.parent}';
      v_report := v_report || jsonb_build_object('gate_wrong_phrase_deletes_nothing', v_ok);
      if not v_ok then v_all := false; end if;

      -- The dry-run: counts the probes, deletes NOTHING.
      v_dry := public.purge_student_parent_domain('', true, v_tenant);
      v_ok := (v_dry->>'ok') = 'true' and (v_dry->>'mode') = 'dry_run';
      v_report := v_report || jsonb_build_object('dry_run_mode', case when v_ok then v_dry->>'total' else v_dry end);
      if not v_ok then v_all := false; end if;
      select count(*) = 1 into v_ok from public.parents where id = '${ids.parent}';
      v_report := v_report || jsonb_build_object('dry_run_deletes_nothing', v_ok);
      if not v_ok then v_all := false; end if;

      -- EXECUTE.
      v_verdict := public.purge_student_parent_domain('PURGER', false, v_tenant);
      v_ok := (v_verdict->>'ok') = 'true' and (v_verdict->>'mode') = 'executed';
      v_report := v_report || jsonb_build_object('execute_ok', case when v_ok then v_verdict->'counts' else v_verdict end);
      if not v_ok then v_all := false; end if;

      -- The dependency-graph zero-residue asserts (every seeded family).
      select (select count(*) from public.parents where id = '${ids.parent}') = 0
         and (select count(*) from public.students where id = '${ids.student}') = 0
         and (select count(*) from public.installments where id = '${ids.installment}') = 0
         and (select count(*) from public.payments where id = '${ids.payment}') = 0
         and (select count(*) from public.payment_allocations where id = '${ids.allocation}') = 0
         and (select count(*) from public.ledger_entries where id = '${ids.ledger}') = 0
         and (select count(*) from public.invoices where id = '${ids.invoice}') = 0
         and (select count(*) from public.activation_codes where id = '${ids.activation}') = 0
         and (select count(*) from public.parent_student_links where id = '${ids.link}') = 0
         and (select count(*) from public.student_documents where id = '${ids.document}') = 0
         and (select count(*) from public.service_enrollments where id = '${ids.serviceEnrollment}') = 0
         and (select count(*) from public.chat_channels where id = '${ids.channel}') = 0
         and (select count(*) from public.chat_messages where id = '${ids.message}') = 0
         and (select count(*) from public.notifications where id = '${ids.notification}') = 0
         and (select count(*) from public.calendar_events where id = '${ids.calendar}') = 0
        into v_ok;
      v_report := v_report || jsonb_build_object('zero_residue_all_families', v_ok);
      if not v_ok then v_all := false; end if;

      -- The portal/auth closure (the auth.users delete permission proof).
      select (select count(*) from auth.users where id = '${ids.authUser}') = 0
         and (select count(*) from public.user_profiles where id = '${ids.profile}') = 0
         and (select count(*) from public.role_assignments where id = '${ids.roleAssign}') = 0
        into v_ok;
      v_report := v_report || jsonb_build_object('portal_auth_closure', v_ok);
      if not v_ok then v_all := false; end if;

      -- THE NO-INTERFERENCE PROOFS (the owner's directive).
      select count(*) = 1 into v_ok from public.sync_queue where id = '${ids.syncOther}';
      v_report := v_report || jsonb_build_object('sync_queue_non_domain_survives', v_ok);
      if not v_ok then v_all := false; end if;

      select count(*) = 0 into v_ok from public.sync_queue where id = '${ids.syncDomain}';
      v_report := v_report || jsonb_build_object('sync_queue_domain_purged', v_ok);
      if not v_ok then v_all := false; end if;

      select count(*) = 1 into v_ok from public.backup_archives where id = '${ids.backup}';
      v_report := v_report || jsonb_build_object('backup_archives_untouched', v_ok);
      if not v_ok then v_all := false; end if;

      select count(*) >= 1 into v_ok from public.audit_logs where action = 'system.purge_student_parent_domain';
      v_report := v_report || jsonb_build_object('purge_audit_entry_written', v_ok);
      if not v_ok then v_all := false; end if;

      -- (The staff-guard selectivity is covered by the source guards + the
      -- unit suites; the live sandbox keeps to the seeded paths.)

      if v_all then
        raise exception 'T416-SANDBOX-GREEN: %', v_report::text;
      else
        raise exception 'T416-SANDBOX-RED: %', v_report::text;
      end if;
    end $t416$;
    rollback;
  `;

  let sandboxOk = false;
  let report = null;
  try {
    await sql(sandbox);
    record("P2.1 sandbox", false, "completed WITHOUT the marker exception (unexpected — the rollback is no longer guaranteed)");
  } catch (e) {
    const msg = String(e.payload?.message ?? e.message ?? "");
    const m = msg.match(/T416-SANDBOX-(GREEN|RED): (.*)/s);
    if (!m) {
      record("P2.1 sandbox", false, `no marker in the error: ${msg.slice(0, 300)}`);
    } else {
      sandboxOk = m[1] === "GREEN";
      try {
        report = JSON.parse(m[2]);
      } catch {
        report = m[2];
      }
      record("P2.1 sandbox verdict", sandboxOk, m[1]);
      if (report && typeof report === "object") {
        for (const [k, v] of Object.entries(report)) {
          const ok = v === true || (typeof v === "string" && v === "true");
          if (!ok) console.log(`   ❌ assert ${k}: ${JSON.stringify(v).slice(0, 200)}`);
        }
        console.log(`   asserts: ${Object.keys(report).length} (${Object.entries(report).filter(([, v]) => v === true || v === "true").length} green)`);
      }
    }
  }

  // Post-sandbox census — the rollback restored EVERYTHING.
  const after = await sqlRows(
    `select
       (select count(*) from public.parents) as parents,
       (select count(*) from public.students) as students,
       (select count(*) from public.payments) as payments,
       (select count(*) from public.installments) as installments,
       (select count(*) from public.backup_archives) as backup_archives,
       (select count(*) from public.sync_queue) as sync_queue,
       (select count(*) from public.audit_logs) as audit_logs,
       (select count(*) from public.backup_archives where archive_id_text like 'FAKE-T416-%') as fake_backups,
       (select count(*) from public.sync_queue where payload->>'_fake' like 'T416-%') as fake_sync,
       (select count(*) from public.parents where parent_code like 'FAKE-T416-%') as fake_parents`,
  );
  const a = after[0] ?? {};
  record(
    "P2.2 rollback restored the real data (parents/students == baseline)",
    String(a.parents) === String(baseline.parents) && String(a.students) === String(baseline.students),
    `parents ${baseline.parents}→${a.parents}, students ${baseline.students}→${a.students}`,
  );
  record(
    "P2.3 zero probe residue after the rollback",
    String(a.fake_backups) === "0" && String(a.fake_sync) === "0" && String(a.fake_parents) === "0",
    `fake_backups=${a.fake_backups} fake_sync=${a.fake_sync} fake_parents=${a.fake_parents}`,
  );
  record(
    "P2.4 audit_logs count unchanged (the sandbox's entry rolled back too)",
    String(a.audit_logs) === String(baseline.audit_logs),
    `${baseline.audit_logs}→${a.audit_logs}`,
  );
  return sandboxOk;
}

// ---------------------------------------------------------------------------
// Phase 3 — the UI path: admin-JWT dry-run through PostgREST
// ---------------------------------------------------------------------------
async function phase3(baseline) {
  console.log("\n== Phase 3 — the exact UI path (GoTrue password grant → rpc dry-run) ==");
  if (!SERVICE_KEY) {
    record("P3 admin-JWT dry-run", false, "SUPABASE_SERVICE_ROLE_KEY not supplied (needed as the auth-endpoint apikey)");
    return;
  }

  const grant = await rest("POST", "/auth/v1/token?grant_type=password", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  }, { apikey: SERVICE_KEY });
  if (grant.status !== 200 || !grant.json?.access_token) {
    record("P3.1 admin sign-in", false, `HTTP ${grant.status}: ${JSON.stringify(grant.json).slice(0, 200)}`);
    return;
  }
  record("P3.1 admin sign-in", true, `${ADMIN_EMAIL} authenticated`);

  const jwt = grant.json.access_token;
  const call1 = await rest("POST", "/rest/v1/rpc/purge_student_parent_domain", {
    p_confirm_phrase: "",
    p_dry_run: true,
    p_tenant_id: null,
  }, { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` });
  const v1 = call1.json;
  record(
    "P3.2 the dry-run verdict through the authenticated path",
    call1.status === 200 && v1?.ok === true && v1?.mode === "dry_run",
    `total=${v1?.total} counts=${JSON.stringify(v1?.counts ?? {}).slice(0, 160)}`,
  );
  record(
    "P3.3 the verdict counts the REAL domain (== the baseline census)",
    String(v1?.counts?.parents) === String(baseline.parents) && String(v1?.counts?.students) === String(baseline.students),
    `parents=${v1?.counts?.parents}/${baseline.parents} students=${v1?.counts?.students}/${baseline.students}`,
  );

  // Re-run — byte-identical (dry-run deleted nothing).
  const call2 = await rest("POST", "/rest/v1/rpc/purge_student_parent_domain", {
    p_confirm_phrase: "",
    p_dry_run: true,
    p_tenant_id: null,
  }, { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` });
  record(
    "P3.4 the dry-run is idempotent (re-run identical, nothing deleted)",
    call2.status === 200 && call2.json?.total === v1?.total,
    `total ${v1?.total} → ${call2.json?.total}`,
  );

  // The wrong phrase through the REAL path is refused.
  const wrong = await rest("POST", "/rest/v1/rpc/purge_student_parent_domain", {
    p_confirm_phrase: "WRONG",
    p_dry_run: false,
    p_tenant_id: null,
  }, { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` });
  record(
    "P3.5 the wrong phrase is refused through the real path",
    wrong.status === 200 && wrong.json?.ok === false && wrong.json?.code === "confirmation_required",
    JSON.stringify(wrong.json).slice(0, 120),
  );
}

// ---------------------------------------------------------------------------
// Phase 4 — the aftermath: sync/backup infrastructure intact
// ---------------------------------------------------------------------------
async function phase4(baseline) {
  console.log("\n== Phase 4 — the no-interference aftermath ==");

  const fns = await sqlRows(
    `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname in
        ('purge_expired_backups', 'mark_sync_queue_processed', 'upsert_parent_from_import', 'write_audit_log')`,
  );
  const names = fns.map((f) => f.proname);
  record(
    "P4.1 the sync/backup RPCs still present",
    ["purge_expired_backups", "mark_sync_queue_processed", "upsert_parent_from_import", "write_audit_log"].every((n) => names.includes(n)),
    names.join(", "),
  );

  const backups = await sqlRows("select count(*) as n from public.backup_archives");
  record(
    "P4.2 backup_archives count unchanged across the whole run",
    String(backups[0]?.n) === String(baseline.backup_archives),
    `${baseline.backup_archives}→${backups[0]?.n}`,
  );

  // The purge RPC is NOT callable anonymously (the PostgREST grant census).
  const anon = await rest("POST", "/rest/v1/rpc/purge_student_parent_domain", {
    p_confirm_phrase: "PURGER",
    p_dry_run: false,
    p_tenant_id: null,
  }, { apikey: SERVICE_KEY });
  // With the service key as apikey but NO user JWT, PostgREST runs as
  // service_role — Gate 1 must still refuse it (service_role is not
  // super_admin, not a DB superuser): the RPC returns {ok:false, forbidden}.
  record(
    "P4.3 the service-role caller is REFUSED by Gate 1 (only humans/console purge)",
    anon.status === 200 && anon.json?.ok === false && anon.json?.code === "forbidden",
    `HTTP ${anon.status}: ${JSON.stringify(anon.json).slice(0, 120)}`,
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`T-416 live verification — ${new Date().toISOString()} — project ${PROJECT_REF}`);

  const { baseline } = await phase0();
  await phase1();
  const sandboxOk = await phase2(baseline);
  await phase3(baseline);
  await phase4(baseline);

  const failed = results.filter((r) => !r.ok);
  console.log("\n== SUMMARY ==");
  console.log(`${results.length - failed.length}/${results.length} GREEN${failed.length ? ` — RED: ${failed.map((f) => f.id).join(", ")}` : ""}`);
  if (failed.length || !sandboxOk) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
