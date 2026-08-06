/**
 * Mock Therapy repositories — Psychology (Psyc) + Speech Therapy (Orthophonie).
 *
 * CRITICAL CONSTRAINTS:
 *   1. FINANCE ISOLATION — These repositories do NOT touch the ledger,
 *      payments, installments, debt, or receipts. Billing for therapy
 *      sessions is handled by Finance via PSY1/PSY2/ORTH1/ORTH2 codes.
 *
 *   2. SENSITIVITY — These records contain medical/psychological data.
 *      The repository exposes all data; the UI layer is responsible for
 *      filtering by RBAC (see `canViewPsychologicalFollowUp` etc.).
 *
 *   3. AUDIT — Every CRUD operation is audit-logged. Therapy audit entries
 *      should be treated with extra care (plan §05.07).
 */
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import type {
  PsychologicalFollowUp,
  PsychologicalSession,
  PsychologicalReport,
  CreatePsychologicalFollowUpInput,
  UpdatePsychologicalFollowUpInput,
  ConductPsychologicalSessionInput,
  CreatePsychologicalReportInput,
  SpeechTherapyFollowUp,
  SpeechTherapyEvaluation,
  SpeechTherapySession,
  CreateSpeechTherapyFollowUpInput,
  UpdateSpeechTherapyFollowUpInput,
  ConductSpeechTherapyEvaluationInput,
  ConductSpeechTherapySessionInput,
} from "../../../domain/model/therapy";
import type {
  PsychologyRepository,
  OrthophonieRepository,
} from "../../../domain/repository/therapy-repository";
import type { Observable } from "../../../domain/repository/repository";
import { SubjectBehavior } from "../subject-behavior";
import {
  validateCreatePsychologicalFollowUpInput,
  validateUpdatePsychologicalFollowUpInput,
  validateConductPsychologicalSessionInput,
  validateCreatePsychologicalReportInput,
  canOpenPsychologicalFollowUp,
  canClosePsychologicalFollowUp,
  validateCreateSpeechTherapyFollowUpInput,
  validateUpdateSpeechTherapyFollowUpInput,
  validateConductSpeechTherapyEvaluationInput,
  validateConductSpeechTherapySessionInput,
  canOpenSpeechTherapyFollowUp,
  canCloseSpeechTherapyFollowUp,
} from "../../../domain/calc/therapy/validation";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function lookupStudent(studentId: string) {
  return store.students.find((s) => s.id === studentId);
}

// ============================================================================
// Psychology repository
// ============================================================================

export class MockPsychologyRepository implements PsychologyRepository {
  // ---- Follow-ups ----
  observeFollowUps(): Observable<PsychologicalFollowUp[]> {
    return store.psychologicalFollowUps$;
  }

  observeFollowUpById(id: string): Observable<PsychologicalFollowUp | null> {
    return new SubjectBehavior(
      store.psychologicalFollowUps.find((f) => f.id === id) ?? null,
    );
  }

  observeFollowUpsByStudent(studentId: string): Observable<PsychologicalFollowUp[]> {
    return new SubjectBehavior(
      store.psychologicalFollowUps.filter((f) => f.studentId === studentId),
    );
  }

  observeFollowUpsByPsychologist(psychologistId: string): Observable<PsychologicalFollowUp[]> {
    return new SubjectBehavior(
      store.psychologicalFollowUps.filter((f) => f.psychologistId === psychologistId),
    );
  }

  async getFollowUpById(id: string): Promise<Result<PsychologicalFollowUp>> {
    await delay(50);
    const fu = store.psychologicalFollowUps.find((f) => f.id === id);
    if (!fu) return Err(Errors.notFound("PsychologicalFollowUp", id));
    return Ok(fu);
  }

  async createFollowUp(
    input: CreatePsychologicalFollowUpInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<PsychologicalFollowUp>> {
    await delay(150);
    const validation = validateCreatePsychologicalFollowUpInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const student = lookupStudent(input.studentId);
    if (!student) return Err(Errors.notFound("Student", input.studentId));

    // Check no active follow-up exists for this student+psychologist
    const existingActive = store.psychologicalFollowUps.filter(
      (f) => f.studentId === input.studentId && f.status === "active",
    );
    const canOpen = canOpenPsychologicalFollowUp(existingActive, input.psychologistId);
    if (!canOpen.isValid) {
      return Err(Errors.validation(canOpen.errors.join(" "), canOpen.errors.join(" ")));
    }

    const fu: PsychologicalFollowUp = {
      id: genId("psy-fu"),
      tenantId: TENANT_ID,
      studentId: input.studentId,
      studentName: `${student.firstName} ${student.lastName}`,
      studentCode: student.code,
      psychologistId: input.psychologistId,
      psychologistName: input.psychologistName,
      reason: input.reason,
      startDate: input.startDate,
      endDate: null,
      status: "active",
      confidentialityLevel: input.confidentialityLevel ?? "standard",
      parentConsent: input.parentConsent,
      parentConsentDate: input.parentConsentDate,
      notes: input.notes ?? null,
      academicYearId: input.academicYearId,
      academicYearCode: input.academicYearCode,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store.psychologicalFollowUps = [fu, ...store.psychologicalFollowUps];
    store.notifyPsychologicalFollowUps();

    appendAudit({
      action: AuditActions.PsychologyFollowUpCreate,
      entityType: "psychological_followup",
      entityId: fu.id,
      actorId,
      actorName,
      diff: { before: null, after: { studentId: student.id, psychologistId: input.psychologistId } },
      note: `Suivi psychologique ouvert pour ${fu.studentName}`,
    });

    return Ok(fu);
  }

  async updateFollowUp(
    id: string,
    input: UpdatePsychologicalFollowUpInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<PsychologicalFollowUp>> {
    await delay(120);
    const idx = store.psychologicalFollowUps.findIndex((f) => f.id === id);
    if (idx < 0) return Err(Errors.notFound("PsychologicalFollowUp", id));

    const before = store.psychologicalFollowUps[idx];
    const validation = validateUpdatePsychologicalFollowUpInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }

    const after: PsychologicalFollowUp = {
      ...before,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.confidentialityLevel !== undefined ? { confidentialityLevel: input.confidentialityLevel } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: nowIso(),
    };
    store.psychologicalFollowUps[idx] = after;
    store.notifyPsychologicalFollowUps();

    appendAudit({
      action: AuditActions.PsychologyFollowUpUpdate,
      entityType: "psychological_followup",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Suivi psychologique modifié pour ${after.studentName}`,
    });

    return Ok(after);
  }

  async closeFollowUp(
    id: string,
    endDate: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<PsychologicalFollowUp>> {
    await delay(120);
    const idx = store.psychologicalFollowUps.findIndex((f) => f.id === id);
    if (idx < 0) return Err(Errors.notFound("PsychologicalFollowUp", id));

    const before = store.psychologicalFollowUps[idx];
    const canClose = canClosePsychologicalFollowUp(before);
    if (!canClose.isValid) {
      return Err(Errors.validation(canClose.errors.join(" "), canClose.errors.join(" ")));
    }

    const after: PsychologicalFollowUp = {
      ...before,
      status: "closed",
      endDate,
      updatedAt: nowIso(),
    };
    store.psychologicalFollowUps[idx] = after;
    store.notifyPsychologicalFollowUps();

    appendAudit({
      action: AuditActions.PsychologyFollowUpClose,
      entityType: "psychological_followup",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Suivi psychologique clôturé pour ${after.studentName}`,
    });

    return Ok(after);
  }

  async deleteFollowUp(id: string, actorId: string, actorName: string): Promise<Result<void>> {
    await delay(120);
    const fu = store.psychologicalFollowUps.find((f) => f.id === id);
    if (!fu) return Err(Errors.notFound("PsychologicalFollowUp", id));

    store.psychologicalFollowUps = store.psychologicalFollowUps.filter((f) => f.id !== id);
    store.psychologicalSessions = store.psychologicalSessions.filter((s) => s.followUpId !== id);
    store.psychologicalReports = store.psychologicalReports.filter((r) => r.followUpId !== id);
    store.notifyPsychologicalFollowUps();
    store.notifyPsychologicalSessions();
    store.notifyPsychologicalReports();

    appendAudit({
      action: AuditActions.PsychologyFollowUpDelete,
      entityType: "psychological_followup",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { studentName: fu.studentName }, after: null },
      note: `Suivi psychologique supprimé pour ${fu.studentName}`,
    });

    return Ok(undefined);
  }

  // ---- Sessions ----
  observeSessions(followUpId: string): Observable<PsychologicalSession[]> {
    return new SubjectBehavior(
      store.psychologicalSessions
        .filter((s) => s.followUpId === followUpId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    );
  }

  observeSessionsByStudent(studentId: string): Observable<PsychologicalSession[]> {
    return new SubjectBehavior(
      store.psychologicalSessions.filter((s) => s.studentId === studentId),
    );
  }

  async conductSession(
    input: ConductPsychologicalSessionInput,
  ): Promise<Result<PsychologicalSession>> {
    await delay(120);
    const validation = validateConductPsychologicalSessionInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const fu = store.psychologicalFollowUps.find((f) => f.id === input.followUpId);
    if (!fu) return Err(Errors.notFound("PsychologicalFollowUp", input.followUpId));

    const session: PsychologicalSession = {
      id: genId("psy-s"),
      tenantId: TENANT_ID,
      followUpId: input.followUpId,
      studentId: fu.studentId,
      studentName: fu.studentName,
      psychologistId: fu.psychologistId,
      psychologistName: fu.psychologistName,
      date: input.date,
      durationMinutes: input.durationMinutes,
      type: input.type,
      summary: input.summary,
      recommendations: input.recommendations ?? null,
      nextSessionDate: input.nextSessionDate ?? null,
      conductedAt: nowIso(),
    };

    store.psychologicalSessions = [session, ...store.psychologicalSessions];
    store.notifyPsychologicalSessions();

    appendAudit({
      action: AuditActions.PsychologySessionConduct,
      entityType: "psychological_session",
      entityId: session.id,
      actorId: input.conductedById,
      actorName: input.conductedByName,
      diff: { before: null, after: { followUpId: fu.id, type: session.type } },
      note: `Séance psychologique menée pour ${session.studentName}`,
    });

    return Ok(session);
  }

  async deleteSession(id: string, actorId: string, actorName: string): Promise<Result<void>> {
    await delay(100);
    const session = store.psychologicalSessions.find((s) => s.id === id);
    if (!session) return Err(Errors.notFound("PsychologicalSession", id));

    store.psychologicalSessions = store.psychologicalSessions.filter((s) => s.id !== id);
    store.notifyPsychologicalSessions();

    appendAudit({
      action: AuditActions.PsychologySessionDelete,
      entityType: "psychological_session",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { studentName: session.studentName }, after: null },
      note: `Séance psychologique supprimée`,
    });

    return Ok(undefined);
  }

  // ---- Reports ----
  observeReports(followUpId: string): Observable<PsychologicalReport[]> {
    return new SubjectBehavior(
      store.psychologicalReports.filter((r) => r.followUpId === followUpId),
    );
  }

  async createReport(
    input: CreatePsychologicalReportInput,
  ): Promise<Result<PsychologicalReport>> {
    await delay(150);
    const validation = validateCreatePsychologicalReportInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const fu = store.psychologicalFollowUps.find((f) => f.id === input.followUpId);
    if (!fu) return Err(Errors.notFound("PsychologicalFollowUp", input.followUpId));

    const report: PsychologicalReport = {
      id: genId("psy-r"),
      tenantId: TENANT_ID,
      followUpId: input.followUpId,
      studentId: fu.studentId,
      studentName: fu.studentName,
      psychologistId: fu.psychologistId,
      psychologistName: fu.psychologistName,
      title: input.title,
      period: input.period,
      content: input.content,
      sharedWithParent: input.sharedWithParent ?? false,
      sharedWithAdministration: input.sharedWithAdministration ?? false,
      createdAt: nowIso(),
    };

    store.psychologicalReports = [report, ...store.psychologicalReports];
    store.notifyPsychologicalReports();

    appendAudit({
      action: AuditActions.PsychologyReportCreate,
      entityType: "psychological_report",
      entityId: report.id,
      actorId: input.authoredById,
      actorName: input.authoredByName,
      diff: { before: null, after: { title: report.title, period: report.period } },
      note: `Rapport psychologique créé pour ${report.studentName}`,
    });

    return Ok(report);
  }

  async deleteReport(id: string, actorId: string, actorName: string): Promise<Result<void>> {
    await delay(100);
    const report = store.psychologicalReports.find((r) => r.id === id);
    if (!report) return Err(Errors.notFound("PsychologicalReport", id));

    store.psychologicalReports = store.psychologicalReports.filter((r) => r.id !== id);
    store.notifyPsychologicalReports();

    appendAudit({
      action: AuditActions.PsychologyReportDelete,
      entityType: "psychological_report",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { title: report.title }, after: null },
      note: `Rapport psychologique supprimé`,
    });

    return Ok(undefined);
  }
}

// ============================================================================
// Speech Therapy (Orthophonie) repository
// ============================================================================

export class MockOrthophonieRepository implements OrthophonieRepository {
  // ---- Follow-ups ----
  observeFollowUps(): Observable<SpeechTherapyFollowUp[]> {
    return store.speechTherapyFollowUps$;
  }

  observeFollowUpById(id: string): Observable<SpeechTherapyFollowUp | null> {
    return new SubjectBehavior(
      store.speechTherapyFollowUps.find((f) => f.id === id) ?? null,
    );
  }

  observeFollowUpsByStudent(studentId: string): Observable<SpeechTherapyFollowUp[]> {
    return new SubjectBehavior(
      store.speechTherapyFollowUps.filter((f) => f.studentId === studentId),
    );
  }

  observeFollowUpsByTherapist(therapistId: string): Observable<SpeechTherapyFollowUp[]> {
    return new SubjectBehavior(
      store.speechTherapyFollowUps.filter((f) => f.therapistId === therapistId),
    );
  }

  async getFollowUpById(id: string): Promise<Result<SpeechTherapyFollowUp>> {
    await delay(50);
    const fu = store.speechTherapyFollowUps.find((f) => f.id === id);
    if (!fu) return Err(Errors.notFound("SpeechTherapyFollowUp", id));
    return Ok(fu);
  }

  async createFollowUp(
    input: CreateSpeechTherapyFollowUpInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<SpeechTherapyFollowUp>> {
    await delay(150);
    const validation = validateCreateSpeechTherapyFollowUpInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const student = lookupStudent(input.studentId);
    if (!student) return Err(Errors.notFound("Student", input.studentId));

    const existingActive = store.speechTherapyFollowUps.filter(
      (f) => f.studentId === input.studentId && f.status === "active",
    );
    const canOpen = canOpenSpeechTherapyFollowUp(existingActive, input.therapistId);
    if (!canOpen.isValid) {
      return Err(Errors.validation(canOpen.errors.join(" "), canOpen.errors.join(" ")));
    }

    const fu: SpeechTherapyFollowUp = {
      id: genId("ortho-fu"),
      tenantId: TENANT_ID,
      studentId: input.studentId,
      studentName: `${student.firstName} ${student.lastName}`,
      studentCode: student.code,
      therapistId: input.therapistId,
      therapistName: input.therapistName,
      reason: input.reason,
      startDate: input.startDate,
      endDate: null,
      status: "active",
      parentConsent: input.parentConsent,
      parentConsentDate: input.parentConsentDate,
      notes: input.notes ?? null,
      academicYearId: input.academicYearId,
      academicYearCode: input.academicYearCode,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store.speechTherapyFollowUps = [fu, ...store.speechTherapyFollowUps];
    store.notifySpeechTherapyFollowUps();

    appendAudit({
      action: AuditActions.OrthophonieFollowUpCreate,
      entityType: "speech_therapy_followup",
      entityId: fu.id,
      actorId,
      actorName,
      diff: { before: null, after: { studentId: student.id, therapistId: input.therapistId } },
      note: `Suivi orthophonique ouvert pour ${fu.studentName}`,
    });

    return Ok(fu);
  }

  async updateFollowUp(
    id: string,
    input: UpdateSpeechTherapyFollowUpInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<SpeechTherapyFollowUp>> {
    await delay(120);
    const idx = store.speechTherapyFollowUps.findIndex((f) => f.id === id);
    if (idx < 0) return Err(Errors.notFound("SpeechTherapyFollowUp", id));

    const before = store.speechTherapyFollowUps[idx];
    const validation = validateUpdateSpeechTherapyFollowUpInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }

    const after: SpeechTherapyFollowUp = {
      ...before,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: nowIso(),
    };
    store.speechTherapyFollowUps[idx] = after;
    store.notifySpeechTherapyFollowUps();

    appendAudit({
      action: AuditActions.OrthophonieFollowUpUpdate,
      entityType: "speech_therapy_followup",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Suivi orthophonique modifié pour ${after.studentName}`,
    });

    return Ok(after);
  }

  async closeFollowUp(
    id: string,
    endDate: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<SpeechTherapyFollowUp>> {
    await delay(120);
    const idx = store.speechTherapyFollowUps.findIndex((f) => f.id === id);
    if (idx < 0) return Err(Errors.notFound("SpeechTherapyFollowUp", id));

    const before = store.speechTherapyFollowUps[idx];
    const canClose = canCloseSpeechTherapyFollowUp(before);
    if (!canClose.isValid) {
      return Err(Errors.validation(canClose.errors.join(" "), canClose.errors.join(" ")));
    }

    const after: SpeechTherapyFollowUp = {
      ...before,
      status: "closed",
      endDate,
      updatedAt: nowIso(),
    };
    store.speechTherapyFollowUps[idx] = after;
    store.notifySpeechTherapyFollowUps();

    appendAudit({
      action: AuditActions.OrthophonieFollowUpClose,
      entityType: "speech_therapy_followup",
      entityId: id,
      actorId,
      actorName,
      diff: { before, after },
      note: `Suivi orthophonique clôturé pour ${after.studentName}`,
    });

    return Ok(after);
  }

  async deleteFollowUp(id: string, actorId: string, actorName: string): Promise<Result<void>> {
    await delay(120);
    const fu = store.speechTherapyFollowUps.find((f) => f.id === id);
    if (!fu) return Err(Errors.notFound("SpeechTherapyFollowUp", id));

    store.speechTherapyFollowUps = store.speechTherapyFollowUps.filter((f) => f.id !== id);
    store.speechTherapyEvaluations = store.speechTherapyEvaluations.filter((e) => e.followUpId !== id);
    store.speechTherapySessions = store.speechTherapySessions.filter((s) => s.followUpId !== id);
    store.notifySpeechTherapyFollowUps();
    store.notifySpeechTherapyEvaluations();
    store.notifySpeechTherapySessions();

    appendAudit({
      action: AuditActions.OrthophonieFollowUpDelete,
      entityType: "speech_therapy_followup",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { studentName: fu.studentName }, after: null },
      note: `Suivi orthophonique supprimé pour ${fu.studentName}`,
    });

    return Ok(undefined);
  }

  // ---- Evaluations ----
  observeEvaluations(followUpId: string): Observable<SpeechTherapyEvaluation[]> {
    return new SubjectBehavior(
      store.speechTherapyEvaluations
        .filter((e) => e.followUpId === followUpId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    );
  }

  async conductEvaluation(
    input: ConductSpeechTherapyEvaluationInput,
  ): Promise<Result<SpeechTherapyEvaluation>> {
    await delay(150);
    const validation = validateConductSpeechTherapyEvaluationInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const fu = store.speechTherapyFollowUps.find((f) => f.id === input.followUpId);
    if (!fu) return Err(Errors.notFound("SpeechTherapyFollowUp", input.followUpId));

    const evaluation: SpeechTherapyEvaluation = {
      id: genId("ortho-e"),
      tenantId: TENANT_ID,
      followUpId: input.followUpId,
      studentId: fu.studentId,
      studentName: fu.studentName,
      therapistId: fu.therapistId,
      therapistName: fu.therapistName,
      date: input.date,
      type: input.type,
      articulation: input.articulation ?? null,
      fluency: input.fluency ?? null,
      comprehension: input.comprehension ?? null,
      expression: input.expression ?? null,
      summary: input.summary,
      recommendations: input.recommendations ?? null,
      conductedAt: nowIso(),
    };

    store.speechTherapyEvaluations = [evaluation, ...store.speechTherapyEvaluations];
    store.notifySpeechTherapyEvaluations();

    appendAudit({
      action: AuditActions.OrthophonieEvaluationConduct,
      entityType: "speech_therapy_evaluation",
      entityId: evaluation.id,
      actorId: input.conductedById,
      actorName: input.conductedByName,
      diff: { before: null, after: { type: evaluation.type, followUpId: fu.id } },
      note: `Évaluation orthophonique menée pour ${evaluation.studentName}`,
    });

    return Ok(evaluation);
  }

  async deleteEvaluation(id: string, actorId: string, actorName: string): Promise<Result<void>> {
    await delay(100);
    const evaluation = store.speechTherapyEvaluations.find((e) => e.id === id);
    if (!evaluation) return Err(Errors.notFound("SpeechTherapyEvaluation", id));

    store.speechTherapyEvaluations = store.speechTherapyEvaluations.filter((e) => e.id !== id);
    store.notifySpeechTherapyEvaluations();

    appendAudit({
      action: AuditActions.OrthophonieEvaluationDelete,
      entityType: "speech_therapy_evaluation",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { studentName: evaluation.studentName }, after: null },
      note: `Évaluation orthophonique supprimée`,
    });

    return Ok(undefined);
  }

  // ---- Sessions ----
  observeSessions(followUpId: string): Observable<SpeechTherapySession[]> {
    return new SubjectBehavior(
      store.speechTherapySessions
        .filter((s) => s.followUpId === followUpId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    );
  }

  observeSessionsByStudent(studentId: string): Observable<SpeechTherapySession[]> {
    return new SubjectBehavior(
      store.speechTherapySessions.filter((s) => s.studentId === studentId),
    );
  }

  async conductSession(
    input: ConductSpeechTherapySessionInput,
  ): Promise<Result<SpeechTherapySession>> {
    await delay(120);
    const validation = validateConductSpeechTherapySessionInput(input);
    if (!validation.isValid) {
      return Err(Errors.validation(validation.errors.join(" "), validation.errors.join(" ")));
    }
    const fu = store.speechTherapyFollowUps.find((f) => f.id === input.followUpId);
    if (!fu) return Err(Errors.notFound("SpeechTherapyFollowUp", input.followUpId));

    const session: SpeechTherapySession = {
      id: genId("ortho-s"),
      tenantId: TENANT_ID,
      followUpId: input.followUpId,
      studentId: fu.studentId,
      studentName: fu.studentName,
      therapistId: fu.therapistId,
      therapistName: fu.therapistName,
      date: input.date,
      durationMinutes: input.durationMinutes,
      exercises: input.exercises,
      observations: input.observations,
      homework: input.homework ?? null,
      progress: input.progress ?? null,
      nextSessionDate: input.nextSessionDate ?? null,
      conductedAt: nowIso(),
    };

    store.speechTherapySessions = [session, ...store.speechTherapySessions];
    store.notifySpeechTherapySessions();

    appendAudit({
      action: AuditActions.OrthophonieSessionConduct,
      entityType: "speech_therapy_session",
      entityId: session.id,
      actorId: input.conductedById,
      actorName: input.conductedByName,
      diff: { before: null, after: { followUpId: fu.id } },
      note: `Séance orthophonique menée pour ${session.studentName}`,
    });

    return Ok(session);
  }

  async deleteSession(id: string, actorId: string, actorName: string): Promise<Result<void>> {
    await delay(100);
    const session = store.speechTherapySessions.find((s) => s.id === id);
    if (!session) return Err(Errors.notFound("SpeechTherapySession", id));

    store.speechTherapySessions = store.speechTherapySessions.filter((s) => s.id !== id);
    store.notifySpeechTherapySessions();

    appendAudit({
      action: AuditActions.OrthophonieSessionDelete,
      entityType: "speech_therapy_session",
      entityId: id,
      actorId,
      actorName,
      diff: { before: { studentName: session.studentName }, after: null },
      note: `Séance orthophonique supprimée`,
    });

    return Ok(undefined);
  }
}

export const mockPsychologyRepository: PsychologyRepository = new MockPsychologyRepository();
export const mockOrthophonieRepository: OrthophonieRepository = new MockOrthophonieRepository();
