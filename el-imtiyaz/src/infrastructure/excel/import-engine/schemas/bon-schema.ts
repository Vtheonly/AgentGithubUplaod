/**
 * BON schema — receipts / client situations.
 *
 * Ported from `excel-import-engine/src/schemas/bonSchema.js`. Loose
 * detection (only `ELEVES` is required). Identity is `eleve + client`
 * (NULL-safe). The `numberOrRef` type tolerates `#REF!` formula errors
 * as warnings rather than errors — broken formulas in the source workbook
 * should not block the import.
 */
import type { ImportSchema } from "../types";

export const BON_SCHEMA: ImportSchema = {
  name: "bon",
  sheetMatchers: [/^BON\s*$/i, /^BONS?$/i],
  headerRow: 10,
  dataStartRow: 12,
  requiredHeaders: ["ELEVES"],
  identity: { fields: ["eleve"], strategy: "upsert" },
  fields: [
    { key: "client", header: "CLIENT", type: "string", required: false },
    { key: "date", header: "DATE", type: "date", required: false },
    { key: "devisAnnuel", header: "DEVIS ANNUEL", type: "number", required: false },
    { key: "eleve", header: "ELEVES", type: "string", required: true },
    { key: "devis", header: "DEVIS", type: "numberOrRef", required: false },
    { key: "totalVerse", header: "TOTAL VERSE", type: "numberOrRef", required: false },
    { key: "resteVerse", header: "RESTE VERSE", type: "numberOrRef", required: false },
  ],
};
