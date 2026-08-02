/**
 * SheetDetector — two-tier schema detection.
 *
 * Ported from `excel-import-engine/src/parsers/SheetDetector.js`.
 *
 * Tier 1: match by sheet name regex (`schema.sheetMatchers`).
 * Tier 2: match by header signature (`schema.requiredHeaders`) — only
 * runs if tier 1 fails AND a header row is provided.
 *
 * Detection precedence follows the SCHEMAS array order: ETAT → REF → BON → DEVIS.
 */
import type { ImportSchema } from "../types";
import { findSchemaForSheet, listSchemas } from "../schemas";

export class SheetDetector {
  /**
   * Detect the schema for a sheet.
   *
   * @param sheetName - The worksheet name.
   * @param headerRow - Optional header cells (lowercased + trimmed) for tier-2 detection.
   * @returns The first matching schema, or `null` if no match.
   */
  detect(sheetName: string, headerRow: readonly string[] | null = null): ImportSchema | null {
    // Tier 1: name match.
    const byName = findSchemaForSheet(sheetName);
    if (byName) return byName;

    // Tier 2: header signature.
    if (headerRow && headerRow.length > 0) {
      const normalizedHeaders = new Set(headerRow.map((h) => h.toLowerCase().trim()));
      for (const summary of listSchemas()) {
        const schema = findSchemaForSheet(summary.name) ?? null;
        if (!schema) continue;
        const requiredHeaders = schema.requiredHeaders;
        if (requiredHeaders.length === 0) continue;
        const allPresent = requiredHeaders.every((h) => normalizedHeaders.has(h.toLowerCase().trim()));
        if (allPresent) return schema;
      }
    }

    return null;
  }
}

export const defaultDetector = new SheetDetector();
