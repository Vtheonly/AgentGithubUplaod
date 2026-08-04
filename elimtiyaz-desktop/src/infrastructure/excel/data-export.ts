/**
 * Data export pipeline — produces JSON + XLSX exports of all parents,
 * students, and ledger entries currently in the system. Used by:
 *
 *   - The CRM page's "Exporter" button (round-trip verification).
 *   - The Settings → Backup tab as a lightweight human-readable backup.
 *   - Iteration 22's "Excel/JSON round-trip" verification requirement.
 *
 * Per plan §14.03 (Report Export Engine): exports are Desktop-only,
 * apply the user's RLS filters, and produce clean multi-sheet workbooks
 * without exposing the database directly.
 *
 * The XLSX shape mirrors the original `Suivis clients AAAA_AAAA.xlsx`
 * ETAT sheet so the export can be diffed against the import for
 * consistency verification.
 */
import type { Parent } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import { exportToXlsx, exportToCsv, type SheetSpec } from "../excel/export-engine";

export interface ExportData {
  parents: readonly Parent[];
  students: readonly Student[];
  ledger: readonly LedgerEntry[];
  exportedAt: string;
}

export interface ExportOptions {
  /** Include the per-entry ledger sheet (can be large — 100s of rows). */
  includeLedger?: boolean;
}

/* ------------------------------------------------------------------ */
/*  JSON export                                                        */
/* ------------------------------------------------------------------ */

export function exportToJson(data: ExportData, fileName: string): void {
  const payload = {
    exportedAt: data.exportedAt,
    schema: "el-imtiyaz-export/v1",
    parents: data.parents,
    students: data.students,
    ledger: data.ledger,
    summary: {
      parentCount: data.parents.length,
      studentCount: data.students.length,
      ledgerEntryCount: data.ledger.length,
    },
  };
  const json = JSON.stringify(payload, null, 2);
  const bytes = new TextEncoder().encode(json);
  // Inline download helper so this module is usable from the renderer
  // without depending on the export-engine's `downloadBlob` (kept separate
  // so the JSON path has zero ExcelJS dependency).
  const blob = new Blob([bytes as BlobPart], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */
/*  XLSX export — mirrors the ETAT sheet layout                        */
/* ------------------------------------------------------------------ */

/**
 * Build the parents sheet spec. One row per parent with their basic info
 * plus the count of children and the consolidated family balance.
 */
function buildParentsSheet(
  parents: readonly Parent[],
  students: readonly Student[],
  ledger: readonly LedgerEntry[],
): SheetSpec {
  // Pre-aggregate student counts + balances per parent for fast row lookup.
  const studentCountByParent = new Map<string, number>();
  for (const s of students) {
    studentCountByParent.set(s.parentId, (studentCountByParent.get(s.parentId) ?? 0) + 1);
  }
  const balanceByParent = new Map<string, number>();
  for (const e of ledger) {
    balanceByParent.set(e.parentId, (balanceByParent.get(e.parentId) ?? 0) + e.amount);
  }

  return {
    name: "Parents",
    accentColor: "349BD4",
    columns: [
      { header: "Code", key: "code", width: 18 },
      { header: "Nom", key: "lastName", width: 22 },
      { header: "Prénom", key: "firstName", width: 22 },
      { header: "Téléphone", key: "phone", width: 18 },
      { header: "E-mail", key: "email", width: 30 },
      { header: "Nb enfants", key: "childCount", width: 12 },
      { header: "Solde (DZD)", key: "balance", width: 16 },
      { header: "Langue", key: "preferredLanguage", width: 10 },
      { header: "Créé le", key: "createdAt", width: 22 },
    ],
    rows: parents.map((p) => ({
      code: p.code,
      lastName: p.lastName,
      firstName: p.firstName,
      phone: p.phone,
      email: p.email ?? "",
      childCount: studentCountByParent.get(p.id) ?? 0,
      balance: balanceByParent.get(p.id) ?? 0,
      preferredLanguage: p.preferredLanguage,
      createdAt: p.createdAt,
    })),
  };
}

/**
 * Build the students sheet spec. Mirrors the ETAT sheet's identity block
 * (B..K) so the export can be visually diffed against the import.
 */
function buildStudentsSheet(
  parents: readonly Parent[],
  students: readonly Student[],
): SheetSpec {
  const parentByCode = new Map(parents.map((p) => [p.id, p]));

  return {
    name: "Élèves",
    accentColor: "2B7FB0",
    columns: [
      { header: "Code", key: "code", width: 18 },
      { header: "TUTEUR", key: "tuteur", width: 22 },
      { header: "Téléphone parent", key: "parentPhone", width: 18 },
      { header: "NOM", key: "lastName", width: 22 },
      { header: "Prénom", key: "firstName", width: 22 },
      { header: "niveau", key: "level", width: 12 },
      { header: "Année", key: "gradeYear", width: 8 },
      { header: "Grade level", key: "gradeLevel", width: 16 },
      { header: "Transport", key: "transportTier", width: 18 },
      { header: "Statut", key: "status", width: 14 },
      { header: "Inscrit le", key: "enrollmentDate", width: 22 },
    ],
    rows: students.map((s) => {
      const parent = parentByCode.get(s.parentId);
      // NOM in the source sheet is LASTNAME FIRSTNAME — keep that order in
      // the export so the file is structurally identical to the import.
      return {
        code: s.code,
        tuteur: parent ? `${parent.lastName} ${parent.firstName}`.trim() : "",
        parentPhone: parent?.phone ?? "",
        lastName: s.lastName,
        firstName: s.firstName,
        level: s.level,
        gradeYear: s.gradeYear,
        gradeLevel: s.gradeLevel,
        transportTier: s.transportTier ?? "",
        status: s.status,
        enrollmentDate: s.enrollmentDate,
      };
    }),
  };
}

/**
 * Build the ledger sheet spec. One row per entry with the signed amount,
 * entry type, source, and a human-readable description. This is the
 * "audit-friendly" view of every financial event.
 */
function buildLedgerSheet(ledger: readonly LedgerEntry[]): SheetSpec {
  return {
    name: "Journal",
    accentColor: "C8A98C",
    columns: [
      { header: "ID", key: "id", width: 26 },
      { header: "Date", key: "at", width: 22 },
      { header: "Type", key: "type", width: 14 },
      { header: "Catégorie", key: "category", width: 14 },
      { header: "Parent ID", key: "parentId", width: 18 },
      { header: "Élève ID", key: "studentId", width: 18 },
      { header: "Montant (DZD)", key: "amount", width: 16 },
      { header: "Source", key: "sourceType", width: 16 },
      { header: "Reçu", key: "receiptNumber", width: 22 },
      { header: "Description", key: "description", width: 60 },
      { header: "Acteur", key: "actorName", width: 22 },
    ],
    rows: [...ledger]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((e) => ({
        id: e.id,
        at: e.at,
        type: e.type,
        category: e.category,
        parentId: e.parentId,
        studentId: e.studentId ?? "",
        amount: e.amount,
        sourceType: e.sourceType,
        receiptNumber: e.receiptNumber ?? "",
        description: e.description,
        actorName: e.actorName,
      })),
  };
}

/**
 * Build a "Résumé" sheet that gives a bird's-eye view of the export
 * (counts, totals, sanity checks). Always the first sheet.
 */
function buildSummarySheet(data: ExportData): SheetSpec {
  const totalCharged = data.ledger
    .filter((e) => e.type === "charge")
    .reduce((sum, e) => sum + e.amount, 0);
  const totalPaid = data.ledger
    .filter((e) => e.type === "payment")
    .reduce((sum, e) => sum + e.amount, 0);
  const totalAdjusted = data.ledger
    .filter((e) => e.type === "adjustment")
    .reduce((sum, e) => sum + e.amount, 0);
  const outstanding = totalCharged + totalAdjusted - totalPaid;

  return {
    name: "Résumé",
    accentColor: "349BD4",
    columns: [
      { header: "Métrique", key: "metric", width: 32 },
      { header: "Valeur", key: "value", width: 48 },
    ],
    rows: [
      { metric: "Date d'export", value: data.exportedAt },
      { metric: "Schéma", value: "el-imtiyaz-export/v1" },
      { metric: "— Comptages —", value: "" },
      { metric: "Nombre de parents", value: data.parents.length },
      { metric: "Nombre d'élèves", value: data.students.length },
      { metric: "Entrées du journal", value: data.ledger.length },
      { metric: "— Totaux financiers (DZD) —", value: "" },
      { metric: "Total facturé (charges)", value: totalCharged },
      { metric: "Total encaissé (paiements)", value: totalPaid },
      { metric: "Total ajustements (remises/remboursements)", value: totalAdjusted },
      { metric: "Solde global en attente", value: outstanding },
    ],
  };
}

/**
 * Export all data to a multi-sheet XLSX file. The default file name
 * includes the export timestamp so successive exports don't overwrite
 * each other.
 */
export async function exportToXlsxFile(
  data: ExportData,
  fileName?: string,
  options: ExportOptions = {},
): Promise<string> {
  const includeLedger = options.includeLedger ?? true;
  const sheets: SheetSpec[] = [
    buildSummarySheet(data),
    buildParentsSheet(data.parents, data.students, data.ledger),
    buildStudentsSheet(data.parents, data.students),
  ];
  if (includeLedger) {
    sheets.push(buildLedgerSheet(data.ledger));
  }
  const finalName =
    fileName ??
    `el-imtiyaz-export-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
  await exportToXlsx(sheets, finalName);
  return finalName;
}

/**
 * Export all data to a CSV file (parents + students flattened). Useful for
 * quick imports into other systems that don't support multi-sheet XLSX.
 */
export function exportStudentsToCsv(
  parents: readonly Parent[],
  students: readonly Student[],
  fileName?: string,
): string {
  const parentByCode = new Map(parents.map((p) => [p.id, p]));
  const finalName =
    fileName ??
    `el-imtiyaz-students-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  exportToCsv(
    [
      { header: "Code", key: "code" },
      { header: "TUTEUR", key: "tuteur" },
      { header: "Téléphone parent", key: "parentPhone" },
      { header: "NOM", key: "lastName" },
      { header: "Prénom", key: "firstName" },
      { header: "niveau", key: "level" },
      { header: "Année", key: "gradeYear" },
      { header: "Transport", key: "transportTier" },
      { header: "Statut", key: "status" },
    ],
    students.map((s) => {
      const parent = parentByCode.get(s.parentId);
      return {
        code: s.code,
        tuteur: parent ? `${parent.lastName} ${parent.firstName}`.trim() : "",
        parentPhone: parent?.phone ?? "",
        lastName: s.lastName,
        firstName: s.firstName,
        level: s.level,
        gradeYear: s.gradeYear,
        transportTier: s.transportTier ?? "",
        status: s.status,
      };
    }),
    finalName,
  );
  return finalName;
}
