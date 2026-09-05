-- T-175 live verification (28th session, 2026-09-05) — calendar_events port
-- readiness. Read-only, wrapped in BEGIN/ROLLBACK so it can be re-run any
-- time without mutating the live DB.
--
-- Checks:
--   C1. Chain holds 67 rows (0001–0070) with the 0070 registration row.
--   C2. The three 0070 columns exist on calendar_events with the right
--       types/defaults (priority text default 'medium', assigned_to ids).
--   C3. The priority CHECK enum is the alert-priority union (mock parity).
--   C4. RLS is enabled on calendar_events (writes stay tenant-scoped).
--   C5. Pre-0070 rows (if any) backfill to priority 'medium'.

BEGIN;

CREATE TEMP TABLE t175_results (
  check_id text,
  ok boolean,
  detail text
);

-- C1: chain + registration
INSERT INTO t175_results
SELECT 'C1', count(*) = 67,
       'registered=' || count(*)::text || ' has_0070=' || (count(*) FILTER (WHERE version = '0070') = 1)::text
  FROM supabase_migrations.schema_migrations;

-- C2: the 0070 columns
INSERT INTO t175_results
SELECT 'C2',
       count(*) = 3
       AND count(*) FILTER (WHERE column_name = 'priority' AND data_type = 'text' AND column_default LIKE '''medium''%') = 1
       AND count(*) FILTER (WHERE column_name = 'assigned_to_user_id' AND data_type = 'uuid') = 1
       AND count(*) FILTER (WHERE column_name = 'assigned_to_role' AND data_type = 'text') = 1,
       'cols=' || string_agg(column_name || ':' || data_type, ', ')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'calendar_events'
   AND column_name IN ('priority', 'assigned_to_user_id', 'assigned_to_role');

-- C3: the priority CHECK enum
INSERT INTO t175_results
SELECT 'C3', pg_get_constraintdef(oid) ILIKE '%low%medium%high%urgent%',
       pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.calendar_events'::regclass
   AND contype = 'c'
   AND pg_get_constraintdef(oid) ILIKE '%priority%';

-- C4: RLS enabled
INSERT INTO t175_results
SELECT 'C4', relrowsecurity, 'rls_enabled=' || relrowsecurity::text
  FROM pg_class
 WHERE oid = 'public.calendar_events'::regclass;

-- C5: pre-existing rows default to 'medium' (0 rows expected today — the
-- live table has never been written to; the check is future-proof).
INSERT INTO t175_results
SELECT 'C5', count(*) FILTER (WHERE priority IS NULL) = 0,
       'rows=' || count(*)::text
  FROM public.calendar_events;

SELECT check_id, ok, detail FROM t175_results ORDER BY check_id;

ROLLBACK;
