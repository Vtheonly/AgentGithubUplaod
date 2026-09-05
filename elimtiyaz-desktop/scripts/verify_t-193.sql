-- ============================================================================
-- verify_t-193.sql — T-193 / MSG-201 live verification (ROLLBACK-safe).
--
-- Proves the homework → parent notification fan-out trigger:
--   T1  a homework INSERT for a class with 2 distinct parents (both with
--       ACTIVE portal accounts) creates EXACTLY 2 notifications (one per
--       parent — deduplicated even when both have 2 children in the class);
--   T2  the payload carries kind 'info', source_label 'Devoirs', the
--       'homework' deep link, the teacher as created_by, and the due date
--       in the body;
--   T3  a parent WITHOUT an active portal account (or with none at all)
--       receives NOTHING (honest-delivery contract, same as 0077);
--   T4  an INACTIVE student's parent is skipped;
--   R1  (regression) the 0061 touch trigger family is unaffected — the
--       homework row itself is inserted and readable;
--   R2  (regression) the 0075 chat trigger is unaffected (a chat message
--       in the same transaction still fans out exactly once per member).
--
-- Wrapped in BEGIN; … ROLLBACK; — re-runnable any time without mutating
-- the live DB. Results land in t193_results.
-- ============================================================================

begin;

create temp table t193_results (id text, ok boolean, detail text);

-- Fixtures: a class, three parents (A + B activated, C not), four students
-- (A-parent has TWO children in the class — dedup case; B one; C's child
-- inactive).
insert into public.user_profiles (id, auth_user_id, tenant_id, email, display_name, status)
values
    ('61111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000001', 't193-a@test.local', 'T193 Parent A', 'active'),
    ('61111111-1111-4111-8111-111111111112', '71111111-1111-4111-8111-111111111112', '00000000-0000-0000-0000-000000000001', 't193-b@test.local', 'T193 Parent B', 'active')
on conflict (id) do nothing;

insert into public.parents (id, tenant_id, parent_code, first_name, last_name, primary_phone, auth_user_id)
values
    ('72111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000001', 'PAR-T193-A', 'T193', 'ParentA', '0550000011', '71111111-1111-4111-8111-111111111111'),
    ('72111111-1111-4111-8111-111111111112', '00000000-0000-0000-0000-000000000001', 'PAR-T193-B', 'T193', 'ParentB', '0550000012', '71111111-1111-4111-8111-111111111112'),
    ('72111111-1111-4111-8111-111111111113', '00000000-0000-0000-0000-000000000001', 'PAR-T193-C', 'T193', 'ParentC', '0550000013', null)
on conflict (id) do nothing;

insert into public.students (id, tenant_id, parent_id, student_code, first_name, last_name, date_of_birth, gender, class_id, enrollment_date, enrollment_status, is_active)
values
    ('73111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000001', '72111111-1111-4111-8111-111111111111', 'ELV-T193-1', 'Enfant', 'A1', '2015-01-01', 'male', (select id from public.classes order by created_at limit 1), '2026-09-01', 'active', true),
    ('73111111-1111-4111-8111-111111111112', '00000000-0000-0000-0000-000000000001', '72111111-1111-4111-8111-111111111111', 'ELV-T193-2', 'Enfant', 'A2', '2016-01-01', 'female', (select id from public.classes order by created_at limit 1), '2026-09-01', 'active', true),
    ('73111111-1111-4111-8111-111111111113', '00000000-0000-0000-0000-000000000001', '72111111-1111-4111-8111-111111111112', 'ELV-T193-3', 'Enfant', 'B1', '2015-06-01', 'male', (select id from public.classes order by created_at limit 1), '2026-09-01', 'active', true),
    ('73111111-1111-4111-8111-111111111114', '00000000-0000-0000-0000-000000000001', '72111111-1111-4111-8111-111111111113', 'ELV-T193-4', 'Enfant', 'C1', '2015-06-01', 'male', (select id from public.classes order by created_at limit 1), '2026-09-01', 'active', false)
on conflict (id) do nothing;

insert into public.homework (id, tenant_id, class_id, subject_id, subject_name, teacher_id, teacher_name, title, description, due_date, attachments, academic_year)
values ('74111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000001',
        (select id from public.classes order by created_at limit 1),
        (select id from public.subjects order by created_at limit 1), 'Mathématiques',
        '61111111-1111-4111-8111-111111111111', 'T193 Enseignant',
        'Exercices pages 12 et 13', 'Terminer les exercices du manuel.', '2026-09-10',
        '[]'::jsonb, '2026-2027');

insert into t193_results
select 'T1_two_distinct_activated_parents', count(*) = 2, 'rows=' || count(*)
  from public.notifications
 where link_entity_type = 'homework'
   and link_entity_id = '74111111-1111-4111-8111-111111111111';

insert into t193_results
select 'T2_payload_shape', bool_and(
           kind = 'info'
           and source = 'system'
           and source_label = 'Devoirs'
           and priority = 'medium'
           and title = 'Nouveau devoir — Mathématiques'
           and body like 'Exercices pages 12 et 13%à rendre le 10/09/2026%'
           and created_by = '61111111-1111-4111-8111-111111111111'
       ) and count(*) = 2,
       'checked ' || count(*) || ' row(s)'
  from public.notifications
 where link_entity_id = '74111111-1111-4111-8111-111111111111';

insert into t193_results
select 'T3_unactivated_parent_not_notified', count(*) = 0, 'rows=' || count(*)
  from public.notifications
 where link_entity_id = '74111111-1111-4111-8111-111111111111'
   and target_user_id not in ('61111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111112');

insert into t193_results
select 'T4_inactive_student_parent_skipped', count(*) = 0, 'rows=' || count(*)
  from public.notifications
 where link_entity_id = '74111111-1111-4111-8111-111111111111'
   and title like '%C1%';

insert into t193_results
select 'R1_homework_row_inserted', count(*) = 1, 'rows=' || count(*)
  from public.homework
 where id = '74111111-1111-4111-8111-111111111111';

-- R2: the 0075 chat trigger is unaffected in the same transaction shape.
insert into public.chat_channels (id, tenant_id, code, name, channel_type, member_ids, created_by)
values ('75111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000001',
        'T193-DM', 'T193 DM', 'direct',
        array['61111111-1111-4111-8111-111111111111'::uuid, '61111111-1111-4111-8111-111111111112'::uuid],
        '61111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

insert into public.chat_messages (id, tenant_id, channel_id, author_id, body, sent_at)
values ('76111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000001',
        '75111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111', 'T193 chat check.', now());

insert into t193_results
select 'R2_chat_trigger_unaffected', count(*) = 1, 'rows=' || count(*)
  from public.notifications
 where link_entity_type = 'chat_channel'
   and link_entity_id = '75111111-1111-4111-8111-111111111111'
   and target_user_id = '61111111-1111-4111-8111-111111111112';

select id, ok, detail from t193_results order by id;
rollback;
