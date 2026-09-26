/**
 * SheetDetector — two-tier schema detection with FORMAT disambiguation.
 *
 * Ported from `excel-import-engine/src/parsers/SheetDetector.js`.
 *
 * Tier 1: match by sheet name regex (`schema.sheetMatchers`).
 * Tier 2: match by header signature (`schema.requiredHeaders`) — only
 * runs if tier 1 fails AND a header row is provided.
 *
 * T-414 (IMPORT-111, 2026-09-26): detection is now backed by the CENTRAL
 * ImportConfigRegistry — when several formats declare the same sheet NAME
 * ("ETAT 20262027" exists in both the 2026-2027 and 2027-2026 workbooks),
 * the header row disambiguates: the format whose requiredHeaders are ALL
 * present wins (most specific signature first, then detectionPriority).
 * The engine stays generic — the format knowledge lives in the registered
 * configuration documents.
 */
import type { ImportSchema } from "../types";
import { importConfigRegistry } from "../../import-config";

export class SheetDetector {
  /**
   * Detect the schema for a sheet.
   *
   * @param sheetName - The worksheet name.
   * @param headerRow - Optional header cells (actual text) for tier-2 /
   *                    format disambiguation.
   * @returns The matching schema, or `null` if no match.
   */
  detect(sheetName: string, headerRow: readonly string[] | null = null): ImportSchema | null {
    return importConfigRegistry.detect(sheetName, headerRow);
  }
}

export const defaultDetector = new SheetDetector();
