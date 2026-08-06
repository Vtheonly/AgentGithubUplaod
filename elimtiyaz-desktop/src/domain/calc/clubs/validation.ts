/**
 * Clubs validation + business rules (plan §05.07).
 *
 * Pure functions — no side effects, no I/O. Used by both the mock and
 * Supabase repository implementations to enforce consistent validation.
 */
import type {
  Club,
  ClubCategory,
  CreateClubInput,
  UpdateClubInput,
  EnrollMemberInput,
  WithdrawMemberInput,
  LogActivityInput,
  ClubMembership,
} from "../../model/club";

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

export function ok(): ValidationResult {
  return { isValid: true, errors: [] };
}

export function fail(...errors: string[]): ValidationResult {
  return { isValid: false, errors };
}

/** Validate a club code format. Must be uppercase, alphanumeric + dashes, 3-40 chars. */
export function validateClubCode(code: string): ValidationResult {
  if (!code || code.trim().length === 0) return fail("Le code du club est requis.");
  if (code.length < 3) return fail("Le code du club doit contenir au moins 3 caractères.");
  if (code.length > 40) return fail("Le code du club ne peut pas dépasser 40 caractères.");
  if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(code)) {
    return fail(
      "Le code du club doit être en majuscules, alphanumérique (tirets autorisés).",
    );
  }
  return ok();
}

export function validateClubName(name: string): ValidationResult {
  if (!name || name.trim().length === 0) return fail("Le nom du club est requis.");
  if (name.trim().length < 3) return fail("Le nom du club doit contenir au moins 3 caractères.");
  if (name.length > 120) return fail("Le nom du club ne peut pas dépasser 120 caractères.");
  return ok();
}

export function validateClubCategory(category: ClubCategory): ValidationResult {
  const valid: readonly ClubCategory[] = [
    "chess",
    "english",
    "it",
    "sports_arts",
    "other",
  ];
  if (!valid.includes(category)) return fail("Catégorie de club invalide.");
  return ok();
}

export function validateClubCapacity(capacity: number | null | undefined): ValidationResult {
  if (capacity == null) return ok(); // null = unlimited
  if (!Number.isFinite(capacity)) return fail("La capacité doit être un nombre.");
  if (!Number.isInteger(capacity)) return fail("La capacité doit être un entier.");
  if (capacity < 1) return fail("La capacité doit être au moins 1 (ou null pour illimité).");
  if (capacity > 1000) return fail("La capacité ne peut pas dépasser 1000.");
  return ok();
}

export function validateCreateClubInput(input: CreateClubInput): ValidationResult {
  const errors: string[] = [];
  const codeRes = validateClubCode(input.code);
  if (!codeRes.isValid) errors.push(...codeRes.errors);
  const nameRes = validateClubName(input.name);
  if (!nameRes.isValid) errors.push(...nameRes.errors);
  const catRes = validateClubCategory(input.category);
  if (!catRes.isValid) errors.push(...catRes.errors);
  const capRes = validateClubCapacity(input.capacity);
  if (!capRes.isValid) errors.push(...capRes.errors);
  if (!input.academicYearId) errors.push("L'année scolaire est requise.");
  if (!input.academicYearCode) errors.push("Le code de l'année scolaire est requis.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateUpdateClubInput(input: UpdateClubInput): ValidationResult {
  const errors: string[] = [];
  if (input.name !== undefined) {
    const r = validateClubName(input.name);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (input.category !== undefined) {
    const r = validateClubCategory(input.category);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (input.capacity !== undefined) {
    const r = validateClubCapacity(input.capacity);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (errors.length === 0) return ok();
  return fail(...errors);
}

/**
 * Check whether enrolling a student in a club would violate business rules:
 *   - student is not already an active member of this club
 *   - club capacity not exceeded (if set)
 *   - club is active and not archived
 */
export function canEnrollMember(
  club: Club,
  existingActiveMemberships: readonly ClubMembership[],
  studentAlreadyActive: boolean,
): ValidationResult {
  if (club.isArchived) {
    return fail("Impossible d'inscrire un élève dans un club archivé.");
  }
  if (!club.isActive) {
    return fail("Le club est en pause — inscriptions suspendues.");
  }
  if (studentAlreadyActive) {
    return fail("L'élève est déjà membre actif de ce club.");
  }
  if (club.capacity != null && existingActiveMemberships.length >= club.capacity) {
    return fail(
      `Capacité atteinte (${club.capacity} membre(s)). Augmentez la capacité ou archivez d'anciens membres.`,
    );
  }
  return ok();
}

export function validateEnrollMemberInput(input: EnrollMemberInput): ValidationResult {
  const errors: string[] = [];
  if (!input.clubId) errors.push("Club requis.");
  if (!input.studentId) errors.push("Élève requis.");
  if (!input.enrolledById) errors.push("Utilisateur responsable requis.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateWithdrawMemberInput(input: WithdrawMemberInput): ValidationResult {
  const errors: string[] = [];
  if (!input.membershipId) errors.push("Adhésion requise.");
  if (!input.withdrawnById) errors.push("Utilisateur responsable requis.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateLogActivityInput(input: LogActivityInput): ValidationResult {
  const errors: string[] = [];
  if (!input.clubId) errors.push("Club requis.");
  if (!input.title || input.title.trim().length === 0) errors.push("Titre requis.");
  if (input.title && input.title.length > 200) errors.push("Le titre ne peut pas dépasser 200 caractères.");
  if (!input.description || input.description.trim().length === 0) errors.push("Description requise.");
  if (!input.date) errors.push("Date requise.");
  if (!input.conductedById) errors.push("Responsable de l'activité requis.");
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 1) {
    errors.push("La durée doit être un nombre positif de minutes.");
  }
  if (input.durationMinutes > 24 * 60) {
    errors.push("La durée ne peut pas dépasser 24 heures (1440 minutes).");
  }
  if (errors.length === 0) return ok();
  return fail(...errors);
}

/**
 * Check if a club can be archived. Business rules:
 *   - Cannot archive if there are active memberships (must withdraw first OR
 *     the archive operation will bulk-withdraw them with reason "Club archivé").
 *   - Can always archive an inactive club.
 */
export function canArchiveClub(
  club: Club,
  _activeMembershipCount: number,
): ValidationResult {
  if (club.isArchived) return fail("Le club est déjà archivé.");
  // Allow archive even with active members — the repository implementation
  // is responsible for bulk-withdrawing them with a system reason.
  // We just emit a warning if there are active members (caller decides).
  return ok();
}

export function canRestoreClub(club: Club): ValidationResult {
  if (!club.isArchived) return fail("Le club n'est pas archivé.");
  return ok();
}

export function canDeleteClub(
  club: Club,
  totalMembershipCount: number,
  activityCount: number,
): ValidationResult {
  // Deletion is a hard delete — only allowed if there is no historical data.
  if (totalMembershipCount > 0) {
    return fail(
      "Impossible de supprimer un club avec des adhésions. Archivez-le plutôt.",
    );
  }
  if (activityCount > 0) {
    return fail(
      "Impossible de supprimer un club avec des activités. Archivez-le plutôt.",
    );
  }
  return ok();
}

/**
 * Check if a club code is unique within the tenant.
 */
export function checkDuplicateClubCode(
  code: string,
  existingClubs: readonly Club[],
  excludeId?: string,
): ValidationResult {
  const conflict = existingClubs.find(
    (c) => c.code === code && c.id !== excludeId,
  );
  if (conflict) {
    return fail(`Un club avec le code "${code}" existe déjà.`);
  }
  return ok();
}
