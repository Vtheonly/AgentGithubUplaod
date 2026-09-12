/**
 * `computeBilling` — pure billing computation for the BatchRegistrationModal.
 *
 * CALC-001 (2026-09-12): reimplemented on the REAL 2026/2027 school model
 * extracted from `Suivis clients  2026_2027.xlsx` (see
 * `domain/calc/pricing/school-price-matrix.ts`). The previous implementation
 * was built on a fictional price book (flat family FI, 10% early discount on
 * the whole gross, 40/30/30 split of the net, 4 transport zones).
 *
 * The REAL model (per the workbook's own formulas):
 *   1. Per student: FI (per grade) + scolarité (per grade) + transport
 *      (per town) − remise (negotiated, per student) = the per-student devis.
 *   2. Tranches: FI first (at registration), then V2 / 2V / v3 where
 *      2V = v3 = fixed per class and the REMISE is deducted from V2 ONLY
 *      (the workbook's S-column formulas: `=122000-J58`).
 *   3. Family totals: Sous-total = Σ devis; Montant Total = Sous-total −
 *      priorCredit (REMBOURSEMENT); prior debt (DETTES) tracked separately.
 *   4. Early payment: 5% of Σ scolarité (FI and transport excluded) when
 *      paid in full before June 30 — the Devis sheet's `=+SUM(F…)*0.05`.
 *   5. STICKER-PRICE CASE: `chargeStickerPrice` reproduces the workbook's
 *      SEDIKI rows (remise recorded but NOT subtracted from the devis).
 *
 * The output is consumed by Step 3 (config + per-student detail) and
 * Step 4 (review totals). It is also the input passed to
 * `buildTuitionChargeEntries` / `buildTransportChargeEntriesForDestination`
 * via the `netTrancheAmounts` field — closing the loop on the
 * double-discounting fix.
 */
import type { Billing, BillingInput, BillingPerStudent, BillingTranche, BillingDiscount } from "./types";
import type { GradeLevel } from "../../../domain/model/student";
import { gradeLevelFromLevelYear } from "../../../domain/model/student";
import type { TransportDestination } from "../../../domain/model/parent";
import { TRANSPORT_DESTINATION_LABELS_FR } from "../../../domain/model/parent";
import { LEVEL_LABELS_FR } from "../../../domain/model/student";
import {
  REAL_TUITION_BY_GRADE,
  REAL_FI_BY_GRADE,
  REAL_TRANSPORT_MATRIX,
  EARLY_PAYMENT_RATE,
  earlyPaymentCutoff,
} from "../../../domain/calc/pricing/school-price-matrix";
import {
  evaluateAllSystemDiscounts,
  sumDiscounts,
  SIBLING_REMISE_PER_CHILD,
  type DiscountEvaluation,
} from "../../../domain/calc/pricing";

export function computeBilling(input: BillingInput): Billing {
  const { students, pricing, includeRegistration, includeTransport } = input;
  const academicYearStartYear = input.academicYearStartYear ?? new Date().getFullYear();
  const paymentDate = input.paymentDate ?? new Date().toISOString();
  const priorCredit = input.priorCredit ?? 0;
  const priorDebt = input.priorDebt ?? 0;

  let totalTuition = 0; // Σ gross scolarité
  let totalTransport = 0;
  let totalRemise = 0; // positive number = total reduction
  let totalFi = 0;

  const perStudent: BillingPerStudent[] = students.map((s, i) => {
    const gradeLevel: GradeLevel = gradeLevelFromLevelYear(s.level, s.gradeYear);
    const remise = Math.max(0, Number(s.remise) || 0);

    // === FI per student, per grade (NEVER once per family) ===
    const fi = includeRegistration
      ? (pricing.registrationFeeByGrade?.[gradeLevel] ?? REAL_FI_BY_GRADE[gradeLevel])
      : 0;

    // === Scolarité sticker (real matrix; PricingConfig takes precedence
    // when the admin has overridden it) ===
    const configSchedule = pricing.tuitionByGradeLevel?.[gradeLevel];
    const realSchedule = REAL_TUITION_BY_GRADE[gradeLevel];
    const scolarite = configSchedule && configSchedule.annualAmount > 0
      ? configSchedule.annualAmount
      : realSchedule.scolarite;

    // === Deterministic discount rules (sibling default only — the remise
    // itself is the negotiated manual input) ===
    const discountEvals: readonly DiscountEvaluation[] = evaluateAllSystemDiscounts({
      grossScolarite: scolarite,
      childIndex: i + 1,
      paymentPlan: s.paymentPlan,
      paymentDate,
      academicYearStartYear,
    });
    const deterministicDiscount = sumDiscounts(discountEvals); // negative

    // === STICKER-PRICE CASE: remise NOT subtracted from the devis ===
    const remiseAppliedToDevis = s.chargeStickerPrice ? 0 : remise;

    // === Transport per town ===
    const dest = (includeTransport && s.transportDestination
      ? s.transportDestination
      : null) as TransportDestination | null;
    const transportSchedule = dest ? REAL_TRANSPORT_MATRIX[dest] : null;
    const transportAmount = transportSchedule ? transportSchedule[0] : 0;

    // === Per-student devis (workbook column L): FI + scol + transport − remise ===
    const devis = fi + scolarite + transportAmount - remiseAppliedToDevis;

    // === Tranches: V2 = V2_sticker − remise; 2V = v3 = fixed ===
    // Config override wins when the admin customized the schedule; otherwise
    // the real matrix's V2/2V/v3 stickers apply with the remise on V2.
    let v2: number;
    let fixed3: number;
    let fixed4: number;
    if (configSchedule && configSchedule.installments && configSchedule.installments[0] > 0) {
      const inst = configSchedule.installments as readonly [number, number, number];
      v2 = inst[0] - remise; // remise always lands on V2
      fixed3 = inst[1];
      fixed4 = inst[2];
    } else {
      v2 = realSchedule.v2 - remise;
      fixed3 = realSchedule.tranche3;
      fixed4 = realSchedule.tranche4;
    }

    const tranches: BillingTranche[] =
      s.paymentPlan === "full_annual"
        ? [{ label: "Année complète", amountDue: fi + scolarite + transportAmount - remiseAppliedToDevis }]
        : [
            { label: "Tranche 2 (V2)", amountDue: v2 },
            { label: "Tranche 3 (2V)", amountDue: fixed3 },
            { label: "Tranche 4 (v3)", amountDue: fixed4 },
          ];

    const transportTranches: BillingTranche[] = transportSchedule
      ? [
          { label: "Transport — Tranche 1 (à l'inscription)", amountDue: transportSchedule[1] },
          { label: "Transport — Tranche 2 (déc.)", amountDue: transportSchedule[2] },
          { label: "Transport — Tranche 3 (mars)", amountDue: transportSchedule[3] },
        ]
      : [];

    totalTuition += scolarite;
    totalTransport += transportAmount;
    totalRemise += remise;
    totalFi += fi;

    const discounts: BillingDiscount[] = [
      ...(remise > 0
        ? [{
            code: "negotiated_remise",
            label: "Remise négociée",
            amount: -remise,
            reason: "Remise négociée (saisie manuelle — déduite de la tranche V2)",
          }]
        : []),
      ...discountEvals.map((d) => ({
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
      registrationFee: fi,
      tuition: scolarite,
      remise,
      netTuition: Math.max(0, scolarite + deterministicDiscount - remise),
      discounts,
      transport: transportAmount,
      tranches,
      transportTranches,
      transportDestinationLabel: dest ? TRANSPORT_DESTINATION_LABELS_FR[dest] : null,
      paymentPlan: s.paymentPlan,
      devis,
      earlyPaymentDiscount: 0, // filled below at family level
    };
  });

  // === Early payment: 5% of Σ scolarité (FI + transport excluded), only
  // when EVERY student is full_annual and the settlement precedes June 30.
  const allFullAnnual = students.length > 0 && students.every((s) => s.paymentPlan === "full_annual");
  let totalEarlyPaymentDiscount = 0;
  if (allFullAnnual) {
    const when = new Date(paymentDate);
    if (when.getTime() <= earlyPaymentCutoff(academicYearStartYear).getTime()) {
      totalEarlyPaymentDiscount = Math.round(totalTuition * EARLY_PAYMENT_RATE);
    }
  }

  const subTotal = totalFi + totalTuition + totalTransport - totalRemise;
  const grandTotal = Math.max(0, subTotal - priorCredit);

  return {
    perStudent,
    registrationFee: totalFi,
    totalTuition,
    totalTransport,
    totalRemise,
    priorCredit,
    priorDebt,
    subTotal,
    grandTotal,
    totalEarlyPaymentDiscount,
  };
}

// Re-export for downstream charge builders that need the sibling default.
export { SIBLING_REMISE_PER_CHILD };
