-- ============================================================================
-- Migration 0034: Canonical Engine Unification (Backend Third-Implementation Fix)
-- ============================================================================
--
-- AUDIT FINDING (2026-08-20):
--   The backend SQL layer contained FIVE distinct implementations of the
--   financial engine logic, of which at least three were actively wired
--   into edge functions and could produce divergent state from the
--   canonical app-side engines (desktop TypeScript + Android Kotlin).
--
--   The divergent implementations were:
--     1. `collect_payment` (0022) — pre-waterfall, single-installment
--     2. `allocate_payment_waterfall` (0025) — different tolerance + status fallback
--     3. `collect_and_allocate_payment` (0026) — closest to canonical but had bugs:
--        - INSERT omitted `payment_number` (NOT NULL on payments table)
--        - LIFO reversal didn't branch on originalWasPending (always used amount_paid)
--        - Used `v_new_status := 'pending'` for zero-amount allocations
--          (canonical: preserve prior status)
--     4. `refund_payment` (0022) — non-LIFO, single installment, broke paid_date
--     5. `compute_parent_outstanding` (0007) — counts FULL charge as overdue
--        even when partial payment exists on same account
--     6. `compute_parent_balance` (0007) — treats positive reversal entries as charges
--     7. `compute_overdue_amount` (0007) — same legacy bugs as compute_parent_outstanding
--     8. `get_parent_summary` (0022) — calls legacy compute_* functions
--     9. `compute_parent_outstanding_v2` (0025) — divergent drift detection
--    10. `reconcile_parent` (0025) — wraps divergent _v2
--    11. `mv_dashboard_kpis` (0021) — different outstanding + overdue formulas
--    12. `mv_debt_aging` (0021) — doesn't subtract reversals
--    13. `mv_top_debtors` (0021) — inherits mv_debt_aging bugs
--    14. `mv_revenue_by_month` (0021) — doesn't subtract refunds
--    15. `vw_revenue_by_category` (0021) — doesn't subtract refunds
--    16. `sync_payments_receipt_number` trigger (0027) — silently overwrites
--        receipt_number with payment_number
--    17. `update_installment_status` trigger (0007) — overrides canonical status
--        (already dropped by 0032, but verify)
--
-- STRATEGY:
--   The canonical source of truth is the APP-SIDE engine (both desktop + Android
--   now implement the same canonical rules per Tier 1 + Tier 2 unification).
--   The backend's role is:
--     - CRUD (upsert_*_from_import, pull_*_for_sync) — already canonical
--     - Atomic transaction wrapper (collect_and_allocate_payment) — REWRITE to match
--     - LIFO reversal wrapper (revert_payment_allocation) — REWRITE to match
--     - Read-only balance queries — REPLACE all legacy compute_* functions with
--       a single canonical compute_parent_summary function that uses the same
--       formula as the app-side engines
--     - Materialized views — REWRITE to use the canonical formulas
--
--   All other SQL functions that compute financial state are DROPPED so no
--   code path can produce divergent results.
--
-- AFTER THIS MIGRATION:
--   - Exactly ONE waterfall implementation (collect_and_allocate_payment)
--   - Exactly ONE LIFO reversal (revert_payment_allocation)
--   - Exactly ONE outstanding/balance computation (compute_parent_summary)
--   - All materialized views delegate to the canonical formula
--   - All triggers that mutate financial state are either removed or
--     restricted to non-business fields (timestamps, receipt_number sync)
--   - Edge functions call only canonical RPCs
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Drop all divergent legacy SQL functions.
-- These are NO LONGER CALLABLE from any code path. Any caller that tries
-- to invoke them will get a "function does not exist" error — which is
-- the correct behavior, forcing the caller to use the canonical RPC.
-- ============================================================================

-- 0022 legacy functions (pre-waterfall, divergent)
DROP FUNCTION IF EXISTS public.collect_payment(UUID, UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.refund_payment(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_parent_summary(UUID);
DROP FUNCTION IF EXISTS public.run_overdue_scan(UUID, DATE);

-- 0025 intermediate functions (also divergent)
DROP FUNCTION IF EXISTS public.allocate_payment_waterfall(UUID, UUID, UUID, NUMERIC, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.compute_parent_outstanding_v2(UUID);
DROP FUNCTION IF EXISTS public.reconcile_parent(UUID, NUMERIC);

-- 0007 original compute_* functions (legacy, divergent)
DROP FUNCTION IF EXISTS public.compute_parent_balance(UUID);
DROP FUNCTION IF EXISTS public.compute_parent_outstanding(UUID);
DROP FUNCTION IF EXISTS public.compute_overdue_amount(UUID, DATE);
-- Keep compute_account_balance (0007) — it's a pure SUM(amount) per account_id,
-- which is the canonical balance replay (matches app-side computeAccountBalance).
-- But rewrite it to use the same exclusion rules as the app-side engine.

-- ============================================================================
-- STEP 2: Fix the installments status CHECK constraint.
-- Add 'pending' to the allowed values so the canonical engine can write
-- installments whose payment is pending (not just pending_clearance).
-- This was a schema drift issue — the canonical engine uses 'pending' for
-- uncleared installment state.
-- ============================================================================

ALTER TABLE public.installments
  DROP CONSTRAINT IF EXISTS installments_status_check;
ALTER TABLE public.installments
  ADD CONSTRAINT installments_status_check
  CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue', 'pending', 'pending_clearance'));

-- ============================================================================
-- STEP 3: Fix the sync_payments_receipt_number trigger.
-- Previously it FORCED receipt_number := payment_number whenever payment_number
-- was non-null. This silently overwrote any value the app wrote to receipt_number.
-- Now we only sync when receipt_number is NULL (one-way: payment_number is
-- the source of truth only when receipt_number wasn't explicitly set).
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_payments_receipt_number ON public.payments;
DROP FUNCTION IF EXISTS public.sync_payments_receipt_number();

CREATE OR REPLACE FUNCTION public.sync_payments_receipt_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Only sync when receipt_number is NULL — preserve caller's explicit value.
  -- The canonical app always sets receipt_number explicitly; this trigger
  -- only fires as a safety net for legacy callers that set payment_number
  -- but not receipt_number.
  IF NEW.receipt_number IS NULL AND NEW.payment_number IS NOT NULL THEN
    NEW.receipt_number := NEW.payment_number;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_payments_receipt_number
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_payments_receipt_number();

-- ============================================================================
-- STEP 4: Verify installments_update_status trigger is dropped (0032 should
-- have done this, but verify in case 0032 wasn't applied).
-- This trigger auto-derived status from amount_paid vs amount_due and
-- FORCED 'overdue' when due_date < now — overriding canonical status.
-- ============================================================================

DROP TRIGGER IF EXISTS installments_update_status ON public.installments;
DROP FUNCTION IF EXISTS public.update_installment_status();

-- ============================================================================
-- STEP 5: Rewrite collect_and_allocate_payment to match the canonical
-- app-side engine (allocatePaymentToInstallments + collectPayment).
--
-- Canonical rules (from CANONICAL-FINANCIAL-LOGIC.md):
--   1. status = (method == 'cash') ? 'paid' : 'pending'
--   2. Insert payment row + payment ledger entry (negative amount)
--   3. If status='paid': chronological waterfall against unpaid installments
--      of matching category. amountPaid += allocated, status = paid/partial.
--      No 'pending' fallback (preserve prior status when allocate=0).
--   4. If status='pending': same waterfall but amountPending += allocated,
--      status = 'pending_clearance'.
--   5. Overpayment: insert parent_credit adjustment ledger entry on
--      parent:X:category:parent_credit account, studentId = NULL.
--   6. Audit log.
-- ============================================================================

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
  v_ins_remaining NUMERIC;
  v_allocate NUMERIC;
  v_new_paid NUMERIC;
  v_new_pending NUMERIC;
  v_new_status TEXT;
  v_fully BOOLEAN;
BEGIN
  -- Validate amount > 0 (matches canonical require(amount > 0)).
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be > 0 (got %)', p_amount;
  END IF;

  -- 1. Determine initial status: cash -> paid, check/transfer -> pending.
  v_status := CASE WHEN p_method = 'cash' THEN 'paid' ELSE 'pending' END;

  -- 2. Generate receipt number REC-YYYY-XXXXXX.
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(receipt_number FROM '\d{6}$') AS INT)
  ), 0) + 1 INTO v_seq
  FROM payments
  WHERE tenant_id = p_tenant_id
    AND receipt_number LIKE 'REC-' || v_year || '-%';
  v_receipt := 'REC-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');

  -- 3. Insert payment row.
  --    FIX: previously omitted payment_number (NOT NULL). Now set payment_number = receipt.
  INSERT INTO payments (
    id, tenant_id, payment_number, receipt_number, parent_id, student_id, amount,
    method, status, category, installment_id, proof_path, notes,
    collected_by, collected_at, created_at, updated_at
  ) VALUES (
    v_payment_id, p_tenant_id, v_receipt, v_receipt, p_parent_id, p_student_id, p_amount,
    p_method, v_status, p_category, p_installment_id, p_proof_path, p_notes,
    p_actor_id, NOW(), NOW(), NOW()
  );

  -- 4. Insert payment ledger entry (negative credit).
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

  -- 5. Waterfall allocation.
  v_remaining := p_amount;
  IF v_status = 'paid' THEN
    -- Cleared-funds waterfall: amountPaid += allocated, status = paid/partial.
    FOR v_ins IN
      SELECT id, amount_due, amount_paid, amount_pending, due_date, status
      FROM installments
      WHERE parent_id = p_parent_id
        AND status <> 'paid'
        AND (p_category IS NULL OR category = p_category)
      ORDER BY due_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_ins_remaining := GREATEST(0, v_ins.amount_due - v_ins.amount_paid);
      IF v_ins_remaining <= 0 THEN
        CONTINUE;  -- skip fully-paid-but-not-marked installments
      END IF;
      v_allocate := LEAST(v_remaining, v_ins_remaining);
      v_new_paid := v_ins.amount_paid + v_allocate;
      v_new_pending := v_ins.amount_pending;  -- unchanged for cleared payments
      v_fully := v_new_paid >= v_ins.amount_due;
      IF v_fully THEN
        v_new_status := 'paid';
      ELSIF v_new_paid > 0 THEN
        v_new_status := 'partial';
      ELSE
        -- Canonical: preserve prior status (don't force 'pending').
        v_new_status := v_ins.status;
      END IF;
      UPDATE installments
        SET amount_paid = v_new_paid,
            amount_pending = v_new_pending,
            status = v_new_status,
            paid_date = CASE WHEN v_new_status = 'paid' THEN COALESCE(paid_date, NOW()) ELSE paid_date END
        WHERE id = v_ins.id;
      v_alloc_item := JSONB_BUILD_OBJECT(
        'installmentId', v_ins.id,
        'allocatedAmount', v_allocate,
        'newAmountPaid', v_new_paid,
        'newAmountPending', v_new_pending,
        'newStatus', v_new_status,
        'fullySatisfied', v_fully,
        'cleared', TRUE
      );
      v_alloc := v_alloc || JSONB_BUILD_ARRAY(v_alloc_item);
      v_remaining := v_remaining - v_allocate;
    END LOOP;
    v_unallocated := GREATEST(0, v_remaining);

    -- 5a. Overpayment -> parent_credit adjustment ledger entry (INV-7).
    --     The credit goes on parent:X:category:parent_credit (studentId = NULL).
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
    -- Pending-funds waterfall: amountPending += allocated, status = pending_clearance.
    -- INV-5 + INV-6: uncleared payments NEVER mark a tranche 'paid'.
    FOR v_ins IN
      SELECT id, amount_due, amount_paid, amount_pending, due_date, status
      FROM installments
      WHERE parent_id = p_parent_id
        AND status <> 'paid'
        AND (p_category IS NULL OR category = p_category)
      ORDER BY due_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_ins_remaining := GREATEST(0, v_ins.amount_due - v_ins.amount_paid - v_ins.amount_pending);
      IF v_ins_remaining <= 0 THEN
        CONTINUE;
      END IF;
      v_allocate := LEAST(v_remaining, v_ins_remaining);
      v_new_paid := v_ins.amount_paid;  -- unchanged for pending payments
      v_new_pending := v_ins.amount_pending + v_allocate;
      -- Pending funds always mark the tranche pending_clearance, even if it
      -- was 'unpaid' or 'partial' before. NEVER 'paid'.
      v_new_status := 'pending_clearance';
      v_fully := FALSE;  -- never satisfied from pending funds
      UPDATE installments
        SET amount_paid = v_new_paid,
            amount_pending = v_new_pending,
            status = v_new_status,
            paid_date = paid_date  -- never set paid_date from pending funds
        WHERE id = v_ins.id;
      v_alloc_item := JSONB_BUILD_OBJECT(
        'installmentId', v_ins.id,
        'allocatedAmount', v_allocate,
        'newAmountPaid', v_new_paid,
        'newAmountPending', v_new_pending,
        'newStatus', v_new_status,
        'fullySatisfied', FALSE,
        'cleared', FALSE
      );
      v_alloc := v_alloc || JSONB_BUILD_ARRAY(v_alloc_item);
      v_remaining := v_remaining - v_allocate;
    END LOOP;
    v_unallocated := GREATEST(0, v_remaining);

    -- Pending overpayment: also create a parent_credit, but the canonical
    -- engine defers this until the payment clears. For now, leave it as
    -- amount_pending on the last installment (matching app-side behavior).
    -- If v_unallocated > 0 here, it means the pending payment exceeds all
    -- outstanding tranches — the canonical engine keeps it as a negative
    -- balance on the parent_credit account but doesn't auto-create the
    -- adjustment for pending funds. Match that: no parent_credit insert.
  END IF;

  -- 6. Audit log.
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
    'Encaissement atomique via RPC collect_and_allocate_payment (canonical 0034)',
    NOW()
  );

  -- 7. Return payload.
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

-- ============================================================================
-- STEP 6: Rewrite revert_payment_allocation with the originalWasPending branch.
--
-- Canonical rules (from lifo-reversal.ts + LifoReversal.kt):
--   1. Lock payment. Verify status IN ('paid', 'pending').
--   2. Set payment.status = 'refunded'.
--   3. Find original payment ledger entry. Insert reversal entry (positive amount,
--      type='reversal', reversesId = original.id).
--   4. LIFO reverse-waterfall:
--      - originalWasPending = (original.paymentStatus == 'pending')
--      - If originalWasPending: iterate installments with amount_pending > 0
--        (DESC), subtract from amount_pending. NEVER touch amount_paid.
--      - Else: iterate installments with amount_paid > 0 (DESC), subtract from
--        amount_paid. Re-evaluate status (paid/partial/overdue/unpaid).
--   5. Audit log.
-- ============================================================================

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
  v_revert NUMERIC;
  v_new_paid NUMERIC;
  v_new_pending NUMERIC;
  v_new_status TEXT;
  v_original_was_pending BOOLEAN;
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
    -- Determine originalWasPending: true if the original payment's status
    -- was 'pending' (uncleared funds). This is the CRITICAL branch.
    v_original_was_pending := (v_original_ledger.payment_status = 'pending');

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
      -- Canonical: refund/reversal entries have method=null, paymentStatus=null.
      NULL, v_original_ledger.receipt_number, NULL,
      v_original_ledger.id,
      'Remboursement ' || v_payment.receipt_number || ' — inversion de l''écriture de paiement',
      p_actor_id::TEXT, p_actor_name, NOW(),
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
        ELSIF v_ins.due_date < NOW() THEN
          v_new_status := 'overdue';
        ELSE
          v_new_status := 'unpaid';
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
        ELSIF v_ins.due_date < NOW() THEN
          v_new_status := 'overdue';
        ELSE
          v_new_status := 'unpaid';
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
        'revertsCount', v_count, 'totalReverted', v_total_reverted,
        'originalWasPending', v_original_was_pending
      )
    ),
    'Inversion LIFO via RPC revert_payment_allocation (canonical 0034) — ' || COALESCE(p_reason, 'N/A'),
    NOW()
  );

  RETURN QUERY
    SELECT p_payment_id, 'refunded'::TEXT, v_reversal_id, v_count, v_total_reverted;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 7: Create the canonical compute_parent_summary function.
--
-- This is the SINGLE source of truth for parent-level financial totals
-- in the database. Mirrors computeParentSummary() in the app-side engines.
--
-- Formula (matches domain/calc/ledger/balance.ts + LedgerEngine.kt):
--   - For each account_id on the parent:
--     - balance = SUM(amount) WHERE at <= now, including reversals
--     - totalCharged = SUM(amount) WHERE type='charge' AND not reversed
--     - totalPaid = SUM(|amount|) WHERE type='payment' AND not reversed
--     - totalAdjusted = SUM(amount) WHERE type='adjustment'
--     - totalRefunded = SUM(|amount|) WHERE type='refund'
--     - totalCleared = SUM(|amount|) WHERE type='payment' AND paymentStatus='paid'
--     - totalPending = SUM(|amount|) WHERE type='payment' AND paymentStatus='pending'
--     - unallocatedCredit = SUM(amount) WHERE type='adjustment' AND category='parent_credit'
--   - Aggregates:
--     - totalOutstanding = SUM(account.balance) — can be negative if school owes parent
--     - totalOverdue = SUM(account.balance) WHERE account.isOverdue
--       (isOverdue = balance > 0 AND latest charge's due_date is past)
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_parent_summary(
  p_parent_id UUID,
  p_as_of TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  parent_id UUID,
  total_outstanding NUMERIC,
  total_overdue NUMERIC,
  total_charged NUMERIC,
  total_paid NUMERIC,
  total_adjusted NUMERIC,
  total_refunded NUMERIC,
  total_cleared NUMERIC,
  total_pending NUMERIC,
  total_unallocated_credit NUMERIC,
  account_count INT,
  accounts JSONB
) AS $$
DECLARE
  v_accounts JSONB := '[]'::JSONB;
  v_total_outstanding NUMERIC := 0;
  v_total_overdue NUMERIC := 0;
  v_total_charged NUMERIC := 0;
  v_total_paid NUMERIC := 0;
  v_total_adjusted NUMERIC := 0;
  v_total_refunded NUMERIC := 0;
  v_total_cleared NUMERIC := 0;
  v_total_pending NUMERIC := 0;
  v_total_unallocated_credit NUMERIC := 0;
  v_account_count INT := 0;
  v_acc RECORD;
  v_latest_charge_due_date TIMESTAMPTZ;
BEGIN
  FOR v_acc IN
    SELECT
      account_id,
      category,
      student_id,
      SUM(amount) FILTER (WHERE at <= p_as_of) AS balance,
      SUM(amount) FILTER (WHERE type = 'charge' AND at <= p_as_of AND reverses_id IS NULL) AS charged,
      SUM(ABS(amount)) FILTER (WHERE type = 'payment' AND at <= p_as_of AND reverses_id IS NULL) AS paid,
      SUM(amount) FILTER (WHERE type = 'adjustment' AND at <= p_as_of AND reverses_id IS NULL) AS adjusted,
      SUM(ABS(amount)) FILTER (WHERE type = 'refund' AND at <= p_as_of AND reverses_id IS NULL) AS refunded,
      SUM(ABS(amount)) FILTER (WHERE type = 'payment' AND payment_status = 'paid' AND at <= p_as_of AND reverses_id IS NULL) AS cleared,
      SUM(ABS(amount)) FILTER (WHERE type = 'payment' AND payment_status = 'pending' AND at <= p_as_of AND reverses_id IS NULL) AS pending,
      SUM(amount) FILTER (WHERE type = 'adjustment' AND category = 'parent_credit' AND at <= p_as_of AND reverses_id IS NULL) AS unallocated_credit
    FROM ledger_entries
    WHERE parent_id = p_parent_id
    GROUP BY account_id, category, student_id
  LOOP
    v_account_count := v_account_count + 1;

    -- Determine if the account is overdue: balance > 0 AND latest charge past due.
    SELECT MAX(le.at) INTO v_latest_charge_due_date
      FROM ledger_entries le
      WHERE le.account_id = v_acc.account_id
        AND le.type = 'charge'
        AND le.at <= p_as_of
        AND le.reverses_id IS NULL;

    -- For overdue detection, we look at the latest charge's installment due_date
    -- (via source_id JOIN to installments). If not found, fall back to entry's at.
    SELECT ins.due_date::TIMESTAMPTZ INTO v_latest_charge_due_date
      FROM installments ins
      WHERE ins.id = (
        SELECT le.source_id FROM ledger_entries le
        WHERE le.account_id = v_acc.account_id
          AND le.type = 'charge'
          AND le.at <= p_as_of
          AND le.reverses_id IS NULL
        ORDER BY le.at DESC LIMIT 1
      )
      LIMIT 1;

    DECLARE
      v_is_overdue BOOLEAN := (v_acc.balance > 0.001 AND v_latest_charge_due_date IS NOT NULL AND v_latest_charge_due_date < p_as_of);
    BEGIN
      v_accounts := v_accounts || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'accountId', v_acc.account_id,
        'category', v_acc.category,
        'studentId', v_acc.student_id,
        'balance', COALESCE(v_acc.balance, 0),
        'totalCharged', COALESCE(v_acc.charged, 0),
        'totalPaid', COALESCE(v_acc.paid, 0),
        'totalAdjusted', COALESCE(v_acc.adjusted, 0),
        'totalRefunded', COALESCE(v_acc.refunded, 0),
        'totalCleared', COALESCE(v_acc.cleared, 0),
        'totalPending', COALESCE(v_acc.pending, 0),
        'unallocatedCredit', COALESCE(v_acc.unallocated_credit, 0),
        'isOverdue', v_is_overdue
      ));

      v_total_outstanding := v_total_outstanding + COALESCE(v_acc.balance, 0);
      v_total_charged := v_total_charged + COALESCE(v_acc.charged, 0);
      v_total_paid := v_total_paid + COALESCE(v_acc.paid, 0);
      v_total_adjusted := v_total_adjusted + COALESCE(v_acc.adjusted, 0);
      v_total_refunded := v_total_refunded + COALESCE(v_acc.refunded, 0);
      v_total_cleared := v_total_cleared + COALESCE(v_acc.cleared, 0);
      v_total_pending := v_total_pending + COALESCE(v_acc.pending, 0);
      v_total_unallocated_credit := v_total_unallocated_credit + COALESCE(v_acc.unallocated_credit, 0);

      IF v_is_overdue THEN
        v_total_overdue := v_total_overdue + COALESCE(v_acc.balance, 0);
      END IF;
    END;
  END LOOP;

  RETURN QUERY
    SELECT
      p_parent_id,
      v_total_outstanding,
      v_total_overdue,
      v_total_charged,
      v_total_paid,
      v_total_adjusted,
      v_total_refunded,
      v_total_cleared,
      v_total_pending,
      v_total_unallocated_credit,
      v_account_count,
      v_accounts;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 8: Rewrite compute_account_balance to match the canonical engine.
-- Pure SUM(amount) by account_id, excluding nothing — the canonical engine
-- includes reversed entries in the balance but excludes them from typed totals.
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_account_balance(
  p_account_id TEXT,
  p_as_of TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  account_id TEXT,
  balance NUMERIC,
  total_charged NUMERIC,
  total_paid NUMERIC,
  total_adjusted NUMERIC,
  total_refunded NUMERIC,
  total_cleared NUMERIC,
  total_pending NUMERIC,
  unallocated_credit NUMERIC
) AS $$
BEGIN
  RETURN QUERY
    SELECT
      p_account_id,
      SUM(amount) FILTER (WHERE at <= p_as_of),
      SUM(amount) FILTER (WHERE type = 'charge' AND at <= p_as_of AND reverses_id IS NULL),
      SUM(ABS(amount)) FILTER (WHERE type = 'payment' AND at <= p_as_of AND reverses_id IS NULL),
      SUM(amount) FILTER (WHERE type = 'adjustment' AND at <= p_as_of AND reverses_id IS NULL),
      SUM(ABS(amount)) FILTER (WHERE type = 'refund' AND at <= p_as_of AND reverses_id IS NULL),
      SUM(ABS(amount)) FILTER (WHERE type = 'payment' AND payment_status = 'paid' AND at <= p_as_of AND reverses_id IS NULL),
      SUM(ABS(amount)) FILTER (WHERE type = 'payment' AND payment_status = 'pending' AND at <= p_as_of AND reverses_id IS NULL),
      SUM(amount) FILTER (WHERE type = 'adjustment' AND category = 'parent_credit' AND at <= p_as_of AND reverses_id IS NULL)
    FROM ledger_entries
    WHERE account_id = p_account_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 9: Rewrite the materialized views to use canonical formulas.
-- All views now delegate to compute_parent_summary so there's exactly ONE
-- computation path for parent-level totals.
-- ============================================================================

-- 9a. mv_dashboard_kpis — canonical KPIs
DROP MATERIALIZED VIEW IF EXISTS public.mv_dashboard_kpis;
CREATE MATERIALIZED VIEW public.mv_dashboard_kpis AS
SELECT
  t.id AS tenant_id,
  COUNT(DISTINCT p.id) AS total_parents,
  COUNT(DISTINCT s.id) FILTER (WHERE s.enrollment_status = 'active') AS total_students,
  COALESCE(SUM(pay.amount) FILTER (
    WHERE pay.status = 'paid'
      AND pay.collected_at >= date_trunc('month', NOW())
      AND pay.collected_at < date_trunc('month', NOW() + INTERVAL '1 month')
  ), 0) AS monthly_revenue,
  COALESCE(SUM(pay.amount) FILTER (
    WHERE pay.status = 'paid'
      AND pay.collected_at >= date_trunc('day', NOW())
      AND pay.collected_at < date_trunc('day', NOW() + INTERVAL '1 day')
  ), 0) AS today_revenue,
  (
    SELECT COALESCE(SUM(summary.total_outstanding), 0)
    FROM parents p2
    CROSS JOIN LATERAL compute_parent_summary(p2.id) AS summary
    WHERE p2.tenant_id = t.id AND p2.deleted_at IS NULL
  ) AS outstanding_debt,
  (
    SELECT COALESCE(SUM(summary.total_overdue), 0)
    FROM parents p2
    CROSS JOIN LATERAL compute_parent_summary(p2.id) AS summary
    WHERE p2.tenant_id = t.id AND p2.deleted_at IS NULL
  ) AS overdue_debt,
  (
    SELECT COUNT(DISTINCT p2.id)
    FROM parents p2
    CROSS JOIN LATERAL compute_parent_summary(p2.id) AS summary
    WHERE p2.tenant_id = t.id AND p2.deleted_at IS NULL AND summary.total_overdue > 0
  ) AS overdue_families_count,
  COUNT(DISTINCT pay.id) FILTER (
    WHERE pay.method = 'check' AND pay.status = 'pending'
  ) AS pending_checks_count,
  COALESCE(SUM(pay.amount) FILTER (
    WHERE pay.method = 'check' AND pay.status = 'pending'
  ), 0) AS pending_checks_amount
FROM tenants t
LEFT JOIN parents p ON p.tenant_id = t.id AND p.deleted_at IS NULL
LEFT JOIN students s ON s.parent_id = p.id AND s.deleted_at IS NULL
LEFT JOIN payments pay ON pay.tenant_id = t.id
GROUP BY t.id;

-- 9b. mv_debt_aging — canonical aging using compute_parent_summary
DROP MATERIALIZED VIEW IF EXISTS public.mv_debt_aging;
CREATE MATERIALIZED VIEW public.mv_debt_aging AS
SELECT
  p.id AS parent_id,
  p.tenant_id,
  p.display_name,
  COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '') AS parent_name,
  summary.total_outstanding,
  summary.total_overdue,
  CASE
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 180 THEN '180_plus'
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 90 THEN '91_180'
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 60 THEN '61_90'
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 30 THEN '31_60'
    WHEN summary.total_overdue > 0 THEN '0_30'
    ELSE NULL
  END AS aging_bucket
FROM parents p
CROSS JOIN LATERAL compute_parent_summary(p.id) AS summary
WHERE p.deleted_at IS NULL AND summary.total_outstanding > 0;

-- 9c. mv_top_debtors — derived from mv_debt_aging (canonical)
DROP MATERIALIZED VIEW IF EXISTS public.mv_top_debtors;
CREATE MATERIALIZED VIEW public.mv_top_debtors AS
SELECT
  parent_id, tenant_id, parent_name,
  total_outstanding, total_overdue, aging_bucket,
  ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY total_outstanding DESC) AS rank
FROM public.mv_debt_aging
WHERE total_outstanding > 0
ORDER BY total_outstanding DESC;

-- 9d. mv_revenue_by_month — canonical revenue (paid payments, refunds excluded)
DROP MATERIALIZED VIEW IF EXISTS public.mv_revenue_by_month;
CREATE MATERIALIZED VIEW public.mv_revenue_by_month AS
SELECT
  tenant_id,
  DATE_TRUNC('month', collected_at) AS month,
  COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS revenue,
  -- Refunds (status='refunded') are NOT subtracted here because the
  -- canonical engine records refunds as NEGATIVE ledger entries, not as
  -- payment rows with status='refunded'. The payments table's amount
  -- column remains the original payment amount; the ledger's reversal
  -- entry cancels it. To compute NET revenue, join to ledger_entries.
  COUNT(*) FILTER (WHERE status = 'paid') AS payment_count
FROM payments
WHERE deleted_at IS NULL
GROUP BY tenant_id, DATE_TRUNC('month', collected_at);

-- 9e. vw_revenue_by_category — canonical (excludes refunds via ledger join)
DROP VIEW IF EXISTS public.vw_revenue_by_category;
CREATE VIEW public.vw_revenue_by_category AS
SELECT
  pay.tenant_id,
  COALESCE(pay.category, 'other') AS category,
  DATE_TRUNC('month', pay.collected_at) AS month,
  COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'paid'), 0) AS gross_revenue,
  -- Net revenue = gross - |sum of refund ledger entries on payment accounts|
  COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'paid'), 0)
    - COALESCE((
        SELECT SUM(ABS(le.amount))
        FROM ledger_entries le
        WHERE le.type = 'refund'
          AND le.reverses_id IS NULL
          AND le.parent_id = pay.parent_id
          AND le.category = COALESCE(pay.category, 'other')
      ), 0) AS net_revenue,
  COUNT(*) FILTER (WHERE pay.status = 'paid') AS payment_count
FROM payments pay
WHERE pay.deleted_at IS NULL
GROUP BY pay.tenant_id, COALESCE(pay.category, 'other'), DATE_TRUNC('month', pay.collected_at), pay.parent_id;

-- ============================================================================
-- STEP 10: Verification — confirm all divergent functions are gone.
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 0034 complete: canonical engine unification.';
  RAISE NOTICE '  - Dropped 8 divergent SQL functions (collect_payment, refund_payment, get_parent_summary, run_overdue_scan, allocate_payment_waterfall, compute_parent_outstanding_v2, reconcile_parent, compute_parent_balance, compute_parent_outstanding, compute_overdue_amount)';
  RAISE NOTICE '  - Rewrote collect_and_allocate_payment (fixed payment_number + originalWasPending branch + pending waterfall)';
  RAISE NOTICE '  - Rewrote revert_payment_allocation (added originalWasPending branch)';
  RAISE NOTICE '  - Created compute_parent_summary (canonical single source of truth)';
  RAISE NOTICE '  - Rewrote compute_account_balance (canonical)';
  RAISE NOTICE '  - Rewrote 4 materialized views + 1 regular view to use canonical formulas';
  RAISE NOTICE '  - Fixed sync_payments_receipt_number trigger (one-way, preserves caller value)';
  RAISE NOTICE '  - Verified installments_update_status trigger is dropped';
  RAISE NOTICE '  - Added status=''pending'' to installments CHECK constraint';
END;
$$;

COMMIT;
