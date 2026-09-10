// ============================================================================
// FILE: elimtiyaz-desktop/src/infrastructure/receipt-pdf/payment-plan.ts
// ============================================================================
/**
 * Payment plan PDF (T-276, 42nd session — AI-311e).
 *
 * The copilot's propose_payment_plan document — a printable installment
 * schedule handed to a debtor family: parent identity, outstanding
 * (canonical), the equal-installment schedule with due dates and
 * cumulative totals. ADVISORY document: no installment rows are written
 * to the system by the AI layer (§15.5 — this is a printed commitment
 * proposal, the registration goes through the canonical installment
 * workflow if the school accepts it).
 */
import { generateReportPdf, type ReportSpec } from "./report-document";

export interface PaymentPlanInput {
  readonly parentName: string;
  readonly parentCode: string;
  readonly parentPhone: string | null;
  readonly outstandingAmount: number;
  readonly months: number;
  readonly downPayment: number;
  readonly monthlyAmount: number;
  readonly totalPlanned: number;
  readonly schedule: readonly { installmentNumber: number; dueDate: string; amount: number; cumulative: number }[];
}

const dzd = (n: number) => n.toLocaleString("fr-FR");

export async function generatePaymentPlanPdf(input: PaymentPlanInput): Promise<Uint8Array> {
  const spec: ReportSpec = {
    title: "PLAN DE PAIEMENT",
    meta: [
      ["Famille", `${input.parentName} (${input.parentCode})`],
      ["Téléphone", input.parentPhone ?? "—"],
      ["Solde dû (canonique)", `${dzd(input.outstandingAmount)} DZD`],
      ["Acompte immédiat", input.downPayment > 0 ? `${dzd(input.downPayment)} DZD` : "aucun"],
      ["Mensualité", `${dzd(input.monthlyAmount)} DZD × ${input.months} mois`],
      ["Total du plan", `${dzd(input.totalPlanned)} DZD`],
    ],
    sections: [
      {
        heading: "Échéancier",
        table: {
          columns: ["#", "Échéance", "Montant (DZD)", "Cumul (DZD)"],
          widths: [0.6, 2, 1.8, 1.8],
          rows: input.schedule.map((r) => [
            String(r.installmentNumber),
            r.dueDate,
            dzd(r.amount),
            dzd(r.cumulative + input.downPayment),
          ]),
        },
        note:
          "Plan indicatif établi sur le solde canonique à la date de génération. L'acceptation du plan par l'établissement et la famille vaut engagement de règlement ; les échéances effectives sont suivies via les rappels canoniques.",
      },
    ],
    footnote:
      "Document généré par l'assistant IA — aucune échéance n'a été inscrite dans le système. Faire signer par la famille et conserver une copie au dossier.",
  };

  return generateReportPdf(spec);
}
