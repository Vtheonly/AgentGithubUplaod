/**
 * ETAT schema — main client/student roster.
 *
 * Ported from `excel-import-engine/src/schemas/etatSchema.js`. The schema
 * for the `ETAT 20262027` sheet of the `Suivis clients AAAA_AAAA.xlsx`
 * workbook. Each row represents one student with embedded parent + financial
 * metadata.
 *
 * Identity: `NEM` (parent phone, may be multi-value "06xxx/07xxx") + `NOM`
 * (student full name). Re-importing the same file updates existing records
 * in place rather than duplicating them.
 */
import type { ImportSchema } from "../types";

export const ETAT_SCHEMA: ImportSchema = {
  name: "etat",
  sheetMatchers: [/^ETAT/i, /^ETAT\s*\d+/i],
  headerRow: 1,
  requiredHeaders: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
  identity: { fields: ["NEM", "NOM"], strategy: "upsert" },
  fields: [
    { key: "infos", header: "INFOS", type: "string", required: false },
    { key: "email", header: "E-MAIL", type: "email", required: false },
    { key: "nem", header: "NEM", type: "phoneList", required: true },
    { key: "tuteur", header: "TUTEUR", type: "string", required: false },
    { key: "nom", header: "NOM", type: "string", required: true, minLength: 2 },
    { key: "niveau", header: "niveau", type: "enum", required: true, values: ["PRIM", "COLG", "GS", "LYC"] },
    { key: "classe", header: "CLASSE", type: "string", required: true },
    { key: "option", header: "OPTION", type: "enum", required: false, values: ["TRNSP", ""] },
    { key: "remise", header: "REMISE", type: "number", required: false, default: 0, min: 0 },
    { key: "justification", header: "JUSTIFICATION", type: "string", required: false },
    { key: "devisAnnuel", header: "DEVIS ANNUEL", type: "number", required: true, min: 0 },
    { key: "remboursement", header: "REMBOURCEMENT", type: "number", required: false, default: 0, min: 0 },
    { key: "dettes", header: "DETTES", type: "number", required: false, default: 0, min: 0 },
    {
      key: "reglements",
      header: "REGLEMENTS DETTES",
      type: "monthlyArray",
      required: false,
      count: 12,
      monthLabels: ["sep", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug"],
    },
  ],
};
