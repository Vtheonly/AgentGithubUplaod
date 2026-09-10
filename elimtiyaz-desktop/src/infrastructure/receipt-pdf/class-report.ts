// ============================================================================
// FILE: elimtiyaz-desktop/src/infrastructure/receipt-pdf/class-report.ts
// ============================================================================
/**
 * Class performance report PDF (T-275, 42nd session — AI-311d).
 *
 * The copilot's generate_class_report document — a one-page (or more)
 * pedagogical meeting sheet: class overview, GPA distribution, the
 * per-student table (canonical GPAs), and the at-risk list. Built over
 * the generic report-document engine; the DATA arrives from the tool
 * layer (canonical `evaluateStudentTermPerformance` per student — this
 * generator never recomputes anything).
 */
import { generateReportPdf, type ReportSpec } from "./report-document";

export interface ClassReportStudentRow {
  readonly name: string;
  readonly code: string;
  readonly gpa: number | null;
  readonly isPassing: boolean | null;
  readonly missingAssessments: number;
}

export interface ClassReportInput {
  readonly className: string;
  readonly classCode: string;
  readonly level: string;
  readonly studentCount: number;
  readonly evaluated: number;
  readonly classAverage: number | null;
  readonly passRate: number | null;
  readonly students: readonly ClassReportStudentRow[];
}

export async function generateClassReportPdf(input: ClassReportInput): Promise<Uint8Array> {
  const sorted = [...input.students].sort((a, b) => (b.gpa ?? -1) - (a.gpa ?? -1));
  const atRisk = input.students.filter((s) => s.gpa !== null && s.gpa < 10);

  const spec: ReportSpec = {
    title: "RAPPORT DE CLASSE",
    meta: [
      ["Classe", `${input.className} (${input.classCode})`],
      ["Niveau", input.level],
      ["Effectif", `${input.studentCount} élèves — ${input.evaluated} évalués`],
      ["Moyenne de classe", input.classAverage !== null ? `${input.classAverage.toFixed(2)} / 20` : "n/a"],
      ["Taux de réussite", input.passRate !== null ? `${input.passRate.toFixed(1)} %` : "n/a"],
    ],
    sections: [
      {
        heading: "Performances par élève",
        table: {
          columns: ["#", "Élève", "Code", "Moyenne /20", "Statut", "Év. manquantes"],
          widths: [0.5, 3, 2.2, 1.2, 1.4, 1.4],
          rows: sorted.map((s, i) => [
            String(i + 1),
            s.name,
            s.code,
            s.gpa !== null ? s.gpa.toFixed(2) : "n/a",
            s.gpa === null ? "non évalué" : s.isPassing ? "admis" : "à risque",
            String(s.missingAssessments),
          ]),
        },
        note:
          "Les moyennes proviennent du moteur canonique d'évaluation (le même que les bulletins). Élève à risque = moyenne < 10/20 (règle canonique de passage).",
      },
      {
        heading: "Élèves à risque (moyenne < 10/20)",
        table:
          atRisk.length > 0
            ? {
                columns: ["Élève", "Code", "Moyenne /20", "Év. manquantes"],
                widths: [3.4, 2.4, 1.3, 1.4],
                rows: atRisk.map((s) => [
                  s.name,
                  s.code,
                  s.gpa !== null ? s.gpa.toFixed(2) : "n/a",
                  String(s.missingAssessments),
                ]),
              }
            : undefined,
        note:
          atRisk.length > 0
            ? `${atRisk.length} élève(s) sous le seuil — entretien pédagogique recommandé avant la fin du trimestre.`
            : "Aucun élève sous le seuil de 10/20.",
      },
    ],
    footnote:
      "Document généré par l'assistant IA à partir des données canoniques du système. Document de travail interne — non destiné à la diffusion aux familles.",
  };

  return generateReportPdf(spec);
}

