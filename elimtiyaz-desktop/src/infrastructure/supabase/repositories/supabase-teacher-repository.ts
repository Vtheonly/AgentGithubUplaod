// ============================================================================
// FILE: src/infrastructure/supabase/repositories/supabase-teacher-repository.ts
// ============================================================================
/**
 * SupabaseTeacherRepository — T-408 (SCHED-105).
 *
 * The legacy TeacherRepository contract bridged onto the CANONICAL tables,
 * per SCHED-100's resolution and ADR-020 (no `teachers` table — teacher
 * identity = `personnel` rows):
 *
 *   - Teacher identity/listing  → `personnel` rows with
 *     staff_category = 'teaching' (0009 CHECK family).
 *   - createTeacher             → flip the personnel row to 'teaching'
 *     (audited) — the year-scoped registration the legacy UI asked for has
 *     no canonical table; personnel IS the teacher record.
 *   - Assignments               → `class_subjects` (teacher_id → personnel.id,
 *     scoped to the year through the class's academic_year_id).
 *   - Timetable observers       → the CANONICAL published `timetable_entries`
 *     (0109/0110 — the same schedule the Emploi du temps tab renders; there
 *     is exactly ONE canonical timetable, never a second one).
 *   - Timetable writers + the legacy teacher↔subject qualification links
 *     → honest validation errors pointing at the canonical editors (the
 *     Emploi du temps tab / the class-subjects tab), instead of inventing a
 *     parallel store (the zero-duplication rule, AGENTS §15).
 *
 * BEFORE this, the `teachers` slot stayed on mockRepositories even in
 * Supabase mode: "Ajouter un enseignant" validated the selected personnel
 * id against the MOCK store (a live uuid was always rejected) and even a
 * success would have persisted nothing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior } from "../../mock/subject-behavior";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import type { Observable } from "../../../domain/repository/repository";
import type {
  Teacher,
  TeacherSubjectAssignment,
  TimetableEntry,
  CreateTeacherInput,
  UpdateTeacherInput,
  AssignTeacherSubjectInput,
  CreateTimetableEntryInput,
  UpdateTimetableEntryInput,
} from "../../../domain/model/teacher";
import type { TeacherRepository } from "../../../domain/repository/teacher-repository";

interface PersonnelRow {
  id: string;
  tenant_id: string;
  personnel_code: string;
  first_name: string;
  last_name: string;
  staff_category: string | null;
  is_active: boolean;
  position: string | null;
  created_at: string;
  updated_at: string;
}

interface ClassSubjectRow {
  id: string;
  tenant_id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string | null;
  created_at: string;
  class_academic_year_id?: string;
}

interface EntryRow {
  id: string;
  tenant_id: string;
  academic_year_id: string;
  class_id: string;
  teacher_id: string | null;
  subject_id: string;
  day: string;
  start_minutes: number;
  end_minutes: number;
  room_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class SupabaseTeacherRepository implements TeacherRepository {
  private readonly teachersSubject = new SubjectBehavior<Teacher[]>([]);
  private readonly assignmentsByYear = new SubjectBehavior<
    Map<string, TeacherSubjectAssignment[]>
  >(new Map());
  private readonly timetableByYear = new SubjectBehavior<
    Map<string, TimetableEntry[]>
  >(new Map());
  /** class_id → entries projection cache (for observeTimetableForClass). */
  private readonly timetableByClass = new SubjectBehavior<
    Map<string, TimetableEntry[]>
  >(new Map());
  private readonly yearCodes = new Map<string, string>();
  private loaded = false;

  constructor(private readonly client: SupabaseClient) {
    void this.refreshAll();
  }

  // ========================================================================
  // Teacher CRUD (personnel staff_category = 'teaching')
  // ========================================================================

  observe(): Observable<Teacher[]> {
    return this.teachersSubject;
  }

  observeById(id: string): Observable<Teacher | null> {
    const sub = new SubjectBehavior<Teacher | null>(null);
    this.teachersSubject.subscribe((teachers) => {
      sub.set(teachers.find((t) => t.id === id) ?? null);
    });
    return sub;
  }

  observeByAcademicYear(academicYearId: string): Observable<Teacher[]> {
    // Personnel is year-agnostic — every active teaching member is a teacher
    // of the requested year; the derived rows carry the year context.
    const sub = new SubjectBehavior<Teacher[]>([]);
    this.teachersSubject.subscribe((teachers) => {
      sub.set(
        teachers
          .filter((t) => t.status === "active")
          .map((t) => ({ ...t, academicYearId, academicYearCode: this.yearCodes.get(academicYearId) ?? t.academicYearCode })),
      );
    });
    return sub;
  }

  observeByPersonnel(personnelId: string): Observable<Teacher[]> {
    const sub = new SubjectBehavior<Teacher[]>([]);
    this.teachersSubject.subscribe((teachers) => {
      sub.set(teachers.filter((t) => t.personnelId === personnelId));
    });
    return sub;
  }

  async getById(id: string): Promise<Result<Teacher>> {
    await this.ensureLoaded();
    const teacher = this.teachersSubject.get().find((t) => t.id === id);
    if (!teacher) return Err(Errors.notFound("Teacher", id));
    return Ok(teacher);
  }

  async createTeacher(
    input: CreateTeacherInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<Teacher>> {
    if (!isUuid(input.personnelId)) {
      return Err(
        Errors.validation(
          "createTeacher: the personnel id must be a Supabase uuid",
          "Membre du personnel introuvable (identifiant invalide).",
        ),
      );
    }
    const tenantId = getTenantId();
    if (!tenantId) {
      return Err(
        Errors.validation(
          "createTeacher: no active tenant context",
          "Aucun établissement actif — sélectionnez un établissement ou reconnectez-vous.",
        ),
      );
    }

    // Read the personnel row first so a bad id fails honestly (notFound,
    // not a silent 0-row update).
    const { data: existing, error: fetchError } = await this.client
      .from("personnel")
      .select("id, personnel_code, first_name, last_name, staff_category, is_active, position")
      .eq("id", input.personnelId)
      .maybeSingle();
    if (fetchError) return Err(supabaseErrorToAppError(fetchError));
    if (!existing) {
      return Err(
        Errors.notFound("Personnel", input.personnelId),
      );
    }

    // The canonical registration: flag the person as teaching staff.
    // Idempotent — re-registering an already-teaching member is a no-op.
    if (existing.staff_category !== "teaching" || !existing.is_active) {
      const patch: Record<string, unknown> = {
        staff_category: "teaching",
        updated_at: new Date().toISOString(),
      };
      if (!existing.is_active) patch.is_active = true;
      if (!existing.position) patch.position = "Enseignant";
      const { data: updated, error: updateError } = await this.client
        .from("personnel")
        .update(patch)
        .eq("id", input.personnelId)
        .select("id, personnel_code, first_name, last_name, staff_category, is_active, position, created_at, updated_at, tenant_id")
        .single();
      if (updateError) return Err(supabaseErrorToAppError(updateError));
      await this.audit(
        "teacher.create",
        input.personnelId,
        actorId,
        actorName,
        { after: { staff_category: "teaching", position: updated.position } },
        `Enseignant enregistré (${input.code})`,
      );
      await this.refreshAll();
      const teacher = this.deriveTeacher(
        updated as unknown as PersonnelRow,
        input.academicYearId,
      );
      return Ok(teacher);
    }

    await this.ensureLoaded();
    const teacher = this.teachersSubject
      .get()
      .find((t) => t.personnelId === input.personnelId);
    return Ok(
      teacher ??
        this.deriveTeacher(
          existing as unknown as PersonnelRow,
          input.academicYearId,
        ),
    );
  }

  async updateTeacher(
    id: string,
    input: UpdateTeacherInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<Teacher>> {
    if (input.maxWeeklyHours !== undefined || input.qualifiedSubjectIds !== undefined) {
      return Err(
        Errors.validation(
          "updateTeacher: maxWeeklyHours/qualifiedSubjectIds have no personnel column",
          "Le volume horaire et les matières qualifiées ne sont pas stockés sur le personnel — assignez l'enseignant à des classes via l'onglet Matières-Classes.",
        ),
      );
    }
    if (input.status === undefined) {
      return Err(
        Errors.validation(
          "updateTeacher: nothing to update",
          "Aucune modification demandée.",
        ),
      );
    }
    if (!isUuid(id)) {
      return Err(Errors.notFound("Teacher", id));
    }
    const isActive = input.status === "active";
    const { data, error } = await this.client
      .from("personnel")
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, personnel_code, first_name, last_name, staff_category, is_active, position, created_at, updated_at, tenant_id")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.audit(
      "teacher.update",
      id,
      actorId,
      actorName,
      { after: { is_active: isActive, status: input.status } },
      null,
    );
    await this.refreshAll();
    const teacher = this.teachersSubject.get().find((t) => t.id === id);
    return Ok(
      teacher ?? this.deriveTeacher(data as unknown as PersonnelRow, ""),
    );
  }

  async deleteTeacher(
    id: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<void>> {
    if (!isUuid(id)) return Err(Errors.notFound("Teacher", id));
    // Referential safety: never un-teach a member still assigned to classes.
    const { count, error: countError } = await this.client
      .from("class_subjects")
      .select("id", { count: "exact", head: true })
      .eq("teacher_id", id);
    if (countError) return Err(supabaseErrorToAppError(countError));
    if ((count ?? 0) > 0) {
      return Err(
        Errors.conflict(
          `teacher still assigned to ${count} class-subject(s)`,
          "Cet enseignant est encore assigné à des matières de classes — réassignez-les d'abord (onglet Matières-Classes).",
        ),
      );
    }
    const { error } = await this.client
      .from("personnel")
      .update({
        staff_category: "support",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return Err(supabaseErrorToAppError(error));
    await this.audit(
      "teacher.delete",
      id,
      actorId,
      actorName,
      { after: { staff_category: "support" } },
      "Retiré du corps enseignant (le membre du personnel est conservé)",
    );
    await this.refreshAll();
    return Ok(undefined);
  }

  // ========================================================================
  // Teacher ↔ Subject assignments (class_subjects derived)
  // ========================================================================

  observeAssignments(teacherId: string): Observable<TeacherSubjectAssignment[]> {
    const sub = new SubjectBehavior<TeacherSubjectAssignment[]>([]);
    this.assignmentsByYear.subscribe((byYear) => {
      const all: TeacherSubjectAssignment[] = [];
      byYear.forEach((list) => all.push(...list));
      sub.set(all.filter((a) => a.teacherId === teacherId));
    });
    return sub;
  }

  observeAssignmentsBySubject(
    subjectId: string,
  ): Observable<TeacherSubjectAssignment[]> {
    const sub = new SubjectBehavior<TeacherSubjectAssignment[]>([]);
    this.assignmentsByYear.subscribe((byYear) => {
      const all: TeacherSubjectAssignment[] = [];
      byYear.forEach((list) => all.push(...list));
      sub.set(all.filter((a) => a.subjectId === subjectId));
    });
    return sub;
  }

  observeAssignmentsByAcademicYear(
    academicYearId: string,
  ): Observable<TeacherSubjectAssignment[]> {
    const sub = new SubjectBehavior<TeacherSubjectAssignment[]>(
      this.assignmentsByYear.get().get(academicYearId) ?? [],
    );
    this.assignmentsByYear.subscribe((byYear) => {
      sub.set(byYear.get(academicYearId) ?? []);
    });
    return sub;
  }

  async assignSubject(
    _input: AssignTeacherSubjectInput,
    _actorId: string,
    _actorName: string,
  ): Promise<Result<TeacherSubjectAssignment>> {
    // The canonical teacher↔subject link is the class-subject assignment
    // (class_subjects.teacher_id) — a bare year-scoped qualification row has
    // no canonical home and would be a parallel store (zero-duplication).
    return Err(
      Errors.validation(
        "assignSubject: the canonical assignment path is class-subjects",
        "L'assignation canonique se fait par classe : Pédagogie → Matières-Classes (ou le dialogue « Assigner à une classe »).",
      ),
    );
  }

  async unassignSubject(
    assignmentId: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<void>> {
    // The underlying row is a class_subjects row — detach the teacher from
    // it (keep the curriculum row itself; removing a subject from a class is
    // the class-subjects tab's job).
    const { data, error } = await this.client
      .from("class_subjects")
      .update({ teacher_id: null, updated_at: new Date().toISOString() })
      .eq("id", assignmentId)
      .select("id")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.audit(
      "teacher.unassignSubject",
      assignmentId,
      actorId,
      actorName,
      { after: { teacher_id: null } },
      null,
    );
    await this.refreshAll();
    return Ok(undefined);
  }

  // ========================================================================
  // Timetable — READ the canonical published schedule (0109/0110)
  // ========================================================================

  observeTimetableForClass(
    classId: string,
    academicYearId: string,
  ): Observable<TimetableEntry[]> {
    const sub = new SubjectBehavior<TimetableEntry[]>(
      this.timetableByClass.get().get(classId) ?? [],
    );
    this.timetableByYear.subscribe((byYear) => {
      const entries = byYear.get(academicYearId) ?? [];
      sub.set(entries.filter((e) => e.classId === classId));
    });
    return sub;
  }

  observeTimetableForTeacher(
    teacherId: string,
    academicYearId: string,
  ): Observable<TimetableEntry[]> {
    const sub = new SubjectBehavior<TimetableEntry[]>([]);
    this.timetableByYear.subscribe((byYear) => {
      const entries = byYear.get(academicYearId) ?? [];
      sub.set(entries.filter((e) => e.teacherId === teacherId));
    });
    return sub;
  }

  observeTimetableByAcademicYear(
    academicYearId: string,
  ): Observable<TimetableEntry[]> {
    const sub = new SubjectBehavior<TimetableEntry[]>(
      this.timetableByYear.get().get(academicYearId) ?? [],
    );
    this.timetableByYear.subscribe((byYear) => {
      sub.set(byYear.get(academicYearId) ?? []);
    });
    return sub;
  }

  async createTimetableEntry(
    _input: CreateTimetableEntryInput,
    _actorId: string,
    _actorName: string,
  ): Promise<Result<TimetableEntry>> {
    return Err(
      Errors.validation(
        "createTimetableEntry: the canonical editor is the Emploi du temps tab",
        "L'édition de l'emploi du temps se fait dans l'onglet Emploi du temps (génération + ajustements validés en direct).",
      ),
    );
  }

  async updateTimetableEntry(
    _id: string,
    _input: UpdateTimetableEntryInput,
    _actorId: string,
    _actorName: string,
  ): Promise<Result<TimetableEntry>> {
    return Err(
      Errors.validation(
        "updateTimetableEntry: the canonical editor is the Emploi du temps tab",
        "L'édition de l'emploi du temps se fait dans l'onglet Emploi du temps (génération + ajustements validés en direct).",
      ),
    );
  }

  async deleteTimetableEntry(
    _id: string,
    _actorId: string,
    _actorName: string,
  ): Promise<Result<void>> {
    return Err(
      Errors.validation(
        "deleteTimetableEntry: the canonical editor is the Emploi du temps tab",
        "L'édition de l'emploi du temps se fait dans l'onglet Emploi du temps (génération + ajustements validés en direct).",
      ),
    );
  }

  // ========================================================================
  // Internals
  // ========================================================================

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.refreshAll();
  }

  private async refreshAll(): Promise<void> {
    this.loaded = true;
    try {
      await Promise.all([
        this.refreshTeachers(),
        this.refreshAssignments(),
        this.refreshTimetable(),
      ]);
    } catch {
      // Silently keep the current cache — the UI shows the empty state.
    }
  }

  private async refreshTeachers(): Promise<void> {
    const { data } = await this.client
      .from("personnel")
      .select(
        "id, tenant_id, personnel_code, first_name, last_name, staff_category, is_active, position, created_at, updated_at",
      )
      .eq("staff_category", "teaching")
      .is("deleted_at", null)
      .order("last_name");
    if (!data) return;
    const years = await this.loadYearCodes();
    const currentYearId = years.find((y) => y.isCurrent)?.id ?? "";
    this.teachersSubject.set(
      (data as unknown as PersonnelRow[]).map((row) =>
        this.deriveTeacher(row, currentYearId),
      ),
    );
  }

  private async refreshAssignments(): Promise<void> {
    // class_subjects joined with classes for the year scope.
    const { data } = await this.client
      .from("class_subjects")
      .select("id, tenant_id, class_id, subject_id, teacher_id, created_at, classes(academic_year_id)")
      .not("teacher_id", "is", null)
      .order("created_at");
    if (!data) return;
    const byYear = new Map<string, TeacherSubjectAssignment[]>();
    const seen = new Set<string>();
    for (const raw of data as unknown as (ClassSubjectRow & {
      classes: { academic_year_id: string } | null;
    })[]) {
      const yearId = raw.classes?.academic_year_id ?? "unknown";
      const teacherId = raw.teacher_id as string;
      // Distinct (teacher, subject) pairs per year — class_subjects rows are
      // per-class; the legacy assignment view is the qualification view.
      const key = `${yearId}:${teacherId}:${raw.subject_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = byYear.get(yearId) ?? [];
      list.push({
        id: raw.id,
        tenantId: raw.tenant_id,
        teacherId,
        subjectId: raw.subject_id,
        academicYearId: yearId,
        isPrimary: true,
        createdAt: raw.created_at,
      });
      byYear.set(yearId, list);
    }
    this.assignmentsByYear.set(byYear);
  }

  private async refreshTimetable(): Promise<void> {
    // The canonical PUBLISHED version per academic year (0110 exposes
    // published versions to every tenant-authenticated account).
    const { data: versions } = await this.client
      .from("timetable_versions")
      .select("id, academic_year_id")
      .eq("status", "published");
    if (!versions || versions.length === 0) {
      this.timetableByYear.set(new Map());
      this.timetableByClass.set(new Map());
      return;
    }
    const versionIds = versions.map((v) => v.id);
    const yearByVersion = new Map(
      versions.map((v) => [v.id as string, v.academic_year_id as string]),
    );
    const { data: entries } = await this.client
      .from("timetable_entries")
      .select("*")
      .in("version_id", versionIds)
      .order("period_index");
    if (!entries) return;
    const { data: rooms } = await this.client
      .from("rooms")
      .select("id, name");
    const roomLabels = new Map<string, string>(
      (rooms ?? []).map((r: { id: string; name: string | null }) => [
        r.id,
        r.name ?? "",
      ]),
    );
    const byYear = new Map<string, TimetableEntry[]>();
    const byClass = new Map<string, TimetableEntry[]>();
    for (const raw of entries as unknown as (EntryRow & {
      version_id: string;
    })[]) {
      const entry = this.mapEntry(raw, roomLabels);
      const year = yearByVersion.get(raw.version_id) ?? entry.academicYearId;
      const yearList = byYear.get(year) ?? [];
      yearList.push(entry);
      byYear.set(year, yearList);
      const classList = byClass.get(entry.classId) ?? [];
      classList.push(entry);
      byClass.set(entry.classId, classList);
    }
    this.timetableByYear.set(byYear);
    this.timetableByClass.set(byClass);
  }

  private mapEntry(
    raw: EntryRow,
    roomLabels: Map<string, string>,
  ): TimetableEntry {
    return {
      id: raw.id,
      tenantId: raw.tenant_id,
      academicYearId: raw.academic_year_id,
      classId: raw.class_id,
      teacherId: raw.teacher_id ?? "",
      subjectId: raw.subject_id,
      // Canonical days include sunday/saturday (the real Algerian week,
      // SCHED-102) — the legacy union is a display-only projection.
      day: raw.day as TimetableEntry["day"],
      startMinutes: raw.start_minutes,
      endMinutes: raw.end_minutes,
      room: raw.room_id ? (roomLabels.get(raw.room_id) ?? null) : null,
      notes: raw.notes,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  private deriveTeacher(row: PersonnelRow, academicYearId: string): Teacher {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personnelId: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      code: row.personnel_code,
      academicYearId,
      academicYearCode: this.yearCodes.get(academicYearId) ?? "",
      status: row.is_active ? "active" : "inactive",
      maxWeeklyHours: 18,
      qualifiedSubjectIds: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private yearCache: { id: string; code: string; isCurrent: boolean }[] = [];

  private async loadYearCodes(): Promise<
    { id: string; code: string; isCurrent: boolean }[]
  > {
    const { data } = await this.client
      .from("academic_years")
      .select("id, code, label, is_current");
    if (data) {
      this.yearCache = data.map(
        (y: { id: string; code: string | null; label: string; is_current: boolean }) => ({
          id: y.id,
          code: y.code ?? y.label,
          isCurrent: y.is_current,
        }),
      );
      for (const y of this.yearCache) this.yearCodes.set(y.id, y.code);
    }
    return this.yearCache;
  }

  private async audit(
    action: string,
    entityId: string,
    actorId: string,
    actorName: string,
    after: Record<string, unknown> | null,
    note: string | null,
  ): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) return;
    await this.client.rpc("write_audit_log", {
      p_tenant_id: tenantId,
      p_action: action,
      p_entity_type: "teacher",
      p_entity_id: isUuid(entityId) ? entityId : null,
      p_actor_id: isUuid(actorId) ? actorId : null,
      p_actor_name: actorName,
      p_after_json: after,
      p_note: note,
    });
  }
}
