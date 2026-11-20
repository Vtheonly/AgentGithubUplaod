-- 0106_personnel_realtime_publication.sql
-- Personnel workforce parity (T-400): revive the EXISTING dead realtime
-- subscriptions for the Personnel surfaces (the REALTIME-105 class gap,
-- live-proven 2026-09-21: the desktop's chat repository already subscribes
-- to postgres_changes on chat_channels + chat_messages, but neither table
-- is a member of the supabase_realtime publication — the subscription
-- connects and then never fires).
--
-- MEMBERSHIP ADDED (each guarded, the 0085/0095 idempotent pattern):
--   * chat_channels     — SupabaseChatRepository ("desktop-chat-realtime")
--   * chat_messages     — SupabaseChatRepository (same channel)
--   * leave_requests    — SupabaseLeaveRequestRepository (the T-400
--                         subscription added with this migration: the
--                         manager's request inbox updates when a worker
--                         submits/responds, without a manual reload)
--
-- NOT added here (no consumer yet — left to T-337's portal scope):
--   notifications, installments, payments, homework, assessments,
--   tasks, workforce_attendance_events. Adding publication members
--   without a subscriber is dead weight; T-337 owns the portal set.
--
-- SECURITY (unchanged posture — the 0085 precedent): NO RLS policy
-- changes. Realtime postgres_changes events are filtered by each
-- subscriber's own SELECT policies (0019/0104): a worker receives events
-- only for rows they may read (own requests, own channels' messages), a
-- manager for their team/tenant scope. Publication membership exposes
-- nothing a authenticated REST SELECT could not already read.

do $add_membership$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_channels'
    ) then
        alter publication supabase_realtime add table public.chat_channels;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
    ) then
        alter publication supabase_realtime add table public.chat_messages;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leave_requests'
    ) then
        alter publication supabase_realtime add table public.leave_requests;
    end if;
end;
$add_membership$;

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the Management-API apply
-- embeds this statement so the DDL and the registration land in ONE atomic
-- transaction; kept here so a fresh CLI deployment registers identically.
-- ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0106', '{0106_personnel_realtime_publication.sql}', 'personnel_realtime_publication')
on conflict (version) do nothing;
