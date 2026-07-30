-- ============================================================================
-- 0003_rbac.sql
-- ============================================================================
-- Role-Based Access Control.
--
-- Three tables implement the matrix:
--   - `roles`              — the 11-role enum (SuperAdmin, FinancialOfficer,
--                            Teacher, SupportStaff, Manager, Buyer, Driver,
--                            WarehouseWorker, Worker, Parent, Student)
--   - `permissions`        — ~50 atomic permissions grouped by domain
--   - `role_permissions`   — many-to-many default matrix (admin can override
--                            per-tenant via `tenant_role_overrides`)
--   - `role_assignments`   — effective role per user within a tenant (a user
--                            may hold different roles across tenants)
--
-- RLS uses `public.current_user_roles()` (defined here) to resolve permissions
-- without round-tripping through the application layer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. roles
-- ----------------------------------------------------------------------------
create table public.roles (
    id              uuid        primary key default public.gen_uuid(),
    code            text        not null unique,                  -- 'super_admin', 'financial_officer', etc.
    label_fr        text        not null,
    label_ar        text,
    label_en        text,
    description     text,
    staff_category  text        check (staff_category in ('administration', 'teaching', 'support', 'medical', null)),
    is_staff_role   boolean     not null default false,           -- true for desktop/mobile access
    is_web_role     boolean     not null default false,           -- true for web portal access
    sort_order      integer     not null default 100,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

comment on column public.roles.is_staff_role is 'true for SuperAdmin, FinancialOfficer, Teacher, SupportStaff, Manager, Buyer, Driver, WarehouseWorker, Worker (desktop + mobile access).';
comment on column public.roles.is_web_role is 'true for Parent, Student (web portal access only).';

-- ----------------------------------------------------------------------------
-- 2. permissions
-- ----------------------------------------------------------------------------
create table public.permissions (
    id              uuid        primary key default public.gen_uuid(),
    code            text        not null unique,                  -- 'view_roster', 'enter_grades', 'manage_pricing', etc.
    label_fr        text        not null,
    label_ar        text,
    label_en        text,
    domain          text        not null check (domain in (
                        'crm', 'academic', 'financial', 'expense', 'hr',
                        'workflow', 'routing', 'settings', 'backup', 'ai',
                        'operations', 'workforce', 'audit', 'notification', 'calendar'
                    )),
    description     text,
    sort_order      integer     not null default 100,
    created_at      timestamptz not null default now()
);

create index permissions_domain_idx on public.permissions (domain, sort_order);

-- ----------------------------------------------------------------------------
-- 3. role_permissions — default matrix (seeded in 0023_seed.sql)
-- ----------------------------------------------------------------------------
create table public.role_permissions (
    role_id         uuid        not null references public.roles(id) on delete cascade,
    permission_id   uuid        not null references public.permissions(id) on delete cascade,
    primary key (role_id, permission_id)
);

-- ----------------------------------------------------------------------------
-- 4. tenant_role_overrides — per-tenant additions/removals (admin can edit
--    via RBAC Matrix Editor in the desktop app)
-- ----------------------------------------------------------------------------
create table public.tenant_role_overrides (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    role_id         uuid        not null references public.roles(id) on delete cascade,
    permission_id   uuid        not null references public.permissions(id) on delete cascade,
    action          text        not null check (action in ('grant', 'deny')),
    created_by      uuid,                                          -- user_profiles.id of admin who set the override
    created_at      timestamptz not null default now(),
    unique (tenant_id, role_id, permission_id)
);

create index tenant_role_overrides_lookup_idx on public.tenant_role_overrides (tenant_id, role_id);

-- ----------------------------------------------------------------------------
-- 5. role_assignments — effective user_role within a tenant
-- ----------------------------------------------------------------------------
create table public.role_assignments (
    id              uuid        primary key default public.gen_uuid(),
    user_profile_id uuid        not null references public.user_profiles(id) on delete cascade,
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    role_id         uuid        not null references public.roles(id) on delete restrict,
    assigned_by     uuid,                                          -- user_profiles.id of admin
    assigned_at     timestamptz not null default now(),
    revoked_at      timestamptz                                    -- set when role is removed
);

create unique index role_assignments_active_uidx on public.role_assignments (user_profile_id, tenant_id, role_id) where revoked_at is null;

create index role_assignments_user_idx on public.role_assignments (user_profile_id, tenant_id) where revoked_at is null;
create index role_assignments_tenant_role_idx on public.role_assignments (tenant_id, role_id) where revoked_at is null;

comment on table public.role_assignments is
  'Effective role per user within a tenant. A user may hold different roles across tenants. RLS uses this to resolve permissions.';

-- ----------------------------------------------------------------------------
-- 6. Helper functions for RLS
-- ----------------------------------------------------------------------------
create or replace function public.current_user_profile_id()
returns uuid
language sql
stable
as $$
    select id from public.user_profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
    -- Tenant is resolved from the user's profile or from the JWT app metadata.
    select coalesce(
        (select tenant_id from public.user_profiles where auth_user_id = auth.uid() limit 1),
        (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    );
$$;

create or replace function public.current_user_roles()
returns text[]
language sql
stable
as $$
    select coalesce(array_agg(r.code), '{}')
    from public.role_assignments ra
    join public.roles r on r.id = ra.role_id
    where ra.user_profile_id = public.current_user_profile_id()
      and ra.revoked_at is null;
$$;

create or replace function public.current_user_permissions()
returns text[]
language sql
stable
as $$
    -- Effective permissions = default matrix for current roles + tenant overrides
    -- (overrides can grant OR deny). Denied overrides win.
    with role_ids as (
        select role_id from public.role_assignments
        where user_profile_id = public.current_user_profile_id()
          and revoked_at is null
    ),
    default_perms as (
        select p.code, true as granted
        from role_permissions rp
        join permissions p on p.id = rp.permission_id
        where rp.role_id in (select role_id from role_ids)
    ),
    overrides as (
        select p.code, (o.action = 'grant') as granted
        from tenant_role_overrides o
        join permissions p on p.id = o.permission_id
        where o.tenant_id = public.current_tenant_id()
          and o.role_id in (select role_id from role_ids)
    )
    select coalesce(array_agg(distinct code), '{}')
    from (
        select code from default_perms where code not in (select code from overrides where granted = false)
        union
        select code from overrides where granted = true
    ) effective;
$$;

create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
as $$
    select p_code = any(public.current_user_permissions());
$$;

create or replace function public.has_role(r_code text)
returns boolean
language sql
stable
as $$
    select r_code = any(public.current_user_roles());
$$;

create or replace function public.has_any_role(r_codes text[])
returns boolean
language sql
stable
as $$
    select exists (
        select 1 from unnest(r_codes) as code
        where code = any(public.current_user_roles())
    );
$$;

comment on function public.current_user_profile_id is 'Resolve the caller''s user_profiles.id from auth.uid(). Stable, RLS-safe.';
comment on function public.current_tenant_id is 'Resolve the caller''s tenant_id from their profile or JWT app_metadata. Stable, RLS-safe.';
comment on function public.current_user_roles is 'Array of role codes currently assigned to the caller.';
comment on function public.current_user_permissions is 'Array of effective permission codes after applying tenant overrides (deny wins).';
comment on function public.has_permission is 'Convenience predicate for inline RLS policies: has_permission(''view_roster'').';
comment on function public.has_role is 'Convenience predicate: has_role(''super_admin'').';
comment on function public.has_any_role is 'Convenience predicate: has_any_role(array[''super_admin'',''financial_officer'']).';

-- ----------------------------------------------------------------------------
-- 7. updated_at triggers
-- ----------------------------------------------------------------------------
create trigger roles_touch_updated_at before update on public.roles
    for each row execute function public.touch_updated_at();
