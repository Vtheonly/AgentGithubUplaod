/**
 * particle-import-engine — Custom Error Types
 *
 * Structured error hierarchy for reliable error handling and diagnostics.
 * Every error includes a machine-readable code and a human-readable message.
 */

export type ErrorCode =
  | 'IMAGE_LOAD_FAILED'
  | 'IMAGE_DECODE_FAILED'
  | 'IMAGE_INVALID_FORMAT'
  | 'IMAGE_TOO_LARGE'
  | 'SAMPLING_FAILED'
  | 'PROJECTION_FAILED'
  | 'FALLBACK_GENERATION_FAILED'
  | 'JOB_NOT_FOUND'
  | 'JOB_ALREADY_RUNNING'
  | 'JOB_CANCELLED'
  | 'RETRY_EXHAUSTED'
  | 'INVALID_CONFIG'
  | 'INVALID_MODE'
  | 'ENGINE_NOT_READY'
  | 'ENGINE_DESTROYED'
  | 'IPC_ERROR'
  | 'UNKNOWN';

export class ImportEngineError extends Error {
  public readonly code: ErrorCode;
  public readonly cause?: Error;
  public readonly timestamp: number;

  constructor(code: ErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = 'ImportEngineError';
    this.code = code;
    this.cause = cause;
    this.timestamp = Date.now();
    Object.setPrototypeOf(this, ImportEngineError.prototype);
  }

  /** Serialise to a plain object for IPC transport. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      cause: this.cause?.message ?? null,
    };
  }
}

/** Thrown when image loading or decoding fails. */
export class ImageLoadError extends ImportEngineError {
  constructor(message: string, cause?: Error) {
    super('IMAGE_LOAD_FAILED', message, cause);
    this.name = 'ImageLoadError';
    Object.setPrototypeOf(this, ImageLoadError.prototype);
  }
}

/** Thrown when pixel sampling encounters an unexpected failure. */
export class SamplingError extends ImportEngineError {
  constructor(message: string, cause?: Error) {
    super('SAMPLING_FAILED', message, cause);
    this.name = 'SamplingError';
    Object.setPrototypeOf(this, SamplingError.prototype);
  }
}

/** Thrown when coordinate projection fails. */
export class ProjectionError extends ImportEngineError {
  constructor(message: string, cause?: Error) {
    super('PROJECTION_FAILED', message, cause);
    this.name = 'ProjectionError';
    Object.setPrototypeOf(this, ProjectionError.prototype);
  }
}

/** Thrown when a job cannot be found or is in an invalid state. */
export class JobError extends ImportEngineError {
  constructor(code: ErrorCode, message: string, cause?: Error) {
    super(code, message, cause);
    this.name = 'JobError';
    Object.setPrototypeOf(this, JobError.prototype);
  }
}

/** Thrown when the engine configuration is invalid. */
export class ConfigError extends ImportEngineError {
  constructor(message: string) {
    super('INVALID_CONFIG', message);
    this.name = 'ConfigError';
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}
