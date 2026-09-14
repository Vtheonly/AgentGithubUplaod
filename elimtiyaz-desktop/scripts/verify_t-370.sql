-- ============================================================================
-- verify_t-370.sql — T-370 (ACAD-500): the 0096 fn_finalize_class_placements
--                    invariants
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can be
-- re-run any time WITHOUT mutating the live DB. Results land in a temp table
-- SELECTed at the end. Covers BOTH the happy path AND the regression paths
-- (the ACAD-500 defect family: draft-ID pointer corruption, non-atomic
-- partial writes, dropped patches, missing audit).
--
-- Run:  SUPABASE_ACCESS_TOKEN=… supabase db query --linked < scripts/verify_t-370.sql
--   or: curl the Management API SQL endpoint with this file as the payload
--        (send from a FILE; a python-urllib User-Agent gets Cloudflare 403s).
--
-- NOTE (§15.27): the authenticated-role leg GRANTs the temp table because
-- SET LOCAL ROLE downgrades the session.
-- NOTE: `set local request.jwt.claims` forges the caller identity the way
-- PostgREST does — auth.uid()/auth.jwt() then resolve from the claims GUC
-- (the verify_t-369 convention).
-- NOTE (§11.1 quirk #9): no '' escapes in TOP-LEVEL SQL — every string
-- comparison lives inside dollar-quoted DO blocks (immune).
-- ============================================================================

BEGIN;

create temp table t370_results (
    check_id text primary key,
    passed boolean not null,
    detail text
);
grant select, insert on t370_results to authenticated;

-- ─── Probe data (all rolled back): parent, student, one existing class ────
delete from public.students where student_code = 'ELV-PROBE-T370';
delete from public.parents where parent_code = 'PAR-PROBE-T370';
delete from public.classes where code like 'CLS-PROBE-T370-%';

insert into public.parents (
    tenant_id, parent_code, first_name, last_name, primary_phone, relationship
)
select t.id, 'PAR-PROBE-T370', 'Probe', 'T-370', '0550000000', 'guardian'
  from public.tenants t
 order by t.created_at
 limit 1;

-- The probe student's grade mirrors an existing academic_levels row so the
-- RPC's grade-code resolution has a real FK target.
insert into public.students (
    tenant_id, parent_id, student_code, first_name, last_name,
    date_of_birth, grade_level_id, grade_level_code, enrollment_status
)
select p.tenant_id, p.id, 'ELV-PROBE-T370', 'Probe', 'T-370',
       current_date - interval '10 years',
       al.id, al.grade_code, 'active'
  from public.parents p
  join public.academic_levels al on al.tenant_id = p.tenant_id
 where p.parent_code = 'PAR-PROBE-T370'
 order by al.grade_code
 limit 1;

-- One EXISTING probe class of the tenant's CURRENT year (the patch leg
-- targets probe data, never real classes).
insert into public.classes (
    tenant_id, academic_year_id, academic_level_id, section, code, name,
    grade_code, capacity, room, is_active
)
select s.tenant_id, ay.id, s.grade_level_id, 'A', 'CLS-PROBE-T370-EXIST',
       'Probe T-370 existing section', s.grade_level_code, 30, 'ROOM-0', true
  from public.students s
  join public.academic_years ay
    on ay.tenant_id = s.tenant_id and ay.is_current = true
 where s.student_code = 'ELV-PROBE-T370';

-- ─── The trusted-caller identity (service_role claims, the t-369 pattern) ──
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

-- ============================================================================
-- CHECK 1 — HAPPY PATH: the atomic batch creates the draft class, MAPS the
--           draft id to the real UUID, applies the existing-class patch,
--           assigns the student, and writes ONE audit entry.
-- ============================================================================
do $$
declare
    v_tenant uuid;
    v_year_id uuid;
    v_year_label text;
    v_grade text;
    v_student_id uuid;
    v_exist_class_id uuid;
    v_res jsonb;
    v_created_id uuid;
    v_audit_before int;
    v_audit_after int;
begin
    select s.tenant_id, s.id, s.grade_level_code
      into v_tenant, v_student_id, v_grade
      from public.students s
     where s.student_code = 'ELV-PROBE-T370';

    select ay.id, ay.label into v_year_id, v_year_label
      from public.academic_years ay
     where ay.tenant_id = v_tenant and ay.is_current = true;

    select c.id into v_exist_class_id
      from public.classes c
     where c.code = 'CLS-PROBE-T370-EXIST';

    select count(*) into v_audit_before
      from public.audit_logs
     where action = 'class.placement_finalize';

    v_res := public.fn_finalize_class_placements(
        p_target_year_id   := v_year_id,
        p_target_year_code := null,
        p_new_classes      := jsonb_build_array(
            jsonb_build_object(
                'clientDraftId', 'draft-probe-t370',
                'code', 'CLS-PROBE-T370-NEW',
                'name', 'Probe T-370 new section',
                'gradeCode', v_grade,
                'section', 'B',
                'room', 'ROOM-NEW',
                'capacity', 20
            )
        ),
        p_updated_classes  := jsonb_build_array(
            jsonb_build_object(
                'id', v_exist_class_id,
                'room', 'ROOM-PATCHED-99'
            )
        ),
        p_student_assignments := jsonb_build_array(
            jsonb_build_object(
                'studentId', v_student_id,
                'targetClassId', 'draft-probe-t370',
                'gradeLevel', v_grade
            )
        ),
        p_actor_profile_id := null,
        p_actor_name       := 'Probe T-370',
        p_tenant_id        := v_tenant
    );

    select id into v_created_id
      from public.classes
     where code = 'CLS-PROBE-T370-NEW';

    select count(*) into v_audit_after
      from public.audit_logs
     where action = 'class.placement_finalize';

    insert into t370_results values (
        '1_rpc_confirms_counts',
        (v_res ->> 'ok') = 'true'
            and (v_res ->> 'createdClassesCount') = '1'
            and (v_res ->> 'updatedClassesCount') = '1'
            and (v_res ->> 'assignedStudentsCount') = '1'
            and (v_res ->> 'targetYearId') = v_year_id::text,
        'res=' || coalesce(v_res::text, '?')
    );
    insert into t370_results values (
        '1b_draft_id_mapped_to_real_uuid',
        v_created_id is not null
            and v_created_id::text <> 'draft-probe-t370'
            and (select class_id::text from public.students where id = v_student_id) = v_created_id::text,
        'created=' || coalesce(v_created_id::text, 'NULL')
            || ' student.class_id=' || coalesce((select class_id::text from public.students where id = v_student_id), 'NULL')
    );
    insert into t370_results values (
        '1c_existing_class_patch_applied',
        (select room from public.classes where id = v_exist_class_id) = 'ROOM-PATCHED-99',
        'room=' || coalesce((select room from public.classes where id = v_exist_class_id), 'NULL')
    );
    insert into t370_results values (
        '1d_grade_level_resolved_not_synthesized',
        (select grade_code from public.classes where id = v_created_id) = v_grade
            and (select academic_level_id from public.classes where id = v_created_id)
                = (select id from public.academic_levels where tenant_id = v_tenant and grade_code = v_grade limit 1),
        'class.grade_code=' || coalesce((select grade_code from public.classes where id = v_created_id), '?')
    );
    insert into t370_results values (
        '1e_one_audit_entry_for_the_batch',
        v_audit_after - v_audit_before = 1,
        'audit delta=' || (v_audit_after - v_audit_before)
    );
end;
$$;

-- ============================================================================
-- CHECK 2 — ATOMICITY: a batch whose SECOND assignment references an unknown
--           student rolls back EVERYTHING (the class creation included).
-- ============================================================================
do $$
declare
    v_tenant uuid;
    v_year_id uuid;
    v_student_id uuid;
    v_err text := '';
    v_classes_before int;
    v_classes_after int;
begin
    select s.tenant_id, s.id into v_tenant, v_student_id
      from public.students s where s.student_code = 'ELV-PROBE-T370';
    select ay.id into v_year_id
      from public.academic_years ay
     where ay.tenant_id = v_tenant and ay.is_current = true;

    select count(*) into v_classes_before
      from public.classes where code like 'CLS-PROBE-T370-%';

    begin
        perform public.fn_finalize_class_placements(
            p_target_year_id   := v_year_id,
            p_target_year_code := null,
            p_new_classes      := jsonb_build_array(
                jsonb_build_object(
                    'clientDraftId', 'draft-probe-atomic',
                    'code', 'CLS-PROBE-T370-ATOMIC',
                    'name', 'Probe atomic section',
                    'gradeCode', (select grade_level_code from public.students where id = v_student_id),
                    'section', 'A'
                )
            ),
            p_updated_classes  := '[]'::jsonb,
            p_student_assignments := jsonb_build_array(
                jsonb_build_object(
                    'studentId', v_student_id,
                    'targetClassId', 'draft-probe-atomic',
                    'gradeLevel', (select grade_level_code from public.students where id = v_student_id)
                ),
                jsonb_build_object(
                    'studentId', '00000000-0000-0000-0000-00000000dead',
                    'targetClassId', 'draft-probe-atomic',
                    'gradeLevel', (select grade_level_code from public.students where id = v_student_id)
                )
            ),
            p_actor_name       := 'Probe T-370',
            p_tenant_id        := v_tenant
        );
    exception when others then
        v_err := sqlerrm;
    end;

    select count(*) into v_classes_after
      from public.classes where code like 'CLS-PROBE-T370-%';

    insert into t370_results values (
        '2_atomic_rollback_no_partial_writes',
        v_err like 'fn_finalize_class_placements: student % not found%'
            and v_classes_after = v_classes_before,
        'err=' || coalesce(v_err, 'NONE')
            || ' classes_before=' || v_classes_before
            || ' classes_after=' || v_classes_after
    );
end;
$$;

-- ============================================================================
-- CHECK 3 — REGRESSION PATHS: duplicate class code (23505), cross-grade
--           assignment (22023), unknown target year (23503).
-- ============================================================================
do $$
declare
    v_tenant uuid;
    v_year_id uuid;
    v_year_label text;
    v_student_id uuid;
    v_grade text;
    v_code_state text := '';
    v_grade_state text := '';
    v_year_state text := '';
begin
    select s.tenant_id, s.id, s.grade_level_code
      into v_tenant, v_student_id, v_grade
      from public.students s where s.student_code = 'ELV-PROBE-T370';
    select ay.id, ay.label into v_year_id, v_year_label
      from public.academic_years ay
     where ay.tenant_id = v_tenant and ay.is_current = true;

    -- 3a: duplicate code in the target year.
    begin
        perform public.fn_finalize_class_placements(
            p_target_year_id   := v_year_id,
            p_new_classes      := jsonb_build_array(
                jsonb_build_object(
                    'clientDraftId', 'draft-dup',
                    'code', 'CLS-PROBE-T370-EXIST',
                    'name', 'Probe duplicate',
                    'gradeCode', v_grade,
                    'section', 'A'
                )
            ),
            p_updated_classes  := '[]'::jsonb,
            p_student_assignments := '[]'::jsonb,
            p_actor_name       := 'Probe T-370',
            p_tenant_id        := v_tenant
        );
    exception when unique_violation or others then
        v_code_state := sqlstate;
    end;

    -- 3b: cross-grade assignment (gradeLevel mismatch vs the target class).
    begin
        perform public.fn_finalize_class_placements(
            p_target_year_id   := v_year_id,
            p_new_classes      := '[]'::jsonb,
            p_updated_classes  := '[]'::jsonb,
            p_student_assignments := jsonb_build_array(
                jsonb_build_object(
                    'studentId', v_student_id,
                    'targetClassId', (select id from public.classes where code = 'CLS-PROBE-T370-EXIST'),
                    'gradeLevel', 'zz-grade-mismatch'
                )
            ),
            p_actor_name       := 'Probe T-370',
            p_tenant_id        := v_tenant
        );
    exception when others then
        v_grade_state := sqlstate;
    end;

    -- 3c: unknown target academic year.
    begin
        perform public.fn_finalize_class_placements(
            p_target_year_id   := null,
            p_target_year_code := 'T370-NO-SUCH-YEAR',
            p_new_classes      := '[]'::jsonb,
            p_updated_classes  := '[]'::jsonb,
            p_student_assignments := '[]'::jsonb,
            p_actor_name       := 'Probe T-370',
            p_tenant_id        := v_tenant
        );
    exception when others then
        v_year_state := sqlstate;
    end;

    insert into t370_results values ('3a_duplicate_code_23505', v_code_state = '23505', 'sqlstate=' || coalesce(v_code_state, 'NONE'));
    insert into t370_results values ('3b_cross_grade_22023', v_grade_state = '22023', 'sqlstate=' || coalesce(v_grade_state, 'NONE'));
    insert into t370_results values ('3c_unknown_year_23503', v_year_state = '23503', 'sqlstate=' || coalesce(v_year_state, 'NONE'));
end;
$$;

-- ============================================================================
-- CHECK 4 — TENANT GUARD: an authenticated caller whose tenant context
--           disagrees with p_tenant_id is rejected 42501 (the 0055 pattern).
--           The p_tenant_id is a LITERAL (the primary tenant id) — under the
--           forged authenticated identity every students read is RLS-filtered
--           to the CALLER's (bogus) tenant, so a subquery would return NULL.
-- ============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000feed", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-00000000beef"}}';

do $$
declare
    v_err_state text := '';
begin
    begin
        perform public.fn_finalize_class_placements(
            p_target_year_code := 'ANY',
            p_new_classes      := '[]'::jsonb,
            p_updated_classes  := '[]'::jsonb,
            p_student_assignments := '[]'::jsonb,
            p_actor_name       := 'Probe T-370',
            -- The REAL primary tenant as a literal, while the forged caller
            -- context points at another tenant: the mismatch must be
            -- rejected before any data access.
            p_tenant_id        := '00000000-0000-0000-0000-000000000001'::uuid
        );
    exception when others then
        v_err_state := sqlstate;
    end;

    insert into t370_results values (
        '4_tenant_mismatch_42501',
        v_err_state = '42501',
        'sqlstate=' || coalesce(v_err_state, 'NONE')
    );
end;
$$;

-- Restore the trusted identity for the remaining checks.
RESET ROLE;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

-- ============================================================================
-- CHECK 5 — GRANTS + REGISTRATION: EXECUTE for the three API roles, and the
--           0096 row present in supabase_migrations.schema_migrations.
-- ============================================================================
do $$
begin
    insert into t370_results values (
        '5a_grant_authenticated',
        has_function_privilege('authenticated', 'public.fn_finalize_class_placements(uuid, text, jsonb, jsonb, jsonb, uuid, text, uuid)', 'EXECUTE'),
        'has_function_privilege authenticated'
    );
    insert into t370_results values (
        '5b_grant_anon',
        has_function_privilege('anon', 'public.fn_finalize_class_placements(uuid, text, jsonb, jsonb, jsonb, uuid, text, uuid)', 'EXECUTE'),
        'has_function_privilege anon'
    );
    insert into t370_results values (
        '5c_grant_service_role',
        has_function_privilege('service_role', 'public.fn_finalize_class_placements(uuid, text, jsonb, jsonb, jsonb, uuid, text, uuid)', 'EXECUTE'),
        'has_function_privilege service_role'
    );
    insert into t370_results values (
        '5d_registration_row_0096',
        exists (
            select 1 from supabase_migrations.schema_migrations
             where version = '0096' and name = 'class_placement_finalize'
        ),
        'supabase_migrations 0096 present'
    );
end;
$$;

select check_id, passed, detail from t370_results order by check_id;

ROLLBACK;
