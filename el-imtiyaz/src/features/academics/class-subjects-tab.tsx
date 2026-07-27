/**
 * ClassSubjectsTab — replaces placeholder in Class Detail page.
 *
 * Iteration 3-G: lists subjects assigned to the class with teacher,
 * weeklyHours, coefficient. Allows assigning new subjects.
 */
import { useState } from "react";
import { BookOpen, User, Clock, Plus } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../state/toast-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { EmptyState } from "../../shared/components/state-views";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../shared/ui/select";
import { FormField } from "../../shared/components/form-field";
import { Input } from "../../shared/ui/input";
import { UnifiedModal, type UnifiedModalProps } from "../../shared/components/unified-modal";
import type { AcademicLevel } from "../../domain/model/student";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function ClassSubjectsTab({ classId }: { classId: string }) {
  const repos = useRepositories();
  const toast = useToast();
  const classSubjects = useObservable(() => repos.subjects.observeByClass(classId), [classId]);
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const [assignOpen, setAssignOpen] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState<string>("");
  const [weeklyHours, setWeeklyHours] = useState(2);
  const [coefficient, setCoefficient] = useState(1);
  const [alert, setAlert] = useState<Alert | null>(null);

  const cls = useObservable(() => repos.classes.observeById(classId), [classId]);
  const levelSubjects = cls
    ? allSubjects.filter((s) => s.level === (cls.level as AcademicLevel))
    : [];

  async function assign() {
    if (!subjectId) {
      setAlert({ tone: "warning", title: "Sélection requise", description: "Choisissez une matière." });
      return;
    }
    const teacher = personnel.find((p) => p.id === teacherId);
    const result = await repos.subjects.assignSubjectToClass({
      classId,
      subjectId,
      teacherId: teacherId || null,
      teacherName: teacher ? `${teacher.firstName} ${teacher.lastName}` : null,
      weeklyHours,
      coefficient,
    });
    if (result.ok) {
      toast.showSuccess("Matière assignée", "L'assignation est enregistrée.");
      setAssignOpen(false);
      setSubjectId("");
      setTeacherId("");
      setWeeklyHours(2);
      setCoefficient(1);
    } else {
      setAlert({
        tone: "error",
        title: "Échec",
        description: result.error.userMessage,
      });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm">Matières de la classe</CardTitle>
          <CardDescription>
            {classSubjects.length > 0
              ? `${classSubjects.length} matière(s) assignée(s)`
              : "Aucune matière assignée — affichage des matières du niveau"}
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
              description="Affichage des matières disponibles pour ce niveau. Cliquez sur 'Assigner une matière' pour configurer."
            />
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">Matière</th>
                    <th className="text-left p-2">Code</th>
                    <th className="text-center p-2">Coef.</th>
                    <th className="text-center p-2">Extracurr.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {levelSubjects.map((s) => (
                    <tr key={s.id}>
                      <td className="p-2 font-medium">{s.name}</td>
                      <td className="p-2 font-mono text-xs">{s.code}</td>
                      <td className="p-2 text-center">{s.coefficient}</td>
                      <td className="p-2 text-center">
                        {s.isExtracurricular ? <Badge variant="secondary">Oui</Badge> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Matière</th>
                  <th className="text-left p-2">Enseignant</th>
                  <th className="text-center p-2">Heures/sem</th>
                  <th className="text-center p-2">Coef.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {classSubjects.map((cs) => {
                  const subj = allSubjects.find((s) => s.id === cs.subjectId);
                  return (
                    <tr key={cs.id}>
                      <td className="p-2 font-medium flex items-center gap-2">
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        {subj?.name ?? cs.subjectId}
                      </td>
                      <td className="p-2 flex items-center gap-1 text-muted-foreground">
                        <User className="h-3 w-3" />
                        {cs.teacherName ?? "—"}
                      </td>
                      <td className="p-2 text-center">
                        <span className="flex items-center justify-center gap-1">
                          <Clock className="h-3 w-3" /> {cs.weeklyHours}h
                        </span>
                      </td>
                      <td className="p-2 text-center">{cs.coefficient}</td>
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
        title="Assigner une matière"
        description="Associe une matière à cette classe avec un enseignant, des heures hebdo et un coefficient."
        submitLabel="Assigner"
        submitIcon={Plus}
        onSubmit={assign}
        alert={alert}
        onDismissAlert={() => setAlert(null)}
      >
        <div className="space-y-4">
          <FormField label="Matière" required>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
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
            <Select value={teacherId || "__none__"} onValueChange={(v) => setTeacherId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Aucun enseignant" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Aucun —</SelectItem>
                {personnel
                  .filter((p) => p.staffCategory === "teacher")
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
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
