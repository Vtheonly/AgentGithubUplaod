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
import { currentTermWindow, isDateInCurrentTerm } from "../../../domain/calc/academics/terms";
import { logAutoReleveEntry } from "./auto-releve";
import type { AppError } from "../../../core/result";

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

    // FIX (vault §05.06 — "Coefficient edits should trigger an automatic GPA
    // recompute for affected students"): assessments persist a coefficient
    // snapshot at entry time and every GPA surface (backend
    // `fn_calculate_student_term_gpa`, Android engine, desktop drawers) reads
    // that snapshot. When an admin changes a subject's coefficient, the
    // stored snapshots for NON-ARCHIVED years are re-weighted so every GPA
    // recomputes automatically (assessments$ is a derived observable).
    // Archived years are deliberately left untouched — history is
    // append-only (§04.07).
    let reweighted = 0;
    if (updates.coefficient != null && updates.coefficient !== before.coefficient) {
      const archivedYearCodes = new Set(
        store.academicYears.filter((y) => y.isArchived).map((y) => y.code),
      );
      store.assessments = store.assessments.map((a) => {
        if (a.subjectId !== id || archivedYearCodes.has(a.academicYear)) return a;
        reweighted += 1;
        return { ...a, coefficient: updates.coefficient as number };
      });
      if (reweighted > 0) store.notifyAssessments();
    }

    appendAudit({
      action: AuditActions.SubjectUpdate,
      entityType: "subject",
      entityId: id,
      actorId: "mock",
      actorName: "Mock",
      diff: { before, after },
      note:
        updates.coefficient != null
          ? `Coefficient modifié: ${before.coefficient} → ${updates.coefficient}` +
            (reweighted > 0
              ? ` — ${reweighted} évaluation(s) re-pondérée(s), moyennes recalculées`
              : " — aucune évaluation active à re-pondérer")
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
    // FIX (vault §04.07 / §06.05 — append-only history): reject any write
    // targeting an ARCHIVED academic year. Once a year is archived its
    // records are read-only; corrections require a new audit-logged entry
    // that supersedes the original. Enforced at the repository layer, not
    // just in the UI (same pattern as the 0–20 score CHECK constraint).
    const archivedYearErr = this.archivedYearError(input.academicYear);
    if (archivedYearErr) return Err(archivedYearErr);
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
    // VAULT §09.06 — auto-populate the teacher's Relevé (grades entered).
    logAutoReleveEntry({
      store,
      appendAudit,
      nowIso,
      actorId: input.enteredBy,
      kind: "grade_entry",
      activity: "correction",
      classId: input.classId,
      subjectId: input.subjectId,
      note: `Note saisie — ${input.devoir1 ?? "—"}/${input.devoir2 ?? "—"}/${input.examen ?? "—"}`,
    });
    return Ok(asm);
  }

  async enterGradesBatch(
    inputs: ReadonlyArray<
      Omit<Assessment, "id" | "subjectAverage" | "enteredAt">
    >,
  ): Promise<Result<Assessment[]>> {
    await delay(250);
    // FIX (vault §04.07 / §06.05 — append-only history): reject the whole
    // batch if ANY row targets an archived academic year (all-or-nothing,
    // mirroring the atomicity rule of batch registration §04.03).
    for (const input of inputs) {
      const archivedYearErr = this.archivedYearError(input.academicYear);
      if (archivedYearErr) return Err(archivedYearErr);
    }
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
    // VAULT §09.06 — auto-populate the teacher's Relevé (grades entered).
    logAutoReleveEntry({
      store,
      appendAudit,
      nowIso,
      actorId: inputs[0]?.enteredBy ?? "mock",
      kind: "grade_entry",
      activity: "correction",
      classId: inputs[0]?.classId ?? null,
      subjectId: inputs[0]?.subjectId ?? null,
      note: `Saisie groupée — ${created.length} note(s)`,
    });
    return Ok(created);
  }

  /**
   * Returns an AppError when `academicYear` refers to an archived school
   * year, otherwise null. Unknown years (no matching AcademicYear record)
   * are treated as writable to stay backwards-compatible with seeded data.
   */
  private archivedYearError(academicYear: string): AppError | null {
    const year = store.academicYears.find((y) => y.code === academicYear);
    if (year?.isArchived) {
      const msg =
        `Année scolaire ${academicYear} archivée — lecture seule. ` +
        `L'historique académique est append-only (plan §04.07).`;
      return Errors.validation(msg, msg);
    }
    return null;
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
    arrivalTimes?: ReadonlyMap<string, string>;
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
        // VAULT §09.01 — arrival time logged for LATE students.
        arrivalTime:
          status === "late"
            ? (input.arrivalTimes?.get(studentId) ?? null)
            : null,
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
          late: records.filter((r) => r.status === "late").length,
        },
      },
    });
    // VAULT §09.06 — auto-populate the teacher's Relevé (attendance
    // submission record — daily roll call completion).
    logAutoReleveEntry({
      store,
      appendAudit,
      nowIso,
      actorId: input.recordedBy,
      kind: "roll_call",
      activity: "supervision",
      classId: input.classId,
      note: `Appel enregistré (${input.session === "morning" ? "matin" : input.session === "afternoon" ? "après-midi" : "journée"}) — ${present}/${records.length} présents`,
    });
    return Ok(records);
  }
  async alertAbsences(studentIds: string[]): Promise<Result<void>> {
    // VAULT §09.04 — automated absence alerts:
    //   1. Count each student's absences for the CURRENT TERM (T1/T2/T3 —
    //      not a rolling window).
    //   2. Only alert when the count reaches the threshold of 3 — "never
    //      send the alert before the threshold is hit. The threshold is 3 —
    //      not 1, not 2."
    //   3. Flag the student card + dispatch a parent notification.
    const THRESHOLD = 3;
    const now = new Date();
    const window = currentTermWindow(now);
    const alerts: { studentId: string; count: number }[] = [];
    for (const studentId of studentIds) {
      const termAbsences = store.attendance.filter(
        (r) =>
          r.studentId === studentId &&
          r.status !== "present" &&
          r.status !== "late" && // LATE is not an absence
          isDateInCurrentTerm(r.date, now),
      ).length;
      if (termAbsences >= THRESHOLD) {
        alerts.push({ studentId, count: termAbsences });
      }
    }
    if (alerts.length === 0) {
      // No student hit the threshold — no premature alerts (vault critical
      // rule). Still audit the evaluation for traceability.
      appendAudit({
        action: "attendance.alert_absences",
        entityType: "student",
        entityId: studentIds.join(","),
        actorId: "system",
        actorName: "Système",
        diff: {
          before: null,
          after: { evaluated: studentIds.length, alerted: 0, threshold: THRESHOLD, term: window.label },
        },
        note: `Évaluation du seuil d'absences (${window.label}) — aucun élève n'a atteint ${THRESHOLD} absences.`,
      });
      return Ok(undefined);
    }
    // Dispatch one parent notification per flagged student.
    for (const { studentId, count } of alerts) {
      const student = store.students.find((s) => s.id === studentId);
      const parent = student ? store.parents.find((p) => p.id === student.parentId) : null;
      const displayName = student ? `${student.firstName} ${student.lastName}` : studentId;
      const notification = {
        id: `ntf-absence-${studentId}-${Date.now()}`,
        title: `Alerte absences — ${displayName}`,
        body: `${displayName} a accumulé ${count} absences ce trimestre (${window.label}). Merci de contacter l'administration pour justifier ces absences.`,
        type: "attendance_alert" as const,
        priority: "high" as const,
        source: "system" as const,
        sourceLabel: "Module Présences",
        entityType: "student",
        entityId: studentId,
        targetUserId: null,
        targetRole: null,
        triggeredAt: null,
        readAt: null,
        createdAt: nowIso(),
        createdBy: "system",
      };
      store.notifications = [notification, ...store.notifications];
      void parent; // parent identity retained for the portal-targeting integration
    }
    store.notifyNotifications();
    appendAudit({
      action: "attendance.alert_absences",
      entityType: "student",
      entityId: alerts.map((a) => a.studentId).join(","),
      actorId: "system",
      actorName: "Système",
      diff: {
        before: null,
        after: {
          evaluated: studentIds.length,
          alerted: alerts.length,
          threshold: THRESHOLD,
          term: window.label,
          students: alerts.map((a) => ({ studentId: a.studentId, absences: a.count })),
        },
      },
      note: `Seuil ${THRESHOLD}+ absences atteint pour ${alerts.length} élève(s) (${window.label}) — alertes parents envoyées.`,
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
    // VAULT §09.06 — auto-populate the teacher's Relevé (homework
    // assignments issued — engagement metric).
    logAutoReleveEntry({
      store,
      appendAudit,
      nowIso,
      actorId: input.teacherId,
      kind: "homework_push",
      activity: "task",
      classId: input.classId,
      subjectId: input.subjectId,
      note: `Devoir publié — « ${input.title} » (${subject?.name ?? "Matière"}${input.attachments.length > 0 ? `, ${input.attachments.length} pièce(s) jointe(s)` : ""})`,
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
