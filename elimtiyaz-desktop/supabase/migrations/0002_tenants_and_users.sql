-- ============================================================================
-- 0002_tenants_and_users.sql
-- ============================================================================
-- Multi-tenant foundation + user identity + approval workflow.
--
-- Design principles:
--   1. `tenants` is the root of isolation. Every tenant-scoped table carries
--      `tenant_id` and is gated by RLS on that column (see 0019_rls_policies.sql).
--   2. `auth.users` (managed by Supabase Auth) is the canonical identity store.
--      `public.user_profiles` is the application-level profile, joined 1:1 with
--      `auth.users.id`. RLS reads `auth.uid()` to identify the caller.
--   3. `account_approval_requests` is the bridge between web self-registration
--      and admin approval. A web visitor signs up via Supabase Auth (Google OAuth
--      or email/password). Their `auth.users.id` is created in a "pending" state.
--      An administrator reviews the request in the desktop app, then either:
--        a) approves and assigns the new user to an existing `parents` profile
--           (matching by activation code, email, or national ID), OR
--        b) approves and creates a brand-new `parents` + `students` profile, OR
--        c) rejects with a reason.
--      Once approved, `user_profiles.status` transitions pending -> active and
--      `role_assignments` is populated with the appropriate role for the tenant.
--
-- Scale assumptions (per user requirements):
--   - ~5,000 total users
--   - ~300 daily active users
--   - ~50 peak concurrent users
-- These volumes are well within single-instance Postgres capacity with the
-- indexes declared in 0020_indexes.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. tenants — institutions served by this Supabase project
-- ----------------------------------------------------------------------------
create table public.tenants (
    id              uuid        primary key default public.gen_uuid(),
    slug            text        not null unique,                 -- url-safe identifier, e.g. 'elimtiyaz-boumerdes'
    name            text        not null,
    legal_name      text,                                        -- 'Sarl Elimtiyaz'
    tax_id          text,                                        -- NIF/RC
    address         text,
    city            text,
    postal_code     text,
    country         text        not null default 'DZ',
    phone           text,
    email           text,
    website         text,
    logo_path       text,                                        -- storage path under bucket 'tenant-assets'
    default_locale  text        not null default 'fr',           -- 'fr' | 'ar' | 'en'
    default_currency text       not null default 'DZD',
    timezone        text        not null default 'Africa/Algiers',
    is_active       boolean     not null default true,
    settings        jsonb       not null default '{}'::jsonb,    -- tenant-specific config (academic year start, etc.)
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz                                  -- soft delete; RLS hides deleted rows
);

comment on table public.tenants is 'Top-level multi-tenant isolation boundary. Every tenant-scoped table references tenants.id via tenant_id.';

-- ----------------------------------------------------------------------------
-- 2. user_profiles — application profile (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table public.user_profiles (
    id                  uuid        primary key default public.gen_uuid(),
    auth_user_id        uuid        not null unique,               -- FK to auth.users(id), enforced by trigger
    tenant_id           uuid        references public.tenants(id) on delete restrict,
    email               text        not null,
    display_name        text,
    avatar_url          text,
    phone               text,
    locale              text        not null default 'fr',
    status              text        not null default 'pending'      -- 'pending' | 'active' | 'suspended' | 'deleted'
                    check (status in ('pending', 'active', 'suspended', 'deleted')),
    approval_request_id uuid,                                       -- FK to account_approval_requests(id), set after approval
    last_login_at       timestamptz,
    last_login_ip       inet,
    last_user_agent     text,
    password_changed_at timestamptz,
    failed_login_count  integer     not null default 0,
    locked_until        timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create unique index user_profiles_email_tenant_uidx on public.user_profiles (tenant_id, email) where tenant_id is not null;
create unique index user_profiles_email_global_uidx on public.user_profiles (email) where tenant_id is null;

comment on table public.user_profiles is
  'Application-level user profile, 1:1 with auth.users. status=pending until an admin approves the registration request.';

-- ----------------------------------------------------------------------------
-- 3. account_approval_requests — web-initiated registration queue
-- ----------------------------------------------------------------------------
create table public.account_approval_requests (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        references public.tenants(id) on delete restrict,
    auth_user_id        uuid        not null unique,                -- the new auth.users.id from web signup
    email               text        not null,
    requested_role      text        not null default 'parent'       -- 'parent' | 'student' | 'staff'
                    check (requested_role in ('parent', 'student', 'staff')),
    requested_at        timestamptz not null default now(),

    -- The web visitor provides one or more identifiers so the admin can match
    -- them to an existing profile (activation code is the canonical path):
    activation_code     text,                                       -- 6-7 digit code issued at enrollment
    national_id         text,                                       -- Algerian NN (10 digits)
    phone               text,
    full_name           text,
    notes_from_user     text,                                       -- free-text message to the admin

    -- Profile to bind once approved (nullable until admin fills it in):
    target_parent_id    uuid,                                       -- FK to parents(id), filled by admin
    target_student_id   uuid,                                       -- FK to students(id), filled by admin (student role only)

    -- Admin decision:
    status              text        not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'expired')),
    reviewed_by         uuid,                                       -- FK to user_profiles(id) (admin)
    reviewed_at         timestamptz,
    decision_note       text,                                       -- admin's note (required if rejected)

    -- Audit metadata:
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    expires_at          timestamptz not null default (now() + interval '7 days') -- auto-expire pending requests
);

create index account_approval_requests_status_idx on public.account_approval_requests (status, requested_at desc);
create index account_approval_requests_tenant_idx on public.account_approval_requests (tenant_id, status);
create index account_approval_requests_activation_code_idx on public.account_approval_requests (activation_code) where activation_code is not null;
create index account_approval_requests_email_idx on public.account_approval_requests (email);

comment on table public.account_approval_requests is
  'Queue of web-initiated registration requests awaiting admin approval. Approved requests bind auth.users.id to a parent or student profile.';

-- ----------------------------------------------------------------------------
-- 4. sessions — app-level session telemetry (Supabase Auth manages JWTs; this
--    table records active sessions for audit + force-revocation on password
--    change per plan §12.04).
-- ----------------------------------------------------------------------------
create table public.sessions (
    id                  uuid        primary key default public.gen_uuid(),
    user_profile_id     uuid        not null references public.user_profiles(id) on delete cascade,
    tenant_id           uuid        references public.tenants(id) on delete cascade,
    supabase_session_id text,                                       -- Supabase Auth access token jti claim
    refresh_token_jti   text,
    ip_address          inet,
    user_agent          text,
    device_name         text,                                       -- 'Desktop Terminal', 'Android SM-A515F', etc.
    started_at          timestamptz not null default now(),
    last_activity_at    timestamptz not null default now(),
    expires_at          timestamptz not null,
    revoked_at          timestamptz,                                -- set when password changed or admin force-logout
    revoked_reason      text
);

create index sessions_user_idx on public.sessions (user_profile_id, started_at desc);
create index sessions_active_idx on public.sessions (tenant_id, expires_at) where revoked_at is null;

comment on table public.sessions is
  'Active session telemetry. Used for audit, force-revocation on password change (plan §12.04), and concurrent-session limits.';

-- ----------------------------------------------------------------------------
-- 5. Triggers: keep auth.users and user_profiles in sync
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_tenant_id uuid;
    v_user_profile_id uuid;
begin
    -- Determine tenant from raw_app_meta_data.tenant_id (if provided during
    -- invitation); otherwise default to the first tenant (single-tenant mode).
    v_tenant_id := new.raw_app_meta_data->>'tenant_id';
    if v_tenant_id is null then
        select id into v_tenant_id from public.tenants order by created_at limit 1;
    end if;

    insert into public.user_profiles (
        auth_user_id, tenant_id, email, display_name, avatar_url,
        phone, status, created_at, updated_at
    ) values (
        new.id, v_tenant_id, new.email,
        coalesce(new.raw_user_meta_data->>'full_name', new.email),
        new.raw_user_meta_data->>'avatar_url',
        new.raw_user_meta_data->>'phone',
        'pending',
        now(), now()
    )
    returning id into v_user_profile_id;

    -- Also create the matching approval request so the admin sees a row in the
    -- desktop "Pending Registrations" queue.
    insert into public.account_approval_requests (
        tenant_id, auth_user_id, email, requested_role,
        activation_code, national_id, phone, full_name,
        notes_from_user, status, requested_at
    ) values (
        v_tenant_id, new.id, new.email,
        coalesce(new.raw_user_meta_data->>'requested_role', 'parent'),
        new.raw_user_meta_data->>'activation_code',
        new.raw_user_meta_data->>'national_id',
        new.raw_user_meta_data->>'phone',
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'notes',
        'pending',
        now()
    );

    return new;
end;
$$;

-- The trigger fires AFTER a new auth.users row is inserted (sign-up or admin
-- invitation). Supabase Auth handles the actual password hashing / OAuth
-- exchange; we only mirror the identity into our app table.
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_auth_user();

comment on function public.handle_new_auth_user is
  'Triggered when a new auth.users row is created. Inserts a matching user_profiles row (status=pending) and an account_approval_requests row so the admin can review the registration.';

-- ----------------------------------------------------------------------------
-- 6. updated_at triggers (canonical pattern, reused on every table)
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

comment on function public.touch_updated_at is
  'Universal BEFORE UPDATE trigger that bumps updated_at. Attach to every table that has an updated_at column.';

create trigger tenants_touch_updated_at before update on public.tenants
    for each row execute function public.touch_updated_at();
create trigger user_profiles_touch_updated_at before update on public.user_profiles
    for each row execute function public.touch_updated_at();
create trigger account_approval_requests_touch_updated_at before update on public.account_approval_requests
    for each row execute function public.touch_updated_at();
