-- ============================================================================
-- verify_t-401.sql — T-401 (filière / spécialité classification), 0107.
-- Convention: BEGIN; … ROLLBACK; — re-runnable any time, never mutates.
-- Results land in the t401_results temp table, SELECTed at the end.
-- Covers BOTH the happy paths AND the regression paths:
--   C1  the catalog is seeded (10 filières + 4 génie spécialités per tenant)
--   C2  fn_track_compatible — the five compatibility rules
--   C3  fn_finalize_class_placements — tagged class creation + stamping +
--       incompatibility rejection (22023) + old-client (no filière keys)
--       behavior preserved
--   C4  execute_batch_promotion — history rows stamped with the filière
--   C5  upsert_student_from_import — classification params round-trip +
--       NULL preserves (import never erases classification)
-- ============================================================================

BEGIN;

-- The trusted-caller identity (service_role claims — the t-370/t-041
-- pattern): the tenant-guarded RPCs resolve current_tenant_id()/auth.jwt()
-- from these claims exactly the way PostgREST does.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t401_results (check_id text, ok boolean, detail text);

-- ─── C1: catalog seeded ────────────────────────────────────────────────────
insert into t401_results
select 'C1a_filiere_catalog',
       count(*) = 10,
       'filieres rows per tenant: ' || count(*)
  from public.filieres where parent_code is null;

insert into t401_results
select 'C1b_specialite_catalog',
       count(*) = 4,
       'génie spécialité rows per tenant: ' || count(*)
  from public.filieres where parent_code = 'technique_mathematique';

insert into t401_results
select 'C1c_every_academic_tenant_seeded',
       (select count(distinct tenant_id) from public.academic_levels)
         = (select count(distinct tenant_id) from public.filieres),
       'academic tenants = ' || (select count(distinct tenant_id) from public.academic_levels)
       || ' vs seeded tenants = ' || (select count(distinct tenant_id) from public.filieres);

-- ─── C2: fn_track_compatible — the compatibility rules ─────────────────────
-- (service-role style call: explicit tenant from academic_levels)
insert into t401_results
select 'C2a_untagged_class_always_compatible',
       public.fn_track_compatible('mathematiques', null, null, null, '2eme_annee',
                                  (select tenant_id from public.academic_levels limit 1)) is true,
       'untagged class accepts any student';

insert into t401_results
select 'C2b_same_filiere_compatible',
       public.fn_track_compatible('mathematiques', null, 'mathematiques', null, '2eme_annee',
                                  (select tenant_id from public.academic_levels limit 1)) is true,
       'same filière passes';

insert into t401_results
select 'C2c_conflicting_applicable_filiere_rejected',
       public.fn_track_compatible('mathematiques', null, 'lettres_philosophie', null, '2eme_annee',
                                  (select tenant_id from public.academic_levels limit 1)) is false,
       '2AS maths student into 2AS lettres class must be REJECTED';

insert into t401_results
select 'C2d_restreaming_compatible',
       public.fn_track_compatible('tronc_commun_sciences', null, 'sciences_experimentales', null, '2eme_annee',
                                  (select tenant_id from public.academic_levels limit 1)) is true,
       '1AS tronc commun entering 2AS filière (re-streaming) passes';

insert into t401_results
select 'C2e_specialite_conflict_rejected',
       public.fn_track_compatible('technique_mathematique', 'genie_civil',
                                  'technique_mathematique', 'genie_electrique', '3eme_annee',
                                  (select tenant_id from public.academic_levels limit 1)) is false,
       'génie civil student into génie électrique class must be REJECTED';

insert into t401_results
select 'C2f_untagged_student_enters_tagged_class',
       public.fn_track_compatible(null, null, 'mathematiques', null, '2eme_annee',
                                  (select tenant_id from public.academic_levels limit 1)) is true,
       'untagged student can enter a tagged class (assignment tags them)';

-- ─── C3: fn_finalize_class_placements (classification-aware) ──────────────
-- Sandbox: a dedicated target year + tenant-owned class + students, all
-- rolled back at the end.
do $verify$
declare
    v_tenant uuid := (select tenant_id from public.academic_levels limit 1);
    v_year_id uuid;
    v_class_id uuid;
    v_math_class_id uuid;
    v_student_1 uuid;  -- untagged student
    v_student_2 uuid;  -- mathématiques student
    v_parent uuid;
    v_result jsonb;
begin
    -- a disposable target year far in the future
    insert into public.academic_years (tenant_id, label, code, start_date, end_date, term_structure, is_current)
    values (v_tenant, 'T401-VERIFY-2099', '2099-2100', '2099-09-01', '2100-06-30', 'trimester', false)
    returning id into v_year_id;

    insert into public.classes (tenant_id, academic_year_id, academic_level_id, code, name, grade_code, section, filiere_code)
    select v_tenant, v_year_id, al.id, 'T401-MATH-1', 'T401 Mathématiques A', '2eme_annee', 'A', 'mathematiques'
      from public.academic_levels al
     where al.tenant_id = v_tenant and al.grade_code = '2eme_annee'
    returning id into v_math_class_id;

    -- a disposable parent + two students
    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone, is_active)
    values (v_tenant, 'PAR-T401-VERIFY', 'T401', 'Verify', '0000000000', true)
    returning id into v_parent;

    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name,
                                 date_of_birth, grade_level_code, is_active)
    values (v_tenant, v_parent, 'ELV-T401-V1', 'Untagged', 'Student', '2010-01-01', '1ere_annee', true)
    returning id into v_student_1;

    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name,
                                 date_of_birth, grade_level_code, filiere_code, is_active)
    values (v_tenant, v_parent, 'ELV-T401-V2', 'Maths', 'Student', '2009-01-01', '2eme_annee', 'mathematiques', true)
    returning id into v_student_2;

    -- C3a: incompatibility rejected (2AS maths student into a
    -- lettres-tagged new class) — the whole batch rolls back.
    begin
        insert into public.classes (tenant_id, academic_year_id, academic_level_id, code, name, grade_code, section, filiere_code)
        select v_tenant, v_year_id, al.id, 'T401-LETTRES-1', 'T401 Lettres A', '2eme_annee', 'A', 'lettres_philosophie'
          from public.academic_levels al
         where al.tenant_id = v_tenant and al.grade_code = '2eme_annee'
        returning id into v_class_id;

        perform public.fn_finalize_class_placements(
            p_target_year_id := v_year_id,
            p_new_classes := '[]'::jsonb,
            p_updated_classes := '[]'::jsonb,
            p_student_assignments := jsonb_build_array(
                jsonb_build_object('studentId', v_student_2, 'targetClassId', v_class_id, 'gradeLevel', '2eme_annee')
            ),
            p_actor_profile_id := null,
            p_actor_name := 'T-401 verify',
            p_tenant_id := v_tenant
        );
        insert into t401_results values ('C3a_conflicting_assignment_rejected', false, 'no exception raised (DEFECT)');
    exception when others then
        insert into t401_results values ('C3a_conflicting_assignment_rejected',
            sqlstate = '22023', 'incompatibility raised ' || sqlstate || ': ' || sqlerrm);
    end;

    -- C3b: re-streaming assignment passes and STAMPS the student's
    -- filière from the tagged class (1AS untagged → 2AS maths class).
    select public.fn_finalize_class_placements(
               p_target_year_id := v_year_id,
               p_new_classes := '[]'::jsonb,
               p_updated_classes := '[]'::jsonb,
               p_student_assignments := jsonb_build_array(
                   jsonb_build_object('studentId', v_student_1, 'targetClassId', v_math_class_id, 'gradeLevel', '2eme_annee')
               ),
               p_actor_profile_id := null,
               p_actor_name := 'T-401 verify',
               p_tenant_id := v_tenant
           ) into v_result;

    insert into t401_results
    select 'C3b_restream_assignment_stamps_filiere',
           (v_result ->> 'assignedStudentsCount')::int = 1
           and s.filiere_code = 'mathematiques'
           and s.grade_level_code = '2eme_annee'
           and s.class_id = v_math_class_id,
           'student after assignment: filière=' || coalesce(s.filiere_code, 'NULL')
           || ' grade=' || s.grade_level_code
      from public.students s where s.id = v_student_1;

    -- C3c: new-class draft with a spécialité is created with the codes.
    select public.fn_finalize_class_placements(
               p_target_year_id := v_year_id,
               p_new_classes := jsonb_build_array(
                   jsonb_build_object(
                       'clientDraftId', 'draft-1',
                       'code', 'T401-TM-MEC',
                       'name', 'T401 Technique Mécanique',
                       'gradeCode', '2eme_annee',
                       'filiereCode', 'technique_mathematique',
                       'specialiteCode', 'genie_mecanique'
                   )
               ),
               p_updated_classes := '[]'::jsonb,
               p_student_assignments := '[]'::jsonb,
               p_actor_profile_id := null,
               p_actor_name := 'T-401 verify',
               p_tenant_id := v_tenant
           ) into v_result;

    insert into t401_results
    select 'C3c_tagged_draft_class_created',
           c.filiere_code = 'technique_mathematique'
           and c.specialite_code = 'genie_mecanique'
           and (v_result ->> 'createdClassesCount')::int = 1,
           'draft class filière=' || coalesce(c.filiere_code, 'NULL')
           || ' spécialité=' || coalesce(c.specialite_code, 'NULL')
      from public.classes c where c.code = 'T401-TM-MEC' and c.tenant_id = v_tenant;

    -- C3d: unknown filière code on a draft is rejected.
    begin
        perform public.fn_finalize_class_placements(
            p_target_year_id := v_year_id,
            p_new_classes := jsonb_build_array(
                jsonb_build_object('clientDraftId', 'draft-2', 'code', 'T401-BAD',
                                   'name', 'T401 Bad', 'gradeCode', '2eme_annee',
                                   'filiereCode', 'not_a_filiere')
            ),
            p_updated_classes := '[]'::jsonb,
            p_student_assignments := '[]'::jsonb,
            p_tenant_id := v_tenant
        );
        insert into t401_results values ('C3d_unknown_filiere_rejected', false, 'no exception raised (DEFECT)');
    exception when others then
        insert into t401_results values ('C3d_unknown_filiere_rejected',
            sqlstate = '23503', 'unknown filière raised ' || sqlstate);
    end;

    -- C3e: OLD-client payload (no filière keys at all) still works; the
    -- classification is derived SERVER-SIDE from the tagged class (the
    -- pre-0107 payload contract is fully preserved).
    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name,
                                 date_of_birth, grade_level_code, is_active)
    values (v_tenant, v_parent, 'ELV-T401-V3', 'Legacy', md5(random()::text), '2010-01-01', '2eme_annee', true)
    returning id into v_student_1;

    perform public.fn_finalize_class_placements(
        p_target_year_id := v_year_id,
        p_new_classes := '[]'::jsonb,
        p_updated_classes := '[]'::jsonb,
        p_student_assignments := jsonb_build_array(
            jsonb_build_object('studentId', v_student_1, 'targetClassId', v_math_class_id, 'gradeLevel', '2eme_annee')
        ),
        p_tenant_id := v_tenant
    );

    insert into t401_results
    select 'C3e_legacy_payload_ok',
           s.filiere_code = 'mathematiques' and s.class_id = v_math_class_id,
           'legacy client assignment into tagged class: filière derived from the class = ' || coalesce(s.filiere_code, 'NULL')
      from public.students s where s.id = v_student_1;

    -- ─── C4: execute_batch_promotion stamps classification into history ──
    perform public.execute_batch_promotion(
        p_decisions := jsonb_build_array(
            jsonb_build_object(
                'student_id', v_student_2,
                'decision', 'promoted',
                'next_grade_code', '3eme_annee',
                'academic_year', '2098-2099',
                'cycle', 'lycee',
                'grade_code', '2eme_annee',
                'grade_year', 2,
                'gpa', 14.5
            )
        ),
        p_actor_name := 'T-401 verify',
        p_tenant_id := v_tenant
    );

    insert into t401_results
    select 'C4a_history_stamped_with_filiere',
           h.filiere_code = 'mathematiques'
           and h.decision = 'promoted'
           and s.grade_level_code = '3eme_annee'
           and s.class_id is null,
           'history filière=' || coalesce(h.filiere_code, 'NULL')
           || ' student grade=' || s.grade_level_code
      from public.student_academic_histories h
      join public.students s on s.id = h.student_id
     where h.student_id = v_student_2 and h.academic_year = '2098-2099';

    -- ─── C5: upsert_student_from_import classification round-trip ────────
    insert into t401_results
    select 'C5a_import_sets_classification',
           s.filiere_code = 'sciences_experimentales',
           'import-set filière=' || coalesce(s.filiere_code, 'NULL')
      from public.upsert_student_from_import(
               p_tenant_id := v_tenant,
               p_student_code := 'ELV-T401-VERIFY',
               p_parent_id := v_parent::text,
               p_first_name := 'Import',
               p_last_name := 'Filiere',
               p_grade_level_code := '2eme_annee',
               p_filiere_code := 'sciences_experimentales'
           ) u
      join public.students s on s.id = u.out_student_id;

    -- NULL must preserve (an import that knows nothing about filière
    -- never erases it).
    insert into t401_results
    select 'C5b_import_null_preserves_classification',
           s.filiere_code = 'sciences_experimentales',
           'after NULL-param import: filière=' || coalesce(s.filiere_code, 'NULL')
      from public.upsert_student_from_import(
               p_tenant_id := v_tenant,
               p_student_code := 'ELV-T401-VERIFY',
               p_parent_id := v_parent::text,
               p_first_name := 'Import',
               p_last_name := 'Filiere',
               p_grade_level_code := '2eme_annee'
           ) u
      join public.students s on s.id = u.out_student_id;

    -- 'general' on an UPDATE means "not provided" — imports never erase a
    -- stored classification (the documented preserve rule). On an INSERT it
    -- stores NULL (untagged) rather than the literal 'general'.
    insert into t401_results
    select 'C5c_import_general_preserves_classification',
           s.filiere_code = 'sciences_experimentales',
           'after general-param import: filière=' || coalesce(s.filiere_code, 'NULL')
      from public.upsert_student_from_import(
               p_tenant_id := v_tenant,
               p_student_code := 'ELV-T401-VERIFY',
               p_parent_id := v_parent::text,
               p_first_name := 'Import',
               p_last_name := 'Filiere',
               p_grade_level_code := '2eme_annee',
               p_filiere_code := 'general'
           ) u
      join public.students s on s.id = u.out_student_id;
end
$verify$;

select check_id, ok, detail from t401_results order by check_id;

ROLLBACK;
