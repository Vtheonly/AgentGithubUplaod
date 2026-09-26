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
import { importConfigRegistry } from "../../import-config";

/**
 * T-414 (IMPORT-111 / ADR-026): this schema is now DERIVED from the
 * central import configuration document (`import-config/configs/
 * etat-2026-2027.ts`) — the single source of truth for the 2026/2027
 * format's mapping. The compiled shape is functionally identical to the
 * historical hand-written definition (fields, headers, tolerances,
 * identity); the configuration adds `column` letters (self-documenting
 * positional map — a no-op when the header also matches).
 */
const compiled = importConfigRegistry
  .resolve("etat-2026-2027")
  .find((s) => s.name === "etat");

if (!compiled) {
  throw new Error("etat-2026-2027 config: the etat sheet failed to compile");
}

export const ETAT_SCHEMA: ImportSchema = compiled;
