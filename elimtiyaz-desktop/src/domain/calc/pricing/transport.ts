/**
 * Transport pricing calculations — single source of truth for transport
 * lookups and tranche schedules.
 *
 * Extracted from `domain/model/pricing.ts`:
 *   - `transportForDestination`                — per-destination lookup
 *   - `transportForTier`                       — per-tier lookup (legacy fallback)
 *   - `transportTranchesForDestination`        — 3-tranche schedule for a destination
 *
 * Behavior preserved verbatim:
 *   - `transportForTier` delegates to `cityTierToDestination` for the
 *     tier → destination mapping, then calls `transportForDestination`.
 *   - Tranche labels are FR (preserved from original):
 *       * "Tranche 1 (À l'inscription)"
 *       * "Tranche 2 (01 Déc – 15 Déc)"
 *       * "Tranche 3 (01 Mar – 15 Mar)"
 *
 * UNIFIED ARCHITECTURE additions:
 *   - `getOfficialTransportDueDates(startYear)` — returns the official ISO
 *     due-date triple per `Prices.md`: Sept 15 / Dec 15 / Mar 15.
 *   - `getOfficialTransportTrancheSplit(destination)` — returns the exact
 *     per-destination tranche amounts from `Prices.md` (e.g. Ville Boumerdes
 *     = 20k/10k/10k DA, Autres = 30k/15k/10k DA).
 */
import type { TransportDestination } from "@/domain/model/parent";
import { cityTierToDestination } from "@/domain/model/parent";
import type { PricingConfig, TransportPricing } from "@/domain/model/pricing";
import { REAL_TRANSPORT_MATRIX } from "./school-price-matrix";

/* ============================================================ */
/*  TOWN-ALIAS normalization (T-338 — the statistics leg)       */
/* ============================================================ */

/**
 * Exact spelling → real-town key. Input is normalized: trimmed, uppercased,
 * ALL whitespace removed.
 *
 * T-338 (61st session): this table is the ONE canonical copy of the town
 * aliases, lifted verbatim from the Excel `DISTINATION` mapper (which now
 * delegates here). The workbook spelling variants (ETAT DISTINATION column +
 * REF reference sheet, including the REF typos "ZEMOURI", "REGHIAA",
 * "KHEMIS KHENCHELA", "OULED HEDDAJ /HOUCHE MEKHEFI") and the LIVE
 * `students.transport_tier` values (which include "BOUMRDES", "BOUMREDES",
 * "OULED MOUSSA", "KHEMISELKHCHNA", …) all resolve through it.
 */
export const TOWN_ALIASES: Readonly<Record<string, TransportDestination>> = {
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
  // Legacy grouped-zone codes that appear as transport_tier values
  TIDJELABINE_SAHEL_FIGUIER_CORSO: "tidjelabine_sahel_figuier_corso",
  BOUDOUAOU_THENIA_ZEMMOURI: "boudouaou_thenia_zemmouri",
  VILLEBOUMERDES: "ville_boumerdes",
};

/**
 * Normalize a raw transport-tier/town string to its canonical
 * TransportDestination — the statistics-grade entry point (T-338).
 *
 * Semantics (deliberately different from the Excel pricing mapper):
 *   - null / undefined / blank → null — the student has NO transport
 *     service; transport statistics must NOT count them.
 *   - Known spelling → the canonical real-town key.
 *   - Unknown non-empty value → "autres" (the legacy fallback zone) — the
 *     student IS a rider, just from an unrecognized locality.
 */
export function normalizeTransportTier(
  raw: string | null | undefined,
): TransportDestination | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  return TOWN_ALIASES[s] ?? "autres";
}

/* ============================================================ */
/*  Official schedule generators (Prices.md — 2026-2027)        */
/* ============================================================ */

/**
 * Official transport tranche due dates per `Prices.md`.
 *
 * Identical to the tuition calendar:
 *   - Tranche 1: September 15 of `startYear`      (at registration)
 *   - Tranche 2: December 15 of `startYear`       (window: Dec 1 – 15)
 *   - Tranche 3: March 15 of `startYear + 1`      (window: Mar 1 – 15)
 *
 * @param startYear  The calendar year in which the academic year starts.
 * @returns A 3-tuple of ISO date strings `[T1, T2, T3]`.
 */
export function getOfficialTransportDueDates(
  startYear: number,
): readonly [string, string, string] {
  return [
    new Date(Date.UTC(startYear, 8, 15)).toISOString(), // Sept 15
    new Date(Date.UTC(startYear, 11, 15)).toISOString(), // Dec 15
    new Date(Date.UTC(startYear + 1, 2, 15)).toISOString(), // Mar 15
  ];
}

/**
 * Official transport tranche split per `Prices.md`.
 *
 * Returns the exact per-destination tranche amounts in DA:
 *
 * | Destination                                  | T1     | T2     | T3     |
 * |----------------------------------------------|--------|--------|--------|
 * | ville_boumerdes                              | 20,000 | 10,000 | 10,000 |
 * | tidjelabine_sahel_figuier_corso              | 20,000 | 13,000 | 10,000 |
 * | boudouaou_thenia_zemmouri                    | 30,000 | 12,000 | 10,000 |
 * | autres                                       | 30,000 | 15,000 | 10,000 |
 *
 * These amounts are the *official* schedule and sum exactly to the annual
 * transport fee for each destination. They are used as the canonical
 * allocation when generating transport charge entries + installments.
 */
export function getOfficialTransportTrancheSplit(
  destination: TransportDestination,
): readonly [number, number, number] {
  switch (destination) {
    case "ville_boumerdes":
      return [20_000, 10_000, 10_000];
    case "tidjelabine_sahel_figuier_corso":
      return [20_000, 13_000, 10_000];
    case "boudouaou_thenia_zemmouri":
      return [30_000, 12_000, 10_000];
    case "autres":
      return [30_000, 15_000, 10_000];
    default: {
      // CALC-001: the 20 real towns — look up the real matrix (annual, T1, T2, T3).
      const schedule = REAL_TRANSPORT_MATRIX[destination];
      return [schedule[1], schedule[2], schedule[3]];
    }
  }
}

/**
 * Convenience: look up transport pricing for a destination.
 *
 * Returns `{ annualAmount: 0, installments: [0, 0, 0] }` when the destination
 * is not configured — preserves original fallback semantics.
 */
export function transportForDestination(
  config: PricingConfig,
  destination: TransportDestination,
): TransportPricing {
  return (
    config.transportByDestination[destination] ?? {
      annualAmount: 0,
      installments: [0, 0, 0],
    }
  );
}

/**
 * Convenience: look up transport annual amount for a legacy tier.
 *
 * Delegates to `cityTierToDestination` for the tier → destination mapping,
 * then calls `transportForDestination`. Returns 0 when the tier maps to
 * no known destination (preserves original behavior).
 */
export function transportForTier(
  config: PricingConfig,
  tier: "t1" | "t2" | "t3",
): number {
  const destination = cityTierToDestination(tier);
  if (!destination) return 0;
  return transportForDestination(config, destination).annualAmount;
}

/**
 * Compute the 3-tranche schedule for transport given a destination.
 *
 * Tranche 1 is due at registration, Tranche 2 Dec 01–15, Tranche 3 Mar 01–15.
 */
export function transportTranchesForDestination(
  config: PricingConfig,
  destination: TransportDestination,
): ReadonlyArray<{ label: string; amountDue: number }> {
  const pricing = transportForDestination(config, destination);
  return [
    { label: "Tranche 1 (À l'inscription)", amountDue: pricing.installments[0] },
    { label: "Tranche 2 (01 Déc – 15 Déc)", amountDue: pricing.installments[1] },
    { label: "Tranche 3 (01 Mar – 15 Mar)", amountDue: pricing.installments[2] },
  ];
}
