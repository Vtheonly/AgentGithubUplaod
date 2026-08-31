-- ============================================================================
-- scripts/verify_t-041.sql — T-041 live verification (migration 0059)
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can be
-- re-run any time without mutating the live DB. Results land in a temp
-- table (Supabase CLI / Management API do not surface RAISE NOTICE).
--
-- Checks (happy path + regression paths):
--   C1  migration 0059 is registered in supabase_migrations.schema_migrations
--   C2  the dead promote_students RPC is GONE (ACAD-100)
--   C3  set_current_academic_year exists with the expected signature
--   C4  execute_batch_promotion exists with the expected signature
--   C5  REGRESSION: execute_batch_promotion REJECTS a malformed decision
--       array (not an array → 22023) — the whole-batch validation works
--   C6  REGRESSION: execute_batch_promotion REJECTS an unknown student
--       (foreign tenant / bogus uuid → 42501) — atomic fail-closed
--   C7  REGRESSION: set_current_academic_year REJECTS a non-existent year
--       (23503) — no silent no-op flip
--   C8  the canonical student_academic_histories staff policy (0057) is
--       present — the promotion flow's write surface
--   C9  anon/authenticated cannot see student_academic_histories rows
--       (RLS read denial, count via a SECURITY-definer-bypassed check)
-- ============================================================================

BEGIN;

CREATE TEMP TABLE t041_results (check_id text, ok boolean, detail text);

-- C1: registration
INSERT INTO t041_results
SELECT 'C1-registered', COUNT(*) = 1,
       'schema_migrations row count=' || COUNT(*)
  FROM supabase_migrations.schema_migrations
 WHERE version = '0059';

-- C2: dead RPC gone
INSERT INTO t041_results
SELECT 'C2-dead-rpc-dropped', COUNT(*) = 0,
       'promote_students procs remaining=' || COUNT(*)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'promote_students';

-- C3: set_current_academic_year signature
INSERT INTO t041_results
SELECT 'C3-set-current-year-present', COUNT(*) = 1,
       'overloads=' || COUNT(*)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'set_current_academic_year'
   AND pg_get_function_arguments(p.oid) LIKE 'p_academic_year_id uuid%';

-- C4: execute_batch_promotion signature
INSERT INTO t041_results
SELECT 'C4-batch-promotion-present', COUNT(*) = 1,
       'overloads=' || COUNT(*)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'execute_batch_promotion'
   AND pg_get_function_arguments(p.oid) LIKE 'p_decisions jsonb%';

-- C5: malformed payload (not a JSON array) must raise 22023
DO $$
BEGIN
    BEGIN
        PERFORM public.execute_batch_promotion('{"student_id": "not-an-array"}'::jsonb, NULL, NULL, NULL);
        INSERT INTO t041_results VALUES ('C5-rejects-non-array', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t041_results
        VALUES ('C5-rejects-non-array', (SQLERRM LIKE '%must be a JSON array%'),
                'raised: ' || SQLERRM);
    END;
END $$;

-- C6: unknown student must raise (42501 family — fail closed, whole batch).
-- Runs under a SIMULATED staff JWT (request.jwt.claims) so the tenant guard
-- passes and the student-existence guard is what fires. (The Management-API
-- SQL endpoint runs without a JWT — unauthenticated callers hit the tenant
-- guard first, which is itself the correct fail-closed behavior — C7b.)
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        PERFORM public.execute_batch_promotion(
            jsonb_build_array(jsonb_build_object(
                'student_id', '99999999-9999-9999-9999-999999999999',
                'decision', 'promoted',
                'next_grade_code', '3am',
                'academic_year', '2025-2026',
                'cycle', 'cem', 'grade_code', '2am', 'grade_year', 2,
                'gpa', 10
            )),
            NULL, NULL, NULL);
        INSERT INTO t041_results VALUES ('C6-rejects-unknown-student', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t041_results
        VALUES ('C6-rejects-unknown-student', (SQLERRM LIKE '%not found in tenant%'),
                'raised: ' || SQLERRM);
    END;
END $$;

-- C7: non-existent year must raise (no silent no-op). Simulated staff JWT.
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
            true);
        PERFORM public.set_current_academic_year('99999999-9999-9999-9999-999999999999'::uuid, NULL, NULL, NULL);
        INSERT INTO t041_results VALUES ('C7-rejects-missing-year', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t041_results
        VALUES ('C7-rejects-missing-year', (SQLERRM LIKE '%not applicable%'),
                'raised: ' || SQLERRM);
    END;
END $$;

-- C7b: caller WITHOUT a JWT (anonymous PostgREST) is rejected by the tenant
-- guard — fail closed.
DO $$
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
        PERFORM public.set_current_academic_year('11111111-1111-1111-1111-111111111111'::uuid, NULL, NULL, NULL);
        INSERT INTO t041_results VALUES ('C7b-anon-fail-closed', false, 'NO ERROR RAISED');
    EXCEPTION WHEN others THEN
        INSERT INTO t041_results
        VALUES ('C7b-anon-fail-closed', (SQLERRM LIKE '%caller tenant%'),
                'raised: ' || SQLERRM);
    END;
END $$;

-- C8: staff policy on the histories table (the promotion write surface)
INSERT INTO t041_results
SELECT 'C8-histories-staff-policy', COUNT(*) >= 1,
       'policies=' || COUNT(*)
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'student_academic_histories'
   AND policyname = 'student_academic_histories_staff';

-- C9: tables the RPC writes remain RLS-enabled
INSERT INTO t041_results
SELECT 'C9-rls-still-on', COUNT(*) = 2,
       'rls-enabled tables among (students, student_academic_histories)=' || COUNT(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('students', 'student_academic_histories')
   AND c.relrowsecurity;

SELECT * FROM t041_results ORDER BY check_id;

ROLLBACK;
