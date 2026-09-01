-- ============================================================================
-- WEAK-030 live verification — expense-approval state machine + hard
-- no-self-approval at the DB layer (migration 0064).
--
-- Reproduces BOTH registered bypasses (as they were possible pre-0064) and
-- the legal paths, all inside a transaction that ROLLS BACK (no data
-- mutation). Run AFTER apply_0064_live.sh:
--   /home/z/my-project/bin/supabase db query --linked -f scripts/verify_t-weak030.sql
--
--   B1  state-machine bypass: pending_approval → settled_and_closed
--       (jump over approve+disburse; receipt + amount set so ONLY the
--       graph can reject it) .................................... must FAIL
--   B1b state-machine bypass: reopen settled_and_closed → pending_approval . must FAIL
--   B1c state-machine bypass: rejected → disbursed ......................... must FAIL
--   B1d illegal INSERT: a ticket born already approved_funds_released ..... must FAIL
--   B2  NULL-approver self-approval (submitter's own ticket, approved_by
--       left NULL — the exact RLS-permitted 0008 bypass) ......... must FAIL
--   B2b explicit self-approval (approved_by = submitted_by) ............... must FAIL
--   L1  legal: pending_approval → approved with a DIFFERENT approver ...... must PASS
--   L2  legal: approved → settled_and_closed (settle_expense allows settling
--       from EITHER approved or disbursed) .......................... must PASS
--   L3  legal: approved → disbursed (the adapter's disburse) .............. must PASS
--   L4  legal: disbursed → settled_and_closed (settleProof shape) ......... must PASS
--   L5  0008 invariant kept: rejected without a reason .................... must FAIL
-- ============================================================================

BEGIN;

CREATE TEMP TABLE weak030_results (scenario text, outcome text, detail text);

-- Fixtures: resolve the REAL seeded category id (office_supplies already
-- exists in the live corpus — never insert fixed fixture ids here).
DO $$
DECLARE
    v_category uuid;
BEGIN
    SELECT id INTO v_category FROM public.expense_categories
     WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND code = 'office_supplies'
       FOR UPDATE;
    IF v_category IS NULL THEN
        INSERT INTO public.expense_categories (id, tenant_id, code, label_fr)
        VALUES ('aaaaaaa0-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'office_supplies', 'Fournitures de bureau')
        RETURNING id INTO v_category;
    END IF;
END $$;

-- Helper: a fresh ticket born pending_approval (the legal initial status),
-- bound to the real seeded category.
DO $$
DECLARE
    i int := 0;
    v_category uuid;
BEGIN
    SELECT id INTO v_category FROM public.expense_categories
     WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND code = 'office_supplies';
    FOR i IN 10..16 LOOP
        INSERT INTO public.expense_tickets (
            id, tenant_id, ticket_number, title, description, category_id,
            requested_amount, justification, urgency, status, submitted_by
        ) VALUES (
            ('aaaaaaa0-0000-4000-8000-0000000000' || i::text)::uuid,
            '00000000-0000-0000-0000-000000000001',
            'EXP-WEAK030-' || lpad(i::text, 3, '0'), 'W030 fixture ' || i, 'fixture',
            v_category,
            1000.00, 'fixture justification', 'medium', 'pending_approval',
            'aaaaaaa0-0000-4000-8000-000000000001'
        );
    END LOOP;
END $$;

-- ── B1: jump pending_approval → settled_and_closed ────────────────────────
DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'settled_and_closed', receipt_path = 'w030/receipt.pdf',
           final_spent_amount = 1000.00, updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000010';
    INSERT INTO weak030_results VALUES ('B1  pending_approval → settled_and_closed jump', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('B1  pending_approval → settled_and_closed jump', 'PASS (expected fail)', SQLERRM);
END $$;

-- ── B1b: reopen settled_and_closed → pending_approval ─────────────────────
-- Ticket 11 first walks the LEGAL path to settled (approve → settle direct,
-- receipt + amount set), then tries to reopen.
UPDATE public.expense_tickets
   SET status = 'approved_funds_released',
       approved_by = 'aaaaaaa0-0000-4000-8000-000000000002',
       approved_at = now(), updated_at = now()
 WHERE id = 'aaaaaaa0-0000-4000-8000-000000000011';
UPDATE public.expense_tickets
   SET status = 'settled_and_closed', receipt_path = 'w030/receipt.pdf',
       receipt_uploaded_at = now(), receipt_uploaded_by = 'aaaaaaa0-0000-4000-8000-000000000002',
       settled_by = 'aaaaaaa0-0000-4000-8000-000000000002', settled_at = now(),
       final_spent_amount = 1000.00, updated_at = now()
 WHERE id = 'aaaaaaa0-0000-4000-8000-000000000011';

DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'pending_approval', updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000011';
    INSERT INTO weak030_results VALUES ('B1b reopen settled_and_closed → pending_approval', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('B1b reopen settled_and_closed → pending_approval', 'PASS (expected fail)', SQLERRM);
END $$;

-- ── B1c: rejected → disbursed ─────────────────────────────────────────────
-- Ticket 12 is legally rejected first (with a reason), then jumps.
UPDATE public.expense_tickets
   SET status = 'rejected', rejected_reason = 'w030 fixture rejection', updated_at = now()
 WHERE id = 'aaaaaaa0-0000-4000-8000-000000000012';

DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'disbursed', updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000012';
    INSERT INTO weak030_results VALUES ('B1c rejected → disbursed', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('B1c rejected → disbursed', 'PASS (expected fail)', SQLERRM);
END $$;

-- ── B1d: illegal INSERT — born approved_funds_released ────────────────────
-- (with a legitimate approver + the real category, so ONLY the
-- initial-status rule can reject).
DO $$
DECLARE
    v_category uuid;
BEGIN
    SELECT id INTO v_category FROM public.expense_categories
     WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND code = 'office_supplies';
    INSERT INTO public.expense_tickets (
        id, tenant_id, ticket_number, title, description, category_id,
        requested_amount, justification, urgency, status, submitted_by, approved_by, approved_at
    ) VALUES (
        'aaaaaaa0-0000-4000-8000-000000000020', '00000000-0000-0000-0000-000000000001',
        'EXP-WEAK030-020', 'W030 born-approved', 'fixture', v_category,
        500.00, 'fixture justification', 'low', 'approved_funds_released',
        'aaaaaaa0-0000-4000-8000-000000000001', 'aaaaaaa0-0000-4000-8000-000000000002', now()
    );
    INSERT INTO weak030_results VALUES ('B1d INSERT born approved_funds_released', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('B1d INSERT born approved_funds_released', 'PASS (expected fail)', SQLERRM);
END $$;

-- ── B2: NULL-approver self-approval (the exact 0008 bypass) ───────────────
-- Ticket 13 belongs to the submitter; the transition itself is LEGAL
-- (pending_approval → approved) so ONLY the null-approver rule can fire.
DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'approved_funds_released', updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000013';
    INSERT INTO weak030_results VALUES ('B2  self-approval with NULL approver', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('B2  self-approval with NULL approver', 'PASS (expected fail)', SQLERRM);
END $$;

-- ── B2b: explicit self-approval (approved_by = submitted_by) ──────────────
DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'approved_funds_released',
           approved_by = 'aaaaaaa0-0000-4000-8000-000000000001', updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000013';
    INSERT INTO weak030_results VALUES ('B2b self-approval with approver = submitter', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('B2b self-approval with approver = submitter', 'PASS (expected fail)', SQLERRM);
END $$;

-- ── L1: legal approval with a DIFFERENT approver ──────────────────────────
DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'approved_funds_released',
           approved_by = 'aaaaaaa0-0000-4000-8000-000000000002',
           approved_at = now(), updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000013';
    INSERT INTO weak030_results VALUES ('L1  pending_approval → approved (different approver)', 'PASS', 'legal transition accepted');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('L1  pending_approval → approved (different approver)', 'FAIL', SQLERRM);
END $$;

-- ── L2: legal approved → settled_and_closed (settle_expense path) ─────────
-- Ticket 14 approves, then settles DIRECTLY from approved (no disburse).
DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'approved_funds_released',
           approved_by = 'aaaaaaa0-0000-4000-8000-000000000002',
           approved_at = now(), updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000014';
    UPDATE public.expense_tickets
       SET status = 'settled_and_closed', receipt_path = 'w030/receipt2.pdf',
           receipt_uploaded_at = now(), receipt_uploaded_by = 'aaaaaaa0-0000-4000-8000-000000000002',
           settled_by = 'aaaaaaa0-0000-4000-8000-000000000002', settled_at = now(),
           final_spent_amount = 700.00, updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000014';
    INSERT INTO weak030_results VALUES ('L2  approved → settled_and_closed (settle_expense path)', 'PASS', 'legal transition accepted');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('L2  approved → settled_and_closed (settle_expense path)', 'FAIL', SQLERRM);
END $$;

-- ── L3 + L4: the adapter's disburse → settleProof path ────────────────────
DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'disbursed', disbursed_at = now(), updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000013';
    INSERT INTO weak030_results VALUES ('L3  approved → disbursed', 'PASS', 'legal transition accepted');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('L3  approved → disbursed', 'FAIL', SQLERRM);
END $$;

DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'settled_and_closed', receipt_path = 'w030/receipt.pdf',
           receipt_uploaded_at = now(), receipt_uploaded_by = 'aaaaaaa0-0000-4000-8000-000000000002',
           settled_by = 'aaaaaaa0-0000-4000-8000-000000000002', settled_at = now(),
           final_spent_amount = 990.00, updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000013';
    INSERT INTO weak030_results VALUES ('L4  disbursed → settled_and_closed (settleProof shape)', 'PASS', 'legal transition accepted');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('L4  disbursed → settled_and_closed (settleProof shape)', 'FAIL', SQLERRM);
END $$;

-- ── L5: 0008 invariant kept — rejection without a reason ──────────────────
DO $$
BEGIN
    UPDATE public.expense_tickets
       SET status = 'rejected', rejected_reason = NULL, updated_at = now()
     WHERE id = 'aaaaaaa0-0000-4000-8000-000000000015';
    INSERT INTO weak030_results VALUES ('L5  rejected without a reason (0008 invariant)', 'FAIL', 'should have raised but did not');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO weak030_results VALUES ('L5  rejected without a reason (0008 invariant)', 'PASS (expected fail)', SQLERRM);
END $$;

-- Report.
SELECT scenario, outcome, detail FROM weak030_results ORDER BY scenario;

ROLLBACK;
