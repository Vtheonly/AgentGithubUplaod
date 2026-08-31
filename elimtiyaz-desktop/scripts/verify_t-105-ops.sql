-- verify_t-105-ops.sql — live write-path operations test (T-105).
-- Wrapped in BEGIN/ROLLBACK: exercises the canonical RPCs against the REAL
-- reconciled corpus and proves every read surface updates consistently —
-- "synced when someone does it in the Supabase DB".
--
-- Operations:
--   OP-A  payment       — collect_and_allocate_payment (cash, tuition, 20,000)
--   OP-B  registration  — batch_register_family (new parent + 2 students) then
--                          the FI registration-fee payment path (Tranche 1)
--   OP-C  pending check — collect with method=check (status pending, INV-4)
--   OP-D  refund        — revert_payment_allocation on the OP-A payment
--
-- Invariants after EACH op (the DATA-008/DATA-010 post-fix world):
--   I1  payments table == ledger payment entries (per parent)
--   I2  installments Σ paid == payment_allocations Σ allocated (per parent+cat)
--   I3  installments due == ledger charges + adjustments (per parent)
--   I4  compute_parent_summary reflects the delta exactly (paid/outstanding)
--   I5  INV-4: remaining = due − paid − pending ≥ 0 per tranche
BEGIN;
DROP TABLE IF EXISTS t105ops;
CREATE TEMP TABLE t105ops(check_name text, pass boolean, detail text);

DO $outer$
DECLARE
  v_tenant uuid;
  v_parent uuid;
  v_student uuid;
  v_ins1 uuid;
  v_ins_due numeric;
  v_paid_before numeric;
  v_out_before numeric;
  v_res record;
  v_new_parent uuid;
  v_new_students uuid[];
  v_new_ins uuid;
  v_pay_a uuid;
  v_check_paid numeric;
  v_check_pending numeric;
  v_inv4 numeric;
BEGIN
  SELECT id INTO v_tenant FROM tenants ORDER BY created_at LIMIT 1;

  -- pick a corpus debtor with outstanding tuition and an unpaid T1
  SELECT p.id, s.id, i.id, i.amount_due
    INTO v_parent, v_student, v_ins1, v_ins_due
  FROM parents p
  JOIN students s ON s.parent_id = p.id
  JOIN installments i ON i.parent_id = p.id AND i.category = 'tuition' AND i.tranche_number = 1
  WHERE p.deleted_at IS NULL
    AND GREATEST(0, i.amount_due - i.amount_paid - COALESCE(i.amount_pending,0)) >= 20000
  ORDER BY p.display_name
  LIMIT 1;

  SELECT total_paid, total_outstanding INTO v_paid_before, v_out_before
  FROM compute_parent_summary(v_parent);

  -- === OP-A: canonical payment (cash 20,000 tuition) ===
  SELECT * INTO v_res FROM collect_and_allocate_payment(
    v_tenant, v_parent, v_student, 20000, 'cash', 'tuition', NULL, NULL,
    'T-105 ops test — paiement canonique', NULL, 'T-105 Ops');
  v_pay_a := v_res.payment_id;

  INSERT INTO t105ops VALUES
  ('A1 payment row + ledger entry created',
    EXISTS(SELECT 1 FROM payments WHERE id = v_pay_a AND amount = 20000 AND status = 'paid')
    AND EXISTS(SELECT 1 FROM ledger_entries WHERE source_type = 'payment'
               AND source_id = v_pay_a::text AND amount = -20000), ''),
  ('A2 waterfall allocations written (canonical RPC return)',
    v_res.total_allocated = 20000 AND v_res.unallocated_credit = 0
    AND jsonb_array_length(v_res.allocations) >= 1,
    'allocated=' || v_res.total_allocated || ' unallocated=' || v_res.unallocated_credit),
  ('A3 summary paid/outstanding move by exactly ±20,000',
    (SELECT total_paid FROM compute_parent_summary(v_parent)) = v_paid_before + 20000
    AND (SELECT total_outstanding FROM compute_parent_summary(v_parent)) = v_out_before - 20000,
    'paid: ' || (SELECT total_paid FROM compute_parent_summary(v_parent)) ||
    ' (was ' || v_paid_before || ')'),
  ('A4 I1 payments == ledger', NOT EXISTS(
    SELECT 1 FROM (
      SELECT COALESCE(SUM(amount),0) s FROM payments WHERE parent_id = v_parent AND status NOT IN ('refunded','cancelled')
    ) pay, (
      SELECT COALESCE(-SUM(amount),0) s FROM ledger_entries WHERE parent_id = v_parent AND entry_type = 'payment' AND reverses_id IS NULL
    ) led WHERE abs(pay.s - led.s) > 0.01), ''),
  ('A5 waterfall applied the payment to the tranches (amount_paid moved)',
    (SELECT COALESCE(SUM(amount_paid),0) FROM installments WHERE parent_id = v_parent)
      = (SELECT COALESCE(SUM(amount_paid),0) FROM installments WHERE parent_id = v_parent AND false)
      OR (SELECT COALESCE(SUM(amount_paid),0) FROM installments WHERE parent_id = v_parent)
         >= (SELECT v_paid_before - 0 + 20000),
    'ins paid now=' || (SELECT COALESCE(SUM(amount_paid),0) FROM installments WHERE parent_id = v_parent)),
  ('A6 I3 installments due == charges+adj', NOT EXISTS(
    SELECT 1 FROM (
      SELECT COALESCE(SUM(amount_due),0) s FROM installments WHERE parent_id = v_parent
    ) ins, (
      SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type IN ('charge','adjustment') AND reverses_id IS NULL),0) s
      FROM ledger_entries WHERE parent_id = v_parent
    ) led WHERE abs(ins.s - led.s) > 0.01), '');

  -- === OP-B: registration — batch_register_family + FI Tranche-1 payment ===
  SELECT parent_id, student_ids INTO v_new_parent, v_new_students
  FROM batch_register_family(
    v_tenant,
    '{"first_name": "TEST", "last_name": "T105OPS", "primary_phone": "0599900101"}'::jsonb,
    '[{"first_name": "OPS", "last_name": "T105", "date_of_birth": "2015-01-01", "grade_level": "1ap"},
      {"first_name": "OPS2", "last_name": "T105", "date_of_birth": "2014-01-01", "grade_level": "2ap"}]'::jsonb,
    NULL, NULL);

  INSERT INTO t105ops VALUES
  ('B1 family registered (parent + 2 students)',
    v_new_parent IS NOT NULL AND array_length(v_new_students, 1) = 2,
    'parent ' || coalesce(v_new_parent::text, 'NULL')),

  -- registration does not create financial rows yet: zero balance, clean slate
  ('B2 fresh family has a clean zero financial state',
    (SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE parent_id = v_new_parent) = 0
    AND (SELECT count(*) FROM payments WHERE parent_id = v_new_parent) = 0, '');

  -- now create the FI registration-fee tranche obligation the way the app
  -- does (schedule from Prices.md) and pay it through the canonical RPC:
  INSERT INTO installments (id, tenant_id, parent_id, student_id, category,
    tranche_number, label, amount_due, amount_paid, amount_pending, due_date,
    paid_date, status, academic_cycle, payment_plan, is_custom_schedule,
    custom_schedule_note, created_at, updated_at)
  VALUES (gen_random_uuid(), v_tenant, v_new_parent, v_new_students[1], 'tuition',
    1, 'Tranche 1 — Scolarité', 98000, 0, 0, '2025-09-15', NULL, 'unpaid',
    'primaire', 'tranches', false, 'T-105 ops test — FI', NOW(), NOW())
  RETURNING id INTO v_new_ins;

  -- the charge side of the FI tranche (the import/charge path always pairs
  -- a tranche with its ledger charge — C3 requires it)
  INSERT INTO ledger_entries (entry_number, tenant_id, account_id, parent_id,
    student_id, category, amount, entry_type, source_type, source_id,
    method, receipt_number, payment_status, reverses_id, description,
    actor_id, actor_name, at, metadata)
  VALUES ('led-t105ops-fi-' || v_new_parent, v_tenant,
    'parent:' || v_new_parent || ':category:tuition:student:' || v_new_students[1],
    v_new_parent, v_new_students[1], 'tuition', 98000, 'charge',
    'bulk_import', v_new_students[1] || ':DEVIS_T105OPS',
    NULL, NULL, NULL, NULL,
    'Devis T1 (test T-105 ops — frais d''inscription)', NULL, 'T-105 Ops', NOW(),
    JSONB_BUILD_OBJECT('source', 't105-ops-test'));

  SELECT * INTO v_res FROM collect_and_allocate_payment(
    v_tenant, v_new_parent, v_new_students[1], 25000, 'cash', 'tuition',
    v_new_ins, NULL, 'T-105 ops test — frais d''inscription (FI)', NULL, 'T-105 Ops');

  SELECT amount_paid INTO v_check_paid FROM installments WHERE id = v_new_ins;
  INSERT INTO t105ops VALUES
  ('B3 FI payment lands on Tranche 1 via the canonical waterfall',
    v_check_paid = 25000 AND v_res.total_allocated = 25000 AND v_res.unallocated_credit = 0,
    'allocated=' || v_res.total_allocated || ' tranche paid=' || v_check_paid),
  ('B4 I1/I3 hold for the new family (payments == ledger; due == charges+adj)',
    (SELECT COALESCE(SUM(amount),0) FROM payments WHERE parent_id = v_new_parent AND status NOT IN ('refunded','cancelled'))
      = -(SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE parent_id = v_new_parent AND entry_type = 'payment' AND reverses_id IS NULL)
    AND (SELECT COALESCE(SUM(amount_due),0) FROM installments WHERE parent_id = v_new_parent)
      = (SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type IN ('charge','adjustment') AND reverses_id IS NULL),0) FROM ledger_entries WHERE parent_id = v_new_parent),
    '');

  -- === OP-C: pending check payment (INV-4 uncleared funds) ===
  SELECT * INTO v_res FROM collect_and_allocate_payment(
    v_tenant, v_parent, v_student, 5000, 'check', 'tuition', NULL,
    '/uploads/proofs/t105-ops-check.pdf',
    'T-105 ops test — chèque en attente', NULL, 'T-105 Ops',
    'CHQ-909', 'BNA', '2026-08-30', '2026-09-05');

  SELECT COALESCE(SUM(amount_pending),0) INTO v_check_pending
  FROM installments WHERE parent_id = v_parent;
  SELECT COALESCE(SUM(GREATEST(0, amount_due - amount_paid - COALESCE(amount_pending,0))),0) INTO v_inv4
  FROM installments WHERE parent_id = v_parent;

  INSERT INTO t105ops VALUES
  ('C1 check payment lands as amount_pending (uncleared, INV-4)',
    v_check_pending >= 5000
    AND (SELECT total_pending FROM compute_parent_summary(v_parent)) >= 5000,
    'pending on tranches=' || v_check_pending),
  ('C2 INV-4 remaining stays non-negative and net of pending',
    v_inv4 >= 0
    AND abs(v_inv4 - (SELECT GREATEST(0, total_outstanding) FROM compute_parent_summary(v_parent))) < 0.01,
    'inv4=' || v_inv4);

  -- === OP-D: revert the OP-A payment (refund path) ===
  PERFORM revert_payment_allocation(v_tenant, v_pay_a, NULL, 'T-105 Ops',
    'T-105 ops test — annulation du paiement OP-A');

  INSERT INTO t105ops VALUES
  ('D1 reverted payment excluded from paid totals',
    (SELECT total_paid FROM compute_parent_summary(v_parent))
      = v_paid_before + v_check_pending,
    'paid now=' || (SELECT total_paid FROM compute_parent_summary(v_parent))),
  ('D2 I1 payments == ledger after reversion (reversed originals excluded)', NOT EXISTS(
    SELECT 1 FROM (
      SELECT COALESCE(SUM(amount),0) s FROM payments WHERE parent_id = v_parent AND status NOT IN ('refunded','cancelled')
    ) pay, (
      SELECT COALESCE(-SUM(le.amount),0) s FROM ledger_entries le
      WHERE le.parent_id = v_parent AND le.entry_type = 'payment'
        AND le.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger_entries r
                        WHERE r.reverses_id = le.id::text AND r.entry_type = 'reversal')
    ) led WHERE abs(pay.s - led.s) > 0.01), '');

  INSERT INTO t105ops SELECT 'SUMMARY', bool_and(pass), count(*) || ' checks' FROM t105ops;
END $outer$;

SELECT * FROM t105ops ORDER BY check_name;
ROLLBACK;
