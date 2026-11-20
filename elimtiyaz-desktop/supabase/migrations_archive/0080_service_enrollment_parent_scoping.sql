-- ============================================================================
-- 0080_service_enrollment_parent_scoping.sql — INFO-300 fix (T-214)
-- ============================================================================
-- DISCOVERY (2026-09-07, 32nd session, while scoping T-211 — the owner's
-- "children's enrollments" portal mandate): the `service_enrollments_select`
-- policy (migration 0019, lines 505-508) grants tenant-wide SELECT to EVERY
-- authenticated user:
--
--     create policy service_enrollments_select on public.service_enrollments
--         for select to authenticated
--         using (tenant_id = public.current_tenant_id());
--
-- A signed-in PARENT of family A can therefore read family B's enrollment
-- rows: service kind, annual amount, per-tranche amounts and due dates.
-- Unlike its sibling policies it carries no parent scoping at all:
--   - invoices_select scopes parents to parent_id IN own parents
--   - students_parent_sees_own scopes parents to parent_id IN own parents
-- The portal never read service_enrollments before T-211 (the
-- useServiceEnrollments hook shipped with ZERO consumers), so the weakness
-- was never exercised — T-211's new enrollments card makes it reachable.
--
-- This migration restores the sibling-policy pattern: staff roles keep
-- tenant-wide access; parents see ONLY their own students' rows. Student
-- self-login rows (students.auth_user_id — rare, provisioned for future
-- student accounts) are included for parity with students_student_self.
--
-- Cross-platform check (AGENTS.md §10): all readers were enumerated before
-- this change — desktop (staff: financial + CRM + pricing modules — passes
-- the has_any_role branch), Android (staff pull-sync — passes the same
-- branch), website (parents via T-211's useServiceEnrollments — now scoped
-- to their own children; the portal only ever filters by the OWN student_id
-- anyway, so no legitimate read path narrows).
--
-- IDEMPOTENCY: drop-policy-if-exists + create — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is applied
-- to the live project TOGETHER with its schema_migrations registration in
-- one atomic transaction (scripts/apply_0080_live.sh).
--
-- NOTE: the Management API SQL endpoint silently DROPS `comment on`
-- statements (AGENTS.md §11.1 quirk 1) — the catalog comment below lands
-- on fresh CLI deployments only. That is the documented live state.
-- ============================================================================

drop policy if exists service_enrollments_select on public.service_enrollments;
create policy service_enrollments_select on public.service_enrollments
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'manager'])
            or public.has_role('parent') and student_id in (
                select s.id from public.students s
                join public.parents p on p.id = s.parent_id
                where p.auth_user_id = auth.uid()
                  and p.deleted_at is null
                  and s.deleted_at is null
            )
            or exists (
                select 1 from public.students s2
                where s2.id = service_enrollments.student_id
                  and s2.auth_user_id = auth.uid()
                  and s2.deleted_at is null
            )
        )
    );

comment on policy service_enrollments_select on public.service_enrollments is
  'INFO-300 fix (T-214, 32nd session): tenant + staff roles, or parent-own-student / student-self scoping — the 0019 tenant-wide SELECT exposed every family''s enrollment amounts to any authenticated parent.';

-- ----------------------------------------------------------------------------
-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0080_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0080', '{0080_service_enrollment_parent_scoping.sql}', 'service_enrollment_parent_scoping')
on conflict (version) do nothing;
