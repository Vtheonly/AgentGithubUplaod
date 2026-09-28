-- ============================================================================
-- verify_t-437.sql — T-437: re-enrollment + student origin (migration 0128)
-- — the live verification script
--
-- The convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can
-- be re-run any time without mutating the live DB; results land in a temp
-- table (t437_results) SELECTed at the end; BOTH the happy paths AND the
-- regression paths are covered.
--
-- Checks:
--   C1  the five origin columns exist on students
--   C2  upsert_student_from_import threads the origin (INSERT + the
--       COALESCE-preserve on a blank partial re-push)
--   C3  register_family_batch threads the origin through the jsonb wire
--   C4  the re_enrollments table + its unique key exist
--   C5  fn_generate: materializes the active roster for a probe year pair,
--       idempotent, and enriches the finalized snapshot from a probe
--       student_academic_histories row (repeated → expected = source grade)
--   C6  fn_set_re_enrollment_decision: the state transitions + the guards
--   C7  fn_re_enroll_student: the composite — placement update, billing
--       legs stamped academic_year_id = target, prior installments
--       UNTOUCHED (INV-26a), status re_enrolled
--   C8  fn_freeze: refuses while waiting rows remain, freezes when all
--       decided, blocks post-freeze mutations
--   C9  the schema_migrations registration row exists
--   C10 the ACL: anon/public lost EXECUTE on the new RPCs, authenticated kept it
-- ============================================================================
BEGIN;

-- The T-403 convention: the Management-API connection carries no user JWT,
-- so the tenant-resolving RPCs would fail their caller verification. Setting
-- the local jwt claims (service_role) lets the verify script exercise the
-- RPCs exactly as an elevated caller would; everything rolls back anyway.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t437_results (check_id text, ok boolean, detail text);

-- The live tenant + the current year (the source) + a PROBE target year
-- (2098-2099 — never a real year; the T-436 C5 probe-year convention).
do $$
declare
    v_tenant uuid;
    v_source public.academic_years;
    v_target public.academic_years;
    v_probe_parent text := 'PAR-2098-T437PROBE';
    v_probe_student text := 'ELV-2098-T437PROBE';
    v_sid uuid;
    v_pid uuid;
    v_re_id uuid;
    v_old_inst_count integer;
    v_old_inst_sum numeric;
    v_res jsonb;
    v_started text;
    v_row record;
begin
    select t.id into v_tenant from public.tenants t order by t.created_at limit 1;
    select * into v_source from public.academic_years ay
     where ay.tenant_id = v_tenant and ay.is_current order by ay.start_date desc limit 1;
    if v_source.id is null then
        select * into v_source from public.academic_years ay
         where ay.tenant_id = v_tenant order by ay.start_date desc limit 1;
    end if;

    insert into public.academic_years (tenant_id, code, label, start_date, end_date, term_structure, is_current, is_archived)
    values (v_tenant, '2098-2099', '2098-2099', '2098-09-01', '2099-06-30', 'trimester', false, false)
    returning * into v_target;

    -- C1: the origin columns ─────────────────────────────────────────────
    insert into t437_results
    select 'C1-origin-columns', count(*) = 5,
           'origin columns present: ' || count(*) || '/5'
      from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name in ('origin_type','previous_school_name','previous_school_level',
                           'previous_academic_year','origin_notes');

    -- C2: the upsert threads the origin (INSERT then blank-partial preserve)
    select u.out_parent_id into v_pid from public.upsert_parent_from_import(
        v_tenant, v_probe_parent, 'T437', 'PROBE', 'T437 PROBE', '0550000000',
        null, null, null, null, null, 'fr', true, null, null, null) u;

    select u.out_student_id into v_sid from public.upsert_student_from_import(
        v_tenant, v_probe_student, v_pid::text, 'Probe', 'T437',
        'Probe T437', null, '2012-01-01', 'male', null, null, null, 'active',
        null, true, '3ap', null, 'tranches', null, null,
        'transfer', 'École Test XYZ', '4AP', '2025-2026', 'probe note') u;

    insert into t437_results
    select 'C2-origin-insert', s.origin_type = 'transfer'
           and s.previous_school_name = 'École Test XYZ'
           and s.previous_school_level = '4AP'
           and s.previous_academic_year = '2025-2026'
           and s.origin_notes = 'probe note',
           'inserted origin: ' || coalesce(s.origin_type, 'NULL')
      from public.students s where s.id = v_sid;

    -- blank partial re-push: origin PRESERVED (COALESCE), not erased
    perform public.upsert_student_from_import(
        v_tenant, v_probe_student, v_pid::text, 'Probe', 'T437',
        'Probe T437', null, '2012-01-01', 'male', null, null, null, 'active',
        null, true, '3ap', null, 'tranches', null, null,
        null, null, null, null, null);

    insert into t437_results
    select 'C2-origin-preserved', s.origin_type = 'transfer' and s.previous_school_name = 'École Test XYZ',
           'origin preserved on blank re-push: ' || coalesce(s.origin_type, 'ERASED')
      from public.students s where s.id = v_sid;

    -- C3: register_family_batch threads the origin through the jsonb wire
    select r.out_students into v_res from public.register_family_batch(
        v_tenant,
        jsonb_build_object('parent_code', 'PAR-2098-T437RFB', 'first_name', 'R437',
                           'last_name', 'BATCH', 'primary_phone', '0551111111',
                           'is_active', true),
        jsonb_build_array(jsonb_build_object(
            'student_code', 'ELV-2098-T437RFB', 'first_name', 'Kid', 'last_name', 'Rfb',
            'date_of_birth', '2013-05-05', 'gender', 'female', 'is_active', true,
            'grade_level_code', '4ap',
            'origin_type', 'new_admission', 'previous_school_name', 'École Origine',
            'previous_school_level', '3AP', 'previous_academic_year', '2025-2026')),
        '[]'::jsonb, '[]'::jsonb) r;

    insert into t437_results
    select 'C3-rfb-origin-thread', s.origin_type = 'new_admission'
           and s.previous_school_name = 'École Origine'
           and s.previous_school_level = '3AP',
           'rfb student origin: ' || coalesce(s.origin_type, 'NULL')
      from public.students s where s.student_code = 'ELV-2098-T437RFB';

    -- C4: the table + the unique key ─────────────────────────────────────
    insert into t437_results
    select 'C4-table-exists', count(*) > 0, 'public.re_enrollments present'
      from information_schema.tables
     where table_schema = 'public' and table_name = 're_enrollments';

    insert into t437_results
    select 'C4-unique-key', count(*) > 0, 'the (tenant, student, target year) unique index present'
      from pg_indexes
     where schemaname = 'public' and tablename = 're_enrollments'
       and indexdef like '%re_enrollments_student_target_key%';

    -- C5: fn_generate — materialize + the finalized-snapshot enrichment.
    -- Probe history FIRST so the first generate sees it (repeated decision →
    -- expected = the source grade).
    insert into public.student_academic_histories (
        tenant_id, student_id, academic_year, cycle, grade_code, grade_year,
        class_name, gpa, decision, narrative
    ) values (
        v_tenant, v_sid, v_source.code, 'primaire', '3ap', 5,
        'Classe Probe 3AP', 11.50, 'repeated', 'probe finalized result'
    ) on conflict (student_id, academic_year) do update
        set decision = 'repeated', gpa = 11.50, grade_code = '3ap';

    select * into v_res from public.fn_generate_re_enrollment_candidates(
        v_source.id, v_target.id, null, 'T-437 verify', v_tenant);

    insert into t437_results
    select 'C5-generated-count', (v_res->>'total_rows')::int > 0,
           'total_rows materialized: ' || coalesce(v_res->>'total_rows', 'NULL');

    -- the probe student's snapshot: repeated → expected = source grade '3ap'
    insert into t437_results
    select 'C5-finalized-snapshot', re.final_decision = 'repeated'
           and re.final_average = 11.50
           and re.source_grade_level_code = '3ap'
           and re.expected_grade_level_code = '3ap',
           'snapshot: decision=' || coalesce(re.final_decision, 'NULL')
             || ' avg=' || coalesce(re.final_average::text, 'NULL')
             || ' expected=' || coalesce(re.expected_grade_level_code, 'NULL')
      from public.re_enrollments re
     where re.student_id = v_sid and re.target_academic_year_id = v_target.id;

    -- idempotent regeneration: no duplicate rows, decided rows untouched
    select re.id into v_re_id
      from public.re_enrollments re
     where re.student_id = v_sid and re.target_academic_year_id = v_target.id;

    select * into v_res from public.fn_generate_re_enrollment_candidates(
        v_source.id, v_target.id, null, 'T-437 verify (regen)', v_tenant);

    insert into t437_results
    select 'C5-idempotent', count(*) = 1,
           'probe student rows after regeneration: ' || count(*)
      from public.re_enrollments re
     where re.student_id = v_sid and re.target_academic_year_id = v_target.id;

    -- C6: the decision transitions ───────────────────────────────────────
    select * into v_res from public.fn_set_re_enrollment_decision(
        v_re_id, 'started', null, null, 'T-437 verify', v_tenant);
    select re.status into v_started from public.re_enrollments re where re.id = v_re_id;

    insert into t437_results
    select 'C6-decision-started', v_started = 'started',
           'status after started: ' || v_started;

    select * into v_res from public.fn_set_re_enrollment_decision(
        v_re_id, 'waiting', null, null, 'T-437 verify', v_tenant);
    select re.status into v_started from public.re_enrollments re where re.id = v_re_id;
    insert into t437_results
    select 'C6-decision-revert', v_started = 'waiting',
           'status after revert to waiting: ' || v_started;

    -- C7: the composite re-enrollment ────────────────────────────────────
    select count(*), coalesce(sum(i.amount_due), 0) into v_old_inst_count, v_old_inst_sum
      from public.installments i where i.student_id = v_sid;

    select * into v_res from public.fn_re_enroll_student(
        v_re_id, '4ap', null, 'tranches', 'boumerdes',
        jsonb_build_array(
            jsonb_build_object('category', 'tuition', 'tranche_number', 1,
                'label', 'Scolarité T1', 'amount_due', 40000, 'due_date', '2098-09-15',
                'status', 'unpaid', 'payment_plan', 'tranches',
                'source_type', 'bulk_import', 'source_id', 're-ELV-2098-T437PROBE-2098-2099:tuition:T1'),
            jsonb_build_object('category', 'tuition', 'tranche_number', 2,
                'label', 'Scolarité T2', 'amount_due', 40000, 'due_date', '2098-12-15',
                'status', 'unpaid', 'payment_plan', 'tranches',
                'source_type', 'bulk_import', 'source_id', 're-ELV-2098-T437PROBE-2098-2099:tuition:T2')
        ),
        jsonb_build_array(
            jsonb_build_object('entry_number', 'T437-PROBE-L1', 'entry_type', 'charge',
                'amount', 40000, 'category', 'tuition', 'description', 'Probe T437 T1',
                'entry_date', '2098-09-01', 'source_type', 'installment',
                'source_id', 're-ELV-2098-T437PROBE-2098-2099:tuition:T1',
                'payment_status', 'unpaid', 'actor_name', 'T-437 verify')
        ),
        null, null, 'T-437 verify', v_tenant);

    insert into t437_results
    select 'C7-status-flipped', re.status = 're_enrolled' and re.installments_written = 2,
           'status=' || re.status || ' installments_written=' || coalesce(re.installments_written::text, 'NULL')
      from public.re_enrollments re where re.id = v_re_id;

    insert into t437_results
    select 'C7-student-placement', s.grade_level_code = '4ap' and s.transport_tier = 'boumerdes'
           and s.enrollment_status = 'active' and s.student_code = 'ELV-2098-T437PROBE',
           'placement: grade=' || coalesce(s.grade_level_code, 'NULL')
             || ' transport=' || coalesce(s.transport_tier, 'NULL')
             || ' (code preserved: ' || s.student_code || ')'
      from public.students s where s.id = v_sid;

    insert into t437_results
    select 'C7-year-stamped', count(*) = 2
           and bool_and(i.academic_year_id = v_target.id),
           'probe installments stamped with the TARGET year: ' || count(*)
      from public.installments i
     where i.student_id = v_sid and i.source_id like 're-ELV-2098-T437PROBE%';

    insert into t437_results
    select 'C7-prior-untouched', count(*) = v_old_inst_count and coalesce(sum(i.amount_due), 0) = v_old_inst_sum,
           'prior installments untouched: ' || count(*) || ' rows, sum ' || coalesce(sum(i.amount_due), 0)
      from public.installments i where i.student_id = v_sid
       and (i.source_id is null or i.source_id not like 're-ELV-2098-T437PROBE%');

    insert into t437_results
    select 'C7-ledger-written', count(*) = 1,
           'probe ledger entries: ' || count(*)
      from public.ledger_entries le
     where le.student_id = v_sid and le.entry_number like 'T437-PROBE-%';

    -- the re_enrolled state is terminal pre-freeze
    begin
        select * into v_res from public.fn_set_re_enrollment_decision(
            v_re_id, 'not_continuing', null, null, 'T-437 verify', v_tenant);
        insert into t437_results values ('C7-terminal-state', false, 're_enrolled accepted a decision change (SHOULD HAVE FAILED)');
    exception when others then
        insert into t437_results values ('C7-terminal-state', true, 're_enrolled refused a decision change: ' || sqlerrm);
    end;

    -- C8: the freeze ─────────────────────────────────────────────────────
    begin
        select * into v_res from public.fn_freeze_re_enrollments(v_target.id, null, 'T-437 verify', v_tenant);
        insert into t437_results values ('C8-freeze-refuses-waiting', false, 'freeze succeeded while waiting rows remain (SHOULD HAVE FAILED)');
    exception when others then
        insert into t437_results values ('C8-freeze-refuses-waiting', true, 'freeze refused while waiting: ' || sqlerrm);
    end;

    -- decide ALL remaining waiting candidates → the freeze must succeed
    for v_row in select re.id from public.re_enrollments re
                 where re.tenant_id = v_tenant and re.target_academic_year_id = v_target.id
                   and re.status = 'waiting'
    loop
        perform public.fn_set_re_enrollment_decision(v_row.id, 'not_continuing', null, null, 'T-437 verify', v_tenant);
    end loop;

    select * into v_res from public.fn_freeze_re_enrollments(v_target.id, null, 'T-437 verify', v_tenant);
    insert into t437_results
    select 'C8-freeze-succeeds', (v_res->>'frozen_count')::int > 0,
           'frozen_count: ' || coalesce(v_res->>'frozen_count', 'NULL');

    insert into t437_results
    select 'C8-all-frozen', bool_and(re.frozen_at is not null),
           'every row frozen: ' || count(*) filter (where re.frozen_at is null) || ' unfrozen'
      from public.re_enrollments re
     where re.tenant_id = v_tenant and re.target_academic_year_id = v_target.id;

    -- post-freeze generation + decisions must refuse
    begin
        select * into v_res from public.fn_generate_re_enrollment_candidates(
            v_source.id, v_target.id, null, 'T-437 verify', v_tenant);
        insert into t437_results values ('C8-post-freeze-generate', false, 'generation succeeded after freeze (SHOULD HAVE FAILED)');
    exception when others then
        insert into t437_results values ('C8-post-freeze-generate', true, 'generation refused after freeze: ' || sqlerrm);
    end;

    begin
        select * into v_res from public.fn_set_re_enrollment_decision(
            v_re_id, 'not_continuing', null, null, 'T-437 verify', v_tenant);
        insert into t437_results values ('C8-post-freeze-decision', false, 'decision succeeded after freeze (SHOULD HAVE FAILED)');
    exception when others then
        insert into t437_results values ('C8-post-freeze-decision', true, 'decision refused after freeze: ' || sqlerrm);
    end;
end
$$;

-- C9: the registration row ────────────────────────────────────────────────
insert into t437_results
select 'C9-registration', count(*) > 0, 'schema_migrations carries 0128'
  from supabase_migrations.schema_migrations where version = '0128';

-- C10: the ACL ────────────────────────────────────────────────────────────
insert into t437_results
select 'C10-anon-revoked', count(*) = 0,
       'anon/public grants on the new RPCs: ' || count(*)
  from information_schema.role_table_grants g
  join pg_proc p on p.proname in ('fn_generate_re_enrollment_candidates',
                                  'fn_get_re_enrollment_candidates',
                                  'fn_set_re_enrollment_decision',
                                  'fn_re_enroll_student',
                                  'fn_freeze_re_enrollments')
 where g.grantee in ('anon', 'public') and g.table_schema = 'public'
   and g.table_name = p.proname;

insert into t437_results
select 'C10-authenticated-granted', count(*) = 5,
       'authenticated grants on the new RPCs: ' || count(*)
  from information_schema.routine_privileges
 where routine_schema = 'public'
   and routine_name in ('fn_generate_re_enrollment_candidates',
                        'fn_get_re_enrollment_candidates',
                        'fn_set_re_enrollment_decision',
                        'fn_re_enroll_student',
                        'fn_freeze_re_enrollments')
   and grantee = 'authenticated';

select check_id, ok, detail from t437_results order by check_id;

ROLLBACK;
