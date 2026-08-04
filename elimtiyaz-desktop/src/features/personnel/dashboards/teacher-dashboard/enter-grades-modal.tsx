/**
 * "Saisir des notes" modal — calls repos.grades.enterGrade() per student.
 *
 * Extracted from `teacher-dashboard.tsx` in task 6-b. Behavior preserved
 * verbatim — only file location + import paths changed.
 */
import { useEffect, useState } from "react";
import { BookMarked, CheckCircle2 } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { useToast } from "../../../../app/providers/toast-provider";
import type { AcademicClass, Subject } from "../../../../domain/model/academic";
import { Input } from "../../../../shared/ui/input";
import { Label } from "../../../../shared/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../../shared/ui/select";
import { UnifiedModal } from "../../../../shared/ui/unified-modal";
import { ACADEMIC_YEAR, todayIso, type AssessmentType } from "./types";

export function EnterGradesModal({
  open, onOpenChange, classId, classes, subjects, enteredBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  classes: readonly AcademicClass[];
  subjects: readonly Subject[];
  enteredBy: string;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const students = useObservable(
    () => classId ? repos.students.observeByClass(classId) : repos.students.observeByClass(""),
    [classId],
  );
  const [subjectId, setSubjectId] = useState("");
  const [assessType, setAssessType] = useState<AssessmentType>("devoir1");
  const [grades, setGrades] = useState<Map<string, string>>(new Map());

  useEffect(() => { setGrades(new Map()); }, [open, classId, assessType, subjectId]);

  const cls = classes.find((c) => c.id === classId);
  const subject = subjects.find((s) => s.id === subjectId);

  async function handleSubmit() {
    if (!cls || !subject) {
      toast.showWarning("Sélection incomplète", "Choisissez une matière.");
      return;
    }
    let count = 0;
    for (const [studentId, raw] of grades) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 20) continue;
      const base = {
        studentId, subjectId: subject.id, classId, term: "T1" as const, academicYear: ACADEMIC_YEAR,
        devoir1: null as number | null, devoir2: null as number | null, examen: null as number | null,
        coefficient: subject.coefficient, enteredBy,
      };
      const input = assessType === "devoir1" ? { ...base, devoir1: value }
        : assessType === "devoir2" ? { ...base, devoir2: value }
        : { ...base, examen: value };
      const res = await repos.grades.enterGrade(input);
      if (res.ok) count++;
    }
    if (count > 0) {
      toast.showSuccess("Notes enregistrées", `${count} note(s) saisie(s).`);
      onOpenChange(false);
    } else {
      toast.showWarning("Aucune note valide", "Vérifiez les valeurs (0 à 20).");
    }
  }

  return (
    <UnifiedModal
      open={open} onOpenChange={onOpenChange}
      title={`Saisir des notes — ${cls?.name ?? ""}`}
      description={todayIso()}
      icon={BookMarked} size="lg"
      submitLabel="Enregistrer" submitIcon={CheckCircle2} onSubmit={handleSubmit}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Matière</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
              <SelectContent>
                {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Type d'évaluation</Label>
            <Select value={assessType} onValueChange={(v) => setAssessType(v as AssessmentType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="devoir1">Devoir 1</SelectItem>
                <SelectItem value="devoir2">Devoir 2</SelectItem>
                <SelectItem value="examen">Examen</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève.</p>
        ) : (
          <ul className="divide-y divide-border">
            {students.map((s) => (
              <li key={s.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{s.firstName} {s.lastName}</p>
                </div>
                <Input
                  type="number" min={0} max={20} step={0.5}
                  className="h-8 w-24"
                  placeholder="0-20"
                  value={grades.get(s.id) ?? ""}
                  onChange={(e) => setGrades((m) => new Map(m).set(s.id, e.target.value))}
                />
                <span className="text-xs text-muted-foreground">/20</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </UnifiedModal>
  );
}
