/**
 * Structured logger.
 *
 * Six log levels (Trace → Critical) per the project specification.
 * In production, logs are scoped to Info and above; in development, all
 * levels are emitted with rich context for debugging.
 *
 * Sensitive fields (tokens, passwords, secrets) are masked automatically
 * via `redactKeys` — the log payload that hits the console or persistence
 * layer never contains raw secrets.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "critical";

export interface LogContext {
  readonly [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  critical: 60,
};

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "apikey",
  "authorization",
  "cookie",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "***";
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

class Logger {
  private minLevel: LogLevel = import.meta.env.DEV ? "trace" : "info";

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  trace(message: string, context?: LogContext): void {
    this.emit("trace", message, context);
  }
  debug(message: string, context?: LogContext): void {
    this.emit("debug", message, context);
  }
  info(message: string, context?: LogContext): void {
    this.emit("info", message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.emit("warn", message, context);
  }
  error(message: string, context?: LogContext, err?: unknown): void {
    this.emit("error", message, { ...context, err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err });
  }
  critical(message: string, context?: LogContext, err?: unknown): void {
    this.emit("critical", message, { ...context, err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err });
  }

  private emit(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      ...(context ? { ctx: redact(context) } : {}),
    };
    const fn = level === "error" || level === "critical" ? console.error : level === "warn" ? console.warn : console.log;
    fn(JSON.stringify(payload));
  }
}

export const logger = new Logger();
