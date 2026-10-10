/**
 * SupabaseStudentNarrativeRepository — the GRADE-103 persistence target
 * (plan §11.05, the report-card narrative store).
 *
 * Task: T-502 (153rd session, 2026-10-11). BEFORE this repository the
 * narrative generator's « Approuver » flow was persistence-HOLLOW: the
 * only write was an audit_logs row (AiNarrativeApproved, 200-char preview)
 * while the toast promised « Narratif enregistré sur la fiche élève » —
 * an approved narrative was unrecoverable the moment the modal closed
 * (live-proven by the T-500 census: zero retrievable narrative writes).
 *
 * Table (migration 0148): `student_narratives` — one row per
 * (tenant_id, student_id, academic_year), upserted in place on
 * re-approval. The year key is the academic-year CODE (e.g. "2025-2026"),
 * the same key space as student_academic_histories.academic_year.
 *
 * MAPPING NOTES:
 *   1. saveNarrative is a PostgREST upsert on the unique
 *      (tenant_id, student_id, academic_year) — re-approval REPLACES the
 *      text (the approval HISTORY lives in audit_logs, append-only).
 *   2. approved_by is uuid-checked (mock-era ids never reach the column);
 *      approved_by_name carries the display name (the 0070/0072
 *      no-FK-join precedent).
 *   3. getNarrative returns the text or null — never an error for "none".
 *
 * RLS (0148): tenant-scoped SELECT; INSERT/UPDATE for the staff writer
 * family (super_admin / manager / support_staff / teacher — the UseAI
 * permission holders).
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `studentNarratives` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import type { StudentNarrativeRepository } from "../../../domain/repository/academic-repository";
import { getTenantId, isUuid } from "./supabase-shared-repositories";

interface StudentNarrativeRow {
  id: string;
  tenant_id: string;
  student_id: string;
  academic_year: string;
  narrative: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string;
  created_at: string;
  updated_at: string;
}

export class SupabaseStudentNarrativeRepository implements StudentNarrativeRepository {
  constructor(private readonly client: SupabaseClient) {}

  async saveNarrative(input: {
    studentId: string;
    academicYear: string;
    narrative: string;
    approvedBy: string;
    approvedByName: string;
  }): Promise<Result<void>> {
    const tenantId = getTenantId();
    if (!tenantId) {
      return Err(Errors.validation(
        "studentNarratives.saveNarrative requires an active tenant context",
        "Aucun établissement actif — reconnectez-vous.",
      ));
    }
    if (!isUuid(input.studentId)) {
      return Err(Errors.validation(
        "studentNarratives.saveNarrative requires a student UUID (the Supabase students table key)",
        "Fiche élève introuvable — reconnectez-vous.",
      ));
    }
    if (!input.narrative.trim()) {
      return Err(Errors.validation(
        "The narrative text is required",
        "Le narratif ne peut pas être vide.",
      ));
    }
    const { error } = await this.client
      .from("student_narratives")
      .upsert(
        {
          tenant_id: tenantId,
          student_id: input.studentId,
          academic_year: input.academicYear,
          narrative: input.narrative,
          approved_by: isUuid(input.approvedBy) ? input.approvedBy : null,
          approved_by_name: input.approvedByName || null,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        // The 0148 unique (tenant_id, student_id, academic_year):
        // re-approval UPDATES the same row, never duplicates.
        { onConflict: "tenant_id,student_id,academic_year" },
      );
    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(undefined);
  }

  async getNarrative(studentId: string, academicYear: string): Promise<Result<string | null>> {
    const tenantId = getTenantId();
    if (!tenantId || !isUuid(studentId)) {
      // No tenant context / mock-era key — honestly "no narrative saved".
      return Ok(null);
    }
    const { data, error } = await this.client
      .from("student_narratives")
      .select("narrative")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .eq("academic_year", academicYear)
      .maybeSingle();
    if (error) return Err(supabaseErrorToAppError(error));
    const row = data as unknown as Pick<StudentNarrativeRow, "narrative"> | null;
    return Ok(row?.narrative ?? null);
  }
}
