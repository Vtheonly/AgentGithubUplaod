-- ============================================================================
-- 0049_dashboard_kpis_fanout_expire_fix.sql
-- ============================================================================
-- Session 8 (2026-08-30) — discovered during the live backend health check.
--
-- Fixes three production defects:
--
--   1. MV FAN-OUT (BUG-NEW-002, Critical): `mv_dashboard_kpis` joins
--      tenants × parents × students × payments and SUMs `payments.amount`
--      over the fanned-out row set. Live evidence: monthly_revenue =
--      21,380,256,900 DZD = true monthly payments (54,962,100) × 389 —
--      exactly the tenant's student count. Every payment row is duplicated
--      once per (parent × student) row. Rewrite: scalar subqueries (same
--      LATERAL pattern the view already used for outstanding_debt).
--
--   2. EXPIRE RPC BROKEN (BUG-NEW-001 / T-083, High): migration 0036's
--      `expire_pending_approvals()` iterates
--      `SELECT DISTINCT tenant_id FROM users WHERE approval_status = 'pending'`
--      — the `users` table does not exist (staff profiles live in
--      `user_profiles`, and approval state lives in
--      `account_approval_requests.status`). The daily cron Edge Function
--      has been failing silently since 0036 shipped. Rewrite: expire stale
--      rows directly from `account_approval_requests` and return the
--      per-tenant counts the EF iterates.
--
--   3. REFRESH CONCURRENTLY IMPOSSIBLE (BUG-NEW-003, High): the
--      `refresh_materialized_view` RPC (migration 0036) runs
--      `REFRESH MATERIALIZED VIEW CONCURRENTLY`, which REQUIRES a unique
--      index on the matview. None of the four MVs has any index (verified
--      live: pg_indexes returns zero rows for all four). Every scheduled
--      refresh has therefore errored. Fix: add unique indexes on natural
--      keys (tenant_id / tenant_id+parent_id / tenant_id+month).
--
-- All statements are idempotent (IF EXISTS guards). No data migration —
-- DDL + one matview refresh at the end.
-- ============================================================================

BEGIN;

-- ─── 1. Fix expire_pending_approvals ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.expire_pending_approvals();

CREATE OR REPLACE FUNCTION public.expire_pending_approvals()
RETURNS TABLE(tenant_id uuid, expired_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Expire every stale approval request past its window, grouped per
    -- tenant. TABLE(tenant_id, expired_count) matches the shape the
    -- expire-pending-approvals Edge Function iterates (0036 contract).
    RETURN QUERY
    WITH expired AS (
        UPDATE public.account_approval_requests a
           SET status = 'expired',
               updated_at = now()
         WHERE a.status = 'pending'
           AND a.expires_at < now()
        RETURNING a.tenant_id
    )
    SELECT e.tenant_id, COUNT(*)::integer AS expired_count
      FROM expired e
     GROUP BY e.tenant_id;
END;
$$;

COMMENT ON FUNCTION public.expire_pending_approvals IS
    'Auto-expires pending account_approval_requests past their window. Returns per-tenant (tenant_id, expired_count) rows for the expire-pending-approvals Edge Function. BUG-NEW-001/T-083: the 0036 version referenced a non-existent "users" table and failed silently on every cron run.';

-- ─── 2. Rebuild mv_dashboard_kpis without the parent×student×payment fan-out ─

DROP MATERIALIZED VIEW IF EXISTS public.mv_dashboard_kpis;

CREATE MATERIALIZED VIEW public.mv_dashboard_kpis AS
SELECT
  t.id AS tenant_id,
  (SELECT COUNT(*)
     FROM public.parents p
    WHERE p.tenant_id = t.id AND p.deleted_at IS NULL) AS total_parents,
  (SELECT COUNT(*)
     FROM public.students s
    WHERE s.tenant_id = t.id AND s.deleted_at IS NULL
      AND s.enrollment_status = 'active') AS total_students,
  (SELECT COALESCE(SUM(pay.amount), 0)
     FROM public.payments pay
    WHERE pay.tenant_id = t.id
      AND pay.status = 'paid'
      AND pay.collected_at >= date_trunc('month', NOW())
      AND pay.collected_at < date_trunc('month', NOW() + INTERVAL '1 month')) AS monthly_revenue,
  (SELECT COALESCE(SUM(pay.amount), 0)
     FROM public.payments pay
    WHERE pay.tenant_id = t.id
      AND pay.status = 'paid'
      AND pay.collected_at >= date_trunc('day', NOW())
      AND pay.collected_at < date_trunc('day', NOW() + INTERVAL '1 day')) AS today_revenue,
  (SELECT COALESCE(SUM(summary.total_outstanding), 0)
     FROM public.parents p2
    CROSS JOIN LATERAL public.compute_parent_summary(p2.id) AS summary
    WHERE p2.tenant_id = t.id AND p2.deleted_at IS NULL) AS outstanding_debt,
  (SELECT COALESCE(SUM(summary.total_overdue), 0)
     FROM public.parents p2
    CROSS JOIN LATERAL public.compute_parent_summary(p2.id) AS summary
    WHERE p2.tenant_id = t.id AND p2.deleted_at IS NULL) AS overdue_debt,
  (SELECT COUNT(DISTINCT p2.id)
     FROM public.parents p2
    CROSS JOIN LATERAL public.compute_parent_summary(p2.id) AS summary
    WHERE p2.tenant_id = t.id AND p2.deleted_at IS NULL
      AND summary.total_overdue > 0) AS overdue_families_count,
  (SELECT COUNT(*)
     FROM public.payments pay
    WHERE pay.tenant_id = t.id
      AND pay.method = 'check' AND pay.status = 'pending') AS pending_checks_count,
  (SELECT COALESCE(SUM(pay.amount), 0)
     FROM public.payments pay
    WHERE pay.tenant_id = t.id
      AND pay.method = 'check' AND pay.status = 'pending') AS pending_checks_amount
FROM public.tenants t;

COMMENT ON MATERIALIZED VIEW public.mv_dashboard_kpis IS
    'One row per tenant. BUG-NEW-002: the 0034/0041/0042 versions SUMmed payments over a tenants×parents×students×payments join — every payment multiplied by the tenant student count (live: 54.96M reported as 21.38B). This version uses scalar subqueries: each aggregate reads its base table exactly once.';

-- ─── 3. Unique indexes so REFRESH ... CONCURRENTLY works ────────────────────
-- The refresh_materialized_view RPC (0036) uses CONCURRENTLY, which fails
-- without a unique index. Zero MV indexes existed live (BUG-NEW-003).

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_dashboard_kpis_tenant
  ON public.mv_dashboard_kpis (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_debt_aging_tenant_parent
  ON public.mv_debt_aging (tenant_id, parent_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_top_debtors_tenant_parent
  ON public.mv_top_debtors (tenant_id, parent_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_revenue_by_month_tenant_month
  ON public.mv_revenue_by_month (tenant_id, month);

-- ─── 4. Populate the corrected KPI matview (plain refresh — the unique
--        index created above only becomes usable by CONCURRENTLY once the
--        view is populated; a plain refresh is safe here because no
--        consumer reads it during the migration transaction).

REFRESH MATERIALIZED VIEW public.mv_dashboard_kpis;

COMMIT;
