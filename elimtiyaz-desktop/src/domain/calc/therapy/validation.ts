/**
 * Therapy validation + business rules (plan §05.07).
 *
 * Enforces the sensitivity + consent + uniqueness constraints that apply
 * to both Psychology (Psyc) and Speech Therapy (Orthophonie) follow-ups.
 *
 * CRITICAL: These rules exist to protect student medical/psychological data.
 * Do not relax them without explicit business approval.
 */
import type {
  PsychologicalFollowUp,
  SpeechTherapyFollowUp,
  CreatePsychologicalFollowUpInput,
  UpdatePsychologicalFollowUpInput,
  ConductPsychologicalSessionInput,
  CreatePsychologicalReportInput,
  CreateSpeechTherapyFollowUpInput,
  UpdateSpeechTherapyFollowUpInput,
  ConductSpeechTherapyEvaluationInput,
  ConductSpeechTherapySessionInput,
} from "../../model/therapy";
import type { ValidationResult } from "../clubs/validation";
import { ok, fail } from "../clubs/validation";

// Re-export for convenience
export { ok, fail };
export type { ValidationResult };

// ============================================================================
// Common validators
// ============================================================================

export function validateReason(reason: string): ValidationResult {
  if (!reason || reason.trim().length === 0) {
    return fail("Le motif de suivi est requis.");
  }
  if (reason.trim().length < 10) {
    return fail("Le motif doit contenir au moins 10 caractères.");
  }
  if (reason.length > 1000) {
    return fail("Le motif ne peut pas dépasser 1000 caractères.");
  }
  return ok();
}

export function validateStartDate(startDate: string): ValidationResult {
  if (!startDate) return fail("La date de début est requise.");
  const d = new Date(startDate);
  if (isNaN(d.getTime())) return fail("Date de début invalide.");
  return ok();
}

export function validateParentConsent(
  consent: boolean,
  consentDate: string | null,
): ValidationResult {
  if (!consent) {
    return fail(
      "Le consentement parental est OBLIGATOIRE avant d'ouvrir un suivi thérapeutique.",
    );
  }
  if (!consentDate) {
    return fail("La date du consentement parental est requise.");
  }
  const d = new Date(consentDate);
  if (isNaN(d.getTime())) return fail("Date de consentement invalide.");
  return ok();
}

export function validateDurationMinutes(minutes: number): ValidationResult {
  if (!Number.isFinite(minutes) || minutes < 1) {
    return fail("La durée doit être un nombre positif de minutes.");
  }
  if (minutes > 8 * 60) {
    return fail("La durée d'une séance ne peut pas dépasser 8 heures.");
  }
  return ok();
}

export function validateSessionDate(date: string): ValidationResult {
  if (!date) return fail("La date de la séance est requise.");
  const d = new Date(date);
  if (isNaN(d.getTime())) return fail("Date de séance invalide.");
  // Sessions cannot be dated more than 1 year in the future
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  if (d > oneYearFromNow) {
    return fail("La date de séance ne peut pas être plus d'un an dans le futur.");
  }
  return ok();
}

// ============================================================================
// Psychology (Psyc) validators
// ============================================================================

export function validateCreatePsychologicalFollowUpInput(
  input: CreatePsychologicalFollowUpInput,
): ValidationResult {
  const errors: string[] = [];
  if (!input.studentId) errors.push("Élève requis.");
  if (!input.psychologistId) errors.push("Psychologue requis.");
  if (!input.psychologistName) errors.push("Nom du psychologue requis.");
  const reasonRes = validateReason(input.reason);
  if (!reasonRes.isValid) errors.push(...reasonRes.errors);
  const startRes = validateStartDate(input.startDate);
  if (!startRes.isValid) errors.push(...startRes.errors);
  const consentRes = validateParentConsent(input.parentConsent, input.parentConsentDate);
  if (!consentRes.isValid) errors.push(...consentRes.errors);
  if (input.confidentialityLevel && !["standard", "restricted"].includes(input.confidentialityLevel)) {
    errors.push("Niveau de confidentialité invalide.");
  }
  if (!input.academicYearId) errors.push("Année scolaire requise.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateUpdatePsychologicalFollowUpInput(
  input: UpdatePsychologicalFollowUpInput,
): ValidationResult {
  const errors: string[] = [];
  if (input.reason !== undefined) {
    const r = validateReason(input.reason);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (input.status !== undefined && !["active", "paused", "closed"].includes(input.status)) {
    errors.push("Statut de suivi invalide.");
  }
  if (
    input.confidentialityLevel !== undefined &&
    !["standard", "restricted"].includes(input.confidentialityLevel)
  ) {
    errors.push("Niveau de confidentialité invalide.");
  }
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateConductPsychologicalSessionInput(
  input: ConductPsychologicalSessionInput,
): ValidationResult {
  const errors: string[] = [];
  if (!input.followUpId) errors.push("Suivi requis.");
  const dateRes = validateSessionDate(input.date);
  if (!dateRes.isValid) errors.push(...dateRes.errors);
  const durRes = validateDurationMinutes(input.durationMinutes);
  if (!durRes.isValid) errors.push(...durRes.errors);
  if (!input.type || !["initial", "follow_up", "emergency", "closing"].includes(input.type)) {
    errors.push("Type de séance invalide.");
  }
  if (!input.summary || input.summary.trim().length === 0) {
    errors.push("Le résumé de la séance est requis.");
  }
  if (input.summary && input.summary.length > 2000) {
    errors.push("Le résumé ne peut pas dépasser 2000 caractères.");
  }
  if (!input.conductedById) errors.push("Psychologue responsable requis.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateCreatePsychologicalReportInput(
  input: CreatePsychologicalReportInput,
): ValidationResult {
  const errors: string[] = [];
  if (!input.followUpId) errors.push("Suivi requis.");
  if (!input.title || input.title.trim().length === 0) errors.push("Titre requis.");
  if (input.title && input.title.length > 200) errors.push("Le titre ne peut pas dépasser 200 caractères.");
  if (!input.period || input.period.trim().length === 0) errors.push("Période requise.");
  if (!input.content || input.content.trim().length === 0) errors.push("Contenu requis.");
  if (input.content && input.content.length > 20000) {
    errors.push("Le contenu ne peut pas dépasser 20000 caractères.");
  }
  if (!input.authoredById) errors.push("Auteur requis.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

/**
 * Check whether a new psychological follow-up can be opened for a student.
 * Business rule: only ONE active follow-up per psychologist per student.
 */
export function canOpenPsychologicalFollowUp(
  studentActiveFollowUps: readonly PsychologicalFollowUp[],
  psychologistId: string,
): ValidationResult {
  const conflict = studentActiveFollowUps.find(
    (f) => f.psychologistId === psychologistId && f.status === "active",
  );
  if (conflict) {
    return fail(
      "L'élève a déjà un suivi psychologique actif avec ce psychologue. Clôturez le suivi existant d'abord.",
    );
  }
  return ok();
}

export function canClosePsychologicalFollowUp(
  followUp: PsychologicalFollowUp,
): ValidationResult {
  if (followUp.status === "closed") {
    return fail("Le suivi est déjà clôturé.");
  }
  return ok();
}

// ============================================================================
// Speech Therapy (Orthophonie) validators
// ============================================================================

export function validateCreateSpeechTherapyFollowUpInput(
  input: CreateSpeechTherapyFollowUpInput,
): ValidationResult {
  const errors: string[] = [];
  if (!input.studentId) errors.push("Élève requis.");
  if (!input.therapistId) errors.push("Orthophoniste requis.");
  if (!input.therapistName) errors.push("Nom de l'orthophoniste requis.");
  const reasonRes = validateReason(input.reason);
  if (!reasonRes.isValid) errors.push(...reasonRes.errors);
  const startRes = validateStartDate(input.startDate);
  if (!startRes.isValid) errors.push(...startRes.errors);
  const consentRes = validateParentConsent(input.parentConsent, input.parentConsentDate);
  if (!consentRes.isValid) errors.push(...consentRes.errors);
  if (!input.academicYearId) errors.push("Année scolaire requise.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateUpdateSpeechTherapyFollowUpInput(
  input: UpdateSpeechTherapyFollowUpInput,
): ValidationResult {
  const errors: string[] = [];
  if (input.reason !== undefined) {
    const r = validateReason(input.reason);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (input.status !== undefined && !["active", "paused", "closed"].includes(input.status)) {
    errors.push("Statut de suivi invalide.");
  }
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateConductSpeechTherapyEvaluationInput(
  input: ConductSpeechTherapyEvaluationInput,
): ValidationResult {
  const errors: string[] = [];
  if (!input.followUpId) errors.push("Suivi requis.");
  const dateRes = validateSessionDate(input.date);
  if (!dateRes.isValid) errors.push(...dateRes.errors);
  if (!input.type || !["initial", "reassessment", "final"].includes(input.type)) {
    errors.push("Type d'évaluation invalide.");
  }
  // Each score axis is 0-100 or null
  for (const [name, val] of [
    ["Articulation", input.articulation],
    ["Fluence", input.fluency],
    ["Compréhension", input.comprehension],
    ["Expression", input.expression],
  ] as const) {
    if (val != null) {
      if (!Number.isFinite(val) || val < 0 || val > 100) {
        errors.push(`${name} : score invalide (0-100 attendu).`);
      }
    }
  }
  if (!input.summary || input.summary.trim().length === 0) {
    errors.push("Le résumé est requis.");
  }
  if (input.summary && input.summary.length > 2000) {
    errors.push("Le résumé ne peut pas dépasser 2000 caractères.");
  }
  if (!input.conductedById) errors.push("Orthophoniste responsable requis.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateConductSpeechTherapySessionInput(
  input: ConductSpeechTherapySessionInput,
): ValidationResult {
  const errors: string[] = [];
  if (!input.followUpId) errors.push("Suivi requis.");
  const dateRes = validateSessionDate(input.date);
  if (!dateRes.isValid) errors.push(...dateRes.errors);
  const durRes = validateDurationMinutes(input.durationMinutes);
  if (!durRes.isValid) errors.push(...durRes.errors);
  if (!input.exercises || input.exercises.trim().length === 0) {
    errors.push("Les exercices pratiqués sont requis.");
  }
  if (input.exercises && input.exercises.length > 2000) {
    errors.push("Les exercices ne peuvent pas dépasser 2000 caractères.");
  }
  if (!input.observations || input.observations.trim().length === 0) {
    errors.push("Les observations sont requises.");
  }
  if (input.observations && input.observations.length > 2000) {
    errors.push("Les observations ne peuvent pas dépasser 2000 caractères.");
  }
  if (
    input.progress !== undefined &&
    input.progress !== null &&
    !["improving", "stable", "regressing"].includes(input.progress)
  ) {
    errors.push("Indicateur de progression invalide.");
  }
  if (!input.conductedById) errors.push("Orthophoniste responsable requis.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function canOpenSpeechTherapyFollowUp(
  studentActiveFollowUps: readonly SpeechTherapyFollowUp[],
  therapistId: string,
): ValidationResult {
  const conflict = studentActiveFollowUps.find(
    (f) => f.therapistId === therapistId && f.status === "active",
  );
  if (conflict) {
    return fail(
      "L'élève a déjà un suivi orthophonique actif avec cet orthophoniste. Clôturez le suivi existant d'abord.",
    );
  }
  return ok();
}

export function canCloseSpeechTherapyFollowUp(
  followUp: SpeechTherapyFollowUp,
): ValidationResult {
  if (followUp.status === "closed") {
    return fail("Le suivi est déjà clôturé.");
  }
  return ok();
}

// ============================================================================
// RBAC enforcement helpers
// ============================================================================

/**
 * Check whether a session can view a psychological follow-up.
 *
 * Access policy:
 *   - SuperAdmin: always (oversight)
 *   - Manager: always (program oversight)
 *   - The assigned psychologist: yes
 *   - Others: only if confidentiality is "standard" AND they have ViewPsychology
 *
 * The caller is responsible for passing the right permission set — this
 * helper just centralizes the logic.
 */
export function canViewPsychologicalFollowUp(
  followUp: PsychologicalFollowUp,
  session: {
    userId: string;
    role: string;
    hasPermission: (perm: string) => boolean;
  },
): boolean {
  // SuperAdmin + Manager: full oversight
  if (session.role === "super_admin" || session.role === "manager") return true;
  // Assigned psychologist: their own case
  if (session.userId === followUp.psychologistId) return true;
  // Standard confidentiality + ViewPsychology permission
  if (
    followUp.confidentialityLevel === "standard" &&
    session.hasPermission("view_psychology")
  ) {
    return true;
  }
  return false;
}

export function canViewSpeechTherapyFollowUp(
  followUp: SpeechTherapyFollowUp,
  session: {
    userId: string;
    role: string;
    hasPermission: (perm: string) => boolean;
  },
): boolean {
  // Same policy as psychological — no extra confidentiality level for orthophonie
  if (session.role === "super_admin" || session.role === "manager") return true;
  if (session.userId === followUp.therapistId) return true;
  if (session.hasPermission("view_orthophonie")) return true;
  return false;
}
