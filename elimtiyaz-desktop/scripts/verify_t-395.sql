-- ============================================================================
-- verify_t-395.sql — the post-restore state assertions for T-395 / OPS-319
-- (migration 0101: the SIDI family restore + the half-refund repair).
--
-- House convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it
-- can be re-run any time without mutating the live DB; results land in a
-- temp table SELECTed at the end (the CLI does not surface RAISE NOTICE);
-- covers BOTH the happy path (the family is back, coherent) AND the
-- regression paths (the other soft-deleted test rows stay deleted; no
-- reversal entries were invented; the financial invariants hold).
--
-- Run:  supabase db query --linked < scripts/verify_t-395.sql
--   or: the Management API SQL endpoint with this file's content
--       (curl --data @file — the Cloudflare UA quirk).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE t395_results (
    check_id   text,
    label      text,
    ok         boolean,
    detail     text
);

GRANT INSERT, SELECT ON t395_results TO authenticated;

-- C1 — the parent is visible-shaped again (the owner's exact report row).
INSERT INTO t395_results
SELECT 'C1', 'parent visible (deleted_at null, is_active, Famille SIDI display)',
       count(*) = 1
       AND coalesce(bool_and(deleted_at IS NULL AND is_active
               AND display_name = 'Famille SIDI — 0554288142'), false) = true,
       'rows=' || count(*) || ' phone=' || coalesce(max(primary_phone), '-')
FROM public.parents
WHERE parent_code = 'PAR-2026-8F4B97'
  AND regexp_replace(primary_phone, '[^0-9]', '', 'g') = '0554288142';

-- C2 — the student is visible-shaped again + correctly linked.
INSERT INTO t395_results
SELECT 'C2', 'student visible + linked (MAMER SAMYI SIDI, 5ap)',
       count(*) = 1
       AND coalesce(bool_and(s.deleted_at IS NULL AND s.is_active
               AND s.parent_id = p.id), false) = true,
       'rows=' || count(*) || ' code=' || coalesce(max(s.student_code), '-')
FROM public.students s
JOIN public.parents p ON p.id = s.parent_id
WHERE p.parent_code = 'PAR-2026-8F4B97'
  AND s.student_code = 'ELV-2026-E0E486';

-- C3 — the payments are back to the canonical 'paid' (Σ 255,000).
INSERT INTO t395_results
SELECT 'C3', 'payments all paid, Σ 255000 (the DATA-011 versements)',
       count(*) = 3 AND coalesce(sum(pay.amount), 0) = 255000
       AND count(*) FILTER (WHERE pay.status = 'paid') = 3,
       'n=' || count(*) || ' Σ=' || coalesce(sum(pay.amount), 0)
       || ' statuses=' || string_agg(DISTINCT pay.status, ',')
FROM public.payments pay
JOIN public.parents p ON p.id = pay.parent_id
WHERE p.parent_code = 'PAR-2026-8F4B97';

-- C4 — installments invariant: Σ due = Σ paid = 255,000, all paid.
INSERT INTO t395_results
SELECT 'C4', 'installments Σ due = Σ paid = 255000',
       count(*) = 3 AND coalesce(sum(amount_due), 0) = 255000
       AND coalesce(sum(amount_paid), 0) = 255000
       AND count(*) FILTER (WHERE status = 'paid') = 3,
       'n=' || count(*) || ' due=' || coalesce(sum(amount_due), 0)
       || ' paid=' || coalesce(sum(amount_paid), 0)
FROM public.installments i
JOIN public.students s ON s.id = i.student_id
JOIN public.parents p ON p.id = s.parent_id
WHERE p.parent_code = 'PAR-2026-8F4B97';

-- C5 — ledger invariant: charge 255,000 − payments 255,000 = net 0 (créance 0).
INSERT INTO t395_results
SELECT 'C5', 'ledger net 0 (charge 255000 − payments 255000)',
       coalesce(sum(le.amount) FILTER (WHERE le.entry_type = 'charge'), 0) = 255000
       AND coalesce(sum(le.amount) FILTER (WHERE le.entry_type = 'payment'), 0) = -255000
       AND coalesce(sum(le.amount), 0) = 0,
       'Σ=' || coalesce(sum(le.amount), 0)
       || ' charge=' || coalesce(sum(le.amount) FILTER (WHERE le.entry_type = 'charge'), 0)
       || ' payments=' || coalesce(sum(le.amount) FILTER (WHERE le.entry_type = 'payment'), 0)
FROM public.ledger_entries le
JOIN public.parents p ON p.id = le.parent_id
WHERE p.parent_code = 'PAR-2026-8F4B97';

-- C6 — the waterfall allocations are intact (5 rows).
INSERT INTO t395_results
SELECT 'C6', 'payment_allocations intact (5)',
       count(*) = 5, 'n=' || count(*)
FROM public.payment_allocations pa
JOIN public.payments pay ON pay.id = pa.payment_id
JOIN public.parents p ON p.id = pay.parent_id
WHERE p.parent_code = 'PAR-2026-8F4B97';

-- C7 — REGRESSION: no reversal entries were invented for the family
-- (the half-refund never created any; the restore must not either).
INSERT INTO t395_results
SELECT 'C7', 'no reversal ledger entries for the family (half-refund signature)',
       count(*) = 0, 'n=' || count(*)
FROM public.ledger_entries le
JOIN public.parents p ON p.id = le.parent_id
WHERE p.parent_code = 'PAR-2026-8F4B97'
  AND le.entry_type = 'reversal';

-- C8 — REGRESSION: the OTHER soft-deleted test rows stay soft-deleted (the
-- restore is scoped to the SIDI family only). Name-keyed: the known 2026-09
-- test rows; vacuously true on a project where they never existed (OLD).
INSERT INTO t395_results
SELECT 'C8', 'other soft-deleted test rows untouched (still deleted)',
       count(*) FILTER (WHERE deleted_at IS NULL) = 0,
       'still_deleted=' || count(*) FILTER (WHERE deleted_at IS NOT NULL)
       || ' wrongly_active=' || count(*) FILTER (WHERE deleted_at IS NULL)
FROM public.parents
WHERE display_name IN ('DIAG TEST', 'DIAG TEST2')
   OR display_name LIKE 'T391 Probe%'
   OR (display_name IS NULL AND primary_phone = '(inconnu)');

-- C9 — the restore audit trail exists (parent/student/payment restores) —
-- OR the project never needed the restore (OLD: no deletion, no refund →
-- the second disjunct proves there was nothing to restore; honest on both).
INSERT INTO t395_results
WITH restores AS (
    SELECT count(*) FILTER (WHERE action = 'parent.restore') AS p,
           count(*) FILTER (WHERE action = 'student.restore') AS s,
           count(*) FILTER (WHERE action = 'payment.restore') AS pay
      FROM public.audit_logs WHERE actor_name = 'Restauration 0101'
), refunds_ever AS (
    SELECT count(*) AS n
      FROM public.audit_logs a
      JOIN public.payments pay ON pay.id = a.entity_id
      JOIN public.parents p ON p.id = pay.parent_id
     WHERE a.action = 'payment.refund'
       AND p.parent_code = 'PAR-2026-8F4B97'
)
SELECT 'C9', 'audit trail (parent.restore, student.restore, payment.restore ×3) — or nothing-to-restore',
       (restores.p >= 1 AND restores.s >= 1 AND restores.pay >= 3)
       OR (refunds_ever.n = 0
           AND NOT EXISTS (SELECT 1 FROM public.parents pp
                            WHERE pp.parent_code = 'PAR-2026-8F4B97'
                              AND (pp.deleted_at IS NOT NULL OR pp.is_active = false))
           AND NOT EXISTS (SELECT 1 FROM public.students ss
                            JOIN public.parents pp ON pp.id = ss.parent_id
                           WHERE pp.parent_code = 'PAR-2026-8F4B97'
                             AND ss.student_code = 'ELV-2026-E0E486'
                             AND (ss.deleted_at IS NOT NULL OR ss.is_active = false))),
       'parent.restore=' || restores.p || ' student.restore=' || restores.s
       || ' payment.restore=' || restores.pay
       || ' historical_refunds=' || refunds_ever.n
FROM restores, refunds_ever;

-- C10 — the chain registration is present (both projects run this).
INSERT INTO t395_results
SELECT 'C10', 'schema_migrations has 0101',
       count(*) = 1, 'n=' || count(*)
FROM supabase_migrations.schema_migrations
WHERE version = '0101';

SELECT check_id, label, ok, detail FROM t395_results ORDER BY check_id;

ROLLBACK;
