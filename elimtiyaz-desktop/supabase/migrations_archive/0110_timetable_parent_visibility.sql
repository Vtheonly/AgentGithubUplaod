-- ============================================================================
-- 0110_timetable_parent_visibility.sql — T-404 (SCHED-100) follow-up
-- ============================================================================
-- Fixes an RLS-recursion defect discovered by verify_t-404.sql C10d during
-- the 0109 live verification (2026-09-22):
--
--   timetable_entries_select's non-staff branch is
--     EXISTS (SELECT 1 FROM timetable_versions v
--             WHERE v.id = timetable_entries.version_id
--               AND v.status = 'published')
--
--   but that EXISTS subquery is itself subject to timetable_versions RLS,
--   whose SELECT policy granted only super_admin / support_staff / teacher.
--   A parent-role (or role-less) authenticated account therefore saw ZERO
--   entries — the "published-only visibility for everyone else" branch was
--   dead code. Live evidence: C10d published_visible=0.
--
-- The fix: the timetable_versions SELECT policy additionally exposes
-- PUBLISHED version rows to every tenant-authenticated account (staff
-- roles keep full visibility). This both revives the entries EXISTS branch
-- and gives the future website parent portal the version lookup it needs
-- (which version is published for the academic year).
--
-- Everything else about 0109 is unchanged. The policy is replaced with
-- DROP IF EXISTS + CREATE (idempotent; the 0094 pattern).
-- ============================================================================

DROP POLICY IF EXISTS timetable_versions_select ON public.timetable_versions;
CREATE POLICY timetable_versions_select ON public.timetable_versions
    FOR SELECT TO AUTHENTICATED
    USING (
        tenant_id = public.current_tenant_id()
        AND (
            public.has_any_role(ARRAY['super_admin','support_staff','teacher'])
            OR status = 'published'
        )
    );
