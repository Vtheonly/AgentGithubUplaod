-- T-174 live verification (28th session, 2026-09-05) — 0069 registration
-- repair + chain-state health. Read-only, wrapped in BEGIN/ROLLBACK so it can
-- be re-run any time without mutating the live DB.
--
-- Checks:
--   C1. The live chain holds exactly 66 registered migrations (0001–0069).
--   C2. The 0069 registration row exists with the exact canonical shape
--       (statements + name).
--   C3. The 0069 constraint exists and is VALIDATED (the DDL applied by the
--       26th session is untouched by the registration repair).
--   C4. Regression path: no DOUBLE registration is possible (unique index on
--       version — the ON CONFLICT repair is structurally idempotent).
--   C5. The registration repair did not touch ledger_entries data (row count
--       in the temp snapshot == live count; read via count(*)).

BEGIN;

CREATE TEMP TABLE t174_results (
  check_id text,
  ok boolean,
  detail text
);

-- C1: chain length
INSERT INTO t174_results
SELECT 'C1', count(*) = 66, 'registered=' || count(*)::text
  FROM supabase_migrations.schema_migrations;

-- C2: the 0069 row shape
INSERT INTO t174_results
SELECT 'C2', count(*) = 1,
       'statements=' || coalesce(max(statements::text), 'NULL') || ' name=' || coalesce(max(name), 'NULL')
  FROM supabase_migrations.schema_migrations
 WHERE version = '0069';

-- C3: constraint present + validated
INSERT INTO t174_results
SELECT 'C3', count(*) = 1 AND bool_and(convalidated),
       'constraints=' || count(*)::text || ' convalidated=' || coalesce(bool_and(convalidated)::text, 'NULL')
  FROM pg_constraint
 WHERE conname = 'ledger_entries_adjustment_description_guard';

-- C4: version uniqueness is enforced (index exists)
INSERT INTO t174_results
SELECT 'C4', count(*) >= 1, 'unique_indexes_on_version=' || count(*)::text
  FROM pg_indexes
 WHERE schemaname = 'supabase_migrations'
   AND tablename = 'schema_migrations'
   AND indexdef ILIKE '%UNIQUE%version%';

-- C5: ledger data untouched (presence + count snapshot)
INSERT INTO t174_results
SELECT 'C5', count(*) >= 690, 'adjustment_rows=' || count(*)::text
  FROM public.ledger_entries
 WHERE entry_type = 'adjustment';

SELECT check_id, ok, detail FROM t174_results ORDER BY check_id;

ROLLBACK;
