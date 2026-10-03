-- ============================================================================
-- verify_t-466.sql — T-466 (DEBT-102): the manual debt (migration 0137) —
-- the live verification script.
--
-- The convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can
-- be re-run any time without mutating the live DB; results land in a temp
-- table (t466_results) SELECTed at the end (run through
-- scripts/run_verify_sql_live.sh, which strips the trailing ROLLBACK — the
-- one-shot session's end provides the same all-or-nothing rollback).
--
-- Checks:
--   C1  installments.tranche_number is NULLABLE (the NON-WAVE row class)
--   C2  create_manual_debt exists: SECURITY DEFINER, plpgsql, 11 args
--   C3  the ACL: anon + public lost EXECUTE; authenticated keeps it
--   C4  the schema_migrations registration row (0137)
--
-- BEHAVIOR (the role-downgraded probe — RLS ENFORCED, everything rolled
-- back at the end; the verify_t-448 convention):
--   C5  the ADMIN (real profile): create_manual_debt succeeds → the
--       installment row lands (source_type manual_entry, tranche NULL,
--       status unpaid, the academic year stamped via the explicit code)
--   C6  the MATCHING ledger charge entry lands (amount, category,
--       student-scoped account, the manual metadata + reference)
--   C7  the audit row lands (installment.manual_debt_created)
--   C8  the guard: a too-short label raises
--   C9  the guard: a non-positive amount raises
--   C10 the DESKTOP READ PATH sees the row through RLS (the reactive
--       surface the repository's cache feeds — the unified-data proof)
--   C11 a non-staff caller (a parent JWT) is REFUSED (the staff gate)
-- ============================================================================
BEGIN;

create temp table t466_results (check_id text, ok boolean, detail text);
GRANT INSERT, SELECT ON t466_results TO authenticated;

-- ─── The catalog checks (session role) ─────────────────────────────────
do $catalog$
declare
    v_count integer;
    v_nullable text;
    v_detail text;
begin
    -- C1: tranche_number is nullable (the NON-WAVE class)
    select is_nullable into v_nullable from information_schema.columns
     where table_schema='public' and table_name='installments' and column_name='tranche_number';
    insert into t466_results values ('C1_tranche_nullable', v_nullable = 'YES',
        'tranche_number.is_nullable=' || coalesce(v_nullable, 'MISSING'));

    -- C2: the RPC's shape
    select count(*), coalesce(max(pg_get_function_identity_arguments(p.oid)), '') into v_count, v_detail
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='create_manual_debt';
    insert into t466_results values ('C2_rpc_exists_definer', v_count = 1 and strpos(v_detail, 'p_parent_id') > 0,
        'args=' || v_detail);

    select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='create_manual_debt' and p.prosecdef;
    insert into t466_results values ('C2b_rpc_security_definer', v_count = 1,
        case when v_count = 1 then 'SECURITY DEFINER (the upsert_installment_from_import convention)' else 'NOT DEFINER' end);

    -- C3: the ACL (§15.34)
    select count(*) into v_count from information_schema.routine_privileges
     where routine_schema='public' and routine_name='create_manual_debt'
       and grantee in ('anon','public') and privilege_type='EXECUTE';
    insert into t466_results values ('C3a_anon_no_execute', v_count = 0,
        case when v_count = 0 then 'anon + public lost EXECUTE' else 'ANON KEPT EXECUTE' end);

    select count(*) into v_count from information_schema.routine_privileges
     where routine_schema='public' and routine_name='create_manual_debt'
       and grantee='authenticated' and privilege_type='EXECUTE';
    insert into t466_results values ('C3b_authenticated_execute', v_count >= 1,
        case when v_count >= 1 then 'authenticated keeps EXECUTE' else 'AUTHENTICATED LOST EXECUTE' end);

    -- C4: the registration
    select count(*) into v_count from supabase_migrations.schema_migrations
     where version='0137' and name='manual_debt';
    insert into t466_results values ('C4_registration', v_count = 1,
        case when v_count = 1 then 'schema_migrations 0137 = manual_debt' else 'NOT REGISTERED' end);
end;
$catalog$;

-- ─── The behavior probes (RLS ENFORCED — the role downgrade runs LAST per
--     the verify_t-448 convention; the claims switch freely while the role
--     stays `authenticated`) ────────────────────────────────────────────
do $behavior$
declare
    v_tenant   uuid := '00000000-0000-0000-0000-000000000001';
    v_admin_sub uuid := 'a148fe34-98e3-422a-bf42-91da094e270c';
    v_parent   text := '48c89a6b-71b1-4282-8eee-c7136a25b209';
    v_student  text := 'aec2335c-938c-4453-9f8b-5a3cca70af90';
    v_ins_id   uuid;
    v_ledger_id uuid;
    v_year_id  uuid;
    v_count    integer;
    v_amount   numeric;
    v_tranche  integer;
    v_source   text;
begin
    -- ══════════ The ADMIN (the real staff profile) ══════════
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', v_admin_sub, 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    set local role authenticated;

    -- C5: the canonical creation succeeds and returns the ids
    begin
        select installment_id, ledger_entry_id, academic_year_id
          into v_ins_id, v_ledger_id, v_year_id
          from public.create_manual_debt(
              v_parent, v_student, 'uniform', 'Vérification T-466 — achat uniforme',
              500, '2026-10-15'::date, '2026-2027',
              'ligne de vérification (transaction jetable)', 'T466-VERIFY', '11111111-1111-1111-1111-111111111111'::uuid, 'Vérificateur T-466');
        insert into t466_results values ('C5_create_ok', v_ins_id is not null,
            'installment=' || coalesce(v_ins_id::text, 'NULL') || ' ledger=' || coalesce(v_ledger_id::text, 'NULL') || ' year=' || coalesce(v_year_id::text, 'NULL'));
    exception when others then
        insert into t466_results values ('C5_create_ok', false, sqlerrm);
    end;

    if v_ins_id is not null then
        -- C5b: the row's shape (the canonical record)
        select amount_due, tranche_number, source_type into v_amount, v_tranche, v_source
          from public.installments where id = v_ins_id;
        insert into t466_results values ('C5b_row_shape',
            v_amount = 500 and v_tranche is null and v_source = 'manual_entry',
            'amount=' || coalesce(v_amount::text,'?') || ' tranche=' || coalesce(v_tranche::text,'NULL') || ' source=' || coalesce(v_source,'?'));

        -- C6: the matching ledger charge entry
        select count(*), max(l.amount), max(l.metadata->>'reference') into v_count, v_amount, v_source
          from public.ledger_entries l where l.id = v_ledger_id;
        insert into t466_results values ('C6_ledger_charge',
            v_count = 1 and v_amount = 500 and v_source = 'T466-VERIFY',
            'rows=' || v_count || ' amount=' || coalesce(v_amount::text,'?') || ' reference=' || coalesce(v_source,'?'));

        -- C7: the audit row
        select count(*) into v_count from public.audit_logs
         where action='installment.manual_debt_created' and entity_id = v_ins_id;
        insert into t466_results values ('C7_audit_row', v_count = 1,
            'audit rows=' || v_count);

        -- C10: the desktop READ path sees it through RLS (PostgREST's own view)
        select count(*) into v_count from public.installments where id = v_ins_id;
        insert into t466_results values ('C10_read_path', v_count = 1,
            'visible rows=' || v_count);
    end if;

    -- C8: the guard — a too-short label raises
    begin
        perform public.create_manual_debt(
            v_parent, v_student, 'other', 'ab', 500, '2026-10-15'::date,
            null, null, null, '11111111-1111-1111-1111-111111111111'::uuid, 'Vérificateur T-466');
        insert into t466_results values ('C8_short_label_refused', false, 'NO exception — the guard is missing!');
    exception when others then
        insert into t466_results values ('C8_short_label_refused', true, 'raised: ' || sqlerrm);
    end;

    -- C9: the guard — a non-positive amount raises
    begin
        perform public.create_manual_debt(
            v_parent, v_student, 'other', 'Montant invalide volontaire', 0, '2026-10-15'::date,
            null, null, null, '11111111-1111-1111-1111-111111111111'::uuid, 'Vérificateur T-466');
        insert into t466_results values ('C9_bad_amount_refused', false, 'NO exception — the guard is missing!');
    exception when others then
        insert into t466_results values ('C9_bad_amount_refused', true, 'raised: ' || sqlerrm);
    end;

    -- ══════════ A NON-STAFF caller (a parent JWT) ══════════
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', '99999999-9999-9999-9999-999999999999'::text, 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    begin
        perform public.create_manual_debt(
            v_parent, v_student, 'other', 'Tentative non-staff', 500, '2026-10-15'::date,
            null, null, null, '11111111-1111-1111-1111-111111111111'::uuid, 'Non-staff');
        insert into t466_results values ('C11_non_staff_refused', false, 'NO exception — the staff gate is missing!');
    exception when others then
        insert into t466_results values ('C11_non_staff_refused', true, 'refused: ' || sqlerrm);
    end;
end;
$behavior$;

select check_id, ok, detail from t466_results order by check_id;

ROLLBACK;
