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
