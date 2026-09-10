// ============================================================================
// FILE: elimtiyaz-desktop/src/infrastructure/receipt-pdf/debt-report.ts
// ============================================================================
/**
 * Collection sheet PDF (T-275, 42nd session — AI-311d).
 *
 * The copilot's generate_debt_report document — the collector's daily
 * work sheet: aging composition, then the debtor table sorted by
 * amount (name, phone, amount, days overdue, bucket, children). The
 * rows arrive from the canonical debt stream (DebtSummary — the same
 * one the alerts workspace renders); this generator formats, never
 * recomputes.
 */
import { generateReportPdf, type ReportSpec } from "./report-document";

export interface DebtReportRow {
  readonly parentName: string;
  readonly parentPhone: string | null;
  readonly outstandingAmount: number;
  readonly daysOverdue: number;
  readonly bucketLabel: string;
  readonly studentCount: number;
}

export interface DebtReportInput {
  readonly minDaysOverdue: number;
  readonly totalOutstanding: number;
  readonly debtors: readonly DebtReportRow[];
  readonly agingBuckets: readonly { bucket: string; amount: number; debtorCount: number }[];
}

const dzd = (n: number) => n.toLocaleString("fr-FR");

export async function generateDebtReportPdf(input: DebtReportInput): Promise<Uint8Array> {
  const spec: ReportSpec = {
    title: "FEUILLE DE RECOUVREMENT",
    meta: [
      ["Date", new Date().toLocaleDateString("fr-FR")],
      ["Critère", `Retard ≥ ${input.minDaysOverdue} jour(s)`],
      ["Débiteurs listés", `${input.debtors.length} familles`],
      ["Total dû (liste)", `${dzd(input.totalOutstanding)} DZD`],
    ],
    sections: [
      {
        heading: "Répartition par ancienneté",
        table:
          input.agingBuckets.length > 0
            ? {
                columns: ["Tranche d'ancienneté", "Montant (DZD)", "Débiteurs"],
                widths: [3, 2, 1.4],
                rows: input.agingBuckets.map((b) => [b.bucket, dzd(b.amount), String(b.debtorCount)]),
              }
            : undefined,
        note: "Composition vieillie des créances — la même répartition que le tableau de bord analytique.",
      },
      {
        heading: "Débiteurs par montant décroissant",
        table: {
          columns: ["Famille", "Téléphone", "Montant dû (DZD)", "Jours", "Ancienneté", "Enfants"],
          widths: [2.8, 1.7, 1.6, 0.8, 1.5, 0.9],
          rows: input.debtors.map((d) => [
            d.parentName,
            d.parentPhone ?? "—",
            dzd(d.outstandingAmount),
            String(d.daysOverdue),
            d.bucketLabel,
            String(d.studentCount),
          ]),
        },
        note: "Relances : appel direct pour > 90 jours, rappel écrit sinon. propose_payment_reminder (assistant IA) prépare chaque relance avec validation humaine.",
      },
    ],
    footnote:
      "Document généré par l'assistant IA à partir du flux canonique des créances. Les montants reflètent l'état du système au moment de la génération.",
  };

  return generateReportPdf(spec);
}
