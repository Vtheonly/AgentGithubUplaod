-- ============================================================================
-- 0093_attendance_justification_update_policy.sql
-- ============================================================================
-- RECONSTRUCTED FROM LIVE (58th session, 2026-09-13 — T-326 / ARCH-011
-- reconciliation): this migration was applied to the production project and
-- registered in supabase_migrations.schema_migrations (version '0093', name
-- 'attendance_justification_update_policy') WITHOUT its file ever being
-- committed to the chain (the ARCH-011 anti-pattern).
--
-- Purpose: the parent portal's absence-justification dialog UPDATES the
-- justification fields (justification_note / justification_path /
-- justification_drive_link / justification_status -> 'submitted') on the
-- student's OWN attendance_records row. The 0009/0057 policy set allowed
-- parents to SELECT attendance but only staff to write — so the portal's
-- only sanctioned write path (AGENTS.md website boundaries: "may submit
-- absence justifications") was IMPOSSIBLE against live RLS.
--
-- This migration adds the missing UPDATE policy, scoped to:
--   - the caller's tenant,
--   - has_role('parent'),
--   - rows whose student belongs to a parent bound to auth.uid()
--     (both not soft-deleted).
--
-- Column-level safety: the policy is on the TABLE, but the website writes
-- ONLY the justification_* columns; status transitions remain staff-owned
-- (review workflow) — the dialog never touches is_present/status.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE + ON CONFLICT registration
-- (already applied live — re-running is a no-op).
-- ============================================================================

drop policy if exists attendance_parent_update_justification
    on public.attendance_records;

create policy attendance_parent_update_justification
    on public.attendance_records
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_role('parent')
        and student_id in (
            select s.id
              from public.students s
              join public.parents p on p.id = s.parent_id
             where p.auth_user_id = auth.uid()
               and s.deleted_at is null
               and p.deleted_at is null
        )
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_role('parent')
        and student_id in (
            select s.id
              from public.students s
              join public.parents p on p.id = s.parent_id
             where p.auth_user_id = auth.uid()
               and s.deleted_at is null
               and p.deleted_at is null
        )
    );

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — already applied live; ON CONFLICT
-- keeps this file a no-op on the live project while making fresh deployments
-- register it).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0093', '{0093_attendance_justification_update_policy.sql}', 'attendance_justification_update_policy')
on conflict (version) do nothing;
