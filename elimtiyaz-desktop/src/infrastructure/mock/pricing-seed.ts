/**
 * Default pricing config — used to seed the mock repository.
 *
 * IMPORTANT: This is the ONLY place monetary amounts are hardcoded in the
 * entire codebase. After initial seed, all amounts come from the
 * PricingRepository (which in production reads from Supabase).
 *
 * CALC-001 fix (2026-09-12): the values now match the REAL 2026/2027 price
 * book extracted from `Suivis clients  2026_2027.xlsx` (the legacy Excel
 * workbook — see `domain/calc/pricing/school-price-matrix.ts` for the
 * formula-level evidence). The previous values came from a fictional
 * "Prices.md" (tuition 130k–395k, 4 transport zones, flat family FI of
 * 5 000 DZD) and matched NOTHING in the school's actual records.
 *
 * Per the plan: "Adding or changing a price must never require modifying
 * source code." The seed values are initial defaults only — admins edit
 * them at runtime via the Settings → Pricing tab.
 */
import type {
  PricingConfig,
  PricingEntry,
  DiscountCode,
} from "../../domain/model/pricing";
import type { GradeLevel } from "../../domain/model/student";
import { GRADE_LEVELS } from "../../domain/model/student";
import type { TransportDestination } from "../../domain/model/parent";
import { TRANSPORT_DESTINATIONS } from "../../domain/model/parent";
import {
  REAL_FI_BY_GRADE,
  REAL_TRANSPORT_MATRIX,
} from "../../domain/calc/pricing/school-price-matrix";

const TENANT_ID = "tenant-el-imtiyaz-oran-001";

const nowIso = () => new Date().toISOString();
const UPDATED_BY = "usr-adm-001";

// ---------------------------------------------------------------------------
// Tuition (per grade level — REAL 2026/2027 schedule from the workbook)
// ---------------------------------------------------------------------------

/** Real tuition schedule. Each tuple is [annual, V2, 2V, v3]. */
const TUITION_SCHEDULE: Record<GradeLevel, readonly [number, number, number, number]> = {
  prescolaire_1: [135_000, 54_000, 40_500, 40_500],
  prescolaire_2: [165_000, 66_000, 49_500, 49_500],
  "1ap": [220_000, 89_000, 65_500, 65_500],
  "2ap": [240_000, 97_000, 71_500, 71_500],
  "3ap": [255_000, 103_000, 76_000, 76_000],
  "4ap": [265_000, 107_000, 79_000, 79_000],
  "5ap": [270_000, 110_000, 80_000, 80_000],
  "1am": [305_000, 122_000, 91_500, 91_500],
  "2am": [320_000, 128_000, 96_000, 96_000],
  "3am": [330_000, 132_000, 99_000, 99_000],
  "4am": [340_000, 136_000, 102_000, 102_000],
  "1ere_annee": [350_000, 140_000, 105_000, 105_000],
  "2eme_annee": [355_000, 142_000, 106_500, 106_500],
  "3eme_annee": [365_000, 146_000, 109_500, 109_500],
};

const tuitionByGradeLevel = GRADE_LEVELS.reduce(
  (acc, g) => {
    const [annual, t1, t2, t3] = TUITION_SCHEDULE[g];
    acc[g] = {
      annualAmount: annual,
      installments: [t1, t2, t3] as const,
    };
    return acc;
  },
  {} as Record<GradeLevel, { annualAmount: number; installments: readonly [number, number, number] }>,
);

// ---------------------------------------------------------------------------
// FI per grade (REAL — charged per student)
// ---------------------------------------------------------------------------

const registrationFeeByGrade: Record<GradeLevel, number> = { ...REAL_FI_BY_GRADE };

// ---------------------------------------------------------------------------
// Transport (all real towns + legacy zones)
// ---------------------------------------------------------------------------

const transportByDestination = TRANSPORT_DESTINATIONS.reduce(
  (acc, d) => {
    const [annual, t1, t2, t3] = REAL_TRANSPORT_MATRIX[d];
    acc[d] = {
      annualAmount: annual,
      installments: [t1, t2, t3] as const,
    };
    return acc;
  },
  {} as Record<
    TransportDestination,
    { annualAmount: number; installments: readonly [number, number, number] }
  >,
);

// ---------------------------------------------------------------------------
// Discounts (the 2 REAL rules; fictional codes kept inactive for DB compat)
// ---------------------------------------------------------------------------

function makeDiscount(
  id: string,
  code: DiscountCode,
  label: string,
  amount: number,
  discountType: "percentage" | "fixed_amount",
  isActive = true,
): PricingEntry {
  return {
    id,
    tenantId: TENANT_ID,
    category: "discount",
    qualifier: code,
    label,
    amount,
    discountType,
    discountCode: code,
    isActive,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  };
}

const discounts: PricingEntry[] = [
  // REAL rule 1: sibling remise — 5 000 DZD per additional child
  // (the default component; the real remise is negotiated per family).
  makeDiscount(
    "disc-sibling-fixed",
    "sibling_fixed",
    "Fratrie — par enfant supplémentaire (−5 000 DA)",
    -5_000,
    "fixed_amount",
  ),
  // REAL rule 2: early annual payment — 5% of the SCOLARITÉ only
  // (workbook formula `=+SUM(F…)*0.05`), before June 30.
  makeDiscount(
    "disc-full-annual",
    "full_annual",
    "Paiement annuel avant le 30 juin (−5% scolarité)",
    5,
    "percentage",
  ),
  // Negotiated remise — free-form amount collected in the wizard.
  makeDiscount(
    "disc-negotiated-remise",
    "negotiated_remise",
    "Remise négociée (montant libre)",
    0,
    "fixed_amount",
  ),
  // ── Fictional rules (CALC-001): seeded INACTIVE so old DB rows keep
  //    rendering but the engine never fires them. ──
  makeDiscount(
    "disc-passage-palier",
    "passage_palier",
    "Passage de palier [RÈGLE FICTIVE — désactivée]",
    -10_000,
    "fixed_amount",
    false,
  ),
  makeDiscount(
    "disc-seniority-5y",
    "seniority_5y",
    "Ancienneté > 5 ans [RÈGLE FICTIVE — désactivée]",
    5,
    "percentage",
    false,
  ),
  makeDiscount(
    "disc-highest-average",
    "highest_average",
    "Meilleure moyenne du palier [RÈGLE FICTIVE — désactivée]",
    10,
    "percentage",
    false,
  ),
];

// ---------------------------------------------------------------------------
// Real school services (ETAT columns PSY1/PSY2/ORTH1/ORTH2/E-PLANT/Ratrapage)
// ---------------------------------------------------------------------------

const additionalServices: PricingEntry[] = [
  {
    id: "svc-psy1",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "psy1",
    label: "Séances de psychologie — 1er semestre (PSY1)",
    amount: 10_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-psy2",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "psy2",
    label: "Séances de psychologie — 2ème semestre (PSY2)",
    amount: 10_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-orth1",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "orth1",
    label: "Séances d'orthophonie — 1er semestre (ORTH1)",
    amount: 10_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-orth2",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "orth2",
    label: "Séances d'orthophonie — 2ème semestre (ORTH2)",
    amount: 10_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-e-plant",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "e_plant",
    label: "Plan d'accompagnement éducatif (E-PLANT)",
    amount: 20_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-ratrapage",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "ratrapage",
    label: "Rattrapage / soutien scolaire",
    amount: 10_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-autiste",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "autiste",
    label: "Programme d'intégration (autisme)",
    amount: 40_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
];

// ---------------------------------------------------------------------------
// Complementary services (psychology, speech therapy — semester & annual)
// ---------------------------------------------------------------------------

const complementaryServices: (PricingEntry & {
  semesterAmount: number;
  annualAmount: number;
})[] = [
  {
    id: "comp-psychology",
    tenantId: TENANT_ID,
    category: "complementary",
    qualifier: "psychology",
    label: "Séances de psychologie (20 séances)",
    amount: 20_000, // canonical annual amount (used by additional-services-style lookups)
    semesterAmount: 10_000,
    annualAmount: 20_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "comp-speech-therapy",
    tenantId: TENANT_ID,
    category: "complementary",
    qualifier: "speech_therapy",
    label: "Séances d'orthophonie (20 séances)",
    amount: 20_000,
    semesterAmount: 10_000,
    annualAmount: 20_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
];

// ---------------------------------------------------------------------------
// Default pricing config
// ---------------------------------------------------------------------------

export const defaultPricingConfig: PricingConfig = {
  tuitionByGradeLevel,
  transportByDestination,
  // LEGACY flat family FI (deprecated — see PricingConfig.registrationFeeByGrade).
  registrationFee: 25_000,
  registrationFeeByGrade,
  monthlyByLevel: {
    primaire: 6_000,
    cem: 6_800,
    lycee: 7_800,
  },
  latePenaltyPerDay: 0, // CALC-001: no daily penalty exists at the school
  discounts,
  additionalServices,
  complementaryServices,
  secondApronFee: 2_000,
};
