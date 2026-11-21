/**
 * E2.4 — the Devis service verification suite (ROADMAP 1.4–1.7).
 *
 * The ONE domain engine (`domain/calc/pricing/devis.ts`) with the per-year
 * pricingBasis, verified against EACH actual workbook's OWN artifact
 * INDIVIDUALLY (the v2.3 One-By-One gate — never a combined run):
 *
 *   A. Era A (workbook A — `Suivis clients  2026_2027.xlsx`): the engine's
 *      #4-wiring outputs on the era-A basis are IDENTICAL to the
 *      pre-conversion computeBilling arithmetic (the equivalence matrix,
 *      pinned on the E2.3 fixture's own representativeDevis vectors + the
 *      sibling/sticker/full-annual/transport/early-payment lanes).
 *   B. Era B (workbook B — `2027-2026.xlsx`): the per-grade folded-sticker
 *      table (V1+2V+v3 = FI+scolarité, the remise on V1 only) cross-checked
 *      against the E2.3 census modes per class INDIVIDUALLY, the two
 *      documented conservation deltas (MS/GS), the 3AP/4AP/5AP class-code
 *      overrides, and the devis-formula convention (FI+scolarité+transport−remise
 *      — workbook B's own `=FI+SOL[+TRANSPORT]−J` formulas).
 *   C. The era-separation delta (R-2): the same grade prices STRUCTURALLY
 *      differently per era (the folded vs separate FI) and the diverging
 *      class codes carry genuinely different scolarités.
 *   D. resolveDevisPricingBasis — the MONOTONE year matrix (never cementing
 *      the stale 2026-2027 fallback for a newer year).
 *   E. The config-override precedence — era A honors the admin config (the
 *      #4 wiring); era B (R-2) does NOT let the era-A-seeded GLOBAL config
 *      overwrite the era-B pricing of record.
 *   F. THE PARITY PIN (DUP-037's death): the mock batchRegister and the
 *      Supabase registration wires produce the SAME installment plan
 *      (category, label, amount, due date) for the same wizard input —
 *      in BOTH eras.
 *   G. BUG-028: the mock refund's actorId is REQUIRED (the domain
 *      contract's own signature — the parity pin).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ERA_2026_2027_BASIS,
  ERA_2027_2026_BASIS,
  resolveDevisPricingBasis,
  computeStudentDevisPlan,
  computeFamilyDevis,
} from "../../domain/calc/pricing/devis";
import {
  REAL_FI_BY_GRADE,
  REAL_TUITION_BY_GRADE,
  REAL_TRANSPORT_MATRIX,
} from "../../domain/calc/pricing/school-price-matrix";
import { computeBilling } from "../../features/crm/batch-registration/compute-billing";
import { defaultPricingConfig } from "../../infrastructure/mock/pricing-seed";
import { buildRegistrationBillingWires } from "../../infrastructure/supabase/repositories/registration-billing-wires";
import type { GradeLevel } from "../../domain/model/student";
import type { TransportDestination } from "../../domain/model/parent";

/* ------------------------------------------------------------------ */
/* Fixtures (the E2.3 artifacts of record — one era per file)          */
/* ------------------------------------------------------------------ */

const FIXTURE_DIR = path.join(__dirname, "pricing", "fixtures", "devis");
const fixtureA = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "era-2026-2027.json"), "utf8"),
) as {
  era: string;
  provenance: { workbook: string; sha256: string };
  fiByGrade: Record<string, number>;
  tuitionByGrade: Record<string, { scolarite: number; v2: number; tranche3: number; tranche4: number }>;
  representativeDevis: { grade: string; fi: number; scolarite: number; remise: number; devisAnnuel: number }[];
};
const fixtureB = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "era-2027-2026.json"), "utf8"),
) as {
  era: string;
  provenance: { workbook: string; sha256: string };
  extraction: {
    perClass: { classCode: string; niveau: string; devisAnnuelMode: number; v1Mode: number; v2Mode: number; v3Mode: number }[];
  };
};

const GRADES = Object.keys(REAL_TUITION_BY_GRADE) as GradeLevel[];
const censusB = new Map(fixtureB.extraction.perClass.map((c) => [c.classCode, c]));

/* A canonical wizard student for the preview parity lanes. */
function wizardStudent(grade: GradeLevel, over: Partial<{
  remise: string; chargeStickerPrice: boolean; paymentPlan: "full_annual" | "tranches";
  transportDestination: TransportDestination | ""; level: "primaire" | "college" | "lycee" | "prescolaire";
  gradeYear: number; gradeLevel: GradeLevel;
}> = {}): Record<string, unknown> {
  return {
    firstName: "Élève",
    middleName: "",
    lastName: "Sonde",
    gender: "unspecified",
    birthDate: "2015-01-01",
    level: over.level ?? "primaire",
    gradeYear: 1,
    gradeLevel: over.gradeLevel ?? grade,
    filiereCode: "",
    specialiteCode: "",
    classId: "",
    transportDestination: over.transportDestination ?? "",
    medicalNotes: "",
    paymentPlan: over.paymentPlan ?? "tranches",
    remise: over.remise ?? "0",
    chargeStickerPrice: over.chargeStickerPrice ?? false,
    originType: "",
    previousSchoolName: "",
    previousSchoolLevel: "",
    previousAcademicYear: "",
    originNotes: "",
  };
}

/* ================================================================== */
/* A. Era A — the equivalence matrix (the #4 wiring, unchanged)        */
/* ================================================================== */

describe("E2.4 — A. era A: the engine reproduces the #4-wiring arithmetic exactly", () => {
  it("the era-A basis IS the REAL matrix (the E2.3 fixture, byte-for-byte)", () => {
    expect(ERA_2026_2027_BASIS.provenance.sha256).toBe(fixtureA.provenance.sha256);
    expect(ERA_2026_2027_BASIS.fiPlacement).toBe("separate-tranche");
    for (const g of GRADES) {
      expect(ERA_2026_2027_BASIS.gradeRows[g].fi).toBe(REAL_FI_BY_GRADE[g]);
      expect(ERA_2026_2027_BASIS.gradeRows[g].scolarite).toBe(REAL_TUITION_BY_GRADE[g].scolarite);
      expect(ERA_2026_2027_BASIS.gradeRows[g].tranches).toEqual([
        REAL_TUITION_BY_GRADE[g].v2,
        REAL_TUITION_BY_GRADE[g].tranche3,
        REAL_TUITION_BY_GRADE[g].tranche4,
      ]);
      // …and the fixture agrees with the matrix per grade.
      expect(fixtureA.fiByGrade[g]).toBe(REAL_FI_BY_GRADE[g]);
      expect(fixtureA.tuitionByGrade[g].scolarite).toBe(REAL_TUITION_BY_GRADE[g].scolarite);
    }
  });

  it("the fixture's representativeDevis vectors price EXACTLY through computeBilling", () => {
    for (const v of fixtureA.representativeDevis) {
      const billing = computeBilling({
        students: [wizardStudent(v.grade as GradeLevel, { remise: String(v.remise) })] as never,
        pricing: defaultPricingConfig,
        includeRegistration: true,
        includeTransport: false,
        academicYearStartYear: 2026,
      });
      expect(billing.perStudent[0].devis).toBe(v.devisAnnuel);
      expect(billing.perStudent[0].registrationFee).toBe(v.fi);
      expect(billing.perStudent[0].tuition).toBe(v.scolarite);
      expect(billing.grandTotal).toBe(v.devisAnnuel);
    }
  });

  it("the per-student tranches: the V1 sticker minus the remise, 2V/v3 fixed (the S-column rule)", () => {
    const plan = computeStudentDevisPlan(
      { gradeLevel: "1am", remise: 5000 },
      ERA_2026_2027_BASIS,
    );
    // 1AAM: V1 122000 − 5000, 2V 91500, v3 91500 — the `=122000-J58` formula.
    expect(plan.tuitionTranches).toEqual([117_000, 91_500, 91_500]);
    expect(plan.fiFoldedIntoFirstTranche).toBe(false);
    expect(plan.devis).toBe(25_000 + 305_000 - 5_000);
  });

  it("the sticker-price case: the devis keeps the FULL sticker, the V1 tranche still takes the remise (SEDIKI)", () => {
    const plan = computeStudentDevisPlan(
      { gradeLevel: "1am", remise: 5000, chargeStickerPrice: true },
      ERA_2026_2027_BASIS,
    );
    expect(plan.devis).toBe(25_000 + 305_000); // the remise NOT subtracted
    expect(plan.remiseAppliedToDevis).toBe(0);
    expect(plan.tuitionTranches[0]).toBe(117_000); // …but V1 still reduced
  });

  it("the family preview: per-student FI, transport per town, the early-payment 5% of the scolarité ONLY", () => {
    const result = computeFamilyDevis({
      students: [
        { gradeLevel: "prescolaire_2", paymentPlan: "full_annual" },
        { gradeLevel: "1ap", paymentPlan: "full_annual", transportDestination: "boudouaou" },
      ],
      includeRegistration: true,
      includeTransport: true,
      academicYearStartYear: 2026,
      paymentDate: "2026-06-15T00:00:00.000Z", // before the June 30 cutoff
    });
    // FI: 18000 + 25000 (PER STUDENT — never a flat family fee).
    expect(result.registrationFee).toBe(18_000 + 25_000);
    // Scolarité: 165000 + 220000; transport BOUDOUAOU 52000.
    expect(result.totalTuition).toBe(165_000 + 220_000);
    expect(result.totalTransport).toBe(52_000);
    // Early payment: 5% of Σ scolarité (FI + transport EXCLUDED).
    expect(result.totalEarlyPaymentDiscount).toBe(Math.round((165_000 + 220_000) * 0.05));
    // Sub-total = FI + scol + transport − remise (remise 0 here).
    expect(result.subTotal).toBe(18_000 + 25_000 + 165_000 + 220_000 + 52_000);
  });

  it("computeBilling full_annual renders the single Année complète line (the devis)", () => {
    const billing = computeBilling({
      students: [wizardStudent("3am", { paymentPlan: "full_annual" })] as never,
      pricing: defaultPricingConfig,
      includeRegistration: true,
      includeTransport: false,
      academicYearStartYear: 2026,
    });
    expect(billing.perStudent[0].tranches).toEqual([
      { label: "Année complète", amountDue: 25_000 + 330_000 },
    ]);
  });

  it("the sibling default is a DISPLAY line — never the installment plan (DUP-001)", () => {
    // Two children, child #2 carries the −5000 sibling line in the preview…
    const billing = computeBilling({
      students: [
        wizardStudent("1ap"),
        wizardStudent("2ap"),
      ] as never,
      pricing: defaultPricingConfig,
      includeRegistration: true,
      includeTransport: false,
      academicYearStartYear: 2026,
    });
    expect(billing.perStudent[1].discounts.some((d) => d.code === "sibling_fixed")).toBe(true);
    // …but BOTH students' tranches are the full stickers (no discount split).
    expect(billing.perStudent[0].tranches.map((t) => t.amountDue)).toEqual([89_000, 65_500, 65_500]);
    expect(billing.perStudent[1].tranches.map((t) => t.amountDue)).toEqual([97_000, 71_500, 71_500]);
  });

  it("a remise exceeding the V1 sticker clamps at 0 (never a negative charge)", () => {
    const plan = computeStudentDevisPlan(
      { gradeLevel: "1ap", remise: 200_000 },
      ERA_2026_2027_BASIS,
    );
    expect(plan.tuitionTranches[0]).toBe(0);
    expect(plan.tuitionTranches[1]).toBe(65_500);
  });
});

/* ================================================================== */
/* B. Era B — the folded-sticker table vs the census, per class        */
/* ================================================================== */

describe("E2.4 — B. era B: the folded per-class sticker table (workbook B ALONE)", () => {
  it("the era-B provenance is workbook B (SHA pinned)", () => {
    expect(ERA_2027_2026_BASIS.provenance.sha256).toBe(fixtureB.provenance.sha256);
    expect(ERA_2027_2026_BASIS.fiPlacement).toBe("folded-into-first");
  });

  it("EVERY grade row: V1+2V+v3 = FI + scolarité (the folded invariant), except the two DOCUMENTED deltas", () => {
    const documentedDeltas: Partial<Record<GradeLevel, number>> = {
      prescolaire_1: -23_000, // MS — the census's own tranche sum (130 000)
      prescolaire_2: -3_000, // GS — the census's own tranche sum (180 000)
    };
    for (const g of GRADES) {
      const row = ERA_2027_2026_BASIS.gradeRows[g];
      const sum = row.tranches[0] + row.tranches[1] + row.tranches[2];
      expect(sum).toBe(row.fi + row.scolarite + (documentedDeltas[g] ?? 0));
    }
  });

  it("the clean-census classes match the E2.3 modes EXACTLY (each class individually)", () => {
    // The classes whose census V1/2V/v3 modes are uncontaminated by remises.
    const clean: [GradeLevel, string][] = [
      ["1ap", "CP"], ["1am", "1AAM"], ["3am", "3AAM"],
      ["1ere_annee", "1ER"], ["3eme_annee", "3EM"],
    ];
    for (const [grade, classCode] of clean) {
      const c = censusB.get(classCode)!;
      const row = ERA_2027_2026_BASIS.gradeRows[grade];
      expect(row.tranches).toEqual([c.v1Mode, c.v2Mode, c.v3Mode]);
    }
  });

  it("the remise-contaminated V1 modes are RECONSTRUCTED (sticker = census mode + the observed remise)", () => {
    // CE1: census v1 101 000 = 106 000 − 5 000 (the workbook's own r4 row:
    // remise 5 000 → V1 101 000). The same −5 000 contamination: CE2/CM1/CM2
    // (107 000/109 000/115 000) and 2AAM/4AAM (133 000/143 000).
    const reconstructed: [GradeLevel, string, number][] = [
      ["2ap", "CE1", 106_000],
      ["3ap", "CE2", 112_000],
      ["4ap", "CM1", 114_000],
      ["5ap", "CM2", 120_000],
      ["2am", "2AAM", 138_000],
      ["4am", "4AAM", 148_000],
    ];
    for (const [grade, classCode, v1] of reconstructed) {
      const c = censusB.get(classCode)!;
      const row = ERA_2027_2026_BASIS.gradeRows[grade];
      expect(row.tranches[0]).toBe(v1);
      expect(c.v1Mode).toBe(v1 - 5_000); // the census mode is the remise-net value
      expect(row.tranches[1]).toBe(c.v2Mode);
      expect(row.tranches[2]).toBe(c.v3Mode);
    }
  });

  it("the FI/scolarité per grade are workbook B's OWN devis-formula components (= era A's)", () => {
    // Verified against the `=FI+SOL[+TRANSPORT]−J` formulas per class (e.g.
    // CE1 `=25000+205000+35000-J2`, 1AAM `=25000+305000-J36`).
    for (const g of GRADES) {
      expect(ERA_2027_2026_BASIS.gradeRows[g].fi).toBe(REAL_FI_BY_GRADE[g]);
      expect(ERA_2027_2026_BASIS.gradeRows[g].scolarite).toBe(REAL_TUITION_BY_GRADE[g].scolarite);
    }
  });

  it("the class-code overrides: 3AP/4AP/5AP carry genuinely different scolarités (workbook B's own formulas)", () => {
    const c3ap = ERA_2027_2026_BASIS.classEntries["3AP"]!;
    expect(c3ap.scolarite).toBe(220_000); // ≠ CE2's 255 000
    expect(c3ap.fi + c3ap.scolarite).toBe(c3ap.tranches![0] + c3ap.tranches![1] + c3ap.tranches![2]);
    const c4ap = ERA_2027_2026_BASIS.classEntries["4AP"]!;
    expect(c4ap.scolarite).toBe(230_000); // ≠ CM1's 265 000
    const c5ap = ERA_2027_2026_BASIS.classEntries["5AP"]!;
    expect(c5ap.scolarite).toBe(250_000); // ≠ CM2's 270 000
    // …and the classCode input routes to the override.
    const byCode = computeStudentDevisPlan(
      { gradeLevel: "3ap", classCode: "3AP" },
      ERA_2027_2026_BASIS,
    );
    expect(byCode.scolarite).toBe(220_000);
    expect(byCode.devis).toBe(25_000 + 220_000);
  });

  it("the era-B transport matrix is the era-A per-town matrix (workbook B's 1T/T2/t3 observations match)", () => {
    expect(ERA_2027_2026_BASIS.transportMatrix).toBe(REAL_TRANSPORT_MATRIX);
  });

  it("the era-B student plan: the FI folded into V1, the remise on V1 only", () => {
    const plan = computeStudentDevisPlan(
      { gradeLevel: "1am", remise: 10_000 },
      ERA_2027_2026_BASIS,
    );
    // 1AAM era B: [132000, 99000, 99000] — the remise lands on V1.
    expect(plan.tuitionTranches).toEqual([122_000, 99_000, 99_000]);
    expect(plan.fiFoldedIntoFirstTranche).toBe(true);
    // The devis keeps the workbook-A convention: FI + scol + transport − remise.
    expect(plan.devis).toBe(25_000 + 305_000 - 10_000);
  });

  it("includeRegistration=false unfolds the FI from V1 (never double-counted, never lost)", () => {
    const plan = computeStudentDevisPlan(
      { gradeLevel: "1am" },
      ERA_2027_2026_BASIS,
      { includeRegistration: false },
    );
    expect(plan.fi).toBe(0);
    expect(plan.devis).toBe(305_000);
    // V1 loses exactly the FI component: 132000 − 25000 = 107000.
    expect(plan.tuitionTranches).toEqual([107_000, 99_000, 99_000]);
  });
});

/* ================================================================== */
/* C+D. The era separation + the monotone year resolution              */
/* ================================================================== */

describe("E2.4 — C/D. the era-separation delta (R-2) + the monotone basis resolution", () => {
  it("the same grade prices STRUCTURALLY differently per era (the folded vs separate FI)", () => {
    const a = computeStudentDevisPlan({ gradeLevel: "3am" }, ERA_2026_2027_BASIS);
    const b = computeStudentDevisPlan({ gradeLevel: "3am" }, ERA_2027_2026_BASIS);
    // Era A: FI separate + [132000, 99000, 99000] tuition-only.
    expect(a.fi).toBe(25_000);
    expect(a.tuitionTranches).toEqual([132_000, 99_000, 99_000]);
    expect(a.fiFoldedIntoFirstTranche).toBe(false);
    // Era B: FI folded — [142000, 106500, 106500] sums to FI+scolarité.
    expect(b.tuitionTranches).toEqual([142_000, 106_500, 106_500]);
    expect(b.fiFoldedIntoFirstTranche).toBe(true);
    // …and the totals agree on the devis convention (FI+scol unchanged).
    expect(a.devis).toBe(b.devis);
  });

  it("resolveDevisPricingBasis is MONOTONE (the newest basis ≤ the year — never the stale fallback)", () => {
    expect(resolveDevisPricingBasis(2025)).toBe(ERA_2026_2027_BASIS);
    expect(resolveDevisPricingBasis(2026)).toBe(ERA_2026_2027_BASIS);
    expect(resolveDevisPricingBasis(2027)).toBe(ERA_2027_2026_BASIS);
    expect(resolveDevisPricingBasis(2028)).toBe(ERA_2027_2026_BASIS);
    expect(resolveDevisPricingBasis(2097)).toBe(ERA_2027_2026_BASIS);
  });

  it("the family preview rides the year: a 2027 registration prices on era B", () => {
    const r = computeFamilyDevis({
      students: [{ gradeLevel: "1am", paymentPlan: "tranches" }],
      includeRegistration: true,
      includeTransport: false,
      academicYearStartYear: 2027,
    });
    expect(r.basis).toBe(ERA_2027_2026_BASIS);
    expect(r.perStudent[0].plan.fiFoldedIntoFirstTranche).toBe(true);
    expect(r.perStudent[0].plan.tuitionTranches).toEqual([132_000, 99_000, 99_000]);
  });
});

/* ================================================================== */
/* E. The config-override precedence                                   */
/* ================================================================== */

describe("E2.4 — E. the config-override precedence (the #4 wiring, per era)", () => {
  it("era A: the populated config rows win (FI, scolarité, installments — today's exact behavior)", () => {
    const config = {
      registrationFeeByGrade: { "1am": 99_000 } as Record<GradeLevel, number>,
      tuitionByGradeLevel: {
        "1am": { annualAmount: 400_000, installments: [160_000, 120_000, 120_000] as [number, number, number] },
      } as Record<GradeLevel, { annualAmount: number; installments: [number, number, number] }>,
    };
    const plan = computeStudentDevisPlan(
      { gradeLevel: "1am", pricingConfig: config },
      ERA_2026_2027_BASIS,
    );
    expect(plan.fi).toBe(99_000);
    expect(plan.scolarite).toBe(400_000);
    expect(plan.tuitionTranches).toEqual([160_000, 120_000, 120_000]);
    expect(plan.fiFoldedIntoFirstTranche).toBe(false);
    expect(plan.configOverrideApplied).toBe(true);
  });

  it("era B (R-2): the era-A-seeded GLOBAL config never overwrites the era-B pricing of record", () => {
    // The default config IS the era-A seed — a 2027 registration must NOT
    // price on it (the stale-fallback root cause, ARCH-037). The protection
    // lives at the WIRES (the registration paths): they pass the config only
    // for its own era; era B prices on the basis of record.
    const { installmentWire } = buildRegistrationBillingWires({
      tenantId: "00000000-0000-0000-0000-000000000001",
      parentCode: "PAR-E24-R2",
      students: [{
        studentCode: "ELV-E24-R2", studentRef: 0, gradeLevel: "1am",
        paymentPlan: "tranches", transportTier: null, remise: 0, chargeStickerPrice: false,
      }],
      pricingConfig: defaultPricingConfig,
      includeRegistration: true,
      includeTransport: false,
      year: 2027,
      at: "2027-09-01T10:00:00.000Z",
      parentTransportDestination: null,
    });
    const tuition = installmentWire.filter((w) => w.category === "tuition");
    expect(tuition.map((w) => w.amount_due)).toEqual([132_000, 99_000, 99_000]); // era-B stickers
    expect(installmentWire.filter((w) => w.category === "other")).toHaveLength(0); // folded — no separate FI
  });

  it("era B: an explicit config override on the CALLER's own authority still unfolds (the classic structure)", () => {
    const config = {
      registrationFeeByGrade: {} as Record<GradeLevel, number>,
      tuitionByGradeLevel: {
        "1am": { annualAmount: 400_000, installments: [160_000, 120_000, 120_000] as [number, number, number] },
      } as Record<GradeLevel, { annualAmount: number; installments: [number, number, number] }>,
    };
    const plan = computeStudentDevisPlan(
      { gradeLevel: "1am", pricingConfig: config },
      ERA_2027_2026_BASIS,
    );
    expect(plan.tuitionTranches).toEqual([160_000, 120_000, 120_000]);
    expect(plan.fiFoldedIntoFirstTranche).toBe(false); // unfolded: the FI is separate
    expect(plan.fi).toBe(25_000); // the basis FI, charged separately
  });
});

/* ================================================================== */
/* F. THE PARITY PIN — mock ≡ live (DUP-037's death)                   */
/* ================================================================== */

describe("E2.4 — F. the parity pin: the mock batchRegister ≡ the Supabase wires", () => {
  const PARITY_CASES: {
    name: string;
    idx: number;
    year: number;
    students: {
      gradeLevel: GradeLevel; remise: number; paymentPlan: "tranches" | "full_annual";
      transportTier: TransportDestination | null; chargeStickerPrice: boolean;
    }[];
    includeRegistration: boolean;
    includeTransport: boolean;
  }[] = [
    {
      name: "era A — two students, a remise, a transport town, per-student FI",
      idx: 1,
      year: 2026,
      students: [
        { gradeLevel: "1am", remise: 5000, paymentPlan: "tranches", transportTier: null, chargeStickerPrice: false },
        { gradeLevel: "prescolaire_2", remise: 0, paymentPlan: "tranches", transportTier: "boudouaou", chargeStickerPrice: false },
      ],
      includeRegistration: true,
      includeTransport: true,
    },
    {
      name: "era A — the sticker-price case (the DUP-037 root: the mock's voided remiseApplied)",
      idx: 2,
      year: 2026,
      students: [
        { gradeLevel: "2ap", remise: 20000, paymentPlan: "tranches", transportTier: null, chargeStickerPrice: true },
      ],
      includeRegistration: true,
      includeTransport: false,
    },
    {
      name: "era B — the folded world, full-annual, transport",
      idx: 3,
      year: 2027,
      students: [
        { gradeLevel: "3am", remise: 15000, paymentPlan: "tranches", transportTier: "corso", chargeStickerPrice: false },
        { gradeLevel: "1ere_annee", remise: 0, paymentPlan: "full_annual", transportTier: null, chargeStickerPrice: false },
      ],
      includeRegistration: true,
      includeTransport: true,
    },
    {
      name: "era B — includeRegistration=false (the unfolded FI leaves V1)",
      idx: 4,
      year: 2027,
      students: [
        { gradeLevel: "1am", remise: 0, paymentPlan: "tranches", transportTier: null, chargeStickerPrice: false },
      ],
      includeRegistration: false,
      includeTransport: false,
    },
  ];

  it.each(PARITY_CASES)("$name", async ({ year, students, includeRegistration, includeTransport, idx }) => {
    // ── The LIVE wires (what register_family_batch persists) ──
    const { installmentWire } = buildRegistrationBillingWires({
      tenantId: "00000000-0000-0000-0000-000000000001",
      parentCode: "PAR-E24-PARITY",
      students: students.map((s, i) => ({
        studentCode: `ELV-E24-${i}`,
        studentRef: i,
        gradeLevel: s.gradeLevel,
        paymentPlan: s.paymentPlan,
        transportTier: s.transportTier,
        remise: s.remise,
        chargeStickerPrice: s.chargeStickerPrice,
      })),
      pricingConfig: defaultPricingConfig,
      includeRegistration,
      includeTransport,
      year,
      at: `${year}-09-01T10:00:00.000Z`,
      parentTransportDestination: null,
    });

    // ── The MOCK (its own batchRegister → the store's installments) ──
    const { MockStudentRepository } = await import("../../infrastructure/mock/repositories/student-repository");
    const { store } = await import("../../infrastructure/mock/repositories/mock-store");
    const repo = new MockStudentRepository();
    // A UNIQUE parent identity per case (the mock's canonical parent code is
    // deterministic — a repeat identity is a conflict, by design).
    const res = await repo.batchRegister({
      parent: {
        firstName: "Parité", lastName: `Sonde ${idx}`, gender: "unspecified",
        phone: `055428770${idx}`, preferredLanguage: "fr", transportDestination: null,
      } as never,
      students: students.map((s) => ({
        firstName: "Élève", lastName: "Sonde", gender: "unspecified" as const,
        birthDate: "2015-01-01", level: "primaire" as const, gradeYear: 1,
        gradeLevel: s.gradeLevel, paymentPlan: s.paymentPlan,
        transportTier: s.transportTier, remise: s.remise,
        chargeStickerPrice: s.chargeStickerPrice,
        originType: "" as const, previousSchoolName: "", previousSchoolLevel: "",
        previousAcademicYear: "", originNotes: "",
      })) as never,
      includeRegistration,
      includeTransport,
      academicYearStartYear: year,
    } as never);
    expect(res.ok).toBe(true);
    // The mock PREPENDS the new installments (`[...billing.installments, ...store.installments]`)
    // — collect them by the case's own parent id.
    const parentId = res.ok ? res.value.parent.id : "";
    const created = store.installments.filter((i) => i.parentId === parentId);

    // ── THE PARITY: the same plan (category, label, amount, due) per student ──
    expect(created.length).toBe(installmentWire.length);
    for (let i = 0; i < installmentWire.length; i++) {
      const wire = installmentWire[i];
      const mock = created[i];
      expect(mock.category).toBe(wire.category);
      expect(mock.label).toBe(wire.label);
      expect(mock.amountDue).toBe(wire.amount_due);
      expect(mock.dueDate).toBe(wire.due_date);
    }
  });
});

/* ================================================================== */
/* G. BUG-028 — the mock refund actorId parity pin                     */
/* ================================================================== */

describe("E2.4 — G. BUG-028: the mock refund signature matches the domain contract", () => {
  it("the mock's refund REQUIRES actorId (3 positional params before the optional name)", async () => {
    const { MockPaymentRepository } = await import("../../infrastructure/mock/repositories/financial-repository");
    const repo = new MockPaymentRepository();
    // The domain contract: refund(id, reason, actorId, actorName?) — all
    // four parameters are DECLARED (the optionality of actorName is
    // type-level only, so the arity is 4; the old mock's optional actorId
    // made it 3-optional and fabricated "usr-current" — the BUG-028 drift).
    expect(repo.refund.length).toBe(4);
    const source = fs.readFileSync(
      path.join(__dirname, "../../infrastructure/mock/repositories/financial-repository.ts"),
      "utf8",
    );
    expect(source).toContain("refund(id: string, reason: string, actorId: string, actorName?: string)");
  });
});
