-- ============================================================================
-- 0076_restore_notifications_select_policy.sql — LIVE DRIFT REPAIR (T-191)
-- ============================================================================
-- DISCOVERY (2026-09-05, 30th session, live policy census during the T-190
-- round-trip): the LIVE `notifications_select` policy on public.notifications
-- is `to authenticated using (true)` — ANY authenticated user can SELECT
-- EVERY notifications row (all users, all tenants). The canonical policy
-- (migration 0019, lines 1023-1032) is tenant-scoped + self/role-targeted:
--
--     create policy notifications_select on public.notifications
--         for select to authenticated
--         using (
--             tenant_id = public.current_tenant_id()
--             and (
--                 target_user_id = public.current_user_profile_id()
--                 or (target_role is not null and target_role = any(public.current_user_roles()))
--                 or (target_user_id is null and target_role is null
--                     and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']))
--             )
--         );
--
-- NO migration in the 0001–0075 chain drops or widens that policy (grep:
-- only 0019 creates notifications_select; 0048 touches insert only). The
-- live widening is therefore UNREGISTERED DRIFT applied directly to the
-- production DB by an unknown actor (the REG-003 / ARCH-009 failure class
-- AGENTS.md §15.11 warns about — "drift compounds silently").
--
-- User-facing symptom observed during the T-190 live round-trip: a parent
-- filtered query returned a STAFF-targeted notification row (the round-trip
-- markRead step then matched 0 rows — parents briefly see data that is not
-- theirs under any crafted filter).
--
-- This migration restores the canonical 0019 policy verbatim.
--
-- IDEMPOTENCY: drop-policy-if-exists + create — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is applied
-- to the live project TOGETHER with its schema_migrations registration in
-- one atomic transaction (scripts/apply_0076_live.sh).
-- ============================================================================

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            target_user_id = public.current_user_profile_id()
            or (target_role is not null and target_role = any(public.current_user_roles()))
            or (target_user_id is null and target_role is null
                and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']))
        )
    );

comment on policy notifications_select on public.notifications is
  'Canonical 0019 scoping restored (T-191): tenant + self-target / role-broadcast / staff broadcast. The live `using (true)` widening was unregistered drift.';

-- ----------------------------------------------------------------------------
-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0076_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0076', '{0076_restore_notifications_select_policy.sql}', 'restore_notifications_select_policy')
on conflict (version) do nothing;
