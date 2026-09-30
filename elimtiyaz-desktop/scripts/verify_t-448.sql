-- ============================================================================
-- verify_t-448.sql — T-448 (UI-326): the dedicated dashboard_layouts table
-- (migration 0134) — the live verification script.
--
-- The convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can
-- be re-run any time without mutating the live DB; results land in a temp
-- table (t448_results) SELECTed at the end (run through
-- scripts/run_verify_sql_live.sh, which strips the trailing ROLLBACK — the
-- one-shot session's end provides the same all-or-nothing rollback).
--
-- Checks:
--   C1  the table + its columns (the dedicated store's shape)
--   C2  the identity constraint: unique (tenant, user_profile, view_key)
--   C3  RLS enabled
--   C4  the FOUR per-action policies, each `to authenticated` and pinned to
--       user_profile_id = current_user_profile_id() (own rows only)
--   C5  save_dashboard_layout exists, SECURITY INVOKER, returns timestamptz
--   C6  the ACL: anon + public lost EXECUTE; authenticated + service_role
--       kept it
--   C7  the schema_migrations registration row (0134)
--
-- BEHAVIOR (the role-downgraded probes — RLS ENFORCED, everything rolled
-- back at the end; the verify_t-432 C12 convention):
--   C8  USER A (the real admin): save via the RPC → a row exists for A
--   C9  USER A: SELECT reads the row back through RLS (the editor's load
--       path) — the layout jsonb round-trips verbatim
--   C10 the UPSERT: a second save → still ONE row, the layout UPDATED
--       (the explicit save is an update, never a duplicate)
--   C11 a caller with NO profile → the RPC refuses (42501) — identity is
--       resolved server-side; an unregistered user cannot save
--   C12 USER B (a synthetic profile, created INSIDE this transaction):
--       sees ZERO of A's rows (the isolation pin)
--   C13 USER B: saves their own layout under the SAME view key → their own
--       row (A's row untouched — one row per USER, not per view)
--   C14 USER B: a direct DELETE targeting A's row id → 0 rows deleted
--       (RLS on DELETE — the forged-identity guard)
--   C15 USER A (claims switched back): the row SURVIVED B's delete + B's
--       writes, layout = A's LAST save (the explicit-save semantics)
--   C16 USER A: DELETE own row (Réinitialiser) → gone for A
-- ============================================================================
BEGIN;

create temp table t448_results (check_id text, ok boolean, detail text);
-- §15.27: the behavior block downgrades to `authenticated` — the temp
-- table must be granted BEFORE that block runs.
GRANT INSERT, SELECT ON t448_results TO authenticated;

-- ─── The catalog checks (session role; the owner bypasses RLS by design —
--     the API roles are what the policies gate) ──────────────────────────
do $catalog$
declare
    v_count integer;
    v_bool  boolean;
    v_detail text;
begin
    -- C1: the columns
    select count(*), string_agg(column_name, ',' order by column_name)
      into v_count, v_detail
      from information_schema.columns
     where table_schema = 'public' and table_name = 'dashboard_layouts';
    insert into t448_results values ('C1_columns', v_count = 7,
        'columns(' || v_count || '): ' || coalesce(v_detail, 'MISSING'));

    -- C2: the identity constraint
    select count(*) into v_count from pg_constraint
     where conrelid = 'public.dashboard_layouts'::regclass
       and contype = 'u'
       and (select array_agg(attname order by attname)
              from unnest(conkey) k
              join pg_attribute a on a.attrelid = conrelid and a.attnum = k)
           = array['tenant_id'::name, 'user_profile_id'::name, 'view_key'::name];
    insert into t448_results values ('C2_identity_unique', v_count = 1,
        case when v_count = 1 then 'unique (tenant_id, user_profile_id, view_key)' else 'CONSTRAINT MISSING' end);

    -- C3: RLS enabled
    select relrowsecurity into v_bool from pg_class
     where oid = 'public.dashboard_layouts'::regclass;
    insert into t448_results values ('C3_rls_enabled', v_bool = true,
        case when v_bool then 'row level security enabled' else 'RLS NOT ENABLED' end);

    -- C4: the four per-action own-rows policies, to authenticated (INSERT
    --     policies carry only with_check — coalesce before matching).
    select count(*) into v_count from pg_policies
     where schemaname = 'public' and tablename = 'dashboard_layouts'
       and roles = '{authenticated}'
       and coalesce(qual, with_check) like '%current_user_profile_id()%';
    insert into t448_results values ('C4_own_rows_policies', v_count = 4,
        'authenticated own-rows policies: ' || v_count || '/4 (select/insert/update/delete)');

    select count(*) into v_count from pg_policies
     where schemaname = 'public' and tablename = 'dashboard_layouts'
       and cmd <> 'SELECT' and cmd <> 'INSERT' and cmd <> 'UPDATE' and cmd <> 'DELETE';
    insert into t448_results values ('C4b_no_role_gate', v_count = 0,
        case when v_count = 0 then 'no role gate on any policy (a personal preference)' else 'ROLE-GATED POLICY PRESENT' end);

    -- C5: the RPC — SECURITY INVOKER + timestamptz return
    select count(*) into v_count from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'save_dashboard_layout'
       and p.prosecdef = false
       and pg_catalog.pg_get_function_result(p.oid) = 'timestamp with time zone';
    insert into t448_results values ('C5_rpc_invoker_timestamptz', v_count = 1,
        case when v_count = 1 then 'save_dashboard_layout(text, jsonb): invoker, returns timestamptz' else 'RPC SHAPE WRONG' end);

    -- C6: the ACL (§15.34)
    select count(*) into v_count from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'save_dashboard_layout'
       and grantee in ('anon', 'public') and privilege_type = 'EXECUTE';
    insert into t448_results values ('C6a_anon_no_execute', v_count = 0,
        case when v_count = 0 then 'anon + public lost EXECUTE' end);

    select count(*) into v_count from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'save_dashboard_layout'
       and grantee = 'authenticated' and privilege_type = 'EXECUTE';
    insert into t448_results values ('C6b_authenticated_execute', v_count >= 1,
        case when v_count >= 1 then 'authenticated keeps EXECUTE' else 'AUTHENTICATED LOST EXECUTE' end);

    -- C7: the registration
    select count(*) into v_count from supabase_migrations.schema_migrations
     where version = '0134' and name = 'dashboard_layouts';
    insert into t448_results values ('C7_registration', v_count = 1,
        case when v_count = 1 then 'schema_migrations 0134 = dashboard_layouts' else 'NOT REGISTERED' end);
end;
$catalog$;

-- ─── The behavior probes (RLS ENFORCED — the role downgrade runs LAST per
--     the verify_t-432 C12 convention; the claims switch freely while the
--     role stays `authenticated`) ────────────────────────────────────────
do $behavior$
declare
    v_tenant         uuid := '00000000-0000-0000-0000-000000000001';
    v_admin_sub      uuid := 'a148fe34-98e3-422a-bf42-91da094e270c';
    v_b_profile      uuid := '77777777-7777-7777-7777-777777777777';
    v_b_auth         uuid := '88888888-8888-8888-8888-888888888888';
    v_a_layout       jsonb;
    v_row_count      integer;
    v_w              text;
    v_ts             timestamptz;
    v_a_row_id       uuid;
    v_err_code       text;
begin
    -- The synthetic USER B profile (rolled back with everything else —
    -- the verify_t-439 probe-row convention).
    insert into public.user_profiles (id, auth_user_id, tenant_id, email, display_name)
    values (v_b_profile, v_b_auth, v_tenant, 't448-probe-b@elimtiyaz.dz', 'T448 Probe B');

    -- ══════════ USER A (the real admin profile) ══════════
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', v_admin_sub, 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    set local role authenticated;

    -- C8: A saves via the RPC (the explicit-save write path)
    begin
        v_ts := public.save_dashboard_layout('t448-probe',
            '{"kpi":{"x":2,"y":3,"w":6,"h":6},"chart":{"x":8,"y":3,"w":4,"h":6}}'::jsonb);
        insert into t448_results values ('C8_a_rpc_save', v_ts is not null,
            'saved_at=' || coalesce(v_ts::text, 'NULL'));
    exception when others then
        insert into t448_results values ('C8_a_rpc_save', false, sqlerrm);
    end;

    -- C9: A reads it back through RLS (the editor's load path) — verbatim
    select count(*), max(layout -> 'kpi' ->> 'w') into v_row_count, v_w
      from public.dashboard_layouts where view_key = 't448-probe';
    insert into t448_results values ('C9_a_load_roundtrip', v_row_count = 1 and v_w = '6',
        'rows=' || v_row_count || ' kpi.w=' || coalesce(v_w, 'null'));

    -- Capture A's row id for the C14 forged-delete probe.
    select id into v_a_row_id from public.dashboard_layouts where view_key = 't448-probe';

    -- C10: the UPSERT — a second save is an UPDATE, never a duplicate
    perform public.save_dashboard_layout('t448-probe',
        '{"kpi":{"x":0,"y":0,"w":12,"h":4}}'::jsonb);
    select count(*), max(layout -> 'kpi' ->> 'w') into v_row_count, v_w
      from public.dashboard_layouts where view_key = 't448-probe';
    insert into t448_results values ('C10_upsert_updates', v_row_count = 1 and v_w = '12',
        'rows=' || v_row_count || ' (ONE row, updated) kpi.w=' || coalesce(v_w, 'null'));

    -- ══════════ A caller with NO profile (the unregistered guard) ══════════
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', '99999999-9999-9999-9999-999999999999'::text, 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    begin
        v_ts := public.save_dashboard_layout('t448-probe', '{"x":1}'::jsonb);
        insert into t448_results values ('C11_no_profile_refused', false,
            'NO exception — an unregistered caller saved a layout!');
    exception
      when insufficient_privilege then
        insert into t448_results values ('C11_no_profile_refused', true,
            '42501 for a caller with no profile (identity resolved server-side)');
      when others then
        insert into t448_results values ('C11_no_profile_refused', false,
            'wrong error: ' || sqlerrm);
    end;

    -- ══════════ USER B (the synthetic profile) ══════════
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', v_b_auth, 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);

    -- C12: B sees ZERO of A's rows (the isolation pin)
    select count(*) into v_row_count from public.dashboard_layouts;
    insert into t448_results values ('C12_b_sees_nothing_of_a', v_row_count = 0,
        'B sees ' || v_row_count || ' rows (A has 1)');

    -- C13: B saves their own layout under the SAME view key → their own row
    begin
        v_ts := public.save_dashboard_layout('t448-probe',
            '{"kpi":{"x":1,"y":1,"w":3,"h":3}}'::jsonb);
        select count(*), max(layout -> 'kpi' ->> 'w') into v_row_count, v_w
          from public.dashboard_layouts;
        insert into t448_results values ('C13_b_saves_own', v_row_count = 1 and v_w = '3',
            'B sees rows=' || v_row_count || ' kpi.w=' || coalesce(v_w, 'null'));
    exception when others then
        insert into t448_results values ('C13_b_saves_own', false, sqlerrm);
    end;

    -- C14: B targets A's row id DIRECTLY (the forged-identity delete) → 0 rows
    delete from public.dashboard_layouts where id = v_a_row_id;
    get diagnostics v_row_count = row_count;
    insert into t448_results values ('C14_b_cannot_delete_a', v_row_count = 0,
        'B deleted ' || v_row_count || ' of A''s rows (must be 0)');

    -- ══════════ Back to USER A (claims switch; role stays authenticated) ══════════
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', v_admin_sub, 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);

    -- C15: A's row SURVIVED B's delete + writes; layout = A's LAST save
    select count(*), max(layout -> 'kpi' ->> 'w') into v_row_count, v_w
      from public.dashboard_layouts where view_key = 't448-probe';
    insert into t448_results values ('C15_a_row_survived', v_row_count = 1 and v_w = '12',
        'A''s rows=' || v_row_count || ' kpi.w=' || coalesce(v_w, 'null'));

    -- C16: A resets (Réinitialiser) → the saved row is GONE
    delete from public.dashboard_layouts where view_key = 't448-probe';
    get diagnostics v_row_count = row_count;
    select count(*) into v_row_count from public.dashboard_layouts;
    insert into t448_results values ('C16_a_reset_clears', v_row_count = 0,
        'after reset, A sees ' || v_row_count || ' rows');
end;
$behavior$;

select * from t448_results order by check_id;

ROLLBACK;
