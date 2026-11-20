-- ============================================================================
-- 0075_chat_message_notifications.sql — CHAT MESSAGE → NOTIFICATION FAN-OUT
-- (T-190, 30th session — the messaging-delivery layer)
-- ============================================================================
-- OWNER MANDATE (2026-09-05, 30th session): "focus on the messaging system,
-- not the chat UI. Messaging is not working at all" — root cause: the chat
-- PERSISTENCE layer works (chat_channels/chat_messages + RLS + realtime +
-- read receipts), but NOTHING notifies a recipient who does not happen to
-- have the app open. A chat_messages INSERT produced zero `notifications`
-- rows, zero pushes, zero emails — the only "delivery" was Supabase
-- Realtime invalidation for an already-open client. A parent with the
-- portal closed never learned a message existed.
--
-- This migration closes that gap server-side (canonical layer — works for
-- EVERY client: desktop, website, Android, and any future writer):
--
--   MSG-200 — chat message sends create no notifications for absent
--   recipients. AFTER INSERT ON chat_messages → one `notifications` row
--   per channel member EXCEPT the author.
--
-- DESIGN NOTES:
--
--   * SECURITY DEFINER — the 0061 `touch_chat_channel_on_message`
--     convention: the trigger must run for ANY author (parents included),
--     while `notifications_insert` (0048) is staff-or-self-gated. The
--     definer body only inserts notification rows that target EXPLICIT
--     members of the channel the message belongs to (membership is already
--     enforced upstream by `chat_messages_insert`'s membership check,
--     0067); no authorization surface is weakened and no client can invoke
--     the function directly.
--   * kind = 'info' → maps to domain NotificationType 'message' via the
--     desktop's KIND_TO_TYPE table (supabase-notification-repository.ts) —
--     the bell routes it to the chat/message family.
--   * link_entity_type = 'chat_channel' → the website's
--     linkEntityTypeToView maps it to the messages view; Android's
--     onNavigateToEntity routes it to the chat screens (T-196 adds the
--     'chat_channel' case); the desktop shows the detail modal.
--   * created_by = the message author (provenance for the audit trail).
--   * One notification per message per recipient (per-event, NOT a digest)
--     — consistent with run-overdue-scan's per-installment alerts. The
--     digest decision stays with UNKNOWN-020.
--   * Announcement channels with an empty member_ids array produce no
--     rows (explicit membership only — safe default; staff list channels
--     carry their members).
--
-- IDEMPOTENCY: drop-trigger-if-exists + create-or-replace — safe to re-apply.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): this file is applied
-- to the live project TOGETHER with its schema_migrations registration in
-- one atomic transaction (scripts/apply_0075_live.sh).
-- ============================================================================

create or replace function public.notify_chat_members_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_channel_name text;
    v_sender_label text;
    v_member_ids uuid[];
    v_member_id uuid;
begin
    -- Soft-deleted rows are never INSERTed (deleted_at is UPDATE-only) —
    -- no guard needed here; the touch trigger (0061) has the same shape.

    select name, member_ids
      into v_channel_name, v_member_ids
      from public.chat_channels
     where id = new.channel_id;

    if v_member_ids is null then
        -- Channel vanished (should not happen — FK) — nothing to fan out.
        return new;
    end if;

    -- Sender label for the title (display_name falls back to email).
    select coalesce(display_name, email)
      into v_sender_label
      from public.user_profiles
     where id = new.author_id;

    foreach v_member_id in array v_member_ids
    loop
        if v_member_id is distinct from new.author_id then
            insert into public.notifications (
                tenant_id,
                kind,
                title,
                body,
                priority,
                source,
                source_label,
                target_user_id,
                link_entity_type,
                link_entity_id,
                created_by,
                triggered_at
            ) values (
                new.tenant_id,
                'info',
                'Nouveau message' ||
                    case
                        when v_channel_name is not null and v_sender_label is not null
                            then ' de ' || v_sender_label || ' — ' || v_channel_name
                        when v_sender_label is not null
                            then ' de ' || v_sender_label
                        when v_channel_name is not null
                            then ' — ' || v_channel_name
                        else ''
                    end,
                left(coalesce(new.body, ''), 160),
                'medium',
                'system',
                'Messagerie',
                v_member_id,
                'chat_channel',
                new.channel_id,
                new.author_id,
                coalesce(new.sent_at, new.created_at)
            );
        end if;
    end loop;

    return new;
end;
$$;

comment on function public.notify_chat_members_on_message is
  'MSG-200: fan out one notification per channel member (except the author) on every chat message insert. SECURITY DEFINER per the 0061 touch-trigger convention — parents can author messages while notifications_insert is staff-or-self-gated; the body only targets explicit channel members.';

drop trigger if exists chat_messages_notify_members on public.chat_messages;
create trigger chat_messages_notify_members
    after insert on public.chat_messages
    for each row execute function public.notify_chat_members_on_message();

-- ----------------------------------------------------------------------------
-- Registration row (T-091/MIG-TOKENS pattern — scripts/apply_0075_live.sh
-- embeds this so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0075', '{0075_chat_message_notifications.sql}', 'chat_message_notifications')
on conflict (version) do nothing;
