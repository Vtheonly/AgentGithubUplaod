/**
 * Excel export engine — plan §14 / §15.
 *
 * Used by:
 *   - Audit log CSV/XLSX export (Settings → Audit tab)
 *   - Report export engine (Dashboard → Reports tab + Financials)
 *   - Excel import engine (import-engine/reporters/excel-reporter.ts)
 *     — shares the same brand-styled header + zebra striping.
 *
 * Per plan §14: ExcelJS is restricted to import/export service modules
 * only — no formula parsing in runtime code.
 *
 * Three public functions:
 *   1. exportToXlsx(sheets, filename) — multi-sheet XLSX
 *   2. exportToCsv(rows, filename)   — single-table CSV
 *   3. downloadBlob(bytes, filename, mime) — generic download helper
 */
import ExcelJS from "exceljs";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SheetSpec {
  /** Sheet name (max 31 chars, no special chars). */
  name: string;
  /** Column definitions. */
  columns: Array<{
    header: string;
    key: string;
    width?: number;
  }>;
  /** Row data — each row is a record keyed by column.key. */
  rows: Array<Record<string, string | number | boolean | null>>;
  /** Optional accent color for the header row (hex like "349BD4"). */
  accentColor?: string;
}

/* ------------------------------------------------------------------ */
/*  Brand constants                                                    */
/* ------------------------------------------------------------------ */

const BRAND_BLUE_HEX = "349BD4";
const BRAND_BLUE_DEEP_HEX = "2B7FB0";

/* ------------------------------------------------------------------ */
/*  XLSX export                                                        */
/* ------------------------------------------------------------------ */

export async function exportToXlsx(sheets: SheetSpec[], filename: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "El-Imtiyaz Desktop";
  wb.created = new Date();
  wb.modified = new Date();

  for (const spec of sheets) {
    const sheet = wb.addWorksheet(safeSheetName(spec.name), {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = spec.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 22,
    }));

    // Style header row (brand color + white text)
    const headerRow = sheet.getRow(1);
    headerRow.height = 24;
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${spec.accentColor ?? BRAND_BLUE_HEX}` },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    headerRow.border = {
      bottom: { style: "thin", color: { argb: `FF${BRAND_BLUE_DEEP_HEX}` } },
    };

    // Add data rows
    for (const row of spec.rows) {
      const r = sheet.addRow(row);
      r.alignment = { vertical: "middle", horizontal: "left" };
    }

    // Auto-filter on the header
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: spec.columns.length },
    };

    // Zebra striping
    for (let i = 2; i <= sheet.rowCount; i++) {
      if (i % 2 === 0) {
        const r = sheet.getRow(i);
        r.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF7F9FB" },
        };
      }
    }
  }

  // Generate buffer and trigger download
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Uint8Array(buffer), filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/* ------------------------------------------------------------------ */
/*  CSV export                                                         */
/* ------------------------------------------------------------------ */

export function exportToCsv(
  columns: Array<{ header: string; key: string }>,
  rows: Array<Record<string, string | number | boolean | null>>,
  filename: string,
): void {
  const escapeCell = (v: string | number | boolean | null): string => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escapeCell(r[c.key] ?? null)).join(","))
    .join("\n");

  // Prepend UTF-8 BOM so Excel reads accents correctly
  const csv = "\ufeff" + `${header}\n${body}`;
  downloadBlob(new TextEncoder().encode(csv), filename, "text/csv;charset=utf-8");
}

/* ------------------------------------------------------------------ */
/*  Download helper                                                    */
/* ------------------------------------------------------------------ */

export function downloadBlob(bytes: Uint8Array, filename: string, mime: string) {
  // Cast to ArrayBufferView for compatibility with TS 5.7+ Blob typing
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function safeSheetName(name: string): string {
  // Excel sheet names: max 31 chars, no : \ / ? * [ ]
  const cleaned = name.replace(/[:\\/?*[\]]/g, "").trim();
  return cleaned.slice(0, 31) || "Sheet";
}
