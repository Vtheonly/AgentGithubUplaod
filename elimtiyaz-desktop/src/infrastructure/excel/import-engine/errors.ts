/**
 * Excel import engine — typed error hierarchy.
 *
 * Ported from the standalone `excel-import-engine/src/errors.js` and
 * adapted to the El-Imtiyaz codebase conventions (TypeScript, ES modules,
 * stable `code` strings for IPC + audit log correlation).
 *
 * Every error carries a stable `code` so the UI can branch on type without
 * parsing the message. The codes match the standalone engine's strings
 * for backward compatibility with any external tooling that consumes
 * audit log entries.
 */
export type ImportEngineErrorCode =
  | "IMPORT_ENGINE_ERROR"
  | "FILE_NOT_FOUND"
  | "UNSUPPORTED_FORMAT"
  | "SHEET_NOT_FOUND"
  | "SCHEMA_ERROR"
  | "STORAGE_ERROR"
  | "VALIDATION_ERROR"
  | "CONFIGURATION_ERROR"
  | "AGGREGATED_IMPORT_ERRORS"
  | "STRICT_MODE_REJECTED"
  /** VAULT §14.02 — atomic import aborted (row errors → full rollback). */
  | "ATOMIC_IMPORT_ABORTED";

export class ImportEngineError extends Error {
  readonly code: ImportEngineErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: ImportEngineErrorCode = "IMPORT_ENGINE_ERROR",
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class FileNotFoundError extends ImportEngineError {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`, "FILE_NOT_FOUND", { filePath });
  }
}

export class UnsupportedFormatError extends ImportEngineError {
  constructor(filePath: string, reason: string) {
    super(`Unsupported format for ${filePath}: ${reason}`, "UNSUPPORTED_FORMAT", { filePath, reason });
  }
}

export class SheetNotFoundError extends ImportEngineError {
  constructor(sheetName: string, availableSheets: readonly string[]) {
    super(
      `Sheet "${sheetName}" not found. Available: ${availableSheets.join(", ") || "(none)"}`,
      "SHEET_NOT_FOUND",
      { sheetName, availableSheets },
    );
  }
}

export class SchemaError extends ImportEngineError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, "SCHEMA_ERROR", details);
  }
}

export class StorageError extends ImportEngineError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, "STORAGE_ERROR", details);
  }
}

export class ValidationError extends ImportEngineError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, "VALIDATION_ERROR", details);
  }
}

export class ConfigurationError extends ImportEngineError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, "CONFIGURATION_ERROR", details);
  }
}

export class AggregatedImportError extends ImportEngineError {
  readonly failures: readonly ImportEngineError[];
  constructor(summary: string, failures: readonly ImportEngineError[] = []) {
    super(summary, "AGGREGATED_IMPORT_ERRORS", { failureCount: failures.length });
    this.failures = failures;
  }
}
