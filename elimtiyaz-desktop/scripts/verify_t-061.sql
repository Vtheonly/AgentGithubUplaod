-- ============================================================================
-- T-061 live verification — proof trigger scoping
-- Stores results in a temp table so we can SELECT them at the end
-- (supabase CLI doesn't surface RAISE NOTICE output).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS t061_results (scenario text, outcome text, detail text);

INSERT INTO public.parents (id, tenant_id, parent_code, first_name, last_name, primary_phone, is_active, created_at, updated_at)
VALUES ('11111111-1111-1111-1111-100000000001', '00000000-0000-0000-0000-000000000001', 'PAR-T061-A', 'T061', 'TestParent', '0000000000', true, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.students (id, tenant_id, parent_id, student_code, first_name, last_name, date_of_birth, grade_level_code, enrollment_status, is_active, created_at, updated_at)
VALUES ('22222222-2222-2222-2222-200000000001', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-100000000001', 'ELV-T061-1', 'T061', 'TestStudent', '2015-01-01', '1am', 'active', true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- Scenario 1: INSERT a check payment WITH proof → succeeds
DO $$
  DECLARE v_pay_id uuid;
BEGIN
  INSERT INTO public.payments (
    id, tenant_id, payment_number, parent_id, student_id, amount, method, status, category,
    receipt_number, proof_path, check_number, check_bank_name,
    collected_by, collected_at, created_at, updated_at
  ) VALUES (
    '33333333-3333-3333-3333-300000000001',
    '00000000-0000-0000-0000-000000000001',
    'PAY-T061-1',
    '11111111-1111-1111-1111-100000000001',
    '22222222-2222-2222-2222-200000000001',
    10000, 'check', 'pending', 'tuition',
    'REC-T061-1', 'proofs/t061-check-1.pdf', 'CHK-001', 'BNA',
    '00000000-0000-0000-0000-000000000001', now(), now(), now()
  ) RETURNING id INTO v_pay_id;
  INSERT INTO t061_results VALUES ('S1: INSERT check WITH proof', 'PASS', 'inserted id=' || v_pay_id);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t061_results VALUES ('S1: INSERT check WITH proof', 'FAIL', SQLERRM);
END $$;

-- Scenario 2: INSERT a check payment WITHOUT proof → fails (preserved)
DO $$
BEGIN
  INSERT INTO public.payments (
    id, tenant_id, payment_number, parent_id, student_id, amount, method, status, category,
    receipt_number, collected_by, collected_at, created_at, updated_at
  ) VALUES (
    '33333333-3333-3333-3333-300000000002',
    '00000000-0000-0000-0000-000000000001',
    'PAY-T061-2',
    '11111111-1111-1111-1111-100000000001',
    '22222222-2222-2222-2222-200000000001',
    10000, 'check', 'pending', 'tuition',
    'REC-T061-2', '00000000-0000-0000-0000-000000000001', now(), now(), now()
  );
  INSERT INTO t061_results VALUES ('S2: INSERT check WITHOUT proof', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t061_results VALUES ('S2: INSERT check WITHOUT proof', 'PASS (expected fail)', SQLERRM);
END $$;

-- Scenario 3: UPDATE a check payment's status only → succeeds
DO $$
BEGIN
  UPDATE public.payments SET status = 'paid', updated_at = now()
   WHERE id = '33333333-3333-3333-3333-300000000001';
  INSERT INTO t061_results VALUES ('S3: status-only UPDATE (proof kept)', 'PASS', 'transitioned to paid');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t061_results VALUES ('S3: status-only UPDATE (proof kept)', 'FAIL', SQLERRM);
END $$;

-- Scenario 4: legacy NULL-proof check row → status-only UPDATE
DO $$
BEGIN
  ALTER TABLE public.payments DISABLE TRIGGER payments_enforce_proof;
  INSERT INTO public.payments (
    id, tenant_id, payment_number, parent_id, student_id, amount, method, status, category,
    receipt_number, check_number, check_bank_name,
    collected_by, collected_at, created_at, updated_at
  ) VALUES (
    '33333333-3333-3333-3333-300000000003',
    '00000000-0000-0000-0000-000000000001',
    'PAY-T061-3',
    '11111111-1111-1111-1111-100000000001',
    '22222222-2222-2222-2222-200000000001',
    10000, 'check', 'pending', 'tuition',
    'REC-T061-3', 'CHK-003', 'BNA',
    '00000000-0000-0000-0000-000000000001', now(), now(), now()
  );
  ALTER TABLE public.payments ENABLE TRIGGER payments_enforce_proof;
  UPDATE public.payments SET status = 'paid', updated_at = now()
   WHERE id = '33333333-3333-3333-3333-300000000003';
  INSERT INTO t061_results VALUES ('S4: status-only UPDATE on legacy NULL-proof check', 'PASS', 'T-061 fix verified');
EXCEPTION WHEN OTHERS THEN
  ALTER TABLE public.payments ENABLE TRIGGER payments_enforce_proof;
  INSERT INTO t061_results VALUES ('S4: status-only UPDATE on legacy NULL-proof check', 'FAIL', 'T-061 fix did NOT take effect: ' || SQLERRM);
END $$;

-- Scenario 5: UPDATE a check payment's method to cash → succeeds
DO $$
BEGIN
  UPDATE public.payments SET method = 'cash', status = 'paid', updated_at = now()
   WHERE id = '33333333-3333-3333-3333-300000000003';
  INSERT INTO t061_results VALUES ('S5: method change check→cash', 'PASS', 'transitioned to cash/paid');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t061_results VALUES ('S5: method change check→cash', 'FAIL', SQLERRM);
END $$;

-- Scenario 6: UPDATE a check payment's proof_path to NULL → fails
DO $$
BEGIN
  UPDATE public.payments SET proof_path = NULL, updated_at = now()
   WHERE id = '33333333-3333-3333-3333-300000000001';
  INSERT INTO t061_results VALUES ('S6: explicit proof_path clear', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t061_results VALUES ('S6: explicit proof_path clear', 'PASS (expected fail)', SQLERRM);
END $$;

-- Scenario 7: INSERT a cash payment (NULL status auto-derived to 'paid')
DO $$
  DECLARE v_status text;
BEGIN
  INSERT INTO public.payments (
    id, tenant_id, payment_number, parent_id, student_id, amount, method, status, category,
    receipt_number, collected_by, collected_at, created_at, updated_at
  ) VALUES (
    '33333333-3333-3333-3333-300000000004',
    '00000000-0000-0000-0000-000000000001',
    'PAY-T061-4',
    '11111111-1111-1111-1111-100000000001',
    '22222222-2222-2222-2222-200000000001',
    5000, 'cash', NULL, 'tuition',
    'REC-T061-4', '00000000-0000-0000-0000-000000000001', now(), now(), now()
  )
  RETURNING status INTO v_status;
  IF v_status = 'paid' THEN
    INSERT INTO t061_results VALUES ('S7: cash payment auto-status', 'PASS', 'NULL status auto-set to paid');
  ELSE
    INSERT INTO t061_results VALUES ('S7: cash payment auto-status', 'FAIL', 'status=' || v_status || ' (expected paid)');
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO t061_results VALUES ('S7: cash payment auto-status', 'FAIL', SQLERRM);
END $$;

SELECT scenario, outcome, detail FROM t061_results ORDER BY scenario;

ROLLBACK;
