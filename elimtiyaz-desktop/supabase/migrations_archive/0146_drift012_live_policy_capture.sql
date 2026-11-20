-- ============================================================================
-- 0146: DRIFT-012 — capture the LIVE (tighter) RLS policies for
--       notifications_insert + workforce_attendance_insert
--       (T-501, 152nd session, 2026-10-11)
-- ============================================================================
--
-- THE DRIFT (T-500 live proof, F8 / I2, 2026-10-10 — both directions of
-- permissiveness vs the committed chain):
--
--   1. notifications_insert:
--        LIVE behavior  = tenant + SELF-TARGET only. The super_admin's
--                         parent-targeted direct insert → 403; a
--                         self-targeted insert → 201; the 0077 RPC
--                         (SECURITY DEFINER) → 200.
--        COMMITTED text = 0048's staff-or-self-target-role (the staff arm
--                         allows cross-target inserts for 5 staff roles).
--        The live policy is TIGHTER — the staff arm does not fire.
--
--   2. workforce_attendance_insert:
--        LIVE behavior  = a PARENT-role tenant member's punch → 403
--                         (with current_tenant_id() and
--                         current_user_roles() both proven correct for the
--                         caller — the refusal is the policy, not the
--                         resolver).
--        COMMITTED text = 0019's tenant-membership-only
--                         (`with check (tenant_id = current_tenant_id())`)
--                         — which would ALLOW the parent's punch.
--        The live policy is TIGHTER — the open door (WORKFORCE-503) is
--        closed in production but the chain still describes it open.
--
-- THIS MIGRATION re-aligns the committed chain with the live BEHAVIOR.
--
-- ⚠ HONEST LIMITATION (documented, not hidden): the exact live policy SQL
--   text could NOT be read this session (the sbp_ Management token is
--   invalid — the §15.77a dead-PAT pattern; no SQL endpoint, no
--   pg_policies read channel). The captures below are BEHAVIOR-DERIVED:
--   the tightest policies consistent with every T-500 probe result
--   (403/201/200 evidence). After the owner-gated apply, the two live
--   probes MUST be re-run as the verification (below); if any probe
--   outcome differs, the live text was tighter still — read
--   pg_policies via the dashboard SQL editor and amend BEFORE trusting
--   this capture (a follow-up migration, never an edit of this file).
--
-- CANONICAL WRITERS UNAFFECTED: every cross-user notification writer is
--   either a SECURITY DEFINER trigger (0075 chat fan-out, 0078 homework
--   fan-out) or the 0077 notify_parent_user RPC — RLS bypasses by design.
--   The desktop's last client-side cross-target writer (alertAbsences)
--   was switched to the 0077 RPC by T-501 (NOTIF-106). The self-target
--   arm preserves user-reminder inserts (target_user_id = caller).
--
-- IDEMPOTENCY: drop-if-exists first — safe to re-apply.
--
-- OWNER-GATED LIVE APPLICATION (§15.77a): apply with a fresh token via
-- scripts/apply_0146_live.sh. Verification probes (re-runnable):
--   P1: as super_admin, direct insert with target_user_id = <parent
--       profile> → must stay 403 (the tighter behavior is PRESERVED).
--   P2: self-targeted insert → 201, then delete (zero residue).
--   P3: 0077 notify_parent_user for an ACTIVE parent → 200 + id.
--   P4: as a parent-role tenant member, punch insert for a personnel id
--       → must stay 403.
--   P5: as staff (or the personnel's own linked account), punch insert
--       → 201, then delete (zero residue).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. notifications_insert — the live self-target-only behavior
-- ----------------------------------------------------------------------------
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        -- DRIFT-012 (0146): the LIVE policy behaves as tenant + SELF-TARGET
        -- only (T-500 F8: the super_admin's parent-targeted insert → 403).
        -- Cross-user delivery is the 0077 notify_parent_user RPC's job
        -- (SECURITY DEFINER); role-broadcast fan-out is the triggers' job
        -- (0075/0078). The 0048 staff arm (cross-target for 5 staff roles)
        -- does not fire on the live DB — removed here so the chain matches
        -- production. Self-targeted inserts (a user's own reminder) land.
        and target_user_id = public.current_user_profile_id()
    );

comment on policy notifications_insert on public.notifications is
    'DRIFT-012 (0146): live-behavior capture — tenant + self-target only. Cross-user: 0077 RPC; broadcasts: 0075/0078 triggers (SECURITY DEFINER).';

-- ----------------------------------------------------------------------------
-- §2. workforce_attendance_insert — the live staff-or-own-personnel behavior
-- ----------------------------------------------------------------------------
drop policy if exists workforce_attendance_insert on public.workforce_attendance_events;
create policy workforce_attendance_insert on public.workforce_attendance_events
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        -- DRIFT-012 (0146): the LIVE policy refuses a parent-role member's
        -- punch (T-500 I2: 403 with the tenant + role resolvers proven
        -- correct for the caller). Behavior-derived capture: staff roles OR
        -- the personnel's own linked account — mirroring the 0019
        -- workforce_attendance UPDATE/select authority union (line 781).
        -- This closes WORKFORCE-503's committed open door (any tenant
        -- member could punch for any personnel id).
        and (
            public.has_any_role(array['super_admin', 'support_staff', 'manager', 'financial_officer'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );

comment on policy workforce_attendance_insert on public.workforce_attendance_events is
    'DRIFT-012 (0146): live-behavior capture — staff roles or the personnel''s own linked account (the parent-role punch is refused live, T-500 I2). Closes WORKFORCE-503''s committed open door.';

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0146', '{0146_drift012_live_policy_capture.sql}', 'drift012_live_policy_capture')
on conflict (version) do nothing;
