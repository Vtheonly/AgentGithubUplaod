/**
 * Excel DISTINATION column → canonical TransportDestination mapping.
 *
 * The Excel `DISTINATION` column contains raw town names (e.g. "BOUDOUAOU",
 * "DJENAT", "FIGUIER"). Since CALC-001 the canonical transport model is the
 * REAL per-town matrix `REAL_TRANSPORT_MATRIX` in
 * `src/domain/calc/pricing/school-price-matrix.ts` — 20 real towns with
 * observed 2026/2027 prices (40k–65k DZD).
 *
 * T-338 (61st session, 2026-09-14): the alias table itself now lives ONCE in
 * the domain layer — `src/domain/calc/pricing/transport.ts` exports
 * `TOWN_ALIASES` + `normalizeTransportTier` (the statistics-grade
 * null-aware entry point). This mapper delegates to it so the Excel import
 * and the executive statistics resolve IDENTICAL spellings (one table, no
 * duplicate — §9). The import-time semantics are preserved verbatim:
 * blank/unknown → "autres" (the row still imports with a defensible price);
 * the statistics entry point instead returns null for "no transport".
 */
import type { TransportDestination } from "../../../../domain/model/parent";
import { TOWN_ALIASES } from "../../../../domain/calc/pricing/transport";

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
