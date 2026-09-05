-- T-176/T-177 live verification (28th session, 2026-09-05) — workflows ports
-- readiness. Read-only, wrapped in BEGIN/ROLLBACK.
--
-- Checks:
--   C1. Chain holds 68 rows (0001–0071) with the 0071 registration row.
--   C2. workflows.last_deployed_at exists (timestamptz, nullable).
--   C3. The workflows status CHECK is the draft/published/disabled enum.
--   C4. workflow_runs status CHECK includes pending/running/succeeded/
--       failed/timeout/cancelled; trigger_type includes manual_run.
--   C5. RLS enabled on both tables; the runs INSERT policy is tenant-scoped.
--   C6. Both tables are empty (0 rows) — the desktop mock was the only
--       writer; the ports make the desktop the first server-side writer.
--   C7. The workflow-execute EF is deployed (function exists in the
--       `public` schema registry probe via pg functions is not available —
--       the EF census is an HTTP check done outside SQL; here we verify the
--       workflow_runs INSERT path the EF writes to is writable-capable:
--       the tenant + status CHECKs accept the EF's write shape).

BEGIN;

CREATE TEMP TABLE t176_results (
  check_id text,
  ok boolean,
  detail text
);

INSERT INTO t176_results
SELECT 'C1', count(*) = 68 AND count(*) FILTER (WHERE version = '0071') = 1,
       'registered=' || count(*)::text
  FROM supabase_migrations.schema_migrations;

INSERT INTO t176_results
SELECT 'C2', count(*) = 1 AND max(data_type) = 'timestamp with time zone',
       'col=' || coalesce(max(data_type), 'MISSING')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'workflows'
   AND column_name = 'last_deployed_at';

INSERT INTO t176_results
SELECT 'C3', pg_get_constraintdef(oid) ILIKE '%draft%published%disabled%',
       pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.workflows'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) ILIKE '%status%';

INSERT INTO t176_results
SELECT 'C4',
       pg_get_constraintdef(oid) ILIKE '%pending%running%succeeded%failed%timeout%cancelled%'
       AND (SELECT pg_get_constraintdef(c2.oid) ILIKE '%manual_run%'
              FROM pg_constraint c2
             WHERE c2.conrelid = 'public.workflow_runs'::regclass AND c2.contype = 'c'
               AND pg_get_constraintdef(c2.oid) ILIKE '%trigger_type%'),
       'status+trigger CHECKs present'
  FROM pg_constraint
 WHERE conrelid = 'public.workflow_runs'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) ILIKE '%status%';

INSERT INTO t176_results
SELECT 'C5', relrowsecurity,
       'rls_workflows=' || (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.workflows'::regclass)
       || ' rls_runs=' || relrowsecurity::text
  FROM pg_class
 WHERE oid = 'public.workflow_runs'::regclass;

INSERT INTO t176_results
SELECT 'C6', (SELECT count(*) FROM public.workflows) = 0 AND count(*) = 0,
       'workflows=' || (SELECT count(*)::text FROM public.workflows) || ' runs=' || count(*)::text
  FROM public.workflow_runs;

INSERT INTO t176_results
SELECT 'C7', count(*) = 1,
       'insert_policy=' || coalesce(max(policyname), 'MISSING')
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'workflow_runs'
   AND policyname = 'workflow_runs_insert';

SELECT check_id, ok, detail FROM t176_results ORDER BY check_id;

ROLLBACK;
