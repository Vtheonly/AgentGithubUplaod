/**
 * Account statement PDF generator — complete ledger PDF for a parent.
 *
 * Per plan: PDFs are AUTO-GENERATED on payment entry — no manual button.
 * The counter-payment modal calls generateReceipt() on the repository and
 * then this service to render the PDF.
 *
 * Uses pdf-lib (MIT, no native deps, runs in browser + Node).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Payment } from "../../domain/model/payment";
import type { Parent } from "../../domain/model/parent";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
} from "../../domain/model/payment";
import { formatDzdPlain } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";
import {
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
} from "./shared";

export async function generateAccountStatementPdf(
  payments: readonly Payment[],
  parent: Pick<Parent, "firstName" | "lastName" | "code" | "phone" | "email">,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const title = "RELEVÉ DE COMPTE";
  const page = drawHeader(doc, font, title);

  let y = PAGE_H - 130;

  // Statement meta
  drawBox(page, MARGIN, y - 60, CONTENT_W, 60, undefined, BORDER);
  drawKeyValue(page, font, MARGIN + 15, y - 18, "Parent:", `${parent.firstName} ${parent.lastName}`);
  drawKeyValue(page, font, MARGIN + 15, y - 36, "Code:", parent.code);
  drawKeyValue(page, font, MARGIN + 280, y - 18, "Téléphone:", parent.phone);
  drawKeyValue(page, font, MARGIN + 280, y - 36, "E-mail:", parent.email ?? "—");
  drawKeyValue(page, font, MARGIN + 440, y - 18, "Émis le:", formatDate(new Date().toISOString()));

  y -= 90;

  // Summary
  const totalPaid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const totalRefunded = payments.filter((p) => p.status === "refunded").reduce((s, p) => s + p.amount, 0);

  page.drawText("SYNTHÈSE", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
  y -= 18;

  drawBox(page, MARGIN, y - 60, CONTENT_W / 3 - 8, 50, rgb(0xeb / 255, 0xf6 / 255, 0xf0 / 255), SUCCESS);
  page.drawText("Payé", { x: MARGIN + 15, y: y - 16, size: 9, font, color: TEXT_MUTED });
  page.drawText(formatDzdPlain(totalPaid), { x: MARGIN + 15, y: y - 34, size: 12, font: fontBold, color: SUCCESS });

  drawBox(page, MARGIN + CONTENT_W / 3, y - 60, CONTENT_W / 3 - 8, 50, rgb(0xfb / 255, 0xf3 / 255, 0xeb / 255), WARNING);
  page.drawText("En attente", { x: MARGIN + CONTENT_W / 3 + 15, y: y - 16, size: 9, font, color: TEXT_MUTED });
  page.drawText(formatDzdPlain(totalPending), { x: MARGIN + CONTENT_W / 3 + 15, y: y - 34, size: 12, font: fontBold, color: WARNING });

  drawBox(page, MARGIN + 2 * (CONTENT_W / 3), y - 60, CONTENT_W / 3 - 8, 50, rgb(0xfa / 255, 0xfa / 255, 0xfa / 255), BORDER);
  page.drawText("Remboursé", { x: MARGIN + 2 * (CONTENT_W / 3) + 15, y: y - 16, size: 9, font, color: TEXT_MUTED });
  page.drawText(formatDzdPlain(totalRefunded), { x: MARGIN + 2 * (CONTENT_W / 3) + 15, y: y - 34, size: 12, font: fontBold, color: TEXT_PRIMARY });

  y -= 80;

  // Transactions table
  page.drawText("TRANSACTIONS", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
  y -= 18;

  // Table header
  drawBox(page, MARGIN, y - 18, CONTENT_W, 18, BRAND_BLUE_DEEP);
  page.drawText("Date", { x: MARGIN + 10, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Reçu", { x: MARGIN + 80, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Méthode", { x: MARGIN + 180, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Catégorie", { x: MARGIN + 260, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Statut", { x: MARGIN + 350, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("Montant", { x: MARGIN + 460, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  y -= 22;

  // Rows (max ~25 per page; for mock layer this is enough)
  const sorted = [...payments].sort(
    (a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime(),
  );
  for (const p of sorted.slice(0, 25)) {
    if (y < 100) break; // leave room for footer
    page.drawText(formatDate(p.collectedAt), { x: MARGIN + 10, y, size: 9, font, color: TEXT_PRIMARY });
    page.drawText(p.receiptNumber, { x: MARGIN + 80, y, size: 9, font, color: TEXT_PRIMARY });
    page.drawText(PAYMENT_METHOD_LABELS_FR[p.method], { x: MARGIN + 180, y, size: 9, font, color: TEXT_PRIMARY });
    page.drawText(PAYMENT_CATEGORY_LABELS_FR[p.category], { x: MARGIN + 260, y, size: 9, font, color: TEXT_PRIMARY });
    page.drawText(PAYMENT_STATUS_LABELS_FR[p.status], { x: MARGIN + 350, y, size: 9, font, color: TEXT_PRIMARY });
    page.drawText(formatDzdPlain(p.amount), { x: MARGIN + 460, y, size: 9, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: MARGIN + CONTENT_W, y: y + 4 },
      thickness: 0.25,
      color: BORDER,
    });
  }

  drawFooter(page, font, new Date().toISOString());
  return doc.save();
}
