/**
 * Mock TeacherRepository — implements the normalized Teacher entity.
 *
 * Referential integrity:
 *   - createTeacher checks that personnelId exists in store.personnel
 *     and has staffCategory "teacher"
 *   - assignSubject checks that the teacher + subject exist in the same year
 *   - createTimetableEntry detects conflicts (same teacher/class, overlapping time)
 *
 * Academic year scoping:
 *   All queries are scoped by academicYearId to ensure data isolation.
 */
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
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
import type { Observable } from "../../../domain/repository/repository";
import { SubjectBehavior } from "../subject-behavior";
import {
  validateCreateTeacherInput,
  validateUpdateTeacherInput,
  canCreateTeacher,
  checkDuplicateTeacherCode,
  checkDuplicateTeacherForYear,
  validateAssignTeacherSubjectInput,
  checkDuplicateAssignment,
  checkPrimaryTeacherConflict,
  validateCreateTimetableEntryInput,
  validateUpdateTimetableEntryInput,
  detectTimetableConflict,
} from "../../../domain/calc/teacher/validation";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export class MockTeacherRepository implements TeacherRepository {
  // ---- Teacher CRUD ----
  observe(): Observable<Teacher[]> {
    return store.teachers$;
  }

  observeById(id: string): Observable<Teacher | null> {
    return new SubjectBehavior(store.teachers.find((t) => t.id === id) ?? null);
  }

  observeByAcademicYear(academicYearId: string): Observable<Teacher[]> {
    return new SubjectBehavior(
      store.teachers.filter((t) => t.academicYearId === academicYearId),
    );
  }

  observeByPersonnel(personnelId: string): Observable<Teacher[]> {
    return new SubjectBehavior(
      store.teachers.filter((t) => t.personnelId === personnelId),
    );
  }

  async getById(id: string): Promise<Result<Teacher>> {
    await delay(50);
    const t = store.teachers.find((t) => t.id === id);
    if (!t) return Err(Errors.notFound("Teacher", id));
    return Ok(t);
  }

  async createTeacher(
    input: CreateTeacherInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<Teacher>> {
    await delay(150);
    const validation = validateCreateTeacherInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }

    // Check personnel exists and is a teacher
    const personnel = store.personnel.find((p) => p.id === input.personnelId);
    const personnelIsTeacher = !!personnel && personnel.staffCategory === "teacher";
    const canCreate = canCreateTeacher(!!personnel, personnelIsTeacher);
    if (!canCreate.isValid) {
      return Err(Errors.validation(canCreate.errors.join(" "), canCreate.errors.join(" ")));
    }

    // Check duplicate code
    const dupCode = checkDuplicateTeacherCode(input.code, store.teachers);
    if (!dupCode.isValid) {
      return Err(Errors.validation(dupCode.errors.join(" "), dupCode.errors.join(" ")));
    }

    // Check duplicate person+year
    const dupYear = checkDuplicateTeacherForYear(
      input.personnelId,
      input.academicYearId,
      store.teachers,
    );
    if (!dupYear.isValid) {
      return Err(Errors.validation(dupYear.errors.join(" "), dupYear.errors.join(" ")));
    }

    const teacher: Teacher = {
      id: genId("tch"),
      tenantId: TENANT_ID,
      personnelId: input.personnelId,
      firstName: personnel!.firstName,
      lastName: personnel!.lastName,
      code: input.code,
      academicYearId: input.academicYearId,
      academicYearCode: input.academicYearCode,
      status: input.status ?? "active",
      maxWeeklyHours: input.maxWeeklyHours ?? 20,
      qualifiedSubjectIds: input.qualifiedSubjectIds ?? [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store.teachers = [...store.teachers, teacher];
    store.notifyTeachers();

    appendAudit({
      action: AuditActions.ClassCreate, // reuse — no dedicated teacher audit action yet
      entityType: "teacher",
      entityId: teacher.id,
      actorId,
      actorName,
      diff: { before: null, after: { code: teacher.code, personnelId: teacher.personnelId } },
      note: `Enseignant créé : ${teacher.firstName} ${teacher.lastName} (${teacher.code})`,
    });

    return Ok(teacher);
  }

  async updateTeacher(
    id: string,
    input: UpdateTeacherInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<Teacher>> {
    await delay(120);
    const idx = store.teachers.findIndex((t) => t.id === id);
    if (idx < 0) return Err(Errors.notFound("Teacher", id));

    const before = store.teachers[idx];
    const validation = validateUpdateTeacherInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }

    const after: Teacher = {
      ...before,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.maxWeeklyHours !== undefined ? { maxWeeklyHours: input.maxWeeklyHours } : {}),
      ...(input.qualifiedSubjectIds !== undefined ? { qualifiedSubjectIds: input.qualifiedSubjectIds } : {}),
      updatedAt: nowIso(),
    };
    store.teachers[idx] = after;
    store.notifyTeachers();

    appendAudit({
      action: AuditActions.ClassUpdate,
      entityType: "teacher",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Enseignant modifié : ${after.firstName} ${after.lastName}`,
    });

    return Ok(after);
  }

  async deleteTeacher(id: string, actorId: string, actorName: string): Promise<Result<void>> {
    await delay(120);
    const teacher = store.teachers.find((t) => t.id === id);
    if (!teacher) return Err(Errors.notFound("Teacher", id));

    // Cascade: remove assignments + timetable entries for this teacher
    store.teacherSubjectAssignments = store.teacherSubjectAssignments.filter(
      (a) => a.teacherId !== id,
    );
    store.timetableEntries = store.timetableEntries.filter(
      (e) => e.teacherId !== id,
    );
    store.teachers = store.teachers.filter((t) => t.id !== id);
    store.notifyTeachers();
    store.notifyTeacherSubjectAssignments();
    store.notifyTimetableEntries();

    appendAudit({
      action: "teacher.delete",
      entityType: "teacher",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { code: teacher.code, name: `${teacher.firstName} ${teacher.lastName}` }, after: null },
      note: `Enseignant supprimé : ${teacher.firstName} ${teacher.lastName}`,
    });

    return Ok(undefined);
  }

  // ---- Teacher ↔ Subject assignments ----
  observeAssignments(teacherId: string): Observable<TeacherSubjectAssignment[]> {
    return new SubjectBehavior(
      store.teacherSubjectAssignments.filter((a) => a.teacherId === teacherId),
    );
  }

  observeAssignmentsBySubject(subjectId: string): Observable<TeacherSubjectAssignment[]> {
    return new SubjectBehavior(
      store.teacherSubjectAssignments.filter((a) => a.subjectId === subjectId),
    );
  }

  observeAssignmentsByAcademicYear(academicYearId: string): Observable<TeacherSubjectAssignment[]> {
    return new SubjectBehavior(
      store.teacherSubjectAssignments.filter((a) => a.academicYearId === academicYearId),
    );
  }

  async assignSubject(
    input: AssignTeacherSubjectInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<TeacherSubjectAssignment>> {
    await delay(100);
    const validation = validateAssignTeacherSubjectInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }

    // Check teacher exists
    const teacher = store.teachers.find((t) => t.id === input.teacherId);
    if (!teacher) return Err(Errors.notFound("Teacher", input.teacherId));

    // Check subject exists
    const subject = store.subjects.find((s) => s.id === input.subjectId);
    if (!subject) return Err(Errors.notFound("Subject", input.subjectId));

    // Check duplicate
    const dup = checkDuplicateAssignment(input, store.teacherSubjectAssignments);
    if (!dup.isValid) {
      return Err(Errors.validation(dup.errors.join(" "), dup.errors.join(" ")));
    }

    // Check primary conflict
    if (input.isPrimary) {
      const primaryConflict = checkPrimaryTeacherConflict(
        input.subjectId,
        input.academicYearId,
        input.teacherId,
        store.teacherSubjectAssignments,
      );
      if (!primaryConflict.isValid) {
        return Err(Errors.validation(primaryConflict.errors.join(" "), primaryConflict.errors.join(" ")));
      }
    }

    const assignment: TeacherSubjectAssignment = {
      id: genId("tsa"),
      tenantId: TENANT_ID,
      teacherId: input.teacherId,
      subjectId: input.subjectId,
      academicYearId: input.academicYearId,
      isPrimary: input.isPrimary ?? false,
      createdAt: nowIso(),
    };

    store.teacherSubjectAssignments = [...store.teacherSubjectAssignments, assignment];

    // If primary, update the Subject's teacherId/teacherName (denormalized)
    if (assignment.isPrimary) {
      store.subjects = store.subjects.map((s) =>
        s.id === input.subjectId
          ? {
              ...s,
              teacherId: teacher.id,
              teacherName: `${teacher.firstName} ${teacher.lastName}`,
            }
          : s,
      );
      store.subjects$.set(store.subjects);
    }

    store.notifyTeacherSubjectAssignments();

    appendAudit({
      action: "teacher.subject_assign",
      entityType: "teacher_subject_assignment",
      entityId: assignment.id,
      actorId,
      actorName,
      diff: { before: null, after: { teacherId: teacher.id, subjectId: subject.id, isPrimary: assignment.isPrimary } },
      note: `Matière ${subject.name} assignée à ${teacher.firstName} ${teacher.lastName}`,
    });

    return Ok(assignment);
  }

  async unassignSubject(assignmentId: string, actorId: string, actorName: string): Promise<Result<void>> {
    await delay(80);
    const assignment = store.teacherSubjectAssignments.find((a) => a.id === assignmentId);
    if (!assignment) return Err(Errors.notFound("TeacherSubjectAssignment", assignmentId));

    store.teacherSubjectAssignments = store.teacherSubjectAssignments.filter(
      (a) => a.id !== assignmentId,
    );
    store.notifyTeacherSubjectAssignments();

    appendAudit({
      action: "teacher.subject_unassign",
      entityType: "teacher_subject_assignment",
      entityId: assignmentId,
      actorId,
      actorName,
      diff: { before: { teacherId: assignment.teacherId, subjectId: assignment.subjectId }, after: null },
      note: `Assignation matière supprimée`,
    });

    return Ok(undefined);
  }

  // ---- Timetable (Emploi du Temps) ----
  observeTimetableForClass(classId: string, academicYearId: string): Observable<TimetableEntry[]> {
    return new SubjectBehavior(
      store.timetableEntries.filter(
        (e) => e.classId === classId && e.academicYearId === academicYearId,
      ),
    );
  }

  observeTimetableForTeacher(teacherId: string, academicYearId: string): Observable<TimetableEntry[]> {
    return new SubjectBehavior(
      store.timetableEntries.filter(
        (e) => e.teacherId === teacherId && e.academicYearId === academicYearId,
      ),
    );
  }

  observeTimetableByAcademicYear(academicYearId: string): Observable<TimetableEntry[]> {
    return new SubjectBehavior(
      store.timetableEntries.filter((e) => e.academicYearId === academicYearId),
    );
  }

  async createTimetableEntry(
    input: CreateTimetableEntryInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<TimetableEntry>> {
    await delay(120);
    const validation = validateCreateTimetableEntryInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }

    // Check teacher exists
    const teacher = store.teachers.find((t) => t.id === input.teacherId);
    if (!teacher) return Err(Errors.notFound("Teacher", input.teacherId));

    // Check subject exists
    const subject = store.subjects.find((s) => s.id === input.subjectId);
    if (!subject) return Err(Errors.notFound("Subject", input.subjectId));

    // Check class exists
    const cls = store.classes.find((c) => c.id === input.classId);
    if (!cls) return Err(Errors.notFound("Class", input.classId));

    // Detect conflicts
    const conflict = detectTimetableConflict(input, store.timetableEntries);
    if (!conflict.isValid) {
      return Err(Errors.validation(conflict.errors.join(" "), conflict.errors.join(" ")));
    }

    const entry: TimetableEntry = {
      id: genId("tt"),
      tenantId: TENANT_ID,
      academicYearId: input.academicYearId,
      classId: input.classId,
      teacherId: input.teacherId,
      subjectId: input.subjectId,
      day: input.day,
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
      room: input.room ?? null,
      notes: input.notes ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store.timetableEntries = [...store.timetableEntries, entry];
    store.notifyTimetableEntries();

    appendAudit({
      action: "timetable.entry_create",
      entityType: "timetable_entry",
      entityId: entry.id,
      actorId,
      actorName,
      diff: { before: null, after: { teacherId: teacher.id, classId: cls.id, day: entry.day } },
      note: `Emploi du temps : ${subject.name} → ${teacher.firstName} ${teacher.lastName} (${entry.day} ${entry.startMinutes}–${entry.endMinutes})`,
    });

    return Ok(entry);
  }

  async updateTimetableEntry(
    id: string,
    input: UpdateTimetableEntryInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<TimetableEntry>> {
    await delay(100);
    const idx = store.timetableEntries.findIndex((e) => e.id === id);
    if (idx < 0) return Err(Errors.notFound("TimetableEntry", id));

    const before = store.timetableEntries[idx];
    const validation = validateUpdateTimetableEntryInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }

    const after: TimetableEntry = {
      ...before,
      ...(input.startMinutes !== undefined ? { startMinutes: input.startMinutes } : {}),
      ...(input.endMinutes !== undefined ? { endMinutes: input.endMinutes } : {}),
      ...(input.room !== undefined ? { room: input.room } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: nowIso(),
    };

    // Detect conflicts on update (exclude self)
    const conflict = detectTimetableConflict(after, store.timetableEntries, id);
    if (!conflict.isValid) {
      return Err(Errors.validation(conflict.errors.join(" "), conflict.errors.join(" ")));
    }

    store.timetableEntries[idx] = after;
    store.notifyTimetableEntries();

    appendAudit({
      action: "timetable.entry_update",
      entityType: "timetable_entry",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
    });

    return Ok(after);
  }

  async deleteTimetableEntry(id: string, actorId: string, actorName: string): Promise<Result<void>> {
    await delay(80);
    const entry = store.timetableEntries.find((e) => e.id === id);
    if (!entry) return Err(Errors.notFound("TimetableEntry", id));

    store.timetableEntries = store.timetableEntries.filter((e) => e.id !== id);
    store.notifyTimetableEntries();

    appendAudit({
      action: "timetable.entry_delete",
      entityType: "timetable_entry",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { day: entry.day, startMinutes: entry.startMinutes }, after: null },
    });

    return Ok(undefined);
  }
}

export const mockTeacherRepository: TeacherRepository = new MockTeacherRepository();
