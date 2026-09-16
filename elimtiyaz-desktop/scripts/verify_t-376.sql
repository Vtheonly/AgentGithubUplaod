-- ============================================================================
-- verify_t-376.sql — RLS helper SECURITY DEFINER parity live verification
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN/ROLLBACK so it can be re-run
-- any time without mutating the DB; results land in a temp table; covers BOTH
-- the happy path AND the regression path (the recursion that broke every
-- authenticated read on the fresh clone).
--
-- The regression live evidence (empty clone vebfehrpzajhstyhinnw, 2026-09-15):
--   every authenticated PostgREST read returned HTTP 500 `54001 stack depth
--   limit exceeded`, and every unauthenticated read returned HTTP 401.
--   Root cause: the five RLS helpers created by 0003_rbac.sql lacked
--   SECURITY DEFINER, and user_profiles_select_own had lost its
--   `auth_user_id = auth.uid()` fast-path disjunct. Evaluating the
--   user_profiles policy therefore called current_user_profile_id(), whose
--   body selects from user_profiles, which re-evaluates the same policy…
--
-- PRECONDITION: the canonical admin (admin@elimtiyaz.dz) exists with an
-- activated profile. The script resolves its auth_user_id dynamically, so it
-- runs unchanged against both the production DB and any fresh clone.
-- ============================================================================
BEGIN;

DROP TABLE IF EXISTS t376_results;
CREATE TEMP TABLE t376_results (check_id text, ok boolean, detail text);
-- The DO blocks below run SET LOCAL ROLE authenticated/anon — they need write
-- access to the temp results table (the t-148/t-214/t-332 convention,
-- AGENTS.md rule 27).
GRANT INSERT, SELECT ON t376_results TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- A. Structural guard: the five helpers must carry the LIVE production shape.
--    (This is the check that would have caught the drift — and the one that
--    must never be dropped, or a future chain edit re-introduces the trap.)
-- ----------------------------------------------------------------------------
INSERT INTO t376_results
SELECT 'A1-helper-count-secdef',
       COUNT(*) = 5,
       'secdef_helpers=' || COUNT(*)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('current_user_profile_id','current_tenant_id',
                     'has_role','has_any_role','has_permission')
   AND p.prosecdef;

INSERT INTO t376_results
SELECT 'A2-helper-search-path-pinned',
       COUNT(*) = 5,
       'pinned=' || COUNT(*)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('current_user_profile_id','current_tenant_id',
                     'has_role','has_any_role','has_permission')
   AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%';

-- Owner must hold BYPASSRLS (postgres does), otherwise SECURITY DEFINER alone
-- cannot escape the FORCEd RLS on user_profiles/role_assignments/roles/tenants.
INSERT INTO t376_results
SELECT 'A3-helper-owner-bypassrls',
       COUNT(*) = 5,
       'bypassrls_owners=' || COUNT(*)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
 WHERE n.nspname = 'public'
   AND p.proname IN ('current_user_profile_id','current_tenant_id',
                     'has_role','has_any_role','has_permission')
   AND r.rolbypassrls;

-- ----------------------------------------------------------------------------
-- B. The policy must KEEP its fast-path disjunct. Without it the policy
--    re-enters itself even when the helpers are SECURITY DEFINER.
-- ----------------------------------------------------------------------------
INSERT INTO t376_results
SELECT 'B1-select-own-fast-path',
       position('auth_user_id = auth.uid()' in lower(qual)) > 0,
       'qual_chars=' || length(qual)
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'user_profiles'
   AND policyname = 'user_profiles_select_own';

INSERT INTO t376_results
SELECT 'B2-rls-still-forced',
       COUNT(*) = 4,
       'forced_tables=' || COUNT(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('user_profiles','role_assignments','roles','tenants')
   AND c.relforcerowsecurity;

-- ----------------------------------------------------------------------------
-- C. HAPPY PATH — as the canonical admin under `authenticated`:
--    resolving the caller's own identity must NOT recurse (this is exactly the
--    statement that raised 54001 before the fix), and the tenant/role helpers
--    must resolve from the profile + role_assignments.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_sub        text;
    v_profile_id uuid;
    v_own_rows   int;
    v_tenant     uuid;
    v_is_super   boolean;
    v_levels     int;
BEGIN
    -- Resolve the canonical admin's auth uid BEFORE downgrading the role
    -- (postgres holds BYPASSRLS, so this read is unaffected by RLS).
    SELECT auth_user_id::text INTO v_sub
      FROM public.user_profiles
     WHERE email = 'admin@elimtiyaz.dz'
     ORDER BY created_at LIMIT 1;

    PERFORM pg_catalog.set_config('request.jwt.claims',
        json_build_object(
            'sub', v_sub,
            'role', 'authenticated',
            'app_metadata', json_build_object('tenant_id', '00000000-0000-0000-0000-000000000001')
        )::text, true);

    SET LOCAL ROLE authenticated;

    -- C1 — THE recursion probe. Before the fix this raised
    --      "54001 stack depth limit exceeded".
    SELECT public.current_user_profile_id() INTO v_profile_id;

    INSERT INTO t376_results VALUES ('C1-profile-helper-no-recursion',
        v_profile_id IS NOT NULL,
        'resolved_profile=' || coalesce(v_profile_id::text, 'NULL') || ' sub=' || coalesce(v_sub, 'NULL'));

    -- C2 — the caller can read their own profile row (the fast-path branch).
    SELECT COUNT(*) INTO v_own_rows FROM public.user_profiles;
    INSERT INTO t376_results VALUES ('C2-own-profile-visible',
        v_own_rows >= 1, 'visible_profiles=' || v_own_rows);

    -- C3 — tenant + role resolution through the helpers.
    SELECT public.current_tenant_id() INTO v_tenant;
    INSERT INTO t376_results VALUES ('C3-tenant-resolved',
        v_tenant = '00000000-0000-0000-0000-000000000001'::uuid,
        'tenant=' || coalesce(v_tenant::text, 'NULL'));

    SELECT public.has_role('super_admin') INTO v_is_super;
    INSERT INTO t376_results VALUES ('C4-super-admin-role',
        v_is_super, 'has_role(super_admin)=' || v_is_super
        || ' has_any_role=' || public.has_any_role(array['super_admin','support_staff']));

    -- C5 — a normal tenant-scoped read must succeed (was 500/54001).
    SELECT COUNT(*) INTO v_levels FROM public.academic_levels;
    INSERT INTO t376_results VALUES ('C5-tenant-scoped-read',
        v_levels >= 0, 'academic_levels_visible=' || v_levels);
END $$;

-- ----------------------------------------------------------------------------
-- D. REGRESSION PATHS — the fix must not have widened anything.
--    D1: an unbound sub (no profile) must still see zero profiles.
--    D2: the anon role must see zero rows on a guarded business table.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_visible int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "00000000-0000-0000-0000-000000000099", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    SELECT COUNT(*) INTO v_visible FROM public.user_profiles;
    INSERT INTO t376_results VALUES ('D1-unbound-sub-sees-nothing',
        v_visible = 0, 'visible_profiles=' || v_visible);
END $$;

DO $$
DECLARE
    v_parents int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims', '{"role": "anon"}', true);
    SET LOCAL ROLE anon;
    SELECT COUNT(*) INTO v_parents FROM public.parents;
    INSERT INTO t376_results VALUES ('D2-anon-sees-nothing',
        v_parents = 0, 'visible_parents=' || v_parents);
END $$;

-- Results.
SELECT check_id, ok, detail FROM t376_results ORDER BY check_id;

ROLLBACK;
