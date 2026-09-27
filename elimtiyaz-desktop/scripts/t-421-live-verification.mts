/**
 * t-421-live-verification.mts — the DEFINITIVE re-import verification.
 *
 * THE SCENARIO (the owner's 2026-09-26 23:00:40 failure, issue #20's
 * follow-up): re-import the REAL `2027-2026.xlsx` over a database that
 * ALREADY holds its complete import (1,137 students / 3,342 ledger /
 * 2,198 payments / 5,963 installments — the 104th session's verified state).
 *
 * BEFORE T-421 this dies deterministically: PostgREST's `ignoreDuplicates`
 * arbitrates only the primary key (live-proven 23505), so the payments
 * flush — which had NO cross-run filter — fails on its very first
 * all-conflicting chunk; the ledger follows whenever its cache-based
 * filter is empty; the installments Err is dropped; the message lies
 * about "aucune écriture partielle"; and the rollback soft-deletes every
 * student the upserts touched.
 *
 * AFTER T-421 the expected result:
 *   1. The import SUCCEEDS (no throw).
 *   2. Stats: ~0 imported / ~1,139 updated / 2 skipped — the students
 *      match the snapshot (fresh process seeds from the DB) and UPDATE.
 *   3. The financial flush is a NO-OP: the DB preflight filters every
 *      pending row, so the bulk calls receive 0 rows (instrumented here).
 *   4. The census is UNCHANGED before/after — the no-op proof.
 *
 * No SUPABASE_ACCESS_TOKEN needed: the census runs through the admin REST
 * session (counts only).
 *
 * Usage (from elimtiyaz-desktop/):
 *   node --experimental-strip-types scripts/t-421-live-verification.mts
 *   (or) npx tsx scripts/t-421-live-verification.mts
 */
import * as fs from "node:fs";
import * as path from "node:path";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

const g = globalThis as unknown as { localStorage?: Storage };
if (!g.localStorage) {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}
g.localStorage.setItem("el-imtiyaz.session", JSON.stringify({
  tenantId: TENANT_ID,
  userId: "00000000-0000-0000-0000-000000000000",
  displayName: "T-421 Live Verifier",
}));

async function main(): Promise<number> {
  const { createClient } = await import("@supabase/supabase-js");
  const { ImportEngine } = await import("../src/infrastructure/excel/import-engine/index");
  const { RepositoryStorageAdapter } = await import("../src/infrastructure/excel/import-engine/storage/repository-adapter");
  const repos = await import("../src/infrastructure/supabase/repositories/supabase-shared-repositories");

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
  g.localStorage.setItem("el-imtiyaz.session", JSON.stringify({
    tenantId: TENANT_ID,
    userId: signIn.user.id,
    displayName: "T-421 Live Verifier",
  }));
  console.log(`signed in as ${ADMIN_EMAIL}\n`);

  // ── Census helper (admin REST — counts only) ────────────────────────────
  async function census(label: string) {
    const out: Record<string, number | string> = {};
    for (const [table, col, softDelete] of [
      ["students", "id", true], ["parents", "id", true],
      ["ledger_entries", "id", false], ["payments", "id", false], ["installments", "id", false],
    ] as const) {
      let q = client
        .from(table)
        .select(col, { count: "exact", head: true })
        .eq("tenant_id", TENANT_ID);
      if (softDelete) q = q.is("deleted_at", null);
      const { count, error } = await q;
      out[table] = error ? `ERR ${error.message}` : (count ?? 0);
    }
    console.log(`census ${label}:`, JSON.stringify(out));
    return out;
  }

  const before = await census("BEFORE");
  const EXPECT = { students: 1137, ledger_entries: 3342, payments: 2198, installments: 5963 };

  // ── The REAL repositories (the desktop's Supabase-mode classes) ─────────
  const parents = new repos.SupabaseParentRepository(client);
  const students = new repos.SupabaseStudentRepository(client);
  const ledger = new repos.SupabaseLedgerRepository(client);
  const payments = new repos.SupabasePaymentRepository(client);
  const installments = new repos.SupabaseInstallmentRepository(client);

  // ── Instrumentation: how many rows does the flush actually ATTEMPT? ────
  const attempted = { ledger: -1, payments: -1, installments: -1, preflightKeys: -1, preflightReceipts: -1, preflightIdentities: -1 };
  const origLedgerKeys = ledger.listImportLedgerSourceKeys.bind(ledger);
  (ledger as unknown as { listImportLedgerSourceKeys: () => Promise<Set<string>> }).listImportLedgerSourceKeys =
    async () => { const s = await origLedgerKeys(); attempted.preflightKeys = s.size; return s; };
  const origAppend = ledger.bulkAppendWithProgress.bind(ledger);
  (ledger as unknown as { bulkAppendWithProgress: (e: unknown[]) => Promise<unknown> }).bulkAppendWithProgress =
    async (entries: never[]) => { attempted.ledger = entries.length; return origAppend(entries); };
  const origReceipts = payments.listImportPaymentNumbers.bind(payments);
  (payments as unknown as { listImportPaymentNumbers: () => Promise<Set<string>> }).listImportPaymentNumbers =
    async () => { const s = await origReceipts(); attempted.preflightReceipts = s.size; return s; };
  const origCollect = payments.bulkCollectWithProgress.bind(payments);
  (payments as unknown as { bulkCollectWithProgress: (i: unknown[]) => Promise<unknown> }).bulkCollectWithProgress =
    async (inputs: never[]) => { attempted.payments = inputs.length; return origCollect(inputs); };
  const origIdentities = installments.listImportInstallmentIdentities.bind(installments);
  (installments as unknown as { listImportInstallmentIdentities: () => Promise<Set<string>> }).listImportInstallmentIdentities =
    async () => { const s = await origIdentities(); attempted.preflightIdentities = s.size; return s; };
  const origImport = installments.bulkImportInstallmentsWithProgress.bind(installments);
  (installments as unknown as { bulkImportInstallmentsWithProgress: (i: unknown[]) => Promise<unknown> }).bulkImportInstallmentsWithProgress =
    async (inputs: never[]) => { attempted.installments = inputs.length; return origImport(inputs); };

  const engine = new ImportEngine({
    storage: new RepositoryStorageAdapter({
      parents, students, ledger, payments, installments,
      tenantId: TENANT_ID,
      actorId: signIn.user.id,
      actorName: "T-421 Live Verifier",
    }),
    auditSink: { async logAction() { /* no-op */ } },
  });

  // ── The REAL workbook — the exact file of the 23:00 runs ────────────────
  const REPO_ROOT = path.resolve(import.meta.dirname, "..");
  const XLSX_CANDIDATES = [
    path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
    path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
  ];
  const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p))!;
  const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH));
  console.log(`workbook: ${XLSX_PATH} (${bytes.length} bytes)\n`);

  // ── The re-import (the owner's exact action) ────────────────────────────
  const t0 = Date.now();
  let ctx;
  try {
    ctx = await engine.importFile(bytes, "2027-2026.xlsx", { dryRun: false });
  } catch (e) {
    console.error(`\nIMPORT FAILED (the T-421 defect would still be live):\n${(e as Error).message}`);
    const after = await census("AFTER-FAILURE");
    void after;
    return 1;
  }
  const durS = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nimport SUCCEEDED in ${durS}s`);
  console.log(`stats: ${JSON.stringify(ctx.stats)}`);
  console.log(`flush attempted rows: ${JSON.stringify(attempted)}`);

  const after = await census("AFTER");

  // ── The verdict ──────────────────────────────────────────────────────────
  let green = true;
  const checks: Array<[string, boolean, string]> = [];
  checks.push(["no-throw", true, "the re-import completed without the duplicate-key flush failure"]);
  checks.push([
    "students unchanged",
    before.students === after.students && after.students === EXPECT.students,
    `${before.students} → ${after.students} (expected ${EXPECT.students})`,
  ]);
  checks.push([
    "ledger unchanged",
    before.ledger_entries === after.ledger_entries && after.ledger_entries === EXPECT.ledger_entries,
    `${before.ledger_entries} → ${after.ledger_entries} (expected ${EXPECT.ledger_entries})`,
  ]);
  checks.push([
    "payments unchanged",
    before.payments === after.payments && after.payments === EXPECT.payments,
    `${before.payments} → ${after.payments} (expected ${EXPECT.payments})`,
  ]);
  checks.push([
    "installments unchanged",
    before.installments === after.installments && after.installments === EXPECT.installments,
    `${before.installments} → ${after.installments} (expected ${EXPECT.installments})`,
  ]);
  // -1 = the bulk method was never invoked (the preflight filtered the
  // stream to 0 rows — the strongest form of the no-op).
  const none = (n: number) => n === 0 || n === -1;
  checks.push([
    "financial flush was a no-op (0 rows attempted per stream)",
    none(attempted.ledger) && none(attempted.payments) && none(attempted.installments),
    `attempted ledger=${attempted.ledger} payments=${attempted.payments} installments=${attempted.installments} (-1 = never invoked)`,
  ]);
  checks.push([
    "the preflight read the live identities (3342/2198/5963-shaped sets)",
    attempted.preflightKeys === EXPECT.ledger_entries &&
      attempted.preflightReceipts === EXPECT.payments &&
      attempted.preflightIdentities === EXPECT.installments,
    `preflight sets: ledger=${attempted.preflightKeys} payments=${attempted.preflightReceipts} installments=${attempted.preflightIdentities}`,
  ]);
  checks.push([
    "honest stats: ~0 imported / ~1139 updated (no more '1137 imported' upsert miscount)",
    ctx.stats.rowsImported <= 2 && ctx.stats.rowsUpdated >= 1130,
    `imported=${ctx.stats.rowsImported} updated=${ctx.stats.rowsUpdated} skipped=${ctx.stats.rowsSkipped} rejected=${ctx.stats.rowsRejected}`,
  ]);

  console.log("\n── VERDICT ──");
  for (const [name, ok, detail] of checks) {
    console.log(`  ${ok ? "✔" : "✘"}  ${name} — ${detail}`);
    if (!ok) green = false;
  }
  console.log(`\n${green ? "ALL GREEN — the re-import is a clean, verified no-op." : "FAILURES PRESENT — see above."}`);
  return green ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
