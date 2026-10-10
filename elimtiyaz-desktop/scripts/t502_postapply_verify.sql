-- t502_postapply_verify.sql — the LIVE post-apply verification for the
-- T-502 migration round (0144 + 0145 + 0146+0147 atomic).
-- CORRECTED (v3): every probe runs under `set local role authenticated`
-- with explicit claims (the v1 run accidentally evaluated as the management
-- superuser — BYPASSRLS — which trivially passes every policy), and the
-- attendance upsert writes BOTH `date` and `record_date` (the repo's real
-- shape, T-023/ATT-100). All mutations inside ROLLBACK (zero residue).
--
-- Checks:
--   A1  the legacy 0004 index is GONE; the canonical 0041 index present.
--   A2  the second-session attendance upsert (morning→both) no longer 409s.
--   T1  super_admin DELETE on a task is POLICY-ALLOWED (the 0145 fix).
--   T2  parent-role DELETE on a task is POLICY-REFUSED (0 rows).
--   V1  notifications_insert catalog text carries the 0048 staff arm.
--   V2  workforce_insert catalog text carries the own-personnel arm.
--   V3  F8-shape insert WITH RETURNING (admin) → 42501 (NOTIF-107 posture).
--   V4  parent punch WITHOUT RETURNING → REFUSED (WORKFORCE-503 closed).
--   V5a staff punch WITHOUT RETURNING → ALLOWED.
--   V5b own-personnel punch (linked account) → ALLOWED.
begin;

create temp table t502_v (check_id text, outcome text, detail text) on commit drop;
grant select, insert on t502_v to authenticated;

-- ── the authenticated downgrade + the admin claims (transaction-scoped) ──
select set_config('request.jwt.claims',
    '{"sub":"a148fe34-98e3-422a-bf42-91da094e270c","role":"authenticated"}', true);
set local role authenticated;

-- ── A1: the index census (catalog views are authenticated-readable) ──
insert into t502_v
select 'A1-index-census',
       case when count(*) filter (where indexname = 'attendance_records_unique_session_uidx') = 0
              and count(*) filter (where indexname = 'uq_attendance_canonical') = 1
            then 'PASS' else 'FAIL' end,
       string_agg(indexname, ', ')
  from pg_indexes where tablename = 'attendance_records';

-- ── V1/V2: the policy catalog texts ──────────────────────────────────
insert into t502_v
select 'V1-notifications-0048-text',
       case when with_check like '%teacher%' and with_check like '%target_role%' then 'PASS' else 'FAIL' end,
       'staff arm + broadcast arm present'
  from pg_policies where tablename = 'notifications' and policyname = 'notifications_insert';

insert into t502_v
select 'V2-workforce-hardened-text',
       case when with_check like '%personnel%' and with_check like '%super_admin%' then 'PASS' else 'FAIL' end,
       'own-personnel arm + staff arm present'
  from pg_policies where tablename = 'workforce_attendance_events' and policyname = 'workforce_attendance_insert';

-- ── A2: the second-session upsert (F3 inverted), admin claims ────────
do $$
declare
    v_student uuid;
    v_class uuid;
    v_subject uuid;
    v_row1 uuid;
    v_row2 uuid;
begin
    select id into v_student from public.students
     where tenant_id = '00000000-0000-0000-0000-000000000001' limit 1;
    select id into v_class from public.classes
     where tenant_id = '00000000-0000-0000-0000-000000000001' limit 1;
    select id into v_subject from public.class_subjects
     where tenant_id = '00000000-0000-0000-0000-000000000001' limit 1;

    begin
        insert into public.attendance_records (
            tenant_id, student_id, class_id, class_subject_id, date, record_date,
            session, status, recorded_by
        ) values (
            '00000000-0000-0000-0000-000000000001', v_student, v_class, v_subject,
            current_date, current_date,
            'morning', 'present', '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'
        )
        on conflict (tenant_id, student_id, record_date, session) do update
            set status = excluded.status
        returning id into v_row1;

        -- session 2: 'both' — under the LEGACY 0004 index this died 409
        insert into public.attendance_records (
            tenant_id, student_id, class_id, class_subject_id, date, record_date,
            session, status, recorded_by
        ) values (
            '00000000-0000-0000-0000-000000000001', v_student, v_class, v_subject,
            current_date, current_date,
            'both', 'present', '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'
        )
        on conflict (tenant_id, student_id, record_date, session) do update
            set status = excluded.status
        returning id into v_row2;

        insert into t502_v values ('A2-second-session-upsert', 'PASS',
            'morning row + both row both landed (no 409) — the legacy index is gone');
    exception when unique_violation then
        insert into t502_v values ('A2-second-session-upsert', 'FAIL',
            'unique violation 23505 — ' || substr(sqlerrm, 1, 160));
    when others then
        insert into t502_v values ('A2-second-session-upsert', 'ERROR-' || sqlstate,
            substr(sqlerrm, 1, 200));
    end;
end $$;

-- ── T1/T2: the tasks_delete policy (0145) ───────────────────────────
do $$
declare
    v_task uuid;
    v_parent_auth uuid := '50121113-05f0-4fb1-bd8d-7d938cdf382c';
begin
    insert into public.tasks (tenant_id, title, status, priority, created_by)
    values ('00000000-0000-0000-0000-000000000001', 'T502 FAKE delete probe (rolled back)',
            'pending', 'medium', '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b')
    returning id into v_task;

    -- T1: super_admin DELETE — policy-allowed under 0145
    begin
        delete from public.tasks where id = v_task;
        if found then
            insert into t502_v values ('T1-admin-delete', 'PASS',
                'super_admin DELETE affected 1 row (the 0145 policy fires)');
        else
            insert into t502_v values ('T1-admin-delete', 'FAIL', '0 rows — the policy did not fire');
        end if;
    exception when insufficient_privilege then
        insert into t502_v values ('T1-admin-delete', 'FAIL', 'refused: ' || substr(sqlerrm,1,140));
    end;

    -- re-create for the parent probe (still admin claims)
    insert into public.tasks (tenant_id, title, status, priority, created_by)
    values ('00000000-0000-0000-0000-000000000001', 'T502 FAKE delete probe 2 (rolled back)',
            'pending', 'medium', '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b')
    returning id into v_task;

    perform set_config('request.jwt.claims',
        json_build_object('sub', v_parent_auth, 'role', 'authenticated')::text, true);

    -- T2: parent DELETE — policy-refused (0 rows under USING)
    begin
        delete from public.tasks where id = v_task;
        if found then
            insert into t502_v values ('T2-parent-delete', 'FAIL',
                'parent DELETE affected rows — the role union is too wide');
        else
            insert into t502_v values ('T2-parent-delete', 'PASS',
                'parent DELETE = 0-row no-op (the role union excludes parents)');
        end if;
    exception when insufficient_privilege then
        insert into t502_v values ('T2-parent-delete', 'PASS', 'refused at the policy: ' || substr(sqlerrm,1,120));
    end;
end $$;

-- ── V3/V4/V5: the notification + punch postures ─────────────────────
do $$
declare
    v_personnel uuid;
    v_own_personnel uuid;
    v_own_auth uuid;
    v_dummy uuid;
begin
    -- anchors under ADMIN claims (staff can read personnel)
    perform set_config('request.jwt.claims',
        '{"sub":"a148fe34-98e3-422a-bf42-91da094e270c","role":"authenticated"}', true);
    select id into v_personnel from public.personnel
     where tenant_id = '00000000-0000-0000-0000-000000000001'
     order by created_at limit 1;
    select pe.id, pe.user_id into v_own_personnel, v_own_auth
      from public.personnel pe
     where pe.tenant_id = '00000000-0000-0000-0000-000000000001'
       and pe.user_id is not null
     limit 1;

    -- V3: the F8 shape WITH RETURNING → must stay 42501 (NOTIF-107 posture)
    begin
        insert into public.notifications (
            tenant_id, kind, title, body, priority, source,
            target_user_id, target_role, created_by
        ) values (
            '00000000-0000-0000-0000-000000000001', 'warning', 'T502 V3 (rolled back)',
            'probe', 'high', 'system',
            '7c0bfafa-901c-44a9-918d-1a33ad3eef8a', 'parent',
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'
        )
        returning id into v_dummy;
        insert into t502_v values ('V3-f8-returning-block', 'FAIL', 'RETURNING visible — unexpected');
    exception when insufficient_privilege then
        insert into t502_v values ('V3-f8-returning-block', 'PASS',
            'still 42501 — the cross-target read-back stays blocked (NOTIF-107)');
    end;

    -- V5a: staff punch WITHOUT RETURNING → ALLOWED
    begin
        insert into public.workforce_attendance_events (
            tenant_id, personnel_id, event_type, recorded_by
        ) values ('00000000-0000-0000-0000-000000000001', v_personnel, 'clock_in',
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b');
        insert into t502_v values ('V5a-staff-punch', 'PASS', 'staff punch allowed');
    exception when insufficient_privilege then
        insert into t502_v values ('V5a-staff-punch', 'FAIL', 'refused: ' || substr(sqlerrm,1,140));
    end;

    -- V4: parent punch WITHOUT RETURNING → now REFUSED
    perform set_config('request.jwt.claims',
        '{"sub":"50121113-05f0-4fb1-bd8d-7d938cdf382c","role":"authenticated"}', true);
    begin
        insert into public.workforce_attendance_events (
            tenant_id, personnel_id, event_type, recorded_by
        ) values ('00000000-0000-0000-0000-000000000001', v_personnel, 'clock_out',
            '7c0bfafa-901c-44a9-918d-1a33ad3eef8a');
        insert into t502_v values ('V4-parent-punch', 'FAIL',
            'parent punch still allowed — the door is open');
    exception when insufficient_privilege then
        insert into t502_v values ('V4-parent-punch', 'PASS',
            'refused at the INSERT itself — WORKFORCE-503 closed for real');
    end;

    -- V5b: the personnel's OWN linked account punch → ALLOWED
    if v_own_auth is not null then
        perform set_config('request.jwt.claims',
            json_build_object('sub', v_own_auth, 'role', 'authenticated')::text, true);
        begin
            insert into public.workforce_attendance_events (
                tenant_id, personnel_id, event_type, recorded_by
            ) values ('00000000-0000-0000-0000-000000000001', v_own_personnel, 'clock_in', null);
            insert into t502_v values ('V5b-own-personnel-punch', 'PASS',
                'own-personnel punch allowed (the worker dashboard path)');
        exception when insufficient_privilege then
            insert into t502_v values ('V5b-own-personnel-punch', 'FAIL', 'refused: ' || substr(sqlerrm,1,140));
        end;
    else
        insert into t502_v values ('V5b-own-personnel-punch', 'SKIP',
            'no personnel row with a linked account in tenant 001');
    end if;
end $$;

select * from t502_v order by check_id;
rollback;
