-- ============================================================================
-- 0059_canonical_promotion_flow.sql
-- ============================================================================
-- T-041 — ACAD-100 / ACAD-101 / BUSINESS-004: the canonical year-end
-- promotion flow. This migration:
--
--   §1  DROPS the dead SQL `promote_students` RPC (0022:528-619). It was
--       never called by any client, archives to the LEGACY
--       `academic_history` table (0004) instead of the canonical
--       `student_academic_histories` (0029), and references the
--       non-existent `students.grade_level_id` column (pre-0028 relic —
--       the canonical column is `grade_level_code`) — it could never have
--       executed successfully (ACAD-100). The legacy `academic_history`
--       table itself is left in place (dropping a table is a separate,
--       reachability-checked decision — see DEAD registry).
--
--   §2  Creates `set_current_academic_year(p_academic_year_id, …)` — the
--       ACID fix for the non-atomic two-step `setCurrentYear` /
--       `createAcademicYear` client pattern (ACAD-101). ONE UPDATE
--       statement flips `is_current` for every year of the tenant
--       (`is_current = (id = p_academic_year_id)`), so there is no window
--       in which the tenant has zero current years. Writes the audit
--       entry the old client code never wrote (the `_actorId` /
--       `_actorName` parameters were discarded, silenced by underscore
--       prefixes).
--
--   §3  Creates `execute_batch_promotion(p_decisions, …)` — the atomic
--       server-side executor for the full batch promotion. The DECISION
--       COMPUTATION stays client-side (the desktop TS engine
--       `src/domain/calc/academics/promotion.ts` is the reference — GPA
--       evaluation, ranking, suggestion, override); the RPC receives the
--       FINAL decisions and applies them in ONE transaction:
--         1. append-only upsert into `student_academic_histories`
--            (on conflict (student_id, academic_year) — idempotent
--            re-runs, matching the previous client contract),
--         2. `students.grade_level_code` advance + `class_id` clear for
--            'promoted' decisions,
--         3. `enrollment_status = 'graduated'` for 'graduated' decisions,
--         4. one `student.promote` audit entry for the whole batch.
--       'repeated' / 'transferred' decisions archive history only (the
--       student row is untouched — exactly the previous desktop
--       semantics). Any invalid decision (unknown student, foreign
--       tenant, bad decision code, promoted without next grade) RAISES,
--       rolling back the WHOLE batch — failure leaves no partial state.
--       This replaces the desktop's sequential direct-table writes
--       (student N+1 could fail after students 1..N were already
--       advanced — BUSINESS-004's partial-state risk).
--
-- Caller verification (0055 / SEC-111 pattern):
--   - NOT SECURITY DEFINER: every table operation inside runs under the
--     CALLER's RLS (students_admin for §3 student updates,
--     student_academic_histories_staff (0057) for history upserts,
--     academic_years_admin for §2). RLS silently filtering a row makes
--     the function raise 'not found' — cross-tenant attempts fail
--     closed.
--   - Tenant resolution: `p_tenant_id` when supplied (global admins /
--     service_role, verified), else `current_tenant_id()`. A caller
--     whose tenant cannot be resolved is rejected.
--
-- IDEMPOTENCY: §1 is a guarded DROP; §2/§3 are CREATE OR REPLACE. The
-- RPCs carry no data migration.
-- ============================================================================

-- ─── §1. Drop the dead promote_students RPC (ACAD-100) ─────────────────────
DROP FUNCTION IF EXISTS public.promote_students(uuid, uuid, jsonb, uuid);

-- ─── §2. set_current_academic_year — atomic single-statement flip ─────────
CREATE OR REPLACE FUNCTION public.set_current_academic_year(
    p_academic_year_id uuid,
    p_actor_profile_id uuid DEFAULT NULL,
    p_actor_name text DEFAULT NULL,
    p_tenant_id uuid DEFAULT NULL
)
RETURNS public.academic_years
LANGUAGE plpgsql
AS $$
DECLARE
    v_year public.academic_years;
    v_tenant uuid;
    v_caller_is_service_role boolean;
    v_prev_year public.academic_years;
BEGIN
    v_caller_is_service_role := coalesce(auth.jwt() ->> 'role', '') = 'service_role';

    -- Tenant resolution (0055 pattern): explicit tenant allowed for
    -- service_role + global admins only; everyone else must BE of the tenant.
    v_tenant := public.current_tenant_id();
    IF p_tenant_id IS NOT NULL AND (v_tenant IS NULL OR p_tenant_id <> v_tenant) THEN
        IF NOT v_caller_is_service_role AND NOT public.is_global_admin() THEN
            RAISE EXCEPTION 'set_current_academic_year: caller tenant mismatch (p_tenant_id=%)', p_tenant_id
              USING ERRCODE = '42501';
        END IF;
        v_tenant := p_tenant_id;
    END IF;

    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'set_current_academic_year: caller tenant unresolvable'
          USING ERRCODE = '42501';
    END IF;

    -- Remember the tenant's previous current year for the audit diff.
    SELECT * INTO v_prev_year
      FROM public.academic_years ay
     WHERE ay.tenant_id = v_tenant AND ay.is_current
     LIMIT 1;

    -- ACAD-101: ONE statement — there is no zero-current-year window.
    UPDATE public.academic_years ay
       SET is_current = (ay.id = p_academic_year_id),
           updated_at = now()
     WHERE ay.tenant_id = v_tenant
     RETURNING ay.* INTO v_year;

    IF v_year.id IS NULL OR v_year.id <> p_academic_year_id THEN
        -- Either the target does not exist, is in another tenant (RLS hid
        -- it), or the caller lacks the academic_years_admin policy — the
        -- UPDATE matched zero rows or could not set the target. Roll back.
        RAISE EXCEPTION 'set_current_academic_year: academic year % not applicable for this caller', p_academic_year_id
          USING ERRCODE = '23503';
    END IF;

    PERFORM public.write_audit_log(
        p_tenant_id      := v_tenant,
        p_action         := 'academic_year.set_current',
        p_entity_type    := 'academic_year',
        p_entity_id      := p_academic_year_id,
        p_actor_id       := p_actor_profile_id,
        p_actor_name     := p_actor_name,
        p_before_json    := CASE WHEN v_prev_year.id IS NULL THEN NULL
                                 ELSE jsonb_build_object('id', v_prev_year.id, 'label', v_prev_year.label) END,
        p_after_json     := jsonb_build_object('id', v_year.id, 'label', v_year.label),
        p_note           := 'Année courante basculée (atomique, RPC 0059)'
    );

    RETURN v_year;
END;
$$;

COMMENT ON FUNCTION public.set_current_academic_year IS
  'T-041 (ACAD-101): atomically flips is_current for every academic year of the tenant in ONE statement (no zero-current-year window). Caller-verified; runs under caller RLS (academic_years_admin: super_admin + support_staff).';

-- ─── §3. execute_batch_promotion — atomic batch executor ───────────────────
CREATE OR REPLACE FUNCTION public.execute_batch_promotion(
    p_decisions jsonb,
    p_actor_profile_id uuid DEFAULT NULL,
    p_actor_name text DEFAULT NULL,
    p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_decision jsonb;
    v_student_id uuid;
    v_decision_code text;
    v_next_grade text;
    v_academic_year text;
    v_count integer := 0;
    v_updated_ids uuid[] := '{}';
    v_tenant uuid;
    v_caller_is_service_role boolean;
    v_student_found boolean;
    v_history_row public.student_academic_histories%ROWTYPE;
    v_valid_decisions text[] := ARRAY['promoted', 'repeated', 'graduated', 'transferred'];
BEGIN
    IF p_decisions IS NULL OR jsonb_typeof(p_decisions) <> 'array' THEN
        RAISE EXCEPTION 'execute_batch_promotion: p_decisions must be a JSON array'
          USING ERRCODE = '22023';
    END IF;

    v_caller_is_service_role := coalesce(auth.jwt() ->> 'role', '') = 'service_role';

    -- Tenant resolution + caller verification (same rule as §2).
    v_tenant := public.current_tenant_id();
    IF p_tenant_id IS NOT NULL AND (v_tenant IS NULL OR p_tenant_id <> v_tenant) THEN
        IF NOT v_caller_is_service_role AND NOT public.is_global_admin() THEN
            RAISE EXCEPTION 'execute_batch_promotion: caller tenant mismatch (p_tenant_id=%)', p_tenant_id
              USING ERRCODE = '42501';
        END IF;
        v_tenant := p_tenant_id;
    END IF;

    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'execute_batch_promotion: caller tenant unresolvable'
          USING ERRCODE = '42501';
    END IF;

    FOR v_decision IN SELECT * FROM jsonb_array_elements(p_decisions)
    LOOP
        v_student_id     := (v_decision ->> 'student_id')::uuid;
        v_decision_code  := v_decision ->> 'decision';
        v_next_grade     := NULLIF(v_decision ->> 'next_grade_code', '');
        v_academic_year  := v_decision ->> 'academic_year';

        -- ── validation: fail the WHOLE batch on any bad decision ──
        IF v_student_id IS NULL THEN
            RAISE EXCEPTION 'execute_batch_promotion: decision entry without a valid student_id (%)', v_decision
              USING ERRCODE = '22023';
        END IF;
        IF v_decision_code IS NULL OR NOT (v_decision_code = ANY (v_valid_decisions)) THEN
            RAISE EXCEPTION 'execute_batch_promotion: invalid decision "%" for student %', v_decision_code, v_student_id
              USING ERRCODE = '22023';
        END IF;
        IF v_academic_year IS NULL OR v_academic_year = '' THEN
            RAISE EXCEPTION 'execute_batch_promotion: decision for student % lacks academic_year (the completed year to archive)', v_student_id
              USING ERRCODE = '22023';
        END IF;
        IF v_decision_code = 'promoted' AND v_next_grade IS NULL THEN
            RAISE EXCEPTION 'execute_batch_promotion: promoted decision for student % lacks next_grade_code', v_student_id
              USING ERRCODE = '22023';
        END IF;

        -- Student must exist in the caller's tenant (RLS hides foreign rows
        -- → v_student_found stays false → the batch fails closed).
        SELECT TRUE INTO v_student_found
          FROM public.students s
         WHERE s.id = v_student_id
           AND s.tenant_id = v_tenant
           AND s.deleted_at IS NULL;

        IF v_student_found IS NOT TRUE THEN
            RAISE EXCEPTION 'execute_batch_promotion: student % not found in tenant %', v_student_id, v_tenant
              USING ERRCODE = '42501';
        END IF;

        -- ── 1. append-only history upsert (idempotent per student+year) ──
        INSERT INTO public.student_academic_histories (
            tenant_id, student_id, academic_year, cycle, grade_code, grade_year,
            class_id, class_name, gpa, rank, decision, narrative
        ) VALUES (
            v_tenant, v_student_id, v_academic_year,
            v_decision ->> 'cycle', v_decision ->> 'grade_code',
            COALESCE((v_decision ->> 'grade_year')::int, 0),
            (v_decision ->> 'class_id')::uuid,
            v_decision ->> 'class_name',
            COALESCE((v_decision ->> 'gpa')::numeric, 0),
            (v_decision ->> 'rank')::int,
            v_decision_code,
            v_decision ->> 'narrative'
        )
        ON CONFLICT (student_id, academic_year) DO UPDATE SET
            cycle       = EXCLUDED.cycle,
            grade_code  = EXCLUDED.grade_code,
            grade_year  = EXCLUDED.grade_year,
            class_id    = EXCLUDED.class_id,
            class_name  = EXCLUDED.class_name,
            gpa         = EXCLUDED.gpa,
            rank        = EXCLUDED.rank,
            decision    = EXCLUDED.decision,
            narrative   = EXCLUDED.narrative,
            recorded_at = now();

        -- ── 2 + 3. student advancement (desktop semantics preserved) ──
        IF v_decision_code = 'promoted' THEN
            UPDATE public.students
               SET grade_level_code = v_next_grade,
                   class_id = NULL,
                   updated_at = now()
             WHERE id = v_student_id
               AND tenant_id = v_tenant;
            v_updated_ids := v_updated_ids || v_student_id;
        ELSIF v_decision_code = 'graduated' THEN
            UPDATE public.students
               SET enrollment_status = 'graduated',
                   class_id = NULL,
                   updated_at = now()
             WHERE id = v_student_id
               AND tenant_id = v_tenant;
            v_updated_ids := v_updated_ids || v_student_id;
        END IF;
        -- 'repeated' / 'transferred': history row only — the student row
        -- is untouched (previous desktop contract preserved).

        v_count := v_count + 1;
    END LOOP;

    -- ── 4. one audit entry for the batch (0014 canonical entry point) ──
    PERFORM public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'student.promote',
        p_entity_type := 'student',
        p_entity_id   := NULL,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json  := jsonb_build_object(
                             'count', v_count,
                             'updated_student_ids', to_jsonb(v_updated_ids)
                         ),
        p_note        := 'Promotion de classe exécutée (atomique, RPC 0059)'
    );

    RETURN jsonb_build_object(
        'processed_count', v_count,
        'updated_student_ids', to_jsonb(v_updated_ids)
    );
END;
$$;

COMMENT ON FUNCTION public.execute_batch_promotion IS
  'T-041 (ACAD-100/BUSINESS-004): atomic server-side executor for year-end batch promotion. Receives FINAL decisions (GPA/suggestion/override computed client-side by the canonical desktop engine), archives each to student_academic_histories, advances promoted students, graduates 3eme_annee, writes one audit entry — all in ONE transaction. Runs under caller RLS; any invalid or foreign-tenant decision rolls back the whole batch.';
