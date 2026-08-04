/**
 * Build a comprehensive synthetic `Suivis clients 2026_2027 .xlsx` fixture
 * that mirrors the REAL documented structure of `Suivis clients 2026_2027.xlsx`.
 *
 * IMPORTANT — header layout matches the real workbook exactly:
 *
 *   B..K  : Identity (INFOS, E-MAIL, NEM, TUTEUR, NOM, niveau, CLASSE,
 *           OPTION, REMISE, JUSTIFICATION)
 *   L..Q  : Quote & Balance (DEVIS ANNUEL, REMBOURCEMENT, DETTES,
 *           REGLEMENTS DETTES, TOTAL VERSEMENTS, TOTAL*CREANCE)
 *   R..Y  : Installments (FI, V2, 2V, v3, DISTINATION, 1T, T2, t3)
 *
 * The previous fixture wrongly added 12 monthly columns ("sep".."aug") after
 * REGLEMENTS DETTES — that does NOT exist in the real file. REGLEMENTS
 * DETTES is a SINGLE numeric column.
 *
 * The fixture covers:
 *   - Multiple students per parent (3 children sharing one phone)
 *   - Multiple parents with distinct phones
 *   - A row with blank NEM (parent phone) — must still import via
 *     placeholder parent
 *   - A row with an unknown `niveau` code ("UNKNOWN_LEVEL") — must still
 *     import via the tolerant-enum fallback
 *   - Varied financial data: devisAnnuel, dettes, remise, remboursement,
 *     reglementsDettes, and full payment columns (FI, V2, 2V, v3, 1T, T2, t3)
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
  reglementsDettes?: number;
  fi?: number;
  v2?: number;
  v2Alt?: number;
  v3?: number;
  distination?: string;
  t1?: number;
  t2?: number;
  t3?: number;
}

const etatRows: EtatRow[] = [
  // Parent 1 — 3 children sharing phone 0661111111
  {
    nom: "AMRANI Sara", niveau: "PRIM", classe: "1AP-A", nem: "0661111111",
    tuteur: "AMRANI Karim", email: "karim.amrani@example.com",
    devisAnnuel: 245000, dettes: 8000, remise: 5000,
    reglementsDettes: 3000,
    fi: 25000, v2: 73500, v3: 73500, distination: "BOUMERDES", t1: 13000, t2: 7000, t3: 3000,
  },
  {
    nom: "AMRANI Yacine", niveau: "COLG", classe: "1AM-B", nem: "0661111111",
    tuteur: "AMRANI Karim", email: "karim.amrani@example.com",
    devisAnnuel: 330000, dettes: 0,
    fi: 30000, v2: 99000, v3: 99000, distination: "BOUMERDES", t1: 13000, t2: 7000, t3: 3000,
  },
  {
    nom: "AMRANI Lina", niveau: "MS", classe: "GS-1", nem: "0661111111",
    tuteur: "AMRANI Karim", email: "karim.amrani@example.com",
    devisAnnuel: 130000, dettes: 12000, remboursement: 1500,
    reglementsDettes: 6000,
    fi: 18000, v2: 39000, v3: 39000,
  },
  // Parent 2 — 2 children sharing phone 0772222222 / 0552222222 (multi-value)
  {
    nom: "BENALI Mohamed", niveau: "LYC", classe: "1ERE-S", nem: "0772222222/0552222222",
    tuteur: "BENALI Fatima", email: "fatima.benali@example.com",
    devisAnnuel: 375000, dettes: 18000,
    reglementsDettes: 9000,
    fi: 30000, v2: 112500, v3: 112500, distination: "BOUDOUAOU", t1: 30000, t2: 12000, t3: 10000,
    option: "TRNSP",
  },
  {
    nom: "BENALI Amina", niveau: "PRIM", classe: "4AP-A", nem: "0772222222/0552222222",
    tuteur: "BENALI Fatima", email: "fatima.benali@example.com",
    devisAnnuel: 285000, dettes: 0, remise: 5000,
    fi: 25000, v2: 85500, v3: 85500, distination: "BOUDOUAOU", t1: 30000, t2: 12000, t3: 10000,
    option: "TRNSP",
  },
  // Parent 3 — single child, with option typo "TENSP" + unknown "TRNP"
  {
    nom: "CHERIF Riad", niveau: "COLG", classe: "3AM-C", nem: "0612345678",
    tuteur: "CHERIF Yazid", email: "yazid.cherif@example.com",
    devisAnnuel: 355000, dettes: 6000,
    reglementsDettes: 3000,
    fi: 30000, v2: 106500, v3: 106500, distination: "TIDJELABINE", t1: 20000, t2: 13000, t3: 10000,
    option: "TENSP",
  },
  // Parent 4 — blank NEM (must still import via placeholder)
  {
    nom: "DAHO Nadia", niveau: "PRIM", classe: "2AP-B",
    tuteur: "DAHO Wahiba", email: "wahida.daho@example.com",
    devisAnnuel: 265000, dettes: 0,
    fi: 25000, v2: 79500, v3: 79500,
  },
  // Parent 5 — unknown niveau code (must still import via fallback)
  {
    nom: "HAMIDI Ilyes", niveau: "UNKNOWN_LV", classe: "1AP-A", nem: "0558889999",
    tuteur: "HAMIDI Samir", email: "samir.hamidi@example.com",
    devisAnnuel: 245000, dettes: 3000,
    reglementsDettes: 1500,
    fi: 25000, v2: 73500, v3: 73500, distination: "CORSO", t1: 20000, t2: 13000, t3: 10000,
    option: "TRNP",
  },
  // Parent 6 — Arabic-only name (NOM in LASTNAME FIRSTNAME order)
  {
    nom: "زروقي أمين", niveau: "LYC", classe: "2ERE-S", nem: "0698765432",
    tuteur: "زروقي عبد القادر", email: null,
    devisAnnuel: 380000, dettes: 9000,
    reglementsDettes: 4500,
    fi: 30000, v2: 114000, v3: 114000, distination: "ZEMMOURI", t1: 30000, t2: 12000, t3: 10000,
    option: "TRNSP",
  },
  // Parent 7 — single child, minimal financial data (just devisAnnuel)
  {
    nom: "MEZIANE Yasmine", niveau: "GS", classe: "GS-2", nem: "0661234567",
    tuteur: "MEZIANE Leila", email: "leila.meziane@example.com",
    devisAnnuel: 180000, dettes: 0,
    fi: 18000,
  },
  // Parent 8 — MISSING CLASSE (must still import via "Non assignée" default).
  {
    nom: "SAYAH Karim", niveau: "PRIM", classe: "", nem: "0771112233",
    tuteur: "SAYAH Ahmed", email: "ahmed.sayah@example.com",
    devisAnnuel: 245000, dettes: 5000,
    reglementsDettes: 2500,
    fi: 25000, v2: 73500, v3: 73500,
  },
  // Parent 9 — MISSING niveau AND CLASSE AND DEVIS ANNUEL.
  // Must still import via defaults (niveau→PRIM/1ap, classe→Non assignée, devisAnnuel→0).
  {
    nom: "Brahim Saidi", niveau: "", classe: "", nem: "0554443322",
    tuteur: "Saidi Mansour", email: null,
    devisAnnuel: 0, dettes: 0,
    fi: 0,
  },
];

async function buildWorkbook(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "test-fixture-builder";
  wb.created = new Date();

  // ── ETAT sheet ────────────────────────────────────────────────────────
  // Header layout matches the real `Suivis clients 2026_2027.xlsx` exactly
  // (column A is a spacer, B..Y are data columns).
  const etat = wb.addWorksheet("ETAT 20262027");
  etat.addRow([
    "", // A — spacer
    "INFOS", "E-MAIL", "NEM", "TUTEUR", "NOM", "niveau", "CLASSE", "OPTION",
    "REMISE", "JUSTIFICATION", "DEVIS ANNUEL", "REMBOURCEMENT", "DETTES",
    "REGLEMENTS DETTES", "TOTAL VERSEMENTS", "TOTAL*CREANCE",
    "FI", "V2", "2V", "v3", "DISTINATION", "1T", "T2", "t3",
  ]);
  for (const r of etatRows) {
    const totalVersements =
      (r.fi ?? 0) + (r.v2 ?? 0) + (r.v2Alt ?? 0) + (r.v3 ?? 0) +
      (r.t1 ?? 0) + (r.t2 ?? 0) + (r.t3 ?? 0);
    etat.addRow([
      "", // A — spacer
      r.infos ?? "", r.email ?? "", r.nem ?? "", r.tuteur ?? "", r.nom,
      r.niveau, r.classe, r.option ?? "",
      r.remise ?? 0, r.justification ?? "", r.devisAnnuel, r.remboursement ?? 0,
      r.dettes ?? 0, r.reglementsDettes ?? 0,
      totalVersements, // P — TOTAL VERSEMENTS (formula in real sheet)
      r.devisAnnuel - totalVersements + (r.dettes ?? 0) - (r.reglementsDettes ?? 0), // Q — balance
      r.fi ?? 0, r.v2 ?? 0, r.v2Alt ?? 0, r.v3 ?? 0,
      r.distination ?? "", r.t1 ?? 0, r.t2 ?? 0, r.t3 ?? 0,
    ]);
  }
  // Summary row — must be skipped
  etat.addRow([
    "", "", "", "", "", "TOTAL GÉNÉRAL", "", "", "", "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "", 0, 0, 0,
  ]);

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
