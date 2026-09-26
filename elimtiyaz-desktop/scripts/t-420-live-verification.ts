/**
 * t-420-live-verification.ts — the LIVE end-to-end verification of the
 * issue-#20 fix (T-420 Phases 1-3): the Supabase-mode Excel import's
 * financial write path.
 *
 * WHAT THIS PROVES (against the real backend, with the documented admin):
 *
 *   1. The REAL Supabase repositories (SupabaseLedgerRepository /
 *      SupabasePaymentRepository / SupabaseInstallmentRepository — the
 *      classes the desktop uses in Supabase mode, including the FIXED
 *      honest-error bulkAppend/bulkImportInstallments) write the import's
 *      financial data: ledger charges + payments, payment rows, installment
 *      rows with their statuses.
 *   2. The issue-#20 invariant, LIVE: a probe student with prior-year debt
 *      imports with a POSITIVE ledger-replay balance (the live defect was
 *      ZERO charge entries → every student "fully paid").
 *   3. Zero probe residue afterwards (hard cleanup + a post-cleanup census).
 *
 * The probe is run-unique (a timestamp marker in every name/phone/source
 * token) and NEVER touches real parents/students — the real census counts
 * are asserted unchanged at the end.
 *
 * Usage (from elimtiyaz-desktop/):
 *   npx tsx scripts/t-420-live-verification.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── The localStorage polyfill (the shared repositories read the session) ──
// MUST be installed before importing the repository module.
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

const g = globalThis as unknown as { localStorage?: Storage };
if (!g.localStorage) {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

// The session fixture (requireTenantId reads it) — set before the imports
// that capture it at call time.
// NOTE: the userId is patched to the signed-in admin AFTER sign-in (the
// payments' collected_by column requires a real auth uuid).
g.localStorage.setItem("el-imtiyaz.session", JSON.stringify({
  tenantId: TENANT_ID,
  userId: "00000000-0000-0000-0000-000000000000",
  displayName: "T-420 Live Verifier",
}));

// Now the heavy imports (after the polyfill).
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { ImportEngine } from "../src/infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../src/infrastructure/excel/import-engine/storage/repository-adapter";
import {
  SupabaseParentRepository,
  SupabaseStudentRepository,
  SupabaseLedgerRepository,
  SupabasePaymentRepository,
  SupabaseInstallmentRepository,
} from "../src/infrastructure/supabase/repositories/supabase-shared-repositories";

// ── The run-unique probe workbook ──────────────────────────────────────────

const RUN = Date.now().toString().slice(-8); // the run marker
const PROBE_PHONE_BASE = `0559${RUN.padStart(8, "0").slice(-6)}`.slice(0, 10);

interface ProbeSpec {
  name: string;
  phone: string;
  devis: number;
  dettes: number;
  regl: number;
  fi: number; v1: number; v2alt: number; v3: number;
  expectedBalance: number;
  expectStatuses: string[];
}

const PROBES: ProbeSpec[] = [
  {
    name: `T420PROBE${RUN} FULLYPAID`,
    phone: `${PROBE_PHONE_BASE.slice(0, 9)}1`,
    devis: 245_000, dettes: 0, regl: 0,
    fi: 25_000, v1: 95_000, v2alt: 60_000, v3: 65_000,
    expectedBalance: 0,
    expectStatuses: ["paid"],
  },
  {
    name: `T420PROBE${RUN} PARTIAL`,
    phone: `${PROBE_PHONE_BASE.slice(0, 9)}2`,
    devis: 245_000, dettes: 0, regl: 0,
    fi: 25_000, v1: 95_000, v2alt: 0, v3: 0,
    expectedBalance: 125_000,
    expectStatuses: ["paid", "partial", "unpaid"],
  },
  {
    name: `T420PROBE${RUN} DETTES`,
    phone: `${PROBE_PHONE_BASE.slice(0, 9)}3`,
    devis: 245_000, dettes: 20_000, regl: 5_000,
    fi: 25_000, v1: 20_000, v2alt: 0, v3: 0,
    expectedBalance: 215_000,
    expectStatuses: ["partial", "unpaid"],
  },
];

function colIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

async function buildProbeWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ETAT 20262027");
  ws.addRow([
    "", "INFOS", "E-MAIL", "NEM", "TUTEUR", "", "niveau", "CLASSE", "OPTION",
    "REMISE", "JUSTIFICATION", "DEVIS ANNUEL", "REMBOURCEMENT", "DETTES",
    "REGLEMENTS DETTES", "TOTAL VERSEMENTS", "TOTAL*CREANCE", "FI", "V1", "2V",
    "v3", "DISTINATION", "1T", "T2", "t3",
    "PSY1", "PSY2", "PSY3", "PSY4", "PSY5", "PSY6", "PSY7", "PSY8", "PSY9",
    "PSY10", "PSY11", "PSY12", "PSY13", "PSY14",
    "CREANCE SEPT", "CREANCE SEPT", "CREANCE SEPT", "TT CREANCE",
    "COURS SUP", "LIVRES", "CLUB", "SORTIES",
  ]);
  for (const p of PROBES) {
    const row: (string | number | null)[] = new Array(47).fill(null);
    row[colIndex("D") - 1] = p.phone;
    row[colIndex("F") - 1] = p.name;
    row[colIndex("G") - 1] = "PRIM";
    row[colIndex("H") - 1] = "CE1";
    row[colIndex("L") - 1] = p.devis;
    row[colIndex("N") - 1] = p.dettes;
    row[colIndex("O") - 1] = p.regl;
    row[colIndex("R") - 1] = p.fi;
    row[colIndex("S") - 1] = p.v1;
    row[colIndex("T") - 1] = p.v2alt;
    row[colIndex("U") - 1] = p.v3;
    ws.addRow(row);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

// ── SQL helpers (the Management API — superuser, for verification+cleanup) ─

async function sql(query: string): Promise<unknown> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN not set");
  const res = await fetch(
    `https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    throw new Error(`SQL failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  console.log(`T-420 live verification — run marker ${RUN}\n`);

  // 0. Sweep any residue from earlier T-420 probe runs (idempotent) so the
  //    census comparison below is exact.
  await sql(`delete from ledger_entries where student_id in (select id from students where display_name like 'T420PROBE%')`);
  await sql(`delete from payments where student_id in (select id from students where display_name like 'T420PROBE%')`);
  await sql(`delete from installments where student_id in (select id from students where display_name like 'T420PROBE%')`);
  await sql(`delete from students where display_name like 'T420PROBE%'`);
  await sql(`delete from parents where primary_phone like '0559${RUN.slice(0, 6)}%'`);

  // The pre-run census (must be unchanged at the end — zero residue proof).
  const pre = (await sql(
    "select (select count(*) from students where deleted_at is null) s, " +
    "(select count(*) from parents where deleted_at is null) p, " +
    "(select count(*) from ledger_entries) l, (select count(*) from payments) pay, " +
    "(select count(*) from installments) i",
  )) as Array<{ s: string; p: string; l: string; pay: string; i: string }>;
  console.log(`pre-run census: students=${pre[0].s} parents=${pre[0].p} ledger=${pre[0].l} payments=${pre[0].pay} installments=${pre[0].i}`);

  // 1. Sign in as the documented admin.
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  if (signInErr || !signIn.session) {
    console.error(`FATAL: sign-in failed: ${signInErr?.message ?? "no session"}`);
    return 1;
  }
  console.log(`signed in as ${ADMIN_EMAIL}\n`);
  g.localStorage.setItem("el-imtiyaz.session", JSON.stringify({
    tenantId: TENANT_ID,
    userId: signIn.user!.id,
    displayName: "T-420 Live Verifier",
  }));

  // 2. The REAL Supabase repositories (the desktop's Supabase-mode classes).
  const parents = new SupabaseParentRepository(client);
  const students = new SupabaseStudentRepository(client);
  const ledger = new SupabaseLedgerRepository(client);
  const payments = new SupabasePaymentRepository(client);
  const installments = new SupabaseInstallmentRepository(client);

  // The payments table's collected_by column is a UUID (the staff auth id)
  // — the desktop passes session.userId; the probe uses the signed-in admin.
  const actorId = signIn.user!.id;
  const engine = new ImportEngine({
    storage: new RepositoryStorageAdapter({
      parents, students, ledger, payments, installments,
      tenantId: TENANT_ID,
      actorId,
      actorName: "T-420 Live Verifier",
    }),
    auditSink: { async logAction() { /* no-op */ } },
  });

  // 3. The probe import (dry-run first, then the real one).
  const bytes = await buildProbeWorkbook();
  const probePath = path.join(os.tmpdir(), `t420-probe-${RUN}.xlsx`);
  fs.writeFileSync(probePath, bytes);
  const dry = await engine.importFile(bytes, probePath, { dryRun: true });
  console.log(`dry-run: ${dry.stats.rowsRead} rows, ${dry.stats.rowsRejected} rejected`);

  const ctx = await engine.importFile(bytes, probePath, { dryRun: false });
  console.log(
    `import: ${ctx.stats.rowsImported} imported / ${ctx.stats.rowsUpdated} updated / ` +
    `${ctx.stats.rowsSkipped} skipped / ${ctx.stats.rowsRejected} rejected (${ctx.durationMs} ms)`,
  );
  if (ctx.stats.rowsImported !== 3) {
    console.error(`FATAL: expected 3 probe students imported, got ${ctx.stats.rowsImported}`);
    return 1;
  }

  // 4. Verify the financial data landed — per probe student, via SQL.
  let allGreen = true;
  const probeStudentIds: string[] = [];
  for (const p of PROBES) {
    const rows = (await sql(
      `select s.id, s.display_name from students s ` +
      `where s.display_name = '${p.name}'`,
    )) as Array<{ id: string; display_name: string }>;
    if (rows.length !== 1) {
      console.error(`FAIL: probe ${p.name}: ${rows.length} students found`);
      allGreen = false;
      continue;
    }
    const sid = rows[0].id;
    probeStudentIds.push(sid);

    const entries = (await sql(
      `select entry_type, amount, source_id from ledger_entries where student_id = '${sid}' order by source_id`,
    )) as Array<{ entry_type: string; amount: string; source_id: string }>;
    const charges = entries.filter((e) => e.entry_type === "charge")
      .reduce((s, e) => s + Number(e.amount), 0);
    const pays = entries.filter((e) => e.entry_type === "payment")
      .reduce((s, e) => s + Number(e.amount), 0);
    const balance = charges + pays;

    const payRows = (await sql(
      `select count(*) n, coalesce(sum(amount),0) total from payments where student_id = '${sid}'`,
    )) as Array<{ n: string; total: string }>;
    const instRows = (await sql(
      `select status, count(*) n from installments where student_id = '${sid}' group by status`,
    )) as Array<{ status: string; n: string }>;

    const expectedCharges = p.devis + p.dettes;
    const expectedPays = -(p.fi + p.v1 + p.v2alt + p.v3 + p.regl);

    const checks: Array<[string, boolean, string]> = [];
    checks.push([`ledger entries exist (${entries.length})`, entries.length > 0, `${entries.length}`]);
    checks.push([`Σ charges == devis+dettes`, charges === expectedCharges, `${charges} vs ${expectedCharges}`]);
    checks.push([`Σ payment credits == −(payments)`, pays === expectedPays, `${pays} vs ${expectedPays}`]);
    checks.push([`ledger-replay balance == ${p.expectedBalance}`, balance === p.expectedBalance, `${balance}`]);
    if (p.dettes > 0) {
      const hasDettes = entries.some((e) => e.source_id?.endsWith(":DETTES"));
      checks.push([`the DETTES charge entry exists`, hasDettes, entries.map((e) => e.source_id).join(",")]);
    }
    checks.push([`payment rows (${payRows[0].n})`, Number(payRows[0].n) > 0, `Σ ${payRows[0].total}`]);
    const statuses = instRows.map((r) => r.status);
    for (const st of p.expectStatuses) {
      checks.push([`an installment with status ${st}`, statuses.includes(st), statuses.join(",")]);
    }

    let probeGreen = true;
    for (const [label, ok, detail] of checks) {
      if (!ok) probeGreen = false;
      console.log(`  [${ok ? "PASS" : "FAIL"}] ${p.name}: ${label} (${detail})`);
    }
    if (!probeGreen) allGreen = false;
    console.log("");
  }

  // THE issue-#20 invariant, stated LIVE: the debt probe's balance is > 0.
  const debtProbe = PROBES[2];
  const debtBal = (await sql(
    `select coalesce(sum(amount), 0) bal ` +
    `from ledger_entries le join students s on s.id = le.student_id ` +
    `where s.display_name = '${debtProbe.name}'`,
  )) as Array<{ bal: string }>;
  const debtBalance = Number(debtBal[0].bal);
  const debtOk = debtBalance === debtProbe.expectedBalance && debtBalance > 0;
  console.log(`  [${debtOk ? "PASS" : "FAIL"}] THE ISSUE-#20 INVARIANT (live): the debt probe replays to ${debtBalance} DZD (> 0 — NOT "fully paid")`);
  if (!debtOk) allGreen = false;

  // 5. Cleanup — hard-delete EVERY T420PROBE row (this run AND any residue
  //    from earlier probe runs — e.g. a failed run's already-flushed ledger
  //    entries whose students were soft-deleted by the compensating
  //    rollback; the rollback compensates parents/students, not the
  //    financial rows that landed before the failure). Superuser SQL.
  await sql(`delete from ledger_entries where student_id in (select id from students where display_name like 'T420PROBE%')`);
  await sql(`delete from payments where student_id in (select id from students where display_name like 'T420PROBE%')`);
  await sql(`delete from installments where student_id in (select id from students where display_name like 'T420PROBE%')`);
  await sql(`delete from ledger_entries where parent_id in (select parent_id from students where display_name like 'T420PROBE%')`);
  await sql(`delete from payments where parent_id in (select parent_id from students where display_name like 'T420PROBE%')`);
  await sql(`delete from installments where parent_id in (select parent_id from students where display_name like 'T420PROBE%')`);
  await sql(`delete from students where display_name like 'T420PROBE%'`);
  await sql(`delete from parents where primary_phone like '0559${RUN.slice(0, 6)}%'`);
  // The audit trail is append-only (§15.26) — probe audit rows stay.

  const post = (await sql(
    "select (select count(*) from students where deleted_at is null) s, " +
    "(select count(*) from parents where deleted_at is null) p, " +
    "(select count(*) from ledger_entries) l, (select count(*) from payments) pay, " +
    "(select count(*) from installments) i",
  )) as Array<{ s: string; p: string; l: string; pay: string; i: string }>;
  const residueOk =
    post[0].s === pre[0].s && post[0].p === pre[0].p &&
    post[0].l === pre[0].l && post[0].pay === pre[0].pay && post[0].i === pre[0].i;
  console.log(`\npost-cleanup census: students=${post[0].s} parents=${post[0].p} ledger=${post[0].l} payments=${post[0].pay} installments=${post[0].i}`);
  console.log(`  [${residueOk ? "PASS" : "FAIL"}] zero probe residue (the census is byte-identical to pre-run)`);
  if (!residueOk) allGreen = false;

  console.log(`\n${allGreen ? "ALL GREEN — the issue-#20 fix is live-verified end-to-end." : "FAILURES DETECTED — see the matrix above."}`);
  return allGreen ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
