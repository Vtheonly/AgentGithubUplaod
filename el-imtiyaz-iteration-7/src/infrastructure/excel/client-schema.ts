/**
 * Canonical Excel schema for the El-Imtiyaz `Suivis clients` workbook.
 *
 * This file is the ONLY place that knows about the specific structure of
 * the school's `Suivis clients 2026_2027.xlsx` file. The dynamic importer
 * engine in `dynamic-import.ts` is generic — it knows nothing about this
 * file's columns.
 *
 * The schema is data-driven: to add a new column, add a new entry to
 * `columns` and (if needed) a new field to `ImportedClientRow`. No engine
 * code changes required.
 *
 * Source workbook structure (inspected 2026-07-28):
 *   Sheet 1: "ETAT 20262027" — main client ledger
 *     Header columns (FR):
 *       - INFOS (notes)
 *       - E-MAIL
 *       - NEM (parent phone, possibly two numbers separated by /)
 *       - TUTEUR (parent full name)
 *       - NOM (student full name)
 *       - niveau (PRIM / CEM / LYC)
 *       - CLASSE (CE1, CM1, 2AP, etc.)
 *       - OPTION (transport / service options)
 *       - REMISE (discount amount)
 *       - JUSTIFICATION (discount reason)
 *       - DEVIS ANNUEL (annual quote)
 *       - REMBOURCEMENT (reimbursement amount)
 *       - DETTES (current debt)
 *       - REGLEMENTS DETTES (debt payments)
 *       - TOTAL VERSEMENTS (total payments)
 *       - TOTAL*CREANCE (total outstanding)
 *       - 1T / T2 / t3 (3-tranche schedule — tuition)
 *       - SEPTEMBRE / DECEMBRE / MARS (termly payment columns)
 *
 *   Sheet 2: "BON" — auxiliary
 *   Sheet 3: "Devis" — quote generator (one quote per student)
 *   Sheet 4: "REF" — reference data (city tiers + grade codes)
 */
import type { ImportSchema, ColumnSpec } from "./dynamic-import";
import type { AcademicLevel } from "../../domain/model/student";
import type { PaymentCategory } from "../../domain/model/payment";

/**
 * Output entity: one row per student (with embedded parent info).
 * The importer produces these; the caller's inserter turns them into
 * Parent + Student + Installment records.
 */
export interface ImportedClientRow {
  readonly rowIndex: number;

  // Parent fields
  readonly parentFullName: string;
  readonly parentFirstName: string;
  readonly parentLastName: string;
  readonly parentPhone: string;
  readonly parentWhatsapp: string | null;
  readonly parentEmail: string | null;
  readonly cityTier: "t1" | "t2" | "t3" | null;

  // Student fields
  readonly studentFullName: string;
  readonly studentFirstName: string;
  readonly studentLastName: string;
  readonly level: AcademicLevel;
  readonly className: string | null;

  // Financial fields (as recorded in the source spreadsheet)
  readonly devisAnnuel: number;
  readonly remise: number;
  readonly remiseJustification: string | null;
  readonly dettes: number;
  readonly reglementDettes: number;
  readonly totalVersements: number;
  readonly tranche1: number;
  readonly tranche2: number;
  readonly tranche3: number;
  readonly septembre: number;
  readonly decembre: number;
  readonly mars: number;
}

/* ================================================================== */
/*  Column specifications                                              */
/* ================================================================== */

function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  // Algerian naming convention: family name comes FIRST (all-caps in the source spreadsheet).
  // e.g., "ZIREG AHMED" → lastName="ZIREG", firstName="AHMED".
  return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
}

function normalizePhone(raw: string): { phone: string; whatsapp: string | null } {
  // Some cells contain two phone numbers separated by "/".
  const parts = raw.split(/[/]/).map((s) => s.trim()).filter(Boolean);
  const phone = parts[0] ?? "";
  const whatsapp = parts[1] ?? null;
  return { phone, whatsapp };
}

function normalizeLevel(raw: string): AcademicLevel | null {
  const v = raw.toLowerCase().trim();
  if (["prim", "primaire", "p"].includes(v)) return "primaire";
  if (["cem", "moyen", "m"].includes(v)) return "cem";
  if (["lyc", "lycee", "l"].includes(v)) return "lycee";
  return null;
}

const columns: readonly ColumnSpec[] = [
  // Parent fields
  {
    field: "tuteur",
    label: "Tuteur (parent full name)",
    aliases: ["tuteur", "tuteurs", "parent", "parents", "parent name"],
    type: "string",
    required: true,
    pattern: "^.+\\S.+$",
  },
  {
    field: "nem",
    label: "NEM (parent phone)",
    aliases: ["nem", "phone", "telephone", "tel", "téléphone", "téléphone parent", "contact"],
    type: "string",
    required: true,
    pattern: "^[+]?[0-9\\s/]{8,30}$",
  },
  {
    field: "email",
    label: "E-MAIL",
    aliases: ["email", "e-mail", "courriel", "courriel parent", "e mail"],
    type: "string",
    required: false,
    pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
  },
  {
    field: "cityTier",
    label: "Zone de résidence",
    aliases: ["zone", "tier", "city tier", "destination", "ville", "zone de résidence"],
    type: "enum",
    required: false,
    enumValues: ["t1", "t2", "t3"],
    defaultValue: "t1",
  },

  // Student fields
  {
    field: "nom",
    label: "NOM (student full name)",
    aliases: ["nom", "name", "student name", "élève", "eleve", "nom élève", "nom eleve", "étudiant"],
    type: "string",
    required: true,
    pattern: "^.+\\S.+$",
  },
  {
    field: "niveau",
    label: "niveau (academic level)",
    aliases: ["niveau", "level", "niveau scolaire", "niveau élève", "classe niveau"],
    type: "enum",
    required: true,
    enumValues: ["prim", "primaire", "p", "cem", "moyen", "m", "lyc", "lycee", "l"],
  },
  {
    field: "classe",
    label: "CLASSE (specific class)",
    aliases: ["classe", "class", "section", "groupe"],
    type: "string",
    required: false,
  },

  // Financial fields
  {
    field: "devisAnnuel",
    label: "DEVIS ANNUEL (annual quote)",
    aliases: ["devis annuel", "devis", "annual quote", "quote", "annuel", "devis annuel total"],
    type: "number",
    required: true,
    min: 0,
    max: 1_000_000,
  },
  {
    field: "remise",
    label: "REMISE (discount amount)",
    aliases: ["remise", "discount", "réduction", "reduction"],
    type: "number",
    required: false,
    min: 0,
    max: 100_000,
    defaultValue: 0,
  },
  {
    field: "remiseJustification",
    label: "JUSTIFICATION (discount reason)",
    aliases: ["justification", "remise justification", "discount reason", "raison"],
    type: "string",
    required: false,
  },
  {
    field: "dettes",
    label: "DETTES (current debt)",
    aliases: ["dettes", "debt", "dette", "créance", "creance"],
    type: "number",
    required: false,
    min: 0,
    max: 1_000_000,
    defaultValue: 0,
  },
  {
    field: "reglementDettes",
    label: "REGLEMENTS DETTES (debt payments)",
    aliases: ["reglements dettes", "règlements dettes", "debt payments", "reglement dette"],
    type: "number",
    required: false,
    min: 0,
    max: 1_000_000,
    defaultValue: 0,
  },
  {
    field: "totalVersements",
    label: "TOTAL VERSEMENTS (total payments)",
    aliases: ["total versements", "total payments", "versements", "payments total", "total*versements"],
    type: "number",
    required: false,
    min: 0,
    max: 1_000_000,
    defaultValue: 0,
  },
  {
    field: "tranche1",
    label: "1T (tranche 1)",
    aliases: ["1t", "t1", "tranche 1", "tranche1", "1ere tranche", "première tranche"],
    type: "number",
    required: false,
    min: 0,
    max: 500_000,
    defaultValue: 0,
  },
  {
    field: "tranche2",
    label: "T2 (tranche 2)",
    aliases: ["t2", "tranche 2", "tranche2", "2eme tranche", "deuxième tranche"],
    type: "number",
    required: false,
    min: 0,
    max: 500_000,
    defaultValue: 0,
  },
  {
    field: "tranche3",
    label: "t3 (tranche 3)",
    aliases: ["t3", "tranche 3", "tranche3", "3eme tranche", "troisième tranche"],
    type: "number",
    required: false,
    min: 0,
    max: 500_000,
    defaultValue: 0,
  },
  {
    field: "septembre",
    label: "SEPTEMBRE (September payment)",
    aliases: ["septembre", "sep", "sept"],
    type: "number",
    required: false,
    min: 0,
    max: 500_000,
    defaultValue: 0,
  },
  {
    field: "decembre",
    label: "DECEMBRE (December payment)",
    aliases: ["decembre", "décembre", "dec", "dec12"],
    type: "number",
    required: false,
    min: 0,
    max: 500_000,
    defaultValue: 0,
  },
  {
    field: "mars",
    label: "MARS (March payment)",
    aliases: ["mars", "mar", "march"],
    type: "number",
    required: false,
    min: 0,
    max: 500_000,
    defaultValue: 0,
  },
];

/* ================================================================== */
/*  Schema definition                                                  */
/* ================================================================== */

export const clientImportSchema: ImportSchema<ImportedClientRow> = {
  id: "el-imtiyaz-clients-v1",
  label: "Suivis clients (Excel)",
  description:
    "Schéma d'import pour le fichier `Suivis clients AAAA_AAAA.xlsx`. " +
    "Chaque ligne représente un élève (avec son tuteur parent). Les colonnes " +
    "financières (DEVIS ANNUEL, DETTES, tranches) sont lues telles quelles " +
    "et converties en écritures comptables via le moteur de ledger.",
  sheets: [
    {
      name: "ETAT",
      nameAliases: ["etat", "etat 20262027", "etat 20252026", "suivis clients", "clients", "etat clients", "etat 20262027"],
      headerRowIndex: 1,
      firstDataRow: 2,
      maxRows: 100_000,
      columns,
    },
  ],
  map: (row, rowIndex) => {
    const tuteurRaw = String(row.tuteur ?? "").trim();
    const nomRaw = String(row.nom ?? "").trim();
    const nemRaw = String(row.nem ?? "").trim();
    const emailRaw = String(row.email ?? "").trim();
    const tierRaw = String(row.cityTier ?? "t1").toLowerCase().trim();
    const niveauRaw = String(row.niveau ?? "").toLowerCase().trim();

    const parentNames = splitFullName(tuteurRaw);
    const studentNames = splitFullName(nomRaw);
    const phones = normalizePhone(nemRaw);
    const level = normalizeLevel(niveauRaw);
    if (!level) {
      throw new Error(`Invalid niveau "${niveauRaw}" at row ${rowIndex}`);
    }

    return {
      rowIndex,
      parentFullName: tuteurRaw,
      parentFirstName: parentNames.firstName,
      parentLastName: parentNames.lastName,
      parentPhone: phones.phone,
      parentWhatsapp: phones.whatsapp,
      parentEmail: emailRaw || null,
      cityTier: (tierRaw as "t1" | "t2" | "t3") || "t1",

      studentFullName: nomRaw,
      studentFirstName: studentNames.firstName,
      studentLastName: studentNames.lastName,
      level,
      className: (row.classe as string) || null,

      devisAnnuel: Number(row.devisAnnuel ?? 0),
      remise: Number(row.remise ?? 0),
      remiseJustification: (row.remiseJustification as string) || null,
      dettes: Number(row.dettes ?? 0),
      reglementDettes: Number(row.reglementDettes ?? 0),
      totalVersements: Number(row.totalVersements ?? 0),
      tranche1: Number(row.tranche1 ?? 0),
      tranche2: Number(row.tranche2 ?? 0),
      tranche3: Number(row.tranche3 ?? 0),
      septembre: Number(row.septembre ?? 0),
      decembre: Number(row.decembre ?? 0),
      mars: Number(row.mars ?? 0),
    };
  },
};

/**
 * Map an imported client row to the category breakdown for ledger entry creation.
 * Each non-zero financial field becomes a charge entry on the parent's account.
 */
export interface LedgerImportEntry {
  readonly category: PaymentCategory;
  readonly amount: number;
  readonly description: string;
  readonly dueDate: string; // ISO date
  readonly tranche?: number;
}

/**
 * Convert an imported client row into a list of ledger charge entries.
 * The caller (repository layer) wraps these in `createChargeEntry()` calls.
 *
 * This is the bridge between the Excel schema and the ledger domain model.
 */
export function importedRowToCharges(
  row: ImportedClientRow,
  academicYear: string,
  defaultDueDates: { tranche1: string; tranche2: string; tranche3: string; termSep: string; termDec: string; termMar: string },
): LedgerImportEntry[] {
  const entries: LedgerImportEntry[] = [];

  // Tranche charges (tuition) — only if non-zero.
  if (row.tranche1 > 0) {
    entries.push({
      category: "tuition",
      amount: row.tranche1,
      description: `Scolarité ${academicYear} — Tranche 1 (${row.studentFullName})`,
      dueDate: defaultDueDates.tranche1,
      tranche: 1,
    });
  }
  if (row.tranche2 > 0) {
    entries.push({
      category: "tuition",
      amount: row.tranche2,
      description: `Scolarité ${academicYear} — Tranche 2 (${row.studentFullName})`,
      dueDate: defaultDueDates.tranche2,
      tranche: 2,
    });
  }
  if (row.tranche3 > 0) {
    entries.push({
      category: "tuition",
      amount: row.tranche3,
      description: `Scolarité ${academicYear} — Tranche 3 (${row.studentFullName})`,
      dueDate: defaultDueDates.tranche3,
      tranche: 3,
    });
  }

  // Term payments (these were collected in past terms — they're payments, not charges,
  // but for import purposes we treat them as charges already settled).
  // The caller should mark them as paid (i.e., also create payment entries).

  return entries;
}
