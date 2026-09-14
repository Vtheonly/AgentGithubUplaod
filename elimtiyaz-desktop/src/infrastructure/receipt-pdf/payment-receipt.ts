/**
 * Payment receipt PDF generator — single-transaction receipt.
 *
 * Format code: RCP-2026-XXXXX (the payment.receiptNumber).
 *
 * Per plan: PDFs are AUTO-GENERATED on payment entry — no manual button.
 * The counter-payment modal calls generateReceipt() on the repository and
 * then this service to render the PDF.
 *
 * Uses pdf-lib (MIT, no native deps, runs in browser + Node).
 *
 * T-368 (67th session, REPT-500/501/502): amounts render via `dzdPdf`
 * (U+202F → ASCII space — the old raw formatDzdPlain output made
 * Helvetica throw "WinAnsi cannot encode" on every amount >= 1 000 DZD);
 * every drawn string is sanitized; the notes section renders ALL wrapped
 * lines (the old slice(0, 2) silently truncated); the footer carries the
 * true page count via stampPageFooters.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Payment } from "../../domain/model/payment";
import { parentDisplayName, type Parent } from "../../domain/model/parent";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
} from "../../domain/model/payment";
import { formatDateTime } from "../../core/format/date";
import {
  PAGE_W,
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
  drawKeyValue,
  drawBox,
  stampPageFooters,
  wrapText,
} from "./shared";

/** WinAnsi-safe label lookup (label maps miss → "—", never undefined). */
function label(map: Record<string, string>, key: string): string {
  return sanitizePdfText(map[key] ?? "—");
}

export async function generatePaymentReceiptPdf(
  payment: Payment,
  parent?: Pick<Parent, "firstName" | "lastName" | "displayName" | "code" | "phone"> | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const title = "REÇU DE PAIEMENT";
  const page = drawHeader(doc, font, title);

  let y = PAGE_H - 130;

  // Receipt meta box
  drawBox(page, MARGIN, y - 60, CONTENT_W, 60, undefined, BORDER);
  drawKeyValue(page, font, MARGIN + 15, y - 18, "Reçu N°:", payment.receiptNumber);
  drawKeyValue(page, font, MARGIN + 15, y - 36, "Date:", formatDateTime(payment.collectedAt));
  drawKeyValue(page, font, MARGIN + 280, y - 18, "Statut:", label(PAYMENT_STATUS_LABELS_FR, payment.status));
  drawKeyValue(page, font, MARGIN + 280, y - 36, "Référence:", payment.id.slice(0, 8).toUpperCase());

  y -= 90;

  // Parent / Payeur section
  page.drawText("PAYEUR", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
  y -= 18;
  drawBox(page, MARGIN, y - 50, CONTENT_W, 50, rgb(0xf7 / 255, 0xf9 / 255, 0xfb / 255), BORDER);
  if (parent) {
    drawKeyValue(page, font, MARGIN + 15, y - 16, "Nom:", parentDisplayName(parent));
    drawKeyValue(page, font, MARGIN + 15, y - 34, "Code:", parent.code);
    drawKeyValue(page, font, MARGIN + 280, y - 16, "Téléphone:", parent.phone);
  } else {
    page.drawText("—", { x: MARGIN + 15, y: y - 16, size: 10, font, color: TEXT_MUTED });
  }

  y -= 70;

  // Payment details section
  page.drawText("DÉTAIL DU PAIEMENT", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
  y -= 18;

  // Table header
  drawBox(page, MARGIN, y - 20, CONTENT_W, 20, BRAND_BLUE_DEEP);
  page.drawText("Désignation", { x: MARGIN + 15, y: y - 14, size: 9, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Méthode", { x: MARGIN + 240, y: y - 14, size: 9, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Catégorie", { x: MARGIN + 340, y: y - 14, size: 9, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Montant", { x: MARGIN + 440, y: y - 14, size: 9, font: fontBold, color: rgb(1, 1, 1) });
  y -= 22;

  // Table row
  page.drawText("Paiement comptoir", { x: MARGIN + 15, y: y - 4, size: 10, font, color: TEXT_PRIMARY });
  page.drawText(label(PAYMENT_METHOD_LABELS_FR, payment.method), { x: MARGIN + 240, y: y - 4, size: 10, font, color: TEXT_PRIMARY });
  page.drawText(label(PAYMENT_CATEGORY_LABELS_FR, payment.category), { x: MARGIN + 340, y: y - 4, size: 10, font, color: TEXT_PRIMARY });
  const amountStr = dzdPdf(payment.amount);
  page.drawText(amountStr, { x: MARGIN + 440, y: y - 4, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawLine({
    start: { x: MARGIN, y: y - 14 },
    end: { x: MARGIN + CONTENT_W, y: y - 14 },
    thickness: 0.5,
    color: BORDER,
  });

  y -= 30;

  // Total box
  drawBox(page, MARGIN + 320, y - 36, CONTENT_W - 320, 36, SUCCESS);
  page.drawText("TOTAL PAYÉ", { x: MARGIN + 335, y: y - 14, size: 9, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText(amountStr, {
    x: MARGIN + CONTENT_W - 15 - fontBold.widthOfTextAtSize(amountStr, 14),
    y: y - 22,
    size: 14,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y -= 60;

  // Notes section — T-368 (REPT-501): render ALL wrapped lines (the old
  // slice(0, 2) silently truncated long notes on a financial document).
  if (payment.notes) {
    page.drawText("NOTES", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;
    const noteLines = wrapText(sanitizePdfText(payment.notes), font, 10, CONTENT_W - 30);
    const boxH = Math.max(30, noteLines.length * 12 + 18);
    drawBox(page, MARGIN, y - boxH, CONTENT_W, boxH, rgb(0xfa / 255, 0xfa / 255, 0xfa / 255), BORDER);
    noteLines.forEach((line, i) => {
      page.drawText(line, { x: MARGIN + 15, y: y - 12 - i * 12, size: 10, font, color: TEXT_PRIMARY });
    });
    y -= boxH + 10;
  }

  // Proof section
  if (payment.proofUrl) {
    page.drawText("JUSTIFICATIF", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;
    drawBox(page, MARGIN, y - 26, CONTENT_W, 26, rgb(0xfa / 255, 0xfa / 255, 0xfa / 255), BORDER);
    page.drawText(sanitizePdfText(`Fichier joint: ${payment.proofUrl}`).slice(0, 90), {
      x: MARGIN + 15, y: y - 16, size: 10, font, color: TEXT_PRIMARY,
    });
    y -= 32;
  }

  // Status banner (keep above the bottom limit; the receipt is one page —
  // if an extreme note pushed y too far, clamp instead of drawing off-page)
  const bannerY = Math.max(y - 28, PAGE_BOTTOM_LIMIT + 28);
  const statusColor = payment.status === "paid" ? SUCCESS : payment.status === "pending" ? WARNING : TEXT_MUTED;
  drawBox(page, MARGIN, bannerY - 28, CONTENT_W, 28, statusColor);
  const statusLabel = `Statut: ${sanitizePdfText((PAYMENT_STATUS_LABELS_FR[payment.status] ?? "—").toUpperCase())}`;
  page.drawText(statusLabel, {
    x: MARGIN + 15, y: bannerY - 18, size: 11, font: fontBold, color: rgb(1, 1, 1),
  });

  // Signature line
  const sigY = 140;
  page.drawText("Signature & cachet", { x: PAGE_W - MARGIN - 150, y: sigY + 20, size: 9, font, color: TEXT_MUTED });
  page.drawLine({
    start: { x: PAGE_W - MARGIN - 150, y: sigY },
    end: { x: PAGE_W - MARGIN, y: sigY },
    thickness: 0.5,
    color: BORDER,
  });

  stampPageFooters(doc, font, new Date().toISOString());
  return doc.save();
}
