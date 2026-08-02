/**
 * Tests for the Excel import engine — engine lifecycle + storage adapter +
 * end-to-end import against a synthetic ETAT workbook.
 *
 * The engine itself depends on ExcelJS for parsing — these tests build a
 * small workbook in-memory and run it through the full pipeline.
 */
import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import {
  ImportEngine,
  InMemoryAdapter,
  ETAT_SCHEMA,
  REF_SCHEMA,
  ImportContext,
} from "../../../infrastructure/excel/import-engine";

async function makeFile(
  sheets: Array<{ name: string; header: readonly (string | number)[]; rows: readonly (readonly (string | number | null)[])[] }>,
): Promise<File> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    // Only add a header row if the schema expects one (header length > 0).
    // REF schema has headerRow=0 (no header) — skip the empty row.
    if (sheet.header.length > 0) {
      ws.addRow(sheet.header as (string | number)[]);
    }
    for (const row of sheet.rows) {
      ws.addRow(row as (string | number | null)[]);
    }
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer], "test.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("excel-import-engine / InMemoryAdapter", () => {
  let adapter: InMemoryAdapter;

  beforeEach(async () => {
    adapter = new InMemoryAdapter();
    await adapter.init();
  });

  it("upsertRecord returns 'insert' for new records", async () => {
    const result = await adapter.upsertRecord(
      ETAT_SCHEMA,
      { nem: ["0663701834"], nom: "Test", niveau: "PRIM", classe: "CE1", devisAnnuel: 10000 },
      ["NEM", "NOM"],
      "run_test",
    );
    expect(result.action).toBe("insert");
  });

  it("upsertRecord returns 'skip' for unchanged re-imports", async () => {
    const record = { nem: ["0663701834"], nom: "Test", niveau: "PRIM", classe: "CE1", devisAnnuel: 10000 };
    await adapter.upsertRecord(ETAT_SCHEMA, record, ["NEM", "NOM"], "run_1");
    const result = await adapter.upsertRecord(ETAT_SCHEMA, record, ["NEM", "NOM"], "run_2");
    expect(result.action).toBe("skip");
  });

  it("upsertRecord returns 'update' for changed records", async () => {
    const record1 = { nem: ["0663701834"], nom: "Test", niveau: "PRIM", classe: "CE1", devisAnnuel: 10000 };
    const record2 = { nem: ["0663701834"], nom: "Test", niveau: "PRIM", classe: "CE1", devisAnnuel: 15000 };
    await adapter.upsertRecord(ETAT_SCHEMA, record1, ["NEM", "NOM"], "run_1");
    const result = await adapter.upsertRecord(ETAT_SCHEMA, record2, ["NEM", "NOM"], "run_2");
    expect(result.action).toBe("update");
  });

  it("insertRecord deduplicates by first-key value", async () => {
    await adapter.insertRecord("ref_enseignants", { nom: "Professeur A" });
    const result = await adapter.insertRecord("ref_enseignants", { nom: "Professeur A" });
    expect(result.action).toBe("skip");
  });

  it("listRecords filters by schema name", async () => {
    await adapter.upsertRecord(ETAT_SCHEMA, { nem: ["0663701834"], nom: "A" }, ["NEM", "NOM"], "r1");
    await adapter.upsertRecord(ETAT_SCHEMA, { nem: ["0770123456"], nom: "B" }, ["NEM", "NOM"], "r1");
    const records = await adapter.listRecords("etat");
    expect(records).toHaveLength(2);
  });

  it("saveAuditRun + getRun round-trip", async () => {
    const ctx = new ImportContext({ filePath: "test.xlsx", options: {} });
    ctx.computeFileMetadata(new Uint8Array([1, 2, 3]));
    ctx.addSheetResult({
      sheet: "ETAT",
      schema: "etat",
      rowsRead: 1,
      rowsImported: 1,
      rowsUpdated: 0,
      rowsSkipped: 0,
      rowsRejected: 0,
    });
    ctx.finish();
    await adapter.saveAuditRun(ctx);

    const retrieved = await adapter.getRun(ctx.runId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.runId).toBe(ctx.runId);
    expect(retrieved?.status).toBe("success");
    expect(retrieved?.stats.rowsImported).toBe(1);
  });
});

describe("excel-import-engine / ImportEngine", () => {
  let engine: ImportEngine;
  let auditCalls: Array<{ action: string; entityId: string }>;

  beforeEach(() => {
    auditCalls = [];
    engine = new ImportEngine({
      storage: new InMemoryAdapter(),
      auditSink: {
        async logAction(action, _entityType, entityId) {
          auditCalls.push({ action, entityId });
        },
      },
      generateReports: false, // skip report downloads in tests
    });
  });

  it("emits audit run_started + run_completed on successful import", async () => {
    const file = await makeFile([
      {
        name: "ETAT 20262027",
        header: ["INFOS", "E-MAIL", "NEM", "TUTEUR", "NOM", "niveau", "CLASSE", "OPTION", "REMISE", "JUSTIFICATION", "DEVIS ANNUEL"],
        rows: [
          ["", "p@example.dz", "0663701834", "ZIREG AHMED", "ZIREG LEA", "PRIM", "CE1", "", 0, "", 54000],
        ],
      },
    ]);

    const ctx = await engine.importFile(file, "test.xlsx");
    expect(ctx.stats.rowsImported).toBe(1);
    expect(ctx.stats.rowsRejected).toBe(0);
    expect(ctx.errors).toHaveLength(0);

    // 2 audit calls: run_started + run_completed.
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls[0].action).toBe("import.run_started");
    expect(auditCalls[1].action).toBe("import.run_completed");
  });

  it("rejects invalid rows and records them in the errors list (Iteration 14: niveau + NEM relaxed)", async () => {
    const file = await makeFile([
      {
        name: "ETAT 20262027",
        header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
        rows: [
          // Valid row.
          ["0663701834", "ZIREG LEA", "PRIM", "CE1", 54000],
          // Invalid niveau — downgraded to warning per Iteration 14 (tolerateUnknown).
          // Row still imports.
          ["0770123456", "Test Student", "INVALID", "CE1", 30000],
          // Missing required NOM — this is a real required-field error.
          ["", "", "PRIM", "CE1", 25000],
          // Missing required niveau — real error.
          ["0770123456", "No Niveau", "", "CE1", 25000],
        ],
      },
    ]);

    const ctx = await engine.importFile(file, "test.xlsx");
    expect(ctx.stats.rowsRead).toBe(4);
    expect(ctx.stats.rowsImported).toBe(2); // rows 1 + 2 (INVALID niveau now imports)
    expect(ctx.stats.rowsRejected).toBe(2); // rows 3 + 4 (missing NOM, missing niveau)
    expect(ctx.errors).toHaveLength(2);
    // Warnings include the INVALID niveau downgrade.
    expect(ctx.warnings.length).toBeGreaterThanOrEqual(1);
    expect(ctx.warnings.some((w) => w.rule === "enum")).toBe(true);
  });

  it("skips unchanged records on re-import (idempotent)", async () => {
    const file = await makeFile([
      {
        name: "ETAT 20262027",
        header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
        rows: [["0663701834", "ZIREG LEA", "PRIM", "CE1", 54000]],
      },
    ]);

    // First import.
    const ctx1 = await engine.importFile(file, "test.xlsx");
    expect(ctx1.stats.rowsImported).toBe(1);
    expect(ctx1.stats.rowsSkipped).toBe(0);

    // Re-import the same file.
    const ctx2 = await engine.importFile(file, "test.xlsx");
    expect(ctx2.stats.rowsImported).toBe(0);
    expect(ctx2.stats.rowsSkipped).toBe(1);
  });

  it("dryRun validates without writing to storage", async () => {
    const file = await makeFile([
      {
        name: "ETAT 20262027",
        header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
        rows: [["0663701834", "Test", "PRIM", "CE1", 10000]],
      },
    ]);

    const ctx = await engine.importFile(file, "test.xlsx", { dryRun: true });
    expect(ctx.stats.rowsRead).toBe(1);
    // In dry-run mode, rowsImported is incremented for display but no storage write happens.
    expect(ctx.stats.rowsImported).toBe(1);

    // Verify storage is empty.
    const records = await engine.getStorage().listRecords("etat");
    expect(records).toHaveLength(0);
  });

  it("emits lifecycle events in order", async () => {
    const events: string[] = [];
    engine.on("start", () => events.push("start"));
    engine.on("sheet:start", () => events.push("sheet:start"));
    engine.on("sheet:row", () => events.push("sheet:row"));
    engine.on("sheet:done", () => events.push("sheet:done"));
    engine.on("done", () => events.push("done"));

    const file = await makeFile([
      {
        name: "ETAT 20262027",
        header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
        rows: [["0663701834", "Test", "PRIM", "CE1", 10000]],
      },
    ]);

    await engine.importFile(file, "test.xlsx");
    expect(events).toEqual([
      "start",
      "sheet:start",
      "sheet:row",
      "sheet:done",
      "done",
    ]);
  });

  it("fan-outs REF rows into multiple reference tables", async () => {
    // REF schema has headerRow=0 (no header) — the parser generates synthetic
    // A/B/C/D headers from column count. So we just add data rows directly.
    const file = await makeFile([
      {
        name: "REF",
        header: [], // no header row
        rows: [
          ["Professeur A", "CE1", "", "Alger"],
          ["Professeur B", "CM2", "", "Oran"],
        ],
      },
    ]);

    const ctx = await engine.importFile(file, "test.xlsx");
    expect(ctx.stats.rowsImported).toBe(2);

    // 3 ref tables should have entries.
    const enseignants = await engine.getStorage().listRefRecords("ref_enseignants");
    const classes = await engine.getStorage().listRefRecords("ref_classes");
    const localites = await engine.getStorage().listRefRecords("ref_localites");
    expect(enseignants.length).toBe(2);
    expect(classes.length).toBe(2);
    expect(localites.length).toBe(2);
  });

  it("preview lists sheets with detected schema", async () => {
    const file = await makeFile([
      {
        name: "ETAT 20262027",
        header: ["NEM", "NOM", "niveau", "CLASSE", "DEVIS ANNUEL"],
        rows: [["0663701834", "Test", "PRIM", "CE1", 10000]],
      },
      {
        name: "REF",
        header: ["A", "B", "C", "D"],
        rows: [["Prof", "CE1", "", "Alger"]],
      },
    ]);

    const sheets = await engine.preview(file);
    expect(sheets).toHaveLength(2);
    expect(sheets[0].name).toBe("ETAT 20262027");
    expect(sheets[0].schema?.name).toBe("etat");
    expect(sheets[1].name).toBe("REF");
    expect(sheets[1].schema?.name).toBe("ref");
  });

  it("ignores sheets that don't match any schema", async () => {
    const file = await makeFile([
      {
        name: "UnknownSheet",
        header: ["Foo", "Bar"],
        rows: [["a", "b"]],
      },
    ]);

    const ctx = await engine.importFile(file, "test.xlsx");
    expect(ctx.stats.sheetsProcessed).toBe(0);
    expect(ctx.warnings.some((w) => w.rule === "no_sheets")).toBe(true);
  });

  it("emits error event on failure", async () => {
    let errorEmitted = false;
    engine.on("error", () => {
      errorEmitted = true;
    });

    // Pass an invalid file (not a real xlsx).
    const badFile = new File([new Uint8Array([0, 1, 2, 3])], "bad.xlsx");
    await expect(engine.importFile(badFile, "bad.xlsx")).rejects.toThrow();
    expect(errorEmitted).toBe(true);
  });
});
