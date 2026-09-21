import type {
  ClassRepository,
  SubjectRepository,
  GradeRepository,
  AttendanceRepository,
  HomeworkRepository,
  PromotionRepository,
  GradeEntryInput,
  ClassPlacementRepository,
  FinalizeClassPlacementsInput,
  FinalizeClassPlacementsResult,
} from "../../../domain/repository/academic-repository";
import type { Observable } from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { derived } from "../subject-behavior";
import { computeSubjectAverageFromRecipe } from "../../../domain/calc/academics/subject-config";
import type {
  AcademicHistoryEntry,
  AcademicClass,
  Subject,
  SubjectConfiguration,
  ClassSubject,
  Assessment,
  AttendanceRecord,
  Homework,
  AttendanceSession,
  AttendanceStatus,
} from "../../../domain/model/academic";
import type { Student, AcademicLevel } from "../../../domain/model/student";
import { trackCompatible, trackIncompatibilityReason, normalizeTrackCode } from "../../../domain/model/filiere";
import type {
  PromotionCycle,
  PromotionCycleClass,
  PromotionClassConfirmResult,
} from "../../../domain/model/promotion-cycle";
import type {
  PromotionCycleRepository,
  CreatePromotionCycleInput,
  ConfirmPromotionCycleClassInput,
} from "../../../domain/repository/academic-repository";
import {
  academicLevelFromGradeLevel,
  gradeYearFromGradeLevel,
} from "../../../domain/model/student";
import {
  createAcademicHistoryEntry,
  type PromotionCandidate,
} from "../../../domain/calc/academics/promotion";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";
import { ACADEMIC_YEAR } from "../seed-data";
import { currentTermWindow, isDateInCurrentTerm } from "../../../domain/calc/academics/terms";
import { logAutoReleveEntry } from "./auto-releve";
import { dispatchAbsenceLimitExceeded } from "./workflow-event-bridge";
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
      // T-407 (mock/Supabase parity): normalize the classification at the
      // store boundary — the Supabase createClass normalizes "general" →
      // NULL at its wire, so the mock's store must too (the create-class
      // dialogs used to send the literal "general" when « Générale » was
      // picked).
      filiereCode: normalizeTrackCode(input.filiereCode),
      specialiteCode: normalizeTrackCode(input.specialiteCode),
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
  /** T-345 (MATIERE-500/ADR-018): the context configurations. */
  observeConfigurations(): Observable<SubjectConfiguration[]> {
    return store.subjectConfigurations$;
  }
  async upsertSubjectConfiguration(
    input: Omit<SubjectConfiguration, "id" | "tenantId"> & { id?: string },
  ): Promise<Result<SubjectConfiguration>> {
    await delay(160);
    const key = (c: SubjectConfiguration) =>
      `${c.subjectId}|${c.academicYearId}|${c.academicLevelId}|${c.direction}`;
    const idx = store.subjectConfigurations.findIndex(
      (c) =>
        key(c) ===
        `${input.subjectId}|${input.academicYearId}|${input.academicLevelId}|${input.direction || "general"}`,
    );
    const before = idx >= 0 ? store.subjectConfigurations[idx] : null;
    const row: SubjectConfiguration = {
      ...input,
      direction: input.direction || "general",
      id: idx >= 0 ? store.subjectConfigurations[idx].id : `subcfg-${Date.now()}`,
      tenantId: TENANT_ID,
    };
    store.subjectConfigurations =
      idx >= 0
        ? store.subjectConfigurations.map((c, i) => (i === idx ? row : c))
        : [...store.subjectConfigurations, row];
    store.notifySubjectConfigurations();
    appendAudit({
      action: AuditActions.SubjectUpdate,
      entityType: "subject-configuration",
      entityId: row.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before, after: row },
      note: `Configuration matière — coefficient ${row.coefficient}, recette D1:${row.gradingRecipe.devoir1} D2:${row.gradingRecipe.devoir2} Ex:${row.gradingRecipe.examen} CC:${row.gradingRecipe.cc}`,
    });
    return Ok(row);
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
  /**
   * T-352 (DASH-402): the school-wide stream — mock-parity with the
   * Supabase implementation (tenant-scoped there; store-scoped here).
   * Optional year/term filters ignored on the mock store (single demo
   * year), same as the other observe* methods' leading-underscore params.
   */
  observeAll(
    _academicYear?: string,
    _term?: string,
  ): Observable<Assessment[]> {
    return derived([store.assessments$], () => [...store.assessments]);
  }
  async enterGrade(input: GradeEntryInput): Promise<Result<Assessment>> {
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
      cc: input.cc ?? null,
      coefficientDevoir1: input.coefficientDevoir1 ?? 1,
      coefficientDevoir2: input.coefficientDevoir2 ?? 1,
      coefficientExamen: input.coefficientExamen ?? 2,
      coefficientCc: input.coefficientCc ?? 0,
      id: `asm-${Date.now()}`,
      // T-345 (ADR-018): the recipe-aware canonical engine (the snapshots
      // carried by the input are the recipe in force at entry).
      subjectAverage: computeSubjectAverageFromRecipe(
        input.devoir1,
        input.devoir2,
        input.examen,
        input.cc ?? null,
        {
          devoir1: input.coefficientDevoir1 ?? 1,
          devoir2: input.coefficientDevoir2 ?? 1,
          examen: input.coefficientExamen ?? 2,
          cc: input.coefficientCc ?? 0,
        },
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
    inputs: ReadonlyArray<GradeEntryInput>,
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
      cc: input.cc ?? null,
      coefficientDevoir1: input.coefficientDevoir1 ?? 1,
      coefficientDevoir2: input.coefficientDevoir2 ?? 1,
      coefficientExamen: input.coefficientExamen ?? 2,
      coefficientCc: input.coefficientCc ?? 0,
      id: `asm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      // T-345 (ADR-018): the recipe-aware canonical engine.
      subjectAverage: computeSubjectAverageFromRecipe(
        input.devoir1,
        input.devoir2,
        input.examen,
        input.cc ?? null,
        {
          devoir1: input.coefficientDevoir1 ?? 1,
          devoir2: input.coefficientDevoir2 ?? 1,
          examen: input.coefficientExamen ?? 2,
          cc: input.coefficientCc ?? 0,
        },
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
  /**
   * T-352 (DASH-402): the school-wide stream — mock-parity with the
   * Supabase implementation.
   */
  observeAll(from: string, to: string): Observable<AttendanceRecord[]> {
    return derived(
      [store.attendance$],
      () => store.attendance.filter((r) => r.date >= from && r.date <= to),
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
    // T-314 (event bridge): when a student JUST crossed the unexcused-
    // absence threshold (3) in the current term, fire the DEPLOYED
    // `absence_limit_exceeded` workflows — REAL side effects (notification
    // + supervisor task + run record). Fail-safe: a workflow failure never
    // breaks the roll-call save.
    const now = new Date();
    for (const record of records) {
      if (record.status !== "absent_unexcused" && record.status !== "absent_excused") continue;
      const termAbsences = store.attendance.filter(
        (r) =>
          r.studentId === record.studentId &&
          (r.status === "absent_unexcused" || r.status === "absent_excused") &&
          isDateInCurrentTerm(r.date, now) &&
          (r.justificationStatus ?? "none") !== "accepted",
      ).length;
      if (termAbsences >= 3) {
        const student = store.students.find((s) => s.id === record.studentId);
        if (student) {
          void dispatchAbsenceLimitExceeded(student, termAbsences, input.recordedBy).catch(() => {
            /* fail-safe — the workflow bridge already audit-logs its errors */
          });
        }
      }
    }
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

  /**
   * T-040 (ATT-101): the staff review queue — records whose justification is
   * in the given state (default 'submitted'), newest first. Mirrors the
   * Supabase implementation against the in-memory store (demo mode).
   */
  observeJustifications(
    status: "submitted" | "accepted" | "rejected" = "submitted",
  ): Observable<AttendanceRecord[]> {
    return derived(
      [store.attendance$],
      () =>
        store.attendance
          .filter((r) => (r.justificationStatus ?? "none") === status)
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
          .slice(0, 200),
    );
  }

  /**
   * T-040 (ATT-101): staff decision — flips justificationStatus and records
   * the reviewer + timestamp. Records with no justification ('none') cannot
   * be reviewed; a previous decision may be overturned (correction path).
   */
  async reviewJustification(input: {
    recordId: string;
    decision: "accepted" | "rejected";
    reviewedBy: string;
  }): Promise<Result<AttendanceRecord>> {
    await delay(120);
    const record = store.attendance.find((r) => r.id === input.recordId);
    if (!record || (record.justificationStatus ?? "none") === "none") {
      return Err(
        Errors.notFound(
          "AttendanceRecord (justification 'none' ou introuvable)",
          input.recordId,
        ),
      );
    }
    const reviewed: AttendanceRecord = {
      ...record,
      justificationStatus: input.decision,
      justificationReviewedBy: input.reviewedBy,
      justificationReviewedAt: new Date().toISOString(),
    };
    store.attendance = store.attendance.map((r) =>
      r.id === input.recordId ? reviewed : r,
    );
    return Ok(reviewed);
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

// ============================================================================
// Class Placement (T-370 / ACAD-500 — the 9ddde68 "Constitution des Classes"
// workflow). Mirrors the canonical fn_finalize_class_placements RPC
// (migration 0096): validate EVERYTHING first, then mutate — the batch is
// atomic (any validation failure leaves the store untouched), new-section
// draft ids are mapped to the created ids BEFORE students are pointed at
// them, existing-class patches are applied, and ONE audit entry records the
// whole batch. NO parallel store: this operates on the SAME shared `store`
// every other mock repository uses.
// ============================================================================
export class MockClassPlacementRepository implements ClassPlacementRepository {
  async finalizePlacements(
    input: FinalizeClassPlacementsInput,
  ): Promise<Result<FinalizeClassPlacementsResult>> {
    await delay(220);

    // ── Validation pass (atomicity: nothing mutates until every check passed)
    // Target year resolution — by id first, then by code/label (the RPC's
    // resolution order).
    const targetYear =
      store.academicYears.find(
        (y) => input.targetAcademicYearId && y.id === input.targetAcademicYearId,
      ) ??
      store.academicYears.find(
        (y) =>
          y.code === input.targetAcademicYearCode ||
          y.label === input.targetAcademicYearCode,
      );
    if (!targetYear) {
      return Err(Errors.validation(
        `L'année scolaire cible « ${input.targetAcademicYearCode} » n'existe pas (créez-la dans Années scolaires d'abord).`,
      ));
    }

    // New classes: mandatory name/gradeCode/code + code uniqueness in year.
    for (const draft of input.newClasses) {
      if (!draft.name?.trim()) {
        return Err(Errors.validation(
          "Une nouvelle section doit porter un nom.",
        ));
      }
      if (!draft.gradeCode) {
        return Err(Errors.validation(
          `La nouvelle section « ${draft.name} » n'a pas de niveau.`,
        ));
      }
      if (!draft.code?.trim()) {
        return Err(Errors.validation(
          `La nouvelle section « ${draft.name} » n'a pas de code.`,
        ));
      }
      const inYear = (c: AcademicClass) =>
        c.academicYearId === targetYear.id || c.academicYear === targetYear.code;
      const duplicateExisting = store.classes.some(
        (c) => c.code === draft.code && inYear(c),
      );
      const duplicateInBatch = input.newClasses.some(
        (d) => d.code === draft.code && d.clientDraftId !== draft.clientDraftId,
      );
      if (duplicateExisting || duplicateInBatch) {
        return Err(Errors.validation(
          `Le code de classe « ${draft.code} » existe déjà pour l'année ${targetYear.code}.`,
        ));
      }
    }

    // Existing-class patches: the id must be an EXISTING class of the target
    // year (a draft id here is a contract violation — the hook filters).
    for (const patch of input.classesToUpdate) {
      const existing = store.classes.find((c) => c.id === patch.id);
      if (!existing) {
        return Err(Errors.notFound("Class", patch.id));
      }
      if (
        existing.academicYearId !== targetYear.id &&
        existing.academicYear !== targetYear.code
      ) {
        return Err(Errors.validation(
          `La classe « ${existing.name } » n'appartient pas à l'année ${targetYear.code}.`,
        ));
      }
    }

    // Student assignments: target must resolve (draft map or existing class),
    // grade must match, student must exist.
    const draftIds = new Set(input.newClasses.map((d) => d.clientDraftId));
    for (const assignment of input.studentAssignments) {
      if (!draftIds.has(assignment.targetClassId)) {
        const target = store.classes.find(
          (c) => c.id === assignment.targetClassId,
        );
        if (!target) {
          return Err(Errors.notFound("Class", assignment.targetClassId));
        }
        if (target.gradeCode !== assignment.gradeLevel) {
          return Err(Errors.validation(
            `L'affectation de l'élève ${assignment.studentId} (${assignment.gradeLevel}) ne correspond pas au niveau de la classe « ${target.name} » (${target.gradeCode}).`,
          ));
        }
      } else {
        // DRAFT target (parity with the RPC's Step C grade-integrity check:
        // the server checks the CREATED class's grade_code, which comes from
        // the draft's gradeCode — the mock must reject the same mismatch,
        // not just existing-class targets).
        const draft = input.newClasses.find(
          (d) => d.clientDraftId === assignment.targetClassId,
        )!;
        if (draft.gradeCode !== assignment.gradeLevel) {
          return Err(Errors.validation(
            `L'affectation de l'élève ${assignment.studentId} (${assignment.gradeLevel}) ne correspond pas au niveau de la nouvelle section « ${draft.name} » (${draft.gradeCode}).`,
          ));
        }
      }
      if (!store.students.some((s) => s.id === assignment.studentId)) {
        return Err(Errors.notFound("Student", assignment.studentId));
      }
      // T-401: classification compatibility — the mock mirrors the SQL
      // fn_track_compatible guard so mock-mode parity holds.
      const trackStudent = store.students.find((s) => s.id === assignment.studentId)!;
      const trackClass = draftIds.has(assignment.targetClassId)
        ? { filiereCode: input.newClasses.find((d) => d.clientDraftId === assignment.targetClassId)!.filiereCode ?? null,
            specialiteCode: input.newClasses.find((d) => d.clientDraftId === assignment.targetClassId)!.specialiteCode ?? null,
            gradeCode: assignment.gradeLevel }
        : (() => { const c = store.classes.find((c) => c.id === assignment.targetClassId); return c
            ? { filiereCode: c.filiereCode ?? null, specialiteCode: c.specialiteCode ?? null, gradeCode: c.gradeCode }
            : null; })();
      if (
        trackClass &&
        !trackCompatible(
          trackStudent.filiereCode,
          trackStudent.specialiteCode,
          trackClass.filiereCode,
          trackClass.specialiteCode,
          trackClass.gradeCode,
        )
      ) {
        return Err(Errors.validation(
          `${trackStudent.firstName} ${trackStudent.lastName} : ${
            trackIncompatibilityReason(trackStudent.filiereCode, trackClass.filiereCode, trackClass.gradeCode)
              ?? "classification incompatible avec la classe cible"}`,
        ));
      }
    }

    // ── Mutation pass (every check above passed — apply the whole batch)
    const createdIdMap = new Map<string, string>();
    let createdClassesCount = 0;
    for (const draft of input.newClasses) {
      const cls: AcademicClass = {
        id: `cls-${Date.now().toString(36)}-${createdClassesCount}`,
        tenantId: TENANT_ID,
        academicYearId: targetYear.id,
        // Mock-layer id convention (the Supabase layer resolves the real
        // academic_levels FK server-side — each layer keeps its own id
        // convention; the CONTRACT is identical).
        academicLevelId: `al-${draft.gradeCode}`,
        code: draft.code,
        name: draft.name,
        gradeCode: draft.gradeCode,
        // level/gradeYear are DERIVED from gradeCode (the canonical
        // helpers) — same as mapClassRow on the Supabase side; the RPC
        // never receives them.
        level: academicLevelFromGradeLevel(draft.gradeCode),
        gradeYear: gradeYearFromGradeLevel(draft.gradeCode),
        section: draft.section || "A",
        // T-401: the drafted section's classification (normalized like the
        // SQL side — "general" stores as NULL/untagged).
        filiereCode: normalizeTrackCode(draft.filiereCode),
        specialiteCode: normalizeTrackCode(draft.specialiteCode),
        room: draft.room,
        capacity: draft.capacity,
        enrolledCount: 0,
        homeroomTeacherId: draft.homeroomTeacherId,
        homeroomTeacherName: draft.homeroomTeacherName,
        notes: null,
        academicYear: targetYear.code,
        isActive: true,
      };
      store.classes.push(cls);
      createdIdMap.set(draft.clientDraftId, cls.id);
      createdClassesCount += 1;
    }

    let updatedClassesCount = 0;
    for (const patch of input.classesToUpdate) {
      const idx = store.classes.findIndex((c) => c.id === patch.id);
      if (idx >= 0) {
        store.classes[idx] = {
          ...store.classes[idx],
          ...(patch.room !== undefined ? { room: patch.room } : {}),
          ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
          ...(patch.homeroomTeacherId !== undefined
            ? { homeroomTeacherId: patch.homeroomTeacherId }
            : {}),
          ...(patch.homeroomTeacherName !== undefined
            ? { homeroomTeacherName: patch.homeroomTeacherName }
            : {}),
        };
        updatedClassesCount += 1;
      }
    }

    let assignedStudentsCount = 0;
    for (const assignment of input.studentAssignments) {
      const finalClassId =
        createdIdMap.get(assignment.targetClassId) ?? assignment.targetClassId;
      const idx = store.students.findIndex((s) => s.id === assignment.studentId);
      if (idx >= 0) {
        store.students[idx] = {
          ...store.students[idx],
          classId: finalClassId,
          gradeLevel: assignment.gradeLevel,
          level: assignment.level,
          gradeYear: assignment.gradeYear,
          // T-401: a tagged class stamps the student's classification (the
          // legitimate year-end transition — mirrors the RPC's Step C).
          ...(store.classes.find((c) => c.id === finalClassId)?.filiereCode
            ? { filiereCode: store.classes.find((c) => c.id === finalClassId)!.filiereCode }
            : {}),
          ...(store.classes.find((c) => c.id === finalClassId)?.specialiteCode
            ? { specialiteCode: store.classes.find((c) => c.id === finalClassId)!.specialiteCode }
            : {}),
          updatedAt: nowIso(),
        };
        assignedStudentsCount += 1;
      }
    }

    // Recompute enrolled counts (the students.class_id histogram).
    for (const cls of store.classes) {
      const count = store.students.filter(
        (s) => s.classId === cls.id && s.status === "active",
      ).length;
      const idx = store.classes.indexOf(cls);
      store.classes[idx] = { ...cls, enrolledCount: count };
    }

    store.classes$.set([...store.classes]);
    store.notifyStudents();

    // ONE audit entry for the whole batch (INV-5 of the 9ddde68 spec).
    appendAudit({
      action: AuditActions.ClassPlacementFinalize,
      entityType: "class",
      entityId: targetYear.code,
      actorId: input.performedBy,
      actorName: input.performedByName,
      diff: {
        before: null,
        after: {
          target_academic_year: targetYear.code,
          classes_created: createdClassesCount,
          classes_updated: updatedClassesCount,
          students_assigned: assignedStudentsCount,
        },
      },
      note: `Constitution des classes effectuée pour ${targetYear.code} : ${createdClassesCount} classe(s) créée(s), ${updatedClassesCount} mise(s) à jour, ${assignedStudentsCount} élève(s) affecté(s).`,
    });

    return Ok({
      targetYearId: targetYear.id,
      createdClassesCount,
      updatedClassesCount,
      assignedStudentsCount,
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
export const mockClassPlacementRepository: ClassPlacementRepository =
  new MockClassPlacementRepository();

export type { Observable };

// ============================================================================
// MockPromotionCycleRepository — T-403 (mirrors the 0108 RPC semantics)
// ============================================================================

/** Recursively strip readonly (the mock mutates its in-memory state). */
type DeepMutable<T> = { -readonly [K in keyof T]: DeepMutable<T[K]> };

interface MockCycleState {
  cycle: DeepMutable<PromotionCycle>;
  classes: DeepMutable<PromotionCycleClass>[];
}

export class MockPromotionCycleRepository implements PromotionCycleRepository {
  // One shared in-memory store per mock session (the mock-store pattern).
  private static readonly cycles: MockCycleState[] = [];

  static reset(): void {
    MockPromotionCycleRepository.cycles.length = 0;
  }

  private tenantClasses(sourceYear: string): AcademicClass[] {
    return store.classes.filter(
      (c) => (c.academicYear === sourceYear || c.academicYearId === `ay-${sourceYear}`) && c.isActive,
    );
  }

  private classStudentCount(classId: string): number {
    return store.students.filter(
      (s) => s.classId === classId && s.status === "active",
    ).length;
  }

  async listCycles(): Promise<Result<readonly PromotionCycle[]>> {
    await delay(120);
    return Ok(MockPromotionCycleRepository.cycles.map((c) => c.cycle));
  }

  async getCycleClasses(cycleId: string): Promise<Result<readonly PromotionCycleClass[]>> {
    await delay(120);
    const found = MockPromotionCycleRepository.cycles.find((c) => c.cycle.id === cycleId);
    if (!found) return Err(Errors.notFound("PromotionCycle", cycleId));
    return Ok(found.classes);
  }

  async openOrCreateCycle(input: CreatePromotionCycleInput): Promise<Result<PromotionCycle>> {
    await delay(200);
    const existing = MockPromotionCycleRepository.cycles.find(
      (c) => c.cycle.sourceAcademicYear === input.sourceAcademicYear && c.cycle.status !== "cancelled",
    );
    if (existing) return Ok(existing.cycle);

    const year = store.academicYears.find(
      (y) => y.code === input.sourceAcademicYear || y.label === input.sourceAcademicYear,
    );
    if (!year) {
      return Err(Errors.validation(
        `L'année scolaire source « ${input.sourceAcademicYear} » n'existe pas (créez-la dans Années scolaires d'abord).`,
      ));
    }
    const src = year.code ?? year.label;
    const target =
      input.targetAcademicYear ??
      `${Number(src.slice(0, 4)) + 1}-${Number(src.slice(0, 4)) + 2}`;

    const now = nowIso();
    const cycle: PromotionCycle = {
      id: `pc-${Date.now().toString(36)}`,
      sourceAcademicYear: src,
      targetAcademicYear: target,
      status: "draft",
      notes: null,
      createdByName: input.performedByName,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      completedByName: null,
      classesTotal: 0,
      classesProcessed: 0,
      studentsAwaiting: 0,
      promotedCount: 0,
      repeatingCount: 0,
      deferredCount: 0,
    };
    const classes: PromotionCycleClass[] = this.tenantClasses(src).map((c) => ({
      id: `pcc-${c.id}`,
      cycleId: cycle.id,
      classId: c.id,
      classCode: c.code,
      className: c.name,
      gradeCode: c.gradeCode,
      status: "pending" as const,
      studentsAwaiting: this.classStudentCount(c.id),
      promotedCount: 0,
      repeatingCount: 0,
      deferredCount: 0,
      exceptionNote: null,
      processedByName: null,
      processedAt: null,
    }));
    const mut = cycle as DeepMutable<PromotionCycle>;
    mut.classesTotal = classes.length;
    mut.studentsAwaiting = classes.reduce((sum, c) => sum + c.studentsAwaiting, 0);
    MockPromotionCycleRepository.cycles.push({ cycle, classes });

    appendAudit({
      action: AuditActions.ClassPlacementFinalize, // closest existing code; the SQL writes promotion.cycle_create
      entityType: "promotion_cycle",
      entityId: cycle.id,
      actorId: input.performedBy,
      actorName: input.performedByName,
      diff: { before: null, after: { source: src, target, classes: classes.length } },
    });
    return Ok(cycle);
  }

  async confirmClass(input: ConfirmPromotionCycleClassInput): Promise<Result<PromotionClassConfirmResult>> {
    await delay(280);
    const state = MockPromotionCycleRepository.cycles.find((c) => c.cycle.id === input.cycleId);
    if (!state) return Err(Errors.notFound("PromotionCycle", input.cycleId));
    if (state.cycle.status === "completed" || state.cycle.status === "cancelled") {
      return Err(Errors.validation(`Le cycle ${state.cycle.sourceAcademicYear} est ${state.cycle.status} — il ne peut plus être modifié.`));
    }
    const classRow = state.classes.find((c) => c.classId === input.classId);
    if (!classRow) return Err(Errors.notFound("PromotionCycleClass", input.classId));
    if (classRow.status !== "pending" && classRow.status !== "in_review") {
      return Err(Errors.validation(`La classe « ${classRow.className} » est déjà ${classRow.status} (rouvrez-la pour re-confirmer).`));
    }

    // Every active student of the class must have a decision.
    const classStudents = store.students.filter(
      (s) => s.classId === input.classId && s.status === "active",
    );
    const declared = new Set(
      input.decisions.map((d) => String(d.student_id ?? "")),
    );
    const missing = classStudents.filter((s) => !declared.has(s.id));
    if (missing.length > 0) {
      return Err(Errors.validation(
        `Chaque élève de la classe doit avoir une décision — manquants : ${missing.map((s) => `${s.firstName} ${s.lastName}`).join(", ")}`,
      ));
    }

    // The incomplete-notes two-phase ack (the client-side mirror).
    if (!input.acknowledgeIncompleteNotes) {
      const incomplete = classStudents.filter(
        (s) => !store.assessments.some(
          (a) => a.studentId === s.id && a.devoir1 != null && a.devoir2 != null && a.examen != null,
        ),
      );
      if (incomplete.length > 0) {
        return Err(Errors.validation(
          `[NOTES_INCOMPLETES] Les notes ne sont pas encore toutes renseignées (${incomplete.length} élève(s) : ${incomplete.map((s) => `${s.firstName} ${s.lastName}`).join(", ")}). Êtes-vous sûr de vouloir continuer ?`,
        ));
      }
    }

    // THE canonical execution: the same MockPromotionRepository semantics
    // (history append + grade advance + graduation) — one business path.
    const promoted = input.decisions.filter((d) => d.decision === "promoted").length;
    const repeated = input.decisions.filter((d) => d.decision === "repeated").length;
    const deferred = input.decisions.filter((d) => d.decision === "transferred" || d.decision === "graduated").length;

    for (const d of input.decisions) {
      const student = store.students.find((s) => s.id === d.student_id);
      if (!student) continue;
      const idx = store.students.indexOf(student);
      const decision = d.decision as "promoted" | "repeated" | "graduated" | "transferred";
      const next: Student = {
        ...student,
        ...(decision === "promoted" && typeof d.next_grade_code === "string"
          ? { gradeLevel: d.next_grade_code as Student["gradeLevel"], classId: null }
          : {}),
        ...(decision === "graduated" ? { status: "graduated" as const, classId: null } : {}),
        academicHistory: [
          ...(student.academicHistory ?? []),
        {
          id: `hist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          studentId: student.id,
          academicYear: String(d.academic_year ?? state.cycle.sourceAcademicYear),
          cycle: (d.cycle as AcademicHistoryEntry["cycle"]) ?? "lycee",
          level: academicLevelFromGradeLevel((d.grade_code as Student["gradeLevel"]) ?? student.gradeLevel),
          gradeCode: (d.grade_code as Student["gradeLevel"]) ?? student.gradeLevel,
          gradeYear: Number(d.grade_year ?? 0),
          classId: (d.class_id as string | null) ?? null,
          className: (d.class_name as string | null) ?? null,
          gpa: Number(d.gpa ?? 0),
          rank: (d.rank as number | null) ?? null,
          decision,
          narrative: (d.narrative as string | null) ?? null,
          recordedAt: nowIso(),
        },
        ],
      };
      store.students[idx] = next;
    }
    store.notifyStudents();

    classRow.status = "processed";
    classRow.studentsAwaiting = 0;
    classRow.promotedCount = promoted;
    classRow.repeatingCount = repeated;
    classRow.deferredCount = deferred;
    classRow.processedByName = input.performedByName;
    classRow.processedAt = nowIso();

    state.cycle.status =
      state.cycle.status === "draft" || state.cycle.status === "in_review"
        ? "partially_processed"
        : state.cycle.status;
    state.cycle.classesProcessed = state.classes.filter((c) => c.status === "processed").length;
    state.cycle.promotedCount = state.classes.reduce((s, c) => s + c.promotedCount, 0);
    state.cycle.repeatingCount = state.classes.reduce((s, c) => s + c.repeatingCount, 0);
    state.cycle.deferredCount = state.classes.reduce((s, c) => s + c.deferredCount, 0);
    state.cycle.studentsAwaiting = state.classes
      .filter((c) => c.status !== "processed" && c.status !== "skipped")
      .reduce((s, c) => s + c.studentsAwaiting, 0);
    state.cycle.updatedAt = nowIso();

    appendAudit({
      action: AuditActions.ClassPlacementFinalize,
      entityType: "promotion_cycle",
      entityId: state.cycle.id,
      actorId: input.performedBy,
      actorName: input.performedByName,
      diff: { before: null, after: { class: classRow.className, promoted, repeated, deferred } },
    });

    return Ok({
      cycleId: state.cycle.id,
      classId: classRow.classId,
      className: classRow.className,
      promoted,
      repeated,
      deferred,
      incompleteNotesCount: 0,
      incompleteNotesAcked: input.acknowledgeIncompleteNotes ?? false,
    });
  }

  async reopenClass(
    cycleId: string,
    classId: string,
    reason: string | null,
    performedBy: string,
    performedByName: string,
  ): Promise<Result<void>> {
    await delay(160);
    const state = MockPromotionCycleRepository.cycles.find((c) => c.cycle.id === cycleId);
    if (!state) return Err(Errors.notFound("PromotionCycle", cycleId));
    if (state.cycle.status === "completed" || state.cycle.status === "cancelled") {
      return Err(Errors.validation(`Le cycle ${state.cycle.sourceAcademicYear} est ${state.cycle.status}.`));
    }
    const classRow = state.classes.find((c) => c.classId === classId);
    if (!classRow) return Err(Errors.notFound("PromotionCycleClass", classId));
    if (classRow.status !== "processed" && classRow.status !== "exception" && classRow.status !== "skipped") {
      return Err(Errors.validation(`La classe « ${classRow.className} » est ${classRow.status} — rien à rouvrir.`));
    }
    classRow.status = "in_review";
    classRow.studentsAwaiting = this.classStudentCount(classId);
    classRow.exceptionNote = null;
    state.cycle.classesProcessed = state.classes.filter((c) => c.status === "processed").length;
    state.cycle.updatedAt = nowIso();
    return Ok(undefined);
  }

  async completeCycle(cycleId: string, performedBy: string, performedByName: string): Promise<Result<void>> {
    await delay(160);
    const state = MockPromotionCycleRepository.cycles.find((c) => c.cycle.id === cycleId);
    if (!state) return Err(Errors.notFound("PromotionCycle", cycleId));
    if (state.cycle.status === "completed") {
      return Err(Errors.validation("Le cycle est déjà terminé."));
    }
    const pending = state.classes.filter(
      (c) => c.status !== "processed" && c.status !== "exception" && c.status !== "skipped",
    );
    if (pending.length > 0) {
      return Err(Errors.validation(
        `Le cycle ne peut pas être terminé — classes restant à traiter : ${pending.map((c) => c.className).join(", ")}`,
      ));
    }
    state.cycle.status = "completed";
    state.cycle.completedAt = nowIso();
    state.cycle.completedByName = performedByName;
    state.cycle.updatedAt = nowIso();
    return Ok(undefined);
  }

  async cancelCycle(cycleId: string, reason: string | null, performedBy: string, performedByName: string): Promise<Result<void>> {
    await delay(160);
    const state = MockPromotionCycleRepository.cycles.find((c) => c.cycle.id === cycleId);
    if (!state) return Err(Errors.notFound("PromotionCycle", cycleId));
    if (state.cycle.status === "completed") {
      return Err(Errors.validation("Un cycle terminé ne peut pas être annulé (l'historique est immuable)."));
    }
    state.cycle.status = "cancelled";
    state.cycle.notes = reason ?? state.cycle.notes;
    state.cycle.updatedAt = nowIso();
    return Ok(undefined);
  }
}
export const mockPromotionCycleRepository: PromotionCycleRepository =
  new MockPromotionCycleRepository();
