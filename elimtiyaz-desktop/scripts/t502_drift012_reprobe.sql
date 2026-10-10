-- T-502: the DRIFT-012 re-probe under the TODAY-readable live policy text.
-- Re-runs the EXACT T-500 F8 + I2 insert shapes under authenticated-role
-- impersonation, inside a ROLLBACK transaction (zero residue).
-- Structure: resolve ids as the session superuser FIRST, then downgrade.
begin;

create temp table t502_ids (
    parent_auth uuid, parent_profile uuid, personnel_id uuid, student_id uuid
) on commit drop;

insert into t502_ids (parent_auth, parent_profile)
select u.id, p.id
  from auth.users u
  join public.user_profiles p on p.auth_user_id = u.id
  join public.role_assignments ra on ra.user_profile_id = p.id
  join public.roles r on r.id = ra.role_id
 where r.code = 'parent' and ra.revoked_at is null
   and p.tenant_id = '00000000-0000-0000-0000-000000000001'
 limit 1;

update t502_ids set
    personnel_id = (select id from public.personnel
                     where tenant_id = '00000000-0000-0000-0000-000000000001'
                     order by created_at limit 1),
    student_id = (select id from public.students
                   where tenant_id = '00000000-0000-0000-0000-000000000001'
                   limit 1);

create temp table t502_probe (probe text, outcome text, detail text) on commit drop;
grant select, insert on t502_probe to authenticated;
grant select on t502_ids to authenticated;

-- ── P-F8: the admin (super_admin, tenant 001) inserts a parent-targeted
--    notification with target_role='parent' — the exact F8 shape that
--    403'd on 2026-10-10. ────────────────────────────────────────────
select set_config('request.jwt.claims',
  '{"sub":"a148fe34-98e3-422a-bf42-91da094e270c","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
    v_parent_profile uuid;
    v_student uuid;
    v_roles text[];
    v_tenant uuid;
begin
    select current_user_roles() into v_roles;
    select current_tenant_id() into v_tenant;
    select parent_profile, student_id into v_parent_profile, v_student from t502_ids;

    begin
        insert into public.notifications (
            tenant_id, kind, title, body, priority, source,
            target_user_id, target_role, link_entity_type, link_entity_id, created_by
        ) values (
            '00000000-0000-0000-0000-000000000001', 'warning',
            'T502 probe (rolled back)', 'probe', 'high', 'system',
            v_parent_profile, 'parent', 'student', v_student,
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'
        );
        insert into t502_probe values ('F8-impersonated',
            'ALLOWED', 'admin roles=' || v_roles::text || ' tenant=' || coalesce(v_tenant::text,'null'));
    exception when insufficient_privilege then
        insert into t502_probe values ('F8-impersonated', 'REFUSED-42501',
            'insufficient_privilege; admin roles=' || v_roles::text);
    when others then
        insert into t502_probe values ('F8-impersonated', 'ERROR-' || sqlstate,
            substr(sqlerrm, 1, 160));
    end;
end $$;

-- ── P-I2: a parent-role member (tenant 001) punches for a personnel id —
--    the exact I2 shape that 403'd on 2026-10-10. ────────────────────
do $$
declare
    v_ids record;
begin
    select * into v_ids from t502_ids;

    perform set_config('request.jwt.claims',
        json_build_object('sub', v_ids.parent_auth, 'role', 'authenticated')::text, true);

    begin
        insert into public.workforce_attendance_events (
            tenant_id, personnel_id, event_type, recorded_by
        ) values (
            '00000000-0000-0000-0000-000000000001', v_ids.personnel_id, 'clock_out',
            v_ids.parent_profile
        );
        insert into t502_probe values ('I2-impersonated', 'ALLOWED',
            'parent punch accepted under current live policy');
    exception when insufficient_privilege then
        insert into t502_probe values ('I2-impersonated', 'REFUSED-42501',
            'insufficient_privilege (the policy refuses)');
    when others then
        insert into t502_probe values ('I2-impersonated', 'ERROR-' || sqlstate,
            substr(sqlerrm, 1, 160));
    end;
end $$;

select * from t502_probe;
rollback;
