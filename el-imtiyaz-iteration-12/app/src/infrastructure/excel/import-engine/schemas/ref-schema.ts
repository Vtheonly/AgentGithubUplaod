/**
 * REF schema — reference data (teachers, classes, localities).
 *
 * Ported from `excel-import-engine/src/schemas/refSchema.js`. Uses
 * `headerRow: 0` as a sentinel meaning "no header row" — the parser
 * generates synthetic `A`, `B`, `C`, `D`… headers from column count.
 *
 * Identity is empty (`strategy: 'insert'`) — rows are deduplicated via
 * `INSERT OR IGNORE` on each ref table's UNIQUE constraint.
 *
 * The `extractAs` map drives the multi-table fan-out: one REF row can
 * produce up to 3 inserts across `ref_enseignants`, `ref_classes`, and
 * `ref_localites`.
 */
import type { ImportSchema } from "../types";

export const REF_SCHEMA: ImportSchema = {
  name: "ref",
  sheetMatchers: [/^REF$/i, /^REFERENCES?$/i],
  headerRow: 0,
  requiredHeaders: [],
  identity: { fields: [], strategy: "insert" },
  fields: [
    { key: "enseignant", header: "A", type: "string", required: false },
    { key: "classe", header: "B", type: "string", required: false },
    { key: "localite", header: "D", type: "string", required: false },
  ],
  extractAs: {
    enseignant: { table: "ref_enseignants", column: "nom" },
    classe: { table: "ref_classes", column: "code" },
    localite: { table: "ref_localites", column: "nom" },
  },
};
