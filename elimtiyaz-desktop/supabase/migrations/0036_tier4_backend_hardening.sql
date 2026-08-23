-- ============================================================================
-- Migration 0036 — Tier 4 Backend Hardening (Cross-Platform Unification)
-- ============================================================================
-- Date: 2026-08-22
-- Author: Tier 4 cross-platform verification
--
-- This migration closes the 6 hidden competing business rules found by the
-- Tier 4 backend audit (`BACKEND-AUDIT-T4`). It is the FINAL backend
-- consolidation step: after 0036, the only callable financial SQL functions
-- are the 4 canonical ones defined in 0034 + 0035.
--
-- Findings closed by this migration:
--   1. DROP the legacy `compute_account_balance(text)` 1-arg overload from
--      migration 0007. The canonical version (2-arg, body rewritten in 0034)
--      is the only callable one.
--   2. Document `payments.excess_amount` (added in 0033) as a UI-display-only
--      column. The canonical overpayment tracking is via `parent_credit`
--      ledger entries (INV-7).
--   3. Add a guard COMMENT to `batch_register_family` warning that it uses
--      `gen_random_bytes(3)` for parent_code — the canonical rule (spec §7.1)
--      mandates the deterministic FNV-1a hash via the application layer.
--      Both apps now use the deterministic generator; this RPC remains as a
--      backend fallback only.
--   4. Add a guard COMMENT to `generate_activation_code` warning that it uses
--      `random()` — same reason as above. Both apps now use the deterministic
--      `deterministicActivationCode(parentCode, tenantId)`.
--   5. Fix the `expire_pending_approvals()` SQL function to return
--      `TABLE(tenant_id uuid, expired_count integer)` so the edge function
--      `expire-pending-approvals/index.ts` can iterate the result.
--   6. Add the missing `refresh_materialized_view(p_name text)` RPC so the
--      edge function `refresh-materialized-views/index.ts`'s per-view
--      fallback works.
--
-- No data migrations are performed — only DDL + COMMENTs.
-- All changes are reversible by dropping the added objects.
-- ============================================================================

BEGIN;

-- ─── 1. DROP the legacy 1-arg `compute_account_balance(text)` overload ────
-- Migration 0007 created this function with a single `account_id` argument
-- and a naive SUM(amount) body. Migration 0034's CREATE OR REPLACE tried to
-- replace it, but used a 2-arg signature (entries + account_id), which created
-- an OVERLOAD instead of replacing the original.
--
-- After 0034, the legacy 1-arg overload remained callable. Any caller using
-- `SELECT compute_account_balance('parent:par-1:category:tuition')` would
-- get the legacy naive SUM result, which doesn't apply the canonical INV-2
-- (typed totals exclude reversed originals) or INV-3 (parent_credit
-- separate bucket) rules.
--
-- This DROP removes the 1-arg overload. After 0036, only the 2-arg canonical
-- version is callable.
DROP FUNCTION IF EXISTS public.compute_account_balance(text);

-- Verify only the 2-arg canonical version remains
DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM pg_proc
    WHERE proname = 'compute_account_balance'
      AND pronamespace = 'public'::regnamespace;

    IF v_count <> 1 THEN
        RAISE EXCEPTION 'compute_account_balance should have exactly 1 overload after 0036 (the 2-arg canonical), but found %', v_count;
    END IF;
END $$;

-- ─── 2. COMMENT on payments.excess_amount ───────────────────────────────────
-- The `excess_amount` column was added in 0033 (`payment_allocations`).
-- It is populated by the application layer for UI display purposes
-- (showing "Excédent (crédit parent)" in the AdaptivePaymentSlider). The
-- canonical overpayment tracking is via `parent_credit` ledger adjustment
-- entries (INV-7). The column is NOT a source of truth for financial
-- calculations — any caller reading it for balance computation is a bug.
COMMENT ON COLUMN public.payments.excess_amount IS
    'UI-display-only field. Populated by the application layer for the overpayment breakdown display. NOT a source of truth for financial calculations — canonical overpayment tracking is via `parent_credit` ledger adjustment entries (INV-7). Reading this column for balance computation is a bug.';

-- ─── 3. COMMENT on batch_register_family ────────────────────────────────────
-- Migration 0022 created this function with `gen_random_bytes(3)` for
-- parent_code. The canonical spec §7.1 mandates a deterministic FNV-1a hash
-- (via the application layer). Both apps now use the deterministic generator
-- (`deterministicParentCode(year, identityFields)`). This RPC remains as a
-- backend fallback only and should not be called by new code paths.
COMMENT ON FUNCTION public.batch_register_family IS
    'BACKEND FALLBACK ONLY. Uses gen_random_bytes(3) for parent_code — non-deterministic. The canonical rule (spec §7.1) mandates a deterministic FNV-1a hash via the application layer. Both apps now use deterministicParentCode(year, identityFields). New code paths must NOT call this RPC.';

-- ─── 4. COMMENT on generate_activation_code ─────────────────────────────────
COMMENT ON FUNCTION public.generate_activation_code IS
    'BACKEND FALLBACK ONLY. Uses random() for activation code — non-deterministic. The canonical rule (spec §7.1) mandates a deterministic FNV-1a hash via the application layer. Both apps now use deterministicActivationCode(parentCode, tenantId). New code paths must NOT call this RPC.';

-- ─── 5. Fix expire_pending_approvals() to return TABLE ────────────────────────
-- Migration 0028 created this as a scalar `integer` function. The edge
-- function `expire-pending-approvals/index.ts:72` iterates the result as
-- `for (const row of data)`. With a scalar return, the call would throw
-- `TypeError: rows is not iterable`.
--
-- This DROP + CREATE changes the return type to TABLE(tenant_id, expired_count).
-- The edge function can now iterate the per-tenant results.

DROP FUNCTION IF EXISTS public.expire_pending_approvals();

CREATE OR REPLACE FUNCTION public.expire_pending_approvals()
RETURNS TABLE(tenant_id uuid, expired_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant uuid;
    v_expired integer;
    v_total_expired integer := 0;
BEGIN
    FOR v_tenant IN SELECT DISTINCT tenant_id FROM users WHERE approval_status = 'pending' LOOP
        UPDATE users
        SET approval_status = 'expired',
            updated_at = now()
        WHERE tenant_id = v_tenant
          AND approval_status = 'pending'
          AND created_at < now() - INTERVAL '30 days';
        GET DIAGNOSTICS v_expired = ROW_COUNT;
        v_total_expired := v_total_expired + v_expired;
        -- Emit one row per tenant
        RETURN QUERY SELECT v_tenant, v_expired;
    END LOOP;
END;
$$ SET search_path = public;

COMMENT ON FUNCTION public.expire_pending_approvals() IS
    'Iterates all tenants with pending approvals, expires any older than 30 days. Returns one row per tenant with the expired count. Called by the scheduled expire-pending-approvals Edge Function.';

-- ─── 6. Add refresh_materialized_view(p_name) RPC ───────────────────────────
-- The edge function `refresh-materialized-views/index.ts:89` calls this RPC
-- as a per-view fallback when `refresh_all_materialized_views()` fails. The
-- RPC didn't exist before — the edge function would have failed at runtime
-- with `Could not find the function refresh_materialized_view`.

CREATE OR REPLACE FUNCTION public.refresh_materialized_view(p_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Refresh a single materialized view by name. Returns TRUE on success.
    -- The view name must be one of the canonical views defined in 0021 +
    -- 0034 (mv_dashboard_kpis, mv_debt_aging, mv_top_debtors, mv_revenue_by_month).
    -- Other names raise an exception to prevent arbitrary view refreshes.
    IF p_name NOT IN ('mv_dashboard_kpis', 'mv_debt_aging', 'mv_top_debtors', 'mv_revenue_by_month') THEN
        RAISE EXCEPTION 'Cannot refresh unknown materialized view: %', p_name;
    END IF;
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', p_name);
    RETURN TRUE;
END;
$$ SET search_path = public;

COMMENT ON FUNCTION public.refresh_materialized_view(text) IS
    'Refresh a single canonical materialized view by name. Allowed names: mv_dashboard_kpis, mv_debt_aging, mv_top_debtors, mv_revenue_by_month. Used by the refresh-materialized-views Edge Function per-view fallback.';

-- ─── Verification summary ───────────────────────────────────────────────────
DO $$
DECLARE
    v_canonical_count integer;
    v_legacy_count integer;
BEGIN
    -- Count the 4 canonical functions
    SELECT COUNT(*) INTO v_canonical_count
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'collect_and_allocate_payment',
        'revert_payment_allocation',
        'compute_parent_summary',
        'compute_account_balance'
      );

    -- Count the legacy divergent functions (should all be 0)
    SELECT COUNT(*) INTO v_legacy_count
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'collect_payment',
        'allocate_payment_waterfall',
        'refund_payment',
        'get_parent_summary',
        'run_overdue_scan',
        'compute_parent_outstanding_v2',
        'reconcile_parent',
        'compute_parent_balance',
        'compute_parent_outstanding',
        'compute_overdue_amount'
      );

    RAISE NOTICE 'Tier 4 Backend Audit (post-migration 0036):';
    RAISE NOTICE '  Canonical functions present: % (expected 4)', v_canonical_count;
    RAISE NOTICE '  Legacy divergent functions: % (expected 0)', v_legacy_count;

    IF v_canonical_count <> 4 THEN
        RAISE EXCEPTION 'Canonical function count is % — expected exactly 4 after migration 0036.', v_canonical_count;
    END IF;

    IF v_legacy_count <> 0 THEN
        RAISE EXCEPTION 'Legacy divergent function count is % — expected 0 after migration 0036.', v_legacy_count;
    END IF;
END $$;

COMMIT;
