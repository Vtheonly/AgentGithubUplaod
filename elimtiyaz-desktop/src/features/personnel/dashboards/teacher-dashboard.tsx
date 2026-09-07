/**
 * Teacher dashboard — pedagogical workspace (Personnel module).
 *
 * Teachers do ALL their pedagogical work from the Personnel dashboard and
 * never switch to the Student or Pédagogie administrative modules.
 *
 * T-235 / RBAC-301 (35th session): this workspace is now STRICTLY
 * self-contained. The previous version navigated to the administrative
 * screens (`/academics/class/:id` exposed the promotion button and the
 * full class-management tabs; `/academics/class/:id/roll-call` left the
 * Personnel module). Roll-call and grade entry now open as full-screen
 * overlays INSIDE this dashboard — the teacher selects a class, performs
 * the work, and stays in Personnel the whole time. With T-234 the
 * teacher role no longer holds the module-entry permissions, so the
 * sidebar shows CRM/Pédagogie/Finances as padlocked.
 *
 * Scoped data: `myClasses` lists ONLY the classes whose homeroom teacher
 * is the signed-in teacher's own personnel record. An unlinked account
 * (no personnel row) sees ZERO classes — never the full catalog (the
 * previous `me === null` fallback showed every class in the school).
 */
import { useMemo, useState } from "react";
import { GraduationCap, Users, BookOpen, ClipboardCheck, Plus, BookMarked, X } from "lucide-react";
import { z } from "zod";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../../shared/ui/auto-form";
import { Button } from "../../../shared/ui/button";
import { StatusChip } from "../../../shared/ui/status-chip";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import { RollCallScreen } from "../../academics/roll-call-screen";
import { GradeEntryScreen } from "../../academics/grade-entry-screen";
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

/** Which in-module workflow overlay is open (T-235). */
type Overlay =
  | { kind: "roll-call"; classId: string }
  | { kind: "grades"; classId: string; subjectId: string }
  | { kind: "subject-picker"; classId: string };

export function TeacherDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);

  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  // Resolve the teacher's own personnel record via the auth→personnel
  // userId bridge.
  const me = useObservable(
    () => repos.personnel.observeByUserId(session?.userId ?? ""),
    [session?.userId],
  );
  const teacherId = me?.id ?? session?.userId ?? "";

  // T-235: STRICT scoping — only the classes homeroom-assigned to THIS
  // teacher's personnel record. An unlinked account (me === null) sees
  // NOTHING (the previous fallback showed the entire school's classes).
  const myClasses = useMemo(
    () => classes.filter((c) => me !== null && c.homeroomTeacherId === me.id),
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

  // Tasks = roll-call for each class with students enrolled — performed
  // INSIDE the Personnel workspace (T-235: no navigation).
  const tasks: readonly DashboardTask[] = myClasses.map((c) => ({
    id: c.id,
    label: `Faire l'appel — ${c.name}`,
    description: `${c.enrolledCount} élèves inscrits`,
    onClick: () => setOverlay({ kind: "roll-call", classId: c.id }),
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

  // Subjects offered for grade entry of a given class = the subjects
  // assigned to that class (class-subject assignments). The observable is
  // queried with the picked class id ("" while no picker is open → an
  // empty assignment list, harmless); an empty assignment list falls
  // back to the full catalog (a class may not have assignments yet).
  const pickerClassId = overlay?.kind === "subject-picker" ? overlay.classId : "";
  const classSubjects = useObservable(
    () => repos.subjects.observeByClass(pickerClassId),
    [pickerClassId],
  );
  const pickerSubjects = useMemo(() => {
    const assignedIds = new Set(classSubjects.map((cs) => cs.subjectId));
    const assigned = subjects.filter((s) => assignedIds.has(s.id));
    return assigned.length > 0 ? assigned : subjects;
  }, [classSubjects, subjects]);

  const overlayClass = overlay
    ? myClasses.find((c) => c.id === overlay.classId)
    : undefined;

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
          {me === null ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Votre compte n'est pas encore rattaché à une fiche enseignant. Contactez l'administrateur pour activer votre espace pédagogique.
            </p>
          ) : myClasses.length === 0 ? (
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOverlay({ kind: "roll-call", classId: c.id })}
                      >
                        <ClipboardCheck className="size-3.5 mr-1" /> Appel
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOverlay({ kind: "subject-picker", classId: c.id })}
                      >
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

      {overlay?.kind === "subject-picker" && (
        <UnifiedModal
          open
          onOpenChange={(open: boolean) => { if (!open) setOverlay(null); }}
          title={`Saisie des notes — ${overlayClass?.name ?? "Classe"}`}
          description="Choisissez la matière à évaluer. La saisie reste dans votre espace Personnel."
          hideSubmit
          hideCancel
          size="md"
        >
          <div className="max-h-[50vh] overflow-y-auto space-y-1.5 pr-1">
            {pickerSubjects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Aucune matière disponible. Contactez le responsable pédagogique.
              </p>
            ) : (
              pickerSubjects.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setOverlay({ kind: "grades", classId: overlay.classId, subjectId: s.id })}
                  className="w-full flex items-center justify-between rounded-md border px-3 py-2 text-sm text-left hover:bg-accent/10 transition-colors"
                >
                  <span className="font-medium truncate">{s.name}</span>
                  <span className="text-xs text-muted-foreground">Coef. {s.coefficient}</span>
                </button>
              ))
            )}
          </div>
        </UnifiedModal>
      )}

      {(overlay?.kind === "roll-call" || overlay?.kind === "grades") && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-surface-background"
          role="dialog"
          aria-modal="true"
          aria-label={overlay.kind === "roll-call" ? "Appel" : "Saisie des notes"}
        >
          {/* T-235: the in-module workspace chrome. The embedded screen's
              own header/actions remain; this close affordance guarantees an
              exit even when the screen renders its not-found branch. */}
          <div className="flex items-center justify-between border-b border-border bg-surface-panel px-4 py-2 shrink-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Mon espace · {overlay.kind === "roll-call" ? "Appel" : "Notes"}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setOverlay(null)}>
              <X className="h-4 w-4" /> Fermer
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            {overlay.kind === "roll-call" ? (
              <RollCallScreen classId={overlay.classId} onExit={() => setOverlay(null)} />
            ) : (
              <GradeEntryScreen
                classId={overlay.classId}
                subjectId={overlay.subjectId}
                onExit={() => setOverlay(null)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
