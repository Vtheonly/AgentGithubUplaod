-- ============================================================================
-- 0053_tenant_scoped_rbac.sql — RECONCILIATION MIGRATION (T-005)
-- ============================================================================
-- PROBLEM (discovered 2026-08-31 during the 10th recovery session's opening
-- live-DB inspection — registered as ARCH-011):
--
--   The LIVE Supabase project (hkvkefubghbbotgnteir) has migration 0053
--   registered in `supabase_migrations.schema_migrations` with the name
--   "tenant_scoped_rbac", but NO corresponding file exists in the local
--   repo (the local chain ended at 0052). The SQL was applied directly
--   via the Management API SQL endpoint by a previous session/actor that
--   did not commit the migration file — the same drift class as ARCH-009
--   (T-091's 0051 reconciliation).
--
--   This file reconciles the drift: it captures the tenant-scoped RBAC
--   SQL that is live but was missing from the repo, so a FRESH database
--   deployment of the canonical chain (ADR-001) produces the same schema
--   as the live project.
--
-- WHAT IT CHANGES (TENANT-100 / TENANT-101 / TENANT-102, task T-005):
--   1. Adds `public.is_global_admin()` — true when the caller's
--      user_profiles row has tenant_id IS NULL (the global-admin concept
--      from the 0002 schema comment, previously unwired).
--   2. Rewrites `current_user_roles()` — now scoped to
--      `role_assignments.tenant_id = current_tenant_id()` (was: the union
--      of roles across ALL tenants → cross-tenant role inheritance), with
--      the global-admin path returning super_admin directly (global admins
--      hold no role_assignments rows; role_assignments.tenant_id is NOT NULL).
--   3. Rewrites `current_user_permissions()` — same tenant scoping for the
--      role_ids CTE + the global-admin path granting every permission code
--      (matches the prior service_role-style "all permissions" behavior and
--      makes the EF shared helper `extractAuthContext` work for non-
--      super_admin global admins — partial SEC-109 mitigation).
--   4. RLS policies re-scoped:
--        - tenants_select:      id = current_tenant_id() OR is_global_admin()
--        - tenants_update:      is_global_admin() (was: any super_admin)
--        - tenants_insert:      is_global_admin() (was: any super_admin)
--        - tenants_delete:      is_global_admin() (was: any super_admin —
--          the cascade-to-all-tenant-data exploit from TENANT-102)
--        - user_profiles_admin_update: is_global_admin() OR (row tenant =
--          current_tenant_id() AND has_role('super_admin')) — a per-tenant
--          super_admin can now only admin-update profiles in their own
--          tenant (was: every profile in the DB, incl. tenant-hopping
--          via `UPDATE user_profiles SET tenant_id = ...`).
--
-- SOURCE: definitions extracted verbatim from the live DB via
-- `pg_get_functiondef` / `pg_policies` on 2026-08-31 (task MIG-TOKENS).
-- Registered live as schema_migrations version 0053 "tenant_scoped_rbac".
--
-- IDEMPOTENCY: create-or-replace functions + drop-if-exists/create
-- policies → re-applying on the live DB is a no-op; on a fresh DB it
-- creates everything.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Global-admin predicate (TENANT-101 fix foundation)
-- ----------------------------------------------------------------------------
create or replace function public.is_global_admin()
returns boolean
language sql
stable
as $$
    select exists (
        select 1 from public.user_profiles
        where auth_user_id = auth.uid()
          and tenant_id is null
    );
$$;

-- ----------------------------------------------------------------------------
-- 2. Tenant-scoped role resolver (TENANT-100)
-- ----------------------------------------------------------------------------
create or replace function public.current_user_roles()
returns text[]
language sql
stable
as $$
    -- Global admins (user_profiles.tenant_id IS NULL) implicitly hold
    -- super_admin — they have no role_assignments rows (role_assignments.
    -- tenant_id is NOT NULL per 0003) so the per-tenant lookup below
    -- would return '{}' for them. Return super_admin directly so the
    -- RBAC resolver treats them as super_admin (TENANT-101 fix).
    select case
        when public.is_global_admin()
        then array['super_admin']::text[]
        else coalesce(array_agg(r.code), '{}')
    end
    from public.role_assignments ra
    join public.roles r on r.id = ra.role_id
    where ra.user_profile_id = public.current_user_profile_id()
      and ra.tenant_id = public.current_tenant_id()  -- TENANT-SCOPE FIX (TENANT-100)
      and ra.revoked_at is null;
$$;

-- ----------------------------------------------------------------------------
-- 3. Tenant-scoped permission resolver (TENANT-100)
-- ----------------------------------------------------------------------------
create or replace function public.current_user_permissions()
returns text[]
language sql
stable
as $$
    -- Global admins receive every permission code (matches the prior
    -- service_role-style "all permissions" behavior, but now via the
    -- RBAC resolver so the EF shared-helper `extractAuthContext` path
    -- also works for non-super_admin global admins — SEC-109 partial).
    select case
        when public.is_global_admin()
        then coalesce(array_agg(p.code), '{}')
        else (
            -- Effective permissions = default matrix for current roles
            -- IN THE CURRENT TENANT + tenant overrides (deny wins).
            with role_ids as (
                select role_id from public.role_assignments
                where user_profile_id = public.current_user_profile_id()
                  and tenant_id = public.current_tenant_id()  -- TENANT-SCOPE FIX (TENANT-100)
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
            ) effective
        )
    end
    from public.permissions p;
$$;

-- ----------------------------------------------------------------------------
-- 4. RLS policy re-scoping (TENANT-101 / TENANT-102)
-- ----------------------------------------------------------------------------
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
    for select to authenticated
    using (
        id = public.current_tenant_id()
        or public.is_global_admin()
    );

drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants
    for update to authenticated
    using (public.is_global_admin())
    with check (public.is_global_admin());

drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants
    for insert to authenticated
    with check (public.is_global_admin());

drop policy if exists tenants_delete on public.tenants;
create policy tenants_delete on public.tenants
    for delete to authenticated
    using (public.is_global_admin());

drop policy if exists user_profiles_admin_update on public.user_profiles;
create policy user_profiles_admin_update on public.user_profiles
    for update to authenticated
    using (
        public.is_global_admin()
        or (
            tenant_id = public.current_tenant_id()
            and public.has_role('super_admin')
        )
    )
    with check (
        public.is_global_admin()
        or (
            tenant_id = public.current_tenant_id()
            and public.has_role('super_admin')
        )
    );
