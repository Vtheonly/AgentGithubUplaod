/**
 * Class details drawer — opened when a teacher clicks one of "Mes classes".
 *
 * Extracted from `teacher-dashboard.tsx` in task 6-b. Behavior preserved
 * verbatim — only file location + import paths changed.
 */
import {
  GraduationCap, ClipboardCheck, BookMarked, Plus,
} from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import type { AcademicClass } from "../../../../domain/model/academic";
import { Button } from "../../../../shared/ui/button";
import { UnifiedModal } from "../../../../shared/ui/unified-modal";
import { todayIso } from "./types";

export function ClassDetailsDrawer({
  cls,
  open,
  onOpenChange,
  onAssignHomework,
  onTakeAttendance,
  onEnterGrades,
}: {
  cls: AcademicClass | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssignHomework: (id: string) => void;
  onTakeAttendance: (id: string) => void;
  onEnterGrades: (id: string) => void;
}) {
  const repos = useRepositories();
  const students = useObservable(
    () => cls ? repos.students.observeByClass(cls.id) : repos.students.observeByClass(""),
    [cls?.id],
  );
  const grades = useObservable(
    () => cls ? repos.grades.observeForClass(cls.id) : repos.grades.observeForClass(""),
    [cls?.id],
  );
  const homework = useObservable(
    () => cls ? repos.homework.observeForClass(cls.id) : repos.homework.observeForClass(""),
    [cls?.id],
  );
  const attendance = useObservable(
    () => cls ? repos.attendance.observeByClass(cls.id, todayIso()) : repos.attendance.observeByClass("", todayIso()),
    [cls?.id],
  );

  if (!cls) {
    return (
      <UnifiedModal open={false} onOpenChange={onOpenChange} title="" hideFooter>
        <div />
      </UnifiedModal>
    );
  }

  const presentCount = attendance.filter((a) => a.status === "present").length;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      size="lg"
      title={cls.name}
      description={`Salle ${cls.room ?? "—"} • ${cls.enrolledCount}/${cls.capacity} élèves • ${todayIso()}`}
      icon={GraduationCap}
      hideFooter
      footer={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onTakeAttendance(cls.id)}>
            <ClipboardCheck className="h-4 w-4" /> Faire l'appel
          </Button>
          <Button size="sm" variant="outline" onClick={() => onEnterGrades(cls.id)}>
            <BookMarked className="h-4 w-4" /> Saisir des notes
          </Button>
          <Button size="sm" onClick={() => onAssignHomework(cls.id)}>
            <Plus className="h-4 w-4" /> Donner un devoir
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-2">Élèves ({students.length})</h3>
          {students.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun élève inscrit.</p>
          ) : (
            <ul className="divide-y divide-border">
              {students.slice(0, 12).map((s) => (
                <li key={s.id} className="py-1.5 text-sm text-foreground">
                  {s.firstName} {s.lastName}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-2">Appel du jour</h3>
          <p className="text-xs text-muted-foreground">
            {presentCount}/{students.length} présents · {attendance.length} enregistrement(s)
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-2">Notes récentes</h3>
          {grades.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune note saisie.</p>
          ) : (
            <ul className="text-xs text-muted-foreground space-y-1">
              {grades.slice(0, 5).map((g) => (
                <li key={g.id} className="font-mono">
                  élève {g.studentId} · D1={g.devoir1 ?? "—"} D2={g.devoir2 ?? "—"} Ex={g.examen ?? "—"} moy={g.subjectAverage ?? "—"}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-2">Devoirs à venir</h3>
          {homework.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun devoir.</p>
          ) : (
            <ul className="divide-y divide-border">
              {homework.map((hw) => (
                <li key={hw.id} className="py-1.5 text-sm">
                  <span className="font-medium text-foreground">{hw.title}</span>
                  <span className="text-xs text-muted-foreground"> · à rendre {hw.dueDate}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </UnifiedModal>
  );
}
