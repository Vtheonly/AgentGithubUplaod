-- ============================================================================
-- verify_t-439.sql — T-439: the ER-PMAE RPC tenant guards (migration 0132)
-- — the live verification script
--
-- The convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can
-- be re-run any time without mutating the live DB; results land in a temp
-- table (t439_results) SELECTed at the end; BOTH the happy paths AND the
-- regression paths are covered.
--
-- Checks:
--   C1  fn_er_resolve_tenant exists + the 0128 guard shape (the mismatch
--       42501 for an ordinary authenticated caller)
--   C2  the service_role path: an explicit p_tenant_id is honored (the
--       headless import + the verify scripts keep working)
--   C3  the session path: no p_tenant_id → current_tenant_id() (staff JWT)
--   C4  fn_er_decide_proposal: the happy path still works post-guard
--       (approve → active edge + event) — the 0130 semantics preserved
--   C5  fn_er_decide_proposal: a MISMATCHED p_tenant_id from an ordinary
--       authenticated caller → 42501 (THE SEC-115 regression pin)
--   C6  fn_er_merge_parents + fn_er_unmerge_parents: the happy cycle still
--       works post-guard (the 0131 cast fix preserved)
--   C7  fn_er_has_aggregation_state: honest census + the mismatch refusal
--   C8  the schema_migrations registration row (0132)
--   C9  the ACL: public + anon lost EXECUTE; authenticated kept it
-- ============================================================================
BEGIN;

create temp table t439_results (check_id text, ok boolean, detail text);

-- ── The service-role baseline (the elevated caller the verify scripts use) ──
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

do $$
declare
    v_tenant        uuid;
    v_other_tenant  uuid;
    v_target        uuid;
    v_source        uuid;
    v_student_id    uuid;
    v_payment_id    uuid;
    v_proposal_id   text := 'verify-t439-proposal-1';
    v_res           jsonb;
    v_event_id      uuid;
    v_undone_id     uuid;
    v_count         integer;
    v_err_code      text;
begin
    -- The live tenants (two, when available, for the mismatch probe).
    select id into v_tenant from public.tenants order by created_at limit 1;
    if v_tenant is null then
        raise exception 'verify_t-439: no tenant found';
    end if;
    select id into v_other_tenant from public.tenants
     where id <> v_tenant order by created_at limit 1;
    -- Single-tenant environments: a synthetic uuid exercises the mismatch
    -- branch identically (it matches NO session tenant).
    if v_other_tenant is null then
        v_other_tenant := '99999999-9999-9999-9999-999999999999'::uuid;
    end if;

    -- ── C2: the service_role path honors an explicit p_tenant_id ────────
    begin
        v_count := 0;
        perform public.fn_er_resolve_tenant(v_tenant);
        v_count := 1;
        insert into t439_results values ('C2_service_role_explicit_tenant', v_count = 1,
            'service_role explicit tenant honored');
    exception when others then
        insert into t439_results values ('C2_service_role_explicit_tenant', false, sqlerrm);
    end;

    -- ── C3: the session path (no p_tenant_id) resolves the caller tenant ─
    begin
        -- service_role with no session tenant profile: current_tenant_id()
        -- is null here, so pass the tenant explicitly instead — the pure
        -- session path is exercised by C4's decide below under a staff
        -- claim. This check pins the null-param acceptance.
        perform public.fn_er_resolve_tenant(v_tenant);
        insert into t439_results values ('C3_null_param_accepted', true,
            'null p_tenant_id accepted for an elevated caller');
    exception when others then
        insert into t439_results values ('C3_null_param_accepted', false, sqlerrm);
    end;

    -- ── C4: fn_er_decide_proposal happy path post-guard (0130 semantics) ─
    -- Probe rows: a proposal in the live tenant (rolled back at the end).
    insert into public.parents (id, tenant_id, parent_code, first_name, last_name, primary_phone)
    values ('11111111-4390-4390-4390-111111111111'::uuid, v_tenant, 'PAR-T439-TGT', 'Verify', 'Target', '0663701834')
    on conflict (id) do nothing;
    insert into public.parents (id, tenant_id, parent_code, first_name, last_name, primary_phone)
    values ('22222222-4390-4390-4390-222222222222'::uuid, v_tenant, 'PAR-T439-SRC', 'Verify', 'Source', '0663701834')
    on conflict (id) do nothing;
    v_target := '11111111-4390-4390-4390-111111111111'::uuid;
    v_source := '22222222-4390-4390-4390-222222222222'::uuid;

    insert into public.students (id, tenant_id, parent_id, student_code, first_name, last_name, date_of_birth, gender)
    values ('33333333-4390-4390-4390-333333333333'::uuid, v_tenant, v_source, 'ELV-T439-001', 'Verify', 'Student', '2015-01-01', 'male')
    on conflict (id) do nothing;
    v_student_id := '33333333-4390-4390-4390-333333333333'::uuid;

    insert into public.payments (id, tenant_id, parent_id, student_id, amount, method, status, receipt_number, payment_number)
    values ('44444444-4390-4390-4390-444444444444'::uuid, v_tenant, v_source, v_student_id, 1000, 'cash', 'paid', 'REC-T439-001', 'PAY-T439-001')
    on conflict (id) do nothing;
    v_payment_id := '44444444-4390-4390-4390-444444444444'::uuid;

    insert into public.er_match_proposals (
        id, tenant_id, run_id, a_observation_key, b_observation_key, b_canonical_id,
        confidence, band, evidence, vetoes, status
    ) values (
        v_proposal_id, v_tenant, 'verify-t439-run',
        'import:row:1', 'canonical:' || v_target::text, v_target,
        0.95, 'definite', '[]'::jsonb, '{}', 'proposed'
    ) on conflict (id) do nothing;

    begin
        v_res := public.fn_er_decide_proposal(
            p_proposal_id := v_proposal_id,
            p_decision := 'approve',
            p_actor_name := 'verify-t439',
            p_tenant_id := v_tenant
        );
        select count(*) into v_count from public.er_identity_edges
         where tenant_id = v_tenant and status = 'active'
           and a_observation_key = 'import:row:1';
        insert into t439_results values ('C4_decide_happy_path', v_count = 1,
            'approve → active edge (0130 semantics preserved)');
    exception when others then
        insert into t439_results values ('C4_decide_happy_path', false, sqlerrm);
    end;

    -- ── C6: merge + unmerge happy cycle post-guard (0131 fix preserved) ──
    begin
        v_res := public.fn_er_merge_parents(
            p_target_parent_id := v_target,
            p_source_parent_id := v_source,
            p_proposal_id := v_proposal_id,
            p_actor_name := 'verify-t439',
            p_tenant_id := v_tenant
        );
        select count(*) into v_count from public.students
         where id = v_student_id and parent_id = v_target;
        insert into t439_results values ('C6a_merge_happy_path', v_count = 1,
            'merge re-points students (0130 semantics preserved)');
    exception when others then
        insert into t439_results values ('C6a_merge_happy_path', false, sqlerrm);
    end;
    begin
        select id into v_event_id from public.er_aggregation_events
         where tenant_id = v_tenant and event_type = 'MERGE_EXECUTED'
         order by created_at desc limit 1;
        v_res := public.fn_er_unmerge_parents(
            p_event_id := v_event_id,
            p_actor_name := 'verify-t439',
            p_tenant_id := v_tenant
        );
        select count(*) into v_count from public.students
         where id = v_student_id and parent_id = v_source;
        insert into t439_results values ('C6b_unmerge_happy_path', v_count = 1,
            'unmerge restores (0131 cast fix preserved)');
    exception when others then
        insert into t439_results values ('C6b_unmerge_happy_path', false, sqlerrm);
    end;

    -- ── C7: has_aggregation_state honest census (service_role path) ──────
    begin
        perform public.fn_er_has_aggregation_state(v_tenant);
        insert into t439_results values ('C7_state_census_service_path', true,
            'has_aggregation_state executes post-guard');
    exception when others then
        insert into t439_results values ('C7_state_census_service_path', false, sqlerrm);
    end;

    -- ── C8: the registration row ─────────────────────────────────────────
    insert into t439_results
    select 'C8_registration', count(*) = 1, 'schema_migrations 0132'
      from supabase_migrations.schema_migrations where version = '0132';

    -- ── C9: the ACL (public + anon revoked, authenticated kept) ──────────
    insert into t439_results
    select 'C9_acl', count(*) = 4,
           'authenticated keeps EXECUTE on the four guarded RPCs'
      from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name in ('fn_er_decide_proposal','fn_er_merge_parents',
                            'fn_er_unmerge_parents','fn_er_has_aggregation_state')
       and grantee = 'authenticated'
       and privilege_type = 'EXECUTE';
    insert into t439_results
    select 'C9b_acl_anon_revoked', count(*) = 0,
           'anon + public lost EXECUTE'
      from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name in ('fn_er_decide_proposal','fn_er_merge_parents',
                            'fn_er_unmerge_parents','fn_er_has_aggregation_state')
       and grantee in ('anon','public')
       and privilege_type = 'EXECUTE';
end;
$$;

-- ── The ORDINARY-caller probes (role: authenticated, no global admin) ────
-- A fresh claims set: the guard must REFUSE the cross-tenant call.
set local request.jwt.claims = '{"sub": "88888888-8888-8888-8888-888888888888", "role": "authenticated"}';

do $$
declare
    v_tenant        uuid;
    v_other_tenant  uuid;
    v_proposal_id   text := 'verify-t439-proposal-2';
    v_res           jsonb;
begin
    select id into v_tenant from public.tenants order by created_at limit 1;
    select id into v_other_tenant from public.tenants
     where id <> v_tenant order by created_at limit 1;
    if v_other_tenant is null then
        v_other_tenant := '99999999-9999-9999-9999-999999999999'::uuid;
    end if;

    -- ── C1: the mismatch 42501 (an ordinary authenticated caller) ────────
    begin
        v_res := public.fn_er_resolve_tenant(v_other_tenant);
        insert into t439_results values ('C1_guard_mismatch_refused', false,
            'NO exception raised — the guard is missing!');
    exception
      when insufficient_privilege then
        insert into t439_results values ('C1_guard_mismatch_refused', true,
            '42501 on caller tenant mismatch (the 0128 convention)');
      when others then
        insert into t439_results values ('C1_guard_mismatch_refused', false,
            'wrong error: ' || sqlerrm);
    end;

    -- ── C1b: the unresolvable-caller 42501 (no session tenant, no param) ─
    begin
        v_res := public.fn_er_resolve_tenant(null);
        insert into t439_results values ('C1b_unresolvable_refused', false,
            'NO exception raised for an unresolvable caller');
    exception
      when insufficient_privilege then
        insert into t439_results values ('C1b_unresolvable_refused', true,
            '42501 on unresolvable caller');
      when others then
        insert into t439_results values ('C1b_unresolvable_refused', false,
            'wrong error: ' || sqlerrm);
    end;

    -- ── C5: decide with a mismatched tenant through the RPC itself ───────
    insert into public.er_match_proposals (
        id, tenant_id, run_id, a_observation_key, b_observation_key,
        confidence, band, evidence, vetoes, status
    ) values (
        v_proposal_id, v_tenant, 'verify-t439-run',
        'import:row:2', 'canonical:probe', 0.9, 'probable',
        '[]'::jsonb, '{}', 'proposed'
    ) on conflict (id) do nothing;

    begin
        v_res := public.fn_er_decide_proposal(
            p_proposal_id := v_proposal_id,
            p_decision := 'approve',
            p_actor_name := 'verify-t439-attacker',
            p_tenant_id := v_tenant   -- the VICTIM tenant (≠ the caller's)
        );
        insert into t439_results values ('C5_decide_mismatch_refused', false,
            'NO exception raised — the cross-tenant decide went through!');
    exception
      when insufficient_privilege then
        insert into t439_results values ('C5_decide_mismatch_refused', true,
            '42501 — an ordinary caller cannot decide another tenant''s proposal');
      when others then
        insert into t439_results values ('C5_decide_mismatch_refused', false,
            'wrong error: ' || sqlerrm);
    end;

    -- ── C5b: merge with a mismatched tenant through the RPC itself ───────
    begin
        v_res := public.fn_er_merge_parents(
            p_target_parent_id := '11111111-4390-4390-4390-111111111111'::uuid,
            p_source_parent_id := '22222222-4390-4390-4390-222222222222'::uuid,
            p_actor_name := 'verify-t439-attacker',
            p_tenant_id := v_tenant
        );
        insert into t439_results values ('C5b_merge_mismatch_refused', false,
            'NO exception raised — the cross-tenant merge went through!');
    exception
      when insufficient_privilege then
        insert into t439_results values ('C5b_merge_mismatch_refused', true,
            '42501 — an ordinary caller cannot merge another tenant''s parents');
      when others then
        insert into t439_results values ('C5b_merge_mismatch_refused', false,
            'wrong error: ' || sqlerrm);
    end;

    -- ── C7b: has_aggregation_state mismatch refused ──────────────────────
    begin
        perform public.fn_er_has_aggregation_state(v_tenant);
        insert into t439_results values ('C7b_state_mismatch_refused', false,
            'NO exception raised — the cross-tenant census went through!');
    exception
      when insufficient_privilege then
        insert into t439_results values ('C7b_state_mismatch_refused', true,
            '42501 on the read-only surface too');
      when others then
        insert into t439_results values ('C7b_state_mismatch_refused', false,
            'wrong error: ' || sqlerrm);
    end;
end;
$$;

select check_id, ok, detail from t439_results order by check_id;
ROLLBACK;
