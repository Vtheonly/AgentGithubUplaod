import type {
  ClassRepository,
  SubjectRepository,
  GradeRepository,
  AttendanceRepository,
  HomeworkRepository,
  PromotionRepository,
} from "../../../domain/repository/academic-repository";
import type { Observable } from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { derived } from "../subject-behavior";
import { computeSubjectAverage } from "../../../domain/model/academic";
import type {
  AcademicClass,
  Subject,
  ClassSubject,
  Assessment,
  AttendanceRecord,
  Homework,
  AttendanceSession,
  AttendanceStatus,
} from "../../../domain/model/academic";
import type { Student, AcademicLevel } from "../../../domain/model/student";
import {
  createAcademicHistoryEntry,
  type PromotionCandidate,
} from "../../../domain/calc/academics/promotion";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";
import { ACADEMIC_YEAR } from "../seed-data";

// ============================================================================
// Classes (Unlimited creation per grade level, zero capacity limits)
// ============================================================================
export class MockClassRepository implements ClassRepository {
  observe(): Observable<AcademicClass[]> {
    return store.classes$;
  }
  observeByLevel(level: AcademicLevel): Observable<AcademicClass[]> {
    // FIX (reactivity): derive from the store stream.
    return derived([store.classes$], () => store.classes.filter((c) => c.level === level));
  }
  observeById(id: string): Observable<AcademicClass | null> {
    return derived([store.classes$], () => store.classes.find((c) => c.id === id) ?? null);
  }
  async createClass(
    input: Omit<
      AcademicClass,
      "id" | "tenantId" | "enrolledCount" | "isActive"
    >,
  ): Promise<Result<AcademicClass>> {
    await delay(200);
    const cls: AcademicClass = {
      ...input,
      id: `cls-${String(store.classes.length + 1).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      enrolledCount: 0,
      notes: input.notes ?? null,
      isActive: true,
    };
    store.classes.push(cls);
    store.classes$.set([...store.classes]);
    appendAudit({
      action: AuditActions.ClassCreate,
      entityType: "class",
      entityId: cls.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: {
        before: null,
        after: { code: cls.code, name: cls.name, gradeCode: cls.gradeCode },
      },
      note: `Création de classe: ${cls.name} (${cls.gradeCode})`,
    });
    return Ok(cls);
  }
  async updateClass(
    id: string,
    updates: Partial<AcademicClass>,
  ): Promise<Result<AcademicClass>> {
    await delay(180);
    const idx = store.classes.findIndex((c) => c.id === id);
    if (idx < 0) return Err(Errors.notFound("Class", id));
    const before = store.classes[idx];
    const after = { ...before, ...updates };
    store.classes[idx] = after;
    store.classes$.set([...store.classes]);
    appendAudit({
      action: AuditActions.ClassUpdate,
      entityType: "class",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before, after },
    });
    return Ok(after);
  }
  async deleteClass(id: string): Promise<Result<void>> {
    await delay(180);
    store.classes = store.classes.filter((c) => c.id !== id);
    store.classes$.set([...store.classes]);
    appendAudit({
      action: "class.delete",
      entityType: "class",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
    });
    return Ok(undefined);
  }
}

// ============================================================================
// Subjects
// ============================================================================
export class MockSubjectRepository implements SubjectRepository {
  observe(): Observable<Subject[]> {
    return store.subjects$;
  }
  observeByLevel(level: AcademicLevel): Observable<Subject[]> {
    return derived([store.subjects$], () => store.subjects.filter((s) => s.level === level));
  }
  observeByClass(classId: string): Observable<ClassSubject[]> {
    return derived(
      [store.classSubjects$],
      () => store.classSubjects.filter((cs) => cs.classId === classId),
    );
  }
  async assignSubjectToClass(
    input: Omit<ClassSubject, "id">,
  ): Promise<Result<ClassSubject>> {
    await delay(180);
    const cs: ClassSubject = { ...input, id: `csj-${Date.now()}` };
    store.classSubjects = [...store.classSubjects, cs];
    store.notifyClassSubjects();
    appendAudit({
      action: AuditActions.SubjectUpdate,
      entityType: "class-subject",
      entityId: cs.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: cs },
      note: `Matière ${cs.subjectId} assignée à la classe ${cs.classId}`,
    });
    return Ok(cs);
  }
  async removeSubjectFromClass(id: string): Promise<Result<void>> {
    await delay(150);
    store.classSubjects = store.classSubjects.filter((cs) => cs.id !== id);
    store.notifyClassSubjects();
    appendAudit({
      action: AuditActions.SubjectArchive,
      entityType: "class-subject",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: null },
      note: `Assignation supprimée`,
    });
    return Ok(undefined);
  }

  async createSubject(
    input: Omit<Subject, "id" | "tenantId">,
  ): Promise<Result<Subject>> {
    await delay(120);
    const subj: Subject = {
      ...input,
      id: `subj-${Date.now()}`,
      tenantId: TENANT_ID,
    };
    store.subjects = [...store.subjects, subj];
    store.subjects$.set(store.subjects);
    appendAudit({
      action: AuditActions.SubjectCreate,
      entityType: "subject",
      entityId: subj.id,
      actorId: "mock",
      actorName: "Mock",
      diff: { before: null, after: subj },
      note: `Matière créée: ${subj.name} (${subj.code})`,
    });
    return Ok(subj);
  }

  async updateSubject(
    id: string,
    updates: Partial<Omit<Subject, "id" | "tenantId">>,
  ): Promise<Result<Subject>> {
    await delay(120);
    const idx = store.subjects.findIndex((s) => s.id === id);
    if (idx < 0) return Err(Errors.unknown("Subject not found"));
    const before = store.subjects[idx];
    const after: Subject = { ...before, ...updates };
    store.subjects = store.subjects.map((s) => (s.id === id ? after : s));
    store.subjects$.set(store.subjects);
    appendAudit({
      action: AuditActions.SubjectUpdate,
      entityType: "subject",
      entityId: id,
      actorId: "mock",
      actorName: "Mock",
      diff: { before, after },
      note:
        updates.coefficient != null
          ? `Coefficient modifié: ${before.coefficient} → ${updates.coefficient}`
          : "Matière modifiée",
    });
    return Ok(after);
  }

  async archiveSubject(id: string): Promise<Result<void>> {
    await delay(120);
    const before = store.subjects.find((s) => s.id === id);
    store.subjects = store.subjects.filter((s) => s.id !== id);
    store.subjects$.set(store.subjects);
    appendAudit({
      action: AuditActions.SubjectArchive,
      entityType: "subject",
      entityId: id,
      actorId: "mock",
      actorName: "Mock",
      diff: { before, after: null },
      note: `Matière archivée: ${before?.name ?? id}`,
    });
    return Ok(undefined);
  }
}

// ============================================================================
// Grades
// ============================================================================
export class MockGradeRepository implements GradeRepository {
  observeForStudent(studentId: string): Observable<Assessment[]> {
    // FIX (reactivity): derive from the store stream so the student drawer's
    // grades tab refreshes after grade entry / batch entry.
    return derived(
      [store.assessments$],
      () => store.assessments.filter((a) => a.studentId === studentId),
    );
  }
  observeForClass(
    classId: string,
    _academicYear?: string,
    _term?: string,
  ): Observable<Assessment[]> {
    return derived(
      [store.assessments$],
      () => store.assessments.filter((a) => a.classId === classId),
    );
  }
  async enterGrade(
    input: Omit<Assessment, "id" | "subjectAverage" | "enteredAt">,
  ): Promise<Result<Assessment>> {
    await delay(150);
    const asm: Assessment = {
      ...input,
      id: `asm-${Date.now()}`,
      subjectAverage: computeSubjectAverage(
        input.devoir1,
        input.devoir2,
        input.examen,
      ),
      enteredAt: nowIso(),
    };
    store.assessments = [asm, ...store.assessments];
    store.notifyAssessments();
    appendAudit({
      action: AuditActions.GradeEnter,
      entityType: "assessment",
      entityId: asm.id,
      actorId: input.enteredBy,
      actorName: "Session courante",
    });
    return Ok(asm);
  }

  async enterGradesBatch(
    inputs: ReadonlyArray<
      Omit<Assessment, "id" | "subjectAverage" | "enteredAt">
    >,
  ): Promise<Result<Assessment[]>> {
    await delay(250);
    const created: Assessment[] = inputs.map((input) => ({
      ...input,
      id: `asm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      subjectAverage: computeSubjectAverage(
        input.devoir1,
        input.devoir2,
        input.examen,
      ),
      enteredAt: nowIso(),
    }));

    store.assessments = [...created, ...store.assessments];
    store.notifyAssessments();
    appendAudit({
      action: AuditActions.GradeEnter,
      entityType: "assessment",
      entityId: "batch",
      actorId: inputs[0]?.enteredBy ?? "mock",
      actorName: "Session courante",
      diff: { before: null, after: { count: created.length } },
    });
    return Ok(created);
  }
}

// ============================================================================
// Attendance
// ============================================================================
export class MockAttendanceRepository implements AttendanceRepository {
  observeByClass(
    classId: string,
    date: string,
  ): Observable<AttendanceRecord[]> {
    // FIX (reactivity): derive from the store stream.
    return derived(
      [store.attendance$],
      () => store.attendance.filter((r) => r.classId === classId && r.date === date),
    );
  }
  observeByClassRange(
    classId: string,
    from: string,
    to: string,
  ): Observable<AttendanceRecord[]> {
    // FIX (7-day claim): range query used by the class attendance tab.
    return derived(
      [store.attendance$],
      () =>
        store.attendance.filter(
          (r) => r.classId === classId && r.date >= from && r.date <= to,
        ),
    );
  }
  observeByStudent(
    studentId: string,
    from: string,
    to: string,
  ): Observable<AttendanceRecord[]> {
    return derived(
      [store.attendance$],
      () => store.attendance.filter(
        (r) => r.studentId === studentId && r.date >= from && r.date <= to,
      ),
    );
  }
  async recordRollCall(input: {
    classId: string;
    date: string;
    session: AttendanceSession;
    statuses: ReadonlyMap<string, AttendanceStatus>;
    recordedBy: string;
  }): Promise<Result<AttendanceRecord[]>> {
    await delay(220);
    // FIX (duplicate roll-call records): previously every submission APPENDED
    // new records for the same (class, date, session) — re-saving a roll call
    // duplicated every row and inflated attendance stats. Now a resubmission
    // REPLACES the previous records for that slot (idempotent upsert).
    const existingForSlot = store.attendance.filter(
      (r) => r.classId === input.classId && r.date === input.date && r.session === input.session,
    );
    const existingIds = new Set(existingForSlot.map((r) => r.studentId));
    const records: AttendanceRecord[] = [...input.statuses.entries()].map(
      ([studentId, status]) => ({
        id: `att-${input.classId}-${input.date}-${input.session}-${studentId}`,
        studentId,
        classId: input.classId,
        date: input.date,
        session: input.session,
        status,
        note: existingForSlot.find((r) => r.studentId === studentId)?.note ?? null,
        recordedBy: input.recordedBy,
        recordedAt: nowIso(),
        syncedAt: nowIso(),
      }),
    );
    const replacedIds = new Set(records.map((r) => r.studentId));
    store.attendance = [
      ...records,
      ...store.attendance.filter(
        (r) =>
          !(
            r.classId === input.classId &&
            r.date === input.date &&
            r.session === input.session &&
            (replacedIds.has(r.studentId) || existingIds.has(r.studentId))
          ),
      ),
    ];
    store.notifyAttendance();
    const present = records.filter((r) => r.status === "present").length;
    appendAudit({
      action: AuditActions.AttendanceSubmit,
      entityType: "attendance",
      entityId: input.classId,
      actorId: input.recordedBy,
      actorName: "Session courante",
      diff: {
        before: null,
        after: {
          total: records.length,
          present,
          absent: records.length - present,
        },
      },
    });
    return Ok(records);
  }
  async alertAbsences(studentIds: string[]): Promise<Result<void>> {
    appendAudit({
      action: "attendance.alert_absences",
      entityType: "student",
      entityId: studentIds.join(","),
      actorId: "system",
      actorName: "Système",
      note: `Seuil 3+ absences atteint pour ${studentIds.length} élève(s)`,
    });
    return Ok(undefined);
  }
}

// ============================================================================
// Homework
// ============================================================================
export class MockHomeworkRepository implements HomeworkRepository {
  observeForClass(classId: string): Observable<Homework[]> {
    return derived(
      [store.homework$],
      () => (classId ? store.homework.filter((h) => h.classId === classId) : store.homework),
    );
  }
  observeByTeacher(teacherId: string): Observable<Homework[]> {
    return derived(
      [store.homework$],
      () => store.homework.filter((h) => h.teacherId === teacherId),
    );
  }
  async push(input: {
    classId: string;
    subjectId: string;
    teacherId: string;
    teacherName: string;
    title: string;
    description: string;
    dueDate: string;
    attachments: readonly string[];
  }): Promise<Result<Homework>> {
    await delay(200);
    const subject = store.subjects.find((s) => s.id === input.subjectId);
    const hw: Homework = {
      ...input,
      id: `hw-${Date.now()}`,
      subjectName: subject?.name ?? "Matière",
      attachments: input.attachments,
      academicYear: ACADEMIC_YEAR,
      createdAt: nowIso(),
      pushedAt: nowIso(),
      acknowledgedCount: 0,
    };
    store.homework = [hw, ...store.homework];
    store.notifyHomework();
    appendAudit({
      action: AuditActions.HomeworkPush,
      entityType: "homework",
      entityId: hw.id,
      actorId: input.teacherId,
      actorName: input.teacherName,
    });
    return Ok(hw);
  }
}

// ============================================================================
// Promotion
// ============================================================================
/**
 * Derive the academic year label that just completed, given the target year
 * of the promotion (e.g. "2026-2027" → "2025-2026"). Falls back to the seed
 * academic year when the input is not parseable.
 */
function derivePreviousAcademicYear(targetAcademicYear: string): string {
  const m = /^(\d{4})-(\d{4})$/.exec(targetAcademicYear.trim());
  if (m) {
    const start = Number(m[1]) - 1;
    return `${start}-${start + 1}`;
  }
  return ACADEMIC_YEAR;
}

export class MockPromotionRepository implements PromotionRepository {
  async executeBatchPromotion(input: {
    candidates: readonly {
      candidate: PromotionCandidate;
      finalDecision: import("../../../domain/model/academic").PromotionDecision;
    }[];
    targetAcademicYear: string;
    performedBy: string;
    performedByName: string;
  }): Promise<Result<{ promotedStudents: Student[]; updatedCount: number }>> {
    await delay(300);
    const updatedStudents: Student[] = [];

    for (const item of input.candidates) {
      const { candidate, finalDecision } = item;
      const idx = store.students.findIndex(
        (s) => s.id === candidate.student.id,
      );
      if (idx >= 0) {
        const current = store.students[idx];
        const nextGradeLevel =
          finalDecision === "promoted" && candidate.nextGradeLevel
            ? candidate.nextGradeLevel
            : current.gradeLevel;
        const nextLevel =
          finalDecision === "promoted" && candidate.nextAcademicLevel
            ? candidate.nextAcademicLevel
            : current.level;
        const nextGradeYear =
          finalDecision === "promoted" && candidate.nextGradeYear
            ? candidate.nextGradeYear
            : current.gradeYear;

        // FIX (academic history): append an entry for the year the student
        // just COMPLETED — plan §04.07 makes history append-only and stored
        // on the student entity. Previously no entry was ever written, so
        // the "Historique académique" card in the student drawer was
        // permanently empty. Uses the canonical factory from the promotion
        // module so cycle/level derivation stays consistent.
        const sourceAcademicYear = derivePreviousAcademicYear(input.targetAcademicYear);
        const completedYearEntry = createAcademicHistoryEntry(
          candidate,
          sourceAcademicYear,
          current.classId
            ? store.classes.find((c) => c.id === current.classId)?.name ?? null
            : null,
          finalDecision,
        );

        const updated: Student = {
          ...current,
          gradeLevel: nextGradeLevel,
          level: nextLevel,
          gradeYear: nextGradeYear,
          status: finalDecision === "graduated" ? "graduated" : current.status,
          // Promoted students move to the next grade — their old class
          // assignment no longer applies and must be cleared so the new
          // year's class assignment can be made.
          classId: finalDecision === "promoted" ? null : current.classId,
          academicHistory: [...(current.academicHistory ?? []), completedYearEntry],
          updatedAt: nowIso(),
        };

        store.students[idx] = updated;
        updatedStudents.push(updated);
      }
    }

    store.notifyStudents();

    appendAudit({
      action: AuditActions.StudentPromote,
      entityType: "student",
      entityId: "batch",
      actorId: input.performedBy,
      actorName: input.performedByName,
      diff: {
        before: null,
        after: {
          count: updatedStudents.length,
          targetYear: input.targetAcademicYear,
        },
      },
      note: `Promotion de classe exécutée vers l'année ${input.targetAcademicYear}`,
    });

    return Ok({
      promotedStudents: updatedStudents,
      updatedCount: updatedStudents.length,
    });
  }
}

// Singletons
export const mockClassRepository: ClassRepository = new MockClassRepository();
export const mockSubjectRepository: SubjectRepository =
  new MockSubjectRepository();
export const mockGradeRepository: GradeRepository = new MockGradeRepository();
export const mockAttendanceRepository: AttendanceRepository =
  new MockAttendanceRepository();
export const mockHomeworkRepository: HomeworkRepository =
  new MockHomeworkRepository();
export const mockPromotionRepository: PromotionRepository =
  new MockPromotionRepository();

export type { Observable };
