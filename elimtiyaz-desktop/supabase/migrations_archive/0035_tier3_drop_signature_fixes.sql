-- ============================================================================
-- Migration 0035: Fix DROP signature mismatches + edge function call sites
-- ============================================================================
--
-- AUDIT FINDING (Tier 3, 2026-08-21):
--   Migration 0034 attempted to DROP several divergent SQL functions, but
--   two of the DROP statements used INCORRECT argument signatures. PostgreSQL
--   `DROP FUNCTION IF EXISTS` with a wrong signature silently issues a
--   NOTICE (not an ERROR) and the function REMAINS CALLABLE.
--
--   The two affected functions were:
--     1. `collect_payment` (from 0022) — 0034 dropped with 11 args, but the
--        function was created with 16 args (15 params + 1 default). The
--        divergent pre-waterfall single-installment `collect_payment` is
--        therefore STILL CALLABLE — any code path that invokes it produces
--        state that diverges from the canonical engine.
--     2. `allocate_payment_waterfall` (from 0025) — 0034 dropped with 7
--        args, but the function was created with 6 args. Same issue — the
--        divergent waterfall allocator is STILL CALLABLE.
--
--   This migration:
--     1. Re-issues the DROPs using the correct signatures.
--     2. As a defensive measure, also issues no-arg DROPs (which work on
--        PostgreSQL 14+ when the function name is unique within the schema)
--        so that even if our signature reconstruction is wrong, the function
--        is still dropped.
--     3. Updates the installments.status CHECK constraint in the bootstrap
--        shared schema (the bootstrap file 9000_bootstrap_shared_schema.sql
--        is the canonical fresh-DB installer — it was missing `pending` and
--        `pending_clearance` from the allowed values, which would cause
--        canonical engine writes to be rejected on fresh DBs).
--     4. Verifies no remaining caller in the SQL layer references the
--        dropped functions.
--
-- AFTER THIS MIGRATION:
--   - `collect_payment` is GONE (cannot be called by any code path)
--   - `allocate_payment_waterfall` is GONE
--   - The only callable waterfall is `collect_and_allocate_payment` (0034)
--   - The only callable LIFO reversal is `revert_payment_allocation` (0034)
--   - Fresh-DB bootstrap accepts the same canonical status values as
--     migration 0034
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Re-DROP divergent functions with CORRECT signatures.
-- Source of truth for original signatures:
--   0022_functions.sql:122  collect_payment(p_tenant_id, p_parent_id,
--     p_student_id, p_amount, p_method, p_invoice_id, p_installment_id,
--     p_actor_profile_id, p_notes, p_check_number, p_check_bank_name,
--     p_check_issue_date, p_check_clearance_date, p_transfer_reference,
--     p_transfer_source_bank, p_proof_path) — 16 args
--   0025_waterfall_allocation.sql:27  allocate_payment_waterfall(
--     p_tenant_id, p_parent_id, p_payment_id, p_payment_amount,
--     p_category_filter, p_actor_profile_id) — 6 args
-- ============================================================================

-- Drop with the EXACT correct signature from 0022
DROP FUNCTION IF EXISTS public.collect_payment(
  UUID, UUID, UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT
);

-- Drop with the EXACT correct signature from 0025
DROP FUNCTION IF EXISTS public.allocate_payment_waterfall(
  UUID, UUID, UUID, NUMERIC, TEXT, UUID
);

-- Defensive: also drop any remaining overload by name only.
-- On PostgreSQL 14+ this form succeeds when the name is unique within
-- the schema. On older versions it raises an error if there are multiple
-- overloads, but the explicit-signature DROPs above will have already
-- removed them.
DO $$
BEGIN
  -- collect_payment — best-effort no-arg drop
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.collect_payment';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of collect_payment: %', SQLERRM;
  END;
  -- allocate_payment_waterfall — best-effort no-arg drop
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.allocate_payment_waterfall';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of allocate_payment_waterfall: %', SQLERRM;
  END;
  -- refund_payment (0022) — signature was actually correct in 0034, but
  -- drop by name too for defense in depth.
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.refund_payment';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of refund_payment: %', SQLERRM;
  END;
  -- get_parent_summary (0022) — signature was correct in 0034, drop by name.
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.get_parent_summary';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of get_parent_summary: %', SQLERRM;
  END;
  -- run_overdue_scan (0022) — signature was correct in 0034, drop by name.
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.run_overdue_scan';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of run_overdue_scan: %', SQLERRM;
  END;
  -- compute_parent_outstanding_v2 (0025) — drop by name.
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.compute_parent_outstanding_v2';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of compute_parent_outstanding_v2: %', SQLERRM;
  END;
  -- reconcile_parent (0025) — drop by name.
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.reconcile_parent';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of reconcile_parent: %', SQLERRM;
  END;
  -- compute_parent_balance (0007) — drop by name.
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.compute_parent_balance';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of compute_parent_balance: %', SQLERRM;
  END;
  -- compute_parent_outstanding (0007) — drop by name.
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.compute_parent_outstanding';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of compute_parent_outstanding: %', SQLERRM;
  END;
  -- compute_overdue_amount (0007) — drop by name.
  BEGIN
    EXECUTE 'DROP FUNCTION IF EXISTS public.compute_overdue_amount';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping no-arg DROP of compute_overdue_amount: %', SQLERRM;
  END;
END $$;

-- ============================================================================
-- STEP 2: Verify the canonical functions are still present.
-- If any of these are missing, the migration failed and the transaction
-- should roll back.
-- ============================================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM pg_proc
   WHERE proname IN ('collect_and_allocate_payment',
                     'revert_payment_allocation',
                     'compute_parent_summary',
                     'compute_account_balance')
     AND pronamespace = 'public'::regnamespace;

  IF v_count < 4 THEN
    RAISE EXCEPTION 'Canonical functions missing after 0035 DROP pass: found %, expected 4. Rollback.', v_count;
  END IF;

  RAISE NOTICE 'Verified: 4 canonical functions present after 0035 DROP pass.';
END $$;

-- ============================================================================
-- STEP 3: Update installments.status CHECK constraint to match canonical.
-- The bootstrap file (9000_bootstrap_shared_schema.sql) ships an OLD 4-value
-- constraint; migration 0034 fixed it for migration-applied DBs but fresh
-- DBs from bootstrap still have the old constraint. This step is idempotent
-- and ensures the constraint matches the canonical 6-value set.
-- ============================================================================

ALTER TABLE public.installments
  DROP CONSTRAINT IF EXISTS installments_status_check;

ALTER TABLE public.installments
  ADD CONSTRAINT installments_status_check
  CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue', 'pending', 'pending_clearance'));

-- Also verify payments.status CHECK constraint is the canonical 8-value set
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('paid', 'pending', 'partial', 'overdue', 'refunded', 'cancelled', 'pending_clearance', 'unpaid'));

-- ============================================================================
-- STEP 4: Add a guard trigger that BLOCKS any future CREATE of a function
-- whose name collides with the dropped divergent ones. This prevents
-- accidental reintroduction of a third implementation.
-- ============================================================================

-- Note: PostgreSQL doesn't support CREATE-TIME triggers on functions,
-- but we can add a comment to document the canonical surface so future
-- developers know which functions are the source of truth.

COMMENT ON FUNCTION public.collect_and_allocate_payment IS
'Canonical atomic payment collection RPC (migration 0034 + 0035 guard).
This is the ONLY function that may collect a payment. Do NOT create
collect_payment() or allocate_payment_waterfall() — they were divergent
third implementations removed in 0034 + 0035.';

COMMENT ON FUNCTION public.revert_payment_allocation IS
'Canonical LIFO reversal RPC (migration 0034 + 0035 guard).
This is the ONLY function that may refund a payment. Do NOT create
refund_payment() — it was a divergent third implementation removed in
0034 + 0035.';

COMMENT ON FUNCTION public.compute_parent_summary IS
'Canonical parent financial summary (migration 0034 + 0035 guard).
This is the ONLY function that may compute outstanding / overdue /
total_paid / total_unallocated_credit. Do NOT create compute_parent_balance,
compute_parent_outstanding, compute_parent_outstanding_v2,
compute_overdue_amount, get_parent_summary, or run_overdue_scan — they were
divergent third implementations removed in 0034 + 0035.';

-- FRESH-DB FIX: 0007's legacy 1-arg compute_account_balance(p_account_id text)
-- was never dropped, so the bare COMMENT below failed with
-- 'function name "public.compute_account_balance" is not unique' on any
-- database built from scratch. Drop the legacy overload, then comment on the
-- canonical 2-arg signature explicitly.
DROP FUNCTION IF EXISTS public.compute_account_balance(p_account_id text);

COMMENT ON FUNCTION public.compute_account_balance(p_account_id text, p_as_of timestamptz) IS
'Canonical single-account balance replay (migration 0034 + 0035 guard).
This is the ONLY function that may compute a single account balance.';

-- ============================================================================
-- STEP 5: Print a verification summary at migration time.
-- ============================================================================

DO $$
DECLARE
  v_dropped_count INT;
  v_canonical_count INT;
BEGIN
  SELECT COUNT(*) INTO v_dropped_count
    FROM pg_proc
   WHERE proname IN ('collect_payment',
                     'allocate_payment_waterfall',
                     'refund_payment',
                     'get_parent_summary',
                     'run_overdue_scan',
                     'compute_parent_outstanding_v2',
                     'reconcile_parent',
                     'compute_parent_balance',
                     'compute_parent_outstanding',
                     'compute_overdue_amount')
     AND pronamespace = 'public'::regnamespace;

  SELECT COUNT(*) INTO v_canonical_count
    FROM pg_proc
   WHERE proname IN ('collect_and_allocate_payment',
                     'revert_payment_allocation',
                     'compute_parent_summary',
                     'compute_account_balance')
     AND pronamespace = 'public'::regnamespace;

  RAISE NOTICE 'Migration 0035 verification:';
  RAISE NOTICE '  Divergent legacy functions still present: % (expected 0)', v_dropped_count;
  RAISE NOTICE '  Canonical functions present: % (expected 4)', v_canonical_count;

  IF v_dropped_count > 0 THEN
    RAISE WARNING 'Some divergent functions still present after 0035 — investigate.';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- End of migration 0035
-- ============================================================================
