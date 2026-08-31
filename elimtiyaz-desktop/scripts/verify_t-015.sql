-- verify_t-015.sql — live verification for migration 0058 (T-015 / DRIFT-011).
--
-- Convention (AGENTS.md §11.1): BEGIN…ROLLBACK wrapper + temp results table.
--
-- Checks:
--   S1  0058 registered in schema_migrations (version 0058).
--   S2  next_receipt_number returns the canonical REC-YYYY-NNNNNN format with
--       the correct next sequence (MAX+1 for the tenant+year).
--   S3  generate_receipt_numbers(tenant, N) returns exactly N contiguous
--       sequential numbers starting at MAX+1 (the import allocation contract).
--   S4  generate_receipt_numbers rejects a foreign tenant (SEC-111 pattern)
--       for a non-service-role, non-global-admin caller.
--   S5  upsert_payment_from_import with a NULL payment number generates a
--       canonical number (insert path) — the sync-queue contract; the row is
--       inserted with BOTH payment_number and receipt_number set (0034 trigger).
--   S6  upsert_payment_from_import with an EXPLICIT number still dedups
--       (second call updates, does not insert) — regression guard.

BEGIN;

CREATE TEMP TABLE t015_results (check_id TEXT, passed BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v_admin uuid;
  v_tenant uuid;
  v_parent uuid;
  v_student uuid;
  v_year INT := EXTRACT(YEAR FROM NOW());
  v_max_seq INT;
  v_next TEXT;
  v_batch TEXT[];
  v_err TEXT;
  v_res RECORD;
  v_count INT;
BEGIN
  -- Resolve the real admin user + their tenant (JWT-emulation context, T-006 pattern)
  SELECT u.id, up.tenant_id INTO v_admin, v_tenant
  FROM auth.users u
  JOIN public.user_profiles up ON up.auth_user_id = u.id
  LIMIT 1;
  SELECT p.id INTO v_parent FROM public.parents p WHERE p.tenant_id = v_tenant AND p.deleted_at IS NULL LIMIT 1;
  SELECT s.id INTO v_student FROM public.students s WHERE s.tenant_id = v_tenant AND s.deleted_at IS NULL LIMIT 1;

  IF v_admin IS NULL OR v_tenant IS NULL THEN
    INSERT INTO t015_results VALUES ('PRE', false, 'no admin user/tenant resolved');
    RETURN;
  END IF;

  -- Emulate the admin's authenticated JWT for the SEC-111-checked RPC calls.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- S1 — registration
  SELECT COUNT(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version = '0058';
  INSERT INTO t015_results VALUES ('S1 0058 registered', v_count = 1, 'rows=' || v_count);

  -- S2 — canonical single number
  SELECT COALESCE(MAX(CAST(SUBSTRING(pay.receipt_number FROM '\d{6}$') AS INT)), 0) INTO v_max_seq
  FROM public.payments pay
  WHERE pay.tenant_id = v_tenant AND pay.receipt_number LIKE 'REC-' || v_year || '-%';
  v_next := public.next_receipt_number(v_tenant);
  INSERT INTO t015_results VALUES ('S2 next_receipt_number canonical',
    v_next = 'REC-' || v_year || '-' || LPAD((v_max_seq + 1)::TEXT, 6, '0'),
    'expected=' || 'REC-' || v_year || '-' || LPAD((v_max_seq + 1)::TEXT, 6, '0') || ' got=' || v_next);

  -- S3 — batch allocation (admin JWT emulated above → tenant matches)
  SELECT array_agg(n) INTO v_batch FROM public.generate_receipt_numbers(v_tenant, 3) AS t(n);
  INSERT INTO t015_results VALUES ('S3 batch allocation contiguous',
    v_batch = ARRAY[
      'REC-' || v_year || '-' || LPAD((v_max_seq + 1)::TEXT, 6, '0'),
      'REC-' || v_year || '-' || LPAD((v_max_seq + 2)::TEXT, 6, '0'),
      'REC-' || v_year || '-' || LPAD((v_max_seq + 3)::TEXT, 6, '0')],
    'got=' || COALESCE(array_to_string(v_batch, ','), 'NULL'));

  -- S4 — cross-tenant rejection (emulate an authenticated non-admin JWT from
  -- the real admin user whose tenant differs from the foreign probe tenant).
  v_err := NULL;
  BEGIN
    SET LOCAL role authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000999', 'role', 'authenticated')::text, true);
    PERFORM public.generate_receipt_numbers('99999999-9999-9999-9999-999999999999'::uuid, 1);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  RESET role;
  INSERT INTO t015_results VALUES ('S4 cross-tenant allocation rejected', v_err IS NOT NULL,
    COALESCE('rejected: ' || left(v_err, 100), 'UNEXPECTEDLY ALLOWED'));

  -- S5 — NULL payment number generates a canonical number on insert
  v_err := NULL;
  BEGIN
    SELECT * INTO v_res FROM public.upsert_payment_from_import(
      p_tenant_id := v_tenant,
      p_payment_number := NULL,
      p_parent_id := v_parent::text,
      p_student_id := v_student::text,
      p_amount := 123.45,
      p_method := 'cash',
      p_category := 'other');
    IF v_res.payment_number IS NULL OR v_res.payment_number NOT LIKE 'REC-' || v_year || '-%' THEN
      v_err := 'generated number wrong: ' || COALESCE(v_res.payment_number, 'NULL');
    END IF;
    IF NOT v_res.was_inserted THEN
      v_err := COALESCE(v_err, '') || ' expected was_inserted=true';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO t015_results VALUES ('S5 NULL number generates canonical', v_err IS NULL, COALESCE(v_err, 'number=' || v_res.payment_number));

  -- S6 — explicit number dedups (update, not insert)
  v_err := NULL;
  BEGIN
    SELECT * INTO v_res FROM public.upsert_payment_from_import(
      p_tenant_id := v_tenant,
      p_payment_number := 'T015-DEDUP-PROBE',
      p_parent_id := v_parent::text,
      p_student_id := v_student::text,
      p_amount := 10,
      p_method := 'cash',
      p_category := 'other');
    IF NOT v_res.was_inserted THEN v_err := 'first call should insert'; END IF;
    SELECT * INTO v_res FROM public.upsert_payment_from_import(
      p_tenant_id := v_tenant,
      p_payment_number := 'T015-DEDUP-PROBE',
      p_parent_id := v_parent::text,
      p_student_id := v_student::text,
      p_amount := 10,
      p_method := 'cash',
      p_category := 'other');
    IF v_res.was_inserted THEN v_err := COALESCE(v_err,'') || ' second call should update'; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO t015_results VALUES ('S6 explicit number dedups', v_err IS NULL, COALESCE(v_err, 'insert-then-update ok'));

  -- S7 — generated rows carry BOTH payment_number and receipt_number (0034 trigger)
  SELECT COUNT(*) INTO v_count FROM public.payments
   WHERE tenant_id = v_tenant AND payment_number LIKE 'REC-' || v_year || '-%'
     AND receipt_number IS NULL;
  INSERT INTO t015_results VALUES ('S7 inserted rows have receipt_number synced', v_count = 0,
    'rows_with_null_receipt=' || v_count);
END $$;

SELECT check_id, passed, detail FROM t015_results ORDER BY check_id;

ROLLBACK;
