/**
 * Leveled logger for the import engine.
 *
 * Ported from `excel-import-engine/src/utils/logger.js` but uses the
 * project's existing structured logger at `src/core/logging/logger.ts`
 * for actual output. This module is a thin facade that prefixes all
 * messages with `import-engine` so they can be filtered in the dev console.
 *
 * In production, the engine emits structured events that the UI consumes
 * directly — this logger is a fallback for unstructured debugging.
 */
import { logger } from "../../../../core/logging/logger";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class ImportLogger {
  private prefix: string;
  private level: LogLevel;

  constructor(prefix = "import-engine", level: LogLevel = "info") {
    this.prefix = prefix;
    this.level = level;
  }

  private enabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    if (this.enabled("debug")) logger.debug(`[${this.prefix}] ${msg}`, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    if (this.enabled("info")) logger.info(`[${this.prefix}] ${msg}`, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    if (this.enabled("warn")) logger.warn(`[${this.prefix}] ${msg}`, meta);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    if (this.enabled("error")) logger.error(`[${this.prefix}] ${msg}`, meta);
  }

  child(prefix: string): ImportLogger {
    return new ImportLogger(`${this.prefix}:${prefix}`, this.level);
  }
}

export const defaultLogger = new ImportLogger();
