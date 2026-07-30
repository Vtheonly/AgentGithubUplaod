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
 */
import { useEffect, useMemo, useState } from "react";
import {
  GraduationCap, Users, BookOpen, ClipboardCheck, Plus,
  CheckCircle2, BookMarked, MessageSquare, Send,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import {
  type AttendanceStatus,
  type AttendanceSession,
  type AcademicClass,
  type Subject,
} from "../../../domain/model/academic";
import { StatusChip } from "../../../shared/ui/status-chip";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Textarea } from "../../../shared/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import {
  DashboardGrid, DashboardKpiRow, DashboardSection, KpiCard,
} from "./dashboard-primitives";

const todayIso = () => new Date().toISOString().slice(0, 10);
const ACADEMIC_YEAR = "2025-2026";

interface ParentComm {
  id: string;
  parent: string;
  student: string;
  subject: string;
  at: string;
}

const SEED_PARENT_COMMS: ParentComm[] = [
  { id: "pc-001", parent: "Mme Benali", student: "Yacine Benali", subject: "Devoir non rendu", at: "Hier · 16:42" },
  { id: "pc-002", parent: "M. Hadj Ali", student: "Lina Hadj Ali", subject: "Question sur le programme", at: "Lun · 09:15" },
  { id: "pc-003", parent: "Mme Cherif", student: "Sami Cherif", subject: "Absence prévue vendredi", at: "Mar · 11:08" },
];

export function TeacherDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

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

/* -------------------- Class details drawer -------------------- */

function ClassDetailsDrawer({
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

/* -------------------- Assign homework -------------------- */

function AssignHomeworkModal({
  open, onOpenChange, classes, subjects, teacherId, teacherName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: readonly AcademicClass[];
  subjects: readonly Subject[];
  teacherId: string;
  teacherName: string;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => { if (open && classes[0] && !classId) setClassId(classes[0].id); }, [open, classes, classId]);

  async function handleSubmit() {
    if (!title.trim() || !classId || !subjectId || !dueDate) {
      toast.showWarning("Champs requis", "Classe, matière, titre et date sont obligatoires.");
      return;
    }
    const result = await repos.homework.push({
      classId, subjectId, teacherId, teacherName,
      title: title.trim(), description: description.trim(),
      dueDate, attachments: [],
    });
    if (result.ok) {
      toast.showSuccess("Devoir publié", "Les élèves et parents ont été notifiés.");
      setTitle(""); setDescription(""); setDueDate("");
      onOpenChange(false);
    } else {
      toast.showError("Erreur", "Impossible de publier le devoir.");
    }
  }

  return (
    <UnifiedModal
      open={open} onOpenChange={onOpenChange}
      title="Donner un devoir" description="Sera publié aux élèves et parents."
      icon={Plus} size="md"
      submitLabel="Publier" submitIcon={Send} onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Classe</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Matière</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
              <SelectContent>
                {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hw-title">Titre</Label>
          <Input id="hw-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hw-desc">Description</Label>
          <Textarea id="hw-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hw-due">À rendre le</Label>
          <Input id="hw-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
    </UnifiedModal>
  );
}

/* -------------------- Take attendance -------------------- */

const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string; tone: "success" | "warning" | "danger" | "info" }[] = [
  { value: "present", label: "Présent", tone: "success" },
  { value: "late", label: "Retard", tone: "warning" },
  { value: "absent_excused", label: "Abs. excusée", tone: "info" },
  { value: "absent_unexcused", label: "Abs. non excusée", tone: "danger" },
];

function TakeAttendanceModal({
  open, onOpenChange, classId, classes, recordedBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  classes: readonly AcademicClass[];
  recordedBy: string;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const students = useObservable(
    () => classId ? repos.students.observeByClass(classId) : repos.students.observeByClass(""),
    [classId],
  );
  const [statuses, setStatuses] = useState<Map<string, AttendanceStatus>>(new Map());
  const [session, setSession] = useState<AttendanceSession>("morning");

  useEffect(() => {
    if (open && students.length > 0) {
      setStatuses(new Map(students.map((s) => [s.id, "present" as AttendanceStatus])));
    }
  }, [open, students]);

  const cls = classes.find((c) => c.id === classId);

  async function handleSubmit() {
    if (!cls) return;
    const result = await repos.attendance.recordRollCall({
      classId, date: todayIso(), session, statuses: statuses as ReadonlyMap<string, AttendanceStatus>, recordedBy,
    });
    if (result.ok) {
      toast.showSuccess("Appel enregistré", `${students.length} élève(s) pointé(s).`);
      onOpenChange(false);
    } else {
      toast.showError("Erreur", "Impossible d'enregistrer l'appel.");
    }
  }

  return (
    <UnifiedModal
      open={open} onOpenChange={onOpenChange}
      title={`Faire l'appel — ${cls?.name ?? ""}`}
      description={todayIso()}
      icon={ClipboardCheck} size="lg"
      submitLabel="Enregistrer" submitIcon={CheckCircle2} onSubmit={handleSubmit}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Session :</Label>
          <Select value={session} onValueChange={(v) => setSession(v as AttendanceSession)}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="morning">Matin</SelectItem>
              <SelectItem value="afternoon">Après-midi</SelectItem>
              <SelectItem value="both">Les deux</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève dans cette classe.</p>
        ) : (
          <ul className="divide-y divide-border">
            {students.map((s) => {
              const cur = statuses.get(s.id) ?? "present";
              return (
                <li key={s.id} className="py-2 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{s.firstName} {s.lastName}</p>
                  </div>
                  <Select value={cur} onValueChange={(v) => {
                    setStatuses((m) => new Map(m).set(s.id, v as AttendanceStatus));
                  }}>
                    <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ATTENDANCE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </UnifiedModal>
  );
}

/* -------------------- Enter grades -------------------- */

type AssessmentType = "devoir1" | "devoir2" | "examen";

function EnterGradesModal({
  open, onOpenChange, classId, classes, subjects, enteredBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  classes: readonly AcademicClass[];
  subjects: readonly Subject[];
  enteredBy: string;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const students = useObservable(
    () => classId ? repos.students.observeByClass(classId) : repos.students.observeByClass(""),
    [classId],
  );
  const [subjectId, setSubjectId] = useState("");
  const [assessType, setAssessType] = useState<AssessmentType>("devoir1");
  const [grades, setGrades] = useState<Map<string, string>>(new Map());

  useEffect(() => { setGrades(new Map()); }, [open, classId, assessType, subjectId]);

  const cls = classes.find((c) => c.id === classId);
  const subject = subjects.find((s) => s.id === subjectId);

  async function handleSubmit() {
    if (!cls || !subject) {
      toast.showWarning("Sélection incomplète", "Choisissez une matière.");
      return;
    }
    let count = 0;
    for (const [studentId, raw] of grades) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 20) continue;
      const base = {
        studentId, subjectId: subject.id, classId, term: "T1" as const, academicYear: ACADEMIC_YEAR,
        devoir1: null as number | null, devoir2: null as number | null, examen: null as number | null,
        coefficient: subject.coefficient, enteredBy,
      };
      const input = assessType === "devoir1" ? { ...base, devoir1: value }
        : assessType === "devoir2" ? { ...base, devoir2: value }
        : { ...base, examen: value };
      const res = await repos.grades.enterGrade(input);
      if (res.ok) count++;
    }
    if (count > 0) {
      toast.showSuccess("Notes enregistrées", `${count} note(s) saisie(s).`);
      onOpenChange(false);
    } else {
      toast.showWarning("Aucune note valide", "Vérifiez les valeurs (0 à 20).");
    }
  }

  return (
    <UnifiedModal
      open={open} onOpenChange={onOpenChange}
      title={`Saisir des notes — ${cls?.name ?? ""}`}
      description={todayIso()}
      icon={BookMarked} size="lg"
      submitLabel="Enregistrer" submitIcon={CheckCircle2} onSubmit={handleSubmit}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Matière</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
              <SelectContent>
                {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Type d'évaluation</Label>
            <Select value={assessType} onValueChange={(v) => setAssessType(v as AssessmentType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="devoir1">Devoir 1</SelectItem>
                <SelectItem value="devoir2">Devoir 2</SelectItem>
                <SelectItem value="examen">Examen</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève.</p>
        ) : (
          <ul className="divide-y divide-border">
            {students.map((s) => (
              <li key={s.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{s.firstName} {s.lastName}</p>
                </div>
                <Input
                  type="number" min={0} max={20} step={0.5}
                  className="h-8 w-24"
                  placeholder="0-20"
                  value={grades.get(s.id) ?? ""}
                  onChange={(e) => setGrades((m) => new Map(m).set(s.id, e.target.value))}
                />
                <span className="text-xs text-muted-foreground">/20</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </UnifiedModal>
  );
}
