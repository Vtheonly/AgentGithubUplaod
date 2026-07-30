/**
 * Receipt PDF generation service — plan §07.05.
 *
 * Two formats:
 *   1. generatePaymentReceiptPdf(payment, parent?) → single-transaction receipt
 *      Format code: RCP-2026-XXXXX (the payment.receiptNumber)
 *   2. generateAccountStatementPdf(payments, parent) → complete ledger PDF
 *
 * Per plan: PDFs are AUTO-GENERATED on payment entry — no manual button.
 * The counter-payment modal calls generateReceipt() on the repository and
 * then this service to render the PDF.
 *
 * Uses pdf-lib (MIT, no native deps, runs in browser + Node).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { Payment } from "../domain/model/payment";
import type { Parent } from "../domain/model/parent";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
} from "../domain/model/payment";
import { formatDzdPlain } from "../core/format/currency";
import { formatDateTime, formatDate } from "../core/format/date";

/* ------------------------------------------------------------------ */
/*  Brand colors — match design tokens (RGB 0..1)                     */
/* ------------------------------------------------------------------ */

const BRAND_BLUE = rgb(0x34 / 255, 0x9b / 255, 0xd4 / 255);
const BRAND_BLUE_DEEP = rgb(0x2b / 255, 0x7f / 255, 0xb0 / 255);
const TEXT_PRIMARY = rgb(0x1e / 255, 0x1f / 255, 0x20 / 255);
const TEXT_MUTED = rgb(0x6b / 255, 0x70 / 255, 0x75 / 255);
const BORDER = rgb(0xcc / 255, 0xcc / 255, 0xcc / 255);
const SUCCESS = rgb(0x3f / 255, 0xa6 / 255, 0x6e / 255);
const WARNING = rgb(0xc8 / 255, 0xa9 / 255, 0x8c / 255);
// Iteration 9 — additional palette for bulletin / payslip PDFs.
const DANGER = rgb(0xc0 / 255, 0x50 / 255, 0x4d / 255);
const ACCENT_BG = rgb(0xf5 / 255, 0xf7 / 255, 0xfa / 255);
const PRIMARY_BG = rgb(0xe6 / 255, 0xf3 / 255, 0xfb / 255);

/* ------------------------------------------------------------------ */
/*  Layout helpers                                                     */
/* ------------------------------------------------------------------ */

const PAGE_W = 595.28; // A4 width in points (72 dpi)
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

type PdfPage = ReturnType<PDFDocument["addPage"]>;

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
function sanitizePdfText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
}

function drawHeader(doc: PDFDocument, font: PDFFont, title: string): PdfPage {
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

function drawFooter(page: PdfPage, font: PDFFont, generatedAt: string) {
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

function drawKeyValue(
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

function drawBox(
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

/* ------------------------------------------------------------------ */
/*  1. Payment Receipt                                                 */
/* ------------------------------------------------------------------ */

export async function generatePaymentReceiptPdf(
  payment: Payment,
  parent?: Pick<Parent, "firstName" | "lastName" | "code" | "phone"> | null,
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
    drawKeyValue(page, font, MARGIN + 15, y - 16, "Nom:", `${parent.firstName} ${parent.lastName}`);
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

/* ------------------------------------------------------------------ */
/*  2. Account Statement                                               */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

/* ------------------------------------------------------------------ */
/*  Download helper (browser / Electron renderer)                      */
/* ------------------------------------------------------------------ */

export function downloadPdf(bytes: Uint8Array, filename: string) {
  // Cast to BlobPart for compatibility with TS 5.7+ Blob typing
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
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
/*  Iteration 9 — Entity-specific reports (spec §5.2)                 */
/*                                                                    */
/*  Per spec:                                                         */
/*    - Bulletins trimestriels → generated in StudentDetailDrawer     */
/*    - Relevé de compte      → generated in ParentDetailDrawer       */
/*    - Fiche de paie         → generated in PersonnelDetailDrawer    */
/*                                                                    */
/*  These functions are kept here because they share the same PDF     */
/*  rendering primitives (drawHeader, drawBox, drawKeyValue, etc.).   */
/* ------------------------------------------------------------------ */

import type { Student } from "../domain/model/student";
import type { Assessment, Subject, AcademicTerm } from "../domain/model/academic";
import type { Personnel } from "../domain/model/personnel";
import { LEVEL_LABELS_FR } from "../domain/model/student";
import { STAFF_CATEGORY_LABELS_FR, PERSONNEL_STATUS_LABELS_FR } from "../domain/model/personnel";

/**
 * Generate a student's term bulletin PDF (relevé de notes trimestriel).
 *
 * Iteration 9 — spec §5.2: this PDF is generated exclusively inside the
 * StudentDetailDrawer, NOT from the global Reports tab.
 */
export async function generateBulletinPdf(input: {
  student: Pick<Student, "firstName" | "lastName" | "code" | "level" | "gradeYear" | "gender" | "classId">;
  term: AcademicTerm;
  assessments: readonly Assessment[];
  gpa: number | null;
  subjects: readonly Subject[];
  /** Optional class name (resolved by the caller from classId). */
  className?: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const title = "BULLETIN TRIMESTRIEL";
  const page = drawHeader(doc, font, title);

  let y = PAGE_H - 130;

  // Student identity box
  drawBox(page, MARGIN, y - 60, CONTENT_W, 60, undefined, BORDER);
  drawKeyValue(page, font, MARGIN + 15, y - 18, sanitizePdfText("Élève:"), sanitizePdfText(`${input.student.firstName} ${input.student.lastName}`));
  drawKeyValue(page, font, MARGIN + 15, y - 36, sanitizePdfText("Code:"), sanitizePdfText(input.student.code));
  drawKeyValue(page, font, MARGIN + 280, y - 18, sanitizePdfText("Niveau:"), sanitizePdfText(`${LEVEL_LABELS_FR[input.student.level]} · A${input.student.gradeYear}`));
  drawKeyValue(page, font, MARGIN + 280, y - 36, sanitizePdfText("Classe:"), sanitizePdfText(input.className ?? input.student.classId ?? "—"));
  drawKeyValue(page, font, MARGIN + 440, y - 18, sanitizePdfText("Trimestre:"), sanitizePdfText(input.term));
  drawKeyValue(page, font, MARGIN + 440, y - 36, sanitizePdfText("Émis le:"), sanitizePdfText(formatDate(new Date().toISOString())));

  y -= 90;

  // Grades table
  page.drawText(sanitizePdfText("Notes par matière"), { x: MARGIN, y, size: 14, font: fontBold, color: TEXT_PRIMARY });
  y -= 22;

  // Table header
  drawBox(page, MARGIN, y - 18, CONTENT_W, 18, ACCENT_BG, BORDER);
  page.drawText(sanitizePdfText("Matière"), { x: MARGIN + 10, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText("D1", { x: MARGIN + 220, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText("D2", { x: MARGIN + 280, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText(sanitizePdfText("Examen"), { x: MARGIN + 340, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText(sanitizePdfText("Coef."), { x: MARGIN + 410, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText("Moy.", { x: MARGIN + 470, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  y -= 18;

  // Table rows
  for (const a of input.assessments) {
    const subject = input.subjects.find((s) => s.id === a.subjectId);
    const name = subject?.name ?? a.subjectId;
    drawBox(page, MARGIN, y - 16, CONTENT_W, 16, undefined, BORDER);
    page.drawText(sanitizePdfText(name.slice(0, 30)), { x: MARGIN + 10, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(a.devoir1 != null ? a.devoir1.toFixed(2) : "—", { x: MARGIN + 220, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(a.devoir2 != null ? a.devoir2.toFixed(2) : "—", { x: MARGIN + 280, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(a.examen != null ? a.examen.toFixed(2) : "—", { x: MARGIN + 340, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(String(a.coefficient ?? 1), { x: MARGIN + 410, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(a.subjectAverage != null ? a.subjectAverage.toFixed(2) : "—", { x: MARGIN + 470, y: y - 12, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;
    if (y < 100) break; // simple page-break guard
  }

  y -= 20;
  // GPA box
  drawBox(page, MARGIN, y - 30, CONTENT_W, 30, PRIMARY_BG, BORDER);
  page.drawText(sanitizePdfText("Moyenne générale pondérée"), { x: MARGIN + 15, y: y - 20, size: 12, font: fontBold, color: TEXT_PRIMARY });
  const gpaText = input.gpa != null ? `${input.gpa.toFixed(2)} / 20` : "—";
  const gpaColor = input.gpa != null && input.gpa >= 10 ? SUCCESS : input.gpa != null ? DANGER : TEXT_MUTED;
  page.drawText(gpaText, { x: MARGIN + 470, y: y - 20, size: 16, font: fontBold, color: gpaColor });

  y -= 50;
  // Decision footer
  if (input.gpa != null) {
    const decision = input.gpa >= 10 ? "ADMIS" : "EN DIFFICULTE";
    const decisionColor = input.gpa >= 10 ? SUCCESS : DANGER;
    page.drawText(sanitizePdfText(`Décision: ${decision}`), { x: MARGIN, y, size: 11, font: fontBold, color: decisionColor });
  }

  // Footer
  page.drawText(sanitizePdfText("Document généré automatiquement par El-Imtiyaz Desktop Terminal — non officiel sans signature."), { x: MARGIN, y: 30, size: 8, font, color: TEXT_MUTED });

  return doc.save();
}

/**
 * Generate a personnel payslip PDF (fiche de paie).
 *
 * Iteration 9 — spec §5.2: this PDF is generated exclusively inside the
 * PersonnelDetailDrawer, NOT from the global Reports tab.
 */
export async function generatePayslipPdf(
  personnel: Pick<Personnel, "firstName" | "lastName" | "id" | "staffCategory" | "position" | "hireDate" | "salary" | "weeklyHoursTarget" | "weeklyHoursLogged" | "status" | "email" | "phone">,
  period: string = new Date().toISOString().slice(0, 7),
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const title = "FICHE DE PAIE";
  const page = drawHeader(doc, font, title);

  let y = PAGE_H - 130;

  // Identity box
  drawBox(page, MARGIN, y - 60, CONTENT_W, 60, undefined, BORDER);
  drawKeyValue(page, font, MARGIN + 15, y - 18, sanitizePdfText("Employé:"), sanitizePdfText(`${personnel.firstName} ${personnel.lastName}`));
  drawKeyValue(page, font, MARGIN + 15, y - 36, sanitizePdfText("Matricule:"), sanitizePdfText(personnel.id));
  drawKeyValue(page, font, MARGIN + 280, y - 18, sanitizePdfText("Catégorie:"), sanitizePdfText(STAFF_CATEGORY_LABELS_FR[personnel.staffCategory]));
  drawKeyValue(page, font, MARGIN + 280, y - 36, sanitizePdfText("Poste:"), sanitizePdfText(personnel.position ?? "—"));
  drawKeyValue(page, font, MARGIN + 440, y - 18, sanitizePdfText("Période:"), sanitizePdfText(period));
  drawKeyValue(page, font, MARGIN + 440, y - 36, sanitizePdfText("Statut:"), sanitizePdfText(PERSONNEL_STATUS_LABELS_FR[personnel.status]));

  y -= 90;

  // Salary details
  page.drawText(sanitizePdfText("Détails de la rémunération"), { x: MARGIN, y, size: 14, font: fontBold, color: TEXT_PRIMARY });
  y -= 22;

  const salary = personnel.salary ?? 0;
  const hourlyRate = personnel.weeklyHoursTarget > 0 ? salary / (personnel.weeklyHoursTarget * 4.33) : 0;
  const hoursWorked = personnel.weeklyHoursLogged * 4.33; // monthly equivalent
  const hoursTarget = personnel.weeklyHoursTarget * 4.33;

  const rows: Array<[string, string]> = [
    [sanitizePdfText("Salaire mensuel brut"), `${formatDzdPlain(salary)} DZD`],
    [sanitizePdfText("Heures hebdo. cibles"), `${personnel.weeklyHoursTarget} h`],
    [sanitizePdfText("Heures hebdo. effectuées"), `${personnel.weeklyHoursLogged} h`],
    [sanitizePdfText("Heures mensuelles cibles"), `${hoursTarget.toFixed(1)} h`],
    [sanitizePdfText("Heures mensuelles effectuées"), `${hoursWorked.toFixed(1)} h`],
    [sanitizePdfText("Taux horaire estimé"), `${formatDzdPlain(Math.round(hourlyRate))} DZD/h`],
    [sanitizePdfText("Date d'embauche"), personnel.hireDate],
  ];

  for (const [label, value] of rows) {
    drawBox(page, MARGIN, y - 18, CONTENT_W, 18, undefined, BORDER);
    page.drawText(label, { x: MARGIN + 15, y: y - 13, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(sanitizePdfText(value), { x: MARGIN + 460, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 18;
    if (y < 100) break;
  }

  y -= 20;
  // Total
  drawBox(page, MARGIN, y - 30, CONTENT_W, 30, PRIMARY_BG, BORDER);
  page.drawText(sanitizePdfText("Net à payer"), { x: MARGIN + 15, y: y - 20, size: 12, font: fontBold, color: TEXT_PRIMARY });
  page.drawText(sanitizePdfText(`${formatDzdPlain(salary)} DZD`), { x: MARGIN + 460, y: y - 20, size: 16, font: fontBold, color: BRAND_BLUE_DEEP });

  // Footer
  page.drawText(sanitizePdfText("Document généré automatiquement par El-Imtiyaz Desktop Terminal — non officiel sans signature."), { x: MARGIN, y: 30, size: 8, font, color: TEXT_MUTED });

  return doc.save();
}
