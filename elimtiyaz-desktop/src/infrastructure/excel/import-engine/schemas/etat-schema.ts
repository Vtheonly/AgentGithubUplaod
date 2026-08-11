/**
 * ETAT schema — main client/student roster.
 *
 * Schema for the `ETAT 20262027` sheet of the `Suivis clients AAAA_AAAA.xlsx`
 * workbook. Each row represents one student with embedded parent + financial
 * metadata.
 *
 * Identity: `NEM` (parent phone, may be multi-value "06xxx/07xxx") + `NOM`
 * (student full name in `LASTNAME FIRSTNAME` order). Re-importing the same
 * file updates existing records in place rather than duplicating them.
 *
 * Field mapping (verified against the real `Suivis clients 2026_2027.xlsx`
 * and the column documentation in `Clients_Sheet_Merged.md`):
 *
 *   | Col | Header               | Field key      | Type     |
 *   |----:|----------------------|----------------|----------|
 *   | B   | INFOS                | infos          | string   |
 *   | C   | E-MAIL               | email          | email    |
 *   | D   | NEM                  | nem            | phoneList|
 *   | E   | TUTEUR               | tuteur         | string   |
 *   | F   | NOM                  | nom            | string   |
 *   | G   | niveau               | niveau         | enum     |
 *   | H   | CLASSE               | classe         | string   |
 *   | I   | OPTION               | option         | enum     |
 *   | J   | REMISE               | remise         | number   |
 *   | K   | JUSTIFICATION        | justification  | string   |
 *   | L   | DEVIS ANNUEL         | devisAnnuel    | number   | (formula — cached result is read)
 *   | M   | REMBOURCEMENT        | remboursement  | number   |
 *   | N   | DETTES               | dettes         | number   |
 *   | O   | REGLEMENTS DETTES    | reglementsDettes | number | (single column, not 12 months)
 *   | P   | TOTAL VERSEMENTS     | totalVersements | number  | (formula — informational)
 *   | Q   | TOTAL*CREANCE        | totalCreance   | number   | (formula — informational)
 *   | R   | FI                   | fi             | number   | (registration fee paid)
 *   | S   | V2                   | v2             | number   | (2nd tuition installment paid)
 *   | T   | 2V                   | v2Alt          | number   | (alt 2nd installment — rarely used)
 *   | U   | v3                   | v3             | number   | (3rd tuition installment paid)
 *   | V   | DISTINATION          | distination    | string   | (transport town — text, NOT a number)
 *   | W   | 1T                   | t1             | number   | (1st transport tranche paid)
 *   | X   | T2                   | t2             | number   | (2nd transport tranche paid)
 *   | Y   | t3                   | t3             | number   | (3rd transport tranche paid)
 *   | Z   | PSY1                 | psy1           | number   | (psychology session 1 — therapy_psychology)
 *   | AA  | PSY2                 | psy2           | number   | (psychology session 2 — therapy_psychology)
 *   | AB  | ORTH1                | orth1          | number   | (speech therapy session 1 — therapy_speech)
 *   | AC  | ORTH2                | orth2          | number   | (speech therapy session 2 — therapy_speech)
 *   | AD  | E-PLANT              | eplant         | number   | (extra support plan payment)
 *   | AE  | Ratrapage            | ratrapage      | number   | (catch-up session payment)
 *   | AF  | SEPTEMBRE            | septembre      | number   | (September quarterly tranche)
 *   | AG  | CREANCES SEPTEMBRE   | creanceSeptembre | number | (September outstanding — informational)
 *   | AH  | DECEMBRE             | decembre       | number   | (December quarterly tranche)
 *   | AI  | CREANCES DECEMBRE    | creanceDecembre | number  | (December outstanding — informational)
 *   | AJ  | MARS                 | mars           | number   | (March quarterly tranche)
 *   | AK  | CREANCES MARS        | creanceMars    | number   | (March outstanding — informational)
 *
 * The schema also tolerates the documented Excel quirks:
 *   - `#REF!` formula errors → warnings, row still imports.
 *   - Formula cells without cached results (e.g. shared formulas) → coerced to 0.
 *   - Unknown `niveau` codes → warnings, row still imports.
 *   - Missing `NEM` → parent falls back to placeholder name.
 *   - Stale 2021/2022 dates in Devis → ignored (Devis sheet is not imported as data).
 *
 * The previously-broken `REGLEMENTS DETTES` field was typed as
 * `monthlyArray` with `count: 12`, which caused the engine to read the 12
 * columns AFTER `REGLEMENTS DETTES` (TOTAL VERSEMENTS, TOTAL*CREANCE, FI,
 * V2, 2V, v3, DISTINATION, 1T, T2, t3, PSY1, PSY2) as monthly payment data.
 * That was completely wrong — those columns are independent financial fields.
 * REGLEMENTS DETTES is now a single `number` field, and each payment column
 * is its own field.
 *
 * EXTENDED COLUMNS (PSY/ORTH/quarterly): columns Z..AK capture therapy
 * payments (psychology, speech), the E-PLANT flag, catch-up sessions, and
 * the three quarterly tranches (September, December, March). These were
 * previously dropped because the schema stopped at column Y. They are now
 * parsed so the importer captures the COMPLETE financial picture per row
 * and the therapy payments can be written as `therapy_psychology` /
 * `therapy_speech` ledger entries (migration 0027 added these categories).
 */
import type { ImportSchema } from "../types";

export const ETAT_SCHEMA: ImportSchema = {
  name: "etat",
  sheetMatchers: [/^ETAT/i, /^ETAT\s*\d+/i],
  headerRow: 1,
  // Only NOM is truly required — "import student no matter what".
  // CLASSE, niveau, DEVIS ANNUEL are all optional with defaults so missing
  // cells never block a row from importing.
  requiredHeaders: ["NOM"],
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
      required: false,
      default: "PRIM",
      values: [
        "PRIM", "COLG", "LYC",
        "GS", "MS", "PS", "TPS",
        "AUTISTE",
        "NV2", "NV3", "NV4", "NV5",
        "CLYC", "LYCI",
      ],
      tolerateUnknown: true,
    },
    { key: "classe", header: "CLASSE", type: "string", required: false, default: "Non assignée" },
    {
      key: "option",
      header: "OPTION",
      type: "enum",
      required: false,
      values: ["TRNSP", "TENSP", "TRNP", ""],
      tolerateUnknown: true,
    },
    { key: "remise", header: "REMISE", type: "number", required: false, default: 0, min: 0 },
    { key: "justification", header: "JUSTIFICATION", type: "string", required: false },

    // ── Pricing & balance block (L–Q) ────────────────────────────────────
    // DEVIS ANNUEL is a formula in the real sheet (e.g. =25000+205000-J2).
    // The ExcelParser's `normalizeCell` already extracts `result` from
    // formula cells, so by the time the value reaches the coercer it's a
    // plain number. When the formula has no cached result (shared formula
    // without master), the cell value is null → falls back to default 0.
    { key: "devisAnnuel", header: "DEVIS ANNUEL", type: "number", required: false, default: 0, min: 0 },
    { key: "remboursement", header: "REMBOURCEMENT", type: "number", required: false, default: 0, min: 0 },
    { key: "dettes", header: "DETTES", type: "number", required: false, default: 0, min: 0 },
    // REGLEMENTS DETTES — single column ("debt payments made toward prior-year debts").
    // Was wrongly typed as monthlyArray (count:12) — that read the 12 next columns
    // as monthly data, corrupting the import.
    { key: "reglementsDettes", header: "REGLEMENTS DETTES", type: "number", required: false, default: 0, min: 0 },
    // P and Q are formula columns — informational only. They're not used by
    // the storage adapter (which recomputes balances from individual entries),
    // but we capture them so the import report can flag rows where the
    // Excel-computed total differs from the ledger-computed total.
    { key: "totalVersements", header: "TOTAL VERSEMENTS", type: "number", required: false, default: 0, min: 0 },
    { key: "totalCreance", header: "TOTAL*CREANCE", type: "number", required: false, default: 0 },

    // ── Payment installments block (R–Y) ─────────────────────────────────
    // These are the ACTUAL payment columns tracked by the school. Each is a
    // single number representing the amount paid for that tranche. They
    // feed the ledger as individual `payment` entries so the student's
    // payment history is granular and matches the Excel sheet exactly.
    { key: "fi", header: "FI", type: "number", required: false, default: 0, min: 0 },
    { key: "v2", header: "V2", type: "number", required: false, default: 0, min: 0 },
    { key: "v2Alt", header: "2V", type: "number", required: false, default: 0, min: 0 },
    { key: "v3", header: "v3", type: "number", required: false, default: 0, min: 0 },
    // DISTINATION is a text column (town name) that sits between the tuition
    // and transport payment columns. It is NOT a payment — it determines
    // the transport fee tier applied to the L formula.
    { key: "distination", header: "DISTINATION", type: "string", required: false },
    { key: "t1", header: "1T", type: "number", required: false, default: 0, min: 0 },
    { key: "t2", header: "T2", type: "number", required: false, default: 0, min: 0 },
    { key: "t3", header: "t3", type: "number", required: false, default: 0, min: 0 },

    // ── Therapy + extra sessions block (Z–AE) ────────────────────────────
    // These columns capture payments for therapy sessions (psychology,
    // speech therapy) and extra support sessions. They feed the ledger as
    // `therapy_psychology` / `therapy_speech` entries (categories added by
    // migration 0026/0027).
    { key: "psy1", header: "PSY1", type: "number", required: false, default: 0, min: 0 },
    { key: "psy2", header: "PSY2", type: "number", required: false, default: 0, min: 0 },
    { key: "orth1", header: "ORTH1", type: "number", required: false, default: 0, min: 0 },
    { key: "orth2", header: "ORTH2", type: "number", required: false, default: 0, min: 0 },
    { key: "eplant", header: "E-PLANT", type: "number", required: false, default: 0, min: 0 },
    { key: "ratrapage", header: "Ratrapage", type: "number", required: false, default: 0, min: 0 },

    // ── Quarterly tranches block (AF–AK) ─────────────────────────────────
    // September / December / March quarterly payments + their outstanding
    // balances. The amounts feed the ledger as `tuition` payments; the
    // CREANCES columns are informational (the ledger recomputes balances).
    { key: "septembre", header: "SEPTEMBRE", type: "number", required: false, default: 0, min: 0 },
    { key: "creanceSeptembre", header: "CREANCES SEPTEMBRE", type: "number", required: false, default: 0 },
    { key: "decembre", header: "DECEMBRE", type: "number", required: false, default: 0, min: 0 },
    { key: "creanceDecembre", header: "CREANCES DECEMBRE", type: "number", required: false, default: 0 },
    { key: "mars", header: "MARS", type: "number", required: false, default: 0, min: 0 },
    { key: "creanceMars", header: "CREANCES MARS", type: "number", required: false, default: 0 },
  ],
};
