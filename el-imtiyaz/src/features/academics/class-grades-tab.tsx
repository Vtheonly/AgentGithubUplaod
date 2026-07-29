/**
 * ClassGradesTab — replaces placeholder in Class Detail page.
 *
 * Iteration 3-G: latest grade per subject with D1/D2/Examen breakdown.
 * Uses GradeRepository.observeForClass(classId).
 */
import { GraduationCap } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { EmptyState } from "../../shared/components/state-views";
import { StatusChip } from "../../shared/components/status-chip";
import { formatDate } from "../../core/format/date";

export function ClassGradesTab({ classId }: { classId: string }) {
  const repos = useRepositories();
  const assessments = useObservable(() => repos.grades.observeForClass(classId), [classId]);
  const subjects = useObservable(() => repos.subjects.observe(), []);

  // Group by subjectId
  const bySubject = new Map<string, typeof assessments>();
  for (const a of assessments) {
    if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, []);
    bySubject.get(a.subjectId)!.push(a);
  }

  // For each subject, take the most recent assessment
  const latestPerSubject = Array.from(bySubject.entries()).map(([subjectId, list]) => {
    const sorted = list.slice().sort(
      (a, b) => new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime(),
    );
    return { subjectId, latest: sorted[0], count: list.length };
  });

  // Class averages
  const validAverages = assessments
    .map((a) => a.subjectAverage)
    .filter((v): v is number => v != null);
  const classAvg = validAverages.length > 0
    ? validAverages.reduce((s, v) => s + v, 0) / validAverages.length
    : null;
  const passingCount = validAverages.filter((v) => v >= 10).length;
  const failingCount = validAverages.filter((v) => v < 10).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-primary" /> Notes — trimestres courants
        </CardTitle>
        <CardDescription>
          {assessments.length > 0
            ? `${assessments.length} évaluation(s) · ${latestPerSubject.length} matière(s) · Moyenne classe: ${classAvg != null ? classAvg.toFixed(2) : "—"}/20`
            : "Aucune note saisie"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {assessments.length === 0 ? (
          <EmptyState
            title="Aucune note"
            description="Les notes apparaîtront ici une fois saisies via 'Saisie des notes'."
          />
        ) : (
          <div className="space-y-4">
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-border p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Évaluations</p>
                <p className="text-2xl font-mono font-bold mt-1">{assessments.length}</p>
              </div>
              <div className="rounded-md border border-status-success/30 bg-status-success/5 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">≥ 10/20</p>
                <p className="text-2xl font-mono font-bold text-status-success mt-1">{passingCount}</p>
              </div>
              <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">&lt; 10/20</p>
                <p className="text-2xl font-mono font-bold text-status-danger mt-1">{failingCount}</p>
              </div>
            </div>

            {/* Per-subject table */}
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">Matière</th>
                    <th className="text-center p-2">Term</th>
                    <th className="text-center p-2">D1</th>
                    <th className="text-center p-2">D2</th>
                    <th className="text-center p-2">Examen</th>
                    <th className="text-center p-2">Coef.</th>
                    <th className="text-center p-2">Moy.</th>
                    <th className="text-center p-2">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {latestPerSubject.map(({ subjectId, latest, count }) => {
                    const subj = subjects.find((s) => s.id === subjectId);
                    const passing = latest.subjectAverage != null && latest.subjectAverage >= 10;
                    return (
                      <tr key={subjectId}>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{subj?.name ?? subjectId}</span>
                            {count > 1 && (
                              <Badge variant="outline" className="text-[10px]">+{count - 1}</Badge>
                            )}
                          </div>
                          {subj && (
                            <span className="text-[10px] text-muted-foreground font-mono">{subj.code}</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          <Badge variant="secondary">{latest.term}</Badge>
                        </td>
                        <td className="p-2 text-center font-mono">{latest.devoir1 ?? "—"}</td>
                        <td className="p-2 text-center font-mono">{latest.devoir2 ?? "—"}</td>
                        <td className="p-2 text-center font-mono">{latest.examen ?? "—"}</td>
                        <td className="p-2 text-center text-muted-foreground">{latest.coefficient}</td>
                        <td className="p-2 text-center">
                          {latest.subjectAverage != null ? (
                            <StatusChip
                              label={latest.subjectAverage.toFixed(2)}
                              tone={passing ? "success" : "danger"}
                            />
                          ) : "—"}
                        </td>
                        <td className="p-2 text-center text-xs text-muted-foreground">
                          {formatDate(latest.enteredAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Formule: moyenne = (D1 + D2 + 2·Examen) / 4 — chaque note sur 20 (plan §06.02).
              Seuil de passage: 10/20 (configurable dans une prochaine itération).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
