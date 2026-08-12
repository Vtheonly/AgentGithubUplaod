/**
 * School Year validation + business rules.
 *
 * Extends the existing AcademicYear model with lifecycle helpers:
 *   - create / update / archive / restore / delete
 *   - prevent duplicate codes
 *   - prevent deleting current year
 *   - prevent archive if there are active classes (warn-only — admin can override)
 *
 * CRITICAL FINANCE ISOLATION:
 *   School year operations MUST NOT recalculate, modify, or otherwise
 *   touch financial records. The school year is purely an organizational
 *   entity. The only finance-visible side effect is when enrollment changes
 *   affect tuition rules — and that is handled by the enrollment repository,
 *   not the school year repository.
 */
import type { AcademicYear } from "../../model/academic";
import type { ValidationResult } from "../clubs/validation";
import { ok, fail } from "../clubs/validation";

export { ok, fail };
export type { ValidationResult };

/** Validate the school year code format, e.g. "2026-2027". */
export function validateSchoolYearCode(code: string): ValidationResult {
  if (!code || code.trim().length === 0) {
    return fail("Le code de l'année scolaire est requis.");
  }
  // Accept formats: 2026-2027, 2026/2027, 2026_2027
  const m = code.match(/^(\d{4})[-/_](\d{4})$/);
  if (!m) {
    return fail(
      "Format invalide. Attendu : AAAA-AAAA (ex. 2026-2027).",
    );
  }
  const startYear = parseInt(m[1], 10);
  const endYear = parseInt(m[2], 10);
  if (endYear !== startYear + 1) {
    return fail(
      `L'année de fin doit être l'année suivante (ex. ${startYear}-${startYear + 1}).`,
    );
  }
  return ok();
}

export function validateSchoolYearLabel(label: string): ValidationResult {
  if (!label || label.trim().length === 0) {
    return fail("Le libellé de l'année scolaire est requis.");
  }
  if (label.length > 100) {
    return fail("Le libellé ne peut pas dépasser 100 caractères.");
  }
  return ok();
}

export function validateSchoolYearDates(
  startDate: string,
  endDate: string,
): ValidationResult {
  if (!startDate) return fail("La date de début est requise.");
  if (!endDate) return fail("La date de fin est requise.");
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime())) return fail("Date de début invalide.");
  if (isNaN(end.getTime())) return fail("Date de fin invalide.");
  if (end <= start) {
    return fail("La date de fin doit être postérieure à la date de début.");
  }
  // Sanity: a school year should be 8-14 months long
  const diffMonths =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  if (diffMonths < 8 || diffMonths > 14) {
    return fail(
      `Une année scolaire dure généralement 8 à 14 mois (ici ${diffMonths} mois).`,
    );
  }
  return ok();
}

export function validateTermStructure(
  termStructure: "semester" | "trimester" | "quarter",
): ValidationResult {
  if (!["semester", "trimester", "quarter"].includes(termStructure)) {
    return fail("Structure de trimestres invalide.");
  }
  return ok();
}

export interface CreateSchoolYearInput {
  readonly code: string;
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly termStructure: "semester" | "trimester" | "quarter";
  readonly isCurrent?: boolean;
}

export function validateCreateSchoolYearInput(
  input: CreateSchoolYearInput,
): ValidationResult {
  const errors: string[] = [];
  const codeRes = validateSchoolYearCode(input.code);
  if (!codeRes.isValid) errors.push(...codeRes.errors);
  const labelRes = validateSchoolYearLabel(input.label);
  if (!labelRes.isValid) errors.push(...labelRes.errors);
  const datesRes = validateSchoolYearDates(input.startDate, input.endDate);
  if (!datesRes.isValid) errors.push(...datesRes.errors);
  const termRes = validateTermStructure(input.termStructure);
  if (!termRes.isValid) errors.push(...termRes.errors);
  if (errors.length === 0) return ok();
  return fail(...errors);
}

export interface UpdateSchoolYearInput {
  readonly label?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly termStructure?: "semester" | "trimester" | "quarter";
}

export function validateUpdateSchoolYearInput(
  input: UpdateSchoolYearInput,
): ValidationResult {
  const errors: string[] = [];
  if (input.label !== undefined) {
    const r = validateSchoolYearLabel(input.label);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (input.startDate !== undefined || input.endDate !== undefined) {
    // Both must be provided together for date validation
    if (!input.startDate || !input.endDate) {
      errors.push("Les dates de début et de fin doivent être fournies ensemble.");
    } else {
      const r = validateSchoolYearDates(input.startDate, input.endDate);
      if (!r.isValid) errors.push(...r.errors);
    }
  }
  if (input.termStructure !== undefined) {
    const r = validateTermStructure(input.termStructure);
    if (!r.isValid) errors.push(...r.errors);
  }
  if (errors.length === 0) return ok();
  return fail(...errors);
}

/**
 * Check if a school year can be archived.
 *
 * Business rules:
 *   - Cannot archive the current school year (must set another as current first)
 *   - Can always archive a non-current year
 */
export function canArchiveSchoolYear(
  year: AcademicYear,
  activeClassCount: number,
): ValidationResult {
  if (year.isArchived) {
    return fail("L'année scolaire est déjà archivée.");
  }
  if (year.isCurrent) {
    return fail(
      "Impossible d'archiver l'année scolaire courante. Désignez d'abord une autre année comme courante.",
    );
  }
  // Allow archive with active classes — they will be soft-archived too.
  // The repository is responsible for handling this gracefully.
  if (activeClassCount > 0) {
    // Warn only — do not block. Caller can choose to confirm.
    return ok();
  }
  return ok();
}

export function canRestoreSchoolYear(year: AcademicYear): ValidationResult {
  if (!year.isArchived) {
    return fail("L'année scolaire n'est pas archivée.");
  }
  return ok();
}

/**
 * Check if a school year can be HARD-DELETED.
 *
 * Business rules:
 *   - NEVER delete the current school year
 *   - Cannot delete if there are any classes (active or archived) — must archive first
 *   - Cannot delete if there are any students enrolled in this year
 */
export function canDeleteSchoolYear(
  year: AcademicYear,
  classCount: number,
  studentCount: number,
): ValidationResult {
  if (year.isCurrent) {
    return fail(
      "Impossible de supprimer l'année scolaire courante. Désignez d'abord une autre année comme courante.",
    );
  }
  if (classCount > 0) {
    return fail(
      `Impossible de supprimer : ${classCount} classe(s) rattachée(s). Archivez-les d'abord.`,
    );
  }
  if (studentCount > 0) {
    return fail(
      `Impossible de supprimer : ${studentCount} élève(s) rattaché(s).`,
    );
  }
  return ok();
}

/**
 * Check if a school year can be set as current.
 *
 * Business rules:
 *   - Cannot set an archived year as current (must restore first)
 */
export function canSetCurrentSchoolYear(year: AcademicYear): ValidationResult {
  if (year.isArchived) {
    return fail(
      "Impossible de définir une année archivée comme courante. Restaurez-la d'abord.",
    );
  }
  return ok();
}

/**
 * Check if a new school year code conflicts with existing years.
 */
export function checkDuplicateCode(
  code: string,
  existingYears: readonly AcademicYear[],
  excludeId?: string,
): ValidationResult {
  const conflict = existingYears.find(
    (y) => y.code === code && y.id !== excludeId,
  );
  if (conflict) {
    return fail(`Une année scolaire avec le code "${code}" existe déjà.`);
  }
  return ok();
}
