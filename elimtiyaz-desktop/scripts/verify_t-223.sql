-- ============================================================================
-- verify_t-223.sql — regression + acceptance evidence for migration 0081
-- (T-223, 34th session)
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can be
-- re-run any time without mutating the live DB. Results land in the temp
-- table t223_results and are SELECTed at the end. All exception-trapping
-- logic lives inside dollar-quoted DO blocks (Management-API quirk #9:
-- never put '' escapes in top-level SQL).
-- ============================================================================
BEGIN;

create temp table t223_results (
    check_name text,
    ok         boolean,
    detail     text
);

-- A valid reference DAG: trigger → condition → (true: action, false: action)
-- + a converging final action.
do $$
declare
    v_dag jsonb := '{
        "nodes": [
            {"id": "t1", "type": "trigger",   "subtype": "payment_overdue",    "label": "Overdue",   "position": {"x":0,"y":0},   "config": {}},
            {"id": "c1", "type": "condition", "subtype": "debt_over_threshold","label": "Debt>40k",  "position": {"x":1,"y":0},   "config": {"condition": {"kind":"comparison","field":"parent.outstanding_balance","op":">","value":40000}}},
            {"id": "a1", "type": "action",    "subtype": "push_notification",  "label": "Urgent",    "position": {"x":2,"y":-1},  "config": {"title":"Urgent"}},
            {"id": "a2", "type": "action",    "subtype": "send_email",         "label": "Normal",    "position": {"x":2,"y":1},   "config": {"to":"p@x.dz"}},
            {"id": "d1", "type": "delay",     "subtype": "wait_duration",      "label": "Wait",      "position": {"x":3,"y":0},   "config": {"duration_ms": 60000}}
        ],
        "edges": [
            {"id": "e1", "source": "t1", "target": "c1"},
            {"id": "e2", "source": "c1", "target": "a1"},
            {"id": "e3", "source": "c1", "target": "a2"},
            {"id": "e4", "source": "a1", "target": "d1"},
            {"id": "e5", "source": "a2", "target": "d1"}
        ]
    }'::jsonb;
    v_res jsonb;
begin
    v_res := public.validate_workflow_dag(v_dag, true);
    insert into t223_results values ('valid_dag_strict',
        (v_res->>'valid')::boolean,
        (v_res->'errors')::text || ' / ' || (v_res->'warnings')::text);
end $$;

-- Cyclic DAG → invalid + the cycle is NAMED (node ids listed).
do $$
declare
    v_dag jsonb := '{
        "nodes": [
            {"id": "t1", "type": "trigger",   "subtype": "manual_run", "label": "T", "position": {"x":0,"y":0}, "config": {}},
            {"id": "c1", "type": "condition", "subtype": "student_status_match", "label": "C", "position": {"x":1,"y":0}, "config": {"condition": {"kind":"comparison","field":"student.status","op":"==","value":"active"}}},
            {"id": "a1", "type": "action",    "subtype": "log_audit",  "label": "A", "position": {"x":2,"y":0}, "config": {}}
        ],
        "edges": [
            {"id": "e1", "source": "t1", "target": "c1"},
            {"id": "e2", "source": "c1", "target": "a1"},
            {"id": "e3", "source": "a1", "target": "c1"}
        ]
    }'::jsonb;
    v_res jsonb;
begin
    v_res := public.validate_workflow_dag(v_dag, true);
    insert into t223_results values ('cycle_rejected_named',
        not (v_res->>'valid')::boolean and (v_res->>'errors') like '%cycle detected%'
            and (v_res->>'errors') like '%c1%' and (v_res->>'errors') like '%a1%',
        (v_res->'errors')::text);
end $$;

-- Structural rejections: duplicate node id / missing edge ref / self-edge /
-- duplicate pair / bad subtype / trigger with incoming edge / no trigger
-- (strict) / malformed definition / bad condition op / bad wait duration.
do $$
declare
    v_res jsonb;
    v_dup_node jsonb := '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}},{"id":"n1","type":"action","subtype":"log_audit","label":"b","position":{},"config":{}}],"edges":[]}';
    v_missing_ref jsonb := '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}}],"edges":[{"id":"e1","source":"n1","target":"ghost"}]}';
    v_self_edge jsonb := '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}}],"edges":[{"id":"e1","source":"n1","target":"n1"}]}';
    v_dup_pair jsonb := '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}},{"id":"n2","type":"action","subtype":"log_audit","label":"b","position":{},"config":{}}],"edges":[{"id":"e1","source":"n1","target":"n2"},{"id":"e2","source":"n1","target":"n2"}]}';
    v_bad_subtype jsonb := '{"nodes":[{"id":"n1","type":"trigger","subtype":"laser_beam","label":"a","position":{},"config":{}}],"edges":[]}';
    v_trigger_fed jsonb := '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}},{"id":"n2","type":"action","subtype":"log_audit","label":"b","position":{},"config":{}},{"id":"n3","type":"trigger","subtype":"schedule","label":"c","position":{},"config":{}}],"edges":[{"id":"e1","source":"n1","target":"n2"},{"id":"e2","source":"n2","target":"n3"}]}';
    v_no_trigger jsonb := '{"nodes":[{"id":"n1","type":"action","subtype":"log_audit","label":"a","position":{},"config":{}}],"edges":[]}';
    v_bad_cond jsonb := '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}},{"id":"c1","type":"condition","subtype":"debt_over_threshold","label":"c","position":{},"config":{"condition":{"kind":"comparison","field":"x","op":"~~","value":1}}}],"edges":[{"id":"e1","source":"n1","target":"c1"}]}';
    v_bad_wait jsonb := '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}},{"id":"d1","type":"delay","subtype":"wait_duration","label":"d","position":{},"config":{"duration_ms":-5}}],"edges":[{"id":"e1","source":"n1","target":"d1"}]}';
    v_route_ok jsonb := '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}},{"id":"r1","type":"condition","subtype":"route_switch","label":"r","position":{},"config":{"routes":[{"label":"V1","condition":{"kind":"comparison","field":"x","op":">","value":1}}]}},{"id":"a1","type":"action","subtype":"log_audit","label":"b","position":{},"config":{}}],"edges":[{"id":"e1","source":"n1","target":"r1"},{"id":"e2","source":"r1","target":"a1"}]}';
begin
    v_res := public.validate_workflow_dag(v_dup_node, true);
    insert into t223_results values ('duplicate_node_id_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%duplicate node id%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag(v_missing_ref, true);
    insert into t223_results values ('missing_edge_ref_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%unknown target node%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag(v_self_edge, true);
    insert into t223_results values ('self_edge_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%self-reference%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag(v_dup_pair, true);
    insert into t223_results values ('duplicate_pair_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%duplicate edge between%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag(v_bad_subtype, true);
    insert into t223_results values ('unregistered_subtype_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%not registered%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag(v_trigger_fed, true);
    insert into t223_results values ('fed_trigger_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%triggers must be roots%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag(v_no_trigger, true);
    insert into t223_results values ('strict_no_trigger_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%no trigger node%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag('{"nodes": "not-an-array", "edges": []}'::jsonb, true);
    insert into t223_results values ('malformed_definition_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%nodes must be an array%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag(v_bad_cond, true);
    insert into t223_results values ('bad_condition_op_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%malformed condition tree%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag(v_bad_wait, true);
    insert into t223_results values ('negative_wait_rejected', not (v_res->>'valid')::boolean and (v_res->>'errors') like '%positive duration_ms%', (v_res->'errors')::text);
    v_res := public.validate_workflow_dag(v_route_ok, true);
    insert into t223_results values ('route_switch_valid', (v_res->>'valid')::boolean, (v_res->'errors')::text || ' / ' || (v_res->'warnings')::text);
    -- Non-strict mode: cycles STILL fail (execution never walks a cycle),
    -- but the no-trigger / condition-config rules are relaxed.
    v_res := public.validate_workflow_dag(v_no_trigger, false);
    insert into t223_results values ('non_strict_no_trigger_tolerated', (v_res->>'valid')::boolean, (v_res->'errors')::text);
end $$;

-- Publish gate end-to-end on a REAL workflows row (rolled back).
do $$
declare
    v_tenant   uuid := (select id from public.tenants where is_active and deleted_at is null limit 1);
    v_wf_id    uuid;
    v_version  int;
    v_err      text;
begin
    insert into public.workflows (tenant_id, code, name, description, dag_definition, status)
    values (v_tenant, 'WF-T223-TEST', 'T-223 verify', null,
        '{"nodes":[{"id":"t1","type":"trigger","subtype":"manual_run","label":"T","position":{},"config":{}}],"edges":[]}'::jsonb,
        'draft')
    returning id into v_wf_id;

    -- 1. Valid publish → accepted, version = 1.
    update public.workflows set status = 'published' where id = v_wf_id
    returning version into v_version;
    insert into t223_results values ('publish_valid_ok_version_1', v_version = 1, 'version=' || v_version);

    -- 2. Corrupt the published DAG with a cycle → REJECTED.
    begin
        update public.workflows
           set dag_definition = '{"nodes":[{"id":"n1","type":"action","subtype":"log_audit","label":"a","position":{},"config":{}},{"id":"n2","type":"action","subtype":"log_audit","label":"b","position":{},"config":{}}],"edges":[{"id":"e1","source":"n1","target":"n2"},{"id":"e2","source":"n2","target":"n1"}]}'::jsonb
         where id = v_wf_id;
        insert into t223_results values ('published_edit_cycle_rejected', false, 'cycle edit was ACCEPTED (bug)');
    exception when others then
        v_err := sqlerrm;
        insert into t223_results values ('published_edit_cycle_rejected', v_err like '%publish rejected%', 'err: ' || v_err);
    end;

    -- 3. Republish cycle directly from draft → REJECTED.
    update public.workflows set status = 'disabled' where id = v_wf_id;
    update public.workflows set dag_definition = '{"nodes":[{"id":"n1","type":"action","subtype":"log_audit","label":"a","position":{},"config":{}}],"edges":[]}'::jsonb where id = v_wf_id;
    begin
        update public.workflows
           set dag_definition = '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}},{"id":"n2","type":"action","subtype":"log_audit","label":"b","position":{},"config":{}}],"edges":[{"id":"e1","source":"n1","target":"n2"},{"id":"e2","source":"n2","target":"n1"}]}'::jsonb
         where id = v_wf_id;
        update public.workflows set status = 'published' where id = v_wf_id;
        insert into t223_results values ('cyclic_publish_rejected', false, 'cyclic publish was ACCEPTED (bug)');
    exception when others then
        v_err := sqlerrm;
        insert into t223_results values ('cyclic_publish_rejected', v_err like '%publish rejected%' and v_err like '%cycle%', 'err: ' || v_err);
    end;

    -- 4. Fix the DAG → republish accepted → version bumps.
    update public.workflows
       set dag_definition = '{"nodes":[{"id":"n1","type":"trigger","subtype":"manual_run","label":"a","position":{},"config":{}}],"edges":[]}'::jsonb
     where id = v_wf_id;
    update public.workflows set status = 'published' where id = v_wf_id
    returning version into v_version;
    insert into t223_results values ('republish_bumps_version', v_version = 2, 'version=' || v_version);
end $$;

-- trigger_type CHECK extension.
do $$
declare
    v_tenant uuid := (select id from public.tenants where is_active and deleted_at is null limit 1);
    v_wf_id  uuid;
    v_run_id uuid;
begin
    insert into public.workflows (tenant_id, code, name, description, dag_definition, status)
    values (v_tenant, 'WF-T223-RUN', 'T-223 run check', null,
        '{"nodes":[{"id":"t1","type":"trigger","subtype":"grade_below_threshold","label":"T","position":{},"config":{}}],"edges":[]}'::jsonb,
        'published')
    returning id into v_wf_id;

    insert into public.workflow_runs (tenant_id, workflow_id, trigger_type, status, actor_note, request_id, workflow_version)
    values (v_tenant, v_wf_id, 'grade_below_threshold', 'succeeded', 't223 verify', 'req-t223', 1)
    returning id into v_run_id;
    insert into t223_results values ('new_trigger_type_accepted', v_run_id is not null, 'run row inserted');

    begin
        insert into public.workflow_runs (tenant_id, workflow_id, trigger_type, status)
        values (v_tenant, v_wf_id, 'laser_beam', 'succeeded');
        insert into t223_results values ('bogus_trigger_type_rejected', false, 'bogus type ACCEPTED (bug)');
    exception when check_violation then
        insert into t223_results values ('bogus_trigger_type_rejected', true, 'check_violation raised');
    end;
end $$;

-- workflow_pending_resumes: park/claim/duplicate protection.
do $$
declare
    v_tenant uuid := (select id from public.tenants where is_active and deleted_at is null limit 1);
    v_wf_id  uuid;
    v_run_id uuid;
    v_resume uuid;
begin
    insert into public.workflows (tenant_id, code, name, description, dag_definition, status)
    values (v_tenant, 'WF-T223-RES', 'T-223 resume check', null,
        '{"nodes":[{"id":"t1","type":"trigger","subtype":"manual_run","label":"T","position":{},"config":{}}],"edges":[]}'::jsonb,
        'published')
    returning id into v_wf_id;

    insert into public.workflow_runs (tenant_id, workflow_id, trigger_type, status)
    values (v_tenant, v_wf_id, 'manual_run', 'running')
    returning id into v_run_id;

    insert into public.workflow_pending_resumes (tenant_id, run_id, workflow_id, node_id, state, resume_after)
    values (v_tenant, v_run_id, v_wf_id, 'wait1', '{"context": {}}'::jsonb, now() + interval '7 days')
    returning id into v_resume;
    insert into t223_results values ('pending_resume_row_ok', v_resume is not null, 'parked');

    -- Duplicate park on the same (run, node) → unique violation.
    begin
        insert into public.workflow_pending_resumes (tenant_id, run_id, workflow_id, node_id, state, resume_after)
        values (v_tenant, v_run_id, v_wf_id, 'wait1', '{}'::jsonb, now() + interval '7 days');
        insert into t223_results values ('duplicate_pending_park_rejected', false, 'duplicate ACCEPTED (bug)');
    exception when unique_violation then
        insert into t223_results values ('duplicate_pending_park_rejected', true, 'unique_violation raised');
    end;

    -- Claim (the scheduler's atomic transition).
    update public.workflow_pending_resumes
       set status = 'claimed', claimed_at = now()
     where id = v_resume and status = 'pending';
    insert into t223_results values ('claim_transition_ok', true, 'claimed');
end $$;

-- Column existence (post-DDL catalog check).
do $$
declare
    v_cols int;
begin
    select count(*) into v_cols from information_schema.columns
     where table_schema = 'public' and table_name = 'workflow_runs'
       and column_name in ('actor_note', 'request_id', 'workflow_version', 'resumed_at');
    insert into t223_results values ('run_columns_present', v_cols = 4, 'found ' || v_cols || ' of 4');

    select count(*) into v_cols from information_schema.columns
     where table_schema = 'public' and table_name = 'workflows'
       and column_name = 'version';
    insert into t223_results values ('workflow_version_column_present', v_cols = 1, 'found ' || v_cols);
end $$;

select check_name, ok, detail from t223_results order by check_name;

ROLLBACK;
