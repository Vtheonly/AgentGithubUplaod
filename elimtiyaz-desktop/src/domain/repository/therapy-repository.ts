/**
 * Therapy repository interface — plan §05.07.
 *
 * CRUD + session + report operations for Psychology (Psyc) and Speech
 * Therapy (Orthophonie) follow-ups.
 *
 * CRITICAL CONSTRAINTS:
 *   1. SENSITIVITY — These records contain medical/psychological data.
 *      The repository MUST enforce role-based visibility:
 *        - SuperAdmin / Manager: full oversight
 *        - Designated therapist: their own cases
 *        - Others: filtered by confidentiality level + permission
 *      The mock implementation does NOT do role filtering itself — that's
 *      the UI layer's job using `canViewPsychologicalFollowUp` etc. The
 *      repository simply exposes all data and trusts the UI to filter.
 *      Production (Supabase) implementations SHOULD enforce RLS.
 *
 *   2. FINANCE ISOLATION — Therapy CRUD MUST NOT touch the ledger, payments,
 *      installments, debt, or receipts. Billing for therapy sessions is
 *      handled separately by Finance via PSY1/PSY2/ORTH1/ORTH2 codes.
 */
import type { Result } from "../../core/result";
import type { Observable } from "./repository";
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
} from "../model/therapy";

// ============================================================================
// Psychology repository
// ============================================================================

export interface PsychologyRepository {
  // ---- Follow-ups ----
  observeFollowUps(): Observable<PsychologicalFollowUp[]>;
  observeFollowUpById(id: string): Observable<PsychologicalFollowUp | null>;
  observeFollowUpsByStudent(studentId: string): Observable<PsychologicalFollowUp[]>;
  observeFollowUpsByPsychologist(psychologistId: string): Observable<PsychologicalFollowUp[]>;
  getFollowUpById(id: string): Promise<Result<PsychologicalFollowUp>>;
  createFollowUp(
    input: CreatePsychologicalFollowUpInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<PsychologicalFollowUp>>;
  updateFollowUp(
    id: string,
    input: UpdatePsychologicalFollowUpInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<PsychologicalFollowUp>>;
  closeFollowUp(
    id: string,
    endDate: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<PsychologicalFollowUp>>;
  deleteFollowUp(id: string, actorId: string, actorName: string): Promise<Result<void>>;

  // ---- Sessions ----
  observeSessions(followUpId: string): Observable<PsychologicalSession[]>;
  observeSessionsByStudent(studentId: string): Observable<PsychologicalSession[]>;
  conductSession(
    input: ConductPsychologicalSessionInput,
  ): Promise<Result<PsychologicalSession>>;
  deleteSession(id: string, actorId: string, actorName: string): Promise<Result<void>>;

  // ---- Reports ----
  observeReports(followUpId: string): Observable<PsychologicalReport[]>;
  createReport(
    input: CreatePsychologicalReportInput,
  ): Promise<Result<PsychologicalReport>>;
  deleteReport(id: string, actorId: string, actorName: string): Promise<Result<void>>;
}

// ============================================================================
// Speech Therapy (Orthophonie) repository
// ============================================================================

export interface OrthophonieRepository {
  // ---- Follow-ups ----
  observeFollowUps(): Observable<SpeechTherapyFollowUp[]>;
  observeFollowUpById(id: string): Observable<SpeechTherapyFollowUp | null>;
  observeFollowUpsByStudent(studentId: string): Observable<SpeechTherapyFollowUp[]>;
  observeFollowUpsByTherapist(therapistId: string): Observable<SpeechTherapyFollowUp[]>;
  getFollowUpById(id: string): Promise<Result<SpeechTherapyFollowUp>>;
  createFollowUp(
    input: CreateSpeechTherapyFollowUpInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<SpeechTherapyFollowUp>>;
  updateFollowUp(
    id: string,
    input: UpdateSpeechTherapyFollowUpInput,
    actorId: string,
    actorName: string,
  ): Promise<Result<SpeechTherapyFollowUp>>;
  closeFollowUp(
    id: string,
    endDate: string,
    actorId: string,
    actorName: string,
  ): Promise<Result<SpeechTherapyFollowUp>>;
  deleteFollowUp(id: string, actorId: string, actorName: string): Promise<Result<void>>;

  // ---- Evaluations ----
  observeEvaluations(followUpId: string): Observable<SpeechTherapyEvaluation[]>;
  conductEvaluation(
    input: ConductSpeechTherapyEvaluationInput,
  ): Promise<Result<SpeechTherapyEvaluation>>;
  deleteEvaluation(id: string, actorId: string, actorName: string): Promise<Result<void>>;

  // ---- Sessions ----
  observeSessions(followUpId: string): Observable<SpeechTherapySession[]>;
  observeSessionsByStudent(studentId: string): Observable<SpeechTherapySession[]>;
  conductSession(
    input: ConductSpeechTherapySessionInput,
  ): Promise<Result<SpeechTherapySession>>;
  deleteSession(id: string, actorId: string, actorName: string): Promise<Result<void>>;
}
