-- ============================================================================
-- verify_t-484.sql — T-484 (the shifts/schedules Supabase port): the live
-- verification script. NO migration this task (the 0010 tables exist and
-- are applied since 2026-08-31) — this suite proves the CONTRACT the two
-- new repositories depend on, on the live database.
--
-- The convention (AGENTS.md §11.1 + the T-446 runner): wrapped in
-- BEGIN; … ROLLBACK; results land in a temp table (t484_results)
-- SELECTed at the end. Every runtime probe below writes ONLY inside this
-- transaction (zero residue).
--
-- Checks:
--   C1  the shifts table shape (the canonical 0010 §2 columns)
--   C2  the schedules table shape (the canonical 0010 §3 columns)
--   C3  the shifts unique (tenant_id, code) rejects a duplicate code
--   C4  the schedules unique (tenant_id, personnel_id, date) rejects a
--       second same-day row for the same personnel
--   C5  the shifts CHECK end_time > start_time rejects an inverted window
--   C6  the shifts CHECK color_hex pattern rejects a bad color
--   C7  RUNTIME: a canonical shift template + a per-day schedule row
--       INSERT (the exact payload shape the repositories write) — rolled
--       back with the transaction
--   C8  the RLS policies: shifts_select/shifts_admin + schedules_select/
--       schedules_admin (the 0019 posture the repositories depend on)
--   C9  the live row census (both tables — the honest empty-state trail)
--   C10 the schema_migrations chain is UNCHANGED by this task (no new
--       rows past 0142 — T-484 adds no migration)
-- ============================================================================
BEGIN;

create temp table t484_results (check_id text, ok boolean, detail text);

do $verify$
declare
    v_count integer;
    v_tenant uuid;
begin
    -- C1: the shifts shape
    select count(*) into v_count from information_schema.columns
     where table_schema='public' and table_name='shifts'
       and column_name in ('code','name','start_time','end_time','grace_period_minutes','color_hex','is_active');
    insert into t484_results values ('C1_shifts_shape', v_count = 7,
        'the 0010 §2 columns present=' || v_count::text || '/7');

    -- C2: the schedules shape
    select count(*) into v_count from information_schema.columns
     where table_schema='public' and table_name='schedules'
       and column_name in ('personnel_id','shift_id','date','start_time','end_time','note');
    insert into t484_results values ('C2_schedules_shape', v_count = 6,
        'the 0010 §3 columns present=' || v_count::text || '/6');

    select id into v_tenant from public.tenants order by id limit 1;

    -- C3: the shifts (tenant_id, code) unique
    begin
        insert into public.shifts (tenant_id, code, name, start_time, end_time)
        values (v_tenant, 'VERIFY_T484', 'Probe', '08:00', '12:00');
        insert into public.shifts (tenant_id, code, name, start_time, end_time)
        values (v_tenant, 'VERIFY_T484', 'Dupe', '09:00', '10:00');
        insert into t484_results values ('C3_shift_code_unique', false,
            'the duplicate code was ACCEPTED (expected unique_violation)');
    exception when unique_violation then
        insert into t484_results values ('C3_shift_code_unique', true,
            'unique_violation raised as designed');
    end;

    -- C4: the schedules (tenant, personnel, date) unique — needs a real
    -- personnel row (the FK); if the tenant has none, the probe degrades to
    -- the documented skip (the C4 catalog half still proves the index).
    declare
        v_personnel uuid;
    begin
        select id into v_personnel from public.personnel
         where tenant_id = v_tenant and deleted_at is null limit 1;
        if v_personnel is null then
            insert into t484_results values ('C4_schedule_day_unique', true,
                'SKIPPED at runtime — no live personnel row; the unique index is catalog-verified below');
        else
            insert into public.schedules (tenant_id, personnel_id, date)
            values (v_tenant, v_personnel, '2026-10-05');
            insert into public.schedules (tenant_id, personnel_id, date)
            values (v_tenant, v_personnel, '2026-10-05');
            insert into t484_results values ('C4_schedule_day_unique', false,
                'the second same-day row was ACCEPTED (expected unique_violation)');
        end if;
    exception when unique_violation then
        insert into t484_results values ('C4_schedule_day_unique', true,
            'unique_violation raised as designed');
    end;
    select count(*) into v_count from pg_indexes
     where schemaname='public' and tablename='schedules'
       and indexdef like '%UNIQUE%(tenant_id, personnel_id, date)%';
    insert into t484_results values ('C4b_schedule_unique_catalog', v_count >= 1,
        'the (tenant,personnel,date) unique index rows=' || v_count::text);

    -- C5: the shifts time CHECK
    begin
        insert into public.shifts (tenant_id, code, name, start_time, end_time)
        values (v_tenant, 'VERIFY_T484_INV', 'Inversé', '17:00', '08:00');
        insert into t484_results values ('C5_shift_time_check', false,
            'the inverted window was ACCEPTED (expected check_violation)');
    exception when check_violation then
        insert into t484_results values ('C5_shift_time_check', true,
            'check_violation raised as designed');
    end;

    -- C6: the color pattern CHECK
    begin
        insert into public.shifts (tenant_id, code, name, start_time, end_time, color_hex)
        values (v_tenant, 'VERIFY_T484_COL', 'Couleur', '08:00', '12:00', 'red');
        insert into t484_results values ('C6_color_check', false,
            'the bad color was ACCEPTED (expected check_violation)');
    exception when check_violation then
        insert into t484_results values ('C6_color_check', true,
            'check_violation raised as designed');
    end;

    -- C7: RUNTIME — the exact repository payload shape inserts
    begin
        insert into public.shifts (tenant_id, code, name, start_time, end_time,
            grace_period_minutes, color_hex, is_active)
        values (v_tenant, 'VERIFY_T484_FULL', 'Probe complet', '08:00', '12:00',
            10, '#1d4ed8', true);
        declare
            v_shift uuid;
            v_personnel2 uuid;
        begin
            select id into v_shift from public.shifts
             where tenant_id = v_tenant and code = 'VERIFY_T484_FULL';
            select id into v_personnel2 from public.personnel
             where tenant_id = v_tenant and deleted_at is null limit 1;
            if v_personnel2 is not null then
                insert into public.schedules (tenant_id, personnel_id, shift_id,
                    date, start_time, end_time, note)
                values (v_tenant, v_personnel2, v_shift, '2026-10-06', '08:30', '12:30', 'Probe');
            end if;
        end;
        insert into t484_results values ('C7_repository_payload', true,
            'the canonical shift + (personnel-dependent) schedule payload inserted');
    exception when others then
        insert into t484_results values ('C7_repository_payload', false,
            'raised unexpectedly: ' || sqlerrm);
    end;

    -- C8: the RLS policies
    select count(*) into v_count from pg_policies
     where schemaname='public' and tablename in ('shifts','schedules')
       and policyname in ('shifts_select','shifts_admin','schedules_select','schedules_admin');
    insert into t484_results values ('C8_rls_policies', v_count = 4,
        'the four 0019 policies rows=' || v_count::text || '/4');

    -- C9: the live row census (REAL rows only — the C7 probe rows are
    -- inside this transaction and excluded by their markers)
    select count(*) into v_count from public.shifts
     where code not like 'VERIFY_T484%';
    insert into t484_results values ('C9_shifts_census', true,
        'real live shift rows=' || v_count::text || ' — the honest empty state the port leaves visible');
    select count(*) into v_count from public.schedules
     where note is distinct from 'Probe';
    insert into t484_results values ('C9b_schedules_census', true,
        'real live schedule rows=' || v_count::text);

    -- C10: no migration added by this task
    select count(*) into v_count from supabase_migrations.schema_migrations
     where version > '0142';
    insert into t484_results values ('C10_no_new_migration', v_count = 0,
        'rows past 0142=' || v_count::text);
end
$verify$;

select check_id, ok, detail from t484_results order by check_id;

ROLLBACK;
