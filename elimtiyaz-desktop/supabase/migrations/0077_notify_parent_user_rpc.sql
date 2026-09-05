-- ============================================================================
-- 0077_notify_parent_user_rpc.sql — CANONICAL PARENT NOTIFICATION RPC (T-192)
-- ============================================================================
-- Problems addressed (30th session, MSG-101):
--
--   The desktop's debt-reminder actions ("Envoyer un rappel" per-parent and
--   "Diffuser les rappels" bulk) NEVER delivered anything:
--     * broadcastReminders inserted notifications with NONEXISTENT columns
--       (`type`, `entity_type`, `entity_id` — the DB uses `kind`,
--       `link_entity_type`, `link_entity_id`) → every insert failed with a
--       PostgREST 400, was swallowed by console.warn, and `dispatched` was
--       still incremented — a silently fake success;
--     * even with the right columns the insert had NO target (target_user_id
--       NULL, target_role NULL) → under notifications_select the row is a
--       staff-only broadcast; the DEBTOR PARENT (the intended recipient)
--       could never see it;
--     * sendReminder() was a literal no-op returning Ok(undefined);
--     * the audit call targeted a nonexistent `append_audit_entry` RPC
--       (the canonical one is `write_audit_log`, migration 0014) — also
--       swallowed.
--
--   ROOT CAUSE (the architectural one): resolving parent → portal account
--   (parents.auth_user_id → user_profiles.id) CANNOT be done client-side by
--   a financial officer — `user_profiles_select` (0019) lets only
--   super_admin / support_staff read OTHER profiles. The resolution belongs
--   server-side.
--
-- This migration adds the canonical resolution + notification writer:
--
--   notify_parent_user(p_parent_id, p_kind, p_title, p_body, p_priority,
--                      p_source_label, p_link_entity_type, p_link_entity_id,
--                      p_actor_id) → notification id
--
-- SECURITY (the 0050/0055 hardened SECURITY DEFINER pattern — NOT an RLS
-- bypass): the function re-implements every invariant the policies would
-- enforce:
--   * caller must be an authenticated staff member (the 0048
--     notifications_insert staff gate, mirrored);
--   * p_parent_id must exist and belong to the caller's tenant;
--   * the ONLY privilege the definer grants beyond caller RLS is the
--     profile LOOKUP (parents.auth_user_id → user_profiles.id) and the
--     notification insert targeting THAT parent — exactly what staff could
--     do via the 0048 insert policy once they knew the target id;
--   * a parent with no linked account (auth_user_id NULL) or a non-active
--     profile → returns NULL (undeliverable in-app — the caller reports it
--     honestly instead of counting a fake dispatch);
--   * no client can make it target an arbitrary user: the target is always
--     derived from p_parent_id.
--
-- IDEMPOTENCY: create-or-replace — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is applied
-- to the live project TOGETHER with its schema_migrations registration in
-- one atomic transaction (scripts/apply_0077_live.sh).
-- ============================================================================

create or replace function public.notify_parent_user(
    p_parent_id        uuid,
    p_title            text,
    p_kind             text default 'alert',
    p_body             text default null,
    p_priority         text default 'medium',
    p_source_label     text default null,
    p_link_entity_type text default 'parent',
    p_link_entity_id   uuid default null,
    p_actor_id         uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant      uuid := public.current_tenant_id();
    v_profile_id  uuid;
    v_status      text;
    v_notif_id    uuid;
begin
    -- Caller verification (the hardened pattern — see header).
    if v_tenant is null then
        raise exception 'notify_parent_user: caller has no tenant context'
            using errcode = '42501';
    end if;
    if not public.has_any_role(array['super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher']) then
        raise exception 'notify_parent_user: only staff may send parent notifications'
            using errcode = '42501';
    end if;

    -- The parent must exist in the caller's tenant.
    if not exists (
        select 1 from public.parents p
         where p.id = p_parent_id
           and p.tenant_id = v_tenant
           and p.deleted_at is null
    ) then
        raise exception 'notify_parent_user: parent % not found in the caller''s tenant', p_parent_id
            using errcode = '22023';
    end if;

    -- Resolve the parent's portal account (parents.auth_user_id →
    -- user_profiles.id). NULL when the parent never activated.
    select up.id, up.status
      into v_profile_id, v_status
      from public.parents p
      join public.user_profiles up on up.auth_user_id = p.auth_user_id
     where p.id = p_parent_id
       and p.tenant_id = v_tenant
     limit 1;

    if v_profile_id is null or v_status is distinct from 'active' then
        -- Undeliverable in-app: the parent has no active portal account.
        -- Return NULL so the caller can count/report it honestly.
        return null;
    end if;

    insert into public.notifications (
        tenant_id, kind, title, body, priority,
        source, source_label,
        target_user_id,
        link_entity_type, link_entity_id,
        created_by, triggered_at
    ) values (
        v_tenant,
        case
            when p_kind in ('alert', 'info', 'warning', 'success', 'error', 'system') then p_kind
            else 'alert'
        end,
        p_title,
        p_body,
        case
            when p_priority in ('low', 'medium', 'high', 'urgent') then p_priority
            else 'medium'
        end,
        'system',
        coalesce(p_source_label, 'Module Finances'),
        v_profile_id,
        coalesce(p_link_entity_type, 'parent'),
        coalesce(p_link_entity_id, p_parent_id),
        p_actor_id,
        now()
    )
    returning id into v_notif_id;

    return v_notif_id;
end;
$$;

comment on function public.notify_parent_user is
  'MSG-101: canonical parent notification writer. SECURITY DEFINER (hardened pattern): staff-gated, tenant-scoped, resolves parents.auth_user_id → user_profiles.id server-side (financial officers cannot read other profiles under RLS). Returns the notification id, or NULL when the parent has no ACTIVE portal account (undeliverable in-app).';

-- ----------------------------------------------------------------------------
-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0077_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0077', '{0077_notify_parent_user_rpc.sql}', 'notify_parent_user_rpc')
on conflict (version) do nothing;
