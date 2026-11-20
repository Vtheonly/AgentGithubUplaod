-- ============================================================================
-- 0149: ACAD-510 — the classes.notes column: the class dialog's notes field
--       finally has a live persistence target (T-502, 153rd session,
--       2026-10-11)
-- ============================================================================
--
-- THE DEFECT (T-408 registration, 91st session 2026-09-22; T-500 live
-- re-proof C1, 2026-10-10):
--
--   The domain model (AcademicClass.notes) and the class-creation dialog
--   carry a notes field, but the live `classes` table has NO such column
--   (re-proven live: `column classes.notes does not exist`), and the
--   Supabase repository drops the field on BOTH write paths:
--     * createClass's INSERT never sends notes;
--     * updateClass's patch never maps it (the T-500 UPDATE-path proof:
--       class-detail-page sends notes, « Classe mise à jour » fires, the
--       edited notes are silently discarded).
--   The MOCK twin persists notes — the classic mock↔live divergence that
--   made dev mode look correct.
--
-- THE FIX (the registered decision: the column, not the UI downgrade):
--   §1 adds the nullable `notes` column. The repository wiring (createClass
--   INSERT + updateClass patch) lands in the same T-502 change; the read
--   side already maps `row.notes` (mapClassRow) and the SELECT is `*`, so
--   existing reads pick the column up automatically once it exists.
--
-- IDEMPOTENCY: add column if not exists — safe to re-apply.
--
-- VERIFICATION (post-apply): scripts/t502_postapply_verify2.sql — the
-- catalog census + the create/update round-trip probe (rolled back).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. The column
-- ----------------------------------------------------------------------------
alter table public.classes add column if not exists notes text;

comment on column public.classes.notes is
    'ACAD-510 (0149): custom notes/observations per class — the persistence target behind AcademicClass.notes (previously dropped silently on both create and update).';

-- ----------------------------------------------------------------------------
-- §2. Registration (T-091/MIG-TOKENS pattern)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0149', '{0149_classes_notes.sql}', 'classes_notes')
on conflict (version) do nothing;
