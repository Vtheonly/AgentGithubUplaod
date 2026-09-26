/**
 * Import configuration — the 2027/2026 workbook format
 * (`2027-2026.xlsx`, 2 sheets: `ETAT 20262027` + `statistiques `).
 *
 * T-414 (IMPORT-111 / ADR-026): the FIRST format registered through the
 * configuration repository that could NOT be expressed by the old
 * header-only schemas. The deep comparison
 * (docs/architecture/excel-format-comparison-2026-2027-vs-2027-2026.md —
 * built from Excel/excel_deep_inspection_report.md +
 * Excel/full_descbrtion.md + a header-row diff of both workbooks)
 * established the mapping:
 *
 *   Columns A–E, G–Y: IDENTICAL semantics to the 2026/2027 format.
 *   Column F: header cell EMPTY — student names in the same position →
 *             POSITIONAL addressing (`column: "F"`); identity uses the
 *             field KEY (`nom`) instead of the vanished header.
 *   Column S: header RENAMED V2 → V1 (the school's relabeling of the 1st
 *             tuition installment — the mislabeled V2 was corrected) →
 *             same canonical key `v2` (the canonical record contract —
 *             the storage adapters' "1st tuition installment" key).
 *   Columns Z–AA: PSY1/PSY2 (same).
 *   Columns AB–AM: the therapy grid EXPANDED to PSY3…PSY14 (replacing
 *             ORTH1/ORTH2 + E-PLANT + Ratrapage) → all psychology-session
 *             payments (therapy_psychology ledger entries).
 *   Columns AN–AP: three columns sharing the header CREANCE SEPT →
 *             positionally addressed (creanceSept = the September-quota
 *             formula S+J+N−threshold; creanceSept2/3 = lump-sum
 *             adjustments) — INFORMATIONAL (the ledger recomputes
 *             balances; no entries written).
 *   Column AQ: TT CREANCE — total creance — INFORMATIONAL.
 *   Columns AR–AU: NEW ancillary services — COURS SUP (tutoring →
 *             tuition), LIVRES (books → books), CLUB (→ extracurricular),
 *             SORTIES (school trips → extracurricular) — PAYMENTS through
 *             the existing financial ledger.
 *
 *   The `statistiques ` sheet (analytical dashboard, 1 871 #REF! errors
 *   from its references to the deleted 'Etat General Versement' sheet) is
 *   EXCLUDED: it is a reporting surface, not a data source.
 */
import type { ImportConfigDocument } from "../types";

const psySession = (n: number, column: string) => ({
  key: `psy${n}`,
  header: `PSY${n}`,
  column,
  type: "number" as const,
  required: false,
  default: 0,
  min: 0,
  concept: `Psychology session ${n} payment (therapy_psychology) — the expanded therapy grid`,
  role: "financial-payment" as const,
});

export const ETAT_2027_2026_CONFIG: ImportConfigDocument = {
  id: "etat-2027-2026",
  version: 1,
  formatLabel: "Suivis clients 2027/2026 (ETAT — nouvelle grille)",
  description:
    "The 2027/2026 client-tracking workbook. The ETAT roster keeps the same core engine " +
    "(columns A–E/G–Y semantically identical; P = R+S+T+U+W+X+Y and Q = L−P formulas byte-identical) " +
    "with a headerless student column (F), the V2→V1 relabeling, the expanded PSY1–PSY14 therapy " +
    "grid, the CREANCE SEPT ×3 + TT CREANCE informational block and four new ancillary services " +
    "(COURS SUP, LIVRES, CLUB, SORTIES). The statistiques sheet is excluded (a reporting surface).",
  academicYearHint: "2027-2026",
  sourceProvenance:
    "Excel/2027-2026.xlsx (the forensic evidence at the repository root) + " +
    "Excel/excel_deep_inspection_report.md + Excel/full_descbrtion.md + " +
    "docs/architecture/excel-format-comparison-2026-2027-vs-2027-2026.md (the deep comparison).",
  enabled: true,
  createdAt: "2026-09-26T00:00:00Z",
  updatedAt: "2026-09-26T00:00:00Z",
  sheets: [
    {
      name: "etat",
      description:
        "Master client/student roster — one row per student (the 2027/2026 grid).",
      sheetMatchers: ["^ETAT", "^ETAT\\s*\\d+"],
      headerRow: 1,
      requiredHeaders: ["V1", "LIVRES", "CLUB", "SORTIES"],
      identity: { fields: ["NEM", "nom"], strategy: "upsert" },
      detectionPriority: 110,
      canonicalConcept:
        "Same canonical target as the 2026/2027 ETAT sheet: students + parents + financial " +
        "records through the SAME repositories, ledger, payments journal and installment " +
        "schedule (RepositoryStorageAdapter). The canonical record keys are IDENTICAL — " +
        "only their source addresses differ.",
      fields: [
        { key: "infos", header: "INFOS", column: "B", type: "string", required: false, concept: "Administrative free-text flags", role: "note" },
        { key: "email", header: "E-MAIL", column: "C", type: "email", required: false, concept: "Contact — actually stores document codes / book-payment markers", role: "contact" },
        { key: "nem", header: "NEM", column: "D", type: "phoneList", required: false, concept: "Parent phone(s), possibly multi-value 06xxx/07xxx", role: "identity" },
        { key: "tuteur", header: "TUTEUR", column: "E", type: "string", required: false, concept: "New/returning student flag (NV = nouveau)", role: "note" },
        {
          key: "nom", column: "F", type: "string", required: true, minLength: 2,
          concept: "Student full name (LASTNAME FIRSTNAME) — HEADERLESS column: the 2027/2026 header row lost the NOM label; the data is identical in shape",
          role: "identity",
        },
        {
          key: "niveau", header: "niveau", column: "G", type: "enum", required: false, default: "PRIM",
          values: ["PRIM", "COLG", "LYC", "GS", "MS", "PS", "TPS", "AUTISTE", "NV2", "NV3", "NV4", "NV5", "CLYC", "LYCI"],
          tolerateUnknown: true,
          concept: "Academic cycle code (operator-invented variants tolerated)", role: "academic",
        },
        { key: "classe", header: "CLASSE", column: "H", type: "string", required: false, default: "Non assignée", concept: "Specific grade/class code (CE1, 1AAM…)", role: "academic" },
        {
          key: "option", header: "OPTION", column: "I", type: "enum", required: false,
          values: ["TRNSP", "TENSP", "TRNP", "TRNSP 15JOUR", ""], tolerateUnknown: true,
          concept: "Transport subscription flag (new 15-day variant tolerated)", role: "academic",
        },
        { key: "remise", header: "REMISE", column: "J", type: "number", required: false, default: 0, min: 0, concept: "Negotiated discount — already netted in DEVIS ANNUEL (no ledger adjustment)", role: "financial-charge" },
        { key: "justification", header: "JUSTIFICATION", column: "K", type: "string", required: false, concept: "Discount reason (free text)", role: "note" },
        { key: "devisAnnuel", header: "DEVIS ANNUEL", column: "L", type: "number", required: false, default: 0, min: 0, concept: "Net annual quote (formula = FI + scolarité + transport − remise with the year's price constants; cached result read)", role: "financial-charge" },
        { key: "remboursement", header: "REMBOURCEMENT", column: "M", type: "number", required: false, default: 0, min: 0, concept: "Refund issued to the family (negative ledger adjustment)", role: "financial-charge" },
        { key: "dettes", header: "DETTES", column: "N", type: "number", required: false, default: 0, min: 0, concept: "Prior-year debt carried forward (additional charge)", role: "financial-charge" },
        { key: "reglementsDettes", header: "REGLEMENTS DETTES", column: "O", type: "number", required: false, default: 0, min: 0, concept: "Payments made toward prior-year debts", role: "financial-payment" },
        { key: "totalVersements", header: "TOTAL VERSEMENTS", column: "P", type: "number", required: false, default: 0, min: 0, concept: "Formula =R+S+T+U+W+X+Y — informational (ledger recomputes)", role: "financial-informational" },
        { key: "totalCreance", header: "TOTAL*CREANCE", column: "Q", type: "number", required: false, default: 0, concept: "Formula =L−P — informational (ledger recomputes)", role: "financial-informational" },
        { key: "fi", header: "FI", column: "R", type: "number", required: false, default: 0, min: 0, concept: "Frais d'inscription paid — often collected within V1 in this year's structure (the P formula still includes R)", role: "financial-payment" },
        {
          key: "v2", header: "V1", column: "S", type: "number", required: false, default: 0, min: 0,
          concept: "1st tuition installment paid — header RELABELED V2→V1 (the 2026/2027 mislabel corrected); same canonical key v2",
          role: "financial-payment",
        },
        { key: "v2Alt", header: "2V", column: "T", type: "number", required: false, default: 0, min: 0, concept: "2nd tuition installment paid", role: "financial-payment" },
        { key: "v3", header: "v3", column: "U", type: "number", required: false, default: 0, min: 0, concept: "3rd tuition installment paid", role: "financial-payment" },
        { key: "distination", header: "DISTINATION", column: "V", type: "string", required: false, concept: "Transport town (determines the transport fee tier)", role: "academic" },
        { key: "t1", header: "1T", column: "W", type: "number", required: false, default: 0, min: 0, concept: "1st transport tranche paid", role: "financial-payment" },
        { key: "t2", header: "T2", column: "X", type: "number", required: false, default: 0, min: 0, concept: "2nd transport tranche paid", role: "financial-payment" },
        { key: "t3", header: "t3", column: "Y", type: "number", required: false, default: 0, min: 0, concept: "3rd transport tranche paid", role: "financial-payment" },
        psySession(1, "Z"),
        psySession(2, "AA"),
        psySession(3, "AB"),
        psySession(4, "AC"),
        psySession(5, "AD"),
        psySession(6, "AE"),
        psySession(7, "AF"),
        psySession(8, "AG"),
        psySession(9, "AH"),
        psySession(10, "AI"),
        psySession(11, "AJ"),
        psySession(12, "AK"),
        psySession(13, "AL"),
        psySession(14, "AM"),
        {
          key: "creanceSept", header: "CREANCE SEPT", column: "AN", type: "number", required: false, default: 0,
          concept: "September-quota check (formula S+J+N−expected-tuition [+W−expected-transport]) — genuinely NEW in this format; informational (the ledger recomputes balances)",
          role: "financial-informational",
        },
        {
          key: "creanceSept2", header: "CREANCE SEPT", column: "AO", type: "number", required: false, default: 0,
          concept: "Second CREANCE SEPT column (lump-sum adjustments) — positionally addressed (shared header)",
          role: "financial-informational",
        },
        {
          key: "creanceSept3", header: "CREANCE SEPT", column: "AP", type: "number", required: false, default: 0,
          concept: "Third CREANCE SEPT column (lump-sum adjustments) — positionally addressed (shared header)",
          role: "financial-informational",
        },
        { key: "ttCreance", header: "TT CREANCE", column: "AQ", type: "number", required: false, default: 0, concept: "Total creance — informational (ledger recomputes)", role: "financial-informational" },
        { key: "coursSup", header: "COURS SUP", column: "AR", type: "number", required: false, default: 0, min: 0, concept: "Supplementary tutoring payment (tuition family)", role: "financial-payment" },
        { key: "livres", header: "LIVRES", column: "AS", type: "number", required: false, default: 0, min: 0, concept: "Textbook payment — promoted from a free-text note in 2026/2027 to a structured column (books)", role: "financial-payment" },
        { key: "club", header: "CLUB", column: "AT", type: "number", required: false, default: 0, min: 0, concept: "Extracurricular club payment (extracurricular)", role: "financial-payment" },
        { key: "sorties", header: "SORTIES", column: "AU", type: "number", required: false, default: 0, min: 0, concept: "School-trip payment (extracurricular)", role: "financial-payment" },
      ],
    },
  ],
  excludedSheets: [
    {
      sheetMatchers: ["^statistiques\\s*$"],
      reason:
        "The statistiques sheet is an analytical DASHBOARD (revenue/headcount/creance aggregates by " +
        "cycle), not a data source: 1 871 of its formulas are #REF! errors referencing the deleted " +
        "'Etat General Versement' sheet. Its KPIs are the desktop Statistics tab's job (§15.53: " +
        "analytics CONSUMES the canonical engines, never a second data path).",
    },
  ],
  transformations: [
    { appliesTo: "nom", description: "positional resolution via column F (the header cell is empty in this format)" },
    { appliesTo: "v2", description: "header V1 → canonical key v2 (the 1st-installment relabeling; the canonical record contract is unchanged)" },
    { appliesTo: "creanceSept / creanceSept2 / creanceSept3", description: "positional resolution (three columns share the CREANCE SEPT header)" },
    { appliesTo: "psy3…psy14", description: "the expanded therapy grid maps to therapy_psychology ledger entries (same as psy1/psy2)" },
    { appliesTo: "coursSup / livres / club / sorties", description: "new ancillary services map to tuition / books / extracurricular / extracurricular payment entries through the existing ledger" },
    { appliesTo: "nem", description: "phoneList normalization — split on '/', keep valid DZ numbers" },
    { appliesTo: "*", description: "formula cells read via cached results; missing cached results coerce to 0" },
  ],
};
