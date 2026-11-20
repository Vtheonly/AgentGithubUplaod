-- ============================================================================
-- 0088_workflow_condition_subtype.sql
-- ============================================================================
-- RECONSTRUCTED FROM LIVE (58th session, 2026-09-13 — T-326 / ARCH-011
-- reconciliation): this migration was applied to the production project by a
-- concurrent session and registered in supabase_migrations.schema_migrations
-- (version '0088', name 'workflow_condition_subtype') WITHOUT its file ever
-- being committed to the chain — the exact ARCH-011 anti-pattern (a fresh
-- deployment would silently miss it). The file below reproduces the LIVE
-- pg_get_functiondef() output byte-for-byte in its effect:
--
--   validate_workflow_dag gains the `has_medical_justification` CONDITION
--   subtype (the T-221/T-314 29-subtype registry's condition set: 5 -> 6),
--   matching the desktop NodeInspectorDrawer's predicate-builder output.
--   Everything else (Kahn cycle walk, trigger-root rule, route_switch /
--   wait_duration strict-mode validation) is the 0081 body verbatim.
--
-- Idempotent: CREATE OR REPLACE + ON CONFLICT registration (already applied
-- live — re-running is a no-op).
-- ============================================================================

create or replace function public.validate_workflow_dag(p_definition jsonb, p_strict boolean default true)
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
        "condition": ["debt_over_threshold","payment_method_match","student_status_match","time_window","route_switch","has_medical_justification"],
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

            if v_type = 'condition' and v_subtype in ('debt_over_threshold','payment_method_match','student_status_match','has_medical_justification') then
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
-- Registration (T-091/MIG-TOKENS pattern — already applied live; ON CONFLICT
-- keeps this file a no-op on the live project while making fresh deployments
-- register it).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0088', '{0088_workflow_condition_subtype.sql}', 'workflow_condition_subtype')
on conflict (version) do nothing;
