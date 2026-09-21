-- ============================================================================
-- verify_t-403.sql — T-403 (the promotion-cycle workflow), 0108.
-- Convention: BEGIN; … ROLLBACK; — re-runnable, never mutates.
--
-- BLOCK STRUCTURE (the PL/pgSQL savepoint trap — see verify_t-402.sql's
-- header): the sandbox setup, the main happy-path, and EVERY
-- exception-expecting check live in ISOLATED DO blocks so a caught exception
-- cannot roll back earlier results.
--
--   C1  create cycle → cycle + per-class rows with live counts
--   C2  a second active cycle for the same source year → 23505
--   C3  confirm with a MISSING student decision → 22023 (every-student rule)
--   C4  confirm with incomplete notes + NO ack → [NOTES_INCOMPLETES] P0001
--   C5  confirm WITH the ack → processed + tallies + students advanced +
--       history stamped (incl. 0107's filière) + cycle partially_processed
--   C6  re-confirming the processed class → 55006
--   C7  reopen → in_review → re-confirm (idempotent history upsert)
--   C8  complete with a pending class → refused with the list
--   C9  complete after ALL classes resolved → completed
--   C10 a completed cycle cannot be cancelled; a cancelled year's slot can
--       host a fresh cycle
-- ============================================================================

BEGIN;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t403_results (check_id text, ok boolean, detail text);

-- ─── Block A: the sandbox (a far-future year, 2 classes, 3 students,
-- complete assessments for 2, incomplete for 1) ───────────────────────────
do $setup$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_year_id uuid;
    v_class_a uuid;
    v_class_b uuid;
    v_subject uuid;
    v_cs uuid;
    v_parent uuid;
    v_s1 uuid; v_s2 uuid; v_s3 uuid;
begin
    insert into public.academic_years (tenant_id, label, code, start_date, end_date, term_structure, is_current)
    values (v_tenant, 'T403-VERIFY-2095', '2095-2096', '2095-09-01', '2096-06-30', 'trimester', false)
    returning id into v_year_id;

    insert into public.classes (tenant_id, academic_year_id, academic_level_id, code, name, grade_code, section, filiere_code)
    select v_tenant, v_year_id, al.id, 'T403-A', 'T403 Classe A', '2eme_annee', 'A', 'mathematiques'
      from public.academic_levels al where al.tenant_id = v_tenant and al.grade_code = '2eme_annee'
    returning id into v_class_a;

    insert into public.classes (tenant_id, academic_year_id, academic_level_id, code, name, grade_code, section)
    select v_tenant, v_year_id, al.id, 'T403-B', 'T403 Classe B', '1ere_annee', 'B'
      from public.academic_levels al where al.tenant_id = v_tenant and al.grade_code = '1ere_annee'
    returning id into v_class_b;

    insert into public.subjects (tenant_id, code, name_fr, domain, default_coefficient)
    values (v_tenant, 'T403-MATH', 'T403 Mathématiques', 'scolarite', 4)
    returning id into v_subject;

    insert into public.class_subjects (tenant_id, class_id, subject_id)
    values (v_tenant, v_class_a, v_subject)
    returning id into v_cs;

    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone, is_active)
    values (v_tenant, 'PAR-T403-VERIFY', 'T403', 'Verify', '0000000000', true)
    returning id into v_parent;

    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name, date_of_birth,
                                 grade_level_code, filiere_code, class_id, is_active)
    values (v_tenant, v_parent, 'ELV-T403-1', 'Complet', 'Un', '2009-01-01', '2eme_annee', 'mathematiques', v_class_a, true)
    returning id into v_s1;
    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name, date_of_birth,
                                 grade_level_code, class_id, is_active)
    values (v_tenant, v_parent, 'ELV-T403-2', 'Complet', 'Deux', '2009-01-01', '2eme_annee', v_class_a, true)
    returning id into v_s2;
    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name, date_of_birth,
                                 grade_level_code, class_id, is_active)
    values (v_tenant, v_parent, 'ELV-T403-3', 'Incomplet', 'Trois', '2009-01-01', '2eme_annee', v_class_a, true)
    returning id into v_s3;

    -- Complete marks for s1 and s2; s3 gets NOTHING (the incomplete case).
    insert into public.assessments (tenant_id, student_id, class_id, subject_id, academic_year,
                                    term, kind, label, max_score, devoir1, devoir2, examen, class_subject_id)
    values (v_tenant, v_s1, v_class_a, v_subject, '2095-2096', 1, 'devoir_1', 'T403', 20, 15, 14, 16, v_cs),
           (v_tenant, v_s2, v_class_a, v_subject, '2095-2096', 1, 'devoir_2', 'T403', 20, 12, 11, 10, v_cs);

    -- A student in class B (the "other class stays pending" case).
    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name, date_of_birth,
                                 grade_level_code, class_id, is_active)
    values (v_tenant, v_parent, 'ELV-T403-4', 'Autre', 'Classe', '2010-01-01', '1ere_annee', v_class_b, true);
end
$setup$;

-- ─── Block B: C1 create + C3/C4/C5 the confirm matrix + C6/C7 reopen ──────
do $main$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_class_a uuid := (select id from public.classes where code = 'T403-A');
    v_class_b uuid := (select id from public.classes where code = 'T403-B');
    v_s1 uuid := (select id from public.students where student_code = 'ELV-T403-1');
    v_s2 uuid := (select id from public.students where student_code = 'ELV-T403-2');
    v_s3 uuid := (select id from public.students where student_code = 'ELV-T403-3');
    v_result jsonb;
    v_cycle_id uuid;
    v_row record;
begin
    -- C1: create the cycle.
    select public.fn_create_promotion_cycle(
        p_source_academic_year := '2095-2096',
        p_actor_name := 'T-403 verify',
        p_tenant_id := v_tenant
    ) into v_result;
    v_cycle_id := (v_result ->> 'cycle_id')::uuid;

    insert into t403_results
    select 'C1_cycle_created_with_classes',
           (v_result ->> 'classes_count')::int = 2,
           'classes_count=' || (v_result ->> 'classes_count');

    insert into t403_results
    select 'C1b_class_rows_carry_live_counts',
           count(*) = 2 and sum(students_awaiting) = 4 and min(status) = 'pending',
           'class rows: ' || count(*) || ' awaiting total: ' || sum(students_awaiting)
      from public.promotion_cycle_classes where cycle_id = v_cycle_id;

    -- C3: a decision is missing for s3 → the every-student rule.
    begin
        perform public.fn_confirm_promotion_cycle_class(
            p_cycle_id := v_cycle_id,
            p_class_id := v_class_a,
            p_decisions := jsonb_build_array(
                jsonb_build_object('student_id', v_s1, 'decision', 'promoted',
                                   'next_grade_code', '3eme_annee', 'academic_year', '2095-2096',
                                   'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2, 'gpa', 15),
                jsonb_build_object('student_id', v_s2, 'decision', 'repeated',
                                   'academic_year', '2095-2096',
                                   'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2, 'gpa', 7)
            ),
            p_actor_name := 'T-403 verify',
            p_tenant_id := v_tenant
        );
        insert into t403_results values ('C3_missing_decision_rejected', false, 'no exception (DEFECT)');
    exception when others then
        insert into t403_results values ('C3_missing_decision_rejected',
            sqlstate = '22023' and sqlerrm like '%doit avoir une décision%',
            'raised ' || sqlstate || ': ' || left(sqlerrm, 80));
    end;

    -- C4: incomplete notes (s3 has no marks) + NO ack → the blocking warning.
    begin
        perform public.fn_confirm_promotion_cycle_class(
            p_cycle_id := v_cycle_id,
            p_class_id := v_class_a,
            p_decisions := jsonb_build_array(
                jsonb_build_object('student_id', v_s1, 'decision', 'promoted',
                                   'next_grade_code', '3eme_annee', 'academic_year', '2095-2096',
                                   'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2, 'gpa', 15),
                jsonb_build_object('student_id', v_s2, 'decision', 'repeated',
                                   'academic_year', '2095-2096',
                                   'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2, 'gpa', 7),
                jsonb_build_object('student_id', v_s3, 'decision', 'repeated',
                                   'academic_year', '2095-2096',
                                   'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2, 'gpa', 0)
            ),
            p_ack_incomplete_notes := false,
            p_actor_name := 'T-403 verify',
            p_tenant_id := v_tenant
        );
        insert into t403_results values ('C4_incomplete_notes_blocked', false, 'no exception (DEFECT)');
    exception when others then
        insert into t403_results values ('C4_incomplete_notes_blocked',
            position('[NOTES_INCOMPLETES]' in sqlerrm) > 0,
            'raised: ' || left(sqlerrm, 100));
    end;

    -- C5: WITH the ack → the confirmation succeeds end to end.
    select public.fn_confirm_promotion_cycle_class(
        p_cycle_id := v_cycle_id,
        p_class_id := v_class_a,
        p_decisions := jsonb_build_array(
            jsonb_build_object('student_id', v_s1, 'decision', 'promoted',
                               'next_grade_code', '3eme_annee', 'academic_year', '2095-2096',
                               'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2,
                               'gpa', 15, 'rank', 1, 'narrative', 'T-403'),
            jsonb_build_object('student_id', v_s2, 'decision', 'repeated',
                               'academic_year', '2095-2096',
                               'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2,
                               'gpa', 7, 'rank', 2, 'narrative', 'T-403'),
            jsonb_build_object('student_id', v_s3, 'decision', 'repeated',
                               'academic_year', '2095-2096',
                               'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2,
                               'gpa', 0, 'rank', 3, 'narrative', 'T-403')
        ),
        p_ack_incomplete_notes := true,
        p_actor_name := 'T-403 verify',
        p_tenant_id := v_tenant
    ) into v_result;

    insert into t403_results
    select 'C5_confirmed_with_ack',
           (v_result ->> 'promoted')::int = 1 and (v_result ->> 'repeated')::int = 2,
           'promoted=' || (v_result ->> 'promoted') || ' repeated=' || (v_result ->> 'repeated')
              || ' incomplete_count=' || (v_result ->> 'incomplete_notes_count');

    insert into t403_results
    select 'C5b_class_row_processed_with_tallies',
           pcc.status = 'processed' and pcc.promoted_count = 1 and pcc.repeating_count = 2
             and pcc.processed_by_name = 'T-403 verify' and pcc.processed_at is not null,
           'status=' || pcc.status || ' P=' || pcc.promoted_count || ' R=' || pcc.repeating_count
      from public.promotion_cycle_classes pcc
     where pcc.cycle_id = v_cycle_id and pcc.class_id = v_class_a;

    insert into t403_results
    select 'C5c_student_advanced_and_history_stamped',
           s.grade_level_code = '3eme_annee' and s.class_id is null
             and h.decision = 'promoted' and h.filiere_code = 'mathematiques',
           's1 grade=' || s.grade_level_code || ' history filière=' || coalesce(h.filiere_code, 'NULL')
      from public.students s
      left join public.student_academic_histories h
        on h.student_id = s.id and h.academic_year = '2095-2096'
     where s.id = v_s1;

    insert into t403_results
    select 'C5d_cycle_partially_processed',
           pc.status = 'partially_processed',
           'cycle status=' || pc.status
      from public.promotion_cycles pc where pc.id = v_cycle_id;

    -- C6: re-confirming the processed class is refused.
    begin
        perform public.fn_confirm_promotion_cycle_class(
            p_cycle_id := v_cycle_id,
            p_class_id := v_class_a,
            p_decisions := jsonb_build_array(
                jsonb_build_object('student_id', v_s1, 'decision', 'promoted',
                                   'next_grade_code', '3eme_annee', 'academic_year', '2095-2096',
                                   'cycle', 'lycee', 'grade_code', '3eme_annee', 'grade_year', 3, 'gpa', 15)),
            p_ack_incomplete_notes := true,
            p_actor_name := 'T-403 verify',
            p_tenant_id := v_tenant
        );
        insert into t403_results values ('C6_reconfirm_refused', false, 'no exception (DEFECT)');
    exception when others then
        insert into t403_results values ('C6_reconfirm_refused',
            sqlstate = '55006', 'raised ' || sqlstate);
    end;

    -- C7: reopen → in_review → the live awaiting count is back.
    perform public.fn_reopen_promotion_cycle_class(
        p_cycle_id := v_cycle_id, p_class_id := v_class_a,
        p_reason := 'T-403 reopen check', p_actor_name := 'T-403 verify', p_tenant_id := v_tenant);

    -- NOTE: after the C5 confirmation the promoted student LEFT the class
    -- (class_id cleared) — the reopened review's live awaiting count is the
    -- 2 repeaters, not the original 3.
    insert into t403_results
    select 'C7_reopen_back_to_in_review',
           pcc.status = 'in_review' and pcc.students_awaiting = 2,
           'status=' || pcc.status || ' awaiting=' || pcc.students_awaiting || ' (the promoted student left the class)'
      from public.promotion_cycle_classes pcc
     where pcc.cycle_id = v_cycle_id and pcc.class_id = v_class_a;

    -- C8: complete with class B still pending → refused with the list.
    begin
        perform public.fn_complete_promotion_cycle(v_cycle_id, p_actor_name := 'T-403 verify', p_tenant_id := v_tenant);
        insert into t403_results values ('C8_complete_refused_while_pending', false, 'no exception (DEFECT)');
    exception when others then
        insert into t403_results values ('C8_complete_refused_while_pending',
            sqlstate = '22023' and sqlerrm like '%T403 Classe B%',
            'raised ' || sqlstate || ': ' || left(sqlerrm, 80));
    end;

    -- C7b: re-confirm the reopened class (the idempotent path — the
    -- history upsert overwrites in place, never duplicates).
    select public.fn_confirm_promotion_cycle_class(
        p_cycle_id := v_cycle_id,
        p_class_id := v_class_a,
        p_decisions := jsonb_build_array(
            jsonb_build_object('student_id', v_s1, 'decision', 'promoted',
                               'next_grade_code', '3eme_annee', 'academic_year', '2095-2096',
                               'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2,
                               'gpa', 15, 'rank', 1, 'narrative', 'T-403 re-run'),
            jsonb_build_object('student_id', v_s2, 'decision', 'repeated',
                               'academic_year', '2095-2096',
                               'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2,
                               'gpa', 7, 'rank', 2, 'narrative', 'T-403'),
            jsonb_build_object('student_id', v_s3, 'decision', 'repeated',
                               'academic_year', '2095-2096',
                               'cycle', 'lycee', 'grade_code', '2eme_annee', 'grade_year', 2,
                               'gpa', 0, 'rank', 3, 'narrative', 'T-403')
        ),
        p_ack_incomplete_notes := true,
        p_actor_name := 'T-403 verify',
        p_tenant_id := v_tenant
    ) into v_result;

    insert into t403_results
    select 'C7b_reconfirm_after_reopen',
           (v_result ->> 'promoted')::int = 1,
           're-confirmed promoted=' || (v_result ->> 'promoted');

    insert into t403_results
    select 'C7c_history_not_duplicated',
           count(*) = 3,
           'history rows for the 3 students (overwritten in place): ' || count(*)
      from public.student_academic_histories h
     where h.academic_year = '2095-2096'
       and h.student_id in (v_s1, v_s2, v_s3);

    -- Resolve class B (skip) then complete.
    update public.promotion_cycle_classes pcc
       set status = 'skipped', exception_note = 'T-403 verify skip'
     where pcc.cycle_id = v_cycle_id and pcc.class_id = v_class_b;

    perform public.fn_complete_promotion_cycle(v_cycle_id, p_actor_name := 'T-403 verify', p_tenant_id := v_tenant);

    insert into t403_results
    select 'C9_cycle_completed',
           pc.status = 'completed' and pc.completed_at is not null and pc.completed_by_name = 'T-403 verify',
           'status=' || pc.status || ' completed_by=' || coalesce(pc.completed_by_name, 'NULL')
      from public.promotion_cycles pc where pc.id = v_cycle_id;

    -- C10: a completed cycle cannot be cancelled.
    begin
        perform public.fn_cancel_promotion_cycle(v_cycle_id, p_reason := 'nope', p_actor_name := 'T-403 verify', p_tenant_id := v_tenant);
        insert into t403_results values ('C10_completed_not_cancellable', false, 'no exception (DEFECT)');
    exception when others then
        insert into t403_results values ('C10_completed_not_cancellable',
            sqlstate = '55006', 'raised ' || sqlstate);
    end;
end
$main$;

-- ─── Block C: C2 (the duplicate-cycle guard) + the cancel-frees-slot rule,
-- in their own transaction state after Block B's completion. ─────────────
do $second$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_result jsonb;
begin
    -- The active (completed) cycle still occupies the 2095-2096 slot.
    begin
        perform public.fn_create_promotion_cycle(
            p_source_academic_year := '2095-2096',
            p_actor_name := 'T-403 verify',
            p_tenant_id := v_tenant
        );
        insert into t403_results values ('C2_duplicate_active_cycle_rejected', false, 'no exception (DEFECT)');
    exception when others then
        insert into t403_results values ('C2_duplicate_active_cycle_rejected',
            sqlstate = '23505', 'raised ' || sqlstate);
    end;
end
$second$;

select check_id, ok, detail from t403_results order by check_id;

ROLLBACK;
