import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Student } from "../../domain/model/student";
import type { Assessment, Subject, AcademicTerm } from "../../domain/model/academic";
import { LEVEL_LABELS_FR } from "../../domain/model/student";
import { formatDate } from "../../core/format/date";
import {
  PAGE_W,
  PAGE_H,
  MARGIN,
  CONTENT_W,
  BORDER,
  TEXT_PRIMARY,
  TEXT_MUTED,
  ACCENT_BG,
  PRIMARY_BG,
  SUCCESS,
  DANGER,
  sanitizePdfText,
  drawHeader,
  drawKeyValue,
  drawBox,
} from "../receipt-pdf/shared";

export async function generateBulletinPdf(input: {
  student: Pick<
    Student,
    | "firstName"
    | "lastName"
    | "code"
    | "level"
    | "gradeYear"
    | "gender"
    | "classId"
  >;
  term: AcademicTerm;
  assessments: readonly Assessment[];
  gpa: number | null;
  subjects: readonly Subject[];
  className?: string;
  narrative?: string | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const title = `BULLETIN TRIMESTRIEL - ${input.term}`;
  const page = drawHeader(doc, font, title);

  let y = PAGE_H - 130;

  // Student Identity Box
  drawBox(page, MARGIN, y - 65, CONTENT_W, 65, undefined, BORDER);
  drawKeyValue(
    page,
    font,
    MARGIN + 15,
    y - 18,
    sanitizePdfText("Élève:"),
    sanitizePdfText(`${input.student.firstName} ${input.student.lastName}`),
  );
  drawKeyValue(
    page,
    font,
    MARGIN + 15,
    y - 36,
    sanitizePdfText("Code:"),
    sanitizePdfText(input.student.code),
  );
  drawKeyValue(
    page,
    font,
    MARGIN + 280,
    y - 18,
    sanitizePdfText("Niveau:"),
    sanitizePdfText(
      `${LEVEL_LABELS_FR[input.student.level]} · A${input.student.gradeYear}`,
    ),
  );
  drawKeyValue(
    page,
    font,
    MARGIN + 280,
    y - 36,
    sanitizePdfText("Classe:"),
    sanitizePdfText(input.className ?? input.student.classId ?? "—"),
  );
  drawKeyValue(
    page,
    font,
    MARGIN + 440,
    y - 18,
    sanitizePdfText("Trimestre:"),
    sanitizePdfText(input.term),
  );
  drawKeyValue(
    page,
    font,
    MARGIN + 440,
    y - 36,
    sanitizePdfText("Émis le:"),
    sanitizePdfText(formatDate(new Date().toISOString())),
  );

  y -= 95;

  // Subject Grades Table Header
  page.drawText(sanitizePdfText("Résultats Scolaires par Matière"), {
    x: MARGIN,
    y,
    size: 12,
    font: fontBold,
    color: TEXT_PRIMARY,
  });
  y -= 20;

  drawBox(page, MARGIN, y - 18, CONTENT_W, 18, ACCENT_BG, BORDER);
  page.drawText(sanitizePdfText("Matière"), {
    x: MARGIN + 10,
    y: y - 13,
    size: 9,
    font: fontBold,
    color: TEXT_PRIMARY,
  });
  page.drawText("Devoir 1", {
    x: MARGIN + 210,
    y: y - 13,
    size: 9,
    font: fontBold,
    color: TEXT_PRIMARY,
  });
  page.drawText("Devoir 2", {
    x: MARGIN + 270,
    y: y - 13,
    size: 9,
    font: fontBold,
    color: TEXT_PRIMARY,
  });
  page.drawText(sanitizePdfText("Examen"), {
    x: MARGIN + 330,
    y: y - 13,
    size: 9,
    font: fontBold,
    color: TEXT_PRIMARY,
  });
  page.drawText(sanitizePdfText("Coef."), {
    x: MARGIN + 400,
    y: y - 13,
    size: 9,
    font: fontBold,
    color: TEXT_PRIMARY,
  });
  page.drawText("Moyenne", {
    x: MARGIN + 450,
    y: y - 13,
    size: 9,
    font: fontBold,
    color: TEXT_PRIMARY,
  });
  y -= 18;

  // Render Grade Rows
  for (const a of input.assessments) {
    const subject = input.subjects.find((s) => s.id === a.subjectId);
    if (subject?.isExtracurricular) continue; // Scolarité split

    const name = subject?.name ?? a.subjectId;
    drawBox(page, MARGIN, y - 16, CONTENT_W, 16, undefined, BORDER);
    page.drawText(sanitizePdfText(name.slice(0, 32)), {
      x: MARGIN + 10,
      y: y - 12,
      size: 9,
      font,
      color: TEXT_PRIMARY,
    });
    page.drawText(a.devoir1 != null ? a.devoir1.toFixed(2) : "—", {
      x: MARGIN + 210,
      y: y - 12,
      size: 9,
      font,
      color: TEXT_PRIMARY,
    });
    page.drawText(a.devoir2 != null ? a.devoir2.toFixed(2) : "—", {
      x: MARGIN + 270,
      y: y - 12,
      size: 9,
      font,
      color: TEXT_PRIMARY,
    });
    page.drawText(a.examen != null ? a.examen.toFixed(2) : "—", {
      x: MARGIN + 330,
      y: y - 12,
      size: 9,
      font,
      color: TEXT_PRIMARY,
    });
    page.drawText(String(a.coefficient ?? 1), {
      x: MARGIN + 400,
      y: y - 12,
      size: 9,
      font,
      color: TEXT_PRIMARY,
    });

    const avgText =
      a.subjectAverage != null ? a.subjectAverage.toFixed(2) : "—";
    const avgColor =
      a.subjectAverage != null && a.subjectAverage >= 10 ? SUCCESS : DANGER;
    page.drawText(avgText, {
      x: MARGIN + 450,
      y: y - 12,
      size: 9,
      font: fontBold,
      color: avgColor,
    });
    y -= 16;
  }

  y -= 15;

  // GPA Summary Box
  drawBox(page, MARGIN, y - 30, CONTENT_W, 30, PRIMARY_BG, BORDER);
  page.drawText(sanitizePdfText("Moyenne Générale Trimestrielle"), {
    x: MARGIN + 15,
    y: y - 20,
    size: 11,
    font: fontBold,
    color: TEXT_PRIMARY,
  });

  const gpaText = input.gpa != null ? `${input.gpa.toFixed(2)} / 20` : "— / 20";
  const gpaColor =
    input.gpa != null && input.gpa >= 10
      ? SUCCESS
      : input.gpa != null
        ? DANGER
        : TEXT_MUTED;
  page.drawText(gpaText, {
    x: MARGIN + 430,
    y: y - 20,
    size: 14,
    font: fontBold,
    color: gpaColor,
  });

  y -= 45;

  // Teacher Narrative Section (if present)
  if (input.narrative) {
    page.drawText(
      sanitizePdfText("Appréciation Générale du Conseil des Professeurs"),
      {
        x: MARGIN,
        y,
        size: 11,
        font: fontBold,
        color: TEXT_PRIMARY,
      },
    );
    y -= 15;

    const lines = input.narrative
      .split("\n")
      .filter((l) => l.trim().length > 0);
    drawBox(
      page,
      MARGIN,
      y - (lines.length * 14 + 10),
      CONTENT_W,
      lines.length * 14 + 10,
      ACCENT_BG,
      BORDER,
    );
    y -= 12;
    for (const line of lines) {
      page.drawText(sanitizePdfText(line.slice(0, 100)), {
        x: MARGIN + 10,
        y,
        size: 8.5,
        font,
        color: TEXT_PRIMARY,
      });
      y -= 14;
    }
  }

  // Footer Signatures
  y = 80;
  page.drawText(sanitizePdfText("Signature de l'Enseignant Principal"), {
    x: MARGIN,
    y,
    size: 9,
    font: fontBold,
    color: TEXT_MUTED,
  });
  page.drawText(sanitizePdfText("Sceau et Signature du Directeur"), {
    x: PAGE_W - MARGIN - 180,
    y,
    size: 9,
    font: fontBold,
    color: TEXT_MUTED,
  });

  page.drawText(
    sanitizePdfText(
      "El-Imtiyaz Desktop Terminal · Document officiel d'évaluation académique",
    ),
    { x: MARGIN, y: 30, size: 8, font, color: TEXT_MUTED },
  );

  return doc.save();
}
