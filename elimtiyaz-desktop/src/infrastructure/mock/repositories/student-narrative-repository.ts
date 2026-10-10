// ============================================================================
// FILE: src/infrastructure/mock/repositories/student-narrative-repository.ts
// ============================================================================
/**
 * MockStudentNarrativeRepository — GRADE-103 (T-502, 2026-10-11).
 *
 * The mock twin of `SupabaseStudentNarrativeRepository`: the year-keyed
 * report-card narrative store, kept in memory keyed on
 * (studentId, academicYear) — the same one-row-per-key upsert semantics as
 * the 0148 table's unique (tenant_id, student_id, academic_year).
 */

import type {
  StudentNarrativeRepository,
} from "../../../domain/repository/academic-repository";
import { Ok, Err, type Result } from "../../../core/result";
import { Errors } from "../../../core/app-error";

const narratives = new Map<string, string>();

const key = (studentId: string, academicYear: string): string =>
  `${studentId}|${academicYear}`;

export const mockStudentNarrativeRepository: StudentNarrativeRepository = {
  async saveNarrative(input): Promise<Result<void>> {
    if (!input.narrative.trim()) {
      return Err(Errors.validation(
        "The narrative text is required",
        "Le narratif ne peut pas être vide.",
      ));
    }
    narratives.set(key(input.studentId, input.academicYear), input.narrative);
    return Ok(undefined);
  },

  async getNarrative(studentId, academicYear): Promise<Result<string | null>> {
    return Ok(narratives.get(key(studentId, academicYear)) ?? null);
  },
};
