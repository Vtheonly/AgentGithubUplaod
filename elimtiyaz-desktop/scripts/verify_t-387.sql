-- ============================================================================
-- verify_t-387.sql — SYNC-300 live verification: blank strings vs typed RPC
-- parameters + the seed-state census that DISPROVED the "missing seed data"
-- hypothesis for the reported student-import HTTP 400.
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN/ROLLBACK so it can be re-run
-- any time without mutating the DB; results land in a temp table; covers BOTH
-- the happy path AND the regression path.
--
-- The live evidence (NEW project vebfehrpzajhstyhinnw, 2026-09-17, T-387):
--   * The desktop sync push sent `p_class_id: ""` (`??` does NOT convert ""
--     to null) → PostgREST answered HTTP 400
--     {"code":"22P02","message":"invalid input syntax for type uuid: \"\""}.
--     The cast fails BEFORE the SECURITY DEFINER body runs — the server-side
--     NULLIF/TRIM normalization cannot save a failed parameter CAST.
--   * The same call with p_class_id NULL → HTTP 200 (out_student_id returned).
--   * The reported "missing seed data" hypothesis was DISPROVEN on the live
--     DB: every reference table carries its canonical row count (see C1/C2)
--     and the default tenant 00000000-0000-0000-0000-000000000001 EXISTS.
--     Migration parity is exact (97/97, version-by-version).
--
-- Checks:
--   A. the uuid cast boundary: ''::uuid raises 22P02 (the RED mechanism)
--   B. the RPC accepts p_class_id NULL and upserts (rolled back here)
--   C. the seed-state census (the hypothesis disproof)
--   D. the RPC signature census (18 live params — the types.ts baseline)
--   E. super_admin holds ALL permissions (the RBAC requirement)
-- ============================================================================
BEGIN;

DROP TABLE IF EXISTS t385_results;
CREATE TEMP TABLE t385_results (check_id text, ok boolean, detail text);

-- ----------------------------------------------------------------------------
-- A. The RED mechanism: the empty string is NOT a valid uuid literal. This is
--    exactly what PostgREST does with `p_class_id: ""` before the RPC body
--    runs (captured here in pure SQL so the boundary contract is pinned).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_err text := 'no-error';
BEGIN
    BEGIN
        PERFORM ''::uuid;
    EXCEPTION WHEN others THEN
        v_err := SQLERRM;
    END;
    INSERT INTO t385_results
    VALUES ('A1-empty-string-uuid-cast-rejected',
            v_err LIKE '%invalid input syntax for type uuid%',
            'sqlstate_message=' || v_err);
END $$;

-- ----------------------------------------------------------------------------
-- B. The GREEN path: the RPC upserts cleanly with p_class_id NULL (against a
--    probe parent resolved by code) — rolled back with the whole script.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_parent uuid;
    v_out    record;
BEGIN
    -- resolve (or create, rolled back) a probe parent by canonical code
    SELECT id INTO v_parent FROM public.parents
     WHERE parent_code = 'PAR-PROBE-T387' AND deleted_at IS NULL LIMIT 1;
    IF v_parent IS NULL THEN
        INSERT INTO public.parents (tenant_id, parent_code, first_name, last_name,
                                    display_name, primary_phone, is_active)
        VALUES ('00000000-0000-0000-0000-000000000001', 'PAR-PROBE-T387', 'PROBE',
                'T387', 'PROBE T387', '+000000000', true)
        RETURNING id INTO v_parent;
    END IF;

    SELECT * INTO v_out FROM public.upsert_student_from_import(
        p_tenant_id     := '00000000-0000-0000-0000-000000000001',
        p_student_code  := 'ELV-PROBE-T387-B',
        p_parent_id     := v_parent::text,
        p_first_name    := 'PROBE',
        p_last_name     := 'T387B',
        p_class_id      := NULL,          -- the SYNC-300 post-fix shape
        p_date_of_birth := NULL
    );
    INSERT INTO t385_results
    VALUES ('B1-rpc-accepts-null-class-id',
            v_out.out_student_id IS NOT NULL AND v_out.out_student_code = 'ELV-PROBE-T387-B',
            'out_student_code=' || coalesce(v_out.out_student_code::text, 'NULL')
            || ' inserted=' || coalesce(v_out.out_was_inserted::text, 'NULL'));
END $$;

-- ----------------------------------------------------------------------------
-- C. The seed-state census — the DISPROOF of the "missing seed data"
--    hypothesis (every canonical count present, default tenant exists).
--    NOTE: transport_destinations = 28 is the CANONICAL post-0089 state
--    (0023's 4 legacy zones + 0089's 24 real towns) — re-running 0023's
--    trailing DO-asserts on a fully-migrated DB would FAIL on this count.
-- ----------------------------------------------------------------------------
INSERT INTO t385_results
SELECT 'C1-reference-table-census',
       (SELECT COUNT(*) FROM public.tenants) = 1
       AND (SELECT COUNT(*) FROM public.roles) = 11
       AND (SELECT COUNT(*) FROM public.permissions) = 56
       AND (SELECT COUNT(*) FROM public.academic_levels) = 14
       AND (SELECT COUNT(*) FROM public.academic_years) = 1
       AND (SELECT COUNT(*) FROM public.expense_categories) = 9
       AND (SELECT COUNT(*) FROM public.departments) = 4
       AND (SELECT COUNT(*) FROM public.pricing_configs) = 1
       AND (SELECT COUNT(*) FROM public.grade_level_tuition) = 14
       AND (SELECT COUNT(*) FROM public.transport_destinations) = 28
       AND (SELECT COUNT(*) FROM public.complementary_services) = 3
       AND (SELECT COUNT(*) FROM public.discounts) = 5,
       'tenants=1 roles=11 perms=56 levels=14 years=1 expense_cat=9 dept=4 '
       || 'pricing=1 tuition=14 transport=28 services=3 discounts=5';

INSERT INTO t385_results
SELECT 'C2-default-tenant-exists',
       COUNT(*) = 1,
       'default_tenant_rows=' || COUNT(*)
  FROM public.tenants
 WHERE id = '00000000-0000-0000-0000-000000000001';

INSERT INTO t385_results
SELECT 'C3-migration-parity-97',
       (SELECT COUNT(*) FROM supabase_migrations.schema_migrations) = 97,
       'applied=' || (SELECT COUNT(*) FROM supabase_migrations.schema_migrations);

-- ----------------------------------------------------------------------------
-- D. The RPC signature census — the live pg_proc parameter count/types that
--    src/infrastructure/supabase/types.ts must not fall behind again.
-- ----------------------------------------------------------------------------
INSERT INTO t385_results
SELECT 'D1-upsert-student-rpc-18-in-params',
       total = 21 AND with_0028 = 3 AND with_out = 3,
       'argnames(in+out)=' || total || ' (0028 IN params: ' || with_0028
       || '/3; out_* columns: ' || with_out || '/3 — pg_proc lists IN+OUT)'
  FROM (
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE n IN ('p_grade_level_code','p_transport_tier','p_payment_plan')) AS with_0028,
           COUNT(*) FILTER (WHERE n IN ('out_student_id','out_student_code','out_was_inserted')) AS with_out
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
      CROSS JOIN LATERAL unnest(p.proargnames) AS n
     WHERE ns.nspname = 'public' AND p.proname = 'upsert_student_from_import'
  ) census;

-- ----------------------------------------------------------------------------
-- E. super_admin = ALL permissions (the RBAC requirement the seed encodes).
-- ----------------------------------------------------------------------------
INSERT INTO t385_results
SELECT 'E1-super-admin-all-permissions',
       COUNT(*) = (SELECT COUNT(*) FROM public.permissions),
       'super_admin_grants=' || COUNT(*) || ' / permissions='
       || (SELECT COUNT(*) FROM public.permissions)
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
 WHERE r.code = 'super_admin';

SELECT * FROM t385_results ORDER BY check_id;

ROLLBACK;
