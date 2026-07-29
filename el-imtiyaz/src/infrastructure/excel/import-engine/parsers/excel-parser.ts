/**
 * ExcelParser — ExcelJS wrapper.
 *
 * Ported from `excel-import-engine/src/parsers/ExcelParser.js`. The
 * renderer version accepts a `File` or `ArrayBuffer` (the original
 * Node version accepted a file path). The ExcelJS API is identical
 * in both environments — only the entry point differs.
 *
 * Responsibilities:
 *   - Open `.xlsx` / `.xlsm` workbooks via ExcelJS (with cached formula results).
 *   - List sheets with detected schema.
 *   - Iterate rows of a sheet, emitting `{ headerName: value }` objects.
 *
 * The parser performs NO business validation — that's `RowValidator`'s job.
 */
import ExcelJS from "exceljs";
import type { ImportSchema } from "../types";
import { SheetDetector } from "./sheet-detector";

export interface IterateRowsOptions {
  onRow?: (row: Record<string, unknown>, rowIndex: number) => Promise<void> | void;
  onProgress?: (read: number, total: number) => void;
}

export interface IterateRowsResult {
  rowsRead: number;
  headers: string[];
}

export interface SheetInfo {
  name: string;
  rowCount: number;
  schema: ImportSchema | null;
}

export class ExcelParser {
  private readonly detector: SheetDetector;

  constructor() {
    this.detector = new SheetDetector();
  }

  /**
   * Open a workbook from a `File` (renderer) or `ArrayBuffer`.
   *
   * In the renderer, callers obtain the buffer via `await file.arrayBuffer()`.
   */
  async open(input: File | ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook> {
    let buffer: ArrayBuffer;
    if (input instanceof File) {
      buffer = await input.arrayBuffer();
    } else if (input instanceof Uint8Array) {
      buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
    } else {
      buffer = input;
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return wb;
  }

  /** List sheets with detected schema. */
  async listSheets(input: File | ArrayBuffer | Uint8Array): Promise<SheetInfo[]> {
    const wb = await this.open(input);
    return wb.worksheets.map((ws) => {
      const headerRow = this.readHeaderRow(ws, 0);
      const schema = this.detector.detect(ws.name, headerRow);
      return { name: ws.name, rowCount: ws.rowCount, schema };
    });
  }

  /**
   * Iterate rows of a worksheet.
   *
   * Calls `onRow(row, rowIndex)` for each non-empty row, where `row` is a
   * `{ headerName: value }` object. The `onRow` callback may be async —
   * the parser awaits it to guarantee deterministic ordering for upserts.
   */
  async iterateRows(
    ws: ExcelJS.Worksheet,
    schema: ImportSchema | null,
    opts: IterateRowsOptions = {},
  ): Promise<IterateRowsResult> {
    const { onRow, onProgress } = opts;

    // Note: use `??` (nullish coalescing) because `headerRow: 0` is a valid
    // sentinel meaning "no header" — `||` would coerce 0 to 1 (bug).
    const headerRowNumber = schema && schema.headerRow != null ? schema.headerRow : 1;
    const dataStartRow =
      schema && schema.dataStartRow != null
        ? schema.dataStartRow
        : headerRowNumber === 0
        ? 1
        : headerRowNumber + 1;

    let headers: string[];
    if (headerRowNumber === 0) {
      // No header — generate synthetic A, B, C, … from column count.
      const colCount = ws.columnCount || 1;
      headers = [];
      for (let c = 1; c <= colCount; c++) headers.push(this.colLetter(c));
    } else {
      headers = this.readHeaderRow(ws, headerRowNumber);
    }

    const total = ws.rowCount || 0;
    let read = 0;

    for (let r = dataStartRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row || row.cellCount === 0) continue;

      let isEmpty = true;
      const obj: Record<string, unknown> = {};
      for (let c = 1; c <= headers.length; c++) {
        const headerName = headers[c - 1];
        if (!headerName) continue; // skip columns without a header
        const cell = row.getCell(c);
        const v = cell && cell.value !== undefined ? cell.value : null;
        if (v !== null && v !== "" && v !== undefined) isEmpty = false;
        obj[headerName] = this.normalizeCell(cell);
      }

      if (isEmpty) {
        read++;
        continue;
      }

      obj.__rowIndex = r;

      if (onRow) await onRow(obj, r);
      read++;
      if (onProgress && read % 50 === 0) onProgress(read, total);
    }

    if (onProgress) onProgress(read, total);

    return { rowsRead: read, headers };
  }

  /** Read the header row cells as a string array (for sheet detection). */
  private readHeaderRow(ws: ExcelJS.Worksheet, headerRowNumber: number): string[] {
    if (headerRowNumber === 0) {
      const colCount = ws.columnCount || 1;
      const headers: string[] = [];
      for (let c = 1; c <= colCount; c++) headers.push(this.colLetter(c));
      return headers;
    }
    const row = ws.getRow(headerRowNumber);
    if (!row) return [];
    const headers: string[] = [];
    const colCount = ws.columnCount || row.cellCount || 0;
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      let v = this.normalizeCell(cell);
      if (typeof v === "string") v = v.trim();
      headers.push(v as string);
    }
    return headers;
  }

  /**
   * Normalise an ExcelJS cell value into a plain JS value.
   *
   * Handles formula objects (uses `.result`), shared formulas without
   * cached results (returns null), hyperlinks (`.text`), rich text
   * (concatenated), error cells (`#REF!` etc.), and dates (preserved).
   */
  private normalizeCell(cell: ExcelJS.Cell | null | undefined): unknown {
    if (!cell) return null;
    let v: unknown = cell.value;

    if (v && typeof v === "object") {
      const obj = v as {
        result?: unknown;
        sharedFormula?: unknown;
        formula?: unknown;
        text?: string;
        richText?: { text: string }[];
        error?: string;
      };
      if (obj.result !== undefined) {
        v = obj.result;
      } else if (obj.sharedFormula !== undefined || obj.formula !== undefined) {
        v = null; // shared formula without cached result
      } else if (obj.text !== undefined) {
        v = obj.text;
      } else if (Array.isArray(obj.richText)) {
        v = obj.richText.map((t) => t.text).join("");
      } else if (obj.error !== undefined) {
        v = obj.error; // e.g. "#REF!"
      } else if (v instanceof Date) {
        // keep as-is
      } else {
        try {
          v = JSON.stringify(v);
        } catch {
          v = String(v);
        }
      }
    }

    return v;
  }

  /** Convert a 1-based column index to an Excel letter (1→A, 27→AA, etc.). */
  private colLetter(n: number): string {
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
}

export const defaultParser = new ExcelParser();
