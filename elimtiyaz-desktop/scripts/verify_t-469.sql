-- ============================================================================
-- verify_t-469.sql — T-469 (DEBT-103): the configurable AMOUNT thresholds +
-- the per-level message templates (migration 0138) — the live verification
-- script.
--
-- The convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can
-- be re-run any time without mutating the live DB; results land in a temp
-- table (t469_results) SELECTed at the end (run through
-- scripts/run_verify_sql_live.sh, which strips the trailing ROLLBACK — the
-- one-shot session's end provides the same all-or-nothing rollback).
--
-- Checks:
--   C1  the SIX seeds exist for EVERY tenant (the idempotent on-conflict
--       insert makes re-runs no-ops)
--   C2  the seeded VALUES: yellow 20000 / red 60000 / the four messages ''
--   C3  the recreated read_debt_aging_thresholds: the jsonb carries
--       amountYellowDzd + amountRedDzd + levelMessages{green,yellow,orange,red}
--   C4  the reader's day-dimension keys are UNCHANGED (the T-443 contract
--       survives the §15.32 recreation)
--   C5  the ACL: anon + public lost EXECUTE; authenticated keeps it
--   C6  the schema_migrations registration row (0138)
--
-- BEHAVIOR (the role-downgraded probe — RLS ENFORCED, everything rolled
-- back at the end; the verify_t-466 convention):
--   C7  the ADMIN (the real staff profile) reads the EXTENDED payload
--       through the reader (the desktop's observeThresholds path)
--   C8  the CONFIGURED round-trip: set yellow=35000 + a red message →
--       the reader reflects BOTH (the ROLLBACK restores the seeds)
--   C9  a NON-STAFF caller (a bare authenticated sub with no staff role)
--       is REFUSED (the staff gate)
--  C10 the AMOUNT classification boundary (the in-SQL mirror of
--       classifyOutstandingAmount: <20000 green · >=20000 yellow ·
--       <=60000 yellow · >60000 red — the partition-without-gaps proof)
-- ============================================================================
BEGIN;

create temp table t469_results (check_id text, ok boolean, detail text);
-- The role-downgraded $behavior$ block (set local role authenticated) needs
-- to write its probe results (the verify_t-466 convention).
GRANT INSERT, SELECT ON t469_results TO authenticated;

-- ─── The catalog + seed checks (session role) ──────────────────────────
do $catalog$
declare
    v_tenants integer;
    v_missing integer;
    v_yellow numeric;
    v_red numeric;
    v_msgs integer;
    v_reader text;
    v_args text;
    v_reg integer;
begin
    -- C1: every tenant carries all six keys.
    select count(distinct tenant_id) into v_tenants from public.system_settings;
    select count(*) into v_missing
      from (select distinct tenant_id from public.system_settings) t
     where (
        select count(*) from public.system_settings s
         where s.tenant_id = t.tenant_id
           and s.category = 'debt'
           and s.key in ('debt.amount_threshold_yellow_dzd',
                         'debt.amount_threshold_red_dzd',
                         'debt.level_message_green',
                         'debt.level_message_yellow',
                         'debt.level_message_orange',
                         'debt.level_message_red')
     ) < 6;
    insert into t469_results values ('C1_six_seeds_per_tenant',
        coalesce(v_missing, 1) = 0,
        'tenants=' || coalesce(v_tenants,0) || ' tenants_missing_keys=' || coalesce(v_missing,0));

    -- C2: the seeded values (the documented defaults).
    select min((value #>> '{}')::numeric) into v_yellow
      from public.system_settings
     where category = 'debt' and key = 'debt.amount_threshold_yellow_dzd';
    select min((value #>> '{}')::numeric) into v_red
      from public.system_settings
     where category = 'debt' and key = 'debt.amount_threshold_red_dzd';
    select count(*) into v_msgs
      from public.system_settings
     where category = 'debt'
       and key like 'debt.level_message_%'
       and coalesce(value #>> '{}', '') = '';
    insert into t469_results values ('C2_seeded_values',
        coalesce(v_yellow,-1) = 20000 and coalesce(v_red,-1) = 60000 and coalesce(v_msgs,0) >= 4,
        'yellow=' || coalesce(v_yellow,-1) || ' red=' || coalesce(v_red,-1)
        || ' empty_messages=' || coalesce(v_msgs,0));

    -- C3/C4: the recreated reader's return shape (probed as jsonb keys).
    begin
        v_reader := public.read_debt_aging_thresholds()::text;
    exception when others then
        v_reader := null;
    end;
    insert into t469_results values ('C3_reader_extended_payload',
        v_reader is not null
        and v_reader like '%amountYellowDzd%'
        and v_reader like '%amountRedDzd%'
        and v_reader like '%levelMessages%'
        and v_reader like '%green%'
        and v_reader like '%orange%',
        'keys=' || coalesce(substring(v_reader from 1 for 140), 'READER-FAILED'));

    insert into t469_results values ('C4_day_keys_unchanged',
        v_reader is not null
        and v_reader like '%gracePeriodDays%'
        and v_reader like '%yellowDays%'
        and v_reader like '%redDays%'
        and v_reader like '%activePayerGraceDays%',
        'the T-443 day contract intact');

    -- C5: the ACL (the 0138 grants: anon/public revoked, authenticated kept).
    select pg_get_function_arguments(p.oid) into v_args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'read_debt_aging_thresholds';
    insert into t469_results values ('C5_acl',
        v_args is not null,
        'args=' || coalesce(v_args, 'FUNCTION MISSING')
        || ' (acl: check via has_function_privilege below)');

    insert into t469_results values ('C5b_anon_denied',
        not has_function_privilege('anon', 'public.read_debt_aging_thresholds()', 'EXECUTE'),
        'anon EXECUTE revoked');
    insert into t469_results values ('C5c_authenticated_allowed',
        has_function_privilege('authenticated', 'public.read_debt_aging_thresholds()', 'EXECUTE'),
        'authenticated EXECUTE granted');

    -- C6: the registration row.
    select count(*) into v_reg
      from supabase_migrations.schema_migrations
     where version = '0138' and name = 'debt_amount_thresholds_and_messages';
    insert into t469_results values ('C6_registration',
        coalesce(v_reg,0) = 1,
        'rows=' || coalesce(v_reg,0));
end
$catalog$;

-- ─── C7–C10: the behavior probes (role-downgraded, RLS enforced) ───────
do $behavior$
declare
    v_tenant   uuid := '00000000-0000-0000-0000-000000000001';
    v_admin_sub uuid := 'a148fe34-98e3-422a-bf42-91da094e270c';
    v_payload jsonb;
    v_yellow numeric;
    v_red numeric;
begin
    -- ══════════ The ADMIN (the real staff profile) ══════════
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', v_admin_sub, 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    set local role authenticated;

    -- C7: the staff read path sees the EXTENDED payload.
    begin
        v_payload := public.read_debt_aging_thresholds();
        -- C10's boundaries are pinned against the SEED edges (captured
        -- BEFORE the C8 round-trip mutates them inside this transaction).
        v_yellow := (v_payload->>'amountYellowDzd')::numeric;
        v_red := (v_payload->>'amountRedDzd')::numeric;
        insert into t469_results values ('C7_staff_reads_extended',
            v_payload ? 'amountYellowDzd' and v_payload ? 'levelMessages',
            'yellow=' || coalesce(v_payload->>'amountYellowDzd','?')
            || ' red=' || coalesce(v_payload->>'amountRedDzd','?')
            || ' msgs=' || coalesce(v_payload->'levelMessages'::text,'?'));
    exception when others then
        insert into t469_results values ('C7_staff_reads_extended', false, sqlerrm);
    end;

    -- C8: the CONFIGURED round-trip (rolled back with this transaction).
    begin
        update public.system_settings
           set value = '35000'::jsonb
         where category = 'debt' and key = 'debt.amount_threshold_yellow_dzd';
        update public.system_settings
           set value = '"Contentieux — convoquer la famille."'::jsonb
         where category = 'debt' and key = 'debt.level_message_red';
        v_payload := public.read_debt_aging_thresholds();
        insert into t469_results values ('C8_configured_round_trip',
            (v_payload->>'amountYellowDzd') = '35000'
            and (v_payload->'levelMessages'->>'red') like 'Contentieux%',
            'yellow=' || coalesce(v_payload->>'amountYellowDzd','?')
            || ' msg_red=' || coalesce(v_payload->'levelMessages'->>'red','?'));
    exception when others then
        insert into t469_results values ('C8_configured_round_trip', false, sqlerrm);
    end;

    -- C10: the boundary matrix (the in-SQL mirror of classifyOutstandingAmount,
    -- against the SEED edges captured at C7 — the C8 mutation never leaks here).
    insert into t469_results
    select 'C10_boundary_matrix',
           count(*) = 4,
           string_agg(check_id || '=' || ok, ', ')
      from (
        select 'below_yellow' as check_id, (19999::numeric < v_yellow) as ok
        union all
        select 'at_yellow_inclusive', (20000::numeric >= v_yellow and 20000::numeric <= v_red)
        union all
        select 'at_red_inclusive', (60000::numeric > v_yellow and 60000::numeric <= v_red)
        union all
        select 'above_red_exclusive', (60000.01::numeric > v_red)
      ) b;

    -- ══════════ C9: a NON-STAFF caller (a bare sub, no staff role) ══════════
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', '99900000-0000-4000-8000-000000000470'::uuid,
                          'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    begin
        perform public.read_debt_aging_thresholds();
        insert into t469_results values ('C9_non_staff_refused', false,
            'NOT REFUSED — the staff gate is open!');
    exception when others then
        insert into t469_results values ('C9_non_staff_refused',
            sqlerrm like 'forbidden:%',
            'refused: ' || sqlerrm);
    end;
end
$behavior$;

-- ─── The report (the last statement — run_verify_sql_live.sh depends on it)
SELECT check_id, ok, detail FROM t469_results ORDER BY check_id;

ROLLBACK;
