/**
 * Backup scheduler — 24h cycle (plan §13.02).
 *
 * In production, the scheduler ticks every 24 hours and runs a backup
 * using the current session user as the actor (or "system" if no session).
 * In development, the tick is reduced to 5 minutes so the behavior is
 * observable without waiting a full day.
 *
 * The scheduler is a thin wrapper around `setInterval` that delegates to
 * the `BackupRepository.runBackup` method. It is started from
 * `AppShell.tsx` after the user logs in, and the returned unsubscribe
 * function is called on cleanup.
 *
 * Failure handling: backup failures are logged + surfaced via the audit
 * log (the repository already writes a `backup.run` audit entry on
 * success). The scheduler itself swallows errors so a transient failure
 * doesn't crash the app or block the next tick.
 */
import type { Repositories } from "../../app/providers/repository-provider";
import { logger } from "../../core/logger";

export interface SchedulerActor {
  readonly id: string;
  readonly name: string;
}

/** Production tick: 24 hours. */
const PROD_TICK_MS = 24 * 60 * 60 * 1000;
/** Dev tick: 5 minutes (so iteration is observable without waiting a day). */
const DEV_TICK_MS = 5 * 60 * 1000;

/**
 * Start the backup scheduler.
 *
 * @param repos     The Repositories object (used to call `backups.runBackup`).
 * @param getActor  A function returning the current actor (or null). The
 *                  scheduler uses the actor at tick-time, not at start-time,
 *                  so the actor can change across ticks (e.g. user logs
 *                  out and back in as a different user).
 * @returns An unsubscribe function that clears the interval.
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
  const tickMs = isDev ? DEV_TICK_MS : PROD_TICK_MS;
  logger.info("backup.scheduler.start", {
    tickMs,
    mode: isDev ? "dev" : "prod",
  });

  const handle = setInterval(async () => {
    const actor = getActor();
    const actorId = actor?.id ?? "system";
    const actorName = actor?.name ?? "Système (scheduler)";
    try {
      const result = await repos.backups.runBackup(actorId, actorName);
      if (result.ok) {
        logger.info("backup.scheduler.tick.success", {
          archiveId: result.value.id,
          sizeBytes: result.value.sizeBytes,
        });
      } else {
        logger.warn("backup.scheduler.tick.failed", {
          code: result.error.code,
          message: result.error.message,
        });
      }
    } catch (err) {
      // Defensive: the repository should never throw (it returns Err), but
      // we catch here so a transient failure doesn't kill the scheduler.
      logger.error("backup.scheduler.tick.threw", { err });
    }
  }, tickMs);

  // Return the unsubscribe function.
  return () => {
    logger.info("backup.scheduler.stop", {});
    clearInterval(handle);
  };
}
