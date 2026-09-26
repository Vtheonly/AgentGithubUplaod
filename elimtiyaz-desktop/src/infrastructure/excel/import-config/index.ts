/**
 * Import Configuration repository — the public surface (T-414 / ADR-026).
 *
 * ONE central registry holds every import configuration in the system.
 * The generic import engine resolves its schemas from here; nothing else
 * needs to know which formats exist. Adding a new spreadsheet format =
 * registering a new `ImportConfigDocument` (see `configs/`), never an
 * engine change.
 *
 * Built-in formats (seeded at module load):
 *   - etat-2026-2027 — "Suivis clients  2026_2027.xlsx" (ETAT + BON + Devis + REF)
 *   - etat-2027-2026 — "2027-2026.xlsx" (the new ETAT grid; statistiques excluded)
 */
import { ImportConfigRegistry } from "./config-registry";
import { ETAT_2026_2027_CONFIG } from "./configs/etat-2026-2027";
import { ETAT_2027_2026_CONFIG } from "./configs/etat-2027-2026";

export * from "./types";
export {
  ImportConfigRegistry,
  compileSheetConfig,
  validateImportConfigDocument,
} from "./config-registry";
export * from "./extensions";

/** The system-wide import configuration registry (single instance). */
export const importConfigRegistry = new ImportConfigRegistry();

// Seed the built-in format documents. Registration validates each document
// structurally; a failure here is a programming error (config typo) — the
// throw surfaces it at load time, not mid-import.
for (const doc of [ETAT_2026_2027_CONFIG, ETAT_2027_2026_CONFIG]) {
  const issues = importConfigRegistry.register(doc);
  if (issues.length > 0) {
    throw new Error(
      `invalid import configuration "${doc.id}": ${issues
        .map((i) => `${i.path}: ${i.message}`)
        .join("; ")}`,
    );
  }
}
