// ============================================================================
// FILE: src/features/academics/class-subjects-tab.tsx
// ============================================================================
import { useState, useMemo } from "react";
import { BookOpen, User, Clock, Plus, Trash2 } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { EmptyState } from "../../shared/layout/state-views";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { FormField } from "../../shared/ui/form-field";
import { Input } from "../../shared/ui/input";
import {
  UnifiedModal,
  type UnifiedModalProps,
} from "../../shared/ui/unified-modal";
import type { AcademicLevel } from "../../domain/model/student";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function ClassSubjectsTab({ classId }: { classId: string }) {
  const repos = useRepositories();
  const toast = useToast();
  const classSubjects = useObservable(
    () => repos.subjects.observeByClass(classId),
    [classId],
  );
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const teachers = useObservable(() => repos.teachers.observe(), []);

  const [assignOpen, setAssignOpen] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState<string>("");
  const [weeklyHours, setWeeklyHours] = useState(2);
  const [coefficient, setCoefficient] = useState(1);
  const [alert, setAlert] = useState<Alert | null>(null);

  const cls = useObservable(
    () => repos.classes.observeById(classId),
    [classId],
  );
  const levelSubjects = cls
    ? allSubjects.filter((s) => s.level === (cls.level as AcademicLevel))
    : allSubjects;

  // Combine Personnel with category=teacher and registered Teacher profiles
  const eligibleTeachers = useMemo(() => {
    const list: Array<{ id: string; name: string }> = [];
    const seenIds = new Set<string>();

    personnel
      .filter((p) => p.staffCategory === "teacher" || p.roleId === "teacher")
      .forEach((p) => {
        seenIds.add(p.id);
        list.push({ id: p.id, name: `${p.firstName} ${p.lastName}` });
      });

    teachers.forEach((t) => {
      if (!seenIds.has(t.personnelId) && !seenIds.has(t.id)) {
        seenIds.add(t.id);
        list.push({
          id: t.personnelId || t.id,
          name: `${t.firstName} ${t.lastName}`,
        });
      }
    });

    return list;
  }, [personnel, teachers]);

  async function assign() {
    if (!subjectId) {
      setAlert({
        tone: "warning",
        title: "Sélection requise",
        description: "Choisissez une matière.",
      });
      return;
    }
    const teacher = eligibleTeachers.find((t) => t.id === teacherId);
    const selectedSubj = allSubjects.find((s) => s.id === subjectId);

    const result = await repos.subjects.assignSubjectToClass({
      classId,
      subjectId,
      teacherId: teacherId || null,
      teacherName: teacher ? teacher.name : null,
      weeklyHours: weeklyHours || 2,
      coefficient: coefficient || selectedSubj?.coefficient || 1,
    });

    if (result.ok) {
      toast.showSuccess(
        "Matière assignée",
        `« ${selectedSubj?.name ?? "Matière"} » a été configurée pour cette classe.`,
      );
      setAssignOpen(false);
      setSubjectId("");
      setTeacherId("");
      setWeeklyHours(2);
      setCoefficient(1);
      setAlert(null);
    } else {
      setAlert({
        tone: "error",
        title: "Erreur",
        description: result.error.userMessage,
      });
    }
  }

  async function handleRemoveSubject(csId: string) {
    const r = await repos.subjects.removeSubjectFromClass(csId);
    if (r.ok) {
      toast.showSuccess(
        "Matière retirée",
        "La matière a été retirée de la classe.",
      );
    } else {
      toast.showError("Échec", r.error.userMessage);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm">
            Matières et Enseignants de la classe
          </CardTitle>
          <CardDescription>
            {classSubjects.length > 0
              ? `${classSubjects.length} matière(s) assignée(s)`
              : "Aucune matière assignée — affichage du programme du niveau"}
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setAssignOpen(true)}>
          <Plus className="h-4 w-4" /> Assigner une matière
        </Button>
      </CardHeader>
      <CardContent>
        {classSubjects.length === 0 ? (
          <div className="space-y-3">
            <EmptyState
              title="Aucune assignation enregistrée"
              description="Configurez les matières et les enseignants pour cette classe."
            />
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-2.5">Matière</th>
                  <th className="text-left p-2.5">Enseignant</th>
                  <th className="text-center p-2.5">Heures/sem</th>
                  <th className="text-center p-2.5">Coef.</th>
                  <th className="text-right p-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {classSubjects.map((cs) => {
                  const subj = allSubjects.find((s) => s.id === cs.subjectId);
                  return (
                    <tr key={cs.id} className="hover:bg-accent/5">
                      <td className="p-2.5 font-medium flex items-center gap-2">
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        {subj?.name ?? cs.subjectId}
                        {subj?.code && (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono"
                          >
                            {subj.code}
                          </Badge>
                        )}
                      </td>
                      <td className="p-2.5 text-muted-foreground">
                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                          <User className="h-3.5 w-3.5 text-primary" />
                          {cs.teacherName ?? "Non désigné"}
                        </span>
                      </td>
                      <td className="p-2.5 text-center font-mono">
                        <span className="flex items-center justify-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />{" "}
                          {cs.weeklyHours}h
                        </span>
                      </td>
                      <td className="p-2.5 text-center font-mono font-semibold">
                        {cs.coefficient}
                      </td>
                      <td className="p-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-status-danger hover:bg-status-danger/10"
                          onClick={() => handleRemoveSubject(cs.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <UnifiedModal
        open={assignOpen}
        onOpenChange={setAssignOpen}
        size="md"
        icon={BookOpen}
        iconTone="primary"
        title="Assigner une matière à la classe"
        description="Associe une matière à cette classe avec un enseignant, des heures hebdomadaires et un coefficient."
        submitLabel="Assigner"
        submitIcon={Plus}
        onSubmit={assign}
        alert={alert}
        onDismissAlert={() => setAlert(null)}
      >
        <div className="space-y-4">
          <FormField label="Matière" required>
            <Select
              value={subjectId}
              onValueChange={(v) => {
                setSubjectId(v);
                const s = allSubjects.find((sub) => sub.id === v);
                if (s) setCoefficient(s.coefficient);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner une matière…" />
              </SelectTrigger>
              <SelectContent>
                {levelSubjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.code}) · coef {s.coefficient}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Enseignant (optionnel)">
            <Select
              value={teacherId || "__none__"}
              onValueChange={(v) => setTeacherId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choisir un enseignant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  — Aucun enseignant désigné —
                </SelectItem>
                {eligibleTeachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Heures / semaine" required>
              <Input
                type="number"
                min={1}
                max={20}
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(Number(e.target.value))}
              />
            </FormField>
            <FormField label="Coefficient" required>
              <Input
                type="number"
                min={1}
                max={10}
                value={coefficient}
                onChange={(e) => setCoefficient(Number(e.target.value))}
              />
            </FormField>
          </div>
        </div>
      </UnifiedModal>
    </Card>
  );
}
