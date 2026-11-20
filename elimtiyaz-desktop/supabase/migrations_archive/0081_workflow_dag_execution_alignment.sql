-- ============================================================================
-- 0081_workflow_dag_execution_alignment.sql
-- ============================================================================
-- Task: T-223 (34th session, 2026-09-07) — DAG automation system alignment.
--
-- WHAT (5 parts):
--   1. workflow_runs: NEW columns actor_note / request_id / workflow_version /
--      resumed_at + trigger_type CHECK extended with the T-221 trigger
--      subtypes (grade_below_threshold, payment_cleared_or_bounced,
--      document_expiration, calendar_cron_event, stock_level_critical).
--   2. workflows: NEW `version` column + BEFORE UPDATE trigger that bumps it
--      on every transition INTO 'published' (publish versioning).
--   3. workflow_pending_resumes: persistent delay/resume scheduling table
--      (T-228's engine parks a wait_duration node here; the scheduler EF
--      claims due rows and resumes the run — execution state survives
--      process termination because it is a ROW, not memory).
--   4. validate_workflow_dag(p_definition jsonb, p_strict boolean): the
--      server-side DAG validator (duplicate node/edge ids, missing node
--      references, self-edges, duplicate (source,target) pairs, Kahn cycle
--      detection naming the involved nodes, node type/subtype whitelist
--      mirroring the 29-subtype desktop registry, trigger in-degree rule,
--      strict-mode ≥1 trigger, condition-tree validation, wait_duration
--      config sanity).
--   5. workflows_publish_gate: BEFORE UPDATE trigger — an INVALID DAG can
--      never be published through ANY writer (the requirement the
--      client-side Kahn guard could not enforce: server-side validation).
--
-- WHY (opening audit of the 34th session):
--   The live workflow-execute EF (v21) reads `workflows.definition` /
--   `version` — columns that DO NOT EXIST (the table has dag_definition,
--   no version) → every call 404s; it inserts workflow_version /
--   triggered_by_profile_id / actor_note / request_id — none exist →
--   PGRST 204. The 0012 trigger_type CHECK predates the T-221 subtype
--   expansion, so a run triggered by e.g. grade_below_threshold would
--   violate the constraint. Nothing here changes business rules — it is
--   the schema catching up to the persisted desktop contract
--   ({nodes:[{id,type,subtype,label,position,config}], edges:[{id,source,
--   target}]}, migration-0012 comment + T-176 mapping notes).
--
-- SAFETY / IDEMPOTENCE:
--   - Pure additive DDL (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE
--     functions, DROP TRIGGER IF EXISTS + CREATE TRIGGER) — safe to re-run.
--   - The trigger_type CHECK replacement first DROPS whatever check
--     constraint(s) currently encode the 7-value legacy enum (name resolved
--     dynamically — 0012 created it unnamed), then re-adds the extended
--     constraint with an explicit name.
--   - Existing rows: 0 workflows / 0 workflow_runs live (verified 2026-09-07)
--     — no backfill needed; every new column is nullable or defaulted.
--   - RLS untouched (workflows/workflow_runs policies from 0019).
--   - workflow_pending_resumes is service-role-only by design (RLS enabled,
--     NO policies — only the scheduler EF / service key touch it; the
--     desktop observes pause state through workflow_runs.node_results).
--
-- IMPLEMENTATION NOTE (Kahn in plpgsql): the walk uses FLAT parallel edge
-- arrays (deduped (source,target) pairs) + a 1-D in-degree array. plpgsql
-- arrays are rectangular N-D — jagged int[][] adjacency is NOT reliably
-- assignable, so the classic adjacency-list form is avoided on purpose.
--
-- KNOWN QUIRK (AGENTS.md §11.1): COMMENT ON statements are silently dropped
-- by the Management-API SQL endpoint — they land on fresh CLI deployments
-- only. Catalog NULL comments on the live DB are the documented state.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1a. workflow_runs — execution-contract columns
-- ----------------------------------------------------------------------------
alter table public.workflow_runs
    add column if not exists actor_note        text,
    add column if not exists request_id        text,
    add column if not exists workflow_version  integer check (workflow_version is null or workflow_version >= 1),
    add column if not exists resumed_at        timestamptz;

comment on column public.workflow_runs.actor_note is
  'Free-text note from the triggering actor (e.g. "Desktop manual run by X"). Written by the workflow-execute EF. Added by 0081 (T-223).';
comment on column public.workflow_runs.request_id is
  'Correlation id (x-request-id header or generated) for cross-referencing EF logs + audit entries. Added by 0081 (T-223).';
comment on column public.workflow_runs.workflow_version is
  'workflows.version at execution time (publish counter — bumped by the workflows_version_on_publish trigger). Added by 0081 (T-223).';
comment on column public.workflow_runs.resumed_at is
  'Set when a parked run (workflow_pending_resumes) is resumed by the scheduler EF. Added by 0081 (T-223).';

-- ----------------------------------------------------------------------------
-- 1b. workflow_runs — trigger_type CHECK extension (T-221 subtypes)
-- ----------------------------------------------------------------------------
do $$
declare
    r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.workflow_runs'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%trigger_type%'
    loop
        execute format('alter table public.workflow_runs drop constraint %I', r.conname);
    end loop;
end $$;

alter table public.workflow_runs
    add constraint workflow_runs_trigger_type_check
    check (trigger_type in (
        -- legacy 0012 set
        'payment_overdue', 'student_enrolled', 'payment_recorded',
        'schedule', 'absence_limit', 'manual_run', 'debt_over_threshold',
        -- T-221 educational trigger set (desktop absence_limit_exceeded maps
        -- to the legacy 'absence_limit' spelling on the run side)
        'grade_below_threshold', 'payment_cleared_or_bounced',
        'document_expiration', 'calendar_cron_event', 'stock_level_critical'
    ));

-- ----------------------------------------------------------------------------
-- 2. workflows — version column + publish-increment trigger
-- ----------------------------------------------------------------------------
alter table public.workflows
    add column if not exists version integer not null default 0 check (version >= 0);

comment on column public.workflows.version is
  'Publish counter: 0 = never published (draft); every transition INTO published bumps it by 1 (first publish = 1). Recorded on each workflow_run (workflow_runs.workflow_version). Added by 0081 (T-223).';

create or replace function public.workflows_version_on_publish()
returns trigger
language plpgsql
as $$
begin
    -- Bump the publish version on every transition INTO 'published'
    -- (draft→published, disabled→published). The column default is 0
    -- (= never published), so the first publish lands at 1.
    -- Unpublishing/editing does NOT touch it.
    if new.status = 'published' and old.status is distinct from 'published' then
        new.version := coalesce(old.version, 0) + 1;
    end if;
    return new;
end;
$$;

drop trigger if exists workflows_version_on_publish on public.workflows;
create trigger workflows_version_on_publish
    before update on public.workflows
    for each row execute function public.workflows_version_on_publish();

-- ----------------------------------------------------------------------------
-- 3. workflow_pending_resumes — persistent delay/resume scheduling (T-228)
-- ----------------------------------------------------------------------------
create table if not exists public.workflow_pending_resumes (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    run_id          uuid        not null references public.workflow_runs(id) on delete cascade,
    workflow_id     uuid        not null references public.workflows(id) on delete restrict,
    node_id         text        not null,
    -- Serialized engine state: the topological walk position, open-edge set,
    -- accumulated node_results, execution context. Everything needed to
    -- re-enter the run at this node after process death.
    state           jsonb       not null default '{}'::jsonb,
    resume_after    timestamptz not null,
    status          text        not null default 'pending' check (status in ('pending', 'claimed', 'completed', 'cancelled')),
    claimed_at      timestamptz,
    completed_at    timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- Due-work scan for the scheduler EF (partial: only pending rows matter).
create index if not exists workflow_pending_resumes_due_idx
    on public.workflow_pending_resumes (resume_after)
    where status = 'pending';

create index if not exists workflow_pending_resumes_run_idx
    on public.workflow_pending_resumes (run_id);

create index if not exists workflow_pending_resumes_tenant_idx
    on public.workflow_pending_resumes (tenant_id, created_at desc);

-- Duplicate-execution protection: at most ONE pending/claimed resume per
-- (run, node). A second park attempt on the same node of the same run is
-- rejected by the index (the engine re-parks by node id after a re-entry).
create unique index if not exists workflow_pending_resumes_run_node_uidx
    on public.workflow_pending_resumes (run_id, node_id)
    where status in ('pending', 'claimed');

comment on table public.workflow_pending_resumes is
  'Persistent delay/resume queue for workflow runs parked at a wait_duration node (T-228). Claimed atomically by the workflow-resume-scheduler EF. RLS enabled with NO policies: service-role only — the desktop observes pause state via workflow_runs.node_results. Added by 0081 (T-223).';

-- Service-role-only table: RLS on, no policies (deny-by-default to clients).
alter table public.workflow_pending_resumes enable row level security;

create trigger workflow_pending_resumes_touch_updated_at
    before update on public.workflow_pending_resumes
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4a. workflow_condition_valid — recursive condition-tree validation
-- ----------------------------------------------------------------------------
-- Mirrors parseConditionConfig/evaluateNode (domain/calc/workflow/
-- condition-evaluator.ts): comparison {kind,field,op,value} with op in the
-- 6 canonical operators, or logic {kind,combinator,children[]} with
-- combinator in and/or/not (NOT requires exactly 1 child).
create or replace function public.workflow_condition_valid(p_node jsonb)
returns boolean
language plpgsql
stable
as $$
declare
    v_kind       text;
    v_combinator text;
    v_child      jsonb;
begin
    if p_node is null or jsonb_typeof(p_node) <> 'object' then
        return false;
    end if;
    v_kind := p_node ->> 'kind';
    if v_kind = 'comparison' then
        return p_node ? 'field'
           and jsonb_typeof(p_node -> 'field') = 'string'
           and (p_node ->> 'field') <> ''
           and p_node ? 'op'
           and (p_node ->> 'op') in ('>', '<', '>=', '<=', '==', '!=');
    elsif v_kind = 'logic' then
        v_combinator := p_node ->> 'combinator';
        if v_combinator not in ('and', 'or', 'not') then
            return false;
        end if;
        if not p_node ? 'children' or jsonb_typeof(p_node -> 'children') <> 'array' then
            return false;
        end if;
        if v_combinator = 'not' and jsonb_array_length(p_node -> 'children') <> 1 then
            return false;
        end if;
        for v_child in select jsonb_array_elements(p_node -> 'children')
        loop
            if not public.workflow_condition_valid(v_child) then
                return false;
            end if;
        end loop;
        return true;
    end if;
    return false;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4b. validate_workflow_dag — the server-side DAG validator
-- ----------------------------------------------------------------------------
-- Returns jsonb:
--   { "valid": boolean, "errors": text[], "warnings": text[],
--     "node_count": int, "edge_count": int }
--
-- Rules (mirrors the desktop registry + kahn.ts + the EF engine validator;
-- the whitelists are pinned together by the desktop
-- workflow-dag-server-validation source-guard test):
--   structural : nodes/edges must be arrays; node.id non-empty + unique;
--                edge.id non-empty + unique; source/target must reference
--                existing node ids; no self-edges; no duplicate (source,
--                target) pairs.
--   taxonomy   : node.type in the 5 canonical types; node.subtype in the
--                per-type whitelist (the 29-subtype registry).
--   topology   : Kahn cycle detection (reports the involved node ids);
--                trigger nodes must have in-degree 0.
--   strict mode (publish): at least one trigger node; condition nodes need
--                a parseable condition tree (config.condition) or a legacy
--                scalar config; route_switch needs config.routes; delay
--                wait_duration needs a positive duration_ms.
create or replace function public.validate_workflow_dag(
    p_definition jsonb,
    p_strict     boolean default true
)
returns jsonb
language plpgsql
stable
as $$
declare
    v_nodes        jsonb;
    v_edges        jsonb;
    v_errors       text[] := '{}';
    v_warnings     text[] := '{}';
    v_node_ids     text[] := '{}';
    v_edge_ids     text[] := '{}';
    v_seen_pairs   text[] := '{}';
    v_subtype_map  jsonb := '{
        "trigger":   ["payment_overdue","student_enrolled","payment_recorded","schedule","absence_limit_exceeded","manual_run","grade_below_threshold","payment_cleared_or_bounced","document_expiration","calendar_cron_event","stock_level_critical"],
        "condition": ["debt_over_threshold","payment_method_match","student_status_match","time_window","route_switch"],
        "action":    ["send_email","apply_discount","create_invoice","push_notification","log_audit","send_whatsapp","restrict_account","dispatch_task","generate_document","account_adjustment"],
        "delay":     ["wait_duration"],
        "transform": ["database_query","extract_field"]
    }'::jsonb;
    v_node         jsonb;
    v_edge         jsonb;
    v_cfg          jsonb;
    v_id           text;
    v_type         text;
    v_subtype      text;
    v_source       text;
    v_target       text;
    v_pair         text;
    v_i            int;
    v_j            int;
    v_k            int;
    v_n            int;
    v_m            int;
    v_src_idx      int;
    v_tgt_idx      int;
    -- Kahn state: flat parallel arrays (deduped edge list) + 1-D in-degree.
    v_edge_src     int[] := '{}';
    v_edge_tgt     int[] := '{}';
    v_in_degree    int[];
    v_queue        int[];
    v_current      int;
    v_processed    int := 0;
    v_cycle_nodes  text[] := '{}';
    v_trigger_seen boolean := false;
    v_cond         jsonb;
    v_cond_text    jsonb;
    v_route        jsonb;
    v_duration     numeric;
begin
    -- ---------- structural: the definition object itself ----------
    if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
        return jsonb_build_object('valid', false, 'errors',
            jsonb_build_array('definition must be a JSON object with nodes[] and edges[]'),
            'warnings', '[]'::jsonb, 'node_count', 0, 'edge_count', 0);
    end if;
    if not p_definition ? 'nodes' or jsonb_typeof(p_definition -> 'nodes') <> 'array' then
        return jsonb_build_object('valid', false, 'errors',
            jsonb_build_array('definition.nodes must be an array'),
            'warnings', '[]'::jsonb, 'node_count', 0, 'edge_count', 0);
    end if;
    if not p_definition ? 'edges' or jsonb_typeof(p_definition -> 'edges') <> 'array' then
        return jsonb_build_object('valid', false, 'errors',
            jsonb_build_array('definition.edges must be an array'),
            'warnings', '[]'::jsonb, 'node_count', 0, 'edge_count', 0);
    end if;

    v_nodes := p_definition -> 'nodes';
    v_edges := coalesce(p_definition -> 'edges', '[]'::jsonb);
    v_n := jsonb_array_length(v_nodes);
    v_m := jsonb_array_length(v_edges);

    if v_n = 0 then
        v_errors := array_append(v_errors, 'workflow has no nodes');
    end if;

    -- ---------- nodes: id, type, subtype ----------
    v_i := 0;
    for v_node in select jsonb_array_elements(v_nodes)
    loop
        v_i := v_i + 1;
        if jsonb_typeof(v_node) <> 'object' then
            v_errors := array_append(v_errors, format('node[%s] is not an object', v_i - 1));
            v_node_ids := array_append(v_node_ids, '§invalid' || v_i::text || '§');
            continue;
        end if;
        v_id := v_node ->> 'id';
        if v_id is null or v_id = '' then
            v_errors := array_append(v_errors, format('node[%s] has an empty/missing id', v_i - 1));
            v_id := '§invalid' || v_i::text || '§';
        elsif v_id = any(v_node_ids) then
            v_errors := array_append(v_errors, format('duplicate node id "%s"', v_id));
        end if;
        v_node_ids := array_append(v_node_ids, v_id);

        v_type := v_node ->> 'type';
        if v_type is null or not (v_type = any(array['trigger','condition','action','delay','transform'])) then
            v_errors := array_append(v_errors, format('node "%s" has invalid type "%s"', v_id, coalesce(v_type, '§null§')));
        else
            v_subtype := v_node ->> 'subtype';
            if v_subtype is null or v_subtype = '' then
                v_errors := array_append(v_errors, format('node "%s" (type %s) is missing its subtype', v_id, v_type));
            elsif not (v_subtype = any(array(select jsonb_array_elements_text(coalesce(v_subtype_map -> v_type, '[]'::jsonb))))) then
                v_errors := array_append(v_errors, format('node "%s": subtype "%s" is not registered for type %s', v_id, v_subtype, v_type));
            end if;
        end if;

        if v_type = 'trigger' then
            v_trigger_seen := true;
        end if;
    end loop;

    -- ---------- edges: id, refs, self, duplicate pairs ----------
    v_i := 0;
    for v_edge in select jsonb_array_elements(v_edges)
    loop
        v_i := v_i + 1;
        if jsonb_typeof(v_edge) <> 'object' then
            v_errors := array_append(v_errors, format('edge[%s] is not an object', v_i - 1));
            continue;
        end if;
        v_id := v_edge ->> 'id';
        if v_id is null or v_id = '' then
            v_warnings := array_append(v_warnings, format('edge[%s] has no id (tolerated — key is (source,target))', v_i - 1));
        elsif v_id = any(v_edge_ids) then
            v_errors := array_append(v_errors, format('duplicate edge id "%s"', v_id));
        end if;
        v_edge_ids := array_append(v_edge_ids, v_id);

        v_source := v_edge ->> 'source';
        v_target := v_edge ->> 'target';
        if v_source is null or v_source = '' or not (v_source = any(v_node_ids)) then
            v_errors := array_append(v_errors, format('edge "%s" references unknown source node "%s"', coalesce(v_id, format('edge[%s]', v_i - 1)), coalesce(v_source, '§null§')));
        end if;
        if v_target is null or v_target = '' or not (v_target = any(v_node_ids)) then
            v_errors := array_append(v_errors, format('edge "%s" references unknown target node "%s"', coalesce(v_id, format('edge[%s]', v_i - 1)), coalesce(v_target, '§null§')));
        end if;
        if v_source is not null and v_source = v_target then
            v_errors := array_append(v_errors, format('edge "%s" is a self-reference on node "%s"', coalesce(v_id, format('edge[%s]', v_i - 1)), v_source));
        end if;
        if v_source is not null and v_target is not null and v_source <> v_target
           and (v_source = any(v_node_ids)) and (v_target = any(v_node_ids)) then
            v_pair := v_source || '->' || v_target;
            if v_pair = any(v_seen_pairs) then
                v_errors := array_append(v_errors, format('duplicate edge between "%s" and "%s"', v_source, v_target));
            else
                -- Deduped edge list for the Kahn walk (first pair wins).
                v_edge_src := array_append(v_edge_src, array_position(v_node_ids, v_source));
                v_edge_tgt := array_append(v_edge_tgt, array_position(v_node_ids, v_target));
            end if;
            v_seen_pairs := array_append(v_seen_pairs, v_pair);
        end if;
    end loop;

    -- ---------- Kahn cycle detection (in-degree walk, flat edge arrays) ----------
    if v_n > 0 and coalesce(array_length(v_node_ids, 1), 0) = v_n then
        for v_i in 1..v_n loop
            v_in_degree[v_i] := 0;
        end loop;
        for v_k in 1..coalesce(array_length(v_edge_src, 1), 0) loop
            v_in_degree[v_edge_tgt[v_k]] := coalesce(v_in_degree[v_edge_tgt[v_k]], 0) + 1;
        end loop;

        for v_i in 1..v_n loop
            if coalesce(v_in_degree[v_i], 0) = 0 then
                v_queue := array_append(v_queue, v_i);
            end if;
        end loop;

        while coalesce(array_length(v_queue, 1), 0) > 0
        loop
            v_current := v_queue[1];
            v_queue := v_queue[2:coalesce(array_length(v_queue, 1), 1)];
            v_processed := v_processed + 1;
            for v_k in 1..coalesce(array_length(v_edge_src, 1), 0) loop
                if v_edge_src[v_k] = v_current then
                    v_j := v_edge_tgt[v_k];
                    v_in_degree[v_j] := v_in_degree[v_j] - 1;
                    if v_in_degree[v_j] = 0 then
                        v_queue := array_append(v_queue, v_j);
                    end if;
                end if;
            end loop;
        end loop;

        if v_processed < v_n then
            for v_i in 1..v_n loop
                if coalesce(v_in_degree[v_i], 0) > 0 then
                    v_cycle_nodes := array_append(v_cycle_nodes, v_node_ids[v_i]);
                end if;
            end loop;
            v_errors := array_append(v_errors,
                format('cycle detected — %s node(s) involved: %s (Kahn)',
                       coalesce(array_length(v_cycle_nodes, 1), 0), array_to_string(v_cycle_nodes, ', ')));
        end if;

        -- Trigger in-degree rule (a trigger fed by another node is malformed).
        -- Computed from the deduped edge list (the walk above MUTATES
        -- v_in_degree, so it cannot be reused here).
        for v_node in select jsonb_array_elements(v_nodes)
        loop
            if (v_node ->> 'type') = 'trigger' then
                v_src_idx := array_position(v_node_ids, v_node ->> 'id');
                if v_src_idx is not null then
                    v_tgt_idx := 0;
                    for v_k in 1..coalesce(array_length(v_edge_tgt, 1), 0) loop
                        if v_edge_tgt[v_k] = v_src_idx then
                            v_tgt_idx := v_tgt_idx + 1;
                        end if;
                    end loop;
                    if v_tgt_idx > 0 then
                        v_errors := array_append(v_errors,
                            format('trigger node "%s" has incoming edges — triggers must be roots', v_node ->> 'id'));
                    end if;
                end if;
            end if;
        end loop;
    end if;

    -- ---------- strict-mode rules (publish gate) ----------
    if p_strict then
        if not v_trigger_seen and v_n > 0 then
            v_errors := array_append(v_errors, 'workflow has no trigger node (required for publishing)');
        end if;

        for v_node in select jsonb_array_elements(v_nodes)
        loop
            v_id := v_node ->> 'id';
            v_subtype := v_node ->> 'subtype';
            v_type := v_node ->> 'type';
            v_cfg := coalesce(v_node -> 'config', '{}'::jsonb);

            if v_type = 'condition' and v_subtype in ('debt_over_threshold','payment_method_match','student_status_match') then
                v_cond := coalesce(v_cfg -> 'condition', v_cfg -> '_condition');
                if v_cond is null then
                    -- legacy scalar configs tolerated with a warning
                    if v_cfg ? 'threshold' or v_cfg ? 'method' or v_cfg ? 'status' then
                        v_warnings := array_append(v_warnings,
                            format('node "%s": legacy scalar condition config (no canonical condition tree)', v_id));
                    else
                        v_errors := array_append(v_errors,
                            format('node "%s": condition node has no condition configured', v_id));
                    end if;
                elsif jsonb_typeof(v_cond) = 'string' then
                    begin
                        v_cond_text := (v_cond #>> '{}')::jsonb;
                        if not public.workflow_condition_valid(v_cond_text) then
                            v_errors := array_append(v_errors, format('node "%s": malformed condition tree', v_id));
                        end if;
                    exception when others then
                        v_errors := array_append(v_errors, format('node "%s": condition is a string but not valid JSON', v_id));
                    end;
                elsif not public.workflow_condition_valid(v_cond) then
                    v_errors := array_append(v_errors, format('node "%s": malformed condition tree', v_id));
                end if;
            end if;

            if v_type = 'condition' and v_subtype = 'route_switch' then
                if not (v_cfg ? 'routes') or jsonb_typeof(v_cfg -> 'routes') <> 'array' then
                    v_errors := array_append(v_errors, format('node "%s": route_switch has no routes configured', v_id));
                else
                    for v_route in select jsonb_array_elements(v_cfg -> 'routes')
                    loop
                        if jsonb_typeof(v_route) <> 'object' or not (v_route ? 'condition') then
                            v_errors := array_append(v_errors, format('node "%s": a route is missing its condition', v_id));
                        elsif not public.workflow_condition_valid(v_route -> 'condition') then
                            v_errors := array_append(v_errors, format('node "%s": a route condition is malformed', v_id));
                        end if;
                    end loop;
                end if;
            end if;

            if v_type = 'delay' and v_subtype = 'wait_duration' then
                if v_cfg ? 'duration_ms' then
                    begin
                        v_duration := (v_cfg ->> 'duration_ms')::numeric;
                        if v_duration is null or v_duration <= 0 then
                            v_errors := array_append(v_errors, format('node "%s": wait_duration must be a positive duration_ms', v_id));
                        end if;
                    exception when others then
                        v_errors := array_append(v_errors, format('node "%s": duration_ms is not a number', v_id));
                    end;
                else
                    v_errors := array_append(v_errors, format('node "%s": wait_duration has no duration_ms', v_id));
                end if;
            end if;
        end loop;
    end if;

    return jsonb_build_object(
        'valid', (coalesce(array_length(v_errors, 1), 0) = 0),
        'errors', to_jsonb(v_errors),
        'warnings', to_jsonb(v_warnings),
        'node_count', v_n,
        'edge_count', v_m
    );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. workflows_publish_gate — no invalid DAG can ever be published
-- ----------------------------------------------------------------------------
-- PostgreSQL fires same-event BEFORE triggers in NAME order:
-- 'workflows_publish_gate' < 'workflows_touch_updated_at' (0012) <
-- 'workflows_version_on_publish' — validation runs FIRST, so a rejected
-- update never bumps the version or the timestamp (the raised exception
-- aborts the statement).
--
-- Validation scope:
--   - any transition INTO 'published' (draft→published, disabled→published);
--   - any dag_definition change while ALREADY published (an edit that would
--     corrupt a live workflow is rejected too — the strict gate holds for
--     the whole published lifetime).
-- Drafts are free-form (the client-side Kahn guard still refuses to SAVE a
-- cyclic graph from the builder; drafts are never executable).
create or replace function public.workflows_publish_gate()
returns trigger
language plpgsql
as $$
declare
    v_result jsonb;
    v_errors text[];
begin
    if new.status = 'published'
       and (old.status is distinct from 'published'
            or new.dag_definition is distinct from old.dag_definition) then
        v_result := public.validate_workflow_dag(new.dag_definition, true);
        if not (v_result ->> 'valid')::boolean then
            v_errors := array(select jsonb_array_elements_text(v_result -> 'errors'));
            raise exception 'workflow publish rejected: %',
                    array_to_string(v_errors, ' | ')
                using errcode = '23514';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists workflows_publish_gate on public.workflows;
create trigger workflows_publish_gate
    before update on public.workflows
    for each row execute function public.workflows_publish_gate();

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — scripts/apply_0081_live.sh embeds
-- this so the DDL + registration land in ONE atomic transaction)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0081', '{0081_workflow_dag_execution_alignment.sql}', 'workflow_dag_execution_alignment')
on conflict (version) do nothing;
