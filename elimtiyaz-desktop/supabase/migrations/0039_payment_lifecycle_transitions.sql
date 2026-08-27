-- ============================================================================
-- 0039 — Payment lifecycle transitions (vault §07.02) + structured
-- non-cash payment fields (vault §07.01).
--
-- Purely ADDITIVE / backward-compatible:
--   1. `collect_and_allocate_payment` is recreated with 6 additional
--      OPTIONAL parameters (defaulting to NULL) so check / transfer
--      payments can carry their structured fields (check #, bank name,
--      issue date, clearance date, transfer reference, source bank).
--      Existing callers (Android app, Edge Functions, older desktop
--      builds) that omit the new parameters behave EXACTLY as before.
--   2. New atomic RPC `mark_payment_cleared` — the PENDING → PAID
--      transition ("bank clearance verified"): payment status flip +
--      installments' uncleared funds (amount_pending) move into cleared
--      funds (amount_paid) oldest-first + audit_log.
--   3. New atomic RPC `mark_payment_bounced` — the PENDING → UNPAID
--      transition ("check bounces / transfer fails"): payment status flip
--      + LIFO reversal of the uncleared allocation + reversal ledger
--      entry + audit_log with the mandatory reason.
--
-- No existing business logic (waterfall, discounts, pricing, LIFO reversal
-- math) is modified — only new, additive transitions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Recreate collect_and_allocate_payment with optional method fields.
--    Body is IDENTICAL to migration 0026 except:
--      - the new parameters,
--      - the payments INSERT now also persists them,
--      - the ledger metadata includes them for traceability.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION collect_and_allocate_payment(
  p_tenant_id UUID,
  p_parent_id UUID,
  p_student_id UUID,
  p_amount NUMERIC(12, 2),
  p_method TEXT,
  p_category TEXT,
  p_installment_id UUID,
  p_proof_path TEXT,
  p_notes TEXT,
  p_actor_id UUID,
  p_actor_name TEXT,
  p_check_number TEXT DEFAULT NULL,
  p_check_bank_name TEXT DEFAULT NULL,
  p_check_issue_date DATE DEFAULT NULL,
  p_check_clearance_date DATE DEFAULT NULL,
  p_transfer_reference TEXT DEFAULT NULL,
  p_transfer_source_bank TEXT DEFAULT NULL
) RETURNS TABLE (
  payment_id UUID,
  receipt_number TEXT,
  payment_status TEXT,
  total_allocated NUMERIC(12, 2),
  unallocated_credit NUMERIC(12, 2),
  allocations JSONB
) AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW());
  v_seq INT;
  v_receipt TEXT;
  v_status TEXT;
  v_payment_id UUID := gen_random_uuid();
  v_ledger_id TEXT;
  v_remaining NUMERIC;
  v_alloc JSONB := '[]'::JSONB;
  v_alloc_item JSONB;
  v_ins RECORD;
  v_unallocated NUMERIC := 0;
  v_account_id TEXT;
BEGIN
  -- Determine initial status: cash -> paid, check/transfer -> pending.
  v_status := CASE WHEN p_method = 'cash' THEN 'paid' ELSE 'pending' END;

  -- Generate receipt number REC-YYYY-XXXXXX.
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(receipt_number FROM '\d{6}$') AS INT)
  ), 0) + 1 INTO v_seq
  FROM payments
  WHERE tenant_id = p_tenant_id
    AND receipt_number LIKE 'REC-' || v_year || '-%';
  v_receipt := 'REC-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');

  -- 2. Insert payment row (now with the structured non-cash fields).
  INSERT INTO payments (
    id, tenant_id, receipt_number, parent_id, student_id, amount,
    method, status, category, installment_id, proof_path, notes,
    check_number, check_bank_name, check_issue_date, check_clearance_date,
    transfer_reference, transfer_source_bank,
    collected_by, collected_at, created_at, updated_at
  ) VALUES (
    v_payment_id, p_tenant_id, v_receipt, p_parent_id, p_student_id, p_amount,
    p_method, v_status, p_category, p_installment_id, p_proof_path, p_notes,
    p_check_number, p_check_bank_name, p_check_issue_date, p_check_clearance_date,
    p_transfer_reference, p_transfer_source_bank,
    p_actor_id, NOW(), NOW(), NOW()
  );

  -- 3. Insert payment ledger entry (negative credit).
  v_account_id := 'parent:' || p_parent_id || ':category:' || p_category;
  IF p_student_id IS NOT NULL THEN
    v_account_id := v_account_id || ':student:' || p_student_id;
  END IF;
  v_ledger_id := 'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8);
  INSERT INTO ledger_entries (
    id, tenant_id, account_id, parent_id, student_id, category, amount,
    type, source_type, source_id, method, receipt_number, payment_status,
    reverses_id, description, actor_id, actor_name, at, metadata
  ) VALUES (
    v_ledger_id, p_tenant_id, v_account_id, p_parent_id, p_student_id,
    p_category, -p_amount, 'payment', 'payment', v_payment_id::TEXT,
    p_method, v_receipt, v_status, NULL,
    'Encaissement ' || v_receipt || ' — ' || p_method || ' (' || p_category || ')',
    p_actor_id::TEXT, p_actor_name, NOW(),
    JSONB_BUILD_OBJECT(
      'installmentId', p_installment_id, 'proofUrl', p_proof_path,
      'checkNumber', p_check_number, 'checkBankName', p_check_bank_name,
      'transferReference', p_transfer_reference, 'transferSourceBank', p_transfer_source_bank
    )
  );

  -- 4. Waterfall allocation (paid only).
  v_remaining := p_amount;
  IF v_status = 'paid' THEN
    FOR v_ins IN
      SELECT id, amount_due, amount_paid
      FROM installments
      WHERE parent_id = p_parent_id
        AND status <> 'paid'
        AND (p_category IS NULL OR category = p_category)
      ORDER BY due_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      DECLARE
        v_ins_remaining NUMERIC := GREATEST(0, v_ins.amount_due - v_ins.amount_paid);
        v_allocate NUMERIC := LEAST(v_remaining, v_ins_remaining);
        v_new_paid NUMERIC := v_ins.amount_paid + v_allocate;
        v_new_status TEXT;
        v_fully BOOLEAN := v_new_paid >= v_ins.amount_due;
      BEGIN
        IF v_fully THEN
          v_new_status := 'paid';
        ELSIF v_new_paid > 0 THEN
          v_new_status := 'partial';
        ELSE
          v_new_status := 'pending';
        END IF;
        UPDATE installments
          SET amount_paid = v_new_paid, status = v_new_status,
              paid_date = CASE WHEN v_fully THEN NOW() ELSE paid_date END
          WHERE id = v_ins.id;
        v_alloc_item := JSONB_BUILD_OBJECT(
          'installmentId', v_ins.id,
          'allocatedAmount', v_allocate,
          'newAmountPaid', v_new_paid,
          'newStatus', v_new_status,
          'fullySatisfied', v_fully
        );
        v_alloc := v_alloc || JSONB_BUILD_ARRAY(v_alloc_item);
        v_remaining := v_remaining - v_allocate;
      END;
    END LOOP;
    v_unallocated := GREATEST(0, v_remaining);

    -- 5. Overpayment -> parent_credit adjustment ledger entry.
    IF v_unallocated > 0 THEN
      INSERT INTO ledger_entries (
        id, tenant_id, account_id, parent_id, student_id, category, amount,
        type, source_type, source_id, method, receipt_number, payment_status,
        reverses_id, description, actor_id, actor_name, at, metadata
      ) VALUES (
        'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8),
        p_tenant_id,
        'parent:' || p_parent_id || ':category:parent_credit',
        p_parent_id, NULL, 'parent_credit', -v_unallocated,
        'adjustment', 'adjustment', 'credit-' || v_payment_id::TEXT,
        NULL, v_receipt, NULL, NULL,
        'Crédit parent (excédent de paiement reçu ' || v_receipt || ')',
        p_actor_id::TEXT, p_actor_name, NOW(),
        JSONB_BUILD_OBJECT('sourcePaymentId', v_payment_id, 'unallocatedAmount', v_unallocated)
      );
    END IF;
  ELSE
    -- 6. status='pending': update amount_pending only.
    FOR v_ins IN
      SELECT id, amount_due, amount_paid
      FROM installments
      WHERE parent_id = p_parent_id
        AND status <> 'paid'
        AND (p_category IS NULL OR category = p_category)
      ORDER BY due_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      DECLARE
        v_ins_remaining NUMERIC := GREATEST(0, v_ins.amount_due - v_ins.amount_paid);
        v_allocate NUMERIC := LEAST(v_remaining, v_ins_remaining);
      BEGIN
        UPDATE installments
          SET amount_pending = amount_pending + v_allocate,
              status = 'pending_clearance'
          WHERE id = v_ins.id;
        v_alloc_item := JSONB_BUILD_OBJECT(
          'installmentId', v_ins.id,
          'allocatedAmount', v_allocate,
          'cleared', FALSE,
          'newStatus', 'pending_clearance'
        );
        v_alloc := v_alloc || JSONB_BUILD_ARRAY(v_alloc_item);
        v_remaining := v_remaining - v_allocate;
      END;
    END LOOP;
    v_unallocated := GREATEST(0, v_remaining);
  END IF;

  -- 7. Audit log.
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.collect', 'payment', v_payment_id::TEXT,
    p_actor_id::TEXT, p_actor_name,
    JSONB_BUILD_OBJECT(
      'amount', p_amount, 'method', p_method, 'receipt', v_receipt,
      'status', v_status, 'allocations', v_alloc,
      'unallocatedCredit', v_unallocated,
      'checkNumber', p_check_number, 'transferReference', p_transfer_reference
    ),
    'Encaissement atomique via RPC collect_and_allocate_payment',
    NOW()
  );

  -- 8. Return payload.
  RETURN QUERY
    SELECT
      v_payment_id,
      v_receipt,
      v_status,
      p_amount - v_unallocated,
      v_unallocated,
      v_alloc;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. mark_payment_cleared — PENDING → PAID (bank clearance verified).
--    Uncleared funds move amount_pending → amount_paid, oldest tranche
--    first (the same order the waterfall applied them). A tranche may only
--    be 'paid' when CLEARED funds cover it (Invariant 4).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_payment_cleared(
  p_tenant_id UUID,
  p_payment_id UUID,
  p_actor_id UUID,
  p_actor_name TEXT DEFAULT 'System'
) RETURNS TABLE (
  payment_id UUID,
  payment_status TEXT,
  cleared_installments INT,
  total_cleared NUMERIC(12, 2)
) AS $$
DECLARE
  v_payment RECORD;
  v_remaining NUMERIC;
  v_cleared_count INT := 0;
  v_total_cleared NUMERIC := 0;
  v_ins RECORD;
  v_new_paid NUMERIC;
  v_new_pending NUMERIC;
  v_new_status TEXT;
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

  -- 1. Flip the payment status.
  UPDATE payments
    SET status = 'paid', updated_at = NOW()
    WHERE id = p_payment_id;

  -- 2. Move uncleared funds into cleared funds, oldest tranche first.
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
    DECLARE
      v_moved NUMERIC := LEAST(v_remaining, v_ins.amount_pending);
    BEGIN
      v_new_paid := v_ins.amount_paid + v_moved;
      v_new_pending := GREATEST(0, v_ins.amount_pending - v_moved);
      IF v_new_paid >= v_ins.amount_due THEN
        v_new_status := 'paid';
      ELSIF v_new_paid > 0 THEN
        v_new_status := 'partial';
      ELSE
        v_new_status := v_ins.status;
      END IF;
      UPDATE installments
        SET amount_paid = v_new_paid,
            amount_pending = v_new_pending,
            status = v_new_status,
            paid_date = CASE WHEN v_new_status = 'paid' THEN COALESCE(v_ins.paid_date, NOW()) ELSE v_ins.paid_date END,
            updated_at = NOW()
        WHERE id = v_ins.id;
      INSERT INTO audit_logs (
        id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
        diff, note, created_at
      ) VALUES (
        gen_random_uuid(), p_tenant_id, 'installment.clear_funds', 'installment', v_ins.id::TEXT,
        p_actor_id::TEXT, p_actor_name,
        JSONB_BUILD_OBJECT(
          'before', JSONB_BUILD_OBJECT('amountPaid', v_ins.amount_paid, 'amountPending', v_ins.amount_pending, 'status', v_ins.status),
          'after', JSONB_BUILD_OBJECT('amountPaid', v_new_paid, 'amountPending', v_new_pending, 'status', v_new_status, 'cleared', v_moved)
        ),
        'Compensation bancaire — paiement ' || p_payment_id::TEXT || ' confirmé.',
        NOW()
      );
      v_cleared_count := v_cleared_count + 1;
      v_total_cleared := v_total_cleared + v_moved;
      v_remaining := v_remaining - v_moved;
    END;
  END LOOP;

  -- 3. Audit the transition itself.
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.mark_cleared', 'payment', p_payment_id::TEXT,
    p_actor_id::TEXT, p_actor_name,
    JSONB_BUILD_OBJECT(
      'before', JSONB_BUILD_OBJECT('status', 'pending', 'amount', v_payment.amount),
      'after', JSONB_BUILD_OBJECT('status', 'paid', 'clearedInstallments', v_cleared_count, 'totalCleared', v_total_cleared)
    ),
    'Compensation bancaire confirmée pour ' || v_payment.receipt_number,
    NOW()
  );

  RETURN QUERY
    SELECT p_payment_id, 'paid'::TEXT, v_cleared_count, v_total_cleared;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3. mark_payment_bounced — PENDING → UNPAID (check bounces / transfer fails).
--    LIFO reversal of the uncleared allocation + reversal ledger entry that
--    exactly negates the original payment entry (Invariant 5).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_payment_bounced(
  p_tenant_id UUID,
  p_payment_id UUID,
  p_reason TEXT,
  p_actor_id UUID,
  p_actor_name TEXT DEFAULT 'System'
) RETURNS TABLE (
  payment_id UUID,
  payment_status TEXT,
  reverted_installments INT,
  total_reverted NUMERIC(12, 2)
) AS $$
DECLARE
  v_payment RECORD;
  v_original_ledger RECORD;
  v_remaining NUMERIC;
  v_revert_count INT := 0;
  v_total_reverted NUMERIC := 0;
  v_ins RECORD;
  v_new_paid NUMERIC;
  v_new_pending NUMERIC;
  v_new_status TEXT;
BEGIN
  IF p_reason IS NULL OR BTRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'A bounce reason is mandatory (vault §07.02)';
  END IF;

  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;
  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending payments can bounce (current status: %)', v_payment.status;
  END IF;

  -- 1. Flip the payment status to unpaid (the debt returns to unpaid).
  UPDATE payments
    SET status = 'unpaid',
        notes = CONCAT_WS(' | ', notes, 'Rejet: ' || BTRIM(p_reason)),
        updated_at = NOW()
    WHERE id = p_payment_id;

  -- 2. Reversal ledger entry that exactly negates the original payment entry.
  SELECT * INTO v_original_ledger
  FROM ledger_entries
  WHERE source_type = 'payment' AND source_id = p_payment_id::TEXT AND type = 'payment'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO ledger_entries (
      id, tenant_id, account_id, parent_id, student_id, category, amount,
      type, source_type, source_id, method, receipt_number, payment_status,
      reverses_id, description, actor_id, actor_name, at, metadata
    ) VALUES (
      'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8),
      p_tenant_id,
      v_original_ledger.account_id,
      v_original_ledger.parent_id,
      v_original_ledger.student_id,
      v_original_ledger.category,
      -v_original_ledger.amount,
      'reversal', 'payment', p_payment_id::TEXT,
      v_original_ledger.method, v_original_ledger.receipt_number, 'unpaid',
      v_original_ledger.id,
      'Échec d''encaissement ' || v_payment.receipt_number || ' — chèque/virement rejeté',
      p_actor_id::TEXT, p_actor_name, NOW(),
      JSONB_BUILD_OBJECT('bounceReason', BTRIM(p_reason), 'originalPaymentId', p_payment_id)
    );

    -- 3. LIFO reversal of the uncleared allocation (amount_pending).
    v_remaining := v_payment.amount;
    FOR v_ins IN
      SELECT id, amount_due, amount_paid, amount_pending, category, status, paid_date
      FROM installments
      WHERE parent_id = v_payment.parent_id
        AND amount_pending > 0
        AND (v_payment.category IS NULL OR category = v_payment.category)
      ORDER BY due_date DESC, id DESC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      DECLARE
        v_revert NUMERIC := LEAST(v_remaining, v_ins.amount_pending);
      BEGIN
        v_new_paid := v_ins.amount_paid;
        v_new_pending := GREATEST(0, v_ins.amount_pending - v_revert);
        IF v_new_paid >= v_ins.amount_due AND v_ins.amount_due > 0 THEN
          v_new_status := 'paid';
        ELSIF v_new_paid > 0 THEN
          v_new_status := 'partial';
        ELSE
          v_new_status := 'unpaid';
        END IF;
        UPDATE installments
          SET amount_paid = v_new_paid,
              amount_pending = v_new_pending,
              status = v_new_status,
              paid_date = CASE WHEN v_new_status = 'paid' THEN v_ins.paid_date ELSE NULL END,
              updated_at = NOW()
        WHERE id = v_ins.id;
        INSERT INTO audit_logs (
          id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
          diff, note, created_at
        ) VALUES (
          gen_random_uuid(), p_tenant_id, 'installment.revert_allocation', 'installment', v_ins.id::TEXT,
          p_actor_id::TEXT, p_actor_name,
          JSONB_BUILD_OBJECT(
            'before', JSONB_BUILD_OBJECT('amountPaid', v_ins.amount_paid, 'amountPending', v_ins.amount_pending, 'status', v_ins.status),
            'after', JSONB_BUILD_OBJECT('amountPaid', v_new_paid, 'amountPending', v_new_pending, 'status', v_new_status, 'reverted', v_revert)
          ),
          'Rejet bancaire — paiement ' || p_payment_id::TEXT || ' échoué.',
          NOW()
        );
        v_revert_count := v_revert_count + 1;
        v_total_reverted := v_total_reverted + v_revert;
        v_remaining := v_remaining - v_revert;
      END;
    END LOOP;
  END IF;

  -- 4. Audit the bounce transition.
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.mark_bounced', 'payment', p_payment_id::TEXT,
    p_actor_id::TEXT, p_actor_name,
    JSONB_BUILD_OBJECT(
      'before', JSONB_BUILD_OBJECT('status', 'pending', 'amount', v_payment.amount),
      'after', JSONB_BUILD_OBJECT('status', 'unpaid', 'reason', BTRIM(p_reason), 'revertedInstallments', v_revert_count, 'totalReverted', v_total_reverted)
    ),
    'Rejet bancaire ' || v_payment.receipt_number || ' — motif : ' || BTRIM(p_reason),
    NOW()
  );

  RETURN QUERY
    SELECT p_payment_id, 'unpaid'::TEXT, v_revert_count, v_total_reverted;
END;
$$ LANGUAGE plpgsql;
