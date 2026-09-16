-- ============================================================================
-- 0096_class_placement_finalize.sql — T-370 (ACAD-500)
-- ============================================================================
-- The canonical backend for the 9ddde68 "Class Formation & Student Placement
-- Studio" UI commit: `fn_finalize_class_placements` — ONE atomic RPC that
--
--   A. creates the newly drafted class sections (academic_level_id resolved
--      from academic_levels.grade_code — never a synthesized id),
--   B. maps clientDraftId -> real class UUID inside the same transaction and
--      applies the patches to the target year's EXISTING sections,
--   C. assigns students to their target sections (grade-integrity checked,
--      historical records untouched — INV-1 of the studio spec),
--   D. writes ONE `class.placement_finalize` audit entry for the whole batch.
--
-- The whole batch commits or rolls back together — the non-atomic
-- classes+students loop with draft-ID pointer corruption (the ACAD-500
-- defect the 08f7f13 follow-up shipped) is closed.
--
-- PROVENANCE (ARCH-011 drift closure, T-370): this function was FIRST
-- applied to the live database by a concurrent agent (registered live as
-- 0096 at 2026-09-14 UTC, before this file existed in the chain). This
-- file reconstructs the applied definition BYTE-FAITHFULLY from
-- pg_get_functiondef (extracted 2026-09-14) so the committed chain and
-- the live database agree — a fresh deployment from this chain now
-- produces the same end state. Re-applying is a no-op (CREATE OR REPLACE
-- + ON CONFLICT DO NOTHING registration).
--
-- SAFETY / GUARDS (the 0055/0059 hardening pattern):
--   * SECURITY INVOKER — the caller's RLS applies to every table touched.
--   * Tenant resolution via current_tenant_id(); p_tenant_id accepted only
--     from service_role / global admins (42501 otherwise).
--   * Target year must exist in the tenant (23503 otherwise).
--   * Duplicate class codes in the target year rejected (23505).
--   * Cross-grade assignments rejected (22023).
--   * Students of other tenants invisible under RLS -> batch fails closed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_finalize_class_placements(p_target_year_id uuid DEFAULT NULL::uuid, p_target_year_code text DEFAULT NULL::text, p_new_classes jsonb DEFAULT '[]'::jsonb, p_updated_classes jsonb DEFAULT '[]'::jsonb, p_student_assignments jsonb DEFAULT '[]'::jsonb, p_actor_profile_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_class_record jsonb;
    v_student_record jsonb;
    v_update_record jsonb;
    v_tenant uuid;
    v_caller_is_service_role boolean;
    v_target_year public.academic_years;
    v_academic_level_id uuid;
    v_created_class_id uuid;
    v_created_classes_map jsonb := '{}'::jsonb;
    v_final_target_class_id uuid;
    v_target_class_grade text;
    v_student_found boolean;
    v_class_found boolean;
    v_created_classes_count integer := 0;
    v_updated_classes_count integer := 0;
    v_assigned_students_count integer := 0;
    v_draft_id text;
    v_code text;
BEGIN
    IF p_new_classes IS NULL OR jsonb_typeof(p_new_classes) <> 'array' THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: p_new_classes must be a JSON array'
          USING ERRCODE = '22023';
    END IF;
    IF p_updated_classes IS NULL OR jsonb_typeof(p_updated_classes) <> 'array' THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: p_updated_classes must be a JSON array'
          USING ERRCODE = '22023';
    END IF;
    IF p_student_assignments IS NULL OR jsonb_typeof(p_student_assignments) <> 'array' THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: p_student_assignments must be a JSON array'
          USING ERRCODE = '22023';
    END IF;

    v_caller_is_service_role := coalesce(auth.jwt() ->> 'role', '') = 'service_role';

    -- Tenant resolution + caller verification (0055/0059 pattern).
    v_tenant := public.current_tenant_id();
    IF p_tenant_id IS NOT NULL AND (v_tenant IS NULL OR p_tenant_id <> v_tenant) THEN
        IF NOT v_caller_is_service_role AND NOT public.is_global_admin() THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: caller tenant mismatch (p_tenant_id=%)', p_tenant_id
              USING ERRCODE = '42501';
        END IF;
        v_tenant := p_tenant_id;
    END IF;

    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: caller tenant unresolvable'
          USING ERRCODE = '42501';
    END IF;

    -- ── target academic year: by id when a UUID is supplied, else by code ──
    IF p_target_year_id IS NOT NULL THEN
        SELECT * INTO v_target_year
          FROM public.academic_years ay
         WHERE ay.id = p_target_year_id
           AND ay.tenant_id = v_tenant;
    END IF;
    IF v_target_year.id IS NULL AND p_target_year_code IS NOT NULL AND p_target_year_code <> '' THEN
        SELECT * INTO v_target_year
          FROM public.academic_years ay
         WHERE ay.tenant_id = v_tenant
           AND (ay.code = p_target_year_code OR ay.label = p_target_year_code)
         ORDER BY ay.is_current DESC, ay.start_date DESC
         LIMIT 1;
    END IF;
    IF v_target_year.id IS NULL THEN
        RAISE EXCEPTION 'fn_finalize_class_placements: target academic year "%" not found in tenant (create it in Années scolaires first)', coalesce(p_target_year_code, p_target_year_id::text)
          USING ERRCODE = '23503';
    END IF;

    -- ── Step A: insert the newly drafted classes ──────────────────────────
    FOR v_class_record IN SELECT * FROM jsonb_array_elements(p_new_classes)
    LOOP
        v_draft_id := NULLIF(v_class_record ->> 'clientDraftId', '');
        v_code := NULLIF(v_class_record ->> 'code', '');

        IF NULLIF(v_class_record ->> 'name', '') IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: new class draft % lacks a name', v_class_record
              USING ERRCODE = '22023';
        END IF;
        IF NULLIF(v_class_record ->> 'gradeCode', '') IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: new class draft "%" lacks a gradeCode', v_class_record ->> 'name'
              USING ERRCODE = '22023';
        END IF;
        IF v_code IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: new class draft "%" lacks a code', v_class_record ->> 'name'
              USING ERRCODE = '22023';
        END IF;

        -- academic_level_id RESOLVED from academic_levels.grade_code (the
        -- column is a real UUID FK — never synthesized).
        SELECT al.id INTO v_academic_level_id
          FROM public.academic_levels al
         WHERE al.tenant_id = v_tenant
           AND al.grade_code = v_class_record ->> 'gradeCode';
        IF v_academic_level_id IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: no academic_level for grade_code "%" (tenant %)', v_class_record ->> 'gradeCode', v_tenant
              USING ERRCODE = '23503';
        END IF;

        -- The unique constraint is (tenant_id, academic_year_id, code).
        SELECT TRUE INTO v_class_found
          FROM public.classes c
         WHERE c.tenant_id = v_tenant
           AND c.academic_year_id = v_target_year.id
           AND c.code = v_code;
        IF v_class_found THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: class code "%" already exists in year %', v_code, v_target_year.label
              USING ERRCODE = '23505';
        END IF;

        INSERT INTO public.classes (
            tenant_id, academic_year_id, academic_level_id,
            code, name, grade_code, section,
            room, capacity,
            homeroom_teacher_id, homeroom_teacher_name,
            is_active
        ) VALUES (
            v_tenant, v_target_year.id, v_academic_level_id,
            v_code, v_class_record ->> 'name', v_class_record ->> 'gradeCode',
            COALESCE(NULLIF(v_class_record ->> 'section', ''), 'A'),
            NULLIF(v_class_record ->> 'room', ''),
            COALESCE(NULLIF(v_class_record ->> 'capacity', '')::int, 30),
            CASE
                WHEN NULLIF(v_class_record ->> 'homeroomTeacherId', '') IS NULL THEN NULL
                ELSE (v_class_record ->> 'homeroomTeacherId')::uuid
            END,
            NULLIF(v_class_record ->> 'homeroomTeacherName', ''),
            TRUE
        )
        RETURNING id INTO v_created_class_id;

        IF v_draft_id IS NOT NULL THEN
            v_created_classes_map := jsonb_set(
                v_created_classes_map,
                ARRAY[v_draft_id],
                to_jsonb(v_created_class_id::text)
            );
        END IF;

        v_created_classes_count := v_created_classes_count + 1;
    END LOOP;

    -- ── Step B: apply patches to EXISTING classes of the target year ──────
    FOR v_update_record IN SELECT * FROM jsonb_array_elements(p_updated_classes)
    LOOP
        IF (v_update_record ->> 'id')::uuid IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: class update entry lacks a valid id (%)', v_update_record
              USING ERRCODE = '22023';
        END IF;

        UPDATE public.classes c
           SET room = CASE WHEN v_update_record ? 'room'
                           THEN NULLIF(v_update_record ->> 'room', '') ELSE c.room END,
               capacity = CASE WHEN v_update_record ? 'capacity'
                               THEN COALESCE(NULLIF(v_update_record ->> 'capacity', '')::int, c.capacity)
                               ELSE c.capacity END,
               homeroom_teacher_id = CASE
                   WHEN v_update_record ? 'homeroomTeacherId' THEN
                       CASE WHEN NULLIF(v_update_record ->> 'homeroomTeacherId', '') IS NULL THEN NULL
                            ELSE (v_update_record ->> 'homeroomTeacherId')::uuid END
                   ELSE c.homeroom_teacher_id END,
               homeroom_teacher_name = CASE WHEN v_update_record ? 'homeroomTeacherName'
                                             THEN NULLIF(v_update_record ->> 'homeroomTeacherName', '')
                                             ELSE c.homeroom_teacher_name END,
               updated_at = now()
         WHERE c.id = (v_update_record ->> 'id')::uuid
           AND c.tenant_id = v_tenant
           AND c.academic_year_id = v_target_year.id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: class % not found in tenant/year % (existing-class patches must target the placement year)', v_update_record ->> 'id', v_target_year.label
              USING ERRCODE = '23503';
        END IF;

        v_updated_classes_count := v_updated_classes_count + 1;
    END LOOP;

    -- ── Step C: assign students to their target sections ──────────────────
    -- Historical records are deliberately NOT touched (INV-1 of the studio
    -- spec): student_academic_histories rows belong to the promotion flow.
    FOR v_student_record IN SELECT * FROM jsonb_array_elements(p_student_assignments)
    LOOP
        -- Resolve the final target class id (draft map first, then UUID).
        IF v_student_record ->> 'targetClassId' IS NOT NULL
           AND v_created_classes_map ? (v_student_record ->> 'targetClassId') THEN
            v_final_target_class_id := (v_created_classes_map ->> (v_student_record ->> 'targetClassId'))::uuid;
        ELSIF NULLIF(v_student_record ->> 'targetClassId', '') IS NOT NULL THEN
            v_final_target_class_id := (v_student_record ->> 'targetClassId')::uuid;
        ELSE
            RAISE EXCEPTION 'fn_finalize_class_placements: assignment for student % lacks a targetClassId', v_student_record ->> 'studentId'
              USING ERRCODE = '22023';
        END IF;

        -- Target class must exist in the tenant (RLS hides foreign rows →
        -- not found → the batch fails closed).
        SELECT c.grade_code INTO v_target_class_grade
          FROM public.classes c
         WHERE c.id = v_final_target_class_id
           AND c.tenant_id = v_tenant;
        IF v_target_class_grade IS NULL THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: target class % not found in tenant %', v_final_target_class_id, v_tenant
              USING ERRCODE = '23503';
        END IF;

        -- Grade integrity: the assignment's gradeLevel must match the
        -- target section's grade (prevents cross-grade corruption).
        IF NULLIF(v_student_record ->> 'gradeLevel', '') IS NOT NULL
           AND v_student_record ->> 'gradeLevel' <> v_target_class_grade THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: student % assignment grade "%" does not match target class grade "%"', v_student_record ->> 'studentId', v_student_record ->> 'gradeLevel', v_target_class_grade
              USING ERRCODE = '22023';
        END IF;

        -- Student must exist in the caller's tenant (not deleted).
        SELECT TRUE INTO v_student_found
          FROM public.students s
         WHERE s.id = (v_student_record ->> 'studentId')::uuid
           AND s.tenant_id = v_tenant
           AND s.deleted_at IS NULL;
        IF v_student_found IS NOT TRUE THEN
            RAISE EXCEPTION 'fn_finalize_class_placements: student % not found in tenant %', v_student_record ->> 'studentId', v_tenant
              USING ERRCODE = '23503';
        END IF;

        UPDATE public.students
           SET class_id = v_final_target_class_id,
               grade_level_code = COALESCE(NULLIF(v_student_record ->> 'gradeLevel', ''), grade_level_code),
               updated_at = now()
         WHERE id = (v_student_record ->> 'studentId')::uuid
           AND tenant_id = v_tenant;

        v_assigned_students_count := v_assigned_students_count + 1;
    END LOOP;

    -- ── Step D: ONE audit entry for the whole batch (0014 entry point) ────
    PERFORM public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'class.placement_finalize',
        p_entity_type := 'class',
        p_entity_id   := NULL,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json  := jsonb_build_object(
                             'target_academic_year', v_target_year.label,
                             'classes_created', v_created_classes_count,
                             'classes_updated', v_updated_classes_count,
                             'students_assigned', v_assigned_students_count
                         ),
        p_note        := format('Constitution des classes effectuée pour %s : %s classe(s) créée(s), %s mise(s) à jour, %s élève(s) affecté(s).',
                                v_target_year.label, v_created_classes_count, v_updated_classes_count, v_assigned_students_count)
    );

    RETURN jsonb_build_object(
        'ok', TRUE,
        'targetYearId', v_target_year.id,
        'createdClassesCount', v_created_classes_count,
        'updatedClassesCount', v_updated_classes_count,
        'assignedStudentsCount', v_assigned_students_count
    );
END;
$function$;
-- ^ terminator added 2026-09-15 (OPS-313, T-378): the committed file closed the
-- dollar-quoted body with no `;`, so a fresh `supabase db push --include-all`
-- concatenated the CREATE FUNCTION with the following `revoke` statement and
-- parse-failed (42601, live-proven on the NEW project inside BEGIN/ROLLBACK).
-- Owner-sanctioned in-place edit (the one-byte syntax fix does not change the
-- applied semantics on any database that already carries 0096; both the OLD
-- and NEW projects keep their existing registrations untouched).


-- ----------------------------------------------------------------------------
-- Grants (the live-applied state: explicit EXECUTE for the three API roles —
-- the function is tenant-guarded, so anon callers fail closed at the tenant
-- resolution).
-- ----------------------------------------------------------------------------
revoke all on function public.fn_finalize_class_placements(uuid, text, jsonb, jsonb, jsonb, uuid, text, uuid) from public;
grant execute on function public.fn_finalize_class_placements(uuid, text, jsonb, jsonb, jsonb, uuid, text, uuid) to authenticated, service_role, anon;

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the apply script embeds this
-- so the DDL and the registration land in ONE atomic transaction).
-- NOTE: this migration was applied LIVE by a concurrent agent BEFORE this
-- file existed; the ON CONFLICT DO NOTHING keeps the re-registration safe.
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0096', '{0096_class_placement_finalize.sql}', 'class_placement_finalize')
on conflict (version) do nothing;
