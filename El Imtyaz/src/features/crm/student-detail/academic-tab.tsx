/**
 * Tab 2 — Académique (grade book per term + academic history).
 *
 * Iteration 9 — Bulletin PDF download (spec §5.2): generated exclusively
 * inside the Student Profile Drawer (StudentDetailDrawer) or Class Detail
 * view. The button generates a PDF containing the student's identity,
 * term grades, GPA, and academic history — entirely client-side via
 * pdf-lib.
 *
 * Extracted from `student-detail-drawer.tsx` (iteration 6-a). Behavior
 * preserved exactly — only file location + import paths changed.
 */
import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { StatusChip } from "../../../shared/ui/status-chip";
import { generateBulletinPdf, downloadPdf } from "../../../infrastructure/receipt-pdf";
import {
  LEVEL_LABELS_FR,
  PROMOTION_DECISION_LABELS_FR,
  type AcademicHistoryEntry,
} from "../../../domain/model/student";
import type { AcademicTerm } from "../../../domain/model/academic";
import { TERMS } from "./types";

export function AcademicTab({ studentId }: { studentId: string }) {
  const repos = useRepositories();
  const toast = useToast();
  const [term, setTerm] = useState<AcademicTerm>("T1");
  const [downloading, setDownloading] = useState(false);
  const assessments = useObservable(() => repos.grades.observeForStudent(studentId), [studentId]);

  // Academic history is append-only and lives on the student entity itself
  // (plan §04.07). For mock layer, we read it from the student object.
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const history = (student as unknown as { academicHistory?: AcademicHistoryEntry[] })?.academicHistory ?? [];

  const termAssessments = assessments.filter((a) => a.term === term);

  // Overall GPA across all subjects in this term (weighted by coefficient)
  const totalCoef = termAssessments.reduce((s, a) => s + (a.coefficient || 1), 0);
  const weightedSum = termAssessments.reduce(
    (s, a) => s + (a.subjectAverage ?? 0) * (a.coefficient || 1),
    0,
  );
  const gpa = totalCoef > 0 ? weightedSum / totalCoef : null;

  /**
   * Iteration 9 — Bulletin PDF download (spec §5.2).
   *
   * Per spec: "Student Report Cards / Grade Transcripts (Bulletins
   * trimestriels / Relevé de notes): Must be generated exclusively inside
   * the Student Profile Drawer (StudentDetailDrawer) or Class Detail view."
   *
   * The button generates a PDF containing the student's identity, term
   * grades, GPA, and academic history. Generated entirely client-side
   * via pdf-lib.
   */
  async function handleDownloadBulletin() {
    if (!student) {
      toast.showWarning("Élève introuvable", "Impossible de générer le bulletin.");
      return;
    }
    if (termAssessments.length === 0) {
      toast.showWarning("Aucune note", `Aucune note saisie pour ${term}.`);
      return;
    }
    setDownloading(true);
    try {
      const klass = student.classId
        ? repos.classes.observe().get().find((c) => c.id === student.classId)
        : null;
      const pdfBytes = await generateBulletinPdf({
        student,
        term,
        assessments: termAssessments,
        gpa,
        subjects: repos.subjects.observe().get(),
        className: klass?.name,
      });
      const fileName = `bulletin-${student.code}-${term}-${new Date().toISOString().slice(0, 10)}.pdf`;
      downloadPdf(pdfBytes, fileName);
      toast.showSuccess("Bulletin téléchargé", fileName);
    } catch (e) {
      toast.showError("Échec du téléchargement", e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Notes — {term}</span>
            <div className="flex items-center gap-2">
              {/* Iteration 9 — Bulletin PDF (spec §5.2: entity-specific report
                  generated exclusively inside the StudentDetailDrawer). */}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={handleDownloadBulletin}
                disabled={downloading || termAssessments.length === 0}
                title="Télécharger le bulletin PDF"
              >
                {downloading ? (
                  <><FileText className="h-3 w-3" /> Génération…</>
                ) : (
                  <><Download className="h-3 w-3" /> Bulletin PDF</>
                )}
              </Button>
              <div className="flex gap-1">
                {TERMS.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={t === term ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setTerm(t)}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>
          </CardTitle>
          <CardDescription>
            Moyenne = (D1 + D2 + 2·Examen) / 4 — chaque note sur 20 (plan §06.02)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {termAssessments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucune note saisie pour ce trimestre.
            </p>
          ) : (
            <>
              <div className="rounded-md border border-border overflow-hidden mb-3">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left p-2">Matière</th>
                      <th className="text-center p-2">D1</th>
                      <th className="text-center p-2">D2</th>
                      <th className="text-center p-2">Examen</th>
                      <th className="text-center p-2">Coef.</th>
                      <th className="text-center p-2">Moy.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {termAssessments.map((a) => {
                      const subject = repos.subjects.observe().get().find((s) => s.id === a.subjectId);
                      return (
                        <tr key={a.id}>
                          <td className="p-2 font-medium">{subject?.name ?? a.subjectId}</td>
                          <td className="p-2 text-center font-mono">{a.devoir1 ?? "—"}</td>
                          <td className="p-2 text-center font-mono">{a.devoir2 ?? "—"}</td>
                          <td className="p-2 text-center font-mono">{a.examen ?? "—"}</td>
                          <td className="p-2 text-center text-muted-foreground">{a.coefficient}</td>
                          <td className="p-2 text-center font-mono font-semibold">
                            {a.subjectAverage?.toFixed(2) ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between rounded-md bg-primary/5 border border-primary/20 p-3">
                <span className="text-sm font-medium">Moyenne générale pondérée</span>
                <span className={`font-mono font-bold text-lg ${gpa != null && gpa >= 10 ? "text-status-success" : "text-status-danger"}`}>
                  {gpa != null ? gpa.toFixed(2) : "—"} / 20
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Historique académique</CardTitle>
          <CardDescription>Append-only — décisions de promotion (plan §04.07)</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucune année antérieure enregistrée.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((h, i) => (
                <li key={i} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{h.academicYear}</span>
                    <StatusChip
                      label={PROMOTION_DECISION_LABELS_FR[h.decision]}
                      tone={h.decision === "promoted" || h.decision === "graduated" ? "success" : h.decision === "repeated" ? "warning" : "info"}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{LEVEL_LABELS_FR[h.level]} · Année {h.gradeYear}{h.className ? ` · ${h.className}` : ""}</span>
                    <span>Moy. {h.gpa.toFixed(2)}{h.rank ? ` · Rang ${h.rank}` : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
