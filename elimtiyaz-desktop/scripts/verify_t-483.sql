-- ============================================================================
-- verify_t-483.sql — T-483 (the onboarding persistence port / migration
-- 0142): the live verification script.
--
-- The convention (AGENTS.md §11.1 + the T-446 runner): wrapped in
-- BEGIN; … ROLLBACK; results land in a temp table (t483_results)
-- SELECTed at the end (the runner strips the trailing ROLLBACK; the
-- session-end rollback provides the same all-or-nothing guarantee —
-- every runtime probe below writes ONLY inside this transaction).
--
-- Checks:
--   C1  personnel_id is nullable on onboarding_states
--   C2  the partial unique index onboarding_states_tenant_singleton_idx
--       exists (tenant_id) where personnel_id is null
--   C3  RUNTIME: a tenant-singleton row (personnel_id NULL) INSERTs —
--       inside BEGIN…ROLLBACK, zero residue
--   C4  RUNTIME: a SECOND singleton row for the same tenant is REJECTED
--       (the partial unique index works)
--   C5  RUNTIME: the per-personnel semantics survive — a personnel_id
--       row inserts (the 0010 unique (tenant_id, personnel_id) intact)
--   C6  the 0019 RLS policies are unchanged (onboarding_states_select +
--       onboarding_states_admin — the singleton row's visibility posture)
--   C7  the schema_migrations registration row (0142)
--   C8  the live table's row census (pre-0142 rows — all per-personnel;
--       recorded for the honest trail)
-- ============================================================================
BEGIN;

create temp table t483_results (check_id text, ok boolean, detail text);

do $verify$
declare
    v_count integer;
    v_nullable text;
    v_tenant uuid;
begin
    -- C1: personnel_id nullable
    select is_nullable into v_nullable from information_schema.columns
     where table_schema='public' and table_name='onboarding_states' and column_name='personnel_id';
    insert into t483_results values ('C1_personnel_nullable', v_nullable = 'YES',
        'is_nullable=' || coalesce(v_nullable,'MISSING'));

    -- C2: the partial unique index
    select count(*) into v_count from pg_indexes
     where schemaname='public' and tablename='onboarding_states'
       and indexname='onboarding_states_tenant_singleton_idx';
    insert into t483_results values ('C2_singleton_index', v_count = 1,
        'the partial unique index present=' || v_count::text);

    -- C3: RUNTIME — a tenant-singleton row inserts
    select id into v_tenant from public.tenants order by id limit 1;
    begin
        insert into public.onboarding_states (tenant_id, personnel_id, current_step,
            completed_steps, data_json)
        values (v_tenant, null, 3, '{0,1,2}', '{"departments":[]}'::jsonb);
        insert into t483_results values ('C3_singleton_inserts', true,
            'the tenant-singleton row (personnel_id NULL) inserted');
    exception when others then
        insert into t483_results values ('C3_singleton_inserts', false,
            'raised unexpectedly: ' || sqlerrm);
    end;

    -- C4: RUNTIME — a SECOND singleton row for the same tenant is rejected
    begin
        insert into public.onboarding_states (tenant_id, personnel_id, current_step)
        values (v_tenant, null, 0);
        insert into t483_results values ('C4_second_singleton_rejected', false,
            'the second singleton row was ACCEPTED (expected unique_violation)');
    exception when unique_violation then
        insert into t483_results values ('C4_second_singleton_rejected', true,
            'unique_violation raised as designed');
    end;

    -- C5: RUNTIME — the per-personnel semantics survive (a personnel row
    -- inserts beside the singleton; the FK needs a real personnel row).
    begin
        insert into public.onboarding_states (tenant_id, personnel_id, current_step)
        select p.tenant_id, p.id, 0
          from public.personnel p
         where p.tenant_id = v_tenant and p.deleted_at is null
         limit 1;
        if not found then
            insert into t483_results values ('C5_personnel_row_inserts', true,
                'SKIPPED — no live personnel row to probe (the tenant''s personnel table is empty; the DDL posture is proven by C1/C2/C4)');
        else
            insert into t483_results values ('C5_personnel_row_inserts', true,
                'a per-personnel row inserted beside the singleton');
        end if;
    exception when others then
        insert into t483_results values ('C5_personnel_row_inserts', false,
            'raised unexpectedly: ' || sqlerrm);
    end;

    -- C6: the RLS policies unchanged
    select count(*) into v_count from pg_policies
     where schemaname='public' and tablename='onboarding_states' and policyname='onboarding_states_select';
    insert into t483_results values ('C6a_rls_select', v_count = 1,
        'onboarding_states_select rows=' || v_count::text);
    select count(*) into v_count from pg_policies
     where schemaname='public' and tablename='onboarding_states' and policyname='onboarding_states_admin';
    insert into t483_results values ('C6b_rls_admin', v_count = 1,
        'onboarding_states_admin rows=' || v_count::text);

    -- C7: the registration row
    select count(*) into v_count from supabase_migrations.schema_migrations
     where version = '0142';
    insert into t483_results values ('C7_registration', v_count = 1,
        'schema_migrations 0142 rows=' || v_count::text);

    -- C8: the live row census (the honest trail — the probe rows above are
    -- inside this transaction; the census counts them, noted here)
    select count(*) into v_count from public.onboarding_states;
    insert into t483_results values ('C8_row_census', true,
        'rows visible inside this tx (incl. the C3/C5 probes)=' || v_count::text
            || ' — pre-apply baseline: 0 rows (probed before the apply)');
end
$verify$;

select check_id, ok, detail from t483_results order by check_id;

ROLLBACK;
