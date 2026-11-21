/**
 * `computeBilling` — the BatchRegistrationModal's billing preview (steps 3/4).
 *
 * E2.4 (2026-11-22): the arithmetic MOVED to the ONE domain engine —
 * `domain/calc/pricing/devis.ts` (`computeFamilyDevis` with the per-year
 * `pricingBasis`). This file is now the THIN feature mapping onto the
 * `Billing` shape (labels + the wizard's display fields); the engine owns
 * every number (DUP-001's consolidation: the preview, the Supabase wires and
 * the mock batchRegister consume the SAME per-student plans).
 *
 * The policy is unchanged from the CALC-001 model (the #4 wiring): per
 * student FI + scolarité + transport − remise; tranches V1/2V/v3 with the
 * remise on V1; family Sous-total − REMBOURSEMENT; 5% early payment of the
 * scolarité only. The per-year pricingBasis (era A 2026-2027 / era B
 * 2027-2026) is resolved from `academicYearStartYear` — never a cemented
 * fallback.
 */
import type { Billing, BillingInput, BillingPerStudent, BillingTranche, BillingDiscount } from "./types";
import type { GradeLevel } from "../../../domain/model/student";
import { gradeLevelFromLevelYear } from "../../../domain/model/student";
import type { TransportDestination } from "../../../domain/model/parent";
import { TRANSPORT_DESTINATION_LABELS_FR } from "../../../domain/model/parent";
import { LEVEL_LABELS_FR } from "../../../domain/model/student";
import {
  computeFamilyDevis,
  resolveDevisPricingBasis,
} from "../../../domain/calc/pricing/devis";

export function computeBilling(input: BillingInput): Billing {
  const { students, pricing, includeRegistration, includeTransport } = input;
  const academicYearStartYear = input.academicYearStartYear ?? new Date().getFullYear();
  const paymentDate = input.paymentDate ?? new Date().toISOString();
  const priorCredit = input.priorCredit ?? 0;
  const priorDebt = input.priorDebt ?? 0;

  const result = computeFamilyDevis({
    students: students.map((s) => ({
      gradeLevel: (s.gradeLevel ?? gradeLevelFromLevelYear(s.level, s.gradeYear)) as GradeLevel,
      remise: Math.max(0, Number(s.remise) || 0),
      chargeStickerPrice: s.chargeStickerPrice,
      transportDestination: (s.transportDestination || null) as TransportDestination | null,
      paymentPlan: s.paymentPlan,
    })),
    pricingConfig: pricing,
    includeRegistration,
    includeTransport,
    academicYearStartYear,
    paymentDate,
    priorCredit,
    basis: resolveDevisPricingBasis(academicYearStartYear),
  });

  const perStudent: BillingPerStudent[] = result.perStudent.map((line, i) => {
    const s = students[i];
    const plan = line.plan;
    const dest = (includeTransport && s.transportDestination
      ? s.transportDestination
      : null) as TransportDestination | null;

    const tranches: BillingTranche[] =
      s.paymentPlan === "full_annual"
        ? [{ label: "Année complète", amountDue: plan.devis }]
        : [
            { label: "Tranche 1 (V1)", amountDue: plan.tuitionTranches[0] },
            { label: "Tranche 2 (2V)", amountDue: plan.tuitionTranches[1] },
            { label: "Tranche 3 (v3)", amountDue: plan.tuitionTranches[2] },
          ];

    const transportTranches: BillingTranche[] = dest
      ? [
          { label: "Transport — Tranche 1 (à l'inscription)", amountDue: plan.transportTranches[0] },
          { label: "Transport — Tranche 2 (déc.)", amountDue: plan.transportTranches[1] },
          { label: "Transport — Tranche 3 (mars)", amountDue: plan.transportTranches[2] },
        ]
      : [];

    const discounts: BillingDiscount[] = [
      ...(plan.remise > 0
        ? [{
            code: "negotiated_remise",
            label: "Remise négociée",
            amount: -plan.remise,
            reason: "Remise négociée (saisie manuelle — déduite de la tranche V2)",
          }]
        : []),
      ...line.discounts.map((d) => ({
        code: d.code,
        label: d.label,
        amount: d.amount,
        reason: d.reason,
      })),
    ];

    return {
      index: i + 1,
      name: `${s.firstName} ${s.lastName}`.trim() || `Élève ${i + 1}`,
      level: LEVEL_LABELS_FR[s.level],
      registrationFee: plan.fi,
      tuition: plan.scolarite,
      remise: plan.remise,
      netTuition: line.netTuition,
      discounts,
      transport: plan.transport,
      tranches,
      transportTranches,
      transportDestinationLabel: dest ? TRANSPORT_DESTINATION_LABELS_FR[dest] : null,
      paymentPlan: s.paymentPlan,
      devis: plan.devis,
      earlyPaymentDiscount: 0, // family-level (result.totalEarlyPaymentDiscount)
    };
  });

  return {
    perStudent,
    registrationFee: result.registrationFee,
    totalTuition: result.totalTuition,
    totalTransport: result.totalTransport,
    totalRemise: result.totalRemise,
    priorCredit,
    priorDebt,
    subTotal: result.subTotal,
    grandTotal: result.grandTotal,
    totalEarlyPaymentDiscount: result.totalEarlyPaymentDiscount,
  };
}

// Re-export for downstream charge builders that need the sibling default.
export { SIBLING_REMISE_PER_CHILD } from "../../../domain/calc/pricing/school-price-matrix";
