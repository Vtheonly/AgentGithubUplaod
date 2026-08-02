/**
 * Particle engine — typed error hierarchy.
 *
 * Mirrors the standalone engine's error classes but uses the project's
 * `AppError`-friendly shape (stable `code` + human-readable `message`).
 * Errors are thrown by the pipeline stages and can be surfaced to the UI
 * via the existing toast / modal infrastructure.
 */

export type ParticleErrorCode =
  | "IMAGE_LOAD_FAILED"
  | "IMAGE_DECODE_FAILED"
  | "IMAGE_INVALID_FORMAT"
  | "IMAGE_TOO_LARGE"
  | "SAMPLING_FAILED"
  | "PROJECTION_FAILED"
  | "FALLBACK_GENERATION_FAILED"
  | "INVALID_CONFIG"
  | "INVALID_MODE"
  | "ENGINE_NOT_READY"
  | "ENGINE_DESTROYED"
  | "UNKNOWN";

export class ParticleEngineError extends Error {
  readonly code: ParticleErrorCode;
  readonly cause?: unknown;
  readonly timestamp: string;

  constructor(message: string, code: ParticleErrorCode = "UNKNOWN", cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (cause !== undefined) this.cause = cause;
    this.timestamp = new Date().toISOString();
    // Restore prototype chain after Error extension (TS quirk)
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      cause: this.cause instanceof Error ? { name: this.cause.name, message: this.cause.message } : this.cause,
    };
  }
}

export class ImageLoadError extends ParticleEngineError {
  constructor(message: string, cause?: unknown) {
    super(message, "IMAGE_LOAD_FAILED", cause);
  }
}

export class SamplingError extends ParticleEngineError {
  constructor(message: string, cause?: unknown) {
    super(message, "SAMPLING_FAILED", cause);
  }
}

export class ProjectionError extends ParticleEngineError {
  constructor(message: string, cause?: unknown) {
    super(message, "PROJECTION_FAILED", cause);
  }
}

export class ConfigError extends ParticleEngineError {
  constructor(message: string) {
    super(message, "INVALID_CONFIG");
  }
}
