/**
 * DEVIS schema — family quote slips.
 *
 * T-414 (IMPORT-111 / ADR-026): DERIVED from the central configuration
 * document (import-config/configs/etat-2026-2027.ts) — functionally
 * identical to the historical hand-written definition.
 */
import type { ImportSchema } from "../types";
import { importConfigRegistry } from "../../import-config";

const compiled = importConfigRegistry
  .resolve("etat-2026-2027")
  .find((s) => s.name === "devis");

if (!compiled) {
  throw new Error("etat-2026-2027 config: the devis sheet failed to compile");
}

export const DEVIS_SCHEMA: ImportSchema = compiled;
