import { useState } from "react";
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
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  GRADE_LEVEL_LABELS_FR,
  LEVEL_LABELS_FR,
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
import { Permission } from "../../core/rbac/permissions";
import { ClassSubjectsTab } from "./class-subjects-tab";
import { ClassAttendanceTab } from "./class-attendance-tab";
import { ClassGradesTab } from "./class-grades-tab";
import { NarrativeGeneratorButton } from "./narrative-generator-modal";
import { HomeworkPushModal } from "./homework-push-modal";
import { BatchPromotionModal } from "./batch-promotion-modal";

/** Sentinel while no subject is selected (Radix forbids empty values). */
const NO_SUBJECT = "__pick__";

export function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const repos = useRepositories();
  const { session } = useAuth();

  const cls = useObservable(
    () => repos.classes.observeById(classId ?? ""),
    [classId],
  );
  const students = useObservable(
    () => repos.students.observeByClass(classId ?? ""),
    [classId],
  );
  const classSubjects = useObservable(
    () => repos.subjects.observeByClass(classId ?? ""),
    [classId],
  );
  const allSubjects = useObservable(() => repos.subjects.observe(), []);

  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  // FIX (unreachable grade entry): the `/grades/:subjectId` route existed
  // but NO UI ever navigated to it — grades could never be entered. This
  // subject picker + "Saisir" button in the class toolbar is the entry point.
  const [gradeSubject, setGradeSubject] = useState<string>(NO_SUBJECT);

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

  const canRollCall = !!session && session.permissions.has(Permission.RollCall);
  const canGrade = !!session && session.permissions.has(Permission.EnterGrades);
  const canHomework =
    !!session && session.permissions.has(Permission.AssignHomework);
  const canPromote =
    !!session && session.permissions.has(Permission.PromoteStudent);

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

      {/* Class Notes Banner (if configured) */}
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

        {/* FIX (grade entry entry-point): subject picker + Saisir button —
            previously the GradeEntryScreen route was unreachable. */}
        <div className="flex items-center gap-1.5">
          <Select
            value={gradeSubject}
            onValueChange={setGradeSubject}
            disabled={!canGrade || classSubjects.length === 0}
          >
            <SelectTrigger className="h-8 w-52 text-xs">
              <SelectValue placeholder="Matière à évaluer…" />
            </SelectTrigger>
            <SelectContent>
              {classSubjects.map((cs) => {
                const subj = allSubjects.find((s) => s.id === cs.subjectId);
                return (
                  <SelectItem key={cs.subjectId} value={cs.subjectId}>
                    {subj?.name ?? cs.subjectId}
                    {cs.coefficient ? ` (coef. ${cs.coefficient})` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!canGrade || gradeSubject === NO_SUBJECT}
            onClick={() =>
              navigate(`/academics/class/${classId}/grades/${gradeSubject}`)
            }
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
          <PageTab value="subjects" label="Matières" icon={BookOpen} />
          <PageTab value="attendance" label="Présences" icon={Calendar} />
          <PageTab value="grades" label="Notes" icon={GraduationCap} />
        </PageTabList>

        <PageTabContent value="students">
          <Card>
            <CardContent className="p-0">
              <div className="border-b border-border p-3 flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  <strong className="text-primary">{students.length}</strong>{" "}
                  élève(s) inscrit(s) dans cette classe
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    Salle : {cls.room ?? "Non assignée"}
                  </Badge>
                  <Badge variant="outline">
                    Enseignant principal :{" "}
                    {cls.homeroomTeacherName ?? "Non désigné"}
                  </Badge>
                </div>
              </div>
              <ul className="divide-y divide-border">
                {students.map((s) => (
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
                    <NarrativeGeneratorButton student={s} classId={classId!} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!canGrade}
                      onClick={() =>
                        navigate(`/academics/class/${classId}/grades/${gradeSubject !== NO_SUBJECT ? gradeSubject : ""}`)
                      }
                      title={
                        gradeSubject === NO_SUBJECT
                          ? "Choisissez d'abord une matière dans la barre d'actions"
                          : "Saisir / modifier les notes de cet élève"
                      }
                    >
                      <GraduationCap className="h-3.5 w-3.5" />
                    </Button>
                    <StatusChip
                      label={s.status === "active" ? "Actif" : s.status}
                      tone={s.status === "active" ? "success" : "neutral"}
                    />
                  </li>
                ))}
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
    </div>
  );
}
