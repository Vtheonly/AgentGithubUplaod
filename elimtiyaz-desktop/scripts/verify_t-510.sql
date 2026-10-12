-- verify_t-510.sql — live verification for T-510 (migration 0152, DEBT-105 /
-- GitHub issue #31: the per-tranche amount adjustment RPC
-- `adjust_installment_amount`).
--
-- Convention (AGENTS.md §11.1 + §15.39): wrapped in BEGIN/ROLLBACK so it can
-- be re-run any time without mutating the live DB (the EXECUTE-mode evidence
-- — the only trustworthy proof for a gated RPC); results land in a temp
-- table; the guards' rejections are captured through nested BEGIN/EXCEPTION
-- blocks (the raised error is the PASS condition); the whole payload runs in
-- ONE Management-API session (quirk #3 — the verify-script convention).
--
-- Live actor used (resolved 2026-10-13):
--   STAFF        auth.users a148fe34-98e3-422a-bf42-91da094e270c
--                (profile admin@elimtiyaz.dz, role super_admin, tenant
--                 00000000-0000-0000-0000-000000000001)
--   NON-STAFF    a synthetic unbound sub (00000000-…-099) — resolves to NO
--                profile: has_any_role is empty, the gate must fail closed.
--
-- Seeded inside the transaction (rolled back — zero residue, §15.38): one
-- T-510-FAKE-marked family (parent + student) + 3 installments covering the
-- issue's classes: an UNPAID future-due tranche, a FULLY PAID tranche, and a
-- PARTIAL tranche with UNCLEARED pending funds.
BEGIN;

DROP TABLE IF EXISTS t510_results;
CREATE TEMP TABLE t510_results (check_id text, ok boolean, detail text);
-- §15.27: the DO blocks run SET LOCAL ROLE authenticated — grant the temp
-- results table before the first impersonation.
GRANT INSERT, SELECT ON t510_results TO authenticated, anon;

-- Seed the T-510 FAKE family (rolled back at the end — zero residue).
SET LOCAL ROLE postgres;
INSERT INTO public.parents (id, tenant_id, parent_code, first_name, last_name,
    primary_phone, notes)
VALUES ('66666666-1111-2222-3333-444444444401'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'PAR-UI-TEST-510', 'T510', 'VERIFY-SEED', '0000000000',
        'T-510 verify seed — rolled back');
INSERT INTO public.students (id, tenant_id, parent_id, student_code, first_name,
    last_name, date_of_birth, medical_notes)
VALUES ('66666666-1111-2222-3333-444444444402'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        '66666666-1111-2222-3333-444444444401'::uuid,
        'ELV-UI-TEST-510', 'Kid', 'VERIFY-SEED', '2015-01-01',
        'T-510 verify seed — rolled back');
-- The three class fixtures.
INSERT INTO public.installments (id, tenant_id, parent_id, student_id,
    category, label, tranche_number, amount_due, amount_paid, amount_pending,
    due_date, paid_date, status, payment_plan, source_type, source_id)
VALUES
  -- ins-A: unpaid, FUTURE due (the ADR-033 unpaid branch).
  ('66666666-1111-2222-3333-444444444411'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   '66666666-1111-2222-3333-444444444401'::uuid,
   '66666666-1111-2222-3333-444444444402'::uuid,
   'tuition', 'Tranche 1 (seed T-510)', 1, 10000, 0, 0,
   '2097-06-15', NULL, 'unpaid', 'tranches', 'bulk_import', 'seed-t510-A'),
  -- ins-B: FULLY PAID (10 000 paid of 10 000 due, paid_date stamped).
  ('66666666-1111-2222-3333-444444444412'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   '66666666-1111-2222-3333-444444444401'::uuid,
   '66666666-1111-2222-3333-444444444402'::uuid,
   'tuition', 'Tranche 2 (seed T-510)', 2, 10000, 10000, 0,
   '2026-06-15', '2026-06-10', 'paid', 'tranches', 'bulk_import', 'seed-t510-B'),
  -- ins-C: PARTIAL with UNCLEARED pending funds (2 000 cleared + 3 000 pending
  -- of 10 000 due — the pending_clearance state).
  ('66666666-1111-2222-3333-444444444413'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   '66666666-1111-2222-3333-444444444401'::uuid,
   '66666666-1111-2222-3333-444444444402'::uuid,
   'tuition', 'Tranche 3 (seed T-510)', 3, 10000, 2000, 3000,
   '2097-06-15', NULL, 'pending_clearance', 'tranches', 'bulk_import', 'seed-t510-C');
RESET ROLE;

-- C1: registration + chain (148 = the 147 repo files 0001..0152 MINUS the
-- deliberately-skipped 0118 slot PLUS the documented stray live-0118 row
-- that 0120 reconciled — the UNKNOWN-028 steady state: live = repo + 1).
INSERT INTO t510_results
SELECT 'C1-registered', COUNT(*) = 1, 'rows=' || COUNT(*)
  FROM supabase_migrations.schema_migrations WHERE version = '0152';
INSERT INTO t510_results
SELECT 'C1-chain-148', (SELECT COUNT(*) FROM supabase_migrations.schema_migrations) = 148,
       'chain=' || (SELECT COUNT(*) FROM supabase_migrations.schema_migrations);

-- The family-level T-103 gap BEFORE any adjustment (the reconciliation
-- witness baseline: the seeded family has NO ledger charges, so its gap is
-- the negative of Σ due — the ADJUSTMENT must preserve it exactly).
-- (Computed inside the C2 block below; the baseline is captured here.)
CREATE TEMP TABLE t510_gap_baseline AS
SELECT COALESCE(SUM(l.amount), 0) - (SELECT COALESCE(SUM(i.amount_due), 0)
        FROM public.installments i WHERE i.parent_id = '66666666-1111-2222-3333-444444444401'::uuid) AS gap
  FROM public.ledger_entries l
 WHERE l.parent_id = '66666666-1111-2222-3333-444444444401'::uuid;
GRANT SELECT ON t510_gap_baseline TO authenticated;

-- C2+C3+C7+C8: the EXECUTE-mode evidence — the STAFF role drives the RPC
-- through the issue's scenarios on the SEEDED family (inside the
-- transaction; every write rolls back at the end).
DO $$
DECLARE
    v_r record;
    v_a record;
    v_sibling_due numeric;
    v_sibling_paid numeric;
    v_sibling_pending numeric;
    v_sibling_status text;
    v_gap_before numeric;
    v_gap_after numeric;
    v_ledger_count int;
    v_payments_count int;
    v_payment_entries int;
    v_overcovered boolean;
    v_excess numeric;
BEGIN
    -- The staff impersonation (the t-214 C5 convention).
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "a148fe34-98e3-422a-bf42-91da094e270c", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;

    SELECT gap INTO v_gap_before FROM t510_gap_baseline;
    SELECT COALESCE(SUM(x.amount_due), 0), COUNT(*) INTO v_sibling_due, v_ledger_count
      FROM public.installments x WHERE x.parent_id = '66666666-1111-2222-3333-444444444401'::uuid;
    SELECT COUNT(*) INTO v_payments_count FROM public.payments
     WHERE parent_id = '66666666-1111-2222-3333-444444444401'::uuid;
    SELECT COUNT(*) INTO v_payment_entries FROM public.ledger_entries
     WHERE entry_type = 'payment' AND parent_id = '66666666-1111-2222-3333-444444444401'::uuid;

    -- ── C2: the UP adjustment on the UNPAID tranche (ins-A 10 000 → 12 000) ──
    SELECT * INTO v_r FROM public.adjust_installment_amount(
        '66666666-1111-2222-3333-444444444411'::uuid, 12000, 'C2 verification T-510 — augmentation',
        NULL, 't510-verify') AS t;
    SELECT amount_due, status INTO v_a FROM public.installments
     WHERE id = '66666666-1111-2222-3333-444444444411'::uuid;
    INSERT INTO t510_results VALUES ('C2-row-updated',
        v_a.amount_due = 12000 AND v_a.status = 'unpaid',
        'due=' || v_a.amount_due || ' status=' || v_a.status || ' delta=' || v_r.delta);
    INSERT INTO t510_results VALUES ('C2-return-shape',
        v_r.previous_amount_due = 10000 AND v_r.delta = 2000
        AND v_r.new_status = 'unpaid' AND v_r.overcovered = false,
        'prev=' || v_r.previous_amount_due || ' delta=' || v_r.delta);
    -- The ONE ledger adjustment entry with the exact signed delta on the
    -- tranche's OWN account.
    INSERT INTO t510_results SELECT 'C2-ledger-entry',
        COUNT(*) = 1 AND SUM(amount) = 2000
        AND (array_agg(account_id))[1] = 'parent:66666666-1111-2222-3333-444444444401:category:tuition:student:66666666-1111-2222-3333-444444444402'
        AND (array_agg(entry_type))[1] = 'adjustment',
        'entries=' || COUNT(*)
  FROM public.ledger_entries
 WHERE source_id = 'adj-66666666-1111-2222-3333-444444444411';
    -- The audit row with the before/after pair.
    INSERT INTO t510_results SELECT 'C2-audit-row',
        COUNT(*) = 1
        AND MIN((after_json ->> 'amountDue')::numeric) = 12000
        AND MIN((before_json ->> 'amountDue')::numeric) = 10000
        AND MIN(action) = 'installment.amount_adjusted',
        'audit_rows=' || COUNT(*)
  FROM public.audit_logs
 WHERE entity_id = '66666666-1111-2222-3333-444444444411'::uuid;

    -- ── C7: the SIBLING isolation — ins-B and ins-C byte-identical ──
    SELECT amount_due, amount_paid, amount_pending, status
      INTO v_sibling_due, v_sibling_paid, v_sibling_pending, v_sibling_status
      FROM public.installments WHERE id = '66666666-1111-2222-3333-444444444412'::uuid;
    INSERT INTO t510_results VALUES ('C7-sibling-B-untouched',
        v_sibling_due = 10000 AND v_sibling_paid = 10000 AND v_sibling_pending = 0
        AND v_sibling_status = 'paid',
        'B: due=' || v_sibling_due || ' paid=' || v_sibling_paid || ' status=' || v_sibling_status);
    SELECT amount_due, amount_paid, amount_pending, status
      INTO v_sibling_due, v_sibling_paid, v_sibling_pending, v_sibling_status
      FROM public.installments WHERE id = '66666666-1111-2222-3333-444444444413'::uuid;
    INSERT INTO t510_results VALUES ('C7-sibling-C-untouched',
        v_sibling_due = 10000 AND v_sibling_paid = 2000 AND v_sibling_pending = 3000
        AND v_sibling_status = 'pending_clearance',
        'C: due=' || v_sibling_due || ' paid=' || v_sibling_paid || ' pending=' || v_sibling_pending);

    -- ── C3: the OVER-COVERED DOWN adjustment on the PAID tranche
    --       (ins-B 10 000 → 4 000 with 10 000 already paid) ──
    SELECT * INTO v_r FROM public.adjust_installment_amount(
        '66666666-1111-2222-3333-444444444412'::uuid, 4000, 'C3 verification T-510 — reduction sous couverture',
        NULL, 't510-verify') AS t;
    SELECT amount_due, amount_paid, amount_pending, status INTO v_a FROM public.installments
     WHERE id = '66666666-1111-2222-3333-444444444412'::uuid;
    INSERT INTO t510_results VALUES ('C3-overcovered-explicit',
        v_r.overcovered = true AND v_r.excess = 6000
        AND v_a.amount_due = 4000 AND v_a.amount_paid = 10000 AND v_a.status = 'paid',
        'flag=' || v_r.overcovered || ' excess=' || v_r.excess
        || ' paid=' || v_a.amount_paid || ' status=' || v_a.status);

    -- ── C8: the T-103 delta preservation — the family gap is UNCHANGED ──
    SELECT COALESCE(SUM(l.amount), 0) - (SELECT COALESCE(SUM(i.amount_due), 0)
             FROM public.installments i
            WHERE i.parent_id = '66666666-1111-2222-3333-444444444401'::uuid)
      INTO v_gap_after
      FROM public.ledger_entries l
     WHERE l.parent_id = '66666666-1111-2222-3333-444444444401'::uuid;
    INSERT INTO t510_results VALUES ('C8-reconciliation-gap-preserved',
        v_gap_after = v_gap_before,
        'before=' || v_gap_before || ' after=' || v_gap_after);

    -- ── C10: the payments untouched (zero rows, zero payment entries — the
    --        seeded family carries none and the adjustment created none) ──
    INSERT INTO t510_results VALUES ('C10-payments-untouched',
        (SELECT COUNT(*) = v_payments_count FROM public.payments
         WHERE parent_id = '66666666-1111-2222-3333-444444444401'::uuid)
        AND (SELECT COUNT(*) = v_payment_entries FROM public.ledger_entries
              WHERE entry_type = 'payment' AND parent_id = '66666666-1111-2222-3333-444444444401'::uuid),
        'payments=' || v_payments_count || ' payment_entries=' || v_payment_entries);

    -- ── C4: the NO-OP guard (the repeated same-value save) ──
    BEGIN
        PERFORM public.adjust_installment_amount(
            '66666666-1111-2222-3333-444444444412'::uuid, 4000, 'C4 no-op T-510',
            NULL, 't510-verify');
        INSERT INTO t510_results VALUES ('C4-noop-guard', false, 'no exception raised');
    EXCEPTION WHEN others THEN
        INSERT INTO t510_results VALUES ('C4-noop-guard',
            position('nothing to adjust' in SQLERRM) > 0, SQLERRM);
    END;

    -- ── C5: the short-reason guard ──
    BEGIN
        PERFORM public.adjust_installment_amount(
            '66666666-1111-2222-3333-444444444413'::uuid, 11000, 'ab',
            NULL, 't510-verify');
        INSERT INTO t510_results VALUES ('C5-reason-guard', false, 'no exception raised');
    EXCEPTION WHEN others THEN
        INSERT INTO t510_results VALUES ('C5-reason-guard',
            position('the reason is required' in SQLERRM) > 0, SQLERRM);
    END;

    -- ── C6: the negative-amount guard ──
    BEGIN
        PERFORM public.adjust_installment_amount(
            '66666666-1111-2222-3333-444444444413'::uuid, -5, 'C6 negative T-510',
            NULL, 't510-verify');
        INSERT INTO t510_results VALUES ('C6-negative-guard', false, 'no exception raised');
    EXCEPTION WHEN others THEN
        INSERT INTO t510_results VALUES ('C6-negative-guard',
            position('must be >= 0' in SQLERRM) > 0, SQLERRM);
    END;

    -- ── C9: the NON-STAFF gate (an unbound sub — has_any_role is empty,
    --        the write must fail closed) ──
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "00000000-0000-0000-0000-000000000099", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    BEGIN
        PERFORM public.adjust_installment_amount(
            '66666666-1111-2222-3333-444444444411'::uuid, 13000, 'C9 non-staff T-510',
            NULL, 't510-verify');
        INSERT INTO t510_results VALUES ('C9-non-staff-rejected', false, 'no exception raised');
    EXCEPTION WHEN others THEN
        INSERT INTO t510_results VALUES ('C9-non-staff-rejected',
            position('forbidden' in SQLERRM) > 0, SQLERRM);
    END;

    -- ── C11: the PENDING tranche keeps its state under an increase
    --        (ins-C 10 000 → 11 000; the uncleared funds are preserved) ──
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "a148fe34-98e3-422a-bf42-91da094e270c", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SELECT * INTO v_r FROM public.adjust_installment_amount(
        '66666666-1111-2222-3333-444444444413'::uuid, 11000, 'C11 pending T-510 — fonds non degages preserves',
        NULL, 't510-verify') AS t;
    SELECT amount_paid, amount_pending, status INTO v_a FROM public.installments
     WHERE id = '66666666-1111-2222-3333-444444444413'::uuid;
    INSERT INTO t510_results VALUES ('C11-pending-preserved',
        v_a.amount_paid = 2000 AND v_a.amount_pending = 3000
        AND v_a.status = 'pending_clearance' AND v_r.overcovered = false,
        'paid=' || v_a.amount_paid || ' pending=' || v_a.amount_pending || ' status=' || v_a.status);
END $$;

-- Results.
SELECT check_id, ok, detail FROM t510_results ORDER BY check_id;

ROLLBACK;
