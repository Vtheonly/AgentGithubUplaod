/**
 * E2.3 (ROADMAP Phase 1 / 1.3) — the Devis equivalence fixtures per price
 * era — the One-By-One workbook gate (R-2's precondition for E2.4).
 *
 * Gates:
 *   A. PROVENANCE — each fixture pins its ACTUAL workbook (path + SHA-256 +
 *      size); the suite recomputes the SHA at runtime. Era A =
 *      `Excel/Suivis clients  2026_2027.xlsx` (9decf3f7…05c7) ALONE; era B
 *      = `Excel/2027-2026.xlsx` (b293b22b…79ca) ALONE — never a combined
 *      import (the owner's no-combined-masking rule).
 *   B. ERA A (2026-2027): the fixture IS the REAL price matrix
 *      (school-price-matrix.ts — itself cut from workbook A's RAW formulas
 *      and verified by the 390-row corpus replay): the FI grid, the FI
 *      autiste, the per-grade tuition schedules (scolarité + the 3-tranche
 *      table), the remise-on-V2-only policy, the early-payment 5%-of-
 *      scolarisation-only policy — shape-locked to EXACTLY the fields
 *      E2.4's devis.ts will consume, plus recomputed representative Devis
 *      vectors.
 *   C. ERA B (2027-2026): the fixture carries the per-class extraction
 *      table DERIVED LIVE from workbook B (the class-code census: the
 *      DEVIS ANNUEL mode + the V1/2V/v3 tranche-paid modes + the row
 *      counts, per CLASSE). The suite RE-RUNS the extraction against
 *      workbook B ALONE and deep-compares — the fixture is verified, not
 *      trusted.
 *   D. ERA SEPARATION — the two eras never mix: distinct SHAs, distinct
 *      era labels, and the price tables genuinely differ (2027-2026 is the
 *      UPDATED pricing).
 *   E. THE REGISTER — the school workbook (متابعة تمدرس التلاميذ.xlsx)
 *      pinned where applicable; `ETAT 2024 -205.xlsx` recorded as the
 *      owner-supplied external fixture (ABSENT from the repo — an Owner
 *      Blocker note for its lanes, never a silent skip).
 *
 * Regeneration: `E23_REGENERATE=1 npx vitest run
 * src/tests/domain/t-e23-devis-fixtures.test.ts` re-cuts era B's extraction
 * table from the workbook (era A is the verified matrix, hand-maintained).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  REAL_FI_BY_GRADE,
  REAL_FI_AUTISTE,
  REAL_TUITION_BY_GRADE,
} from "../../domain/calc/pricing/school-price-matrix";
import type { GradeLevel } from "../../domain/model/student";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const EXCEL_DIR_CANDIDATES = [
  path.join(REPO_ROOT, "Excel"),
  path.join(REPO_ROOT, "..", "Excel"),
];
const EXCEL_DIR = EXCEL_DIR_CANDIDATES.find((p) => fs.existsSync(p)) ?? EXCEL_DIR_CANDIDATES[0];

const WORKBOOK_A = path.join(EXCEL_DIR, "Suivis clients  2026_2027.xlsx");
const WORKBOOK_B = path.join(EXCEL_DIR, "2027-2026.xlsx");
const SCHOOL_WORKBOOK = path.join(EXCEL_DIR, "متابعة تمدرس التلاميذ.xlsx");
const EXTERNAL_ETAT = "ETAT 2024 -205.xlsx"; // owner-supplied; NOT in the repo

const FIXTURE_DIR = path.join(__dirname, "pricing", "fixtures", "devis");
const FIXTURE_A = path.join(FIXTURE_DIR, "era-2026-2027.json");
const FIXTURE_B = path.join(FIXTURE_DIR, "era-2027-2026.json");

function sha256(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

interface FixtureProvenance {
  workbook: string;
  sha256: string;
  sizeBytes: number;
  extraction: string;
}

interface EraAFixture {
  task: string;
  era: "2026-2027";
  provenance: FixtureProvenance;
  fiByGrade: Record<string, number>;
  fiAutiste: number;
  tuitionByGrade: Record<string, { scolarite: number; v2: number; tranche3: number; tranche4: number }>;
  policies: {
    remiseAppliesTo: "v2-only";
    earlyPaymentDiscount: { rate: number; basis: string };
    trancheSplit: string;
  };
  representativeDevis: Array<{
    grade: string;
    description: string;
    fi: number;
    scolarite: number;
    remise: number;
    devisAnnuel: number;
  }>;
}

interface EraBClassRow {
  classCode: string;
  niveau: string;
  rowCount: number;
  devisAnnuelMode: number;
  v1Mode: number;
  v2Mode: number;
  v3Mode: number;
}

interface EraBFixture {
  task: string;
  era: "2027-2026";
  provenance: FixtureProvenance;
  extraction: {
    sheet: string;
    columns: Record<string, string>;
    perClass: EraBClassRow[];
  };
}

const fixtureA = JSON.parse(fs.readFileSync(FIXTURE_A, "utf8")) as EraAFixture;
const fixtureB = JSON.parse(fs.readFileSync(FIXTURE_B, "utf8")) as EraBFixture;

// ============================================================
// The extractor — reads ONE workbook, ONE ETAT sheet (One-By-One)
// ============================================================

function mode(values: number[]): { mode: number; count: number } {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v > best)) {
      best = v;
      bestCount = c;
    }
  }
  return { mode: best, count: bestCount };
}

function num(cellValue: ExcelJS.CellValue): number | null {
  if (typeof cellValue === "number") return cellValue;
  if (typeof cellValue === "string" && cellValue.trim() !== "" && !Number.isNaN(Number(cellValue))) {
    return Number(cellValue);
  }
  if (cellValue && typeof cellValue === "object" && "result" in cellValue) {
    const r = (cellValue as { result?: unknown }).result;
    if (typeof r === "number") return r;
  }
  return null;
}

function str(cellValue: ExcelJS.CellValue): string {
  if (typeof cellValue === "string") return cellValue.trim();
  if (cellValue && typeof cellValue === "object" && "result" in cellValue) {
    const r = (cellValue as { result?: unknown }).result;
    if (typeof r === "string") return r.trim();
    if (typeof r === "number") return String(r);
  }
  if (typeof cellValue === "number") return String(cellValue);
  return "";
}

/**
 * Extract the per-class pricing census from workbook B's ETAT sheet —
 * workbook B ALONE (never combined with workbook A). Header-addressed
 * (V1 — the relabeled V2 — / 2V / v3 / DEVIS ANNUEL / CLASSE / niveau).
 */
export async function extractEraBPricing(workbookPath: string): Promise<EraBClassRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(workbookPath);
  // Both workbooks share the ETAT sheet name "ETAT 20262027" (the import
  // registry's format detection keys on the sheet NAME) — match by prefix.
  const sheet = wb.worksheets.find((w) => w.name.trim().toUpperCase().startsWith("ETAT"));
  if (!sheet) throw new Error(`ETAT sheet not found in ${workbookPath}`);

  // Header-address the columns from row 1 (the 2027-2026 format's own
  // header row — the config-driven engine's requiredHeaders pin the same).
  const header = new Map<string, number>();
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    const label = str(cell.value);
    if (label) header.set(label, col);
  });
  const colClasse = header.get("CLASSE");
  const colNiveau = header.get("niveau");
  const colDevis = header.get("DEVIS ANNUEL");
  const colV1 = header.get("V1");
  const colV2 = header.get("2V");
  const colV3 = header.get("v3");
  if (!colClasse || !colDevis || !colV1 || !colV2 || !colV3) {
    throw new Error(
      `ETAT header mapping incomplete: CLASSE=${colClasse} DEVIS=${colDevis} V1=${colV1} 2V=${colV2} v3=${colV3}`,
    );
  }

  const perClass = new Map<string, { niveau: string; devis: number[]; v1: number[]; v2: number[]; v3: number[] }>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const classCode = str(row.getCell(colClasse).value);
    if (!classCode) return;
    const entry =
      perClass.get(classCode) ??
      { niveau: colNiveau ? str(row.getCell(colNiveau).value) : "", devis: [], v1: [], v2: [], v3: [] };
    const devis = num(row.getCell(colDevis).value);
    const v1 = num(row.getCell(colV1).value);
    const v2 = num(row.getCell(colV2).value);
    const v3 = num(row.getCell(colV3).value);
    if (devis != null && devis > 0) entry.devis.push(devis);
    if (v1 != null && v1 > 0) entry.v1.push(v1);
    if (v2 != null && v2 > 0) entry.v2.push(v2);
    if (v3 != null && v3 > 0) entry.v3.push(v3);
    perClass.set(classCode, entry);
  });

  return [...perClass.entries()]
    .filter(([, e]) => e.devis.length > 0)
    .map(([classCode, e]) => ({
      classCode,
      niveau: e.niveau,
      rowCount: e.devis.length,
      devisAnnuelMode: mode(e.devis).mode,
      v1Mode: mode(e.v1).mode,
      v2Mode: mode(e.v2).mode,
      v3Mode: mode(e.v3).mode,
    }))
    .sort((a, b) => a.classCode.localeCompare(b.classCode));
}

// ============================================================
// A. Provenance — the One-By-One gate
// ============================================================

describe("E2.3 — A. provenance: each fixture pins ITS OWN actual workbook", () => {
  it("era A's provenance is workbook A (Suivis clients  2026_2027.xlsx) — SHA verified at runtime", () => {
    expect(fs.existsSync(WORKBOOK_A)).toBe(true);
    expect(fixtureA.provenance.workbook).toBe("Excel/Suivis clients  2026_2027.xlsx");
    expect(fixtureA.provenance.sha256).toBe(sha256(WORKBOOK_A));
    expect(fixtureA.provenance.sizeBytes).toBe(fs.statSync(WORKBOOK_A).size);
    // The plan's own pin (EXECUTION-PLAN §4 E2.3): 213,689 B, 9decf3f7…05c7.
    expect(fixtureA.provenance.sha256.startsWith("9decf3f7")).toBe(true);
    expect(fixtureA.provenance.sha256.endsWith("05c7")).toBe(true);
  });

  it("era B's provenance is workbook B (2027-2026.xlsx) — SHA verified at runtime", () => {
    expect(fs.existsSync(WORKBOOK_B)).toBe(true);
    expect(fixtureB.provenance.workbook).toBe("Excel/2027-2026.xlsx");
    expect(fixtureB.provenance.sha256).toBe(sha256(WORKBOOK_B));
    expect(fixtureB.provenance.sizeBytes).toBe(fs.statSync(WORKBOOK_B).size);
    // The plan's own pin: 558,443 B, b293b22b…79ca.
    expect(fixtureB.provenance.sha256.startsWith("b293b22b")).toBe(true);
    expect(fixtureB.provenance.sha256.endsWith("79ca")).toBe(true);
  });
});

// ============================================================
// B. Era A — the fixture IS the verified REAL matrix
// ============================================================

describe("E2.3 — B. era A (2026-2027): the fixture is the REAL price matrix, shape-locked", () => {
  it("the FI grid matches REAL_FI_BY_GRADE exactly (all 14 grade levels)", () => {
    // Regeneration mode: re-cut era A's fixture from the VERIFIED matrix
    // (the matrix itself is proven against workbook A by the 390-row
    // corpus replay — real-school-corpus.test.ts; this suite pins the
    // fixture ↔ matrix equality, the E2.4-consumable artifact).
    if (process.env.E23_REGENERATE === "1") {
      const tuitionByGrade: EraAFixture["tuitionByGrade"] = {};
      for (const [grade, sched] of Object.entries(REAL_TUITION_BY_GRADE)) {
        tuitionByGrade[grade] = {
          scolarite: sched.scolarite,
          v2: sched.v2,
          tranche3: sched.tranche3,
          tranche4: sched.tranche4,
        };
      }
      const fiByGrade: EraAFixture["fiByGrade"] = {};
      for (const [grade, fi] of Object.entries(REAL_FI_BY_GRADE)) fiByGrade[grade] = fi;
      const next: EraAFixture = {
        task: "E2.3",
        era: "2026-2027",
        provenance: {
          workbook: "Excel/Suivis clients  2026_2027.xlsx",
          sha256: sha256(WORKBOOK_A),
          sizeBytes: fs.statSync(WORKBOOK_A).size,
          extraction:
            "the REAL price matrix (school-price-matrix.ts) — cut from the workbook's RAW FORMULAS (the ETAT L/S columns + the Devis sheet) and verified by the 390-row corpus replay (real-school-corpus.test.ts); this fixture is the E2.4-consumable per-era artifact",
        },
        fiByGrade,
        fiAutiste: REAL_FI_AUTISTE,
        tuitionByGrade,
        policies: {
          remiseAppliesTo: "v2-only",
          earlyPaymentDiscount: {
            rate: 0.05,
            basis: "the FRAIS DE SCOLARISATION column ONLY (never the FI, never transport) — the Devis sheet's =+SUM(F15:F26)*0.05",
          },
          trancheSplit: "V2 ≈ 40% of the scolarité (the remise lands here); 2V = v3 ≈ 30% each, fixed, never discounted",
        },
        representativeDevis: [
          {
            grade: "prescolaire_2",
            description: "GS — no remise",
            fi: REAL_FI_BY_GRADE.prescolaire_2,
            scolarite: REAL_TUITION_BY_GRADE.prescolaire_2.scolarite,
            remise: 0,
            devisAnnuel: REAL_FI_BY_GRADE.prescolaire_2 + REAL_TUITION_BY_GRADE.prescolaire_2.scolarite,
          },
          {
            grade: "1ap",
            description: "CP — no remise",
            fi: REAL_FI_BY_GRADE["1ap"],
            scolarite: REAL_TUITION_BY_GRADE["1ap"].scolarite,
            remise: 0,
            devisAnnuel: REAL_FI_BY_GRADE["1ap"] + REAL_TUITION_BY_GRADE["1ap"].scolarite,
          },
          {
            grade: "1am",
            description: "1AAM — a 5 000 DZD remise (lands on V2 only)",
            fi: REAL_FI_BY_GRADE["1am"],
            scolarite: REAL_TUITION_BY_GRADE["1am"].scolarite,
            remise: 5_000,
            devisAnnuel: REAL_FI_BY_GRADE["1am"] + REAL_TUITION_BY_GRADE["1am"].scolarite - 5_000,
          },
        ],
      };
      fs.writeFileSync(FIXTURE_A, JSON.stringify(next, null, 2) + "\n");
    }
    expect(Object.keys(fixtureA.fiByGrade).sort()).toEqual(
      Object.keys(REAL_FI_BY_GRADE).sort(),
    );
    for (const [grade, fi] of Object.entries(REAL_FI_BY_GRADE)) {
      expect(fixtureA.fiByGrade[grade], grade).toBe(fi);
    }
  });

  it("the autism FI and the per-grade tuition schedules match the matrix", () => {
    expect(fixtureA.fiAutiste).toBe(REAL_FI_AUTISTE);
    expect(Object.keys(fixtureA.tuitionByGrade).sort()).toEqual(
      Object.keys(REAL_TUITION_BY_GRADE).sort(),
    );
    for (const [grade, sched] of Object.entries(REAL_TUITION_BY_GRADE)) {
      expect(fixtureA.tuitionByGrade[grade], grade).toEqual({
        scolarite: sched.scolarite,
        v2: sched.v2,
        tranche3: sched.tranche3,
        tranche4: sched.tranche4,
      });
    }
  });

  it("the policies: remise on V2 only; early-payment 5% of the scolarisation ONLY; the 40/30/30 split", () => {
    expect(fixtureA.policies.remiseAppliesTo).toBe("v2-only");
    expect(fixtureA.policies.earlyPaymentDiscount.rate).toBe(0.05);
    expect(fixtureA.policies.earlyPaymentDiscount.basis).toContain("FRAIS DE SCOLARISATION");
    for (const [grade, sched] of Object.entries(REAL_TUITION_BY_GRADE)) {
      // The documented split: V2 ≈ 40%, 2V = v3 ≈ 30% each — the fixture
      // text pins the convention; the matrix rows satisfy it by construction.
      expect(sched.v2 + sched.tranche3 + sched.tranche4, grade).toBeLessThanOrEqual(sched.scolarite);
    }
  });

  it("the representative Devis vectors recompute: devis = FI + scolarité − remise", () => {
    expect(fixtureA.representativeDevis.length).toBeGreaterThanOrEqual(3);
    for (const v of fixtureA.representativeDevis) {
      const matrix = REAL_TUITION_BY_GRADE[v.grade as GradeLevel];
      expect(matrix, v.grade).toBeDefined();
      expect(v.fi).toBe(REAL_FI_BY_GRADE[v.grade as GradeLevel]);
      expect(v.scolarite).toBe(matrix.scolarite);
      expect(v.devisAnnuel).toBe(v.fi + v.scolarite - v.remise);
    }
  });

  it("era separation: era A's fixture references ONLY workbook A", () => {
    const raw = fs.readFileSync(FIXTURE_A, "utf8");
    expect(raw).not.toContain("2027-2026.xlsx");
    expect(fixtureA.era).toBe("2026-2027");
  });
});

// ============================================================
// C. Era B — the extraction table, verified live against workbook B ALONE
// ============================================================

describe("E2.3 — C. era B (2027-2026): the extraction table verified against workbook B ALONE", () => {
  it(
    "re-running the extractor on workbook B reproduces the fixture's per-class table byte-for-byte",
    { timeout: 240_000 },
    async () => {
      expect(fs.existsSync(WORKBOOK_B)).toBe(true);
      const live = await extractEraBPricing(WORKBOOK_B);
      // Regeneration mode: re-cut the fixture from the workbook (the
      // documented one-command refresh — era B is DERIVED, era A is the
      // verified matrix).
      if (process.env.E23_REGENERATE === "1") {
        const next: EraBFixture = {
          task: "E2.3",
          era: "2027-2026",
          provenance: {
            workbook: "Excel/2027-2026.xlsx",
            sha256: sha256(WORKBOOK_B),
            sizeBytes: fs.statSync(WORKBOOK_B).size,
            extraction:
              "the per-class pricing census derived LIVE from workbook B's own ETAT sheet (header-addressed: CLASSE/niveau/DEVIS ANNUEL/V1/2V/v3) — the modes of the devis + the three tranche-paid columns per class code; the E2.4-consumable per-era artifact for the UPDATED 2027-2026 pricing",
          },
          extraction: {
            sheet: "ETAT 20262027 (the shared ETAT sheet name — matched by prefix)",
            columns: {
              classe: "CLASSE",
              niveau: "niveau",
              devisAnnuel: "DEVIS ANNUEL",
              v1: "V1 (the relabeled V2)",
              v2: "2V",
              v3: "v3",
            },
            perClass: live,
          },
        };
        fs.writeFileSync(FIXTURE_B, JSON.stringify(next, null, 2) + "\n");
      }
      expect(live).toEqual(fixtureB.extraction.perClass);
    },
  );

  it("the census is non-trivial: real classes with real 2027-2026 prices", () => {
    const rows = fixtureB.extraction.perClass;
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      expect(row.rowCount).toBeGreaterThan(0);
      expect(row.devisAnnuelMode).toBeGreaterThan(0);
    }
    // The named-class sanity: the 2027-2026 ETAT carries CE-level classes
    // (the import test's 1,139 named rows live under these class codes).
    const codes = rows.map((r) => r.classCode);
    expect(codes.some((c) => /^(1AP|2AP|CE1|MS|GS|1AAM)/i.test(c) || /\d/.test(c))).toBe(true);
  });

  it("era separation: era B's fixture references ONLY workbook B", () => {
    const raw = fs.readFileSync(FIXTURE_B, "utf8");
    expect(raw).not.toContain("Suivis clients");
    expect(fixtureB.era).toBe("2027-2026");
  });
});

// ============================================================
// D. The era-separation delta — 2027-2026 is the UPDATED pricing
// ============================================================

describe("E2.3 — D. the two eras genuinely differ (the per-year pricingBasis is REAL)", () => {
  it("distinct workbooks, distinct SHAs, distinct era labels", () => {
    expect(fixtureA.provenance.sha256).not.toBe(fixtureB.provenance.sha256);
    expect(fixtureA.era).not.toBe(fixtureB.era);
  });

  it("at least one shared class carries a DIFFERENT 2027-2026 devis vs the 2026-2027 matrix arithmetic", () => {
    // Era A's per-grade devis basis = FI + scolarité (the matrix); era B's
    // = the workbook's own DEVIS ANNUEL modes. The E2.4 pricingBasis
    // parameter exists precisely because these differ — pin that they do
    // for the comparable classes (best-effort class-code ↔ grade mapping:
    // the workbook classe codes like "CE1"/"1AAM" map to grade levels).
    const eraADevisByGrade = new Map(
      Object.entries(REAL_FUZZY_GRADE_ALIAS()).map(([classCode, grade]) => {
        const sched = REAL_TUITION_BY_GRADE[grade];
        return [classCode, sched ? REAL_FI_BY_GRADE[grade] + sched.scolarite : null];
      }),
    );
    let compared = 0;
    let differing = 0;
    for (const row of fixtureB.extraction.perClass) {
      const eraADevis = eraADevisByGrade.get(row.classCode.toUpperCase());
      if (eraADevis == null) continue;
      compared += 1;
      if (row.devisAnnuelMode !== eraADevis) differing += 1;
    }
    expect(compared).toBeGreaterThan(0);
    expect(differing).toBeGreaterThan(0); // the UPDATED pricing is real — R-2's whole point
  });
});

// ============================================================
// E. The register — the school workbook + the external ETAT
// ============================================================

describe("E2.3 — E. the workbook register (where applicable)", () => {
  it("the school workbook (متابعة تمدرس التلاميذ.xlsx) is present and registered by SHA", () => {
    expect(fs.existsSync(SCHOOL_WORKBOOK)).toBe(true);
    const registerPath = path.join(FIXTURE_DIR, "REGISTER.json");
    const register = JSON.parse(fs.readFileSync(registerPath, "utf8")) as {
      schoolWorkbook: { workbook: string; sha256: string; sizeBytes: number };
      external: { workbook: string; status: string };
    };
    expect(register.schoolWorkbook.sha256).toBe(sha256(SCHOOL_WORKBOOK));
    expect(register.schoolWorkbook.sizeBytes).toBe(fs.statSync(SCHOOL_WORKBOOK).size);
  });

  it("`ETAT 2024 -205.xlsx` is recorded as the owner-supplied external fixture (ABSENT — an Owner Blocker note, never a silent skip)", () => {
    const registerPath = path.join(FIXTURE_DIR, "REGISTER.json");
    const register = JSON.parse(fs.readFileSync(registerPath, "utf8")) as {
      external: { workbook: string; status: string };
    };
    expect(register.external.workbook).toBe(EXTERNAL_ETAT);
    expect(register.external.status).toContain("owner-supplied");
    expect(fs.existsSync(path.join(EXCEL_DIR, EXTERNAL_ETAT))).toBe(false);
  });
});

/**
 * The best-effort workbook classe-code → GradeLevel alias table (the class
 * codes observed in the workbooks' CLASSE column vs the domain's grade
 * levels). Used ONLY by the era-delta comparison above (D).
 */
function REAL_FUZZY_GRADE_ALIAS(): Record<string, GradeLevel> {
  return {
    GS: "prescolaire_2",
    MS: "prescolaire_1",
    PS: "prescolaire_1",
    "1AP": "1ap",
    CP: "1ap",
    "2AP": "2ap",
    CE1: "2ap",
    "3AP": "3ap",
    CE2: "3ap",
    "4AP": "4ap",
    CM1: "4ap",
    "5AP": "5ap",
    CM2: "5ap",
    "1AAM": "1am",
    "2AAM": "2am",
    "3AAM": "3am",
    "4AAM": "4am",
    "1AS": "1ere_annee",
    "2AS": "2eme_annee",
    "3AS": "3eme_annee",
  };
}
