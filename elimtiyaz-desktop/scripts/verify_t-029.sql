-- ============================================================================
-- T-029 live verification — approve_account_request rebind guard
-- Verifies:
--   S1: Approving a fresh (unbound) parent binding → succeeds, audit entry written
--   S2: Approving a request that targets an ALREADY-BOUND parent (different
--       auth_user_id) → FAILS with the rebind guard exception
--   S3: Approving a request targeting the SAME auth_user_id as the existing
--       binding → succeeds (idempotent re-approval)
-- Stores results in a temp table; entire script wrapped in BEGIN/ROLLBACK.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS t029_results (scenario text, outcome text, detail text);

-- Test fixtures
INSERT INTO public.parents (id, tenant_id, parent_code, first_name, last_name, primary_phone, is_active, auth_user_id, created_at, updated_at)
VALUES
  ('66666666-6666-6666-6666-600000000001', '00000000-0000-0000-0000-000000000001', 'PAR-T029-A', 'T029', 'Fresh', '0000000000', true, NULL, now(), now()),
  ('66666666-6666-6666-6666-600000000002', '00000000-0000-0000-0000-000000000001', 'PAR-T029-B', 'T029', 'AlreadyBound', '0000000000', true, '77777777-7777-7777-7777-700000000001', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Create fake account_approval_requests rows directly
INSERT INTO public.account_approval_requests (id, tenant_id, auth_user_id, requested_role, status, target_parent_id, email, created_at, updated_at)
VALUES
  ('88888888-8888-8888-8888-800000000001', '00000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-700000000002', 'parent', 'pending', '66666666-6666-6666-6666-600000000001', 't029-s1@test.local', now(), now()),
  ('88888888-8888-8888-8888-800000000002', '00000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-700000000003', 'parent', 'pending', '66666666-6666-6666-6666-600000000002', 't029-s2@test.local', now(), now()),
  ('88888888-8888-8888-8888-800000000003', '00000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-700000000001', 'parent', 'pending', '66666666-6666-6666-6666-600000000002', 't029-s3@test.local', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Create a user_profiles row for the reviewer
INSERT INTO public.user_profiles (id, tenant_id, auth_user_id, email, status, created_at, updated_at)
VALUES ('99999999-9999-9999-9999-900000000001', '00000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-700000000099', 'reviewer@t029.test', 'active', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Scenario 1: Approve fresh binding → succeeds, audit entry written
DO $$
  DECLARE v_role_id uuid; v_audit_count int;
BEGIN
  v_role_id := public.approve_account_request(
    p_request_id => '88888888-8888-8888-8888-800000000001',
    p_reviewer_profile_id => '99999999-9999-9999-9999-900000000001',
    p_target_parent_id => '66666666-6666-6666-6666-600000000001',
    p_decision_note => 'T-029 S1 fresh bind'
  );
  -- Check the audit entry was written
  SELECT count(*) INTO v_audit_count FROM public.audit_logs
    WHERE action = 'parent.bind' AND entity_id = '66666666-6666-6666-6666-600000000001';
  IF v_audit_count >= 1 THEN
    INSERT INTO t029_results VALUES ('S1: fresh binding approved + audited', 'PASS', 'role=' || v_role_id || ', audit_count=' || v_audit_count);
  ELSE
    INSERT INTO t029_results VALUES ('S1: fresh binding approved + audited', 'FAIL', 'audit entry missing');
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t029_results VALUES ('S1: fresh binding approved + audited', 'FAIL', SQLERRM);
END $$;

-- Scenario 2: Approve re-binding to a different user → FAILS (T-029 fix)
DO $$
  DECLARE v_role_id uuid;
BEGIN
  v_role_id := public.approve_account_request(
    p_request_id => '88888888-8888-8888-8888-800000000002',
    p_reviewer_profile_id => '99999999-9999-9999-9999-900000000001',
    p_target_parent_id => '66666666-6666-6666-6666-600000000002',  -- already bound to 700000000001
    p_decision_note => 'T-029 S2 rebind attempt'
  );
  INSERT INTO t029_results VALUES ('S2: rebind to different user rejected', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t029_results VALUES ('S2: rebind to different user rejected', 'PASS (expected fail)', SQLERRM);
END $$;

-- Scenario 3: Approve re-binding to the SAME user (idempotent) → succeeds
DO $$
  DECLARE v_role_id uuid;
BEGIN
  v_role_id := public.approve_account_request(
    p_request_id => '88888888-8888-8888-8888-800000000003',
    p_reviewer_profile_id => '99999999-9999-9999-9999-900000000001',
    p_target_parent_id => '66666666-6666-6666-6666-600000000002',  -- bound to 700000000001
    p_decision_note => 'T-029 S3 idempotent rebind'
  );
  INSERT INTO t029_results VALUES ('S3: rebind to same user (idempotent)', 'PASS', 'idempotent re-approval succeeded');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t029_results VALUES ('S3: rebind to same user (idempotent)', 'FAIL', SQLERRM);
END $$;

-- Scenario 4: verify the live function body has the rebind guard
DO $$
  DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'approve_account_request';
  IF v_def LIKE '%already bound to a different auth_user_id%' THEN
    INSERT INTO t029_results VALUES ('S4: function body has rebind guard', 'PASS', 'rebind guard is present in the live function body');
  ELSE
    INSERT INTO t029_results VALUES ('S4: function body has rebind guard', 'FAIL', 'rebind guard is MISSING');
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t029_results VALUES ('S4: function body has rebind guard', 'FAIL', SQLERRM);
END $$;

SELECT scenario, outcome, detail FROM t029_results ORDER BY scenario;

ROLLBACK;
