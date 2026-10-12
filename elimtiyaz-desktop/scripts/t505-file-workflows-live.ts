/**
 * t505-live-verification.ts — T-505 phase (e): the LIVE verification of the
 * new file-based workflows against the owner's project, through the app's
 * REAL code paths (the same harness pattern as t505-sync-backup-repro.ts).
 *
 * Probes (read-mostly; the only writes are the probe's own backup archive +
 * its mirror row + the audit entries — all cleaned up or append-only):
 *   L1  sign-in via the app's own client + the real repositories
 *   L2  the WARMED Excel checkpoint (buildBackupCheckpoint) — the real
 *       13-sheet workbook ZIP built from the live server state
 *   L3  the checkpoint ZIP is a valid PK zip whose manifest carries the
 *       per-source warm-up record (every source warmed against the LIVE DB)
 *   L4  the backup → export → INSPECT ladder (the real entire-archive ZIP
 *       through the production zip-reader + the validation ladder)
 *   L5  the checksum TAMPER gate (a flipped byte → the import REFUSED)
 *   L6  the END-TO-END file round-trip: export → WIPE the vault → inspect →
 *       import → the EXISTING restore → the restored-from marker
 *   L7  cleanup (the probe archive's mirror row removed; the vault cleared)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

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

import { getSupabaseRepositories } from "../src/infrastructure/supabase/supabase-repositories";
import {
  setBackupPassphrase,
  restore,
  getRestoredFromMarker,
} from "../src/infrastructure/backup/backup-service";
import { clearVault } from "../src/infrastructure/backup/indexed-db-vault";
import {
  buildEntireArchiveExport,
} from "../src/infrastructure/export/archive-export";
import { buildBackupCheckpoint } from "../src/infrastructure/backup/backup-checkpoint";
import {
  inspectBackupFile,
  importBackupArchive,
  type PickedBackupFile,
} from "../src/infrastructure/backup/backup-file-restore";
import { readZip } from "../src/infrastructure/export/zip-reader";

const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = process.env.T505_ADMIN_EMAIL ?? "admin@elimtiyaz.dz";
const ADMIN_PASSWORD = process.env.T505_ADMIN_PASSWORD ?? "elimtiyaz@admin2026";
const TAG = `t505-live-${Date.now().toString(36)}`;

const log = (...a: unknown[]) => console.log(`[${TAG}]`, ...a);
const results: Array<[string, boolean, string]> = [];
function record(id: string, ok: boolean, note = ""): void {
  results.push([id, ok, note]);
  log(`${ok ? "PASS" : "FAIL"} — ${id}${note ? ` — ${note}` : ""}`);
}

async function main(): Promise<void> {
  localStorageShim.setItem(
    "el-imtiyaz.local-config",
    JSON.stringify({ supabase_url: SUPABASE_URL, supabase_anon_key: PUBLISHABLE_KEY, supabase_use_supabase: true }),
  );
  const { getSupabaseClient } = await import("../src/infrastructure/supabase/supabase-client");
  const client = getSupabaseClient();
  const signIn = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (signIn.error || !signIn.data?.user) throw new Error(`sign-in failed: ${signIn.error?.message}`);
  const actorId = signIn.data.user.id;
  record("L1 admin sign-in (the app's own client)", true, signIn.data.user.email ?? "");

  localStorageShim.setItem("el-imtiyaz.session", JSON.stringify({
    userId: actorId,
    tenantId: "00000000-0000-0000-0000-000000000001",
    email: signIn.data.user.email,
    displayName: "T505 Live",
    role: "super_admin",
    permissions: [],
    accessToken: "probe", refreshToken: "probe",
    expiresAt: Date.now() + 3600_000, locale: "fr",
  }));

  const repos = getSupabaseRepositories();
  await clearVault();
  setBackupPassphrase(`fake-${TAG}-passphrase`);

  // ── L2+L3: the warmed checkpoint against the LIVE backend ──────────────
  const checkpoint = await buildBackupCheckpoint(repos, actorId, "T505 Live");
  record("L2 buildBackupCheckpoint (live, warmed)", checkpoint.ok, checkpoint.ok
    ? `${checkpoint.value.bytes.length} bytes — ${checkpoint.value.fileName}`
    : JSON.stringify(checkpoint.error).slice(0, 300));
  if (!checkpoint.ok) throw new Error("checkpoint failed");

  const warmBySource = Object.fromEntries(checkpoint.value.warmup.map((w) => [w.source, w.status]));
  const degraded = checkpoint.value.warmup.filter((w) => w.status === "degraded");
  const zipEntries = readZip(checkpoint.value.bytes);
  const manifestEntry = zipEntries.find((e) => e.name === "manifest.json")!;
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  record("L3 the checkpoint ZIP manifest carries sourceWarmup", Array.isArray(manifest.sourceWarmup),
    `sources: ${manifest.sourceWarmup.map((w: { source: string; status: string }) => `${w.source}=${w.status}`).join(", ").slice(0, 220)}`);
  record("L3b the warmed sources against the LIVE DB", degraded.length === 0,
    degraded.length === 0 ? "every source warmed" : `degraded: ${degraded.map((d) => d.source).join(", ")}`);

  // ── L4: the backup → export → inspection ladder ─────────────────────────
  const backupRun = await repos.backups.runBackup(actorId, "T505 Live");
  record("L4a runBackup (the real Supabase-mode pipeline)", backupRun.ok, backupRun.ok
    ? `${backupRun.value.sizeBytes} bytes — parents=${backupRun.value.metadata.parentCount}`
    : JSON.stringify(backupRun.error).slice(0, 200));
  if (!backupRun.ok) throw new Error("backup failed");
  const archiveId = backupRun.value.id;

  const exportBuilt = await buildEntireArchiveExport();
  const picked: PickedBackupFile = {
    name: "kept-archive.zip",
    path: "/mnt/usb/kept-archive.zip",
    bytes: exportBuilt.bytes,
    sizeBytes: exportBuilt.bytes.byteLength,
    lastModified: new Date().toISOString(),
  };
  const inspection = inspectBackupFile(picked);
  record("L4b the inspection ladder (entire-archive ZIP)", inspection.kind === "entire-archive-zip",
    `${inspection.archives.length} archive(s); the probe's entry integrity=${inspection.archives.find((a) => a.archiveId === archiveId)?.integrity}`);
  const selected = inspection.archives.find((a) => a.archiveId === archiveId)!;
  record("L4c the per-archive counts from the manifest", selected.counts.parents === backupRun.value.metadata.parentCount,
    `parents=${selected.counts.parents} students=${selected.counts.students} payments=${selected.counts.payments}`);

  // ── L5: the TAMPER gate ─────────────────────────────────────────────────
  const tamperedEntries = readZip(exportBuilt.bytes).map((e) => {
    if (e.name === `backups/${archiveId}`) {
      const t = new Uint8Array(e.data);
      t[0] ^= 0xff;
      return { name: e.name, data: t };
    }
    return { name: e.name, data: e.data };
  });
  const { buildZip } = await import("../src/infrastructure/export/zip-writer");
  const tamperedZip = buildZip(tamperedEntries);
  const tamperedInspection = inspectBackupFile({ ...picked, bytes: tamperedZip });
  await clearVault();
  const tamperResult = await importBackupArchive(tamperedInspection.archives[0]);
  record("L5 the TAMPER gate (a flipped ciphertext byte)", !tamperResult.ok && tamperResult.error.includes("Checksum"),
    tamperResult.ok ? "THE GATE FAILED OPEN — must not import" : (tamperResult.error ?? "").slice(0, 140));

  // ── L6: the END-TO-END file round-trip ──────────────────────────────────
  await clearVault();
  const importResult = await importBackupArchive(selected);
  record("L6a the import (checksum-gated)", importResult.ok, importResult.ok ? archiveId : importResult.error);
  if (!importResult.ok) throw new Error("import failed");
  const restoreResult = await restore(repos, archiveId, actorId, "T505 Live");
  record("L6b the EXISTING restore path (Supabase mode)", restoreResult.ok, restoreResult.ok
    ? `${restoreResult.value.durationMs}ms — the offline layer rehydrated (the documented boundary: the server data is untouched)`
    : String(restoreResult.error.userMessage).slice(0, 200));
  const marker = getRestoredFromMarker();
  record("L6c the restored-from marker", marker?.archiveId === archiveId,
    `parents=${marker?.counts.parents} payments=${marker?.counts.payments}`);

  // ── L7: cleanup ─────────────────────────────────────────────────────────
  const del = await client.from("backup_archives").delete().eq("archive_id_text", archiveId);
  record("L7 mirror-row cleanup", !del.error, del.error?.message ?? "removed");
  await clearVault();
  log("cleanup done");

  const fails = results.filter(([, ok]) => !ok);
  console.log("\n========== T505 LIVE VERIFICATION ==========");
  for (const [id, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"} ${id}${note ? ` — ${note}` : ""}`);
  console.log(`${results.length - fails.length}/${results.length} passed`);
  fs.writeFileSync(
    path.resolve(import.meta.dirname, "t505-file-workflows-live-report.json"),
    JSON.stringify({ tag: TAG, at: new Date().toISOString(), results }, null, 2),
  );
  process.exit(fails.length > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error(`[${TAG}] FATAL`, err);
  process.exit(2);
});
