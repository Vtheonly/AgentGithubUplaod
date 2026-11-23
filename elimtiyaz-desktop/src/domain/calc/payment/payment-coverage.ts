/**
 * Payment coverage — the ONE canonical every-detail coverage view model.
 *
 * T-579 (ROADMAP 5.11 / EXECUTION-PLAN §4, the v2.3 every-detail expansion):
 * `buildPaymentCoverage(payment, allocations, installments, context?)` is the
 * shared builder behind the receipt PDF's AFFECTATION/COUVERTURE section, the
 * account-statement PDF's coverage sub-rows + totals, PaymentBreakdownCard's
 * family-situation block, and the payment modal's success stage. ONE builder —
 * the same payment produces the same coverage lines on every surface (the
 * T-330 cross-platform lockstep discipline).
 *
 * The ALLOCATION SOURCE stays the canonical precedence chain (T-330,
 * payment-breakdown-card.tsx): payment_allocations via
 * `repos.payments.allocationsForPayment` FIRST, the ledger receipt-number join
 * as FALLBACK, the payment's own category LAST RESORT. `resolvePaymentAllocations`
 * below is that chain, extracted — the card, the drawers, the tabs and the
 * modal all call it; nobody re-implements it.
 *
 * Totals semantics (INV-4 — Cleared Funds Only):
 *   - `paidNow`        this payment's amount.
 *   - `paidToDate`     the family's cumulative CLEARED payments (status
 *                      "paid"), this payment included — null when the caller
 *                      did not supply the family history (honest degradation:
 *                      the surface simply omits the row).
 *   - `totalGross`     "Prix" — Σ installments.amountDue (the commitment).
 *   - `totalJustified` "Prix justifié" — the net after discount
 *                      (installments are generated at their NET amount, so
 *                      absent an explicit discount this equals totalGross).
 *   - `remaining`      "Reste dû" — max(0, totalJustified − paidToDate); null
 *                      without family history. Never negative: an overpaid
 *                      family shows the excess via `excess`, not a negative
 *                      debt.
 *   - `excess`         this payment's overpayment vs expectedAmount
 *                      (payment.excessAmount when set, else derived — the
 *                      card's exact convention).
 *
 * Academic year (ADR-030): the payment's own `academicYearId` (payment-made
 * year) first, then the allocated installments' year, then the INV-14 date
 * fallback (`currentAcademicYear(collectedAt)`). The label resolves through
 * the provided AcademicYear list when the id is known.
 */
import type {
  Payment,
  PaymentAllocation,
  Installment,
  PaymentCategory,
} from "../../model/payment";
import { paymentCategoryLabelFr } from "../../model/payment";
import type { AcademicYear } from "../../model/academic";
import { currentAcademicYear } from "../../../core/format/date";
import type { LedgerRepository, PaymentRepository, InstallmentRepository } from "../../repository/repository";
import type { AcademicYearRepository } from "../../repository/academic-repository";

/** Tranche identity — from the installment's canonical `trancheNumber` (T-425: never label parsing). */
export type TrancheKey = "FI" | "T1" | "T2" | "T3" | "AUTRE";

export const TRANCHE_LABELS: Record<TrancheKey, string> = {
  FI: "Frais d'inscription (FI)",
  T1: "Tranche 1",
  T2: "Tranche 2",
  T3: "Tranche 3",
  AUTRE: "Autres lignes",
};

/** One coverage line — an allocation enriched with its installment identity. */
export interface PaymentCoverageLine {
  readonly key: string;
  readonly category: PaymentCategory | null;
  readonly label: string;
  readonly trancheKey: TrancheKey;
  readonly allocatedAmount: number;
}

export interface TrancheAgg {
  readonly key: TrancheKey;
  readonly label: string;
  readonly amount: number;
}

export interface CategoryAgg {
  readonly category: PaymentCategory | null;
  readonly label: string;
  readonly amount: number;
}

export interface PaymentCoverageTotals {
  readonly paidNow: number;
  readonly paidToDate: number | null;
  readonly totalGross: number;
  readonly totalJustified: number;
  readonly remaining: number | null;
  readonly expectedAmount: number;
  readonly excess: number;
}

export interface PaymentCoverage {
  readonly lines: readonly PaymentCoverageLine[];
  readonly byTranche: readonly TrancheAgg[];
  readonly byCategory: readonly CategoryAgg[];
  readonly totals: PaymentCoverageTotals;
  readonly academicYearLabel: string | null;
}

/** Optional context beyond the three core inputs (all additive). */
export interface PaymentCoverageContext {
  /** The family's FULL payment history — enables paidToDate + remaining. */
  readonly familyPayments?: readonly Payment[];
  /** The academic years list — resolves academicYearId → its code. */
  readonly academicYears?: readonly AcademicYear[];
  /** An explicit discount (e.g. the registration line-item's remise). */
  readonly discountAmount?: number;
}

/** The canonical tranche key of an installment (0=FI, 1..3=T1..T3, else AUTRE). */
export function trancheKeyOf(installment: Installment | undefined): TrancheKey {
  switch (installment?.trancheNumber) {
    case 0:
      return "FI";
    case 1:
      return "T1";
    case 2:
      return "T2";
    case 3:
      return "T3";
    default:
      return "AUTRE";
  }
}

/**
 * The ONE coverage builder. Pure — same inputs, same lines, every surface.
 * `allocations` come from the canonical chain (`resolvePaymentAllocations`);
 * an empty list means the legacy single-category payment (the chain's LAST
 * RESORT line is synthesized here exactly as the card renders it).
 */
export function buildPaymentCoverage(
  payment: Payment,
  allocations: readonly PaymentAllocation[],
  installments: readonly Installment[] = [],
  context: PaymentCoverageContext = {},
): PaymentCoverage {
  const installmentById = new Map(installments.map((i) => [i.id, i]));

  /* --- Coverage lines --- */
  const lines: PaymentCoverageLine[] =
    allocations.length > 0
      ? allocations.map((a) => {
          const inst = a.installmentId ? installmentById.get(a.installmentId) : undefined;
          return {
            key: a.id,
            category: a.category ?? inst?.category ?? null,
            label:
              a.label ??
              inst?.label ??
              (a.category ? paymentCategoryLabelFr(a.category) : "Multi-services"),
            trancheKey: trancheKeyOf(inst),
            allocatedAmount: a.allocatedAmount,
          };
        })
      : [
          {
            key: `${payment.id}-last-resort`,
            category: payment.category,
            label: payment.category ? paymentCategoryLabelFr(payment.category) : "Multi-services",
            trancheKey: "AUTRE",
            allocatedAmount: payment.amount,
          },
        ];

  /* --- Per-tranche aggregation (canonical order, non-zero only) --- */
  const trancheSums = new Map<TrancheKey, number>();
  for (const l of lines) {
    trancheSums.set(l.trancheKey, (trancheSums.get(l.trancheKey) ?? 0) + l.allocatedAmount);
  }
  const byTranche: TrancheAgg[] = (["FI", "T1", "T2", "T3", "AUTRE"] as const as TrancheKey[])
    .filter((k) => (trancheSums.get(k) ?? 0) > 0)
    .map((k) => ({ key: k, label: TRANCHE_LABELS[k], amount: trancheSums.get(k)! }));

  /* --- Per-category aggregation --- */
  const catSums = new Map<string, CategoryAgg>();
  for (const l of lines) {
    const key = l.category ?? "multi";
    const prev = catSums.get(key);
    if (prev) catSums.set(key, { ...prev, amount: prev.amount + l.allocatedAmount });
    else
      catSums.set(key, {
        category: l.category,
        label: l.category ? paymentCategoryLabelFr(l.category) : "Multi-services",
        amount: l.allocatedAmount,
      });
  }
  const byCategory = [...catSums.values()];

  /* --- Totals --- */
  const paidNow = payment.amount;
  const totalGross = installments.reduce((s, i) => s + i.amountDue, 0);
  const totalJustified = Math.max(0, totalGross - Math.max(0, context.discountAmount ?? 0));

  let paidToDate: number | null = null;
  let remaining: number | null = null;
  if (context.familyPayments) {
    const includesThis = context.familyPayments.some((p) => p.id === payment.id);
    paidToDate =
      context.familyPayments.reduce((s, p) => s + (p.status === "paid" ? p.amount : 0), 0) +
      (!includesThis && payment.status === "paid" ? payment.amount : 0);
    remaining = Math.max(0, totalJustified - paidToDate);
  }

  const expectedAmount = payment.expectedAmount ?? 0;
  const excess =
    payment.excessAmount ?? (expectedAmount > 0 ? Math.max(0, paidNow - expectedAmount) : 0);

  /* --- Academic year (ADR-030 precedence + the INV-14 date fallback) --- */
  const years = context.academicYears ?? [];
  let academicYearLabel: string | null = null;
  const yearId =
    payment.academicYearId ?? installments.find((i) => i.academicYearId)?.academicYearId ?? null;
  if (yearId) academicYearLabel = years.find((y) => y.id === yearId)?.code ?? null;
  if (!academicYearLabel) {
    academicYearLabel = currentAcademicYear(new Date(payment.collectedAt));
  }

  return {
    lines,
    byTranche,
    byCategory,
    totals: { paidNow, paidToDate, totalGross, totalJustified, remaining, expectedAmount, excess },
    academicYearLabel,
  };
}

/** The repository slice `resolvePaymentAllocations` needs (the app provider satisfies it). */
export interface CoverageRepositories {
  readonly payments: PaymentRepository;
  readonly ledger: LedgerRepository;
}

/**
 * The canonical allocation precedence chain (T-330, payment-breakdown-card
 * §47-87) — extracted so the card, the PDF call sites and the modal share
 * ONE implementation:
 *   1. PRIMARY   `payments.allocationsForPayment(payment.id)` — the
 *                server-side waterfall record (migration 0033).
 *   2. FALLBACK  the ledger receipt-number join (legacy payments / mock).
 *   3. LAST RESORT is NOT a fetch — `buildPaymentCoverage` synthesizes the
 *                single-category line when the chain yields nothing.
 */
export async function resolvePaymentAllocations(
  repos: CoverageRepositories,
  payment: Payment,
): Promise<readonly PaymentAllocation[]> {
  // 1. PRIMARY: the canonical table read (Supabase mode; the mock derives
  //    the same lines from its own ledger).
  if (typeof repos.payments.allocationsForPayment === "function") {
    const result = await repos.payments.allocationsForPayment(payment.id);
    if (result.ok && result.value.length > 0) return [...result.value];
  }
  // 2. FALLBACK: ledger entries for the parent filtered to this payment's
  //    receiptNumber (payment-type entries are allocations).
  try {
    const ledgerObs = repos.ledger.observeByParent(payment.parentId);
    const allEntries = typeof ledgerObs.get === "function" ? ledgerObs.get() : [];
    const matching = allEntries.filter(
      (e) => e.receiptNumber === payment.receiptNumber && e.type === "payment",
    );
    return matching.map((e) => ({
      id: `${payment.id}-${e.id}`,
      paymentId: payment.id,
      chargeId: null,
      installmentId: null,
      category: e.category,
      allocatedAmount: Math.abs(e.amount),
      label: (e.metadata?.field as string) ?? null,
      createdAt: e.at,
    }));
  } catch {
    return [];
  }
}

/**
 * Resolve allocations for MANY payments — the account-statement seam.
 * The `preloaded` snapshot (e.g. the `observeAllocations` observable's
 * current value) short-circuits the chain for the payments it covers; every
 * payment the snapshot does not cover resolves through the canonical chain
 * (`resolvePaymentAllocations`). Returns a map keyed by payment id — the
 * statement generator's `allocationsByPayment` input.
 */
export async function resolveAllocationsForPayments(
  repos: CoverageRepositories,
  payments: readonly Payment[],
  preloaded?: readonly PaymentAllocation[],
): Promise<ReadonlyMap<string, readonly PaymentAllocation[]>> {
  const byPayment = new Map<string, readonly PaymentAllocation[]>();
  const paymentIds = new Set(payments.map((p) => p.id));
  if (preloaded && preloaded.length > 0) {
    for (const a of preloaded) {
      if (!paymentIds.has(a.paymentId)) continue;
      const existing = byPayment.get(a.paymentId);
      if (existing) byPayment.set(a.paymentId, [...existing, a]);
      else byPayment.set(a.paymentId, [a]);
    }
  }
  const missing = payments.filter((p) => (byPayment.get(p.id)?.length ?? 0) === 0);
  const resolved = await Promise.all(
    missing.map(async (p) => [p.id, await resolvePaymentAllocations(repos, p)] as const),
  );
  for (const [id, allocs] of resolved) {
    if (allocs.length > 0) byPayment.set(id, allocs);
  }
  return byPayment;
}

/** The full repository slice for `resolvePaymentCoverage`. */
export interface FullCoverageRepositories extends CoverageRepositories {
  readonly installments: InstallmentRepository;
  readonly academicYears: AcademicYearRepository;
}

/**
 * Convenience: resolve the payment's full coverage in one call — allocations
 * via the canonical chain, the family's installments + payments + academic
 * years via their observables' current snapshot. The observables are already
 * warm in the app shell (the boot-storm gate loads them); a cold `get()` on a
 * live repository returns [] — the builder then degrades honestly (no
 * paid-to-date row), never fabricates.
 */
export function resolvePaymentCoverage(
  repos: FullCoverageRepositories,
  payment: Payment,
): Promise<PaymentCoverage> {
  return resolvePaymentAllocations(repos, payment).then((allocations) => {
    const installments = repos.installments.observeByParent(payment.parentId).get() ?? [];
    const familyPayments = repos.payments.observeByParent(payment.parentId).get() ?? [];
    const academicYears = repos.academicYears.observeAll().get() ?? [];
    return buildPaymentCoverage(payment, allocations, installments, {
      familyPayments,
      academicYears,
    });
  });
}
