/**
 * Schema registry — central lookup for all import schemas.
 *
 * Ported from `excel-import-engine/src/schemas/index.js`. Detection
 * precedence is ETAT → REF → BON → DEVIS (the order of the `SCHEMAS`
 * array). When two schemas could match a sheet, the first wins.
 */
import type { ImportSchema } from "../types";
import { ETAT_SCHEMA } from "./etat-schema";
import { REF_SCHEMA } from "./ref-schema";
import { BON_SCHEMA } from "./bon-schema";
import { DEVIS_SCHEMA } from "./devis-schema";

export const SCHEMAS: readonly ImportSchema[] = [
  ETAT_SCHEMA,
  REF_SCHEMA,
  BON_SCHEMA,
  DEVIS_SCHEMA,
];

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
