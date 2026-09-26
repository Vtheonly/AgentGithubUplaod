/**
 * Import configuration — the 2026/2027 workbook format
 * (`Suivis clients  2026_2027.xlsx`, 4 sheets: ETAT / BON / Devis / REF).
 *
 * T-414 (IMPORT-111 / ADR-026): this document is the DATA twin of the
 * historical T-105 schemas — the field mappings are functionally IDENTICAL
 * to the `schemas/etat-schema.ts` (etc.) definitions they now own, so the
 * compiled schemas preserve every documented quirk tolerance:
 *   - `#REF!`/`#NAME?` formula errors → warnings, row still imports;
 *   - formula cells without cached results → coerced to 0;
 *   - unknown `niveau` codes → warnings, row still imports;
 *   - missing NEM → parent falls back to placeholder name;
 *   - REGLEMENTS DETTES is a single number (NOT the 12-month array the
 *     original standalone engine wrongly assumed).
 *
 * Column letters are declared for EVERY field (self-documenting column
 * map; positional resolution is a no-op when the header also matches).
 */
import type { ImportConfigDocument } from "../types";

export const ETAT_2026_2027_CONFIG: ImportConfigDocument = {
  id: "etat-2026-2027",
  version: 1,
  formatLabel: "Suivis clients 2026/2027 (ETAT + BON + Devis + REF)",
  description:
    "The 2026/2027 client-tracking workbook. ETAT 20262027 is the master roster " +
    "(one row per student with embedded parent + financial metadata); Devis holds " +
    "printable family quotes; BON holds receipt templates (broken #REF! lookups " +
    "tolerated); REF holds the reference lists (grades + transport towns).",
  academicYearHint: "2026-2027",
  sourceProvenance:
    "Excel/Suivis clients  2026_2027.xlsx (the forensic evidence at the repository root) + " +
    "Excel/excel_deep_inspection_report.md + ADR-017 (the workbook-derived price matrix).",
  enabled: true,
  createdAt: "2026-09-26T00:00:00Z",
  updatedAt: "2026-09-26T00:00:00Z",
  sheets: [
    {
      name: "etat",
      description: "Master client/student roster — one row per student.",
      sheetMatchers: ["^ETAT", "^ETAT\\s*\\d+"],
      headerRow: 1,
      requiredHeaders: ["NOM"],
      identity: { fields: ["NEM", "NOM"], strategy: "upsert" },
      detectionPriority: 100,
      canonicalConcept:
        "Student + parent + financial snapshot per row; feeds ParentRepository, " +
        "StudentRepository, the ledger (charges/payments/adjustments), the payments " +
        "journal and the installment schedule via RepositoryStorageAdapter.",
      fields: [
        { key: "infos", header: "INFOS", column: "B", type: "string", required: false, concept: "Administrative free-text flags", role: "note" },
        { key: "email", header: "E-MAIL", column: "C", type: "email", required: false, concept: "Contact — actually stores document codes (BON01) most of the time", role: "contact" },
        { key: "nem", header: "NEM", column: "D", type: "phoneList", required: false, concept: "Parent phone(s), possibly multi-value 06xxx/07xxx", role: "identity" },
        { key: "tuteur", header: "TUTEUR", column: "E", type: "string", required: false, concept: "New/returning student flag (NV = nouveau)", role: "note" },
        { key: "nom", header: "NOM", column: "F", type: "string", required: true, minLength: 2, concept: "Student full name (LASTNAME FIRSTNAME)", role: "identity" },
        {
          key: "niveau", header: "niveau", column: "G", type: "enum", required: false, default: "PRIM",
          values: ["PRIM", "COLG", "LYC", "GS", "MS", "PS", "TPS", "AUTISTE", "NV2", "NV3", "NV4", "NV5", "CLYC", "LYCI"],
          tolerateUnknown: true,
          concept: "Academic cycle code (operator-invented variants tolerated)", role: "academic",
        },
        { key: "classe", header: "CLASSE", column: "H", type: "string", required: false, default: "Non assignée", concept: "Specific grade/class code (CE1, 1AAM…)", role: "academic" },
        {
          key: "option", header: "OPTION", column: "I", type: "enum", required: false,
          values: ["TRNSP", "TENSP", "TRNP", ""], tolerateUnknown: true,
          concept: "Transport subscription flag", role: "academic",
        },
        { key: "remise", header: "REMISE", column: "J", type: "number", required: false, default: 0, min: 0, concept: "Negotiated discount — already netted in DEVIS ANNUEL (no ledger adjustment)", role: "financial-charge" },
        { key: "justification", header: "JUSTIFICATION", column: "K", type: "string", required: false, concept: "Discount reason (free text)", role: "note" },
        { key: "devisAnnuel", header: "DEVIS ANNUEL", column: "L", type: "number", required: false, default: 0, min: 0, concept: "Net annual quote (formula = FI + scolarité + transport − remise; cached result read)", role: "financial-charge" },
        { key: "remboursement", header: "REMBOURCEMENT", column: "M", type: "number", required: false, default: 0, min: 0, concept: "Refund issued to the family (negative ledger adjustment)", role: "financial-charge" },
        { key: "dettes", header: "DETTES", column: "N", type: "number", required: false, default: 0, min: 0, concept: "Prior-year debt carried forward (additional charge)", role: "financial-charge" },
        { key: "reglementsDettes", header: "REGLEMENTS DETTES", column: "O", type: "number", required: false, default: 0, min: 0, concept: "Payments made toward prior-year debts (single column — NOT a monthly array)", role: "financial-payment" },
        { key: "totalVersements", header: "TOTAL VERSEMENTS", column: "P", type: "number", required: false, default: 0, min: 0, concept: "Formula =R+S+T+U+W+X+Y — informational (ledger recomputes)", role: "financial-informational" },
        { key: "totalCreance", header: "TOTAL*CREANCE", column: "Q", type: "number", required: false, default: 0, concept: "Formula =L−P — informational (ledger recomputes)", role: "financial-informational" },
        { key: "fi", header: "FI", column: "R", type: "number", required: false, default: 0, min: 0, concept: "Frais d'inscription (registration fee) paid", role: "financial-payment" },
        { key: "v2", header: "V2", column: "S", type: "number", required: false, default: 0, min: 0, concept: "1st tuition installment paid (header mislabeled V2 in this format; renamed V1 in 2027-2026)", role: "financial-payment" },
        { key: "v2Alt", header: "2V", column: "T", type: "number", required: false, default: 0, min: 0, concept: "2nd tuition installment paid", role: "financial-payment" },
        { key: "v3", header: "v3", column: "U", type: "number", required: false, default: 0, min: 0, concept: "3rd tuition installment paid", role: "financial-payment" },
        { key: "distination", header: "DISTINATION", column: "V", type: "string", required: false, concept: "Transport town (determines the transport fee tier)", role: "academic" },
        { key: "t1", header: "1T", column: "W", type: "number", required: false, default: 0, min: 0, concept: "1st transport tranche paid", role: "financial-payment" },
        { key: "t2", header: "T2", column: "X", type: "number", required: false, default: 0, min: 0, concept: "2nd transport tranche paid", role: "financial-payment" },
        { key: "t3", header: "t3", column: "Y", type: "number", required: false, default: 0, min: 0, concept: "3rd transport tranche paid", role: "financial-payment" },
        { key: "psy1", header: "PSY1", column: "Z", type: "number", required: false, default: 0, min: 0, concept: "Psychology session 1 payment (therapy_psychology)", role: "financial-payment" },
        { key: "psy2", header: "PSY2", column: "AA", type: "number", required: false, default: 0, min: 0, concept: "Psychology session 2 payment (therapy_psychology)", role: "financial-payment" },
        { key: "orth1", header: "ORTH1", column: "AB", type: "number", required: false, default: 0, min: 0, concept: "Speech-therapy session 1 payment (therapy_speech)", role: "financial-payment" },
        { key: "orth2", header: "ORTH2", column: "AC", type: "number", required: false, default: 0, min: 0, concept: "Speech-therapy session 2 payment (therapy_speech)", role: "financial-payment" },
        { key: "eplant", header: "E-PLANT", column: "AD", type: "number", required: false, default: 0, min: 0, concept: "Accompaniment-plan payment (other)", role: "financial-payment" },
        { key: "ratrapage", header: "Ratrapage", column: "AE", type: "number", required: false, default: 0, min: 0, concept: "Catch-up session payment (tuition)", role: "financial-payment" },
        { key: "septembre", header: "SEPTEMBRE", column: "AF", type: "number", required: false, default: 0, min: 0, concept: "September quarterly tranche payment (tuition)", role: "financial-payment" },
        { key: "creanceSeptembre", header: "CREANCES SEPTEMBRE", column: "AG", type: "number", required: false, default: 0, concept: "September outstanding — informational (ledger recomputes)", role: "financial-informational" },
        { key: "decembre", header: "DECEMBRE", column: "AH", type: "number", required: false, default: 0, min: 0, concept: "December quarterly tranche payment (tuition)", role: "financial-payment" },
        { key: "creanceDecembre", header: "CREANCES DECEMBRE", column: "AI", type: "number", required: false, default: 0, concept: "December outstanding — informational (ledger recomputes)", role: "financial-informational" },
        { key: "mars", header: "MARS", column: "AJ", type: "number", required: false, default: 0, min: 0, concept: "March quarterly tranche payment (tuition)", role: "financial-payment" },
        { key: "creanceMars", header: "CREANCES MARS", column: "AK", type: "number", required: false, default: 0, concept: "March outstanding — informational (ledger recomputes)", role: "financial-informational" },
      ],
    },
    {
      name: "ref",
      description: "Reference lists (synthetic A/B/C… headers — headerless sheet).",
      sheetMatchers: ["^REF$", "^REFERENCES?$"],
      headerRow: 0,
      requiredHeaders: [],
      identity: { fields: [], strategy: "insert" },
      detectionPriority: 100,
      canonicalConcept: "Fan-out reference rows (teachers / grades / transport towns) via extractAs.",
      fields: [
        { key: "enseignant", header: "A", column: "A", type: "string", required: false, concept: "Teacher/staff name list", role: "reference" },
        { key: "classe", header: "B", column: "B", type: "string", required: false, concept: "Grade codes (the academic vocabulary)", role: "reference" },
        { key: "localite", header: "D", column: "D", type: "string", required: false, concept: "Transport town list (the 20 communes)", role: "reference" },
      ],
      extractAs: {
        enseignant: { table: "ref_enseignants", column: "nom" },
        classe: { table: "ref_classes", column: "code" },
        localite: { table: "ref_localites", column: "nom" },
      },
    },
    {
      name: "bon",
      description: "Receipt template rows (VLOOKUP-driven; #REF! tolerated).",
      sheetMatchers: ["^BON\\s*$", "^BONS?$"],
      headerRow: 1,
      dataStartRow: 2,
      requiredHeaders: ["ELEVES"],
      identity: { fields: ["eleve"], strategy: "upsert" },
      detectionPriority: 100,
      canonicalConcept: "Receipt documents (BON sheet); references the missing 'PAR PARENT' / 'Etat General Versement' sheets — #REF! errors are warnings.",
      fields: [
        { key: "client", header: "CLIENT", type: "string", required: false, concept: "Client (parent) name", role: "identity" },
        { key: "date", header: "DATE", type: "date", required: false, concept: "Receipt date", role: "note" },
        { key: "devisAnnuel", header: "DEVIS ANNUEL", type: "number", required: false, concept: "Annual quote snapshot on the receipt", role: "financial-charge" },
        { key: "eleve", header: "ELEVES", type: "string", required: false, concept: "Student name (identity)", role: "identity" },
        { key: "devis", header: "DEVIS", type: "numberOrRef", required: false, concept: "Quote number (may be #REF!)", role: "note" },
        { key: "totalVerse", header: "TOTAL VERSE", type: "numberOrRef", required: false, concept: "Total paid (VLOOKUP — may be #REF!)", role: "financial-informational" },
        { key: "resteVerse", header: "RESTE VERSE", type: "numberOrRef", required: false, concept: "Remaining (VLOOKUP — may be #REF!)", role: "financial-informational" },
      ],
    },
    {
      name: "devis",
      description: "Family quote slips (repeating document blocks).",
      sheetMatchers: ["^DEVIS$", "^DEVIS\\s"],
      headerRow: 1,
      dataStartRow: 2,
      requiredHeaders: ["Prenom élève"],
      identity: { fields: ["client", "devisNumero"], strategy: "upsert" },
      detectionPriority: 100,
      canonicalConcept: "Quote line items per child (the front-end pricing calculation whose family subtotal matches Σ DEVIS ANNUEL in ETAT).",
      fields: [
        { key: "client", header: "Client", type: "string", required: false, concept: "Client (parent) name", role: "identity" },
        { key: "devisNumero", header: "Devis n°", type: "string", required: false, concept: "Quote number (identity)", role: "identity" },
        { key: "date", header: "Date", type: "date", required: false, concept: "Quote date", role: "note" },
        { key: "prenomEleve", header: "Prenom élève", type: "string", required: false, concept: "Student first name", role: "identity" },
        { key: "classe", header: "Classe", type: "string", required: false, concept: "Class at quote time", role: "academic" },
        { key: "fraisInscription", header: "Frais d'inscription", type: "numberOrRef", required: false, concept: "Registration fee line item", role: "financial-charge" },
        { key: "fraisScolarisation", header: "Frais de scolarisation", type: "numberOrRef", required: false, concept: "Tuition line item (the 5% early-payment base)", role: "financial-charge" },
        { key: "services", header: "Services", type: "numberOrRef", required: false, concept: "Services line item (transport…)", role: "financial-charge" },
        { key: "total", header: "Total", type: "numberOrRef", required: false, concept: "Line total", role: "financial-charge" },
      ],
    },
  ],
  transformations: [
    { appliesTo: "nem", description: "phoneList normalization — split on '/', keep valid DZ numbers" },
    { appliesTo: "devisAnnuel / fi / v2 / v3 / t1-t3 / psy / orth", description: "formula cells read via their cached results; missing cached results coerce to 0" },
    { appliesTo: "*", description: "#REF!/#NAME? cells on optional fields → warnings, row still imports" },
    { appliesTo: "niveau / option", description: "unknown enum values → warnings (tolerateUnknown), row still imports" },
  ],
};
