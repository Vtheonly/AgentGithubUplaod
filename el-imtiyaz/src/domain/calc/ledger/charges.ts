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
 *   - Discounts are applied per-tranche via `applyDiscount`.
 */
import type { LedgerEntry } from "@/domain/model/ledger";
import type { AcademicLevel, GradeLevel } from "@/domain/model/student";
import type { TransportDestination } from "@/domain/model/parent";
import type { PricingConfig, PricingEntry } from "@/domain/model/pricing";
import {
  tuitionForLevel,
  tuitionForGradeLevel,
  tuitionTranches,
  tuitionTranchesForGrade,
  transportForTier,
  transportForDestination,
  transportTranchesForDestination,
  applyDiscount,
} from "../pricing";
import { createChargeEntry } from "./entries";

/**
 * Build the charge entries for a 3-tranche tuition schedule.
 *
 * Iteration 6: If `gradeLevel` is provided, uses the granular per-grade-level
 * pricing (preferred). Falls back to the legacy `level`-based pricing otherwise.
 *
 * @returns 3 `charge` entries (one per tranche) with due dates.
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
  trancheDueDates: readonly [string, string, string]; // ISO dates for T1/T2/T3
  actorId: string;
  actorName: string;
  sourceId: string;
  discounts?: readonly PricingEntry[]; // applied to each tranche
}): LedgerEntry[] {
  // Iteration 6: prefer per-grade-level pricing.
  const tranches = input.gradeLevel
    ? tuitionTranchesForGrade(input.config, input.gradeLevel)
    : (() => {
        const tuition = tuitionForLevel(input.config, input.level);
        return tuitionTranches(tuition);
      })();
  const annualAmount = input.gradeLevel
    ? tuitionForGradeLevel(input.config, input.gradeLevel).annualAmount
    : tuitionForLevel(input.config, input.level);

  return tranches.map((t, i) => {
    let amount = t.amountDue;
    if (input.discounts && input.discounts.length > 0) {
      for (const d of input.discounts) {
        if (d.discountType) {
          amount = applyDiscount(amount, { amount: d.amount, discountType: d.discountType });
        }
      }
    }
    return createChargeEntry({
      tenantId: input.tenantId,
      parentId: input.parentId,
      studentId: input.studentId,
      category: "tuition",
      amount,
      sourceType: "installment",
      sourceId: `${input.sourceId}-t${i + 1}`,
      description: `Scolarité ${input.academicYear} — Tranche ${i + 1} (${input.gradeLevel ?? input.level})`,
      actorId: input.actorId,
      actorName: input.actorName,
      at: input.trancheDueDates[i],
      metadata: {
        tranche: i + 1,
        level: input.level,
        gradeLevel: input.gradeLevel ?? null,
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
}): LedgerEntry[] {
  const tranches = transportTranchesForDestination(input.config, input.destination);
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
