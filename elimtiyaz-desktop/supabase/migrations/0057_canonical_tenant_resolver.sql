-- 0057_canonical_tenant_resolver.sql (T-025 — DEAD-100 / TENANT-105 / TENANT-106)
--
-- Replaces the dead 0029-era resolver `fn_current_tenant_id()` (reads the
-- Postgres session setting `app.current_tenant_id`, which NO client, EF or
-- trigger ever sets — so it always returns NULL and every policy using it is
-- inert) with the canonical `current_tenant_id()` (auth.uid()-based,
-- migration 0019/0053 lineage).
--
-- What this does:
--  1. Drops the 6 inert `rls_*_tenant` policies on academic_years,
--     academic_levels, classes, subjects, class_subjects, assessments.
--     These tables KEEP their working role-gated 0019/0041 policies
--     (*_admin / *_select / assessments_admin / assessments_select), so
--     dropping the dead ones changes nothing for any client — it only
--     removes policies that can never grant access (DEAD-100 cleanup
--     without weakening RLS: nothing that currently grants access is
--     removed, nothing new is granted on these tables).
--  2. Replaces the dead policy on student_academic_histories with a working
--     staff-gated policy (tenant + has_any_role) so the year-end promotion
--     flow can finally upsert the append-only history records
--     (TENANT-106 — the desktop batch promotion aborts on the RLS denial
--     today). Role list mirrors assessments_admin (the other academic-write
--     surface): super_admin, support_staff, teacher.
--  3. Rewrites set_assessments_tenant() (0041) so the final fallback
--     COALESCE(fn_current_tenant_id(), '<DEMO>') is GONE: an assessment row
--     that cannot be tenant-resolved (no tenant_id, no valid student_id)
--     now FAILS instead of being silently stamped with the DEMO tenant
--     (TENANT-105 absorbed into DEAD-100).
--  4. Drops public.fn_current_tenant_id() (plain DROP — if anything still
--     references it, the migration fails loudly instead of silently
--     breaking that object).
--
-- Idempotent: policy drops use IF EXISTS; the trigger function is CREATE OR
-- REPLACE; the function drop is guarded.

-- 1. Dead policies on tables that keep their working role-gated policies.
DROP POLICY IF EXISTS rls_academic_years_tenant        ON public.academic_years;
DROP POLICY IF EXISTS rls_academic_levels_tenant       ON public.academic_levels;
DROP POLICY IF EXISTS rls_classes_tenant               ON public.classes;
DROP POLICY IF EXISTS rls_subjects_tenant              ON public.subjects;
DROP POLICY IF EXISTS rls_class_subjects_tenant        ON public.class_subjects;
DROP POLICY IF EXISTS rls_assessments_tenant           ON public.assessments;

-- 2. student_academic_histories: dead policy → working staff-gated policy.
DROP POLICY IF EXISTS rls_student_academic_histories_tenant ON public.student_academic_histories;
DROP POLICY IF EXISTS student_academic_histories_staff      ON public.student_academic_histories;
CREATE POLICY student_academic_histories_staff ON public.student_academic_histories
  FOR ALL
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'teacher'::text])
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'teacher'::text])
  );

-- 3. set_assessments_tenant(): no DEMO fallback — unresolvable tenant FAILS.
CREATE OR REPLACE FUNCTION public.set_assessments_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.tenant_id IS NULL THEN
        IF NEW.student_id IS NOT NULL THEN
            SELECT s.tenant_id INTO NEW.tenant_id
              FROM public.students s WHERE s.id = NEW.student_id;
        END IF;
    END IF;
    -- T-025 (TENANT-105): the previous fallback stamped orphan rows with
    -- the DEMO tenant ('00000000-…-0001') because fn_current_tenant_id()
    -- always returned NULL. An assessment that cannot be tenant-resolved is
    -- a caller bug — fail loudly instead of writing cross-tenant data.
    IF NEW.tenant_id IS NULL THEN
        RAISE EXCEPTION 'assessment tenant_id unresolvable: no tenant_id and no valid student_id (student_id=%)', NEW.student_id
            USING ERRCODE = '23502';
    END IF;
    RETURN NEW;
END;
$$;

-- 4. The dead resolver itself.
DROP FUNCTION IF EXISTS public.fn_current_tenant_id();
