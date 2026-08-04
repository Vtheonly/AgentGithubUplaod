/**
 * Excel import engine — shared types.
 *
 * Ported from the standalone `excel-import-engine` CommonJS package and
 * adapted to TypeScript with the project's domain types.
 *
 * The schema-driven design means the engine is generic — adding support
 * for a new Excel format is a matter of registering a new `ImportSchema`,
 * not changing engine code.
 */

/** Animation morphing mode — kept for parity with the standalone engine. */
export type ImportState = "pending" | "loading" | "sampling" | "projecting" | "ready" | "running" | "paused" | "error" | "destroyed";

/** Run status derived from `ImportContext.stats`. */
export type RunStatus = "running" | "success" | "partial" | "failed";

/** Field types accepted by the schema's `FieldSpec.type`. */
export type FieldType =
  | "string"
  | "email"
  | "phone"
  | "phoneList"
  | "number"
  | "numberOrRef"
  | "enum"
  | "date"
  | "boolean"
  | "monthlyArray";

/** Severity for error/warning entries. */
export type Severity = "error" | "warn";

/** A single field declaration in a schema. */
export interface FieldSpec {
  /** Canonical field key (camelCase) used in the coerced record. */
  readonly key: string;
  /** Original header text in the source spreadsheet. */
  readonly header: string;
  readonly type: FieldType;
  readonly required: boolean;
  /** For `enum` fields: the allowed values (will be uppercased). */
  readonly values?: readonly string[];
  /**
   * For `enum` fields: when true, unknown values are recorded as warnings
   * (not errors) so the row still imports. Used for fields where the real
   * spreadsheet contains operator-invented variants (e.g. `niveau` codes).
   */
  readonly tolerateUnknown?: boolean;
  /** For `string`/`email` fields: minimum trimmed length. */
  readonly minLength?: number;
  /** For `number`/`numberOrRef` fields: minimum value. */
  readonly min?: number;
  /** For `number`/`numberOrRef` fields: maximum value. */
  readonly max?: number;
  /** Default value if the cell is empty (only when `required: false`). */
  readonly default?: unknown;
  /** For `monthlyArray` fields: number of contiguous columns to aggregate. */
  readonly count?: number;
  /** For `monthlyArray` fields: month labels (e.g. `["sep","oct",...]`). */
  readonly monthLabels?: readonly string[];
  /** Case transformation for `string` fields. */
  readonly uppercase?: boolean;
  readonly lowercase?: boolean;
}

/** Identity definition for upsert matching. */
export interface SchemaIdentity {
  /** Header names (original case) whose values form the identity key. */
  readonly fields: readonly string[];
  /** `'upsert'` updates existing records; `'insert'` always inserts. */
  readonly strategy: "upsert" | "insert";
}

/** For REF schema: fan-out a single row into multiple reference tables. */
export interface ExtractAsTarget {
  readonly table: string;
  readonly column: string;
}

/** A complete schema for one Excel sheet. */
export interface ImportSchema {
  readonly name: string;
  /** Regex patterns tested against the sheet name (case-insensitive). */
  readonly sheetMatchers: readonly RegExp[];
  /** Header row index (1-based). `0` means "no header" (synthetic A/B/C…). */
  readonly headerRow: number;
  /** First data row (1-based). Defaults to `headerRow + 1`. */
  readonly dataStartRow?: number;
  /** Headers that must be present for tier-2 sheet detection. */
  readonly requiredHeaders: readonly string[];
  readonly identity: SchemaIdentity;
  readonly fields: readonly FieldSpec[];
  /** For REF: maps field keys to (table, column) targets. */
  readonly extractAs?: Record<string, ExtractAsTarget>;
}

/** A coerced + validated row ready for storage. */
export type ImportRecord = Record<string, unknown>;

/** A single error or warning produced during validation. */
export interface ImportIssue {
  readonly runId: string;
  readonly sheet: string | null;
  readonly rowIndex?: number;
  readonly field?: string;
  readonly header?: string;
  readonly rule: string;
  readonly message: string;
  readonly severity: Severity;
  readonly rawValue?: string;
}

/** Per-sheet rollup of run statistics. */
export interface SheetResult {
  readonly sheet: string;
  readonly schema: string;
  rowsRead: number;
  rowsImported: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsRejected: number;
}

/** Aggregate run statistics. */
export interface RunStats {
  sheetsProcessed: number;
  rowsRead: number;
  rowsImported: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsRejected: number;
  warnings: number;
}

/** Result of an upsert operation. */
export interface UpsertResult {
  readonly action: "insert" | "update" | "skip";
  readonly id?: string | number;
}

/** Optional source metadata attached to a run. */
export interface ImportSource {
  readonly user?: string;
  readonly triggeredBy?: string;
  readonly [key: string]: unknown;
}

/** Options passed to `ImportEngine.importFile`. */
export interface ImportOptions {
  /** Restrict processing to these sheet names. */
  readonly sheets?: readonly string[];
  /** Restrict processing to these schema names. */
  readonly schemas?: readonly string[];
  /** Validate without writing to storage. */
  readonly dryRun?: boolean;
  /** Reject the entire run if any error occurs (post-commit). */
  readonly strict?: boolean;
  /** Override the configured report directory for this run. */
  readonly reportDir?: string;
  /** Source metadata (user, origin, etc.). */
  readonly source?: ImportSource;
}
