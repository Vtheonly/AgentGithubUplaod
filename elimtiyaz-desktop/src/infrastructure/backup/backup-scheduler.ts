/**
 * Backup scheduler — 24h cycle at ~02:00 AM (vault §13.01).
 *
 * "An automated daemon runs on the Desktop Master Terminal and executes a
 * full system backup every 24 hours. Runs at ~02:00 AM to minimize user
 * impact."
 *
 * Scheduling strategy:
 *   - The next run is computed as the NEXT 02:00 AM (local time) — not a
 *     blind 24h interval from start-up, so backups always land at ~02:00.
 *   - After each run, the following tick is re-armed for the next 02:00.
 *   - In development the tick is reduced to 5 minutes so the behavior is
 *     observable without waiting a day.
 *
 * Failure handling: backup failures are logged to the PERSISTED run log
 * (localStorage, surfaced in Settings → Sauvegarde) + the audit log. The
 * scheduler itself swallows errors so a transient failure doesn't crash the
 * app or block the next tick. Disk-space is checked before each run — the
 * vault alerts at 80% capacity (vault §13.06).
 */
import type { Repositories } from "../../app/providers/repository-provider";
import { logger } from "../../core/logger";

export interface SchedulerActor {
  readonly id: string;
  readonly name: string;
}

export interface BackupRunLogEntry {
  readonly at: string;
  readonly status: "success" | "failed";
  readonly archiveId?: string;
  readonly sizeBytes?: number;
  readonly durationMs: number;
  readonly error?: string;
  readonly trigger: "scheduled" | "manual";
}

/** localStorage key for the persisted daemon run log (last 50 runs). */
const RUN_LOG_KEY = "el-imtiyaz:backup-run-log";
const RUN_LOG_LIMIT = 50;

/** Dev tick: 5 minutes (so iteration is observable without waiting a day). */
const DEV_TICK_MS = 5 * 60 * 1000;

/** Hour of the daily scheduled backup (vault §13.01 — ~02:00 AM). */
const SCHEDULE_HOUR = 2;

/** Milliseconds until the next 02:00 AM local time. */
function msUntilNextScheduledRun(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(SCHEDULE_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(60_000, next.getTime() - now.getTime());
}

/** Persist a run-log entry (kept to the last RUN_LOG_LIMIT entries). */
export function appendRunLog(entry: BackupRunLogEntry): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(RUN_LOG_KEY);
    const log: BackupRunLogEntry[] = raw ? JSON.parse(raw) : [];
    log.unshift(entry);
    localStorage.setItem(RUN_LOG_KEY, JSON.stringify(log.slice(0, RUN_LOG_LIMIT)));
  } catch {
    /* best-effort persistence */
  }
}

/** Read the persisted daemon run log (newest first). */
export function readRunLog(): BackupRunLogEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(RUN_LOG_KEY);
    return raw ? (JSON.parse(raw) as BackupRunLogEntry[]) : [];
  } catch {
    return [];
  }
}

export interface StorageCapacity {
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  readonly usedPercent: number | null;
  readonly alert: boolean;
}

/**
 * VAULT §13.06 — vault disk-space check with an alert at 80% capacity.
 * Uses the browser Storage Quota API (`navigator.storage.estimate`) — the
 * web-platform equivalent of checking the external drive's free space.
 */
export async function checkVaultCapacity(): Promise<StorageCapacity> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      return { usageBytes: null, quotaBytes: null, usedPercent: null, alert: false };
    }
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const usedPercent = quota > 0 ? Math.round((usage / quota) * 1000) / 10 : null;
    return {
      usageBytes: usage,
      quotaBytes: quota,
      usedPercent,
      alert: usedPercent !== null && usedPercent >= 80,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null, usedPercent: null, alert: false };
  }
}

/**
 * Start the backup scheduler.
 *
 * @param repos     The Repositories object (used to call `backups.runBackup`).
 * @param getActor  A function returning the current actor (or null). The
 *                  scheduler uses the actor at tick-time, not at start-time,
 *                  so the actor can change across ticks.
 * @returns An unsubscribe function that clears the timer.
 */
// Detect dev mode safely (see core/logger.ts for the same pattern).
function readDevFlag(): boolean {
  try {
    return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

export function startBackupScheduler(
  repos: Repositories,
  getActor: () => SchedulerActor | null,
): () => void {
  const isDev = readDevFlag();
  logger.info("backup.scheduler.start", {
    mode: isDev ? "dev" : "prod",
    scheduledHour: SCHEDULE_HOUR,
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function runTick(trigger: "scheduled" | "manual") {
    const actor = getActor();
    const actorId = actor?.id ?? "system";
    const actorName = actor?.name ?? "Système (scheduler)";
    const startedAt = Date.now();

    // VAULT §13.06 — disk-space alert BEFORE the run (80% threshold).
    const capacity = await checkVaultCapacity();
    if (capacity.alert) {
      logger.error("backup.scheduler.vault_capacity_alert", {
        usedPercent: capacity.usedPercent,
      });
      appendRunLog({
        at: new Date().toISOString(),
        status: "failed",
        durationMs: 0,
        trigger,
        error: `Espace du coffre critique : ${capacity.usedPercent}% utilisé (seuil 80%) — purgez les anciennes archives.`,
      });
      void repos.audit.log({
        action: "backup.capacity_alert",
        entityType: "backup",
        entityId: "vault",
        actorId,
        actorName,
        tenantId: "tenant-el-imtiyaz-oran-001",
        diff: { before: null, after: capacity },
        note: `Alerte espace coffre : ${capacity.usedPercent}% utilisé (seuil 80%)`,
      }).then(() => undefined, () => undefined);
      return;
    }

    try {
      const result = await repos.backups.runBackup(actorId, actorName);
      if (result.ok) {
        logger.info("backup.scheduler.tick.success", {
          archiveId: result.value.id,
          sizeBytes: result.value.sizeBytes,
        });
        appendRunLog({
          at: new Date().toISOString(),
          status: "success",
          archiveId: result.value.id,
          sizeBytes: result.value.sizeBytes,
          durationMs: Date.now() - startedAt,
          trigger,
        });
      } else {
        logger.warn("backup.scheduler.tick.failed", {
          code: result.error.code,
          message: result.error.message,
        });
        appendRunLog({
          at: new Date().toISOString(),
          status: "failed",
          durationMs: Date.now() - startedAt,
          trigger,
          error: result.error.userMessage ?? result.error.message,
        });
      }
    } catch (err) {
      // Defensive: the repository should never throw (it returns Err), but
      // we catch here so a transient failure doesn't kill the scheduler.
      logger.error("backup.scheduler.tick.threw", { err });
      appendRunLog({
        at: new Date().toISOString(),
        status: "failed",
        durationMs: Date.now() - startedAt,
        trigger,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function armNext() {
    if (stopped) return;
    const delay = isDev ? DEV_TICK_MS : msUntilNextScheduledRun();
    timer = setTimeout(async () => {
      await runTick("scheduled");
      armNext();
    }, delay);
    logger.info("backup.scheduler.armed", {
      nextRunInMs: delay,
      nextRunAt: new Date(Date.now() + delay).toISOString(),
    });
  }

  armNext();

  // Return the unsubscribe function.
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    logger.info("backup.scheduler.stop", {});
  };
}

/** Exposed for the backup tab's manual "Sauvegarder maintenant" action. */
export async function runManualBackup(
  repos: Repositories,
  getActor: () => SchedulerActor | null,
): Promise<BackupRunLogEntry | null> {
  const actor = getActor();
  const actorId = actor?.id ?? "system";
  const actorName = actor?.name ?? "Session courante";
  const startedAt = Date.now();
  try {
    const result = await repos.backups.runBackup(actorId, actorName);
    const entry: BackupRunLogEntry = result.ok
      ? {
          at: new Date().toISOString(),
          status: "success",
          archiveId: result.value.id,
          sizeBytes: result.value.sizeBytes,
          durationMs: Date.now() - startedAt,
          trigger: "manual",
        }
      : {
          at: new Date().toISOString(),
          status: "failed",
          durationMs: Date.now() - startedAt,
          trigger: "manual",
          error: result.error.userMessage ?? result.error.message,
        };
    appendRunLog(entry);
    return entry;
  } catch (err) {
    const entry: BackupRunLogEntry = {
      at: new Date().toISOString(),
      status: "failed",
      durationMs: Date.now() - startedAt,
      trigger: "manual",
      error: err instanceof Error ? err.message : String(err),
    };
    appendRunLog(entry);
    return entry;
  }
}
