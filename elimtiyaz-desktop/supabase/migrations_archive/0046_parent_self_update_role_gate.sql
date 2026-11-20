-- ============================================================================
-- 0046_parent_self_update_role_gate.sql — FIRE enforce_parent_self_update_columns ONLY FOR PARENTS (T-031)
-- ============================================================================
-- Problem SEC-008 (T-031): the BEFORE UPDATE trigger
-- `enforce_parent_self_update_columns` (migration 0043) fires
-- unconditionally on EVERY parent UPDATE. The function rejects ANY
-- change to identity columns (id, tenant_id, parent_code, first_name,
-- last_name, national_id, relationship, notes, is_active,
-- is_financially_restricted, auth_user_id, deleted_at) — even when
-- the caller is a staff member (admin/manager/super_admin) legitimately
-- editing a parent's profile.
--
-- Concrete impact: the desktop's `edit-parent-modal.tsx` cannot rename
-- a parent (`first_name`/`last_name`), deactivate one (`is_active` =
-- false), or restrict one financially (`is_financially_restricted` =
-- true) — the trigger raises "Parents can only update contact fields"
-- for the staff user. Same for the ApprovalsTab's account-approval
-- flow that sets `auth_user_id` after binding an activation code.
--
-- The fix per T-031's proposed resolution: gate the trigger's
-- restriction on `has_role('parent')` callers. Staff roles
-- (admin, manager, super_admin, support_staff, finance, teacher,
-- etc.) can update identity fields; the parent role still cannot.
--
-- Strategy:
--   1. Wrap the existing restriction body in
--        `if public.has_role('parent') then … end if;`
--      so the restriction fires ONLY for parent-role callers.
--   2. SECURITY DEFINER + search_path=public is preserved so the
--      trigger can call `has_role` (which itself is SECURITY DEFINER
--      per migration 0034) without RLS interference.
--   3. The trigger itself is unchanged (drop+recreate to rebind to
--      the redefined function, same pattern as 0045).
--
-- Compatibility: append-only per AGENTS.md §15 rule 9. Migration 0043
-- is unchanged. The trigger event spec (BEFORE UPDATE) is preserved.
-- ============================================================================

create or replace function public.enforce_parent_self_update_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- T-031 / SEC-008: gate the restriction on the parent role.
  -- Staff (admin, manager, super_admin, support_staff, finance,
  -- teacher, etc.) can update identity fields — the parent-role
  -- restriction applies ONLY to parent callers. has_role() is itself
  -- SECURITY DEFINER per migration 0034, so it works inside this
  -- trigger even when the caller's JWT role assignments would be
  -- filtered by RLS on role_assignments.
  if public.has_role('parent') then
    -- Parents can only touch contact fields. Anything else is rejected.
    if new.id is distinct from old.id
       or new.tenant_id is distinct from old.tenant_id
       or new.parent_code is distinct from old.parent_code
       or new.first_name is distinct from old.first_name
       or new.last_name is distinct from old.last_name
       or new.national_id is distinct from old.national_id
       or new.relationship is distinct from old.relationship
       or new.notes is distinct from old.notes
       or new.is_active is distinct from old.is_active
       or new.is_financially_restricted is distinct from old.is_financially_restricted
       or new.auth_user_id is distinct from old.auth_user_id
       or new.deleted_at is distinct from old.deleted_at then
      raise exception 'Parents can only update contact fields (phone, email, address, occupation)';
    end if;
  end if;
  return new;
end;
$$;

-- Re-bind the trigger to the redefined function (same pattern as 0045).
drop trigger if exists parents_enforce_self_update_columns on public.parents;
create trigger parents_enforce_self_update_columns
  before update on public.parents
  for each row execute function public.enforce_parent_self_update_columns();

-- ----------------------------------------------------------------------------
-- Audit note: this migration does NOT remove the parents_self_update RLS
-- policy from 0043 — the policy still restricts parent self-updates to
-- rows where `auth_user_id = auth.uid()` (a parent can only update their
-- OWN row). The TRIGGER is the second layer of defense (which FIELDS they
-- can touch); the RLS policy is the first layer (which ROWS they can
-- touch). Both layers are needed; only the trigger layer was broken.
-- ----------------------------------------------------------------------------
