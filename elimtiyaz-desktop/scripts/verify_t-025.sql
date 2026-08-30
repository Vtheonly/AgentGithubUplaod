-- verify_t-025.sql — live verification for migration 0057 (T-025:
-- DEAD-100 / TENANT-105 / TENANT-106).
--
-- Convention (AGENTS.md §11.1): BEGIN…ROLLBACK wrapper + temp results table.
-- JWT contexts are emulated via SET LOCAL "request.jwt.claims" (the T-006
-- pattern) so RLS + has_any_role are exercised as the real apps see them.
--
-- Checks:
--   S1  authenticated staff (admin JWT) can SELECT student_academic_histories
--       (was: RLS denial on every operation — TENANT-106).
--   S2  authenticated staff can INSERT a history row for their own tenant
--       (the desktop promotion-flow upsert path).
--   S3  cross-tenant history INSERT is rejected (WITH CHECK).
--   S4  an ORPHAN assessment insert (no tenant_id, invalid student_id) now
--       FAILS instead of being stamped with the DEMO tenant (TENANT-105).
--   S5  a legit assessment insert (tenant_id + valid student_id) succeeds.
--   S6  fn_current_tenant_id() is gone and zero policies reference it
--       (DEAD-100 cleanup complete).

BEGIN;

CREATE TEMP TABLE t025_results (check_id TEXT, passed BOOLEAN, detail TEXT) ON COMMIT DROP;

-- Resolve the real admin user (1 auth user in production: admin@elimtiyaz.dz)
-- and the production tenant.
CREATE TEMP TABLE t025_ctx AS
SELECT u.id AS admin_uid,
       up.tenant_id AS admin_tenant,
       (SELECT id FROM public.students WHERE deleted_at IS NULL LIMIT 1) AS any_student
FROM auth.users u
LEFT JOIN public.user_profiles up ON up.auth_user_id = u.id
LIMIT 1;

DO $$
DECLARE
  v_admin uuid;
  v_tenant uuid;
  v_student uuid;
  v_foreign uuid := '99999999-9999-9999-9999-999999999999';
  v_count integer;
  v_ok boolean;
  v_err text;
BEGIN
  SELECT admin_uid, admin_tenant, any_student INTO v_admin, v_tenant, v_student FROM t025_ctx;

  IF v_admin IS NULL THEN
    INSERT INTO t025_results VALUES ('PRE', false, 'no auth user resolved');
    RETURN;
  END IF;
  IF v_tenant IS NULL THEN
    INSERT INTO t025_results VALUES ('PRE', false, 'admin user_profiles has no tenant');
    RETURN;
  END IF;

  -- S1 — staff SELECT on student_academic_histories (TENANT-106 fix).
  v_err := NULL;
  BEGIN
    SET LOCAL role authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    SELECT COUNT(*) INTO v_count FROM public.student_academic_histories;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  RESET role;
  INSERT INTO t025_results VALUES ('S1 staff can SELECT histories', v_err IS NULL, COALESCE(v_err, 'count=' || v_count));

  -- S2 — staff INSERT for their own tenant (promotion-flow upsert path).
  v_err := NULL;
  BEGIN
    SET LOCAL role authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    INSERT INTO public.student_academic_histories
      (tenant_id, student_id, academic_year, cycle, grade_code, grade_year, class_id, class_name, gpa, rank, decision)
    VALUES (v_tenant, v_student, '2025-2026', 'primaire', '2AP', 2, NULL, 'Vérif T-025', 15.5, 1, 'promoted');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  RESET role;
  INSERT INTO t025_results VALUES ('S2 staff can INSERT own-tenant history', v_err IS NULL, COALESCE(v_err, 'insert ok (rolled back)'));

  -- S3 — cross-tenant INSERT rejected.
  v_err := NULL;
  BEGIN
    SET LOCAL role authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    INSERT INTO public.student_academic_histories
      (tenant_id, student_id, academic_year, cycle, grade_code, grade_year, class_id, class_name, gpa, rank, decision)
    VALUES (v_foreign, v_student, '2025-2026', 'primaire', '2AP', 2, NULL, 'cross-tenant probe', 15.5, 1, 'promoted');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  RESET role;
  INSERT INTO t025_results VALUES ('S3 cross-tenant INSERT rejected', v_err IS NOT NULL, COALESCE('rejected: ' || v_err, 'insert unexpectedly succeeded'));

  -- S4 — orphan assessment insert FAILS (no DEMO fallback, TENANT-105).
  BEGIN
    INSERT INTO public.assessments (tenant_id, student_id, term)
    VALUES (NULL, v_foreign, 1);
    INSERT INTO t025_results VALUES ('S4 orphan assessment insert FAILS', false, 'insert unexpectedly succeeded (DEMO fallback back?)');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t025_results VALUES ('S4 orphan assessment insert FAILS', true, 'rejected: ' || left(SQLERRM, 120));
  END;

  -- S5 — legit assessment insert (tenant + valid student) succeeds.
  BEGIN
    INSERT INTO public.assessments (tenant_id, student_id, term, label)
    VALUES (v_tenant, v_student, 1, 'T-025 legit probe');
    INSERT INTO t025_results VALUES ('S5 legit assessment insert ok', true, 'insert ok (rolled back)');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t025_results VALUES ('S5 legit assessment insert ok', false, left(SQLERRM, 160));
  END;

  -- S6 — the dead resolver is gone everywhere.
  BEGIN
    DECLARE
      v_pol integer := 0;
      v_fn integer := 0;
    BEGIN
      SELECT COUNT(*) INTO v_fn FROM pg_proc WHERE proname = 'fn_current_tenant_id';
      SELECT COUNT(*) INTO v_pol FROM pg_policies
       WHERE schemaname='public' AND (qual LIKE '%fn_current_tenant_id%' OR with_check LIKE '%fn_current_tenant_id%');
      INSERT INTO t025_results VALUES ('S6 dead resolver fully removed', (v_fn = 0 AND v_pol = 0),
                                       'functions=' || v_fn || ' policies referencing it=' || v_pol);
    END;
  END;
END $$;

SELECT check_id, passed, detail FROM t025_results ORDER BY check_id;

ROLLBACK;
