-- ============================================================================
-- 0047_approve_account_request_rebind_guard.sql — REJECT RE-BINDING A PARENT
--                                              ALREADY BOUND TO ANOTHER USER (T-029)
-- ============================================================================
-- Problem PARENT-101 (T-029): approve_account_request's rebind branch
-- (0005 / 0044) sets `parents.auth_user_id = v_request.auth_user_id`
-- when target_parent_id is provided AND requested_role='parent'. But
-- it does NOT check whether the target parent already has a DIFFERENT
-- auth_user_id bound — the binding is silently overwritten, the previous
-- user loses access without audit trail.
--
-- Concrete impact: an admin approves a new signup request with
-- target_parent_id pointing at an already-bound parent (e.g. a parent
-- who lost their phone and is re-binding to a new account) — the old
-- account silently loses access; no audit entry records the previous
-- binding; reconciliation of "who had access when" is impossible.
--
-- The fix per T-029's proposed resolution: the rebind block rejects
-- parents already bound to a different user. The "explicit invalidate
-- + audit" path is a future enhancement (would need a separate flow
-- with a confirmation dialog).
--
-- Strategy:
--   1. Add a check: if the target parent's auth_user_id IS NOT NULL
--      AND is different from v_request.auth_user_id, raise an exception.
--      The exception message instructs the admin to unbind first via
--      the standard RBAC editor (which writes its own audit entry).
--   2. If the target parent's auth_user_id IS NULL OR equals the new
--      user, proceed as before (no behavior change for legitimate
--      first-time bindings).
--   3. The before_json audit entry captures the OLD auth_user_id so
--      the rebinding is auditable when it IS allowed (e.g. unbind +
--      rebind in two steps).
--
-- Compatibility: append-only per AGENTS.md §15 rule 9. Migrations
-- 0005 (original) and 0044 (admin-created accounts path) are
-- unchanged. The RPC's signature is preserved verbatim.
-- ============================================================================

create or replace function public.approve_account_request(
    p_request_id uuid,
    p_reviewer_profile_id uuid,
    p_target_parent_id uuid default null,
    p_target_student_id uuid default null,
    p_decision_note text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
    v_request record;
    v_role_id uuid;
    v_role_code text;
    v_existing_parent_auth_user_id uuid;
    v_audit_id uuid;
    v_old_parent_auth_user_id uuid;
begin
    select * into v_request
      from public.account_approval_requests
     where id = p_request_id
       and status = 'pending'
     for update;

    if not found then
        raise exception 'Approval request not found or already processed';
    end if;

    -- Determine role to assign
    v_role_code := case v_request.requested_role
        when 'parent' then 'parent'
        when 'student' then 'student'
        when 'staff' then 'support_staff'  -- admin must refine via RBAC editor
    end;

    select id into v_role_id from public.roles where code = v_role_code;

    -- Update the request
    update public.account_approval_requests
       set status = 'approved',
           reviewed_by = p_reviewer_profile_id,
           reviewed_at = now(),
           decision_note = p_decision_note,
           target_parent_id = coalesce(p_target_parent_id, v_request.target_parent_id),
           target_student_id = coalesce(p_target_student_id, v_request.target_student_id)
     where id = p_request_id;

    -- Activate the user profile
    update public.user_profiles
       set status = 'active',
           approval_request_id = p_request_id
     where auth_user_id = v_request.auth_user_id;

    -- Assign the role
    insert into public.role_assignments (user_profile_id, tenant_id, role_id, assigned_by)
    select up.id, v_request.tenant_id, v_role_id, p_reviewer_profile_id
      from public.user_profiles up
     where up.auth_user_id = v_request.auth_user_id
     on conflict (user_profile_id, tenant_id, role_id) where revoked_at is null do nothing;

    -- Bind to parent profile if requested_role='parent' and target_parent_id provided
    -- T-029 / PARENT-101: REJECT re-binding a parent already bound to a
    -- different user. The admin must unbind first via the standard RBAC
    -- editor (which writes its own audit entry). This block also writes
    -- a `parent.bind` audit entry capturing the OLD auth_user_id (null for
    -- first-time bindings) so the rebinding is auditable when it IS
    -- allowed.
    if v_request.requested_role = 'parent' and p_target_parent_id is not null then
        -- Capture the existing binding for the audit entry + the re-bind check.
        select auth_user_id into v_existing_parent_auth_user_id
          from public.parents
         where id = p_target_parent_id;

        v_old_parent_auth_user_id := coalesce(v_existing_parent_auth_user_id, ('00000000-0000-0000-0000-000000000000')::uuid);

        -- Reject re-binding to a different user.
        if v_existing_parent_auth_user_id is not null
           and v_existing_parent_auth_user_id is distinct from v_request.auth_user_id then
            raise exception
                'Parent % is already bound to a different auth_user_id (%). Unbind the previous account via the RBAC editor before approving this request.',
                p_target_parent_id, v_existing_parent_auth_user_id
                using hint = 'Use the RBAC editor to clear auth_user_id first, then re-approve.';
        end if;

        -- Perform the binding.
        update public.parents
           set auth_user_id = v_request.auth_user_id
         where id = p_target_parent_id;

        -- Audit the binding (including the OLD auth_user_id for forensic trail).
        v_audit_id := public.write_audit_log(
            p_tenant_id => v_request.tenant_id,
            p_action => 'parent.bind',
            p_entity_type => 'parent',
            p_entity_id => p_target_parent_id,
            p_actor_id => p_reviewer_profile_id,
            p_actor_role => v_role_code,
            p_before_json => jsonb_build_object('auth_user_id', v_existing_parent_auth_user_id),
            p_after_json => jsonb_build_object('auth_user_id', v_request.auth_user_id, 'request_id', p_request_id),
            p_note => coalesce(p_decision_note, 'parent account binding approved')
        );
    end if;

    -- Bind to student profile if requested_role='student' and target_student_id provided
    -- T-029 / PARENT-101: same guard pattern for students (silent over-
    -- write was the same defect shape).
    if v_request.requested_role = 'student' and p_target_student_id is not null then
        -- Capture the existing binding.
        select auth_user_id into v_existing_parent_auth_user_id
          from public.students
         where id = p_target_student_id;

        if v_existing_parent_auth_user_id is not null
           and v_existing_parent_auth_user_id is distinct from v_request.auth_user_id then
            raise exception
                'Student % is already bound to a different auth_user_id (%). Unbind the previous account via the RBAC editor before approving this request.',
                p_target_student_id, v_existing_parent_auth_user_id
                using hint = 'Use the RBAC editor to clear auth_user_id first, then re-approve.';
        end if;

        update public.students
           set auth_user_id = v_request.auth_user_id
         where id = p_target_student_id;

        v_audit_id := public.write_audit_log(
            p_tenant_id => v_request.tenant_id,
            p_action => 'student.bind',
            p_entity_type => 'student',
            p_entity_id => p_target_student_id,
            p_actor_id => p_reviewer_profile_id,
            p_actor_role => v_role_code,
            p_before_json => jsonb_build_object('auth_user_id', v_existing_parent_auth_user_id),
            p_after_json => jsonb_build_object('auth_user_id', v_request.auth_user_id, 'request_id', p_request_id),
            p_note => coalesce(p_decision_note, 'student account binding approved')
        );
    end if;

    return v_role_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Audit note: this migration does NOT add a unique constraint on
-- parents.auth_user_id or students.auth_user_id — those columns are
-- nullable (a parent/student can exist without a bound auth_user_id
-- until activation), and a UNIQUE constraint would forbid two unbound
-- rows. The check is enforced at the RPC level (this function) which
-- is the canonical approval path. The admin_create_user_account RPC
-- (0044) does NOT bind parent rows (it creates new auth.users, not
-- parent bindings), so no parallel fix is needed there.
-- ----------------------------------------------------------------------------
