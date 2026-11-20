-- ============================================================================
-- 0054_auth_trigger_no_client_metadata.sql — RECONCILIATION MIGRATION (T-007)
-- ============================================================================
-- PROBLEM (discovered 2026-08-31 during the 10th recovery session's opening
-- live-DB inspection — registered as ARCH-011):
--
--   The LIVE Supabase project has migration 0054 registered in
--   `supabase_migrations.schema_migrations` with the name
--   "auth_trigger_no_client_metadata", but NO corresponding file existed
--   in the local repo (the local chain ended at 0052). Same drift class
--   as ARCH-009 / the 0053 reconciliation: applied directly via the
--   Management API SQL endpoint, never committed.
--
--   This file captures that SQL so a FRESH deployment of the canonical
--   chain matches the live project (ADR-001).
--
-- WHAT IT CHANGES (SEC-108, task T-007):
--   The `handle_new_auth_user()` trigger function previously trusted:
--     - raw_app_meta_data->>'tenant_id' (tenant injection at signup)
--     - raw_user_meta_data->>'requested_role' (role escalation at signup)
--     - raw_user_meta_data->>'phone' (untrusted client data)
--   for BOTH self-signup and admin-invite paths.
--
--   The rewrite distinguishes the two paths with a TRUSTED signal:
--     v_is_admin_invited := app_metadata.created_by_admin = 'true'
--   (set server-side by the create-user-account EF before
--   auth.admin.createUser — line 211 of that EF; self-signup CANNOT set
--   app_metadata via the public API).
--
--   Self-signup path now:
--     - tenant  = first active tenant (canonical default; 0023_seed)
--     - role    = hardcoded 'parent' (the only self-service role per
--                 plan §02.08) — never the client's requested_role
--     - phone   = NULL (collected later via the parent record)
--     - approval request captures ONLY email + hardcoded 'parent'
--       (activation_code / national_id / notes are admin-invite-only)
--
--   Admin-invite path unchanged in substance:
--     - tenant  = app_metadata.tenant_id (server-side EF), fallback =
--       first active tenant (defensive)
--     - role    = user_metadata.requested_role validated against the
--       CHECK constraint ('parent'|'student'|'staff'), else 'parent'
--     - full_name/phone/activation_code/national_id/notes = EF-supplied
--
-- SOURCE: definition extracted verbatim from the live DB via
-- `pg_get_functiondef` on 2026-08-31 (task MIG-TOKENS). Registered live
-- as schema_migrations version 0054 "auth_trigger_no_client_metadata".
--
-- IDEMPOTENCY: create-or-replace function → re-applying on the live DB
-- is a no-op; on a fresh DB it creates the function (the trigger that
-- calls it is created by migration 0002).
-- ============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path TO 'public', 'auth'
as $function$
declare
    v_is_admin_invited boolean;
    v_tenant_id uuid;
    v_user_profile_id uuid;
    v_requested_role text;
    v_full_name text;
    v_phone text;
begin
    -- ── Path detection ───────────────────────────────────────────────
    -- The create-user-account EF (server-side) sets app_metadata.created_by_admin=true
    -- before calling auth.admin.createUser. This is the ONLY trusted signal
    -- that the auth.users row came from an admin (not from self-signup).
    -- Self-signup (Google OAuth or email/password from the website) does
    -- NOT set this flag — Supabase's auth.users rows created via the public
    -- signUp endpoint have raw_app_meta_data = NULL or '{}' (the user
    -- cannot set app_metadata via the public API; only via admin API).
    v_is_admin_invited := coalesce(
        (new.raw_app_meta_data ->> 'created_by_admin') = 'true',
        false
    );

    -- ── Tenant resolution ────────────────────────────────────────────
    if v_is_admin_invited then
        -- Admin-invite path: the EF set app_metadata.tenant_id server-side
        -- (line 211 of create-user-account/index.ts). This is trusted.
        v_tenant_id := (new.raw_app_meta_data ->> 'tenant_id')::uuid;
        -- Fallback if the EF didn't set it (shouldn't happen — defensive).
        if v_tenant_id is null then
            select id into v_tenant_id from public.tenants
            where is_active = true
            order by created_at limit 1;
        end if;
    else
        -- Self-signup path: IGNORE client-supplied app_metadata.tenant_id
        -- (an attacker can set raw_user_meta_data freely; raw_app_meta_data
        -- is supposed to be admin-only but Supabase's OAuth flows may
        -- allow client-set app_metadata in some configurations — defense
        -- in depth). Use the canonical default tenant (0023_seed.sql).
        select id into v_tenant_id from public.tenants
        where is_active = true
        order by created_at limit 1;
    end if;

    -- ── Requested role resolution ───────────────────────────────────
    if v_is_admin_invited then
        -- Admin-invite path: the EF set user_metadata.requested_role via
        -- `toRequestedRole(body.role)` (line 78-82 of create-user-account/
        -- index.ts). This maps the 11-role wire code to 'parent' |
        -- 'student' | 'staff' (anything else becomes 'staff'). The actual
        -- role assignment happens in admin_create_user_account RPC (0044),
        -- NOT the trigger — the trigger just records what bucket the
        -- approval request will land in.
        v_requested_role := coalesce(
            new.raw_user_meta_data ->> 'requested_role',
            'parent'
        );
        -- Validate against the CHECK constraint ('parent' | 'student' | 'staff').
        -- If the EF supplied an invalid value, fall back to 'parent' (least-privilege).
        if v_requested_role not in ('parent', 'student', 'staff') then
            v_requested_role := 'parent';
        end if;
    else
        -- Self-signup path: HARDCODE 'parent'. Never trust the client-
        -- supplied raw_user_meta_data.requested_role. The only self-service
        -- role per plan §02.08 is 'parent' (the website is read-mostly
        -- for parents; staff accounts are admin-provisioned only).
        v_requested_role := 'parent';
    end if;

    -- ── Profile display fields ───────────────────────────────────────
    -- For admin-invite: use the EF-supplied full_name + phone (server-side).
    -- For self-signup: prefer the OAuth provider's user_metadata.full_name
    -- (Google returns it server-side via the OAuth flow — NOT client-
    -- controlled); fall back to email if absent. The client CANNOT inject
    -- a fake full_name via the Google OAuth flow (Google sets it server-side
    -- from the Google account profile). Phone is nullable; don't trust
    -- client-supplied phone (the bind_activation_code RPC will collect it
    -- later from the parent record).
    if v_is_admin_invited then
        v_full_name := new.raw_user_meta_data ->> 'full_name';
        v_phone := new.raw_user_meta_data ->> 'phone';
    else
        v_full_name := coalesce(
            new.raw_user_meta_data ->> 'full_name',
            new.raw_user_meta_data ->> 'name',
            new.email
        );
        v_phone := null;  -- collected later via the parent record
    end if;

    -- ── Insert user_profiles row ─────────────────────────────────────
    insert into public.user_profiles (
        auth_user_id, tenant_id, email, display_name, avatar_url,
        phone, status, created_at, updated_at
    ) values (
        new.id, v_tenant_id, new.email,
        v_full_name,
        new.raw_user_meta_data ->> 'avatar_url',
        v_phone,
        'pending',
        now(), now()
    )
    returning id into v_user_profile_id;

    -- ── Insert account_approval_requests row ─────────────────────────
    -- For self-signup: only the email + the hardcoded 'parent' role are
    -- captured. The other fields (activation_code, national_id, phone,
    -- full_name, notes_from_user) are NULL — they're collected later
    -- (activation_code via the bind-activation-code EF; national_id /
    -- phone / full_name via the parent record; notes via the admin
    -- approval UI).
    -- For admin-invite: the EF already supplied the values server-side;
    -- the approval request is auto-resolved by admin_create_user_account
    -- RPC (0044).
    insert into public.account_approval_requests (
        tenant_id, auth_user_id, email, requested_role,
        activation_code, national_id, phone, full_name,
        notes_from_user, status, requested_at
    ) values (
        v_tenant_id, new.id, new.email,
        v_requested_role,
        -- Only trust these fields for admin-invite path (server-side EF).
        case when v_is_admin_invited then new.raw_user_meta_data ->> 'activation_code' else null end,
        case when v_is_admin_invited then new.raw_user_meta_data ->> 'national_id' else null end,
        case when v_is_admin_invited then v_phone else null end,
        case when v_is_admin_invited then v_full_name else null end,
        case when v_is_admin_invited then new.raw_user_meta_data ->> 'notes' else null end,
        'pending',
        now()
    );

    return new;
end;
$function$;
