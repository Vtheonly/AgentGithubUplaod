-- ============================================================================
-- 0115_cross_category_collection_waterfall_inv4.sql
-- T-411 (95th session, 2026-09-23) — ADR-023
--
-- Fixes THREE registered problems in one atomic change (they all touch the
-- same two RPCs — splitting them would leave the chain in a half-repaired
-- state where the desktop TS engine and the SQL twin disagree):
--
-- 1. BUSINESS-106 (CRITICAL): consolidated-debt collection can never
--    allocate across categories. The desktop used to coerce
--    `p_category ?? "tuition"` and the consolidated entry points sent a
--    decorative single category ("other") — the waterfall filter
--    `category = p_category` then restricted allocation to one category
--    (with ZERO 'other' installments live, a consolidated cash collection
--    booked 100% parent_credit and cleared nothing). ADR-023 makes
--    `p_category = NULL` the canonical cross-category scope (financial-
--    rules §4 — a rule the waterfall filters already implemented). The
--    storage columns become NULLABLE so a multi-service payment/entry can
--    exist: `payments.category NULL` = "Multi-services".
--
-- 2. BUSINESS-107 (HIGH): the CLEARED-branch waterfall capacity ignored
--    `amount_pending` (TS + SQL twins — the A-0042 fix covered the pending
--    branch only), and `mark_payment_cleared` had no overflow guard, so a
--    pending cheque followed by cash over-allocated a tranche and the
--    excess silently vanished on clearance. Both branches now compute
--    GREATEST(0, due − paid − pending) (INV-4) and the clearance RPC caps
--    the pending→paid move at (due − paid), booking any leftover as
--    parent_credit instead of absorbing it.
--
-- 3. DATA-029 (server-side half): the waterfall now ALSO writes
--    `payment_allocations` rows (the T-330 canonical per-payment coverage
--    source — previously only the 0062/0063 historical backfills ever
--    populated it, so live collections relied on the ledger receipt-join
--    fallback). Each row carries the CONCRETE category of the installment
--    it satisfied — including for cross-category payments.
--
-- PRESERVED (audit §I): every existing behaviour — exact-category
-- collection (T-060), receipt numbering (ADR-004), audit shape, the
-- parent_credit overpayment entry, deferred credit for pending funds.
--
-- Live application: T-091/MIG-TOKENS pattern (registration below, atomic).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema: NULL category = multi-service (ADR-023)
-- ----------------------------------------------------------------------------
ALTER TABLE public.payments ALTER COLUMN category DROP NOT NULL;
ALTER TABLE public.ledger_entries ALTER COLUMN category DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. collect_and_allocate_payment — INV-4 both branches + cross-category
--    booking + payment_allocations writes. Replaces the 0087 definition
--    (the arg signature is UNCHANGED — the old overload is dropped first,
--    §15.32a).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.collect_and_allocate_payment(
  uuid, uuid, uuid, numeric, text, text, uuid, text, text, uuid, text,
  text, text, date, date, text, text, timestamptz);

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
  -- T-310: the RESOLVED actor (name + role).
  v_actor_name TEXT; v_actor_role TEXT;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be > 0 (got %)', p_amount; END IF;

  -- T-310 (AUDIT-502): resolve the actor ONCE, up-front.
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

  -- ADR-023: p_category NULL = multi-service — stored as NULL (the payments
  -- row renders "Multi-services"; per-service truth lives in
  -- payment_allocations). Concrete categories are stored verbatim (T-060).
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

  -- ADR-023: the cross-category payment entry books ONE entry (the revert
  -- RPC reverses a single entry by source_id) on the synthetic account
  -- `parent:{id}:category:all` with a NULL category. Parent-level replay
  -- (Σ signed balances) reduces the outstanding correctly; per-category
  -- views read payment_allocations.
  v_account_id := 'parent:' || p_parent_id || ':category:' || COALESCE(p_category, 'all');
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
    'Encaissement ' || v_receipt || ' — ' || p_method || ' (' || COALESCE(p_category, 'multi-services') || ')',
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
      SELECT id, amount_due, amount_paid, amount_pending, due_date, status, category, label
      FROM installments
      WHERE parent_id = p_parent_id AND status <> 'paid'
        AND (p_category IS NULL OR category = p_category)
      ORDER BY due_date ASC, id ASC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      -- BUSINESS-107 (INV-4): the cleared branch now subtracts
      -- amount_pending too — a cheque pending on the tranche reduces the
      -- capacity for a subsequent CASH payment, so paid + pending can
      -- never exceed due.
      v_ins_remaining := GREATEST(0, v_ins.amount_due - v_ins.amount_paid - v_ins.amount_pending);
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
      -- DATA-029: the canonical per-payment coverage record (T-330 chain).
      -- Concrete category per row — including for cross-category payments.
      INSERT INTO payment_allocations (
        id, tenant_id, payment_id, charge_id, installment_id, category,
        allocated_amount, label, created_at
      ) VALUES (
        gen_random_uuid(), p_tenant_id, v_payment_id, NULL, v_ins.id,
        v_ins.category, v_allocate, v_ins.label, p_as_of
      );
      v_alloc_item := JSONB_BUILD_OBJECT('installmentId', v_ins.id,
        'allocatedAmount', v_allocate, 'newAmountPaid', v_new_paid,
        'newAmountPending', v_new_pending, 'newStatus', v_new_status,
        'fullySatisfied', v_fully, 'cleared', TRUE, 'category', v_ins.category);
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
      SELECT id, amount_due, amount_paid, amount_pending, due_date, status, category, label
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
      -- DATA-029: pending allocations are recorded too (cleared = FALSE is
      -- derivable from the payment's status; the amount is the commitment).
      INSERT INTO payment_allocations (
        id, tenant_id, payment_id, charge_id, installment_id, category,
        allocated_amount, label, created_at
      ) VALUES (
        gen_random_uuid(), p_tenant_id, v_payment_id, NULL, v_ins.id,
        v_ins.category, v_allocate, v_ins.label, p_as_of
      );
      v_alloc_item := JSONB_BUILD_OBJECT('installmentId', v_ins.id,
        'allocatedAmount', v_allocate, 'newAmountPaid', v_new_paid,
        'newAmountPending', v_new_pending, 'newStatus', v_new_status,
        'fullySatisfied', FALSE, 'cleared', FALSE, 'category', v_ins.category);
      v_alloc := v_alloc || JSONB_BUILD_ARRAY(v_alloc_item);
      v_remaining := v_remaining - v_allocate;
    END LOOP;
    v_unallocated := GREATEST(0, v_remaining);
    -- No parent_credit insert for pending funds (canonical defers until clearance)
  END IF;

  -- 6. Audit log (T-310 canonical columns preserved verbatim).
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
      'unallocatedCredit', v_unallocated, 'category', p_category
    ),
    JSONB_BUILD_OBJECT(
      'amount', p_amount, 'method', p_method, 'receipt', v_receipt,
      'status', v_status, 'allocations', v_alloc,
      'unallocatedCredit', v_unallocated, 'category', p_category
    ),
    'Encaissement atomique via RPC collect_and_allocate_payment (canonical 0034 + structured fields; 0115 INV-4/cross-category)',
    p_as_of
  );

  RETURN QUERY SELECT v_payment_id, v_receipt, v_status,
    p_amount - v_unallocated, v_unallocated, v_alloc;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. mark_payment_cleared — overflow guard + excess → parent_credit
--    (BUSINESS-107). Replaces the 0042 definition (signature unchanged).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mark_payment_cleared(uuid, uuid, uuid, text, timestamptz);

CREATE OR REPLACE FUNCTION public.mark_payment_cleared(
  p_tenant_id UUID,
  p_payment_id UUID,
  p_actor_id UUID,
  p_actor_name TEXT DEFAULT 'System',
  p_as_of TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  payment_id UUID,
  payment_status TEXT,
  cleared_installments INT,
  total_cleared NUMERIC(12, 2),
  overflow_credit NUMERIC(12, 2)
) AS $$
DECLARE
  v_payment RECORD;
  v_remaining NUMERIC;
  v_cleared_count INT := 0;
  v_total_cleared NUMERIC := 0;
  v_overflow NUMERIC := 0;
  v_ins RECORD;
  v_new_paid NUMERIC;
  v_new_pending NUMERIC;
  v_new_status TEXT;
  v_capacity NUMERIC;
  v_moved NUMERIC;
BEGIN
  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;
  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending payments can be cleared (current status: %)', v_payment.status;
  END IF;

  UPDATE payments
    SET status = 'paid', updated_at = p_as_of
    WHERE id = p_payment_id;

  v_remaining := v_payment.amount;
  FOR v_ins IN
    SELECT id, amount_due, amount_paid, amount_pending, category, status, paid_date
    FROM installments
    WHERE parent_id = v_payment.parent_id
      AND amount_pending > 0
      AND (v_payment.category IS NULL OR category = v_payment.category)
    ORDER BY due_date ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    -- BUSINESS-107 (INV-4): the pending→paid move is capped at the
    -- tranche's REMAINING CAPACITY (due − paid), never at the raw pending
    -- amount. Pre-0115 data could carry paid + pending > due (the
    -- cleared-branch bug); the cap stops the clearance from pushing
    -- amount_paid beyond amount_due.
    v_capacity := GREATEST(0, v_ins.amount_due - v_ins.amount_paid);
    v_moved := LEAST(v_remaining, v_ins.amount_pending, v_capacity);
    IF v_moved <= 0 THEN CONTINUE; END IF;
    v_new_paid := v_ins.amount_paid + v_moved;
    v_new_pending := GREATEST(0, v_ins.amount_pending - v_moved);
    IF v_new_paid >= v_ins.amount_due THEN
      v_new_status := 'paid';
    ELSIF v_new_paid > 0 THEN
      v_new_status := 'partial';
    ELSE
      -- Canonical reevaluateInstallmentStatus (clearance.ts) at the op clock.
      IF v_ins.due_date < p_as_of THEN
        v_new_status := 'overdue';
      ELSE
        v_new_status := 'pending';
      END IF;
    END IF;
    UPDATE installments
      SET amount_paid = v_new_paid,
          amount_pending = v_new_pending,
          status = v_new_status,
          paid_date = CASE WHEN v_new_status = 'paid' THEN COALESCE(v_ins.paid_date, p_as_of) ELSE v_ins.paid_date END,
          updated_at = p_as_of
        WHERE id = v_ins.id;
    INSERT INTO audit_logs (
      id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
      diff, note, created_at
    ) VALUES (
      gen_random_uuid(), p_tenant_id, 'installment.clear_funds', 'installment', v_ins.id,
      p_actor_id, p_actor_name,
      JSONB_BUILD_OBJECT(
        'before', JSONB_BUILD_OBJECT('amountPaid', v_ins.amount_paid, 'amountPending', v_ins.amount_pending, 'status', v_ins.status),
        'after', JSONB_BUILD_OBJECT('amountPaid', v_new_paid, 'amountPending', v_new_pending, 'status', v_new_status, 'cleared', v_moved)
      ),
      'Compensation bancaire — paiement ' || p_payment_id::TEXT || ' confirmé.',
      p_as_of
    );
    v_cleared_count := v_cleared_count + 1;
    v_total_cleared := v_total_cleared + v_moved;
    v_remaining := v_remaining - v_moved;
  END LOOP;

  -- BUSINESS-107: any cleared funds that could NOT move (every tranche at
  -- capacity) become parent_credit — previously they silently vanished
  -- from every read surface.
  v_overflow := GREATEST(0, v_remaining);
  IF v_overflow > 0 THEN
    INSERT INTO ledger_entries (
      entry_number, tenant_id, account_id, parent_id, student_id, category, amount,
      entry_type, source_type, source_id, method, receipt_number, payment_status,
      reverses_id, description, actor_id, actor_name, at, metadata
    ) VALUES (
      'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8),
      p_tenant_id, 'parent:' || v_payment.parent_id || ':category:parent_credit',
      v_payment.parent_id, NULL, 'parent_credit', -v_overflow,
      'adjustment', 'adjustment', 'credit-' || p_payment_id::TEXT,
      NULL, NULL, NULL, NULL,
      'Crédit parent (excédent de compensation — paiement ' || v_payment.receipt_number || ')',
      p_actor_id::TEXT, p_actor_name, p_as_of,
      JSONB_BUILD_OBJECT('sourcePaymentId', p_payment_id, 'overflowCredit', v_overflow)
    );
  END IF;

  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.mark_cleared', 'payment', p_payment_id,
    p_actor_id, p_actor_name,
    JSONB_BUILD_OBJECT(
      'before', JSONB_BUILD_OBJECT('status', 'pending', 'amount', v_payment.amount),
      'after', JSONB_BUILD_OBJECT('status', 'paid', 'clearedInstallments', v_cleared_count,
                                  'totalCleared', v_total_cleared, 'overflowCredit', v_overflow)
    ),
    'Compensation bancaire confirmée pour ' || v_payment.receipt_number,
    p_as_of
  );

  RETURN QUERY
    SELECT p_payment_id, 'paid'::TEXT, v_cleared_count, v_total_cleared, v_overflow;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- 4. Registration (T-091/MIG-TOKENS pattern — atomic with the DDL for the
--    Management-API live application; idempotent via ON CONFLICT)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0115', '{0115_cross_category_collection_waterfall_inv4.sql}', 'cross_category_collection_waterfall_inv4')
on conflict (version) do nothing;
