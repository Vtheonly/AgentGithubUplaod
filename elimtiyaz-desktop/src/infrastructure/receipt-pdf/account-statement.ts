/**
 * Account statement PDF generator — complete ledger PDF for a parent.
 *
 * Per plan: PDFs are AUTO-GENERATED on payment entry — no manual button.
 * The counter-payment modal calls generateReceipt() on the repository and
 * then this service to render the PDF.
 *
 * Uses pdf-lib (MIT, no native deps, runs in browser + Node).
 *
 * T-368 (67th session, REPT-500/501/502): EVERY payment renders (the old
 * `slice(0, 25)` + mid-page `break` silently dropped the tail of the
 * transaction list on long-lived accounts while the summary totals
 * counted everything — an internally inconsistent financial document);
 * rows flow onto "(suite)" continuation pages; amounts render via
 * `dzdPdf` (WinAnsi-safe); every drawn string is sanitized; the footer
 * carries the true page count on every page.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Payment } from "../../domain/model/payment";
import { parentDisplayName, type Parent } from "../../domain/model/parent";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  paymentCategoryLabelFr,
} from "../../domain/model/payment";
import { formatDate } from "../../core/format/date";
import {
  PAGE_H,
  MARGIN,
  CONTENT_W,
  PAGE_BOTTOM_LIMIT,
  BORDER,
  BRAND_BLUE_DEEP,
  SUCCESS,
  WARNING,
  TEXT_MUTED,
  TEXT_PRIMARY,
  dzdPdf,
  sanitizePdfText,
  drawHeader,
  continuationHeader,
  drawKeyValue,
  drawBox,
  drawCellClipped,
  stampPageFooters,
} from "./shared";

/** WinAnsi-safe label lookup (label maps miss → "—", never undefined). */
function label(map: Record<string, string>, key: string): string {
  return sanitizePdfText(map[key] ?? "—");
}

const TITLE = "RELEVÉ DE COMPTE";

/** Row height + rule for the transaction table. */
const ROW_H = 16;

/**
 * S46 (the statement-alignment fix) — the column geometry, ONE source of
 * truth for the header AND the rows. The amount column is RIGHT-ALIGNED at
 * a shared edge (financial-table convention: the digits line up; the old
 * left-fixed x=+460 ragged the column and overflowed the margin on
 * 7-digit amounts).
 */
const COL_DATE = MARGIN + 10;
const COL_RECEIPT = MARGIN + 80;
const COL_METHOD = MARGIN + 180;
const COL_CATEGORY = MARGIN + 260;
const COL_STATUS = MARGIN + 350;
const AMOUNT_RIGHT = MARGIN + CONTENT_W - 12;

function drawTableHeader(page: PDFPage, font: PDFFont, y: number) {
  drawBox(page, MARGIN, y - 18, CONTENT_W, 18, BRAND_BLUE_DEEP);
  page.drawText("Date", { x: COL_DATE, y: y - 13, size: 8, font, color: rgb(1, 1, 1) });
  page.drawText("Reçu", { x: COL_RECEIPT, y: y - 13, size: 8, font, color: rgb(1, 1, 1) });
  page.drawText("Méthode", { x: COL_METHOD, y: y - 13, size: 8, font, color: rgb(1, 1, 1) });
  page.drawText("Catégorie", { x: COL_CATEGORY, y: y - 13, size: 8, font, color: rgb(1, 1, 1) });
  page.drawText("Statut", { x: COL_STATUS, y: y - 13, size: 8, font, color: rgb(1, 1, 1) });
  // S46: the header shares the rows' right edge.
  page.drawText("Montant", {
    x: AMOUNT_RIGHT - font.widthOfTextAtSize("Montant", 8),
    y: y - 13,
    size: 8,
    font,
    color: rgb(1, 1, 1),
  });
}

export async function generateAccountStatementPdf(
  payments: readonly Payment[],
  parent: Pick<Parent, "firstName" | "lastName" | "displayName" | "code" | "phone" | "email">,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = drawHeader(doc, font, TITLE);

  let y = PAGE_H - 130;

  // Statement meta
  drawBox(page, MARGIN, y - 60, CONTENT_W, 60, undefined, BORDER);
  // S46: explicit labelWidths, and the issue date gets its OWN row — the
  // old three-column grid drew the "Émis le" value at x=600 on a 595pt
  // page (drawn, but off the sheet: the date was invisible on every
  // statement ever generated).
  drawKeyValue(page, font, MARGIN + 15, y - 18, "Parent:", parentDisplayName(parent), 70);
  drawKeyValue(page, font, MARGIN + 15, y - 36, "Code:", parent.code, 70);
  drawKeyValue(page, font, MARGIN + 245, y - 18, "Téléphone:", parent.phone, 80);
  drawKeyValue(page, font, MARGIN + 245, y - 36, "E-mail:", parent.email ?? "—", 80);
  drawKeyValue(page, font, MARGIN + 15, y - 54, "Émis le:", formatDate(new Date().toISOString()), 70);

  y -= 90;

  // Summary
  const totalPaid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const totalRefunded = payments.filter((p) => p.status === "refunded").reduce((s, p) => s + p.amount, 0);

  page.drawText("SYNTHÈSE", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
  y -= 18;

  // S46: the three summary boxes evenly fill the content width (flush left
  // AND right — the old CONTENT_W/3 arithmetic left the row 8pt short on
  // the right, visibly asymmetric against the meta box above it).
  const BOX_GAP = 8;
  const BOX_W = (CONTENT_W - 2 * BOX_GAP) / 3;

  drawBox(page, MARGIN, y - 60, BOX_W, 50, rgb(0xeb / 255, 0xf6 / 255, 0xf0 / 255), SUCCESS);
  page.drawText("Payé", { x: MARGIN + 15, y: y - 16, size: 9, font, color: TEXT_MUTED });
  page.drawText(dzdPdf(totalPaid), { x: MARGIN + 15, y: y - 34, size: 12, font: fontBold, color: SUCCESS });

  const box2X = MARGIN + BOX_W + BOX_GAP;
  drawBox(page, box2X, y - 60, BOX_W, 50, rgb(0xfb / 255, 0xf3 / 255, 0xeb / 255), WARNING);
  page.drawText("En attente", { x: box2X + 15, y: y - 16, size: 9, font, color: TEXT_MUTED });
  page.drawText(dzdPdf(totalPending), { x: box2X + 15, y: y - 34, size: 12, font: fontBold, color: WARNING });

  const box3X = MARGIN + 2 * (BOX_W + BOX_GAP);
  drawBox(page, box3X, y - 60, BOX_W, 50, rgb(0xfa / 255, 0xfa / 255, 0xfa / 255), BORDER);
  page.drawText("Remboursé", { x: box3X + 15, y: y - 16, size: 9, font, color: TEXT_MUTED });
  page.drawText(dzdPdf(totalRefunded), { x: box3X + 15, y: y - 34, size: 12, font: fontBold, color: TEXT_PRIMARY });

  y -= 80;

  // Transactions table
  page.drawText("TRANSACTIONS", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
  y -= 18;

  drawTableHeader(page, font, y);
  y -= 22;

  // T-368 (REPT-501): render EVERY payment — rows flow onto continuation
  // pages instead of the old `slice(0, 25)` + `break` truncation.
  const sorted = [...payments].sort(
    (a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime(),
  );
  for (const p of sorted) {
    if (y < PAGE_BOTTOM_LIMIT) {
      page = continuationHeader(doc, font, TITLE);
      drawTableHeader(page, font, PAGE_H - 110);
      // S46: the first-page rhythm (box top at Y → first row baseline at
      // Y-22). The old PAGE_H-130 sat 2pt higher — the first row of every
      // continuation page overlapped the header box's bottom edge.
      y = PAGE_H - 110 - 22;
    }
    // S46: every cell is clipped to its column width — long labels can
    // never bleed into the neighbouring column.
    drawCellClipped(page, font, formatDate(p.collectedAt), COL_DATE, y, 9, 66, TEXT_PRIMARY);
    drawCellClipped(page, font, sanitizePdfText(p.receiptNumber), COL_RECEIPT, y, 9, 94, TEXT_PRIMARY);
    drawCellClipped(page, font, label(PAYMENT_METHOD_LABELS_FR, p.method), COL_METHOD, y, 9, 74, TEXT_PRIMARY);
    drawCellClipped(page, font, paymentCategoryLabelFr(p.category), COL_CATEGORY, y, 9, 84, TEXT_PRIMARY);
    drawCellClipped(page, font, label(PAYMENT_STATUS_LABELS_FR, p.status), COL_STATUS, y, 9, 100, TEXT_PRIMARY);
    // S46: right-aligned at the shared edge — the digits line up and the
    // widest amount (1 350 000) stays inside the margin (the old
    // left-fixed x=+460 ran 4.8pt past it).
    const amountStr = dzdPdf(p.amount);
    page.drawText(amountStr, {
      x: AMOUNT_RIGHT - fontBold.widthOfTextAtSize(amountStr, 9),
      y,
      size: 9,
      font: fontBold,
      color: TEXT_PRIMARY,
    });
    y -= ROW_H;
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: MARGIN + CONTENT_W, y: y + 4 },
      thickness: 0.25,
      color: BORDER,
    });
  }

  // Transaction count note — the table and the totals now agree by
  // construction; the count makes the completeness explicit for the reader.
  if (sorted.length > 0) {
    const countNote = sanitizePdfText(
      `${sorted.length} transaction(s) listée(s) — document complet.`,
    );
    // S46: if the last row filled the page, the note FLOWS onto a fresh
    // continuation page instead of being silently dropped.
    if (y < PAGE_BOTTOM_LIMIT) {
      page = continuationHeader(doc, font, TITLE);
      y = PAGE_H - 130;
    }
    page.drawText(countNote, { x: MARGIN, y, size: 8, font, color: TEXT_MUTED });
  }

  stampPageFooters(doc, font, new Date().toISOString());
  return doc.save();
}
