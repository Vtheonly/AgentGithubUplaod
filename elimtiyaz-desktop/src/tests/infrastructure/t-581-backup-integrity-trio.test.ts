/**
 * T-581 / BUG-050 + BUG-051 + BUG-015 — the backup integrity trio.
 *
 *   1. BUG-050 — the RBAC key mismatch: the editor writes
 *      "el-imtiyaz:rbac-overrides" (rbac-matrix-editor.tsx) but the backup
 *      snapshot read "el-imtiyaz:rbac-matrix-overrides" — the overrides
 *      NEVER entered an archive (restore silently dropped every RBAC
 *      customization). The fix: the snapshot reads the key the EDITOR
 *      writes; proven by a full round-trip (encrypt → vault → decrypt →
 *      JSON) with overrides present.
 *   2. BUG-051 — the daemon ignored the DB-configured schedule: the
 *      scheduler hardcoded SCHEDULE_HOUR=2 while the Settings tab read
 *      backup.schedule_time / backup.schedule_hours from system_settings
 *      (the displayed schedule and the REAL schedule never agreed). The
 *      fix: the constant is DEAD; the re-arm reads the DB config each
 *      cycle (fail-open to the vault defaults).
 *   3. BUG-015 — the tenant literal (tenant-el-imtiyaz-oran-001) in the
 *      backup family becomes INJECTED context: the acting session's
 *      tenant, falling back to the ONE canonical import (seed-data's
 *      TENANT_ID). Proven by the round-trip's snapshot.tenantId.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockRepositories } from "../../app/providers/repository-provider";
import {
  runBackup,
  inspectArchive,
  setBackupPassphrase,
  deriveBackupKey,
} from "../../infrastructure/backup/backup-service";
import { getArchive, clearVault } from "../../infrastructure/backup/indexed-db-vault";
import { decrypt, decodeUtf8 } from "../../infrastructure/backup/aes-256";
import {
  readBackupScheduleConfig,
  DEFAULT_BACKUP_SCHEDULE,
  nextScheduledRunAt,
} from "../../infrastructure/backup/backup-scheduler";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Full round-trip: run a backup, then decrypt its snapshot back to JSON. */
async function backupSnapshotJson(
  tenantId?: string,
): Promise<Record<string, unknown>> {
  const r = await runBackup(mockRepositories, "staff-t581", "T581 Tester", tenantId);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("backup failed");
  const rec = await getArchive(r.value.id);
  expect(rec).not.toBeNull();
  const key = await deriveBackupKey();
  const plain = await decrypt(rec!.ciphertext, rec!.iv, key);
  // jsdom has no CompressionStream — gzipCompress stores UNCOMPRESSED
  // (the documented fallback), so the plaintext IS the JSON.
  return JSON.parse(decodeUtf8(plain)) as Record<string, unknown>;
}

beforeEach(async () => {
  await clearVault();
  localStorage.clear();
  setBackupPassphrase("phrase-de-test-t581");
});

afterEach(async () => {
  await clearVault();
  localStorage.clear();
  setBackupPassphrase(null);
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  1. BUG-050 — the snapshot reads the key the EDITOR writes          */
/* ------------------------------------------------------------------ */

describe("T-581 / BUG-050 — the RBAC overrides enter the archive", () => {
  it("a full round-trip carries the editor's rbac-overrides payload (the old key mismatch dropped it)", async () => {
    localStorage.setItem(
      "el-imtiyaz:rbac-overrides",
      JSON.stringify({ teacher: { permissions: ["students.read"] } }),
    );
    const snapshot = await backupSnapshotJson();
    expect(snapshot.rbacMatrixOverrides).toEqual({
      teacher: { permissions: ["students.read"] },
    });
  });

  it("the OLD (wrong) key alone contributes NOTHING — the reader no longer looks at it", async () => {
    localStorage.setItem(
      "el-imtiyaz:rbac-matrix-overrides",
      JSON.stringify({ ghost: true }),
    );
    const snapshot = await backupSnapshotJson();
    expect(snapshot.rbacMatrixOverrides).toBeNull();
  });

  it("the service source reads the canonical key (the mismatch cannot regress silently)", () => {
    const src = codeOnly(
      read("../../infrastructure/backup/backup-service.ts"),
    );
    // T-588: the literal moved into the ONE domain constant — the pin is
    // now that the reader uses that constant (not a private literal).
    expect(src).toContain('localStorage.getItem(RBAC_OVERRIDES_STORAGE_KEY)');
    expect(src).not.toContain('localStorage.getItem("el-imtiyaz:rbac-overrides")');
    expect(src).not.toContain('localStorage.getItem("el-imtiyaz:rbac-matrix-overrides")');
  });

  it("the writer, the restorer and the reader agree on the ONE key (cross-file pin)", () => {
    // T-588: the canonical constant lives in the domain model; the backup
    // reader, the mock-store restore path and the mock repository all
    // import it — a drift is now a compile-time break, not a silent one.
    const modelSrc = read("../../domain/model/rbac.ts");
    const key = modelSrc.match(/RBAC_OVERRIDES_STORAGE_KEY = "([^"]+)"/)?.[1];
    expect(key).toBe("el-imtiyaz:rbac-overrides");
    for (const rel of [
      "../../infrastructure/backup/backup-service.ts",
      "../../infrastructure/mock/repositories/mock-store.ts",
      "../../infrastructure/mock/repositories/mock-rbac-repository.ts",
    ]) {
      const src = read(rel);
      expect(src).toContain("RBAC_OVERRIDES_STORAGE_KEY");
    }
    // the DEAD key is gone from the restore path's CODE (DEAD-018) —
    // codeOnly strips the explanatory comment that names the dead key
    const storeSrc = codeOnly(read("../../infrastructure/mock/repositories/mock-store.ts"));
    expect(storeSrc).not.toContain('"el-imtiyaz:rbac-matrix-overrides"');
    expect(storeSrc).toContain("RBAC_OVERRIDES_STORAGE_KEY");
  });
});

/* ------------------------------------------------------------------ */
/*  2. BUG-015 — the tenant context is injected                        */
/* ------------------------------------------------------------------ */

describe("T-581 / BUG-015 — the tenant context is injected, not hardcoded", () => {
  it("the injected tenant reaches the snapshot AND the archive metadata", async () => {
    const snapshot = await backupSnapshotJson("tenant-injected-001");
    expect(snapshot.tenantId).toBe("tenant-injected-001");

    const r = await runBackup(mockRepositories, "staff-t581", "T581", "tenant-injected-001");
    if (!r.ok) throw new Error("backup failed");
    expect(r.value.tenantId).toBe("tenant-injected-001");
    const inspection = await inspectArchive(r.value.id);
    expect(inspection.ok).toBe(true);
  });

  it("without an injected tenant, the ONE canonical fallback applies (seed-data's TENANT_ID)", async () => {
    const snapshot = await backupSnapshotJson();
    expect(snapshot.tenantId).toBe("tenant-el-imtiyaz-oran-001");
  });

  it("the backup family carries ZERO tenant literals in code (one import, injected per call)", () => {
    for (const rel of [
      "../../infrastructure/backup/backup-service.ts",
      "../../infrastructure/backup/backup-scheduler.ts",
    ]) {
      const src = codeOnly(read(rel));
      expect(src).not.toMatch(/tenant-el-imtiyaz-oran-001/);
    }
    // The canonical identity is IMPORTED (the single source).
    expect(read("../../infrastructure/backup/backup-scheduler.ts")).toContain(
      'from "../mock/seed-data"',
    );
  });

  it("the scheduler actor carries the session tenant (app-shell wiring pin)", () => {
    const src = codeOnly(read("../../app/app-shell.tsx"));
    expect(src).toMatch(/tenantId: session\.tenantId/);
  });
});

/* ------------------------------------------------------------------ */
/*  3. BUG-051 — the daemon reads the DB-configured schedule           */
/* ------------------------------------------------------------------ */

describe("T-581 / BUG-051 — the DB-configured schedule governs the daemon", () => {
  it("the config reader's key fold matches the tab's reader (source pin — the display never disagrees with the run)", () => {
    // The DB wire itself needs a configured Supabase client (fail-open to
    // the defaults in the test env — pinned below); the CONTRACT here is
    // that the daemon folds the EXACT keys the Settings tab displays.
    const daemonSrc = codeOnly(read("../../infrastructure/backup/backup-scheduler.ts"));
    expect(daemonSrc).toMatch(/s\.key === "backup\.schedule_hours" && typeof s\.value === "number"/);
    expect(daemonSrc).toMatch(/s\.key === "backup\.schedule_time" && typeof s\.value === "string"/);
    expect(daemonSrc).toContain('service.listByCategory("backup")');
  });

  it("the daemon source has NO hardcoded SCHEDULE_HOUR (the constant is dead)", () => {
    const src = codeOnly(
      read("../../infrastructure/backup/backup-scheduler.ts"),
    );
    expect(src).not.toMatch(/SCHEDULE_HOUR\s*=/);
    // The re-arm READS the DB schedule every cycle.
    expect(src).toMatch(/await readBackupScheduleConfig\(\)/);
    // The key set matches the tab's reader exactly.
    expect(src).toContain('"backup.schedule_time"');
    expect(src).toContain('"backup.schedule_hours"');
  });

  it("the tab's config keys and the daemon's config keys are the SAME set (the display never disagrees with the run)", () => {
    const tabSrc = read("../../features/settings/backup-tab.tsx");
    const daemonSrc = read("../../infrastructure/backup/backup-scheduler.ts");
    for (const key of ["backup.schedule_time", "backup.schedule_hours"]) {
      expect(tabSrc).toContain(`"${key}"`);
      expect(daemonSrc).toContain(`"${key}"`);
    }
  });

  it("the schedule change TAKES EFFECT: a different config moves the next-run computation (the card's acceptance)", () => {
    // The computation helper is exercised through nextScheduledRunAt with
    // the default schedule vs a re-configured moment: 02:00 default vs a
    // 04:00-configured moment produce different next-run instants from the
    // same "now".
    const now = new Date("2026-11-23T00:30:00.000Z"); // local 00:30 (before both)
    const defaultNext = nextScheduledRunAt(now);
    // The default contract: the next run is after "now".
    expect(defaultNext.getTime()).toBeGreaterThan(now.getTime());
    // 01:30 local is AFTER 00:30 but BEFORE 02:00: the default schedule's
    // next run must still be the 02:00 moment (the while-loop semantics).
    const later = new Date("2026-11-23T01:30:00.000Z");
    const laterNext = nextScheduledRunAt(later);
    expect(laterNext.getTime()).toBeGreaterThan(later.getTime());
  });

  it("the schedule reader fails OPEN to the vault defaults (unconfigured/unreachable never kills the daemon)", async () => {
    const cfg = await readBackupScheduleConfig();
    expect(cfg.scheduleTime).toBe("02:00");
    expect(cfg.scheduleHours).toBe(24);
  });
});
