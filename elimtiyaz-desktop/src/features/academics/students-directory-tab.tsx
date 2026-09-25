// ============================================================================
// FILE: src/features/academics/students-directory-tab.tsx
// ============================================================================
/**
 * StudentsDirectoryTab — the Pedagogy (Pédagogie) student search surface
 * (T-413 / the "student search in the Pedagogy section" mandate).
 *
 * THE DEFECT THIS CLOSES: an approved student existed in the central
 * `students` table but the Pedagogy section had NO student search at all —
 * the only student lists lived in CRM and the Cmd+K palette. An admin
 * looking for a student "in Pedagogy" found nothing (the owner's reported
 * "approved and given portal access but cannot subsequently be found in
 * the student-management/Pedagogy area").
 *
 * THE CONTRACT:
 *   - Search the CANONICAL student records — `repos.students` (the same
 *     repository the CRM table consumes; in Supabase mode the same
 *     `students` table row set). NEVER a local/mock dataset.
 *   - Identifiers: name (first/last/display), ELV code, the family name,
 *     and the class name.
 *   - Filters: grade level + class.
 *   - Each row carries the standardized 3-dot StudentActionsMenu (the
 *     cross-section "Open in…" navigation).
 *   - Deep link: `/academics?studentId=…` opens this tab with the student
 *     selected (the StudentActionsMenu's "Ouvrir dans Pédagogie" target).
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { StudentActionsMenu } from "../../shared/ui/student-actions-menu";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Badge } from "../../shared/ui/badge";
import { EmptyState } from "../../shared/layout/state-views";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../shared/ui/select";
import {
  Search,
  GraduationCap,
  School,
  Users,
  X,
} from "lucide-react";
import {
  studentDisplayName,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS_FR,
  type Student,
} from "../../domain/model/student";
import { parentDisplayName, type Parent } from "../../domain/model/parent";
import type { AcademicClass } from "../../domain/model/academic";

export function StudentsDirectoryTab({
  /** The deep-linked student (the "Open in Pédagogie" target). */
  initialStudentId,
}: {
  initialStudentId?: string | null;
} = {}) {
  const repos = useRepositories();
  const students = useObservable(() => repos.students.observe(), []) ?? [];
  const parents = useObservable(() => repos.parents.observe(), []) ?? [];
  const classes = useObservable(() => repos.classes.observe(), []) ?? [];

  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    initialStudentId ?? null,
  );

  const parentById = useMemo(() => {
    const map = new Map<string, Parent>();
    for (const p of parents) map.set(p.id, p);
    return map;
  }, [parents]);

  const classById = useMemo(() => {
    const map = new Map<string, AcademicClass>();
    for (const c of classes) map.set(c.id, c);
    return map;
  }, [classes]);

  // The canonical search: name + ELV code + family name + class name —
  // ALL from the repositories (zero local datasets).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      if (levelFilter !== "all" && s.gradeLevel !== levelFilter) return false;
      if (classFilter !== "all" && s.classId !== classFilter) return false;
      if (!q) return true;
      const parent = s.parentId ? parentById.get(s.parentId) : undefined;
      const cls = s.classId ? classById.get(s.classId) : undefined;
      return (
        studentDisplayName(s).toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (parent ? parentDisplayName(parent).toLowerCase().includes(q) : false) ||
        (cls ? (cls.name ?? cls.code).toLowerCase().includes(q) : false) ||
        s.gradeLevel.toLowerCase().includes(q)
      );
    });
  }, [students, query, levelFilter, classFilter, parentById, classById]);

  const selectedStudent = selectedStudentId
    ? (students.find((s) => s.id === selectedStudentId) ?? null)
    : null;

  // Consume the deep link once, then clean the param (the /crm convention).
  useMemo(() => {
    const sid = searchParams.get("studentId");
    if (sid) {
      setSelectedStudentId(sid);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("studentId");
          return next;
        },
        { replace: true },
      );
    }
    return null;
  }, [searchParams, setSearchParams]);

  function resetFilters() {
    setQuery("");
    setLevelFilter("all");
    setClassFilter("all");
  }

  const hasActiveFilter =
    query.trim() !== "" || levelFilter !== "all" || classFilter !== "all";

  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un élève (nom, code ELV, famille, classe)…"
            className="pl-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Effacer la recherche"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les niveaux</SelectItem>
              {GRADE_LEVELS.map((g) => (
                <SelectItem key={g} value={g}>
                  {GRADE_LEVEL_LABELS_FR[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les classes</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name ?? c.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasActiveFilter && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Réinitialiser
            </Button>
          )}
        </div>
      </div>

      {/* Result count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} élève(s) — dossier central (recherche canonique :
        nom, code, famille, classe).
      </p>

      {/* The selected student panel (the deep-link landing state) */}
      {selectedStudent && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm font-semibold truncate">
                  {studentDisplayName(selectedStudent)}
                </p>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {selectedStudent.code}
                </Badge>
                {selectedStudent.gradeLevel && (
                  <Badge variant="outline" className="text-[10px]">
                    {GRADE_LEVEL_LABELS_FR[selectedStudent.gradeLevel] ??
                      selectedStudent.gradeLevel}
                  </Badge>
                )}
                {selectedStudent.classId &&
                  classById.get(selectedStudent.classId) && (
                    <Badge variant="outline" className="text-[10px]">
                      <School className="h-3 w-3 mr-1" />
                      {classById.get(selectedStudent.classId)!.name ??
                        classById.get(selectedStudent.classId)!.code}
                    </Badge>
                  )}
                {selectedStudent.parentId && parentById.get(selectedStudent.parentId) && (
                  <Badge variant="outline" className="text-[10px]">
                    <Users className="h-3 w-3 mr-1" />
                    {parentDisplayName(
                      parentById.get(selectedStudent.parentId)!,
                    )}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <StudentActionsMenu
                student={selectedStudent}
                parentName={
                  selectedStudent.parentId
                    ? parentById.get(selectedStudent.parentId)
                      ? parentDisplayName(parentById.get(selectedStudent.parentId)!)
                      : null
                    : null
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSelectedStudentId(null)}
                aria-label="Fermer le dossier sélectionné"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Results table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-12 w-12" />}
          title="Aucun élève trouvé"
          description={
            hasActiveFilter
              ? "Aucun élève du dossier central ne correspond à ces critères."
              : "Le dossier central ne contient aucun élève actif."
          }
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2.5">Élève</th>
                  <th className="text-left font-medium px-3 py-2.5 hidden md:table-cell">
                    Code
                  </th>
                  <th className="text-left font-medium px-3 py-2.5 hidden lg:table-cell">
                    Niveau
                  </th>
                  <th className="text-left font-medium px-3 py-2.5 hidden lg:table-cell">
                    Classe
                  </th>
                  <th className="text-left font-medium px-3 py-2.5 hidden xl:table-cell">
                    Famille
                  </th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.slice(0, 200).map((s) => (
                  <StudentRow
                    key={s.id}
                    student={s}
                    parent={
                      s.parentId ? parentById.get(s.parentId) : undefined
                    }
                    cls={s.classId ? classById.get(s.classId) : undefined}
                    selected={s.id === selectedStudentId}
                    onSelect={() =>
                      setSelectedStudentId(s.id === selectedStudentId ? null : s.id)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 200 && (
            <p className="px-3 py-2 text-xs text-muted-foreground bg-muted/30">
              200 premiers résultats affichés — affinez la recherche.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StudentRow({
  student,
  parent,
  cls,
  selected,
  onSelect,
}: {
  student: Student;
  parent?: Parent;
  cls?: AcademicClass;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      className={selected ? "bg-primary/5" : "hover:bg-accent/5 cursor-pointer"}
      onClick={onSelect}
    >
      <td className="px-3 py-2.5">
        <span className="font-medium">{studentDisplayName(student)}</span>
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        <span className="font-mono text-xs text-muted-foreground">
          {student.code}
        </span>
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell">
        <Badge variant="outline" className="text-[10px]">
          {GRADE_LEVEL_LABELS_FR[student.gradeLevel] ?? student.gradeLevel}
        </Badge>
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell">
        {cls ? (
          <span className="text-xs text-muted-foreground">
            {cls.name ?? cls.code}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 hidden xl:table-cell">
        {parent ? (
          <span className="text-xs text-muted-foreground">
            {parentDisplayName(parent)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
        <StudentActionsMenu student={student} parentName={parent ? parentDisplayName(parent) : null} />
      </td>
    </tr>
  );
}
