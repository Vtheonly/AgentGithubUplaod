/**
 * Therapy domain model — Psychology (Psyc) + Speech Therapy (Orthophonie).
 *
 * Per plan §05.07:
 *   "Do not treat therapy sessions as a Club. Therapy services often have
 *    medical documentation requirements; keep them in a distinct sub-module
 *    with their own attachment schema."
 *
 * CRITICAL CONSTRAINTS:
 *   1. SENSITIVITY — These records contain medical/psychological information.
 *      Access is restricted to:
 *        - SuperAdmin (oversight only, audit-logged)
 *        - Manager (program oversight)
 *        - Designated psychologists / speech therapists (their own cases)
 *      Teachers, financial officers, support staff do NOT have access by default.
 *
 *   2. FINANCE ISOLATION — Therapy CRUD MUST NOT touch the ledger, payments,
 *      installments, debt, or receipts. Billing for therapy sessions is
 *      handled separately by Finance via the complementary-services pricing
 *      config (PSY1/PSY2/ORTH1/ORTH2 codes — see Clients_Sheet_Merged.md §02).
 *      The therapy repositories only manage clinical records.
 *
 *   3. NO GPA IMPACT — Therapy progress never feeds into Scolarité GPA.
 *
 *   4. PARENT CONSENT — Required before any follow-up can be opened.
 *      `parentConsent` flag must be true; `parentConsentDate` records when.
 *
 * Source: plan §05.07 "Extracurricular Clubs and Therapy"
 *         Clients_Sheet_Merged.md §02 (columns Z, AA, AB, AC)
 */

// ============================================================================
// Psychology (Psyc)
// ============================================================================

export type PsychologicalFollowUpStatus =
  | "active"      // ongoing therapy
  | "paused"      // temporarily paused (e.g. school holidays)
  | "closed";     // therapy concluded

export type PsychologicalSessionType =
  | "initial"     // first intake session
  | "follow_up"   // regular session
  | "emergency"   // urgent / crisis session
  | "closing";    // final session before closing the follow-up

export type ConfidentialityLevel =
  | "standard"     // visible to designated staff
  | "restricted";  // visible only to the psychologist + SuperAdmin

/**
 * Attachment kind for therapy medical documentation (vault §05.07:
 * "Therapy services often have medical documentation requirements; keep
 * them in a distinct sub-module with their own attachment schema").
 *
 * This schema is deliberately SEPARATE from student documents and homework
 * attachments — therapy records carry medical/psychological sensitivity and
 * are access-controlled by the therapy RBAC permissions, not the generic
 * student document permissions.
 */
export type TherapyAttachmentKind =
  | "medical_report"   // compte-rendu médical
  | "assessment"       // bilan / évaluation initiale
  | "prescription"     // ordonnance
  | "consent_form"     // consentement parental signé
  | "other";

export const THERAPY_ATTACHMENT_KIND_LABELS_FR: Record<TherapyAttachmentKind, string> = {
  medical_report: "Compte-rendu médical",
  assessment: "Bilan / Évaluation",
  prescription: "Ordonnance",
  consent_form: "Consentement parental",
  other: "Autre",
};

/** A medical-documentation attachment on a therapy follow-up (vault §05.07). */
export interface TherapyAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly kind: TherapyAttachmentKind;
  readonly uploadedBy: string;
  readonly uploadedAt: string; // ISO datetime
  readonly note: string | null;
}

/**
 * PsychologicalFollowUp — the umbrella case file for a student receiving
 * psychological support. A student can have multiple follow-ups over time
 * (e.g. one in 2025, another in 2027), but only ONE active follow-up at
 * a time per psychologist.
 */
export interface PsychologicalFollowUp {
  readonly id: string;
  readonly tenantId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentCode: string;
  /** Personnel ID of the psychologist assigned to this case. */
  readonly psychologistId: string;
  readonly psychologistName: string;
  /** Reason for referral (e.g. "Anxiété scolaire signalée par l'enseignant"). */
  readonly reason: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly status: PsychologicalFollowUpStatus;
  readonly confidentialityLevel: ConfidentialityLevel;
  readonly parentConsent: boolean;
  readonly parentConsentDate: string | null;
  /** High-level notes visible to authorized staff (NOT session details). */
  readonly notes: string | null;
  /**
   * Medical documentation attachments (vault §05.07 — own attachment schema,
   * distinct from student documents and clubs).
   */
  readonly attachments?: readonly TherapyAttachment[];
  readonly academicYearId: string;
  readonly academicYearCode: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePsychologicalFollowUpInput {
  readonly studentId: string;
  readonly psychologistId: string;
  readonly psychologistName: string;
  readonly reason: string;
  readonly startDate: string;
  readonly confidentialityLevel?: ConfidentialityLevel;
  readonly parentConsent: boolean;
  readonly parentConsentDate: string | null;
  readonly notes?: string | null;
  readonly attachments?: readonly TherapyAttachment[];
  readonly academicYearId: string;
  readonly academicYearCode: string;
}

export interface UpdatePsychologicalFollowUpInput {
  readonly reason?: string;
  readonly endDate?: string | null;
  readonly status?: PsychologicalFollowUpStatus;
  readonly confidentialityLevel?: ConfidentialityLevel;
  readonly notes?: string | null;
  readonly attachments?: readonly TherapyAttachment[];
}

/**
 * PsychologicalSession — a single therapy session.
 *
 * The `summary` is intentionally a brief overview — full session notes
 * are NOT stored in the system (per confidentiality best practices).
 * Detailed clinical notes belong in the psychologist's secure case files.
 */
export interface PsychologicalSession {
  readonly id: string;
  readonly tenantId: string;
  readonly followUpId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly psychologistId: string;
  readonly psychologistName: string;
  /** ISO datetime when the session took place. */
  readonly date: string;
  readonly durationMinutes: number;
  readonly type: PsychologicalSessionType;
  /** Brief summary (1-3 sentences) — clinical details stay offline. */
  readonly summary: string;
  readonly recommendations: string | null;
  readonly nextSessionDate: string | null;
  readonly conductedAt: string;
}

export interface ConductPsychologicalSessionInput {
  readonly followUpId: string;
  readonly date: string;
  readonly durationMinutes: number;
  readonly type: PsychologicalSessionType;
  readonly summary: string;
  readonly recommendations?: string | null;
  readonly nextSessionDate?: string | null;
  readonly conductedById: string;
  readonly conductedByName: string;
}

/**
 * PsychologicalReport — a periodic written report summarizing the student's
 * progress. Can optionally be shared with the parent and/or administration.
 */
export interface PsychologicalReport {
  readonly id: string;
  readonly tenantId: string;
  readonly followUpId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly psychologistId: string;
  readonly psychologistName: string;
  readonly title: string;
  /** Period covered, e.g. "Trimestre 1 — 2025-2026". */
  readonly period: string;
  /** Full report content (markdown). */
  readonly content: string;
  readonly sharedWithParent: boolean;
  readonly sharedWithAdministration: boolean;
  readonly createdAt: string;
}

export interface CreatePsychologicalReportInput {
  readonly followUpId: string;
  readonly title: string;
  readonly period: string;
  readonly content: string;
  readonly sharedWithParent?: boolean;
  readonly sharedWithAdministration?: boolean;
  readonly authoredById: string;
  readonly authoredByName: string;
}

// ============================================================================
// Speech Therapy (Orthophonie)
// ============================================================================

export type SpeechTherapyFollowUpStatus = "active" | "paused" | "closed";

export type SpeechTherapyEvaluationType =
  | "initial"      // baseline assessment
  | "reassessment" // mid-therapy progress check
  | "final";       // closing assessment

export type SpeechTherapyProgress =
  | "improving"
  | "stable"
  | "regressing";

/**
 * SpeechTherapyFollowUp — the umbrella case file for a student receiving
 * speech therapy. Same lifecycle semantics as PsychologicalFollowUp.
 */
export interface SpeechTherapyFollowUp {
  readonly id: string;
  readonly tenantId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentCode: string;
  /** Personnel ID of the speech therapist (orthophoniste). */
  readonly therapistId: string;
  readonly therapistName: string;
  readonly reason: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly status: SpeechTherapyFollowUpStatus;
  readonly parentConsent: boolean;
  readonly parentConsentDate: string | null;
  readonly notes: string | null;
  /** Medical documentation attachments (vault §05.07 — own schema). */
  readonly attachments?: readonly TherapyAttachment[];
  readonly academicYearId: string;
  readonly academicYearCode: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSpeechTherapyFollowUpInput {
  readonly studentId: string;
  readonly therapistId: string;
  readonly therapistName: string;
  readonly reason: string;
  readonly startDate: string;
  readonly parentConsent: boolean;
  readonly parentConsentDate: string | null;
  readonly notes?: string | null;
  readonly attachments?: readonly TherapyAttachment[];
  readonly academicYearId: string;
  readonly academicYearCode: string;
}

export interface UpdateSpeechTherapyFollowUpInput {
  readonly reason?: string;
  readonly endDate?: string | null;
  readonly status?: SpeechTherapyFollowUpStatus;
  readonly notes?: string | null;
  readonly attachments?: readonly TherapyAttachment[];
}

/**
 * SpeechTherapyEvaluation — a structured assessment of the student's speech,
 * language, and communication skills. Each axis is scored 0-100 (or null if
 * not evaluated in this session).
 */
export interface SpeechTherapyEvaluation {
  readonly id: string;
  readonly tenantId: string;
  readonly followUpId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly therapistId: string;
  readonly therapistName: string;
  readonly date: string;
  readonly type: SpeechTherapyEvaluationType;
  /** Articulation score 0-100 (pronunciation clarity). */
  readonly articulation: number | null;
  /** Fluency score 0-100 (smoothness of speech). */
  readonly fluency: number | null;
  /** Comprehension score 0-100 (receptive language). */
  readonly comprehension: number | null;
  /** Expression score 0-100 (expressive language). */
  readonly expression: number | null;
  readonly summary: string;
  readonly recommendations: string | null;
  readonly conductedAt: string;
}

export interface ConductSpeechTherapyEvaluationInput {
  readonly followUpId: string;
  readonly date: string;
  readonly type: SpeechTherapyEvaluationType;
  readonly articulation?: number | null;
  readonly fluency?: number | null;
  readonly comprehension?: number | null;
  readonly expression?: number | null;
  readonly summary: string;
  readonly recommendations?: string | null;
  readonly conductedById: string;
  readonly conductedByName: string;
}

/**
 * SpeechTherapySession — a single therapy session.
 *
 * Tracks the exercises practiced, observations, homework for next session,
 * and a high-level progress indicator.
 */
export interface SpeechTherapySession {
  readonly id: string;
  readonly tenantId: string;
  readonly followUpId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly therapistId: string;
  readonly therapistName: string;
  readonly date: string;
  readonly durationMinutes: number;
  /** Free-text list of exercises practiced during the session. */
  readonly exercises: string;
  /** Clinical observations during the session. */
  readonly observations: string;
  /** Homework / practice instructions for the next session. */
  readonly homework: string | null;
  readonly progress: SpeechTherapyProgress | null;
  readonly nextSessionDate: string | null;
  readonly conductedAt: string;
}

export interface ConductSpeechTherapySessionInput {
  readonly followUpId: string;
  readonly date: string;
  readonly durationMinutes: number;
  readonly exercises: string;
  readonly observations: string;
  readonly homework?: string | null;
  readonly progress?: SpeechTherapyProgress | null;
  readonly nextSessionDate?: string | null;
  readonly conductedById: string;
  readonly conductedByName: string;
}

// ============================================================================
// Status labels (French)
// ============================================================================

export const PSYCHOLOGICAL_FOLLOWUP_STATUS_LABELS_FR: Record<
  PsychologicalFollowUpStatus,
  string
> = {
  active: "Actif",
  paused: "En pause",
  closed: "Clôturé",
};

export const PSYCHOLOGICAL_SESSION_TYPE_LABELS_FR: Record<
  PsychologicalSessionType,
  string
> = {
  initial: "Séance initiale",
  follow_up: "Séance de suivi",
  emergency: "Urgence",
  closing: "Séance de clôture",
};

export const SPEECH_THERAPY_FOLLOWUP_STATUS_LABELS_FR: Record<
  SpeechTherapyFollowUpStatus,
  string
> = {
  active: "Actif",
  paused: "En pause",
  closed: "Clôturé",
};

export const SPEECH_THERAPY_EVALUATION_TYPE_LABELS_FR: Record<
  SpeechTherapyEvaluationType,
  string
> = {
  initial: "Évaluation initiale",
  reassessment: "Réévaluation",
  final: "Évaluation finale",
};

export const SPEECH_THERAPY_PROGRESS_LABELS_FR: Record<
  SpeechTherapyProgress,
  string
> = {
  improving: "En progrès",
  stable: "Stable",
  regressing: "En régression",
};

export const CONFIDENTIALITY_LABELS_FR: Record<ConfidentialityLevel, string> = {
  standard: "Standard",
  restricted: "Restreint",
};
