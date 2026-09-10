// ============================================================================
// FILE: elimtiyaz-desktop/src/infrastructure/receipt-pdf/report-document.ts
// ============================================================================
/**
 * Generic report document PDF builder (T-275, 42nd session — AI-311d).
 *
 * A reusable "titled report with sections and tables" engine over the
 * SAME drawing primitives the receipts use (./shared — drawHeader,
 * drawFooter, drawBox, drawKeyValue, sanitizePdfText). The three
 * copilot report generators (class report, debt report, payment plan)
 * are thin adapters over this builder — one table renderer, three
 * documents, zero duplication (§9: one implementation per rule).
 *
 * Multi-page: rows flow onto continuation pages automatically with a
 * compact "(suite)" header; the footer lands on the last page only.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import {
  PAGE_H,
  MARGIN,
  CONTENT_W,
  BORDER,
  TEXT_MUTED,
  TEXT_PRIMARY,
  ACCENT_BG,
  BRAND_BLUE,
  drawHeader,
  drawFooter,
  drawBox,
  sanitizePdfText,
  type PdfPage,
} from "./shared";

export interface ReportTable {
  /** Column headers (rendered bold on ACCENT_BG). */
  readonly columns: readonly string[];
  /** Rows of pre-formatted cell strings. */
  readonly rows: readonly (readonly string[])[];
  /** Per-column relative widths (sum normalized). Defaults equal. */
  readonly widths?: readonly number[];
}

export interface ReportSection {
  readonly heading: string;
  /** Key-value block rendered above the table (optional). */
  readonly keyValue?: readonly (readonly [string, string])[];
  readonly table?: ReportTable;
  /** Free-text note under the section (wrapped, muted). */
  readonly note?: string;
}

export interface ReportSpec {
  /** Rendered in the brand header (right side). */
  readonly title: string;
  /** Meta block rendered under the header (label → value). */
  readonly meta: readonly (readonly [string, string])[];
  readonly sections: readonly ReportSection[];
  /** Footnote rendered above the footer. */
  readonly footnote?: string;
}

const ROW_H = 16;
const TABLE_PAD = 4;
const MAX_Y_BOTTOM = 70;

/** Mutable draw cursor — everything renders through this state. */
interface Cursor {
  page: PdfPage;
  y: number;
}

export async function generateReportPdf(spec: ReportSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cursor: Cursor = { page: drawHeader(doc, font, sanitizePdfText(spec.title)), y: PAGE_H - 110 };
  const newPage = (): Cursor => {
    const p = drawHeader(doc, font, sanitizePdfText(`${spec.title} (suite)`));
    return { page: p, y: PAGE_H - 100 };
  };
  const ensure = (c: Cursor, needed: number): Cursor =>
    c.y - needed >= MAX_Y_BOTTOM ? c : newPage();

  // Meta block
  if (spec.meta.length > 0) {
    const metaH = spec.meta.length * 16 + 12;
    drawBox(cursor.page, MARGIN, cursor.y - metaH + 8, CONTENT_W, metaH, ACCENT_BG, BORDER);
    let my = cursor.y - 2;
    for (const [label, value] of spec.meta) {
      cursor.page.drawText(sanitizePdfText(label), { x: MARGIN + 12, y: my, size: 9, font, color: TEXT_MUTED });
      cursor.page.drawText(sanitizePdfText(value), { x: MARGIN + 175, y: my, size: 9.5, font: fontBold, color: TEXT_PRIMARY });
      my -= 16;
    }
    cursor.y -= metaH + 20;
  }

  for (const section of spec.sections) {
    // Section heading
    let c = ensure(cursor, 30);
    c.page.drawText(sanitizePdfText(section.heading.toUpperCase()), {
      x: MARGIN,
      y: c.y,
      size: 10.5,
      font: fontBold,
      color: BRAND_BLUE,
    });
    c.y -= 20;

    // Key-value block
    if (section.keyValue && section.keyValue.length > 0) {
      c = ensure(c, section.keyValue.length * 15 + 10);
      for (const [label, value] of section.keyValue) {
        c.page.drawText(sanitizePdfText(label), { x: MARGIN + 4, y: c.y, size: 9, font, color: TEXT_MUTED });
        c.page.drawText(sanitizePdfText(value), { x: MARGIN + 170, y: c.y, size: 9.5, font: fontBold, color: TEXT_PRIMARY });
        c.y -= 15;
      }
      c.y -= 8;
    }

    // Table
    if (section.table && section.table.rows.length > 0) {
      const table = section.table;
      const nCols = table.columns.length;
      const rel = table.widths ?? table.columns.map(() => 1);
      const totalRel = rel.reduce((s, w) => s + w, 0);
      const colW = rel.map((w) => (CONTENT_W - (nCols - 1) * 1) * (w / totalRel));

      // Header row
      c = ensure(c, ROW_H + TABLE_PAD);
      drawBox(c.page, MARGIN, c.y - ROW_H, CONTENT_W, ROW_H, ACCENT_BG, BORDER);
      let cx = MARGIN + TABLE_PAD;
      table.columns.forEach((col, i) => {
        c.page.drawText(sanitizePdfText(truncate(col, colW[i] - 8, fontBold, 8.5)), {
          x: cx,
          y: c.y - ROW_H + 5,
          size: 8.5,
          font: fontBold,
          color: TEXT_PRIMARY,
        });
        cx += colW[i] + 1;
      });
      c.y -= ROW_H;

      // Data rows (striped)
      table.rows.forEach((row, ri) => {
        c = ensure(c, ROW_H);
        if (ri % 2 === 1) {
          drawBox(c.page, MARGIN, c.y - ROW_H, CONTENT_W, ROW_H, rgb(0.96, 0.97, 0.98));
        }
        let rx = MARGIN + TABLE_PAD;
        row.forEach((cell, i) => {
          c.page.drawText(sanitizePdfText(truncate(String(cell), colW[i] - 8, font, 9)), {
            x: rx,
            y: c.y - ROW_H + 5,
            size: 9,
            font,
            color: TEXT_PRIMARY,
          });
          rx += colW[i] + 1;
        });
        c.y -= ROW_H;
      });
      c.y -= 16;
    }

    // Note
    if (section.note) {
      const lines = wrapPdfText(section.note, font, 9, CONTENT_W - 8);
      c = ensure(c, lines.length * 12 + 6);
      for (const line of lines) {
        c.page.drawText(sanitizePdfText(line), { x: MARGIN + 4, y: c.y, size: 9, font, color: TEXT_MUTED });
        c.y -= 12;
      }
      c.y -= 10;
    }

    cursor.page = c.page;
    cursor.y = c.y;
  }

  // Footnote (last page, only if it fits without a fresh page)
  if (spec.footnote) {
    const lines = wrapPdfText(spec.footnote, font, 8.5, CONTENT_W);
    if (cursor.y - lines.length * 11 >= MAX_Y_BOTTOM) {
      for (const line of lines) {
        cursor.page.drawText(sanitizePdfText(line), { x: MARGIN, y: cursor.y, size: 8.5, font, color: TEXT_MUTED });
        cursor.y -= 11;
      }
    }
  }
  drawFooter(cursor.page, font, new Date().toISOString());

  return doc.save();
}

/* ------------------------------------------------------------------ */
/*  Local helpers                                                      */
/* ------------------------------------------------------------------ */

function truncate(text: string, maxWidth: number, font: PDFFont, size: number): string {
  // Sanitize FIRST: widthOfTextAtSize THROWS on non-WinAnsi code points
  // (e.g. U+202F, the narrow no-break space fr-FR toLocaleString emits
  // between digit groups) — the raw adapter strings reach this helper.
  const safe = sanitizePdfText(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let t = safe;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = sanitizePdfText(text);
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 6); // notes stay compact
}
