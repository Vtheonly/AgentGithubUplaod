-- T-502: the audit-mirror contract probe — write_audit_log called with the
-- EXACT payload shape writeAuditMirror() sends (the 0014 RPC, impersonated
-- as the admin, ROLLED BACK — the append-only table keeps zero residue).
begin;

create temp table t502_m (probe text, outcome text, detail text) on commit drop;
grant select, insert on t502_m to authenticated;

select set_config('request.jwt.claims',
    '{"sub":"a148fe34-98e3-422a-bf42-91da094e270c","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
    v_id uuid;
begin
    -- the exact shape: p_tenant_id/p_action/p_entity_type/p_entity_id/
    -- p_actor_id/p_actor_name/p_before_json/p_after_json/p_note
    begin
        v_id := public.write_audit_log(
            p_tenant_id   := '00000000-0000-0000-0000-000000000001',
            p_action      := 'task.create',
            p_entity_type := 'task',
            p_entity_id   := null,
            p_actor_id    := '42e369e9-9f88-40a0-8434-ffd3b2c3ba8b',
            p_actor_name  := 'T-502 Mirror Probe',
            p_before_json := null,
            p_after_json  := jsonb_build_object('title', 'probe', 'status', 'pending'),
            p_note        := null
        );
        insert into t502_m values ('M1-mirror-rpc-shape', 'PASS',
            'uuid returned: ' || coalesce(v_id::text, 'NULL'));
    exception when others then
        insert into t502_m values ('M1-mirror-rpc-shape', 'FAIL',
            sqlstate || ': ' || substr(sqlerrm, 1, 180));
    end;

    -- the ACTION landing check: the row is visible inside the transaction
    -- (the append-only trigger allows INSERT; the rollback reverts it)
    begin
        perform 1 from public.audit_logs
         where action = 'task.create' and actor_name = 'T-502 Mirror Probe'
           and tenant_id = '00000000-0000-0000-0000-000000000001';
        if found then
            insert into t502_m values ('M2-row-visible', 'PASS',
                'the mirror row landed and is tenant-visible');
        else
            insert into t502_m values ('M2-row-visible', 'FAIL', 'row not found');
        end if;
    exception when others then
        insert into t502_m values ('M2-row-visible', 'FAIL', substr(sqlerrm, 1, 160));
    end;
end $$;

select * from t502_m;
rollback;
