-- ============================================================================
-- verify_t-402.sql — T-402 (the canonical promotion model read side), 0107.
-- Convention: BEGIN; … ROLLBACK; — re-runnable, never mutates.
--
-- The gap T-402 closes: the desktop NEVER read student_academic_histories
-- (Student.academicHistory always undefined in Supabase mode). This script
-- proves the FULL round-trip on the live database:
--   R1  the canonical WRITE (execute_batch_promotion, 0107's replaced
--       definition) archives history rows WITH the classification stamp;
--   R2  the desktop's exact READ (the repository's tenant-scoped
--       select-all + academic_year ordering — the wire shape the new
--       fetchAcademicHistoryRows emits) returns every column
--       mapAcademicHistoryRow consumes;
--   R3  repeaters stay distinguishable from promoted students;
--   R4  the shared fail-closed validation (promoted without next grade);
--   R5  idempotent re-run (ON CONFLICT student+year — overwritten in
--       place, never duplicated).
--
-- BLOCK STRUCTURE NOTE (the PL/pgSQL savepoint trap): each block runs in
-- its own implicit savepoint — a caught exception rolls back EVERYTHING
-- its block did. The sandbox setup therefore lives in its own block, and
-- every exception-expecting check is isolated so its rollback cannot eat
-- the previous checks' results (the first draft of this script lost R1..R3
-- exactly this way — do not re-inline them).
-- ============================================================================

BEGIN;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t402_results (check_id text, ok boolean, detail text);

-- ─── Block A: the sandbox family (no exception paths) ──────────────────────
do $setup$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_parent uuid;
begin
    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone, is_active)
    values (v_tenant, 'PAR-T402-VERIFY', 'T402', 'Verify', '0000000000', true)
    returning id into v_parent;

    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name,
                                 date_of_birth, grade_level_code, filiere_code, is_active)
    values (v_tenant, v_parent, 'ELV-T402-V1', 'Promoted', 'Student', '2009-01-01', '2eme_annee', 'mathematiques', true);

    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name,
                                 date_of_birth, grade_level_code, is_active)
    values (v_tenant, v_parent, 'ELV-T402-V2', 'Repeater', 'Student', '2009-01-01', '3eme_annee', true);
end
$setup$;

-- ─── Block B: the canonical write + the desktop's exact read ──────────────
do $main$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_student_promoted uuid := (select id from public.students where student_code = 'ELV-T402-V1');
    v_student_repeated uuid := (select id from public.students where student_code = 'ELV-T402-V2');
    v_result jsonb;
    v_read_count int;
    v_read_row record;
begin
    select public.execute_batch_promotion(
        p_decisions := jsonb_build_array(
            jsonb_build_object(
                'student_id', v_student_promoted,
                'decision', 'promoted',
                'next_grade_code', '3eme_annee',
                'academic_year', '2098-2099',
                'cycle', 'lycee',
                'grade_code', '2eme_annee',
                'grade_year', 2,
                'gpa', 15.25,
                'rank', 2,
                'narrative', 'T-402 verify promoted'
            ),
            jsonb_build_object(
                'student_id', v_student_repeated,
                'decision', 'repeated',
                'academic_year', '2098-2099',
                'cycle', 'lycee',
                'grade_code', '3eme_annee',
                'grade_year', 3,
                'gpa', 7.5,
                'rank', 25,
                'narrative', 'T-402 verify repeated'
            )
        ),
        p_actor_name := 'T-402 verify',
        p_tenant_id := v_tenant
    ) into v_result;

    insert into t402_results
    select 'R1_canonical_write_processed_both',
           (v_result ->> 'processed_count')::int = 2,
           'processed_count=' || (v_result ->> 'processed_count');

    insert into t402_results
    select 'R1b_student_advanced_and_class_cleared',
           s.grade_level_code = '3eme_annee' and s.class_id is null,
           'promoted student grade=' || s.grade_level_code || ' class=' || coalesce(s.class_id::text, 'NULL')
      from public.students s where s.id = v_student_promoted;

    insert into t402_results
    select 'R1c_repeater_untouched',
           s.grade_level_code = '3eme_annee' and s.enrollment_status = 'active',
           'repeater stays 3eme_annee+active (distinguished by the history decision)'
      from public.students s where s.id = v_student_repeated;

    -- The desktop's READ wire shape (fetchAcademicHistoryRows):
    -- select("*").eq("tenant_id", tenant).order("academic_year", ascending).
    select count(*) into v_read_count
      from public.student_academic_histories
     where tenant_id = v_tenant;

    select * into v_read_row
      from public.student_academic_histories
     where student_id = v_student_promoted
       and academic_year = '2098-2099';

    insert into t402_results
    select 'R2_read_returns_both_students',
           v_read_count = 2,
           'tenant-scoped history rows: ' || v_read_count;

    insert into t402_results
    select 'R2b_row_shape_mapper_complete',
           v_read_row.student_id = v_student_promoted
           and v_read_row.cycle is not null
           and v_read_row.grade_code is not null
           and v_read_row.grade_year is not null
           and v_read_row.decision = 'promoted'
           and v_read_row.gpa = 15.25
           and v_read_row.filiere_code = 'mathematiques'
           and v_read_row.specialite_code is null
           and v_read_row.recorded_at is not null,
           'every mapAcademicHistoryRow column present: decision=' || v_read_row.decision
           || ' gpa=' || v_read_row.gpa || ' filière=' || coalesce(v_read_row.filiere_code, 'NULL');

    insert into t402_results
    select 'R2c_repeater_distinguishable_in_history',
           h.decision = 'repeated' and h.gpa = 7.5,
           'repeater history decision=' || h.decision || ' gpa=' || h.gpa
      from public.student_academic_histories h
     where h.student_id = v_student_repeated and h.academic_year = '2098-2099';

    -- R5: idempotent re-run — overwritten in place, never duplicated.
    perform public.execute_batch_promotion(
        p_decisions := jsonb_build_array(
            jsonb_build_object(
                'student_id', v_student_promoted,
                'decision', 'promoted',
                'next_grade_code', '3eme_annee',
                'academic_year', '2098-2099',
                'cycle', 'lycee',
                'grade_code', '2eme_annee',
                'grade_year', 2,
                'gpa', 15.75,
                'narrative', 'T-402 verify re-run (overwrites in place)'
            )
        ),
        p_actor_name := 'T-402 verify',
        p_tenant_id := v_tenant
    );

    insert into t402_results
    select 'R5_idempotent_rerun_no_duplicate',
           count(*) = 2 and count(distinct student_id) = 2,
           'history rows after re-run: ' || count(*) || ' (one per student)'
      from public.student_academic_histories
     where tenant_id = v_tenant and academic_year = '2098-2099';

    insert into t402_results
    select 'R5b_rerun_overwrote_in_place',
           h.gpa = 15.75 and h.narrative like '%overwrites in place%',
           're-run gpa=' || h.gpa
      from public.student_academic_histories h
     where h.student_id = v_student_promoted
       and h.academic_year = '2098-2099';
end
$main$;

-- ─── Block C: the shared fail-closed validation (isolated — its exception
-- must not roll back Block B's results) ────────────────────────────────────
do $failclosed$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
begin
    perform public.execute_batch_promotion(
        p_decisions := jsonb_build_array(
            jsonb_build_object(
                'student_id', (select id from public.students where student_code = 'ELV-T402-V2'),
                'decision', 'promoted',
                'next_grade_code', NULL,
                'academic_year', '2097-2098',
                'cycle', 'lycee',
                'grade_code', '3eme_annee',
                'grade_year', 3,
                'gpa', 0,
                'narrative', 'Promotion directe (sans revue d''évaluations)'
            )
        ),
        p_actor_name := 'Promotion rapide',
        p_tenant_id := v_tenant
    );
    insert into t402_results values ('R4_shared_failclosed_validation', false, 'no exception (DEFECT — promoted without next_grade_code accepted)');
exception when others then
    insert into t402_results values ('R4_shared_failclosed_validation',
        sqlstate = '22023', 'promoted-without-next-grade rejected with ' || sqlstate || ' (the quick path and the review path share ONE validation)');
end
$failclosed$;

select check_id, ok, detail from t402_results order by check_id;

ROLLBACK;
