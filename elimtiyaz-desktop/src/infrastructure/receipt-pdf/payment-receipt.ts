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
 *
 * T-579 (Session 52, the v2.3 EVERY-DETAIL contract): the optional
 * `coverage` input (allocation/installment/family data resolved through the
 * canonical chain — see payment-coverage.ts) unlocks, in order:
 *   1. MODALITÉS DE PAIEMENT — the full check (N°/banque/émission/
 *      compensation) or transfer (référence/banque émettrice) field set
 *      (the plan §07.01 columns; drawn only for those methods).
 *   2. AFFECTATION / COUVERTURE — the allocation lines (labels), the
 *      per-tranche (FI/T1/T2/T3) and per-category breakdowns, and the
 *      totals block: Payé maintenant · Total attendu · Excédent ·
 *      Payé à ce jour · Prix justifié (net) · Reste dû · Année scolaire.
 *   3. The collector ("Encaissé par") line.
 * Without `coverage` the receipt renders exactly as before (additive).
 * Sections flow onto "(suite)" continuation pages rather than truncating
 * (the S46/T-368 discipline — a financial document never silently drops).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type {
  Payment,
  PaymentAllocation,
  Installment,
} from "../../domain/model/payment";
import { parentDisplayName, type Parent } from "../../domain/model/parent";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  paymentCategoryLabelFr,
} from "../../domain/model/payment";
import type { AcademicYear } from "../../domain/model/academic";
import { formatDate, formatDateTime } from "../../core/format/date";
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
  continuationHeader,
  drawKeyValue,
  drawBox,
  drawCellClipped,
  stampPageFooters,
  wrapText,
} from "./shared";
import { buildPaymentCoverage } from "../../domain/calc/payment/payment-coverage";

/** WinAnsi-safe label lookup (label maps miss → "—", never undefined). */
function label(map: Record<string, string>, key: string): string {
  return sanitizePdfText(map[key] ?? "—");
}

/**
 * T-579 — the optional every-detail coverage input. Resolve via
 * `resolvePaymentCoverage`/`resolvePaymentAllocations` (payment-coverage.ts);
 * every field is optional and additive (absent → the section degrades or is
 * omitted; nothing is fabricated).
 */
export interface ReceiptCoverageOptions {
  /** The payment's allocations (the canonical chain's output). */
  readonly allocations?: readonly PaymentAllocation[];
  /** The family's installments — enables Prix justifié / Reste dû. */
  readonly installments?: readonly Installment[];
  /** The family's full payment history — enables Payé à ce jour / Reste dû. */
  readonly familyPayments?: readonly Payment[];
  /** The academic years list — resolves the année scolaire label. */
  readonly academicYears?: readonly AcademicYear[];
}

export async function generatePaymentReceiptPdf(
  payment: Payment,
  parent?: Pick<Parent, "firstName" | "lastName" | "displayName" | "code" | "phone"> | null,
  coverage?: ReceiptCoverageOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const title = "REÇU DE PAIEMENT";
  let page: PDFPage = drawHeader(doc, font, title);

  // T-579: the shared coverage view model — ONE builder for the card, the
  // modal and BOTH PDF generators. Absent inputs degrade honestly.
  const cov = buildPaymentCoverage(
    payment,
    coverage?.allocations ?? [],
    coverage?.installments ?? [],
    {
      familyPayments: coverage?.familyPayments,
      academicYears: coverage?.academicYears,
    },
  );

  let y = PAGE_H - 130;

  // Receipt meta box
  drawBox(page, MARGIN, y - 60, CONTENT_W, 60, undefined, BORDER);
  drawKeyValue(page, font, MARGIN + 15, y - 18, "Reçu N°:", payment.receiptNumber);
  drawKeyValue(page, font, MARGIN + 15, y - 36, "Date:", formatDateTime(payment.collectedAt));
  drawKeyValue(page, font, MARGIN + 280, y - 18, "Statut:", label(PAYMENT_STATUS_LABELS_FR, payment.status));
  drawKeyValue(page, font, MARGIN + 280, y - 36, "Référence:", payment.id.slice(0, 8).toUpperCase());
  // T-579 (7): the collector — "Encaissé par".
  drawKeyValue(page, font, MARGIN + 15, y - 52, "Encaissé par:", payment.collectedBy || "—");

  y -= 92;

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

  // T-579 (6): MODALITÉS DE PAIEMENT — the full check/transfer field set
  // (plan §07.01). Drawn only for those methods; cash needs no box.
  if (payment.method === "check" || payment.method === "transfer") {
    page.drawText("MODALITÉS DE PAIEMENT", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;
    drawBox(page, MARGIN, y - 34, CONTENT_W, 34, rgb(0xfa / 255, 0xfa / 255, 0xfa / 255), BORDER);
    if (payment.method === "check") {
      drawKeyValue(page, font, MARGIN + 15, y - 14, "N° chèque:", payment.checkNumber ?? "—", 75);
      drawKeyValue(page, font, MARGIN + 15, y - 28, "Banque:", payment.checkBankName ?? "—", 75);
      drawKeyValue(page, font, MARGIN + 245, y - 14, "Date d'émission:", payment.checkIssueDate ? formatDate(payment.checkIssueDate) : "—", 100);
      drawKeyValue(page, font, MARGIN + 245, y - 28, "Compensation:", payment.checkClearanceDate ? formatDate(payment.checkClearanceDate) : "—", 100);
    } else {
      drawKeyValue(page, font, MARGIN + 15, y - 14, "Référence virement:", payment.transferReference ?? "—", 115);
      drawKeyValue(page, font, MARGIN + 245, y - 14, "Banque émettrice:", payment.transferSourceBank ?? "—", 105);
      drawKeyValue(page, font, MARGIN + 15, y - 28, "Date:", formatDate(payment.collectedAt), 115);
    }
    y -= 44;
  }

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
  drawCellClipped(page, font, paymentCategoryLabelFr(payment.category), MARGIN + 340, y - 4, 10, 92, TEXT_PRIMARY);
  const amountStr = dzdPdf(payment.amount);
  page.drawText(amountStr, { x: MARGIN + 440, y: y - 4, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawLine({
    start: { x: MARGIN, y: y - 14 },
    end: { x: MARGIN + CONTENT_W, y: y - 14 },
    thickness: 0.5,
    color: BORDER,
  });

  y -= 30;

  // Total box — the paid-now headline (T-579: the totals block below carries
  // the rest of the contract; this green box stays the amount's anchor).
  drawBox(page, MARGIN + 320, y - 36, CONTENT_W - 320, 36, SUCCESS);
  page.drawText("TOTAL PAYÉ", { x: MARGIN + 335, y: y - 14, size: 9, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText(amountStr, {
    x: MARGIN + CONTENT_W - 15 - fontBold.widthOfTextAtSize(amountStr, 14),
    y: y - 22,
    size: 14,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y -= 56;

  // T-579 (1/2/5): AFFECTATION / COUVERTURE — the allocation lines, the
  // per-tranche (FI/T1/T2/T3) and per-category breakdowns, then the totals
  // block. Only when the caller resolved the coverage data; a bare call
  // (legacy surfaces) renders the pre-T-579 receipt unchanged.
  if (coverage) {
    const line = (text: string, yy: number, opts: { size?: number; bold?: boolean; color?: typeof TEXT_PRIMARY } = {}) => {
      page.drawText(sanitizePdfText(text), {
        x: MARGIN + 15,
        y: yy,
        size: opts.size ?? 9,
        font: opts.bold ? fontBold : font,
        color: opts.color ?? TEXT_PRIMARY,
      });
    };
    const rightAmount = (amount: number, yy: number, opts: { size?: number; bold?: boolean; color?: typeof TEXT_PRIMARY } = {}) => {
      const s = dzdPdf(amount);
      page.drawText(s, {
        x: MARGIN + CONTENT_W - 15 - (opts.bold ? fontBold : font).widthOfTextAtSize(s, opts.size ?? 9),
        y: yy,
        size: opts.size ?? 9,
        font: opts.bold ? fontBold : font,
        color: opts.color ?? TEXT_PRIMARY,
      });
    };
    /** T-368 flow discipline: never truncate — continue onto "(suite)". */
    const ensureSpace = (needed: number) => {
      if (y - needed < PAGE_BOTTOM_LIMIT + 12) {
        page = continuationHeader(doc, font, title);
        y = PAGE_H - 110;
      }
    };

    page.drawText("AFFECTATION / COUVERTURE", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;

    // The allocation lines (cap at 6 like the modal's waterfall preview —
    // beyond that the aggregates below carry the truth; the count is honest).
    const MAX_LINES = 6;
    for (const l of cov.lines.slice(0, MAX_LINES)) {
      ensureSpace(13);
      drawCellClipped(page, font, `${l.label}`, MARGIN + 15, y, 9, 330, TEXT_PRIMARY);
      rightAmount(l.allocatedAmount, y);
      y -= 13;
    }
    if (cov.lines.length > MAX_LINES) {
      ensureSpace(13);
      line(`+ ${cov.lines.length - MAX_LINES} autre(s) affectation(s) — voir agrégats ci-dessous`, y, { size: 8, color: TEXT_MUTED });
      y -= 13;
    }

    // Per-tranche breakdown (FI / T1 / T2 / T3 / Autres — canonical order).
    if (cov.byTranche.length > 0) {
      ensureSpace(14);
      line(
        `Par tranche : ${cov.byTranche.map((t) => `${t.key} ${dzdPdf(t.amount)}`).join("  ·  ")}`,
        y,
        { size: 8, color: TEXT_MUTED },
      );
      y -= 14;
    }

    // Per-category breakdown.
    if (cov.byCategory.length > 1) {
      ensureSpace(14);
      const parts = cov.byCategory.map((c) => `${c.label} ${dzdPdf(c.amount)}`);
      let joined = parts.join("  ·  ");
      while (font.widthOfTextAtSize(joined, 8) > CONTENT_W - 30 && parts.length > 1) {
        parts.pop();
        joined = `${parts.join("  ·  ")}  ·  …`;
      }
      line(`Par catégorie : ${joined}`, y, { size: 8, color: TEXT_MUTED });
      y -= 14;
    }

    // The totals block — the v2.3 contract's four headline figures + the
    // card's expected/excess pair + the academic year.
    ensureSpace(30);
    y -= 4;
    page.drawLine({
      start: { x: MARGIN, y: y + 6 },
      end: { x: MARGIN + CONTENT_W, y: y + 6 },
      thickness: 0.5,
      color: BORDER,
    });

    const totalsRows: Array<{ lab: string; val: string; bold?: boolean; color?: typeof TEXT_PRIMARY }> = [];
    totalsRows.push({ lab: "Payé maintenant", val: dzdPdf(cov.totals.paidNow), bold: true });
    if (cov.totals.expectedAmount > 0) {
      totalsRows.push({ lab: "Total attendu", val: dzdPdf(cov.totals.expectedAmount) });
    }
    if (cov.totals.excess > 0) {
      totalsRows.push({ lab: "Excédent (crédit parent)", val: `+${dzdPdf(cov.totals.excess)}`, color: WARNING });
    }
    if (cov.totals.paidToDate !== null) {
      totalsRows.push({ lab: "Payé à ce jour (famille)", val: dzdPdf(cov.totals.paidToDate) });
    }
    if (coverage.installments && cov.totals.totalJustified > 0) {
      totalsRows.push({ lab: "Prix justifié (net)", val: dzdPdf(cov.totals.totalJustified) });
    }
    if (cov.totals.remaining !== null) {
      totalsRows.push({
        lab: "Reste dû",
        val: dzdPdf(cov.totals.remaining),
        bold: true,
        color: cov.totals.remaining > 0 ? rgb(0xc0 / 255, 0x50 / 255, 0x4d / 255) : SUCCESS,
      });
    }
    for (const row of totalsRows) {
      ensureSpace(13);
      // Static French labels draw RAW (WinAnsi-safe literals — the same
      // convention as "DÉTAIL DU PAIEMENT"/"TOTAL PAYÉ"); the values are
      // dzdPdf output (ASCII by construction).
      page.drawText(row.lab, {
        x: MARGIN + 15, y, size: 9, font: row.bold ? fontBold : font, color: row.color ?? TEXT_PRIMARY,
      });
      page.drawText(row.val, {
        x: MARGIN + CONTENT_W - 15 - (row.bold ? fontBold : font).widthOfTextAtSize(row.val, 9),
        y, size: 9, font: row.bold ? fontBold : font, color: row.color ?? TEXT_PRIMARY,
      });
      y -= 13;
    }

    // T-579 (8): the academic year — raw label, sanitized dynamic value.
    if (cov.academicYearLabel) {
      ensureSpace(14);
      page.drawText(`Année scolaire : ${sanitizePdfText(cov.academicYearLabel)}`, {
        x: MARGIN + 15, y, size: 9, font, color: TEXT_MUTED,
      });
      y -= 14;
    }
    y -= 10;
  }

  // Notes section — T-368 (REPT-501): render ALL wrapped lines (the old
  // slice(0, 2) silently truncated long notes on a financial document).
  if (payment.notes) {
    if (y - 32 < PAGE_BOTTOM_LIMIT + 12) {
      page = continuationHeader(doc, font, title);
      y = PAGE_H - 110;
    }
    page.drawText("NOTES", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;
    const noteLines = wrapText(sanitizePdfText(payment.notes), font, 10, CONTENT_W - 30);
    const boxH = Math.max(30, noteLines.length * 12 + 18);
    drawBox(page, MARGIN, y - boxH, CONTENT_W, boxH, rgb(0xfa / 255, 0xfa / 255, 0xfa / 255), BORDER);
    noteLines.forEach((ln, i) => {
      page.drawText(ln, { x: MARGIN + 15, y: y - 12 - i * 12, size: 10, font, color: TEXT_PRIMARY });
    });
    y -= boxH + 10;
  }

  // Proof section
  if (payment.proofUrl) {
    if (y - 40 < PAGE_BOTTOM_LIMIT + 12) {
      page = continuationHeader(doc, font, title);
      y = PAGE_H - 110;
    }
    page.drawText("JUSTIFICATIF", { x: MARGIN, y, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 16;
    drawBox(page, MARGIN, y - 26, CONTENT_W, 26, rgb(0xfa / 255, 0xfa / 255, 0xfa / 255), BORDER);
    page.drawText(sanitizePdfText(`Fichier joint: ${payment.proofUrl}`).slice(0, 90), {
      x: MARGIN + 15, y: y - 16, size: 10, font, color: TEXT_PRIMARY,
    });
    y -= 32;
  }

  // Status banner (keep above the bottom limit; clamps when an extreme note
  // pushed y too far — the banner never renders off-page).
  const bannerY = Math.max(y - 28, PAGE_BOTTOM_LIMIT + 28);
  const statusColor = payment.status === "paid" ? SUCCESS : payment.status === "pending" ? WARNING : TEXT_MUTED;
  drawBox(page, MARGIN, bannerY - 28, CONTENT_W, 28, statusColor);
  const statusLabel = `Statut: ${sanitizePdfText((PAYMENT_STATUS_LABELS_FR[payment.status] ?? "—").toUpperCase())}`;
  page.drawText(statusLabel, {
    x: MARGIN + 15, y: bannerY - 18, size: 11, font: fontBold, color: rgb(1, 1, 1),
  });

  // Signature line (always on the LAST page).
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
