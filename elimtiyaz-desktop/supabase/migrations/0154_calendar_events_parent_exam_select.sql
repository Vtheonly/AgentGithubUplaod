-- ============================================================================
-- 0154_calendar_events_parent_exam_select.sql
-- ============================================================================
-- T-525 (UI-343 companion + CROSS-201 + SEC-117, 169th session 2026-10-13) —
-- the exam & homework calendar-visibility mandate (the owner's issue):
--
--   1. `calendar_events_select` gains THE PARENT BRANCH: a parent may read
--      EXAM events (target_entity_type = 'exam') scoped to the classes of
--      THEIR OWN children — the canonical 0041 parent-scope pattern
--      (students ⋈ parents on auth_user_id, deleted_at IS NULL on both).
--      This is the read window that carries Pedagogy-scheduled exams to the
--      parent portal calendar ("Exam Timetable — Dates, Rooms, Invigilators"
--      per the portal plan) once the desktop scheduling surface (T-525
--      phase 4) writes them. It is NOT a weakening: the branch exposes ONLY
--      exam rows tied to the parent's children's classes — no staff events,
--      no follow-up calls, no other families' data. The 0126/PERF-509
--      InitPlan-hoist shape (the (select …) wrappers) is preserved.
--
--   2. `calendar_events_admin` (0019) — THE ROLE CHECK IT NEVER HAD: the
--      policy was `for all … using (tenant_id = current_tenant_id())` with
--      NO role predicate, so EVERY authenticated tenant member — including
--      PARENTS — could INSERT/UPDATE/soft-DELETE staff calendar events (and,
--      because PostgreSQL ORs permissive policies per command, the same
--      policy leaked the whole tenant's events to parent SELECTs). Live
--      proof (T-525 §15.39 probe, 2026-10-13): a parent-JWT impersonation
--      INSERT SUCCEEDED. Every sibling 0019 `_admin` policy
--      (role_assignments_admin, academic_levels_admin, classes_admin,
--      tenant_role_overrides_admin …) carries has_role/has_any_role — the
--      omission is an oversight, not a design. The fix adds the staff role
--      list — the SAME list calendar_events_select already grants (the
--      desktop gates event creation behind `!!session`, i.e. any signed-in
--      staff member).
--
--      The tightening and the parent read branch ship in ONE migration on
--      purpose: tightening _admin alone would strip parents of the
--      (accidental) read that currently makes ANY event reachable — the
--      exam feature needs the intentional, scoped window to exist in the
--      same instant the accidental one closes.
--
--   PLATFORM IMPACT: the desktop (the only calendar_events writer —
--   T-175's SupabaseCalendarRepository) is staff-only and unaffected (its
--   session carries a staff role). The website's parent portal reads
--   calendar_events through useUpcomingEvents / useEventsInRange: staff
--   users (if any ever sign in there) keep the staff read; parents get
--   exam rows for their children's classes. The Android app does not touch
--   calendar_events. No consumer of the previous accidental parent-wide
--   exposure exists BY DESIGN (0019's role list never included 'parent').
--
--   NOTE ON THE EXAM ROW SHAPE (CROSS-201): exams are stored as
--   kind = 'custom' (0013's CHECK constraint is untouched) +
--   target_entity_type = 'exam' + target_entity_id = <class id> +
--   location = <room> + target_name = <invigilator> — the portal's
--   documented contract (elimtiyaz-website src/features/calendar/event-kind.ts).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. calendar_events_select — the 0126 staff shape + the parent exam branch.
-- ----------------------------------------------------------------------------
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and is_deleted = false
        and (
            (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager',
                                  'teacher', 'buyer', 'driver', 'warehouse_worker', 'worker']))
            or (
                (select public.has_role('parent'))
                and target_entity_type = 'exam'
                and target_entity_id in (
                    select s.class_id
                    from public.students s
                    join public.parents p on p.id = s.parent_id
                    where p.auth_user_id = auth.uid()
                      and p.deleted_at is null
                      and s.deleted_at is null
                      and s.class_id is not null
                )
            )
        )
    );

comment on policy calendar_events_select on public.calendar_events is
    'T-525 (CROSS-201/SEC-117): the 0126 staff read (InitPlan-hoisted) + the parent branch — exam events (target_entity_type=''exam'') scoped to the parent''s own children''s classes (the 0041 parent-scope pattern). The portal calendar''s exam read window.';

-- ----------------------------------------------------------------------------
-- §2. calendar_events_admin — the staff role check (SEC-117).
-- ----------------------------------------------------------------------------
drop policy if exists calendar_events_admin on public.calendar_events;
create policy calendar_events_admin on public.calendar_events
    for all to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager',
                                  'teacher', 'buyer', 'driver', 'warehouse_worker', 'worker']))
    )
    with check (
        tenant_id = (select public.current_tenant_id())
        and (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager',
                                  'teacher', 'buyer', 'driver', 'warehouse_worker', 'worker']))
    );

comment on policy calendar_events_admin on public.calendar_events is
    'T-525 (SEC-117): the 0019 tenant-scoped FOR ALL policy gains the staff role list every sibling _admin policy already carried — parents (and any non-staff member) can no longer write or delete staff calendar events, and the accidental tenant-wide parent SELECT through this policy is closed (parents read through the exam-scoped calendar_events_select branch).';

-- ----------------------------------------------------------------------------
-- §3. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0154', '{0154_calendar_events_parent_exam_select.sql}', 'calendar_events_parent_exam_select')
on conflict (version) do nothing;
