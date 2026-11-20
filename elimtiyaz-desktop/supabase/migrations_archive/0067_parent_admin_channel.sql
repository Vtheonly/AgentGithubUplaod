-- ============================================================================
-- 0067_parent_admin_channel.sql — PARENT→ADMINISTRATOR MESSENGER SCOPE (T-148, 24th session)
-- ============================================================================
-- OWNER MANDATE (2026-09-03, 24th session — registered as CHAT-200 and
-- decided by ADR-012, which amends ADR-008):
--   "The messenger on the web client should only connect users (parents)
--    directly to the Administrator (one-on-one channel). Communication
--    between parents must not be allowed; the chat feature is strictly
--    meant for educational reports and inquiries directed to the admin."
--
-- Problems addressed:
--
--   CHAT-200a — the portal messenger is DEAD for parents: no code path a
--     parent can invoke creates a chat_channels row (create_direct_channel
--     is staff-only per ADR-008; staff simply never opened one — live:
--     0 rows in chat_channels). This migration adds the parent-side RPC
--     open_parent_admin_channel() so a parent can ALWAYS reach the
--     Administrator (educational reports / inquiries).
--
--   CHAT-200b — nothing structurally forbids parent↔parent communication:
--     0048's chat_channels_insert still lets ANY authenticated creator
--     build a channel with ARBITRARY member_ids (creator ∈ members is the
--     only constraint) — a parent could create a parent↔parent channel,
--     and chat_messages_insert would then let both parents post (the
--     member rule alone). This migration tightens BOTH policies so that
--     non-staff (parent/student) callers can only ever talk to STAFF:
--       * chat_channels_insert — a non-staff creator requires EVERY other
--         member to hold a staff role;
--       * chat_messages_insert — a non-staff author requires channel_type
--         'direct' AND at least one OTHER member holding a staff role.
--     Staff callers keep the full 0048 semantics (member rule unchanged).
--
-- SECURITY notes:
--   * profile_has_staff_role() is SECURITY DEFINER + STABLE with a pinned
--     search_path (the 0003 convention for role resolvers — has_any_role
--     itself is SECURITY DEFINER). Rationale: the RLS policies below must
--     evaluate staff-ness of OTHER profiles; a SECURITY INVOKER subquery
--     would run under the CALLER's RLS on role_assignments, where a parent
--     cannot read other users' role rows → the check would silently fail
--     and parents could not post anywhere. The helper is read-only, takes
--     a single profile uuid, and exposes nothing beyond a boolean.
--   * open_parent_admin_channel() follows the 0061 create_direct_channel
--     pattern: SECURITY DEFINER with explicit caller verification (the
--     0050/0055 hardened pattern, NOT an RLS bypass), deterministic
--     idempotent DM code from the sorted member pair, audit row, returns
--     only a channel the caller belongs to.
--
-- IDEMPOTENCY: drop-if-exists + create-or-replace — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is applied
-- to the live project TOGETHER with its schema_migrations registration in
-- one atomic transaction (scripts pattern used by T-150).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profile_has_staff_role(p_profile_id) — RLS-safe staff-ness resolver
-- ----------------------------------------------------------------------------
create or replace function public.profile_has_staff_role(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.role_assignments ra
          join public.roles r on r.id = ra.role_id
         where ra.user_profile_id = p_profile_id
           and ra.revoked_at is null
           -- The SAME 5-role chat-staff list every chat policy uses (0048
           -- insert gates, 0061 create_direct_channel staff gate) — kept
           -- consistent so the author exemption and the counterpart check
           -- can never disagree.
           and r.code = any(array['super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher'])
           and (ra.tenant_id = public.current_tenant_id() or ra.tenant_id is null)
    );
$$;

comment on function public.profile_has_staff_role is
  'CHAT-200 (0067): does this profile hold an ACTIVE chat-staff role (super_admin/manager/support_staff/financial_officer/teacher — the same 5-role list as 0048/0061) in the current tenant? SECURITY DEFINER so RLS policies can evaluate the staff-ness of OTHER members without exposing role_assignments rows to the caller (same convention as has_any_role, 0003).';

-- ----------------------------------------------------------------------------
-- 2. chat_channels_insert — non-staff creators may only add STAFF members
--    (0048 kept: creator ∈ members + announcement staff gate)
-- ----------------------------------------------------------------------------
drop policy if exists chat_channels_insert on public.chat_channels;
create policy chat_channels_insert on public.chat_channels
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        -- T-071 / CHAT-100 (preserved from 0048): creator must be a member.
        and member_ids @> array[public.current_user_profile_id()]
        -- T-071 / CHAT-100 (preserved from 0048): 'announcement' is staff-only.
        and (
            channel_type is distinct from 'announcement'
            or public.has_any_role(array['super_admin', 'manager', 'support_staff'])
        )
        -- T-148 / CHAT-200b (NEW): a NON-STAFF creator (parent/student) may
        -- only create a channel whose OTHER members are ALL staff —
        -- parent↔parent channels become structurally impossible to create.
        and (
            public.has_any_role(array['super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher'])
            or (
                select bool_and(public.profile_has_staff_role(m))
                  from unnest(member_ids) as m
                 where m is distinct from public.current_user_profile_id()
            )
        )
    );

-- ----------------------------------------------------------------------------
-- 3. chat_messages_insert — non-staff authors post ONLY in direct channels
--    with a staff counterpart (0048's member rule preserved for everyone)
-- ----------------------------------------------------------------------------
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and author_id = public.current_user_profile_id()
        -- T-071 / CHAT-101 (preserved from 0048): author must be a member
        -- of the channel.
        and exists (
            select 1 from public.chat_channels c
             where c.id = chat_messages.channel_id
               and c.tenant_id = chat_messages.tenant_id
               and c.member_ids @> array[public.current_user_profile_id()]
        )
        -- T-148 / CHAT-200b (NEW): a NON-STAFF author (parent/student) may
        -- only post in a DIRECT channel where at least one OTHER member
        -- holds a staff role. Staff authors keep 0048's full member rule.
        and (
            public.has_any_role(array['super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher'])
            or exists (
                select 1
                  from public.chat_channels c
                  join lateral (
                      select m from unnest(c.member_ids) as m
                       where m is distinct from public.current_user_profile_id()
                  ) members on true
                 where c.id = chat_messages.channel_id
                   and c.tenant_id = chat_messages.tenant_id
                   and c.channel_type = 'direct'
                   and public.profile_has_staff_role(members.m)
            )
        )
    );

-- ----------------------------------------------------------------------------
-- 4. open_parent_admin_channel() — the parent side of the messenger
--    (ADR-012; mirrors 0061's create_direct_channel structure)
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

    -- The messenger's parent side is for PARENT accounts only (the school's
    -- model: parents reach the administration; staff use create_direct_channel).
    if not exists (
        select 1
          from public.role_assignments ra
          join public.roles r on r.id = ra.role_id
         where ra.user_profile_id = v_me
           and (ra.tenant_id = v_tenant or ra.tenant_id is null)
           and ra.revoked_at is null
           and r.code = 'parent'
    ) then
        raise exception 'open_parent_admin_channel: only parent accounts may open the administration channel'
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
    -- create_direct_channel, so the channel a parent opens here is the very
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
        'Parent to administration channel (migration 0067, ADR-012)'
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
            to_jsonb(v_ch), 'open_parent_admin_channel (idempotent RPC, migration 0067 / ADR-012)'
        );
    end if;

    return v_ch;
end;
$$;

comment on function public.open_parent_admin_channel is
  'CHAT-200a (0067 / ADR-012): the PARENT side of the messenger — idempotently opens (or returns) the 1:1 direct channel between the calling parent and the tenant Administrator (super_admin, fallback support_staff). Deterministic DM code from the sorted member pair — the same channel create_direct_channel resolves for the pair. SECURITY DEFINER with full caller verification (parent-role gate, staff excluded).';

-- ----------------------------------------------------------------------------
-- 5. Register the RPC's execute grant ( PUBLIC by convention for RPCs the
--    clients call with their own JWT — the function itself verifies the
--    caller; consistent with create_direct_channel's default grants).
-- ----------------------------------------------------------------------------
grant execute on function public.open_parent_admin_channel(text) to authenticated;
grant execute on function public.profile_has_staff_role(uuid) to authenticated;
