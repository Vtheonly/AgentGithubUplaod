-- ============================================================================
-- 0048_chat_notifications_rls_insert_tighten.sql — TIGHTEN RLS INSERT POLICIES FOR
--                                              CHAT_CHANNELS / CHAT_MESSAGES / NOTIFICATIONS (T-071)
-- ============================================================================
-- Problems CHAT-100, CHAT-101, NOTIF-101 (T-071):
--
--   1. chat_channels_insert (0019) only checked `tenant_id = current_tenant_id()`.
--      ANY authenticated user could create a channel for ANY set of
--      member_ids, including channel types they shouldn't (e.g. a parent
--      creating an 'announcement' channel).
--
--   2. chat_messages_insert (0019) checked tenant + author_id =
--      current_user. But it did NOT verify the author is a MEMBER of the
--      channel. A parent could post into a channel they're not a member of
--      (just by knowing the channel_id).
--
--   3. notifications_insert (0019) only checked tenant_id. ANY
--      authenticated user could address a notification to ANY other user
--      (e.g. a parent addresses a notification to a teacher, or to a
--      stranger parent). Or impersonate a target_role broadcast.
--
-- The fix per T-071's proposed resolution:
--   * chat_channels_insert: requires creator ∈ member_ids AND role-gates
--     'announcement' channel_type to staff (super_admin / manager /
--     support_staff). Parents can create direct-message channels (between
--     themselves and a staff member, e.g.) but NOT announcement channels.
--   * chat_messages_insert: requires the author to be a member of the
--     channel they're posting into (verified via the chat_channels row's
--     member_ids array).
--   * notifications_insert: requires the caller to be staff (super_admin /
--     manager / support_staff / financial_officer / teacher) OR the
--     notification targets themselves (target_user_id = caller) OR the
--     caller holds the target_role (role-broadcast self-targeting — a
--     staff member can address a notification to all holders of their own
--     role).
--
-- Compatibility: append-only per AGENTS.md §15 rule 9. Migration 0019
-- is unchanged. The RLS policies are dropped+recreated (the standard
-- pattern for RLS policy changes).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. chat_channels_insert — creator ∈ member_ids + announcement role-gate
-- ----------------------------------------------------------------------------
drop policy if exists chat_channels_insert on public.chat_channels;
create policy chat_channels_insert on public.chat_channels
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        -- T-071 / CHAT-100: creator must be a member of the channel.
        and member_ids @> array[public.current_user_profile_id()]
        -- T-071 / CHAT-100: 'announcement' channel_type is staff-only.
        -- Parents can create direct-message channels but NOT announcement channels.
        and (
            channel_type is distinct from 'announcement'
            or public.has_any_role(array['super_admin', 'manager', 'support_staff'])
        )
    );

-- ----------------------------------------------------------------------------
-- 2. chat_messages_insert — author must be a channel member
-- ----------------------------------------------------------------------------
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and author_id = public.current_user_profile_id()
        -- T-071 / CHAT-101: author must be a member of the channel.
        and exists (
            select 1 from public.chat_channels c
             where c.id = chat_messages.channel_id
               and c.tenant_id = chat_messages.tenant_id
               and c.member_ids @> array[public.current_user_profile_id()]
        )
    );

-- ----------------------------------------------------------------------------
-- 3. notifications_insert — staff-only OR self-targeting
-- ----------------------------------------------------------------------------
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        -- T-071 / NOTIF-101: a notification may be inserted by:
        --   (a) staff (super_admin / manager / support_staff /
        --       financial_officer / teacher) — the canonical writers
        --       (workflow triggers, financial events, attendance alerts).
        --   (b) the target themselves (target_user_id = caller) — e.g.
        --       a user setting a reminder for themselves.
        --   (c) the caller holds the target_role — a staff member
        --       addressing a notification to all holders of their own
        --       role (a teacher broadcasting to teachers).
        and (
            public.has_any_role(array['super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher'])
            or target_user_id = public.current_user_profile_id()
            or (target_role is not null and target_role = any(public.current_user_roles()))
        )
    );

-- ----------------------------------------------------------------------------
-- Audit note: this migration does NOT change the SELECT / UPDATE
-- policies — only INSERT. Parents can still READ notifications addressed
-- to them (notifications_select) and mark them read (notifications_update)
-- as before. The desktop's NotificationBell, the Android notification
-- pull, and the website's notification badge all rely on the unchanged
-- SELECT policy. The INSERT change affects only the canonical writers
-- (staff actions, workflow triggers, financial events) — all of which
-- use the staff-role path.
-- ----------------------------------------------------------------------------
