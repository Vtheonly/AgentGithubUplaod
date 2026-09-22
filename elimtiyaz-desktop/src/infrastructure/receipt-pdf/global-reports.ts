// ============================================================================
// FILE: elimtiyaz-desktop/src/infrastructure/receipt-pdf/global-reports.ts
// ============================================================================
/**
 * Global report PDF generators — T-368 (67th session, REPT-504).
 *
 * The PDF twins of the five global XLSX exports (`excel/reports.ts`):
 * thin `ReportSpec` adapters over the SAME data the XLSX functions consume
 * (one data path, two renderers — no second data derivation, the §6/§9
 * reuse rule). The Reports tab gains an honest PDF button per report
 * instead of the T-088 "Bientôt disponible" gap.
 *
 *   - generateRevenueReportPdf         ↔ exportRevenueReport
 *   - generateOutstandingDebtReportPdf ↔ exportOutstandingDebtReport
 *   - generateStudentRosterPdf         ↔ exportStudentRoster
 *   - generatePersonnelDirectoryPdf    ↔ the tab's inline annuaire XLSX
 *   - generateExpensesByCategoryPdf    ↔ the tab's inline dépenses XLSX
 *
 * All rendering flows through the generic report-document engine (T-275)
 * which now paginates, sanitizes, and stamps true page counts (T-368a).
 */
import { generateReportPdf, type ReportSpec } from "./report-document";
import { dzdPdf } from "./shared";
import type { Payment } from "../../domain/model/payment";
import type { Student } from "../../domain/model/student";
import type { Personnel } from "../../domain/model/personnel";
import type { Expense } from "../../domain/model/expense";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  AGING_BUCKET_LABELS_FR,
} from "../../domain/model/payment";
import { LEVEL_LABELS_FR } from "../../domain/model/student";
import { STAFF_CATEGORY_LABELS_FR, PERSONNEL_STATUS_LABELS_FR } from "../../domain/model/personnel";
import { EXPENSE_CATEGORY_LABELS_FR, EXPENSE_STATUS_LABELS_FR } from "../../domain/model/expense";

const dzd = (n: number) => dzdPdf(n);
const lbl = (map: Record<string, string>, key: string | null | undefined): string =>
  (key != null && map[key]) || "—";
const isoDate = (v: string | null | undefined): string => (v ? v.slice(0, 10) : "");

/* ------------------------------------------------------------------ */
/*  1. Revenue report (PDF twin of exportRevenueReport)                */
/* ------------------------------------------------------------------ */

export async function generateRevenueReportPdf(
  payments: readonly Payment[],
  options: { from: string; to: string },
): Promise<Uint8Array> {
  const paid = payments.filter((p) => p.status === "paid");
  const total = paid.reduce((s, p) => s + p.amount, 0);

  const byMethod = new Map<string, { count: number; total: number }>();
  const byCategory = new Map<string, { count: number; total: number }>();
  for (const p of paid) {
    const m = byMethod.get(p.method) ?? { count: 0, total: 0 };
    m.count += 1;
    m.total += p.amount;
    byMethod.set(p.method, m);
    // ADR-023: null = multi-service — its own bucket.
    const catKey = p.category ?? "multi-services";
    const c = byCategory.get(catKey) ?? { count: 0, total: 0 };
    c.count += 1;
    c.total += p.amount;
    byCategory.set(catKey, c);
  }

  const sorted = [...paid].sort(
    (a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime(),
  );

  const spec: ReportSpec = {
    title: "RAPPORT DE REVENUS",
    meta: [
      ["Période", `${options.from} → ${options.to}`],
      ["Paiements encaissés", `${paid.length}`],
      ["Total encaissé", `${dzd(total)} DZD`],
    ],
    sections: [
      {
        heading: "Répartition par méthode",
        table:
          byMethod.size > 0
            ? {
                columns: ["Méthode", "Nombre", "Total (DZD)"],
                widths: [2.6, 1, 1.6],
                rows: Array.from(byMethod.entries()).map(([k, v]) => [
                  lbl(PAYMENT_METHOD_LABELS_FR, k),
                  String(v.count),
                  dzd(v.total),
                ]),
              }
            : undefined,
      },
      {
        heading: "Répartition par catégorie",
        table:
          byCategory.size > 0
            ? {
                columns: ["Catégorie", "Nombre", "Total (DZD)"],
                widths: [2.6, 1, 1.6],
                rows: Array.from(byCategory.entries()).map(([k, v]) => [
                  lbl(PAYMENT_CATEGORY_LABELS_FR, k),
                  String(v.count),
                  dzd(v.total),
                ]),
              }
            : undefined,
      },
      {
        heading: "Transactions",
        table: {
          columns: ["Date", "Reçu", "Méthode", "Catégorie", "Montant (DZD)"],
          widths: [1.1, 1.8, 1.2, 1.4, 1.2],
          rows: sorted.map((p) => [
            isoDate(p.collectedAt),
            p.receiptNumber,
            lbl(PAYMENT_METHOD_LABELS_FR, p.method),
            lbl(PAYMENT_CATEGORY_LABELS_FR, p.category),
            dzd(p.amount),
          ]),
        },
        note: "Statut 'Payé' uniquement — les chèques en attente et les remboursements sont exclus des revenus.",
      },
    ],
    footnote:
      "Rapport global généré à partir des données réelles du système (flux canonique des paiements).",
  };
  return generateReportPdf(spec);
}

/* ------------------------------------------------------------------ */
/*  2. Outstanding debt report (PDF twin of exportOutstandingDebtReport) */
/* ------------------------------------------------------------------ */

export interface GlobalDebtRow {
  readonly parentCode: string;
  readonly parentName: string;
  readonly parentPhone: string;
  readonly bucket: string;
  readonly daysOverdue: number;
  readonly outstandingAmount: number;
}

export async function generateOutstandingDebtReportPdf(rows: readonly GlobalDebtRow[]): Promise<Uint8Array> {
  const total = rows.reduce((s, r) => s + r.outstandingAmount, 0);
  const byBucket = new Map<string, { amount: number; count: number }>();
  for (const r of rows) {
    const b = byBucket.get(r.bucket) ?? { amount: 0, count: 0 };
    b.amount += r.outstandingAmount;
    b.count += 1;
    byBucket.set(r.bucket, b);
  }
  const sorted = [...rows].sort((a, b) => b.outstandingAmount - a.outstandingAmount);

  const spec: ReportSpec = {
    title: "CREANCES PAR TRANCHE D'AGE",
    meta: [
      ["Date", new Date().toLocaleDateString("fr-FR")],
      ["Familles débitrices", `${rows.length}`],
      ["Total dû", `${dzd(total)} DZD`],
    ],
    sections: [
      {
        heading: "Répartition par ancienneté",
        table:
          byBucket.size > 0
            ? {
                columns: ["Tranche d'ancienneté", "Montant (DZD)", "Débiteurs"],
                widths: [3, 2, 1.4],
                rows: Array.from(byBucket.entries()).map(([k, v]) => [
                  lbl(AGING_BUCKET_LABELS_FR, k),
                  dzd(v.amount),
                  String(v.count),
                ]),
              }
            : undefined,
      },
      {
        heading: "Débiteurs par montant décroissant",
        table: {
          columns: ["Code", "Famille", "Téléphone", "Jours", "Ancienneté", "Montant dû (DZD)"],
          widths: [1.4, 2.4, 1.7, 0.8, 1.3, 1.4],
          rows: sorted.map((d) => [
            d.parentCode,
            d.parentName,
            d.parentPhone || "—",
            String(d.daysOverdue),
            lbl(AGING_BUCKET_LABELS_FR, d.bucket),
            dzd(d.outstandingAmount),
          ]),
        },
      },
    ],
    footnote:
      "Les montants reflètent l'état du système au moment de la génération (flux canonique des créances).",
  };
  return generateReportPdf(spec);
}

/* ------------------------------------------------------------------ */
/*  3. Student roster (PDF twin of exportStudentRoster)                */
/* ------------------------------------------------------------------ */

export async function generateStudentRosterPdf(students: readonly Student[]): Promise<Uint8Array> {
  const byLevel = new Map<string, number>();
  for (const s of students) {
    byLevel.set(s.level, (byLevel.get(s.level) ?? 0) + 1);
  }
  const sorted = [...students].sort((a, b) =>
    a.level === b.level ? a.code.localeCompare(b.code) : a.level.localeCompare(b.level),
  );

  const spec: ReportSpec = {
    title: "EFFECTIFS PAR NIVEAU",
    meta: [
      ["Date", new Date().toLocaleDateString("fr-FR")],
      ["Élèves inscrits", `${students.length}`],
      ["Niveaux", `${byLevel.size}`],
    ],
    sections: [
      {
        heading: "Répartition par niveau",
        table: {
          columns: ["Niveau", "Effectif"],
          widths: [3, 1.4],
          rows: Array.from(byLevel.entries()).map(([k, v]) => [
            lbl(LEVEL_LABELS_FR, k),
            String(v),
          ]),
        },
      },
      {
        heading: "Registre complet",
        table: {
          columns: ["Code", "Prénom", "Nom", "Niveau", "Année", "Inscrit le", "Statut"],
          widths: [1.6, 1.6, 1.7, 1.2, 0.7, 1.2, 1.2],
          rows: sorted.map((s) => [
            s.code,
            s.firstName,
            s.lastName,
            lbl(LEVEL_LABELS_FR, s.level),
            String(s.gradeYear),
            isoDate(s.enrollmentDate),
            s.status,
          ]),
        },
      },
    ],
    footnote: "Registre global généré à partir du flux canonique des élèves.",
  };
  return generateReportPdf(spec);
}

/* ------------------------------------------------------------------ */
/*  4. Personnel directory (PDF twin of the tab's annuaire XLSX)       */
/* ------------------------------------------------------------------ */

export async function generatePersonnelDirectoryPdf(personnel: readonly Personnel[]): Promise<Uint8Array> {
  const sorted = [...personnel].sort((a, b) => a.lastName.localeCompare(b.lastName));
  const spec: ReportSpec = {
    title: "ANNUAIRE DU PERSONNEL",
    meta: [
      ["Date", new Date().toLocaleDateString("fr-FR")],
      ["Effectif", `${personnel.length}`],
    ],
    sections: [
      {
        heading: "Registre du personnel",
        table: {
          columns: ["Matricule", "Nom", "Catégorie", "Poste", "Téléphone", "Statut"],
          widths: [1.3, 2.2, 1.4, 2.2, 1.6, 1.1],
          rows: sorted.map((p) => [
            p.id,
            `${p.firstName} ${p.lastName}`,
            lbl(STAFF_CATEGORY_LABELS_FR, p.staffCategory),
            p.position ?? "—",
            p.phone,
            lbl(PERSONNEL_STATUS_LABELS_FR, p.status),
          ]),
        },
      },
    ],
    footnote: "Annuaire interne — données de contact du personnel.",
  };
  return generateReportPdf(spec);
}

/* ------------------------------------------------------------------ */
/*  5. Expenses by category (PDF twin of the tab's dépenses XLSX)      */
/* ------------------------------------------------------------------ */

export async function generateExpensesByCategoryPdf(expenses: readonly Expense[]): Promise<Uint8Array> {
  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const e of expenses) {
    const c = byCategory.get(e.category) ?? { amount: 0, count: 0 };
    c.amount += e.finalSpentAmount ?? e.amount;
    c.count += 1;
    byCategory.set(e.category, c);
  }
  const total = Array.from(byCategory.values()).reduce((s, v) => s + v.amount, 0);
  const sorted = [...expenses].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  const spec: ReportSpec = {
    title: "DEPENSES PAR CATEGORIE",
    meta: [
      ["Date", new Date().toLocaleDateString("fr-FR")],
      ["Dépenses", `${expenses.length}`],
      ["Total engagé", `${dzd(total)} DZD`],
    ],
    sections: [
      {
        heading: "Agrégat par catégorie",
        table: {
          columns: ["Catégorie", "Nombre", "Montant total (DZD)"],
          widths: [2.8, 1, 1.8],
          rows: Array.from(byCategory.entries()).map(([k, v]) => [
            lbl(EXPENSE_CATEGORY_LABELS_FR, k),
            String(v.count),
            dzd(v.amount),
          ]),
        },
      },
      {
        heading: "Tickets de dépense",
        table: {
          columns: ["Code", "Titre", "Bénéficiaire", "Statut", "Montant (DZD)"],
          widths: [1.4, 2.2, 2, 1.2, 1.4],
          rows: sorted.map((e) => [
            e.requestCode,
            e.title,
            e.payee,
            lbl(EXPENSE_STATUS_LABELS_FR, e.status),
            dzd(e.finalSpentAmount ?? e.amount),
          ]),
        },
      },
    ],
    footnote:
      "Montant final retenu = finalSpentAmount quand il est saisi, sinon le montant demandé (convention des dépenses).",
  };
  return generateReportPdf(spec);
}
