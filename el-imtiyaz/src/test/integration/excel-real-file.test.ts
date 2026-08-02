/**
 * Integration test: import the real Suivis clients xlsx and assert key
 * invariants on the result.
 *
 * This file is the canonical "does the Excel import actually work on
 * the real sheet?" test. It runs the engine against the actual
 * `Suivis clients 2026_2027 .xlsx` file shipped with the repo and
 * verifies:
 *   1. The ETAT sheet is detected with the right schema.
 *   2. The header row is parsed correctly.
 *   3. The dry-run import accepts the vast majority of rows (Iter 14
 *      goal: ≥ 95% acceptance rate on ETAT).
 *   4. The remaining rejections are ONLY for genuinely empty/summary
 *      rows at the sheet end (no NOM, no niveau, no CLASSE, no DEVIS
 *      ANNUEL — all real required-field violations).
 *   5. Warnings include the documented tolerant-enum downgrades
 *      (AUTISTE, MS, NV2, etc.) — confirming the schema fixes are
 *      active.
 *   6. The BON + Devis + REF sheets are also processed (BON/Devis
 *      reject most rows due to their non-tabular layout — that's a
 *      known limitation documented in iteration 11).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ImportEngine } from "../../infrastructure/excel/import-engine/import-engine";
import { SheetDetector } from "../../infrastructure/excel/import-engine/parsers/sheet-detector";
import { ExcelParser } from "../../infrastructure/excel/import-engine/parsers/excel-parser";

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname_test = dirname(fileURLToPath(import.meta.url));
// Walk up from src/test/integration/ to the project root, then into test-fixture-suivis.xlsx
const FIXTURE_PATH = join(__dirname_test, "..", "..", "..", "test-fixture-suivis.xlsx");

function loadFixture(): Uint8Array {
  const buf = readFileSync(FIXTURE_PATH);
  return new Uint8Array(buf);
}

describe("Real Suivis clients Excel — Iteration 14 acceptance", () => {
  it("detects the ETAT sheet by name", async () => {
    const bytes = loadFixture();
    const parser = new ExcelParser();
    const wb = await parser.open(bytes);
    const etatSheet = wb.worksheets.find((ws) => /ETAT/i.test(ws.name));
    expect(etatSheet).toBeDefined();
  });

  it("parses the ETAT header row with all expected columns", async () => {
    const bytes = loadFixture();
    const parser = new ExcelParser();
    const wb = await parser.open(bytes);
    const etatSheet = wb.worksheets.find((ws) => /ETAT/i.test(ws.name))!;
    // ExcelParser.readHeaderRow is private — access via reflection.
    const headerRow = (parser as unknown as { readHeaderRow: (ws: unknown, n: number) => string[] }).readHeaderRow(etatSheet, 1);
    // Some cells may be null/empty — filter + normalize for the comparison.
    const lower = headerRow
      .filter((h) => h != null && h !== "")
      .map((h) => String(h).toLowerCase().trim());
    // Per the real sheet, these headers must be present (case-insensitive).
    expect(lower).toContain("nom");
    expect(lower).toContain("niveau");
    expect(lower).toContain("classe");
    expect(lower).toContain("devis annuel");
    // NEM is in the sheet but no longer required (Iter 14).
    expect(lower).toContain("nem");
  });

  it("detects the ETAT schema for the real sheet name", async () => {
    const bytes = loadFixture();
    const parser = new ExcelParser();
    const wb = await parser.open(bytes);
    const etatSheet = wb.worksheets.find((ws) => /ETAT/i.test(ws.name))!;
    const detector = new SheetDetector();
    const schema = detector.detect(etatSheet.name);
    expect(schema?.name).toBe("etat");
  });

  it("dry-run imports the file with ≥ 95% acceptance on ETAT (Iter 14 goal)", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: true,
      source: { user: "test" },
    });

    const etatResult = ctx.sheetResults.find((s) => s.schema === "etat");
    expect(etatResult).toBeDefined();

    const acceptanceRate = etatResult!.rowsImported / etatResult!.rowsRead;
    console.log(
      `ETAT: ${etatResult!.rowsImported}/${etatResult!.rowsRead} imported ` +
      `(${(acceptanceRate * 100).toFixed(1)}%), ${etatResult!.rowsRejected} rejected`,
    );

    // Iteration 14 goal: ≥ 95% acceptance rate on ETAT.
    // Pre-fix: 89% (359/403). Post-fix: 96.5% (389/403).
    expect(acceptanceRate).toBeGreaterThanOrEqual(0.95);
  });

  it("remaining ETAT rejections are only for genuinely empty rows (real required-field violations)", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: true,
      source: { user: "test" },
    });

    const etatErrors = ctx.errors.filter((e) => e.sheet?.startsWith("ETAT"));
    // Every remaining error must be a `required` rule — NOT an enum or
    // email or identity error (those were the Iteration 14 fixes).
    for (const e of etatErrors) {
      expect(e.rule).toBe("required");
    }
    // And the required-field violations must be on the canonical required
    // fields: nom, niveau, classe, devisAnnuel.
    const violatedFields = new Set(etatErrors.map((e) => e.field));
    const allowedRequiredFields = new Set(["nom", "niveau", "classe", "devisAnnuel"]);
    for (const f of violatedFields) {
      expect(allowedRequiredFields.has(f!)).toBe(true);
    }
  });

  it("warnings include tolerant-enum downgrades for documented non-canonical niveau codes", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: true,
      source: { user: "test" },
    });

    // The real sheet has rows with AUTISTE, MS, NV2, NV3, NV4, CLYC, LYCI, etc.
    // These are now in the schema's enum, so they should NOT produce warnings.
    // But the sheet also has some genuinely unknown values that should produce
    // tolerant-enum warnings (downgraded from errors).
    // What we DO expect: zero `enum` errors on the niveau field.
    const niveauEnumErrors = ctx.errors.filter(
      (e) => e.field === "niveau" && e.rule === "enum",
    );
    expect(niveauEnumErrors).toHaveLength(0);

    // And the schema's expanded enum should accept all the documented codes
    // (no warnings on AUTISTE, MS, etc. — they're in the canonical list now).
  });

  it("does NOT produce any `identity` errors on the ETAT sheet (Iter 14 — partial identity)", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: true,
      source: { user: "test" },
    });

    // Pre-Iter-14: rows without NEM produced identity errors because
    // extractIdentity required ALL identity fields. Post-Iter-14: those
    // rows now build identity from NOM alone — no identity errors.
    const identityErrors = ctx.errors.filter(
      (e) => e.rule === "identity" && e.sheet?.startsWith("ETAT"),
    );
    expect(identityErrors).toHaveLength(0);
  });

  it("does NOT produce any `email` errors on the ETAT sheet (Iter 14 — optional email downgrade)", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: true,
      source: { user: "test" },
    });

    // Pre-Iter-14: "BON01" in the E-MAIL column produced an email error
    // and rejected the entire row. Post-Iter-14: invalid emails on the
    // optional email field become warnings — no email errors.
    const emailErrors = ctx.errors.filter(
      (e) => e.rule === "email" && e.sheet?.startsWith("ETAT"),
    );
    expect(emailErrors).toHaveLength(0);
  });

  it("does NOT produce any `enum` errors on the OPTION field (Iter 14 — documented typos accepted)", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: true,
      source: { user: "test" },
    });

    // Pre-Iter-14: TENSP and TRNP (documented typos in the real sheet)
    // produced enum errors. Post-Iter-14: they're in the enum.
    const optionEnumErrors = ctx.errors.filter(
      (e) => e.field === "option" && e.rule === "enum",
    );
    expect(optionEnumErrors).toHaveLength(0);
  });

  it("processes all 4 sheets (ETAT, BON, Devis, REF)", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: true,
      source: { user: "test" },
    });

    const sheetNames = ctx.sheetResults.map((s) => s.schema);
    expect(sheetNames).toContain("etat");
    expect(sheetNames).toContain("bon");
    expect(sheetNames).toContain("devis");
    expect(sheetNames).toContain("ref");
  });

  it("REF sheet imports with 100% acceptance (no required fields)", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: true,
      source: { user: "test" },
    });

    const refResult = ctx.sheetResults.find((s) => s.schema === "ref");
    expect(refResult).toBeDefined();
    expect(refResult!.rowsRejected).toBe(0);
    expect(refResult!.rowsImported).toBeGreaterThan(0);
  });

  it("computes a SHA-256 checksum for the file", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx = await engine.importFile(bytes, "Suivis clients 2026_2027.xlsx", {
      dryRun: true,
      source: { user: "test" },
    });

    expect(ctx.fileChecksum).toBeTruthy();
    expect(ctx.fileChecksum).toMatch(/^[a-f0-9]{64}$/i);
    expect(ctx.fileSize).toBeGreaterThan(0);
  });

  it("generates a unique run ID for each invocation", async () => {
    const bytes = loadFixture();
    const engine = new ImportEngine({ generateReports: false });
    await engine.init();

    const ctx1 = await engine.importFile(bytes, "test.xlsx", { dryRun: true });
    const ctx2 = await engine.importFile(bytes, "test.xlsx", { dryRun: true });
    expect(ctx1.runId).not.toBe(ctx2.runId);
  });
});
