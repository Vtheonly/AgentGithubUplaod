/**
 * Family statement PDF — S47 (the owner-requested financially DETAILED and
 * TRACEABLE client history).
 *
 * The account statement (account-statement.ts) lists payment rows; this
 * generator renders the FULL financial picture the owner demanded: per
 * CHILD sections (academic year, tranches, devis, dettes, transport with
 * its destination), a spelled-out balance reconstruction ("Solde = À payer
 * − Réglé"), the source record references (workbook, sheet, Excel row),
 * the financial fault inspector's findings WITH their evidence chains,
 * and an explicit "informations non disponibles" list — nothing invented,
 * nothing silently dropped.
 *
 * Layout discipline (the S46 lessons, all enforced):
 *   - every table amount is RIGHT-ALIGNED at a shared edge;
 *   - every cell is ellipsis-clipped to its column (drawCellClipped);
 *   - every block asks for space FIRST (ensureSpace) and flows onto a
 *     "(suite)" continuation page — the S46 continuation rhythm;
 *   - explicit labelWidths in the meta grid (no off-page values);
 *   - long prose wraps (wrapText), never overflows.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  PAGE_H,
  MARGIN,
  CONTENT_W,
  PAGE_BOTTOM_LIMIT,
  BORDER,
  BRAND_BLUE_DEEP,
  DANGER,
  SUCCESS,
  WARNING,
  TEXT_MUTED,
  TEXT_PRIMARY,
  ACCENT_BG,
  sanitizePdfText,
  drawHeader,
  continuationHeader,
  drawBox,
  drawCellClipped,
  drawKeyValue,
  stampPageFooters,
  wrapText,
} from "./shared";

/* ------------------------------------------------------------------ */
/*  Document model                                                     */
/* ------------------------------------------------------------------ */

export interface FamilyStatementInstallment {
  /** e.g. "Frais d'inscription (FI)" / "Tranche 1 — Scolarité (V1)". */
  readonly label: string;
  /** The tranche number (0 = FI, 1..3 = waves) — for the reference. */
  readonly tranche: number;
  readonly due: number;
  readonly paid: number;
}

export interface FamilyStatementPayment {
  readonly date: string;
  /** Full description: category + academic year + tranche + child. */
  readonly description: string;
  readonly method: string;
  readonly amount: number;
}

export interface FamilyStatementStudent {
  readonly name: string;
  readonly className: string;
  readonly level: string;
  readonly academicYear: string;
  readonly devisAnnuel: number | null;
  /** e.g. "formule Excel: =300000−J955 (base 300 000 − remise 5 000)". */
  readonly devisNote?: string | null;
  readonly dettes: number | null;
  readonly dettesReglement: number | null;
  readonly transport: {
    readonly destination: string;
    readonly tranches: ReadonlyArray<{ label: string; amount: number | null }>;
  } | null;
  readonly installments: readonly FamilyStatementInstallment[];
  readonly payments: readonly FamilyStatementPayment[];
  readonly sourceRow?: number;
}

/** A fault-inspector finding rendered with its evidence chain. */
export interface FamilyStatementAnomaly {
  readonly verdict: "confirmed_error" | "suspicious" | "legitimate_large" | "unverifiable";
  readonly subject: string;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly suggestedAction?: string;
}

export interface FamilyStatement {
  readonly parent: {
    readonly displayName: string;
    readonly code?: string | null;
    readonly phone?: string | null;
    readonly email?: string | null;
    /** e.g. "Excel 2027-2026.xlsx · ETAT 20262027 · lignes 954–955". */
    readonly sourceRef: string;
  };
  readonly issuedAt: string;
  readonly academicYear: string;
  readonly students: readonly FamilyStatementStudent[];
  readonly anomalies: readonly FamilyStatementAnomaly[];
  /** Data that could NOT be verified — listed explicitly, never invented. */
  readonly unavailable: readonly string[];
}

/* ------------------------------------------------------------------ */
/*  Layout constants                                                   */
/* ------------------------------------------------------------------ */

const TITLE = "RELEVÉ DE COMPTE — HISTORIQUE CLIENT";
/** Section heading bar height + inner padding. */
const SECTION_H = 20;
/** Space above each block. */
const BLOCK_GAP = 14;
/** The fee table column left edges (absolute). */
const FEE_LABEL_X = MARGIN + 8;
const FEE_DETAIL_X = MARGIN + 170;
const FEE_DUE_X = MARGIN + 355;
const FEE_PAID_X = MARGIN + 428;
/** Shared right edge for amount cells (the S46 rule). */
const AMOUNT_RIGHT = MARGIN + CONTENT_W - 10;
/** The fee table's two amount columns get DISTINCT right edges so the
 * "À payer" and "Réglé" figures never collide: due ends at 470, paid at
 * the shared edge (the right-most column, as in a French décompte). */
const DUE_RIGHT = MARGIN + 420;
/** Fee-table row height. */
const FEE_ROW_H = 15;

const VERDICT_LABELS: Record<FamilyStatementAnomaly["verdict"], string> = {
  confirmed_error: "ERREUR CONFIRMÉE",
  suspicious: "SUSPECT — À VÉRIFIER",
  legitimate_large: "ÉLEVÉ MAIS PLAUSIBLE",
  unverifiable: "NON VÉRIFIABLE",
};
const VERDICT_COLORS: Record<FamilyStatementAnomaly["verdict"], ReturnType<typeof rgb>> = {
  confirmed_error: DANGER,
  suspicious: WARNING,
  legitimate_large: SUCCESS,
  unverifiable: TEXT_MUTED,
};

function dzd(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n
    .toLocaleString("fr-FR", { maximumFractionDigits: 0, useGrouping: true })
    .replace(/[\u202f\u00a0\u2009]/g, " ");
}

/* ------------------------------------------------------------------ */
/*  Generator                                                          */
/* ------------------------------------------------------------------ */

export async function generateFamilyStatementPdf(
  stmt: FamilyStatement,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = drawHeader(doc, font, TITLE);
  let y = PAGE_H - 110;

  /** Draw text, clipped, WinAnsi-safe. */
  const text = (
    p: PDFPage, s: string, x: number, yy: number,
    size: number, f: PDFFont, color: ReturnType<typeof rgb>, maxW?: number,
  ) => {
    const safe = sanitizePdfText(s);
    if (maxW !== undefined) drawCellClipped(p, f, safe, x, yy, size, maxW, color);
    else p.drawText(safe, { x, y: yy, size, font: f, color });
  };
  /** Right-aligned text at an arbitrary right edge. */
  const rightAt = (
    p: PDFPage, s: string, right: number, yy: number, size: number,
    f: PDFFont, color: ReturnType<typeof rgb>,
  ) => {
    const safe = sanitizePdfText(s);
    p.drawText(safe, {
      x: right - f.widthOfTextAtSize(safe, size),
      y: yy, size, font: f, color,
    });
  };

  /** Flow to a continuation page when out of space (the S46 rhythm). */
  const ensureSpace = (needed: number) => {
    if (y - needed < PAGE_BOTTOM_LIMIT) {
      page = continuationHeader(doc, font, TITLE);
      y = PAGE_H - 130;
    }
  };

  /* ── 1. Client meta ── */
  drawBox(page, MARGIN, y - 64, CONTENT_W, 64, undefined, BORDER);
  drawKeyValue(page, font, MARGIN + 15, y - 18, "Client:", stmt.parent.displayName, 70);
  drawKeyValue(page, font, MARGIN + 15, y - 36, "Année scolaire:", stmt.academicYear, 70);
  drawKeyValue(page, font, MARGIN + 15, y - 54, "Émis le:", stmt.issuedAt, 70);
  drawKeyValue(page, font, MARGIN + 245, y - 18, "Téléphone:", stmt.parent.phone ?? "—", 80);
  drawKeyValue(page, font, MARGIN + 245, y - 36, "E-mail:", stmt.parent.email ?? "—", 80);
  drawKeyValue(page, font, MARGIN + 245, y - 54, "Élèves:", `${stmt.students.length}`, 80);
  y -= 64 + 6;
  ensureSpace(14);
  text(page, `Source: ${stmt.parent.sourceRef}`, MARGIN, y, 8, font, TEXT_MUTED, CONTENT_W);
  y -= BLOCK_GAP;

  /* ── 2. Synthèse (flush 3-box row — the S46 pattern) ── */
  const totalDue = stmt.students.reduce(
    (a, s) =>
      a + s.installments.reduce((x, i) => x + i.due, 0),
    0,
  );
  const totalPaid = stmt.students.reduce(
    (a, s) => a + s.payments.reduce((x, p) => x + p.amount, 0),
    0,
  );
  const totalDevis = stmt.students.reduce((a, s) => a + (s.devisAnnuel ?? 0), 0);
  const BOX_GAP = 8;
  const BOX_W = (CONTENT_W - 2 * BOX_GAP) / 3;
  const boxes: Array<[string, string, ReturnType<typeof rgb>]> = [
    ["Devis annuel (source)", dzd(totalDevis), TEXT_PRIMARY],
    ["Total réglé", dzd(totalPaid), SUCCESS],
    ["Solde dû (reconstitué)", dzd(totalDue - totalPaid), DANGER],
  ];
  boxes.forEach(([label, value, color], i) => {
    const bx = MARGIN + i * (BOX_W + BOX_GAP);
    drawBox(page, bx, y - 50, BOX_W, 50, ACCENT_BG, BORDER);
    text(page, label, bx + 12, y - 17, 8, font, TEXT_MUTED, BOX_W - 20);
    rightAt(page, value, bx + BOX_W - 12, y - 38, 12, fontBold, color);
  });
  y -= 50 + BLOCK_GAP;

  /* ── 3. Per-student sections ── */
  for (const [sIdx, s] of stmt.students.entries()) {
    ensureSpace(SECTION_H + FEE_ROW_H * 6 + 40);
    // Section bar.
    drawBox(page, MARGIN, y - SECTION_H, CONTENT_W, SECTION_H, BRAND_BLUE_DEEP);
    const sectionTitle = `${sIdx + 1}. ${s.name} — ${s.className} (${s.level}) — ${s.academicYear}`;
    text(page, sectionTitle, MARGIN + 8, y - 14, 10, fontBold, rgb(1, 1, 1), CONTENT_W - 120);
    if (s.sourceRow !== undefined) {
      const ref = `ligne Excel ${s.sourceRow}`;
      text(page, ref, AMOUNT_RIGHT - font.widthOfTextAtSize(ref, 8), y - 14, 8, font, rgb(1, 1, 1));
    }
    y -= SECTION_H + 8;

    // Devis line + note.
    const devisLine = `Devis annuel (source Excel): ${dzd(s.devisAnnuel)}`;
    text(page, devisLine, MARGIN + 4, y, 9, fontBold, TEXT_PRIMARY, CONTENT_W / 2);
    if (s.dettes && s.dettes > 0) {
      const dettesLine = `Dettes antérieures: ${dzd(s.dettes)} (réglé: ${dzd(s.dettesReglement ?? 0)})`;
      text(page, dettesLine, MARGIN + CONTENT_W / 2 + 4, y, 9, font, DANGER, CONTENT_W / 2 - 8);
    }
    y -= 13;
    if (s.devisNote) {
      const noteLines = wrapText(sanitizePdfText(s.devisNote), font, 8, CONTENT_W - 8);
      for (const line of noteLines.slice(0, 2)) {
        ensureSpace(11);
        text(page, line, MARGIN + 4, y, 8, font, TEXT_MUTED, CONTENT_W - 8);
        y -= 11;
      }
    }
    if (s.transport) {
      ensureSpace(12);
      const tDetail = s.transport.tranches
        .map((t) => `${t.label}: ${dzd(t.amount)}`)
        .join(" · ");
      const tLine = `Transport -> ${s.transport.destination} — ${tDetail}`;
      text(page, tLine, MARGIN + 4, y, 8, font, TEXT_MUTED, CONTENT_W - 8);
      y -= 12;
    }

    // The fee table.
    ensureSpace(FEE_ROW_H * (s.installments.length + 2) + 10);
    drawBox(page, MARGIN, y - 16, CONTENT_W, 16, rgb(0xef / 255, 0xf3 / 255, 0xf7 / 255));
    text(page, "Poste", FEE_LABEL_X, y - 12, 8, fontBold, TEXT_MUTED, 155);
    text(page, "Détail / échéance", FEE_DETAIL_X, y - 12, 8, fontBold, TEXT_MUTED, 175);
    rightAt(page, "À payer", DUE_RIGHT, y - 12, 8, fontBold, TEXT_MUTED);
    rightAt(page, "Réglé", AMOUNT_RIGHT, y - 12, 8, fontBold, TEXT_MUTED);
    y -= 18;

    let sumDue = 0, sumPaidFees = 0;
    for (const inst of s.installments) {
      ensureSpace(FEE_ROW_H + 2);
      text(page, inst.label, FEE_LABEL_X, y, 9, font, TEXT_PRIMARY, 155);
      const dueStr = dzd(inst.due);
      sumDue += inst.due;
      sumPaidFees += inst.paid;
      rightAt(page, dueStr, DUE_RIGHT, y, 9, font, TEXT_PRIMARY);
      rightAt(page, dzd(inst.paid), AMOUNT_RIGHT, y, 9, font, TEXT_PRIMARY);
      y -= FEE_ROW_H;
      page.drawLine({
        start: { x: MARGIN, y: y + 4 },
        end: { x: MARGIN + CONTENT_W, y: y + 4 },
        thickness: 0.25, color: BORDER,
      });
    }
    // Total row.
    ensureSpace(FEE_ROW_H + 2);
    text(page, "TOTAL", FEE_LABEL_X, y, 9, fontBold, TEXT_PRIMARY, 155);
    rightAt(page, dzd(sumDue), DUE_RIGHT, y, 9, fontBold, TEXT_PRIMARY);
    rightAt(page, dzd(sumPaidFees), AMOUNT_RIGHT, y, 9, fontBold, TEXT_PRIMARY);
    y -= FEE_ROW_H + 6;

    // The spelled-out balance reconstruction.
    const stuPaid = s.payments.reduce((a, p) => a + p.amount, 0);
    ensureSpace(14);
    const recon = `Solde dû pour ${s.name} = À payer ${dzd(sumDue)} − Réglé ${dzd(stuPaid)} = ${dzd(sumDue - stuPaid)}`;
    text(page, recon, MARGIN + 4, y, 9, fontBold, TEXT_PRIMARY, CONTENT_W - 8);
    y -= 14;

    // Payments history.
    if (s.payments.length > 0) {
      ensureSpace(16 + s.payments.length * (FEE_ROW_H + 1) + 6);
      text(page, `Historique des règlements (${s.payments.length})`, MARGIN + 4, y, 9, fontBold, TEXT_MUTED, CONTENT_W - 8);
      y -= 14;
      for (const pay of s.payments) {
        ensureSpace(FEE_ROW_H + 1);
        text(page, pay.date, MARGIN + 8, y, 8, font, TEXT_MUTED, 55);
        // The FULL description — child + year + tranche + purpose.
        text(page, pay.description, FEE_DETAIL_X - 60, y, 8, font, TEXT_PRIMARY, 235);
        text(page, pay.method, MARGIN + 355, y, 8, font, TEXT_MUTED, 60);
        rightAt(page, dzd(pay.amount), AMOUNT_RIGHT, y, 9, fontBold, TEXT_PRIMARY);
        y -= FEE_ROW_H;
      }
    }
    y -= BLOCK_GAP;
  }

  /* ── 4. Anomalies (the fault inspector's findings, evidence included) ── */
  if (stmt.anomalies.length > 0) {
    ensureSpace(30);
    drawBox(page, MARGIN, y - SECTION_H, CONTENT_W, SECTION_H, DANGER);
    text(page, `ANOMALIES DÉTECTÉES — INSPECTEUR FINANCIER (${stmt.anomalies.length})`,
      MARGIN + 8, y - 14, 10, fontBold, rgb(1, 1, 1), CONTENT_W - 16);
    y -= SECTION_H + 8;

    for (const a of stmt.anomalies) {
      // Measure the block first (evidence lines wrap).
      const evLines = a.evidence.flatMap((e) => wrapText(sanitizePdfText(`- ${e}`), font, 8, CONTENT_W - 32));
      const blockH = 30 + evLines.length * 10 + (a.suggestedAction ? 12 : 0);
      ensureSpace(blockH + 8);
      drawBox(page, MARGIN, y - blockH, CONTENT_W, blockH, undefined, VERDICT_COLORS[a.verdict]);
      const verdictLabel = VERDICT_LABELS[a.verdict];
      text(page, `[${verdictLabel}]`, MARGIN + 10, y - 13, 8, fontBold, VERDICT_COLORS[a.verdict], 130);
      text(page, a.subject, MARGIN + 145, y - 13, 9, fontBold, TEXT_PRIMARY, CONTENT_W - 160);
      let ay = y - 25;
      for (const line of wrapText(sanitizePdfText(a.summary), font, 8, CONTENT_W - 24)) {
        text(page, line, MARGIN + 10, ay, 8, font, TEXT_PRIMARY, CONTENT_W - 20);
        ay -= 10;
      }
      for (const line of evLines) {
        text(page, line, MARGIN + 10, ay, 8, font, TEXT_MUTED, CONTENT_W - 20);
        ay -= 10;
      }
      if (a.suggestedAction) {
        for (const line of wrapText(`-> ${sanitizePdfText(a.suggestedAction)}`, font, 8, CONTENT_W - 24).slice(0, 2)) {
          text(page, line, MARGIN + 10, ay, 8, font, VERDICT_COLORS[a.verdict], CONTENT_W - 20);
          ay -= 10;
        }
      }
      y -= blockH + 8;
    }
  }

  /* ── 5. Explicitly unavailable information ── */
  if (stmt.unavailable.length > 0) {
    ensureSpace(24 + stmt.unavailable.length * 12);
    text(page, "INFORMATIONS NON DISPONIBLES (jamais inventées):", MARGIN, y, 9, fontBold, TEXT_MUTED, CONTENT_W);
    y -= 14;
    for (const u of stmt.unavailable) {
      ensureSpace(12);
      text(page, `• ${u}`, MARGIN + 8, y, 8, font, TEXT_MUTED, CONTENT_W - 16);
      y -= 12;
    }
  }

  stampPageFooters(doc, font, new Date().toISOString());
  return doc.save();
}
