-- ============================================================================
-- 0091_parent_reads_student_academic_histories.sql
-- ============================================================================
-- RECONSTRUCTED FROM LIVE (58th session, 2026-09-13 — T-326 / ARCH-011
-- reconciliation): this migration was applied to the production project and
-- registered in supabase_migrations.schema_migrations (version '0091', name
-- 'parent_reads_student_academic_histories') WITHOUT its file ever being
-- committed to the chain (the ARCH-011 anti-pattern — a fresh deployment
-- would silently miss it, and the parent portal's per-child academic-history
-- query would return 0 rows under RLS forever).
--
-- Purpose: the parent portal (elimtiyaz-website) renders each child's
-- previous school years (student_academic_histories — migration 0029, the
-- CANONICAL academic-history table per source-of-truth.md): pass/fail
-- decision, GPA, rank, class, narrative. The 0057 policy set is STAFF-ONLY
-- (super_admin / support_staff / teacher), so a signed-in parent could not
-- read their own children's history rows.
--
-- This migration adds the missing SELECT policy, scoped to:
--   - the caller's tenant (current_tenant_id()),
--   - rows whose student belongs to a parent bound to auth.uid() with
--     both parent and student not soft-deleted.
--
-- The policy shape mirrors the established parent-read pattern
-- (payments_parent_own_select family, migration 0041) — no SECURITY DEFINER,
-- no role expansion, write paths untouched (histories remain append-only
-- staff/system-written via execute_batch_promotion, migration 0059).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE + ON CONFLICT registration
-- (already applied live — re-running is a no-op).
-- ============================================================================

drop policy if exists student_academic_histories_parent_select
    on public.student_academic_histories;

create policy student_academic_histories_parent_select
    on public.student_academic_histories
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and student_id in (
            select s.id
              from public.students s
              join public.parents p on p.id = s.parent_id
             where p.auth_user_id = auth.uid()
               and p.deleted_at is null
               and s.deleted_at is null
        )
    );

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — already applied live; ON CONFLICT
-- keeps this file a no-op on the live project while making fresh deployments
-- register it).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0091', '{0091_parent_reads_student_academic_histories.sql}', 'parent_reads_student_academic_histories')
on conflict (version) do nothing;
