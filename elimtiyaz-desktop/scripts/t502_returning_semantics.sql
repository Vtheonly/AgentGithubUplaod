-- T-502: settle the INSERT...RETURNING RLS semantics + production overdue evidence.
-- Q1: does INSERT ... RETURNING * raise 42501 when the SELECT policy can't see
--     the new row (the F8 shape, admin claims)?
-- Q2: production evidence — do overdue-sourced notifications exist? who wrote them?
begin;

create temp table t502_ret (probe text, outcome text, detail text) on commit drop;
grant select, insert on t502_ret to authenticated;

set local role authenticated;

do $$
declare
    v_parent_profile uuid;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"a148fe34-98e3-422a-bf42-91da094e270c","role":"authenticated"}', true);

    -- the F8 shape WITH the RETURNING clause (PostgREST ?select=* equivalent)
    begin
        insert into public.notifications (
            tenant_id, kind, title, body, priority, source,
            target_user_id, target_role, link_entity_type, created_by
        ) values (
            '00000000-0000-0000-0000-000000000001', 'warning',
            'T502 RETURNING probe (rolled back)', 'probe', 'high', 'system',
            '7c0bfafa-901c-44a9-918d-1a33ad3eef8a', 'parent', 'student',
            '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b'
        )
        returning id, target_user_id;
        insert into t502_ret values ('F8-with-RETURNING', 'ALLOWED',
            'returning visible — no 42501');
    exception when insufficient_privilege then
        insert into t502_ret values ('F8-with-RETURNING', 'REFUSED-42501', substr(sqlerrm, 1, 250));
    when others then
        insert into t502_ret values ('F8-with-RETURNING', 'ERROR-' || sqlstate, substr(sqlerrm, 1, 250));
    end;
end $$;

select * from t502_ret;
rollback;

-- Q2 (autonomous, read-only): production overdue notification evidence
select source, count(*) as n,
       min(created_at)::date as first, max(created_at)::date as last
  from public.notifications
 group by source
 order by n desc
 limit 12;
