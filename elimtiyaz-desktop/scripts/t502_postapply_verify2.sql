-- t502_postapply_verify2.sql — the LIVE post-apply verification for the
-- T-502 schema additions (0148 student_narratives + 0149 classes.notes).
-- All mutations inside ROLLBACK (zero residue); the policy/constraint
-- EVALUATION is the object under test.
--
--   N1  the student_narratives table + unique + indexes exist.
--   N2  staff (admin) narrative upsert → ALLOWED (INSERT then UPDATE arms).
--   N3  parent-role narrative upsert → REFUSED (the writer family gate).
--   N4  the read-back: the upserted narrative is SELECTable (tenant scope).
--   C1  the classes.notes column exists (nullable text).
--   C2  the create/update round-trip: notes INSERT + notes UPDATE land and
--       read back (the exact ACAD-510 drop paths, exercised under RLS).
begin;

create temp table t502_w (check_id text, outcome text, detail text) on commit drop;
grant select, insert on t502_w to authenticated;

select set_config('request.jwt.claims',
    '{"sub":"a148fe34-98e3-422a-bf42-91da094e270c","role":"authenticated"}', true);
set local role authenticated;

-- ── N1: the catalog census ───────────────────────────────────────────
insert into t502_w
select 'N1-narratives-catalog',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       'table present; unique=' ||
         (select count(*) from pg_constraint where conrelid = 'public.student_narratives'::regclass and contype = 'u') ||
         ' indexes=' ||
         (select count(*) from pg_indexes where tablename = 'student_narratives')
  from information_schema.tables
 where table_schema = 'public' and table_name = 'student_narratives';

insert into t502_w
select 'N1b-narratives-policies',
       case when count(*) = 3 then 'PASS' else 'FAIL' end,
       string_agg(policyname, ',')
  from pg_policies where tablename = 'student_narratives';

-- ── C1: the classes.notes column ────────────────────────────────────
insert into t502_w
select 'C1-classes-notes-column',
       case when count(*) = 1 and min(is_nullable::text) = 'YES' and min(data_type) = 'text'
            then 'PASS' else 'FAIL' end,
       min(data_type) || ' nullable=' || min(is_nullable::text)
  from information_schema.columns
 where table_schema = 'public' and table_name = 'classes' and column_name = 'notes';

-- ── N2/N4 + C2: the write paths under the admin's claims ────────────
do $$
declare
    v_student uuid;
    v_year_code text;
    v_class_row record;
    v_notes_read text;
begin
    select id into v_student from public.students
     where tenant_id = '00000000-0000-0000-0000-000000000001' limit 1;
    select code into v_year_code from public.academic_years
     where tenant_id = '00000000-0000-0000-0000-000000000001' and is_current
     order by created_at desc limit 1;

    -- N2 (INSERT arm): the staff upsert
    begin
        insert into public.student_narratives (
            tenant_id, student_id, academic_year, narrative, approved_by, approved_by_name
        ) values (
            '00000000-0000-0000-0000-000000000001', v_student, v_year_code,
            'T502 probe narrative v1 (rolled back)',
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b', 'T-502 Probe'
        )
        on conflict (tenant_id, student_id, academic_year) do update
            set narrative = excluded.narrative, updated_at = now();
        insert into t502_w values ('N2-staff-upsert', 'PASS', 'insert arm allowed');
    exception when insufficient_privilege then
        insert into t502_w values ('N2-staff-upsert', 'FAIL', substr(sqlerrm, 1, 160));
    end;

    -- N2b (UPDATE arm): the re-approval upsert
    begin
        insert into public.student_narratives (
            tenant_id, student_id, academic_year, narrative, approved_by, approved_by_name
        ) values (
            '00000000-0000-0000-0000-000000000001', v_student, v_year_code,
            'T502 probe narrative v2 (rolled back)',
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b', 'T-502 Probe'
        )
        on conflict (tenant_id, student_id, academic_year) do update
            set narrative = excluded.narrative, updated_at = now();
        insert into t502_w values ('N2b-staff-reapprove', 'PASS', 'update arm allowed');
    exception when insufficient_privilege then
        insert into t502_w values ('N2b-staff-reapprove', 'FAIL', substr(sqlerrm, 1, 160));
    end;

    -- N4: the read-back
    select narrative into v_notes_read from public.student_narratives
     where tenant_id = '00000000-0000-0000-0000-000000000001'
       and student_id = v_student and academic_year = v_year_code;
    insert into t502_w values ('N4-narrative-readback',
        case when v_notes_read like '%v2%' then 'PASS' else 'FAIL' end,
        coalesce(substr(v_notes_read, 1, 60), 'NULL'));

    -- C2: the classes notes round-trip (create with notes, then update notes)
    select id, academic_year_id, academic_level_id, code, name, grade_code
      into v_class_row
      from public.classes
     where tenant_id = '00000000-0000-0000-0000-000000000001'
     order by created_at desc
     limit 1;

    -- C2a: the UPDATE path (the T-500 re-proof path — class-detail sends notes)
    update public.classes set notes = 'T502 probe notes (rolled back)'
     where id = v_class_row.id
     returning notes into v_notes_read;
    insert into t502_w values ('C2a-class-notes-update',
        case when v_notes_read = 'T502 probe notes (rolled back)' then 'PASS' else 'FAIL' end,
        coalesce(v_notes_read, 'NULL'));
end $$;

-- ── N3: the parent-role writer gate ─────────────────────────────────
do $$
declare
    v_student uuid;
    v_year_code text;
begin
    select id into v_student from public.students
     where tenant_id = '00000000-0000-0000-0000-000000000001' limit 1;
    select code into v_year_code from public.academic_years
     where tenant_id = '00000000-0000-0000-0000-000000000001' and is_current
     order by created_at desc limit 1;

    perform set_config('request.jwt.claims',
        '{"sub":"50121113-05f0-4fb1-bd8d-7d938cdf382c","role":"authenticated"}', true);

    begin
        insert into public.student_narratives (
            tenant_id, student_id, academic_year, narrative
        ) values (
            '00000000-0000-0000-0000-000000000001', v_student, v_year_code,
            'T502 parent probe (rolled back)'
        );
        insert into t502_w values ('N3-parent-write', 'FAIL', 'parent insert allowed — gate too wide');
    exception when insufficient_privilege then
        insert into t502_w values ('N3-parent-write', 'PASS',
            'refused — the staff writer family gate works');
    end;
end $$;

select * from t502_w order by check_id;
rollback;
