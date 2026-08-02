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
 *
 * Iteration 14 — schema aligned with the documented business reality in
 * `Clients_Sheet_Merged.txt`:
 *   - `niveau` enum expanded to include every code that appears in the real
 *     sheet: PRIM, COLG, LYC, GS, MS, PS, TPS, AUTISTE, NV2, NV3, NV4, NV5,
 *     CLYC, LYCI. Unknown values are recorded as warnings (so the row still
 *     imports) — this is intentional because operators occasionally invent
 *     ad-hoc codes for special cases.
 *   - `OPTION` enum accepts the canonical `TRNSP` plus the documented typos
 *     `TENSP` and `TRNP`. Unknown values are recorded as warnings rather than
 *     errors.
 *   - `NEM` is no longer `required` — the business doc describes it as
 *     "purely informational" and "goes nowhere" (no downstream system uses
 *     it). Many valid students in the real sheet have no parent phone.
 *   - `email` keeps its type, but invalid emails are downgraded to warnings
 *     by the optional-field-tolerance rule in the coercer (iteration 14).
 */
import type { ImportSchema } from "../types";

export const ETAT_SCHEMA: ImportSchema = {
  name: "etat",
  sheetMatchers: [/^ETAT/i, /^ETAT\s*\d+/i],
  headerRow: 1,
  requiredHeaders: ["NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
  identity: { fields: ["NEM", "NOM"], strategy: "upsert" },
  fields: [
    { key: "infos", header: "INFOS", type: "string", required: false },
    { key: "email", header: "E-MAIL", type: "email", required: false },
    { key: "nem", header: "NEM", type: "phoneList", required: false },
    { key: "tuteur", header: "TUTEUR", type: "string", required: false },
    { key: "nom", header: "NOM", type: "string", required: true, minLength: 2 },
    {
      key: "niveau",
      header: "niveau",
      type: "enum",
      required: true,
      // Per Clients_Sheet_Merged.txt → "01 - Level Codes (niveau)":
      //   PRIM/COLG/LYC  — broad school levels
      //   GS/MS/PS/TPS   — pre-school sections
      //   AUTISTE        — special-needs class
      //   NV2/3/4/5      — non-gradeable variants
      //   CLYC/LYCI      — lycée variants (typos in source data, accepted)
      values: [
        "PRIM", "COLG", "LYC",
        "GS", "MS", "PS", "TPS",
        "AUTISTE",
        "NV2", "NV3", "NV4", "NV5",
        "CLYC", "LYCI",
      ],
      // Unknown enum values become warnings, not errors (see FieldCoercer).
      tolerateUnknown: true,
    },
    { key: "classe", header: "CLASSE", type: "string", required: true },
    {
      key: "option",
      header: "OPTION",
      type: "enum",
      required: false,
      // Per Clients_Sheet_Merged.txt → "04 - Option Codes":
      //   TRNSP — transport needed (canonical)
      //   TENSP — variant / probable typo (4 occurrences in real sheet)
      //   TRNP  — variant / probable typo (1 occurrence in real sheet)
      values: ["TRNSP", "TENSP", "TRNP", ""],
      tolerateUnknown: true,
    },
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
