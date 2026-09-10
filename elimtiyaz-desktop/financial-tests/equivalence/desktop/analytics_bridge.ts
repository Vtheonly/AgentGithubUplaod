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
 */
import type { Payment, PaymentCategory, PaymentMethod } from "../../../src/domain/model/payment";
import {
  derivePaymentStats,
  deriveAmountHistogram,
  deriveCategoryMix,
  deriveMethodMix,
  derivePareto,
  deriveAgingComposition,
} from "../../../src/features/dashboard/components/analytics/analytics-derivations";
import { daysBetweenFloor } from "../../../src/domain/calc/shared/dates";
import { agingBucketFromDays } from "../../../src/domain/calc/payment/queries";
import type { DebtByAgingBucket } from "../../../src/domain/model/operations";

export { derivePaymentStats, deriveAmountHistogram, deriveCategoryMix, deriveMethodMix, derivePareto, deriveAgingComposition };
export { daysBetweenFloor as daysBetweenFloorFor, agingBucketFromDays as agingBucketFor };

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
// PARITY-003 / T-292 — the visual-parity derivations (5 new families).
// Same extraction discipline as deriveRecoveryFunnel above: the pure bodies
// are taken VERBATIM from their desktop sources so the corpus exercises the
// SAME code the desktop renders.
// ============================================================================

import {
  deriveCollectionHeatmap,
  deriveYearOverYear,
} from "../../../src/features/dashboard/components/analytics/analytics-derivations";

export { deriveCollectionHeatmap, deriveYearOverYear };

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

// ── Tranche waves (installment-schedule-tab.tsx — pure bodies, T-248) ──────

/**
 * Tranche-number matcher — VERBATIM extraction from
 * `src/features/financials/installment-schedule-tab.tsx`:
 * /^\\s*Tranche\\s*([1-3])\\b/i — "Tranche 1"/"Tranche 2 (Jan–Mar)" match,
 * "Année complète"/"Tranche 10" do not.
 */
export function trancheNumberOfFor(label: string): 1 | 2 | 3 | null {
  const m = /^\s*Tranche\s*([1-3])\b/i.exec(label);
  return m ? (Number(m[1]) as 1 | 2 | 3) : null;
}

export interface TrancheWaveBridge {
  index: 1 | 2 | 3;
  label: string;
  hint: string;
  due: number;
  paid: number;
  pending: number;
  pct: number;
  isNextTarget: boolean;
}

/**
 * Tranche waves — VERBATIM extraction from installment-schedule-tab.tsx:
 * per wave due (Σ amountDue), paid (Σ amountPaid — INCLUDES uncleared
 * checks, the display convention), pending (Σ amountPending),
 * pct = min(100, round(paid/due×100)); isNextTarget = the first wave with
 * a canonical remaining balance (Σdue − Σpaid − Σpending > 0).
 */
export function deriveTrancheWavesFor(
  rows: readonly { label: string; amountDue: number; amountPaid: number; amountPending: number }[],
): TrancheWaveBridge[] {
  const groups = new Map<1 | 2 | 3, { label: string; amountDue: number; amountPaid: number; amountPending: number }[]>();
  for (const r of rows) {
    const n = trancheNumberOfFor(r.label);
    if (n === null) continue;
    const list = groups.get(n) ?? [];
    list.push(r);
    groups.set(n, list);
  }
  const totalOutstanding = (list: { amountDue: number; amountPaid: number; amountPending: number }[]) =>
    Math.max(0, list.reduce((s, i) => s + i.amountDue, 0) - list.reduce((s, i) => s + i.amountPaid, 0) - list.reduce((s, i) => s + i.amountPending, 0));
  const firstWithRemaining = Array.from(groups.entries())
    .filter(([, list]) => totalOutstanding(list) > 0)
    .map(([n]) => n)
    .sort((a, b) => a - b)[0];
  const TRANCHE_WAVE_META: ReadonlyArray<{ index: 1 | 2 | 3; label: string; hint: string }> = [
    { index: 1, label: "Tranche 1 (Septembre)", hint: "échéance 15 sep — à l'inscription" },
    { index: 2, label: "Tranche 2 (Décembre)", hint: "échéance 15 déc" },
    { index: 3, label: "Tranche 3 (Mars)", hint: "échéance 15 mars" },
  ];
  return TRANCHE_WAVE_META.map(({ index, label, hint }) => {
    const list = groups.get(index) ?? [];
    const due = list.reduce((s, i) => s + i.amountDue, 0);
    const paid = list.reduce((s, i) => s + i.amountPaid, 0);
    const pending = list.reduce((s, i) => s + i.amountPending, 0);
    const pct = due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;
    return { index, label, hint, due, paid, pending, pct, isNextTarget: index === firstWithRemaining };
  });
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
  capacity: DemographicSliceBridge[];
}

/**
 * Demographics — VERBATIM extraction of the pure aggregation from
 * `src/infrastructure/supabase/repositories/supabase-dashboard-repository.ts`
 * demographics(): grade from the student's CLASS (GRADE_LEVEL_LABELS_FR →
 * class name → "Non assigné"), gender (Garçons/Filles/Non spécifié only
 * when > 0), age buckets (< 6 / 6–8 / 9–11 / 12–14 / 15–17 / 18+ ans,
 * year-only arithmetic), capacity (cap ≤ 0/null → 30,
 * percent = round(count/cap×100)). totalStudents = students.length || 1.
 */
export function deriveDemographicsFor(
  students: readonly { gender: string; birthDate?: string | null; classId?: string | null }[],
  classes: readonly { id: string; name: string; gradeCode?: string | null; capacity?: number | null }[],
  currentYear: number,
): DemographicsBridge {
  const totalStudents = students.length || 1;

  const classMap = new Map(
    classes.map((c) => [
      c.id,
      { name: c.name ?? c.id, grade_code: c.gradeCode ?? null, capacity: c.capacity && c.capacity > 0 ? c.capacity : 30 },
    ] as const),
  );
  const classStudentCounts = new Map<string, number>();
  for (const s of students) {
    if (s.classId) {
      classStudentCounts.set(s.classId, (classStudentCounts.get(s.classId) ?? 0) + 1);
    }
  }

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

  // Capacity distribution
  const capacity = classes.map((c) => {
    const count = classStudentCounts.get(c.id) ?? 0;
    const cap = c.capacity && c.capacity > 0 ? c.capacity : 30;
    return { label: c.name ?? c.id, count, percent: Math.round((count / cap) * 100) };
  });

  return { grade, gender, age, capacity };
}
