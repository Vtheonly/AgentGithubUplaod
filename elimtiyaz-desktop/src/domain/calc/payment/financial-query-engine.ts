// ============================================================================
// FILE: src/domain/calc/payment/financial-query-engine.ts
// ============================================================================
/**
 * Financial Query & Diagnostic Engine — T-411 re-base (DUP-006, 95th
 * session 2026-09-23).
 *
 * CLASSIFICATION (audit §H, binding): this module is an ANALYTICAL layer —
 * classifications, thresholds, presets and prompts. It is a CONSUMER of the
 * canonical engines, never a second implementation of them (AGENTS.md
 * §15.53a):
 *   - balances/credits   ← computeParentSummary + displayParentCredit (ADR-010)
 *   - per-tranche remaining ← installmentRemaining (INV-4)
 *   - tranche waves      ← the canonical tranche_number grouping (T-354)
 *   - per-service cleared ← payment_allocations (T-330 chain, DATA-029)
 *   - debt status        ← the DebtSummary stream (§15 installment basis)
 *
 * Provides deep analytical queries and correlations across:
 *   - Cash Flow & Treasury (Cleared payments vs Disbursed expenses)
 *   - Tranche Clearance Velocity (T1, T2, T3 satisfaction rates)
 *   - Cross-Service Leakage (e.g. Tuition paid, Transport unpaid)
 *   - Bank Float Risk (Checks pending > 15 days without clearance)
 *   - Immediate Offset Candidates (Available parent credit + open debt)
 *   - Delinquency Triage (Chronic vs Transitory overdue balances)
 *
 * All functions are pure and total.
 */

import type {
  Payment,
  Installment,
  DebtSummary,
  PaymentCategory,
  PaymentAllocation,
} from "../../model/payment";
import type { LedgerEntry } from "../../model/ledger";
import type { Expense } from "../../model/expense";
import type { Parent } from "../../model/parent";
import type { Student } from "../../model/student";
import { parentDisplayName } from "../../model/parent";
import { installmentRemaining } from "./queries";
import { computeParentSummary, displayParentCredit } from "../ledger/balance";

export type FinancialAnomalyType =
  | "service_leakage" // Paid tuition but defaulted on auxiliary services
  | "pending_check_risk" // Check/transfer pending > 15 days
  | "unabsorbed_credit" // Parent has credit balance but also open debt
  | "early_default_critical" // Initial tuition tranche (T1/FI) still unpaid past 60 days
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
  auxiliaryDebt: number; // Transport, therapy, etc.
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
  /**
   * T-411 (FA-07 fix): the honest 30-day inflow forecast — (a) outstanding
   * on debt already overdue by ≤ 30 days PLUS (b) the INV-4 remaining of
   * tranches falling due within the next 30 days. NO recovery factor: the
   * previous ×0.85 multiplier was an undocumented constant (DUP-006
   * evidence) and has been removed.
   */
  expectedInflow30d: number;
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
    description: "Scolarité payée mais Transport / services annexes impayés",
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
    description: "Tranche initiale de scolarité toujours impayée",
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
 *
 * T-411 re-base: balance/credit fields come from the CANONICAL ledger replay
 * (`computeParentSummary` + `displayParentCredit`, ADR-010) instead of the
 * raw `parent_credit` filter (DATA-024); the debt fallback uses
 * `installmentRemaining` (INV-4); T1 detection groups by the canonical
 * `trancheNumber` (DATA-023).
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

  const nowMs = Date.now();
  const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;

  return parents.map((parent) => {
    const pDebt = debtMap.get(parent.id);
    const pInsts = installmentsByParent.get(parent.id) ?? [];
    const pPayments = paymentsByParent.get(parent.id) ?? [];
    const pStudents = studentsByParent.get(parent.id) ?? [];

    // ── Canonical replay (INV-1 / ADR-010) — DATA-024 fix ──────────────
    // The credit is the DISPLAY derivation over the canonical aggregates,
    // never a raw `parent_credit` filter (no reversal exclusion there).
    const summary = computeParentSummary(ledgerEntries, parent.id, parentDisplayName(parent));
    const unallocatedCredit = displayParentCredit(
      summary.totalOutstanding,
      summary.totalUnallocatedCredit,
    );

    // Net due / paid on the ledger basis — the SAME numbers the CRM
    // dossier's Finances tab shows (cross-tab reconciliation, audit §G).
    const totalDue = summary.totalCharged + summary.totalAdjusted;
    const totalPaid = summary.totalPaid;
    // Debt on the §15 installment basis (the Créances number); the
    // fallback uses the canonical INV-4 helper, never `due − paid`.
    const totalDebt = pDebt
      ? pDebt.outstandingAmount
      : pInsts.reduce((s, i) => s + installmentRemaining(i), 0);
    const daysOverdue = pDebt ? pDebt.daysOverdue : 0;

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

    // Early default: is the INITIAL TUITION tranche (canonical wave 1 —
    // the inscription/FI tranche) still unpaid? DATA-023 fix: group by the
    // canonical `trancheNumber`, never the label text (the retired
    // `label.includes("1")` hack matched transport rows and probe labels).
    const t1Unpaid = tuitionInsts.some(
      (i) =>
        i.trancheNumber === 1 &&
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
        "Tranche 1 initiale (scolarité) toujours impayée (retard critique)",
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
        "Relancer spécifiquement pour le transport / services annexes.";
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
 * Computes performance, collection rate, and debt breakdown by service
 * category.
 *
 * T-411 re-base (DATA-029): per-service CLEARED and PENDING derive from the
 * canonical `payment_allocations` (the T-330 chain — where the waterfall
 * actually put the money), joined to the payment's status for the
 * cleared/pending split. The previous `payments.category` attribution
 * misfiled cross-category collections and counted overpayment-turned-credit
 * as in-category cleared. The category list is trimmed to the ACTIVE
 * services (CALC-001 retired canteen/uniform/books/extracurricular).
 */
export function computeCrossServicePerformance(params: {
  installments: readonly Installment[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
}): ServicePerformanceRow[] {
  const { installments, payments, allocations } = params;

  const categories: { key: PaymentCategory; label: string }[] = [
    { key: "tuition", label: "Scolarité Annuelle" },
    { key: "transport", label: "Transport Scolaire" },
    { key: "therapy_psychology", label: "Accompagnement Psychologique" },
    { key: "therapy_speech", label: "Orthophonie" },
    { key: "second_apron", label: "2ème Tablier" },
    { key: "other", label: "Autres Services" },
  ];

  // Canonical attribution: allocation rows carry the CONCRETE category the
  // waterfall satisfied; the payment's status splits cleared vs pending.
  const paymentStatusById = new Map(payments.map((p) => [p.id, p.status]));
  const clearedByCategory = new Map<PaymentCategory, number>();
  const pendingByCategory = new Map<PaymentCategory, number>();
  for (const a of allocations) {
    // A null-category allocation (ledger-fallback derivation for a
    // cross-category payment) has no per-service attribution by definition.
    if (a.category === null) continue;
    const status = paymentStatusById.get(a.paymentId);
    if (status === "paid") {
      clearedByCategory.set(
        a.category,
        (clearedByCategory.get(a.category) ?? 0) + a.allocatedAmount,
      );
    } else if (status === "pending" || status === "pending_clearance") {
      pendingByCategory.set(
        a.category,
        (pendingByCategory.get(a.category) ?? 0) + a.allocatedAmount,
      );
    }
  }
  // Fallback for legacy payments predating the allocations table (or mock
  // stores without derived allocations): the payment-row category, only
  // when NO allocation row exists for that payment.
  const paymentsWithAllocations = new Set(allocations.map((a) => a.paymentId));
  for (const p of payments) {
    if (paymentsWithAllocations.has(p.id)) continue;
    if (p.category === null) continue; // multi-service rows have allocations
    if (p.status === "paid") {
      clearedByCategory.set(
        p.category,
        (clearedByCategory.get(p.category) ?? 0) + p.amount,
      );
    } else if (p.status === "pending" || p.status === "pending_clearance") {
      pendingByCategory.set(
        p.category,
        (pendingByCategory.get(p.category) ?? 0) + p.amount,
      );
    }
  }

  return categories
    .map(({ key, label }) => {
      const catInsts = installments.filter((i) => i.category === key);

      const totalBilled = catInsts.reduce((s, i) => s + i.amountDue, 0);
      const totalCleared = clearedByCategory.get(key) ?? 0;
      const totalPending = pendingByCategory.get(key) ?? 0;

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
 *
 * T-411: tranche rates group by the canonical `trancheNumber` (DATA-023);
 * the 30-day forecast is the honest sum of (a) overdue ≤ 30 j outstanding +
 * (b) INV-4 remaining of tranches due within 30 days — NO recovery factor
 * (FA-07). The operating flow EXCLUDES payroll (salary_payments never
 * enters ledger_entries) — the radar labels this explicitly (FA-08).
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

  // Honest 30-day inflow forecast (FA-07 — the ×0.85 factor is REMOVED):
  // (a) outstanding on debt already overdue by ≤ 30 days (the §15 stream's
  //     daysOverdue; 0 = not yet due → belongs to (b) when due within 30 d);
  // (b) the INV-4 remaining of not-yet-due tranches falling due within the
  //     next 30 days.
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const overdueOutstanding30d = debtSummaries
    .filter((d) => d.daysOverdue > 0 && d.daysOverdue <= 30)
    .reduce((s, d) => s + d.outstandingAmount, 0);
  const upcomingDue30d = installments
    .filter((i) => i.status !== "paid")
    .filter((i) => {
      const due = new Date(i.dueDate).getTime();
      return due >= now && due < now + thirtyDaysMs;
    })
    .reduce((s, i) => s + installmentRemaining(i), 0);
  const expectedInflow30d = Math.round(overdueOutstanding30d + upcomingDue30d);

  // Tranche collection rates (T1, T2, T3) — the canonical `trancheNumber`
  // grouping (T-354/DASH-404), NEVER the label text.
  const computeTrancheRate = (wave: 1 | 2 | 3) => {
    const tInsts = installments.filter((i) => i.trancheNumber === wave);
    const due = tInsts.reduce((s, i) => s + i.amountDue, 0);
    const paid = tInsts.reduce((s, i) => s + i.amountPaid, 0);
    return due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;
  };

  return {
    totalClearedInflow,
    totalDisbursedOutflow,
    netOperatingCashFlow,
    bankFloatPending,
    expectedInflow30d,
    t1CollectionRate: computeTrancheRate(1),
    t2CollectionRate: computeTrancheRate(2),
    t3CollectionRate: computeTrancheRate(3),
  };
}
