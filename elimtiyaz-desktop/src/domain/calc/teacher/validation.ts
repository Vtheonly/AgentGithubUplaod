/**
 * Teacher validation + business rules.
 *
 * Enforces:
 *   - Teacher code format + uniqueness within tenant
 *   - Personnel reference is required (teacher must reference a person/account)
 *   - Academic year is required (teacher is scoped per year)
 *   - Subject assignment uniqueness (no duplicate teacher+subject+year)
 *   - Primary teacher enforcement (a subject can have only one primary teacher per year)
 *   - Timetable conflict detection (no overlapping slots for same teacher/class)
 */
import type {
  Teacher,
  TeacherStatus,
  CreateTeacherInput,
  UpdateTeacherInput,
  TeacherSubjectAssignment,
  AssignTeacherSubjectInput,
  TimetableEntry,
  CreateTimetableEntryInput,
  UpdateTimetableEntryInput,
  SchoolDay,
} from "../../model/teacher";
import type { ValidationResult } from "../clubs/validation";
import { ok, fail } from "../clubs/validation";

export { ok, fail };
export type { ValidationResult };

// ============================================================================
// Teacher validators
// ============================================================================

export function validateTeacherCode(code: string): ValidationResult {
  if (!code || code.trim().length === 0) {
    return fail("Le code enseignant est requis.");
  }
  if (code.length < 3) {
    return fail("Le code enseignant doit contenir au moins 3 caractères.");
  }
  if (code.length > 40) {
    return fail("Le code enseignant ne peut pas dépasser 40 caractères.");
  }
  if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(code)) {
    return fail(
      "Le code enseignant doit être en majuscules, alphanumérique (tirets autorisés).",
    );
  }
  return ok();
}

export function validateTeacherStatus(status: TeacherStatus): ValidationResult {
  if (!["active", "on_leave", "inactive"].includes(status)) {
    return fail("Statut enseignant invalide.");
  }
  return ok();
}

export function validateMaxWeeklyHours(hours: number): ValidationResult {
  if (!Number.isFinite(hours) || hours < 0) {
    return fail("Les heures hebdomadaires doivent être un nombre positif.");
  }
  if (hours > 40) {
    return fail("Les heures hebdomadaires ne peuvent pas dépasser 40.");
  }
  return ok();
}

export function validateCreateTeacherInput(input: CreateTeacherInput): ValidationResult {
  const errors: string[] = [];
  if (!input.personnelId) {
    errors.push("La référence au personnel (personne/compte) est requise.");
  }
  const codeRes = validateTeacherCode(input.code);
  if (!codeRes.isValid) errors.push(...codeRes.errors);
  if (!input.academicYearId) {
    errors.push("L'année scolaire est requise (le teacher est scoped par année).");
  }
  if (input.status !== undefined) {
    const r = validateTeacherStatus(input.status);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (input.maxWeeklyHours !== undefined) {
    const r = validateMaxWeeklyHours(input.maxWeeklyHours);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateUpdateTeacherInput(input: UpdateTeacherInput): ValidationResult {
  const errors: string[] = [];
  if (input.status !== undefined) {
    const r = validateTeacherStatus(input.status);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (input.maxWeeklyHours !== undefined) {
    const r = validateMaxWeeklyHours(input.maxWeeklyHours);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (errors.length === 0) return ok();
  return fail(...errors);
}

/**
 * Check whether a teacher can be created — the referenced Personnel record
 * must exist and have staffCategory "teacher" (or be eligible).
 */
export function canCreateTeacher(
  personnelExists: boolean,
  personnelIsTeacher: boolean,
): ValidationResult {
  if (!personnelExists) {
    return fail("Le personnel référencé n'existe pas.");
  }
  if (!personnelIsTeacher) {
    return fail(
      "Le personnel référencé n'est pas categorisé comme enseignant (staffCategory != 'teacher').",
    );
  }
  return ok();
}

export function checkDuplicateTeacherCode(
  code: string,
  existingTeachers: readonly Teacher[],
  excludeId?: string,
): ValidationResult {
  const conflict = existingTeachers.find(
    (t) => t.code === code && t.id !== excludeId,
  );
  if (conflict) {
    return fail(`Un enseignant avec le code "${code}" existe déjà.`);
  }
  return ok();
}

export function checkDuplicateTeacherForYear(
  personnelId: string,
  academicYearId: string,
  existingTeachers: readonly Teacher[],
  excludeId?: string,
): ValidationResult {
  const conflict = existingTeachers.find(
    (t) =>
      t.personnelId === personnelId &&
      t.academicYearId === academicYearId &&
      t.id !== excludeId,
  );
  if (conflict) {
    return fail(
      "Cette personne a déjà un enregistrement enseignant pour cette année scolaire.",
    );
  }
  return ok();
}

// ============================================================================
// Teacher ↔ Subject assignment validators
// ============================================================================

export function validateAssignTeacherSubjectInput(
  input: AssignTeacherSubjectInput,
): ValidationResult {
  const errors: string[] = [];
  if (!input.teacherId) errors.push("Enseignant requis.");
  if (!input.subjectId) errors.push("Matière requise.");
  if (!input.academicYearId) errors.push("Année scolaire requise.");
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function checkDuplicateAssignment(
  input: AssignTeacherSubjectInput,
  existing: readonly TeacherSubjectAssignment[],
  excludeId?: string,
): ValidationResult {
  const conflict = existing.find(
    (a) =>
      a.teacherId === input.teacherId &&
      a.subjectId === input.subjectId &&
      a.academicYearId === input.academicYearId &&
      a.id !== excludeId,
  );
  if (conflict) {
    return fail("Cet enseignant est déjà assigné à cette matière pour cette année.");
  }
  return ok();
}

export function checkPrimaryTeacherConflict(
  subjectId: string,
  academicYearId: string,
  teacherId: string,
  existing: readonly TeacherSubjectAssignment[],
  excludeId?: string,
): ValidationResult {
  let pool = existing;
  if (excludeId) {
    pool = existing.filter((a) => a.id !== excludeId);
  }
  const conflict = pool.find(
    (a) =>
      a.subjectId === subjectId &&
      a.academicYearId === academicYearId &&
      a.teacherId !== teacherId &&
      a.isPrimary,
  );
  if (conflict) {
    return fail(
      "Cette matière a déjà un enseignant principal pour cette année. Définissez l'ancien comme non-principal d'abord.",
    );
  }
  return ok();
}

// ============================================================================
// Timetable validators
// ============================================================================

export function validateDay(day: SchoolDay): ValidationResult {
  if (!["monday", "tuesday", "wednesday", "thursday", "friday"].includes(day)) {
    return fail("Jour invalide (lundi à vendredi uniquement).");
  }
  return ok();
}

export function validateTimeRange(startMinutes: number, endMinutes: number): ValidationResult {
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes)) {
    return fail("Les heures doivent être des minutes entières depuis minuit.");
  }
  if (startMinutes < 0 || startMinutes >= 1440) {
    return fail("L'heure de début doit être entre 0 et 1439 minutes.");
  }
  if (endMinutes <= startMinutes) {
    return fail("L'heure de fin doit être postérieure à l'heure de début.");
  }
  if (endMinutes > 1440) {
    return fail("L'heure de fin ne peut pas dépasser 24h (1440 minutes).");
  }
  if (startMinutes < 420 || endMinutes > 1200) {
    return fail(
      "Les horaires scolaires doivent être entre 07:00 et 20:00 (420–1200 minutes).",
    );
  }
  return ok();
}

export function validateCreateTimetableEntryInput(
  input: CreateTimetableEntryInput,
): ValidationResult {
  const errors: string[] = [];
  if (!input.academicYearId) errors.push("Année scolaire requise.");
  if (!input.classId) errors.push("Classe requise.");
  if (!input.teacherId) errors.push("Enseignant requis (référence l'entité Teacher).");
  if (!input.subjectId) errors.push("Matière requise.");
  const dayRes = validateDay(input.day);
  if (!dayRes.isValid) errors.push(...dayRes.errors);
  const timeRes = validateTimeRange(input.startMinutes, input.endMinutes);
  if (!timeRes.isValid) errors.push(...timeRes.errors);
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export function validateUpdateTimetableEntryInput(
  input: UpdateTimetableEntryInput,
): ValidationResult {
  const errors: string[] = [];
  if (input.startMinutes !== undefined || input.endMinutes !== undefined) {
    const start = input.startMinutes ?? 0;
    const end = input.endMinutes ?? 1440;
    const r = validateTimeRange(start, end);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (errors.length === 0) return ok();
  return fail(...errors);
}

/**
 * Detect timetable conflicts — a teacher cannot be in two places at once,
 * and a class cannot have two subjects at the same time.
 */
export function detectTimetableConflict(
  input: CreateTimetableEntryInput | TimetableEntry,
  existingEntries: readonly TimetableEntry[],
  excludeId?: string,
): ValidationResult {
  const day = "day" in input ? input.day : (input as TimetableEntry).day;
  const start = "startMinutes" in input ? input.startMinutes : 0;
  const end = "endMinutes" in input ? input.endMinutes : 0;
  const teacherId = "teacherId" in input ? input.teacherId : "";
  const classId = "classId" in input ? input.classId : "";
  const academicYearId = "academicYearId" in input ? input.academicYearId : "";

  const conflicts = existingEntries.filter((e) => {
    if (e.id === excludeId) return false;
    if (e.academicYearId !== academicYearId) return false;
    if (e.day !== day) return false;
    if (e.teacherId !== teacherId && e.classId !== classId) return false;
    return start < e.endMinutes && end > e.startMinutes;
  });

  if (conflicts.length > 0) {
    const c = conflicts[0];
    const reason =
      c.teacherId === teacherId
        ? "L'enseignant a déjà un cours à cette heure"
        : "La classe a déjà un cours à cette heure";
    return fail(
      `Conflit d'emploi du temps : ${reason} (${c.day} ${c.startMinutes}–${c.endMinutes}).`,
    );
  }
  return ok();
}
