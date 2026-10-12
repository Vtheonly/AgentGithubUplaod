-- ============================================================================
-- 0151_read_rpc_statement_timeout_headroom.sql — T-504 (PERF-510, the
-- 2026-10-12 boot-storm RECURRENCE): function-level statement-timeout
-- headroom for the staff-gated financial READ RPC family.
-- ============================================================================
-- WHAT THIS ADDS (and nothing else — pure function metadata, ZERO body
-- changes, zero business-logic drift by construction):
--
--   ALTER FUNCTION … SET statement_timeout = '30s' on the six SECURITY
--   DEFINER read functions the desktop's boot volley hammers:
--     1. public.read_payments_collection()            (0123)
--     2. public.read_installments_collection()        (0123)
--     3. public.read_ledger_entries_collection()      (0123)
--     4. public.read_debt_summary_collection()        (0123)
--     5. public.compute_debt_aging_summary(timestamptz) (0111/0125/0133)
--     6. public.compute_debt_aging_rows(uuid, timestamptz) (0111/0126/0127)
--
-- WHY (the recurrence evidence — the owner's 2026-10-12 04:39:51 UTC
-- console log, the PERF-510 entry): with 0126 live since 2026-09-28 (the
-- aging summary measured ~100 ms under impersonation, verify_t-432.sql
-- 15/15; the T-433 boot-path health probe ALL 200s), ONE degraded boot
-- round still returned 500s on THREE DISTINCT collection RPCs within the
-- same second, with compute_debt_aging_summary killed by
--   "canceling statement due to statement timeout"   (SQLSTATE 57014)
-- — the statement was RUNNING (not queued) and crossed the invoker-role
-- statement timeout. This is the compute-size-bound case the T-432
-- closeout registered as the conditional follow-up ("the free-tier CPU
-- credit exhaustion class"); the 0123 family exists to be the IMMUNE read
-- path (SECURITY DEFINER, no per-row RLS chain, no 1,000-row cap) — but a
-- SECURITY DEFINER function still runs under the INVOKER role's
-- statement_timeout. The immune path was never given timeout headroom.
--
-- WHY 30s (not 0): the ceiling stays BOUNDED — these are full scans of
-- tenant tables (a few thousand rows live) whose healthy runtime is
-- milliseconds (post-0126); 30s only matters when the compute is degraded
-- (the exact class this guards), where finishing in 5–15 s is strictly
-- better for the staff user than dying at ~3 s and blanking the surface
-- (the desktop's honest-degradation then requires a manual refresh).
-- Unlimited (0) would remove the runaway-statement backstop entirely.
--
-- WHY NOT a role-level change: `ALTER ROLE authenticated SET …` would
-- touch EVERY query of every client (the portal included) and fights the
-- platform's own role settings — the function-level SET applies ONLY
-- during these six gated reads and is invisible to everything else.
--
-- The client half of T-504 (the same session): the SHARED CONCURRENCY GATE
-- (the registered PERF-510 lever — the boot volley of distinct collection
-- reads now drains bounded instead of stampeding the pool) + the retry
-- ladder adoption on the three un-retried read paths. The COMPUTE UPGRADE
-- remains the owner-gated structural lever (money decision, unchanged —
-- see the PERF-510 entry).
--
-- GATES: none weakened — EXECUTE grants are untouched (staff-gated
-- has_any_role + tenant-scoped current_tenant_id() inside every body);
-- this migration only pins per-function GUC metadata (pg_proc.proconfig).
--
-- Registration: the T-091/MIG-TOKENS embedded block (atomic with the DDL
-- for the Management-API live application; idempotent via ON CONFLICT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The 0123 collection family (the four full-collection jsonb reads).
-- ----------------------------------------------------------------------------
alter function public.read_payments_collection() set statement_timeout = '30s';
alter function public.read_installments_collection() set statement_timeout = '30s';
alter function public.read_ledger_entries_collection() set statement_timeout = '30s';
alter function public.read_debt_summary_collection() set statement_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 2. The 0111 aging family (the summary RPC the desktop's seedAging calls +
--    the ungated rows computation the matview refresh consumes).
-- ----------------------------------------------------------------------------
alter function public.compute_debt_aging_summary(p_as_of timestamptz) set statement_timeout = '30s';
alter function public.compute_debt_aging_rows(p_tenant_id uuid, p_as_of timestamptz) set statement_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 3. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0151', '{0151_read_rpc_statement_timeout_headroom.sql}', 'read_rpc_statement_timeout_headroom')
on conflict (version) do nothing;
