/**
 * REF schema — reference data (teachers, classes, localities).
 *
 * Ported from `excel-import-engine/src/schemas/refSchema.js`. Uses
 * `headerRow: 0` as a sentinel meaning "no header row" — the parser
 * generates synthetic `A`, `B`, `C`, `D`… headers from column count.
 *
 * T-414 (IMPORT-111 / ADR-026): DERIVED from the central configuration
 * document (import-config/configs/etat-2026-2027.ts) — functionally
 * identical to the historical hand-written definition.
 */
import type { ImportSchema } from "../types";
import { importConfigRegistry } from "../../import-config";

const compiled = importConfigRegistry
  .resolve("etat-2026-2027")
  .find((s) => s.name === "ref");

if (!compiled) {
  throw new Error("etat-2026-2027 config: the ref sheet failed to compile");
}

export const REF_SCHEMA: ImportSchema = compiled;
