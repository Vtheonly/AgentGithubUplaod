-- verify_t-214.sql — live verification for T-214 (migration 0080, INFO-300:
-- service_enrollments_select tightened from tenant-wide SELECT to
-- staff-roles + parent-own-student + student-self scoping).
--
-- Convention (AGENTS.md §11.1): wrapped in BEGIN/ROLLBACK so it can be
-- re-run any time without mutating the live DB; results land in a temp
-- table; covers BOTH the happy path and the regression path (the original
-- tenant-wide leak must be gone).
--
-- Live actors used (read-only references, resolved 2026-09-07):
--   PARENT-OWN   auth.users e2c922fb-e2bd-4662-8867-8198d12547e2
--                (profile 2f00d2dd…, role 'parent', parent 09e65092…,
--                 student b0037eef… ELV-2026-607FE9)
--   STAFF        auth.users 0a3597e7-9681-48b1-bd32-0360c7981d1e
--                (profile dac9c821…, role 'super_admin')
--
-- Seeded inside the transaction (rolled back — zero residue): one
-- UI-TEST-tagged family (parent + student) + 2 service_enrollments rows
-- (one for the own student, one for the seeded family).
BEGIN;

DROP TABLE IF EXISTS t214_results;
CREATE TEMP TABLE t214_results (check_id text, ok boolean, detail text);
-- The DO blocks below run SET LOCAL ROLE authenticated — they need write
-- access to the temp results table (the t-148 convention).
GRANT INSERT, SELECT ON t214_results TO authenticated, anon;

-- C1: registration + chain length (77 = 0001..0080, zero drift)
INSERT INTO t214_results
SELECT 'C1-registered', COUNT(*) = 1, 'rows=' || COUNT(*)
  FROM supabase_migrations.schema_migrations WHERE version = '0080';
INSERT INTO t214_results
SELECT 'C1-chain-77', (SELECT COUNT(*) FROM supabase_migrations.schema_migrations) = 77,
       'chain=' || (SELECT COUNT(*) FROM supabase_migrations.schema_migrations);

-- C2: the policy qual carries the staff-role branch AND the parent-own-student
--     subquery. QUIRK DISCOVERY (32nd session): the Management API SQL
--     endpoint corrupts statements containing doubled single quotes ('')
--     in LIKE patterns — sibling literals in the same SELECT returned
--     false while the identical expressions re-tested alone returned true
--     (live evidence, 2026-09-07). Use position() with quote-free
--     substrings instead of LIKE patterns containing ''.
INSERT INTO t214_results
SELECT 'C2-policy-shape',
       position('has_any_role' in lower(qual)) > 0
       AND position('has_role(' in lower(qual)) > 0
       AND position('parent' in lower(qual)) > 0
       AND position('student_id in' in lower(qual)) > 0
       AND position('auth_user_id = auth.uid()' in lower(qual)) > 0,
       'qual_chars=' || length(qual)
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'service_enrollments'
  AND policyname = 'service_enrollments_select';

-- Seed the UI-TEST family (rolled back at the end — zero residue).
SET LOCAL ROLE postgres;
INSERT INTO public.parents (id, tenant_id, parent_code, first_name, last_name,
    primary_phone, notes)
VALUES ('11111111-2222-3333-4444-555555555501'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'PAR-UI-TEST-214', 'UI', 'TEST-214', '0000000000',
        'T-214 verify seed — rolled back');
INSERT INTO public.students (id, tenant_id, parent_id, student_code, first_name,
    last_name, date_of_birth, medical_notes)
VALUES ('11111111-2222-3333-4444-555555555601'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        '11111111-2222-3333-4444-555555555501'::uuid,
        'ELV-UI-TEST-214', 'Kid', 'TEST-214', '2015-01-01',
        'T-214 verify seed — rolled back');
INSERT INTO public.service_enrollments (id, tenant_id, student_id,
    academic_year_id, service_kind, annual_amount)
VALUES
  ('11111111-2222-3333-4444-555555555701'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   '11111111-2222-3333-4444-555555555601'::uuid,
   (SELECT id FROM public.academic_years WHERE is_current LIMIT 1),
   'canteen', 36000),
  ('11111111-2222-3333-4444-555555555702'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   'b0037eef-c26c-4684-bb0b-7fc2c75584fc'::uuid,
   (SELECT id FROM public.academic_years WHERE is_current LIMIT 1),
   'transport', 40000);
RESET ROLE;

-- C3: PARENT-OWN sees ONLY their own student's enrollment (the transport row),
--     NOT the seeded other family's canteen row (the INFO-300 leak, closed).
DO $$
DECLARE
    v_own int;
    v_other int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "e2c922fb-e2bd-4662-8867-8198d12547e2", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    SELECT COUNT(*) INTO v_own FROM public.service_enrollments
      WHERE student_id = 'b0037eef-c26c-4684-bb0b-7fc2c75584fc'::uuid;
    SELECT COUNT(*) INTO v_other FROM public.service_enrollments
      WHERE student_id = '11111111-2222-3333-4444-555555555601'::uuid;
    INSERT INTO t214_results VALUES ('C3-parent-own-only',
        v_own = 1 AND v_other = 0,
        'own=' || v_own || ' other_family=' || v_other);
END $$;

-- C4: a parent WITHOUT the 'parent' role binding and with no students sees
--     nothing (their claims resolve to an unrelated profile). Simulated via
--     a random sub that maps to NO profile: every branch must fail closed.
DO $$
DECLARE
    v_visible int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "00000000-0000-0000-0000-000000000099", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    SELECT COUNT(*) INTO v_visible FROM public.service_enrollments;
    INSERT INTO t214_results VALUES ('C4-unbound-user-sees-nothing',
        v_visible = 0, 'visible=' || v_visible);
END $$;

-- C5: STAFF (super_admin) still sees BOTH rows (the staff read path is
--     preserved — desktop/Android readers are unaffected).
DO $$
DECLARE
    v_visible int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "0a3597e7-9681-48b1-bd32-0360c7981d1e", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    SELECT COUNT(*) INTO v_visible FROM public.service_enrollments;
    INSERT INTO t214_results VALUES ('C5-staff-sees-all',
        v_visible = 2, 'visible=' || v_visible);
END $$;

-- Results.
SELECT check_id, ok, detail FROM t214_results ORDER BY check_id;

ROLLBACK;
