/**
 * Validator rules — shared types.
 *
 * Each rule function in this directory returns a `RuleIssue | null`. The
 * caller (`FieldCoercer` + `ImportContext`) wraps the issue into a full
 * `ImportIssue` by attaching `runId`, `sheet`, `rowIndex`, and `severity`.
 *
 * Ported from the CommonJS `excel-import-engine` package — the original
 * rules returned plain objects without `field`/`header`; those are now
 * populated explicitly so the caller doesn't need to re-derive them.
 */
import type { FieldSpec } from "../../types";

/**
 * A validation issue produced by a single rule.
 *
 * Lighter than `ImportIssue`: missing `runId`, `sheet`, `rowIndex`, and
 * `severity`, which are attached by the caller.
 */
export interface RuleIssue {
  /** Canonical field key (camelCase) the issue applies to. */
  readonly field: string;
  /** Original spreadsheet header for the field. */
  readonly header: string;
  /** Rule identifier, e.g. `"required"`, `"phone"`, `"email"`. */
  readonly rule: string;
  /** Human-readable (French) message. */
  readonly message: string;
  /** The raw cell value, when relevant. */
  readonly rawValue?: string;
}

/** Re-export so rules can import `FieldSpec` from a single local path. */
export type { FieldSpec };
