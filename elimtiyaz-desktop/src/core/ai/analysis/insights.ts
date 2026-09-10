// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/analysis/insights.ts
// ============================================================================
/**
 * Composite insight builders (T-273/T-276, 42nd session — AI-311b/e).
 *
 * These functions compose CANONICAL outputs into decision-grade insight:
 * anomaly detection (payments / attendance / grades), class comparison,
 * collection-campaign prioritization, intervention risk scoring, and
 * payment-plan construction.
 *
 * SCOPE DISCIPLINE (ADR-016 §2): every input is a canonical read-side
 * stream (repository observables, canonical engine outputs). Scores and
 * tiers are HEURISTIC ENRICHMENT documented here — they rank and explain,
 * they never mutate anything and never replace a canonical business rule
 * (the waterfall, the overdue rule, the promotion rule stay canonical).
 */

import type { AttendanceRecord } from "../../../domain/model/academic";
import type { Assessment } from "../../../domain/model/academic";
import type { Payment } from "../../../domain/model/payment";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";
import {
  computeDescriptiveStats,
  type DescriptiveStats,
} from "./statistics";

/* ------------------------------------------------------------------ */
/*  1. Payment anomalies (dispute / fraud / entry-error lens)           */
/* ------------------------------------------------------------------ */

export interface PaymentAnomaly {
  readonly paymentId: string;
  readonly receiptNumber: string;
  readonly parentId: string;
  readonly amount: number;
  readonly collectedAt: string;
  readonly kind: "amount_outlier_high" | "amount_outlier_low";
  readonly zScore: number;
  readonly explanation: string;
}

export interface PaymentAnomalyReport {
  readonly stats: DescriptiveStats;
  readonly anomalies: readonly PaymentAnomaly[];
  readonly normalRange: readonly [number, number] | null;
  readonly screened: number;
}

/**
 * Screen a parent's payment trail for amount outliers (Tukey fences).
 * Duplicated-receipt / same-day double-payment patterns are ALSO flagged
 * (the DATA-005 dispute class) — kind is additive, never exclusive.
 */
export function detectPaymentAnomalies(
  payments: readonly Payment[],
  parents: readonly Pick<Parent, "id" | "displayName" | "firstName" | "lastName">[],
): PaymentAnomalyReport {
  const stats = computeDescriptiveStats(payments.map((p) => p.amount), 0);
  const byId = new Map(parents.map((p) => [p.id, p]));

  const anomalies: PaymentAnomaly[] = [];
  if (stats.q1 !== null && stats.q3 !== null && stats.iqr !== null) {
    const lo = stats.q1 - 1.5 * stats.iqr;
    const hi = stats.q3 + 1.5 * stats.iqr;
    for (const p of payments) {
      const z = stats.stddev && stats.stddev > 0 && stats.mean !== null
        ? Number(((p.amount - stats.mean) / stats.stddev).toFixed(2))
        : 0;
      if (p.amount > hi) {
        anomalies.push({
          paymentId: p.id,
          receiptNumber: p.receiptNumber,
          parentId: p.parentId,
          amount: p.amount,
          collectedAt: p.collectedAt,
          kind: "amount_outlier_high",
          zScore: z,
          explanation: `Montant ${(p.amount / 1000).toFixed(0)}k DZD au-dessus de la borne haute (${(hi / 1000).toFixed(0)}k) — vérifier une saisie multiple de tranches ou une erreur de saisie.`,
        });
      } else if (p.amount < lo) {
        anomalies.push({
          paymentId: p.id,
          receiptNumber: p.receiptNumber,
          parentId: p.parentId,
          amount: p.amount,
          collectedAt: p.collectedAt,
          kind: "amount_outlier_low",
          zScore: z,
          explanation: `Montant atypiquement bas (${p.amount} DZD) — possible acompte ou frais annexes isolés.`,
        });
      }
    }
  }

  // Same-day double payments by the same parent (the dispute-resolution
  // pattern get_payment_history exists for). Names resolve in the tool
  // layer via parentDisplayName (DATA-005 rule).
  const byDay = new Map<string, Payment[]>();
  for (const p of payments) {
    const key = `${p.parentId}|${p.collectedAt.slice(0, 10)}`;
    const list = byDay.get(key) ?? [];
    list.push(p);
    byDay.set(key, list);
  }
  const seen = new Set(anomalies.map((a) => a.paymentId));
  for (const [key, list] of byDay) {
    if (list.length < 2) continue;
    const parentId = key.split("|")[0];
    const total = list.reduce((s, p) => s + p.amount, 0);
    for (const p of list) {
      if (seen.has(p.id)) continue;
      anomalies.push({
        paymentId: p.id,
        receiptNumber: p.receiptNumber,
        parentId,
        amount: p.amount,
        collectedAt: p.collectedAt,
        kind: "amount_outlier_high",
        zScore: 0,
        explanation: `${list.length} paiements le même jour (total ${total.toLocaleString("fr-FR")} DZD) — pattern à vérifier en cas de contestation.`,
      });
    }
  }
  void byId;

  return {
    stats,
    anomalies: anomalies.slice(0, 20),
    normalRange:
      stats.q1 !== null && stats.q3 !== null && stats.iqr !== null
        ? [Number((stats.q1 - 1.5 * stats.iqr).toFixed(0)), Number((stats.q3 + 1.5 * stats.iqr).toFixed(0))]
        : null,
    screened: payments.length,
  };
}

/* ------------------------------------------------------------------ */
/*  2. Attendance anomalies (décrochage lens)                           */
/* ------------------------------------------------------------------ */

export interface AttendanceAnomaly {
  readonly studentId: string;
  readonly studentName: string;
  readonly attendanceRate: number;
  readonly unexcusedAbsences: number;
  readonly classRate: number | null;
  readonly deviation: number | null;
  readonly explanation: string;
}

export interface StudentAttendanceInput {
  readonly student: Pick<Student, "id" | "firstName" | "lastName" | "displayName" | "classId">;
  readonly records: readonly AttendanceRecord[];
}

/**
 * Flag students whose attendance rate deviates from the cohort mean by
 * more than 1.5σ (or an absolute floor: rate < 85% with ≥2 unexcused
 * absences). The rate itself comes from the CANONICAL
 * `calculateAttendanceRate` (applied by the tool layer before calling).
 */
export function detectAttendanceAnomalies(
  cohort: readonly StudentAttendanceInput[],
): AttendanceAnomaly[] {
  const rates = cohort.map((c) => c.records.length > 0 ? attendanceRateOf(c.records) : null);
  const valid = rates.filter((r): r is number => r !== null);
  const stats = computeDescriptiveStats(valid, 3);
  const sigma = stats.stddev ?? 0;
  const mean = stats.mean ?? null;

  const out: AttendanceAnomaly[] = [];
  cohort.forEach((c, i) => {
    const rate = rates[i];
    if (rate === null) return;
    const unexcused = c.records.filter((r) => r.status === "absent_unexcused").length;
    const dev = mean !== null ? rate - mean : null;
    const sigFlag = sigma > 0 && dev !== null && Math.abs(dev) > 1.5 * sigma && dev < 0;
    const absFlag = rate < 0.85 && unexcused >= 2;
    if (!sigFlag && !absFlag) return;
    out.push({
      studentId: c.student.id,
      studentName:
        c.student.displayName ?? `${c.student.firstName} ${c.student.lastName}`,
      attendanceRate: rate,
      unexcusedAbsences: unexcused,
      classRate: mean,
      deviation: dev !== null ? Number(dev.toFixed(3)) : null,
      explanation: sigFlag
        ? `Taux ${(rate * 100).toFixed(0)}% vs moyenne de cohorte ${(mean !== null ? mean * 100 : 0).toFixed(0)}% (écart > 1,5σ) — décrochage probable.`
        : `Taux ${(rate * 100).toFixed(0)}% < 85% avec ${unexcused} absences non excusées — suivi requis.`,
    });
  });
  return out.slice(0, 20);
}

/** The canonical attendance rate formula (present+late / total) — see domain/model/academic. */
function attendanceRateOf(records: readonly AttendanceRecord[]): number {
  if (records.length === 0) return 1;
  const favorable = records.filter((r) => r.status === "present" || r.status === "late").length;
  return Number((favorable / records.length).toFixed(3));
}

/* ------------------------------------------------------------------ */
/*  3. Grade collapse detection (per student vs own baseline)          */
/* ------------------------------------------------------------------ */

export interface GradeAnomaly {
  readonly studentId: string;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly subjectAverage: number;
  readonly studentBaseline: number | null;
  readonly gap: number | null;
  readonly explanation: string;
}

/**
 * Flag subject averages collapsing ≥ 4 points below the student's own
 * mean across subjects (intra-student, the pedagogically meaningful
 * comparison — NOT a cross-student ranking).
 */
export function detectGradeAnomalies(
  perStudent: readonly {
    studentId: string;
    assessments: readonly Pick<Assessment, "subjectId" | "subjectAverage">[];
  }[],
  subjects: readonly { id: string; name: string }[],
): GradeAnomaly[] {
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;
  const out: GradeAnomaly[] = [];
  for (const { studentId, assessments } of perStudent) {
    const entries = assessments
      .filter((a) => typeof a.subjectAverage === "number" && Number.isFinite(a.subjectAverage))
      .map((a) => ({ subjectId: a.subjectId, value: a.subjectAverage as number }));
    if (entries.length < 3) continue; // need a baseline
    const baseline = entries.reduce((s, e) => s + e.value, 0) / entries.length;
    for (const e of entries) {
      const gap = e.value - baseline;
      if (gap <= -4) {
        out.push({
          studentId,
          subjectId: e.subjectId,
          subjectName: subjectName(e.subjectId),
          subjectAverage: Number(e.value.toFixed(2)),
          studentBaseline: Number(baseline.toFixed(2)),
          gap: Number(gap.toFixed(2)),
          explanation: `${subjectName(e.subjectId)} à ${e.value.toFixed(1)}/20 vs moyenne personnelle ${baseline.toFixed(1)}/20 (−${Math.abs(gap).toFixed(1)} pts) — effondrement ciblé, pas un profil globalement faible.`,
        });
      }
    }
  }
  return out.slice(0, 20);
}

/* ------------------------------------------------------------------ */
/*  4. Class comparison (pedagogical benchmarking)                     */
/* ------------------------------------------------------------------ */

export interface ClassPerformanceRow {
  readonly classId: string;
  readonly className: string;
  readonly classCode: string;
  readonly level: string;
  readonly studentCount: number;
  readonly evaluated: number;
  readonly average: number | null;
  readonly median: number | null;
  readonly spread: number | null;
  readonly passRate: number | null;
  readonly atRiskCount: number;
}

/**
 * Cross-class comparison table. GPA per student is computed by the CANONICAL
 * `evaluateStudentTermPerformance` (tool layer); this function only
 * aggregates + ranks. `ranking` orders by average (desc), ties by pass rate.
 */
export function compareClassPerformance(
  rows: readonly ClassPerformanceRow[],
): { ranking: readonly ClassPerformanceRow[]; best: ClassPerformanceRow | null; weakest: ClassPerformanceRow | null; dispersionNote: string } {
  const ranked = [...rows].sort((a, b) => {
    const av = a.average ?? -1;
    const bv = b.average ?? -1;
    if (bv !== av) return bv - av;
    return (b.passRate ?? -1) - (a.passRate ?? -1);
  });
  const best = ranked[0] ?? null;
  const weakest = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const validSpreads = rows.map((r) => r.spread).filter((s): s is number => s !== null);
  const avgSpread =
    validSpreads.length > 0
      ? Number((validSpreads.reduce((s, v) => s + v, 0) / validSpreads.length).toFixed(2))
      : null;
  const mostDispersed = [...rows]
    .filter((r) => r.spread !== null)
    .sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0))[0] ?? null;
  return {
    ranking: ranked,
    best,
    weakest,
    dispersionNote:
      mostDispersed && avgSpread !== null
        ? `Dispersion moyenne ${avgSpread} pts ; la plus hétérogène : ${mostDispersed.className} (${mostDispersed.spread} pts entre médiane et quartiles) — classe à groupes de niveau marqués.`
        : "Dispersion non calculable (classes sans évaluations suffisantes).",
  };
}

/* ------------------------------------------------------------------ */
/*  5. Collection campaign scoring (the #1 business concern)           */
/* ------------------------------------------------------------------ */

export type CollectionStrategy = "amount_first" | "aging_first" | "balanced";

export interface DebtorInput {
  readonly parentId: string;
  readonly parentName: string;
  readonly parentPhone: string | null;
  readonly studentCount: number;
  readonly outstandingAmount: number;
  readonly daysOverdue: number;
  readonly bucket: string;
}

export interface PrioritizedDebtor extends DebtorInput {
  readonly priority: "P1" | "P2" | "P3";
  readonly score: number;
  readonly recommendedAction: string;
  readonly rationale: string;
}

/**
 * Prioritize debtors for a collection campaign.
 *
 * Scoring (0–100, heuristic, documented in ADR-016 §4):
 *   - amount_first : 70% amount percentile + 30% aging
 *   - aging_first  : 70% aging + 30% amount percentile
 *   - balanced     : 50/50
 * Tiers: P1 ≥ 70, P2 ≥ 40, else P3.
 */
export function prioritizeDebtors(
  debtors: readonly DebtorInput[],
  strategy: CollectionStrategy,
): PrioritizedDebtor[] {
  if (debtors.length === 0) return [];
  const amounts = [...debtors].sort((a, b) => a.outstandingAmount - b.outstandingAmount);
  const amountRank = new Map<string, number>(); // percentile 0..1
  amounts.forEach((d, i) => amountRank.set(d.parentId, debtors.length === 1 ? 1 : i / (debtors.length - 1)));

  const maxDays = Math.max(...debtors.map((d) => d.daysOverdue), 1);
  const weights =
    strategy === "amount_first"
      ? { amount: 0.7, aging: 0.3 }
      : strategy === "aging_first"
        ? { amount: 0.3, aging: 0.7 }
        : { amount: 0.5, aging: 0.5 };

  const prioritized = debtors.map((d) => {
    const amountPct = amountRank.get(d.parentId) ?? 0;
    const agingPct = Math.min(1, d.daysOverdue / maxDays);
    const score = Math.round(100 * (weights.amount * amountPct + weights.aging * agingPct));
    const priority: PrioritizedDebtor["priority"] = score >= 70 ? "P1" : score >= 40 ? "P2" : "P3";
    const recommendedAction =
      priority === "P1"
        ? d.daysOverdue > 90
          ? "Appel téléphonique direct + lettre officielle (proposition de plan de paiement)"
          : "Appel téléphonique cette semaine"
        : priority === "P2"
          ? "Rappel écrit (SMS/notification) puis appel si sans effet sous 7 jours"
          : "Rappel automatique (notification)";
    return {
      ...d,
      priority,
      score,
      recommendedAction,
      rationale: `${d.outstandingAmount.toLocaleString("fr-FR")} DZD dus, ${d.daysOverdue} j de retard (${d.bucket}) — score ${score}/100 [${strategy}].`,
    };
  });

  return prioritized.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/*  6. Intervention risk scoring (pedagogical early warning)           */
/* ------------------------------------------------------------------ */

export interface InterventionCandidate {
  readonly studentId: string;
  readonly studentName: string;
  readonly classId: string | null;
  readonly gpa: number | null;
  readonly isPassing: boolean | null;
  readonly attendanceRate: number | null;
  readonly unexcusedAbsences: number;
  readonly missingAssessments: number;
  readonly riskScore: number;
  readonly riskLevel: "critical" | "high" | "moderate" | "watch";
  readonly drivers: readonly string[];
  readonly recommendedActions: readonly string[];
}

/**
 * Composite early-warning score (0–100, heuristic — ADR-016 §5):
 *   - academic  : up to 45 (GPA distance below 10/20, scaled)
 *   - attendance: up to 35 (unexcused absences + rate below 85%)
 *   - data gaps : up to 20 (missing assessments obscure the true level)
 * Levels: critical ≥ 75, high ≥ 55, moderate ≥ 35, else watch.
 */
export function scoreInterventionRisk(candidates: readonly {
  student: Pick<Student, "id" | "firstName" | "lastName" | "displayName" | "classId">;
  gpa: number | null;
  isPassing: boolean | null;
  attendanceRate: number | null;
  unexcusedAbsences: number;
  missingAssessments: number;
}[]): InterventionCandidate[] {
  const out: InterventionCandidate[] = [];
  for (const c of candidates) {
    const drivers: string[] = [];
    const actions: string[] = [];

    // Academic leg (45)
    let academic = 0;
    if (c.gpa !== null) {
      if (c.gpa < 10) {
        academic = Math.min(45, Math.round((10 - c.gpa) * 9));
        drivers.push(`moyenne ${c.gpa.toFixed(1)}/20 (< 10)`);
        actions.push("Entretien pédagogique avec l'élève et propositions de soutien ciblé");
      } else if (c.gpa < 12) {
        academic = 8;
        drivers.push(`moyenne ${c.gpa.toFixed(1)}/20 juste au-dessus du seuil`);
      }
    } else {
      academic = 10;
      drivers.push("moyenne non évaluable (aucune note)");
    }

    // Attendance leg (35)
    let attendance = 0;
    if (c.attendanceRate !== null && c.attendanceRate < 0.85) {
      attendance += Math.min(20, Math.round((0.85 - c.attendanceRate) * 100));
      drivers.push(`assiduité ${(c.attendanceRate * 100).toFixed(0)}% (< 85%)`);
    }
    if (c.unexcusedAbsences > 0) {
      attendance += Math.min(15, c.unexcusedAbsences * 2);
      drivers.push(`${c.unexcusedAbsences} absences non excusées`);
    }
    if (c.attendanceRate !== null && c.attendanceRate < 0.85 && c.unexcusedAbsences >= 4) {
      actions.push("Contacter la famille (le décrochage précède souvent l'échec scolaire)");
    }

    // Data-gap leg (20)
    let gaps = 0;
    if (c.missingAssessments > 0) {
      gaps = Math.min(20, c.missingAssessments * 4);
      drivers.push(`${c.missingAssessments} évaluations manquantes`);
      actions.push("Rattrapage des évaluations manquantes (le bulletin est incomplet)");
    }
    if (actions.length === 0 && academic + attendance > 30) {
      actions.push("Surveillance rapprochée sur les prochaines évaluations");
    }

    const riskScore = Math.min(100, academic + attendance + gaps);
    const riskLevel: InterventionCandidate["riskLevel"] =
      riskScore >= 75 ? "critical" : riskScore >= 55 ? "high" : riskScore >= 35 ? "moderate" : "watch";

    out.push({
      studentId: c.student.id,
      studentName:
        c.student.displayName ?? `${c.student.firstName} ${c.student.lastName}`,
      classId: c.student.classId ?? null,
      gpa: c.gpa,
      isPassing: c.isPassing,
      attendanceRate: c.attendanceRate,
      unexcusedAbsences: c.unexcusedAbsences,
      missingAssessments: c.missingAssessments,
      riskScore,
      riskLevel,
      drivers,
      recommendedActions: actions,
    });
  }
  return out
    .filter((c) => c.riskScore >= 20) // below 20 = noise, not actionable
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 15);
}

/* ------------------------------------------------------------------ */
/*  7. Payment plan construction (advisory schedule builder)           */
/* ------------------------------------------------------------------ */

export interface PaymentPlanRow {
  readonly installmentNumber: number;
  readonly dueDate: string; // ISO date
  readonly amount: number;
  readonly cumulative: number;
}

export interface PaymentPlan {
  readonly outstandingAmount: number;
  readonly months: number;
  readonly downPayment: number;
  readonly monthlyAmount: number;
  readonly schedule: readonly PaymentPlanRow[];
  readonly totalPlanned: number;
}

/**
 * Build an equal-installment plan over the REAL outstanding balance
 * (computed canonically by the tool layer — this function receives the
 * number, never re-derives it). The last row absorbs the rounding rest
 * so the plan sums EXACTLY to (outstanding − downPayment).
 */
export function buildPaymentPlan(
  outstandingAmount: number,
  months: number,
  startDate = new Date(),
  downPayment = 0,
): PaymentPlan {
  const cleanMonths = Math.max(1, Math.min(12, Math.round(months)));
  const cleanDown = Math.max(0, Math.min(outstandingAmount, Math.round(downPayment)));
  const remaining = Math.max(0, Math.round(outstandingAmount) - cleanDown);
  const base = Math.floor(remaining / cleanMonths);
  const rest = remaining - base * cleanMonths;

  const schedule: PaymentPlanRow[] = [];
  let cumulative = 0;
  for (let i = 1; i <= cleanMonths; i++) {
    const amount = i === cleanMonths ? base + rest : base;
    cumulative += amount;
    const due = new Date(startDate.getFullYear(), startDate.getMonth() + i, startDate.getDate());
    schedule.push({
      installmentNumber: i,
      dueDate: due.toISOString().slice(0, 10),
      amount,
      cumulative,
    });
  }

  return {
    outstandingAmount: Math.round(outstandingAmount),
    months: cleanMonths,
    downPayment: cleanDown,
    monthlyAmount: base,
    schedule,
    totalPlanned: cumulative + cleanDown,
  };
}
