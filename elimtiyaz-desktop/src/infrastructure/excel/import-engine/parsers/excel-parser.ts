import ExcelJS from "exceljs";
import type { ImportSchema } from "../types";
import { SheetDetector } from "./sheet-detector";

export interface IterateRowsOptions {
  onRow?: (
    row: Record<string, unknown>,
    rowIndex: number,
  ) => Promise<void> | void;
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
   */
  async open(
    input: File | ArrayBuffer | Uint8Array,
  ): Promise<ExcelJS.Workbook> {
    let buffer: ArrayBuffer;
    if (input instanceof File) {
      buffer = await input.arrayBuffer();
    } else if (input instanceof Uint8Array) {
      buffer = input.buffer.slice(
        input.byteOffset,
        input.byteOffset + input.byteLength,
      ) as ArrayBuffer;
    } else {
      buffer = input;
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return wb;
  }

  /** List sheets with detected schema. */
  async listSheets(
    input: File | ArrayBuffer | Uint8Array,
  ): Promise<SheetInfo[]> {
    const wb = await this.open(input);
    return wb.worksheets.map((ws) => {
      const headerRow = this.readHeaderRow(ws, 0);
      const schema = this.detector.detect(ws.name, headerRow);
      return { name: ws.name, rowCount: ws.rowCount, schema };
    });
  }

  private normalizeString(s: string): string {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  /**
   * Dynamically search for the header row across the top 30 rows of a sheet.
   */
  private findHeaderRow(
    ws: ExcelJS.Worksheet,
    schema: ImportSchema | null,
  ): { headerRowNumber: number; dataStartRow: number; headers: string[] } {
    if (!schema || schema.headerRow === 0) {
      const colCount = ws.columnCount || 1;
      const headers: string[] = [];
      for (let c = 1; c <= colCount; c++) headers.push(this.colLetter(c));
      return { headerRowNumber: 0, dataStartRow: 1, headers };
    }

    const maxScanRows = Math.min(30, ws.rowCount || 30);
    const requiredHeadersNorm = schema.requiredHeaders.map((h) =>
      this.normalizeString(h),
    );
    const fieldHeadersNorm = schema.fields
      .map((f) => (f.header ? this.normalizeString(f.header) : ""))
      .filter(Boolean);

    let bestRow = schema.headerRow || 1;
    let bestScore = -1;
    let bestHeaders: string[] = [];

    const candidateRows = new Set<number>();
    if (schema.headerRow && schema.headerRow <= ws.rowCount) {
      candidateRows.add(schema.headerRow);
    }
    for (let r = 1; r <= maxScanRows; r++) {
      candidateRows.add(r);
    }

    for (const r of candidateRows) {
      const rowHeaders = this.readHeaderRow(ws, r);
      if (rowHeaders.length === 0) continue;

      const rowHeadersNorm = rowHeaders.map((h) => this.normalizeString(h));

      let reqMatchCount = 0;
      for (const reqH of requiredHeadersNorm) {
        if (
          rowHeadersNorm.some(
            (h) =>
              h === reqH ||
              (h.length >= 3 && reqH.length >= 3 && (h.includes(reqH) || reqH.includes(h))),
          )
        ) {
          reqMatchCount++;
        }
      }

      let fieldMatchCount = 0;
      for (const fieldH of fieldHeadersNorm) {
        if (
          rowHeadersNorm.some(
            (h) =>
              h === fieldH ||
              (h.length >= 3 && fieldH.length >= 3 && (h.includes(fieldH) || fieldH.includes(h))),
          )
        ) {
          fieldMatchCount++;
        }
      }

      const score = reqMatchCount * 10 + fieldMatchCount;
      const isExplicit = schema.headerRow && r === schema.headerRow;

      if (score > bestScore || (score === bestScore && isExplicit)) {
        bestScore = score;
        bestRow = r;
        bestHeaders = rowHeaders;
      }
    }

    let dataStartRow = bestRow + 1;
    if (
      schema.dataStartRow &&
      schema.headerRow &&
      bestRow === schema.headerRow
    ) {
      dataStartRow = schema.dataStartRow;
    }

    return { headerRowNumber: bestRow, dataStartRow, headers: bestHeaders };
  }

  /**
   * Iterate rows of a worksheet.
   */
  async iterateRows(
    ws: ExcelJS.Worksheet,
    schema: ImportSchema | null,
    opts: IterateRowsOptions = {},
  ): Promise<IterateRowsResult> {
    const { onRow, onProgress } = opts;

    const { dataStartRow, headers } = this.findHeaderRow(ws, schema);

    const total = ws.rowCount || 0;
    let read = 0;

    for (let r = dataStartRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row || row.cellCount === 0) continue;

      let isEmpty = true;
      const obj: Record<string, unknown> = {};
      for (let c = 1; c <= headers.length; c++) {
        const headerName = headers[c - 1];
        if (!headerName) continue;
        const cell = row.getCell(c);
        const v = this.normalizeCell(cell);
        if (v !== null && v !== "" && v !== undefined) isEmpty = false;
        obj[headerName] = v;
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

  /** Read the header row cells as a string array. */
  private readHeaderRow(
    ws: ExcelJS.Worksheet,
    headerRowNumber: number,
  ): string[] {
    if (headerRowNumber === 0) {
      const colCount = ws.columnCount || 1;
      const headers: string[] = [];
      for (let c = 1; c <= colCount; c++) headers.push(this.colLetter(c));
      return headers;
    }
    const row = ws.getRow(headerRowNumber);
    if (!row) return [];
    const headers: string[] = [];
    const colCount = Math.max(ws.columnCount || 0, row.cellCount || 0);
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      let v = this.normalizeCell(cell);
      if (typeof v === "string") v = v.trim();
      headers.push((v ?? "") as string);
    }
    return headers;
  }

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
        v = null;
      } else if (obj.text !== undefined) {
        v = obj.text;
      } else if (Array.isArray(obj.richText)) {
        v = obj.richText.map((t) => t.text).join("");
      } else if (obj.error !== undefined) {
        v = obj.error;
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
