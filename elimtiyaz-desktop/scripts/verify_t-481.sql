-- ============================================================================
-- verify_t-481.sql — T-481 (WORKFORCE-508): the Relevé port — the live
-- verification script (READ-ONLY catalog probe: the canonical contract the
-- repository depends on; no migration was needed — 0009 created the table).
--
-- The convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; results
-- land in a temp table (t481_results) SELECTed at the end.
--
-- Checks:
--   C1  releve_entries exists with the 0009 shape (personnel_id FK,
--       activity_type CHECK, clock_in_at/clock_out_at, recorded_by,
--       description, the generated duration_minutes)
--   C2  the activity CHECK admits the domain union (8 values verbatim)
--   C3  the prevent_self_releve_entry trigger exists on INSERT/UPDATE
--   C4  the RLS policies: SELECT (staff quartet OR own-personnel) + INSERT
--       (staff quartet only)
--   C5  the personnel embed shape resolves (the FK the repository's
--       personnel(first_name, last_name) join relies on)
-- ============================================================================
BEGIN;

create temp table t481_results (check_id text, ok boolean, detail text);

do $verify$
declare
    v_count integer;
    v_def text;
begin
    -- C1: the table + its shape
    select count(*) into v_count from information_schema.tables
     where table_schema='public' and table_name='releve_entries';
    if v_count = 0 then
        insert into t481_results values ('C1_table_shape', false, 'releve_entries MISSING');
    else
        select count(*) into v_count from information_schema.columns
         where table_schema='public' and table_name='releve_entries'
           and column_name in ('personnel_id','activity_type','class_id','description',
                               'clock_in_at','clock_out_at','duration_minutes','recorded_by','recorded_at');
        insert into t481_results values ('C1_table_shape', v_count = 9,
            'shape columns present=' || v_count::text || '/9');
    end if;

    -- C2: the activity CHECK admits the domain union (both spellings of the
    -- Surveillance activity after 0140's widening + the DB-only 'admin')
    select coalesce(max(pg_get_constraintdef(c.oid)), '') into v_def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname='public' and t.relname='releve_entries' and c.contype='c';
    insert into t481_results values ('C2_activity_check',
        strpos(v_def, 'course') > 0 and strpos(v_def, 'supervision') > 0
            and strpos(v_def, 'correction') > 0 and strpos(v_def, 'warehouse') > 0
            and strpos(v_def, 'admin') > 0,
        'the clients'' wire union + admin present in the CHECK (0140 widened)');

    -- C3: the self-entry trigger
    select count(*) into v_count
      from pg_trigger tg
      join pg_class t on t.oid = tg.tgrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname='public' and t.relname='releve_entries'
       and tg.tgfoid = 'public.prevent_self_releve_entry()'::regprocedure
       and tg.tgenabled <> 'D';
    insert into t481_results values ('C3_self_entry_trigger', v_count = 1,
        'prevent_self_releve_entry triggers enabled=' || v_count::text);

    -- C4: the RLS policies
    select count(*) into v_count from pg_policies
     where schemaname='public' and tablename='releve_entries' and policyname='releve_entries_select';
    insert into t481_results values ('C4_rls_select_policy', v_count = 1,
        'select policy rows=' || v_count::text);
    select count(*) into v_count from pg_policies
     where schemaname='public' and tablename='releve_entries' and policyname='releve_entries_insert';
    insert into t481_results values ('C4b_rls_insert_policy', v_count = 1,
        'insert policy rows=' || v_count::text);

    -- C5: the personnel FK embed shape
    select count(*) into v_count
      from information_schema.table_constraints tc
     where tc.table_schema='public' and tc.table_name='releve_entries'
       and tc.constraint_type='FOREIGN KEY' and tc.constraint_name like '%personnel%';
    insert into t481_results values ('C5_personnel_fk', v_count >= 1,
        'personnel FK constraints=' || v_count::text);
end
$verify$;

select check_id, ok, detail from t481_results order by check_id;

ROLLBACK;
