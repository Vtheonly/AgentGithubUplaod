// ============================================================================
// FILE: src/features/academics/class-detail-page.tsx
// ============================================================================
import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ClipboardCheck,
  GraduationCap,
  BookOpen,
  Users,
  Calendar,
  Award,
  StickyNote,
  UserCheck,
  UserPlus,
  Pencil,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { can } from "../../core/rbac/session";
import {
  GRADE_LEVEL_LABELS_FR,
  LEVEL_LABELS_FR,
  type AcademicLevel,
} from "../../domain/model/student";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import {
  PageTabs,
  PageTabList,
  PageTab,
  PageTabContent,
} from "../../shared/layout/page-tabs";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { Permission } from "../../core/rbac/permissions";
import { ClassSubjectsTab } from "./class-subjects-tab";
import { ClassAttendanceTab } from "./class-attendance-tab";
import { ClassGradesTab } from "./class-grades-tab";
import { NarrativeGeneratorButton } from "./narrative-generator-modal";
import { HomeworkPushModal } from "./homework-push-modal";
import { BatchPromotionModal } from "./batch-promotion-modal";

const NO_SUBJECT = "__pick__";

export function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const cls = useObservable(
    () => repos.classes.observeById(classId ?? ""),
    [classId],
  );
  const students = useObservable(
    () => repos.students.observeByClass(classId ?? ""),
    [classId],
  );
  const allStudents = useObservable(() => repos.students.observe(), []);
  const classSubjects = useObservable(
    () => repos.subjects.observeByClass(classId ?? ""),
    [classId],
  );
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [assignHomeroomOpen, setAssignHomeroomOpen] = useState(false);
  const [editClassOpen, setEditClassOpen] = useState(false);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [selectedStudentToAdd, setSelectedStudentToAdd] = useState("");
  const [selectedHomeroomId, setSelectedHomeroomId] = useState("");
  const [customRoom, setCustomRoom] = useState("");
  const [classNameInput, setClassNameInput] = useState("");
  const [classNotesInput, setClassNotesInput] = useState("");
  const [gradeSubject, setGradeSubject] = useState<string>(NO_SUBJECT);

  const eligibleTeachers = useMemo(() => {
    return personnel.filter(
      (p) => p.staffCategory === "teacher" || p.roleId === "teacher",
    );
  }, [personnel]);

  // Available subjects for this level (shown if classSubjects is empty so grade entry is never blocked)
  const availableGradeSubjects = useMemo(() => {
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

  // Students not currently in this class
  const unassignedStudents = useMemo(() => {
    return allStudents.filter(
      (s) => s.classId !== classId && s.status === "active",
    );
  }, [allStudents, classId]);

  if (!cls) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Classe introuvable" />
        <Button
          variant="outline"
          onClick={() => navigate("/academics")}
          className="mx-6 w-fit"
        >
          <ArrowLeft className="h-4 w-4" /> Retour aux classes
        </Button>
      </div>
    );
  }

  const canRollCall = can(session, Permission.RollCall);
  const canGrade = can(session, Permission.EnterGrades);
  const canHomework = can(session, Permission.AssignHomework);
  const canPromote = can(session, Permission.PromoteStudent);
  const canManageClass = can(session, Permission.ManageClasses);

  async function handleSaveHomeroom() {
    if (!cls) return;
    const teacher = eligibleTeachers.find((t) => t.id === selectedHomeroomId);
    const result = await repos.classes.updateClass(cls.id, {
      homeroomTeacherId:
        selectedHomeroomId === "__none__"
          ? null
          : selectedHomeroomId || cls.homeroomTeacherId,
      homeroomTeacherName:
        selectedHomeroomId === "__none__"
          ? null
          : teacher
            ? `${teacher.firstName} ${teacher.lastName}`
            : cls.homeroomTeacherName,
      room: customRoom.trim() || cls.room,
    });

    if (result.ok) {
      toast.showSuccess(
        "Enseignant principal assigné",
        `${teacher ? `${teacher.firstName} ${teacher.lastName}` : "Non désigné"} est responsable de ${cls.name}.`,
      );
      setAssignHomeroomOpen(false);
    } else {
      toast.showError("Échec", result.error.userMessage);
    }
  }

  async function handleSaveClassDetails() {
    if (!cls) return;
    const result = await repos.classes.updateClass(cls.id, {
      name: classNameInput.trim() || cls.name,
      room: customRoom.trim() || cls.room,
      notes: classNotesInput.trim() || null,
    });

    if (result.ok) {
      toast.showSuccess(
        "Classe mise à jour",
        "Les détails de la classe ont été modifiés.",
      );
      setEditClassOpen(false);
    } else {
      toast.showError("Échec", result.error.userMessage);
    }
  }

  async function handleAddStudentToClass() {
    if (!selectedStudentToAdd || !classId || !cls) return;
    const stu = allStudents.find((s) => s.id === selectedStudentToAdd);
    if (!stu) return;

    const result = await repos.students.updateStudent(stu.id, {
      classId: classId,
    });

    if (result.ok) {
      toast.showSuccess(
        "Élève ajouté",
        `${stu.firstName} ${stu.lastName} a été affecté(e) à ${cls.name}.`,
      );
      setAddStudentOpen(false);
      setSelectedStudentToAdd("");
    } else {
      toast.showError("Échec", result.error.userMessage);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={cls.name}
        description={`Niveau : ${GRADE_LEVEL_LABELS_FR[cls.gradeCode] ?? cls.gradeCode} (${LEVEL_LABELS_FR[cls.level]}) · Année ${cls.academicYear}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/academics")}
          >
            <ArrowLeft className="h-4 w-4" /> Retour aux classes
          </Button>
        }
      />

      {cls.notes && (
        <div className="mx-6 mb-3 bg-muted/20 border border-border p-3 rounded-lg flex items-start gap-2.5 text-xs text-muted-foreground">
          <StickyNote className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-foreground mr-1">
              Notes de la classe :
            </span>
            <span>{cls.notes}</span>
          </div>
        </div>
      )}

      {/* Action Toolbar */}
      <div className="flex flex-wrap gap-2 px-6 pb-3 items-center">
        <Button
          variant="outline"
          size="sm"
          disabled={!canRollCall}
          onClick={() => navigate(`/academics/class/${classId}/roll-call`)}
        >
          <ClipboardCheck className="h-4 w-4" /> Appel (30 sec)
        </Button>

        {/* Grade Entry selector & button — always populated with available subjects */}
        <div className="flex items-center gap-1.5">
          <Select
            value={gradeSubject}
            onValueChange={setGradeSubject}
            disabled={!canGrade || availableGradeSubjects.length === 0}
          >
            <SelectTrigger className="h-8 w-56 text-xs">
              <SelectValue placeholder="Choisir une matière à noter…" />
            </SelectTrigger>
            <SelectContent>
              {availableGradeSubjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} {s.code ? `(${s.code})` : ""} · Coef. {s.coefficient}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!canGrade || gradeSubject === NO_SUBJECT}
            onClick={() => {
              if (gradeSubject && gradeSubject !== NO_SUBJECT) {
                navigate(`/academics/class/${classId}/grades/${gradeSubject}`);
              }
            }}
          >
            <GraduationCap className="h-4 w-4" /> Saisir des notes
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={!canHomework}
          onClick={() => setHomeworkOpen(true)}
        >
          <BookOpen className="h-4 w-4" /> Diffuser un devoir
        </Button>

        {canManageClass && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedHomeroomId(cls.homeroomTeacherId ?? "__none__");
              setCustomRoom(cls.room ?? "");
              setAssignHomeroomOpen(true);
            }}
          >
            <UserCheck className="h-4 w-4" /> Assigner Enseignant Principal
          </Button>
        )}

        {canPromote && (
          <Button
            variant="default"
            size="sm"
            onClick={() => setPromotionOpen(true)}
          >
            <Award className="h-4 w-4" /> Passage d'année (Batch Promotion)
          </Button>
        )}
      </div>

      <PageTabs
        defaultValue="students"
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList>
          <PageTab
            value="students"
            label="Élèves"
            icon={Users}
            count={students.length}
          />
          <PageTab
            value="subjects"
            label="Matières"
            icon={BookOpen}
            count={classSubjects.length}
          />
          <PageTab value="attendance" label="Présences" icon={Calendar} />
          <PageTab value="grades" label="Notes" icon={GraduationCap} />
        </PageTabList>

        <PageTabContent value="students">
          <Card>
            <CardContent className="p-0">
              <div className="border-b border-border p-3 flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-medium text-foreground">
                  <strong className="text-primary">{students.length}</strong>{" "}
                  élève(s) inscrit(s) dans cette classe
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">
                    Salle : {cls.room ?? "Non assignée"}
                  </Badge>
                  <Badge
                    variant="default"
                    className="bg-primary/10 text-primary border-primary/20"
                  >
                    Enseignant principal :{" "}
                    {cls.homeroomTeacherName ?? "Non désigné"}
                  </Badge>
                  {canManageClass && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setSelectedStudentToAdd("");
                          setAddStudentOpen(true);
                        }}
                      >
                        <UserPlus className="h-3 w-3 mr-1" /> Ajouter un élève
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-primary"
                        onClick={() => {
                          setClassNameInput(cls.name);
                          setCustomRoom(cls.room ?? "");
                          setClassNotesInput(cls.notes ?? "");
                          setEditClassOpen(true);
                        }}
                      >
                        <Pencil className="h-3 w-3 mr-1" /> Modifier la classe
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <ul className="divide-y divide-border">
                {students.length === 0 ? (
                  <li className="p-6 text-center text-xs text-muted-foreground">
                    Aucun élève affecté à cette classe. Utilisez « Ajouter un
                    élève » pour inscrire des élèves.
                  </li>
                ) : (
                  students.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-3 p-3 hover:bg-accent/5"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback>
                          {s.firstName[0]}
                          {s.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">
                            {s.firstName} {s.lastName}
                          </p>
                          <span className="font-mono text-xs text-muted-foreground">
                            {s.code}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Né(e) le {s.birthDate}
                          {s.medicalNotes &&
                            ` · Notes médicales : ${s.medicalNotes}`}
                        </p>
                      </div>
                      <NarrativeGeneratorButton
                        student={s}
                        classId={classId!}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!canGrade}
                        onClick={() => {
                          const targetSubj =
                            gradeSubject && gradeSubject !== NO_SUBJECT
                              ? gradeSubject
                              : availableGradeSubjects[0]?.id;
                          if (targetSubj) {
                            navigate(
                              `/academics/class/${classId}/grades/${targetSubj}`,
                            );
                          }
                        }}
                        title="Saisir les notes"
                      >
                        <GraduationCap className="h-3.5 w-3.5" />
                      </Button>
                      <StatusChip
                        label={s.status === "active" ? "Actif" : s.status}
                        tone={s.status === "active" ? "success" : "neutral"}
                      />
                    </li>
                  ))
                )}
              </ul>
            </CardContent>
          </Card>
        </PageTabContent>

        <PageTabContent value="subjects">
          <ClassSubjectsTab classId={classId!} />
        </PageTabContent>

        <PageTabContent value="attendance">
          <ClassAttendanceTab classId={classId!} />
        </PageTabContent>

        <PageTabContent value="grades">
          <ClassGradesTab classId={classId!} />
        </PageTabContent>
      </PageTabs>

      <HomeworkPushModal
        open={homeworkOpen}
        onOpenChange={setHomeworkOpen}
        presetClassId={classId}
      />
      <BatchPromotionModal
        classId={classId!}
        open={promotionOpen}
        onOpenChange={setPromotionOpen}
      />

      {/* Modal: Assign Homeroom Teacher */}
      <UnifiedModal
        open={assignHomeroomOpen}
        onOpenChange={setAssignHomeroomOpen}
        size="md"
        icon={UserCheck}
        iconTone="primary"
        title={`Assigner l'enseignant principal — ${cls.name}`}
        description="Désignez l'enseignant responsable de la classe et modifiez la salle attribuée."
        submitLabel="Enregistrer"
        onSubmit={handleSaveHomeroom}
      >
        <div className="space-y-4">
          <FormField label="Enseignant principal" required>
            <Select
              value={selectedHomeroomId}
              onValueChange={setSelectedHomeroomId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un enseignant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  — Aucun enseignant désigné —
                </SelectItem>
                {eligibleTeachers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Salle de classe">
            <Input
              value={customRoom}
              onChange={(e) => setCustomRoom(e.target.value)}
              placeholder="Ex. Salle B12"
            />
          </FormField>
        </div>
      </UnifiedModal>

      {/* Modal: Edit Class Details */}
      <UnifiedModal
        open={editClassOpen}
        onOpenChange={setEditClassOpen}
        size="md"
        icon={Pencil}
        iconTone="primary"
        title={`Modifier les détails — ${cls.name}`}
        description="Modifiez le nom, la salle ou les notes pédagogiques de cette classe."
        submitLabel="Enregistrer les modifications"
        onSubmit={handleSaveClassDetails}
      >
        <div className="space-y-4">
          <FormField label="Nom de la classe" required>
            <Input
              value={classNameInput}
              onChange={(e) => setClassNameInput(e.target.value)}
              placeholder="Ex. 1ère AP - Section A"
            />
          </FormField>

          <FormField label="Salle de classe">
            <Input
              value={customRoom}
              onChange={(e) => setCustomRoom(e.target.value)}
              placeholder="Ex. Salle B12"
            />
          </FormField>

          <FormField label="Notes & Observations">
            <Textarea
              value={classNotesInput}
              onChange={(e) => setClassNotesInput(e.target.value)}
              placeholder="Remarques spécifiques, consignes ou aménagements..."
              rows={3}
            />
          </FormField>
        </div>
      </UnifiedModal>

      {/* Modal: Add Student to Class */}
      <UnifiedModal
        open={addStudentOpen}
        onOpenChange={setAddStudentOpen}
        size="md"
        icon={UserPlus}
        iconTone="primary"
        title={`Ajouter un élève à ${cls.name}`}
        description="Affectez un élève inscrit dans l'établissement à cette classe."
        submitLabel="Ajouter l'élève"
        onSubmit={handleAddStudentToClass}
      >
        <div className="space-y-3">
          <FormField label="Sélectionner l'élève" required>
            <Select
              value={selectedStudentToAdd}
              onValueChange={setSelectedStudentToAdd}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choisir un élève…" />
              </SelectTrigger>
              <SelectContent>
                {unassignedStudents.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.firstName} {s.lastName} ({s.code}) · {s.gradeLevel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </UnifiedModal>
    </div>
  );
}
