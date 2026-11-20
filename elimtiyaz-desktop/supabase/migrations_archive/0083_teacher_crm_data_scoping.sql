-- ============================================================================
-- 0083_teacher_crm_data_scoping.sql — RBAC-302 fix (T-236, 35th session)
-- ============================================================================
-- DISCOVERY (2026-09-07, 35th session, owner mandate: "Personnel/Workforce
-- RBAC overhaul"): the owner-supplied external audit verified the CLIENT
-- boundary gaps (fixed client-side in T-234/T-235), but the DATA layer is
-- stricter-critical and the audit missed it — migration 0019 grants the
-- teacher role:
--
--   1. students_update: 'teacher' sits in the role list → a teacher JWT can
--      UPDATE student profile rows through PostgREST (names, parent link,
--      class assignment) even though the desktop UI gates EditStudent. The
--      owner's mandate is explicit: "Teachers cannot modify student
--      profiles, change promotion/academic status".
--   2. students_select: 'teacher' → tenant-WIDE read of the entire student
--      directory (all classes, not just their own).
--   3. parents_select: 'teacher' → tenant-wide read of PARENT records incl.
--      primary_phone — "sensitive CRM data" the mandate locks away from
--      operational staff (teachers have no parent-facing duty: roll-call
--      and grade entry never read the parents table).
--   4. assessments_select (0041's live version): 'teacher' → tenant-wide
--      read of every class's marks. (The legacy `grades` table from 0004
--      is NOT read by any client — the desktop grade engine reads/writes
--      `assessments` since 0029/0041 — so its 0019 policies are left
--      untouched; scoping them would change nothing any client can reach.)
--
-- The live policy expressions were dumped BEFORE writing this migration
-- (pg_policies on the live project) and match 0019/0041 exactly — zero
-- policy drift confirmed for the four surfaces this migration touches.
--
-- FIX: this migration scopes the teacher branch to the classes the teacher
-- is actually assigned to (homeroom classes via classes.homeroom_teacher_id,
-- subject classes via class_subjects.teacher_id — both FK → personnel.id,
-- and personnel.user_id → user_profiles.id = current_user_profile_id()),
-- and removes the teacher role outright from the two CRM write/read
-- surfaces it has no duty on (students_update, parents_select).
--
-- Cross-platform check (AGENTS.md §10) — every reader enumerated:
--   - Desktop: teacher workflows now load rosters per-class
--     (repos.students.observeByClass — T-235 embedded workspace); the
--     teacher never opens the CRM directory (T-234 matrix + route guards).
--     Administrative roles keep the tenant-wide branch unchanged.
--   - Android: teacher roll-call/grade-entry flows query per-class; the
--     roster screens are CRM-hub routes (VIEW_ROSTER) which teachers lose
--     in T-237. No legitimate read path narrows.
--   - Website: parent/student only (separate policies, untouched).
--
-- REGRESSION SAFETY: financial_officer/support_staff/manager/super_admin
-- branches are byte-identical to 0019; students_student_self and
-- students_parent_sees_own policies are untouched (separate policies).
--
-- IDEMPOTENCY: drop-policy-if-exists + create — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is
-- applied to the live project TOGETHER with its schema_migrations
-- registration in one atomic transaction (scripts/apply_0083_live.sh).
--
-- NOTE: the Management API SQL endpoint silently DROPS `comment on`
-- statements (AGENTS.md §11.1 quirk 1) — the catalog comments land on
-- fresh CLI deployments only. That is the documented live state.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. students_update — drop 'teacher' (mandate: teachers can NEVER write
--    student profiles). The remaining role list matches 0019 minus teacher.
-- ----------------------------------------------------------------------------
drop policy if exists students_update on public.students;
create policy students_update on public.students
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );

comment on policy students_update on public.students is
  'RBAC-302 fix (T-236, 35th session): teacher REMOVED from the update role list — student-profile writes are administrative-only (super_admin/financial_officer/support_staff), matching the UI EditStudent gate and the owner mandate.';

-- ----------------------------------------------------------------------------
-- 2. students_select — staff roles keep tenant-wide; the teacher branch is
--    scoped to the classes the caller teaches (homeroom OR subject
--    assignment via personnel.user_id = current_user_profile_id()).
-- ----------------------------------------------------------------------------
drop policy if exists students_select on public.students;
create policy students_select on public.students
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and deleted_at is null
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager'])
            or (
                public.has_role('teacher')
                and (
                    exists (
                        select 1
                          from public.classes c
                         where c.id = students.class_id
                           and c.homeroom_teacher_id in (
                               select p.id
                                 from public.personnel p
                                where p.user_id = public.current_user_profile_id()
                                  and p.deleted_at is null
                           )
                    )
                    or exists (
                        select 1
                          from public.class_subjects cs
                         where cs.class_id = students.class_id
                           and cs.teacher_id in (
                               select p.id
                                 from public.personnel p
                                where p.user_id = public.current_user_profile_id()
                                  and p.deleted_at is null
                           )
                    )
                )
            )
        )
    );

comment on policy students_select on public.students is
  'RBAC-302 fix (T-236, 35th session): teachers see ONLY students of the classes they teach (homeroom via classes.homeroom_teacher_id or subject via class_subjects.teacher_id, resolved through personnel.user_id); administrative roles keep tenant-wide reads.';

-- ----------------------------------------------------------------------------
-- 3. parents_select — drop 'teacher' entirely (no parent-facing duty;
--    roll-call/grade entry never read parents; the phone directory is
--    exactly the "sensitive CRM data" operational staff are locked out of).
-- ----------------------------------------------------------------------------
drop policy if exists parents_select on public.parents;
create policy parents_select on public.parents
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and deleted_at is null
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager'])
    );

comment on policy parents_select on public.parents is
  'RBAC-302 fix (T-236, 35th session): teacher REMOVED — the parent directory (incl. contact phone numbers) is administrative-only; teachers have no parent-facing duty in the roll-call/grade workflows.';

-- ----------------------------------------------------------------------------
-- 4. assessments_select — the canonical marks surface (0029/0041; the
--    legacy `grades` table is not read by any client). Staff roles keep
--    tenant-wide; parent/student self branches are preserved VERBATIM from
--    0041; the teacher branch is scoped to the students of the classes the
--    caller teaches (the same set the scoped students_select grants).
-- ----------------------------------------------------------------------------
drop policy if exists assessments_select on public.assessments;
create policy assessments_select on public.assessments
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'support_staff', 'financial_officer', 'manager'])
            OR (
                public.has_role('parent')
                AND student_id IN (
                    SELECT s.id FROM public.students s
                    JOIN public.parents p ON p.id = s.parent_id
                    WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL
                )
            )
            OR (
                public.has_role('student')
                AND student_id IN (
                    SELECT s.id FROM public.students s
                    WHERE s.auth_user_id = auth.uid() AND s.deleted_at IS NULL
                )
            )
            OR (
                public.has_role('teacher')
                AND student_id IN (
                    SELECT s.id FROM public.students s
                     WHERE s.deleted_at IS NULL
                       AND (
                           EXISTS (
                               SELECT 1 FROM public.classes c
                                WHERE c.id = s.class_id
                                  AND c.homeroom_teacher_id IN (
                                      SELECT p.id FROM public.personnel p
                                       WHERE p.user_id = public.current_user_profile_id()
                                         AND p.deleted_at IS NULL
                                  )
                           )
                           OR EXISTS (
                               SELECT 1 FROM public.class_subjects cs
                                WHERE cs.class_id = s.class_id
                                  AND cs.teacher_id IN (
                                      SELECT p.id FROM public.personnel p
                                       WHERE p.user_id = public.current_user_profile_id()
                                         AND p.deleted_at IS NULL
                                  )
                           )
                       )
                )
            )
        )
    );

comment on policy assessments_select on public.assessments is
  'RBAC-302 fix (T-236, 35th session): the teacher branch is scoped to the students of their assigned classes (homeroom or subject assignment); 0041''s parent-own/student-self branches preserved verbatim; administrative roles keep tenant-wide reads.';

-- ----------------------------------------------------------------------------
-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0083_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0083', '{0083_teacher_crm_data_scoping.sql}', 'teacher_crm_data_scoping')
on conflict (version) do nothing;
