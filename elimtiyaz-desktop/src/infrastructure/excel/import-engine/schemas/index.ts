/**
 * Schema registry — central lookup for all import schemas.
 *
 * Ported from `excel-import-engine/src/schemas/index.js`. Detection
 * precedence is ETAT → REF → BON → DEVIS (the order of the `SCHEMAS`
 * array). When two schemas could match a sheet, the first wins.
 *
 * T-414 (IMPORT-111 / ADR-026, 2026-09-26): the schema universe is now
 * DERIVED from the central ImportConfigRegistry — the format knowledge
 * lives in configuration documents (data), not in this module. The
 * compiled order preserves the legacy precedence: the 2026-2027 format's
 * sheets (etat → ref → bon → devis) come first, then the 2027-2026
 * format's etat sheet. The engine consumes this shim exactly as before.
 */
import type { ImportSchema } from "../types";
import { importConfigRegistry } from "../../import-config";

/** Every enabled compiled schema, in detection order (registry-driven). */
export const SCHEMAS: readonly ImportSchema[] = importConfigRegistry.resolveAll();

export function findSchemaByName(name: string): ImportSchema | undefined {
  return SCHEMAS.find((s) => s.name === name);
}

/** First schema whose `sheetMatchers` regex array matches the sheet name. */
export function findSchemaForSheet(sheetName: string): ImportSchema | undefined {
  return SCHEMAS.find((s) => s.sheetMatchers.some((re) => re.test(sheetName)));
}

/** Lightweight summary used by the detector's tier-2 iteration. */
export function listSchemas(): readonly { name: string; matchers: readonly RegExp[] }[] {
  return SCHEMAS.map((s) => ({ name: s.name, matchers: s.sheetMatchers }));
}
