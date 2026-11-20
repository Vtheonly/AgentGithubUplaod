-- ============================================================================
-- 0156_chat_messages_insert_workforce_widening.sql — THE WORKER GROUP-CHAT
-- CITIZENSHIP FIX (T-527 / CHAT-307, 171st session, 2026-10-13)
-- ============================================================================
-- DISCOVERED DURING THE T-527 E2E ACCEPTANCE ROUND (live, 2026-10-13): a
-- worker-role staff member signing in and posting in the shared Staff
-- General channel (a GROUP channel) receives 403 — chat_messages_insert's
-- first branch still carries the 0067-era FIVE-role office list
-- (super_admin / manager / support_staff / financial_officer / teacher),
-- so the ONLY path a worker could post through is the second branch (a
-- DIRECT channel with an office-staff counterpart). The 0105 widening
-- ("workers are full chat citizens") reached create_direct_channel and
-- 0135 recreated profile_has_staff_role on the 9-role set, but the message
-- INSERT policy's own role list was never widened — workers can be MEMBERS
-- of every internal channel and can DM office staff, but can never SPEAK
-- in a group/department channel. The owner's mandate §5.2 ("Every
-- authorized participant can send and receive messages in that channel")
-- makes this a hard defect, and it also breaks the desktop's ChatPanel for
-- every worker/buyer/driver/warehouse_worker user in every group channel.
--
-- THE FIX: chat_messages_insert's first branch widens to the SAME 9-role
-- employee set 0105/0135 established (the 0023 census minus parent/student).
-- Everything else in the policy is preserved verbatim: the tenant match,
-- the author-binding (author_id = current_user_profile_id() — the
-- anti-impersonation rule the mandate §5.3 demands), the membership check,
-- and the T-148/CHAT-200b non-staff branch (parents/students still post
-- ONLY in direct channels with a staff counterpart — parent↔parent remains
-- structurally impossible; NO authorization surface is weakened: the
-- widened roles were already full channel MEMBERS by the 0135 scope rule).
--
-- The sibling policies were audited the same round and are CORRECT as-is:
--   chat_channels_insert — the 5-role list is only its FIRST branch; the
--     fallback (every OTHER member staff via the 9-role
--     profile_has_staff_role) already lets workers create channels.
--   chat_channels_update — super_admin/manager/support_staff or the
--     creator: workers cannot mutate channels they did not create (the
--     mandate §5.3 "cannot remove other users" rule — preserved).
--   notifications_insert — bypassed for the chat fan-out by the 0075
--     SECURITY DEFINER trigger (documented convention) — no gap.
--   chat_messages_select — member-based (no role list) — no gap.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): applied to the live
-- project TOGETHER with its schema_migrations registration in one atomic
-- transaction (the registration stanza at the bottom).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. chat_messages_insert — the 0105 9-role widening.
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
        -- T-527 / CHAT-307 (NEW): the staff-author branch widens to the
        -- FULL 9-role employee set (the 0105/0135 definition — the 0023
        -- census minus parent/student). Workers/buyers/drivers/warehouse
        -- workers were already full channel MEMBERS; now they can SPEAK
        -- in group and department channels, not just DM office staff.
        and (
            public.has_any_role(array[
                'super_admin', 'manager', 'support_staff', 'financial_officer', 'teacher',
                'worker', 'buyer', 'driver', 'warehouse_worker'
            ])
            -- T-148 / CHAT-200b (preserved verbatim): a NON-STAFF author
            -- (parent/student) may only post in a DIRECT channel where at
            -- least one OTHER member holds a staff role. Parent↔parent
            -- channels remain structurally impossible to converse in.
            or exists (
                select 1 from public.chat_channels c
                  join lateral (
                      select m.m from unnest(c.member_ids) as m(m)
                       where m.m is distinct from public.current_user_profile_id()
                  ) members on (true)
                 where c.id = chat_messages.channel_id
                   and c.tenant_id = chat_messages.tenant_id
                   and c.channel_type = 'direct'
                   and public.profile_has_staff_role(members.m)
            )
        )
    );

comment on policy chat_messages_insert on public.chat_messages is
    'T-071/CHAT-101 membership + T-148/CHAT-200b parent-DM-only branch (preserved) + T-527/CHAT-307 (0156): the staff-author branch widened to the 0105 9-role employee set — workforce roles can post in group/department channels, not only DM office staff.';

-- ----------------------------------------------------------------------------
-- 2. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0156', '{0156_chat_messages_insert_workforce_widening.sql}', 'chat_messages_insert_workforce_widening')
on conflict (version) do nothing;
