/**
 * Mock StudentRepository — in-memory CRUD for students with reactive
 * observation, batch registration (atomic with rollback), and promotion.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including the iteration 6 logic
 * for atomic batch registration with snapshot-based rollback.
 */
import type {
  StudentRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { studentCode } from "../../../core/format/id";
import { SubjectBehavior } from "../subject-behavior";
import type {
  Student,
  CreateStudentInput,
  BatchRegistrationInput,
  BatchRegistrationResult,
  GradeLevel,
} from "../../../domain/model/student";
import { gradeLevelFromLevelYear } from "../../../domain/model/student";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";
import { MockParentRepository } from "./parent-repository";
import type { AppError } from "../../../core/result";

export class MockStudentRepository implements StudentRepository {
  observe(): Observable<Student[]> {
    return store.students$;
  }

  observeByParent(parentId: string): Observable<Student[]> {
    return new SubjectBehavior(store.students.filter((s) => s.parentId === parentId));
  }

  observeByClass(classId: string): Observable<Student[]> {
    return new SubjectBehavior(store.students.filter((s) => s.classId === classId));
  }

  observeById(id: string): Observable<Student | null> {
    return new SubjectBehavior(store.students.find((s) => s.id === id) ?? null);
  }

  async search(query: string): Promise<Result<Student[]>> {
    await delay(120);
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...store.students]);
    return Ok(
      store.students.filter((s) =>
        `${s.firstName} ${s.lastName} ${s.code}`.toLowerCase().includes(q),
      ),
    );
  }

  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    await delay(200);
    const year = new Date().getFullYear();
    const seq = store.students.length + 1;
    // Iteration 6: derive gradeLevel if not provided explicitly.
    const gradeLevel: GradeLevel = input.gradeLevel ?? gradeLevelFromLevelYear(input.level, input.gradeYear);
    const student: Student = {
      id: `stu-${String(seq).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      code: studentCode(year, seq),
      parentId,
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      birthDate: input.birthDate,
      enrollmentDate: nowIso(),
      level: input.level,
      gradeYear: input.gradeYear,
      gradeLevel,
      classId: input.classId ?? null,
      photoUrl: null,
      medicalNotes: input.medicalNotes ?? null,
      transportTier: input.transportTier ?? null,
      status: "active",
      paymentPlan: input.paymentPlan ?? "tranches",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.students.unshift(student);
    store.notifyStudents();
    appendAudit({
      action: AuditActions.StudentCreate,
      entityType: "student",
      entityId: student.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: { code: student.code } },
    });
    return Ok(student);
  }

  async updateStudent(id: string, updates: Partial<CreateStudentInput>): Promise<Result<Student>> {
    await delay(180);
    const idx = store.students.findIndex((s) => s.id === id);
    if (idx < 0) return Err(Errors.notFound("Student", id));
    const before = store.students[idx];
    // Iteration 6: re-derive gradeLevel if level/gradeYear were updated.
    const newLevel = updates.level ?? before.level;
    const newYear = updates.gradeYear ?? before.gradeYear;
    const newGradeLevel: GradeLevel =
      updates.gradeLevel ?? gradeLevelFromLevelYear(newLevel, newYear);
    const after: Student = {
      ...before,
      ...updates,
      level: newLevel,
      gradeYear: newYear,
      gradeLevel: newGradeLevel,
      updatedAt: nowIso(),
    };
    store.students[idx] = after;
    store.notifyStudents();
    appendAudit({
      action: AuditActions.StudentUpdate,
      entityType: "student",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before, after },
    });
    return Ok(after);
  }

  async deleteStudent(id: string): Promise<Result<void>> {
    await delay(180);
    store.students = store.students.filter((s) => s.id !== id);
    store.notifyStudents();
    appendAudit({
      action: "student.delete",
      entityType: "student",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
    });
    return Ok(undefined);
  }

  /**
   * Iteration 6: TRUE atomic batch registration with rollback.
   *
   * The plan §18.01 mandates "All multi-record writes wrapped in BEGIN...COMMIT".
   * The previous implementation created the parent first, then iterated student
   * creation — if any student failed, the parent and earlier students persisted.
   *
   * This implementation:
   *   1. Pre-validates ALL student inputs BEFORE writing anything.
   *   2. Snapshots the current state of parents and students arrays.
   *   3. Creates the parent + all students atomically.
   *   4. On ANY failure, rolls back to the snapshot.
   *   5. Writes a single audit entry on success.
   *
   * If rollback occurs, the audit log records the failure (not a success).
   */
  async batchRegister(input: BatchRegistrationInput): Promise<Result<BatchRegistrationResult>> {
    await delay(400);

    // Step 1: Pre-validate inputs (fail fast, before any mutation).
    if (input.students.length === 0) {
      return Err(Errors.validation("L'inscription groupée requiert au moins un élève"));
    }
    for (let i = 0; i < input.students.length; i++) {
      const s = input.students[i];
      if (!s.firstName?.trim() || !s.lastName?.trim()) {
        return Err(Errors.validation(`Élève ${i + 1}: prénom et nom requis`));
      }
      if (!s.birthDate) {
        return Err(Errors.validation(`Élève ${i + 1}: date de naissance requise`));
      }
    }

    // Step 2: Snapshot state for rollback.
    const parentsSnapshot = [...store.parents];
    const studentsSnapshot = [...store.students];

    try {
      const year = new Date().getFullYear();
      // Step 3a: Create parent.
      const parentResult = await new MockParentRepository().createParent(input.parent);
      if (!parentResult.ok) {
        throw parentResult.error;
      }
      const parent = parentResult.value;

      // Step 3b: Create all students.
      const students: Student[] = [];
      for (const sInput of input.students) {
        const seq = store.students.length + 1;
        const gradeLevel: GradeLevel =
          sInput.gradeLevel ?? gradeLevelFromLevelYear(sInput.level, sInput.gradeYear);
        const student: Student = {
          id: `stu-${String(seq).padStart(3, "0")}`,
          tenantId: TENANT_ID,
          code: studentCode(year, seq),
          parentId: parent.id,
          firstName: sInput.firstName,
          lastName: sInput.lastName,
          gender: sInput.gender,
          birthDate: sInput.birthDate,
          enrollmentDate: nowIso(),
          level: sInput.level,
          gradeYear: sInput.gradeYear,
          gradeLevel,
          classId: sInput.classId ?? null,
          photoUrl: null,
          medicalNotes: sInput.medicalNotes ?? null,
          transportTier: sInput.transportTier ?? null,
          status: "active",
          paymentPlan: sInput.paymentPlan ?? "tranches",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        store.students.unshift(student);
        students.push(student);
      }
      store.notifyStudents();

      // Step 4: Audit the successful atomic transaction.
      appendAudit({
        action: AuditActions.BatchRegister,
        entityType: "batch",
        entityId: parent.id,
        actorId: "usr-current",
        actorName: "Session courante",
        diff: { before: null, after: { parentCode: parent.code, studentCount: students.length } },
        note: `Inscription groupée atomique — ${students.length} élève(s) créé(s) avec succès`,
      });
      return Ok({ parent, students });
    } catch (err) {
      // Step 5: ROLLBACK on failure — restore the snapshot.
      store.parents = parentsSnapshot;
      store.students = studentsSnapshot;
      store.notifyParents();
      store.notifyStudents();
      appendAudit({
        action: AuditActions.BatchRegister,
        entityType: "batch",
        entityId: "failed",
        actorId: "usr-current",
        actorName: "Session courante",
        diff: { before: null, after: null },
        note: `Échec inscription groupée — annulée (rollback). Raison: ${err instanceof Error ? err.message : String(err)}`,
      });
      if (err && typeof err === "object" && "code" in err) {
        return Err(err as AppError);
      }
      return Err(Errors.unknown(err));
    }
  }

  async promote(studentIds: string[], _academicYear: string): Promise<Result<Student[]>> {
    await delay(300);
    const promoted = store.students
      .filter((s) => studentIds.includes(s.id))
      .map((s) => ({ ...s, updatedAt: nowIso() }));
    appendAudit({
      action: AuditActions.StudentPromote,
      entityType: "student",
      entityId: studentIds.join(","),
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: { count: promoted.length } },
    });
    return Ok(promoted);
  }
}

/** Singleton instance — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockStudentRepository: StudentRepository = new MockStudentRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
