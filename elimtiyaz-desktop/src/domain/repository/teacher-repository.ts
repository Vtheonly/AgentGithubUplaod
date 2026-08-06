/**
 * Teacher repository interface.
 *
 * CRUD + assignment + timetable operations for the normalized Teacher entity.
 *
 * Referential integrity:
 *   - createTeacher requires a valid personnelId (FK → Personnel)
 *   - assignSubject requires a valid teacherId + subjectId within the same academic year
 *   - Timetable entries reference Teacher (NOT Account/Personnel directly)
 *
 * Academic year scoping:
 *   All queries are scoped by academicYearId to ensure data isolation between
 *   school years. Switching the active academic year changes the entire
 *   pedagogical context.
 */
import type { Result } from "../../core/result";
import type { Observable } from "./repository";
import type {
  Teacher,
  TeacherSubjectAssignment,
  TimetableEntry,
  CreateTeacherInput,
  UpdateTeacherInput,
  AssignTeacherSubjectInput,
  CreateTimetableEntryInput,
  UpdateTimetableEntryInput,
} from "../model/teacher";

export interface TeacherRepository {
  // ---- Teacher CRUD ----
  observe(): Observable<Teacher[]>;
  observeById(id: string): Observable<Teacher | null>;
  observeByAcademicYear(academicYearId: string): Observable<Teacher[]>;
  observeByPersonnel(personnelId: string): Observable<Teacher[]>;
  getById(id: string): Promise<Result<Teacher>>;
  createTeacher(input: CreateTeacherInput, actorId: string, actorName: string): Promise<Result<Teacher>>;
  updateTeacher(id: string, input: UpdateTeacherInput, actorId: string, actorName: string): Promise<Result<Teacher>>;
  deleteTeacher(id: string, actorId: string, actorName: string): Promise<Result<void>>;

  // ---- Teacher ↔ Subject assignments ----
  observeAssignments(teacherId: string): Observable<TeacherSubjectAssignment[]>;
  observeAssignmentsBySubject(subjectId: string): Observable<TeacherSubjectAssignment[]>;
  observeAssignmentsByAcademicYear(academicYearId: string): Observable<TeacherSubjectAssignment[]>;
  assignSubject(input: AssignTeacherSubjectInput, actorId: string, actorName: string): Promise<Result<TeacherSubjectAssignment>>;
  unassignSubject(assignmentId: string, actorId: string, actorName: string): Promise<Result<void>>;

  // ---- Timetable (Emploi du Temps) ----
  observeTimetableForClass(classId: string, academicYearId: string): Observable<TimetableEntry[]>;
  observeTimetableForTeacher(teacherId: string, academicYearId: string): Observable<TimetableEntry[]>;
  observeTimetableByAcademicYear(academicYearId: string): Observable<TimetableEntry[]>;
  createTimetableEntry(input: CreateTimetableEntryInput, actorId: string, actorName: string): Promise<Result<TimetableEntry>>;
  updateTimetableEntry(id: string, input: UpdateTimetableEntryInput, actorId: string, actorName: string): Promise<Result<TimetableEntry>>;
  deleteTimetableEntry(id: string, actorId: string, actorName: string): Promise<Result<void>>;
}
