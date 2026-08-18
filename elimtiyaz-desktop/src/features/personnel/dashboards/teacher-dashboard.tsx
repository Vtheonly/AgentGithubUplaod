/**
 * Teacher dashboard — pedagogical workspace.
 *
 * Teachers do ALL their pedagogical work from the Personnel dashboard and
 * never switch to the Student module.
 *
 * Refactored to consume `<RoleDashboardLayout>` (KPI row + class cards feed
 * + homework feed) and `<AutoFormModal>` (assign-homework form). The
 * previous `teacher-dashboard/` subfolder with mini-modals for taking
 * attendance and entering grades is replaced by direct navigation to the
 * canonical full-screen workflows `RollCallScreen` and `GradeEntryScreen`,
 * which are built for dynamic 30+ student rosters.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Users, BookOpen, ClipboardCheck, Plus, BookMarked } from "lucide-react";
import { z } from "zod";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../../shared/ui/auto-form";
import { Button } from "../../../shared/ui/button";
import { StatusChip } from "../../../shared/ui/status-chip";
import {
  RoleDashboardLayout,
  type DashboardKpi,
  type DashboardTask,
  type DashboardFeedItem,
} from "./role-dashboard-layout";

const HomeworkSchema = z.object({
  classId: z.string().min(1, "Classe requise"),
  subjectId: z.string().min(1, "Matière requise"),
  title: z.string().min(3, "Titre requis (min. 3 caractères)"),
  dueDate: z.string().min(4, "Date limite requise"),
  description: z.string().optional().default(""),
});

type HomeworkFormData = z.infer<typeof HomeworkSchema>;

export function TeacherDashboard() {
  const navigate = useNavigate();
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);

  const [homeworkOpen, setHomeworkOpen] = useState(false);

  // Resolve the teacher's own personnel record via the auth→personnel
  // userId bridge.
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

  const totalStudents = useMemo(
    () => myClasses.reduce((sum, c) => sum + c.enrolledCount, 0),
    [myClasses],
  );

  async function handleAssignHomework(data: HomeworkFormData) {
    const res = await repos.homework.push({
      classId: data.classId,
      subjectId: data.subjectId,
      teacherId,
      teacherName: session?.displayName ?? "Enseignant",
      title: data.title,
      description: data.description ?? "",
      dueDate: data.dueDate,
      attachments: [],
    });
    if (res.ok) {
      toast.showSuccess("Devoir publié", "Les élèves et parents ont été notifiés.");
      setHomeworkOpen(false);
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  const kpis: readonly DashboardKpi[] = [
    { label: "Mes classes", value: myClasses.length, icon: GraduationCap },
    { label: "Mes élèves", value: totalStudents, icon: Users },
    { label: "Devoirs à noter", value: myHomework.length, icon: BookOpen, trend: myHomework.length > 0 ? "À corriger" : undefined },
    { label: "Appel à faire", value: myClasses.length, icon: ClipboardCheck, trend: myClasses.length > 0 ? "À traiter" : undefined },
  ];

  // Tasks = roll-call for each class with students enrolled
  const tasks: readonly DashboardTask[] = myClasses.map((c) => ({
    id: c.id,
    label: `Faire l'appel — ${c.name}`,
    description: `${c.enrolledCount} élèves inscrits`,
    onClick: () => navigate(`/academics/class/${c.id}/roll-call`),
  }));

  // Feed = recent homework
  const feed: readonly DashboardFeedItem[] = myHomework.slice(0, 5).map((h) => ({
    id: h.id,
    label: h.title,
    description: `${h.subjectName} — À rendre le ${h.dueDate} · ${h.acknowledgedCount} élève(s) informé(s)`,
    timestamp: h.pushedAt ? "Publié" : "Brouillon",
    icon: BookOpen,
  }));

  const homeworkFields: readonly AutoFormField[] = [
    {
      name: "classId", label: "Classe", type: "select", required: true,
      options: myClasses.map((c) => ({ label: c.name, value: c.id })),
    },
    {
      name: "subjectId", label: "Matière", type: "select", required: true,
      options: subjects.map((s) => ({ label: s.name, value: s.id })),
    },
    { name: "title", label: "Titre du devoir", type: "text", required: true, wide: true, placeholder: "Ex. Devoir Chapitre 5" },
    { name: "dueDate", label: "Date de rendu", type: "date", required: true },
    { name: "description", label: "Consignes", type: "textarea", wide: true, placeholder: "Précisez les attentes…" },
  ];

  return (
    <>
      <RoleDashboardLayout
        role="Enseignant"
        actorName={session?.displayName ?? "Enseignant"}
        kpis={kpis}
        tasks={tasks}
        feed={feed}
        actions={[
          { label: "Nouveau devoir", icon: Plus, variant: "default", onClick: () => setHomeworkOpen(true) },
        ]}
      >
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Mes classes affectées</h3>
          {myClasses.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aucune classe ne vous est affectée. Contactez le responsable pédagogique.
            </p>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {myClasses.map((c) => (
                <div key={c.id} className="rounded-lg border p-3 flex flex-col justify-between space-y-3">
                  <div>
                    <p className="font-semibold text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground">Salle : {c.room ?? "—"} · {c.enrolledCount} élèves</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <StatusChip label={`${c.enrolledCount}/${c.capacity ?? "∞"}`} tone="neutral" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/academics/class/${c.id}/roll-call`)}>
                        <ClipboardCheck className="size-3.5 mr-1" /> Appel
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/academics/class/${c.id}`)}>
                        <BookMarked className="size-3.5 mr-1" /> Notes
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </RoleDashboardLayout>

      <AutoFormModal
        open={homeworkOpen}
        onOpenChange={setHomeworkOpen}
        title="Donner un devoir"
        description="Le devoir sera envoyé aux portails des élèves et parents."
        schema={HomeworkSchema}
        fields={homeworkFields}
        onSubmit={handleAssignHomework}
        submitLabel="Publier le devoir"
      />
    </>
  );
}
