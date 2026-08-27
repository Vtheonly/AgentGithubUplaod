-- ============================================================================
-- 0040 — Cross-platform RPC unification fix (equivalence-suite finding E-0039-OVL).
--
-- PROBLEM (found by the cross-platform equivalence suite on a real
-- PostgreSQL running the full 0001→0039 chain):
--
--   1. Migration 0039 created a SECOND `collect_and_allocate_payment`
--      overload (17 args) alongside the canonical 14-arg one from 0034.
--      PostgreSQL can no longer resolve 14-arg NAMED calls:
--          ERROR: function collect_and_allocate_payment(...) is not unique
--      PostgREST (desktop app, Edge Functions) always calls with named
--      arguments → the atomic payment RPC was broken on every path:
--        * 14-arg calls (collect-payment Edge Function) → "is not unique"
--        * 17-arg calls (desktop production payload) → resolved to the
--          0039 overload, whose body is the pre-canonical 0026 shape and
--          fails at runtime ("column reference receipt_number is
--          ambiguous"; ledger INSERT targets nonexistent `type`/`id`
--          columns; payments INSERT omits NOT NULL payment_number).
--      The desktop silently fell back to `upsert_payment_from_import`,
--      which never runs the waterfall → hidden cross-platform state
--      divergence (desktop-Supabase ≠ Android ≠ canonical engine).
--
-- FIX — no business-logic change. The canonical 0034 body is reinstated as
-- the ONE function, extended with the three optional structured fields
-- 0039 wanted (check_issue_date, check_clearance_date, transfer_source_bank)
-- so they are persisted exactly as 0039 intended. 14-arg and 17-arg named
-- calls both resolve to it (omitted params default to NULL).
--
-- Also fixes the two lifecycle RPCs 0039 added, which were written against
-- the pre-0027 ledger schema:
--   * mark_payment_bounced queried `type = 'payment'` (column is entry_type)
--     and inserted reversal rows with the legacy `id`/`type` column names.
--   * both lifecycle RPCs cast uuid ids to TEXT for uuid columns in
--     audit_logs (entity_id / actor_id are uuid).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop BOTH overloads and recreate the single canonical function.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS collect_and_allocate_payment(
  uuid, uuid, uuid, numeric, text, text, uuid, text, text, uuid, text, text, text, text);

DROP FUNCTION IF EXISTS collect_and_allocate_payment(
  uuid, uuid, uuid, numeric, text, text, uuid, text, text, uuid, text, text, text, date, date, text, text);

CREATE OR REPLACE FUNCTION collect_and_allocate_payment(
  p_tenant_id UUID, p_parent_id UUID, p_student_id UUID,
  p_amount NUMERIC(12, 2), p_method TEXT, p_category TEXT,
  p_installment_id UUID, p_proof_path TEXT, p_notes TEXT,
  p_actor_id UUID, p_actor_name TEXT,
  p_check_number TEXT DEFAULT NULL, p_check_bank_name TEXT DEFAULT NULL,
  p_check_issue_date DATE DEFAULT NULL, p_check_clearance_date DATE DEFAULT NULL,
  p_transfer_reference TEXT DEFAULT NULL, p_transfer_source_bank TEXT DEFAULT NULL
) RETURNS TABLE (
  payment_id UUID, receipt_number TEXT, payment_status TEXT,
  total_allocated NUMERIC(12, 2), unallocated_credit NUMERIC(12, 2),
  allocations JSONB
) AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW()); v_seq INT; v_receipt TEXT; v_status TEXT;
  v_payment_id UUID := gen_random_uuid(); v_ledger_id TEXT; v_remaining NUMERIC;
  v_alloc JSONB := '[]'::JSONB; v_alloc_item JSONB; v_ins RECORD; v_unallocated NUMERIC := 0;
  v_account_id TEXT; v_ins_remaining NUMERIC; v_allocate NUMERIC; v_new_paid NUMERIC;
  v_new_pending NUMERIC; v_new_status TEXT; v_fully BOOLEAN;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be > 0 (got %)', p_amount; END IF;
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
    p_actor_id, NOW(), NOW(), NOW()
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
    p_actor_id::TEXT, p_actor_name, NOW(),
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
      ELSE v_new_status := v_ins.status; END IF;
      UPDATE installments
        SET amount_paid = v_new_paid, amount_pending = v_new_pending,
            status = v_new_status,
            paid_date = CASE WHEN v_new_status = 'paid' THEN COALESCE(paid_date, NOW()) ELSE paid_date END
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
        p_actor_id::TEXT, p_actor_name, NOW(),
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

  INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id, actor_id, actor_name, diff, note, created_at)
  VALUES (gen_random_uuid(), p_tenant_id, 'payment.collect', 'payment', v_payment_id,
    p_actor_id, p_actor_name,
    JSONB_BUILD_OBJECT('amount', p_amount, 'method', p_method, 'receipt', v_receipt,
      'status', v_status, 'allocations', v_alloc, 'unallocatedCredit', v_unallocated),
    'Encaissement atomique via RPC collect_and_allocate_payment (canonical 0034 + structured fields)', NOW());

  RETURN QUERY SELECT v_payment_id, v_receipt, v_status,
    p_amount - v_unallocated, v_unallocated, v_alloc;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. mark_payment_cleared — fix audit uuid casts (entity_id/actor_id are uuid).
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

  UPDATE payments
    SET status = 'paid', updated_at = NOW()
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
        gen_random_uuid(), p_tenant_id, 'installment.clear_funds', 'installment', v_ins.id,
        p_actor_id, p_actor_name,
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

  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.mark_cleared', 'payment', p_payment_id,
    p_actor_id, p_actor_name,
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
-- 3. mark_payment_bounced — fix entry_type reference + ledger column names
--    + uuid casts (0039 wrote against the pre-0027 ledger schema).
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

  UPDATE payments
    SET status = 'unpaid',
        notes = CONCAT_WS(' | ', notes, 'Rejet: ' || BTRIM(p_reason)),
        updated_at = NOW()
    WHERE id = p_payment_id;

  SELECT * INTO v_original_ledger
  FROM ledger_entries
  WHERE source_type = 'payment' AND source_id = p_payment_id::TEXT AND entry_type = 'payment'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO ledger_entries (
      entry_number, tenant_id, account_id, parent_id, student_id, category, amount,
      entry_type, source_type, source_id, method, receipt_number, payment_status,
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
      v_original_ledger.entry_number,
      'Échec d''encaissement ' || v_payment.receipt_number || ' — chèque/virement rejeté',
      p_actor_id::TEXT, p_actor_name, NOW(),
      JSONB_BUILD_OBJECT('bounceReason', BTRIM(p_reason), 'originalPaymentId', p_payment_id::TEXT)
    );

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
          gen_random_uuid(), p_tenant_id, 'installment.revert_allocation', 'installment', v_ins.id,
          p_actor_id, p_actor_name,
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

  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.mark_bounced', 'payment', p_payment_id,
    p_actor_id, p_actor_name,
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
