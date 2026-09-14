-- ============================================================================
-- 0097_personnel_account_linkage.sql — ACCOUNT ↔ EMPLOYEE LINKAGE (T-371 / WORKFORCE-501)
-- ============================================================================
-- Owner mandate (2026-09-14, 70th session): "link the account created in the
-- Admin Settings to an employee. When the employee logs in, they should see
-- their own profile, tasks, responsibilities… the account is properly
-- associated with the selected employee from the moment it is created."
--
-- The linkage COLUMN shipped in 0009 (personnel.user_id references
-- user_profiles(id), personnel_user_idx) and the read side has been complete
-- since 0019 (RLS personnel_self) + the desktop observeByUserId contract —
-- but NO flow ever populated it (live census 2026-09-14: 0 of 3 rows bound).
-- The T-079 admin-creation RPC (0044) activates the profile, assigns the
-- role and resolves the approval request; this migration extends it so the
-- SuperAdmin's employee selection binds personnel.user_id in the SAME atomic
-- transaction.
--
-- Changes:
--   1. admin_create_user_account gains two OPTIONAL parameters (CREATE OR
--      REPLACE with trailing defaults — backward compatible; the EF's named-
--      argument call keeps working):
--        p_personnel_id uuid — the employee to bind (null = unlinked account,
--                              the T-079 behaviour unchanged)
--        p_email       text  — the login email, used to backfill
--                              personnel.email when the record has none
--   2. Guards (distinct errcodes so the EF maps clean 4xx responses):
--        P0002  personnel not found in this tenant (or soft-deleted)
--        23505  the employee is already bound to a DIFFERENT account
--        23505  the new profile is already bound to ANOTHER employee
--      Re-binding the SAME (profile ↔ personnel) pair is a no-op (idempotent
--      retry semantics).
--   3. Partial UNIQUE index — at most ONE active personnel row per account:
--      the 1:1 invariant enforced at the storage layer.
--
-- SECURITY: unchanged posture — SECURITY DEFINER, EXECUTE restricted to
-- service_role (re-asserted below), the EF remains the security boundary
-- (super_admin only). The personnel UPDATE inside the RPC writes through the
-- definer (service role), NOT through client RLS — clients still cannot
-- write personnel.user_id directly (the 0019 personnel_admin policy is
-- role-gated, and this column is only ever set by this RPC / the EF).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. admin_create_user_account — activate + role-assign + resolve + LINK
-- ----------------------------------------------------------------------------
create or replace function public.admin_create_user_account(
    p_auth_user_id        uuid,
    p_role_code           text,
    p_tenant_id           uuid,
    p_reviewer_profile_id uuid,
    p_decision_note       text default null,
    p_personnel_id        uuid default null,
    p_email               text default null
)
returns uuid  -- the activated user_profiles.id
language plpgsql
security definer
set search_path = public
as $$
declare
    v_profile_id  uuid;
    v_role_id     uuid;
    v_request_id  uuid;
    v_personnel_id uuid;
    v_bound_user  uuid;
    v_other_id    uuid;
begin
    -- 1. The auth user must exist and have a trigger-created profile.
    select up.id
      into v_profile_id
      from public.user_profiles up
     where up.auth_user_id = p_auth_user_id
       and up.tenant_id = p_tenant_id
       for update;

    if v_profile_id is null then
        raise exception 'user profile not found for auth user %', p_auth_user_id
          using errcode = 'P0002';
    end if;

    -- 2. The requested role must exist (prevents phantom-role assignment).
    select r.id
      into v_role_id
      from public.roles r
     where r.code = p_role_code;

    if v_role_id is null then
        raise exception 'unknown role code %', p_role_code
          using errcode = '22023';  -- invalid_parameter_value
    end if;

    -- 3. Activate the profile (the admin IS the approval).
    update public.user_profiles
       set status = 'active',
           updated_at = now()
     where id = v_profile_id;

    -- 4. Assign the chosen role (idempotent on conflict).
    insert into public.role_assignments (user_profile_id, tenant_id, role_id, assigned_by)
    values (v_profile_id, p_tenant_id, v_role_id, p_reviewer_profile_id)
    on conflict (user_profile_id, tenant_id, role_id) where revoked_at is null
    do nothing;

    -- 5. Resolve the auto-created approval request so the Inscriptions
    --    queue stays clean — the audit trail records who created the
    --    account and when.
    update public.account_approval_requests
       set status = 'approved',
           reviewed_by = p_reviewer_profile_id,
           reviewed_at = now(),
           decision_note = coalesce(p_decision_note, 'Compte créé directement par un administrateur')
     where auth_user_id = p_auth_user_id
       and status = 'pending'
    returning id into v_request_id;

    -- 6. Link the profile to the approval request (mirrors 0005 behaviour).
    if v_request_id is not null then
        update public.user_profiles
           set approval_request_id = v_request_id
         where id = v_profile_id;
    end if;

    -- 7. T-371 (WORKFORCE-501) — bind the employee record to the account,
    --    in the SAME transaction. Guards BEFORE any write:
    if p_personnel_id is not null then
        select p.id, p.user_id
          into v_personnel_id, v_bound_user
          from public.personnel p
         where p.id = p_personnel_id
           and p.tenant_id = p_tenant_id
           and p.deleted_at is null
           for update;

        if v_personnel_id is null then
            raise exception 'personnel % not found in tenant % (or deleted)', p_personnel_id, p_tenant_id
              using errcode = 'P0002';
        end if;

        if v_bound_user is not null and v_bound_user <> v_profile_id then
            raise exception 'personnel % is already linked to another account (%)', p_personnel_id, v_bound_user
              using errcode = '23505';  -- unique_violation semantics
        end if;

        -- The new profile must not already belong to a DIFFERENT employee.
        if v_bound_user is null then
            select p.id
              into v_other_id
              from public.personnel p
             where p.user_id = v_profile_id
               and p.id <> p_personnel_id
               and p.deleted_at is null
             limit 1;

            if v_other_id is not null then
                raise exception 'profile % is already linked to another personnel (%)', v_profile_id, v_other_id
                  using errcode = '23505';
            end if;
        end if;

        -- Backfill the contact email on the employee record when absent so
        -- the two rows agree with each other going forward.
        update public.personnel
           set user_id = v_profile_id,
               email = coalesce(email, nullif(trim(p_email), '')),
               updated_at = now()
         where id = p_personnel_id
           and (user_id is null or user_id = v_profile_id);
    end if;

    return v_profile_id;
end;
$$;

comment on function public.admin_create_user_account(uuid, text, uuid, uuid, text, uuid, text) is
  'T-079/T-371: activates the trigger-created profile of an admin-created auth user, assigns the chosen role, resolves the auto-created approval request, and (T-371) optionally binds the selected employee record via personnel.user_id — one atomic transaction. Server-side only (service_role); the create-user-account Edge Function is the security boundary.';

-- ----------------------------------------------------------------------------
-- 2. Drop the OLD 5-param overload + re-assert the EXECUTE lockdown
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE with a DIFFERENT parameter list creates a NEW overload;
-- it does NOT replace the 0044 function. Two overloads sharing the same
-- parameter NAMES (p_auth_user_id, p_role_code, …) make every named-notation
-- call (the EF's supabase.rpc) fail with "function name is not unique" —
-- so the old signature is DROPPED explicitly. The new 7-param function
-- remains callable with the original five named arguments (the two new
-- parameters carry defaults), so the deployed EF keeps working during the
-- migration window even before its personnel_id update ships.
drop function if exists public.admin_create_user_account(uuid, text, uuid, uuid, text);

revoke execute on function public.admin_create_user_account(uuid, text, uuid, uuid, text, uuid, text)
    from public, anon, authenticated;
grant execute on function public.admin_create_user_account(uuid, text, uuid, uuid, text, uuid, text)
    to service_role;

-- ----------------------------------------------------------------------------
-- 3. One account ↔ at most one active employee — storage-level invariant
-- ----------------------------------------------------------------------------
-- Live pre-check (2026-09-14 census): 0 rows with user_id set, 0 duplicates
-- → the index applies cleanly. The partial predicate keeps archived rows
-- (deleted_at not null) out of the invariant so soft-deleted history never
-- blocks a re-hire + new account.
create unique index if not exists personnel_active_account_uq
    on public.personnel (user_id)
    where user_id is not null and deleted_at is null;
