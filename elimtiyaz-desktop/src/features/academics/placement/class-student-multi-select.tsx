// ============================================================================
// FILE: src/features/academics/placement/class-student-multi-select.tsx
// ============================================================================
// T-474 — the owner's class-roster mandate: the student multi-select shared
// by the class CREATION modal (grade-levels-class-view) and the class EDIT
// modal (class-detail-page).
//
// Design notes (the reuse-first rule, AGENTS.md §6/§9):
//   - The PERSISTENCE seam is the surface's own existing call:
//     `repos.students.updateStudent(id, { classId })` — the exact call the
//     class-detail page's single-student « Ajouter un élève » dialog already
//     makes (and `classId: null` for unassignment, symmetric). The atomic
//     `finalizePlacements` RPC was evaluated and deliberately NOT used: it
//     cannot express UNASSIGNMENT, and it is year-transition-oriented (it
//     rewrites gradeLevel/level/gradeYear per assignment) — the mid-year
//     roster edit needs assign AND remove symmetrically.
//   - The ELIGIBILITY default follows the owner's words ("students currently
//     associated with the relevant academic year and who are eligible for
//     that class"): active students whose gradeLevel matches the class's
//     grade. A « show all students » toggle widens the pool to every active
//     student (the existing single-add dialog's permissiveness — a school
//     may place a student ahead of/below their nominal grade).
//   - Students already assigned to ANOTHER class stay listed (with their
//     current class shown as a badge) so the operator can MOVE them; the
//     students of the class being EDITED are pre-checked by the caller.
// ============================================================================
import { useMemo, useState } from "react";
import { Search, UserCheck, Users } from "lucide-react";
import { Input } from "../../../shared/ui/input";
import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { cn } from "../../../shared/ui/cn";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { GRADE_LEVEL_LABELS_FR, type GradeLevel, type Student } from "../../../domain/model/student";

export interface ClassStudentMultiSelectProps {
  /** The class's grade level — the default eligibility filter. */
  readonly gradeCode: GradeLevel;
  /**
   * The class being EDITED (null on the create modal). Its current members
   * are always listed (even if the grade filter changed under them) and the
   * caller pre-checks them; also used to badge « this class » rows.
   */
  readonly currentClassId?: string | null;
  /** The class's display name (edit mode: badges; create mode: hints). */
  readonly currentClassName?: string | null;
  /** The selected student ids (controlled). */
  readonly selectedIds: ReadonlySet<string>;
  /** Controlled toggle. */
  readonly onToggle: (studentId: string) => void;
  /** Replace the whole selection (select-all / clear). */
  readonly onReplaceSelection: (studentIds: readonly string[]) => void;
  /** Height cap for the scrollable list (Tailwind max-h-* class). */
  readonly listMaxHeightClass?: string;
}

interface StudentRow {
  readonly student: Student;
  readonly className: string | null;
  readonly isCurrentClassMember: boolean;
}

export function ClassStudentMultiSelect({
  gradeCode,
  currentClassId = null,
  currentClassName = null,
  selectedIds,
  onToggle,
  onReplaceSelection,
  listMaxHeightClass = "max-h-64",
}: ClassStudentMultiSelectProps) {
  const repos = useRepositories();
  const allStudents = useObservable(() => repos.students.observe(), []) ?? [];
  const allClasses = useObservable(() => repos.classes.observe(), []) ?? [];
  const [query, setQuery] = useState("");
  const [showAllGrades, setShowAllGrades] = useState(false);

  const classById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of allClasses) map.set(c.id, c.name);
    return map;
  }, [allClasses]);

  // The candidate pool: active students, grade-eligible by default (the
  // owner's "eligible for that class"), widened by the explicit toggle.
  // The EDITED class's own members are ALWAYS in the pool — the grade filter
  // must never hide the pre-checked roster (the caller's diff would then
  // read them as "removed").
  const candidates = useMemo<StudentRow[]>(() => {
    const rows: StudentRow[] = [];
    for (const s of allStudents) {
      if (s.status !== "active") continue;
      const isMember = currentClassId != null && s.classId === currentClassId;
      const gradeEligible = s.gradeLevel === gradeCode;
      if (!gradeEligible && !isMember && !showAllGrades) continue;
      rows.push({
        student: s,
        className: s.classId ? (classById.get(s.classId) ?? null) : null,
        isCurrentClassMember: isMember,
      });
    }
    rows.sort((a, b) => {
      // Current members first, then alphabetical — the operator's eye lands
      // on the roster they are editing before the candidates.
      if (a.isCurrentClassMember !== b.isCurrentClassMember) {
        return a.isCurrentClassMember ? -1 : 1;
      }
      const byLast = a.student.lastName.localeCompare(b.student.lastName, "fr");
      if (byLast !== 0) return byLast;
      return a.student.firstName.localeCompare(b.student.firstName, "fr");
    });
    return rows;
  }, [allStudents, gradeCode, currentClassId, showAllGrades, classById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((r) => {
      const s = r.student;
      return (
        s.firstName.toLowerCase().includes(q) ||
        s.lastName.toLowerCase().includes(q) ||
        (s.displayName ?? "").toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q)
      );
    });
  }, [candidates, query]);

  const selectedCount = selectedIds.size;
  const filteredSelectedCount = filtered.filter((r) =>
    selectedIds.has(r.student.id),
  ).length;

  return (
    <div className="space-y-2" data-testid="class-student-multi-select">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Users className="h-3.5 w-3.5 text-primary" />
          Élèves de la classe
          <Badge
            variant="secondary"
            className="font-mono text-[10px] px-1.5 py-0"
            data-testid="class-student-selected-count"
          >
            {selectedCount} sélectionné{selectedCount > 1 ? "s" : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {filtered.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() =>
                onReplaceSelection(
                  filteredSelectedCount === filtered.length
                    ? // Everything visible is already selected → clear the VISIBLE selection only
                      [...selectedIds].filter(
                        (id) =>
                          !filtered.some((r) => r.student.id === id),
                      )
                    : filtered.map((r) => r.student.id),
                )
              }
              data-testid="class-student-select-all"
            >
              <UserCheck className="h-3 w-3 mr-1" />
              {filteredSelectedCount === filtered.length
                ? "Aucun (visible)"
                : "Tout (visible)"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 px-2 text-[11px]",
              showAllGrades && "text-primary",
            )}
            onClick={() => setShowAllGrades((v) => !v)}
            data-testid="class-student-grade-filter-toggle"
          >
            {showAllGrades
              ? `Filtre : tous les niveaux`
              : `Filtre : ${GRADE_LEVEL_LABELS_FR[gradeCode] ?? gradeCode}`}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher par nom ou code (ELV-…)"
          className="pl-8 h-8 text-xs"
          data-testid="class-student-search"
        />
      </div>

      <div
        className={cn(
          "border border-border rounded-lg divide-y divide-border overflow-y-auto bg-background",
          listMaxHeightClass,
        )}
        role="group"
        aria-label="Élèves éligibles"
      >
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {query
              ? "Aucun élève ne correspond à la recherche."
              : showAllGrades
                ? "Aucun élève actif dans l'établissement."
                : `Aucun élève actif au niveau « ${GRADE_LEVEL_LABELS_FR[gradeCode] ?? gradeCode} » — élargissez avec le filtre « tous les niveaux ».`}
          </p>
        ) : (
          filtered.map(({ student: s, className, isCurrentClassMember }) => {
            const checked = selectedIds.has(s.id);
            return (
              <label
                key={s.id}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 cursor-pointer transition-colors select-none",
                  checked ? "bg-primary/5" : "hover:bg-accent/5",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(s.id)}
                  className="h-4 w-4 shrink-0 accent-primary cursor-pointer"
                  data-testid={`class-student-checkbox-${s.id}`}
                />
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    isCurrentClassMember
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.firstName[0]}
                  {s.lastName[0]}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium text-foreground truncate">
                    {s.firstName} {s.lastName}
                    {isCurrentClassMember && (
                      <span className="ml-1.5 text-[10px] font-normal text-primary">
                        (dans cette classe)
                      </span>
                    )}
                  </span>
                  <span className="block text-[10px] text-muted-foreground font-mono truncate">
                    {s.code} · {GRADE_LEVEL_LABELS_FR[s.gradeLevel] ?? s.gradeLevel}
                  </span>
                </span>
                {className && !isCurrentClassMember && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 max-w-28 truncate shrink-0"
                    title={`Classe actuelle : ${className}`}
                  >
                    {className}
                  </Badge>
                )}
              </label>
            );
          })
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {currentClassId
          ? "Décochez un élève pour le retirer de la classe à l'enregistrement ; cochez pour l'affecter (un élève déjà placé ailleurs sera déplacé)."
          : "Les élèves cochés seront affectés à la nouvelle classe dès sa création (un élève déjà placé ailleurs sera déplacé)."}
      </p>
    </div>
  );
}
