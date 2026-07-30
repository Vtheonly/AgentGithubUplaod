import type { ImportSchema } from "../types";

export const DEVIS_SCHEMA: ImportSchema = {
  name: "devis",
  sheetMatchers: [/^DEVIS$/i, /^DEVIS\s/i],
  headerRow: 1,
  dataStartRow: 2,
  requiredHeaders: ["Prenom élève"],
  identity: { fields: ["client", "devisNumero"], strategy: "upsert" },
  fields: [
    { key: "client", header: "Client", type: "string", required: false },
    { key: "devisNumero", header: "Devis n°", type: "string", required: false },
    { key: "date", header: "Date", type: "date", required: false },
    {
      key: "prenomEleve",
      header: "Prenom élève",
      type: "string",
      required: false,
    },
    { key: "classe", header: "Classe", type: "string", required: false },
    {
      key: "fraisInscription",
      header: "Frais d'inscription",
      type: "numberOrRef",
      required: false,
    },
    {
      key: "fraisScolarisation",
      header: "Frais de scolarisation",
      type: "numberOrRef",
      required: false,
    },
    {
      key: "services",
      header: "Services",
      type: "numberOrRef",
      required: false,
    },
    { key: "total", header: "Total", type: "numberOrRef", required: false },
  ],
};
