/**
 * Devis service — THE billing preview engine with a per-year pricingBasis
 * (E2.4 / ROADMAP 1.4–1.7; DUP-001's consolidation: the ONE domain engine the
 * feature preview, the Supabase registration wires AND the mock batchRegister
 * all consume — never a second billing arithmetic).
 *
 * THE TWO PRICE ERAS (R-2 / ARCH-037 — the E2.3 fixtures are the artifacts of
 * record, each cut from and verified against ONE actual workbook ALONE):
 *
 *   Era A — 2026-2027 (`Suivis clients  2026_2027.xlsx`, SHA 9decf3f7…05c7):
 *     devis = FI + scolarité + transport − remise (the ETAT L-column formulas).
 *     Tranches: the FI is charged SEPARATELY (the workbook's R column / the
 *     wizard's tranche 0), then V1/2V/v3 are FIXED per-class tuition stickers
 *     (V1 ≈ 40% of the scolarité, 2V = v3 ≈ 30%) with the REMISE landing on
 *     V1 ONLY (the S-column `=122000-J58` formulas). This is exactly the
 *     `school-price-matrix.ts` REAL_* model — the era-A fixture is that
 *     matrix, byte-for-byte.
 *
 *   Era B — 2027-2026 (`2027-2026.xlsx`, SHA b293b22b…79ca): the devis formula
 *     convention is UNCHANGED (`=FI+scolarité[+transport]−remise`, the same
 *     per-grade FI and scolarité components — verified against the workbook's
 *     own formulas) but the tranche STRUCTURE changed: the FI is FOLDED into
 *     the first tranche — V1 + 2V + v3 = FI + scolarité (e.g. 1AAM
 *     132 000/99 000/99 000 = 330 000 = 25 000 + 305 000; CP
 *     98 000/73 500/73 500 = 245 000 = 25 000 + 220 000), still ≈40/30/30,
 *     with the REMISE on V1 only. The per-class sticker table below is the
 *     E2.3 census (the modes of workbook B's own V1/2V/v3 columns), with the
 *     remise-contaminated V1 modes reconstructed (sticker = observed V1 +
 *     the row's remise — e.g. CE1's census 101 000 = 106 000 − 5 000) and
 *     the two documented conservation deltas (MS −23 000, GS −3 000: the
 *     workbook's own tranche sums differ from its devis components —
 *     recorded, never silently "fixed").
 *
 * `resolveDevisPricingBasis` is MONOTONE (the newest basis whose start year is
 * ≤ the requested year): a 2027 re-enrollment prices on era B, an unknown
 * 2028+ year prices on the NEWEST known basis — the stale 2026-2027 fallback
 * is never cemented (ARCH-037's root complaint; the REAL_* constants'
 * regeneration/deletion stays in T-587/§16's lane).
 *
 * Admin overrides: a populated `PricingConfig` row wins per today's #4-wiring
 * precedence (compute-billing.ts): `registrationFeeByGrade[grade]` overrides
 * the FI; `tuitionByGradeLevel[grade].annualAmount > 0` overrides the
 * scolarité; `installments[0] > 0` overrides the tranche stickers — and a
 * config override forces the CLASSIC structure (FI separate, tuition-only
 * installments) because `PricingConfig.installments` carry tuition-only
 * semantics. The deterministic discounts (sibling default, early payment) are
 * DISPLAY-level lines in the family preview exactly as the #4 wiring renders
 * them — they never alter the installment plan (the workbook's sibling
 * component already lives INSIDE the negotiated remise; subtracting it again
 * was the double-discounting family, DUP-001).
 */
import type { GradeLevel } from "../../model/student";
import type { PaymentPlan } from "../../model/payment";
import type { PricingConfig } from "../../model/pricing";
import type { TransportDestination } from "../../model/parent";
import {
  REAL_FI_BY_GRADE,
  REAL_FI_AUTISTE,
  REAL_TUITION_BY_GRADE,
  REAL_TUITION_AUTISTE,
  REAL_TRANSPORT_MATRIX,
  EARLY_PAYMENT_RATE,
  earlyPaymentCutoff,
} from "./school-price-matrix";
import { evaluateAllSystemDiscounts, sumDiscounts, type DiscountEvaluation } from "./discount-engine";

/* ============================================================ */
/*  1. The per-year pricing basis                               */
/* ============================================================ */

/** How the FI is placed in the installment plan. */
export type DevisFiPlacement = "separate-tranche" | "folded-into-first";

/** One grade's pricing row inside a basis. */
export interface DevisGradeRow {
  /** FI (frais d'inscription) sticker per student. */
  readonly fi: number;
  /** Gross annual scolarité (FI and transport excluded). */
  readonly scolarite: number;
  /**
   * The three tuition tranche stickers. Era A: TUITION-ONLY stickers
   * (Σ = scolarité; the FI is a separate tranche). Era B: FI-FOLDED stickers
   * (Σ = FI + scolarité). The remise lands on the FIRST sticker only.
   */
  readonly tranches: readonly [number, number, number];
}

/** A diverging class code inside an era (the era-B census reality). */
export interface DevisClassEntry {
  readonly gradeLevel: GradeLevel;
  readonly fi: number;
  readonly scolarite: number;
  readonly tranches: readonly [number, number, number] | null;
  /** The census note (provenance / why this class diverges). */
  readonly note: string;
}

export interface DevisPricingBasis {
  /** The academic year code this basis prices (e.g. "2026-2027"). */
  readonly academicYearCode: string;
  /** The calendar year the academic year starts. */
  readonly academicYearStartYear: number;
  readonly fiPlacement: DevisFiPlacement;
  readonly gradeRows: Readonly<Record<GradeLevel, DevisGradeRow>>;
  /** The autism integration program row. */
  readonly autiste: DevisGradeRow;
  /** Diverging class codes (keyed by the workbook's CLASSE code). */
  readonly classEntries: Readonly<Record<string, DevisClassEntry>>;
  readonly transportMatrix: typeof REAL_TRANSPORT_MATRIX;
  /** Early-payment discount rate (5% of the scolarité ONLY, both eras). */
  readonly earlyPaymentRate: number;
  readonly provenance: {
    readonly workbook: string;
    readonly sha256: string;
    readonly note: string;
  };
}

/** Era A — the REAL 2026/2027 matrix (= the E2.3 era-2026-2027 fixture). */
export const ERA_2026_2027_BASIS: DevisPricingBasis = {
  academicYearCode: "2026-2027",
  academicYearStartYear: 2026,
  fiPlacement: "separate-tranche",
  gradeRows: mapGradeRows(REAL_FI_BY_GRADE, REAL_TUITION_BY_GRADE),
  autiste: {
    fi: REAL_FI_AUTISTE,
    scolarite: REAL_TUITION_AUTISTE.scolarite,
    tranches: [REAL_TUITION_AUTISTE.v2, REAL_TUITION_AUTISTE.tranche3, REAL_TUITION_AUTISTE.tranche4],
  },
  classEntries: {},
  transportMatrix: REAL_TRANSPORT_MATRIX,
  earlyPaymentRate: EARLY_PAYMENT_RATE,
  provenance: {
    workbook: "Excel/Suivis clients  2026_2027.xlsx",
    sha256: "9decf3f7e7461b45bdc195dc74c180be8b1a3e897b2497dcb4add921bfc905c7",
    note: "the REAL_* matrix (school-price-matrix.ts) — the ETAT L/S formula model, 390-row corpus replay",
  },
};

/**
 * Era B — the 2027-2026 pricing (the E2.3 census consumed as the basis).
 * FI/scolarité per grade: workbook B's own devis formulas (identical
 * components to era A — verified). Tranche stickers: the census modes with
 * the remise-contaminated V1 modes reconstructed; MS/GS carry the two
 * documented conservation deltas.
 */
export const ERA_2027_2026_BASIS: DevisPricingBasis = {
  academicYearCode: "2027-2026",
  academicYearStartYear: 2027,
  fiPlacement: "folded-into-first",
  gradeRows: {
    prescolaire_1: { fi: 18_000, scolarite: 135_000, tranches: [52_000, 39_000, 39_000] }, // MS — Σ130 000 (Δ −23 000 documented)
    prescolaire_2: { fi: 18_000, scolarite: 165_000, tranches: [72_000, 54_000, 54_000] }, // GS — Σ180 000 (Δ −3 000 documented)
    "1ap": { fi: 25_000, scolarite: 220_000, tranches: [98_000, 73_500, 73_500] }, // CP — clean census
    "2ap": { fi: 25_000, scolarite: 240_000, tranches: [106_000, 79_500, 79_500] }, // CE1 — v1 reconstructed (census 101 000 = −5 000 remise)
    "3ap": { fi: 25_000, scolarite: 255_000, tranches: [112_000, 84_000, 84_000] }, // CE2 — clean census
    "4ap": { fi: 25_000, scolarite: 265_000, tranches: [114_000, 88_500, 87_500] }, // CM1 — row-verified v1 sticker 114 000
    "5ap": { fi: 30_000, scolarite: 270_000, tranches: [120_000, 90_000, 90_000] }, // CM2 — clean census
    "1am": { fi: 25_000, scolarite: 305_000, tranches: [132_000, 99_000, 99_000] }, // 1AAM — clean census
    "2am": { fi: 25_000, scolarite: 320_000, tranches: [138_000, 103_500, 103_500] }, // 2AAM — v1 reconstructed (census 133 000 = −5 000)
    "3am": { fi: 25_000, scolarite: 330_000, tranches: [142_000, 106_500, 106_500] }, // 3AAM — clean census
    "4am": { fi: 30_000, scolarite: 340_000, tranches: [148_000, 111_000, 111_000] }, // 4AAM — v1 reconstructed (census 143 000 = −5 000)
    "1ere_annee": { fi: 25_000, scolarite: 350_000, tranches: [150_000, 112_500, 112_500] }, // 1ER — clean census
    "2eme_annee": { fi: 25_000, scolarite: 355_000, tranches: [152_000, 114_000, 114_000] }, // 2EM — 2V census 15 000 = partial-data noise → reconstructed
    "3eme_annee": { fi: 30_000, scolarite: 365_000, tranches: [158_000, 118_500, 118_500] }, // 3EM — clean census
  },
  autiste: {
    // No clean era-B census (the AUTIST* tracks are 1-row-each observations:
    // devis 300 500 / 283 000 / 293 000 with unpopulated 2V/v3) — the row is
    // DERIVED 40/30/30 of (FI 23 000 + scolarité 250 000), documented.
    fi: REAL_FI_AUTISTE,
    scolarite: REAL_TUITION_AUTISTE.scolarite,
    tranches: [109_200, 81_900, 81_900],
  },
  classEntries: {
    // The nAP class codes that genuinely diverge from their grade's mainstream
    // class (workbook B runs both codes with different scolarités).
    "3AP": {
      gradeLevel: "3ap", fi: 25_000, scolarite: 220_000,
      tranches: [77_000, 84_000, 84_000], // Σ245 000 = FI+scol (r86: V1 31 000 + remise 46 000 = 77 000)
      note: "the 3AP class carries CE1-level scolarité (220 000), not CE2's 255 000",
    },
    "4AP": {
      gradeLevel: "4ap", fi: 25_000, scolarite: 230_000,
      tranches: [84_000, 85_500, 85_500], // Σ255 000 = FI+scol (census 2V/v3 modes)
      note: "the 4AP class carries 230 000, not CM1's 265 000",
    },
    "5AP": {
      gradeLevel: "5ap", fi: 30_000, scolarite: 250_000,
      tranches: [100_000, 90_000, 90_000], // Σ280 000 = FI+scol (r155: V1 ≈ 100 000)
      note: "the 5AP class carries 250 000, not CM2's 270 000",
    },
    // 1AP/2AP agree with their grade rows (CP/CE1) — no override needed.
    // The special tracks (no grade mapping; consumed by the diagnostics lane):
    "AUTIST": { gradeLevel: "1ap", fi: 23_000, scolarite: 290_000, tranches: null, note: "autisme track — formula-verified row" },
    "AUTISTE": { gradeLevel: "1ap", fi: 23_000, scolarite: 290_000, tranches: null, note: "autisme track — formula-verified row" },
    "AUTISTS": { gradeLevel: "1ap", fi: 23_000, scolarite: 270_000, tranches: null, note: "autisme track — formula-verified row" },
    "NV1": { gradeLevel: "1ap", fi: 23_000, scolarite: 225_000, tranches: null, note: "integration track — formula-verified row" },
    "NV3": { gradeLevel: "1ap", fi: 23_000, scolarite: 260_000, tranches: null, note: "integration track — formula-verified row" },
    "NV4": { gradeLevel: "1ap", fi: 23_000, scolarite: 245_000, tranches: null, note: "integration track — formula-verified row" },
  },
  transportMatrix: REAL_TRANSPORT_MATRIX, // workbook B's 1T/T2/t3 observations match the era-A per-town matrix
  earlyPaymentRate: EARLY_PAYMENT_RATE,
  provenance: {
    workbook: "Excel/2027-2026.xlsx",
    sha256: "b293b22bef41aa3df833d015c09d89021b28b519f324e0a63921553084f479ca",
    note: "the E2.3 era-2027-2026 census (the per-class V1/2V/v3 modes) + the devis-formula FI/scolarité verification",
  },
};

function mapGradeRows(
  fi: Readonly<Record<GradeLevel, number>>,
  tuition: Readonly<Record<GradeLevel, { scolarite: number; v2: number; tranche3: number; tranche4: number }>>,
): Readonly<Record<GradeLevel, DevisGradeRow>> {
  const out = {} as Record<GradeLevel, DevisGradeRow>;
  for (const grade of Object.keys(tuition) as GradeLevel[]) {
    const t = tuition[grade];
    out[grade] = { fi: fi[grade], scolarite: t.scolarite, tranches: [t.v2, t.tranche3, t.tranche4] };
  }
  return out;
}

const KNOWN_BASES = [ERA_2026_2027_BASIS, ERA_2027_2026_BASIS];

/**
 * Resolve the pricing basis for an academic year (MONOTONE: the newest basis
 * whose start year is ≤ the requested year — 2026 → era A, 2027+ → era B;
 * the stale 2026-2027 fallback is never cemented for a newer year).
 */
export function resolveDevisPricingBasis(academicYearStartYear: number): DevisPricingBasis {
  let chosen = KNOWN_BASES[0];
  for (const b of KNOWN_BASES) {
    if (b.academicYearStartYear <= academicYearStartYear) chosen = b;
  }
  return chosen;
}

/* ============================================================ */
/*  2. The per-student canonical plan                           */
/* ============================================================ */

export interface DevisPlanStudentInput {
  readonly gradeLevel: GradeLevel;
  /** The workbook CLASSE code (the era-B per-class override lane). */
  readonly classCode?: string | null;
  readonly remise?: number;
  readonly chargeStickerPrice?: boolean;
  readonly transportDestination?: TransportDestination | null;
  readonly includeTransport?: boolean;
  /** The admin PricingConfig (its populated rows win — the #4 precedence). */
  readonly pricingConfig?: Pick<PricingConfig, "registrationFeeByGrade" | "tuitionByGradeLevel"> | null;
}

export interface DevisStudentPlan {
  readonly fi: number;
  readonly scolarite: number;
  readonly transport: number;
  readonly remise: number;
  /** The remise actually subtracted from the devis (0 in the sticker case). */
  readonly remiseAppliedToDevis: number;
  /** FI + scolarité + transport − remiseAppliedToDevis (the workbook column L). */
  readonly devis: number;
  /** The three tuition tranches AFTER the remise on the first (clamped ≥ 0). */
  readonly tuitionTranches: readonly [number, number, number];
  /** Era B: the FI is inside the first tranche (no separate FI line). */
  readonly fiFoldedIntoFirstTranche: boolean;
  readonly transportTranches: readonly [number, number, number];
  /** True when a PricingConfig row overrode the basis (classic structure). */
  readonly configOverrideApplied: boolean;
  readonly basisCode: string;
}

/**
 * Compute ONE student's canonical installment plan on the given basis — the
 * ONE arithmetic the feature preview, the Supabase wires and the mock
 * batchRegister consume (DUP-001/DUP-037 die here).
 */
export function computeStudentDevisPlan(
  student: DevisPlanStudentInput,
  basis: DevisPricingBasis,
  options?: { readonly includeRegistration?: boolean },
): DevisStudentPlan {
  const includeRegistration = options?.includeRegistration ?? true;
  const includeTransport = student.includeTransport ?? true;
  const remise = Math.max(0, Number(student.remise) || 0);
  const chargeStickerPrice = student.chargeStickerPrice ?? false;

  // ── The basis row (per-class override → grade row) + the config layer ──
  const classEntry = student.classCode ? basis.classEntries[student.classCode] : undefined;
  const gradeRow = basis.gradeRows[student.gradeLevel];
  const rowFi = classEntry?.fi ?? gradeRow.fi;
  const rowScolarite = classEntry?.scolarite ?? gradeRow.scolarite;
  const rowTranches = classEntry?.tranches ?? gradeRow.tranches;
  const cfg = student.pricingConfig ?? null;
  const cfgFi = cfg?.registrationFeeByGrade?.[student.gradeLevel];
  const cfgSchedule = cfg?.tuitionByGradeLevel?.[student.gradeLevel];

  const fi = includeRegistration ? (cfgFi ?? rowFi) : 0;
  const scolarite =
    cfgSchedule && cfgSchedule.annualAmount > 0 ? cfgSchedule.annualAmount : rowScolarite;
  const configOverrideApplied = Boolean(
    (includeRegistration && cfgFi != null) || (cfgSchedule && cfgSchedule.annualAmount > 0),
  );

  // ── Tranche stickers ──
  // Precedence (the #4 wiring): config installments (tuition-only, classic
  // structure) → the basis's own stickers. A config override of ANY kind on a
  // FOLDED basis unfolds it (the separately-charged FI must equal the FI in
  // the devis — the basis's tuition-only view + the config FI). On era A
  // (already tuition-only) an FI/scolarité-only override keeps the basis
  // stickers — today's exact behavior.
  const cfgInstallments =
    cfgSchedule && cfgSchedule.installments && cfgSchedule.installments[0] > 0
      ? (cfgSchedule.installments as readonly [number, number, number])
      : null;
  const folded = basis.fiPlacement === "folded-into-first";
  const unfold = (t: readonly [number, number, number], fiInTranche: number): readonly [number, number, number] =>
    [Math.max(0, t[0] - fiInTranche), t[1], t[2]];

  let tranches: readonly [number, number, number];
  let fiFolded: boolean;
  if (cfgInstallments) {
    tranches = cfgInstallments;
    fiFolded = false;
  } else if (!configOverrideApplied) {
    tranches = rowTranches;
    fiFolded = folded;
    if (folded && !includeRegistration) {
      // The folded FI leaves the first tranche when the FI is excluded.
      tranches = unfold(tranches, rowFi);
    }
  } else {
    tranches = folded ? unfold(rowTranches, rowFi) : rowTranches;
    fiFolded = false;
  }

  // ── Transport (per town; the matrix covers legacy zones + real towns) ──
  const dest = includeTransport && student.transportDestination ? student.transportDestination : null;
  const transportSchedule = dest ? basis.transportMatrix[dest] : null;
  const transport = transportSchedule ? transportSchedule[0] : 0;

  // ── The devis (the workbook column L): FI + scol + transport − remise ──
  const remiseAppliedToDevis = chargeStickerPrice ? 0 : remise;
  const devis = fi + scolarite + transport - remiseAppliedToDevis;

  // ── The remise lands on the FIRST tranche only (clamped ≥ 0 — a remise
  // exceeding the sticker can never mint a negative charge) ──
  const tuitionTranches: readonly [number, number, number] = [
    Math.max(0, tranches[0] - remise),
    tranches[1],
    tranches[2],
  ];

  return {
    fi,
    scolarite,
    transport,
    remise,
    remiseAppliedToDevis,
    devis,
    tuitionTranches,
    fiFoldedIntoFirstTranche: fiFolded,
    transportTranches: transportSchedule
      ? [transportSchedule[1], transportSchedule[2], transportSchedule[3]]
      : [0, 0, 0],
    configOverrideApplied,
    basisCode: basis.academicYearCode,
  };
}

/* ============================================================ */
/*  3. The family preview (the #4-wiring policy, per-era)       */
/* ============================================================ */

export interface FamilyDevisStudentInput extends DevisPlanStudentInput {
  readonly paymentPlan: PaymentPlan;
}

export interface FamilyDevisStudentLine {
  readonly plan: DevisStudentPlan;
  readonly discounts: readonly DiscountEvaluation[];
  /** Σ deterministic discounts (negative) — display-level, never the plan. */
  readonly deterministicDiscount: number;
  /** max(0, scolarité + deterministicDiscount − remise) — the #4 netTuition. */
  readonly netTuition: number;
  readonly paymentPlan: PaymentPlan;
}

export interface FamilyDevisResult {
  readonly perStudent: readonly FamilyDevisStudentLine[];
  readonly registrationFee: number;
  readonly totalTuition: number;
  readonly totalTransport: number;
  readonly totalRemise: number;
  readonly subTotal: number;
  readonly grandTotal: number;
  readonly totalEarlyPaymentDiscount: number;
  readonly basis: DevisPricingBasis;
}

/**
 * The family billing preview — the policy of the wizard's step-4 review
 * (today's `computeBilling` wiring), priced per-era. `computeBilling` maps
 * this onto the feature `Billing` shape; the wires/mock consume the
 * per-student plans for the persisted installment construction.
 */
export function computeFamilyDevis(input: {
  readonly students: readonly FamilyDevisStudentInput[];
  readonly pricingConfig?: Pick<PricingConfig, "registrationFeeByGrade" | "tuitionByGradeLevel"> | null;
  readonly includeRegistration: boolean;
  readonly includeTransport: boolean;
  readonly academicYearStartYear?: number;
  readonly paymentDate?: string;
  readonly priorCredit?: number;
  readonly basis?: DevisPricingBasis;
}): FamilyDevisResult {
  const academicYearStartYear = input.academicYearStartYear ?? new Date().getFullYear();
  const paymentDate = input.paymentDate ?? new Date().toISOString();
  const priorCredit = input.priorCredit ?? 0;
  const basis = input.basis ?? resolveDevisPricingBasis(academicYearStartYear);

  let totalTuition = 0;
  let totalTransport = 0;
  let totalRemise = 0;
  let totalFi = 0;

  const perStudent: FamilyDevisStudentLine[] = input.students.map((s, i) => {
    const plan = computeStudentDevisPlan(
      { ...s, includeTransport: input.includeTransport },
      basis,
      { includeRegistration: input.includeRegistration },
    );

    const discounts = evaluateAllSystemDiscounts({
      grossScolarite: plan.scolarite,
      childIndex: i + 1,
      paymentPlan: s.paymentPlan,
      paymentDate,
      academicYearStartYear,
    });
    const deterministicDiscount = sumDiscounts(discounts);

    totalTuition += plan.scolarite;
    totalTransport += plan.transport;
    totalRemise += plan.remise;
    totalFi += plan.fi;

    return {
      plan,
      discounts,
      deterministicDiscount,
      netTuition: Math.max(0, plan.scolarite + deterministicDiscount - plan.remise),
      paymentPlan: s.paymentPlan,
    };
  });

  // Early payment: 5% of Σ scolarité (FI + transport excluded) when EVERY
  // student is full_annual and the settlement precedes June 30.
  const allFullAnnual =
    input.students.length > 0 && input.students.every((s) => s.paymentPlan === "full_annual");
  let totalEarlyPaymentDiscount = 0;
  if (allFullAnnual) {
    const when = new Date(paymentDate);
    if (when.getTime() <= earlyPaymentCutoff(academicYearStartYear).getTime()) {
      totalEarlyPaymentDiscount = Math.round(totalTuition * basis.earlyPaymentRate);
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
    subTotal,
    grandTotal,
    totalEarlyPaymentDiscount,
    basis,
  };
}
