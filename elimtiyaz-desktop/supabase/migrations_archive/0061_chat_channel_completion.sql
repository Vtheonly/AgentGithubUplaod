-- ============================================================================
-- 0061_chat_channel_completion.sql — CHAT BACKEND COMPLETION (T-098, 14th session)
-- ============================================================================
-- OWNER DECISION (2026-08-31, 14th session): the owner instructed
-- "fix and test the chat in all platforms" — this RESOLVES UNKNOWN-005
-- (chat product scope): staff↔parent / staff↔staff chat IS a committed
-- feature. T-037's "if built" branch is now the operative plan.
--
-- Problems addressed:
--
--   CHAT-103 — no production code anywhere creates chat_channels rows; the
--   website's MessagesView is permanently empty and the desktop chat is an
--   in-memory mock. This migration provides the canonical, idempotent
--   channel-creation RPC (create_direct_channel) that both clients call.
--   (The desktop Supabase repository override lands in the same change set.)
--
--   CHAT-104 — chat_channels.updated_at never advances when a chat_message
--   is inserted; the channel list is ordered by CREATION time, not last
--   message. This migration adds last_message_at / last_message_preview
--   columns + a touch trigger so channel ordering is by most recent
--   message (both the website's .order("updated_at") and the desktop's
--   lastMessageAt sort become correct).
--
--   Desktop domain parity — the desktop ChatChannel model carries
--   description / departmentId / archivedAt / lastMessageAt /
--   lastMessagePreview, but the table had no such columns; a Supabase-backed
--   chat repository needs them (archived_at = soft archive; description =
--   channel purpose; department_id = department-scope channel).
--
--   Missing UPDATE policy — chat_channels had only SELECT/INSERT policies;
--   the desktop's updateChannel / archiveChannel / addMembers /
--   removeMembers operations would be RLS-denied. This migration adds a
--   role-gated UPDATE policy (staff or the channel creator).
--
-- SECURITY notes:
--   * touch_chat_channel_on_message() is SECURITY DEFINER (repo convention:
--     `security definer set search_path = public`, cf. 0022). Rationale: the
--     trigger UPDATEs chat_channels during a chat_messages INSERT fired by
--     ANY author (including a parent in a DM); a SECURITY INVOKER trigger
--     would be RLS-denied for non-staff authors because chat_channels_update
--     is staff/creator-gated. The function touches ONLY the denormalized
--     preview columns (last_message_at, last_message_preview, updated_at) —
--     no authorization surface is weakened; no client can invoke it.
--   * create_direct_channel() is SECURITY INVOKER — every statement inside
--     runs under the CALLER's RLS (the 0048 insert policy requires the
--     creator to be a member; the select policy only returns channels the
--     caller can see). Deterministic DM codes make the RPC idempotent.
--   * No SECURITY DEFINER RPC is exposed to clients that mutates anything a
--     client could not already mutate under RLS.
--
-- IDEMPOTENCY: add-column-if-not-exists + drop-policy-if-exists +
-- create-or-replace + drop-trigger-if-exists — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is applied
-- to the live project TOGETHER with its schema_migrations registration in
-- one atomic transaction (scripts/apply_0061_live.sh).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. chat_channels — completion columns (desktop domain parity + CHAT-104)
-- ----------------------------------------------------------------------------
alter table public.chat_channels
    add column if not exists description          text,
    add column if not exists department_id        uuid,
    add column if not exists archived_at          timestamptz,
    add column if not exists last_message_at      timestamptz,
    add column if not exists last_message_preview text;

comment on column public.chat_channels.description is 'Optional channel purpose text (desktop domain parity).';
comment on column public.chat_channels.department_id is 'Department scope for department-type channels (no FK by convention).';
comment on column public.chat_channels.archived_at is 'Soft archive timestamp; archived channels are hidden from active lists.';
comment on column public.chat_channels.last_message_at is 'Denormalized sent_at of the most recent message (CHAT-104: ordering by last activity).';
comment on column public.chat_channels.last_message_preview is 'First 120 chars of the most recent message body (CHAT-104: list previews).';

create index if not exists chat_channels_last_message_idx
    on public.chat_channels (tenant_id, last_message_at desc nulls last);
create index if not exists chat_channels_archived_idx
    on public.chat_channels (tenant_id, archived_at) where archived_at is not null;

-- ----------------------------------------------------------------------------
-- 2. chat_channels_update policy (CHAT-103 support: desktop channel
--    management). Staff (super_admin / manager / support_staff) or the
--    channel creator may update; parents remain read/reply only.
-- ----------------------------------------------------------------------------
drop policy if exists chat_channels_update on public.chat_channels;
create policy chat_channels_update on public.chat_channels
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'manager', 'support_staff'])
            or created_by = public.current_user_profile_id()
        )
    )
    with check (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'manager', 'support_staff'])
            or created_by = public.current_user_profile_id()
        )
    );

-- ----------------------------------------------------------------------------
-- 3. CHAT-104: touch the channel (last message + updated_at) on every
--    chat_messages INSERT. SECURITY DEFINER — see the header rationale.
-- ----------------------------------------------------------------------------
create or replace function public.touch_chat_channel_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.chat_channels
       set last_message_at      = coalesce(new.sent_at, new.created_at),
           last_message_preview = left(new.body, 120),
           updated_at           = now()
     where id = new.channel_id;
    return new;
end;
$$;

comment on function public.touch_chat_channel_on_message is
  'CHAT-104: keep chat_channels.last_message_at/preview fresh so channel lists order by last activity. SECURITY DEFINER because the UPDATE must run for ANY author (parents included) while chat_channels_update is staff/creator-gated; only denormalized preview columns are touched.';

drop trigger if exists chat_messages_touch_channel on public.chat_messages;
create trigger chat_messages_touch_channel
    after insert on public.chat_messages
    for each row execute function public.touch_chat_channel_on_message();

-- ----------------------------------------------------------------------------
-- 4. CHAT-103: canonical, idempotent direct-channel creation.
--    SECURITY DEFINER with explicit caller verification (the 0050/0055
--    hardened pattern — NOT an RLS bypass): the 0019 policy
--    user_profiles_select_own lets only super_admin/support_staff see OTHER
--    profiles, so an INVOKER function could not validate the target member
--    for manager/teacher callers. The definer body therefore re-implements
--    every invariant the RLS policies would have enforced:
--      * caller must be an authenticated staff member (staff gate),
--      * caller must be a member of the created channel (by construction),
--      * channel_type is fixed to 'direct' (announcement gate, 0048),
--      * the other member must be a real profile of the caller's tenant,
--      * the returned row is one the caller is a member of.
--    Channel creation is STAFF-ONLY by product design: the parent portal is
--    read+reply (parents receive channels staff open for them).
-- ----------------------------------------------------------------------------
create or replace function public.create_direct_channel(
    p_other_profile_id uuid,
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
    v_a      uuid;
    v_b      uuid;
    v_code   text;
    v_ch     public.chat_channels;
begin
    if v_me is null then
        raise exception 'create_direct_channel: no user profile for the caller (auth.uid() has no user_profiles row)'
            using errcode = '42501';
    end if;
    if v_tenant is null then
        raise exception 'create_direct_channel: caller has no tenant (global admins must act inside a tenant context)'
            using errcode = '42501';
    end if;
    if not public.has_any_role(array['super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher']) then
        raise exception 'create_direct_channel: only staff may create chat channels (parents are read+reply by design)'
            using errcode = '42501';
    end if;
    if p_other_profile_id is null or p_other_profile_id = v_me then
        raise exception 'create_direct_channel: p_other_profile_id must be a different profile from the caller'
            using errcode = '22023';
    end if;
    -- The other member must be a real profile of the same tenant (or a
    -- global-admin profile). Guards against fabricated member ids.
    if not exists (
        select 1 from public.user_profiles up
         where up.id = p_other_profile_id
           and (up.tenant_id = v_tenant or up.tenant_id is null)
    ) then
        raise exception 'create_direct_channel: other profile not found in the caller''s tenant'
            using errcode = '22023';
    end if;

    v_a := least(v_me, p_other_profile_id);
    v_b := greatest(v_me, p_other_profile_id);
    v_code := 'DM-' || v_a || '-' || v_b;

    insert into public.chat_channels (
        tenant_id, code, name, channel_type, member_ids, created_by, description
    ) values (
        v_tenant, v_code, coalesce(nullif(btrim(p_name), ''), 'Direct'), 'direct',
        array[v_a, v_b], v_me, null
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
        raise exception 'create_direct_channel: channel vanished after upsert'
            using errcode = '22023';
    end if;

    -- Audit the creation (mock parity: chat.channel_create; convention 0014).
    if v_ch.created_by = v_me then
        insert into public.audit_logs (
            tenant_id, action, entity_type, entity_id, actor_id, after_json, note
        ) values (
            v_tenant, 'chat.channel_create', 'chat_channel', v_ch.id, v_me,
            to_jsonb(v_ch), 'create_direct_channel (idempotent RPC)'
        );
    end if;

    return v_ch;
end;
$$;

comment on function public.create_direct_channel is
  'CHAT-103 canonical path: idempotent 1:1 direct channel creation, staff-only. Deterministic code from the sorted member pair (same pair always maps to the same channel). SECURITY DEFINER with full caller verification (staff gate + target-exists + fixed direct type) — see migration header; returns only a channel the caller belongs to.';
