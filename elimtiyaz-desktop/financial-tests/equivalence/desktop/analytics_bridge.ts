/**
 * analytics_bridge — the T-285 bridge between the cross-platform equivalence
 * desktop runner and the desktop's canonical analytics derivation layer.
 *
 * PARITY-002: the corpus op `deriveAnalyticsStats` must exercise the SAME
 * derivations the desktop Analytics tab renders. `analytics-derivations.ts`
 * is pure (no React) so it imports cleanly; `deriveRecoveryFunnel` lives in
 * a .tsx component file (recovery-funnel-card.tsx) whose module graph pulls
 * React/recharts — its PURE body is extracted verbatim here (source commit
 * b6fbbcd, T-257) with the chart palette reduced to the shape the runner
 * needs. `collectionRateFromTotals` mirrors insights-rail.tsx:59-61.
 *
 * T-339/T-341 (61st session, STATS-400): `deriveAmountHistogram` and
 * `deriveCollectionHeatmap` were REMOVED with the vanity statistics (the
 * owner's kill list) — the corpus ops no longer emit them, and the
 * executive-statistics derivations (the replacements) are re-exported
 * below for the NEW `deriveExecutiveStats` op.
 */
import type { Payment, PaymentCategory, PaymentMethod } from "../../../src/domain/model/payment";
import {
  derivePaymentStats,
  deriveCategoryMix,
  deriveMethodMix,
  derivePareto,
  deriveAgingComposition,
} from "../../../src/features/dashboard/components/analytics/analytics-derivations";
import { daysBetweenFloor } from "../../../src/domain/calc/shared/dates";
import { agingBucketFromDays } from "../../../src/domain/calc/payment/queries";
import type { DebtByAgingBucket } from "../../../src/domain/model/operations";

export { derivePaymentStats, deriveCategoryMix, deriveMethodMix, derivePareto, deriveAgingComposition };
export { daysBetweenFloor as daysBetweenFloorFor, agingBucketFromDays as agingBucketFor };

// T-341: the executive-statistics canonical derivations (pure TS — the
// corpus op `deriveExecutiveStats` exercises the SAME code the desktop
// Executive Command Center renders).
export {
  deriveTrancheWaves,
  deriveDiscountErosion,
  deriveDebtTriage,
  deriveFamilyConcentration,
  deriveTransportYield,
  deriveServiceYield,
  deriveEnrollmentDynamics,
  deriveTripleRiskSummary,
} from "../../../src/features/dashboard/components/analytics/executive-statistics";

// T-453 (T-447 mirror, PARITY-006 item 7): the canonical POOLED all-categories
// T1/T2/T3 derivation + the non-wave summary, imported AND re-exported to the
// corpus generator and the runner so the corpus pins them cross-platform (the
// standing T-447 follow-up: "the corpus executive_statistics regeneration").
// T-455 (PARITY-007 item 3): emptyPooledWave joins the imports — the
// re-extracted strip adapter needs the presentation slot factory IN SCOPE.
import {
  derivePooledTrancheWaves,
  deriveNonWaveSummary,
  emptyPooledWave,
} from "../../../src/domain/calc/payment/tranche-waves";
export { derivePooledTrancheWaves, deriveNonWaveSummary, emptyPooledWave };

/** CanonicalPayment (centimes) → desktop Payment (DZD) for the analytics slice. */
export function toAnalyticsPayment(p: {
  id: string;
  parentId: string;
  studentId?: string | null;
  amount: number;
  method: string;
  status: string;
  category: string;
  receiptNumber: string;
  installmentId?: string | null;
  collectedBy: string;
  collectedAt: string;
}): Payment {
  return {
    tenantId: "t1",
    id: p.id,
    receiptNumber: p.receiptNumber,
    parentId: p.parentId,
    studentId: p.studentId ?? null,
    amount: p.amount / 100,
    method: p.method as PaymentMethod,
    status: p.status as Payment["status"],
    category: p.category as PaymentCategory,
    installmentId: p.installmentId ?? null,
    proofUrl: null,
    notes: null,
    collectedBy: p.collectedBy,
    collectedAt: p.collectedAt,
    createdAt: p.collectedAt,
    updatedAt: p.collectedAt,
  };
}

export interface FunnelStage {
  name: string;
  count: number;
  rateFromPrevious: number;
}

/**
 * Recovery funnel stages — VERBATIM extraction of the pure derivation from
 * `src/features/dashboard/components/recovery-funnel-card.tsx` (b6fbbcd):
 * total overdue → ≤60 j → 61–90 j → >90 j, family counts from the aging
 * census buckets, each stage's share of the TOTAL (stage-1 base).
 */
export function deriveRecoveryFunnel(debtAging: readonly DebtByAgingBucket[]): FunnelStage[] {
  const byBucket = new Map(debtAging.map((b) => [b.bucket, b.debtorCount]));
  const total =
    (byBucket.get("0_30") ?? 0) +
    (byBucket.get("31_60") ?? 0) +
    (byBucket.get("61_90") ?? 0) +
    (byBucket.get("91_180") ?? 0) +
    (byBucket.get("180_plus") ?? 0);
  if (total === 0) return [];
  const pct = (n: number) => Math.round((n / total) * 100);
  return [
    { name: "En retard", count: total, rateFromPrevious: 100 },
    {
      name: "≤ 60 j",
      count: (byBucket.get("0_30") ?? 0) + (byBucket.get("31_60") ?? 0),
      rateFromPrevious: pct((byBucket.get("0_30") ?? 0) + (byBucket.get("31_60") ?? 0)),
    },
    {
      name: "61–90 j",
      count: byBucket.get("61_90") ?? 0,
      rateFromPrevious: pct(byBucket.get("61_90") ?? 0),
    },
    {
      name: "> 90 j",
      count: (byBucket.get("91_180") ?? 0) + (byBucket.get("180_plus") ?? 0),
      rateFromPrevious: pct((byBucket.get("91_180") ?? 0) + (byBucket.get("180_plus") ?? 0)),
    },
  ];
}

/**
 * The collection rate — VERBATIM extraction from
 * `src/features/dashboard/components/insights-rail.tsx` (the gauge):
 * encaissé / (encaissé + créances), Math.round'd, clamped to 100.
 */
export function collectionRateFromTotals(annualRevenue: number, outstanding: number): number {
  const totalExpected = annualRevenue + outstanding;
  if (totalExpected <= 0) return 0;
  return Math.min(100, Math.round((annualRevenue / totalExpected) * 100));
}

// ============================================================================
// PARITY-003 / T-292 — the visual-parity derivations.
// Same extraction discipline as deriveRecoveryFunnel above: the pure bodies
// are taken VERBATIM from their desktop sources so the corpus exercises the
// SAME code the desktop renders.
// ============================================================================

import {
  deriveYearOverYear,
} from "../../../src/features/dashboard/components/analytics/analytics-derivations";

export { deriveYearOverYear };

/** School week + bin constants re-exported for the runner/scenarios. */
export const SCHOOL_WEEK_ROWS_BRIDGE = [
  { key: "Dim", jsDay: 0 },
  { key: "Lun", jsDay: 1 },
  { key: "Mar", jsDay: 2 },
  { key: "Mer", jsDay: 3 },
  { key: "Jeu", jsDay: 4 },
] as const;

export interface WeeklyRhythmDatum {
  day: string;
  cash: number;
  check: number;
  transfer: number;
}

/**
 * Weekly operating rhythm — VERBATIM extraction of the pure derivation from
 * `src/features/dashboard/components/weekly-operating-rhythm.tsx` (T-243):
 * the Algerian school week (Dim→Jeu), counter-activity convention (ONLY
 * `status === "refunded"` excluded — pending/partial ARE counted), per-method
 * accumulation. Friday/Saturday payments are dropped.
 */
export function deriveWeeklyRhythmFor(
  payments: readonly Payment[],
  range?: { from: string; to: string },
): WeeklyRhythmDatum[] {
  const fromTs = range ? Date.parse(`${range.from}T00:00:00Z`) : null;
  const toTs = range ? Date.parse(`${range.to}T23:59:59Z`) : null;
  const cells = SCHOOL_WEEK_ROWS_BRIDGE.map(() => ({ cash: 0, check: 0, transfer: 0 }));
  for (const p of payments) {
    if (p.status === "refunded") continue;
    const ts = Date.parse(p.collectedAt);
    if (Number.isNaN(ts)) continue;
    if (fromTs !== null && ts < fromTs) continue;
    if (toTs !== null && ts > toTs) continue;
    const jsDay = new Date(ts).getUTCDay();
    const idx = SCHOOL_WEEK_ROWS_BRIDGE.findIndex((d) => d.jsDay === jsDay);
    if (idx === -1) continue; // Fri/Sat — outside the Algerian school week
    cells[idx][p.method] += p.amount;
  }
  return cells.map((c, i) => ({ day: SCHOOL_WEEK_ROWS_BRIDGE[i].key, ...c }));
}

// ── Tranche waves (installment-schedule-tab.tsx — the T-447 CURRENT adapter) ─

/**
 * T-455 (PARITY-007 item 3 — the harness-drift repair): this extraction is
 * RE-EXTRACTED from the CURRENT desktop production body. The previous
 * VERBATIM extraction (the T-248 pure body: label-regex grouping +
 * `pct = min(100, round(…))`) mirrored a body the desktop RETIRED in T-447
 * ("the last piece of wave math living in a feature file; it is retired") —
 * the corpus family `analytics_visuals.trancheWaves` was pinning semantics
 * NO desktop surface renders anymore (the §15.81 harness-drift class).
 *
 * The CURRENT `installment-schedule-tab.tsx` `deriveTrancheWaves` maps the
 * canonical `derivePooledTrancheWaves` rows (the SAME object the Statistics
 * main wave cards consume), adding only this surface's presentation
 * (label/hint/isNextTarget/tuitionPct). This extraction mirrors THAT
 * construction (one derivation, N presentations):
 *   - grouping by the CANONICAL `trancheNumber` column (never label parsing)
 *   - `pct` = the canonical PARITY-001 rate (round, NEVER clamped)
 *   - `remaining` = the INV-4 remaining over the wave's rows
 *   - `isOverdue` = any unsettled row's due date is past (T-427)
 *   - `dueDate`/`dueDateMax` = the wave's DERIVED due-date range (T-434/T-435)
 *   - `tuitionPct` = the tuition-isolated rate (T-432 — the same number the
 *     Statistics per-category breakdown carries)
 */
export function deriveTrancheWavesFor(
  rows: readonly {
    parentId: string;
    label: string;
    category: string;
    trancheNumber: number;
    amountDue: number;
    amountPaid: number;
    amountPending: number;
    dueDate: string;
    status: string;
  }[],
  nowEpochMs: number,
): TrancheWaveBridge[] {
  // The canonical domain Installment projection (DZD domain — the pooling
  // derivation consumes the desktop's own types).
  const installments = rows.map((r) => ({
    id: `bridge-${r.parentId}-${r.label}-${r.trancheNumber}`,
    parentId: r.parentId,
    studentId: null,
    category: r.category as never,
    label: r.label,
    trancheNumber: r.trancheNumber as 1 | 2 | 3,
    amountDue: r.amountDue,
    amountPaid: r.amountPaid,
    amountPending: r.amountPending,
    dueDate: r.dueDate,
    paidDate: null,
    status: r.status as never,
    academicCycle: undefined,
    paymentPlan: "tranches" as const,
    isCustomSchedule: false,
    customSchedule: false,
    customScheduleNote: null,
  }));
  const pooled = derivePooledTrancheWaves(installments, nowEpochMs);
  const byIndex = new Map(pooled.map((w) => [w.wave, w]));
  const firstWithRemaining = pooled
    .filter((w) => w.remainingTotal > 0)
    .map((w) => w.wave)
    .sort((a, b) => a - b)[0];
  const TRANCHE_WAVE_META: ReadonlyArray<{ index: 1 | 2 | 3; label: string; hint: string }> = [
    { index: 1, label: "Tranche 1 (Septembre)", hint: "échéance 15 sep" },
    { index: 2, label: "Tranche 2 (Décembre)", hint: "échéance 15 déc" },
    { index: 3, label: "Tranche 3 (Mars)", hint: "échéance 15 mars" },
  ];
  return TRANCHE_WAVE_META.map(({ index, label, hint }) => {
    const w = byIndex.get(index) ?? emptyPooledWave(index);
    const tuition = w.perCategory.find((c) => c.category === "tuition");
    const tuitionPct = tuition && tuition.dueTotal > 0 ? Math.round((tuition.paidTotal / tuition.dueTotal) * 100) : null;
    return {
      index,
      label,
      hint,
      dueDate: w.dueDateMin !== null ? new Date(w.dueDateMin).toISOString() : null,
      dueDateMax: w.dueDateMax !== null ? new Date(w.dueDateMax).toISOString() : null,
      isOverdue: w.anyUnsettledOverdue,
      due: w.dueTotal,
      paid: w.paidTotal,
      pending: w.pendingTotal,
      remaining: w.remainingTotal,
      pct: w.collectedPct,
      tuitionPct,
      isNextTarget: index === firstWithRemaining,
    };
  });
}

export interface TrancheWaveBridge {
  index: 1 | 2 | 3;
  label: string;
  hint: string;
  dueDate: string | null;
  dueDateMax: string | null;
  isOverdue: boolean;
  due: number;
  paid: number;
  pending: number;
  remaining: number;
  pct: number;
  tuitionPct: number | null;
  isNextTarget: boolean;
}

/**
 * T-455 — the FINANCE-STRIP TOTALS (the desktop tab's totals block mirror):
 * `sumInstallmentsDue` / `sumInstallmentsPaid` / `totalOutstanding` (the
 * canonical INV-4 family) + the T-426 dynamic-overdue count over the whole
 * selection (non-wave rows included — FI is billed money too).
 */
export function deriveTrancheStripTotalsFor(
  rows: readonly {
    parentId: string;
    label: string;
    category: string;
    trancheNumber: number;
    amountDue: number;
    amountPaid: number;
    amountPending: number;
    dueDate: string;
    status: string;
  }[],
  nowEpochMs: number,
): { totalDue: number; totalPaid: number; totalRemaining: number; overdueCount: number } {
  const installments = rows.map((r) => ({
    id: `bridge-${r.parentId}-${r.label}-${r.trancheNumber}`,
    parentId: r.parentId,
    studentId: null,
    category: r.category as never,
    label: r.label,
    trancheNumber: r.trancheNumber as 1 | 2 | 3,
    amountDue: r.amountDue,
    amountPaid: r.amountPaid,
    amountPending: r.amountPending,
    dueDate: r.dueDate,
    paidDate: null,
    status: r.status as never,
    academicCycle: undefined,
    paymentPlan: "tranches" as const,
    isCustomSchedule: false,
    customSchedule: false,
    customScheduleNote: null,
  }));
  const totalDue = installments.reduce((s, i) => s + i.amountDue, 0);
  const totalPaid = installments.reduce((s, i) => s + i.amountPaid, 0);
  const totalPending = installments.reduce((s, i) => s + i.amountPending, 0);
  const totalRemaining = Math.max(0, totalDue - totalPaid - totalPending);
  const overdueCount = installments.filter(
    (i) =>
      i.status !== "paid" &&
      Date.parse(i.dueDate) < nowEpochMs &&
      Math.max(0, i.amountDue - i.amountPaid - i.amountPending) > 0,
  ).length;
  return { totalDue, totalPaid, totalRemaining, overdueCount };
}

// ── Demographics (supabase-dashboard-repository.demographics — pure body) ──

import { GRADE_LEVEL_LABELS_FR } from "../../../src/domain/model/student";

export interface DemographicSliceBridge {
  label: string;
  count: number;
  percent: number;
}

export interface DemographicsBridge {
  grade: DemographicSliceBridge[];
  gender: DemographicSliceBridge[];
  age: DemographicSliceBridge[];
}

/**
 * Demographics — VERBATIM extraction of the pure aggregation from
 * `src/infrastructure/supabase/repositories/supabase-dashboard-repository.ts`
 * demographics(): grade from the student's CLASS (GRADE_LEVEL_LABELS_FR →
 * class name → "Non assigné"), gender (Garçons/Filles/Non spécifié only
 * when > 0), age buckets (< 6 / 6–8 / 9–11 / 12–14 / 15–17 / 18+ ans,
 * year-only arithmetic). totalStudents = students.length || 1.
 * T-339: the CAPACITY slice was REMOVED (no fake ceilings — STATS-400).
 */
export function deriveDemographicsFor(
  students: readonly { gender: string; birthDate?: string | null; classId?: string | null }[],
  classes: readonly { id: string; name: string; gradeCode?: string | null }[],
  currentYear: number,
): DemographicsBridge {
  const totalStudents = students.length || 1;

  const classMap = new Map(
    classes.map((c) => [
      c.id,
      { name: c.name ?? c.id, grade_code: c.gradeCode ?? null } as const,
    ]),
  );

  // Grade distribution (from the student's class)
  const gradeCounts = new Map<string, number>();
  for (const s of students) {
    const cls = s.classId ? classMap.get(s.classId) : null;
    let gradeKey = "Non assigné";
    if (cls) {
      if (cls.grade_code && cls.grade_code in GRADE_LEVEL_LABELS_FR) {
        gradeKey = GRADE_LEVEL_LABELS_FR[cls.grade_code as keyof typeof GRADE_LEVEL_LABELS_FR];
      } else {
        gradeKey = cls.name;
      }
    }
    gradeCounts.set(gradeKey, (gradeCounts.get(gradeKey) ?? 0) + 1);
  }
  const grade = Array.from(gradeCounts.entries()).map(([label, count]) => ({
    label,
    count,
    percent: Math.round((count / totalStudents) * 100),
  }));

  // Gender distribution
  let maleCount = 0;
  let femaleCount = 0;
  let unspecifiedCount = 0;
  for (const s of students) {
    if (s.gender === "male") maleCount++;
    else if (s.gender === "female") femaleCount++;
    else unspecifiedCount++;
  }
  const gender: DemographicSliceBridge[] = [
    { label: "Garçons", count: maleCount, percent: Math.round((maleCount / totalStudents) * 100) },
    { label: "Filles", count: femaleCount, percent: Math.round((femaleCount / totalStudents) * 100) },
  ];
  if (unspecifiedCount > 0) {
    gender.push({
      label: "Non spécifié",
      count: unspecifiedCount,
      percent: Math.round((unspecifiedCount / totalStudents) * 100),
    });
  }

  // Age distribution
  const ageBuckets = [
    { label: "< 6 ans", min: 0, max: 5, count: 0 },
    { label: "6–8 ans", min: 6, max: 8, count: 0 },
    { label: "9–11 ans", min: 9, max: 11, count: 0 },
    { label: "12–14 ans", min: 12, max: 14, count: 0 },
    { label: "15–17 ans", min: 15, max: 17, count: 0 },
    { label: "18+ ans", min: 18, max: 120, count: 0 },
  ];
  for (const s of students) {
    if (!s.birthDate) continue;
    const birthYear = new Date(s.birthDate).getFullYear();
    if (isNaN(birthYear)) continue;
    const ageYears = currentYear - birthYear;
    const bucket = ageBuckets.find((b) => ageYears >= b.min && ageYears <= b.max);
    if (bucket) bucket.count++;
  }
  const age = ageBuckets.map((b) => ({
    label: b.label,
    count: b.count,
    percent: Math.round((b.count / totalStudents) * 100),
  }));

  // T-339 (STATS-400): the capacity fill-rate slice was REMOVED — no fake
  // ceilings. The section-imbalance intelligence lives in the executive
  // statistics op (deriveExecutiveStats → deriveEnrollmentDynamics).

  return { grade, gender, age };
}
