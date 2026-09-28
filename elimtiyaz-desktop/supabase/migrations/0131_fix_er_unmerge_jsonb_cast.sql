-- ============================================================================
-- 0131_fix_er_unmerge_jsonb_cast.sql
-- T-438 (117th session, 2026-09-29): the ER-PMAE unmerge cast repair —
-- discovered LIVE by verify_t-438 (the §11.1 convention catching a real
-- defect before any caller could hit it).
--
-- THE BUG: fn_er_unmerge_parents' restore-mapping replay cast the
-- jsonb_each values DIRECTLY to uuid (`value::uuid`), which PostgreSQL
-- rejects with 42846 (jsonb has no direct uuid cast). The mapping keys and
-- values are JSON SCALARS — they must go through text first
-- (`value::text::uuid`). The merge RPC was unaffected (it BUILDS the
-- jsonb); only the unmerge's replay path was broken.
--
-- §1  fn_er_unmerge_parents recreated with the corrected casts (drop first
--     so no stale overload survives — the §15.32a discipline)
-- §2  Registration (the T-091/MIG-TOKENS pattern — atomic with the DDL)
--
-- Numbering: 0131 is the next free number.
-- ============================================================================

drop function if exists public.fn_er_unmerge_parents(uuid, uuid, text, text, uuid);

create or replace function public.fn_er_unmerge_parents(
    p_event_id    uuid,
    p_actor_id    uuid default null,
    p_actor_name  text default null,
    p_rationale   text default null,
    p_tenant_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $er_unmerge$
declare
    v_tenant      uuid;
    v_event       public.er_aggregation_events;
    v_restore     jsonb;
    v_row_id      uuid;
    v_prev_parent uuid;
    v_counts      jsonb;
    v_undone_id   uuid;
begin
    -- 0. Tenant + guards.
    v_tenant := coalesce(p_tenant_id, public.current_tenant_id());
    if v_tenant is null then
        raise exception 'fn_er_unmerge_parents: tenant requis';
    end if;

    select * into v_event
    from public.er_aggregation_events
    where id = p_event_id and tenant_id = v_tenant and event_type = 'MERGE_EXECUTED';

    if v_event.id is null then
        raise exception 'fn_er_unmerge_parents: événement de fusion introuvable (%)', p_event_id;
    end if;

    -- One unmerge per merge (idempotence of the reversal).
    if exists (
        select 1 from public.er_aggregation_events
        where tenant_id = v_tenant and event_type = 'MERGE_UNDONE'
          and payload->>'reversesEventId' = p_event_id::text
    ) then
        raise exception 'fn_er_unmerge_parents: cette fusion est déjà annulée';
    end if;

    v_restore := v_event.payload->'restoreMapping';

    -- 1. Replay the prior mapping (only rows that STILL point at the target
    --    from this merge — a row re-parented since is left alone, honestly).
    --    0131 FIX: a direct jsonb→uuid cast raises 42846, and value::text
    --    keeps the JSON quotes — the unquoted extraction is `#>> '{}'`
    --    (the KEY is already unquoted text).
    if v_restore->'students' is not null then
        for v_row_id, v_prev_parent in
            select key::uuid, (value #>> '{}')::uuid
            from jsonb_each(v_restore->'students')
        loop
            update public.students
            set parent_id = v_prev_parent
            where id = v_row_id and tenant_id = v_tenant
              and parent_id = v_event.canonical_id;
        end loop;
    end if;
    if v_restore->'payments' is not null then
        for v_row_id, v_prev_parent in
            select key::uuid, (value #>> '{}')::uuid
            from jsonb_each(v_restore->'payments')
        loop
            update public.payments
            set parent_id = v_prev_parent
            where id = v_row_id and tenant_id = v_tenant
              and parent_id = v_event.canonical_id;
        end loop;
    end if;
    if v_restore->'installments' is not null then
        for v_row_id, v_prev_parent in
            select key::uuid, (value #>> '{}')::uuid
            from jsonb_each(v_restore->'installments')
        loop
            update public.installments
            set parent_id = v_prev_parent
            where id = v_row_id and tenant_id = v_tenant
              and parent_id = v_event.canonical_id;
        end loop;
    end if;
    if v_restore->'ledger_entries' is not null then
        for v_row_id, v_prev_parent in
            select key::uuid, (value #>> '{}')::uuid
            from jsonb_each(v_restore->'ledger_entries')
        loop
            update public.ledger_entries
            set parent_id = v_prev_parent
            where id = v_row_id and tenant_id = v_tenant
              and parent_id = v_event.canonical_id;
        end loop;
    end if;

    -- 2. Restore the merged-away parent (un-soft-delete).
    update public.parents
    set deleted_at = null
    where id = v_event.merged_away_id and tenant_id = v_tenant;

    -- 3. Sever the identity edges tied to the merged-away canonical entity.
    update public.er_identity_edges
    set status = 'severed', severed_at = now(), severed_by = p_actor_id
    where tenant_id = v_tenant and status = 'active'
      and (a_observation_key = 'canonical:' || v_event.merged_away_id::text
           or b_observation_key = 'canonical:' || v_event.merged_away_id::text);

    -- 4. The MERGE_UNDONE event (referencing the reversed merge).
    insert into public.er_aggregation_events (
        tenant_id, event_type, run_id, canonical_id, merged_away_id,
        observation_keys, actor_id, actor_name, rationale, payload
    ) values (
        v_tenant, 'MERGE_UNDONE', v_event.run_id, v_event.canonical_id, v_event.merged_away_id,
        v_event.observation_keys, p_actor_id, p_actor_name, p_rationale,
        jsonb_build_object('reversesEventId', p_event_id::text)
    ) returning id into v_undone_id;

    -- 5. Audit.
    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'er.unmerge_parents',
        p_entity_type := 'parent',
        p_entity_id   := v_event.merged_away_id,
        p_actor_id    := p_actor_id,
        p_actor_name  := p_actor_name,
        p_before_json := jsonb_build_object('mergeEventId', p_event_id),
        p_after_json  := jsonb_build_object('undoneEventId', v_undone_id,
                                            'restoredParentId', v_event.merged_away_id),
        p_note        := format('ER-PMAE : annulation de la fusion %s — mappage restauré, parent %s rétabli.',
                                p_event_id, v_event.merged_away_id)
    );

    select jsonb_build_object(
        'students', (select count(*) from jsonb_object_keys(coalesce(v_restore->'students', '{}'::jsonb))),
        'payments', (select count(*) from jsonb_object_keys(coalesce(v_restore->'payments', '{}'::jsonb))),
        'installments', (select count(*) from jsonb_object_keys(coalesce(v_restore->'installments', '{}'::jsonb))),
        'ledger_entries', (select count(*) from jsonb_object_keys(coalesce(v_restore->'ledger_entries', '{}'::jsonb)))
    ) into v_counts;

    return jsonb_build_object(
        'eventId', v_undone_id,
        'restoredParentId', v_event.merged_away_id,
        'restored', v_counts
    );
end;
$er_unmerge$;

revoke all on function public.fn_er_unmerge_parents(uuid, uuid, text, text, uuid) from public;
grant execute on function public.fn_er_unmerge_parents(uuid, uuid, text, text, uuid)
    to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — atomic with the DDL)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0131', '{0131_fix_er_unmerge_jsonb_cast.sql}', 'fix_er_unmerge_jsonb_cast')
on conflict (version) do nothing;
