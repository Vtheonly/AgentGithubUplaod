// ============================================================================
// FILE: src/features/academics/academic-year-detail-drawer.tsx
// ============================================================================
import { useState, useMemo } from "react";
import {
  Calendar,
  Users,
  GraduationCap,
  BookOpen,
  School,
  TrendingUp,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  Star,
  Search,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Layers,
  Plus,
  UserCheck,
} from "lucide-react";
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
import {
  UnifiedModal,
  type UnifiedModalProps,
} from "../../shared/ui/unified-modal";
import { KpiCard } from "../../shared/ui/kpi-card";
import { StatusChip } from "../../shared/ui/status-chip";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import type { AcademicYear } from "../../domain/model/academic";
import {
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS_FR,
  LEVEL_LABELS_FR,
  type AcademicLevel,
} from "../../domain/model/student";
import {
  TEACHER_STATUS_LABELS_FR,
  type TeacherStatus,
} from "../../domain/model/teacher";
import { STAFF_CATEGORY_LABELS_FR } from "../../domain/model/personnel";

type Alert = NonNullable<UnifiedModalProps["alert"]>;
type SubTab = "overview" | "classes" | "teachers" | "subjects" | "settings";

const TERM_STRUCTURE_LABELS: Record<string, string> = {
  semester: "Semestres",
  trimester: "Trimestres",
  quarter: "Quarts",
};

export function AcademicYearDetailDrawer({
  year,
  open,
  onOpenChange,
  canManage,
}: {
  year: AcademicYear;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canManage: boolean;
}) {
  const [subTab, setSubTab] = useState<SubTab>("overview");

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      variant="drawer"
      icon={Calendar}
      iconTone="primary"
      title={year.label}
      description={`${year.code} · ${TERM_STRUCTURE_LABELS[year.termStructure] ?? year.termStructure} · ${year.startDate} → ${year.endDate}`}
      hideSubmit
      cancelLabel="Fermer"
      header={
        <div className="flex items-center gap-2 flex-wrap">
          {year.isCurrent && (
            <Badge className="text-[10px]">
              <Star className="h-3 w-3 mr-1" />
              Année courante
            </Badge>
          )}
          {year.isArchived && (
            <Badge variant="secondary" className="text-[10px]">
              Archivée
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {TERM_STRUCTURE_LABELS[year.termStructure] ?? year.termStructure}
          </Badge>
        </div>
      }
    >
      <div className="flex items-center gap-1 border-b border-border mb-4 overflow-x-auto">
        {(
          [
            { value: "overview", label: "Vue d'ensemble", icon: TrendingUp },
            { value: "classes", label: "Classes", icon: School },
            { value: "teachers", label: "Enseignants", icon: Users },
            { value: "subjects", label: "Matières", icon: BookOpen },
            { value: "settings", label: "Paramètres", icon: Pencil },
          ] as const
        ).map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setSubTab(t.value)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              subTab === t.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "overview" && <OverviewTab year={year} />}
      {subTab === "classes" && <ClassesSubTab year={year} />}
      {subTab === "teachers" && (
        <TeachersSubTab year={year} canManage={canManage} />
      )}
      {subTab === "subjects" && <SubjectsSubTab year={year} />}
      {subTab === "settings" && (
        <SettingsSubTab year={year} canManage={canManage} />
      )}
    </UnifiedModal>
  );
}

function ReadinessTile({
  label,
  rate,
  tone,
  detail,
}: {
  label: string;
  rate: number;
  tone: "success" | "info" | "warning" | "danger";
  detail: string;
}) {
  const barTone =
    tone === "success"
      ? "bg-status-success"
      : tone === "info"
        ? "bg-primary"
        : tone === "warning"
          ? "bg-status-warning"
          : "bg-status-danger";
  const textTone =
    tone === "success"
      ? "text-status-success"
      : tone === "info"
        ? "text-primary"
        : tone === "warning"
          ? "text-status-warning"
          : "text-status-danger";
  return (
    <div className="p-3 rounded-lg border border-border/70 bg-surface-elevated/40 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground truncate">
          {label}
        </span>
        <span className={`text-xs font-mono font-bold shrink-0 ${textTone}`}>
          {rate}%
        </span>
      </div>
      <div
        className="h-1.5 rounded-full bg-muted overflow-hidden"
        aria-hidden="true"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${barTone}`}
          style={{
            width: `${Math.min(100, Math.max(rate, rate > 0 ? 4 : 0))}%`,
          }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground truncate">{detail}</p>
    </div>
  );
}

function OverviewTab({ year }: { year: AcademicYear }) {
  const repos = useRepositories();
  const allClasses = useObservable(() => repos.classes.observe(), []);
  const allStudents = useObservable(() => repos.students.observe(), []);
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const allPersonnel = useObservable(() => repos.personnel.observe(), []);
  const teachers = useObservable(
    () => repos.teachers.observeByAcademicYear(year.id),
    [],
  );
  const timetableEntries = useObservable(
    () => repos.teachers.observeTimetableByAcademicYear(year.id),
    [],
  );

  const yearClasses = useMemo(
    () => allClasses.filter((c) => c.academicYearId === year.id),
    [allClasses, year.id],
  );

  const yearSubjects = useMemo(
    () => allSubjects.filter((s) => s.academicYearId === year.id),
    [allSubjects, year.id],
  );

  // Combine teachers registered in TeacherRepository with Personnel teachers
  const totalTeachersCount = useMemo(() => {
    const ids = new Set<string>();
    teachers.forEach((t) => ids.add(t.personnelId || t.id));
    allPersonnel
      .filter((p) => p.staffCategory === "teacher" || p.roleId === "teacher")
      .forEach((p) => ids.add(p.id));
    return ids.size;
  }, [teachers, allPersonnel]);

  const totalEnrolled = yearClasses.reduce((s, c) => s + c.enrolledCount, 0);
  const totalCapacity = yearClasses.reduce((s, c) => s + (c.capacity ?? 30), 0);
  const capacityRate =
    totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 100) : 0;

  const classesWithTimetable = new Set(timetableEntries.map((e) => e.classId))
    .size;
  const timetableCoverage =
    yearClasses.length > 0
      ? Math.round((classesWithTimetable / yearClasses.length) * 100)
      : 0;

  const classesWithHomeroom = yearClasses.filter(
    (c) => c.homeroomTeacherId !== null,
  ).length;
  const homeroomAssignmentRate =
    yearClasses.length > 0
      ? Math.round((classesWithHomeroom / yearClasses.length) * 100)
      : 0;

  const cycleBreakdown = useMemo(() => {
    const cycles: Array<{
      cycle: AcademicLevel;
      label: string;
      classes: number;
      students: number;
    }> = [
      { cycle: "primaire", label: "Primaire", classes: 0, students: 0 },
      { cycle: "cem", label: "CEM", classes: 0, students: 0 },
      { cycle: "lycee", label: "Lycée", classes: 0, students: 0 },
    ];
    for (const c of yearClasses) {
      const entry = cycles.find((cy) => cy.cycle === c.level);
      if (entry) {
        entry.classes++;
        entry.students += c.enrolledCount;
      }
    }
    return cycles;
  }, [yearClasses]);

  const gradeBreakdown = useMemo(() => {
    return GRADE_LEVELS.map((g) => {
      const gradeClasses = yearClasses.filter((c) => c.gradeCode === g);
      const gradeStudents = gradeClasses.reduce(
        (s, c) => s + c.enrolledCount,
        0,
      );
      return {
        grade: g,
        label: GRADE_LEVEL_LABELS_FR[g],
        classes: gradeClasses.length,
        students: gradeStudents,
      };
    });
  }, [yearClasses]);

  const now = new Date();
  const start = new Date(year.startDate);
  const end = new Date(year.endDate);
  const totalDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86_400_000),
  );
  const elapsedDays = Math.max(
    0,
    Math.min(
      totalDays,
      Math.round((now.getTime() - start.getTime()) / 86_400_000),
    ),
  );
  const progressPct = Math.round((elapsedDays / totalDays) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Classes"
          value={yearClasses.length}
          icon={<School className="h-5 w-5" />}
          tone="info"
        />
        <KpiCard
          label="Élèves inscrits"
          value={totalEnrolled}
          icon={<Users className="h-5 w-5" />}
          tone="success"
        />
        <KpiCard
          label="Enseignants"
          value={totalTeachersCount}
          icon={<GraduationCap className="h-5 w-5" />}
          tone="info"
        />
        <KpiCard
          label="Matières"
          value={yearSubjects.length}
          icon={<BookOpen className="h-5 w-5" />}
          tone="warning"
        />
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              État de Préparation de l'Année Scolaire
            </span>
            <Badge variant="outline" className="text-[10px] font-mono shrink-0">
              {year.code}
            </Badge>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ReadinessTile
              label="Salles & Classes"
              rate={yearClasses.length > 0 ? 100 : 0}
              tone="success"
              detail={`${yearClasses.length} classe(s) configurée(s)`}
            />
            <ReadinessTile
              label="Enseignants Principaux"
              rate={homeroomAssignmentRate}
              tone={
                homeroomAssignmentRate >= 80
                  ? "success"
                  : homeroomAssignmentRate > 0
                    ? "info"
                    : "danger"
              }
              detail={`${classesWithHomeroom} / ${yearClasses.length} classes assignées`}
            />
            <ReadinessTile
              label="Emplois du Temps"
              rate={timetableCoverage}
              tone={
                timetableCoverage >= 80
                  ? "success"
                  : timetableCoverage > 0
                    ? "warning"
                    : "danger"
              }
              detail={`${classesWithTimetable} / ${yearClasses.length} EDT validés`}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Progression de l'année scolaire
            </span>
            <span className="text-muted-foreground">
              {elapsedDays} / {totalDays} jours · {progressPct}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Début : {year.startDate}</span>
            <span>Fin : {year.endDate}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Répartition par cycle
          </h3>
          <div className="space-y-2">
            {cycleBreakdown.map((c) => {
              const maxStudents = Math.max(
                ...cycleBreakdown.map((x) => x.students),
                1,
              );
              const pct = (c.students / maxStudents) * 100;
              return (
                <div key={c.cycle} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{c.label}</span>
                    <span className="font-mono text-foreground">
                      {c.classes} classe(s) · {c.students} élève(s)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/70 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ClassesSubTab({ year }: { year: AcademicYear }) {
  const repos = useRepositories();
  const allClasses = useObservable(() => repos.classes.observe(), []);
  const [search, setSearch] = useState("");
  const [cycleFilter, setCycleFilter] = useState<string>("all");

  const yearClasses = useMemo(
    () => allClasses.filter((c) => c.academicYearId === year.id),
    [allClasses, year.id],
  );

  const filtered = yearClasses.filter((c) => {
    if (cycleFilter !== "all" && c.level !== cycleFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.room ?? "").toLowerCase().includes(q) ||
        (c.homeroomTeacherName ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, code, salle, enseignant…"
            className="pl-9 h-8 text-xs"
          />
        </div>
        <Select value={cycleFilter} onValueChange={setCycleFilter}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous cycles</SelectItem>
            <SelectItem value="primaire">Primaire</SelectItem>
            <SelectItem value="cem">CEM</SelectItem>
            <SelectItem value="lycee">Lycée</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} / {yearClasses.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border rounded">
          Aucune classe trouvée pour cette année.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 p-2.5 rounded border border-border/60 bg-card hover:bg-accent/5"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {c.name}
                  </p>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {c.code}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {LEVEL_LABELS_FR[c.level]} ·{" "}
                  {GRADE_LEVEL_LABELS_FR[c.gradeCode]} · Salle {c.room ?? "—"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold text-foreground">
                  {c.enrolledCount}
                  {c.capacity ? `/${c.capacity}` : ""} élèves
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {c.homeroomTeacherName ?? "Non désigné"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TeachersSubTab — unified teacher list with class assignment workflow
// ============================================================================

interface UnifiedTeacherDisplay {
  id: string;
  personnelId: string;
  teacherRecordId?: string;
  firstName: string;
  lastName: string;
  code: string;
  status: TeacherStatus;
  maxWeeklyHours: number;
  assignedHomeroomClasses: string[];
  assignedSubjectClasses: string[];
  subjects: string[];
}

function TeachersSubTab({
  year,
  canManage,
}: {
  year: AcademicYear;
  canManage: boolean;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const teachers = useObservable(
    () => repos.teachers.observeByAcademicYear(year.id),
    [year.id],
  );
  const assignments = useObservable(
    () => repos.teachers.observeAssignmentsByAcademicYear(year.id),
    [year.id],
  );
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const allPersonnel = useObservable(() => repos.personnel.observe(), []);
  const allClasses = useObservable(() => repos.classes.observe(), []);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [assignClassTarget, setAssignClassTarget] =
    useState<UnifiedTeacherDisplay | null>(null);
  const [addTeacherOpen, setAddTeacherOpen] = useState(false);
  const [selectedPersonnelId, setSelectedPersonnelId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [assignmentType, setAssignmentType] = useState<"homeroom" | "subject">(
    "homeroom",
  );
  const [selectedSubjectId, setSelectedSubjectId] = useState("");

  const yearClasses = useMemo(
    () => allClasses.filter((c) => c.academicYearId === year.id),
    [allClasses, year.id],
  );

  // T-313 (REG-006): NO render-triggered auto-provisioning. The 9e70078
  // patch fired repos.teachers.createTeacher() for every un-provisioned
  // personnel teacher ON EVERY RENDER PASS — a write with no user action,
  // retried forever when it failed (feedback loop on the observables it
  // mutates). Teacher records for a school year are now created ONLY via
  // the explicit "+ Ajouter un enseignant" modal (handleRegisterTeacher).
  // The unifiedTeachers merge below already DISPLAYS un-provisioned
  // personnel teachers (badged by their computed ENS- code) so nothing is
  // hidden by this removal — it only stops the silent writes.

  // Merge teachers from TeacherRepository and Personnel for comprehensive display
  const unifiedTeachers = useMemo<UnifiedTeacherDisplay[]>(() => {
    const list: UnifiedTeacherDisplay[] = [];
    const seenPersonnelIds = new Set<string>();

    teachers.forEach((t) => {
      seenPersonnelIds.add(t.personnelId);
      const teacherAssignments = assignments.filter(
        (a) => a.teacherId === t.id,
      );
      const subjectNames = teacherAssignments
        .map((a) => allSubjects.find((s) => s.id === a.subjectId)?.name ?? "")
        .filter(Boolean);

      // Find homeroom classes for this teacher
      const homeroomClasses = yearClasses
        .filter(
          (c) =>
            c.homeroomTeacherId === t.personnelId ||
            c.homeroomTeacherId === t.id,
        )
        .map((c) => c.name);

      list.push({
        id: t.id,
        personnelId: t.personnelId,
        teacherRecordId: t.id,
        firstName: t.firstName,
        lastName: t.lastName,
        code: t.code,
        status: t.status,
        maxWeeklyHours: t.maxWeeklyHours,
        assignedHomeroomClasses: homeroomClasses,
        assignedSubjectClasses: [],
        subjects: subjectNames,
      });
    });

    // Add any personnel teacher not yet in TeacherRepository
    allPersonnel
      .filter((p) => p.staffCategory === "teacher" || p.roleId === "teacher")
      .forEach((p) => {
        if (!seenPersonnelIds.has(p.id)) {
          const homeroomClasses = yearClasses
            .filter((c) => c.homeroomTeacherId === p.id)
            .map((c) => c.name);

          list.push({
            id: p.id,
            personnelId: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            code: `ENS-${p.id.slice(-4).toUpperCase()}`,
            status: "active",
            maxWeeklyHours: p.weeklyHoursTarget || 18,
            assignedHomeroomClasses: homeroomClasses,
            assignedSubjectClasses: [],
            subjects: [],
          });
        }
      });

    return list;
  }, [teachers, assignments, allSubjects, allPersonnel, yearClasses]);

  const filtered = unifiedTeachers.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        t.subjects.join(" ").toLowerCase().includes(q) ||
        t.assignedHomeroomClasses.join(" ").toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleAssignToClassSubmit() {
    if (!assignClassTarget || !selectedClassId || !session) return;
    const targetClass = yearClasses.find((c) => c.id === selectedClassId);
    if (!targetClass) return;

    if (assignmentType === "homeroom") {
      const result = await repos.classes.updateClass(targetClass.id, {
        homeroomTeacherId: assignClassTarget.personnelId,
        homeroomTeacherName: `${assignClassTarget.firstName} ${assignClassTarget.lastName}`,
      });

      if (result.ok) {
        toast.showSuccess(
          "Enseignant principal assigné",
          `${assignClassTarget.firstName} ${assignClassTarget.lastName} est maintenant responsable de la classe ${targetClass.name}.`,
        );
        setAssignClassTarget(null);
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
        teacherId: assignClassTarget.personnelId,
        teacherName: `${assignClassTarget.firstName} ${assignClassTarget.lastName}`,
        weeklyHours: 2,
        coefficient: subj?.coefficient || 1,
      });

      if (result.ok) {
        toast.showSuccess(
          "Matière et enseignant assignés",
          `${assignClassTarget.firstName} ${assignClassTarget.lastName} enseigne désormais ${subj?.name ?? "la matière"} en ${targetClass.name}.`,
        );
        setAssignClassTarget(null);
        setSelectedClassId("");
        setSelectedSubjectId("");
      } else {
        toast.showError("Échec", result.error.userMessage);
      }
    }
  }

  async function handleRegisterTeacher() {
    if (!selectedPersonnelId || !session) return;
    const p = allPersonnel.find((pers) => pers.id === selectedPersonnelId);
    if (!p) return;

    const res = await repos.teachers.createTeacher(
      {
        personnelId: p.id,
        code: `ENS-${year.code.slice(0, 4)}-${p.id.slice(-3).toUpperCase()}`,
        academicYearId: year.id,
        academicYearCode: year.code,
        status: "active",
        maxWeeklyHours: p.weeklyHoursTarget || 18,
      },
      session.userId,
      session.displayName,
    );

    if (res.ok) {
      toast.showSuccess(
        "Enseignant ajouté",
        `${p.firstName} ${p.lastName} est actif pour l'année ${year.code}.`,
      );
      setAddTeacherOpen(false);
      setSelectedPersonnelId("");
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, code, classe, matière…"
              className="pl-9 h-8 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="active">Actifs</SelectItem>
              <SelectItem value="on_leave">En congé</SelectItem>
              <SelectItem value="inactive">Inactifs</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">
            {filtered.length} enseignant(s)
          </span>
          {canManage && (
            <Button
              size="sm"
              onClick={() => setAddTeacherOpen(true)}
              className="h-8 text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Ajouter un enseignant
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border rounded">
          Aucun enseignant trouvé pour cette année.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {filtered.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-3 p-3 rounded border border-border/60 bg-card hover:bg-accent/5 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {t.firstName} {t.lastName}
                  </p>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {t.code}
                  </Badge>
                  <StatusChip
                    label={TEACHER_STATUS_LABELS_FR[t.status]}
                    tone={t.status === "active" ? "success" : "neutral"}
                  />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">
                    <strong>Classes principales :</strong>{" "}
                    {t.assignedHomeroomClasses.length > 0
                      ? t.assignedHomeroomClasses.join(", ")
                      : "Aucune"}
                  </span>
                  {t.subjects.length > 0 && (
                    <>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">
                        <strong>Matières :</strong> {t.subjects.join(", ")}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="text-[10px] text-muted-foreground font-mono">
                  Max {t.maxWeeklyHours}h/sem
                </span>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setAssignClassTarget(t);
                      setSelectedClassId("");
                    }}
                  >
                    <UserCheck className="h-3.5 w-3.5 mr-1" />
                    Assigner à une classe
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Assign teacher to class */}
      {assignClassTarget && (
        <UnifiedModal
          open={!!assignClassTarget}
          onOpenChange={(o) => !o && setAssignClassTarget(null)}
          size="md"
          icon={UserCheck}
          iconTone="primary"
          title={`Assigner ${assignClassTarget.firstName} ${assignClassTarget.lastName} à une classe`}
          description={`Année scolaire ${year.code} · Choisissez la classe et le rôle pédagogique.`}
          submitLabel="Confirmer l'affectation"
          onSubmit={handleAssignToClassSubmit}
        >
          <div className="space-y-4">
            <FormField label="Type d'affectation" required>
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

            <FormField label="Classe cible" required>
              <Select
                value={selectedClassId}
                onValueChange={setSelectedClassId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une classe…" />
                </SelectTrigger>
                <SelectContent>
                  {yearClasses.map((c) => (
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
                    <SelectValue placeholder="Sélectionner la matière…" />
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

      {/* Modal: Register teacher */}
      {addTeacherOpen && (
        <UnifiedModal
          open={addTeacherOpen}
          onOpenChange={setAddTeacherOpen}
          size="md"
          icon={Plus}
          iconTone="primary"
          title="Ajouter un enseignant pour cette année"
          description={`Active un enseignant du personnel pour l'année scolaire ${year.code}.`}
          submitLabel="Activer l'enseignant"
          onSubmit={handleRegisterTeacher}
        >
          <div className="space-y-3">
            <FormField label="Sélectionner le membre du personnel" required>
              <Select
                value={selectedPersonnelId}
                onValueChange={setSelectedPersonnelId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir un enseignant…" />
                </SelectTrigger>
                <SelectContent>
                  {allPersonnel.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} ·{" "}
                      {p.position || STAFF_CATEGORY_LABELS_FR[p.staffCategory]}
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

function SubjectsSubTab({ year }: { year: AcademicYear }) {
  const repos = useRepositories();
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const assignments = useObservable(
    () => repos.teachers.observeAssignmentsByAcademicYear(year.id),
    [],
  );
  const teachers = useObservable(
    () => repos.teachers.observeByAcademicYear(year.id),
    [],
  );
  const [search, setSearch] = useState("");
  const [cycleFilter, setCycleFilter] = useState<string>("all");

  const yearSubjects = useMemo(
    () => allSubjects.filter((s) => s.academicYearId === year.id),
    [allSubjects, year.id],
  );

  const filtered = yearSubjects.filter((s) => {
    if (cycleFilter !== "all" && s.cycle !== cycleFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.teacherName ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, code, enseignant…"
            className="pl-9 h-8 text-xs"
          />
        </div>
        <Select value={cycleFilter} onValueChange={setCycleFilter}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous cycles</SelectItem>
            <SelectItem value="primaire">Primaire</SelectItem>
            <SelectItem value="cem">CEM</SelectItem>
            <SelectItem value="lycee">Lycée</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} / {yearSubjects.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border rounded">
          Aucune matière trouvée pour cette année.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {filtered.map((s) => {
            const subjectAssignments = assignments.filter(
              (a) => a.subjectId === s.id,
            );
            const allTeachersForSubject = subjectAssignments
              .map((a) => {
                const t = teachers.find((t) => t.id === a.teacherId);
                return t ? `${t.firstName} ${t.lastName}` : null;
              })
              .filter(Boolean);
            return (
              <div
                key={s.id}
                className="flex items-start gap-3 p-2.5 rounded border border-border/60 bg-card hover:bg-accent/5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {s.name}
                    </p>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {s.code}
                    </Badge>
                    {s.isExtracurricular && (
                      <Badge variant="secondary" className="text-[10px]">
                        Extrascolaire
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {LEVEL_LABELS_FR[s.level]} · Coef. {s.coefficient} · Seuil{" "}
                    {s.passingGrade}/20
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    <strong>Enseignant(s) :</strong>{" "}
                    {allTeachersForSubject.length > 0
                      ? allTeachersForSubject.join(", ")
                      : "Aucun assigné"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {s.teacherId ? (
                    <StatusChip label="Assignée" tone="success" />
                  ) : (
                    <StatusChip label="Sans prof" tone="danger" />
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {subjectAssignments.length} assignation(s)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsSubTab({
  year,
  canManage,
}: {
  year: AcademicYear;
  canManage: boolean;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [label, setLabel] = useState(year.label);
  const [startDate, setStartDate] = useState(year.startDate);
  const [endDate, setEndDate] = useState(year.endDate);
  const [termStructure, setTermStructure] = useState(year.termStructure);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const res = await repos.academicYears.updateAcademicYear(
      year.id,
      {
        label: label.trim() || year.label,
        startDate,
        endDate,
        termStructure,
      },
      session.userId,
      session.displayName,
    );
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Année modifiée", `${year.code} a été mise à jour.`);
    } else {
      setAlert({
        tone: "error",
        title: "Échec de modification",
        description: res.error.userMessage,
      });
    }
  }

  async function handleSetCurrent() {
    if (!session) return;
    const res = await repos.academicYears.setCurrentYear(
      year.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess(
        "Année courante",
        `${year.code} est maintenant courante.`,
      );
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  async function handleArchive() {
    if (!session) return;
    const res = await repos.academicYears.archiveAcademicYear(
      year.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Année archivée", year.label);
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  async function handleRestore() {
    if (!session) return;
    const res = await repos.academicYears.restoreAcademicYear(
      year.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Année restaurée", year.label);
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  async function handleDelete() {
    if (!session) return;
    const res = await repos.academicYears.deleteAcademicYear(
      year.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Année supprimée", year.label);
    } else {
      toast.showError("Échec de la suppression", res.error.userMessage);
    }
  }

  if (!canManage) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Vous n'avez pas la permission de modifier les années scolaires.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Modifier l'année scolaire
          </h3>
          <div className="space-y-3">
            <FormField label="Code" hint="Non modifiable (identifiant stable)">
              <Input value={year.code} disabled className="bg-muted/30" />
            </FormField>
            <FormField label="Libellé" required>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Date de début" required>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </FormField>
              <FormField label="Date de fin" required>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </FormField>
            </div>
            <FormField label="Structure" required>
              <Select
                value={termStructure}
                onValueChange={(v) =>
                  setTermStructure(v as typeof termStructure)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trimester">Trimestres (3)</SelectItem>
                  <SelectItem value="semester">Semestres (2)</SelectItem>
                  <SelectItem value="quarter">Quarts (4)</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {alert && (
              <div
                className={`p-2 rounded text-xs ${
                  alert.tone === "error"
                    ? "bg-status-danger/10 text-status-danger"
                    : "bg-status-warning/10 text-status-warning"
                }`}
              >
                <strong>{alert.title}</strong> — {alert.description}
              </div>
            )}
            <Button size="sm" onClick={handleSave} disabled={submitting}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {submitting ? "Enregistrement…" : "Enregistrer les modifications"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Archive className="h-4 w-4 text-primary" />
            Actions sur l'année
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {!year.isCurrent && !year.isArchived && (
              <Button size="sm" variant="outline" onClick={handleSetCurrent}>
                <Star className="h-3.5 w-3.5 mr-1" />
                Définir comme courante
              </Button>
            )}
            {!year.isArchived ? (
              <Button size="sm" variant="outline" onClick={handleArchive}>
                <Archive className="h-3.5 w-3.5 mr-1" />
                Archiver
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={handleRestore}>
                <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
                Restaurer
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-status-danger hover:bg-status-danger/10"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Supprimer définitivement
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
