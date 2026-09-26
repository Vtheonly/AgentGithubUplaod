/**
 * Import Configuration types — T-414 (IMPORT-111 / ADR-026, 2026-09-26).
 *
 * A `ImportConfigDocument` is a DATA description of ONE source workbook
 * format: which sheets it carries, how each sheet's columns map to the
 * CANONICAL import record (the field keys consumed by the storage
 * adapters — `nom`, `nem`, `fi`, `v2`, `psy1`…), the value
 * transformations/normalization rules, entity identification, validation
 * and the classification of every column (identity / academic / contact /
 * financial-payment / financial-informational).
 *
 * The GENERIC import engine (`import-engine/`) consumes compiled
 * `ImportSchema`s and never knows any format-specific detail — adding
 * support for a new spreadsheet format is a matter of REGISTERING a new
 * configuration document with the central `ImportConfigRegistry`, never a
 * code change to the engine (the T-105 docstring's promise, now enforced
 * structurally: spreadsheet-specific knowledge lives HERE, as data).
 *
 * Column addressing (the 2027-2026 format's decisive difference):
 *   - `header`      — match by the column's header text (the classic form);
 *   - `headerAliases` — additional accepted header spellings (config-driven,
 *                       superseding the engine's static alias table);
 *   - `column`      — match by column LETTER ("F", "AN") — POSITIONAL
 *                     addressing for columns whose header cell is EMPTY or
 *                     AMBIGUOUS (the new format's student-name column F has
 *                     no header; its three CREANCE SEPT columns share one
 *                     header). When `column` is set it takes PRECEDENCE.
 *
 * Everything here is JSON-serializable (RegExp sources as strings, dates as
 * ISO strings) so configurations can be persisted, exported, versioned and
 * — as a future extension — loaded from a database-backed store instead of
 * the built-in one (`ImportConfigStore`, see extensions.ts).
 */
import type { ExtractAsTarget, FieldType, SchemaIdentity } from "../import-engine/types";

// Re-exported for config authors (single import surface).
export type { FieldType };

/** Classification of a mapped column — audit/tooling/documentation metadata. */
export type ImportFieldRole =
  | "identity" // student/parent identification (NOM, NEM)
  | "academic" // niveau, CLASSE, OPTION
  | "contact" // E-MAIL
  | "note" // INFOS, COL_A free-text flags
  | "financial-charge" // amounts the family OWES (DEVIS ANNUEL, DETTES)
  | "financial-payment" // amounts the family PAID (FI, V1, PSY1, LIVRES…)
  | "financial-informational" // balances/arrears the LEDGER recomputes (TOTAL*CREANCE, CREANCE SEPT)
  | "reference"; // REF-sheet lookup lists

/** One column → canonical-field mapping. */
export interface ImportFieldMapping {
  /** Canonical record key (camelCase) — the storage adapters' contract. */
  readonly key: string;
  /** Header text in the source sheet (omit for headerless columns). */
  readonly header?: string;
  /** Accepted header spellings — config-driven aliases. */
  readonly headerAliases?: readonly string[];
  /** Column letter (A…ZZ) — positional address; takes precedence when set. */
  readonly column?: string;
  readonly type: FieldType;
  readonly required?: boolean;
  /** For `enum` fields: the allowed values. */
  readonly values?: readonly string[];
  /** For `enum` fields: unknown values warn (row still imports). */
  readonly tolerateUnknown?: boolean;
  readonly minLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly default?: unknown;
  readonly count?: number;
  readonly monthLabels?: readonly string[];
  readonly uppercase?: boolean;
  readonly lowercase?: boolean;
  /** Human documentation: the canonical business concept this column carries. */
  readonly concept: string;
  /** Column classification (audit/tooling — not consumed by the engine). */
  readonly role: ImportFieldRole;
}

/** One sheet's interpretation inside a workbook format. */
export interface ImportSheetConfig {
  /** Engine schema name — the STORAGE ADAPTER dispatches on this ("etat"). */
  readonly name: string;
  readonly description?: string;
  /** Sheet-name regex sources (string form — serializable; case-insensitive). */
  readonly sheetMatchers: readonly string[];
  /** Header row index (1-based); 0 = headerless sheet (synthetic A/B/C…). */
  readonly headerRow: number;
  readonly dataStartRow?: number;
  /**
   * Headers that characterize THIS sheet/format. Used for (a) tier-2 sheet
   * detection and (b) FORMAT disambiguation when several formats share a
   * sheet NAME ("ETAT 20262027" exists in both supported workbooks) — the
   * format whose requiredHeaders are ALL present wins.
   */
  readonly requiredHeaders: readonly string[];
  readonly identity: SchemaIdentity;
  readonly fields: readonly ImportFieldMapping[];
  readonly extractAs?: Record<string, ExtractAsTarget>;
  /**
   * Disambiguation precedence (lower = examined first) among same-named
   * sheets of different formats. Default 100.
   */
  readonly detectionPriority?: number;
  /** What this sheet represents in the canonical model. */
  readonly canonicalConcept?: string;
}

/** A sheet that is deliberately NOT imported from this workbook format. */
export interface ExcludedSheetConfig {
  /** Sheet-name regex sources identifying the excluded sheet. */
  readonly sheetMatchers: readonly string[];
  readonly reason: string;
}

/** A declarative value transformation (documentation + audit surface). */
export interface ImportTransformationNote {
  readonly appliesTo: string;
  readonly description: string;
}

/** One complete workbook format description. */
export interface ImportConfigDocument {
  /** Stable configuration id, e.g. "etat-2027-2026". */
  readonly id: string;
  /** Document schema version (bump when the mapping evolves). */
  readonly version: number;
  /** Human label, e.g. "ETAT — Suivis clients 2026/2027 (ancien format)". */
  readonly formatLabel: string;
  readonly description: string;
  /** The academic year this format was used for (documentation). */
  readonly academicYearHint?: string;
  /** Where the format came from (the forensic evidence trail). */
  readonly sourceProvenance?: string;
  readonly enabled: boolean;
  readonly sheets: readonly ImportSheetConfig[];
  /** Sheets present in the workbook but deliberately not imported. */
  readonly excludedSheets?: readonly ExcludedSheetConfig[];
  /** Normalization/transformation rules the engine applies for this format. */
  readonly transformations?: readonly ImportTransformationNote[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Structural validation issue found in a config document. */
export interface ImportConfigIssue {
  readonly path: string;
  readonly message: string;
}

/** Lightweight registry listing entry. */
export interface ImportConfigSummary {
  readonly id: string;
  readonly version: number;
  readonly formatLabel: string;
  readonly academicYearHint?: string;
  readonly enabled: boolean;
  readonly sheetNames: readonly string[];
}
