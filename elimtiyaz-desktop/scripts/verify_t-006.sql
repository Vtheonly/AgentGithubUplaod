-- ============================================================================
-- T-006 live verification — SECURITY DEFINER RPC hardening (migration 0055)
--   SEC-110  bind_activation_code caller verification + re-bind guard + audit
--   SEC-112  revert_payment_allocation tenant filter
--   SEC-111  upsert_payment_from_import caller-tenant verification
--
-- JWT-context emulation: the RPC guards read auth.uid() / auth.jwt(),
-- which resolve from request.jwt.claims. This script switches the claim
-- setting between scenarios (set_config(..., is_local => true)) to emulate:
--   - service_role caller  (the Edge Function path — trusted)
--   - authenticated caller (direct PostgREST path — restricted)
--   - anonymous / no JWT   (fully rejected)
--
-- Everything runs inside BEGIN ... ROLLBACK — the live DB is untouched.
-- Results go into a temp table, SELECTed at the end.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS t006_results (scenario text, outcome text, detail text);

-- ----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- ----------------------------------------------------------------------------
-- Demo tenant (the only real tenant) = 00000000-0000-0000-0000-000000000001
-- Synthetic second tenant for cross-tenant scenarios
INSERT INTO public.tenants (id, name, slug, created_at, updated_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'T006-Foreign-Tenant', 't006-foreign', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Parents
INSERT INTO public.parents (id, tenant_id, parent_code, first_name, last_name, primary_phone, is_active, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-100000000001', '00000000-0000-0000-0000-000000000001', 'PAR-T006-A', 'T006', 'UnboundA', '0555000001', true, now(), now()),
  ('11111111-1111-1111-1111-100000000002', '00000000-0000-0000-0000-000000000001', 'PAR-T006-B', 'T006', 'PreboundB', '0555000002', true, now(), now()),
  ('11111111-1111-1111-1111-100000000003', '00000000-0000-0000-0000-000000000001', 'PAR-T006-C', 'T006', 'UnboundC', '0555000003', true, now(), now()),
  ('11111111-1111-1111-1111-100000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'PAR-T006-F', 'T006', 'ForeignF', '0555000004', true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- Pre-bind parent B to attacker U1
UPDATE public.parents SET auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' WHERE id = '11111111-1111-1111-1111-100000000002';

-- Activation codes
INSERT INTO public.activation_codes (id, tenant_id, code, parent_id, issued_at, expires_at)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '650061', '11111111-1111-1111-1111-100000000001', now(), now() + interval '30 days'),
  ('cccccccc-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '650062', '11111111-1111-1111-1111-100000000002', now(), now() + interval '30 days'),
  ('cccccccc-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '650063', '11111111-1111-1111-1111-100000000003', now(), now() + interval '30 days')
ON CONFLICT (id) DO NOTHING;

-- user_profiles for the authenticated-caller emulation (U2 → demo tenant)
INSERT INTO public.user_profiles (id, auth_user_id, tenant_id, email, display_name, status, created_at, updated_at)
VALUES ('dddddddd-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 't006-u2@test.local', 'T006 Caller U2', 'active', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- S1 — SEC-110 happy path via service_role (the EF path): bind succeeds
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
BEGIN
  PERFORM public.bind_activation_code(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '650061',
    'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid
  );
  INSERT INTO t006_results VALUES ('S1: bind via service_role (EF path)', 'PASS', 'bind returned without error');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t006_results VALUES ('S1: bind via service_role (EF path)', 'FAIL', SQLERRM);
END $$;

-- ----------------------------------------------------------------------------
-- S2 — SEC-110 direct call, p_auth_user_id = caller (authenticated U2):
--      proceeds past the caller check and binds + writes the RPC audit row
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-0000000000a2"}', true);
DO $$
DECLARE v_count int;
BEGIN
  PERFORM public.bind_activation_code(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '650063',
    'aaaaaaaa-0000-0000-0000-0000000000a2'::uuid
  );
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE action = 'activation_code.bind_rpc'
     AND entity_id = '11111111-1111-1111-1111-100000000003'::uuid;
  IF v_count = 1 THEN
    INSERT INTO t006_results VALUES ('S2: direct self-bind + PARENT-103 audit', 'PASS', 'bind ok; audit_logs activation_code.bind_rpc row present');
  ELSE
    INSERT INTO t006_results VALUES ('S2: direct self-bind + PARENT-103 audit', 'FAIL', 'bind ok but audit row count=' || v_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t006_results VALUES ('S2: direct self-bind + PARENT-103 audit', 'FAIL', SQLERRM);
END $$;

-- ----------------------------------------------------------------------------
-- S3 — SEC-110 regression: direct call, p_auth_user_id = ANOTHER user (U1)
--      while authenticated as U2 → must be rejected
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.bind_activation_code(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '650062',
    'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid  -- foreign user
  );
  INSERT INTO t006_results VALUES ('S3: direct FOREIGN bind rejected', 'FAIL', 'should have raised SEC-110 but bind succeeded');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%SEC-110%' THEN
    INSERT INTO t006_results VALUES ('S3: direct FOREIGN bind rejected', 'PASS (expected fail)', SQLERRM);
  ELSE
    INSERT INTO t006_results VALUES ('S3: direct FOREIGN bind rejected', 'FAIL', 'wrong error: ' || SQLERRM);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- S4 — SEC-110 regression: anonymous caller (no JWT) → rejected
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '', true);
DO $$
BEGIN
  PERFORM public.bind_activation_code(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '650062',
    'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid
  );
  INSERT INTO t006_results VALUES ('S4: anonymous bind rejected', 'FAIL', 'should have raised but bind succeeded');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%SEC-110%' THEN
    INSERT INTO t006_results VALUES ('S4: anonymous bind rejected', 'PASS (expected fail)', SQLERRM);
  ELSE
    INSERT INTO t006_results VALUES ('S4: anonymous bind rejected', 'FAIL', 'wrong error: ' || SQLERRM);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- S5 — STUDENT-101 re-bind guard: parent B already bound to U1; a second
--      code for B must NOT silently transfer the binding to U2
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE v_bound uuid;
BEGIN
  PERFORM public.bind_activation_code(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '650062',
    'aaaaaaaa-0000-0000-0000-0000000000a2'::uuid  -- different from U1
  );
  SELECT auth_user_id INTO v_bound FROM public.parents WHERE id = '11111111-1111-1111-1111-100000000002'::uuid;
  INSERT INTO t006_results VALUES ('S5: silent re-bind rejected', 'FAIL', 'should have raised but parent now bound to ' || coalesce(v_bound::text,'NULL'));
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%already bound%' THEN
    INSERT INTO t006_results VALUES ('S5: silent re-bind rejected', 'PASS (expected fail)', SQLERRM);
  ELSE
    INSERT INTO t006_results VALUES ('S5: silent re-bind rejected', 'FAIL', 'wrong error: ' || SQLERRM);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- S6 — SEC-111 happy path via service_role: upsert into the demo tenant works
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.upsert_payment_from_import(
    p_tenant_id     => '00000000-0000-0000-0000-000000000001'::uuid,
    p_payment_number => 'PAY-T006-S6',
    p_parent_id     => '11111111-1111-1111-1111-100000000001',
    p_student_id    => NULL,
    p_amount        => 12500.00,
    p_method        => 'cash',
    p_category      => 'tuition',
    p_status        => 'paid'
  );
  INSERT INTO t006_results VALUES ('S6: upsert via service_role', 'PASS', 'upsert_payment_from_import returned');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t006_results VALUES ('S6: upsert via service_role', 'FAIL', SQLERRM);
END $$;

-- ----------------------------------------------------------------------------
-- S7 — SEC-111 regression: authenticated caller (U2, demo tenant) injecting
--      into the FOREIGN tenant → rejected
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-0000000000a2"}', true);
-- NOTE: p_student_id has NO default in the (unchanged since 0027/0031)
-- function signature — callers must pass it (or another arg before it must
-- be passed positionally). Passing it explicitly mirrors real callers.
DO $$
BEGIN
  PERFORM public.upsert_payment_from_import(
    p_tenant_id     => 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,  -- foreign
    p_payment_number => 'PAY-T006-S7',
    p_parent_id     => '11111111-1111-1111-1111-100000000004',
    p_student_id    => NULL,
    p_amount        => 99000.00,
    p_method        => 'cash',
    p_status        => 'paid'
  );
  INSERT INTO t006_results VALUES ('S7: foreign-tenant upsert rejected', 'FAIL', 'should have raised SEC-111 but upsert succeeded');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%SEC-111%' THEN
    INSERT INTO t006_results VALUES ('S7: foreign-tenant upsert rejected', 'PASS (expected fail)', SQLERRM);
  ELSE
    INSERT INTO t006_results VALUES ('S7: foreign-tenant upsert rejected', 'FAIL', 'wrong error: ' || SQLERRM);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- S8 — SEC-112: minimal same-tenant refund still works end-to-end
--      (payment paid + original ledger entry → revert → refunded)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- NOTE: payment + ledger are inserted in SEPARATE DO blocks — an EXCEPTION
-- handler inside a DO block rolls the WHOLE block back (implicit
-- subtransaction), so a shared block would lose the payment row when the
-- ledger insert fails (first-run lesson: S8's refund then saw "not found").
DO $$
BEGIN
  INSERT INTO public.payments (id, tenant_id, payment_number, parent_id, amount, method, category, status, receipt_number, collected_at, created_at, updated_at)
  VALUES ('33333333-3333-3333-3333-300000000801', '00000000-0000-0000-0000-000000000001', 'PAY-T006-S8', '11111111-1111-1111-1111-100000000001', 10000, 'cash', 'tuition', 'paid', 'REC-T006-S8', now(), now(), now());
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t006_results VALUES ('S8: fixture (payment)', 'FAIL', 'fixture insert: ' || SQLERRM);
END $$;

DO $$
BEGIN
  -- account_id is NOT NULL on the live ledger_entries (text); the reversal
  -- INSERT copies it from the original entry.
  INSERT INTO public.ledger_entries (entry_number, tenant_id, parent_id, account_id, entry_type, amount, category, source_type, source_id, payment_status, at, description, created_at)
  VALUES ('LED-T006-S8', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-100000000001', 'cash-main', 'payment', 10000, 'tuition', 'payment', '33333333-3333-3333-3333-300000000801', 'paid', now(), 'T006 fixture', now());
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t006_results VALUES ('S8: fixture (ledger)', 'FAIL', 'fixture insert: ' || SQLERRM);
END $$;

DO $$
DECLARE v_result record; v_audit record;
BEGIN
  SELECT * INTO v_result FROM public.revert_payment_allocation(
    p_tenant_id  => '00000000-0000-0000-0000-000000000001'::uuid,
    p_payment_id => '33333333-3333-3333-3333-300000000801'::uuid,
    p_actor_id   => 'dddddddd-0000-0000-0000-0000000000d2'::uuid,
    p_actor_name => 'T006 Actor',
    p_reason     => 'T006 same-tenant refund'
  );
  SELECT * INTO v_audit FROM public.audit_logs
   WHERE action = 'payment.refund' AND entity_id = '33333333-3333-3333-3333-300000000801'::uuid
   ORDER BY created_at DESC LIMIT 1;
  IF v_result.new_status = 'refunded' AND v_audit.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid THEN
    INSERT INTO t006_results VALUES ('S8: same-tenant refund + audit tenant stamp', 'PASS', 'refunded; audit tenant = payment tenant');
  ELSE
    INSERT INTO t006_results VALUES ('S8: same-tenant refund + audit tenant stamp', 'FAIL', 'status=' || v_result.new_status || ' audit_tenant=' || coalesce(v_audit.tenant_id::text,'none'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t006_results VALUES ('S8: same-tenant refund + audit tenant stamp', 'FAIL', SQLERRM);
END $$;

-- ----------------------------------------------------------------------------
-- S9 — SEC-112 regression: cross-tenant refund attempt → "Payment not found"
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.revert_payment_allocation(
    p_tenant_id  => 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,  -- foreign caller tenant
    p_payment_id => '33333333-3333-3333-3333-300000000801'::uuid,  -- demo-tenant payment
    p_actor_id   => 'dddddddd-0000-0000-0000-0000000000d2'::uuid,
    p_actor_name => 'T006 Attacker',
    p_reason     => 'T006 cross-tenant attempt'
  );
  INSERT INTO t006_results VALUES ('S9: cross-tenant refund rejected', 'FAIL', 'should have raised not-found but revert succeeded');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%not found%' THEN
    INSERT INTO t006_results VALUES ('S9: cross-tenant refund rejected', 'PASS (expected fail)', SQLERRM);
  ELSE
    INSERT INTO t006_results VALUES ('S9: cross-tenant refund rejected', 'FAIL', 'wrong error: ' || SQLERRM);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Report
-- ----------------------------------------------------------------------------
SELECT scenario, outcome, detail FROM t006_results;

ROLLBACK;
