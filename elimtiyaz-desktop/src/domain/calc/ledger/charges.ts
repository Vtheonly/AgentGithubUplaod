/**
 * Charge entry builders — construct multi-entry charge schedules for
 * tuition and transport based on `PricingConfig`.
 *
 * Extracted from `domain/model/ledger.ts`:
 *   - `buildTuitionChargeEntries`                     — 3-tranche tuition
 *   - `buildTransportChargeEntry`                     — single transport fee (legacy)
 *   - `buildTransportChargeEntriesForDestination`     — 3-tranche transport
 *
 * Behavior preserved verbatim:
 *   - Iteration 6 logic: prefer per-grade-level pricing when `gradeLevel`
 *     is provided; fall back to legacy `level`-based pricing otherwise.
 *   - For transport: prefer per-destination pricing when `destination`
 *     is provided; fall back to legacy `tier`-based pricing otherwise.
 *
 * UNIFIED ARCHITECTURE (this revision):
 *   - The per-tranche `applyDiscount` loop inside `buildTuitionChargeEntries`
 *     has been REMOVED. This was the root cause of the double-discounting
 *     bug: a −5,000 DA sibling discount was being applied to *each* tranche
 *     (3 × −5,000 = −15,000 DA) instead of once on the annual total.
 *   - Callers MUST now pre-evaluate discounts on the annual gross total
 *     via `evaluateAllSystemDiscounts` (see `domain/calc/pricing/discount-engine.ts`)
 *     and pass the resulting NET tranche amounts via the new `netTrancheAmounts`
 *     input field. When `netTrancheAmounts` is provided, it overrides the
 *     config-derived gross tranche amounts.
 *   - The legacy `discounts` field is still accepted for backward compatibility
 *     but is IGNORED — discounts must be pre-applied by the caller.
 *   - New `paymentPlan` field on the input drives whether 1 (full_annual)
 *     or 3 (tranches) entries are generated.
 *   - New `academicCycle` field is recorded in the metadata for downstream
 *     schedule regeneration.
 */
import type { LedgerEntry } from "@/domain/model/ledger";
import type { AcademicLevel, GradeLevel } from "@/domain/model/student";
import type { TransportDestination } from "@/domain/model/parent";
import type { PricingConfig, PricingEntry } from "@/domain/model/pricing";
import type { AcademicCycle, PaymentPlan } from "@/domain/model/payment";
import {
  tuitionForLevel,
  tuitionForGradeLevel,
  tuitionTranches,
  tuitionTranchesForGrade,
  transportForTier,
  transportForDestination,
  transportTranchesForDestination,
} from "../pricing";
import { createChargeEntry } from "./entries";

/**
 * Build the charge entries for a tuition schedule.
 *
 * - If `paymentPlan === "full_annual"`: returns 1 charge entry for the
 *   full net annual amount (with a single due date).
 * - If `paymentPlan === "tranches"` (default): returns 3 charge entries
 *   (one per tranche) with the official `Prices.md` due dates.
 *
 * The `netTrancheAmounts` field (when provided) overrides the config-derived
 * gross tranche amounts. Callers should compute this by:
 *   1. Looking up the gross annual tuition from `PricingConfig`.
 *   2. Running `evaluateAllSystemDiscounts` on the gross.
 *   3. Net Annual = Gross − Sum(discounts).
 *   4. Splitting via `splitNetTuitionByOfficialSchedule(net)`.
 *
 * Discounts MUST NOT be applied inside this function — that was the
 * double-discounting bug. The `discounts` field is accepted for backward
 * compatibility but is now IGNORED.
 */
export function buildTuitionChargeEntries(input: {
  tenantId: string;
  parentId: string;
  studentId: string;
  level: AcademicLevel;
  /** Optional granular grade level — preferred over `level` when provided. */
  gradeLevel?: GradeLevel;
  config: PricingConfig;
  academicYear: string;
  /** ISO due dates for T1/T2/T3 (or the single full-annual date). */
  trancheDueDates: readonly [string, string, string] | readonly [string];
  actorId: string;
  actorName: string;
  sourceId: string;
  /** @deprecated Use `netTrancheAmounts` instead. Ignored since the refactor. */
  discounts?: readonly PricingEntry[];
  /** Pre-calculated NET tranche amounts (gross minus evaluated discounts).
   *  When provided, overrides the config-derived gross amounts. */
  netTrancheAmounts?: readonly [number, number, number] | readonly [number];
  /** Payment plan — drives 1 vs 3 entries. Defaults to "tranches". */
  paymentPlan?: PaymentPlan;
  /** Education cycle — recorded in metadata for schedule regeneration. */
  academicCycle?: AcademicCycle;
}): LedgerEntry[] {
  const plan: PaymentPlan = input.paymentPlan ?? "tranches";

  // Full-annual: ONE charge entry for the net annual amount.
  if (plan === "full_annual") {
    const netAmount =
      input.netTrancheAmounts && input.netTrancheAmounts.length === 1
        ? input.netTrancheAmounts[0]
        : input.gradeLevel
          ? tuitionForGradeLevel(input.config, input.gradeLevel).annualAmount
          : tuitionForLevel(input.config, input.level);
    const dueDate = input.trancheDueDates[0];
    return [
      createChargeEntry({
        tenantId: input.tenantId,
        parentId: input.parentId,
        studentId: input.studentId,
        category: "tuition",
        amount: netAmount,
        sourceType: "installment",
        sourceId: `${input.sourceId}-t1`,
        description: `Scolarité ${input.academicYear} — Année complète (${input.gradeLevel ?? input.level})`,
        actorId: input.actorId,
        actorName: input.actorName,
        at: dueDate,
        metadata: {
          tranche: 1,
          level: input.level,
          gradeLevel: input.gradeLevel ?? null,
          paymentPlan: "full_annual",
          academicCycle: input.academicCycle ?? null,
          baseAmount: netAmount,
        },
      }),
    ];
  }

  // Tranches: THREE charge entries.
  // If caller pre-computed net tranche amounts, use them directly.
  // Otherwise fall back to config-derived gross amounts (legacy behavior).
  const tranches =
    input.netTrancheAmounts && input.netTrancheAmounts.length === 3
      ? (input.netTrancheAmounts as readonly [number, number, number]).map((amt, i) => ({
          label: `Tranche ${i + 1}`,
          amountDue: amt,
        }))
      : input.gradeLevel
        ? tuitionTranchesForGrade(input.config, input.gradeLevel)
        : (() => {
            const tuition = tuitionForLevel(input.config, input.level);
            return tuitionTranches(tuition);
          })();
  const annualAmount = input.gradeLevel
    ? tuitionForGradeLevel(input.config, input.gradeLevel).annualAmount
    : tuitionForLevel(input.config, input.level);
  const dueDates = input.trancheDueDates as readonly [string, string, string];

  return tranches.map((t, i) => {
    // IMPORTANT: NO per-tranche discount application. The caller MUST pre-apply
    // discounts on the annual total via `evaluateAllSystemDiscounts` and pass
    // the net amounts via `netTrancheAmounts`. Applying discounts here would
    // triple-count any fixed-amount discount (3 × −5,000 = −15,000 instead of −5,000).
    return createChargeEntry({
      tenantId: input.tenantId,
      parentId: input.parentId,
      studentId: input.studentId,
      category: "tuition",
      amount: t.amountDue,
      sourceType: "installment",
      sourceId: `${input.sourceId}-t${i + 1}`,
      description: `Scolarité ${input.academicYear} — Tranche ${i + 1} (${input.gradeLevel ?? input.level})`,
      actorId: input.actorId,
      actorName: input.actorName,
      at: dueDates[i],
      metadata: {
        tranche: i + 1,
        level: input.level,
        gradeLevel: input.gradeLevel ?? null,
        paymentPlan: "tranches",
        academicCycle: input.academicCycle ?? null,
        baseAmount: annualAmount,
      },
    });
  });
}

/**
 * Build the charge entry for a transport fee (single entry — legacy).
 *
 * Iteration 6: If `destination` is provided, uses the per-destination pricing
 * (preferred). Falls back to the legacy `tier`-based pricing otherwise.
 *
 * Note: When `destination` is provided, only ONE entry is created (the annual
 * transport charge). If you need the 3-tranche transport schedule, use
 * `buildTransportChargeEntriesForDestination` instead.
 */
export function buildTransportChargeEntry(input: {
  tenantId: string;
  parentId: string;
  studentId: string | null;
  tier?: "t1" | "t2" | "t3";
  /** Optional granular destination — preferred over `tier` when provided. */
  destination?: TransportDestination;
  config: PricingConfig;
  academicYear: string;
  dueDate: string;
  actorId: string;
  actorName: string;
  sourceId: string;
}): LedgerEntry {
  let amount: number;
  let zoneLabel: string;
  if (input.destination) {
    amount = transportForDestination(input.config, input.destination).annualAmount;
    zoneLabel = input.destination;
  } else {
    const tier = input.tier ?? "t1";
    amount = transportForTier(input.config, tier);
    zoneLabel = tier.toUpperCase();
  }
  return createChargeEntry({
    tenantId: input.tenantId,
    parentId: input.parentId,
    studentId: input.studentId,
    category: "transport",
    amount,
    sourceType: "installment",
    sourceId: input.sourceId,
    description: `Transport ${input.academicYear} — Zone ${zoneLabel}`,
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.dueDate,
    metadata: { tier: input.tier ?? null, destination: input.destination ?? null },
  });
}

/**
 * Iteration 6: Build the 3-tranche transport charge entries for a destination.
 *
 * Returns 3 `charge` entries — one per tranche (at registration, Dec 01–15, Mar 01–15).
 * Use this in the ledger seed and the billing engine to record each tranche
 * separately with its own due date.
 *
 * UNIFIED ARCHITECTURE: A `netTrancheAmounts` override is accepted for
 * symmetry with `buildTuitionChargeEntries`, so callers can pre-evaluate
 * transport discounts (rare, but supported) on the annual total before
 * splitting. Transport follows the same official schedule as tuition
 * (Sept 15 / Dec 15 / Mar 15).
 */
export function buildTransportChargeEntriesForDestination(input: {
  tenantId: string;
  parentId: string;
  studentId: string | null;
  destination: TransportDestination;
  config: PricingConfig;
  academicYear: string;
  trancheDueDates: readonly [string, string, string];
  actorId: string;
  actorName: string;
  sourceId: string;
  /** Pre-calculated NET transport tranche amounts (overrides config gross). */
  netTrancheAmounts?: readonly [number, number, number];
}): LedgerEntry[] {
  const tranches =
    input.netTrancheAmounts && input.netTrancheAmounts.length === 3
      ? (input.netTrancheAmounts as readonly [number, number, number]).map((amt, i) => ({
          label: `Tranche ${i + 1}`,
          amountDue: amt,
        }))
      : transportTranchesForDestination(input.config, input.destination);
  return tranches.map((t, i) => {
    return createChargeEntry({
      tenantId: input.tenantId,
      parentId: input.parentId,
      studentId: input.studentId,
      category: "transport",
      amount: t.amountDue,
      sourceType: "installment",
      sourceId: `${input.sourceId}-t${i + 1}`,
      description: `Transport ${input.academicYear} — Tranche ${i + 1} (${input.destination})`,
      actorId: input.actorId,
      actorName: input.actorName,
      at: input.trancheDueDates[i],
      metadata: { tranche: i + 1, destination: input.destination },
    });
  });
}
