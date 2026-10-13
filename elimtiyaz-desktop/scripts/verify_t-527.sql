-- verify_t-527.sql — live verification for T-527 (migration 0155, SEC-118 /
-- the expense-approval actor binding + reviewer gate + the unguarded-RPC
-- hardening).
--
-- Convention (AGENTS.md §11.1 + §15.39): wrapped in BEGIN/ROLLBACK so it can
-- be re-run any time without mutating the live DB (the EXECUTE-mode evidence
-- — the only trustworthy proof for trigger/RLS/RPC gates); results land in a
-- temp table; the guards' rejections are captured through nested
-- BEGIN/EXCEPTION blocks (the raised error is the PASS condition); the whole
-- payload runs in ONE Management-API session (quirk #3).
--
-- Live actors (resolved 2026-10-13, the T-527 phase-3 accounts):
--   ADMIN  auth.users a148fe34-98e3-422a-bf42-91da094e270c
--          (profile 42e369e9-9f88-40a0-8434-ffd3b2c3ba8b, admin@elimtiyaz.dz,
--           role super_admin, tenant 00000000-0000-0000-0000-000000000001)
--   WORKER auth.users 2aeecaa9-2d93-4c0b-957f-162f52cf5bc3
--          (profile 0bd51bf0-b8b4-4324-93b8-1b198bfc887e,
--           adam.cherif@elimtiyaz.dz, role worker — the restricted staff
--           role the mandate §3 describes)
--
-- Seeded inside the transaction (rolled back — zero residue, §15.38): five
-- T527-FAKE-marked expense tickets — Adam's pending ×2, Adam's draft,
-- Adam's pre-approved (transitioned as the JWT-less service session), and
-- the admin's own pending (the ddd class).
--
-- THE MATRIX (the owner's acceptance conditions #7–#10):
--   the WORKER (staff): submit PASS · field-edit PASS · draft→submit PASS ·
--     forged-approver DENY · self-approval DENY · self-reject DENY ·
--     self-disburse DENY · RPC-approve DENY · RPC-settle DENY ·
--     cross-employee UPDATE 0-rows (RLS) · cross-employee SELECT invisible
--     (RLS) · own-proof settle PASS (the T-521 Android flow — deliberately
--     preserved: settle is ordered AFTER approval by the state machine and
--     requires receipt+amount by the 0008 invariants);
--   the ADMIN (reviewer): approve PASS · reject-with-reason PASS ·
--     RPC-approve-as-self PASS · RPC-settle-as-self PASS ·
--     approve-in-another-name DENY (the anti-forgery is UNIVERSAL — even a
--     super_admin cannot record an approval in someone else's name) ·
--     own-ticket self-approval DENY (the 0064 rule preserved);
--   ANON: EXECUTE revoked on both RPCs.
BEGIN;

DROP TABLE IF EXISTS t527_results;
CREATE TEMP TABLE t527_results (check_id text, ok boolean, detail text);
-- §15.27: the DO blocks run SET LOCAL ROLE authenticated — grant the temp
-- results table before the first impersonation.
GRANT INSERT, SELECT ON t527_results TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Seed the T-527 FAKE tickets (as the JWT-less service session — the trigger's
-- caller gates (d)/(e) are caller-scoped and do not fire; clause (a) allows
-- born draft/pending; the pre-approved ticket is transitioned here because
-- INSERT cannot be born approved).
-- ---------------------------------------------------------------------------
SET LOCAL ROLE postgres;
SET LOCAL request.jwt.claims = '';

INSERT INTO public.expense_tickets (id, tenant_id, ticket_number, title, description,
    justification, category_id, requested_amount, urgency, status, submitted_by, payee)
VALUES
  ('77777777-1111-2222-3333-444444444401'::uuid, '00000000-0000-0000-0000-000000000001'::uuid,
   'EXP-2026-T527A', 'T527 verify — Adam pending 1', 'probe', 'probe',
   (SELECT id FROM public.expense_categories WHERE tenant_id = '00000000-0000-0000-0000-000000000001' ORDER BY code LIMIT 1),
   1000, 'medium', 'pending_approval', '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid, 'T-527 probe'),
  ('77777777-1111-2222-3333-444444444402'::uuid, '00000000-0000-0000-0000-000000000001'::uuid,
   'EXP-2026-T527B', 'T527 verify — Adam pending 2', 'probe', 'probe',
   (SELECT id FROM public.expense_categories WHERE tenant_id = '00000000-0000-0000-0000-000000000001' ORDER BY code LIMIT 1),
   2000, 'medium', 'pending_approval', '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid, 'T-527 probe'),
  ('77777777-1111-2222-3333-444444444403'::uuid, '00000000-0000-0000-0000-000000000001'::uuid,
   'EXP-2026-T527C', 'T527 verify — Adam approved (settle fixture)', 'probe', 'probe',
   (SELECT id FROM public.expense_categories WHERE tenant_id = '00000000-0000-0000-0000-000000000001' ORDER BY code LIMIT 1),
   3000, 'medium', 'pending_approval', '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid, 'T-527 probe'),
  ('77777777-1111-2222-3333-444444444404'::uuid, '00000000-0000-0000-0000-000000000001'::uuid,
   'EXP-2026-T527D', 'T527 verify — Adam draft', 'probe', 'probe',
   (SELECT id FROM public.expense_categories WHERE tenant_id = '00000000-0000-0000-0000-000000000001' ORDER BY code LIMIT 1),
   4000, 'low', 'draft', '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid, 'T-527 probe'),
  ('77777777-1111-2222-3333-444444444405'::uuid, '00000000-0000-0000-0000-000000000001'::uuid,
   'EXP-2026-T527E', 'T527 verify — the admin own (the ddd class)', 'probe', 'probe',
   (SELECT id FROM public.expense_categories WHERE tenant_id = '00000000-0000-0000-0000-000000000001' ORDER BY code LIMIT 1),
   5000, 'low', 'pending_approval', '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'::uuid, 'T-527 probe');

-- The settle fixture: pending → approved as the JWT-less session (approved_by
-- = the admin's profile, ≠ the submitter — clause (c) satisfied; the
-- caller-scoped (d)/(e) do not fire without a JWT).
UPDATE public.expense_tickets
   SET status = 'approved_funds_released',
       approved_by = '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'::uuid,
       approved_at = now(),
       approval_note = 'T-527 verify pre-approval'
 WHERE id = '77777777-1111-2222-3333-444444444403'::uuid;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- C-series: the migration artifacts (registration, chain, the guard text,
-- the anon revoke — position() probes, never '' LIKE patterns, quirk #9).
-- ---------------------------------------------------------------------------
INSERT INTO t527_results
SELECT 'C1-registered', COUNT(*) = 1, 'rows=' || COUNT(*)
  FROM supabase_migrations.schema_migrations WHERE version = '0155';
INSERT INTO t527_results
SELECT 'C2-trigger-has-reviewer-gate',
       position('Reviewer-only expense transition' in prosrc) > 0
       AND position('Forged approver' in prosrc) > 0,
       'guard clauses present'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'enforce_expense_workflow_rules';
INSERT INTO t527_results
SELECT 'C3-anon-execute-revoked',
       NOT has_function_privilege('anon', 'public.approve_expense(uuid, uuid, uuid, text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.settle_expense(uuid, uuid, numeric, text, uuid)', 'EXECUTE'),
       'anon: approve=' || has_function_privilege('anon', 'public.approve_expense(uuid, uuid, uuid, text)', 'EXECUTE')
       || ' settle=' || has_function_privilege('anon', 'public.settle_expense(uuid, uuid, numeric, text, uuid)', 'EXECUTE');
INSERT INTO t527_results
SELECT 'C4-rpc-caller-gates',
       position('only super_admin / financial_officer / manager may approve' in prosrc) > 0,
       'approve_expense gate present'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'approve_expense';

-- ---------------------------------------------------------------------------
-- S-series: the WORKER (Adam, role worker) — the staff permission matrix.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_count int;
    v_title text;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "2aeecaa9-2d93-4c0b-957f-162f52cf5bc3", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;

    -- S1: the worker SUBMITS a new ticket (born pending_approval) — the
    --     mandate's acceptance #6, the RLS insert policy's 9-role list.
    BEGIN
        INSERT INTO public.expense_tickets (tenant_id, ticket_number, title, description,
            justification, category_id, requested_amount, urgency, status, submitted_by, payee)
        VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'EXP-2026-T527F',
                'T527 verify — worker submit', 'probe', 'probe',
                (SELECT id FROM public.expense_categories WHERE tenant_id = '00000000-0000-0000-0000-000000000001' ORDER BY code LIMIT 1),
                6000, 'medium', 'pending_approval',
                '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid, 'T-527 probe');
        INSERT INTO t527_results VALUES ('S1-worker-submit', true, 'insert ok');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('S1-worker-submit', false, SQLERRM);
    END;

    -- S2: the FORGED APPROVER — the worker approves their own ticket naming
    --     the ADMIN as approver (the SEC-118 headline bypass, pre-0155 legal).
    --     Either guard denies it: clause (d) fires first for a non-reviewer
    --     (the reviewer gate); clause (e) (Forged approver) is the second
    --     layer for a hypothetical reviewer-class submitter. BOTH messages
    --     prove the bypass is closed.
    BEGIN
        UPDATE public.expense_tickets
           SET status = 'approved_funds_released',
               approved_by = '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'::uuid,
               approved_at = now()
         WHERE id = '77777777-1111-2222-3333-444444444401'::uuid;
        INSERT INTO t527_results VALUES ('S2-forged-approver-DENY', false, 'NO exception — the bypass is OPEN');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('S2-forged-approver-DENY',
            position('Reviewer-only expense transition' in SQLERRM) > 0
            OR position('Forged approver' in SQLERRM) > 0, SQLERRM);
    END;

    -- S3: SELF-APPROVAL (approved_by = self) — the 0064 rule, still first.
    BEGIN
        UPDATE public.expense_tickets
           SET status = 'approved_funds_released',
               approved_by = '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid,
               approved_at = now()
         WHERE id = '77777777-1111-2222-3333-444444444401'::uuid;
        INSERT INTO t527_results VALUES ('S3-self-approval-DENY', false, 'NO exception');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('S3-self-approval-DENY',
            position('Self-approval is forbidden' in SQLERRM) > 0, SQLERRM);
    END;

    -- S4: SELF-REJECTION — the reviewer gate (the mandate: staff cannot
    --     reject, only administrators approve or reject).
    BEGIN
        UPDATE public.expense_tickets
           SET status = 'rejected', rejected_reason = 'worker self-reject probe'
         WHERE id = '77777777-1111-2222-3333-444444444402'::uuid;
        INSERT INTO t527_results VALUES ('S4-self-reject-DENY', false, 'NO exception');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('S4-self-reject-DENY',
            position('Reviewer-only expense transition' in SQLERRM) > 0, SQLERRM);
    END;

    -- S5: SELF-DISBURSE (funds release on the approved fixture) — the
    --     reviewer gate.
    BEGIN
        UPDATE public.expense_tickets
           SET status = 'disbursed', disbursed_at = now()
         WHERE id = '77777777-1111-2222-3333-444444444403'::uuid;
        INSERT INTO t527_results VALUES ('S5-self-disburse-DENY', false, 'NO exception');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('S5-self-disburse-DENY',
            position('Reviewer-only expense transition' in SQLERRM) > 0, SQLERRM);
    END;

    -- S6: the FIELD EDIT on the worker's own pending ticket (no status
    --     change) — the desktop update() contract, preserved.
    UPDATE public.expense_tickets SET title = 'T527 verify — edited title'
     WHERE id = '77777777-1111-2222-3333-444444444401'::uuid;
    SELECT title INTO v_title FROM public.expense_tickets
     WHERE id = '77777777-1111-2222-3333-444444444401'::uuid;
    INSERT INTO t527_results VALUES ('S6-own-field-edit-PASS',
        v_title = 'T527 verify — edited title', 'title=' || v_title);

    -- S7: draft → pending_approval on the worker's OWN draft (the submit
    --     transition — the one transition submitters keep).
    BEGIN
        UPDATE public.expense_tickets SET status = 'pending_approval', submitted_at = now()
         WHERE id = '77777777-1111-2222-3333-444444444404'::uuid;
        INSERT INTO t527_results VALUES ('S7-own-draft-submit-PASS', true, 'transition ok');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('S7-own-draft-submit-PASS', false, SQLERRM);
    END;

    -- S8: the RPC path — the worker calls approve_expense naming the ADMIN
    --     as approver (pre-0155: LEGAL — the RPC's only check was ≠ submitter).
    BEGIN
        PERFORM public.approve_expense(
            '00000000-0000-0000-0000-000000000001'::uuid,
            '77777777-1111-2222-3333-444444444402'::uuid,
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'::uuid,
            'forged probe');
        INSERT INTO t527_results VALUES ('S8-rpc-approve-DENY', false, 'NO exception — the RPC bypass is OPEN');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('S8-rpc-approve-DENY',
            position('only super_admin / financial_officer / manager may approve' in SQLERRM) > 0, SQLERRM);
    END;

    -- S9: the RPC settle path — same gate.
    BEGIN
        PERFORM public.settle_expense(
            '00000000-0000-0000-0000-000000000001'::uuid,
            '77777777-1111-2222-3333-444444444403'::uuid,
            3000, 't527/receipt-probe.pdf',
            '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid);
        INSERT INTO t527_results VALUES ('S9-rpc-settle-DENY', false, 'NO exception');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('S9-rpc-settle-DENY',
            position('only super_admin / financial_officer / manager may settle' in SQLERRM) > 0, SQLERRM);
    END;

    -- S10: the CROSS-EMPLOYEE UPDATE — the worker patches the ADMIN's own
    --      ticket: RLS hides the row (0 rows — never an exception).
    UPDATE public.expense_tickets SET title = 'hijack probe'
     WHERE id = '77777777-1111-2222-3333-444444444405'::uuid;
    INSERT INTO t527_results VALUES ('S10-cross-employee-update-DENY', NOT FOUND,
        'found=' || FOUND::text);

    -- S11: the CROSS-EMPLOYEE READ — the worker sees ONLY their own tickets.
    SELECT COUNT(*) INTO v_count FROM public.expense_tickets
     WHERE id IN ('77777777-1111-2222-3333-444444444401'::uuid,
                  '77777777-1111-2222-3333-444444444402'::uuid,
                  '77777777-1111-2222-3333-444444444403'::uuid,
                  '77777777-1111-2222-3333-444444444404'::uuid,
                  '77777777-1111-2222-3333-444444444405'::uuid);
    INSERT INTO t527_results VALUES ('S11-cross-employee-read-DENY', v_count = 4,
        'visible=' || v_count || '/5 (the admin own ticket must be invisible)');

    -- S12: the SUBMITTER'S OWN-PROOF SETTLE on their APPROVED ticket (the
    --      T-521 Android flow, live-green the same day — deliberately NOT
    --      gated: the state machine orders it after approval and the 0008
    --      invariants require receipt + final amount).
    BEGIN
        UPDATE public.expense_tickets
           SET status = 'settled_and_closed',
               final_spent_amount = 2900,
               receipt_path = 't527/worker-proof.jpg',
               receipt_uploaded_at = now(),
               receipt_uploaded_by = '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid,
               settled_by = '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid,
               settled_at = now()
         WHERE id = '77777777-1111-2222-3333-444444444403'::uuid;
        INSERT INTO t527_results VALUES ('S12-own-proof-settle-PASS', FOUND, 'found=' || FOUND::text);
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('S12-own-proof-settle-PASS', false, SQLERRM);
    END;

    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- A-series: the ADMIN (super_admin, the reviewer) — the approval authority.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_audit uuid;
    v_status text;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "a148fe34-98e3-422a-bf42-91da094e270c", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;

    -- A1: the reviewer APPROVES the worker's ticket naming THEMSELVES —
    --     the canonical desktop path (approve() sets approved_by = the
    --     signed-in reviewer).
    BEGIN
        UPDATE public.expense_tickets
           SET status = 'approved_funds_released',
               approved_by = '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'::uuid,
               approved_at = now(), approval_note = 'T-527 verify approve'
         WHERE id = '77777777-1111-2222-3333-444444444401'::uuid;
        INSERT INTO t527_results VALUES ('A1-reviewer-approve-PASS', FOUND, 'found=' || FOUND::text);
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('A1-reviewer-approve-PASS', false, SQLERRM);
    END;

    -- A2: the reviewer REJECTS with the mandatory reason (the mandate's §4:
    --     the rejection reason is recorded and visible to the submitter).
    BEGIN
        UPDATE public.expense_tickets
           SET status = 'rejected', rejected_reason = 'T-527 verify — motif insuffisant'
         WHERE id = '77777777-1111-2222-3333-444444444402'::uuid;
        INSERT INTO t527_results VALUES ('A2-reviewer-reject-PASS', FOUND, 'found=' || FOUND::text);
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('A2-reviewer-reject-PASS', false, SQLERRM);
    END;

    -- A3: the UNIVERSAL ANTI-FORGERY — even the SUPER_ADMIN cannot record
    --     an approval in ANOTHER profile's name. The forged approver is a
    --     THIRD PARTY (another worker, ≠ submitter, ≠ acting user) so the
    --     (e) anti-forgery clause is the one exercised (naming the SUBMITTER
    --     would be the 0064 self-approval class instead — both denied).
    BEGIN
        UPDATE public.expense_tickets
           SET status = 'approved_funds_released',
               approved_by = '5c8f4267-24e4-44d5-8b66-011d698b957b'::uuid,
               approved_at = now()
         WHERE id = '77777777-1111-2222-3333-444444444404'::uuid;
        INSERT INTO t527_results VALUES ('A3-admin-forging-worker-DENY', false, 'NO exception');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('A3-admin-forging-worker-DENY',
            position('Forged approver' in SQLERRM) > 0, SQLERRM);
    END;

    -- A4: the RPC path as the reviewer naming THEMSELVES — the hardened
    --     approve_expense works for its legitimate caller.
    BEGIN
        v_audit := public.approve_expense(
            '00000000-0000-0000-0000-000000000001'::uuid,
            '77777777-1111-2222-3333-444444444404'::uuid,
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'::uuid,
            'T-527 verify rpc approve');
        SELECT status INTO v_status FROM public.expense_tickets
         WHERE id = '77777777-1111-2222-3333-444444444404'::uuid;
        INSERT INTO t527_results VALUES ('A4-rpc-approve-as-self-PASS',
            v_status = 'approved_funds_released' AND v_audit IS NOT NULL,
            'status=' || v_status);
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('A4-rpc-approve-as-self-PASS', false, SQLERRM);
    END;

    -- A5: the RPC actor binding — the admin names the WORKER as approver.
    BEGIN
        PERFORM public.approve_expense(
            '00000000-0000-0000-0000-000000000001'::uuid,
            '77777777-1111-2222-3333-444444444402'::uuid,
            '0bd51bf0-b8b4-4324-93b8-1b198bfc887e'::uuid,
            'forged rpc probe');
        INSERT INTO t527_results VALUES ('A5-rpc-forged-actor-DENY', false, 'NO exception');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('A5-rpc-forged-actor-DENY',
            position('actor binding' in SQLERRM) > 0, SQLERRM);
    END;

    -- A6: the RPC settle as the reviewer naming THEMSELVES.
    BEGIN
        v_audit := public.settle_expense(
            '00000000-0000-0000-0000-000000000001'::uuid,
            '77777777-1111-2222-3333-444444444404'::uuid,
            4000, 't527/admin-proof.pdf',
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'::uuid);
        SELECT status INTO v_status FROM public.expense_tickets
         WHERE id = '77777777-1111-2222-3333-444444444404'::uuid;
        INSERT INTO t527_results VALUES ('A6-rpc-settle-as-self-PASS',
            v_status = 'settled_and_closed' AND v_audit IS NOT NULL,
            'status=' || v_status);
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('A6-rpc-settle-as-self-PASS', false, SQLERRM);
    END;

    -- A7: the ddd class PRESERVED — the admin's OWN ticket cannot be
    --     self-approved (the 0064 rule, still first for everyone).
    BEGIN
        UPDATE public.expense_tickets
           SET status = 'approved_funds_released',
               approved_by = '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'::uuid,
               approved_at = now()
         WHERE id = '77777777-1111-2222-3333-444444444405'::uuid;
        INSERT INTO t527_results VALUES ('A7-admin-self-approval-DENY', false, 'NO exception');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('A7-admin-self-approval-DENY',
            position('Self-approval is forbidden' in SQLERRM) > 0, SQLERRM);
    END;

    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- N-series: ANON — the EXECUTE revoke, exercised (not just declared).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    SET LOCAL ROLE anon;
    BEGIN
        PERFORM public.approve_expense(
            '00000000-0000-0000-0000-000000000001'::uuid,
            '77777777-1111-2222-3333-444444444401'::uuid,
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'::uuid,
            'anon probe');
        INSERT INTO t527_results VALUES ('N1-anon-rpc-DENY', false, 'NO exception — anon can still execute');
    EXCEPTION WHEN others THEN
        INSERT INTO t527_results VALUES ('N1-anon-rpc-DENY',
            position('permission denied' in lower(SQLERRM)) > 0, SQLERRM);
    END;
    RESET ROLE;
END;
$$;

-- ---------------------------------------------------------------------------
-- The verdict + the details in ONE result (the Management-API endpoint
-- surfaces ONLY the last statement's result set — quirk #4; a single
-- jsonb payload carries both the per-check evidence and the summary).
-- ---------------------------------------------------------------------------
SELECT jsonb_build_object(
    'checks', jsonb_agg(jsonb_build_object('id', check_id, 'ok', ok, 'detail', detail)
                        ORDER BY check_id),
    'green', COUNT(*) FILTER (WHERE ok),
    'total', COUNT(*),
    'verdict', CASE WHEN COUNT(*) FILTER (WHERE ok) = COUNT(*)
                    THEN 'T-527 VERIFY: ALL ' || COUNT(*) || ' CHECKS GREEN'
                    ELSE 'T-527 VERIFY: ' || COUNT(*) FILTER (WHERE ok) || '/' || COUNT(*) || ' — RED CHECKS PRESENT'
               END
       ) AS result
  FROM t527_results;

ROLLBACK;
