// ============================================================================
// FILE: src/features/dashboard/components/analytics/executive-statistics.ts
// ============================================================================
/**
 * executive-statistics — the canonical derivation family for the
 * Executive Command Center (T-338, 61st session, 2026-09-14 — STATS-400).
 *
 * The owner's mandate: the dashboard must show OPERATIONAL decision
 * triggers, not passive vanity numbers. Every function below derives the
 * mandated intelligence from the canonical repository streams:
 *
 *   1. Tranche-wave collection velocity  — deriveTrancheWaves
 *   2. Discount erosion                  — deriveDiscountErosion
 *   3. Debt triage (chronic/transitory)  — deriveDebtTriage
 *   4. Family exposure concentration     — deriveFamilyExposure
 *   5. Transport route yield             — deriveTransportYield
 *   6. Specialized-service yield         — deriveServiceYield
 *   7. Enrollment dynamics + imbalance   — deriveEnrollmentDynamics
 *   8. Triple-risk summary               — deriveTripleRiskSummary
 *
 * DISCIPLINE (same as analytics-derivations.ts, T-255..T-257):
 *   - PURE transforms of the repository contracts — zero synthesis, zero
 *     hard-coded reference numbers (§15.16). Empty inputs → empty outputs
 *     → honest empty states.
 *   - Money values are integer DZD; every displayed ratio is
 *     `Math.round((part / total) * 100)` — the PARITY-001 pinned convention
 *     (integer division in a mirror silently truncates).
 *   - The per-installment remaining + per-day aging follow the INV-4
 *     canonical derivation (T-284/T-285): remaining =
 *     max(0, amountDue − amountPaid − amountPending) over unpaid
 *     installments; days overdue = floor((now − dueDate)/day) when the due
 *     date has passed, else 0.
 *   - This file is the DESKTOP CANONICAL implementation (ADR-002). The
 *     Android `core/StatisticsEngine.kt` mirror must stay byte-equivalent
 *     in semantics; the corpus category `executive_statistics` + the live
 *     SQL truth script (scripts/verify_t-338.sql) pin both.
 */

import type { Installment, Payment, PaymentCategory } from "../../../../domain/model/payment";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import type { Student } from "../../../../domain/model/student";
import type { Parent } from "../../../../domain/model/parent";
import type { AcademicClass } from "../../../../domain/model/academic";
import { parentDisplayName } from "../../../../domain/model/parent";
import { normalizeTransportTier } from "../../../../domain/calc/pricing/transport";
import type { TransportDestination } from "../../../../domain/model/parent";
import type { StudentRiskProfile } from "./operational-query-engine";

// ============================================================================
// Shared helpers
// ============================================================================

/** Milliseconds in one UTC day. */
const DAY_MS = 86_400_000;

/**
 * Parse an ISO date (yyyy-mm-dd or full timestamp) into a UTC timestamp;
 * null when invalid. Same convention as analytics-derivations.ts.
 */
function tsOf(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length > 10 ? iso : `${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Whole days between two epoch-ms values, floored toward zero (the
 * T-284/T-285 `daysBetweenFloor` convention — a tranche due TODAY is 0
 * days overdue, never 1).
 */
export function daysBetweenFloor(earlierIso: string, laterEpochMs: number): number {
  const earlier = tsOf(earlierIso);
  if (earlier === null) return 0;
  return Math.floor((laterEpochMs - earlier) / DAY_MS);
}

/**
 * INV-4 canonical per-installment remaining amount (T-284/T-285): the
 * amount the family still owes on this tranche, 0 once satisfied. Uncleared
 * non-cash funds (amountPending) do NOT reduce the remaining balance until
 * the payment clears.
 */
export function installmentRemaining(i: Pick<Installment, "amountDue" | "amountPaid" | "amountPending" | "status">): number {
  if (i.status === "paid") return 0;
  return Math.max(0, Math.round(i.amountDue - i.amountPaid - i.amountPending));
}

/** Round-half-up percentage share (the PARITY-001 pinned convention). */
export function sharePct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// ============================================================================
// 1. Tranche-wave collection velocity (Vélocité par Vague)
// ============================================================================

export type WavePhase = "not_due" | "in_window" | "overdue";

export interface TrancheWave {
  /** Billing category of the wave (tuition | transport | …). */
  readonly category: PaymentCategory;
  /** Canonical wave number (installments.tranche_number — never label-parsed). */
  readonly wave: 1 | 2 | 3;
  /** Number of billed installments in this wave. */
  readonly installmentCount: number;
  /** Number of FULLY satisfied installments (status === "paid"). */
  readonly paidCount: number;
  /** Distinct families billed in this wave. */
  readonly familyCount: number;
  /** Distinct families that still owe on this wave. */
  readonly debtorFamilyCount: number;
  /** Σ amountDue over the wave (DZD). */
  readonly dueTotal: number;
  /** Σ amountPaid over the wave (DZD). */
  readonly paidTotal: number;
  /** Σ remaining over unpaid installments (INV-4, DZD). */
  readonly remainingTotal: number;
  /** Value-based collection rate: round(paidTotal / dueTotal × 100). */
  readonly collectedPct: number;
  /** Count-based clearance rate: round(paidCount / installmentCount × 100). */
  readonly clearedPct: number;
  /** Earliest due date in the wave (ISO) — null when the wave is empty. */
  readonly dueDate: string | null;
  /** Phase at `now`: not_due (due in the future) | in_window | overdue. */
  readonly phase: WavePhase;
}

/**
 * The three seasonal cash surges — per (category × tranche_number) wave:
 * what was billed, what was collected, what remains, and how far past the
 * due date the wave is. The single replacement for the removed smooth
 * 12-month revenue spline: school revenue is a STAIRCASE of three waves
 * (Sept / Dec / Mar), not a curve.
 *
 * A wave is `overdue` when ANY unpaid installment's due date is past
 * `now`; `not_due` when every unpaid installment is still in the future;
 * `in_window` otherwise (mixed or due today). Fully-collected waves are
 * `overdue`-agnostic (phase computed from unpaid rows only; a paid wave
 * with no unpaid rows reports `in_window` — it is complete, the meters
 * show 100%).
 */
export function deriveTrancheWaves(
  installments: readonly Installment[],
  nowEpochMs: number,
): TrancheWave[] {
  interface Acc {
    category: PaymentCategory;
    wave: 1 | 2 | 3;
    installmentCount: number;
    paidCount: number;
    families: Set<string>;
    debtorFamilies: Set<string>;
    dueTotal: number;
    paidTotal: number;
    remainingTotal: number;
    dueDateMin: number | null;
    anyUnpaidOverdue: boolean;
    anyUnpaidFuture: boolean;
  }
  const byWave = new Map<string, Acc>();
  for (const i of installments) {
    const wave = (i.trancheNumber ?? 1) as 1 | 2 | 3;
    const key = `${i.category}#${wave}`;
    let acc = byWave.get(key);
    if (!acc) {
      acc = {
        category: i.category,
        wave,
        installmentCount: 0,
        paidCount: 0,
        families: new Set<string>(),
        debtorFamilies: new Set<string>(),
        dueTotal: 0,
        paidTotal: 0,
        remainingTotal: 0,
        dueDateMin: null,
        anyUnpaidOverdue: false,
        anyUnpaidFuture: false,
      };
      byWave.set(key, acc);
    }
    acc.installmentCount += 1;
    acc.families.add(i.parentId);
    acc.dueTotal += Math.round(i.amountDue);
    acc.paidTotal += Math.round(i.amountPaid);
    const dueTs = tsOf(i.dueDate);
    if (dueTs !== null && (acc.dueDateMin === null || dueTs < acc.dueDateMin)) {
      acc.dueDateMin = dueTs;
    }
    if (i.status === "paid") {
      acc.paidCount += 1;
    } else {
      const remaining = installmentRemaining(i);
      acc.remainingTotal += remaining;
      if (remaining > 0) acc.debtorFamilies.add(i.parentId);
      if (dueTs !== null) {
        if (dueTs < nowEpochMs) acc.anyUnpaidOverdue = true;
        else acc.anyUnpaidFuture = true;
      }
    }
  }

  const waves: TrancheWave[] = [];
  for (const acc of byWave.values()) {
    let phase: WavePhase;
    if (acc.anyUnpaidOverdue) phase = "overdue";
    else if (acc.anyUnpaidFuture && acc.remainingTotal > 0) phase = "not_due";
    else phase = "in_window";
    waves.push({
      category: acc.category,
      wave: acc.wave,
      installmentCount: acc.installmentCount,
      paidCount: acc.paidCount,
      familyCount: acc.families.size,
      debtorFamilyCount: acc.debtorFamilies.size,
      dueTotal: acc.dueTotal,
      paidTotal: acc.paidTotal,
      remainingTotal: acc.remainingTotal,
      collectedPct: sharePct(acc.paidTotal, acc.dueTotal),
      clearedPct: sharePct(acc.paidCount, acc.installmentCount),
      dueDate: acc.dueDateMin !== null ? new Date(acc.dueDateMin).toISOString() : null,
      phase,
    });
  }
  // Stable order: tuition waves first (the payroll-critical staircase),
  // then transport, then others; wave number ascending inside a category.
  const categoryRank = (c: PaymentCategory): number => (c === "tuition" ? 0 : c === "transport" ? 1 : 2);
  return waves.sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.wave - b.wave);
}

// ============================================================================
// 2. Discount erosion (Le Taux d'Érosion des Remises)
// ============================================================================

export interface DiscountErosion {
  /** Number of negotiated-remise adjustment entries (negative credits). */
  readonly remiseCount: number;
  /** Σ |remise| over those entries (DZD) — the raw negotiated discounts. */
  readonly remiseTotal: number;
  /** Number of double-remise-cancel debit entries (reconciliation 0063). */
  readonly cancelCount: number;
  /** Σ cancels (DZD) — the ledger-honest netting of the imported devis. */
  readonly cancelTotal: number;
  /** Net remise after cancels (remiseTotal − cancelTotal, DZD). */
  readonly netRemiseTotal: number;
  /** Σ positive charge entries (DZD) — the NET invoiced base. */
  readonly grossCharges: number;
  /**
   * Gross sticker price = grossCharges + remiseTotal (DZD). The imported
   * devis amounts are ALREADY net of remise (Excel formula L = composantes
   * − J), so the pre-discount sticker potential is charges + the remises
   * that were negotiated off it.
   */
  readonly stickerTotal: number;
  /** Erosion rate: round(remiseTotal / stickerTotal × 100) — % of gross given away. */
  readonly erosionPct: number;
  /** Average remise per discounted family (DZD, DZD-granularity rounded). */
  readonly averageRemise: number;
  /** Largest single negotiated remise (DZD). */
  readonly maxRemise: number;
  /** Smallest single negotiated remise (DZD). */
  readonly minRemise: number;
  /** Distinct families that received at least one remise. */
  readonly remiseFamilyCount: number;
}

/**
 * Discount erosion from the ledger adjustment stream.
 *
 * IDENTIFICATION CONTRACT (live-verified 2026-09-14): the Excel devis
 * import writes negative `adjustment` entries whose description starts
 * with "Remise sur devis" AND whose metadata carries `field: "REMISE"`
 * (318 live rows, −9 709 700 DZD). The reconciliation-0063 "double-remise"
 * repair writes positive cancel debits whose metadata carries
 * `reason: "double_remise_cancel"` (318 rows, +9 709 700 DZD). Both
 * markers are STRUCTURED metadata — description matching is the documented
 * fallback only.
 *
 * The NET of remises and cancels is ~0 by design (the imported charges are
 * already net), so the erosion metric reports the RAW negotiated remise
 * volume against the reconstructed sticker total — the "how much margin
 * did we give away to fill seats" number the owner mandated.
 */
export function deriveDiscountErosion(ledger: readonly LedgerEntry[]): DiscountErosion {
  let remiseCount = 0;
  let remiseTotal = 0;
  let cancelCount = 0;
  let cancelTotal = 0;
  let grossCharges = 0;
  const remiseFamilies = new Set<string>();
  let maxRemise = 0;
  let minRemise = Number.POSITIVE_INFINITY;

  for (const e of ledger) {
    const amount = Math.round(e.amount);
    if (e.type === "charge") {
      if (amount > 0) grossCharges += amount;
      continue;
    }
    if (e.type !== "adjustment") continue;
    const meta = e.metadata as Record<string, unknown> | undefined;
    const isRemise = amount < 0 && meta?.field === "REMISE";
    const isRemiseByDescription = amount < 0 && e.description.startsWith("Remise sur devis");
    const isCancel = meta?.reason === "double_remise_cancel";
    if (isRemise || isRemiseByDescription) {
      remiseCount += 1;
      remiseTotal += -amount;
      remiseFamilies.add(e.parentId);
      if (-amount > maxRemise) maxRemise = -amount;
      if (-amount < minRemise) minRemise = -amount;
    } else if (isCancel && amount > 0) {
      cancelCount += 1;
      cancelTotal += amount;
    }
  }

  const stickerTotal = grossCharges + remiseTotal;
  return {
    remiseCount,
    remiseTotal,
    cancelCount,
    cancelTotal,
    netRemiseTotal: remiseTotal - cancelTotal,
    grossCharges,
    stickerTotal,
    erosionPct: sharePct(remiseTotal, stickerTotal),
    averageRemise: remiseCount > 0 ? Math.round(remiseTotal / remiseCount) : 0,
    maxRemise: remiseCount > 0 ? maxRemise : 0,
    minRemise: remiseCount > 0 ? minRemise : 0,
    remiseFamilyCount: remiseFamilies.size,
  };
}

// ============================================================================
// 3. Debt triage — chronic vs transitory (Créances par Ancienneté Réelle)
// ============================================================================

export type TriageBucket = "not_due" | "current" | "reminder" | "chronic";

export const TRIAGE_BUCKET_LABELS_FR: Record<TriageBucket, string> = {
  not_due: "Non échue",
  current: "Retard < 15 j (à surveiller)",
  reminder: "Retard 15–45 j (relance)",
  chronic: "Retard > 45 j (intervention)",
};

export interface DebtTriageBucket {
  readonly bucket: TriageBucket;
  readonly label: string;
  /** Σ remaining over the bucket's unpaid installments (DZD). */
  readonly amount: number;
  /** Count of unpaid installments in the bucket. */
  readonly installmentCount: number;
  /** Distinct families owing in the bucket. */
  readonly familyCount: number;
  /** Share of the total outstanding (by value), rounded. */
  readonly share: number;
}

export interface CallListEntry {
  readonly parentId: string;
  /** Outstanding amount across every unpaid installment (INV-4, DZD). */
  readonly outstanding: number;
  /** Worst overdue age across the family's unpaid installments (days). */
  readonly worstDaysOverdue: number;
}

export interface DebtTriage {
  readonly buckets: DebtTriageBucket[];
  /** Total outstanding across every bucket (INV-4, DZD). */
  readonly totalOutstanding: number;
  /** The >45-day families owed the most — the immediate call list. */
  readonly callList: CallListEntry[];
}

/**
 * Real debt aging split into the owner-mandated action tiers:
 *   - not_due  — due date in the future (current tranche debt — NOT bad
 *                debt; this is what makes the raw "Total Debt" number a
 *                heart-attack generator when shown without context)
 *   - current  — < 15 days late (ignorable — salary-cycle transitory)
 *   - reminder — 15–45 days late (WhatsApp reminder)
 *   - chronic  — > 45 days late (Director intervention / account
 *                restriction — the immediate call list)
 *
 * Days overdue = floor((now − dueDate) / day), 0 when not yet due
 * (daysBetweenFloor). A family appears in the call list when ANY unpaid
 * installment is > 45 days late; their exposure is their FULL outstanding
 * (all buckets), ranked descending.
 */
export function deriveDebtTriage(
  installments: readonly Installment[],
  nowEpochMs: number,
): DebtTriage {
  const bucketOrder: TriageBucket[] = ["not_due", "current", "reminder", "chronic"];
  const acc = new Map<TriageBucket, { amount: number; installmentCount: number; families: Set<string> }>();
  for (const b of bucketOrder) acc.set(b, { amount: 0, installmentCount: 0, families: new Set() });
  // Per-family outstanding + worst overdue age across ALL their installments.
  const perFamily = new Map<string, { outstanding: number; worstDaysOverdue: number }>();

  for (const i of installments) {
    const remaining = installmentRemaining(i);
    if (remaining <= 0) continue;
    const days = daysBetweenFloor(i.dueDate, nowEpochMs);
    const bucket: TriageBucket = days <= 0 ? "not_due" : days < 15 ? "current" : days <= 45 ? "reminder" : "chronic";
    const a = acc.get(bucket)!;
    a.amount += remaining;
    a.installmentCount += 1;
    a.families.add(i.parentId);
    const fam = perFamily.get(i.parentId) ?? { outstanding: 0, worstDaysOverdue: 0 };
    fam.outstanding += remaining;
    if (days > fam.worstDaysOverdue) fam.worstDaysOverdue = days;
    perFamily.set(i.parentId, fam);
  }

  const totalOutstanding = [...acc.values()].reduce((s, a) => s + a.amount, 0);
  const buckets: DebtTriageBucket[] = bucketOrder.map((bucket) => {
    const a = acc.get(bucket)!;
    return {
      bucket,
      label: TRIAGE_BUCKET_LABELS_FR[bucket],
      amount: a.amount,
      installmentCount: a.installmentCount,
      familyCount: a.families.size,
      share: sharePct(a.amount, totalOutstanding),
    };
  });

  const chronicFamilies = [...perFamily.entries()]
    .filter(([, f]) => f.worstDaysOverdue > 45)
    .map(([parentId, f]) => ({ parentId, ...f }))
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 10);

  return { buckets, totalOutstanding, callList: chronicFamilies };
}

// ============================================================================
// 4. Family-level exposure concentration (the 80/20 rule)
// ============================================================================

export interface FamilyExposure {
  readonly parentId: string;
  /** Family display name (displayName first — parents.first_name is empty on all live rows). */
  readonly parentName: string;
  /** Outstanding amount across every unpaid installment (INV-4, DZD). */
  readonly outstanding: number;
  /** Active children in the school. */
  readonly childCount: number;
  /** Share of the total school debt, rounded. */
  readonly shareOfTotalDebt: number;
  /** Worst overdue age across the family's unpaid installments (days). */
  readonly worstDaysOverdue: number;
}

export interface FamilyConcentration {
  /** Total school outstanding (INV-4 over unpaid installments, DZD). */
  readonly totalOutstanding: number;
  /** Families with outstanding > 0. */
  readonly debtorFamilyCount: number;
  /** The top-N exposure ranking (default 10 — the owner's "Top 10" metric). */
  readonly topFamilies: FamilyExposure[];
  /** Σ top-N outstanding (DZD). */
  readonly topTotal: number;
  /** round(topTotal / totalOutstanding × 100) — the concentration metric. */
  readonly topConcentrationPct: number;
}

/**
 * Family-level debt concentration. In a private school the debt belongs to
 * the TUTEUR, not the student — one large family stopping payments is a
 * bigger hole than ten single-child families combined. The derivation
 * ranks per-family outstanding (INV-4), counts their active children, and
 * reports the top-N share of the total school debt.
 */
export function deriveFamilyConcentration(params: {
  installments: readonly Installment[];
  parents: readonly Parent[];
  students: readonly Student[];
  topN?: number;
  /**
   * Deterministic "now" (epoch ms) for the worst-overdue ages — REQUIRED
   * for the corpus equivalence (Date.now() inside a derivation makes the
   * output non-reproducible across the two platforms' test runners).
   */
  nowEpochMs: number;
}): FamilyConcentration {
  const { installments, parents, students, topN = 10, nowEpochMs } = params;

  const parentNameById = new Map(parents.map((p) => [p.id, parentDisplayName(p)]));
  const childCountByParent = new Map<string, number>();
  for (const s of students) {
    if (s.status !== "active") continue;
    childCountByParent.set(s.parentId, (childCountByParent.get(s.parentId) ?? 0) + 1);
  }

  const outstandingByFamily = new Map<string, number>();
  const worstOverdueByFamily = new Map<string, number>();
  for (const i of installments) {
    const remaining = installmentRemaining(i);
    if (remaining <= 0) continue;
    outstandingByFamily.set(i.parentId, (outstandingByFamily.get(i.parentId) ?? 0) + remaining);
    const days = daysBetweenFloor(i.dueDate, nowEpochMs);
    if (days > (worstOverdueByFamily.get(i.parentId) ?? 0)) {
      worstOverdueByFamily.set(i.parentId, days);
    }
  }

  const totalOutstanding = [...outstandingByFamily.values()].reduce((s, v) => s + v, 0);
  const ranked = [...outstandingByFamily.entries()]
    .map(([parentId, outstanding]) => ({
      parentId,
      parentName: parentNameById.get(parentId) ?? "Famille inconnue",
      outstanding,
      childCount: childCountByParent.get(parentId) ?? 0,
      shareOfTotalDebt: sharePct(outstanding, totalOutstanding),
      worstDaysOverdue: worstOverdueByFamily.get(parentId) ?? 0,
    }))
    .sort((a, b) => b.outstanding - a.outstanding);

  const topFamilies = ranked.slice(0, topN);
  const topTotal = topFamilies.reduce((s, f) => s + f.outstanding, 0);
  return {
    totalOutstanding,
    debtorFamilyCount: ranked.length,
    topFamilies,
    topTotal,
    topConcentrationPct: sharePct(topTotal, totalOutstanding),
  };
}

// ============================================================================
// 5. Transport route yield (Logistiques)
// ============================================================================

export interface TransportRouteStat {
  /** Canonical destination key (normalized through TOWN_ALIASES). */
  readonly destination: TransportDestination;
  /** Active students riding this route (normalized transport_tier). */
  readonly riders: number;
  /** Σ due over the route's transport installments (DZD). */
  readonly dueTotal: number;
  /** Σ paid over the route's transport installments (DZD). */
  readonly paidTotal: number;
  /** Σ remaining (INV-4, DZD). */
  readonly remainingTotal: number;
  /** round(paidTotal / dueTotal × 100). */
  readonly collectedPct: number;
}

export interface TransportYield {
  /** Active students with a transport assignment (non-null normalized tier). */
  readonly riders: number;
  /** Active students without transport. */
  readonly nonRiders: number;
  /** Unrecognized town strings mapped to "autres" (raw spellings, honest count). */
  readonly unresolvedRawValues: string[];
  /** Per-route stats, riders descending. */
  readonly routes: TransportRouteStat[];
  /** Σ dueTotal over all routes (DZD). */
  readonly dueTotal: number;
  /** Σ paidTotal (DZD). */
  readonly paidTotal: number;
  /** Σ remaining (DZD). */
  readonly remainingTotal: number;
  /** round(paidTotal / dueTotal × 100) — the transport collection rate. */
  readonly collectedPct: number;
}

/**
 * Transport yield per normalized route. The messy live `transport_tier`
 * spellings ("BOUMERDES", "BOUMRDES", "BOUMREDES" are the same town) are
 * resolved through the canonical TOWN_ALIASES table; unknown non-empty
 * strings count as the "autres" zone and are reported verbatim in
 * `unresolvedRawValues` so the administration can repair the source data.
 *
 * Route financials come from the transport installments joined through
 * each rider's parent — NOT from payments (a payment's category is
 * transport but its allocation to a route only exists via the rider).
 */
export function deriveTransportYield(params: {
  students: readonly Student[];
  installments: readonly Installment[];
}): TransportYield {
  const { students, installments } = params;

  // Parent-of-rider → destination (a rider's transport installments hang
  // off their parent's account).
  const riderParentsByDestination = new Map<TransportDestination, Set<string>>();
  let riders = 0;
  let nonRiders = 0;
  const unresolved = new Map<string, number>();
  for (const s of students) {
    if (s.status !== "active") continue;
    const dest = normalizeTransportTier(s.transportTier);
    if (dest === null) {
      nonRiders += 1;
      continue;
    }
    riders += 1;
    if (dest === "autres" && s.transportTier) {
      const raw = s.transportTier.trim();
      if (raw.length > 0) unresolved.set(raw, (unresolved.get(raw) ?? 0) + 1);
    }
    let parents = riderParentsByDestination.get(dest);
    if (!parents) {
      parents = new Set<string>();
      riderParentsByDestination.set(dest, parents);
    }
    parents.add(s.parentId);
  }

  // Transport installments attributed to a route via the rider's parent.
  // Route keys are the UNION of rider destinations and installment-attributed
  // destinations — a route with riders but no billed installments (due 0)
  // still appears: the fill-rate view (riders per route) matters even before
  // the first bill (T-338 fix: rider-only routes were dropped when the
  // installment stream was empty).
  const routeAcc = new Map<TransportDestination, { due: number; paid: number; remaining: number }>();
  for (const dest of riderParentsByDestination.keys()) {
    routeAcc.set(dest, { due: 0, paid: 0, remaining: 0 });
  }
  for (const i of installments) {
    if (i.category !== "transport") continue;
    let attributed = false;
    for (const [dest, parents] of riderParentsByDestination) {
      if (parents.has(i.parentId)) {
        let acc = routeAcc.get(dest);
        if (!acc) {
          acc = { due: 0, paid: 0, remaining: 0 };
          routeAcc.set(dest, acc);
        }
        acc.due += Math.round(i.amountDue);
        acc.paid += Math.round(i.amountPaid);
        acc.remaining += installmentRemaining(i);
        attributed = true;
        break;
      }
    }
    if (!attributed) {
      // Transport installment for a family with no active rider student —
      // still real money: bucket it under "autres" so Σ reconciles.
      let acc = routeAcc.get("autres");
      if (!acc) {
        acc = { due: 0, paid: 0, remaining: 0 };
        routeAcc.set("autres", acc);
      }
      acc.due += Math.round(i.amountDue);
      acc.paid += Math.round(i.amountPaid);
      acc.remaining += installmentRemaining(i);
    }
  }

  const routes: TransportRouteStat[] = [...routeAcc.entries()]
    .map(([destination, a]) => ({
      destination,
      riders: riderParentsByDestination.get(destination)?.size ?? 0,
      dueTotal: a.due,
      paidTotal: a.paid,
      remainingTotal: a.remaining,
      collectedPct: sharePct(a.paid, a.due),
    }))
    .sort((a, b) => b.riders - a.riders || b.remainingTotal - a.remainingTotal);

  const dueTotal = routes.reduce((s, r) => s + r.dueTotal, 0);
  const paidTotal = routes.reduce((s, r) => s + r.paidTotal, 0);
  const remainingTotal = routes.reduce((s, r) => s + r.remainingTotal, 0);

  return {
    riders,
    nonRiders,
    unresolvedRawValues: [...unresolved.entries()].map(([raw]) => raw).sort(),
    routes,
    dueTotal,
    paidTotal,
    remainingTotal,
    collectedPct: sharePct(paidTotal, dueTotal),
  };
}

// ============================================================================
// 6. Specialized-service yield (PSY / ORTH / E-PLANT / …)
// ============================================================================

export interface ServiceStat {
  readonly category: PaymentCategory;
  readonly label: string;
  /** Count of PAID payments in this service category. */
  readonly paymentCount: number;
  /** Σ paid amount (DZD). */
  readonly revenue: number;
  /** Distinct students billed (payments carrying a studentId). */
  readonly studentCount: number;
}

/**
 * The service categories the school actually sells beyond tuition and
 * transport — the therapy/integration tracks (PSY, ORTH, E-PLANT) and the
 * auxiliary categories. Revenue + volume from the PAID payment stream;
 * categories with zero activity are omitted (honest empty state — the
 * live `service_enrollments` table is empty and therapy categories have
 * no payments yet, so the card renders its empty state rather than a
 * fabricated load).
 */
export const SERVICE_CATEGORIES: readonly PaymentCategory[] = [
  "therapy_psychology",
  "therapy_speech",
  "extracurricular",
  "canteen",
  "uniform",
  "books",
  "second_apron",
  "other",
];

export function deriveServiceYield(
  payments: readonly Payment[],
  labels: Readonly<Record<string, string>>,
): ServiceStat[] {
  const acc = new Map<PaymentCategory, { revenue: number; paymentCount: number; students: Set<string> }>();
  for (const p of payments) {
    if (p.status !== "paid") continue;
    if (!SERVICE_CATEGORIES.includes(p.category)) continue;
    let a = acc.get(p.category);
    if (!a) {
      a = { revenue: 0, paymentCount: 0, students: new Set() };
      acc.set(p.category, a);
    }
    a.revenue += Math.round(p.amount);
    a.paymentCount += 1;
    if (p.studentId) a.students.add(p.studentId);
  }
  return [...acc.entries()]
    .map(([category, a]) => ({
      category,
      label: labels[category] ?? category,
      paymentCount: a.paymentCount,
      revenue: a.revenue,
      studentCount: a.students.size,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ============================================================================
// 7. Enrollment dynamics — sibling index + section imbalance
// ============================================================================

export interface FamilySizeSlice {
  /** "1 enfant" / "2 enfants" / … / "5+ enfants". */
  readonly label: string;
  readonly familyCount: number;
  readonly studentCount: number;
}

export interface SectionImbalanceRow {
  /** The grade (class name of the first section by enrollment). */
  readonly gradeLabel: string;
  readonly sectionCount: number;
  /** Enrolled students per section (sorted desc). */
  readonly sections: { readonly classId: string; readonly className: string; readonly enrolled: number }[];
  readonly minEnrolled: number;
  readonly maxEnrolled: number;
  readonly averageEnrolled: number;
  /** maxEnrolled − minEnrolled. */
  readonly spread: number;
  /**
   * True when the grade has 2+ sections AND (spread ≥ 10 OR the max is
   * ≥ 1.5× the min) — the redistribution warning. NO capacity ceiling is
   * involved anywhere: the owner's directive is that a class has no
   * artificial maximum.
   */
  readonly imbalanced: boolean;
}

export interface EnrollmentDynamics {
  readonly totalStudents: number;
  readonly totalFamilies: number;
  /** totalStudents / totalFamilies — the sibling multiplier (2 decimals). */
  readonly siblingIndex: number | null;
  /** Families with 2+ enrolled children (count + share of families). */
  readonly multiChildFamilyCount: number;
  readonly multiChildFamilyPct: number;
  readonly familySizes: FamilySizeSlice[];
  /** Section-imbalance rows for grades with 2+ active sections (spread desc). */
  readonly imbalances: SectionImbalanceRow[];
}

/**
 * Enrollment dynamics: the sibling multiplier (Total Students / Total
 * Families — the family-loyalty ratio), the family-size distribution, and
 * the SECTION IMBALANCE detector that replaces the deleted capacity
 * gauges. No fake ceilings: only real enrollment counts per section,
 * flagged when same-grade sections drift apart (spread ≥ 10 students or
 * max ≥ 1.5 × min).
 */
export function deriveEnrollmentDynamics(params: {
  students: readonly Student[];
  parents: readonly Parent[];
  classes: readonly AcademicClass[];
}): EnrollmentDynamics {
  // `parents` is part of the canonical contract (both platforms pass the
  // same stream) but the derivation counts families from the ACTIVE
  // student rows — parents with no active child are not part of the
  // current year's population.
  const { students, classes } = params;
  void params.parents;

  const activeStudents = students.filter((s) => s.status === "active");
  const childCountByParent = new Map<string, number>();
  for (const s of activeStudents) {
    childCountByParent.set(s.parentId, (childCountByParent.get(s.parentId) ?? 0) + 1);
  }
  // A family counts when it has ≥ 1 active child (parents with no active
  // children are not part of the current year's population).
  const familyChildCounts = [...childCountByParent.values()];
  const totalStudents = activeStudents.length;
  const totalFamilies = familyChildCounts.length;

  const sizeBuckets = new Map<number, { families: number; students: number }>();
  for (const c of familyChildCounts) {
    const key = Math.min(c, 5);
    let b = sizeBuckets.get(key);
    if (!b) {
      b = { families: 0, students: 0 };
      sizeBuckets.set(key, b);
    }
    b.families += 1;
    b.students += c;
  }
  const familySizes: FamilySizeSlice[] = [...sizeBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([size, b]) => ({
      label: size < 5 ? `${size} enfant${size > 1 ? "s" : ""}` : "5+ enfants",
      familyCount: b.families,
      studentCount: b.students,
    }));

  const multiChildFamilyCount = familyChildCounts.filter((c) => c >= 2).length;

  // ── Section imbalance: group ACTIVE classes by grade (gradeCode), keep
  // grades with 2+ sections, compare enrolled counts.
  const sectionsByGrade = new Map<string, AcademicClass[]>();
  for (const c of classes) {
    if (!c.isActive) continue;
    const list = sectionsByGrade.get(c.gradeCode) ?? [];
    list.push(c);
    sectionsByGrade.set(c.gradeCode, list);
  }
  const imbalances: SectionImbalanceRow[] = [];
  for (const [gradeCode, secs] of sectionsByGrade) {
    if (secs.length < 2) continue;
    const sections = secs
      .map((c) => ({ classId: c.id, className: c.name, enrolled: c.enrolledCount }))
      .sort((a, b) => b.enrolled - a.enrolled);
    const minEnrolled = sections[sections.length - 1].enrolled;
    const maxEnrolled = sections[0].enrolled;
    const total = sections.reduce((s, x) => s + x.enrolled, 0);
    const spread = maxEnrolled - minEnrolled;
    imbalances.push({
      gradeLabel: `${sections[0].className} (${gradeCode.toUpperCase()})`,
      sectionCount: sections.length,
      sections,
      minEnrolled,
      maxEnrolled,
      averageEnrolled: sections.length > 0 ? Math.round(total / sections.length) : 0,
      spread,
      imbalanced: spread >= 10 || (minEnrolled > 0 && maxEnrolled >= 1.5 * minEnrolled),
    });
  }
  imbalances.sort((a, b) => b.spread - a.spread);

  return {
    totalStudents,
    totalFamilies,
    siblingIndex: totalFamilies > 0 ? Math.round((totalStudents / totalFamilies) * 100) / 100 : null,
    multiChildFamilyCount,
    multiChildFamilyPct: sharePct(multiChildFamilyCount, totalFamilies),
    familySizes,
    imbalances,
  };
}

// ============================================================================
// 8. Triple-risk summary (the radar header numbers)
// ============================================================================

export interface TripleRiskSummary {
  /** Students triggering ALL three flags (GPA < 10 + unexcused ≥ 3 + overdue debt). */
  readonly tripleCriticalCount: number;
  readonly academicAlertCount: number;
  readonly attendanceAlertCount: number;
  readonly financialTensionCount: number;
  readonly healthyCount: number;
  /** round(tripleCriticalCount / total × 100). */
  readonly tripleCriticalPct: number;
}

/**
 * Summary counts over the operational query engine's risk profiles (the
 * SAME evaluateStudentRiskProfiles the diagnostic console uses — one
 * derivation, no re-implementation). Categorization thresholds live in
 * the engine: GPA < 10/20, unexcused absences ≥ 3 or rate < 85%,
 * family debt ≥ 25 000 DZD.
 */
export function deriveTripleRiskSummary(
  profiles: readonly StudentRiskProfile[],
): TripleRiskSummary {
  const total = profiles.length;
  const count = (cat: StudentRiskProfile["riskCategory"]) =>
    profiles.filter((p) => p.riskCategory === cat).length;
  const tripleCriticalCount = count("triple_critical");
  return {
    tripleCriticalCount,
    academicAlertCount: count("academic_alert"),
    attendanceAlertCount: count("attendance_alert"),
    financialTensionCount: count("financial_tension"),
    healthyCount: count("healthy"),
    tripleCriticalPct: sharePct(tripleCriticalCount, total),
  };
}
