-- 0099_rls_helper_security_definer_parity.sql
-- ============================================================================
-- RLS-401/500 (T-376) — restore the five RLS helper functions to the LIVE
-- production shape (SECURITY DEFINER + search_path=public) and restore the
-- `auth_user_id = auth.uid()` branch of user_profiles_select_own.
--
-- WHAT WAS WRONG (fresh-provision regression, found on the empty clone
-- vebfehrpzajhstyhinnw on 2026-09-15): every authenticated PostgREST request to
-- a tenant-scoped table failed with HTTP 500 `54001 stack depth limit
-- exceeded`, or HTTP 401 when no session token was attached. The desktop app
-- therefore presented a blank UI with a wall of 401s in the devtools console.
-- It was NOT a credential/session problem — signing in again cannot fix it.
--
-- WHY IT HAPPENED — the committed chain had drifted from the live database it
-- was reverse-engineered from (two divergences):
--   1. 0003_rbac.sql creates current_user_profile_id(), current_tenant_id(),
--      has_role(), has_any_role(), has_permission() WITHOUT `SECURITY DEFINER`.
--      LIVE production has secdef=true + `SET search_path TO 'public'` on all
--      five. RLS is FORCEd on user_profiles/role_assignments/roles/tenants
--      (relforcerowsecurity=true), so only a SECURITY DEFINER function owned by
--      `postgres` (rolbypassrls=true) can read those tables from inside a policy
--      without re-entering that policy.
--   2. 0019_rls_policies.sql creates user_profiles_select_own WITHOUT the
--      leading `auth_user_id = auth.uid()` disjunct present in LIVE. That
--      branch is the short-circuit: it answers "this is my own row" without
--      calling any helper function at all.
--   Combined: evaluating any policy on public.user_profiles called
--   current_user_profile_id(), whose body is
--   `select id from public.user_profiles where auth_user_id = auth.uid()` —
--   which re-evaluates the same policy, which calls the same function… until
--   the 2048 kB stack limit is hit. All 83 policy-guarded tables inherited the
--   failure through their predicates, so the whole backend looked "locked".
--
-- WHAT THIS MIGRATION CHANGES (append-only; 0003/0019 are forensic evidence and
-- are NEVER edited — AGENTS.md §15.9 / ADR-001):
--   A. Recreates the five helpers verbatim as they exist in LIVE production
--      (secdef + `SET search_path TO 'public'`, identical bodies).
--   B. Recreates user_profiles_select_own with the LIVE predicate, restoring the
--      `auth_user_id = auth.uid()` fast-path disjunct first.
--
-- VERIFIED (empty clone, read-only comparison against production):
--   * pg_proc: 100/100 public functions, 0 missing, 0 extra; 9 definitions
--     differed before this migration, 5 of them being these helpers.
--   * pg_policies: 226/226 policies, 0 missing, 0 extra; only
--     user_profiles_select_own differed in content.
--
-- SCOPE: structural/behavioural only. No data inserted, updated or deleted.
-- Idempotent (CREATE OR REPLACE / DROP POLICY IF EXISTS) on a DB that already
-- has the live shape.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Helper functions — exact LIVE shape (source of truth)
-- ----------------------------------------------------------------------------

create or replace function public.current_user_profile_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
    select id from public.user_profiles where auth_user_id = auth.uid() limit 1;
$function$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
    -- Tenant is resolved from the user's profile or from the JWT app metadata.
    select coalesce(
        (select tenant_id from public.user_profiles where auth_user_id = auth.uid() limit 1),
        (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    );
$function$;

create or replace function public.has_role(r_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
    select r_code = any(public.current_user_roles());
$function$;

create or replace function public.has_any_role(r_codes text[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
    select exists (
        select 1 from unnest(r_codes) as code
        where code = any(public.current_user_roles())
    );
$function$;

create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
    select p_code = any(public.current_user_permissions());
$function$;

-- ----------------------------------------------------------------------------
-- B. user_profiles_select_own — exact LIVE predicate (fast-path disjunct first)
--    The `auth_user_id = auth.uid()` branch must stay FIRST: it resolves the
--    caller's own row without invoking any helper, so the policy can never
--    re-enter itself. Dropping it (as the drift did) turns this table into a
--    recursion trap even when the helpers above are SECURITY DEFINER.
-- ----------------------------------------------------------------------------

drop policy if exists user_profiles_select_own on public.user_profiles;

create policy user_profiles_select_own on public.user_profiles
    for select to authenticated
    using (
        auth_user_id = auth.uid()
        or id = public.current_user_profile_id()
        or (tenant_id = public.current_tenant_id() and public.has_any_role(array['super_admin', 'support_staff']))
    );

comment on function public.current_user_profile_id is 'Resolve the caller''s user_profiles.id from auth.uid(). SECURITY DEFINER (owner postgres, BYPASSRLS) so RLS policies can call it without re-entering the user_profiles policy. Stable, RLS-safe.';
comment on function public.current_tenant_id is 'Resolve the caller''s tenant_id from their profile or JWT app_metadata. SECURITY DEFINER (owner postgres, BYPASSRLS) so RLS policies can call it without re-entering the user_profiles policy. Stable, RLS-safe.';
comment on function public.has_role is 'Convenience predicate: has_role(''super_admin''). SECURITY DEFINER so RLS policies can evaluate roles without exposing role_assignments rows.';
comment on function public.has_any_role is 'Convenience predicate: has_any_role(array[''super_admin'',''financial_officer'']). SECURITY DEFINER so RLS policies can evaluate roles without exposing role_assignments rows.';
comment on function public.has_permission is 'Convenience predicate for inline RLS policies: has_permission(''view_roster''). SECURITY DEFINER so RLS policies can evaluate permissions without exposing the role tables.';
