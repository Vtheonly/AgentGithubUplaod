-- ============================================================================
-- 0147: DRIFT-012 CORRECTION — the live policy texts were READ (the fresh
--       sbp_ token arrived, 2026-10-11): the live DB MATCHES the committed
--       chain; the 2026-10-10 "tighter live behavior" was a probe-methodology
--       artifact (INSERT … RETURNING also evaluates the SELECT policy).
--       This migration defines the FINAL posture and supersedes 0146 §1.
--       (T-502, 153rd session, 2026-10-11)
-- ============================================================================
--
-- THE DISCOVERY (live evidence, 2026-10-11, the T-502 opening round):
--
--   1. pg_policies READ (the channel the dead token blocked):
--        notifications_insert (live)        = 0048's committed text
--        workforce_attendance_insert (live) = 0019's committed text
--      There is NO drift between the live catalog and the chain — the
--      DRIFT-012 registration is REFUTED at the catalog level.
--
--   2. The T-500 403s REPRODUCED and EXPLAINED without any drift:
--        the probes inserted with `?select=*` (Prefer: return=
--        representation). An INSERT … RETURNING in Postgres requires the
--        new row to pass the table's SELECT policy too — and
--        notifications_select / workforce_attendance_select are
--        recipient-/staff-scoped. Live-proven both directions (rolled
--        back, zero residue):
--          F8 shape WITHOUT RETURNING  → ALLOWED (the 0048 staff arm fires)
--          F8 shape WITH    RETURNING  → 42501 "new row violates row-level
--                                        security policy" (the READ-back is
--                                        blocked by notifications_select)
--          I2 shape WITHOUT RETURNING  → ALLOWED (the 0019 tenant-only text
--                                        allows ANY tenant member's punch)
--      The T-500 conclusion "the live INSERT policies are tighter" was the
--      SELECT-policy/RETURNING interaction misread as an insert-policy
--      gate. DRIFT-012 closes as REFUTED-with-mechanism.
--
--   3. WORKFORCE-503's open door is REAL on the insert side: under 0019's
--      tenant-only text a parent-role member's punch insert SUCCEEDS when
--      no RETURNING is requested (live-proven). The desktop's recordEvent
--      masks it only because it chains .select().single(). §2 below closes
--      the door for real — 0146 §2's hardening stands unchanged.
--
-- WHAT THIS MIGRATION DOES:
--   §1 restores notifications_insert to the 0048 COMMITTED text — undoing
--      0146 §1's self-target-only capture, whose premise ("the live policy
--      behaves as self-target only") is disproven above. The 0048 design
--      (staff writers + self-target + role-broadcast self-targeting)
--      remains the registered contract; the de-facto cross-target block
--      comes from notifications_select's RETURNING interaction, NOT from
--      the insert policy (registered as NOTIF-107 — the Alert Creator's
--      and the overdue generator's client inserts fail at the RETURNING
--      stage; zero source='manual'/'overdue' rows exist in production).
--   §2 re-asserts the workforce_attendance_insert hardening (identical to
--      0146 §2 — kept, not reverted): staff roles OR the personnel's own
--      linked account. This matches the workforce_attendance_select
--      authority union exactly, so no RETURNING trap is introduced: every
--      writer the policy admits can also read its own row back.
--   §3 registers this migration (T-091/MIG-TOKENS pattern).
--
-- APPLICATION CONTRACT: apply ATOMICALLY TOGETHER WITH 0146 (BEGIN; 0146;
--   0147; COMMIT; — scripts/apply_0146_0147_atomic_live.sh), so the live
--   DB never sits in 0146 §1's transient over-tightened state. A fresh
--   CLI deployment applies 0146 then 0147 in file order — same net state.
--
-- IDEMPOTENCY: drop-if-exists first — safe to re-apply.
--
-- VERIFICATION (post-apply, re-runnable — scripts/t502_postapply_verify.sql):
--   V1: notifications_insert catalog text contains the 0048 staff arm
--       (has_any_role … 'teacher') — the restore landed.
--   V2: workforce_attendance_insert catalog text contains the own-personnel
--       arm — the hardening landed.
--   V3: F8-shape insert WITH RETURNING, admin claims → still 42501 (the
--       de-facto cross-target read-back block — NOTIF-107's posture,
--       unchanged by design).
--   V4: parent-role punch WITHOUT RETURNING → now REFUSED (the closed
--       door — WORKFORCE-503 resolved for real).
--   V5: staff punch WITHOUT RETURNING → ALLOWED; own-personnel punch →
--       ALLOWED (the legitimate writers keep working).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. notifications_insert — restored to the 0048 committed text
-- ----------------------------------------------------------------------------
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        -- 0048 / T-071 / NOTIF-101 (restored by 0147 after 0146's
        -- disproven self-only capture): a notification may be inserted by
        -- (a) staff (the 5 canonical writer roles), (b) the target
        -- themselves, (c) a caller broadcasting to their OWN role.
        -- Cross-user DELIVERY remains the 0077 RPC's job; broadcast
        -- fan-out remains the 0075/0078 SECURITY DEFINER triggers' job.
        and (
            public.has_any_role(array['super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher'])
            or target_user_id = public.current_user_profile_id()
            or (target_role is not null and target_role = any(public.current_user_roles()))
        )
    );

comment on policy notifications_insert on public.notifications is
    '0147: restored to the 0048 text — the 2026-10-10 "self-target-only live behavior" was the INSERT…RETURNING/SELECT-policy interaction (NOTIF-107), not a tighter insert policy. DRIFT-012 refuted at the catalog level.';

-- ----------------------------------------------------------------------------
-- §2. workforce_attendance_insert — the hardening stands (0146 §2 re-asserted)
-- ----------------------------------------------------------------------------
drop policy if exists workforce_attendance_insert on public.workforce_attendance_events;
create policy workforce_attendance_insert on public.workforce_attendance_events
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        -- WORKFORCE-503 (0146 §2, kept by 0147): the 0019 tenant-only text
        -- let ANY authenticated tenant member punch for ANY personnel id
        -- (live-proven 2026-10-11: a parent-role punch WITHOUT a RETURNING
        -- clause succeeded). Staff roles OR the personnel's own linked
        -- account — mirroring workforce_attendance_select's authority
        -- union, so every admitted writer can read its row back.
        and (
            public.has_any_role(array['super_admin', 'support_staff', 'manager', 'financial_officer'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );

comment on policy workforce_attendance_insert on public.workforce_attendance_events is
    'WORKFORCE-503 closed (0146 §2, kept by 0147): staff roles or the personnel''s own linked account — the parent-role punch is refused on the INSERT itself, not just at the RETURNING read.';

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0147', '{0147_drift012_correction.sql}', 'drift012_correction')
on conflict (version) do nothing;
