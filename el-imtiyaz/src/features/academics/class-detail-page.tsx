/**
 * ClassDetailPage — 4-tab detail view per plan §05.
 *
 * Tabs: Élèves / Matières / Présences / Notes
 * Quick actions: Appel (RollCall), Notes (GradeEntry), Devoirs (HomeworkPush)
 */
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardCheck, GraduationCap, BookOpen, Users, Calendar } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { LEVEL_LABELS_FR } from "../../domain/model/student";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { StatusChip } from "../../shared/ui/status-chip";
import { Permission } from "../../core/rbac/permissions";
import { ClassSubjectsTab } from "./class-subjects-tab";
import { ClassAttendanceTab } from "./class-attendance-tab";
import { ClassGradesTab } from "./class-grades-tab";
import { NarrativeGeneratorButton } from "./narrative-generator-modal";

export function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const repos = useRepositories();
  const { session } = useAuth();
  const cls = useObservable(() => repos.classes.observeById(classId ?? ""), [classId]);
  const students = useObservable(() => repos.students.observeByClass(classId ?? ""), [classId]);

  if (!cls) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Classe introuvable" />
        <Button variant="outline" onClick={() => navigate("/academics")} className="mx-6 w-fit">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
      </div>
    );
  }

  const canRollCall = !!session && session.permissions.has(Permission.RollCall);
  const canGrade = !!session && session.permissions.has(Permission.EnterGrades);
  const canHomework = !!session && session.permissions.has(Permission.AssignHomework);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={cls.name}
        description={`${LEVEL_LABELS_FR[cls.level]} · Année ${cls.gradeYear} · ${cls.academicYear}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/academics")}>
            <ArrowLeft className="h-4 w-4" /> Retour
          </Button>
        }
      />

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2 px-6 pb-3">
        <Button variant="outline" size="sm" disabled={!canRollCall} onClick={() => navigate(`/academics/class/${classId}/roll-call`)}>
          <ClipboardCheck className="h-4 w-4" /> Appel (30 sec)
        </Button>
        <Button variant="outline" size="sm" disabled={!canGrade}>
          <GraduationCap className="h-4 w-4" /> Saisie des notes
        </Button>
        <Button variant="outline" size="sm" disabled={!canHomework}>
          <BookOpen className="h-4 w-4" /> Diffuser un devoir
        </Button>
      </div>

      <PageTabs defaultValue="students" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="students" label="Élèves" icon={Users} count={students.length} />
          <PageTab value="subjects" label="Matières" icon={BookOpen} />
          <PageTab value="attendance" label="Présences" icon={Calendar} />
          <PageTab value="grades" label="Notes" icon={GraduationCap} />
        </PageTabList>

        <PageTabContent value="students">
          <Card>
            <CardContent className="p-0">
              <div className="border-b border-border p-3 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {students.length} élève(s) inscrits · capacité {cls.capacity}
                </p>
                <Badge variant="outline">Prof principal: {cls.homeroomTeacherName ?? "—"}</Badge>
              </div>
              <ul className="divide-y divide-border">
                {students.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 p-3 hover:bg-accent/5">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback>
                        {s.firstName[0]}{s.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{s.firstName} {s.lastName}</p>
                        <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Né(e) le {s.birthDate}
                        {s.medicalNotes && ` · ⚠ ${s.medicalNotes}`}
                      </p>
                    </div>
                    <NarrativeGeneratorButton student={s} classId={classId!} />
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
    </div>
  );
}
