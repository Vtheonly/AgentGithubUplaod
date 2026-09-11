/**
 * T-301 (OFFLINE-400) — the toggleable backup scheduler suite.
 *
 * Pins the mandate's sub-gap (e):
 *   1. the persisted on/off preference — DEFAULT ON (preserves the
 *      pre-T-301 unconditional daemon), explicit "false" disables,
 *      re-enable restores;
 *   2. the scheduler semantics: a disabled preference means NO scheduled
 *      backup ever runs (the tick no-ops); an enabled preference runs at
 *      the tick; toggling OFF mid-flight stops the NEXT tick; toggling ON
 *      while dormant resumes WITHOUT an app restart (the runtime gating
 *      the T-301 registry entry documents — a deviation from the task
 *      text's "arms only when enabled": the timer keeps cycling so the
 *      toggle is instant in both directions);
 *   3. manual backups are NEVER gated by the preference;
 *   4. the backup-tab wiring (the toggle + the next-run display + the
 *      dormant-mode honesty).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSchedulerEnabled,
  setSchedulerEnabled,
  startBackupScheduler,
  runManualBackup,
  nextScheduledRunAt,
  appendRunLog,
  readRunLog,
} from "../../infrastructure/backup/backup-scheduler";
import type { Repositories } from "../../app/providers/repository-provider";

const ROOT = join(__dirname, "../../..");
const DEV_TICK_MS = 5 * 60 * 1000; // matches the scheduler's dev tick

/** A Repositories stub with a spy backups.runBackup (the scheduler's only deps). */
function makeRepos() {
  return {
    backups: { runBackup: vi.fn(async () => ({ ok: true, value: { id: "bak-t301", sizeBytes: 10 } })) },
    audit: { log: vi.fn(async () => ({ ok: true })) },
  } as unknown as Repositories;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

/* ------------------------------------------------------------------ */
/*  1. The persisted preference                                        */
/* ------------------------------------------------------------------ */

describe("T-301 — the persisted preference", () => {
  it("defaults to ON (the pre-T-301 daemon behavior preserved)", () => {
    expect(isSchedulerEnabled()).toBe(true);
    expect(localStorage.getItem("el-imtiyaz:backup-scheduler-enabled")).toBeNull();
  });

  it("an explicit false disables; re-enable restores", () => {
    setSchedulerEnabled(false);
    expect(isSchedulerEnabled()).toBe(false);
    expect(localStorage.getItem("el-imtiyaz:backup-scheduler-enabled")).toBe("false");
    setSchedulerEnabled(true);
    expect(isSchedulerEnabled()).toBe(true);
    expect(localStorage.getItem("el-imtiyaz:backup-scheduler-enabled")).toBe("true");
  });

  it("nextScheduledRunAt returns a future moment", () => {
    const next = nextScheduledRunAt();
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });
});

/* ------------------------------------------------------------------ */
/*  2. The scheduler semantics (fake timers over the dev tick)         */
/* ------------------------------------------------------------------ */

describe("T-301 — the gated scheduler", () => {
  it("ENABLED: the scheduled tick runs the backup and appends the run log", async () => {
    const repos = makeRepos();
    const stop = startBackupScheduler(repos, () => ({ id: "u1", name: "T" }));
    try {
      await vi.advanceTimersByTimeAsync(DEV_TICK_MS + 100);
      expect(repos.backups.runBackup).toHaveBeenCalledTimes(1);
      const log = readRunLog();
      expect(log).toHaveLength(1);
      expect(log[0].trigger).toBe("scheduled");
      expect(log[0].status).toBe("success");
    } finally {
      stop();
    }
  });

  it("DISABLED: the scheduled tick NEVER runs the backup", async () => {
    setSchedulerEnabled(false);
    const repos = makeRepos();
    const stop = startBackupScheduler(repos, () => ({ id: "u1", name: "T" }));
    try {
      // Two full dev ticks — the daemon stays dormant.
      await vi.advanceTimersByTimeAsync(DEV_TICK_MS + 100);
      await vi.advanceTimersByTimeAsync(DEV_TICK_MS + 100);
      expect(repos.backups.runBackup).not.toHaveBeenCalled();
      expect(readRunLog()).toHaveLength(0);
    } finally {
      stop();
    }
  });

  it("toggling OFF mid-flight stops the NEXT tick (no restart needed)", async () => {
    const repos = makeRepos();
    const stop = startBackupScheduler(repos, () => ({ id: "u1", name: "T" }));
    try {
      // Tick 1: enabled — one backup.
      await vi.advanceTimersByTimeAsync(DEV_TICK_MS + 100);
      expect(repos.backups.runBackup).toHaveBeenCalledTimes(1);

      // Disable BETWEEN ticks.
      setSchedulerEnabled(false);

      // Tick 2: the preference gates it — no second backup.
      await vi.advanceTimersByTimeAsync(DEV_TICK_MS + 100);
      expect(repos.backups.runBackup).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("toggling ON while dormant resumes WITHOUT an app restart", async () => {
    setSchedulerEnabled(false);
    const repos = makeRepos();
    const stop = startBackupScheduler(repos, () => ({ id: "u1", name: "T" }));
    try {
      await vi.advanceTimersByTimeAsync(DEV_TICK_MS + 100);
      expect(repos.backups.runBackup).not.toHaveBeenCalled();

      // Re-enable — the still-cycling daemon picks the preference up at
      // the next tick (no new startBackupScheduler call).
      setSchedulerEnabled(true);
      await vi.advanceTimersByTimeAsync(DEV_TICK_MS + 100);
      expect(repos.backups.runBackup).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("the unsubscribe function stops all future ticks", async () => {
    const repos = makeRepos();
    const stop = startBackupScheduler(repos, () => ({ id: "u1", name: "T" }));
    stop();
    await vi.advanceTimersByTimeAsync(DEV_TICK_MS * 3);
    expect(repos.backups.runBackup).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  3. Manual backups are never gated                                  */
/* ------------------------------------------------------------------ */

describe("T-301 — manual backups ignore the preference", () => {
  it("runManualBackup works with the scheduler disabled", async () => {
    setSchedulerEnabled(false);
    const repos = makeRepos();
    const entry = await runManualBackup(repos, () => ({ id: "u1", name: "T" }));
    expect(repos.backups.runBackup).toHaveBeenCalledTimes(1);
    expect(entry?.status).toBe("success");
    expect(entry?.trigger).toBe("manual");
    expect(readRunLog()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  4. The backup-tab wiring (source guards)                           */
/* ------------------------------------------------------------------ */

describe("T-301 — the backup-tab wiring", () => {
  const tab = readFileSync(join(ROOT, "src/features/settings/backup-tab.tsx"), "utf8");

  it("renders the toggle bound to the persisted preference", () => {
    expect(tab).toContain("data-testid=\"backup-scheduler-toggle\"");
    expect(tab).toContain("checked={schedulerEnabled}");
    expect(tab).toContain("onCheckedChange={handleToggleScheduler}");
    expect(tab).toContain("setSchedulerEnabled(enabled)");
  });

  it("renders the next-run display + the dormant honesty", () => {
    expect(tab).toContain("nextScheduledRunAt()");
    expect(tab).toContain("data-testid=\"backup-scheduler-state\"");
    expect(tab).toContain("Planification automatique");
    expect(tab).toContain("Le planificateur est en veille");
  });

  it("the scheduler gates every scheduled tick on the preference (the core guard)", () => {
    const scheduler = readFileSync(
      join(ROOT, "src/infrastructure/backup/backup-scheduler.ts"),
      "utf8",
    );
    expect(scheduler).toContain('trigger === "scheduled" && !isSchedulerEnabled()');
  });

  it("appendRunLog still works (the run-log contract untouched)", () => {
    appendRunLog({
      at: new Date().toISOString(),
      status: "success",
      durationMs: 5,
      trigger: "manual",
    });
    expect(readRunLog()).toHaveLength(1);
  });
});
