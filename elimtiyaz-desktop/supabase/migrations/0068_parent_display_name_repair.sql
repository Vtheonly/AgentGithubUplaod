-- ============================================================================
-- 0068_parent_display_name_repair.sql — DATA-012 repair (T-151, 24th session)
-- ============================================================================
-- OWNER MANDATE (2026-09-03, registered as DATA-012): "Under the
-- Parent/Child management section, the children's names are mistakenly
-- showing up as the parent's name (e.g., if the parent is 'John Doe', the
-- listed children also appear as 'John Doe')."
--
-- Root cause (live-verified this session): the STUDENT rows are correct —
-- the corpus predates the importer's PARENT-AS-STUDENT FIX. The historic
-- import derived each parent's display_name from their FIRST CHILD's NOM
-- (the Excel has no parent-name column: TUTEUR is empty or the 'NV' flag on
-- 390/390 rows). 259/260 live parents therefore carry a child's full name
-- (e.g. family KEHILI: children LINA/AGHILES/SALIHA, parent display_name
-- 'KEHILI LINA' = the first child) — so the Enfants list shows a child
-- named identically to the parent.
--
-- The repair aligns the live corpus with the importer's CURRENT canonical
-- convention (elimtiyaz-desktop/src/infrastructure/excel/import-engine/
-- storage/repository-adapter.ts, PARENT-AS-STUDENT FIX):
--   display_name = 'Famille {last_name}' (+ ' — {primary_phone}' when a
--   phone exists — the importer's disambiguation suffix; live evidence:
--   HALIMI/ELAOUAR/REZAK each name 3 different families).
--   first_name   = ''  — the real given name is UNKNOWN in the Excel; a
--   child's given name must not masquerade as the parent's. All canonical
--   renderers prefer display_name (desktop parentDisplayName T-134,
--   website formatParentName T-084, Android Parent.fullName), so ''
--   never renders. (The website profile-view's 2 raw first/last joins are
--   canonicalized to formatParentName in the same task — T-084 pattern.)
--   last_name    = unchanged (it already IS the family name — the NOM
--   split 'KEHILI LINA' → last='KEHILI').
--
-- Scope guard: ONLY parents whose display_name (whitespace-normalized,
--   case-insensitive) matches one of their non-deleted children's
--   display_name or first+last join. Parents without children
--   (approval-created rows), parents with non-matching display names, and
--   the single-token HEMLAOUISOFIA row are untouched.
--
-- IDEMPOTENT: after the repair the display_name no longer matches any
-- child's name, so re-running matches 0 rows.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): applied live
-- TOGETHER with its schema_migrations registration in one atomic
-- transaction (scripts/t152_apply_0068.sh).
-- ============================================================================

-- Diagnostic view of what WILL change (kept as a comment for the verify
-- script; the migration itself is a single guarded UPDATE):
--   SELECT count(*) FROM parents p WHERE p.deleted_at IS NULL AND EXISTS (
--       SELECT 1 FROM students s
--        WHERE s.parent_id = p.id AND s.deleted_at IS NULL
--          AND ( lower(regexp_replace(btrim(coalesce(p.display_name,'')),'\s+',' ','g'))
--                = lower(regexp_replace(btrim(coalesce(s.display_name,'')),'\s+',' ','g'))
--             OR lower(regexp_replace(btrim(coalesce(p.display_name,'')),'\s+',' ','g'))
--                = lower(regexp_replace(btrim(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')),'\s+',' ','g')) ) );
--   → 259 (live, 2026-09-03)

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
