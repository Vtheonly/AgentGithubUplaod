/**
 * Build a comprehensive synthetic `Suivis clients 2026_2027 .xlsx` fixture
 * that mirrors the real documented structure. Used by the integration test
 * in `scripts/test-excel-import.ts`.
 *
 * The fixture covers:
 *   - Multiple students per parent (3 children sharing one phone)
 *   - Multiple parents with distinct phones
 *   - A row with blank NEM (parent phone) — must still import via
 *     placeholder parent ("Tuteur Inconnu")
 *   - A row with an unknown `niveau` code ("UNKNOWN_LEVEL") — must still
 *     import via the tolerant-enum fallback
 *   - Varied financial data: devisAnnuel, dettes, remise, remboursement,
 *     and a 12-month reglements array
 *   - A summary/total row at the end (must be skipped as non-data row)
 *   - Empty BON + Devis sheets (matches the user's real file log)
 *   - REF sheet with 5 reference rows
 */
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "test-fixture-suivis.xlsx");

interface EtatRow {
  infos?: string;
  email?: string;
  nem?: string;
  tuteur?: string;
  nom: string;
  niveau: string;
  classe: string;
  option?: string;
  remise?: number;
  justification?: string;
  devisAnnuel: number;
  remboursement?: number;
  dettes?: number;
  reglements?: number[]; // 12 months sep..aug
}

const etatRows: EtatRow[] = [
  // Parent 1 — 3 children sharing phone 0661111111
  {
    nom: "AMRANI Sara", niveau: "PRIM", classe: "1AP-A", nem: "0661111111",
    tuteur: "AMRANI Karim", email: "karim.amrani@example.com",
    devisAnnuel: 48000, dettes: 8000, remise: 2000,
    reglements: [5000, 5000, 0, 5000, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    nom: "AMRANI Yacine", niveau: "COLG", classe: "1AM-B", nem: "0661111111",
    tuteur: "AMRANI Karim", email: "karim.amrani@example.com",
    devisAnnuel: 56000, dettes: 0,
    reglements: [4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000],
  },
  {
    nom: "AMRANI Lina", niveau: "MS", classe: "GS-1", nem: "0661111111",
    tuteur: "AMRANI Karim", email: "karim.amrani@example.com",
    devisAnnuel: 36000, dettes: 12000, remboursement: 1500,
    reglements: [3000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Parent 2 — 2 children sharing phone 0772222222 / 0552222222 (multi-value)
  {
    nom: "BENALI Mohamed", niveau: "LYC", classe: "1ERE-S", nem: "0772222222/0552222222",
    tuteur: "BENALI Fatima", email: "fatima.benali@example.com",
    devisAnnuel: 72000, dettes: 18000,
    reglements: [6000, 6000, 6000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    option: "TRNSP",
  },
  {
    nom: "BENALI Amina", niveau: "PRIM", classe: "4AP-A", nem: "0772222222/0552222222",
    tuteur: "BENALI Fatima", email: "fatima.benali@example.com",
    devisAnnuel: 44000, dettes: 0, remise: 1000,
    reglements: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    option: "TRNSP",
  },
  // Parent 3 — single child, with option typo "TENSP" + unknown "TRNP"
  {
    nom: "CHERIF Riad", niveau: "COLG", classe: "3AM-C", nem: "0612345678",
    tuteur: "CHERIF Yazid", email: "yazid.cherif@example.com",
    devisAnnuel: 52000, dettes: 6000,
    reglements: [2000, 2000, 2000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    option: "TENSP",
  },
  // Parent 4 — blank NEM (must still import via placeholder)
  {
    nom: "DAHO Nadia", niveau: "PRIM", classe: "2AP-B",
    tuteur: "DAHO Wahiba", email: "wahida.daho@example.com",
    devisAnnuel: 42000, dettes: 0,
    reglements: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Parent 5 — unknown niveau code (must still import via fallback)
  {
    nom: "HAMIDI Ilyes", niveau: "UNKNOWN_LV", classe: "1AP-A", nem: "0558889999",
    tuteur: "HAMIDI Samir", email: "samir.hamidi@example.com",
    devisAnnuel: 38000, dettes: 3000,
    reglements: [500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    option: "TRNP",
  },
  // Parent 6 — Arabic-only name
  {
    nom: "زروقي أمين", niveau: "LYC", classe: "2ERE-S", nem: "0698765432",
    tuteur: "زروقي عبد القادر", email: null,
    devisAnnuel: 68000, dettes: 9000,
    reglements: [3000, 3000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Parent 7 — single child, no financial data beyond devisAnnuel
  {
    nom: "MEZIANE Yasmine", niveau: "GS", classe: "GS-2", nem: "0661234567",
    tuteur: "MEZIANE Leila", email: "leila.meziane@example.com",
    devisAnnuel: 30000, dettes: 0,
    reglements: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Parent 8 — MISSING CLASSE (the real-file error at L355).
  // Must still import via the "Non assignée" default.
  {
    nom: "SAYAH Karim", niveau: "PRIM", classe: "", nem: "0771112233",
    tuteur: "SAYAH Ahmed", email: "ahmed.sayah@example.com",
    devisAnnuel: 45000, dettes: 5000,
    reglements: [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Parent 9 — MISSING niveau AND CLASSE AND DEVIS ANNUEL.
  // Must still import via defaults (niveau→PRIM/1ap, classe→Non assignée, devisAnnuel→0).
  {
    nom: "Brahim Saidi", niveau: "", classe: "", nem: "0554443322",
    tuteur: "Saidi Mansour", email: null,
    devisAnnuel: 0, dettes: 0,
    reglements: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
];

async function buildWorkbook(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "test-fixture-builder";
  wb.created = new Date();

  // ── ETAT sheet ────────────────────────────────────────────────────────
  const etat = wb.addWorksheet("ETAT 20262027");
  etat.addRow([
    "INFOS", "E-MAIL", "NEM", "TUTEUR", "NOM", "niveau", "CLASSE", "OPTION",
    "REMISE", "JUSTIFICATION", "DEVIS ANNUEL", "REMBOURCEMENT", "DETTES",
    "REGLEMENTS DETTES",
    "sep", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug",
  ]);
  for (const r of etatRows) {
    etat.addRow([
      r.infos ?? "", r.email ?? "", r.nem ?? "", r.tuteur ?? "", r.nom,
      r.niveau, r.classe, r.option ?? "",
      r.remise ?? 0, r.justification ?? "", r.devisAnnuel, r.remboursement ?? 0,
      r.dettes ?? 0, "",
      ...(r.reglements ?? new Array(12).fill(0)),
    ]);
  }
  // Summary row — must be skipped
  etat.addRow(["", "", "", "", "TOTAL GÉNÉRAL", "", "", "", "", "", 0, 0, 0, "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  // ── BON sheet — empty (matches user's real file log: 0 rows) ──────────
  wb.addWorksheet("BON  ").addRow([
    "CLIENT", "DATE", "DEVIS ANNUEL", "ELEVES", "DEVIS", "TOTAL VERSE", "RESTE VERSE",
  ]);

  // ── Devis sheet — empty (matches user's real file log: 0 rows) ────────
  wb.addWorksheet("Devis").addRow([
    "Client", "Devis n°", "Date", "Prenom élève", "Classe",
    "Frais d'inscription", "Frais de scolarisation", "Services", "Total",
  ]);

  // ── REF sheet — 5 reference rows ──────────────────────────────────────
  const ref = wb.addWorksheet("REF");
  // No header row — REF schema uses headerRow: 0
  ref.addRow(["Mme SORIA", "1AP-A", "", "Boumerdès"]);
  ref.addRow(["M. KAMEL",  "1AM-B", "", "Tidjelabine"]);
  ref.addRow(["Mme LILA",  "1ERE-S", "", "Corso"]);
  ref.addRow(["M. RACHID", "GS-1",   "", "Boudouaou"]);
  ref.addRow(["Mme NADIA", "2AP-B",   "", "Thénia"]);

  return wb;
}

async function main(): Promise<void> {
  const wb = await buildWorkbook();
  const buf = await wb.xlsx.writeBuffer();
  writeFileSync(OUT_PATH, Buffer.from(buf));
  console.log(`Fixture written: ${OUT_PATH}`);
  console.log(`ETAT rows: ${etatRows.length}`);
}

await main();
