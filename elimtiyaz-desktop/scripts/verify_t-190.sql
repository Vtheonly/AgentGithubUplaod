-- ============================================================================
-- verify_t-190.sql — T-190 / MSG-200 live verification (ROLLBACK-safe).
--
-- Proves the chat_messages → notifications fan-out trigger:
--   T1  a message in a 2-member channel creates EXACTLY ONE notification,
--       targeted at the OTHER member (not the author);
--   T2  the notification carries the chat deep-link (chat_channel / channel
--       id), the 'info' kind, the 'Messagerie' source label and the author
--       as created_by;
--   T3  a message authored by the OTHER member fans back symmetrically;
--   T4  a 3-member channel fans out to BOTH other members (2 rows, author
--       excluded);
--   T5  an announcement-style channel with an EMPTY member_ids array
--       produces ZERO notifications (explicit membership only);
--   R1  (regression) messages NEVER notify their own author;
--   R2  (regression) the 0061 touch trigger still fires — last_message_at /
--       last_message_preview still advance on the channel;
--   R3  (regression) the trigger is idempotent machinery: no rows appear
--       for the SAME message id re-processed by later statements (single
--       after-insert trigger — asserted via count stability).
--
-- Wrapped in BEGIN; … ROLLBACK; — re-runnable any time without mutating
-- the live DB. Results land in t190_results.
-- ============================================================================

begin;

create temp table t190_results (id text, ok boolean, detail text);

-- Fixtures: two member profiles + a channel, all under the real tenant.
with tenant as (select id from public.tenants order by created_at limit 1)
insert into public.user_profiles (id, auth_user_id, tenant_id, email, display_name, status)
values
    ('11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', (select id from tenant), 't190-a@test.local', 'T190 Membre A', 'active'),
    ('11111111-1111-4111-8111-111111111112', '21111111-1111-4111-8111-111111111112', (select id from tenant), 't190-b@test.local', 'T190 Membre B', 'active')
on conflict (id) do nothing;

insert into public.chat_channels (id, tenant_id, code, name, channel_type, member_ids, created_by)
values ('31111111-1111-4111-8111-111111111111', (select id from public.tenants order by created_at limit 1),
        'T190-DM-A-B', 'T190 Canal test', 'direct',
        array['11111111-1111-4111-8111-111111111111'::uuid, '11111111-1111-4111-8111-111111111112'::uuid],
        '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

-- T1 + T2: A sends to the channel.
insert into public.chat_messages (id, tenant_id, channel_id, author_id, body, sent_at)
values ('41111111-1111-4111-8111-111111111111', (select id from public.tenants order by created_at limit 1),
        '31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
        'Bonjour, ceci est le premier message de test T-190.', now());

insert into t190_results
select 'T1_one_notification_for_other_member', count(*) = 1,
       'rows=' || count(*)
  from public.notifications
 where link_entity_type = 'chat_channel'
   and link_entity_id = '31111111-1111-4111-8111-111111111111'
   and target_user_id = '11111111-1111-4111-8111-111111111112';

insert into t190_results
select 'T2_payload_shape', bool_and(
           kind = 'info'
           and source = 'system'
           and source_label = 'Messagerie'
           and priority = 'medium'
           and created_by = '11111111-1111-4111-8111-111111111111'
           and title like 'Nouveau message de T190 Membre A%'
           and body like 'Bonjour, ceci est le premier message%'
       ) and count(*) = 1,
       'checked ' || count(*) || ' row(s)'
  from public.notifications
 where link_entity_id = '31111111-1111-4111-8111-111111111111'
   and target_user_id = '11111111-1111-4111-8111-111111111112';

-- R1: the author was NOT notified.
insert into t190_results
select 'R1_author_not_notified', count(*) = 0, 'author rows=' || count(*)
  from public.notifications
 where link_entity_id = '31111111-1111-4111-8111-111111111111'
   and target_user_id = '11111111-1111-4111-8111-111111111111';

-- T3: B replies — fans back to A.
insert into public.chat_messages (id, tenant_id, channel_id, author_id, body, sent_at)
values ('41111111-1111-4111-8111-111111111112', (select id from public.tenants order by created_at limit 1),
        '31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111112',
        'Réponse de B.', now());

insert into t190_results
select 'T3_symmetric_fanout', count(*) = 1, 'rows=' || count(*)
  from public.notifications
 where link_entity_id = '31111111-1111-4111-8111-111111111111'
   and target_user_id = '11111111-1111-4111-8111-111111111111'
   and created_by = '11111111-1111-4111-8111-111111111112';

-- T4 + T5: a 3-member channel and an empty-members announcement channel.
insert into public.chat_channels (id, tenant_id, code, name, channel_type, member_ids, created_by)
values
    ('31111111-1111-4111-8111-111111111112', (select id from public.tenants order by created_at limit 1),
     'T190-GROUP', 'T190 Groupe', 'group',
     array['11111111-1111-4111-8111-111111111111'::uuid,
           '11111111-1111-4111-8111-111111111112'::uuid,
           '11111111-1111-4111-8111-111111111113'::uuid],
     '11111111-1111-4111-8111-111111111111'),
    ('31111111-1111-4111-8111-111111111113', (select id from public.tenants order by created_at limit 1),
     'T190-ANNOUNCE', 'T190 Annonce', 'announcement', '{}'::uuid[],
     '11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

insert into public.user_profiles (id, auth_user_id, tenant_id, email, display_name, status)
values ('11111111-1111-4111-8111-111111111113', '21111111-1111-4111-8111-111111111113',
        (select id from public.tenants order by created_at limit 1), 't190-c@test.local', 'T190 Membre C', 'active')
on conflict (id) do nothing;

insert into public.chat_messages (id, tenant_id, channel_id, author_id, body, sent_at)
values
    ('41111111-1111-4111-8111-111111111113', (select id from public.tenants order by created_at limit 1),
     '31111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', 'Message groupe.', now()),
    ('41111111-1111-4111-8111-111111111114', (select id from public.tenants order by created_at limit 1),
     '31111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', 'Annonce test.', now());

insert into t190_results
select 'T4_group_two_rows_author_excluded', count(*) = 2
       and bool_and(target_user_id in ('11111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111113')),
       'rows=' || count(*)
  from public.notifications
 where link_entity_id = '31111111-1111-4111-8111-111111111112';

insert into t190_results
select 'T5_empty_members_no_notifications', count(*) = 0, 'rows=' || count(*)
  from public.notifications
 where link_entity_id = '31111111-1111-4111-8111-111111111113';

-- R2: the 0061 touch trigger still advanced the channel preview.
insert into t190_results
select 'R2_touch_trigger_still_fires', last_message_at is not null
       and last_message_preview like 'Annonce test%'
       and updated_at >= created_at,
       'preview=' || coalesce(last_message_preview, 'NULL')
  from public.chat_channels
 where id = '31111111-1111-4111-8111-111111111113';

-- R3: count stability — exactly 4 notifications total across the fixtures
-- (1 B [T1] + 1 A [T3] + 2 group [T4] + 0 announce [T5]).
insert into t190_results
select 'R3_total_count_stable', count(*) = 4, 'total=' || count(*)
  from public.notifications
 where link_entity_type = 'chat_channel'
   and link_entity_id in ('31111111-1111-4111-8111-111111111111',
                          '31111111-1111-4111-8111-111111111112',
                          '31111111-1111-4111-8111-111111111113');

select id, ok, detail from t190_results order by id;
rollback;
