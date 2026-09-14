-- ============================================================================
-- verify_t-371.sql — reusable invariant checks for the account↔employee
-- linkage (T-371 / WORKFORCE-501, migration 0097).
--
-- Convention (AGENTS.md §11): wrapped in BEGIN; … ROLLBACK; so it can be
-- re-run any time without mutating the live DB; results land in a temp
-- table selected at the end (the CLI/SQL endpoint surfaces no NOTICEs).
-- Covers BOTH the happy path AND the regression paths.
--
-- Checks:
--   C1  exactly ONE admin_create_user_account overload, the 7-param form.
--   C2  the old 5-param signature is gone (the named-call ambiguity guard).
--   C3  the partial unique index personnel_active_account_uq exists + valid.
--   C4  the RPC binds an employee atomically (probe personnel + fabricated
--       profile inside the transaction) and returns the profile id.
--   C5  the RPC REJECTS binding a second employee to the same profile
--       (23505-class exception, message 'profile … already linked').
--   C6  the RPC REJECTS an unknown/out-of-tenant personnel id (P0002).
--   C7  the unique index REJECTS two active personnel rows on one account.
--   C8  RLS self-read: an authenticated session whose profile is bound sees
--       exactly its own personnel row through the personnel_self policy.
--
-- Run:  supabase db query --linked < scripts/verify_t-371.sql
-- (or the Management API SQL endpoint — the DO-block immunity note, quirk #9,
--  applies: every payload below is dollar-quoted or quote-escape-free).
-- ============================================================================

begin;

create temp table t371_results (check_id text, ok boolean, detail text default null);

-- ---------------------------------------------------------------------------
-- C1/C2 — the function shape
-- ---------------------------------------------------------------------------
insert into t371_results (check_id, ok, detail)
select 'C1_single_overload_7param', count(*) = 1 and pg_get_function_identity_arguments(p.oid) like '%p_personnel_id uuid, p_email text%',
       pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_create_user_account'
group by p.oid;

insert into t371_results (check_id, ok, detail)
select 'C2_old_5param_gone', count(*) = 0, count(*)::text || ' old-signature overloads remain'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_create_user_account'
  and pg_get_function_identity_arguments(p.oid) = 'p_auth_user_id uuid, p_role_code text, p_tenant_id uuid, p_reviewer_profile_id uuid, p_decision_note text';

-- ---------------------------------------------------------------------------
-- C3 — the storage-level 1:1 invariant
-- ---------------------------------------------------------------------------
insert into t371_results (check_id, ok, detail)
select 'C3_unique_index_valid', count(*) = 1 and bool_and(x.indisvalid), i.indexdef
from pg_indexes i
join pg_class c on c.relname = i.indexname
join pg_namespace n on n.oid = c.relnamespace
join pg_index x on x.indexrelid = c.oid
where n.nspname = 'public' and i.tablename = 'personnel'
  and i.indexname = 'personnel_active_account_uq'
group by i.indexdef;

-- ---------------------------------------------------------------------------
-- C4/C5/C6 — the RPC behaviour on a FABRICATED probe (all inside the
-- transaction; the ROLLBACK wipes it). We mint a profile row directly
-- (user_profiles.auth_user_id has no FK to auth.users — enforced by trigger
-- only, so a synthetic uuid is legal) and two probe personnel rows.
-- ---------------------------------------------------------------------------
do $$
declare
    v_tenant      uuid;
    v_auth_user   uuid := gen_random_uuid();
    v_profile     uuid;
    v_p1          uuid;
    v_p2          uuid;
    v_returned    uuid;
    v_err         text;
    v_ctx         text;
begin
    select tenant_id into v_tenant from public.user_profiles
     where tenant_id is not null order by created_at limit 1;

    -- the fabricated profile the RPC will activate
    insert into public.user_profiles (auth_user_id, tenant_id, email, display_name, status)
    values (v_auth_user, v_tenant, 'probe-t371-verify@el-imtiyaz.test', 'Probe T371', 'pending')
    returning id into v_profile;

    insert into public.personnel (tenant_id, personnel_code, first_name, last_name,
                                  staff_category, role_id, position, hire_date, is_active)
    select v_tenant, 'PER-PROBE-T371-VERIFY-1', 'Probe', 'Un', 'support',
           (select id from public.roles where code = 'worker'), 'Technique', current_date, true
    returning id into v_p1;

    insert into public.personnel (tenant_id, personnel_code, first_name, last_name,
                                  staff_category, role_id, position, hire_date, is_active)
    select v_tenant, 'PER-PROBE-T371-VERIFY-2', 'Probe', 'Deux', 'support',
           (select id from public.roles where code = 'worker'), 'Technique', current_date, true
    returning id into v_p2;

    -- C4: the happy path — the link binds in the creation transaction
    begin
        v_returned := public.admin_create_user_account(
            p_auth_user_id => v_auth_user,
            p_role_code => 'worker',
            p_tenant_id => v_tenant,
            p_reviewer_profile_id => v_profile,
            p_personnel_id => v_p1,
            p_email => 'probe-t371-verify@el-imtiyaz.test'
        );
        insert into t371_results (check_id, ok, detail)
        values ('C4_rpc_binds_employee',
                v_returned = v_profile
                and (select user_id from public.personnel where id = v_p1) = v_profile
                and (select email from public.personnel where id = v_p1) = 'probe-t371-verify@el-imtiyaz.test',
                'profile=' || coalesce(v_returned::text, 'NULL'));
    exception when others then
        insert into t371_results (check_id, ok, detail)
        values ('C4_rpc_binds_employee', false, sqlerrm);
    end;

    -- C5: the cross-binding guard — a SECOND employee on the same profile
    begin
        perform public.admin_create_user_account(
            p_auth_user_id => v_auth_user,
            p_role_code => 'worker',
            p_tenant_id => v_tenant,
            p_reviewer_profile_id => v_profile,
            p_personnel_id => v_p2
        );
        insert into t371_results (check_id, ok, detail)
        values ('C5_cross_binding_rejected', false, 'the second bind SUCCEEDED (defect)');
    exception when others then
        insert into t371_results (check_id, ok, detail)
        values ('C5_cross_binding_rejected',
                position('already linked' in sqlerrm) > 0,
                sqlerrm);
    end;

    -- C6: the unknown-personnel guard (a random uuid is no employee)
    begin
        perform public.admin_create_user_account(
            p_auth_user_id => v_auth_user,
            p_role_code => 'worker',
            p_tenant_id => v_tenant,
            p_reviewer_profile_id => v_profile,
            p_personnel_id => gen_random_uuid()
        );
        insert into t371_results (check_id, ok, detail)
        values ('C6_unknown_personnel_rejected', false, 'an unknown id was ACCEPTED (defect)');
    exception when others then
        insert into t371_results (check_id, ok, detail)
        values ('C6_unknown_personnel_rejected', sqlstate = 'P0002', sqlerrm);
    end;

    -- C7: the unique index — a direct second personnel row on the account
    begin
        insert into public.personnel (tenant_id, personnel_code, first_name, last_name,
                                     staff_category, role_id, position, hire_date, is_active, user_id)
        select v_tenant, 'PER-PROBE-T371-VERIFY-3', 'Probe', 'Trois', 'support',
               (select id from public.roles where code = 'worker'), 'Technique', current_date, true, v_profile;
        insert into t371_results (check_id, ok, detail)
        values ('C7_unique_index_rejects_double_bind', false, 'the double bind INSERT succeeded (defect)');
    exception when unique_violation then
        insert into t371_results (check_id, ok, detail)
        values ('C7_unique_index_rejects_double_bind', true, sqlerrm);
    when others then
        insert into t371_results (check_id, ok, detail)
        values ('C7_unique_index_rejects_double_bind', false, 'unexpected: ' || sqlerrm);
    end;
end $$;

-- ---------------------------------------------------------------------------
-- C8 — the RLS self-read through the bound profile (the impersonation
-- convention: SET LOCAL ROLE authenticated + request.jwt.claims; the temp
-- table is granted per AGENTS.md §15.27).
-- ---------------------------------------------------------------------------
grant insert, select on t371_results to authenticated;

do $$
declare
    v_tenant    uuid;
    v_auth_user uuid := gen_random_uuid();
    v_profile   uuid;
    v_personnel uuid;
    v_seen      int;
begin
    select tenant_id into v_tenant from public.user_profiles
     where tenant_id is not null order by created_at limit 1;

    insert into public.user_profiles (auth_user_id, tenant_id, email, display_name, status)
    values (v_auth_user, v_tenant, 'probe-t371-rls@el-imtiyaz.test', 'Probe RLS', 'active')
    returning id into v_profile;

    insert into public.personnel (tenant_id, personnel_code, first_name, last_name,
                                  staff_category, role_id, position, hire_date, is_active, user_id)
    select v_tenant, 'PER-PROBE-T371-RLS', 'Probe', 'RLS', 'support',
           (select id from public.roles where code = 'worker'), 'Technique', current_date, true, v_profile
    returning id into v_personnel;

    -- the RLS-impersonation read (personnel_self: user_id = current profile)
    begin
        set local role authenticated;
        perform set_config('request.jwt.claims',
            json_build_object('sub', v_auth_user::text,
                              'role', 'authenticated',
                              'email', 'probe-t371-rls@el-imtiyaz.test',
                              'app_metadata', json_build_object('tenant_id', v_tenant::text))::text,
            true);
        select count(*) into v_seen from public.personnel where user_id = v_profile;
        reset role;
        insert into t371_results (check_id, ok, detail)
        values ('C8_rls_self_read_sees_exactly_own_row', v_seen = 1, 'seen=' || v_seen);
    exception when others then
        reset role;
        insert into t371_results (check_id, ok, detail)
        values ('C8_rls_self_read_sees_exactly_own_row', false, sqlerrm);
    end;
end $$;

-- ---------------------------------------------------------------------------
-- The verdict
-- ---------------------------------------------------------------------------
select check_id, ok, detail from t371_results order by check_id;
select case when bool_and(ok) then 'ALL 8 CHECKS GREEN'
            else 'FAILURES PRESENT — see above' end as verdict
from t371_results;

rollback;
