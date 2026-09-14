/**
 * Student term bulletin PDF generator (relevé de notes trimestriel).
 *
 * Iteration 9 — entity-specific reports (spec §5.2).
 *
 * Per spec:
 *   - Bulletins trimestriels → generated in StudentDetailDrawer
 *   - Relevé de compte      → generated in ParentDetailDrawer
 *   - Fiche de paie         → generated in PersonnelDetailDrawer
 *
 * These functions are kept here because they share the same PDF rendering
 * primitives (drawHeader, drawBox, drawKeyValue, etc.).
 *
 * Uses pdf-lib (MIT, no native deps, runs in browser + Node).
 *
 * T-368 (67th session, REPT-501/502): assessment rows flow onto "(suite)"
 * continuation pages (the old `y < 100 break` silently dropped every
 * subject past the first page — a 16-subject bulletin lost subjects);
 * the GPA box + decision always render at a safe baseline; footers carry
 * the true page count on every page.
 */
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { Student } from "../../domain/model/student";
import type { Assessment, Subject, AcademicTerm } from "../../domain/model/academic";
import { LEVEL_LABELS_FR } from "../../domain/model/student";
import { formatDate } from "../../core/format/date";
import {
  PAGE_H,
  MARGIN,
  CONTENT_W,
  PAGE_BOTTOM_LIMIT,
  BORDER,
  TEXT_PRIMARY,
  TEXT_MUTED,
  ACCENT_BG,
  PRIMARY_BG,
  SUCCESS,
  DANGER,
  sanitizePdfText,
  drawHeader,
  continuationHeader,
  drawKeyValue,
  drawBox,
  stampPageFooters,
} from "./shared";

const TITLE = "BULLETIN TRIMESTRIEL";

const ROW_H = 16;

function drawTableHeader(page: PDFPage, font: PDFFont, fontBold: PDFFont, y: number) {
  drawBox(page, MARGIN, y - 18, CONTENT_W, 18, ACCENT_BG, BORDER);
  page.drawText(sanitizePdfText("Matière"), { x: MARGIN + 10, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText("D1", { x: MARGIN + 220, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText("D2", { x: MARGIN + 280, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText(sanitizePdfText("Examen"), { x: MARGIN + 340, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText(sanitizePdfText("Coef."), { x: MARGIN + 410, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
  page.drawText("Moy.", { x: MARGIN + 470, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
}

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

  let page = drawHeader(doc, font, TITLE);

  let y = PAGE_H - 130;

  // Student identity box
  drawBox(page, MARGIN, y - 60, CONTENT_W, 60, undefined, BORDER);
  drawKeyValue(page, font, MARGIN + 15, y - 18, "Élève:", `${input.student.firstName} ${input.student.lastName}`);
  drawKeyValue(page, font, MARGIN + 15, y - 36, "Code:", input.student.code);
  drawKeyValue(page, font, MARGIN + 280, y - 18, "Niveau:", `${LEVEL_LABELS_FR[input.student.level]} · A${input.student.gradeYear}`);
  drawKeyValue(page, font, MARGIN + 280, y - 36, "Classe:", input.className ?? input.student.classId ?? "—");
  drawKeyValue(page, font, MARGIN + 440, y - 18, "Trimestre:", input.term);
  drawKeyValue(page, font, MARGIN + 440, y - 36, "Émis le:", formatDate(new Date().toISOString()));

  y -= 90;

  // Grades table
  page.drawText(sanitizePdfText("Notes par matière"), { x: MARGIN, y, size: 14, font: fontBold, color: TEXT_PRIMARY });
  y -= 22;

  drawTableHeader(page, font, fontBold, y);
  y -= 18;

  // Table rows — T-368 (REPT-501): flow onto continuation pages instead of
  // the old `y < 100 break` (which silently dropped subjects).
  for (const a of input.assessments) {
    if (y - ROW_H < PAGE_BOTTOM_LIMIT) {
      page = continuationHeader(doc, font, TITLE);
      drawTableHeader(page, font, fontBold, PAGE_H - 110);
      y = PAGE_H - 128;
    }
    const subject = input.subjects.find((s) => s.id === a.subjectId);
    const name = subject?.name ?? a.subjectId;
    drawBox(page, MARGIN, y - ROW_H, CONTENT_W, ROW_H, undefined, BORDER);
    page.drawText(sanitizePdfText(name.slice(0, 30)), { x: MARGIN + 10, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(a.devoir1 != null ? a.devoir1.toFixed(2) : "—", { x: MARGIN + 220, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(a.devoir2 != null ? a.devoir2.toFixed(2) : "—", { x: MARGIN + 280, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(a.examen != null ? a.examen.toFixed(2) : "—", { x: MARGIN + 340, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(String(a.coefficient ?? 1), { x: MARGIN + 410, y: y - 12, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(a.subjectAverage != null ? a.subjectAverage.toFixed(2) : "—", { x: MARGIN + 470, y: y - 12, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= ROW_H;
  }

  // T-368 (REPT-501): the GPA box + decision ALWAYS render — on a fresh
  // continuation page when the table consumed the current page.
  if (y - 80 < PAGE_BOTTOM_LIMIT) {
    page = continuationHeader(doc, font, TITLE);
    y = PAGE_H - 110;
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

  stampPageFooters(doc, font, new Date().toISOString());

  return doc.save();
}
