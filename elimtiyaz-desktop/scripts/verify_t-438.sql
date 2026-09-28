-- ============================================================================
-- verify_t-438.sql — T-438: the ER-PMAE identity-resolution engine
-- (migration 0130) — the live verification script
--
-- The convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can
-- be re-run any time without mutating the live DB; results land in a temp
-- table (t438_results) SELECTed at the end; BOTH the happy paths AND the
-- regression paths are covered.
--
-- Checks:
--   C1  the four er_* tables exist with their unique constraints
--   C2  RLS is enabled on all four + the policies (staff read / admin
--       manage) exist; NO parent-role policy exists
--   C3  fn_er_decide_proposal: approve → the ACTIVE edge + the event + the
--       decided proposal is immutable (re-decide refused)
--   C4  fn_er_decide_proposal: reject → the NEGATIVE edge (never re-proposed)
--   C5  fn_er_merge_parents: the ONE-transaction reversible merge — probe
--       parents/students/payments re-pointed, source soft-deleted, the
--       event carries the COMPLETE prior mapping (INV-54)
--   C6  fn_er_unmerge_parents: the exact prior state restored (every row
--       back, the parent un-deleted); a SECOND unmerge refused
--   C7  fn_er_has_aggregation_state: honest census (pristine → false)
--   C8  the schema_migrations registration row (0130)
--   C9  the ACL: public lost EXECUTE on the new RPCs; authenticated kept it
--   C10 the audit trail rows landed (er.merge_parents / er.unmerge_parents)
-- ============================================================================
BEGIN;

-- The T-403 convention: the Management-API connection carries no user JWT,
-- so the tenant-resolving RPCs would fail their caller verification. Setting
-- the local jwt claims (service_role) lets the verify script exercise the
-- RPCs exactly as an elevated caller would; everything rolls back anyway.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t438_results (check_id text, ok boolean, detail text);

do $$
declare
    v_tenant        uuid;
    v_target        uuid;
    v_source        uuid;
    v_student_id    uuid;
    v_payment_id    uuid;
    v_proposal_id   text := 'verify-t438-proposal-1';
    v_res           jsonb;
    v_event_id      uuid;
    v_undone_id     uuid;
    v_count         integer;
    v_audit_count   integer;
begin
    -- The live tenant (the owner admin's tenant).
    select id into v_tenant from public.tenants order by created_at limit 1;
    if v_tenant is null then
        raise exception 'verify_t-438: no tenant found';
    end if;

    -- ── C1: the four tables + their unique constraints ──────────────────
    insert into t438_results
    select 'C1_tables',
           count(*) = 4,
           'er_source_observations / er_match_proposals / er_identity_edges / er_aggregation_events'
    from information_schema.tables
    where table_schema = 'public' and table_name in (
        'er_source_observations', 'er_match_proposals', 'er_identity_edges', 'er_aggregation_events');

    insert into t438_results
    select 'C1_constraints',
           count(*) = 2,
           'the named uniques: er_source_observation_identity + er_identity_edge_pair'
    from pg_constraint
    where conname in ('er_source_observation_identity', 'er_identity_edge_pair')
      and contype = 'u';

    -- ── C2: RLS + policies ──────────────────────────────────────────────
    insert into t438_results
    select 'C2_rls',
           count(*) = 4,
           'RLS enabled on all four tables'
    from pg_class
    where relname in ('er_source_observations', 'er_match_proposals', 'er_identity_edges', 'er_aggregation_events')
      and relrowsecurity;

    insert into t438_results
    select 'C2_policies',
           count(*) = 8,
           'staff_read + admin_manage on all four tables'
    from pg_policies
    where schemaname = 'public'
      and tablename like 'er_%'
      and (policyname like '%staff_read' or policyname like '%admin_manage');

    insert into t438_results
    select 'C2_no_parent_access',
           count(*) = 0,
           'NO parent-role policy on any er_* table (identity data is staff-only)'
    from pg_policies
    where schemaname = 'public' and tablename like 'er_%'
      and (policyname like '%parent%' or policyname like '%portal%');

    -- ── Probe data: two parents + one student + one payment (rolled back) ──
    insert into public.parents (id, tenant_id, parent_code, first_name, last_name, primary_phone)
    values (gen_random_uuid(), v_tenant, 'PAR-T438-TGT', 'Mohamed', 'SEDIKI', '0663701834')
    returning id into v_target;

    insert into public.parents (id, tenant_id, parent_code, first_name, last_name, primary_phone)
    values (gen_random_uuid(), v_tenant, 'PAR-T438-SRC', 'Mohamed', 'SEDIKY', '0663701834')
    returning id into v_source;

    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name, date_of_birth, gender)
    values (v_tenant, v_source, 'ELV-T438-001', 'Ishak', 'SEDIKY', '2015-01-01', 'male')
    returning id into v_student_id;

    insert into public.payments (tenant_id, parent_id, student_id, amount, method, status, receipt_number, payment_number)
    values (v_tenant, v_source, v_student_id, 125000, 'cash', 'paid', 'REC-T438-001', 'PAY-T438-001')
    returning id into v_payment_id;

    -- A probe proposal (the engine's persisted shape).
    insert into public.er_match_proposals (id, tenant_id, run_id, a_observation_key, b_observation_key, b_canonical_id, confidence, band, evidence, vetoes, status)
    values (v_proposal_id, v_tenant, 'verify-t438-run', 'import:row:42', 'canonical:' || v_source::text, v_source, 0.95, 'definite', '[]'::jsonb, '{}', 'proposed');

    -- ── C3: approve → the active edge + the event + immutability ────────
    select fn_er_decide_proposal(v_proposal_id, 'approve', null, 'verify-t438', 'probe', v_tenant) into v_res;
    insert into t438_results values ('C3_approve_edge',
        exists (select 1 from public.er_identity_edges where tenant_id = v_tenant and status = 'active'),
        'the ACTIVE edge created');
    insert into t438_results values ('C3_approve_event',
        exists (select 1 from public.er_aggregation_events where tenant_id = v_tenant and event_type = 'PROPOSAL_APPROVED'),
        'the PROPOSAL_APPROVED event written');
    -- The decided proposal is immutable.
    begin
        perform fn_er_decide_proposal(v_proposal_id, 'reject', null, 'verify-t438', 'probe', v_tenant);
        insert into t438_results values ('C3_immutable', false, 're-decide SHOULD have failed');
    exception when others then
        insert into t438_results values ('C3_immutable', true, 're-decide refused (decided proposals are immutable)');
    end;

    -- ── C4: reject → the negative edge ──────────────────────────────────
    insert into public.er_match_proposals (id, tenant_id, run_id, a_observation_key, b_observation_key, b_canonical_id, confidence, band, evidence, vetoes, status)
    values ('verify-t438-proposal-2', v_tenant, 'verify-t438-run', 'import:row:43', 'canonical:' || v_target::text, v_target, 0.7, 'review', '[]'::jsonb, '{}', 'proposed');
    perform fn_er_decide_proposal('verify-t438-proposal-2', 'reject', null, 'verify-t438', 'probe', v_tenant);
    insert into t438_results values ('C4_negative_edge',
        exists (select 1 from public.er_identity_edges where tenant_id = v_tenant and status = 'negative'),
        'the NEGATIVE edge created (never re-proposed)');

    -- ── C5: the reversible merge ────────────────────────────────────────
    select fn_er_merge_parents(v_target, v_source, v_proposal_id, null, 'verify-t438', 'probe merge', v_tenant) into v_res;
    v_event_id := (v_res->>'eventId')::uuid;
    insert into t438_results values ('C5_repointed',
        (select parent_id from public.students where id = v_student_id) = v_target
        and (select parent_id from public.payments where id = v_payment_id) = v_target,
        'student + payment re-pointed to the survivor');
    insert into t438_results values ('C5_softdeleted',
        (select deleted_at is not null from public.parents where id = v_source),
        'the merged-away parent soft-deleted (the T-384 convention)');
    insert into t438_results values ('C5_mapping_recorded',
        ((v_res->'rePointed'->'students')::jsonb ? v_student_id::text)
        and ((v_res->'rePointed'->'payments')::jsonb ? v_payment_id::text),
        'the COMPLETE prior mapping recorded in the event payload');

    -- ── C6: the unmerge restores the EXACT prior state ──────────────────
    select fn_er_unmerge_parents(v_event_id, null, 'verify-t438', 'probe unmerge', v_tenant) into v_res;
    v_undone_id := (v_res->>'eventId')::uuid;
    insert into t438_results values ('C6_restored',
        (select parent_id from public.students where id = v_student_id) = v_source
        and (select parent_id from public.payments where id = v_payment_id) = v_source
        and (select deleted_at is null from public.parents where id = v_source),
        'every row back at its original parent; the parent restored');
    insert into t438_results values ('C6_event',
        v_undone_id is not null
        and exists (select 1 from public.er_aggregation_events where id = v_undone_id and event_type = 'MERGE_UNDONE'),
        'the MERGE_UNDONE event written');
    -- A second unmerge is refused.
    begin
        perform fn_er_unmerge_parents(v_event_id, null, 'verify-t438', 'double', v_tenant);
        insert into t438_results values ('C6_double_refused', false, 'second unmerge SHOULD have failed');
    exception when others then
        insert into t438_results values ('C6_double_refused', true, 'second unmerge refused');
    end;

    -- ── C7: the honest census ───────────────────────────────────────────
    insert into t438_results values ('C7_state',
        fn_er_has_aggregation_state(v_tenant) = true,
        'aggregation state detected after the merge/unmerge cycle');

    -- ── C10: the audit trail ────────────────────────────────────────────
    select count(*) into v_audit_count from public.audit_logs
    where action in ('er.merge_parents', 'er.unmerge_parents', 'er.decide_proposal');
    insert into t438_results values ('C10_audit', v_audit_count >= 3, 'audit rows: ' || v_audit_count);
end $$;

-- ── C8: the registration row (outside the DO — plain SQL) ───────────────
insert into t438_results
select 'C8_registration', count(*) = 1, 'schema_migrations row for 0130'
from supabase_migrations.schema_migrations where version = '0130';

-- ── C9: the ACL (public revoked, authenticated granted) ─────────────────
insert into t438_results
select 'C9_acl',
       count(*) = 0,
       'NO public EXECUTE on the four new RPCs'
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('fn_er_decide_proposal', 'fn_er_merge_parents', 'fn_er_unmerge_parents', 'fn_er_has_aggregation_state')
  and grantee = 'public';

insert into t438_results
select 'C9_acl_authenticated',
       count(*) = 4,
       'authenticated retains EXECUTE on all four RPCs'
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('fn_er_decide_proposal', 'fn_er_merge_parents', 'fn_er_unmerge_parents', 'fn_er_has_aggregation_state')
  and grantee = 'authenticated';

-- The results (everything rolled back after this SELECT).
select check_id, ok, detail from t438_results order by check_id;

ROLLBACK;
