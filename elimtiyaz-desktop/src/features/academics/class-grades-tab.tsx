// ============================================================================
// FILE: src/features/academics/class-grades-tab.tsx
// ============================================================================
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Plus, BookOpen } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { Button } from "../../shared/ui/button";
import { EmptyState } from "../../shared/layout/state-views";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDate } from "../../core/format/date";
import type { AcademicLevel } from "../../domain/model/student";

export function ClassGradesTab({ classId }: { classId: string }) {
  const repos = useRepositories();
  const navigate = useNavigate();
  const [activeTerm, setActiveTerm] = useState<"T1" | "T2" | "T3">("T1");

  const cls = useObservable(() => repos.classes.observeById(classId), [classId]);
  const assessments = useObservable(() => repos.grades.observeForClass(classId), [classId]);
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const classSubjects = useObservable(() => repos.subjects.observeByClass(classId), [classId]);

  const levelSubjects = useMemo(() => {
    if (classSubjects.length > 0) {
      return classSubjects.map((cs) => {
        const s = allSubjects.find((sub) => sub.id === cs.subjectId);
        return {
          id: cs.subjectId,
          name: s?.name ?? cs.subjectId,
          code: s?.code ?? "",
          coefficient: cs.coefficient || s?.coefficient || 1,
        };
      });
    }
    const level = cls?.level as AcademicLevel;
    const levelSubjs = allSubjects.filter((s) => s.level === level);
    return levelSubjs.length > 0 ? levelSubjs : allSubjects;
  }, [classSubjects, allSubjects, cls?.level]);

  const filteredAssessments = assessments.filter((a) => a.term === activeTerm);

  const bySubject = new Map<string, typeof assessments>();
  for (const a of filteredAssessments) {
    if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, []);
    bySubject.get(a.subjectId)!.push(a);
  }

  const latestPerSubject = Array.from(bySubject.entries()).map(([subjectId, list]) => {
    const sorted = list.slice().sort(
      (a, b) => new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime(),
    );
    return { subjectId, latest: sorted[0], count: list.length };
  });

  const validAverages = filteredAssessments
    .map((a) => a.subjectAverage)
    .filter((v): v is number => v != null);
  const classAvg = validAverages.length > 0
    ? validAverages.reduce((s, v) => s + v, 0) / validAverages.length
    : null;
  const passingCount = validAverages.filter((v) => v >= 10).length;
  const failingCount = validAverages.filter((v) => v < 10).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3 flex-wrap gap-2">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-primary" /> Notes et Moyennes — Trimestre {activeTerm}
          </CardTitle>
          <CardDescription>
            {filteredAssessments.length > 0
              ? `${filteredAssessments.length} évaluation(s) · ${latestPerSubject.length} matière(s) · Moyenne classe: ${classAvg != null ? classAvg.toFixed(2) : "—"}/20`
              : "Aucune note saisie pour ce trimestre"}
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-muted/40 p-1 rounded-md border border-border">
            {(["T1", "T2", "T3"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTerm(t)}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                  activeTerm === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Trimestre {t}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {filteredAssessments.length === 0 ? (
          <div className="space-y-4 py-6 text-center">
            <EmptyState
              title={`Aucune note pour le trimestre ${activeTerm}`}
              description="Sélectionnez une matière ci-dessous pour procéder à la saisie des notes de la classe."
            />
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg mx-auto">
              {levelSubjects.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/academics/class/${classId}/grades/${s.id}`)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Noter {s.name}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-border p-3 text-center bg-surface-panel/40">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Évaluations ({activeTerm})</p>
                <p className="text-2xl font-mono font-bold mt-1">{filteredAssessments.length}</p>
              </div>
              <div className="rounded-md border border-status-success/30 bg-status-success/5 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-status-success">≥ 10/20 (Admis)</p>
                <p className="text-2xl font-mono font-bold text-status-success mt-1">{passingCount}</p>
              </div>
              <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-status-danger">&lt; 10/20 (Ajournés)</p>
                <p className="text-2xl font-mono font-bold text-status-danger mt-1">{failingCount}</p>
              </div>
            </div>

            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-2.5">Matière</th>
                    <th className="text-center p-2.5">Devoir 1</th>
                    <th className="text-center p-2.5">Devoir 2</th>
                    <th className="text-center p-2.5">Examen</th>
                    <th className="text-center p-2.5">Coef.</th>
                    <th className="text-center p-2.5">Moyenne</th>
                    <th className="text-center p-2.5">Date saisie</th>
                    <th className="text-right p-2.5">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {latestPerSubject.map(({ subjectId, latest }) => {
                    const subj = allSubjects.find((s) => s.id === subjectId);
                    const passing = latest.subjectAverage != null && latest.subjectAverage >= 10;
                    return (
                      <tr key={subjectId} className="hover:bg-accent/5">
                        <td className="p-2.5 font-medium">
                          <div className="flex items-center gap-2">
                            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{subj?.name ?? subjectId}</span>
                            {subj?.code && <Badge variant="outline" className="text-[10px] font-mono">{subj.code}</Badge>}
                          </div>
                        </td>
                        <td className="p-2.5 text-center font-mono">{latest.devoir1 ?? "—"}</td>
                        <td className="p-2.5 text-center font-mono">{latest.devoir2 ?? "—"}</td>
                        <td className="p-2.5 text-center font-mono">{latest.examen ?? "—"}</td>
                        <td className="p-2.5 text-center text-muted-foreground font-mono">{latest.coefficient}</td>
                        <td className="p-2.5 text-center">
                          {latest.subjectAverage != null ? (
                            <StatusChip
                              label={`${latest.subjectAverage.toFixed(2)} / 20`}
                              tone={passing ? "success" : "danger"}
                            />
                          ) : "—"}
                        </td>
                        <td className="p-2.5 text-center text-xs text-muted-foreground">
                          {formatDate(latest.enteredAt)}
                        </td>
                        <td className="p-2.5 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => navigate(`/academics/class/${classId}/grades/${subjectId}`)}
                          >
                            Modifier
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={() => {
                  const firstSubj = levelSubjects[0]?.id;
                  if (firstSubj) navigate(`/academics/class/${classId}/grades/${firstSubj}`);
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Saisir d'autres notes
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}