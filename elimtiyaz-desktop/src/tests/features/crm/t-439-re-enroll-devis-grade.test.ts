/**
 * T-439 — UI-320 regression suite: the ReEnrollModal's devis prices by the
 * CONFIRMED grade (the shown-vs-persisted parity).
 *
 * THE BUG (registered before the fix per §13): the modal's `computeBilling`
 * input carried `level: "primaire", gradeYear: 1` HARDCODED — every
 * re-enrollment into any grade other than 1AP quoted primaire first-year
 * rates (FI, scolarité, tranches, grand total) while the PERSISTED wires
 * billed the confirmed `gradeLevelCode`. A lycée student was shown primaire
 * prices; the parent signed against numbers the system would not persist
 * (the §15.69 shown-vs-persisted rule violated by the very session that
 * codified it). No test caught it because the UI suite asserted labels
 * only.
 *
 * THE FIX: an additive optional `gradeLevel` override on the billing input
 * (the lossless path — the naive level/gradeYear derivation is LOSSY for
 * `prescolaire_1`, which round-trips to the differently-priced
 * `prescolaire_2`), consumed by `computeBilling` ahead of the level/year
 * pair, wired from the modal's confirmed code (and the useMemo dependency
 * so the quote recomputes on grade change).
 */
import { describe, expect, it } from "vitest";

import { computeBilling } from "../../../features/crm/batch-registration/compute-billing";
import { buildRegistrationBillingWires } from "../../../infrastructure/supabase/repositories/registration-billing-wires";
import { defaultPricingConfig } from "../../../infrastructure/mock/pricing-seed";
import { REAL_TUITION_BY_GRADE, REAL_FI_BY_GRADE } from "../../../domain/calc/pricing/school-price-matrix";
import { gradeLevelFromLevelYear } from "../../../domain/model/student";
import type { Step2Student } from "../../../features/crm/batch-registration/types";

const YEAR = 2027;

function devisStudent(gradeLevel: string, transport = false): Step2Student {
  return {
    firstName: "Test",
    middleName: "",
    lastName: "T439",
    gender: "unspecified",
    birthDate: "",
    level: "primaire",
    gradeYear: 1,
    gradeLevel: gradeLevel as Step2Student["gradeLevel"],
    filiereCode: "",
    specialiteCode: "",
    classId: "",
    transportDestination: transport ? "boumerdes" as const : "",
    medicalNotes: "",
    paymentPlan: "tranches",
    remise: "0",
    chargeStickerPrice: false,
    originType: "",
    previousSchoolName: "",
    previousSchoolLevel: "",
    previousAcademicYear: "",
    originNotes: "",
  };
}

describe("T-439 / UI-320 — the gradeLevel override prices the devis", () => {
  it("a 3AM re-enrollment devis quotes CEM prices, NOT the hardcoded 1AP", () => {
    const billing = computeBilling({
      students: [devisStudent("3am")],
      pricing: defaultPricingConfig,
      includeRegistration: true,
      includeTransport: false,
      academicYearStartYear: YEAR,
    });
    const per = billing.perStudent[0];
    // The scolarité must be the 3AM matrix price — the 1AP hardcode quoted
    // the 1AP price (the bug: a CEM student shown primaire rates).
    expect(per.tuition).toBe(REAL_TUITION_BY_GRADE["3am"].scolarite);
    expect(per.tuition).not.toBe(REAL_TUITION_BY_GRADE["1ap"].scolarite);
    expect(per.registrationFee).toBe(REAL_FI_BY_GRADE["3am"]);
  });

  it("every non-prescolaire grade prices by ITS OWN matrix row (not 1ap)", () => {
    for (const g of ["2ap", "3ap", "4ap", "5ap", "1am", "2am", "3am", "4am", "1ere_annee", "2eme_annee", "3eme_annee"] as const) {
      const billing = computeBilling({
        students: [devisStudent(g)],
        pricing: defaultPricingConfig,
        includeRegistration: true,
        includeTransport: false,
        academicYearStartYear: YEAR,
      });
      expect(billing.perStudent[0].tuition).toBe(REAL_TUITION_BY_GRADE[g].scolarite);
    }
  });

  it("prescolaire_1 prices at ITS OWN row (the lossless path — the level/year derivation is lossy: primaire/0 → prescolaire_2)", () => {
    const billing = computeBilling({
      students: [devisStudent("prescolaire_1")],
      pricing: defaultPricingConfig,
      includeRegistration: true,
      includeTransport: false,
      academicYearStartYear: YEAR,
    });
    expect(billing.perStudent[0].tuition).toBe(REAL_TUITION_BY_GRADE.prescolaire_1.scolarite);
    // The derivation the override replaces would have said prescolaire_2:
    expect(gradeLevelFromLevelYear("primaire", 0)).toBe("prescolaire_2");
    expect(REAL_TUITION_BY_GRADE.prescolaire_1.scolarite).not.toBe(REAL_TUITION_BY_GRADE.prescolaire_2.scolarite);
  });

  it("ABSENT override keeps the historical derivation (the wizard path byte-identical)", () => {
    const wizard = { ...devisStudent("1ap"), gradeLevel: undefined };
    const billing = computeBilling({
      students: [wizard],
      pricing: defaultPricingConfig,
      includeRegistration: true,
      includeTransport: false,
      academicYearStartYear: YEAR,
    });
    expect(billing.perStudent[0].tuition).toBe(REAL_TUITION_BY_GRADE["1ap"].scolarite);
  });

  it("THE PARITY PIN: the shown devis and the persisted wires bill the SAME amounts for a non-1AP grade", () => {
    const grade = "3am" as const;
    // The modal's devis (shown)…
    const billing = computeBilling({
      students: [devisStudent(grade)],
      pricing: defaultPricingConfig,
      includeRegistration: true,
      includeTransport: false,
      academicYearStartYear: YEAR,
    });
    // …and the persisted wires (buildRegistrationBillingWires — what
    // reEnroll actually writes through fn_re_enroll_student).
    const { ledgerWire, installmentWire } = buildRegistrationBillingWires({
      tenantId: "00000000-0000-0000-0000-000000000001",
      parentCode: "PAR-T439",
      students: [
        {
          studentCode: "ELV-T439",
          studentRef: 0,
          gradeLevel: grade,
          paymentPlan: "tranches",
          transportTier: null,
          remise: 0,
          chargeStickerPrice: false,
        },
      ],
      pricingConfig: defaultPricingConfig,
      includeRegistration: true,
      includeTransport: false,
      year: YEAR,
      at: `${YEAR}-09-01T10:00:00.000Z`,
      parentTransportDestination: null,
      sourceIdScope: { prefix: `re-${YEAR}-${YEAR + 1}`, yearCode: `${YEAR}-${YEAR + 1}` },
    });
    // The tranches: the devis's per-tranche stickers vs the wires' amounts.
    const wireTuition = installmentWire.filter((w) => w.category === "tuition");
    expect(wireTuition).toHaveLength(3);
    const wireTotal = wireTuition.reduce((s, w) => s + (w.amount_due as number), 0);
    const wireFi = (ledgerWire.find((l) => l.category === "other")?.amount as number) ?? 0;
    // The devis total (grand total) = the wires' tuition total + the FI.
    expect(billing.perStudent.reduce((s2, p2) => s2 + p2.registrationFee, 0)).toBe(wireFi);
    expect(billing.totalTuition).toBe(wireTotal);
    expect(billing.grandTotal).toBe(wireTotal + wireFi);
  });
});
