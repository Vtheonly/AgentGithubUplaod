/**
 * `computeBilling` — pure billing computation for the BatchRegistrationModal.
 *
 * This is the SINGLE PASS that:
 *   1. Looks up gross annual tuition per student from `PricingConfig`.
 *   2. Evaluates all 5 official `Prices.md` discounts ONCE on the gross
 *      (via `evaluateAllSystemDiscounts`) — never per-tranche.
 *   3. Derives Net Annual Tuition = Gross − Sum(discounts).
 *   4. Splits the Net across 3 tranches (or 1 for `full_annual`) using the
 *      official 40% / 30% / 30% allocation from `Prices.md`.
 *   5. Looks up transport tranches per destination.
 *
 * The output is consumed by Step 3 (config + per-student detail) and
 * Step 4 (review totals). It is also the input passed to
 * `buildTuitionChargeEntries` / `buildTransportChargeEntriesForDestination`
 * via the `netTrancheAmounts` field — closing the loop on the
 * double-discounting fix.
 *
 * NOTE: This file was previously a stub used only for type inference.
 * It now contains the real implementation; the inline `useMemo` in
 * `batch-registration-modal.tsx` is being migrated to call this function.
 */
import type { Billing, BillingInput, BillingPerStudent, BillingTranche, BillingDiscount } from "./types";
import type { GradeLevel } from "../../../domain/model/student";
import { gradeLevelFromLevelYear, academicLevelFromGradeLevel } from "../../../domain/model/student";
import type { TransportDestination } from "../../../domain/model/parent";
import { TRANSPORT_DESTINATION_LABELS_FR } from "../../../domain/model/parent";
import { LEVEL_LABELS_FR } from "../../../domain/model/student";
import {
  tuitionForGradeLevel,
  getOfficialTuitionDueDates,
  splitNetTuitionByOfficialSchedule,
  getOfficialTransportDueDates,
  getOfficialTransportTrancheSplit,
  evaluateAllSystemDiscounts,
  sumDiscounts,
  type DiscountEvaluation,
} from "../../../domain/calc/pricing";
import type { AcademicCycle } from "../../../domain/model/payment";

/** Map an AcademicLevel to the new AcademicCycle (prescolaire/primaire/cem/lycee). */
function levelToCycle(level: BillingInput["students"][number]["level"]): AcademicCycle {
  // AcademicLevel is "primaire" | "cem" | "lycee" — all map directly.
  // (Preschool is encoded inside primaire via gradeLevel prescolaire_1/2.)
  return level as AcademicCycle;
}

export function computeBilling(input: BillingInput): Billing {
  const { students, pricing, includeRegistration, includeTransport } = input;
  const academicYearStartYear = input.academicYearStartYear ?? new Date().getFullYear();
  const paymentDate = input.paymentDate ?? new Date().toISOString();
  const registrationFee = includeRegistration ? pricing.registrationFee : 0;

  let totalTuition = 0;
  let totalTransport = 0;
  let totalDiscounts = 0;

  const perStudent: BillingPerStudent[] = students.map((s, i) => {
    const gradeLevel: GradeLevel = gradeLevelFromLevelYear(s.level, s.gradeYear);
    const cycle = levelToCycle(s.level);
    const grossTuition = tuitionForGradeLevel(pricing, gradeLevel).annualAmount;

    // === Single-pass discount evaluation on the GROSS annual tuition ===
    const discountEvals: readonly DiscountEvaluation[] = evaluateAllSystemDiscounts({
      grossTuition,
      previousGradeLevel: null, // Not tracked in the batch form yet; pass null.
      currentGradeLevel: gradeLevel,
      childIndex: i + 1,
      paymentPlan: s.paymentPlan,
      paymentDate,
      academicYearStartYear,
      academicYearStart: new Date(Date.UTC(academicYearStartYear, 8, 1)).toISOString(),
      enrollmentDate: new Date().toISOString(), // New enrollment — no seniority.
      previousRank: null, // Not tracked in the batch form yet.
    });
    const tuitionDiscount = sumDiscounts(discountEvals); // negative
    const netTuition = Math.max(0, grossTuition + tuitionDiscount);

    // === Tranche split: 1 (full_annual) or 3 (tranches) ===
    let tranches: BillingTranche[];
    if (s.paymentPlan === "full_annual") {
      const dueDates = getOfficialTuitionDueDates(academicYearStartYear, cycle);
      tranches = [{ label: "Année complète", amountDue: netTuition }];
      void dueDates;
    } else {
      const netParts = splitNetTuitionByOfficialSchedule(netTuition);
      tranches = [
        { label: "Tranche 1 (Sept–Déc)", amountDue: netParts[0] },
        { label: "Tranche 2 (Jan–Mar)", amountDue: netParts[1] },
        { label: "Tranche 3 (Avr–Juin)", amountDue: netParts[2] },
      ];
    }

    // === Transport (no discounts — `Prices.md` defines no transport discounts) ===
    const dest = (includeTransport && s.transportDestination
      ? s.transportDestination
      : null) as TransportDestination | null;
    const transportAmount = dest ? getOfficialTransportTrancheSplit(dest).reduce((a, b) => a + b, 0) : 0;
    const transportTranches: BillingTranche[] = dest
      ? getOfficialTransportTrancheSplit(dest).map((amt, idx) => ({
          label: ["Tranche 1 (À l'inscription)", "Tranche 2 (01 Déc – 15 Déc)", "Tranche 3 (01 Mar – 15 Mar)"][idx],
          amountDue: amt,
        }))
      : [];

    totalTuition += netTuition;
    totalTransport += transportAmount;
    totalDiscounts += tuitionDiscount;

    const discounts: BillingDiscount[] = discountEvals.map((d) => ({
      code: d.code,
      label: d.label,
      amount: d.amount,
      reason: d.reason,
    }));

    return {
      index: i + 1,
      name: `${s.firstName} ${s.lastName}`.trim() || `Élève ${i + 1}`,
      level: LEVEL_LABELS_FR[s.level],
      tuition: grossTuition,
      tuitionDiscount,
      netTuition,
      discounts,
      transport: transportAmount,
      tranches,
      transportTranches,
      transportDestinationLabel: dest ? TRANSPORT_DESTINATION_LABELS_FR[dest] : null,
      paymentPlan: s.paymentPlan,
    };
  });

  // Silence unused-import warning for academicLevelFromGradeLevel (kept for future use).
  void academicLevelFromGradeLevel;
  // Also silence the transportDueDates helper (used by charge builders, not here).
  void getOfficialTransportDueDates;

  return {
    perStudent,
    registrationFee,
    totalTuition,
    totalTransport,
    totalDiscounts,
    grandTotal: registrationFee + totalTuition + totalTransport,
  };
}
