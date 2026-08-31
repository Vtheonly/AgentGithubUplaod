-- ============================================================================
-- 0058_receipt_number_server_allocation.sql
-- ============================================================================
-- T-015 / DRIFT-011 — server-authoritative receipt numbers for the import +
-- sync paths (ADR-004: receipt numbers are sequential, per-tenant, per-year,
-- generated server-side; the ONLY client-side generators left after this
-- migration are the Android local ones, toolchain-gated — see the task's
-- Left field).
--
-- WHAT WAS WRONG (DRIFT-011, 5 algorithms):
--   1. collect_and_allocate_payment (0040)   — canonical REC-YYYY-NNNNNN   ✓
--   2. desktop collect() fallback            — random PAY- (REMOVED, T-011)✓
--   3. desktop bulkCollect()                 — PAY-{ts}-{random}           ✗ fixed here
--   4. Android LocalPaymentRepository        — per-device count+1 (T-015 left)
--   5. Android SyncQueueDispatcher fallback  — random PAY- (T-015 left)
--   6. desktop defaultPushHandler            — random PAY-                 ✗ fixed here
--
-- WHAT CHANGES:
--   §1  public.next_receipt_number(p_tenant_id) — the single canonical
--       number generator, algorithm VERBATIM from collect_and_allocate_payment
--       (0040:69-72): MAX(CAST(SUBSTRING(receipt_number FROM '\d{6}$') AS INT))+1
--       filtered by tenant + current year, LPAD 6.
--   §2  public.generate_receipt_numbers(p_tenant_id, p_count) — batch
--       allocation for the Excel importer (bulkCollect): returns the next
--       p_count numbers, guarded by pg_advisory_xact_lock so two concurrent
--       importers cannot compute the same range. Caller-verified with the
--       SEC-111 pattern (service_role / global admin / tenant match).
--   §3  upsert_payment_from_import — when p_payment_number IS NULL or blank,
--       a canonical number is generated server-side (§1) instead of inserting
--       NULL. Serves the desktop sync-queue push (which now passes null
--       instead of a random PAY- number) and any future Android canonical
--       path. Body is the 0055 (SEC-111) version VERBATIM plus the marked
--       T-015 block.
--
-- CONCURRENCY HONESTY (documented residual):
--   generate_receipt_numbers allocates numbers WITHOUT inserting rows. A
--   concurrent interactive collect() can claim MAX+1 (inside the allocated
--   range) between allocation and the importer's bulk INSERT. That collision
--   surfaces as a payments_tenant_id_payment_number_key unique violation →
--   T-012 fail-fast cancels the import → retry succeeds. FAIL-LOUD, never
--   silent (the registry's original complaint was random collision-prone
--   numbers, not this narrow window). NOTE (live-verified 2026-08-31): the
--   unique constraint is on (tenant_id, payment_number) — receipt_number has
--   NO unique constraint (the registry's BUSINESS-006 claim was wrong); the
--   0034 trigger syncs receipt_number := payment_number when NULL, so the
--   import rows land with BOTH fields set, exactly like 0040's canonical row.
--
-- IDEMPOTENCY: create-or-replace only; safe to re-apply.
-- ============================================================================

BEGIN;

-- ─── §1 — canonical single-number generator (0040 algorithm, verbatim) ─────

CREATE OR REPLACE FUNCTION public.next_receipt_number(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = 'public'
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW());
  v_seq INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(pay.receipt_number FROM '\d{6}$') AS INT)), 0) + 1 INTO v_seq
  FROM payments pay
  WHERE pay.tenant_id = p_tenant_id AND pay.receipt_number LIKE 'REC-' || v_year || '-%';
  RETURN 'REC-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');
END;
$$;

COMMENT ON FUNCTION public.next_receipt_number(uuid) IS
  'T-015/DRIFT-011: canonical receipt number (ADR-004) — algorithm verbatim from collect_and_allocate_payment (migration 0040). Read-only; allocation happens in the caller''s transaction.';

-- ─── §2 — batch allocation for the importer (bulkCollect) ──────────────────

CREATE OR REPLACE FUNCTION public.generate_receipt_numbers(p_tenant_id uuid, p_count integer)
RETURNS TABLE(receipt_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW());
  v_seq INT;
  v_i INT;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RETURN;
  END IF;

  -- SEC-111 pattern: the function is SECURITY DEFINER (it must read the
  -- tenant's payments regardless of the caller's RLS). Verify the caller.
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     AND NOT public.is_global_admin()
     AND p_tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
      RAISE EXCEPTION 'generate_receipt_numbers: p_tenant_id does not match the authenticated caller''s tenant (SEC-111 pattern, T-015)';
  END IF;

  -- Serialize concurrent batch allocations for the same tenant so two
  -- importers never compute overlapping ranges. Transaction-scoped: released
  -- automatically at commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext('el-imtiyaz:receipt_numbers:' || p_tenant_id::text));

  SELECT COALESCE(MAX(CAST(SUBSTRING(pay.receipt_number FROM '\d{6}$') AS INT)), 0) INTO v_seq
  FROM payments pay
  WHERE pay.tenant_id = p_tenant_id AND pay.receipt_number LIKE 'REC-' || v_year || '-%';

  FOR v_i IN 1 .. p_count LOOP
    receipt_number := 'REC-' || v_year || '-' || LPAD((v_seq + v_i)::TEXT, 6, '0');
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.generate_receipt_numbers(uuid, integer) IS
  'T-015/DRIFT-011: allocate the next N canonical receipt numbers for a bulk import (advisory-xact-locked against concurrent allocations; see migration header for the documented residual window vs interactive collect).';

-- ─── §3 — upsert_payment_from_import: server-side number when none supplied ─

CREATE OR REPLACE FUNCTION public.upsert_payment_from_import(p_tenant_id uuid, p_payment_number text, p_parent_id text, p_student_id text, p_invoice_id uuid DEFAULT NULL::uuid, p_installment_id text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_method text DEFAULT 'cash'::text, p_category text DEFAULT 'other'::text, p_status text DEFAULT 'paid'::text, p_check_number text DEFAULT NULL::text, p_check_bank_name text DEFAULT NULL::text, p_check_issue_date date DEFAULT NULL::date, p_check_clearance_date date DEFAULT NULL::date, p_transfer_reference text DEFAULT NULL::text, p_transfer_source_bank text DEFAULT NULL::text, p_proof_path text DEFAULT NULL::text, p_collected_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_collected_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_reversal_of_payment_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(payment_id uuid, payment_number text, was_inserted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id uuid;
    v_num text := p_payment_number;
    v_inserted boolean := false;
    v_existing RECORD;
    v_final_status text;
    v_parent uuid := public.resolve_parent_ref(p_tenant_id, p_parent_id);
    v_student uuid := public.resolve_student_ref(p_tenant_id, p_student_id);
    v_installment uuid := public.resolve_installment_ref(p_tenant_id, p_installment_id);
BEGIN
    -- ── SEC-111: caller-tenant verification ──────────────────────────
    -- The SECURITY DEFINER flag bypasses RLS, so without this check any
    -- authenticated caller could write payments into ANY tenant by
    -- passing a foreign p_tenant_id. Trusted exemptions:
    --   - service_role: server-side code (Edge Functions, import jobs);
    --   - global admins (0053): no resolvable current_tenant_id()
    --     (user_profiles.tenant_id IS NULL); the desktop TENANT-103
    --     fallback legitimately targets the demo tenant.
    IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       AND NOT public.is_global_admin()
       AND p_tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
        RAISE EXCEPTION 'upsert_payment_from_import: p_tenant_id does not match the authenticated caller''s tenant (SEC-111)';
    END IF;

    -- ── T-015 / DRIFT-011: server-side canonical number when none supplied.
    -- The desktop sync queue now pushes payments WITHOUT a number when the
    -- queued row carries none (previously a client-side random PAY- number —
    -- collision-prone, wrong format). Dedup by number is meaningless for a
    -- NULL number (the lookup below cannot match), so this path always
    -- INSERTs — correct: nothing identifiable to update.
    IF v_num IS NULL OR btrim(v_num) = '' THEN
        v_num := public.next_receipt_number(p_tenant_id);
    END IF;

    IF v_parent IS NULL THEN
        RAISE EXCEPTION 'upsert_payment_from_import: unresolvable parent ref %', p_parent_id;
    END IF;

    -- NOTE: qualify — `payment_number` is also an output column of the
    -- RETURNS TABLE (unqualified refs are ambiguous).
    SELECT pay.id, pay.payment_number INTO v_existing
      FROM public.payments pay
     WHERE pay.tenant_id = p_tenant_id
       AND pay.payment_number = v_num
     LIMIT 1;

    -- Determine the auto-status for cash vs non-cash (mirrors enforce_payment_proof trigger).
    v_final_status := COALESCE(p_status, CASE WHEN p_method = 'cash' THEN 'paid' ELSE 'pending' END);

    IF FOUND THEN
        v_id := v_existing.id;
        UPDATE public.payments
           SET parent_id        = COALESCE(v_parent, parent_id),
               student_id       = COALESCE(v_student, student_id),
               invoice_id       = COALESCE(p_invoice_id, invoice_id),
               installment_id   = COALESCE(v_installment, installment_id),
               amount           = COALESCE(p_amount, amount),
               method           = COALESCE(NULLIF(p_method, ''), method),
               category         = COALESCE(NULLIF(p_category, ''), category),
               status           = v_final_status,
               check_number     = COALESCE(p_check_number, check_number),
               check_bank_name  = COALESCE(p_check_bank_name, check_bank_name),
               check_issue_date = COALESCE(p_check_issue_date, check_issue_date),
               check_clearance_date = COALESCE(p_check_clearance_date, check_clearance_date),
               transfer_reference = COALESCE(p_transfer_reference, transfer_reference),
               transfer_source_bank = COALESCE(p_transfer_source_bank, transfer_source_bank),
               proof_path       = COALESCE(p_proof_path, proof_path),
               collected_at     = COALESCE(p_collected_at, collected_at),
               collected_by     = COALESCE(p_collected_by, collected_by),
               notes            = COALESCE(p_notes, notes),
               reversal_of_payment_id = COALESCE(p_reversal_of_payment_id, reversal_of_payment_id),
               updated_at       = now()
         WHERE id = v_id;
    ELSE
        v_id := public.gen_uuid();
        v_inserted := true;
        INSERT INTO public.payments (
            id, tenant_id, payment_number, parent_id, student_id, invoice_id, installment_id,
            amount, method, category, status,
            check_number, check_bank_name, check_issue_date, check_clearance_date,
            transfer_reference, transfer_source_bank, proof_path,
            collected_at, collected_by, notes, reversal_of_payment_id,
            created_at, updated_at
        ) VALUES (
            v_id, p_tenant_id, v_num, v_parent, v_student, p_invoice_id, v_installment,
            COALESCE(p_amount, 0), COALESCE(NULLIF(p_method, ''), 'cash'),
            COALESCE(NULLIF(p_category, ''), 'other'), v_final_status,
            p_check_number, p_check_bank_name, p_check_issue_date, p_check_clearance_date,
            p_transfer_reference, p_transfer_source_bank, p_proof_path,
            COALESCE(p_collected_at, now()), p_collected_by, p_notes, p_reversal_of_payment_id,
            now(), now()
        );
    END IF;

    RETURN QUERY SELECT v_id, v_num, v_inserted;
END;
$function$;

COMMIT;
