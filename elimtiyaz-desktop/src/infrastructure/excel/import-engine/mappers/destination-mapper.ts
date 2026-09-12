/**
 * Excel DISTINATION column → canonical TransportDestination mapping.
 *
 * The Excel `DISTINATION` column contains raw town names (e.g. "BOUDOUAOU",
 * "DJENAT", "FIGUIER"). Since CALC-001 the canonical transport model is the
 * REAL per-town matrix `REAL_TRANSPORT_MATRIX` in
 * `src/domain/calc/pricing/school-price-matrix.ts` — 20 real towns with
 * observed 2026/2027 prices (40k–65k DZD):
 *
 *   40 000: BOUMERDES
 *   43 000: CORSO, SAHEL, FIGUIER, TIDJELABINE
 *   52 000: BOUDOUAOU, THENIA
 *   57 000: ZEMMOURI
 *   55 000: DJENAT/CAP DJENET, BORDJ MENAIEL, SI MUSTAPHA, ISSER,
 *           OULED MOUSSA, KHEMIS EL KHECHNA, BENYOUNES, SOUK ELHAD,
 *           CHABAT/CHABET
 *   65 000: BENI AMRANE, REGHAIA, ROUIBA, OULED HEDDAJ, LAGATA
 *
 * The legacy 4-zone enum values (ville_boumerdes, …) remain valid keys —
 * they still resolve inside REAL_TRANSPORT_MATRIX — but every KNOWN town
 * spelling now maps to its own real-town key so the per-town price is
 * exact (the old mapping collapsed ZEMMOURI into the 52k zone and BENI
 * AMRANE into the 55k zone — both wrong by 5 000 / 10 000 DZD).
 *
 * Spelling variants below are the ones ACTUALLY OBSERVED in the workbook
 * (ETAT DISTINATION column + REF reference sheet), including the REF-sheet
 * typos: "ZEMOURI" (missing M), "REGHIAA" (double A), "KHEMIS KHENCHELA"
 * (real town: Khemis El Khechna), "OULED HEDDAJ /HOUCHE MEKHEFI".
 */
import type { TransportDestination } from "../../../../domain/model/parent";

/**
 * Exact spelling → real-town key. Input is normalized: trimmed, uppercased,
 * ALL whitespace removed. The compound REF spelling
 * "OULED HEDDAJ /HOUCHE MEKHEFI" normalizes to "OULEDHEDDAJ/HOUCHEMEKHEFI".
 */
const TOWN_ALIASES: Record<string, TransportDestination> = {
  // 40k — Boumerdès centre
  BOUMERDES: "boumerdes",
  BOUMRDES: "boumerdes",
  BOUMREDES: "boumerdes",
  BOUMERDES20000: "boumerdes",
  CHABAT: "chabat",
  CHABET: "chabet",
  // 43k — Corso / Sahel / Figuier / Tidjelabine
  CORSO: "corso",
  SAHEL: "sahel",
  FIGUIER: "figuier",
  TIDJELABINE: "tidjelabine",
  // 52k — Boudouaou / Thénia
  BOUDOUAOU: "boudouaou",
  THENIA: "thenia",
  // 57k — Zemmouri (REF-sheet typo "ZEMOURI" included)
  ZEMMOURI: "zemmouri",
  ZEMOURI: "zemmouri",
  // 55k — the "medium ring" towns
  DJENAT: "djenet",
  DJENET: "djenet",
  CAPDJENET: "cap_djenet",
  BORDJMNAIL: "bordj_menaiel",
  SIMUSTAPHA: "si_mustapha",
  ISSER: "isser",
  OULEDMOUSSA: "ouled_moussa",
  KHEMISKHECHNA: "khemis_el_khechna",
  KHEMISELKHCHNA: "khemis_el_khechna",
  KHEMISKHCHNA: "khemis_el_khechna",
  KHEMISKHENCHELA: "khemis_el_khechna", // REF-sheet typo
  BENYOUNES: "benyounes",
  SOUKELHAD: "souk_elhad",
  // 65k — the far ring
  BENIAMRAN: "beni_amrane",
  REGHAIA: "reghaia",
  REGHIAA: "reghaia", // REF-sheet typo
  ROUIBA: "rouiba",
  OULEDHEDADJ: "ouled_heddadj",
  OULEDHDADJ: "ouled_heddadj",
  "OULEDHEDDAJ/HOUCHEMEKHEFI": "ouled_heddadj", // REF compound spelling
  OULEDHADADJ: "ouled_heddadj",
  LAGATA: "lagata",
};

/**
 * Map a raw Excel DISTINATION value to a canonical TransportDestination.
 *
 * Known town spellings resolve to their REAL per-town key (exact price).
 * Unknown/blank values fall back to the legacy `autres` zone (55 000 DZD)
 * so the row still imports with a defensible price.
 */
export function mapExcelDestinationToCanonical(raw: unknown): TransportDestination {
  if (raw === null || raw === undefined) return "autres";
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return "autres";
  return TOWN_ALIASES[s] ?? "autres";
}
