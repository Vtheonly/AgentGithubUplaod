/**
 * Teacher dashboard — pedagogical workspace (iteration 8 / 9 auth bridge fix).
 *
 * Teachers do ALL their pedagogical work from the Personnel dashboard and
 * never switch to the Student module. Surfaces:
 *   - KPIs (my classes, my students, homework to grade, attendance to take)
 *   - "My classes" grid — cards filtered by homeroomTeacherId === my personnel id
 *   - Click a class → UnifiedModal drawer with roster / grades / attendance / homework
 *   - "Assign homework" UnifiedModal → repos.homework.push()
 *   - "Take attendance" UnifiedModal → repos.attendance.recordRollCall()
 *   - "Enter grades" UnifiedModal → repos.grades.enterGrade() per student
 *   - Recent homework assigned (repos.homework.observeByTeacher)
 *   - Parent communications (mock 3 entries)
 *
 * Iteration 9: the displayName→personnel match hack is replaced by the new
 * PersonnelRepository.observeByUserId() bridge. The teacher's personnel id
 * feeds all downstream class / homework observables.
 *
 * Task 6-b: the four modals + the class-details drawer have been extracted
 * into the `./teacher-dashboard/` subfolder. This file is now a thin
 * orchestrator that owns the dashboard state and renders the KPI grid +
 * the four sub-components.
 */
import { useMemo, useState } from "react";
import {
  GraduationCap, Users, BookOpen, ClipboardCheck, Plus,
  BookMarked, MessageSquare,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { StatusChip } from "../../../shared/ui/status-chip";
import { Button } from "../../../shared/ui/button";
import {
  DashboardGrid, DashboardKpiRow, DashboardSection, KpiCard,
} from "./dashboard-primitives";
import { SEED_PARENT_COMMS } from "./teacher-dashboard/types";
import { ClassDetailsDrawer } from "./teacher-dashboard/class-details-drawer";
import { AssignHomeworkModal } from "./teacher-dashboard/assign-homework-modal";
import { TakeAttendanceModal } from "./teacher-dashboard/take-attendance-modal";
import { EnterGradesModal } from "./teacher-dashboard/enter-grades-modal";

export function TeacherDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();

  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);

  const [drawerClassId, setDrawerClassId] = useState<string | null>(null);
  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [gradesOpen, setGradesOpen] = useState(false);
  const [activeClassId, setActiveClassId] = useState<string>("");

  // Iteration 9: resolve the teacher's own personnel record via the
  // auth→personnel userId bridge (replaces the displayName string match).
  const me = useObservable(
    () => repos.personnel.observeByUserId(session?.userId ?? ""),
    [session?.userId],
  );
  const teacherId = me?.id ?? session?.userId ?? "";

  const myClasses = useMemo(
    () => classes.filter((c) => me === null || c.homeroomTeacherId === me.id),
    [classes, me],
  );
  const myHomework = useObservable(
    () => repos.homework.observeByTeacher(teacherId),
    [teacherId],
  );

  const drawerClass = useMemo(
    () => classes.find((c) => c.id === drawerClassId) ?? null,
    [classes, drawerClassId],
  );

  function openActionModal(kind: "homework" | "attendance" | "grades", classId: string) {
    setActiveClassId(classId);
    if (kind === "homework") setHomeworkOpen(true);
    else if (kind === "attendance") setAttendanceOpen(true);
    else setGradesOpen(true);
  }

  return (
    <DashboardGrid>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tableau de bord Enseignant</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {me ? me.position : "Vos classes, devoirs, notes et appels."}
          </p>
        </div>
        <div className="flex gap-2">
          {myClasses[0] && (
            <>
              <Button size="sm" variant="outline" onClick={() => openActionModal("attendance", myClasses[0].id)}>
                <ClipboardCheck className="h-4 w-4" /> Faire l'appel
              </Button>
              <Button size="sm" variant="outline" onClick={() => openActionModal("grades", myClasses[0].id)}>
                <BookMarked className="h-4 w-4" /> Saisir des notes
              </Button>
              <Button size="sm" onClick={() => openActionModal("homework", myClasses[0].id)}>
                <Plus className="h-4 w-4" /> Donner un devoir
              </Button>
            </>
          )}
        </div>
      </div>

      <DashboardKpiRow>
        <KpiCard label="Mes classes" value={myClasses.length.toString()} icon={<GraduationCap className="h-5 w-5" />} tone="default" />
        <KpiCard
          label="Mes élèves"
          value={myClasses.reduce((acc, c) => acc + c.enrolledCount, 0).toString()}
          icon={<Users className="h-5 w-5" />}
          tone="info"
        />
        <KpiCard
          label="Devoirs à noter"
          value={myHomework.length.toString()}
          icon={<BookOpen className="h-5 w-5" />}
          tone={myHomework.length > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Appel à faire"
          value={myClasses.length.toString()}
          icon={<ClipboardCheck className="h-5 w-5" />}
          tone={myClasses.length > 0 ? "warning" : "default"}
        />
      </DashboardKpiRow>

      <DashboardSection title="Mes classes" icon={GraduationCap}>
        {myClasses.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucune classe ne vous est affectée. Contactez le responsable pédagogique.
          </p>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {myClasses.map((c) => (
              <button
                key={c.id}
                onClick={() => setDrawerClassId(c.id)}
                className="text-left rounded-lg border border-border p-4 hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">Salle {c.room ?? "—"}</p>
                  </div>
                  <StatusChip label={`${c.enrolledCount}/${c.capacity}`} tone="neutral" />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {c.homeroomTeacherName ?? "—"}
                </p>
              </button>
            ))}
          </div>
        )}
      </DashboardSection>

      <DashboardSection title="Devoirs donnés récemment" icon={BookOpen}>
        {myHomework.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Aucun devoir récent.</p>
        ) : (
          <ul className="divide-y divide-border">
            {myHomework.slice(0, 5).map((hw) => (
              <li key={hw.id} className="py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{hw.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {hw.subjectName} • À rendre le {hw.dueDate} • {hw.acknowledgedCount} élève(s) informé(s)
                  </p>
                </div>
                <StatusChip label={hw.pushedAt ? "Publié" : "Brouillon"} tone={hw.pushedAt ? "success" : "neutral"} />
              </li>
            ))}
          </ul>
        )}
      </DashboardSection>

      <DashboardSection title="Communications parents" icon={MessageSquare}>
        <ul className="divide-y divide-border">
          {SEED_PARENT_COMMS.map((pc) => (
            <li key={pc.id} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">
                  <span className="font-medium">{pc.parent}</span>
                  <span className="text-muted-foreground"> · élève {pc.student}</span>
                </p>
                <p className="text-xs text-muted-foreground truncate">{pc.subject}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{pc.at}</span>
            </li>
          ))}
        </ul>
      </DashboardSection>

      <ClassDetailsDrawer
        cls={drawerClass}
        open={drawerClassId !== null}
        onOpenChange={(o) => { if (!o) setDrawerClassId(null); }}
        onAssignHomework={(id) => openActionModal("homework", id)}
        onTakeAttendance={(id) => openActionModal("attendance", id)}
        onEnterGrades={(id) => openActionModal("grades", id)}
      />

      <AssignHomeworkModal
        open={homeworkOpen}
        onOpenChange={setHomeworkOpen}
        classes={myClasses}
        subjects={subjects}
        teacherId={teacherId}
        teacherName={session?.displayName ?? ""}
      />

      <TakeAttendanceModal
        open={attendanceOpen}
        onOpenChange={setAttendanceOpen}
        classId={activeClassId}
        classes={myClasses}
        recordedBy={session?.userId ?? ""}
      />

      <EnterGradesModal
        open={gradesOpen}
        onOpenChange={setGradesOpen}
        classId={activeClassId}
        classes={myClasses}
        subjects={subjects}
        enteredBy={session?.userId ?? ""}
      />
    </DashboardGrid>
  );
}
