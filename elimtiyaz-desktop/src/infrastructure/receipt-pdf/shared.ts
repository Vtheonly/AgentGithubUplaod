/**
 * Shared PDF primitives — brand colors, layout constants, page type, and the
 * 6 internal drawing helpers used by every receipt-pdf generator.
 *
 * Extracted from the original `receipt-pdf.ts` (plan §07.05) so each
 * generator module can stay focused. Behavior is identical — only the
 * file location and import paths changed.
 */
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { formatDateTime } from "../../core/format/date";

/* ------------------------------------------------------------------ */
/*  Brand colors — match design tokens (RGB 0..1)                     */
/* ------------------------------------------------------------------ */

export const BRAND_BLUE = rgb(0x34 / 255, 0x9b / 255, 0xd4 / 255);
export const BRAND_BLUE_DEEP = rgb(0x2b / 255, 0x7f / 255, 0xb0 / 255);
export const TEXT_PRIMARY = rgb(0x1e / 255, 0x1f / 255, 0x20 / 255);
export const TEXT_MUTED = rgb(0x6b / 255, 0x70 / 255, 0x75 / 255);
export const BORDER = rgb(0xcc / 255, 0xcc / 255, 0xcc / 255);
export const SUCCESS = rgb(0x3f / 255, 0xa6 / 255, 0x6e / 255);
export const WARNING = rgb(0xc8 / 255, 0xa9 / 255, 0x8c / 255);
// Iteration 9 — additional palette for bulletin / payslip PDFs.
export const DANGER = rgb(0xc0 / 255, 0x50 / 255, 0x4d / 255);
export const ACCENT_BG = rgb(0xf5 / 255, 0xf7 / 255, 0xfa / 255);
export const PRIMARY_BG = rgb(0xe6 / 255, 0xf3 / 255, 0xfb / 255);

/* ------------------------------------------------------------------ */
/*  Layout helpers                                                     */
/* ------------------------------------------------------------------ */

export const PAGE_W = 595.28; // A4 width in points (72 dpi)
export const PAGE_H = 841.89;
export const MARGIN = 50;
export const CONTENT_W = PAGE_W - MARGIN * 2;

export type PdfPage = ReturnType<PDFDocument["addPage"]>;

/**
 * Sanitize text for StandardFonts.Helvetica which only supports WinAnsi.
 *
 * Iteration 9 — pdf-lib's StandardFonts.Helvetica throws on characters
 * outside its glyph table (e.g. accented characters that aren't in
 * WinAnsi, certain symbols). To stay safe and avoid embedding a custom
 * font (which would balloon the PDF size), we normalize accented
 * characters to their ASCII equivalents before drawing.
 *
 * This is a lossy conversion — acceptable for internal PDF reports.
 */
export function sanitizePdfText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
}

export function drawHeader(doc: PDFDocument, font: PDFFont, title: string): PdfPage {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  // Brand bar
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 80,
    width: PAGE_W,
    height: 80,
    color: BRAND_BLUE,
  });
  // Brand name
  page.drawText("EL-IMTIYAZ", {
    x: MARGIN,
    y: PAGE_H - 40,
    size: 22,
    font,
    color: rgb(1, 1, 1),
  });
  page.drawText("Établissement Scolaire Privé", {
    x: MARGIN,
    y: PAGE_H - 58,
    size: 9,
    font,
    color: rgb(1, 1, 1),
  });
  // Document title
  page.drawText(title, {
    x: PAGE_W - MARGIN - font.widthOfTextAtSize(title, 14),
    y: PAGE_H - 45,
    size: 14,
    font,
    color: rgb(1, 1, 1),
  });
  return page;
}

export function drawFooter(page: PdfPage, font: PDFFont, generatedAt: string) {
  const y = 40;
  page.drawLine({
    start: { x: MARGIN, y: y + 20 },
    end: { x: PAGE_W - MARGIN, y: y + 20 },
    thickness: 0.5,
    color: BORDER,
  });
  page.drawText(
    "El-Imtiyaz · Oran, Algérie · Téléphone: +213 41 XX XX XX · Email: contact@elimtiyaz.dz",
    { x: MARGIN, y, size: 8, font, color: TEXT_MUTED },
  );
  page.drawText(
    `Généré le ${formatDateTime(generatedAt)} · Page 1/1`,
    { x: PAGE_W - MARGIN - 200, y, size: 8, font, color: TEXT_MUTED },
  );
}

export function drawKeyValue(
  page: PdfPage,
  font: PDFFont,
  x: number,
  y: number,
  label: string,
  value: string,
  labelWidth = 110,
) {
  page.drawText(label, { x, y, size: 9, font, color: TEXT_MUTED });
  page.drawText(value, { x: x + labelWidth, y, size: 10, font, color: TEXT_PRIMARY });
}

export function drawBox(
  page: PdfPage,
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: ReturnType<typeof rgb>,
  stroke?: ReturnType<typeof rgb>,
) {
  page.drawRectangle({
    x, y, width: w, height: h,
    color: fill,
    borderColor: stroke,
    borderWidth: stroke ? 0.5 : 0,
  });
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
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
  return lines;
}
