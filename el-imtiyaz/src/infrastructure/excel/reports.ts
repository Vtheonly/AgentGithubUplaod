/**
 * Report export service — plan §15.
 *
 * Three report types:
 *   1. Revenue Report — multi-sheet XLSX (monthly + by method + by category)
 *   2. Outstanding Debt Report — XLSX or CSV (per-parent breakdown)
 *   3. Student Roster Export — XLSX (per-class + per-level)
 *
 * Per plan §15: RLS filters must be applied on export — i.e. only the
 * data the current user is authorized to see should be exported.
 *
 * The functions accept already-loaded data (the caller is responsible
 * for RLS filtering) and produce downloadable XLSX/CSV files using
 * the shared export engine.
 */
import { exportToXlsx, exportToCsv, type SheetSpec } from "./export-engine";
import type { Payment } from "../../domain/model/payment";
import type { Student } from "../../domain/model/student";
import { formatDzdPlain } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  AGING_BUCKET_LABELS_FR,
} from "../../domain/model/payment";
import { LEVEL_LABELS_FR } from "../../domain/model/student";

/* ------------------------------------------------------------------ */
/*  1. Revenue Report                                                  */
/* ------------------------------------------------------------------ */

export async function exportRevenueReport(
  payments: readonly Payment[],
  options: { from: string; to: string },
): Promise<void> {
  const paid = payments.filter((p) => p.status === "paid");
  const total = paid.reduce((s, p) => s + p.amount, 0);

  // Sheet 1 — Summary
  const summary: SheetSpec = {
    name: "Synthèse",
    columns: [
      { header: "Période", key: "period", width: 28 },
      { header: "Nombre de paiements", key: "count", width: 22 },
      { header: "Total encaissé (DZD)", key: "total", width: 22 },
    ],
    rows: [
      { period: `${options.from} → ${options.to}`, count: paid.length, total },
    ],
  };

  // Sheet 2 — By Method
  const byMethod: Record<string, { count: number; total: number }> = {};
  for (const p of paid) {
    const k = p.method;
    byMethod[k] ??= { count: 0, total: 0 };
    byMethod[k].count += 1;
    byMethod[k].total += p.amount;
  }
  const methodSheet: SheetSpec = {
    name: "Par méthode",
    columns: [
      { header: "Méthode", key: "method", width: 22 },
      { header: "Nombre", key: "count", width: 12 },
      { header: "Total (DZD)", key: "total", width: 22 },
    ],
    rows: Object.entries(byMethod).map(([k, v]) => ({
      method: PAYMENT_METHOD_LABELS_FR[k as keyof typeof PAYMENT_METHOD_LABELS_FR] ?? k,
      count: v.count,
      total: v.total,
    })),
  };

  // Sheet 3 — By Category
  const byCategory: Record<string, { count: number; total: number }> = {};
  for (const p of paid) {
    const k = p.category;
    byCategory[k] ??= { count: 0, total: 0 };
    byCategory[k].count += 1;
    byCategory[k].total += p.amount;
  }
  const categorySheet: SheetSpec = {
    name: "Par catégorie",
    columns: [
      { header: "Catégorie", key: "category", width: 22 },
      { header: "Nombre", key: "count", width: 12 },
      { header: "Total (DZD)", key: "total", width: 22 },
    ],
    rows: Object.entries(byCategory).map(([k, v]) => ({
      category: PAYMENT_CATEGORY_LABELS_FR[k as keyof typeof PAYMENT_CATEGORY_LABELS_FR] ?? k,
      count: v.count,
      total: v.total,
    })),
  };

  // Sheet 4 — All transactions
  const transactionsSheet: SheetSpec = {
    name: "Transactions",
    columns: [
      { header: "Date", key: "date", width: 14 },
      { header: "Reçu", key: "receipt", width: 22 },
      { header: "Méthode", key: "method", width: 16 },
      { header: "Catégorie", key: "category", width: 18 },
      { header: "Statut", key: "status", width: 14 },
      { header: "Montant (DZD)", key: "amount", width: 18 },
    ],
    rows: paid
      .slice()
      .sort((a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime())
      .map((p) => ({
        date: formatDate(p.collectedAt),
        receipt: p.receiptNumber,
        method: PAYMENT_METHOD_LABELS_FR[p.method],
        category: PAYMENT_CATEGORY_LABELS_FR[p.category],
        status: PAYMENT_STATUS_LABELS_FR[p.status],
        amount: p.amount,
      })),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  await exportToXlsx(
    [summary, methodSheet, categorySheet, transactionsSheet],
    `el-imtiyaz-revenu-${stamp}.xlsx`,
  );
}

/* ------------------------------------------------------------------ */
/*  2. Outstanding Debt Report                                         */
/* ------------------------------------------------------------------ */

export interface DebtRow {
  parentCode: string;
  parentName: string;
  parentPhone: string;
  bucket: keyof typeof AGING_BUCKET_LABELS_FR;
  daysOverdue: number;
  outstandingAmount: number;
}

export async function exportOutstandingDebtReport(
  rows: readonly DebtRow[],
  format: "xlsx" | "csv" = "xlsx",
): Promise<void> {
  const columns = [
    { header: "Code parent", key: "parentCode", width: 18 },
    { header: "Nom", key: "parentName", width: 28 },
    { header: "Téléphone", key: "parentPhone", width: 18 },
    { header: "Tranche d'âge", key: "bucket", width: 18 },
    { header: "Jours de retard", key: "daysOverdue", width: 16 },
    { header: "Montant dû (DZD)", key: "outstandingAmount", width: 22 },
  ];
  const data = rows.map((r) => ({
    parentCode: r.parentCode,
    parentName: r.parentName,
    parentPhone: r.parentPhone,
    bucket: AGING_BUCKET_LABELS_FR[r.bucket],
    daysOverdue: r.daysOverdue,
    outstandingAmount: r.outstandingAmount,
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    exportToCsv(columns, data, `el-imtiyaz-creances-${stamp}.csv`);
  } else {
    await exportToXlsx(
      [{ name: "Créances", columns, rows: data, accentColor: "C0504D" }],
      `el-imtiyaz-creances-${stamp}.xlsx`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  3. Student Roster Export                                           */
/* ------------------------------------------------------------------ */

export async function exportStudentRoster(students: readonly Student[]): Promise<void> {
  const columns = [
    { header: "Code", key: "code", width: 18 },
    { header: "Prénom", key: "firstName", width: 16 },
    { header: "Nom", key: "lastName", width: 18 },
    { header: "Niveau", key: "level", width: 12 },
    { header: "Année", key: "gradeYear", width: 8 },
    { header: "Date de naissance", key: "birthDate", width: 16 },
    { header: "Date d'inscription", key: "enrollmentDate", width: 18 },
    { header: "Statut", key: "status", width: 14 },
  ];
  const rows = students.map((s) => ({
    code: s.code,
    firstName: s.firstName,
    lastName: s.lastName,
    level: LEVEL_LABELS_FR[s.level],
    gradeYear: s.gradeYear,
    birthDate: formatDate(s.birthDate),
    enrollmentDate: formatDate(s.enrollmentDate),
    status: s.status,
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  await exportToXlsx(
    [{ name: "Élèves", columns, rows, accentColor: "349BD4" }],
    `el-imtiyaz-effectifs-${stamp}.xlsx`,
  );
}

/* ------------------------------------------------------------------ */
/*  4. Audit Log Export (used by Settings → Audit tab)                 */
/* ------------------------------------------------------------------ */

export interface AuditExportRow {
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string;
  ipAddress: string | null;
  note: string | null;
}

export async function exportAuditLog(
  rows: readonly AuditExportRow[],
  format: "xlsx" | "csv" = "xlsx",
): Promise<void> {
  const columns = [
    { header: "Horodatage", key: "at", width: 22 },
    { header: "Action", key: "action", width: 24 },
    { header: "Type d'entité", key: "entityType", width: 16 },
    { header: "ID entité", key: "entityId", width: 22 },
    { header: "Acteur", key: "actorName", width: 22 },
    { header: "Adresse IP", key: "ipAddress", width: 16 },
    { header: "Note", key: "note", width: 30 },
  ];
  const data = rows.map((r) => ({
    at: r.at,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    actorName: r.actorName,
    ipAddress: r.ipAddress ?? "",
    note: r.note ?? "",
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    exportToCsv(columns, data, `el-imtiyaz-audit-${stamp}.csv`);
  } else {
    await exportToXlsx(
      [{ name: "Audit", columns, rows: data, accentColor: "2B7FB0" }],
      `el-imtiyaz-audit-${stamp}.xlsx`,
    );
  }
}

// Re-export so consumers can format amounts if needed
void formatDzdPlain;
