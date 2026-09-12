// ============================================================================
// FILE: src/features/academics/teachers-tab.tsx
// ============================================================================
import { useState, useMemo } from "react";
import { Users, Plus, Search, UserCheck, School, BookOpen } from "lucide-react";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Input } from "../../shared/ui/input";
import { FormField } from "../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { StatusChip } from "../../shared/ui/status-chip";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useCurrentAcademicYear } from "./hooks/use-current-academic-year";
import {
  GRADE_LEVEL_LABELS_FR,
  LEVEL_LABELS_FR,
} from "../../domain/model/student";
import { TEACHER_STATUS_LABELS_FR } from "../../domain/model/teacher";

interface TeacherRow {
  id: string;
  personnelId: string;
  firstName: string;
  lastName: string;
  code: string;
  position: string;
  status: string;
  maxWeeklyHours: number;
  homeroomClasses: string[];
  subjectClasses: Array<{ className: string; subjectName: string }>;
}

export function TeachersTab({ canManage }: { canManage: boolean }) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const currentYear = useCurrentAcademicYear();

  const personnel = useObservable(() => repos.personnel.observe(), []) ?? [];
  const teachers = useObservable(() => repos.teachers.observe(), []) ?? [];
  const classes = useObservable(() => repos.classes.observe(), []) ?? [];
  const allSubjects = useObservable(() => repos.subjects.observe(), []) ?? [];

  const [search, setSearch] = useState("");
  const [assignModalTarget, setAssignModalTarget] = useState<TeacherRow | null>(
    null,
  );
  const [selectedClassId, setSelectedClassId] = useState("");
  const [assignmentType, setAssignmentType] = useState<"homeroom" | "subject">(
    "homeroom",
  );
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [addTeacherModalOpen, setAddTeacherModalOpen] = useState(false);
  const [selectedPersonnelId, setSelectedPersonnelId] = useState("");

  const teacherRows = useMemo<TeacherRow[]>(() => {
    const list: TeacherRow[] = [];
    const seenPersonnelIds = new Set<string>();

    personnel
      .filter((p) => p.staffCategory === "teacher" || p.roleId === "teacher")
      .forEach((p) => {
        seenPersonnelIds.add(p.id);
        const tRecord = teachers.find((t) => t.personnelId === p.id);

        const homeroomClasses = classes
          .filter(
            (c) =>
              c.homeroomTeacherId === p.id ||
              (tRecord && c.homeroomTeacherId === tRecord.id),
          )
          .map((c) => c.name);

        list.push({
          id: tRecord?.id || p.id,
          personnelId: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          code: tRecord?.code || `ENS-${p.id.slice(-4).toUpperCase()}`,
          position: p.position || "Enseignant",
          status: tRecord?.status || p.status,
          maxWeeklyHours: tRecord?.maxWeeklyHours || p.weeklyHoursTarget || 18,
          homeroomClasses,
          subjectClasses: [],
        });
      });

    teachers.forEach((t) => {
      if (!seenPersonnelIds.has(t.personnelId)) {
        seenPersonnelIds.add(t.personnelId);
        const homeroomClasses = classes
          .filter(
            (c) =>
              c.homeroomTeacherId === t.personnelId ||
              c.homeroomTeacherId === t.id,
          )
          .map((c) => c.name);

        list.push({
          id: t.id,
          personnelId: t.personnelId,
          firstName: t.firstName,
          lastName: t.lastName,
          code: t.code,
          position: "Enseignant",
          status: t.status,
          maxWeeklyHours: t.maxWeeklyHours,
          homeroomClasses,
          subjectClasses: [],
        });
      }
    });

    return list;
  }, [personnel, teachers, classes]);

  const filtered = teacherRows.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
      t.code.toLowerCase().includes(q) ||
      t.homeroomClasses.join(" ").toLowerCase().includes(q)
    );
  });

  async function handleAssignSubmit() {
    if (!assignModalTarget || !selectedClassId || !session) return;
    const targetClass = classes.find((c) => c.id === selectedClassId);
    if (!targetClass) return;

    if (assignmentType === "homeroom") {
      const result = await repos.classes.updateClass(targetClass.id, {
        homeroomTeacherId: assignModalTarget.personnelId,
        homeroomTeacherName: `${assignModalTarget.firstName} ${assignModalTarget.lastName}`,
      });

      if (result.ok) {
        toast.showSuccess(
          "Enseignant principal assigné",
          `${assignModalTarget.firstName} ${assignModalTarget.lastName} est maintenant responsable de la classe ${targetClass.name}.`,
        );
        setAssignModalTarget(null);
        setSelectedClassId("");
      } else {
        toast.showError("Échec", result.error.userMessage);
      }
    } else {
      if (!selectedSubjectId) {
        toast.showWarning("Sélection requise", "Veuillez choisir une matière.");
        return;
      }
      const subj = allSubjects.find((s) => s.id === selectedSubjectId);
      const result = await repos.subjects.assignSubjectToClass({
        classId: targetClass.id,
        subjectId: selectedSubjectId,
        teacherId: assignModalTarget.personnelId,
        teacherName: `${assignModalTarget.firstName} ${assignModalTarget.lastName}`,
        weeklyHours: 2,
        coefficient: subj?.coefficient || 1,
      });

      if (result.ok) {
        toast.showSuccess(
          "Matière assignée",
          `${assignModalTarget.firstName} ${assignModalTarget.lastName} enseigne ${subj?.name ?? "la matière"} en ${targetClass.name}.`,
        );
        setAssignModalTarget(null);
        setSelectedClassId("");
        setSelectedSubjectId("");
      } else {
        toast.showError("Échec", result.error.userMessage);
      }
    }
  }

  async function handleAddTeacherSubmit() {
    if (!selectedPersonnelId || !session) return;
    const p = personnel.find((pers) => pers.id === selectedPersonnelId);
    if (!p) return;

    const res = await repos.teachers.createTeacher(
      {
        personnelId: p.id,
        code: `ENS-${currentYear.code.slice(0, 4)}-${p.id.slice(-3).toUpperCase()}`,
        academicYearId: currentYear.id,
        academicYearCode: currentYear.code,
        status: "active",
        maxWeeklyHours: p.weeklyHoursTarget || 18,
      },
      session.userId,
      session.displayName,
    );

    if (res.ok) {
      toast.showSuccess(
        "Enseignant ajouté",
        `${p.firstName} ${p.lastName} est enregistré comme enseignant.`,
      );
      setAddTeacherModalOpen(false);
      setSelectedPersonnelId("");
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom d'enseignant, code, classe..."
              className="pl-9 h-8 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {filtered.length} enseignant(s) au total
            </span>
            {canManage && (
              <Button
                size="sm"
                onClick={() => setAddTeacherModalOpen(true)}
                className="h-8 text-xs"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Ajouter un enseignant
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Aucun enseignant trouvé. Cliquez sur « Ajouter un enseignant » pour
            enregistrer un membre du personnel comme enseignant.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <Card
              key={t.id}
              className="p-4 space-y-3 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    {t.firstName} {t.lastName}
                  </h3>
                  <p className="text-xs text-muted-foreground">{t.position}</p>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {t.code}
                </Badge>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <School className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>
                    <strong>Classes principales :</strong>{" "}
                    {t.homeroomClasses.length > 0 ? (
                      <span className="text-foreground font-medium">
                        {t.homeroomClasses.join(", ")}
                      </span>
                    ) : (
                      "Non assigné"
                    )}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                <StatusChip
                  label={
                    TEACHER_STATUS_LABELS_FR[
                      t.status as keyof typeof TEACHER_STATUS_LABELS_FR
                    ] ?? "Actif"
                  }
                  tone="success"
                />
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setAssignModalTarget(t);
                      setSelectedClassId("");
                    }}
                  >
                    <UserCheck className="h-3.5 w-3.5 mr-1" />
                    Assigner à une classe
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal: Assign teacher to a class */}
      {assignModalTarget && (
        <UnifiedModal
          open={!!assignModalTarget}
          onOpenChange={(o) => !o && setAssignModalTarget(null)}
          size="md"
          icon={UserCheck}
          iconTone="primary"
          title={`Assigner ${assignModalTarget.firstName} ${assignModalTarget.lastName} à une classe`}
          description="Désignez cet enseignant comme responsable principal ou enseignant de matière."
          submitLabel="Valider l'affectation"
          onSubmit={handleAssignSubmit}
        >
          <div className="space-y-4">
            <FormField label="Rôle pédagogique" required>
              <Select
                value={assignmentType}
                onValueChange={(v) =>
                  setAssignmentType(v as "homeroom" | "subject")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="homeroom">
                    Enseignant principal (Responsable de classe)
                  </SelectItem>
                  <SelectItem value="subject">Enseignant de matière</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Classe à assigner" required>
              <Select
                value={selectedClassId}
                onValueChange={setSelectedClassId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une classe…" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({LEVEL_LABELS_FR[c.level]} -{" "}
                      {GRADE_LEVEL_LABELS_FR[c.gradeCode]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {assignmentType === "subject" && (
              <FormField label="Matière enseignée" required>
                <Select
                  value={selectedSubjectId}
                  onValueChange={setSelectedSubjectId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir la matière…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allSubjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.code}) · Coef. {s.coefficient}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </div>
        </UnifiedModal>
      )}

      {/* Modal: Add/Register teacher from Personnel */}
      {addTeacherModalOpen && (
        <UnifiedModal
          open={addTeacherModalOpen}
          onOpenChange={setAddTeacherModalOpen}
          size="md"
          icon={Plus}
          iconTone="primary"
          title="Ajouter un enseignant"
          description="Sélectionnez un membre du personnel pour lui créer un profil enseignant."
          submitLabel="Créer le profil enseignant"
          onSubmit={handleAddTeacherSubmit}
        >
          <div className="space-y-3">
            <FormField label="Membre du personnel" required>
              <Select
                value={selectedPersonnelId}
                onValueChange={setSelectedPersonnelId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un collaborateur…" />
                </SelectTrigger>
                <SelectContent>
                  {personnel.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} (
                      {p.position || p.staffCategory})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
        </UnifiedModal>
      )}
    </div>
  );
}