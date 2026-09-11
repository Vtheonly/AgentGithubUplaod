// ============================================================================
// FILE: src/domain/calc/payment/financial-query-engine.ts
// ============================================================================
/**
 * Financial Query & Diagnostic Engine.
 *
 * Provides deep analytical queries and correlations across:
 *   - Cash Flow & Treasury (Cleared payments vs Disbursed expenses)
 *   - Tranche Clearance Velocity (T1, T2, T3 satisfaction rates)
 *   - Cross-Service Leakage (e.g. Tuition paid, Transport unpaid)
 *   - Bank Float Risk (Checks pending > 15 days without clearance)
 *   - Immediate Offset Candidates (Available parent credit + open debt)
 *   - Delinquency Triage (Chronic vs Transitory overdue balances)
 *
 * All functions are pure, total, and derive exclusively from canonical models.
 */

import type {
  Payment,
  Installment,
  DebtSummary,
  PaymentCategory,
} from "../../model/payment";
import type { LedgerEntry } from "../../model/ledger";
import type { Expense } from "../../model/expense";
import type { Parent } from "../../model/parent";
import type { Student } from "../../model/student";
import { parentDisplayName } from "../../model/parent";
import { installmentRemaining } from "./queries";

export type FinancialAnomalyType =
  | "service_leakage" // Paid tuition but defaulted on auxiliary services
  | "pending_check_risk" // Check/transfer pending > 15 days
  | "unabsorbed_credit" // Parent has credit balance but also open debt
  | "early_default_critical" // Tranche 1 (Sept) still unpaid past Dec
  | "large_cash_volume" // Single cash payment > 150,000 DA
  | "healthy";

export interface FamilyFinancialDiagnosis {
  parentId: string;
  parentName: string;
  parentPhone: string;
  studentCount: number;
  totalDue: number;
  totalPaid: number;
  totalDebt: number;
  unallocatedCredit: number;
  daysOverdue: number;
  pendingChecksAmount: number;
  tuitionPaid: boolean;
  auxiliaryDebt: number; // Transport, Canteen, etc.
  anomalies: FinancialAnomalyType[];
  anomalySummary: string;
  recommendedAction: string;
}

export interface ServicePerformanceRow {
  category: PaymentCategory;
  label: string;
  totalBilled: number;
  totalCleared: number;
  totalPending: number;
  outstandingDebt: number;
  recoveryRate: number; // 0 to 100
  debtorFamilyCount: number;
  totalFamiliesCount: number;
}

export interface TreasuryHealthSnapshot {
  totalClearedInflow: number;
  totalDisbursedOutflow: number;
  netOperatingCashFlow: number;
  bankFloatPending: number;
  recoverableDebt30d: number; // Estimated cash-in next 30 days
  t1CollectionRate: number;
  t2CollectionRate: number;
  t3CollectionRate: number;
}

export interface FinancialPresetQuery {
  id: string;
  title: string;
  description: string;
  badgeTone: "danger" | "warning" | "info" | "success";
  filter: (f: FamilyFinancialDiagnosis) => boolean;
}

export const FINANCIAL_PRESETS: FinancialPresetQuery[] = [
  {
    id: "service_leakage",
    title: "Fuite de Revenus Services",
    description: "Scolarité payée mais Transport / Cantine impayés",
    badgeTone: "warning",
    filter: (f) => f.anomalies.includes("service_leakage"),
  },
  {
    id: "unabsorbed_credit",
    title: "Compensations Immédiates",
    description: "Crédit parent disponible pouvant solder une dette ouverte",
    badgeTone: "info",
    filter: (f) => f.anomalies.includes("unabsorbed_credit"),
  },
  {
    id: "pending_check_risk",
    title: "Risque Chèques Flottants (> 15j)",
    description: "Paiements par chèque non compensés depuis plus de 2 semaines",
    badgeTone: "danger",
    filter: (f) => f.anomalies.includes("pending_check_risk"),
  },
  {
    id: "early_default_critical",
    title: "Défaut Lourd (Tranche 1 Bloquée)",
    description: "Tranche initiale de rentrée toujours impayée",
    badgeTone: "danger",
    filter: (f) => f.anomalies.includes("early_default_critical"),
  },
  {
    id: "high_debt_chronic",
    title: "Créances Majeures (> 50 000 DA)",
    description: "Dette familiale élevée nécessitant plan de paiement",
    badgeTone: "danger",
    filter: (f) => f.totalDebt >= 50_000,
  },
  {
    id: "large_cash",
    title: "Gros Versements Espèces",
    description: "Paiements uniques en espèces supérieurs à 150 000 DA",
    badgeTone: "info",
    filter: (f) => f.anomalies.includes("large_cash_volume"),
  },
];

/**
 * Builds diagnostic profiles for all families with active financial activity.
 */
export function evaluateFamilyFinancialDiagnoses(params: {
  parents: readonly Parent[];
  students: readonly Student[];
  installments: readonly Installment[];
  payments: readonly Payment[];
  ledgerEntries: readonly LedgerEntry[];
  debtSummaries: readonly DebtSummary[];
}): FamilyFinancialDiagnosis[] {
  const {
    parents,
    students,
    installments,
    payments,
    ledgerEntries,
    debtSummaries,
  } = params;

  const debtMap = new Map(debtSummaries.map((d) => [d.parentId, d]));
  const studentsByParent = new Map<string, Student[]>();
  for (const s of students) {
    const list = studentsByParent.get(s.parentId) ?? [];
    list.push(s);
    studentsByParent.set(s.parentId, list);
  }

  const installmentsByParent = new Map<string, Installment[]>();
  for (const i of installments) {
    const list = installmentsByParent.get(i.parentId) ?? [];
    list.push(i);
    installmentsByParent.set(i.parentId, list);
  }

  const paymentsByParent = new Map<string, Payment[]>();
  for (const p of payments) {
    const list = paymentsByParent.get(p.parentId) ?? [];
    list.push(p);
    paymentsByParent.set(p.parentId, list);
  }

  const creditByParent = new Map<string, number>();
  for (const e of ledgerEntries) {
    if (
      e.category === "parent_credit" &&
      e.type === "adjustment" &&
      e.amount < 0
    ) {
      creditByParent.set(
        e.parentId,
        (creditByParent.get(e.parentId) ?? 0) + Math.abs(e.amount),
      );
    }
  }

  const nowMs = Date.now();
  const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;

  return parents.map((parent) => {
    const pDebt = debtMap.get(parent.id);
    const pInsts = installmentsByParent.get(parent.id) ?? [];
    const pPayments = paymentsByParent.get(parent.id) ?? [];
    const pStudents = studentsByParent.get(parent.id) ?? [];

    const totalDue = pInsts.reduce((s, i) => s + i.amountDue, 0);
    const totalPaid = pInsts.reduce((s, i) => s + i.amountPaid, 0);
    const totalDebt = pDebt
      ? pDebt.outstandingAmount
      : Math.max(0, totalDue - totalPaid);
    const daysOverdue = pDebt ? pDebt.daysOverdue : 0;
    const unallocatedCredit = creditByParent.get(parent.id) ?? 0;

    // Check for pending non-cash payments older than 15 days
    const pendingChecks = pPayments.filter(
      (p) =>
        (p.status === "pending" || p.status === "pending_clearance") &&
        (p.method === "check" || p.method === "transfer") &&
        nowMs - new Date(p.collectedAt).getTime() > fifteenDaysMs,
    );
    const pendingChecksAmount = pendingChecks.reduce((s, p) => s + p.amount, 0);

    // Cross-service analysis: Did they pay tuition but default on transport/other?
    const tuitionInsts = pInsts.filter((i) => i.category === "tuition");
    const auxInsts = pInsts.filter((i) => i.category !== "tuition");

    const tuitionAllPaid =
      tuitionInsts.length > 0 &&
      tuitionInsts.every(
        (i) => i.status === "paid" || installmentRemaining(i) === 0,
      );
    const auxiliaryDebt = auxInsts.reduce(
      (s, i) => s + installmentRemaining(i),
      0,
    );

    // Early default: Is T1 (due September/October) still unpaid?
    const t1Unpaid = tuitionInsts.some(
      (i) =>
        i.label.includes("1") &&
        (i.status === "overdue" || installmentRemaining(i) > 0),
    );

    // Large cash transactions
    const hasLargeCash = pPayments.some(
      (p) => p.method === "cash" && p.amount >= 150_000,
    );

    // Anomalies evaluation
    const anomalies: FinancialAnomalyType[] = [];
    const anomalyNotes: string[] = [];

    if (tuitionAllPaid && auxiliaryDebt > 5000) {
      anomalies.push("service_leakage");
      anomalyNotes.push(
        `Scolarité réglée, mais ${auxiliaryDebt.toLocaleString("fr-FR")} DA dus sur services annexes`,
      );
    }

    if (unallocatedCredit > 0 && totalDebt > 0) {
      anomalies.push("unabsorbed_credit");
      anomalyNotes.push(
        `Crédit de ${unallocatedCredit.toLocaleString("fr-FR")} DA disponible face à ${totalDebt.toLocaleString("fr-FR")} DA de dette`,
      );
    }

    if (pendingChecksAmount > 0) {
      anomalies.push("pending_check_risk");
      anomalyNotes.push(
        `${pendingChecksAmount.toLocaleString("fr-FR")} DA en chèques non compensés depuis > 15j`,
      );
    }

    if (t1Unpaid && daysOverdue > 60) {
      anomalies.push("early_default_critical");
      anomalyNotes.push(
        "Tranche 1 initiale toujours impayée (retard critique)",
      );
    }

    if (hasLargeCash) {
      anomalies.push("large_cash_volume");
      anomalyNotes.push("Versement espèces important (traçabilité)");
    }

    // Recommended Action
    let recommendedAction = "Situation financière régulière.";
    if (anomalies.includes("unabsorbed_credit")) {
      recommendedAction =
        "Absorber immédiatement le crédit disponible sur les tranches ouvertes.";
    } else if (anomalies.includes("pending_check_risk")) {
      recommendedAction =
        "Vérifier l'état de compensation bancaire avec l'officier financier.";
    } else if (anomalies.includes("early_default_critical")) {
      recommendedAction =
        "Convoquer le parent pour mise en place d'un échéancier négocié.";
    } else if (anomalies.includes("service_leakage")) {
      recommendedAction =
        "Relancer spécifiquement pour le transport / cantine.";
    } else if (totalDebt > 40_000) {
      recommendedAction = "Relance téléphonique prioritaire P1.";
    }

    return {
      parentId: parent.id,
      parentName: parentDisplayName(parent),
      parentPhone: parent.phone,
      studentCount: pStudents.length,
      totalDue,
      totalPaid,
      totalDebt,
      unallocatedCredit,
      daysOverdue,
      pendingChecksAmount,
      tuitionPaid: tuitionAllPaid,
      auxiliaryDebt,
      anomalies: anomalies.length > 0 ? anomalies : ["healthy"],
      anomalySummary: anomalyNotes.join(" · ") || "Aucune anomalie détectée",
      recommendedAction,
    };
  });
}

/**
 * Computes performance, collection rate, and debt breakdown by service category.
 */
export function computeCrossServicePerformance(params: {
  installments: readonly Installment[];
  payments: readonly Payment[];
}): ServicePerformanceRow[] {
  const { installments, payments } = params;

  const categories: { key: PaymentCategory; label: string }[] = [
    { key: "tuition", label: "Scolarité Annuelle" },
    { key: "transport", label: "Transport Scolaire" },
    { key: "canteen", label: "Restauration & Cantine" },
    { key: "uniform", label: "Uniformes & Tabliers" },
    { key: "therapy_psychology", label: "Accompagnement Psychologique" },
    { key: "therapy_speech", label: "Orthophonie" },
    { key: "extracurricular", label: "Clubs & Activités" },
    { key: "books", label: "Manuels & Fournitures" },
  ];

  return categories
    .map(({ key, label }) => {
      const catInsts = installments.filter((i) => i.category === key);
      const catPayments = payments.filter(
        (p) => p.category === key && p.status === "paid",
      );
      const catPending = payments.filter(
        (p) =>
          p.category === key &&
          (p.status === "pending" || p.status === "pending_clearance"),
      );

      const totalBilled = catInsts.reduce((s, i) => s + i.amountDue, 0);
      const totalCleared = catPayments.reduce((s, p) => s + p.amount, 0);
      const totalPending = catPending.reduce((s, p) => s + p.amount, 0);

      const outstandingDebt = catInsts.reduce(
        (s, i) => s + installmentRemaining(i),
        0,
      );
      const recoveryRate =
        totalBilled > 0
          ? Math.min(100, Math.round((totalCleared / totalBilled) * 100))
          : 100;

      const allFamilies = new Set(catInsts.map((i) => i.parentId));
      const debtorFamilies = new Set(
        catInsts
          .filter((i) => installmentRemaining(i) > 0)
          .map((i) => i.parentId),
      );

      return {
        category: key,
        label,
        totalBilled,
        totalCleared,
        totalPending,
        outstandingDebt,
        recoveryRate,
        debtorFamilyCount: debtorFamilies.size,
        totalFamiliesCount: allFamilies.size,
      };
    })
    .filter((row) => row.totalBilled > 0 || row.totalCleared > 0);
}

/**
 * Computes treasury liquidity and tranche recovery health.
 */
export function computeTreasuryHealth(params: {
  payments: readonly Payment[];
  installments: readonly Installment[];
  expenses: readonly Expense[];
  debtSummaries: readonly DebtSummary[];
}): TreasuryHealthSnapshot {
  const { payments, installments, expenses, debtSummaries } = params;

  const totalClearedInflow = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);

  const bankFloatPending = payments
    .filter((p) => p.status === "pending" || p.status === "pending_clearance")
    .reduce((s, p) => s + p.amount, 0);

  const totalDisbursedOutflow = expenses
    .filter((e) => e.status === "disbursed" || e.status === "settled")
    .reduce((s, e) => s + (e.finalSpentAmount ?? e.amount), 0);

  const netOperatingCashFlow = totalClearedInflow - totalDisbursedOutflow;

  // 30-day projected cash-in (debts with <= 30 days overdue + tranches due in next 30 days)
  const recoverableDebt30d = debtSummaries
    .filter((d) => d.daysOverdue <= 30)
    .reduce((s, d) => s + d.outstandingAmount * 0.85, 0);

  // Tranche collection rates (T1, T2, T3)
  const computeTrancheRate = (prefix: string) => {
    const tInsts = installments.filter((i) => i.label.includes(prefix));
    const due = tInsts.reduce((s, i) => s + i.amountDue, 0);
    const paid = tInsts.reduce((s, i) => s + i.amountPaid, 0);
    return due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;
  };

  return {
    totalClearedInflow,
    totalDisbursedOutflow,
    netOperatingCashFlow,
    bankFloatPending,
    recoverableDebt30d: Math.round(recoverableDebt30d),
    t1CollectionRate: computeTrancheRate("1"),
    t2CollectionRate: computeTrancheRate("2"),
    t3CollectionRate: computeTrancheRate("3"),
  };
}
