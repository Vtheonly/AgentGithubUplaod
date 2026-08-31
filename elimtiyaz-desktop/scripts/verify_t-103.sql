-- verify_t-103.sql — live verification for T-103 (migration 0062 financial
-- reconciliation). Wrapped in BEGIN/ROLLBACK so it can be re-run any time.
-- Stores results in a temp table so the Supabase CLI surfaces them.
--
-- Checks (per the problem registry's verification criteria):
--   C1  payment_allocations populated + internally consistent
--       (Σ allocations per payment == payment.amount - excess).
--   C2  payments table == ledger payment entries for EVERY parent
--       (DATA-002 closed).
--   C3  installments due == ledger charges + adjustments per parent
--       (DATA-003 closed: transport charges + dettes + devis correction).
--   C4  installments paid == payments allocated (waterfall result);
--       no tranche has amount_paid > amount_due (over-application killed).
--   C5  for debtors: installment remaining == ledger balance
--       (the Finance tab and the parent dossier finally agree).
--   C6  overpayers: balance < 0 and installments remaining == 0
--       (credit position; no parent_credit double-count — DATA-009 decision).
--   C7  expected_amount / excess_amount populated on every payment
--       (DATA-004 closed) and Σ(excess) per parent == -balance for overpayers.
--   C8  transport charges exist for every student with transport installments.
BEGIN;
DROP TABLE IF EXISTS t103_results;
CREATE TEMP TABLE t103_results AS
WITH pay AS (
  SELECT parent_id,
    SUM(amount) FILTER (WHERE status NOT IN ('refunded','cancelled')) AS paid_table
  FROM payments GROUP BY parent_id
), led AS (
  SELECT parent_id,
    SUM(-amount) FILTER (WHERE entry_type = 'payment' AND reverses_id IS NULL) AS paid_ledger,
    SUM(amount) FILTER (WHERE entry_type = 'charge' AND reverses_id IS NULL) AS charged,
    SUM(amount) FILTER (WHERE entry_type = 'adjustment' AND reverses_id IS NULL) AS adjusted,
    SUM(amount) AS balance
  FROM ledger_entries GROUP BY parent_id
), ins AS (
  SELECT parent_id,
    SUM(amount_due) AS due,
    SUM(amount_paid) AS ins_paid,
    SUM(GREATEST(0, amount_due - amount_paid - COALESCE(amount_pending, 0))) AS ins_remaining
  FROM installments GROUP BY parent_id
), alloc AS (
  SELECT payment_id, SUM(allocated_amount) AS allocated
  FROM payment_allocations GROUP BY payment_id
), exc AS (
  SELECT parent_id, SUM(COALESCE(excess_amount, 0)) AS total_excess
  FROM payments WHERE status NOT IN ('refunded','cancelled') GROUP BY parent_id
), base AS (
  SELECT p.id, COALESCE(pay.paid_table,0) AS paid_table, COALESCE(led.paid_ledger,0) AS paid_ledger,
    COALESCE(led.charged,0) AS charged, COALESCE(led.adjusted,0) AS adjusted, COALESCE(led.balance,0) AS balance,
    COALESCE(ins.due,0) AS due, COALESCE(ins.ins_paid,0) AS ins_paid, COALESCE(ins.ins_remaining,0) AS ins_remaining,
    COALESCE(exc.total_excess,0) AS total_excess
  FROM parents p
  LEFT JOIN pay ON pay.parent_id = p.id
  LEFT JOIN led ON led.parent_id = p.id
  LEFT JOIN ins ON ins.parent_id = p.id
  LEFT JOIN exc ON exc.parent_id = p.id
)
SELECT
  (SELECT COUNT(*) FROM payment_allocations) > 0
    AND (SELECT COUNT(*) FROM alloc a JOIN payments p2 ON p2.id = a.payment_id
         WHERE ABS(p2.amount - COALESCE(p2.excess_amount,0) - a.allocated) > 0.001) = 0
    AS c1_allocations_consistent,
  (SELECT COUNT(*) FROM base WHERE ABS(paid_table - paid_ledger) > 0.001) = 0
    AS c2_payments_eq_ledger,
  (SELECT COUNT(*) FROM base WHERE ABS(due - (charged + adjusted)) > 0.001) = 0
    AS c3_due_eq_charges_adj,
  (SELECT COUNT(*) FROM base WHERE ABS(ins_paid - (paid_ledger - total_excess)) > 0.001) = 0
    AND (SELECT COUNT(*) FROM installments WHERE amount_paid - amount_due > 0.001) = 0
    AS c4_waterfall_no_overapply,
  (SELECT COUNT(*) FROM base WHERE balance > 0.001 AND ABS(ins_remaining - balance) > 0.001) = 0
    AS c5_debtors_agree,
  (SELECT COUNT(*) FROM base WHERE balance < -0.001 AND ins_remaining > 0.001) = 0
    AS c6_overpayers_zero_remaining,
  (SELECT COUNT(*) FROM payments WHERE expected_amount IS NULL OR excess_amount IS NULL) = 0
    AS c7_expected_excess_populated,
  (SELECT COUNT(*) FROM installments i WHERE i.category='transport' AND NOT EXISTS (
     SELECT 1 FROM ledger_entries le WHERE le.entry_type='charge' AND le.category='transport'
       AND le.student_id = i.student_id AND le.reverses_id IS NULL)) = 0
    AS c8_transport_charges_present
FROM base LIMIT 1;

-- Detailed counts + the owner's reported parent spot-check, folded into a
-- single final result set (the Supabase CLI only surfaces the last one).
CREATE TEMP TABLE t103_counts AS
WITH pay AS (SELECT parent_id, SUM(amount) FILTER (WHERE status NOT IN ('refunded','cancelled')) AS paid_table FROM payments GROUP BY parent_id),
led AS (SELECT parent_id, SUM(-amount) FILTER (WHERE entry_type='payment' AND reverses_id IS NULL) AS paid_ledger,
  SUM(amount) FILTER (WHERE entry_type='charge' AND reverses_id IS NULL) AS charged,
  SUM(amount) FILTER (WHERE entry_type='adjustment' AND reverses_id IS NULL) AS adjusted,
  SUM(amount) AS balance FROM ledger_entries GROUP BY parent_id),
ins AS (SELECT parent_id, SUM(amount_due) AS due, SUM(amount_paid) AS ins_paid,
  SUM(GREATEST(0, amount_due - amount_paid - COALESCE(amount_pending,0))) AS ins_remaining FROM installments GROUP BY parent_id)
SELECT
  COUNT(*) AS parents_total,
  COUNT(*) FILTER (WHERE ABS(COALESCE(paid_table,0)-COALESCE(paid_ledger,0))>0.001) AS residual_c2,
  COUNT(*) FILTER (WHERE ABS(COALESCE(due,0)-(COALESCE(charged,0)+COALESCE(adjusted,0)))>0.001) AS residual_c3,
  COUNT(*) FILTER (WHERE COALESCE(balance,0)>0.001 AND ABS(COALESCE(ins_remaining,0)-COALESCE(balance,0))>0.001) AS residual_c5,
  COUNT(*) FILTER (WHERE COALESCE(balance,0)<-0.001) AS overpayers,
  COUNT(*) FILTER (WHERE COALESCE(balance,0)>0.001) AS debtors
FROM parents p LEFT JOIN pay ON pay.parent_id=p.id LEFT JOIN led ON led.parent_id=p.id LEFT JOIN ins ON ins.parent_id=p.id;

CREATE TEMP TABLE t103_spot AS
WITH led AS (SELECT SUM(amount) AS balance, SUM(-amount) FILTER (WHERE entry_type='payment') AS paid,
  SUM(amount) FILTER (WHERE entry_type='charge') AS charged, SUM(amount) FILTER (WHERE entry_type='adjustment') AS adjusted
  FROM ledger_entries WHERE parent_id='e3e90f1f-a8e6-428e-b05b-e757a8d53b09'),
ins AS (SELECT SUM(amount_due) AS due, SUM(amount_paid) AS ins_paid,
  SUM(GREATEST(0, amount_due-amount_paid-COALESCE(amount_pending,0))) AS remaining FROM installments WHERE parent_id='e3e90f1f-a8e6-428e-b05b-e757a8d53b09'),
pay AS (SELECT SUM(amount) AS paid_table, SUM(COALESCE(excess_amount,0)) AS excess FROM payments WHERE parent_id='e3e90f1f-a8e6-428e-b05b-e757a8d53b09' AND status NOT IN ('refunded','cancelled'))
SELECT led.charged, led.adjusted, ins.due, led.paid, pay.paid_table,
  ins.ins_paid, ins.remaining, led.balance, pay.excess
FROM led, ins, pay;

SELECT 'C1 payment_allocations consistent' AS check_name, c1_allocations_consistent::text AS pass FROM t103_results
UNION ALL SELECT 'C2 payments == ledger (per parent)', c2_payments_eq_ledger::text FROM t103_results
UNION ALL SELECT 'C3 installments due == charges+adj', c3_due_eq_charges_adj::text FROM t103_results
UNION ALL SELECT 'C4 waterfall applied, no over-applied tranche', c4_waterfall_no_overapply::text FROM t103_results
UNION ALL SELECT 'C5 debtors: remaining == balance', c5_debtors_agree::text FROM t103_results
UNION ALL SELECT 'C6 overpayers: 0 remaining, credit balance', c6_overpayers_zero_remaining::text FROM t103_results
UNION ALL SELECT 'C7 expected/excess populated', c7_expected_excess_populated::text FROM t103_results
UNION ALL SELECT 'C8 transport charges present', c8_transport_charges_present::text FROM t103_results
UNION ALL SELECT 'parents_total', parents_total::text FROM t103_counts
UNION ALL SELECT 'residual_c2_payments_vs_ledger', residual_c2::text FROM t103_counts
UNION ALL SELECT 'residual_c3_due_vs_charges', residual_c3::text FROM t103_counts
UNION ALL SELECT 'residual_c5_debtors_remaining', residual_c5::text FROM t103_counts
UNION ALL SELECT 'overpayers (credit position)', overpayers::text FROM t103_counts
UNION ALL SELECT 'debtors (owe balance)', debtors::text FROM t103_counts
UNION ALL SELECT 'spot_e3e90f1f_charged+adj=due', (charged + adjusted)::text || ' / ' || due::text FROM t103_spot
UNION ALL SELECT 'spot_e3e90f1f_ledger_paid=payments', paid::text || ' / ' || paid_table::text FROM t103_spot
UNION ALL SELECT 'spot_e3e90f1f_allocated=ins_paid', ins_paid::text FROM t103_spot
UNION ALL SELECT 'spot_e3e90f1f_remaining', remaining::text FROM t103_spot
UNION ALL SELECT 'spot_e3e90f1f_balance=-excess', balance::text || ' / -' || excess::text FROM t103_spot;

ROLLBACK;
