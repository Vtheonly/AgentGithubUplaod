-- ============================================================================
-- verify_t-236.sql — T-236 / RBAC-302 verification (35th session).
--
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can be
-- re-run any time without mutating the live DB. Results land in the
-- t236_results temp table (the CLI does not surface RAISE NOTICE output).
--
-- Covers the happy paths AND the regression paths:
--   C1. students_update: teacher ABSENT from the role list.
--   C2. students_select: staff tenant-wide branch present; the teacher
--       branch is scoped (homeroom_teacher_id + class_subjects subqueries
--       through personnel.user_id).
--   C3. parents_select: teacher ABSENT; the four administrative roles kept.
--   C4. assessments_select: 0041's parent/student self branches preserved;
--       teacher branch scoped through personnel.
--   C5. The policies NOT touched by 0083 are unchanged (spot checks:
--       students_insert, students_parent_sees_own, parents_insert).
--   C6. Registration row 0083 exists in supabase_migrations.schema_migrations.
--
-- NOTE (AGENTS.md §11.1 quirk 9): no '' escapes in top-level LIKE patterns —
-- checks use position(… in …) with quote-free substrings instead.
-- Behavioral probes with REAL teacher/admin JWTs run in T-241
-- (docs/recovery/t-241-live-verification.md).
-- ============================================================================
begin;

create temp table t236_results (check_id text, ok boolean, detail text);

-- C1: students_update drops 'teacher'
insert into t236_results
select 'C1 students_update teacher absent',
       position('teacher' in p.qual) = 0,
       left(p.qual, 160)
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'students'
   and p.policyname = 'students_update';

-- C1b: students_update keeps the administrative trio
insert into t236_results
select 'C1b students_update admin roles kept',
       position('super_admin' in p.qual) > 0
         and position('financial_officer' in p.qual) > 0
         and position('support_staff' in p.qual) > 0,
       left(p.qual, 160)
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'students'
   and p.policyname = 'students_update';

-- C2: students_select teacher branch scoped
insert into t236_results
select 'C2 students_select teacher scoped',
       position('teacher' in p.qual) > 0
         and position('homeroom_teacher_id' in p.qual) > 0
         and position('class_subjects' in p.qual) > 0
         and position('personnel' in p.qual) > 0,
       left(p.qual, 200)
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'students'
   and p.policyname = 'students_select';

-- C2b: students_select administrative roles keep tenant-wide reads
insert into t236_results
select 'C2b students_select admin branch intact',
       position('super_admin' in p.qual) > 0
         and position('financial_officer' in p.qual) > 0
         and position('support_staff' in p.qual) > 0
         and position('manager' in p.qual) > 0,
       left(p.qual, 200)
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'students'
   and p.policyname = 'students_select';

-- C3: parents_select teacher absent + admin roles kept
insert into t236_results
select 'C3 parents_select teacher absent, admins kept',
       position('teacher' in p.qual) = 0
         and position('super_admin' in p.qual) > 0
         and position('financial_officer' in p.qual) > 0
         and position('support_staff' in p.qual) > 0
         and position('manager' in p.qual) > 0,
       left(p.qual, 160)
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'parents'
   and p.policyname = 'parents_select';

-- C4: assessments_select — parent/student self branches preserved + teacher scoped
insert into t236_results
select 'C4 assessments_select branches preserved + teacher scoped',
       position('teacher' in p.qual) > 0
         and position('personnel' in p.qual) > 0
         and position('homeroom_teacher_id' in p.qual) > 0
         and position('class_subjects' in p.qual) > 0
         and position('p.auth_user_id = auth.uid()' in p.qual) > 0
         and position('s.auth_user_id = auth.uid()' in p.qual) > 0,
       left(p.qual, 200)
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'assessments'
   and p.policyname = 'assessments_select';

-- C5: untouched policies spot checks. students_insert/parents_insert are
-- FOR INSERT policies — their expression lives in with_check (pg_policies
-- .qual is NULL for insert-only policies — live evidence 35th session).
insert into t236_results
select 'C5a students_insert unchanged (super_admin+support_staff)',
       position('super_admin' in p.with_check) > 0
         and position('support_staff' in p.with_check) > 0,
       left(p.with_check, 120)
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'students'
   and p.policyname = 'students_insert';

insert into t236_results
select 'C5b students_parent_sees_own unchanged',
       position('parent' in p.qual) > 0
         and position('auth_user_id = auth.uid()' in p.qual) > 0,
       left(p.qual, 120)
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'students'
   and p.policyname = 'students_parent_sees_own';

insert into t236_results
select 'C5c parents_insert unchanged',
       position('super_admin' in p.with_check) > 0
         and position('support_staff' in p.with_check) > 0,
       left(p.with_check, 120)
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'parents'
   and p.policyname = 'parents_insert';

-- C6: registration row
insert into t236_results
select 'C6 migration 0083 registered',
       count(*) = 1,
       'rows: ' || count(*)
  from supabase_migrations.schema_migrations
 where version = '0083';

select check_id, ok, detail from t236_results order by check_id;

rollback;
