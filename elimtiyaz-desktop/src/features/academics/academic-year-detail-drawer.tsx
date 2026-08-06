/**
 * AcademicYearDetailDrawer — rich detail view for a single academic year.
 *
 * When the user clicks a school year card, this drawer opens with:
 *   - Overview: KPIs (students, classes, teachers, subjects, enrollment,
 *     capacity utilization, timetable coverage) + per-cycle breakdown
 *   - Classes: searchable list of all classes in this year
 *   - Teachers: searchable list of all teachers active in this year
 *   - Subjects: searchable list of all subjects offered this year
 *   - Settings: edit label/dates/term structure + archive/restore/delete/set-current
 *
 * All data is scoped by the selected academic year — switching years changes
 * the entire pedagogical context visible in the drawer.
 */
import { useState, useMemo } from "react";
import {
  Calendar,
  Users,
  GraduationCap,
  BookOpen,
  Trophy,
  School,
  TrendingUp,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  Star,
  Search,
  CheckCircle2,
  Clock,
  Layers,
} from "lucide-react";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
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
  type GradeLevel,
  type AcademicLevel,
} from "../../domain/model/student";
import { Permission } from "../../core/rbac/permissions";
import {
  TEACHER_STATUS_LABELS_FR,
  formatTimeSlot,
  SCHOOL_DAY_LABELS_FR,
} from "../../domain/model/teacher";

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
      {/* Sub-tab navigation */}
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
      {subTab === "teachers" && <TeachersSubTab year={year} />}
      {subTab === "subjects" && <SubjectsSubTab year={year} />}
      {subTab === "settings" && (
        <SettingsSubTab year={year} canManage={canManage} />
      )}
    </UnifiedModal>
  );
}

// ============================================================================
// Overview tab — KPIs + per-cycle breakdown
// ============================================================================

function OverviewTab({ year }: { year: AcademicYear }) {
  const repos = useRepositories();
  const allClasses = useObservable(() => repos.classes.observe(), []);
  const allStudents = useObservable(() => repos.students.observe(), []);
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const teachers = useObservable(
    () => repos.teachers.observeByAcademicYear(year.id),
    [],
  );
  const assignments = useObservable(
    () => repos.teachers.observeAssignmentsByAcademicYear(year.id),
    [],
  );
  const timetableEntries = useObservable(
    () => repos.teachers.observeTimetableByAcademicYear(year.id),
    [],
  );

  // Filter classes by this academic year
  const yearClasses = useMemo(
    () => allClasses.filter((c) => c.academicYearId === year.id),
    [allClasses, year.id],
  );

  // Filter students: a student belongs to this year if their classId is in
  // one of this year's classes. (Students without a classId are not counted.)
  const yearClassIds = useMemo(
    () => new Set(yearClasses.map((c) => c.id)),
    [yearClasses],
  );
  const yearStudents = useMemo(
    () => allStudents.filter((s) => s.classId && yearClassIds.has(s.classId)),
    [allStudents, yearClassIds],
  );

  // Subjects for this year
  const yearSubjects = useMemo(
    () => allSubjects.filter((s) => s.academicYearId === year.id),
    [allSubjects, year.id],
  );

  // Active teachers
  const activeTeachers = teachers.filter((t) => t.status === "active");

  // Capacity utilization
  const totalEnrolled = yearClasses.reduce((s, c) => s + c.enrolledCount, 0);
  const totalCapacity = yearClasses.reduce(
    (s, c) => s + (c.capacity ?? 30),
    0,
  );
  const capacityRate =
    totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 100) : 0;

  // Timetable coverage
  const classesWithTimetable = new Set(
    timetableEntries.map((e) => e.classId),
  ).size;
  const timetableCoverage =
    yearClasses.length > 0
      ? Math.round((classesWithTimetable / yearClasses.length) * 100)
      : 0;

  // Per-cycle breakdown
  const cycleBreakdown = useMemo(() => {
    const cycles: Array<{ cycle: AcademicLevel; label: string; classes: number; students: number }> = [
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

  // Per-grade breakdown
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
    }).filter((g) => g.classes > 0);
  }, [yearClasses]);

  // Subjects without a teacher assigned (data quality check)
  const subjectsWithoutTeacher = yearSubjects.filter(
    (s) => !s.teacherId,
  ).length;

  // Teachers on leave
  const teachersOnLeave = teachers.filter((t) => t.status === "on_leave").length;

  // Compute days elapsed / remaining in the school year
  const now = new Date();
  const start = new Date(year.startDate);
  const end = new Date(year.endDate);
  const totalDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86_400_000),
  );
  const elapsedDays = Math.max(
    0,
    Math.min(totalDays, Math.round((now.getTime() - start.getTime()) / 86_400_000)),
  );
  const progressPct = Math.round((elapsedDays / totalDays) * 100);

  return (
    <div className="space-y-4">
      {/* KPI grid */}
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
          label="Enseignants actifs"
          value={activeTeachers.length}
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

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Taux remplissage"
          value={`${capacityRate}%`}
          icon={<TrendingUp className="h-5 w-5" />}
          tone={capacityRate > 90 ? "danger" : capacityRate > 70 ? "warning" : "success"}
        />
        <KpiCard
          label="Couverture EDT"
          value={`${timetableCoverage}%`}
          icon={<Calendar className="h-5 w-5" />}
          tone={timetableCoverage === 100 ? "success" : "warning"}
        />
        <KpiCard
          label="Matières sans prof"
          value={subjectsWithoutTeacher}
          icon={<BookOpen className="h-5 w-5" />}
          tone={subjectsWithoutTeacher > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="En congé"
          value={teachersOnLeave}
          icon={<Clock className="h-5 w-5" />}
          tone="default"
        />
      </div>

      {/* Year progress bar */}
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

      {/* Per-cycle breakdown */}
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

      {/* Per-grade breakdown */}
      {gradeBreakdown.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <School className="h-4 w-4 text-primary" />
              Détail par niveau scolaire
            </h3>
            <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
              {gradeBreakdown.map((g) => (
                <div
                  key={g.grade}
                  className="rounded border border-border/60 bg-muted/20 p-2"
                >
                  <p className="text-xs font-medium text-foreground">
                    {g.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {g.classes} classe(s) · {g.students} élève(s)
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data quality alerts */}
      {(subjectsWithoutTeacher > 0 || teachersOnLeave > 0) && (
        <Card className="border-status-warning/40 bg-status-warning/5">
          <CardContent className="p-3 space-y-1.5">
            <h3 className="text-sm font-semibold text-status-warning flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Points d'attention
            </h3>
            {subjectsWithoutTeacher > 0 && (
              <p className="text-xs text-foreground">
                · {subjectsWithoutTeacher} matière(s) sans enseignant assigné.
                Allez dans l'onglet « Matières » pour assigner.
              </p>
            )}
            {teachersOnLeave > 0 && (
              <p className="text-xs text-foreground">
                · {teachersOnLeave} enseignant(s) en congé — vérifiez le
                remplacement des cours.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Classes sub-tab — searchable list
// ============================================================================

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
      {/* Toolbar */}
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
                  {LEVEL_LABELS_FR[c.level]} · {GRADE_LEVEL_LABELS_FR[c.gradeCode]} · Salle {c.room ?? "—"}
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
// Teachers sub-tab — searchable list
// ============================================================================

function TeachersSubTab({ year }: { year: AcademicYear }) {
  const repos = useRepositories();
  const teachers = useObservable(
    () => repos.teachers.observeByAcademicYear(year.id),
    [],
  );
  const assignments = useObservable(
    () => repos.teachers.observeAssignmentsByAcademicYear(year.id),
    [],
  );
  const allSubjects = useObservable(() => repos.subjects.observe(), []);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = teachers.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const teacherSubjects = assignments
        .filter((a) => a.teacherId === t.id)
        .map((a) => allSubjects.find((s) => s.id === a.subjectId)?.name ?? "")
        .join(" ");
      return (
        `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        teacherSubjects.toLowerCase().includes(q)
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
            placeholder="Rechercher par nom, code, matière…"
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
        <span className="text-xs text-muted-foreground">
          {filtered.length} / {teachers.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border rounded">
          Aucun enseignant trouvé pour cette année.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {filtered.map((t) => {
            const teacherAssignments = assignments.filter((a) => a.teacherId === t.id);
            const subjectNames = teacherAssignments
              .map((a) => allSubjects.find((s) => s.id === a.subjectId)?.name ?? "?")
              .filter(Boolean);
            return (
              <div
                key={t.id}
                className="flex items-start gap-3 p-2.5 rounded border border-border/60 bg-card hover:bg-accent/5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {t.firstName} {t.lastName}
                    </p>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {t.code}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {subjectNames.length > 0
                      ? subjectNames.join(", ")
                      : "Aucune matière assignée"}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {teacherAssignments.filter((a) => a.isPrimary).map((a) => (
                      <Badge
                        key={a.id}
                        className="text-[10px] bg-primary/10 text-primary"
                      >
                        Principal : {allSubjects.find((s) => s.id === a.subjectId)?.name ?? "?"}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusChip
                    label={TEACHER_STATUS_LABELS_FR[t.status]}
                    tone={
                      t.status === "active"
                        ? "success"
                        : t.status === "on_leave"
                          ? "warning"
                          : "neutral"
                    }
                  />
                  <span className="text-[10px] text-muted-foreground">
                    Max {t.maxWeeklyHours}h/sem
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

// ============================================================================
// Subjects sub-tab — searchable list
// ============================================================================

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
            const subjectAssignments = assignments.filter((a) => a.subjectId === s.id);
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
                    <p className="text-sm font-medium text-foreground">{s.name}</p>
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
                    {LEVEL_LABELS_FR[s.level]} · Coef. {s.coefficient} · Seuil {s.passingGrade}/20
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

// ============================================================================
// Settings sub-tab — edit + lifecycle actions
// ============================================================================

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
      toast.showSuccess("Année courante", `${year.code} est maintenant courante.`);
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
          <br />
          Contactez un administrateur ou un responsable.
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
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
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
                onValueChange={(v) => setTermStructure(v as typeof termStructure)}
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
            <Button
              size="sm"
              onClick={handleSave}
              disabled={submitting}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {submitting ? "Enregistrement…" : "Enregistrer les modifications"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lifecycle actions */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Archive className="h-4 w-4 text-primary" />
            Actions sur l'année
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {!year.isCurrent && !year.isArchived && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleSetCurrent}
              >
                <Star className="h-3.5 w-3.5 mr-1" />
                Définir comme courante
              </Button>
            )}
            {!year.isArchived ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleArchive}
              >
                <Archive className="h-3.5 w-3.5 mr-1" />
                Archiver
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRestore}
              >
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
          {year.isArchived && (
            <p className="text-[10px] text-muted-foreground">
              Une année archivée est en lecture seule pour les opérations
              pédagogiques. Restaurez-la pour réactiver l'édition.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
