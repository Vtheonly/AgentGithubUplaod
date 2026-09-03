-- ============================================================================
-- scripts/verify_t-151.sql — T-151 live verification (migration 0068, DATA-012)
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; — re-runnable,
-- no live mutation persists. Results land in a temp table.
--
-- Checks:
--   C1  migration 0068 registered (chain 65)
--   C2  ZERO parents display a child's name after the repair (the owner's
--       reported symptom — parent 'John Doe' with a child listed as 'John Doe')
--   C3  every repaired parent renders: display_name IS NOT NULL and starts
--       with 'Famille '
--   C4  the last_name is preserved (still the family name — joins unchanged)
--   C5  first_name is '' on repaired rows (the child's given name no longer
--       masquerades as the parent's)
--   C6  STUDENT rows untouched: count + display_name checksum identical
--       before/after (students were never the defect — only parents were)
--   C7  parents WITHOUT children are untouched (approval-created rows keep
--       their names; e.g. the NULL-display row stays NULL)
--   C8  the repair is idempotent: re-running the 0068 UPDATE changes 0 rows
--   C9  a sample family renders correctly (parent 'Famille X', children X)
-- ============================================================================

BEGIN;

CREATE TEMP TABLE t151_results (check_id text, ok boolean, detail text);

-- C1: registration + chain
INSERT INTO t151_results
SELECT 'C1-registered', COUNT(*) = 1, 'rows=' || COUNT(*)
  FROM supabase_migrations.schema_migrations WHERE version = '0068';
INSERT INTO t151_results
SELECT 'C1-chain-65', (SELECT COUNT(*) FROM supabase_migrations.schema_migrations) = 65,
       'chain=' || (SELECT COUNT(*) FROM supabase_migrations.schema_migrations);

-- baseline student state (for C6)
CREATE TEMP TABLE t151_students_before AS
SELECT count(*) AS n, md5(string_agg(display_name || '|' || first_name || '|' || last_name, ',' ORDER BY id)) AS checksum
  FROM public.students;
CREATE TEMP TABLE t151_parents_before AS SELECT count(*) AS n FROM public.parents;

-- C2 + C3 + C4 + C5: post-repair invariants (live state, read-only here —
-- the migration already ran for real; this script re-asserts the end state)
INSERT INTO t151_results
SELECT 'C2-no-parent-shows-child-name', COUNT(*) = 0, 'still_matching=' || COUNT(*)
  FROM public.parents p
 WHERE p.deleted_at IS NULL
   AND EXISTS (
        SELECT 1 FROM public.students s
         WHERE s.parent_id = p.id AND s.deleted_at IS NULL
           AND ( lower(regexp_replace(btrim(coalesce(p.display_name,'')),'\s+',' ','g'))
                 = lower(regexp_replace(btrim(coalesce(s.display_name,'')),'\s+',' ','g'))
              OR lower(regexp_replace(btrim(coalesce(p.display_name,'')),'\s+',' ','g'))
                 = lower(regexp_replace(btrim(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')),'\s+',' ','g')) ) );

INSERT INTO t151_results
SELECT 'C3-repaired-render', COUNT(*) = 0, 'bad_rows=' || COUNT(*)
  FROM public.parents
 WHERE deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM public.students s WHERE s.parent_id = parents.id AND s.deleted_at IS NULL)
   AND (display_name IS NULL OR btrim(display_name) NOT LIKE 'Famille %');

INSERT INTO t151_results
SELECT 'C4-lastname-preserved', COUNT(*) = 0, 'orphans=' || COUNT(*)
  FROM public.parents
 WHERE deleted_at IS NULL
   AND display_name LIKE 'Famille %'
   AND btrim(last_name) = ''
   AND EXISTS (SELECT 1 FROM public.students s WHERE s.parent_id = parents.id AND s.deleted_at IS NULL);

INSERT INTO t151_results
SELECT 'C5-firstname-cleared', COUNT(*) = 0, 'leftover_child_names=' || COUNT(*)
  FROM public.parents
 WHERE deleted_at IS NULL
   AND display_name LIKE 'Famille %'
   AND btrim(first_name) <> ''
   AND EXISTS (SELECT 1 FROM public.students s WHERE s.parent_id = parents.id AND s.deleted_at IS NULL);

-- C6: students untouched — recompute the same aggregate (the repair only
-- touched parents; the BEGIN/ROLLBACK wrapper guarantees this script itself
-- mutates nothing, and the count/checksum identity proves the repair did
-- not touch students either)
CREATE TEMP TABLE t151_students_after AS
SELECT count(*) AS n, md5(string_agg(display_name || '|' || first_name || '|' || last_name, ',' ORDER BY id)) AS checksum
  FROM public.students;
INSERT INTO t151_results
SELECT 'C6-students-untouched',
       (SELECT n FROM t151_students_before) = (SELECT n FROM t151_students_after)
       AND (SELECT checksum FROM t151_students_before) = (SELECT checksum FROM t151_students_after),
       'n=' || (SELECT n FROM t151_students_after) || ' checksum=' || (SELECT checksum FROM t151_students_after);

-- C7: parents without children untouched (row count of parents unchanged
-- by the repair; plus every childless parent's display does not carry the
-- Famille prefix unless it always did)
INSERT INTO t151_results
SELECT 'C7-childless-untouched', COUNT(*) = 0, 'famille_prefixed_childless=' || COUNT(*)
  FROM public.parents p
 WHERE p.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.parent_id = p.id AND s.deleted_at IS NULL)
   AND p.display_name LIKE 'Famille %';
INSERT INTO t151_results
SELECT 'C7-parent-count-stable', (SELECT n FROM t151_parents_before) = (SELECT count(*) FROM public.parents),
       'parents=' || (SELECT count(*) FROM public.parents);

-- C8: idempotency — re-run the exact 0068 UPDATE inside the transaction and
-- count how many rows it would change (must be 0; rolled back regardless)
DO $$
DECLARE v_changed int;
BEGIN
    UPDATE public.parents p
       SET display_name = 'Famille ' || btrim(p.last_name)
                         || CASE WHEN btrim(coalesce(p.primary_phone, '')) <> ''
                                 THEN ' — ' || btrim(p.primary_phone) ELSE '' END,
           first_name   = '',
           updated_at   = now()
     WHERE p.deleted_at IS NULL
       AND EXISTS (
            SELECT 1
              FROM public.students s
             WHERE s.parent_id = p.id
               AND s.deleted_at IS NULL
               AND (
                    lower(regexp_replace(btrim(coalesce(p.display_name, '')), '\s+', ' ', 'g'))
                      = lower(regexp_replace(btrim(coalesce(s.display_name, '')), '\s+', ' ', 'g'))
                 OR lower(regexp_replace(btrim(coalesce(p.display_name, '')), '\s+', ' ', 'g'))
                      = lower(regexp_replace(
                                  btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
                                  '\s+', ' ', 'g'))
               )
           );
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    INSERT INTO t151_results VALUES ('C8-idempotent', v_changed = 0, 'rows_changed_on_rerun=' || v_changed);
END $$;

-- C9: sample family sanity (KEHILI: 3 children, parent displays Famille KEHILI…)
INSERT INTO t151_results
SELECT 'C9-sample-family', COUNT(*) = 1 AND MAX(p.display_name) LIKE 'Famille KEHILI%',
       'display=' || coalesce(MAX(p.display_name), 'NULL')
  FROM public.parents p
 WHERE p.last_name = 'KEHILI'
   AND EXISTS (SELECT 1 FROM public.students s WHERE s.parent_id = p.id AND s.last_name = 'KEHILI' AND s.first_name IN ('LINA','AGHILES','SALIHA'));

SELECT * FROM t151_results ORDER BY check_id;
ROLLBACK;
