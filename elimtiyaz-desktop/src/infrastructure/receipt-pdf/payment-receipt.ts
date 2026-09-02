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
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Payment } from "../../domain/model/payment";
import { parentDisplayName, type Parent } from "../../domain/model/parent";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
} from "../../domain/model/payment";
import { formatDzdPlain } from "../../core/format/currency";
import { formatDateTime } from "../../core/format/date";
import {
  PAGE_W,
  PAGE_H,
  MARGIN,
  CONTENT_W,
  BORDER,
  BRAND_BLUE_DEEP,
  SUCCESS,
  WARNING,
  TEXT_MUTED,
  TEXT_PRIMARY,
  drawHeader,
  drawFooter,
  drawKeyValue,
  drawBox,
  wrapText,
} from "./shared";

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
  drawKeyValue(page, font, MARGIN + 280, y - 18, "Statut:", PAYMENT_STATUS_LABELS_FR[payment.status]);
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
  page.drawText(PAYMENT_METHOD_LABELS_FR[payment.method], { x: MARGIN + 240, y: y - 4, size: 10, font, color: TEXT_PRIMARY });
  page.drawText(PAYMENT_CATEGORY_LABELS_FR[payment.category], { x: MARGIN + 340, y: y - 4, size: 10, font, color: TEXT_PRIMARY });
  const amountStr = formatDzdPlain(payment.amount);
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

  // Notes section
  if (payment.notes) {
    page.drawText("NOTES", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;
    drawBox(page, MARGIN, y - 30, CONTENT_W, 30, rgb(0xfa / 255, 0xfa / 255, 0xfa / 255), BORDER);
    const noteLines = wrapText(payment.notes, font, 10, CONTENT_W - 30);
    noteLines.slice(0, 2).forEach((line, i) => {
      page.drawText(line, { x: MARGIN + 15, y: y - 12 - i * 12, size: 10, font, color: TEXT_PRIMARY });
    });
    y -= 40;
  }

  // Proof section
  if (payment.proofUrl) {
    page.drawText("JUSTIFICATIF", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;
    drawBox(page, MARGIN, y - 26, CONTENT_W, 26, rgb(0xfa / 255, 0xfa / 255, 0xfa / 255), BORDER);
    page.drawText(`Fichier joint: ${payment.proofUrl}`, {
      x: MARGIN + 15, y: y - 16, size: 10, font, color: TEXT_PRIMARY,
    });
    y -= 32;
  }

  // Status banner
  const statusColor = payment.status === "paid" ? SUCCESS : payment.status === "pending" ? WARNING : TEXT_MUTED;
  drawBox(page, MARGIN, y - 28, CONTENT_W, 28, statusColor);
  const statusLabel = `Statut: ${PAYMENT_STATUS_LABELS_FR[payment.status].toUpperCase()}`;
  page.drawText(statusLabel, {
    x: MARGIN + 15, y: y - 18, size: 11, font: fontBold, color: rgb(1, 1, 1),
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

  drawFooter(page, font, new Date().toISOString());
  return doc.save();
}
