/**
 * Default pricing config — used to seed the mock repository.
 *
 * IMPORTANT: This is the ONLY place monetary amounts are hardcoded in the
 * entire codebase. After initial seed, all amounts come from the
 * PricingRepository (which in production reads from Supabase).
 *
 * Per the plan: "Adding or changing a price must never require modifying
 * source code." The seed values are initial defaults only — admins edit
 * them at runtime via the Settings → Pricing tab.
 *
 * Iteration 6: Default values now match the OFFICIAL 2026-2027 fee schedule
 * provided by the school administration:
 *
 *   Tuition (per grade level, 3-tranche schedule):
 *     - Préscolaire 01  : 130 000 DA (52 000 + 39 000 + 39 000)
 *     - Préscolaire 02  : 180 000 DA (72 000 + 54 000 + 54 000)
 *     - 1AP             : 245 000 DA (98 000 + 73 500 + 73 500)
 *     - 2AP             : 265 000 DA (106 000 + 79 500 + 79 500)
 *     - 3AP             : 280 000 DA (112 000 + 84 000 + 84 000)
 *     - 4AP             : 285 000 DA (114 000 + 85 500 + 85 500)
 *     - 5AP             : 300 000 DA (120 000 + 90 000 + 90 000)
 *     - 1AM             : 330 000 DA (132 000 + 99 000 + 99 000)
 *     - 2AM             : 345 000 DA (138 000 + 103 500 + 103 500)
 *     - 3AM             : 355 000 DA (142 000 + 106 500 + 106 500)
 *     - 4AM             : 370 000 DA (148 000 + 111 000 + 111 000)
 *     - 1ère Année      : 375 000 DA (150 000 + 112 500 + 112 500)
 *     - 2ème Année      : 380 000 DA (152 000 + 114 000 + 114 000)
 *     - 3ème Année      : 395 000 DA (158 000 + 118 500 + 118 500)
 *
 *   Transport (per destination, 3-tranche schedule):
 *     - Ville Boumerdès                            : 40 000 DA (20 000 + 10 000 + 10 000)
 *     - Tidjelabine – Sahel – Figuier – Corso     : 43 000 DA (20 000 + 13 000 + 10 000)
 *     - Boudouaou – Thénia – Zemmouri             : 52 000 DA (30 000 + 12 000 + 10 000)
 *     - Autres                                     : 55 000 DA (30 000 + 15 000 + 10 000)
 *
 *   Complementary services:
 *     - Psychology sessions (20 sessions) : 10 000 DA / semester | 20 000 DA / annual
 *     - Speech therapy sessions (20 sessions) : 10 000 DA / semester | 20 000 DA / annual
 *
 *   2nd apron surcharge: 2 000 DA
 *
 *   Discounts:
 *     - Passage de palier             : −10 000 DA (fixed)
 *     - Ancienneté > 5 ans            : −5% (percentage)
 *     - Paiement annuel avant 30 juin : −10% (percentage)
 *     - Meilleure moyenne du palier   : −10% (percentage)
 *     - Fratrie — enfant supplémentaire : −5 000 DA (fixed per additional student)
 *
 * Iteration 6: TENANT_ID is defined locally to avoid a circular dependency
 * with seed-data.ts. The canonical TENANT_ID remains in seed-data.ts.
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

const TENANT_ID = "tenant-el-imtiyaz-oran-001";

const nowIso = () => new Date().toISOString();
const UPDATED_BY = "usr-adm-001";

// ---------------------------------------------------------------------------
// Tuition (per grade level, 3-tranche schedule)
// ---------------------------------------------------------------------------

/**
 * Official 2026-2027 tuition schedule.
 * Each tuple is [annual, tranche1, tranche2, tranche3].
 */
const TUITION_SCHEDULE: Record<GradeLevel, readonly [number, number, number, number]> = {
  prescolaire_1: [130_000, 52_000, 39_000, 39_000],
  prescolaire_2: [180_000, 72_000, 54_000, 54_000],
  "1ap": [245_000, 98_000, 73_500, 73_500],
  "2ap": [265_000, 106_000, 79_500, 79_500],
  "3ap": [280_000, 112_000, 84_000, 84_000],
  "4ap": [285_000, 114_000, 85_500, 85_500],
  "5ap": [300_000, 120_000, 90_000, 90_000],
  "1am": [330_000, 132_000, 99_000, 99_000],
  "2am": [345_000, 138_000, 103_500, 103_500],
  "3am": [355_000, 142_000, 106_500, 106_500],
  "4am": [370_000, 148_000, 111_000, 111_000],
  "1ere_annee": [375_000, 150_000, 112_500, 112_500],
  "2eme_annee": [380_000, 152_000, 114_000, 114_000],
  "3eme_annee": [395_000, 158_000, 118_500, 118_500],
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
// Transport (per destination, 3-tranche schedule)
// ---------------------------------------------------------------------------

/**
 * Official 2026-2027 transport schedule.
 * Each tuple is [annual, tranche1 (at registration), tranche2 (Dec), tranche3 (Mar)].
 */
const TRANSPORT_SCHEDULE: Record<
  TransportDestination,
  readonly [number, number, number, number]
> = {
  ville_boumerdes: [40_000, 20_000, 10_000, 10_000],
  tidjelabine_sahel_figuier_corso: [43_000, 20_000, 13_000, 10_000],
  boudouaou_thenia_zemmouri: [52_000, 30_000, 12_000, 10_000],
  autres: [55_000, 30_000, 15_000, 10_000],
};

const transportByDestination = TRANSPORT_DESTINATIONS.reduce(
  (acc, d) => {
    const [annual, t1, t2, t3] = TRANSPORT_SCHEDULE[d];
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
// Discounts (5 canonical + 3 legacy)
// ---------------------------------------------------------------------------

function makeDiscount(
  id: string,
  code: DiscountCode,
  label: string,
  amount: number,
  discountType: "percentage" | "fixed_amount",
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
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  };
}

const discounts: PricingEntry[] = [
  // Canonical 2026-2027 discounts
  makeDiscount(
    "disc-passage-palier",
    "passage_palier",
    "Passage de palier (−10 000 DA)",
    -10_000,
    "fixed_amount",
  ),
  makeDiscount(
    "disc-seniority-5y",
    "seniority_5y",
    "Ancienneté > 5 ans (−5%)",
    5,
    "percentage",
  ),
  makeDiscount(
    "disc-full-annual",
    "full_annual",
    "Paiement annuel avant le 30 juin (−10%)",
    10,
    "percentage",
  ),
  makeDiscount(
    "disc-highest-average",
    "highest_average",
    "Meilleure moyenne du palier (−10%)",
    10,
    "percentage",
  ),
  makeDiscount(
    "disc-sibling-fixed",
    "sibling_fixed",
    "Fratrie — par enfant supplémentaire (−5 000 DA)",
    -5_000,
    "fixed_amount",
  ),
];

// ---------------------------------------------------------------------------
// Additional services (canteen, uniform, books, 2nd apron, clubs)
// ---------------------------------------------------------------------------

const additionalServices: PricingEntry[] = [
  {
    id: "svc-canteen-term",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "canteen_term",
    label: "Cantine — trimestre",
    amount: 12_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-uniform",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "uniform",
    label: "Uniforme scolaire",
    amount: 8_500,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-books",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "books",
    label: "Livres et fournitures",
    amount: 6_500,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-chess-club",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "chess_club",
    label: "Club d'échecs (annuel)",
    amount: 9_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-english-club",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "english_club",
    label: "Club d'anglais (annuel)",
    amount: 11_000,
    isActive: true,
    updatedAt: nowIso(),
    updatedBy: UPDATED_BY,
  },
  {
    id: "svc-second-apron",
    tenantId: TENANT_ID,
    category: "additional",
    qualifier: "second_apron",
    label: "2ème tablier",
    amount: 2_000,
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
  registrationFee: 5_000,
  monthlyByLevel: {
    primaire: 6_000,
    cem: 6_800,
    lycee: 7_800,
  },
  latePenaltyPerDay: 100,
  discounts,
  additionalServices,
  complementaryServices,
  secondApronFee: 2_000,
};
