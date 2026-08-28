-- ============================================================================
-- 0042_canonical_overdue_asof_equivalence.sql
-- CROSS-PLATFORM EQUIVALENCE FIXES (Android ↔ Desktop ↔ Website ↔ Backend)
-- ============================================================================
-- Three findings from the cross-platform equivalence framework
-- (framework: /repos/cross-platform-equivalence, 13 failing scenarios):
--
-- A-0042-OVERDUE (13 scenarios):
--   compute_parent_summary classified accounts as overdue using the latest
--   charge WITH at <= p_as_of, mapped to the installment's due_date. The
--   canonical app engines (desktop computeParentSummary + buildOverdueDueDateMap,
--   ported verbatim to the website canonical module and the Android runner)
--   classify on the account's latest charge timestamp across ALL entries —
--   INV-4: overdue iff balance > 0.001 DZD AND latestCharge.at < now. With a
--   3-tranche schedule charged up-front, the two rules disagree whenever any
--   future-dated charge exists (the backend flagged overdue the apps did not).
--   FIX: mirror the canonical rule exactly — MAX(charge.at), no as-of filter,
--   no reversal filter, no installment JOIN. INV-10 names the desktop
--   implementation the single source of truth for the parent summary.
--
-- A-0042-ASOF (6 scenarios):
--   The payment lifecycle RPCs re-evaluated installment status with the
--   database's wall clock (NOW()) — the app engines evaluate at the
--   operation clock. Any backdated or forward-dated operation (e.g. an
--   as-of report or an imported historical payment) produced different
--   statuses per platform. FIX: the RPCs accept p_as_of TIMESTAMPTZ
--   DEFAULT NOW() and evaluate + stamp at that clock. DEFAULT keeps the
--   production behavior byte-identical for every existing caller.
--
-- A-0042-LADDER (2 scenarios):
--   The revert/bounce ladders ended in 'unpaid'; the canonical
--   reevaluateInstallmentStatus (desktop lifo-reversal.ts, INV-10) ends in
--   'pending' for a fully unpaid tranche whose due date is still in the
--   future. FIX: mirror the canonical ladder: paid → partial → overdue
--   (due_date < as-of) → pending.
--
-- The failing inputs + operation sequences are preserved verbatim as
-- permanent regression scenarios in the equivalence framework
-- (regression/*.json). All 4 functions are drop+recreated (signature changes
-- add p_as_of); the 0034/0041 matviews depending on compute_parent_summary
-- are dropped and recreated verbatim.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. compute_parent_summary — canonical overdue detection (A-0042-OVERDUE).
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.mv_dashboard_kpis CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_debt_aging CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_top_debtors CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_revenue_by_month CASCADE;
DROP FUNCTION IF EXISTS public.compute_parent_summary(uuid, timestamptz);

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
      le.account_id,
      le.category,
      le.student_id,
      SUM(le.amount) FILTER (WHERE le.at <= p_as_of) AS balance,
      COALESCE(SUM(le.amount) FILTER (WHERE le.entry_type = 'charge' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS charged,
      COALESCE(SUM(ABS(le.amount)) FILTER (WHERE le.entry_type = 'payment' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS paid,
      COALESCE(SUM(le.amount) FILTER (WHERE le.entry_type = 'adjustment' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS adjusted,
      COALESCE(SUM(ABS(le.amount)) FILTER (WHERE le.entry_type = 'refund' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS refunded,
      COALESCE(SUM(ABS(le.amount)) FILTER (WHERE le.entry_type = 'payment' AND le.payment_status = 'paid' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS cleared,
      COALESCE(SUM(ABS(le.amount)) FILTER (WHERE le.entry_type = 'payment' AND le.payment_status = 'pending' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS pending,
      COALESCE(SUM(le.amount) FILTER (WHERE le.entry_type = 'adjustment' AND le.category = 'parent_credit' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS unallocated_credit
    FROM ledger_entries le
    WHERE le.parent_id = p_parent_id
    GROUP BY le.account_id, le.category, le.student_id
  LOOP
    v_account_count := v_account_count + 1;

    -- Determine if the account is overdue — canonical mirror of the desktop
    -- engine's buildOverdueDueDateMap + computeParentSummary (INV-4 + INV-10,
    -- equivalence finding A-0042-OVERDUE):
    --   overdueDueDate[accountId] = MAX(charge.at) over ALL of the account's
    --   charge entries — NO as-of filter, NO reversal filter, and NO
    --   installment due_date JOIN (the app engines classify on the charge
    --   entry's own timestamp). The account is overdue iff
    --   balance > 0.001 DZD AND that latest-charge timestamp < p_as_of.
    SELECT MAX(le.at) INTO v_latest_charge_due_date
      FROM ledger_entries le
      WHERE le.account_id = v_acc.account_id
        AND le.entry_type = 'charge';

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
$$ LANGUAGE plpgsql SET search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- Recreate the 0034/0041 matviews verbatim (dropped above — they depend on
-- compute_parent_summary). Repopulated on the next scheduled refresh.
-- ----------------------------------------------------------------------------



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
CREATE MATERIALIZED VIEW public.mv_top_debtors AS
SELECT
  parent_id, tenant_id, parent_name,
  total_outstanding, total_overdue, aging_bucket,
  ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY total_outstanding DESC) AS rank
FROM public.mv_debt_aging
WHERE total_outstanding > 0
ORDER BY total_outstanding DESC;
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
GROUP BY tenant_id, DATE_TRUNC('month', collected_at);

-- ----------------------------------------------------------------------------
-- 2. Payment lifecycle RPCs — p_as_of parameter + canonical ladders
--    (A-0042-ASOF + A-0042-LADDER). p_as_of TIMESTAMPTZ DEFAULT NOW():
--    existing callers are unchanged; the equivalence harness pins the
--    scenario clock so all four platforms evaluate the same operation clock.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.collect_and_allocate_payment(
  uuid, uuid, uuid, numeric, text, text, uuid, text, text, uuid, text, text, text, date, date, text, text);

CREATE OR REPLACE FUNCTION collect_and_allocate_payment(
  p_tenant_id UUID, p_parent_id UUID, p_student_id UUID,
  p_amount NUMERIC(12, 2), p_method TEXT, p_category TEXT,
  p_installment_id UUID, p_proof_path TEXT, p_notes TEXT,
  p_actor_id UUID, p_actor_name TEXT,
  p_check_number TEXT DEFAULT NULL, p_check_bank_name TEXT DEFAULT NULL,
  p_check_issue_date DATE DEFAULT NULL, p_check_clearance_date DATE DEFAULT NULL,
  p_transfer_reference TEXT DEFAULT NULL, p_transfer_source_bank TEXT DEFAULT NULL,
  p_as_of TIMESTAMPTZ DEFAULT NOW()
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
    p_actor_id::TEXT, p_actor_name, p_as_of,
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
        p_actor_id::TEXT, p_actor_name, p_as_of,
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
    'Encaissement atomique via RPC collect_and_allocate_payment (canonical 0034 + structured fields)', p_as_of);

  RETURN QUERY SELECT v_payment_id, v_receipt, v_status,
    p_amount - v_unallocated, v_unallocated, v_alloc;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

DROP FUNCTION IF EXISTS public.mark_payment_cleared(uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION mark_payment_cleared(
  p_tenant_id UUID,
  p_payment_id UUID,
  p_actor_id UUID,
  p_actor_name TEXT DEFAULT 'System',
  p_as_of TIMESTAMPTZ DEFAULT NOW()
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
    p_as_of
  );

  RETURN QUERY
    SELECT p_payment_id, 'paid'::TEXT, v_cleared_count, v_total_cleared;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

DROP FUNCTION IF EXISTS public.mark_payment_bounced(uuid, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION mark_payment_bounced(
  p_tenant_id UUID,
  p_payment_id UUID,
  p_reason TEXT,
  p_actor_id UUID,
  p_actor_name TEXT DEFAULT 'System',
  p_as_of TIMESTAMPTZ DEFAULT NOW()
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
        updated_at = p_as_of
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
      p_actor_id::TEXT, p_actor_name, p_as_of,
      JSONB_BUILD_OBJECT('bounceReason', BTRIM(p_reason), 'originalPaymentId', p_payment_id::TEXT)
    );

    v_remaining := v_payment.amount;
    FOR v_ins IN
      SELECT id, amount_due, amount_paid, amount_pending, category, status, paid_date, due_date
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
          -- Canonical reevaluateInstallmentStatus at the op clock
          -- (equivalence finding A-0042-LADDER).
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
              paid_date = CASE WHEN v_new_status = 'paid' THEN v_ins.paid_date ELSE NULL END,
              updated_at = p_as_of
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
          p_as_of
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
    p_as_of
  );

  RETURN QUERY
    SELECT p_payment_id, 'unpaid'::TEXT, v_revert_count, v_total_reverted;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

DROP FUNCTION IF EXISTS public.revert_payment_allocation(uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION revert_payment_allocation(
  p_tenant_id UUID,
  p_payment_id UUID,
  p_actor_id UUID,
  p_actor_name TEXT,
  p_reason TEXT,
  p_as_of TIMESTAMPTZ DEFAULT NOW()
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
      v_reversal_id, p_tenant_id, v_original_ledger.account_id,
      v_original_ledger.parent_id, v_original_ledger.student_id,
      v_original_ledger.category, -v_original_ledger.amount,
      'reversal', 'payment', p_payment_id::TEXT,
      -- Canonical: refund/reversal entries have method=null, paymentStatus=null.
      NULL, v_original_ledger.receipt_number, NULL,
      v_original_ledger.id::TEXT,
      'Remboursement ' || v_payment.receipt_number || ' — inversion de l''écriture de paiement',
      p_actor_id::TEXT, p_actor_name, p_as_of,
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
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.refund', 'payment', p_payment_id,
    p_actor_id, p_actor_name,
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
$$ LANGUAGE plpgsql SET search_path = public, extensions;
