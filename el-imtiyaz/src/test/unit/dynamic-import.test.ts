/**
 * Comprehensive tests for the dynamic, schema-driven Excel importer.
 *
 * Tests cover:
 *   - Schema validation (file structure check)
 *   - Column auto-detection via aliases
 *   - Per-row validation (required, type, enum, pattern, range)
 *   - Atomic commit semantics
 *   - Large dataset handling
 *   - Custom schema registration
 *   - Error collection (not fail-on-first)
 *   - Map function invocation
 */
import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import {
  type ImportSchema,
  type ColumnSpec,
  parseAndPreview,
  commitImport,
  validateFileStructure,
  registerSchema,
  getSchema,
  listSchemas,
  type ImportCommitResult,
} from "../../infrastructure/excel/dynamic-import";
import { clientImportSchema, type ImportedClientRow } from "../../infrastructure/excel/client-schema";
import { Ok } from "../../core/result/result";

async function makeFile(rows: readonly (readonly (string | number | null)[])[], sheetName = "ETAT"): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const row of rows) {
    const r = ws.addRow(row as (string | number | null)[]);
    void r;
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer], "test.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const minimalSchema: ImportSchema<{ name: string; age: number; email: string | null }> = {
  id: "test-minimal",
  label: "Test Minimal",
  description: "Minimal schema for testing",
  sheets: [
    {
      name: "Data",
      nameAliases: ["data", "etat", "feuille"],
      headerRowIndex: 1,
      firstDataRow: 2,
      columns: [
        { field: "name", label: "Name", aliases: ["name", "nom", "fullname"], type: "string", required: true, pattern: "^.+$" },
        { field: "age", label: "Age", aliases: ["age", "Âge"], type: "number", required: true, min: 0, max: 150 },
        { field: "email", label: "Email", aliases: ["email", "e-mail", "courriel"], type: "string", required: false, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
      ],
    },
  ],
  map: (row) => ({
    name: String(row.name ?? ""),
    age: Number(row.age ?? 0),
    email: row.email ? String(row.email) : null,
  }),
};

describe("Dynamic Excel Importer — schema validation", () => {
  it("accepts a file with all required columns", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      ["Alice", 30, "alice@example.com"],
      ["Bob", 25, "bob@example.com"],
    ]);
    const result = await validateFileStructure(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.structuralErrors).toHaveLength(0);
    }
  });

  it("rejects a file missing required columns", async () => {
    const file = await makeFile([
      ["Name", "Email"], // missing Age
      ["Alice", "alice@example.com"],
    ]);
    const result = await validateFileStructure(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.structuralErrors.some((e) => e.code === "MISSING_REQUIRED_COLUMN")).toBe(true);
    }
  });

  it("detects duplicate columns", async () => {
    const file = await makeFile([
      ["Name", "Name", "Age", "Email"], // duplicate Name
      ["Alice", "Alice", 30, "a@b.c"],
    ]);
    const result = await validateFileStructure(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.structuralErrors.some((e) => e.code === "DUPLICATE_COLUMN")).toBe(true);
    }
  });

  it("warns on unknown columns (extra columns are tolerated)", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email", "Extra Column"],
      ["Alice", 30, "a@b.c", "extra value"],
    ]);
    const result = await validateFileStructure(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.structuralErrors.some((e) => e.code === "UNKNOWN_COLUMN")).toBe(true);
    }
  });

  it("matches columns by alias (e.g., 'nom' instead of 'name')", async () => {
    const file = await makeFile([
      ["Nom", "Âge", "Courriel"],
      ["Alice", 30, "alice@example.com"],
    ]);
    const result = await validateFileStructure(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.structuralErrors.filter((e) => e.code === "MISSING_REQUIRED_COLUMN")).toHaveLength(0);
    }
  });
});

describe("Dynamic Excel Importer — row parsing & validation", () => {
  it("parses valid rows correctly", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      ["Alice", 30, "alice@example.com"],
      ["Bob", 25, "bob@example.com"],
    ]);
    const result = await parseAndPreview(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canCommit).toBe(true);
      expect(result.value.validRows).toBe(2);
      expect(result.value.totalRows).toBe(2);
      expect(result.value.sheets[0].rows[0].entity.name).toBe("Alice");
      expect(result.value.sheets[0].rows[0].entity.age).toBe(30);
    }
  });

  it("collects ALL row errors (does not fail on first)", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      ["", 30, "alice@example.com"], // missing name
      ["Bob", 200, "bob@example.com"], // age out of range
      ["Charlie", 25, "not-an-email"], // invalid email
    ]);
    const result = await parseAndPreview(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canCommit).toBe(false);
      expect(result.value.errorCount).toBe(3);
      expect(result.value.validRows).toBe(0);
    }
  });

  it("validates enum columns", async () => {
    const enumSchema: ImportSchema<{ level: string }> = {
      id: "test-enum",
      label: "Enum Test",
      description: "x",
      sheets: [
        {
          name: "Data",
          columns: [
            { field: "level", label: "Level", aliases: ["level", "niveau"], type: "enum", required: true, enumValues: ["primaire", "cem", "lycee"] },
          ],
        },
      ],
      map: (row) => ({ level: String(row.level ?? "") }),
    };
    const file = await makeFile([
      ["Level"],
      ["primaire"],
      ["invalid"],
      ["cem"],
    ]);
    const result = await parseAndPreview(file, enumSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.errorCount).toBe(1);
      expect(result.value.validRows).toBe(2);
    }
  });

  it("validates number range", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      ["Alice", -5, "a@b.c"], // age < min
      ["Bob", 200, "b@c.d"], // age > max
      ["Charlie", 50, "c@d.e"], // valid
    ]);
    const result = await parseAndPreview(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.errorCount).toBe(2);
      expect(result.value.validRows).toBe(1);
    }
  });

  it("handles empty cells with default values", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      ["Alice", 30, ""], // email empty — optional, defaults to null
    ]);
    const result = await parseAndPreview(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canCommit).toBe(true);
      expect(result.value.sheets[0].rows[0].entity.email).toBeNull();
    }
  });
});

describe("Dynamic Excel Importer — atomic commit", () => {
  it("commits via the provided inserter", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      ["Alice", 30, "alice@example.com"],
      ["Bob", 25, "bob@example.com"],
    ]);
    const preview = await parseAndPreview(file, minimalSchema);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    let insertedRows: { name: string; age: number; email: string | null }[] = [];
    const inserter = async (rows: readonly { name: string; age: number; email: string | null }[]) => {
      insertedRows = [...rows];
      return Ok<ImportCommitResult>({ inserted: rows.length, skipped: 0 });
    };
    const result = await commitImport(preview.value, inserter);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.inserted).toBe(2);
      expect(insertedRows).toHaveLength(2);
    }
  });

  it("refuses to commit when validation failed", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      ["", 30, "a@b.c"], // invalid row
    ]);
    const preview = await parseAndPreview(file, minimalSchema);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.canCommit).toBe(false);

    const result = await commitImport(preview.value, async () => Ok({ inserted: 0, skipped: 0 }));
    expect(result.ok).toBe(false);
  });

  it("inserter receives the mapped entities (not raw rows)", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      ["Alice", 30, "alice@example.com"],
    ]);
    const preview = await parseAndPreview(file, minimalSchema);
    if (!preview.ok) return;
    let received: unknown = null;
    await commitImport(preview.value, async (rows) => {
      received = rows;
      return Ok({ inserted: rows.length, skipped: 0 });
    });
    expect(Array.isArray(received)).toBe(true);
    expect((received as Array<{ name: string }>)[0].name).toBe("Alice");
  });
});

describe("Dynamic Excel Importer — schema registry", () => {
  beforeEach(() => {
    // Reset the registry by re-registering (since it's a module-level Map).
    // In practice the registry persists across tests, so we just verify
    // registration works.
  });

  it("registers and retrieves a schema by ID", () => {
    registerSchema(minimalSchema);
    const retrieved = getSchema(minimalSchema.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(minimalSchema.id);
  });

  it("listSchemas returns all registered schemas", () => {
    registerSchema(minimalSchema);
    const all = listSchemas();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.some((s) => s.id === minimalSchema.id)).toBe(true);
  });
});

describe("Dynamic Excel Importer — real workbook (client-schema)", () => {
  it("parses the actual `Suivis clients` workbook structure", async () => {
    // Build a small workbook that matches the real ETAT sheet structure.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("ETAT 20262027");
    ws.addRow([
      "INFOS", "E-MAIL", "NEM", "TUTEUR", "NOM", "niveau", "CLASSE", "OPTION",
      "REMISE", "JUSTIFICATION", "DEVIS ANNUEL", "DETTES", "TOTAL VERSEMENTS",
      "1T", "T2", "t3", "SEPTEMBRE", "DECEMBRE", "MARS",
    ]);
    ws.addRow([
      "note", "parent@example.dz", "0663701834", "ZIREG AHMED",
      "ZIREG LEA", "PRIM", "CE1", "",
      0, "", 54000, 0, 18000,
      18000, 18000, 18000, 6000, 6000, 6000,
    ]);
    ws.addRow([
      "", "parent2@example.dz", "0770123456", "MAHAMED OUSSAID",
      "MAHAMED YACINE", "cem", "2AP", "",
      5000, "Sibling discount", 62000, 5000, 30000,
      20700, 20700, 20600, 10000, 10000, 10000,
    ]);
    const buffer = await wb.xlsx.writeBuffer();
    const file = new File([buffer], "Suivis clients.xlsx");

    const result = await parseAndPreview(file, clientImportSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canCommit).toBe(true);
      expect(result.value.validRows).toBe(2);
      const first = result.value.sheets[0].rows[0].entity as ImportedClientRow;
      expect(first.parentLastName).toBe("ZIREG");
      expect(first.studentFirstName).toBe("LEA");
      expect(first.level).toBe("primaire");
      expect(first.devisAnnuel).toBe(54000);
      expect(first.tranche1).toBe(18000);
    }
  });

  it("handles empty rows gracefully", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      // no data rows
    ], "Data");
    const result = await parseAndPreview(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canCommit).toBe(false); // no rows
      expect(result.value.totalRows).toBe(0);
    }
  });

  it("handles large datasets (1000 rows) efficiently", async () => {
    const rows: (string | number | null)[][] = [["Name", "Age", "Email"]];
    for (let i = 0; i < 1000; i++) {
      rows.push([`Person${i}`, 20 + (i % 50), `p${i}@example.com`]);
    }
    const file = await makeFile(rows);
    const start = Date.now();
    const result = await parseAndPreview(file, minimalSchema);
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalRows).toBe(1000);
      expect(result.value.validRows).toBe(1000);
    }
    // Should complete in under 5 seconds.
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("Dynamic Excel Importer — edge cases", () => {
  it("handles date columns (dd/mm/yyyy format)", async () => {
    const dateSchema: ImportSchema<{ birth: string }> = {
      id: "test-date",
      label: "Date Test",
      description: "x",
      sheets: [{
        name: "Data",
        columns: [
          { field: "birth", label: "Birth Date", aliases: ["birth", "naissance", "date de naissance"], type: "date", required: true },
        ],
      }],
      map: (row) => ({ birth: String(row.birth ?? "") }),
    };
    const file = await makeFile([
      ["Birth"],
      ["15/03/2010"],
      ["2011-08-22"],
    ]);
    const result = await parseAndPreview(file, dateSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canCommit).toBe(true);
      expect(result.value.sheets[0].rows[0].entity.birth).toBe("2010-03-15");
      expect(result.value.sheets[0].rows[1].entity.birth).toBe("2011-08-22");
    }
  });

  it("handles boolean columns", async () => {
    const boolSchema: ImportSchema<{ active: boolean }> = {
      id: "test-bool",
      label: "Bool Test",
      description: "x",
      sheets: [{
        name: "Data",
        columns: [
          { field: "active", label: "Active", aliases: ["active", "actif"], type: "boolean", required: true },
        ],
      }],
      map: (row) => ({ active: Boolean(row.active) }),
    };
    const file = await makeFile([
      ["Active"],
      ["yes"],
      ["no"],
      ["true"],
      ["0"],
    ]);
    const result = await parseAndPreview(file, boolSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sheets[0].rows[0].entity.active).toBe(true);
      expect(result.value.sheets[0].rows[1].entity.active).toBe(false);
      expect(result.value.sheets[0].rows[2].entity.active).toBe(true);
      expect(result.value.sheets[0].rows[3].entity.active).toBe(false);
    }
  });

  it("skips rows before firstDataRow", async () => {
    const file = await makeFile([
      ["Name", "Age", "Email"],
      ["HeaderNote", 0, "header@example.com"], // would be skipped if firstDataRow > 2
      ["Alice", 30, "alice@example.com"],
    ]);
    // Use default firstDataRow (2) — header is row 1, data starts row 2.
    const result = await parseAndPreview(file, minimalSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalRows).toBe(2);
    }
  });

  it("respects maxRows cap", async () => {
    const cappedSchema: ImportSchema<{ name: string; age: number; email: string | null }> = {
      ...minimalSchema,
      id: "test-capped",
      sheets: [{
        ...minimalSchema.sheets[0],
        maxRows: 5,
      }],
    };
    const rows: (string | number | null)[][] = [["Name", "Age", "Email"]];
    for (let i = 0; i < 100; i++) {
      rows.push([`P${i}`, 30, `p${i}@x.com`]);
    }
    const file = await makeFile(rows);
    const result = await parseAndPreview(file, cappedSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalRows).toBe(5);
    }
  });
});
