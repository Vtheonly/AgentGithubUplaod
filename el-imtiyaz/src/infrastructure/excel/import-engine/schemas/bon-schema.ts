import type { ImportSchema } from "../types";

export const BON_SCHEMA: ImportSchema = {
  name: "bon",
  sheetMatchers: [/^BON\s*$/i, /^BONS?$/i],
  headerRow: 1,
  dataStartRow: 2,
  requiredHeaders: ["ELEVES"],
  identity: { fields: ["eleve"], strategy: "upsert" },
  fields: [
    { key: "client", header: "CLIENT", type: "string", required: false },
    { key: "date", header: "DATE", type: "date", required: false },
    {
      key: "devisAnnuel",
      header: "DEVIS ANNUEL",
      type: "number",
      required: false,
    },
    { key: "eleve", header: "ELEVES", type: "string", required: false },
    { key: "devis", header: "DEVIS", type: "numberOrRef", required: false },
    {
      key: "totalVerse",
      header: "TOTAL VERSE",
      type: "numberOrRef",
      required: false,
    },
    {
      key: "resteVerse",
      header: "RESTE VERSE",
      type: "numberOrRef",
      required: false,
    },
  ],
};
