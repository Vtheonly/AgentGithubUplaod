/**
 * School Price Matrix — the REAL El-Imtiyaz 2026/2027 pricing model.
 *
 * ⚠ CANONICAL SOURCE: `Suivis clients  2026_2027.xlsx` (the legacy Excel
 * workbook at the repository root). Every constant below was extracted from
 * the workbook's RAW FORMULAS, not from any prose document:
 *
 *   - ETAT sheet column L (DEVIS ANNUEL) holds per-row formulas such as
 *     `=25000+205000+35000+55000-J3` — literally
 *     `FI + scolarité(2 components) + transport − remise`.
 *   - ETAT sheet column S (V2) holds schedule formulas such as
 *     `=122000-J58` — literally `V2_sticker(1AAM) − remise`.
 *   - Devis sheet computes the early-payment discount as
 *     `=+SUM(F15:F26)*0.05` — 5% of the FRAIS DE SCOLARISATION column ONLY
 *     (never of the FI, never of transport).
 *   - Devis sheet Montant Total = `Sous-total − Réduction − Remboursement`.
 *
 * The tranche model (V2 / 2V / v3, remise on V2 only) is verified against
 * every fully-populated row of the ETAT sheet (see
 * `src/tests/domain/pricing/real-school-corpus.test.ts` — 390 rows replayed).
 *
 * This file SUPERSEDES the fictional `Prices.md` schedule previously encoded
 * in `pricing-seed.ts` / `destination-mapper.ts` (problem CALC-001). The
 * fictional numbers (130k–395k tuition, 4 transport zones, flat family FI)
 * remain loadable from the PricingConfig for backward compatibility, but
 * every NEW quote / registration must run through this matrix.
 */
import type { GradeLevel } from "../../model/student";
import type { TransportDestination } from "../../model/parent";

/* ============================================================ */
/*  1. FI (Frais d'Inscription) — PER STUDENT, per grade         */
/* ============================================================ */

/**
 * FI sticker per grade level — charged PER STUDENT (never once per family).
 * Evidence: ETAT column R (FI) is populated per student row; the Devis sheet
 * lists an F I column per student line (e.g. HEBBAZ: 33000 + 33000 + 18000
 * for three children).
 */
export const REAL_FI_BY_GRADE: Readonly<Record<GradeLevel, number>> = {
  prescolaire_1: 18_000, // MS / PS / TPS
  prescolaire_2: 18_000, // GS
  "1ap": 25_000, // CP
  "2ap": 25_000, // CE1
  "3ap": 25_000, // CE2
  "4ap": 25_000, // CM1
  "5ap": 30_000, // CM2
  "1am": 25_000, // 1AAM
  "2am": 25_000, // 2AAM
  "3am": 25_000, // 3AAM
  "4am": 30_000, // 4AAM (exam class)
  "1ere_annee": 25_000, // 1ER / 1AS
  "2eme_annee": 25_000, // 2EM / 2AS
  "3eme_annee": 30_000, // 3EM / 3AS (exam class)
};

/** FI for the autism integration program (its own line in the workbook). */
export const REAL_FI_AUTISTE = 23_000;

/** Exam-year uplift observed in the workbook (4AM / 3AS / 3EM rows: 30000-33000). */
export const REAL_FI_EXAM_CLASSES = 30_000;

/* ============================================================ */
/*  2. Scolarité sticker + the official V2/2V/v3 tranche table   */
/* ============================================================ */

/**
 * Per-grade scolarité sticker + the official 3-tranche schedule
 * (V2 = tranche 2, 2V = v3 = tranches 3/4 in workbook column names).
 *
 * Evidence per class — ETAT L-formula components and the S/T/U column modes:
 *   - The scolarité is written as TWO components in the workbook for the
 *     "new-style" primary rows (e.g. CE1 = 205000 + 35000); the sum is the
 *     sticker. CM2 carries a 20000 component; CEM/Lycée rows are single-term.
 *   - 2V = v3 are FIXED per class (the mode of the T/U columns across every
 *     fully-paid row) and equal ~30% of the scolarité.
 *   - V2 = scol − FI-independent balancer ≈ 40% of the scolarité
 *     (e.g. 1AAM: 122000 = 0.40 × 305000; 2V = 91500 = 0.30 × 305000).
 *   - The REMISE is deducted from V2 ONLY (S-column formulas: `=122000-J58`,
 *     `=132000-J57`, `=110000-J95`), never from 2V/v3.
 */
export interface RealTuitionSchedule {
  /** Gross annual scolarité (FI excluded, transport excluded). */
  readonly scolarite: number;
  /** Tranche 2 sticker (≈40% of scolarité) — the REMISE lands here. */
  readonly v2: number;
  /** Tranche 3 sticker (≈30%) — fixed, never discounted. */
  readonly tranche3: number;
  /** Tranche 4 sticker (≈30%) — fixed, never discounted. */
  readonly tranche4: number;
}

export const REAL_TUITION_BY_GRADE: Readonly<Record<GradeLevel, RealTuitionSchedule>> = {
  // Classe GS: 18000 + 165000 (formula `=18000+165000-J40`)
  prescolaire_2: { scolarite: 165_000, v2: 66_000, tranche3: 49_500, tranche4: 49_500 },
  // Classe MS: 18000 + 135000 (formula `=18000+135000-J132`); tranches
  // (54000, 40500, 40500) = 40/30/30 of the scolarité — l132 YAHYAOUI LOUAI:
  // V2 = 54000 − 5000 remise = 49000 ✓.
  prescolaire_1: { scolarite: 135_000, v2: 54_000, tranche3: 40_500, tranche4: 40_500 },
  // CP: 185000 + 35000 (formula `=25000+185000+35000-J21`); tranches (89000, 65500, 65500)
  "1ap": { scolarite: 220_000, v2: 89_000, tranche3: 65_500, tranche4: 65_500 },
  // CE1: 205000 + 35000; tranches (97000, 71500, 71500) — ZIREG LEA row l2
  "2ap": { scolarite: 240_000, v2: 97_000, tranche3: 71_500, tranche4: 71_500 },
  // CE2: 220000 + 35000; tranches (103000, 76000, 76000)
  "3ap": { scolarite: 255_000, v2: 103_000, tranche3: 76_000, tranche4: 76_000 },
  // CM1: 230000 + 35000; tranches (107000, 79000, 79000)
  "4ap": { scolarite: 265_000, v2: 107_000, tranche3: 79_000, tranche4: 79_000 },
  // CM2: 250000 + 20000; tranches (110000, 80000, 80000)
  "5ap": { scolarite: 270_000, v2: 110_000, tranche3: 80_000, tranche4: 80_000 },
  // 1AAM: 305000; tranches (122000, 91500, 91500) — S-formula `=122000-J58`
  "1am": { scolarite: 305_000, v2: 122_000, tranche3: 91_500, tranche4: 91_500 },
  // 2AAM: 320000; tranches (128000, 96000, 96000)
  "2am": { scolarite: 320_000, v2: 128_000, tranche3: 96_000, tranche4: 96_000 },
  // 3AAM: 330000; tranches (132000, 99000, 99000) — S-formula `=132000-J57`
  "3am": { scolarite: 330_000, v2: 132_000, tranche3: 99_000, tranche4: 99_000 },
  // 4AAM: 340000; tranches (136000, 102000, 102000)
  "4am": { scolarite: 340_000, v2: 136_000, tranche3: 102_000, tranche4: 102_000 },
  // 1ER: 350000; tranches (140000, 105000, 105000)
  "1ere_annee": { scolarite: 350_000, v2: 140_000, tranche3: 105_000, tranche4: 105_000 },
  // 2EM: 355000; tranches (142000, 106500, 106500)
  "2eme_annee": { scolarite: 355_000, v2: 142_000, tranche3: 106_500, tranche4: 106_500 },
  // 3EM: 365000; tranches (146000, 109500, 109500)
  "3eme_annee": { scolarite: 365_000, v2: 146_000, tranche3: 109_500, tranche4: 109_500 },
};

/** AUTISTE integration program scolarité (formula `=23000+250000…`). */
export const REAL_TUITION_AUTISTE: RealTuitionSchedule = {
  scolarite: 250_000,
  v2: 100_000,
  tranche3: 75_000,
  tranche4: 75_000,
};

/* ============================================================ */
/*  3. Transport — the 20 real towns + the 4 legacy zones        */
/* ============================================================ */

/**
 * Real transport matrix per town — annual + 3-tranche split.
 * Evidence: the ETAT W/X/Y (1T/T2/t3) columns across all transport students:
 *   - BOUMERDES rows: (20000, 10000, 10000) = 40000
 *   - CORSO / FIGUIER rows: (20000, 13000, 10000) = 43000
 *   - BOUDOUAOU / THENIA rows: (30000, 12000, 10000) = 52000
 *   - ZEMMOURI row (MAHMEL RABAH): (30000, 15000, 12000) = 57000
 *   - DJENAT / BORDJMNAIL / OULED MOUSSA rows: (30000, 15000, 10000) = 55000
 *   - BENI AMRANE (AFRA ZINEDINE) / REGHAIA / OULED HEDADJ / LAGATA rows:
 *     (30000, 20000, 15000) = 65000
 * The 4 legacy grouped zones are kept as aliases so existing DB rows keep
 * resolving (their annual totals match the towns they group).
 */
export const REAL_TRANSPORT_MATRIX: Readonly<
  Record<TransportDestination, readonly [number, number, number, number]>
> = {
  // ── Legacy grouped zones (DB-compat; group prices ≈ member towns) ──
  ville_boumerdes: [40_000, 20_000, 10_000, 10_000],
  tidjelabine_sahel_figuier_corso: [43_000, 20_000, 13_000, 10_000],
  boudouaou_thenia_zemmouri: [52_000, 30_000, 12_000, 10_000],
  autres: [55_000, 30_000, 15_000, 10_000],
  // ── Real towns (2026/2027 observed prices) ──
  boumerdes: [40_000, 20_000, 10_000, 10_000],
  chabat: [55_000, 30_000, 15_000, 10_000], // GETAF rows charged 55000 (autres-style)
  chabet: [55_000, 30_000, 15_000, 10_000],
  corso: [43_000, 20_000, 13_000, 10_000],
  sahel: [43_000, 20_000, 13_000, 10_000],
  figuier: [43_000, 20_000, 13_000, 10_000],
  tidjelabine: [43_000, 20_000, 13_000, 10_000],
  boudouaou: [52_000, 30_000, 12_000, 10_000],
  thenia: [52_000, 30_000, 12_000, 10_000],
  zemmouri: [57_000, 30_000, 15_000, 12_000],
  djenet: [55_000, 30_000, 15_000, 10_000],
  cap_djenet: [55_000, 30_000, 15_000, 10_000],
  bordj_menaiel: [55_000, 30_000, 15_000, 10_000],
  si_mustapha: [55_000, 30_000, 15_000, 10_000],
  isser: [55_000, 30_000, 15_000, 10_000],
  ouled_moussa: [55_000, 30_000, 15_000, 10_000],
  khemis_el_khechna: [55_000, 30_000, 15_000, 10_000],
  benyounes: [55_000, 30_000, 15_000, 10_000],
  souk_elhad: [55_000, 30_000, 15_000, 10_000],
  beni_amrane: [65_000, 30_000, 20_000, 15_000],
  reghaia: [65_000, 30_000, 20_000, 15_000],
  rouiba: [65_000, 30_000, 20_000, 15_000],
  ouled_heddadj: [65_000, 30_000, 20_000, 15_000],
  lagata: [65_000, 30_000, 20_000, 15_000],
};

/* ============================================================ */
/*  4. Services — the REAL billable catalog (ETAT cols Z..AE)    */
/* ============================================================ */

/**
 * The school's real specialized services — exactly the ETAT columns
 * PSY1 / PSY2 / ORTH1 / ORTH2 / E-PLANT / Ratrapage, plus the AUTISTE
 * integration track. The fictional chess/English/canteen/uniform catalog
 * is retired (problem CALC-001; the columns never appear in the workbook).
 */
export const REAL_SERVICE_CODES = [
  "psy1",
  "psy2",
  "orth1",
  "orth2",
  "e_plant",
  "ratrapage",
  "autiste",
] as const;

export type RealServiceCode = (typeof REAL_SERVICE_CODES)[number];

export const REAL_SERVICE_LABELS_FR: Readonly<Record<RealServiceCode, string>> = {
  psy1: "Séances de psychologie — 1er semestre (PSY1)",
  psy2: "Séances de psychologie — 2ème semestre (PSY2)",
  orth1: "Séances d'orthophonie — 1er semestre (ORTH1)",
  orth2: "Séances d'orthophonie — 2ème semestre (ORTH2)",
  e_plant: "Plan d'accompagnement éducatif (E-PLANT)",
  ratrapage: "Rattrapage / soutien scolaire",
  autiste: "Programme d'intégration (autisme)",
};

/* ============================================================ */
/*  5. Early-payment discount — 5% of SCOLARITÉ ONLY             */
/* ============================================================ */

/**
 * Early annual payment discount rate.
 *
 * The Devis sheet computes it as `=+SUM(F15:F26)*0.05` — 5% of the summed
 * FRAIS DE SCOLARISATION column ONLY. The FI and transport lines are
 * excluded from the base. (The old code applied 10% to the whole gross —
 * problem CALC-002.)
 */
export const EARLY_PAYMENT_RATE = 0.05;

/** June 30 (23:59:59 UTC) of the academic year start year — the cutoff. */
export function earlyPaymentCutoff(academicYearStartYear: number): Date {
  return new Date(Date.UTC(academicYearStartYear, 5, 30, 23, 59, 59));
}

/**
 * The early-payment discount for a full-annual payment settled before the
 * cutoff. Base = the family's TOTAL scolarité (FI and transport excluded —
 * mirrors `SUM(F)*0.05`).
 */
export function earlyPaymentDiscount(
  scolariteTotal: number,
  paymentPlan: "full_annual" | "tranches",
  paymentDate: string | Date,
  academicYearStartYear: number,
): number {
  if (paymentPlan !== "full_annual") return 0;
  const when = typeof paymentDate === "string" ? new Date(paymentDate) : paymentDate;
  if (when.getTime() > earlyPaymentCutoff(academicYearStartYear).getTime()) return 0;
  return Math.round(scolariteTotal * EARLY_PAYMENT_RATE * 100) / 100;
}

/* ============================================================ */
/*  6. Sibling remise — the default family discount component    */
/* ============================================================ */

/**
 * Default sibling remise: 5 000 DZD per additional child (child #2, #3, …).
 * Evidence: the REMISE (J) formulas decompose as `=13000+22000+5000`,
 * `=18000+23000+5000` — the 5000 component is the per-additional-child
 * sibling remise. The REMAINING components are individually negotiated
 * (the school's real-world remises are NOT a linear formula — see
 * HEBBAZ 3 kids = 10 000 vs KOUBA 3 kids = 41 500), so the wizard treats
 * the remise as a manual per-student input with this default suggestion.
 */
export const SIBLING_REMISE_PER_CHILD = 5_000;

/* ============================================================ */
/*  7. The devis computation — FI + scol + transport − remise    */
/* ============================================================ */

export interface SchoolDevisStudentInput {
  readonly gradeLevel: GradeLevel;
  /** Negotiated remise for THIS student (default 0). */
  readonly remise?: number;
  readonly transportDestination?: TransportDestination | null;
  readonly includeTransport?: boolean;
}

export interface SchoolDevisResult {
  readonly fi: number;
  readonly scolarite: number;
  readonly transport: number;
  readonly remise: number;
  /** FI + scolarité + transport − remise (the workbook's column L). */
  readonly devis: number;
  /** Tranches: [V2, 2V, v3] with the remise fully deducted from V2. */
  readonly tuitionTranches: readonly [number, number, number];
  /** Transport tranches [T1, T2, T3] (fixed per town). */
  readonly transportTranches: readonly [number, number, number];
}

/**
 * Compute ONE student's devis exactly the way the school's workbook does:
 *
 *   devis = FI + scolarité + transport − remise
 *
 * with the tranche schedule:
 *   - V2 = V2_sticker − remise   (the remise lands on tranche 2 ONLY)
 *   - 2V = v3 = fixed stickers
 *
 * ⚠ STICKER-PRICE CASE (CALC-001 special): the workbook carries two rows
 * (SEDIKI ISHAK l5, SEDIKI YAKOUB l6) where the REMISE is recorded in J but
 * the devis formula does NOT subtract it — the devis follows the full
 * STICKER price while the V2 tranche still gets the remise. Pass
 * `chargeStickerPrice: true` to reproduce that behaviour explicitly.
 */
export function computeSchoolDevis(
  input: SchoolDevisStudentInput,
  chargeStickerPrice = false,
): SchoolDevisResult {
  const schedule = REAL_TUITION_BY_GRADE[input.gradeLevel];
  const fi = REAL_FI_BY_GRADE[input.gradeLevel];
  const remise = input.remise ?? 0;
  const includeTransport = input.includeTransport ?? true;
  const transportSchedule = includeTransport && input.transportDestination
    ? REAL_TRANSPORT_MATRIX[input.transportDestination]
    : null;
  const transport = transportSchedule ? transportSchedule[0] : 0;
  const devis = fi + schedule.scolarite + transport - (chargeStickerPrice ? 0 : remise);
  const v2 = Math.max(0, schedule.v2 - remise);
  return {
    fi,
    scolarite: schedule.scolarite,
    transport,
    remise,
    devis,
    tuitionTranches: [v2, schedule.tranche3, schedule.tranche4],
    transportTranches: transportSchedule
      ? [transportSchedule[1], transportSchedule[2], transportSchedule[3]]
      : [0, 0, 0],
  };
}

/**
 * FI lookup per grade (per student). `autiste` tracks fall back to the
 * dedicated autism FI (23 000 DZD).
 */
export function realFiForGrade(gradeLevel: GradeLevel, isAutisteTrack = false): number {
  if (isAutisteTrack) return REAL_FI_AUTISTE;
  return REAL_FI_BY_GRADE[gradeLevel];
}

/** Scolarité sticker lookup per grade. */
export function realScolariteForGrade(gradeLevel: GradeLevel, isAutisteTrack = false): number {
  if (isAutisteTrack) return REAL_TUITION_AUTISTE.scolarite;
  return REAL_TUITION_BY_GRADE[gradeLevel].scolarite;
}
