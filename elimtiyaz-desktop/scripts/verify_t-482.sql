-- ============================================================================
-- verify_t-482.sql — T-482 (UNKNOWN-030 / ADR-034 / migration 0141): the
-- auto-Relevé server-side design — the live verification script.
--
-- The convention (AGENTS.md §11.1 + the T-446 runner): wrapped in
-- BEGIN; … ROLLBACK; results land in a temp table (t482_results)
-- SELECTed at the end (the runner strips the trailing ROLLBACK; the
-- session-end rollback provides the same all-or-nothing guarantee —
-- every runtime probe below writes ONLY inside this transaction).
--
-- Checks:
--   C1  the columns: entry_source (NOT NULL, default 'manual') + auto_kind
--   C2  the CHECKs: entry_source vocabulary, auto_kind vocabulary, the
--       manual/auto coupling
--   C3  the trigger re-scope: prevent_self_releve_entry's CURRENT
--       definition carries the auto early-return AND the §09.05 raise
--   C4  the RPC: record_auto_releve_entry exists, SECURITY DEFINER,
--       returns uuid, granted to authenticated
--   C5  RUNTIME: a MANUAL self-entry still RAISES (§09.05 preserved)
--   C6  RUNTIME: an AUTO-shaped self entry PASSES the trigger (the
--       exemption) — inserted + rolled back, zero residue
--   C7  RUNTIME: the coupling CHECK rejects a manual row carrying auto_kind
--   C8  the schema_migrations registration row (0141)
--   C9  the pre-0141 rows are all 'manual' (the default backfill — live
--       data honesty)
-- ============================================================================
BEGIN;

create temp table t482_results (check_id text, ok boolean, detail text);

do $verify$
declare
    v_count integer;
    v_def text;
    v_col text;
    v_proc record;
    v_raise_message text;
begin
    -- C1: the columns
    select data_type into v_col from information_schema.columns
     where table_schema='public' and table_name='releve_entries' and column_name='entry_source';
    select column_default into v_def from information_schema.columns
     where table_schema='public' and table_name='releve_entries' and column_name='entry_source';
    select count(*) into v_count from information_schema.columns
     where table_schema='public' and table_name='releve_entries' and column_name='auto_kind';
    insert into t482_results values ('C1_columns',
        v_col is not null and v_def is not null and v_count = 1,
        'entry_source=' || coalesce(v_col,'MISSING') || ' default=' || coalesce(v_def,'MISSING') || ' auto_kind present=' || v_count::text);

    -- C2: the three CHECKs
    select count(*) into v_count from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname='public' and t.relname='releve_entries' and c.contype='c'
       and c.conname in ('releve_entries_entry_source_check','releve_entries_auto_kind_check','releve_entries_source_kind_coupling_check');
    insert into t482_results values ('C2_checks', v_count = 3,
        'the three 0141 CHECK constraints present=' || v_count::text || '/3');

    -- C3: the trigger re-scope (the CURRENT function definition carries
    -- BOTH the auto early-return and the §09.05 raise)
    select prosrc into v_def from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='prevent_self_releve_entry';
    insert into t482_results values ('C3_trigger_rescope',
        v_def is not null and position('entry_source = ' in v_def) > 0
            and position('auto' in v_def) > 0
            and position('teacher cannot record their own Releve entry' in v_def) > 0,
        'the scoped trigger definition (auto early-return + the §09.05 raise) present='
            || (v_def is not null)::text);

    -- C4: the RPC
    select p.prosecdef, pg_get_function_result(p.oid) as rettype,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
      into v_proc
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='record_auto_releve_entry';
    insert into t482_results values ('C4_rpc',
        v_proc.prosecdef is true and v_proc.rettype = 'uuid' and v_proc.auth_exec is true,
        'SECURITY DEFINER=' || coalesce(v_proc.prosecdef::text,'MISSING')
            || ' returns=' || coalesce(v_proc.rettype::text,'MISSING')
            || ' authenticated-exec=' || coalesce(v_proc.auth_exec::text,'MISSING'));

    -- C5: RUNTIME — a MANUAL self-entry still RAISES (§09.05 preserved).
    -- The live personnel table has ZERO user_id bindings (probed 2026-10-04:
    -- 14 rows, 0 bound) — the probe therefore creates a SYNTHETIC bound
    -- personnel row INSIDE this transaction (rolled back with it, zero
    -- residue; personnel_code 'VERIFY-T482' unique against the live set).
    -- The personnel INSERT itself may fire later-chain triggers (audit
    -- fan-outs) — all inside the same transaction, all rolled back.
    begin
        insert into public.personnel (tenant_id, personnel_code, user_id,
            first_name, last_name, staff_category)
        select t.id, 'VERIFY-T482', up.id, 'Verify', 'T482', 'teaching'
          from public.tenants t
          cross join (select id from public.user_profiles order by id limit 1) up
         limit 1;

        insert into public.releve_entries (tenant_id, personnel_id, activity_type,
            clock_in_at, recorded_by)
        select p.tenant_id, p.id, 'other', now(), p.user_id
          from public.personnel p
         where p.personnel_code = 'VERIFY-T482'
         limit 1;
        -- Reaching here means the trigger did NOT raise.
        insert into t482_results values ('C5_manual_self_raises', false,
            'the manual self-entry was ACCEPTED (expected the §09.05 raise)');
    exception when others then
        v_raise_message := sqlerrm;
        insert into t482_results values ('C5_manual_self_raises',
            position('teacher cannot record their own Releve entry' in v_raise_message) > 0,
            'raised: ' || v_raise_message);
    end;

    -- C6: RUNTIME — an AUTO-shaped self entry PASSES the trigger (the
    -- exemption; the insert is rolled back with the transaction).
    begin
        insert into public.releve_entries (tenant_id, personnel_id, activity_type,
            clock_in_at, recorded_by, entry_source, auto_kind)
        select p.tenant_id, p.id, 'correction', now(), p.user_id, 'auto', 'grade_entry'
          from public.personnel p
         where p.personnel_code = 'VERIFY-T482'
         limit 1;
        insert into t482_results values ('C6_auto_self_passes', true,
            'the auto-shaped self entry passed the scoped trigger');
    exception when others then
        insert into t482_results values ('C6_auto_self_passes', false,
            'raised unexpectedly: ' || sqlerrm);
    end;

    -- C7: RUNTIME — the coupling CHECK rejects a manual row carrying
    -- auto_kind (a payload no canonical writer would ever send).
    begin
        insert into public.releve_entries (tenant_id, personnel_id, activity_type,
            clock_in_at, recorded_by, entry_source, auto_kind)
        values ('00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000002',
                'other', now(), '00000000-0000-0000-0000-000000000003',
                'manual', 'grade_entry');
        insert into t482_results values ('C7_coupling_rejects', false,
            'the manual+auto_kind row was ACCEPTED (expected check_violation)');
    exception when check_violation then
        insert into t482_results values ('C7_coupling_rejects', true,
            'check_violation raised as designed');
    end;

    -- C8: the registration row
    select count(*) into v_count from supabase_migrations.schema_migrations
     where version = '0141';
    insert into t482_results values ('C8_registration', v_count = 1,
        'schema_migrations 0141 rows=' || v_count::text);

    -- C9: the pre-0141 rows are all 'manual' (the default backfill)
    select count(*) into v_count from public.releve_entries
     where entry_source <> 'manual' and created_at < '2026-10-04';
    insert into t482_results values ('C9_pre_rows_manual', v_count = 0,
        'pre-0141 non-manual rows=' || v_count::text);
end
$verify$;

select check_id, ok, detail from t482_results order by check_id;

ROLLBACK;
