#!/usr/bin/env node
/**
 * T-415 (issue #13) — LIVE Supabase backup/restore/sync/recovery verification.
 *
 * The issue-#13 mandate: "A backup must not be considered successful merely
 * because a backup artifact was produced. Perform an actual restore and
 * validate the restored state… Supabase becomes temporarily unavailable…"
 *
 * This script verifies the SERVER side of the pipeline against the LIVE
 * project (vebfehrpzajhstyhinnw) — §15.38 discipline: run-unique probe rows
 * only, zero residue, never touching real business rows.
 *
 *   PHASE A — the backup_archives metadata pipeline (migration 0013/0019/0022):
 *     A1. probe insert → read-back (every column)
 *     A2. status transitions: encrypted → restored (+restored_at/by) → corrupted
 *     A3. the purge_expired_backups RPC: an EXPIRED probe purged, a FRESH
 *         probe untouched (selectivity), status='purged'
 *     A4. manual delete + zero-residue verification
 *
 *   PHASE B — the audit trail (migration 0014):
 *     B1. write_audit_log RPC (probe entry — append-only journals keep
 *         their evidence by design)
 *     B2. UPDATE blocked + DELETE blocked (the append-only triggers)
 *
 *   PHASE C — the sync queue + the canonical push RPCs (migration 0027):
 *     C1. sync_queue probe insert → mark_sync_queue_processed('synced') →
 *         status + pushed_at verified → residue deleted
 *     C2. the invalid-status rejection (contract guard)
 *     C3. upsert_parent_from_import IDEMPOTENCY: the same payload twice →
 *         exactly ONE row, values byte-stable → residue deleted
 *
 *   PHASE D — the read-only full-database integrity sweep (the "restored
 *     system must be internally consistent" bar, applied to the live state):
 *     D1. table inventory + row counts (the core business tables)
 *     D2. FK orphan checks (students→parents, payments→parents, ledger,
 *         receipts, installments…)
 *     D3. business-key uniqueness (parent_code, student_code)
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ACCESS_TOKEN=… \
 *     node scripts/t-415-live-verification.mjs
 */
import process from "node:process";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = "vebfehrpzajhstyhinnw";

if (!SERVICE_KEY || !ACCESS_TOKEN) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ACCESS_TOKEN env vars.");
  process.exit(2);
}

const REST = `${SUPABASE_URL}/rest/v1`;
const MGMT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const RUN_TAG = `t415-${Date.now().toString(36)}`;
const results = [];
let tenantId = null;
let residue = []; // things to clean at the end (backup_archives + sync_queue + parents probes)

function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${id}${detail ? ` — ${detail}` : ""}`);
}

async function rest(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${REST}${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* raw text */
  }
  return { status: res.status, json, text };
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
    throw new Error(`SQL failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return Array.isArray(json) ? json : [];
}

async function rpc(fn, params) {
  return rest("POST", `/rpc/${fn}`, params);
}

/* ── Preflight ─────────────────────────────────────────────────────── */
async function preflight() {
  console.log(`\n════ T-415 LIVE VERIFICATION — run tag ${RUN_TAG} ════\n`);
  const tenants = await sql("select id, name from tenants order by created_at limit 1;");
  tenantId = tenants[0]?.id;
  if (!tenantId) throw new Error("no tenant row found");
  console.log(`Tenant: ${tenants[0].name} (${tenantId})\n`);
}

/* ── PHASE A: backup_archives ──────────────────────────────────────── */
async function phaseA() {
  console.log("── PHASE A — the backup_archives metadata pipeline ──");

  const probeId = `${RUN_TAG}-probe.db`;
  const freshArchive = {
    tenant_id: tenantId,
    archive_id_text: probeId,
    file_name: probeId,
    size_bytes: 12345,
    checksum_sha256: "a".repeat(64),
    vault_location: "indexeddb",
    status: "encrypted",
    retention_expires_at: new Date(Date.now() + 365 * 864e5).toISOString(),
    created_by: null,
    metadata: { parentCount: 3, studentCount: 5, createdByName: "t415-live-probe", runTag: RUN_TAG },
  };

  // A1 — insert + read-back.
  const ins = await rest("POST", "/backup_archives", freshArchive);
  residue.push(probeId);
  record("A1.insert", ins.status === 201 || ins.status === 200, `HTTP ${ins.status}${ins.text ? ` ${ins.text.slice(0, 120)}` : ""}`);
  const readBack = await rest("GET", `/backup_archives?archive_id_text=eq.${probeId}&select=*`);
  const row = readBack.json?.[0];
  record(
    "A1.readback",
    !!row &&
      row.tenant_id === tenantId &&
      row.size_bytes === 12345 &&
      row.checksum_sha256 === freshArchive.checksum_sha256 &&
      row.vault_location === "indexeddb" &&
      row.status === "encrypted" &&
      row.metadata?.runTag === RUN_TAG,
    row ? `columns verified (status=${row.status})` : readBack.text?.slice(0, 120),
  );

  // A2 — status transitions on the server row.
  const upd1 = await rest("PATCH", `/backup_archives?archive_id_text=eq.${probeId}`, {
    status: "restored",
    restored_at: new Date().toISOString(),
  });
  const r1 = (await rest("GET", `/backup_archives?archive_id_text=eq.${probeId}&select=status,restored_at`)).json?.[0];
  record("A2.restored-transition", upd1.status >= 200 && upd1.status < 300 && r1?.status === "restored" && !!r1?.restored_at, `status=${r1?.status}`);
  const upd2 = await rest("PATCH", `/backup_archives?archive_id_text=eq.${probeId}`, { status: "corrupted" });
  const r2 = (await rest("GET", `/backup_archives?archive_id_text=eq.${probeId}&select=status`)).json?.[0];
  record("A2.corrupted-transition", upd2.status >= 200 && upd2.status < 300 && r2?.status === "corrupted", `status=${r2?.status}`);

  // A3 — the purge RPC: an EXPIRED probe purged, the FRESH probe untouched.
  const expiredId = `${RUN_TAG}-expired.db`;
  await rest("POST", "/backup_archives", {
    ...freshArchive,
    archive_id_text: expiredId,
    file_name: expiredId,
    status: "encrypted",
    retention_expires_at: new Date(Date.now() - 864e5).toISOString(), // expired yesterday
    restored_at: null,
  });
  residue.push(expiredId);
  const purge = await rpc("purge_expired_backups", { p_tenant_id: tenantId });
  const expiredRow = (await rest("GET", `/backup_archives?archive_id_text=eq.${expiredId}&select=status,restored_at`)).json?.[0];
  const freshRow = (await rest("GET", `/backup_archives?archive_id_text=eq.${probeId}&select=status`)).json?.[0];
  record(
    "A3.purge-rpc",
    purge.status >= 200 && purge.status < 300 && expiredRow?.status === "purged" && freshRow?.status === "corrupted",
    `expired→${expiredRow?.status}, fresh stays ${freshRow?.status} (selectivity)`,
  );

  // A4 — manual delete + zero residue.
  const del1 = await rest("DELETE", `/backup_archives?archive_id_text=eq.${probeId}`);
  const del2 = await rest("DELETE", `/backup_archives?archive_id_text=eq.${expiredId}`);
  const left = await rest("GET", `/backup_archives?or=(archive_id_text.eq.${probeId},archive_id_text.eq.${expiredId})&select=archive_id_text`);
  record("A4.manual-delete-zero-residue", (del1.status < 300 && del2.status < 300 && (left.json ?? []).length === 0), `residue rows: ${(left.json ?? []).length}`);
}

/* ── PHASE B: audit_logs ───────────────────────────────────────────── */
async function phaseB() {
  console.log("\n── PHASE B — the audit trail (append-only) ──");

  // B1 — the canonical write RPC (the probe entry REMAINS: append-only
  // journals keep their evidence — this row IS the verification record).
  const w = await rpc("write_audit_log", {
    p_tenant_id: tenantId,
    p_action: "backup.live_verification",
    p_entity_type: "backup",
    p_actor_name: "t415-live-probe",
    p_note: `T-415 live verification run ${RUN_TAG} — the backup/restore/sync/recovery probe round-trip (issue #13).`,
  });
  record("B1.write_audit_log", w.status >= 200 && w.status < 300, `HTTP ${w.status}${w.text && w.status >= 300 ? ` ${w.text.slice(0, 120)}` : ""}`);

  // B2 — UPDATE and DELETE must be BLOCKED (the 0014 append-only triggers).
  // Target the PROBE entry (a row that exists, so the BEFORE trigger
  // actually fires — a no-row UPDATE would 204 vacuously). The trigger
  // blocks the mutation, so the probe row stays intact (append-only
  // evidence by design).
  const probeAudit = (await rest("GET", `/audit_logs?note=like.*${RUN_TAG}*&select=id&order=created_at.desc&limit=1`)).json?.[0];
  if (!probeAudit?.id) {
    record("B2.append-only-enforced", false, "probe audit entry not found for the tamper test");
  } else {
    const up = await rest("PATCH", `/audit_logs?id=eq.${probeAudit.id}`, { note: "tamper" });
    const del = await rest("DELETE", `/audit_logs?id=eq.${probeAudit.id}`);
    const stillThere = (await rest("GET", `/audit_logs?id=eq.${probeAudit.id}&select=id,note`)).json?.[0];
    record(
      "B2.append-only-enforced",
      (up.status >= 400 || /append-only/i.test(up.text ?? "")) &&
        (del.status >= 400 || /append-only/i.test(del.text ?? "")) &&
        !!stillThere &&
        !/tamper/.test(String(stillThere?.note ?? "")),
      `UPDATE→HTTP ${up.status}, DELETE→HTTP ${del.status}, row intact=${!!stillThere}`,
    );
  }
}

/* ── PHASE C: sync_queue + the canonical push RPC ──────────────────── */
async function phaseC() {
  console.log("\n── PHASE C — the sync queue + the canonical push RPC ──");

  // C1 — sync_queue probe + mark_sync_queue_processed.
  const queueId = `sync-${RUN_TAG}`;
  const qIns = await rest("POST", "/sync_queue", {
    id: queueId,
    tenant_id: tenantId,
    entity: "parent",
    operation: "insert",
    actor_id: "t415-live-probe",
    payload: { parent_code: `PAR-${RUN_TAG.toUpperCase()}`, first_name: "Probe", last_name: "T415" },
    status: "pending",
  });
  residue.push(`sync_queue:${queueId}`);
  const mark = await rpc("mark_sync_queue_processed", { p_id: queueId, p_status: "synced" });
  const qRow = (await rest("GET", `/sync_queue?id=eq.${queueId}&select=status,pushed_at`)).json?.[0];
  record(
    "C1.mark_sync_queue_processed",
    qIns.status < 300 && mark.status >= 200 && mark.status < 300 && qRow?.status === "synced" && !!qRow?.pushed_at,
    `status=${qRow?.status}, pushed_at set=${!!qRow?.pushed_at}`,
  );

  // C2 — the invalid-status guard.
  const bad = await rpc("mark_sync_queue_processed", { p_id: queueId, p_status: "bogus" });
  record("C2.invalid-status-rejected", bad.status >= 400, `HTTP ${bad.status} ${/Invalid status/i.test(bad.text ?? "") ? "(guard fired)" : ""}`);

  // C3 — upsert_parent_from_import IDEMPOTENCY (the desktop push contract).
  const parentCode = `PAR-T415-${RUN_TAG.toUpperCase()}`;
  const args = {
    p_tenant_id: tenantId,
    p_parent_code: parentCode,
    p_first_name: "Idempotence",
    p_last_name: "Probe",
    p_primary_phone: "0550-000-000",
    p_occupation: "t415-live-probe",
  };
  const up1 = await rpc("upsert_parent_from_import", args);
  const up2 = await rpc("upsert_parent_from_import", args); // the RETRY
  const rows = (await rest("GET", `/parents?parent_code=eq.${parentCode}&select=parent_code,first_name,last_name,primary_phone,occupation`)).json ?? [];
  record(
    "C3.upsert-idempotency",
    up1.status < 300 && up2.status < 300 && rows.length === 1 && rows[0].first_name === "Idempotence" && rows[0].occupation === "t415-live-probe",
    `two identical pushes → ${rows.length} row(s)`,
  );

  // Cleanup: delete the sync_queue + parent probe rows (zero residue).
  await rest("DELETE", `/sync_queue?id=eq.${queueId}`);
  await rest("DELETE", `/parents?parent_code=eq.${parentCode}`);
  const qLeft = (await rest("GET", `/sync_queue?id=eq.${queueId}&select=id`)).json ?? [];
  const pLeft = (await rest("GET", `/parents?parent_code=eq.${parentCode}&select=id`)).json ?? [];
  record("C3.zero-residue", qLeft.length === 0 && pLeft.length === 0, `sync_queue: ${qLeft.length}, parents: ${pLeft.length}`);
}

/* ── PHASE D: the read-only integrity sweep ────────────────────────── */
async function phaseD() {
  console.log("\n── PHASE D — the read-only full-database integrity sweep ──");

  // D1 — table inventory + counts (introspection-driven: the live schema is
  // the authority — e.g. migration 0007's `receipts` table is absent live,
  // a documented file-chain/live divergence).
  const present = new Set(
    (await sql(`select table_name from information_schema.tables where table_schema = 'public';`)).map(
      (r) => r.table_name,
    ),
  );
  const wanted = [
    "tenants", "parents", "students", "payments", "installments",
    "ledger_entries", "payment_allocations", "account_adjustments",
    "invoices", "classes", "academic_years", "attendance_records",
    "homework", "personnel", "expense_tickets", "audit_logs",
    "sync_queue", "backup_archives",
  ];
  const available = wanted.filter((t) => present.has(t));
  const missing = wanted.filter((t) => !present.has(t));
  const countSelects = available.map((t) => `(select count(*) from ${t}) as ${t}`).join(",\n      ");
  const counts = await sql(`select\n      ${countSelects};`);
  const c = counts[0] ?? {};
  const countLine = Object.entries(c)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  record(
    "D1.table-inventory",
    counts.length === 1 && available.length >= 15,
    `${countLine || "all zero"}${missing.length ? ` | absent live: ${missing.join(", ")}` : ""}`,
  );

  // D2 — FK orphan checks (the internal-consistency bar).
  const orphans = await sql(`
    select
      (select count(*) from students s left join parents p on s.parent_id = p.id where s.parent_id is not null and p.id is null) as orphan_students_parent,
      (select count(*) from students s left join classes cl on s.class_id = cl.id where s.class_id is not null and cl.id is null) as orphan_students_class,
      (select count(*) from payments pay left join parents p on pay.parent_id = p.id where pay.parent_id is not null and p.id is null) as orphan_payments_parent,
      (select count(*) from ledger_entries le left join parents p on le.parent_id = p.id where le.parent_id is not null and p.id is null) as orphan_ledger_parent,
      (select count(*) from attendance_records ar left join students s on ar.student_id = s.id where ar.student_id is not null and s.id is null) as orphan_attendance_student,
      (select count(*) from homework h left join classes cl on h.class_id = cl.id where h.class_id is not null and cl.id is null) as orphan_homework_class;
  `);
  const o = orphans[0] ?? {};
  const orphanTotal = Object.values(o).reduce((a, v) => a + Number(v), 0);
  const orphanLine = Object.entries(o)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  record("D2.fk-orphans", orphanTotal === 0, orphanTotal === 0 ? "zero orphans across the six live FK families" : orphanLine);

  // D3 — business-key uniqueness.
  const dups = await sql(`
    select
      (select count(*) from (select parent_code from parents group by parent_code having count(*) > 1) d) as dup_parent_codes,
      (select count(*) from (select student_code from students where student_code is not null group by student_code having count(*) > 1) d) as dup_student_codes;
  `);
  const d = dups[0] ?? {};
  record(
    "D3.business-key-uniqueness",
    Number(d.dup_parent_codes) === 0 && Number(d.dup_student_codes) === 0,
    `dup parent_codes=${d.dup_parent_codes}, dup student_codes=${d.dup_student_codes}`,
  );
}

/* ── Run ───────────────────────────────────────────────────────────── */
async function main() {
  try {
    await preflight();
    await phaseA();
    await phaseB();
    await phaseC();
    await phaseD();
  } catch (err) {
    record("FATAL", false, err instanceof Error ? err.message : String(err));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n════ RESULT: ${results.length - failed.length}/${results.length} GREEN ════`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  ❌ ${f.id} — ${f.detail}`);
    process.exit(1);
  }
  console.log("Zero residue. The audit probe entry remains (append-only evidence).");
}

await main();
