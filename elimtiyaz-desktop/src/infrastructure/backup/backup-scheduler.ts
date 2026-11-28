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
// T-581 (BUG-015): the tenant literal becomes INJECTED context — the
// canonical single-tenant identity of record is imported ONCE (seed-data),
// and the acting session's tenant rides the scheduler actor.
import { TENANT_ID } from "../mock/seed-data";
// T-581 (BUG-051): the daemon reads the DB-CONFIGURED schedule (the same
// system_settings keys the Settings → Sauvegarde tab displays), never a
// hardcoded hour.
import { isSupabaseConfigured, getSupabaseClient } from "../supabase/backend-access";
import { getSystemConfigService } from "../system-config";

export interface SchedulerActor {
  readonly id: string;
  readonly name: string;
  /** T-581 (BUG-015): the acting session's tenant (injected context). */
  readonly tenantId?: string;
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

/** T-301 (OFFLINE-400): localStorage key for the persisted on/off preference. */
const SCHEDULER_ENABLED_KEY = "el-imtiyaz:backup-scheduler-enabled";

/**
 * T-301 (OFFLINE-400): is the automatic scheduler enabled? DEFAULT ON —
 * preserves the pre-T-301 unconditional arming (vault §13.01's 24h daemon).
 */
export function isSchedulerEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    const raw = localStorage.getItem(SCHEDULER_ENABLED_KEY);
    // Absent key = the default (ON). Only an explicit "false" disables.
    return raw !== "false";
  } catch {
    return true;
  }
}

/** T-301: persist the on/off preference (read at scheduler start AND at every tick). */
export function setSchedulerEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SCHEDULER_ENABLED_KEY, enabled ? "true" : "false");
    }
  } catch {
    /* best-effort persistence */
  }
}

/**
 * T-627 (C-25): the scheduler flag reads TENANT-FIRST — the tenant row
 * (`backup.scheduler_enabled`, read through `read_public_settings`) → the
 * device cache → the default-ON. FAIL-OPEN: any read failure degrades to
 * the device/default value (the daemon must never refuse to arm because a
 * settings read failed — the readBackupScheduleConfig pattern).
 */
export async function readSchedulerEnabledConfig(): Promise<boolean> {
  try {
    if (!isSupabaseConfigured()) return isSchedulerEnabled();
    const client = getSupabaseClient();
    const { data, error } = await client.rpc("read_public_settings");
    if (error || !data || typeof data !== "object") return isSchedulerEnabled();
    const v = (data as { backupSchedulerEnabled?: unknown }).backupSchedulerEnabled;
    // A null row = "never configured" → the device cache → the default ON.
    return typeof v === "boolean" ? v : isSchedulerEnabled();
  } catch {
    return isSchedulerEnabled(); // fail-open
  }
}

/** T-301: the next scheduled run moment (the toggle card's "prochaine exécution
 * à ~02:00" display; dev mode ticks every 5 minutes instead). T-581: the
 * DEFAULT schedule (the daemon itself re-reads the DB config at every
 * re-arm — the async readBackupScheduleConfig is the authoritative one). */
export function nextScheduledRunAt(now: Date = new Date()): Date {
  const isDev = readDevFlag();
  return new Date(
    now.getTime() +
      (isDev ? DEV_TICK_MS : msUntilNextScheduledRun(now, DEFAULT_BACKUP_SCHEDULE)),
  );
}

/** Dev tick: 5 minutes (so iteration is observable without waiting a day). */
const DEV_TICK_MS = 5 * 60 * 1000;

/**
 * T-581 (BUG-051) — the DB-configured schedule shape. The keys are the
 * EXACT ones the Settings → Sauvegarde tab reads (`backup.schedule_time`
 * "HH:MM" + `backup.schedule_hours`, category "backup"); the defaults are
 * the vault §13.01 values (daily at ~02:00). The hardcoded SCHEDULE_HOUR
 * constant is DEAD — the daemon re-reads the config at every re-arm, so a
 * schedule change actually takes effect.
 */
export interface BackupScheduleConfig {
  /** Daily scheduled moment, "HH:MM" (default "02:00"). */
  readonly scheduleTime: string;
  /** Re-run interval in hours when the moment has passed (default 24). */
  readonly scheduleHours: number;
}

export const DEFAULT_BACKUP_SCHEDULE: BackupScheduleConfig = {
  scheduleTime: "02:00",
  scheduleHours: 24,
};

/** T-581 (BUG-051): read the DB-configured schedule (fail-open to the vault defaults). */
export async function readBackupScheduleConfig(): Promise<BackupScheduleConfig> {
  try {
    if (!isSupabaseConfigured()) return DEFAULT_BACKUP_SCHEDULE;
    const service = getSystemConfigService(getSupabaseClient());
    const result = await service.listByCategory("backup");
    if (!result.ok) return DEFAULT_BACKUP_SCHEDULE;
    let scheduleTime = DEFAULT_BACKUP_SCHEDULE.scheduleTime;
    let scheduleHours = DEFAULT_BACKUP_SCHEDULE.scheduleHours;
    for (const s of result.value) {
      if (s.key === "backup.schedule_hours" && typeof s.value === "number") {
        scheduleHours = s.value;
      } else if (s.key === "backup.schedule_time" && typeof s.value === "string") {
        scheduleTime = s.value;
      }
    }
    return { scheduleTime, scheduleHours };
  } catch {
    return DEFAULT_BACKUP_SCHEDULE;
  }
}

/**
 * Milliseconds until the next scheduled run. T-581 (BUG-051): the
 * computation follows the config — the scheduled moment (HH:MM), advanced
 * by scheduleHours while it is in the past (the SAME semantics the
 * Settings tab's display uses, so the daemon and the UI never disagree).
 */
function msUntilNextScheduledRun(now: Date, cfg: BackupScheduleConfig): number {
  const [h, m] = cfg.scheduleTime.split(":").map((x) => parseInt(x, 10));
  const next = new Date(now);
  next.setHours(Number.isNaN(h) ? 2 : h, Number.isNaN(m) ? 0 : m, 0, 0);
  while (next.getTime() <= now.getTime()) {
    next.setHours(next.getHours() + Math.max(1, cfg.scheduleHours));
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
    // T-581 (BUG-051): the DB-configured schedule is the authority (the
    // hardcoded hour is dead); the log line carries the default and the
    // config-read marker.
    defaultSchedule: DEFAULT_BACKUP_SCHEDULE,
    readsDbSchedule: true,
    // T-301: the persisted preference rides the log line (a disabled
    // scheduler starts in DORMANT mode — the timer keeps cycling so a
    // runtime re-enable resumes instantly, but NO backup ever runs while
    // disabled; manual backups are unaffected).
    enabled: isSchedulerEnabled(),
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function runTick(trigger: "scheduled" | "manual") {
    // T-301 (OFFLINE-400) + T-627 (C-25): every SCHEDULED tick reads the
    // flag TENANT-FIRST (the tenant row → the device cache → default ON,
    // fail-open). A disabled scheduler no-ops the tick and keeps idling —
    // flipping the toggle back on resumes at the next tick without an
    // app restart; manual runs never pass through here.
    if (trigger === "scheduled" && !(await readSchedulerEnabledConfig())) {
      logger.info("backup.scheduler.skipped_disabled", { trigger });
      return;
    }
    const actor = getActor();
    const actorId = actor?.id ?? "system";
    const actorName = actor?.name ?? "Système (scheduler)";
    // T-581 (BUG-015): the tenant context is INJECTED (the acting
    // session's tenant, falling back to the canonical single-tenant
    // identity of record — never a scattered literal).
    const tenantId = actor?.tenantId ?? TENANT_ID;
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
        tenantId,
        diff: { before: null, after: capacity },
        note: `Alerte espace coffre : ${capacity.usedPercent}% utilisé (seuil 80%)`,
      }).then(() => undefined, () => undefined);
      return;
    }

    try {
      const result = await repos.backups.runBackup(actorId, actorName, tenantId);
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

  async function armNext() {
    if (stopped) return;
    // T-581 (BUG-051): the re-arm READS the DB schedule every cycle — a
    // schedule change takes effect at the next re-arm without a restart.
    const cfg = isDev ? DEFAULT_BACKUP_SCHEDULE : await readBackupScheduleConfig();
    const delay = isDev ? DEV_TICK_MS : msUntilNextScheduledRun(new Date(), cfg);
    timer = setTimeout(async () => {
      await runTick("scheduled");
      armNext();
    }, delay);
    logger.info("backup.scheduler.armed", {
      nextRunInMs: delay,
      nextRunAt: new Date(Date.now() + delay).toISOString(),
      // T-581: the ACTUAL schedule this arm used (DB config or default).
      schedule: cfg,
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
  // T-581 (BUG-015): the tenant context rides the manual path too.
  const tenantId = actor?.tenantId ?? TENANT_ID;
  const startedAt = Date.now();
  try {
    const result = await repos.backups.runBackup(actorId, actorName, tenantId);
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
