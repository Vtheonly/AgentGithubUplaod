-- ============================================================================
-- 0066_parent_first_name_backfill.sql — DATA-005 data repair (live-applied,
-- reconstructed + committed by the 22nd session)
-- ============================================================================
-- PROVENANCE (ARCH-014, 2026-09-03): this migration was applied to the LIVE
-- project and registered in supabase_migrations.schema_migrations as version
-- '0066' / name 'parent_first_name_backfill' by an actor OUTSIDE the
-- repositories during the 22nd repair session (the session's opening chain
-- check at 2026-09-03 22:3x UTC read 62/62 = 0001–0065 ZERO DRIFT; the
-- closeout re-check read 63 live rows). The 3rd ARCH-011-class event (after
-- 0053/0054 and 0065). The live DB shows only the RESULT of the DML — the
-- actor's exact SQL text is unrecoverable (pg_get_functiondef covers
-- functions, not UPDATEs) — so this file is a SEMANTIC RECONSTRUCTION pinned
-- to the observed live state (see scripts/verify_t-139_data005_backfill.sql):
--
--   live before (DATA-005, 2026-08-30 health check):  259 parents, ALL with
--   first_name = '' , names living in display_name (+last_name).
--   live after (2026-09-03):  258/259 rows carry first_name = the
--   display_name remainder after the leading last_name token (btrim'd);
--   display_name and last_name UNTOUCHED (259/259 non-empty display_name;
--   246 rows satisfy display_name = last_name || ' ' || first_name exactly,
--   12 carry legacy DOUBLE spaces inside display_name, 1 row is a
--   single-token name [HEMLAOUISOFIA: display = last = 'HEMLAOUISOFISOFIA'
--   — see the verify script for the exact value] and legitimately remains
--   first_name = '' — a single token cannot split).
--
-- The reconstruction below reproduces exactly that outcome and is IDEMPOTENT
-- (its WHERE can only ever match the single-token row, which it excludes):
-- a fresh deployment replaying the chain produces the same end state without
-- touching display_name or last_name.
--
-- WHY a data repair belongs in the migration chain: the corpus shape
-- (first_name = '') was itself produced by the original Excel import
-- (migration 0005's importer); the repair is a one-shot corpus alignment in
-- the same ADR-001 chain-of-record spirit as 0062 (finance reconciliation)
-- and 0063 (Excel corpus alignment). DATA-005's agent-side halves were
-- already closed: the portal (T-084, 2026-08-30), the desktop render sites
-- (T-134, 2026-09-03 — 18 sites canonicalized to parentDisplayName), and
-- Android (verified clean — uses fullName). This migration closes the LAST
-- half: the data itself.
-- ============================================================================

update public.parents
   set first_name = btrim(substring(display_name from length(last_name) + 2))
 where first_name = ''
   and display_name is not null
   and display_name <> ''
   -- only names that START with the last_name token can split safely
   and position(' ' in display_name) > 0
   and left(display_name, length(last_name)) = last_name
   -- and there must be a non-blank remainder to become the first name
   and length(display_name) > length(last_name) + 1;

-- Registration row (live value, preserved verbatim — the row ALREADY exists
-- on the live project; this statement exists so a FRESH deployment of the
-- chain registers the migration the same way; ON CONFLICT keeps it
-- idempotent). The statements column mirrors the live row's value:
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0066', '{0066_parent_first_name_backfill.sql}', 'parent_first_name_backfill')
on conflict (version) do nothing;
