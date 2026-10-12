/**
 * t505-sync-backup-repro.ts — the live reproduction of the owner's Sync &
 * Backup session (the 156th session's investigation mandate).
 *
 * WHAT THIS PROBES (the owner's exact test round, through the app's REAL
 * code paths):
 *   A. sign-in → the app's OWN client + session (the exact wiring the
 *      packaged app uses) → the REAL Supabase repositories
 *   B. repos.backups.runBackup() — the warmed backup (BKUP-508 seam)
 *   C. IMMEDIATE restore of the just-created archive (the owner's Oct-4
 *      timing pattern that produced the GCM restore_failed × 3)
 *   D. the SECOND restore (the retry that succeeded)
 *   E. the ExportDialog's EXACT data-collection pattern (cold reactive
 *      streams) → buildExcelOnlyExport — the owner's ZIP-of-Excel mandate
 *   F. buildEntireArchiveExport — the vault export
 *   G. the sync flow: the SyncService with the Supabase push handler +
 *      syncNow (the empty queue's honest no-op)
 *   H. cleanup: the probe archive + its mirror row removed
 *
 * Usage:
 *   npx tsx scripts/t505-sync-backup-repro.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

// ── Environment shims — BEFORE any src import ──────────────────────────────
import "fake-indexeddb/auto";

const memStore = new Map<string, string>();
const localStorageShim = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size; },
};
(globalThis as Record<string, unknown>).localStorage = localStorageShim;
(globalThis as Record<string, unknown>).window = {
  localStorage: localStorageShim,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

// The REAL src modules (imported AFTER the shims)
import { getSupabaseRepositories } from "../src/infrastructure/supabase/supabase-repositories";
import { setBackupPassphrase, getRestoredFromMarker } from "../src/infrastructure/backup/backup-service";
import { getArchive, clearVault } from "../src/infrastructure/backup/indexed-db-vault";
import {
  buildEntireArchiveExport,
  buildExcelOnlyExport,
} from "../src/infrastructure/export/archive-export";

// ── Constants ───────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = process.env.T505_ADMIN_EMAIL ?? "admin@elimtiyaz.dz";
const ADMIN_PASSWORD = process.env.T505_ADMIN_PASSWORD ?? "elimtiyaz@admin2026";
const TAG = `t505-${Date.now().toString(36)}`;
const BACKUP_PASSPHRASE = `fake-${TAG}-probe-passphrase`;

const log = (...a: unknown[]) => console.log(`[${TAG}]`, ...a);
const results: Array<[string, boolean, string]> = [];
function record(id: string, ok: boolean, note = ""): void {
  results.push([id, ok, note]);
  log(`${ok ? "PASS" : "FAIL"} — ${id}${note ? ` — ${note}` : ""}`);
}

async function main(): Promise<void> {
  // ── A. sign-in through the app's OWN client ─────────────────────────────
  localStorageShim.setItem(
    "el-imtiyaz.local-config",
    JSON.stringify({ supabase_url: SUPABASE_URL, supabase_anon_key: PUBLISHABLE_KEY, supabase_use_supabase: true }),
  );
  const { getSupabaseClient } = await import("../src/infrastructure/supabase/supabase-client");
  const client = getSupabaseClient();
  const signIn = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (signIn.error || !signIn.data?.user) {
    throw new Error(`app-client sign-in failed: ${signIn.error?.message ?? "no user"}`);
  }
  const actorId = signIn.data.user.id;
  record("A1 admin sign-in (the app's own client)", true, signIn.data.user.email ?? "");

  // The app's session shape in localStorage (getTenantId reads this).
  localStorageShim.setItem(
    "el-imtiyaz.session",
    JSON.stringify({
      userId: actorId,
      tenantId: "00000000-0000-0000-0000-000000000001",
      email: signIn.data.user.email,
      displayName: "T505 Probe",
      role: "super_admin",
      permissions: [],
      accessToken: "probe",
      refreshToken: "probe",
      expiresAt: Date.now() + 3600_000,
      locale: "fr",
    }),
  );

  // ── B. the REAL repositories + the warmed backup ────────────────────────
  const repos = getSupabaseRepositories();
  record("B1 supabase repositories wired", true, `${Object.keys(repos).length} slots`);

  await clearVault();
  setBackupPassphrase(BACKUP_PASSPHRASE);

  const t0 = Date.now();
  const backupRun = await repos.backups.runBackup(actorId, "T505 Probe");
  record("B2 runBackup (warmed)", backupRun.ok, backupRun.ok
    ? `${backupRun.value.sizeBytes} bytes in ${Date.now() - t0}ms — counts: parents=${backupRun.value.metadata.parentCount} payments=${backupRun.value.metadata.paymentCount}`
    : JSON.stringify(backupRun.error).slice(0, 300));
  if (!backupRun.ok) throw new Error("backup failed — aborting");
  const archiveId = backupRun.value.id;

  // The mirror row landed?
  const mirrorCheck = await client.from("backup_archives").select("id, status").eq("archive_id_text", archiveId);
  record("B3 mirror row", !mirrorCheck.error && (mirrorCheck.data?.length ?? 0) === 1,
    mirrorCheck.error ? mirrorCheck.error.message : `status=${mirrorCheck.data?.[0]?.status}`);

  // ── C. the IMMEDIATE restore (the owner's Oct-4 timing) ─────────────────
  const restore1 = await repos.backups.restore(archiveId, actorId, "T505 Probe");
  record("C1 IMMEDIATE restore (owner's Oct-4 timing)", restore1.ok, restore1.ok
    ? `${restore1.value.durationMs}ms`
    : `ERROR code=${restore1.error.code} msg=${restore1.error.userMessage ?? restore1.error.message}`);
  if (!restore1.ok) {
    log("C1 FULL ERROR:", JSON.stringify(restore1.error, null, 2).slice(0, 1500));
  }

  const marker = getRestoredFromMarker();
  record("C2 restored-from marker", marker?.archiveId === archiveId);

  // ── D. the SECOND restore (the retry that succeeded on Oct 4) ───────────
  const restore2 = await repos.backups.restore(archiveId, actorId, "T505 Probe");
  record("D1 second restore (the Oct-4 retry pattern)", restore2.ok,
    restore2.ok ? `${restore2.value.durationMs}ms` : String(restore2.error.userMessage).slice(0, 200));

  // ── E. the ExportDialog's EXACT data-collection (cold streams) ──────────
  // This is EXACTLY what the dialog does: read the CURRENT cache values.
  const parents = repos.parents.observe().get();
  const students = repos.students.observe().get();
  const payments = repos.payments.observe().get();
  log("E0 cache state: parents", parents.length, "students", students.length, "payments", payments.length);

  const personnel = repos.personnel.observe().get();
  const installments = repos.installments.observe().get();
  const ledger = repos.ledger.observe().get();
  const expenses = repos.expenses.observe().get();
  const classes = repos.classes.observe().get();
  const subjects = repos.subjects.observe().get();

  try {
    const built = await buildExcelOnlyExport({
      parents, students, personnel, payments, installments, ledger, expenses,
      assessments: [], subjects, attendance: [], debtSummaries: [], classes,
      pricing: null, exportedAt: new Date().toISOString(),
    });
    record("E1 buildExcelOnlyExport (dialog pattern)", true,
      `${built.bytes.length} bytes — ${built.fileName}`);
    record("E2 ZIP signature", built.bytes[0] === 0x50 && built.bytes[1] === 0x4b,
      `PK=${built.bytes[0] === 0x50 && built.bytes[1] === 0x4b}`);
  } catch (e) {
    record("E1 buildExcelOnlyExport (dialog pattern)", false, e instanceof Error ? e.message : String(e));
  }

  // ── F. buildEntireArchiveExport (the vault export) ──────────────────────
  try {
    const built = await buildEntireArchiveExport();
    record("F1 buildEntireArchiveExport", true, `${built.bytes.length} bytes — ${built.fileName}`);
  } catch (e) {
    record("F1 buildEntireArchiveExport", false, e instanceof Error ? e.message : String(e));
  }

  // ── G. the sync flow ────────────────────────────────────────────────────
  try {
    const { initialiseSyncService, getSyncService } = await import("../src/infrastructure/sync/sync-service");
    const { defaultPushHandler } = await import("../src/infrastructure/sync/default-push-handler");
    initialiseSyncService({
      tenantId: () => "00000000-0000-0000-0000-000000000001",
      actorId: () => actorId,
      isSupabaseConfigured: () => true,
      isMockMode: () => false,
      push: defaultPushHandler,
      autoStart: false,
    });
    const svc = getSyncService();
    await svc.start();
    const drained = await svc.syncNow();
    record("G1 syncNow (empty queue honest no-op)", true,
      `pushed=${drained.pushed} failed=${drained.failed} skippedMock=${drained.skippedMock}`);
    const store = svc.getStore();
    const all = await store.listAll();
    record("G2 sync queue census", true, `${all.length} entries`);
    await svc.stop();
  } catch (e) {
    record("G1 syncNow", false, e instanceof Error ? `${e.message}\n${(e.stack ?? "").slice(0, 400)}` : String(e));
  }

  // ── H. cleanup: remove the probe archive + mirror row ───────────────────
  const del = await client.from("backup_archives").delete().eq("archive_id_text", archiveId);
  record("H1 mirror row cleanup", !del.error, del.error?.message ?? "removed");
  await clearVault();
  log("cleanup done — vault cleared, mirror row removed");

  // ── summary ──────────────────────────────────────────────────────────────
  const fails = results.filter(([, ok]) => !ok);
  console.log("\n========== T505 PROBE SUMMARY ==========");
  for (const [id, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"} ${id}${note ? ` — ${note}` : ""}`);
  console.log(`${results.length - fails.length}/${results.length} passed`);
  fs.writeFileSync(
    path.resolve(import.meta.dirname, "t505-probe-report.json"),
    JSON.stringify({ tag: TAG, at: new Date().toISOString(), results }, null, 2),
  );
  process.exit(fails.length > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error(`[${TAG}] FATAL`, err);
  process.exit(2);
});
