-- ============================================================================
-- 0044_admin_created_accounts.sql — ADMIN-PROVISIONED LOGIN ACCOUNTS (T-079)
-- ============================================================================
-- Owner request (2026-08-29): "Implement the functionality in the desktop app
-- that allows an admin to create accounts for other users so they can log in
-- with their own accounts."
--
-- Before 0044 a login account could ONLY originate from a web self-signup:
--   web signup → auth.users insert → handle_new_auth_user() trigger (0002)
--   → user_profiles(status='pending') + account_approval_requests('pending')
--   → desktop ApprovalsTab → approve-signup-request EF → approve_account_request (0005).
--
-- 0044 adds the direct admin path for the same trigger-created row:
--   desktop AccountsTab (SuperAdmin) → create-user-account EF
--   → auth.admin.createUser (service role, email_confirm=true,
--     app_metadata.tenant_id = the TRUSTED admin path SEC-108 expects)
--   → trigger mints profile (pending) + approval request (pending)
--   → admin_create_user_account RPC (THIS migration) activates the profile,
--     assigns the chosen role and resolves the approval request in ONE
--     atomic transaction — the admin IS the approval, so no pending state
--     should linger for an account the admin just created.
--
-- SECURITY:
--   • SECURITY DEFINER — same posture as approve_account_request (0005):
--     the function writes user_profiles / role_assignments /
--     account_approval_requests, which the caller (the EF, using the
--     service role) could also write directly; the RPC exists to make the
--     three writes ATOMIC and to keep this activation logic server-side
--     (boundaries: backend owns domain operations).
--   • EXECUTE is REVOKED from public / anon / authenticated and granted
--     ONLY to service_role. Unlike the 0005 RPCs (which any authenticated
--     user can execute directly — the SEC-107/SEC-110 exposure class),
--     this function may only be called from server-side code.
--   • The function performs NO caller authentication itself — the EF is
--     the security boundary (super_admin check via extractAuthContext).
--     The role-existence check below prevents assigning a phantom role.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. admin_create_user_account — activate + role-assign + resolve, atomically
-- ----------------------------------------------------------------------------
create or replace function public.admin_create_user_account(
    p_auth_user_id        uuid,
    p_role_code           text,
    p_tenant_id           uuid,
    p_reviewer_profile_id uuid,
    p_decision_note       text default null
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

    return v_profile_id;
end;
$$;

comment on function public.admin_create_user_account(uuid, text, uuid, uuid, text) is
  'T-079: activates the trigger-created profile of an admin-created auth user, assigns the chosen role and resolves the auto-created approval request. Server-side only (service_role); the create-user-account Edge Function is the security boundary.';

-- ----------------------------------------------------------------------------
-- 2. Lock EXECUTE down to server-side callers only
-- ----------------------------------------------------------------------------
-- The 0005 approval RPCs are executable by any authenticated role (a known
-- exposure — see SEC-107/SEC-110 in the problem registry). This function can
-- mint accounts with ANY role including super_admin, so it must NOT be
-- callable directly by clients: revoke from everyone, grant to service_role
-- only (the EF's client).
revoke execute on function public.admin_create_user_account(uuid, text, uuid, uuid, text)
    from public, anon, authenticated;
grant execute on function public.admin_create_user_account(uuid, text, uuid, uuid, text)
    to service_role;
