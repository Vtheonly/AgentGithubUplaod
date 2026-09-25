-- ============================================================================
-- 0116_student_application_approval.sql — T-413: the complete student
-- application approval + enrollment + portal/messaging synchronization
-- ============================================================================
-- OWNER MANDATE (T-413, 97th session):
--   "Fix the complete student onboarding and synchronization flow so
--    approved students become fully active across the system, including
--    class enrollment, portal access, messaging, and Pedagogy
--    visibility/search."
--
-- Problems addressed (registered by T-413):
--
--   STUDENT-100 — approving a student application NEVER created a student:
--     approve_account_request (0005/0047) can only bind an EXISTING student
--     (p_target_student_id); the approve-signup-request EF has no
--     create-student branch; the desktop ApprovalsTab only renders parent
--     flows. The approved user was active in auth but the CHILD never
--     existed in `students` — invisible in CRM/Pedagogy/Finance/Messaging.
--
--   STUDENT-101 — no STUDENT-102 guard: the EF's PARENT-102 guard (T-132)
--     refuses parent approvals without a binding, but a STUDENT-role
--     approve with NEITHER target_student_id NOR a create path sailed
--     through — the exact "active but unbound" limbo, student edition.
--
--   STUDENT-102 — the website had NO student-application surface: Google
--     OAuth signups land in the queue with requested_role='parent' (the
--     0002 trigger default) and free-text notes only. The applying family
--     had no structured way to submit the child's enrollment request
--     (name, DOB, gender, level).
--
--   STUDENT-103 — student-bound portal access was DEAD: the website
--     auth-provider resolves ONLY parents by auth_user_id — a student whose
--     students.auth_user_id is bound stays "pending" forever (approved +
--     bound but the portal shows the activation wall); and RLS gave a
--     student no path to read their own parent row.
--
--   STUDENT-104 — messaging eligibility gap: open_parent_admin_channel
--     (0067, ADR-012) gates on the parent role — an approved student
--     account could never reach the Administrator through the sanctioned
--     user↔admin channel.
--
-- What this migration adds:
--
--   §1  account_approval_requests.student_application jsonb — the
--       structured application payload the website's pending user attaches
--       (student identity + sought grade level + note).
--   §2  Self-service attach path: the pending user can UPDATE ONLY that
--       column on their OWN pending request (RLS policy + column-guard
--       trigger — the 0046 parent-self-update pattern; every other column
--       change is rejected for non-staff callers).
--   §3  approve_student_application(p_…) — the ONE server-side composite
--       (the §15.39 PERF-501 lesson): binds an existing student OR creates
--       the full canonical student record (deterministic parent code when
--       a new family is needed, ELV-{year}-{seq} student code, class
--       enrollment, student_academic_histories entry, account activation)
--       by REUSING approve_account_request internally (§6 rule) — one
--       transaction, zero partial states.
--   §4  parents_student_sees_own RLS policy — a student-bound account can
--       read their own parent row (the portal's family context header).
--   §5  open_parent_admin_channel extended to student accounts (ADR-012's
--       user↔Administrator scope; staff exclusion unchanged).
--
-- Caller verification posture: §3 is SECURITY DEFINER (the same posture as
-- approve_account_request 0005/0044/0047 — called by the approve-signup-
-- request Edge Function AFTER the EF verified the human caller is
-- super_admin/support_staff). §2's trigger verifies the caller's role via
-- has_any_role (the 0046 pattern). No RLS weakening anywhere: §4 ADDS a
-- narrow self-scoped read path (a student sees ONLY their own parent row).
--
-- IDENTITY CODES: parents via fn_deterministic_parent_code (0065 — FNV-1a
-- of identity fields, re-approval converges on the same code, the unique
-- (tenant_id, parent_code) constraint refuses duplicates); students via
-- public.student_seq (0022/0065 — 'ELV-{year}-{6-digit}').
--
-- IDENTITY-CODE note (§15.46b class): every uuid the RPC receives
-- (p_target_student_id, p_target_parent_id, class_id) is validated against
-- the tenant BEFORE use — a fabricated id fails closed with 'not found'.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is
-- applied to the live project TOGETHER with its schema_migrations
-- registration in one atomic transaction.
--
-- LIVE DISCOVERY (T-413 E2E, 97th session — the GoTrue metadata-timing trap):
-- the admin createUser REST/SDK call RETURNS app_metadata in its response but
-- raw_app_meta_data is NOT yet populated on the auth.users INSERT row when
-- handle_new_auth_user() fires — the AFTER-INSERT trigger always sees the
-- SELF-SIGNUP path (live-proven: an invited probe user got
-- requested_role='parent' + phone=NULL despite app_metadata.created_by_admin
-- being present in the stored row afterwards). Consequence: NO pending
-- student-role request can ever arise from a signup — the T-413 student path
-- therefore begins with the ADMIN's approval-time reclassification
-- (approve-signup-request EF, assign_role='student'), which this migration's
-- RPC then honours.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1  Structured student-application payload on the approval request
-- ----------------------------------------------------------------------------
alter table public.account_approval_requests
    add column if not exists student_application jsonb;

comment on column public.account_approval_requests.student_application is
    'T-413 (STUDENT-102): the structured enrollment application a pending web user attaches — {"student": {first_name, last_name, date_of_birth, gender}, "grade_level_code": "5ap", "note": "…"}. Read by the desktop ApprovalsTab to pre-fill the student-creation form; consumed by approve_student_application when the admin approves.';

-- ----------------------------------------------------------------------------
-- §2  Self-service attach: the pending user may update ONLY this column
--     on their OWN pending request.
--
--     NOTE the SELECT policy: PostgreSQL folds the applicable SELECT-policy
--     predicates into the UPDATE path (row visibility AND the effective
--     WITH CHECK side — the RLS-500 lesson), so the UPDATE policy alone
--     would make every self-update a SILENT ZERO-ROW no-op while the only
--     SELECT policy (0019's staff-only approval_requests_select_admin)
--     hides the row from its own requester. The own-pending SELECT policy
--     below is what makes the attach path actually reachable.
-- ----------------------------------------------------------------------------
drop policy if exists approval_requests_select_own_pending on public.account_approval_requests;
create policy approval_requests_select_own_pending
    on public.account_approval_requests
    for select to authenticated
    using (auth_user_id = auth.uid() and status = 'pending');

drop policy if exists approval_requests_update_own_application on public.account_approval_requests;
create policy approval_requests_update_own_application
    on public.account_approval_requests
    for update to authenticated
    using (auth_user_id = auth.uid() and status = 'pending')
    with check (auth_user_id = auth.uid() and status = 'pending');

-- Column-guard trigger: a non-staff self-update may ONLY touch
-- student_application (+ the updated_at touch below). Every other column
-- change is rejected — a self-updater can never flip status, swap
-- target ids, or rewrite their identity fields (the 0046
-- parent-self-update-column-gate pattern).
--
-- TRUSTED CONTEXTS that bypass the column guard:
--   * the service_role JWT — the Edge Functions' trusted write path
--     (approve-signup-request / approve_account_request via the EF's
--     service client, the 0059 v_caller_is_service_role pattern);
--   * staff callers (super_admin / support_staff — the 0019 update
--     policy's own role set).
create or replace function public.enforce_application_self_update_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- No JWT context at all = a direct DB session (psql / SQL console /
    -- migrations). The postgres role bypasses RLS anyway (RLS's own trust
    -- model); the column guard cannot add security against the DB owner.
    if auth.jwt() is null then
        return new;
    end if;

    -- The EF's service-role client (approve/reject RPC writes) is the
    -- trusted administrative path — auth.uid() is NULL there, so the
    -- self-ownership check below must not run.
    if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
        return new;
    end if;

    -- Staff (direct PostgREST admin updates) keep the full 0019 policy.
    if public.has_any_role(array['super_admin', 'support_staff']) then
        return new;
    end if;

    -- A self-update must target the caller's own pending request (the §2
    -- policy already enforces this on visibility; the trigger re-asserts on
    -- the value level for defence in depth).
    if old.auth_user_id is distinct from auth.uid() then
        raise exception 'student_application self-update: not the caller''s request'
            using errcode = '42501';
    end if;

    if new.auth_user_id is distinct from old.auth_user_id
       or new.status is distinct from old.status
       or new.requested_role is distinct from old.requested_role
       or new.email is distinct from old.email
       or new.tenant_id is distinct from old.tenant_id
       or new.target_parent_id is distinct from old.target_parent_id
       or new.target_student_id is distinct from old.target_student_id
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.decision_note is distinct from old.decision_note
       or new.activation_code is distinct from old.activation_code
       or new.national_id is distinct from old.national_id
       or new.phone is distinct from old.phone
       or new.full_name is distinct from old.full_name
       or new.notes_from_user is distinct from old.notes_from_user then
        raise exception 'student_application self-update may only change the student_application payload (migration 0116 §2)'
            using errcode = '42501';
    end if;

    new.updated_at := now();
    return new;
end;
$$;

comment on function public.enforce_application_self_update_columns is
    'T-413 / STUDENT-102: column gate for the account_approval_requests self-update path — a non-staff caller may only attach their student_application payload to their own pending request.';

drop trigger if exists account_approval_self_update_guard on public.account_approval_requests;
create trigger account_approval_self_update_guard
    before update on public.account_approval_requests
    for each row
    execute function public.enforce_application_self_update_columns();

-- ----------------------------------------------------------------------------
-- §3  approve_student_application — the ONE composite approval RPC
-- ----------------------------------------------------------------------------
create or replace function public.approve_student_application(
    p_request_id uuid,
    p_reviewer_profile_id uuid,
    p_decision_note text default null,
    p_target_student_id uuid default null,
    p_target_parent_id uuid default null,
    p_new_parent jsonb default null,
    p_new_student jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_request record;
    v_parent_id uuid;
    v_student_id uuid;
    v_student_code text;
    v_class record;
    v_class_id uuid;
    v_class_grade_code text;
    v_grade_level_code text;
    v_level record;
    v_year record;
    v_role_id uuid;
    v_existing_student_auth uuid;
    v_seq integer;
    v_is_new_student boolean := false;
    v_audit_id uuid;
    v_parent_code text;
begin
    -- Lock the request (the 0005/0047 pattern).
    select * into v_request
      from public.account_approval_requests
     where id = p_request_id
       and status = 'pending'
     for update;

    if not found then
        raise exception 'approve_student_application: request not found or already processed'
            using errcode = 'P0001';
    end if;

    if v_request.requested_role not in ('parent', 'student') then
        raise exception 'approve_student_application: this RPC approves parent/student applications (requested_role=%)', v_request.requested_role
            using errcode = 'P0001';
    end if;

    -- STUDENT-101 guard (the PARENT-102 lesson, student edition): a
    -- STUDENT-role approval REQUIRES a student binding — target_student_id
    -- (bind existing) OR new_student (create). Otherwise the user would be
    -- active but unbound — the limbo this migration closes.
    if v_request.requested_role = 'student' then
        if p_target_student_id is null and (p_new_student is null or p_new_student = 'null'::jsonb) then
            raise exception 'approve_student_application: a student approval requires target_student_id or new_student (otherwise the user would be active but unbound to any student profile)'
                using errcode = 'P0001';
        end if;
        if p_target_student_id is not null and p_new_student is not null and p_new_student <> 'null'::jsonb then
            raise exception 'approve_student_application: pass either target_student_id (bind existing) or new_student (create), not both'
                using errcode = 'P0001';
        end if;
        if p_target_student_id is not null and p_new_parent is not null and p_new_parent <> 'null'::jsonb then
            raise exception 'approve_student_application: new_parent is only valid when creating a student (pass target_student_id alone to bind an existing student)'
                using errcode = 'P0001';
        end if;
    else
        -- PARENT-role: this RPC is the "approve the family AND enroll the
        -- child" composite. A parent-role approval with p_target_student_id
        -- is a category error (the account binds the PARENT, not a student),
        -- and calling this RPC at all requires a student to enroll — the
        -- plain bind-only parent approval goes through approve_account_request
        -- directly (the existing EF path, unchanged).
        if p_target_student_id is not null then
            raise exception 'approve_student_application: a parent-role approval cannot bind target_student_id (bind the parent; the student is created under the family)'
                using errcode = 'P0001';
        end if;
        if p_new_student is null or p_new_student = 'null'::jsonb then
            raise exception 'approve_student_application: a parent-role approval through this RPC requires new_student (use the plain parent approval path for bind-only approvals)'
                using errcode = 'P0001';
        end if;
        if p_target_parent_id is null and (p_new_parent is null or p_new_parent = 'null'::jsonb) then
            raise exception 'approve_student_application: a parent-role approval requires target_parent_id or new_parent (PARENT-102, migration 0047)'
                using errcode = 'P0001';
        end if;
    end if;

    if p_target_parent_id is not null and p_new_parent is not null and p_new_parent <> 'null'::jsonb then
        raise exception 'approve_student_application: pass either target_parent_id (existing family) or new_parent (create family), not both'
            using errcode = 'P0001';
    end if;

    -- ------------------------------------------------------------------
    -- Branch A (student-role only): bind an EXISTING student
    -- (the 0047 rebind-guard semantics)
    -- ------------------------------------------------------------------
    if v_request.requested_role = 'student' and p_target_student_id is not null then
        select id, auth_user_id, student_code, parent_id
          into v_student_id, v_existing_student_auth, v_student_code, v_parent_id
          from public.students
         where id = p_target_student_id
           and tenant_id = v_request.tenant_id
           and deleted_at is null;

        if v_student_id is null then
            raise exception 'approve_student_application: target student % not found in tenant (or deleted)', p_target_student_id
                using errcode = 'P0002';
        end if;

        if v_existing_student_auth is not null
           and v_existing_student_auth is distinct from v_request.auth_user_id then
            raise exception
                'approve_student_application: student % is already bound to a different auth_user_id (%). Unbind the previous account via the RBAC editor before approving this request.',
                p_target_student_id, v_existing_student_auth
                using hint = 'Use the RBAC editor to clear students.auth_user_id first, then re-approve.',
                    errcode = 'P0001';
        end if;
    else
        -- ------------------------------------------------------------------
        -- Branch B: CREATE the student (the STUDENT-100 fix) — student-role
        -- requests create the student + family; parent-role requests create
        -- the child under the resolved/created family.
        -- ------------------------------------------------------------------

        -- B.1 resolve the parent (students.parent_id is NOT NULL — plan §04.01)
        if p_new_parent is not null and p_new_parent <> 'null'::jsonb then
            if coalesce(btrim(p_new_parent->>'first_name'), '') = ''
               or coalesce(btrim(p_new_parent->>'last_name'), '') = ''
               or coalesce(btrim(p_new_parent->>'primary_phone'), '') = '' then
                raise exception 'approve_student_application: new_parent requires first_name, last_name and primary_phone (the canonical code generator has no random fallback — DRIFT-001, migration 0065)'
                    using errcode = 'P0001';
            end if;

            v_parent_code := public.fn_deterministic_parent_code(
                extract(year from now())::int,
                btrim(p_new_parent->>'primary_phone'),
                p_new_parent->>'display_name',
                btrim(p_new_parent->>'first_name'),
                btrim(p_new_parent->>'last_name')
            );

            insert into public.parents (
                tenant_id, parent_code, first_name, last_name, primary_phone,
                email, national_id, address, city, relationship,
                is_active, created_at, updated_at
            ) values (
                v_request.tenant_id,
                v_parent_code,
                btrim(p_new_parent->>'first_name'),
                btrim(p_new_parent->>'last_name'),
                btrim(p_new_parent->>'primary_phone'),
                nullif(btrim(coalesce(p_new_parent->>'email', v_request.email)), ''),
                nullif(btrim(p_new_parent->>'national_id'), ''),
                nullif(btrim(p_new_parent->>'address'), ''),
                nullif(btrim(p_new_parent->>'city'), ''),
                coalesce(nullif(btrim(p_new_parent->>'relationship'), ''), 'father'),
                true, now(), now()
            )
            -- The deterministic code makes the re-run converge on the SAME
            -- family instead of duplicating (the 0065 idempotency contract:
            -- "the dedup match IS the code").
            on conflict (tenant_id, parent_code) do update
               set email = coalesce(public.parents.email, excluded.email),
                   updated_at = now()
            returning id into v_parent_id;

            v_audit_id := public.write_audit_log(
                p_tenant_id   := v_request.tenant_id,
                p_action      := 'parent.create',
                p_entity_type := 'parent',
                p_entity_id   := v_parent_id,
                p_actor_id    := p_reviewer_profile_id,
                p_after_json  := jsonb_build_object(
                    'source', 'approve_student_application (migration 0116)',
                    'parent_code', v_parent_code
                ),
                p_note        := 'Created parent profile during student-application approval'
            );
        elsif p_target_parent_id is not null then
            select id into v_parent_id
              from public.parents
             where id = p_target_parent_id
               and tenant_id = v_request.tenant_id
               and deleted_at is null;

            if v_parent_id is null then
                raise exception 'approve_student_application: target parent % not found in tenant (or deleted)', p_target_parent_id
                    using errcode = 'P0002';
            end if;
        else
            raise exception 'approve_student_application: creating a student requires target_parent_id or new_parent (students.parent_id is NOT NULL — plan §04.01)'
                using errcode = 'P0001';
        end if;

        -- B.2 validate the student payload
        if coalesce(btrim(p_new_student->>'first_name'), '') = ''
           or coalesce(btrim(p_new_student->>'last_name'), '') = ''
           or coalesce(p_new_student->>'date_of_birth', '') = '' then
            raise exception 'approve_student_application: new_student requires first_name, last_name and date_of_birth'
                using errcode = 'P0001';
        end if;
        if (p_new_student->>'date_of_birth')::date >= current_date then
            raise exception 'approve_student_application: date_of_birth must be in the past'
                using errcode = '22023';
        end if;

        -- B.3 resolve class + grade level (mutual derivation: an explicit
        -- grade_level_code wins; otherwise the class's own level defines it).
        v_class_id := nullif(btrim(coalesce(p_new_student->>'class_id', '')), '')::uuid;
        v_grade_level_code := nullif(btrim(coalesce(p_new_student->>'grade_level_code', '')), '');

        if v_class_id is not null then
            select c.id, c.name, c.code, l.grade_code as level_grade_code,
                   l.cycle as level_cycle, l.year_number as level_year_number
              into v_class
              from public.classes c
              left join public.academic_levels l on l.id = c.academic_level_id
             where c.id = v_class_id
               and c.tenant_id = v_request.tenant_id;

            if v_class.id is null then
                raise exception 'approve_student_application: class % not found in tenant', v_class_id
                    using errcode = 'P0002';
            end if;

            v_class_grade_code := v_class.level_grade_code;
            if v_grade_level_code is null then
                v_grade_level_code := v_class_grade_code;
            elsif v_class_grade_code is not null and v_class_grade_code <> v_grade_level_code then
                raise exception 'approve_student_application: grade_level_code % does not match class % (whose level is %)', v_grade_level_code, v_class_id, v_class_grade_code
                    using errcode = '22023';
            end if;
        end if;

        -- B.4 create the student — the canonical ELV-{year}-{6-digit} code
        v_seq := nextval('public.student_seq');
        v_student_code := 'ELV-' || extract(year from now())::text || '-' || lpad(v_seq::text, 6, '0');

        insert into public.students (
            tenant_id, parent_id, student_code,
            first_name, middle_name, last_name, display_name,
            date_of_birth, gender,
            grade_level_code, grade_level_id, class_id,
            enrollment_date, enrollment_status,
            medical_notes, is_active,
            created_at, updated_at
        ) values (
            v_request.tenant_id, v_parent_id, v_student_code,
            btrim(p_new_student->>'first_name'),
            nullif(btrim(p_new_student->>'middle_name'), ''),
            btrim(p_new_student->>'last_name'),
            nullif(btrim(coalesce(p_new_student->>'display_name', '')), ''),
            (p_new_student->>'date_of_birth')::date,
            nullif(btrim(p_new_student->>'gender'), ''),
            v_grade_level_code,
            (select l.id from public.academic_levels l
              where l.grade_code = v_grade_level_code
                and l.tenant_id = v_request.tenant_id
              limit 1),
            v_class_id,
            current_date, 'active',
            nullif(btrim(p_new_student->>'medical_notes'), ''),
            true, now(), now()
        )
        returning id into v_student_id;

        v_is_new_student := true;

        -- B.5 the canonical enrollment record: student_academic_histories
        -- (0029) — one entry for the CURRENT academic year so the student is
        -- immediately visible in Pedagogy history/provenance consumers
        -- (the T-402 lesson: Supabase mode reads the table, not the
        -- legacy column). Column shape mirrors 0059's
        -- execute_batch_promotion insert verbatim.
        select * into v_year
          from public.academic_years
         where tenant_id = v_request.tenant_id
           and is_current
           and not is_archived
         order by start_date desc
         limit 1;

        if found and v_grade_level_code is not null then
            select * into v_level
              from public.academic_levels
             where grade_code = v_grade_level_code
               and tenant_id = v_request.tenant_id
             limit 1;

            if v_level.id is not null then
                insert into public.student_academic_histories (
                    tenant_id, student_id, academic_year,
                    cycle, grade_code, grade_year,
                    class_id, class_name,
                    gpa, decision, narrative
                ) values (
                    v_request.tenant_id, v_student_id, v_year.label,
                    v_level.cycle, v_grade_level_code,
                    coalesce(v_level.year_number, 1),
                    v_class_id,
                    (select c.name from public.classes c where c.id = v_class_id),
                    0, 'promoted',
                    'Enrollment record created by the student-application approval (migration 0116, T-413).'
                )
                on conflict (student_id, academic_year) do nothing;
            end if;
        end if;

        v_audit_id := public.write_audit_log(
            p_tenant_id   := v_request.tenant_id,
            p_action      := 'student.create',
            p_entity_type := 'student',
            p_entity_id   := v_student_id,
            p_actor_id    := p_reviewer_profile_id,
            p_after_json  := jsonb_build_object(
                'source', 'approve_student_application (migration 0116)',
                'student_code', v_student_code,
                'parent_id', v_parent_id,
                'class_id', v_class_id,
                'grade_level_code', v_grade_level_code
            ),
            p_note        := 'Created student during student-application approval'
        );
    end if;

    -- ------------------------------------------------------------------
    -- Reuse the canonical approval: role assignment + profile activation +
    -- binding + its own audit entries (0005/0047 — the §6 rule).
    -- A student-role approval binds the STUDENT; a parent-role approval
    -- binds the PARENT (0005 semantics preserved verbatim).
    -- ------------------------------------------------------------------
    if v_request.requested_role = 'student' then
        v_role_id := public.approve_account_request(
            p_request_id,
            p_reviewer_profile_id,
            null,
            v_student_id,
            p_decision_note
        );
    else
        v_role_id := public.approve_account_request(
            p_request_id,
            p_reviewer_profile_id,
            v_parent_id,
            null,
            p_decision_note
        );
    end if;

    return jsonb_build_object(
        'student_id', v_student_id,
        'student_code', v_student_code,
        'parent_id', v_parent_id,
        'role_id', v_role_id,
        'created_student', v_is_new_student
    );
end;
$$;

comment on function public.approve_student_application is
    'T-413 / STUDENT-100: the ONE composite student-application approval — binds an existing student or creates the canonical student record (deterministic parent code, ELV student code, class enrollment, student_academic_histories entry) and activates the account by REUSING approve_account_request internally. SECURITY DEFINER called by the approve-signup-request EF after caller-role verification.';

grant execute on function public.approve_student_application(uuid, uuid, text, uuid, uuid, jsonb, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- §4  Student-bound portal access: a student account can read their OWN
--     parent row (the portal family-context header). Self-scoped: the
--     helper resolves the caller's OWN student row and compares parent ids.
--     (STUDENT-103.)
--
--     RECURSION NOTE (the OPS-314 class — caught live by the T-413 E2E):
--     a DIRECT `exists (select 1 from students where … parent_id = parents.id)`
--     in this policy creates a parents↔students policy cycle — the students
--     policies already subquery parents (0019's students_parent_sees_own), so
--     adding the reverse edge produced `42P17 infinite recursion detected in
--     policy for relation "students"` on EVERY parent/student read for
--     non-staff roles. The fix is the documented Supabase pattern for mutual
--     references (the 0067 profile_has_staff_role precedent): a read-only
--     SECURITY DEFINER helper that does the student lookup OUTSIDE the
--     caller's RLS, exposing nothing beyond a boolean.
-- ----------------------------------------------------------------------------
create or replace function public.is_own_parent_via_student(p_parent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.students s
         where s.auth_user_id = auth.uid()
           and s.deleted_at is null
           and s.parent_id = p_parent_id
    );
$$;

comment on function public.is_own_parent_via_student is
    'T-413 / STUDENT-103: TRUE when the caller is the bound student of the given parent (the parents_student_sees_own RLS path). SECURITY DEFINER so the parents policy does not recurse into the students policies (the 0067 profile_has_staff_role pattern).';

drop policy if exists parents_student_sees_own on public.parents;
create policy parents_student_sees_own
    on public.parents
    for select to authenticated
    using (
        deleted_at is null
        and public.is_own_parent_via_student(parents.id)
    );

-- The policy evaluates as the calling role — grant EXECUTE on the helper
-- (the 0067 profile_has_staff_role convention).
grant execute on function public.is_own_parent_via_student(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- §5  Messaging eligibility: open_parent_admin_channel extended to
--     student accounts (STUDENT-104). ADR-012's scope is user↔Administrator;
--     an approved student account reaches the same Administrator channel.
--     Staff exclusion + the deterministic DM code are unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.open_parent_admin_channel(
    p_name text default null
)
returns public.chat_channels
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me     uuid := public.current_user_profile_id();
    v_tenant uuid := public.current_tenant_id();
    v_admin  uuid;
    v_a      uuid;
    v_b      uuid;
    v_code   text;
    v_ch     public.chat_channels;
begin
    if v_me is null then
        raise exception 'open_parent_admin_channel: no user profile for the caller (auth.uid() has no user_profiles row)'
            using errcode = '42501';
    end if;
    if v_tenant is null then
        raise exception 'open_parent_admin_channel: caller has no tenant'
            using errcode = '42501';
    end if;

    -- T-413 / STUDENT-104: the user side of the messenger is for PARENT and
    -- STUDENT accounts (an approved student is a system user who may reach
    -- the Administration — ADR-012's user↔admin scope). Staff keep using
    -- create_direct_channel (0061).
    if not exists (
        select 1
          from public.role_assignments ra
          join public.roles r on r.id = ra.role_id
         where ra.user_profile_id = v_me
           and (ra.tenant_id = v_tenant or ra.tenant_id is null)
           and ra.revoked_at is null
           and r.code in ('parent', 'student')
    ) then
        raise exception 'open_parent_admin_channel: only parent or student accounts may open the administration channel'
            using errcode = '42501';
    end if;
    if public.has_any_role(array['super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher']) then
        raise exception 'open_parent_admin_channel: staff members must use create_direct_channel (0061)'
            using errcode = '42501';
    end if;

    -- Resolve the Administrator: the tenant's oldest ACTIVE super_admin,
    -- falling back to the oldest ACTIVE support_staff.
    select up.id into v_admin
      from public.user_profiles up
      join public.role_assignments ra on ra.user_profile_id = up.id and ra.revoked_at is null
      join public.roles r on r.id = ra.role_id
     where r.code = 'super_admin'
       and (ra.tenant_id = v_tenant or ra.tenant_id is null)
       and up.status = 'active'
     order by up.created_at
     limit 1;

    if v_admin is null then
        select up.id into v_admin
          from public.user_profiles up
          join public.role_assignments ra on ra.user_profile_id = up.id and ra.revoked_at is null
          join public.roles r on r.id = ra.role_id
         where r.code = 'support_staff'
           and (ra.tenant_id = v_tenant or ra.tenant_id is null)
           and up.status = 'active'
         order by up.created_at
         limit 1;
    end if;

    if v_admin is null then
        raise exception 'open_parent_admin_channel: no active administrator account found for this tenant (create the super_admin account first)'
            using errcode = '02000';
    end if;
    if v_admin = v_me then
        raise exception 'open_parent_admin_channel: the administrator cannot open a channel with themselves'
            using errcode = '22023';
    end if;

    -- Deterministic idempotent DM code — the SAME pair algorithm as 0061's
    -- create_direct_channel, so the channel a user opens here is the very
    -- channel the staff side's openParentChannel/create_direct_channel
    -- would resolve to for the same pair (one conversation per pair).
    v_a := least(v_me, v_admin);
    v_b := greatest(v_me, v_admin);
    v_code := 'DM-' || v_a || '-' || v_b;

    insert into public.chat_channels (
        tenant_id, code, name, channel_type, member_ids, created_by, description
    ) values (
        v_tenant, v_code,
        coalesce(nullif(btrim(p_name), ''), 'Administration'),
        'direct', array[v_a, v_b], v_me,
        'User (parent/student) to administration channel (0067, ADR-012; student eligibility added by 0116, T-413)'
    )
    on conflict (tenant_id, code) do nothing
    returning * into v_ch;

    if v_ch is null then
        -- Already exists (idempotent re-open by either member of the pair).
        select * into v_ch
          from public.chat_channels
         where tenant_id = v_tenant and code = v_code;
    end if;

    if v_ch is null then
        raise exception 'open_parent_admin_channel: channel vanished after upsert'
            using errcode = '22023';
    end if;

    -- Audit the creation (0014 convention; mirrors 0061's chat.channel_create).
    if v_ch.created_by = v_me then
        insert into public.audit_logs (
            tenant_id, action, entity_type, entity_id, actor_id, after_json, note
        ) values (
            v_tenant, 'chat.parent_admin_channel_open', 'chat_channel', v_ch.id, v_me,
            to_jsonb(v_ch), 'open_parent_admin_channel (idempotent RPC, migration 0067 / ADR-012; student eligibility: 0116, T-413)'
        );
    end if;

    return v_ch;
end;
$$;

comment on function public.open_parent_admin_channel is
    'CHAT-200a (0067 / ADR-012; student eligibility added by 0116 / T-413): the USER side of the messenger — idempotently opens (or returns) the 1:1 direct channel between the calling parent-or-student and the tenant Administrator (super_admin, fallback support_staff). Deterministic DM code from the sorted member pair — the same channel create_direct_channel resolves for the pair. SECURITY DEFINER with full caller verification (parent/student-role gate, staff excluded).';
