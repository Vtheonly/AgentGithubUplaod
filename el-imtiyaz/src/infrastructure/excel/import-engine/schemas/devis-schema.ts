/**
 * Devis schema — client quotes (one quote per ~20-row block).
 *
 * Ported from `excel-import-engine/src/schemas/devisSchema.js`. Identity
 * is `client + devisNumero`. The schema is a form-style layout with the
 * header at row 13 — see the standalone engine's technical map for the
 * known limitation that per-field `headerRow` overrides are not honored
 * by the parser (the engine only reads the schema-level `headerRow`).
 */
import type { ImportSchema } from "../types";

export const DEVIS_SCHEMA: ImportSchema = {
  name: "devis",
  sheetMatchers: [/^DEVIS$/i, /^DEVIS\s/i],
  headerRow: 13,
  requiredHeaders: ["Prenom élève"],
  identity: { fields: ["client", "devisNumero"], strategy: "upsert" },
  fields: [
    { key: "client", header: "Client", type: "string", required: true },
    { key: "devisNumero", header: "Devis n°", type: "string", required: true },
    { key: "date", header: "Date", type: "date", required: false },
    { key: "prenomEleve", header: "Prenom élève", type: "string", required: true },
    { key: "classe", header: "Classe", type: "string", required: false },
    { key: "fraisInscription", header: "Frais d'inscription", type: "numberOrRef", required: false },
    { key: "fraisScolarisation", header: "Frais de scolarisation", type: "numberOrRef", required: false },
    { key: "services", header: "Services", type: "numberOrRef", required: false },
    { key: "total", header: "Total", type: "numberOrRef", required: false },
  ],
};
