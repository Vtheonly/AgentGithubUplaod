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
 *
 * VAULT COMPLIANCE FIXES (sections 04/05/06 of the requirements vault):
 *   1. §06.03 / §05.01 — the term GPA shown in the header card now uses the
 *      canonical `computeOverallGpa` (coefficient-weighted, extracurricular
 *      EXCLUDED, non-computable averages SKIPPED) instead of an inline
 *      `(Σ avg×coef)/Σcoef` reduce that treated null averages as 0 and let
 *      club grades bleed into the Scolarité GPA. This keeps the drawer
 *      bit-identical to the backend `fn_calculate_student_term_gpa` and the
 *      Android engine (equivalence scenarios 032/034/035).
 *   2. §04.07 / §06.05 — each Academic History year is now expandable:
 *      clicking a past year reveals the complete report card (subject
 *      breakdown with Devoir 1 / Devoir 2 / Examen per term, teacher
 *      observations / narrative, attendance rate for the year, and the
 *      promotion outcome). Read-only by construction — no edit affordances
 *      are rendered for archived years (append-only rule).
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileText } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { StatusChip } from "../../../shared/ui/status-chip";
import { generateBulletinPdf, downloadPdf } from "../../../infrastructure/receipt-pdf";
import {
  computeOverallGpa,
  computeSubjectAverage,
  calculateAttendanceRate,
} from "../../../domain/model/academic";
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
  const [expandedYear, setExpandedYear] = useState<string | null>(null);
  const assessments = useObservable(() => repos.grades.observeForStudent(studentId), [studentId]);

  // FIX (academic history): `academicHistory` is now a real (optional) field
  // on the Student model, appended by the batch-promotion flow — the previous
  // `as unknown as` cast read a field that never existed, so the card was
  // always empty. Also derive a lightweight equivalent view from stored
  // assessments so the tab shows meaningful data before the first promotion.
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const history = student?.academicHistory ?? [];
  const subjects = useObservable(() => repos.subjects.observe(), []);

  // §04.07 — attendance rate per academic year, observed once over the
  // student's full tenure and filtered per expanded year (hooks cannot be
  // called inside the history map). Wide range keeps it reactive-safe.
  const attendanceAll = useObservable(
    () => repos.attendance.observeByStudent(studentId, "2000-01-01", "2100-12-31"),
    [studentId],
  );

  const termAssessments = assessments.filter((a) => a.term === term);

  // FIX (§06.03): canonical coefficient-weighted GPA — extracurricular
  // subjects are excluded and assessments without a computable subject
  // average are skipped, exactly like `fn_calculate_student_term_gpa`.
  const gpa = useMemo(
    () =>
      computeOverallGpa(
        termAssessments.map((a) => {
          const subject = subjects.find((s) => s.id === a.subjectId);
          return {
            subjectAverage:
              a.subjectAverage ?? computeSubjectAverage(a.devoir1, a.devoir2, a.examen),
            coefficient: a.coefficient || subject?.coefficient || 1,
            isExtracurricular: subject?.isExtracurricular ?? false,
          };
        }),
      ),
    [termAssessments, subjects],
  );

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
                      const subject = subjects.find((s) => s.id === a.subjectId);
                      return (
                        <tr key={a.id}>
                          <td className="p-2 font-medium">
                            {subject?.name ?? a.subjectId}
                            {subject?.isExtracurricular && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                (club — hors moyenne)
                              </span>
                            )}
                          </td>
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
          <CardDescription>
            Append-only — cliquez sur une année pour révèler le bulletin complet (plan §04.07)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucune année antérieure enregistrée.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((h, i) => (
                <HistoryYearItem
                  key={h.id ?? `${h.academicYear}-${i}`}
                  entry={h}
                  expanded={expandedYear === (h.id ?? h.academicYear)}
                  onToggle={() =>
                    setExpandedYear((prev) =>
                      prev === (h.id ?? h.academicYear) ? null : (h.id ?? h.academicYear),
                    )
                  }
                  yearAssessments={assessments.filter((a) => a.academicYear === h.academicYear)}
                  subjects={subjects}
                  attendanceRecords={filterAttendanceForYear(attendanceAll, h.academicYear)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// HistoryYearItem — expandable past-year report card (§04.07)
// ============================================================

function HistoryYearItem({
  entry,
  expanded,
  onToggle,
  yearAssessments,
  subjects,
  attendanceRecords,
}: {
  entry: AcademicHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  yearAssessments: readonly import("../../../domain/model/academic").Assessment[];
  subjects: readonly import("../../../domain/model/academic").Subject[];
  attendanceRecords: readonly import("../../../domain/model/academic").AttendanceRecord[];
}) {
  const attendanceRate = attendanceRecords.length > 0
    ? calculateAttendanceRate(attendanceRecords)
    : null;

  return (
    <li className="rounded-md border border-border text-sm">
      <button
        type="button"
        className="w-full text-left p-3 hover:bg-accent/5 transition-colors"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {entry.academicYear}
          </span>
          <StatusChip
            label={PROMOTION_DECISION_LABELS_FR[entry.decision]}
            tone={entry.decision === "promoted" || entry.decision === "graduated" ? "success" : entry.decision === "repeated" ? "warning" : "info"}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground pl-5">
          <span>{LEVEL_LABELS_FR[entry.level]} · Année {entry.gradeYear}{entry.className ? ` · ${entry.className}` : ""}</span>
          <span>Moy. {entry.gpa.toFixed(2)}{entry.rank ? ` · Rang ${entry.rank}` : ""}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          {/* Subject breakdown per term — read-only (append-only rule §04.07) */}
          {TERMS.map((t) => {
            const rows = yearAssessments.filter((a) => a.term === t);
            if (rows.length === 0) return null;
            return (
              <div key={t}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  {t} — Bulletin
                </p>
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 uppercase text-muted-foreground">
                      <tr>
                        <th className="text-left p-1.5">Matière</th>
                        <th className="text-center p-1.5">D1</th>
                        <th className="text-center p-1.5">D2</th>
                        <th className="text-center p-1.5">Examen</th>
                        <th className="text-center p-1.5">Coef.</th>
                        <th className="text-center p-1.5">Moy.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((a) => (
                        <tr key={a.id}>
                          <td className="p-1.5 font-medium">
                            {subjects.find((s) => s.id === a.subjectId)?.name ?? a.subjectId}
                          </td>
                          <td className="p-1.5 text-center font-mono">{a.devoir1 ?? "—"}</td>
                          <td className="p-1.5 text-center font-mono">{a.devoir2 ?? "—"}</td>
                          <td className="p-1.5 text-center font-mono">{a.examen ?? "—"}</td>
                          <td className="p-1.5 text-center text-muted-foreground">{a.coefficient}</td>
                          <td className="p-1.5 text-center font-mono font-semibold">
                            {a.subjectAverage?.toFixed(2) ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {yearAssessments.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              Aucune note détaillée archivée pour cette année (seule la synthèse est conservée).
            </p>
          )}

          {/* Teacher observations / narrative */}
          {entry.narrative && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Observations des enseignants
              </p>
              <p className="text-xs rounded-md bg-muted/30 border border-border p-2">
                {entry.narrative}
              </p>
            </div>
          )}

          {/* Attendance rate + promotion outcome summary */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Taux de présence</p>
              <p className="text-sm font-mono font-semibold">
                {attendanceRate != null
                  ? `${(attendanceRate * 100).toFixed(0)} %`
                  : "— (non archivé)"}
              </p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Décision de promotion</p>
              <p className="text-sm font-medium">
                {PROMOTION_DECISION_LABELS_FR[entry.decision]}
              </p>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <FileText className="h-3 w-3" />
            Année archivée — lecture seule (append-only). Toute correction exige une nouvelle
            entrée auditée.
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * Filter attendance records belonging to an academic year "YYYY-YYYY"
 * (Sept 1 of the start year → Aug 31 of the end year, inclusive).
 */
function filterAttendanceForYear(
  records: readonly import("../../../domain/model/academic").AttendanceRecord[],
  academicYear: string,
): import("../../../domain/model/academic").AttendanceRecord[] {
  const m = /^(\d{4})-(\d{4})$/.exec(academicYear.trim());
  if (!m) return [];
  const from = `${m[1]}-09-01`;
  const to = `${m[2]}-08-31`;
  return records.filter((r) => r.date >= from && r.date <= to);
}
