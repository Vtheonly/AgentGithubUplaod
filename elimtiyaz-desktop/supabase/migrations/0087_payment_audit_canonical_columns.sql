-- ============================================================================
-- 0087_payment_audit_canonical_columns.sql
-- ============================================================================
-- T-310 (49th session, 2026-09-12) — AUDIT-500 residual / AUDIT-502: the
-- payment RPCs wrote their audit payload ONLY into the legacy `diff`
-- column, leaving before_json/after_json NULL.
--
-- OWNER REPORT (the bug's reason to exist):
--   "There is a problem with the payment audit … the audit is not bringing
--   up the payment details correctly." Root cause (live evidence,
--   2026-09-12): every payment.collect row carries
--   before_json = NULL, after_json = NULL, and the full payment result
--   (amount / method / status / receipt / allocations / unallocatedCredit)
--   ONLY in `diff` — a column NO client mapper read. The desktop drawer
--   rendered "structurally identical (no fields changed)" for every
--   payment; the Android sheet rendered its honest-empty state.
--   SECONDARY: the desktop passed the user ID as p_actor_name, so
--   actor_name showed a raw UUID ("dac9c821-…") in the attribution block.
--
-- FIX (server-authoritative, one implementation for every caller):
--   1. collect_and_allocate_payment: the audit INSERT now ALSO writes
--      after_json (the created-payment result — INSERT semantics, before
--      stays NULL) and actor_role. The legacy `diff` column keeps the same
--      payload (backward compat for anything still reading it).
--   2. revert_payment_allocation: the audit INSERT now ALSO writes
--      before_json (the pre-refund status snapshot) + after_json (the
--      refund result) + actor_role.
--   3. Actor resolution (BOTH functions, 0086's pattern): when p_actor_name
--      is NULL the display name + role resolve server-side from
--      user_profiles (by profile id OR auth_user_id — the desktop passes
--      session.userId) with the 'System' fallback for service-role jobs.
--      The resolved name ALSO lands in the ledger_entries.actor_name
--      columns (previously NULL when the caller passed NULL).
--
-- The function bodies are reproduced from the LIVE deployed definitions
-- (pg_get_functiondef, 2026-09-12 — includes the 0039/0040 structured-
-- fields extensions and every FRESH-DB/SEC-112 fix) with ONLY the audit
-- INSERTs and the actor resolution changed. No business logic touched:
-- the waterfall, LIFO reversal, receipt sequencing and ledger writes are
-- byte-identical.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. collect_and_allocate_payment — canonical audit columns + actor resolution
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collect_and_allocate_payment(
  p_tenant_id uuid, p_parent_id uuid, p_student_id uuid, p_amount numeric,
  p_method text, p_category text, p_installment_id uuid, p_proof_path text,
  p_notes text, p_actor_id uuid, p_actor_name text,
  p_check_number text DEFAULT NULL::text, p_check_bank_name text DEFAULT NULL::text,
  p_check_issue_date date DEFAULT NULL::date, p_check_clearance_date date DEFAULT NULL::date,
  p_transfer_reference text DEFAULT NULL::text, p_transfer_source_bank text DEFAULT NULL::text,
  p_as_of timestamp with time zone DEFAULT now()
)
 RETURNS TABLE(payment_id uuid, receipt_number text, payment_status text, total_allocated numeric, unallocated_credit numeric, allocations jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW()); v_seq INT; v_receipt TEXT; v_status TEXT;
  v_payment_id UUID := gen_random_uuid(); v_ledger_id TEXT; v_remaining NUMERIC;
  v_alloc JSONB := '[]'::JSONB; v_alloc_item JSONB; v_ins RECORD; v_unallocated NUMERIC := 0;
  v_account_id TEXT; v_ins_remaining NUMERIC; v_allocate NUMERIC; v_new_paid NUMERIC;
  v_new_pending NUMERIC; v_new_status TEXT; v_fully BOOLEAN;
  -- T-310: the RESOLVED actor (name + role) — used by the ledger writes and
  -- the audit row. NULL p_actor_name resolves server-side (0086's pattern).
  v_actor_name TEXT; v_actor_role TEXT;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be > 0 (got %)', p_amount; END IF;

  -- T-310 (AUDIT-502): resolve the actor ONCE, up-front.
  --   p_actor_name supplied  → keep it (backward compat: mock-mode labels,
  --                            equivalence probes, Android labels).
  --   p_actor_name NULL      → look the profile up by p_actor_id (matching
  --                            user_profiles.id OR auth_user_id — the desktop
  --                            passes session.userId) and use display_name;
  --                            unresolvable (service-role imports) → 'System'.
  IF p_actor_name IS NOT NULL AND p_actor_name <> '' AND p_actor_name <> p_actor_id::TEXT THEN
    v_actor_name := p_actor_name;
  ELSE
    SELECT coalesce(up.display_name, up.email) INTO v_actor_name
      FROM public.user_profiles up
     WHERE up.id = p_actor_id OR up.auth_user_id = p_actor_id
     ORDER BY (up.id = p_actor_id) DESC
     LIMIT 1;
    v_actor_name := coalesce(v_actor_name, 'System');
  END IF;
  SELECT r.code INTO v_actor_role
    FROM public.role_assignments ra
    JOIN public.roles r ON r.id = ra.role_id
   WHERE ra.user_profile_id = (
         SELECT up.id FROM public.user_profiles up
          WHERE up.id = p_actor_id OR up.auth_user_id = p_actor_id
          ORDER BY (up.id = p_actor_id) DESC LIMIT 1)
     AND ra.revoked_at IS NULL
   ORDER BY r.code
   LIMIT 1;

  v_status := CASE WHEN p_method = 'cash' THEN 'paid' ELSE 'pending' END;

  SELECT COALESCE(MAX(CAST(SUBSTRING(pay.receipt_number FROM '\d{6}$') AS INT)), 0) + 1 INTO v_seq
  FROM payments pay
  WHERE pay.tenant_id = p_tenant_id AND pay.receipt_number LIKE 'REC-' || v_year || '-%';
  v_receipt := 'REC-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');

  INSERT INTO payments (
    id, tenant_id, payment_number, receipt_number, parent_id, student_id, amount,
    method, status, category, installment_id, proof_path, notes,
    check_number, check_bank_name, check_issue_date, check_clearance_date,
    transfer_reference, transfer_source_bank,
    collected_by, collected_at, created_at, updated_at
  ) VALUES (
    v_payment_id, p_tenant_id, v_receipt, v_receipt, p_parent_id, p_student_id, p_amount,
    p_method, v_status, p_category, p_installment_id, p_proof_path, p_notes,
    p_check_number, p_check_bank_name, p_check_issue_date, p_check_clearance_date,
    p_transfer_reference, p_transfer_source_bank,
    p_actor_id, p_as_of, p_as_of, p_as_of
  );

  v_account_id := 'parent:' || p_parent_id || ':category:' || p_category;
  IF p_student_id IS NOT NULL THEN v_account_id := v_account_id || ':student:' || p_student_id; END IF;
  v_ledger_id := 'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8);
  INSERT INTO ledger_entries (
    entry_number, tenant_id, account_id, parent_id, student_id, category, amount,
    entry_type, source_type, source_id, method, receipt_number, payment_status,
    reverses_id, description, actor_id, actor_name, at, metadata
  ) VALUES (
    v_ledger_id, p_tenant_id, v_account_id, p_parent_id, p_student_id,
    p_category, -p_amount, 'payment', 'payment', v_payment_id::TEXT,
    p_method, v_receipt, v_status, NULL,
    'Encaissement ' || v_receipt || ' — ' || p_method || ' (' || p_category || ')',
    p_actor_id::TEXT, v_actor_name, p_as_of,
    JSONB_BUILD_OBJECT(
      'installmentId', p_installment_id, 'proofUrl', p_proof_path,
      'checkNumber', p_check_number, 'checkBankName', p_check_bank_name,
      'checkIssueDate', p_check_issue_date, 'checkClearanceDate', p_check_clearance_date,
      'transferReference', p_transfer_reference, 'transferSourceBank', p_transfer_source_bank
    )
  );

  v_remaining := p_amount;
  IF v_status = 'paid' THEN
    FOR v_ins IN
      SELECT id, amount_due, amount_paid, amount_pending, due_date, status
      FROM installments
      WHERE parent_id = p_parent_id AND status <> 'paid'
        AND (p_category IS NULL OR category = p_category)
      ORDER BY due_date ASC, id ASC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_ins_remaining := GREATEST(0, v_ins.amount_due - v_ins.amount_paid);
      IF v_ins_remaining <= 0 THEN CONTINUE; END IF;
      v_allocate := LEAST(v_remaining, v_ins_remaining);
      v_new_paid := v_ins.amount_paid + v_allocate;
      v_new_pending := v_ins.amount_pending;
      v_fully := v_new_paid >= v_ins.amount_due;
      IF v_fully THEN v_new_status := 'paid';
      ELSIF v_new_paid > 0 THEN v_new_status := 'partial';
      ELSE v_new_status := CASE WHEN v_ins.status = 'overdue' THEN 'overdue' ELSE 'pending' END; END IF;
      UPDATE installments
        SET amount_paid = v_new_paid, amount_pending = v_new_pending,
            status = v_new_status,
            paid_date = CASE WHEN v_new_status = 'paid' THEN COALESCE(paid_date, p_as_of) ELSE paid_date END
        WHERE id = v_ins.id;
      v_alloc_item := JSONB_BUILD_OBJECT('installmentId', v_ins.id,
        'allocatedAmount', v_allocate, 'newAmountPaid', v_new_paid,
        'newAmountPending', v_new_pending, 'newStatus', v_new_status,
        'fullySatisfied', v_fully, 'cleared', TRUE);
      v_alloc := v_alloc || JSONB_BUILD_ARRAY(v_alloc_item);
      v_remaining := v_remaining - v_allocate;
    END LOOP;
    v_unallocated := GREATEST(0, v_remaining);
    IF v_unallocated > 0 THEN
      INSERT INTO ledger_entries (
        entry_number, tenant_id, account_id, parent_id, student_id, category, amount,
        entry_type, source_type, source_id, method, receipt_number, payment_status,
        reverses_id, description, actor_id, actor_name, at, metadata
      ) VALUES (
        'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8),
        p_tenant_id, 'parent:' || p_parent_id || ':category:parent_credit',
        p_parent_id, NULL, 'parent_credit', -v_unallocated,
        'adjustment', 'adjustment', 'credit-' || v_payment_id::TEXT,
        NULL, NULL, NULL, NULL,
        'Crédit parent (excédent de paiement reçu ' || v_receipt || ')',
        p_actor_id::TEXT, v_actor_name, p_as_of,
        JSONB_BUILD_OBJECT('sourcePaymentId', v_payment_id, 'unallocatedAmount', v_unallocated)
      );
    END IF;
  ELSE
    FOR v_ins IN
      SELECT id, amount_due, amount_paid, amount_pending, due_date, status
      FROM installments
      WHERE parent_id = p_parent_id AND status <> 'paid'
        AND (p_category IS NULL OR category = p_category)
      ORDER BY due_date ASC, id ASC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_ins_remaining := GREATEST(0, v_ins.amount_due - v_ins.amount_paid - v_ins.amount_pending);
      IF v_ins_remaining <= 0 THEN CONTINUE; END IF;
      v_allocate := LEAST(v_remaining, v_ins_remaining);
      v_new_paid := v_ins.amount_paid;
      v_new_pending := v_ins.amount_pending + v_allocate;
      v_new_status := 'pending_clearance'; v_fully := FALSE;
      UPDATE installments
        SET amount_paid = v_new_paid, amount_pending = v_new_pending,
            status = v_new_status, paid_date = paid_date
        WHERE id = v_ins.id;
      v_alloc_item := JSONB_BUILD_OBJECT('installmentId', v_ins.id,
        'allocatedAmount', v_allocate, 'newAmountPaid', v_new_paid,
        'newAmountPending', v_new_pending, 'newStatus', v_new_status,
        'fullySatisfied', FALSE, 'cleared', FALSE);
      v_alloc := v_alloc || JSONB_BUILD_ARRAY(v_alloc_item);
      v_remaining := v_remaining - v_allocate;
    END LOOP;
    v_unallocated := GREATEST(0, v_remaining);
    -- No parent_credit insert for pending funds (canonical defers until clearance)
  END IF;

  -- 6. Audit log.
  -- T-310 (AUDIT-502): the payload now lands in the CANONICAL columns too —
  -- after_json carries the created-payment result (INSERT semantics: before
  -- stays NULL, every detail is an addition), the legacy `diff` column keeps
  -- the same object for backward compat, and the actor block carries the
  -- RESOLVED name + role instead of a raw UUID.
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role,
    before_json, after_json, diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.collect', 'payment', v_payment_id,
    p_actor_id, v_actor_name, v_actor_role,
    NULL,
    JSONB_BUILD_OBJECT(
      'amount', p_amount, 'method', p_method, 'receipt', v_receipt,
      'status', v_status, 'allocations', v_alloc,
      'unallocatedCredit', v_unallocated
    ),
    JSONB_BUILD_OBJECT(
      'amount', p_amount, 'method', p_method, 'receipt', v_receipt,
      'status', v_status, 'allocations', v_alloc,
      'unallocatedCredit', v_unallocated
    ),
    'Encaissement atomique via RPC collect_and_allocate_payment (canonical 0034 + structured fields)',
    p_as_of
  );

  RETURN QUERY SELECT v_payment_id, v_receipt, v_status,
    p_amount - v_unallocated, v_unallocated, v_alloc;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. revert_payment_allocation — canonical audit columns + actor resolution
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_payment_allocation(
  p_tenant_id uuid, p_payment_id uuid, p_actor_id uuid, p_actor_name text,
  p_reason text, p_as_of timestamp with time zone DEFAULT now()
)
 RETURNS TABLE(payment_id uuid, new_status text, reversal_entry_id text, reverts_count integer, total_reverted numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_payment RECORD;
  v_original_ledger RECORD;
  v_reversal_id TEXT;
  v_reverts JSONB := '[]'::JSONB;
  v_count INT := 0;
  v_total_reverted NUMERIC := 0;
  v_remaining NUMERIC;
  v_ins RECORD;
  v_revert NUMERIC;
  v_new_paid NUMERIC;
  v_new_pending NUMERIC;
  v_new_status TEXT;
  v_original_was_pending BOOLEAN;
  -- T-310: resolved actor (see collect_and_allocate_payment).
  v_actor_name TEXT; v_actor_role TEXT;
BEGIN
  -- T-310 (AUDIT-502): resolve the actor ONCE (same rules as collect).
  IF p_actor_name IS NOT NULL AND p_actor_name <> '' AND p_actor_name <> p_actor_id::TEXT THEN
    v_actor_name := p_actor_name;
  ELSE
    SELECT coalesce(up.display_name, up.email) INTO v_actor_name
      FROM public.user_profiles up
     WHERE up.id = p_actor_id OR up.auth_user_id = p_actor_id
     ORDER BY (up.id = p_actor_id) DESC
     LIMIT 1;
    v_actor_name := coalesce(v_actor_name, 'System');
  END IF;
  SELECT r.code INTO v_actor_role
    FROM public.role_assignments ra
    JOIN public.roles r ON r.id = ra.role_id
   WHERE ra.user_profile_id = (
         SELECT up.id FROM public.user_profiles up
          WHERE up.id = p_actor_id OR up.auth_user_id = p_actor_id
          ORDER BY (up.id = p_actor_id) DESC LIMIT 1)
     AND ra.revoked_at IS NULL
   ORDER BY r.code
   LIMIT 1;

  -- 1. Lock payment row.
  -- SEC-112: the lookup is now tenant-scoped — a payment from another
  -- tenant is indistinguishable from a nonexistent one ("not found"),
  -- so cross-tenant refunds are impossible even for service_role
  -- callers (which bypass RLS). INVOKER callers were already protected
  -- by the payments RLS SELECT policy; this closes the DEFINER/svc gap.
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;
  IF v_payment.status NOT IN ('paid', 'pending') THEN
    RAISE EXCEPTION 'Payment % is already % (cannot revert)', p_payment_id, v_payment.status;
  END IF;

  -- 2. Update payment status.
  UPDATE payments SET status = 'refunded', updated_at = p_as_of WHERE id = p_payment_id;

  -- 3. Find original ledger entry + insert reversal.
  SELECT * INTO v_original_ledger
    FROM ledger_entries
    WHERE source_type = 'payment' AND source_id = p_payment_id::TEXT AND entry_type = 'payment'
    LIMIT 1;

  IF FOUND THEN
    -- Determine originalWasPending: true if the original payment's status
    -- was 'pending' (uncleared funds). This is the CRITICAL branch.
    v_original_was_pending := (v_original_ledger.payment_status = 'pending');

    -- FRESH-DB FIX: same triple bug (type column, text id into uuid PK,
    -- missing NOT NULL entry_number).
    v_reversal_id := 'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8);
    INSERT INTO ledger_entries (
      entry_number, tenant_id, account_id, parent_id, student_id, category, amount,
      entry_type, source_type, source_id, method, receipt_number, payment_status,
      reverses_id, description, actor_id, actor_name, at, metadata
    ) VALUES (
      v_reversal_id, v_payment.tenant_id, v_original_ledger.account_id,
      v_original_ledger.parent_id, v_original_ledger.student_id,
      v_original_ledger.category, -v_original_ledger.amount,
      'reversal', 'payment', p_payment_id::TEXT,
      -- Canonical: refund/reversal entries have method=null, paymentStatus=null.
      NULL, v_original_ledger.receipt_number, NULL,
      v_original_ledger.id::TEXT,
      'Remboursement ' || v_payment.receipt_number || ' — inversion de l''écriture de paiement',
      p_actor_id::TEXT, v_actor_name, p_as_of,
      JSONB_BUILD_OBJECT('refundReason', p_reason, 'originalPaymentId', p_payment_id, 'originalWasPending', v_original_was_pending)
    );

    -- 4. LIFO reverse-waterfall.
    v_remaining := v_payment.amount;

    IF v_original_was_pending THEN
      -- Pending branch: subtract from amount_pending. NEVER touch amount_paid.
      FOR v_ins IN
        SELECT id, amount_due, amount_paid, amount_pending, due_date, status
        FROM installments
        WHERE parent_id = v_payment.parent_id
          AND amount_pending > 0
          AND (v_payment.category IS NULL OR category = v_payment.category)
        ORDER BY due_date DESC, id DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_revert := LEAST(v_remaining, v_ins.amount_pending);
        v_new_pending := v_ins.amount_pending - v_revert;
        v_new_paid := v_ins.amount_paid;  -- UNCHANGED for pending reversals
        -- Status re-evaluation: pending reversal doesn't change paid amount,
        -- so if there were no cleared funds, tranche reverts to its prior
        -- non-pending status based on amount_paid vs amount_due.
        IF v_new_paid >= v_ins.amount_due AND v_ins.amount_due > 0 THEN
          v_new_status := 'paid';
        ELSIF v_new_paid > 0 THEN
          v_new_status := 'partial';
        ELSIF v_ins.due_date < p_as_of THEN
          v_new_status := 'overdue';
        ELSE
          -- Canonical reevaluateInstallmentStatus: fully unpaid + future due
          -- date reverts to 'pending' (equivalence finding A-0042-LADDER).
          v_new_status := 'pending';
        END IF;
        -- If amount_pending is now 0, status reverts to the above. If > 0,
        -- keep pending_clearance (still has uncleared funds).
        IF v_new_pending > 0 THEN
          v_new_status := 'pending_clearance';
        END IF;
        UPDATE installments
          SET amount_paid = v_new_paid, amount_pending = v_new_pending,
              status = v_new_status,
              paid_date = CASE WHEN v_new_status = 'paid' THEN paid_date ELSE NULL END
          WHERE id = v_ins.id;
        v_reverts := v_reverts || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'installmentId', v_ins.id, 'revertedAmount', v_revert,
          'newAmountPaid', v_new_paid, 'newAmountPending', v_new_pending,
          'newStatus', v_new_status, 'bucket', 'pending'
        ));
        v_count := v_count + 1;
        v_total_reverted := v_total_reverted + v_revert;
        v_remaining := v_remaining - v_revert;
      END LOOP;
    ELSE
      -- Cleared branch: subtract from amount_paid.
      FOR v_ins IN
        SELECT id, amount_due, amount_paid, amount_pending, due_date, status
        FROM installments
        WHERE parent_id = v_payment.parent_id
          AND amount_paid > 0
          AND (v_payment.category IS NULL OR category = v_payment.category)
        ORDER BY due_date DESC, id DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_revert := LEAST(v_remaining, v_ins.amount_paid);
        v_new_paid := v_ins.amount_paid - v_revert;
        v_new_pending := v_ins.amount_pending;  -- unchanged for cleared reversals
        IF v_new_paid >= v_ins.amount_due AND v_ins.amount_due > 0 THEN
          v_new_status := 'paid';
        ELSIF v_new_paid > 0 THEN
          v_new_status := 'partial';
        ELSIF v_ins.due_date < p_as_of THEN
          v_new_status := 'overdue';
        ELSE
          -- Canonical reevaluateInstallmentStatus: fully unpaid + future due
          -- date reverts to 'pending' (equivalence finding A-0042-LADDER).
          v_new_status := 'pending';
        END IF;
        UPDATE installments
          SET amount_paid = v_new_paid, amount_pending = v_new_pending,
              status = v_new_status,
              paid_date = CASE WHEN v_new_status = 'paid' THEN paid_date ELSE NULL END
          WHERE id = v_ins.id;
        v_reverts := v_reverts || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'installmentId', v_ins.id, 'revertedAmount', v_revert,
          'newAmountPaid', v_new_paid, 'newAmountPending', v_new_pending,
          'newStatus', v_new_status, 'bucket', 'paid'
        ));
        v_count := v_count + 1;
        v_total_reverted := v_total_reverted + v_revert;
        v_remaining := v_remaining - v_revert;
      END LOOP;
    END IF;
  END IF;

  -- 5. Audit log.
  -- SEC-112: stamped with the PAYMENT's actual tenant (v_payment.tenant_id),
  -- no longer the caller-supplied p_tenant_id.
  -- T-310 (AUDIT-502): the wrapped {before, after} payload now ALSO lands in
  -- the canonical columns (unwrapped) + actor_role; the legacy `diff` column
  -- keeps the wrapped shape for backward compat.
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role,
    before_json, after_json, diff, note, created_at
  ) VALUES (
    gen_random_uuid(), v_payment.tenant_id, 'payment.refund', 'payment', p_payment_id,
    p_actor_id, v_actor_name, v_actor_role,
    JSONB_BUILD_OBJECT('status', v_payment.status),
    JSONB_BUILD_OBJECT(
      'status', 'refunded', 'reversalEntryId', v_reversal_id,
      'revertsCount', v_count, 'totalReverted', v_total_reverted,
      'originalWasPending', v_original_was_pending
    ),
    JSONB_BUILD_OBJECT(
      'before', JSONB_BUILD_OBJECT('status', v_payment.status),
      'after', JSONB_BUILD_OBJECT(
        'status', 'refunded', 'reversalEntryId', v_reversal_id,
        'revertsCount', v_count, 'totalReverted', v_total_reverted,
        'originalWasPending', v_original_was_pending
      )
    ),
    'Inversion LIFO via RPC revert_payment_allocation (canonical 0034) — ' || COALESCE(p_reason, 'N/A'),
    p_as_of
  );

  RETURN QUERY
    SELECT p_payment_id, 'refunded'::TEXT, v_reversal_id, v_count, v_total_reverted;
END;
$function$;

comment on function public.collect_and_allocate_payment is
  'T-310 (0087): the atomic collect — unchanged business logic (0034 + 0039/0040); the audit row now carries after_json (the created-payment result) + actor_role, and a NULL p_actor_name resolves server-side from user_profiles (the caller passing the user ID as the name is treated as NULL).';

comment on function public.revert_payment_allocation is
  'T-310 (0087): the LIFO reversal — unchanged business logic (0034); the audit row now carries the unwrapped before_json/after_json + actor_role, and a NULL p_actor_name resolves server-side.';
