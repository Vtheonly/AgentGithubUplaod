import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Permission } from "../../core/rbac/permissions";
import {
  isPassing,
  validateScore,
  type AcademicTerm,
  type Subject,
} from "../../domain/model/academic";
// T-345 (MATIERE-500/ADR-018): the canonical resolution — ONE rule for the
// coefficient + the grading recipe, replacing the per-screen fallback chains.
import {
  resolveSubjectConfiguration,
  computeSubjectAverageFromRecipe,
} from "../../domain/calc/academics/subject-config";
import type { GradeEntryInput } from "../../domain/repository/academic-repository";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { AlertTriangle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { cn } from "../../shared/ui/cn";

interface Row {
  studentId: string;
  firstName: string;
  lastName: string;
  code: string;
  d1: string;
  d2: string;
  examen: string;
  cc: string;
}

/**
 * Props for embedding the screen OUTSIDE its route (T-235 / RBAC-301 —
 * the teacher Personnel workspace). When provided, `classId`/`subjectId`
 * override the route params; `onExit` replaces the navigate-back behavior
 * (cancel + post-save) so the host stays in control.
 */
export interface GradeEntryScreenProps {
  readonly classId?: string;
  readonly subjectId?: string;
  readonly onExit?: () => void;
}

export function GradeEntryScreen({
  classId: classIdProp,
  subjectId: subjectIdProp,
  onExit,
}: GradeEntryScreenProps = {}) {
  const routeParams = useParams<{ classId: string; subjectId: string }>();
  const classId = classIdProp ?? routeParams.classId;
  const subjectId = subjectIdProp ?? routeParams.subjectId;
  const navigate = useNavigate();
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  // T-235: embedded hosts pass onExit (stay inside Personnel); the routed
  // usage keeps the original navigate-back semantics.
  const exitToClass = () => {
    if (onExit) {
      onExit();
    } else {
      navigate(`/academics/class/${classId}`);
    }
  };

  const cls = useObservable(
    () => repos.classes.observeById(classId ?? ""),
    [classId],
  );
  const students = useObservable(
    () => repos.students.observeByClass(classId ?? ""),
    [classId],
  );
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const classSubjects = useObservable(
    () => repos.subjects.observeByClass(classId ?? ""),
    [classId],
  );
  // T-345 (MATIERE-500/ADR-018): the context-specific subject
  // configurations — the ONE source the coefficient/recipe resolve through.
  const subjectConfigurations = useObservable(
    () => repos.subjects.observeConfigurations(),
    [],
  );
  const classAssessments = useObservable(
    () => repos.grades.observeForClass(classId ?? ""),
    [classId],
  );

  // FIX (subject picker — the screen used to lock on the subjectId from the
  // URL/props with no way to switch, e.g. stuck on "Anglais"). Keep an
  // internal active subject so the teacher can switch matière in-place:
  // embedded hosts (onExit) stay in the overlay, routed usage navigates so
  // the URL stays shareable.
  const [activeSubjectId, setActiveSubjectId] = useState<string | undefined>(
    subjectId,
  );
  useEffect(() => {
    setActiveSubjectId(subjectId);
  }, [subjectId]);
  const effectiveSubjectId = activeSubjectId ?? subjectId;

  // Same catalogue rule as ClassDetailPage / ClassGradesTab: assigned
  // class-subjects first, else the CONFIG-DRIVEN list (subjects carrying a
  // subject_configuration for this class's level+year — the T-345 way a
  // CEM class gets its Arabe once the admin adds the configuration), else
  // the legacy level-filtered directory, else the full directory — so the
  // switcher never shows an empty list while entry stays possible.
  const availableSubjects = useMemo(() => {
    const classLevelId = cls?.academicLevelId ?? null;
    const classYearId = cls?.academicYearId ?? null;
    const resolveCoef = (sub: Subject | undefined): number =>
      resolveSubjectConfiguration({
        subject: sub,
        configurations: subjectConfigurations,
        academicLevelId: classLevelId,
        academicYearId: classYearId,
      }).coefficient;
    if (classSubjects.length > 0) {
      return classSubjects.map((cs) => {
        const s = subjects.find((sub) => sub.id === cs.subjectId);
        return {
          id: cs.subjectId,
          name: s?.name ?? cs.subjectId,
          code: s?.code ?? "",
          coefficient: resolveCoef(s),
        };
      });
    }
    const configDriven = subjects.filter((s) =>
      subjectConfigurations.some(
        (c) =>
          c.subjectId === s.id &&
          c.academicLevelId === classLevelId &&
          c.academicYearId === classYearId &&
          c.isActive,
      ),
    );
    if (configDriven.length > 0) {
      return configDriven.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        coefficient: resolveCoef(s),
      }));
    }
    const level = cls?.level as
      | import("../../domain/model/student").AcademicLevel
      | undefined;
    const levelSubjs = level
      ? subjects.filter((s) => s.level === level)
      : [];
    return (levelSubjs.length > 0 ? levelSubjs : subjects).map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      coefficient: resolveCoef(s),
    }));
  }, [classSubjects, subjects, subjectConfigurations, cls?.academicLevelId, cls?.academicYearId, cls?.level]);

  const handleSubjectChange = (nextId: string) => {
    if (!nextId || nextId === effectiveSubjectId) return;
    if (onExit) {
      setActiveSubjectId(nextId);
    } else {
      navigate(`/academics/class/${classId}/grades/${nextId}`);
    }
  };

  const subject = subjects.find((s) => s.id === effectiveSubjectId);
  // T-345: the canonical resolution (configuration → legacy subject →
  // default) — replaces the per-screen scattered coefficient fallback
  // chains that resolved differently on every surface (MATIERE-500).
  const resolved = useMemo(
    () =>
      resolveSubjectConfiguration({
        subject,
        configurations: subjectConfigurations,
        academicLevelId: cls?.academicLevelId ?? null,
        academicYearId: cls?.academicYearId ?? null,
      }),
    [subject, subjectConfigurations, cls?.academicLevelId, cls?.academicYearId],
  );
  const recipe = resolved.gradingRecipe;
  const [term, setTerm] = useState<AcademicTerm>("T1");
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  // FIX (vault §04.07 / §06.05 — append-only history + RBAC): the grade-entry
  // route is not directly guarded, so enforce BOTH conditions here:
  //   1. the session must hold the EnterGrades permission (teachers+), and
  //   2. the class's academic year must NOT be archived — archived years are
  //      read-only; corrections require a new audit-logged entry.
  const academicYears = useObservable(() => repos.academicYears.observeAll(), []);
  const classYear = cls ? academicYears.find((y) => y.code === cls.academicYear) : undefined;
  const isArchivedYear = classYear?.isArchived ?? false;
  const canEnterGrades = !!session && session.permissions.has(Permission.EnterGrades);
  const readOnly = isArchivedYear || !canEnterGrades;
  const readOnlyReason = isArchivedYear
    ? `L'année scolaire ${cls?.academicYear ?? ""} est archivée — historique en lecture seule (append-only, plan §04.07).`
    : !canEnterGrades
      ? "Votre rôle ne dispose pas de la permission de saisie des notes (EnterGrades)."
      : null;

  // FIX (edit semantics): initialize the entry grid from the roster AND
  // pre-load any existing marks for the selected subject + term. Previously
  // the form always started blank, so saving blindly OVERWROTE previously
  // entered grades with nulls for any student the teacher skipped.
  // A stable init-key guard prevents mid-typing resets when the underlying
  // observables re-emit without relevant changes.
  const lastInitKeyRef = useRef("");
  useEffect(() => {
    const initKey = `${effectiveSubjectId}|${term}|${students.map((s) => s.id).join(",")}|${classAssessments.length}`;
    if (students.length === 0 || initKey === lastInitKeyRef.current) return;
    lastInitKeyRef.current = initKey;
    // When the effective subject has no directory row yet (e.g. a stale
    // assignment id), fall back to the first available subject so the screen
    // never dead-ends on "Matière introuvable" without a way out.
    if (!subject && availableSubjects.length > 0 && !effectiveSubjectId) {
      setActiveSubjectId(availableSubjects[0].id);
      return;
    }
    setRows(
      students.map((s) => {
        const existing = classAssessments.find(
          (a) => a.studentId === s.id && a.subjectId === effectiveSubjectId && a.term === term,
        );
        return {
          studentId: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          code: s.code,
          d1: existing?.devoir1 != null ? String(existing.devoir1) : "",
          d2: existing?.devoir2 != null ? String(existing.devoir2) : "",
          examen: existing?.examen != null ? String(existing.examen) : "",
          cc: existing?.cc != null ? String(existing.cc) : "",
        };
      }),
    );
  }, [students, classAssessments, effectiveSubjectId, subject, term, availableSubjects]);

  function updateRow(
    studentId: string,
    field: "d1" | "d2" | "examen" | "cc",
    value: string,
  ) {
    const cleaned = value.replace(/[^0-9.,]/g, "").replace(",", ".");
    setRows((curr) =>
      curr.map((r) =>
        r.studentId === studentId ? { ...r, [field]: cleaned } : r,
      ),
    );
  }

  function parseScore(s: string): number | null {
    if (!s.trim()) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || !validateScore(n)) return null;
    return n;
  }

  const stats = useMemo(() => {
    let passing = 0;
    let failing = 0;
    let missing = 0;
    let sum = 0;
    let count = 0;

    for (const r of rows) {
      const d1 = parseScore(r.d1);
      const d2 = parseScore(r.d2);
      const ex = parseScore(r.examen);
      const ccMark = parseScore(r.cc);

      if (d1 == null && d2 == null && ex == null && ccMark == null) {
        missing++;
        continue;
      }

      const avg = computeSubjectAverageFromRecipe(d1, d2, ex, ccMark, recipe);
      if (avg == null) {
        missing++;
        continue;
      }

      sum += avg;
      count++;
      if (isPassing(avg)) passing++;
      else failing++;
    }

    return {
      passing,
      failing,
      missing,
      classAverage: count > 0 ? sum / count : null,
    };
  }, [rows, recipe]);

  async function save() {
    if (!session || !classId || !effectiveSubjectId) return;
    if (readOnly) {
      toast.showWarning("Saisie bloquée", readOnlyReason ?? "");
      return;
    }
    setSaving(true);
    try {
      const payload: GradeEntryInput[] = [];

      for (const r of rows) {
        const d1 = parseScore(r.d1);
        const d2 = parseScore(r.d2);
        const ex = parseScore(r.examen);
        const ccMark = parseScore(r.cc);
        if (d1 == null && d2 == null && ex == null && ccMark == null) continue;

        payload.push({
          studentId: r.studentId,
          subjectId: effectiveSubjectId,
          classId,
          term,
          academicYear: cls?.academicYear ?? "2025-2026",
          devoir1: d1,
          devoir2: d2,
          examen: ex,
          // T-345 (ADR-018): the contrôle-continu mark + the entry-time
          // snapshots — the resolved configuration in force RIGHT NOW
          // (coefficient + component weights). History keeps these.
          cc: ccMark,
          coefficient: resolved.coefficient,
          coefficientDevoir1: recipe.devoir1,
          coefficientDevoir2: recipe.devoir2,
          coefficientExamen: recipe.examen,
          coefficientCc: recipe.cc,
          enteredBy: session.userId,
        });
      }

      if (payload.length === 0) {
        toast.showWarning("Saisie vide", "Aucune note valide à enregistrer.");
        return;
      }

      const result = await repos.grades.enterGradesBatch(payload);
      if (result.ok) {
        // FIX (edit semantics): report whether this was a pure save or an
        // overwrite of previously entered marks.
        const previouslyEntered = classAssessments.filter(
          (a) => a.subjectId === effectiveSubjectId && a.term === term,
        ).length;
        toast.showSuccess(
          previouslyEntered > 0 ? "Notes mises à jour" : "Notes enregistrées",
          `${result.value.length} note(s) sauvegardée(s)${previouslyEntered > 0 ? ` (remplace ${previouslyEntered} saisie(s) précédente(s))` : ""}.`,
        );
        exitToClass();
      } else {
        toast.showError("Échec de la sauvegarde", result.error.userMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!cls) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Classe introuvable" />
        <Button
          variant="outline"
          onClick={() =>
            onExit ? onExit() : navigate("/academics")
          }
          className="mx-6 w-fit"
        >
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
      </div>
    );
  }

  // Stale subjectId (e.g. a removed assignment): offer the catalogue instead
  // of a dead-end "Matière introuvable" with no way to pick another matière.
  if (!subject) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          title="Saisie des Notes"
          description={`${cls.name} · choisissez une matière pour commencer la saisie`}
          actions={
            <Button variant="outline" size="sm" onClick={exitToClass}>
              <ArrowLeft className="h-4 w-4" /> Annuler
            </Button>
          }
        />
        <div className="mx-6 mb-3 max-w-md space-y-1">
          <Label className="text-xs text-muted-foreground">Matière</Label>
          <Select
            value={effectiveSubjectId ?? ""}
            onValueChange={handleSubjectChange}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Choisir une matière…" />
            </SelectTrigger>
            <SelectContent>
              {availableSubjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} {s.code ? `(${s.code})` : ""} · Coef.{" "}
                  {s.coefficient}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {availableSubjects.length === 0 && (
          <p className="mx-6 text-sm text-muted-foreground">
            Aucune matière disponible. Contactez le responsable pédagogique.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`Saisie des Notes — ${subject.name}`}
        description={`${cls.name} · Coefficient ${subject.coefficient} · ${subject.code}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={exitToClass}
          >
            <ArrowLeft className="h-4 w-4" /> Annuler
          </Button>
        }
      />

      <div className="flex items-end gap-3 px-6 pb-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Matière</Label>
          <Select
            value={effectiveSubjectId ?? ""}
            onValueChange={handleSubjectChange}
          >
            <SelectTrigger className="h-9 w-64">
              <SelectValue placeholder="Choisir une matière…" />
            </SelectTrigger>
            <SelectContent>
              {availableSubjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} {s.code ? `(${s.code})` : ""} · Coef.{" "}
                  {s.coefficient}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Trimestre</Label>
          <Select
            value={term}
            onValueChange={(v) => setTerm(v as AcademicTerm)}
          >
            <SelectTrigger className="w-36 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="T1">Trimestre 1</SelectItem>
              <SelectItem value="T2">Trimestre 2</SelectItem>
              <SelectItem value="T3">Trimestre 3</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Moyenne de classe :
          </span>
          <Badge
            variant={
              stats.classAverage == null
                ? "outline"
                : isPassing(stats.classAverage)
                  ? "success"
                  : "danger"
            }
          >
            {stats.classAverage == null
              ? "—"
              : `${stats.classAverage.toFixed(2)} / 20`}
          </Badge>
        </div>
      </div>

      {/* FIX (append-only history): read-only banner for archived years or
          sessions lacking the EnterGrades permission. */}
      {readOnly && readOnlyReason && (
        <div className="mx-6 mb-3 flex items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5 text-xs text-status-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{readOnlyReason}</span>
        </div>
      )}

      <div className="mx-6 mb-3 grid grid-cols-3 gap-2">
        <StatBox
          label="Admis"
          value={stats.passing}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="success"
        />
        <StatBox
          label="Ajournés"
          value={stats.failing}
          icon={<TrendingDown className="h-4 w-4" />}
          tone="danger"
        />
        <StatBox
          label="Saisies manquantes"
          value={stats.missing}
          icon={<Minus className="h-4 w-4" />}
          tone="warning"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-20">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-popover border-b border-border z-10">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2.5 px-3">Élève</th>
                  <th className="py-2.5 px-3 text-center w-24">Devoir 1</th>
                  <th className="py-2.5 px-3 text-center w-24">Devoir 2</th>
                  <th className="py-2.5 px-3 text-center w-24">
                    Examen (×{recipe.examen || 0})
                  </th>
                  {recipe.cc > 0 && (
                    <th className="py-2.5 px-3 text-center w-24">
                      Contrôle continu (×{recipe.cc})
                    </th>
                  )}
                  <th className="py-2.5 px-3 text-center w-28">Moyenne</th>
                  <th className="py-2.5 px-3 text-center w-24">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const d1 = parseScore(r.d1);
                  const d2 = parseScore(r.d2);
                  const ex = parseScore(r.examen);
                  const ccMark = parseScore(r.cc);
                  const avg = computeSubjectAverageFromRecipe(
                    d1,
                    d2,
                    ex,
                    ccMark,
                    recipe,
                  );
                  const hasInvalid =
                    (r.d1 && d1 == null) ||
                    (r.d2 && d2 == null) ||
                    (r.examen && ex == null) ||
                    (r.cc && ccMark == null);

                  return (
                    <tr key={r.studentId} className="hover:bg-accent/5">
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-[10px]">
                              {r.firstName[0]}
                              {r.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {r.firstName} {r.lastName}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-mono">
                              {r.code}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <ScoreInput
                          value={r.d1}
                          onChange={(v) => updateRow(r.studentId, "d1", v)}
                          invalid={!!r.d1 && d1 == null}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <ScoreInput
                          value={r.d2}
                          onChange={(v) => updateRow(r.studentId, "d2", v)}
                          invalid={!!r.d2 && d2 == null}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <ScoreInput
                          value={r.examen}
                          onChange={(v) => updateRow(r.studentId, "examen", v)}
                          invalid={!!r.examen && ex == null}
                        />
                      </td>
                      {recipe.cc > 0 && (
                        <td className="py-2 px-3">
                          <ScoreInput
                            value={r.cc}
                            onChange={(v) => updateRow(r.studentId, "cc", v)}
                            invalid={!!r.cc && ccMark == null}
                          />
                        </td>
                      )}
                      <td className="py-2 px-3 text-center font-mono font-bold text-sm">
                        {avg == null ? "—" : avg.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {avg == null ? (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        ) : isPassing(avg) ? (
                          <StatusChip label="Admis" tone="success" />
                        ) : (
                          <StatusChip label="Ajourné" tone="danger" />
                        )}
                        {hasInvalid && (
                          <p className="text-[9px] text-status-danger mt-0.5">
                            Invalide (0-20)
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-surface-panel/95 backdrop-blur-sm p-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-mono">
          Formule : Moyenne = (D1×{recipe.devoir1} + D2×{recipe.devoir2} +
          Examen×{recipe.examen}
          {recipe.cc > 0 ? ` + C.Continu×${recipe.cc}` : ""}) /
          {" "}
          {recipe.devoir1 + recipe.devoir2 + recipe.examen + recipe.cc} —
          coefficient {resolved.coefficient}
          {resolved.source === "configuration"
            ? " (configuration de la matière pour cette classe)"
            : resolved.source === "legacy-subject"
              ? " (répertoire matières — configuration à définir)"
              : ""}
        </p>
        <Button onClick={save} disabled={saving || rows.length === 0 || readOnly}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {readOnly ? "Lecture seule" : "Enregistrer les notes"}
        </Button>
      </div>
    </div>
  );
}

function ScoreInput({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="—"
      className={cn(
        "h-8 w-20 mx-auto text-center font-mono text-sm",
        invalid && "border-status-danger focus-visible:ring-status-danger",
      )}
    />
  );
}

function StatBox({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "success" | "danger" | "warning";
}) {
  const toneClass = {
    success: "text-status-success",
    danger: "text-status-danger",
    warning: "text-status-warning",
  }[tone];

  return (
    <div className="rounded-md border border-border p-2 flex items-center gap-2">
      <span className={toneClass}>{icon}</span>
      <div>
        <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-mono font-bold", toneClass)}>{value}</p>
      </div>
    </div>
  );
}
