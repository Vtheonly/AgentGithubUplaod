/**
 * Excel import engine — public barrel export.
 *
 * Re-exports the engine class, all types, errors, schemas, and the
 * building-block classes so consumers can compose them directly if
 * needed. The typical entry point is `createImportEngine()` from
 * `./import-engine`.
 */
export { ImportEngine, createImportEngine } from "./import-engine";
export type { ImportEngineConfig, AuditSink, ImportEventMap } from "./import-engine";

export { ImportContext } from "./import-context";

export type {
  ImportState,
  RunStatus,
  FieldType,
  Severity,
  FieldSpec,
  SchemaIdentity,
  ExtractAsTarget,
  ImportSchema,
  ImportRecord,
  ImportIssue,
  SheetResult,
  RunStats,
  UpsertResult,
  ImportSource,
  ImportOptions,
} from "./types";

export {
  FileNotFoundError,
  UnsupportedFormatError,
  SheetNotFoundError,
  SchemaError,
  StorageError,
  ValidationError,
  ConfigurationError,
  AggregatedImportError,
  ImportEngineError,
} from "./errors";
export type { ImportEngineErrorCode } from "./errors";

export { SCHEMAS, findSchemaByName, findSchemaForSheet, listSchemas } from "./schemas";
export { ETAT_SCHEMA } from "./schemas/etat-schema";
export { BON_SCHEMA } from "./schemas/bon-schema";
export { DEVIS_SCHEMA } from "./schemas/devis-schema";
export { REF_SCHEMA } from "./schemas/ref-schema";

export { ExcelParser, defaultParser } from "./parsers/excel-parser";
export type { IterateRowsOptions, IterateRowsResult, SheetInfo } from "./parsers/excel-parser";
export { SheetDetector, defaultDetector } from "./parsers/sheet-detector";

export { RowValidator } from "./validators/row-validator";
export type { RowValidationResult } from "./validators/row-validator";
export { FieldCoercer, defaultCoercer, coerceField, coerceRecord } from "./validators/field-coercer";
export type { CoerceResult } from "./validators/field-coercer";

export { required } from "./validators/rules/required";
export { normalizePhone, validatePhone, phone, phoneList } from "./validators/rules/phone";
export { email } from "./validators/rules/email";
export { enumRule } from "./validators/rules/enum";
export { parseNumber, positiveNumber } from "./validators/rules/positive-number";
export type { ParsedNumber } from "./validators/rules/positive-number";
export { minLength } from "./validators/rules/min-length";
export type { RuleIssue } from "./validators/rules/types";

export { UpsertMatcher } from "./dedupe/upsert-matcher";

export { StorageAdapter } from "./storage/storage-adapter";
export type { StorageRecord, RunAuditEntry } from "./storage/storage-adapter";
export { InMemoryAdapter } from "./storage/in-memory-adapter";

export { JsonReporter } from "./reporters/json-reporter";
export type { JsonReportSummary, JsonReportResult } from "./reporters/json-reporter";
export { ExcelReporter } from "./reporters/excel-reporter";
export type { ExcelReportResult } from "./reporters/excel-reporter";

export { generateRunId, uuid } from "./utils/id";
export { fileChecksum, objectChecksum } from "./utils/checksum";
export { ImportLogger, defaultLogger } from "./utils/logger";
export type { LogLevel } from "./utils/logger";
