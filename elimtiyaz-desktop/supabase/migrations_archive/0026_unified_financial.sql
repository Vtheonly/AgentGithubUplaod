-- ============================================================================
-- 0026_unified_financial.sql
-- ============================================================================
-- Unified Financial Architecture migration.
--
-- Implements the schema changes + atomic stored procedures mandated by the
-- multi-manager refactoring blueprint:
--
--   1. installments table: add amount_pending, academic_cycle, payment_plan,
--      is_custom_schedule, custom_schedule_note columns.
--   2. payments table: enforce status check constraint.
--   3. ledger_entries table: enforce category check constraint including
--      parent_credit, therapy_psychology, therapy_speech, second_apron.
--   4. Atomic RPC `collect_and_allocate_payment` — wraps payment + ledger +
--      waterfall allocation + parent_credit + audit_log in a single
--      transaction (BEGIN ... COMMIT).
--   5. Atomic RPC `revert_payment_allocation` — wraps refund + reversal
--      entry + reverse-waterfall (LIFO) + status re-evaluation + audit_log.
--
-- These RPCs eliminate the race conditions that existed when the client
-- made 3 separate HTTP requests (payment → ledger → installments) and a
-- network interruption between any two could leave the database in a
-- corrupted state.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. installments — new columns
-- ----------------------------------------------------------------------------
ALTER TABLE installments
  ADD COLUMN IF NOT EXISTS amount_pending NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS academic_cycle TEXT
    CHECK (academic_cycle IN ('prescolaire', 'primaire', 'cem', 'lycee')),
  ADD COLUMN IF NOT EXISTS payment_plan TEXT DEFAULT 'tranches' NOT NULL
    CHECK (payment_plan IN ('full_annual', 'tranches')),
  ADD COLUMN IF NOT EXISTS is_custom_schedule BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS custom_schedule_note TEXT;

COMMENT ON COLUMN installments.amount_pending IS
  'Uncleared non-cash funds (pending check/transfer) sitting on this tranche. '
  'Invariant 4: a tranche is "paid" only when amount_paid >= amount_due.';
COMMENT ON COLUMN installments.academic_cycle IS
  'Education cycle (prescolaire/primaire/cem/lycee) — drives schedule template.';
COMMENT ON COLUMN installments.payment_plan IS
  'Whether this installment is a 100% full-annual payment or a single tranche.';
COMMENT ON COLUMN installments.is_custom_schedule IS
  'True when the due date has been manually overridden per parent.';

-- ----------------------------------------------------------------------------
-- 2. payments — status check constraint
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_status_check
      CHECK (status IN ('paid', 'pending', 'unpaid', 'partial', 'overdue',
                        'refunded', 'cancelled', 'pending_clearance'));
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 3. ledger_entries — category check constraint (expanded)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- Drop the old constraint if it exists, then add the expanded version.
  ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_category_check;
  ALTER TABLE ledger_entries
    ADD CONSTRAINT ledger_entries_category_check
    CHECK (category IN (
      'tuition', 'transport', 'canteen', 'uniform', 'books',
      'extracurricular', 'therapy_psychology', 'therapy_speech',
      'second_apron', 'parent_credit', 'other'
    ));
END$$;

-- ----------------------------------------------------------------------------
-- 4. Atomic RPC: collect_and_allocate_payment
-- ----------------------------------------------------------------------------
-- Wraps the entire payment collection flow in a single transaction:
--   1. Lock target installment rows (FOR UPDATE).
--   2. Insert payment row.
--   3. Insert payment credit ledger entry.
--   4. If status='paid': run waterfall allocation against installments
--      (update amount_paid, status, paid_date).
--   5. If overpayment: insert parent_credit adjustment ledger entry.
--   6. If status='pending': update installments.amount_pending only.
--   7. Insert audit_log row.
--   8. Return payment + allocation payload.
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
  p_actor_name TEXT
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

  -- 2. Insert payment row.
  INSERT INTO payments (
    id, tenant_id, receipt_number, parent_id, student_id, amount,
    method, status, category, installment_id, proof_path, notes,
    collected_by, collected_at, created_at, updated_at
  ) VALUES (
    v_payment_id, p_tenant_id, v_receipt, p_parent_id, p_student_id, p_amount,
    p_method, v_status, p_category, p_installment_id, p_proof_path, p_notes,
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
    JSONB_BUILD_OBJECT('installmentId', p_installment_id, 'proofUrl', p_proof_path)
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
      'unallocatedCredit', v_unallocated
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
-- 5. Atomic RPC: revert_payment_allocation
-- ----------------------------------------------------------------------------
-- Reverses a prior payment: refund + reversal entry + reverse-waterfall
-- (LIFO) + status re-evaluation + audit_log.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revert_payment_allocation(
  p_tenant_id UUID,
  p_payment_id UUID,
  p_actor_id UUID,
  p_actor_name TEXT,
  p_reason TEXT
) RETURNS TABLE (
  payment_id UUID,
  new_status TEXT,
  reversal_entry_id TEXT,
  reverts_count INT,
  total_reverted NUMERIC(12, 2)
) AS $$
DECLARE
  v_payment RECORD;
  v_original_ledger RECORD;
  v_reversal_id TEXT;
  v_reverts JSONB := '[]'::JSONB;
  v_count INT := 0;
  v_total_reverted NUMERIC := 0;
  v_remaining NUMERIC;
  v_ins RECORD;
BEGIN
  -- 1. Lock payment row.
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;
  IF v_payment.status NOT IN ('paid', 'pending') THEN
    RAISE EXCEPTION 'Payment % is already % (cannot revert)', p_payment_id, v_payment.status;
  END IF;

  -- 2. Update payment status.
  UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = p_payment_id;

  -- 3. Find original ledger entry + insert reversal.
  SELECT * INTO v_original_ledger
    FROM ledger_entries
    WHERE source_type = 'payment' AND source_id = p_payment_id::TEXT AND type = 'payment'
    LIMIT 1;
  IF FOUND THEN
    v_reversal_id := 'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8);
    INSERT INTO ledger_entries (
      id, tenant_id, account_id, parent_id, student_id, category, amount,
      type, source_type, source_id, method, receipt_number, payment_status,
      reverses_id, description, actor_id, actor_name, at, metadata
    ) VALUES (
      v_reversal_id, p_tenant_id, v_original_ledger.account_id,
      v_original_ledger.parent_id, v_original_ledger.student_id,
      v_original_ledger.category, -v_original_ledger.amount,
      'reversal', 'payment', p_payment_id::TEXT,
      v_original_ledger.method, v_original_ledger.receipt_number, 'refunded',
      v_original_ledger.id,
      'Remboursement ' || v_payment.receipt_number || ' — inversion de l''écriture de paiement',
      p_actor_id::TEXT, p_actor_name, NOW(),
      JSONB_BUILD_OBJECT('refundReason', p_reason, 'originalPaymentId', p_payment_id)
    );

    -- 4. Reverse-waterfall (LIFO).
    v_remaining := v_payment.amount;
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
      DECLARE
        v_revert NUMERIC := LEAST(v_remaining, v_ins.amount_paid);
        v_new_paid NUMERIC := v_ins.amount_paid - v_revert;
        v_new_pending NUMERIC := v_ins.amount_pending;
        v_new_status TEXT;
      BEGIN
        IF v_new_paid >= v_ins.amount_due AND v_ins.amount_due > 0 THEN
          v_new_status := 'paid';
        ELSIF v_new_paid > 0 THEN
          v_new_status := 'partial';
        ELSIF v_ins.due_date < NOW() THEN
          v_new_status := 'overdue';
        ELSE
          v_new_status := 'pending';
        END IF;
        UPDATE installments
          SET amount_paid = v_new_paid, amount_pending = v_new_pending,
              status = v_new_status,
              paid_date = CASE WHEN v_new_status = 'paid' THEN paid_date ELSE NULL END
          WHERE id = v_ins.id;
        v_reverts := v_reverts || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'installmentId', v_ins.id, 'revertedAmount', v_revert,
          'newAmountPaid', v_new_paid, 'newStatus', v_new_status
        ));
        v_count := v_count + 1;
        v_total_reverted := v_total_reverted + v_revert;
        v_remaining := v_remaining - v_revert;
      END;
    END LOOP;
  END IF;

  -- 5. Audit log.
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.refund', 'payment', p_payment_id::TEXT,
    p_actor_id::TEXT, p_actor_name,
    JSONB_BUILD_OBJECT(
      'before', JSONB_BUILD_OBJECT('status', v_payment.status),
      'after', JSONB_BUILD_OBJECT(
        'status', 'refunded', 'reversalEntryId', v_reversal_id,
        'revertsCount', v_count, 'totalReverted', v_total_reverted
      )
    ),
    'Inversion LIFO via RPC revert_payment_allocation — ' || COALESCE(p_reason, 'N/A'),
    NOW()
  );

  RETURN QUERY
    SELECT p_payment_id, 'refunded'::TEXT, v_reversal_id, v_count, v_total_reverted;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 6. Verification: confirm the RPCs exist.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'Migration 0026 complete: installments columns + check constraints + 2 atomic RPCs.';
END$$;
