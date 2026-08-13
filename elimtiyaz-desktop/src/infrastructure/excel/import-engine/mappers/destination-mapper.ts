/**
 * Excel DISTINATION column → canonical TransportDestination mapping.
 *
 * The Excel `DISTINATION` column contains raw town names (e.g. "BOUDOUAOU",
 * "DJENAT", "FIGUIER"). The canonical `TransportDestination` enum has 4
 * values per `Prices.md`:
 *
 *   - ville_boumerdes                → 40,000 DA (20k + 10k + 10k)
 *   - tidjelabine_sahel_figuier_corso → 43,000 DA (20k + 13k + 10k)
 *   - boudouaou_thenia_zemmouri      → 52,000 DA (30k + 12k + 10k)
 *   - autres                         → 55,000 DA (30k + 15k + 10k)
 *
 * This mapping normalizes the raw town names to the canonical enum so the
 * importer can look up the correct transport pricing.
 */
import type { TransportDestination } from "../../../../domain/model/parent";

/**
 * Map a raw Excel DISTINATION value to a canonical TransportDestination.
 *
 * The mapping is based on the actual values found in the real
 * `Suivis clients 2026_2027.xlsx` workbook:
 *
 *   ville_boumerdes:
 *     BOUMERDES, BOUMRDES, BOUMREDES, BOUMERDES20000, CHABAT, CHABET
 *
 *   tidjelabine_sahel_figuier_corso:
 *     TIDJELABINE, SAHEL, FIGUIER, CORSO, DJENAT
 *
 *   boudouaou_thenia_zemmouri:
 *     BOUDOUAOU, THENIA, ZEMMOURI
 *
 *   autres (everything else):
 *     BENIAMRAN, BORDJMNAIL, ERBATACHE, ISSER, KHEMIS KHECHNA,
 *     KHEMISELKHCHNA, KHEMISKHCHNA, LAGATA, OULED MOUSSA, OULEDMOUSA,
 *     OULEDHDADJ, OULEDHADADJ, OULEDHEDADJ, REGHAIA
 */
export function mapExcelDestinationToCanonical(raw: unknown): TransportDestination {
  if (raw === null || raw === undefined) return "autres";
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return "autres";

  // ville_boumerdes — Boumerdes centre + nearby (Chabat)
  if (s === "BOUMERDES" || s === "BOUMRDES" || s === "BOUMREDES" ||
      s === "BOUMERDES20000" || s === "CHABAT" || s === "CHABET") {
    return "ville_boumerdes";
  }

  // tidjelabine_sahel_figuier_corso
  if (s === "TIDJELABINE" || s === "SAHEL" || s === "FIGUIER" ||
      s === "CORSO" || s === "DJENAT") {
    return "tidjelabine_sahel_figuier_corso";
  }

  // boudouaou_thenia_zemmouri
  if (s === "BOUDOUAOU" || s === "THENIA" || s === "ZEMMOURI") {
    return "boudouaou_thenia_zemmouri";
  }

  // Everything else → autres (55,000 DA per Prices.md)
  return "autres";
}

/**
 * Official 2026-2027 tuition schedule from `Prices.md`.
 * Each tuple is [annual, tranche1, tranche2, tranche3].
 *
 * These are the REAL prices — not percentages or made-up numbers.
 */
export const OFFICIAL_TUITION_SCHEDULE: Record<string, readonly [number, number, number, number]> = {
  // Préscolaire & Primaire
  prescolaire_1: [130_000, 52_000, 39_000, 39_000],
  prescolaire_2: [180_000, 72_000, 54_000, 54_000],
  "1ap": [245_000, 98_000, 73_500, 73_500],
  "2ap": [265_000, 106_000, 79_500, 79_500],
  "3ap": [280_000, 112_000, 84_000, 84_000],
  "4ap": [285_000, 114_000, 85_500, 85_500],
  "5ap": [300_000, 120_000, 90_000, 90_000],
  // Collège
  "1am": [330_000, 132_000, 99_000, 99_000],
  "2am": [345_000, 138_000, 103_500, 103_500],
  "3am": [355_000, 142_000, 106_500, 106_500],
  "4am": [370_000, 148_000, 111_000, 111_000],
  // Lycée
  "1ere_annee": [375_000, 150_000, 112_500, 112_500],
  "2eme_annee": [380_000, 152_000, 114_000, 114_000],
  "3eme_annee": [395_000, 158_000, 118_500, 118_500],
};

/**
 * Official 2026-2027 transport schedule from `Prices.md`.
 * Each tuple is [annual, tranche1, tranche2, tranche3].
 *
 * | Destination                                  | T1     | T2     | T3     | Total  |
 * |----------------------------------------------|--------|--------|--------|--------|
 * | Ville Boumerdès                              | 20,000 | 10,000 | 10,000 | 40,000 |
 * | Tidjelabine – Sahel – Figuier – Corso        | 20,000 | 13,000 | 10,000 | 43,000 |
 * | Boudouaou – Thénia – Zemmouri                | 30,000 | 12,000 | 10,000 | 52,000 |
 * | Autres                                       | 30,000 | 15,000 | 10,000 | 55,000 |
 */
export const OFFICIAL_TRANSPORT_SCHEDULE: Record<TransportDestination, readonly [number, number, number, number]> = {
  ville_boumerdes: [40_000, 20_000, 10_000, 10_000],
  tidjelabine_sahel_figuier_corso: [43_000, 20_000, 13_000, 10_000],
  boudouaou_thenia_zemmouri: [52_000, 30_000, 12_000, 10_000],
  autres: [55_000, 30_000, 15_000, 10_000],
};

/**
 * Official complementary services pricing from `Prices.md`.
 */
export const OFFICIAL_SERVICES_PRICING = {
  psychology_semester: 10_000,
  psychology_annual: 20_000,
  speech_therapy_semester: 10_000,
  speech_therapy_annual: 20_000,
  second_apron: 2_000,
} as const;

/**
 * Official discounts from `Prices.md`.
 */
export const OFFICIAL_DISCOUNTS = {
  passage_palier: 10_000, // fixed -10,000 DA
  sibling: 5_000, // fixed -5,000 DA per additional child
  early_annual: 0.10, // 10% off for full annual payment before June 30
  highest_average: 0.10, // 10% off for highest average in level
  seniority: 0.05, // 5% off for > 5 years seniority
} as const;
