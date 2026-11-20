-- ============================================================================
-- 0132_er_rpc_tenant_guards.sql
-- T-439 (118th session, 2026-09-29): SEC-115 — the four 0130 ER-PMAE RPCs
-- resolve their tenant as coalesce(p_tenant_id, public.current_tenant_id())
-- with NO caller-tenant-mismatch guard. Any authenticated principal
-- (including parent-portal accounts, whom the er_* RLS explicitly excludes)
-- can pass ANY p_tenant_id and merge/unmerge/decide against another
-- tenant's identity data through the SECURITY DEFINER functions — RLS on
-- the er_* tables is bypassed by construction, so the RPC is the only gate
-- and it had none.
--
-- THE FIX (the 0128 guard convention — migrations 0059/0096/0107/0108/0128
-- all raise 42501 on caller/tenant mismatch):
--   §1  fn_er_resolve_tenant — the shared guard helper (the
--       fn_resolve_reenrollment_tenant pattern verbatim): the session tenant
--       WINS for ordinary staff; an explicit p_tenant_id is honored only
--       for service_role (the headless import + the verify scripts) or a
--       global admin; anything else → 42501.
--   §2  the four functions recreated with the guard (bodies VERBATIM from
--       0130/0131 — only the tenant-resolution block changes; 0131's
--       unmerge jsonb-cast fix is preserved).
--   §3  Registration (T-091/MIG-TOKENS).
--
-- Numbering: 0132 (0131 is the live unmerge cast fix — §15.9: applied
-- migrations are never edited).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. The shared tenant guard (the 0128 fn_resolve_reenrollment_tenant
--      pattern verbatim)
-- ----------------------------------------------------------------------------
create or replace function public.fn_er_resolve_tenant(p_tenant_id uuid default null)
returns uuid
language plpgsql
stable
as $$
declare
    v_tenant uuid;
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
    v_tenant := public.current_tenant_id();
    if p_tenant_id is not null and (v_tenant is null or p_tenant_id <> v_tenant) then
        if not v_caller_is_service_role and not public.is_global_admin() then
            raise exception 'er-pmae: caller tenant mismatch (p_tenant_id=%)', p_tenant_id
              using errcode = '42501';
        end if;
        v_tenant := p_tenant_id;
    end if;
    if v_tenant is null then
        raise exception 'er-pmae: caller tenant unresolvable'
          using errcode = '42501';
    end if;
    return v_tenant;
end;
$$;

revoke all on function public.fn_er_resolve_tenant(uuid) from public, anon;
grant execute on function public.fn_er_resolve_tenant(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- §2. The four RPCs recreated with the guard (bodies verbatim from
--      0130/0131 — only the tenant-resolution block changes)
-- ----------------------------------------------------------------------------

-- decide — the guarded recreation
create or replace function public.fn_er_decide_proposal(
    p_proposal_id  text,
    p_decision     text,      -- 'approve' | 'reject'
    p_actor_id     uuid default null,
    p_actor_name   text default null,
    p_rationale    text default null,
    p_tenant_id    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $er_decide$
declare
    v_tenant    uuid;
    v_proposal  public.er_match_proposals;
    v_event_id  uuid;
    v_edge      public.er_identity_edges;
begin
    -- 0. Tenant + guards (T-439/SEC-115: the 0128 caller-tenant-mismatch
    --    guard — the experimental flag was never an authorization boundary,
    --    and SECURITY DEFINER bypasses the er_* RLS by construction).
    v_tenant := public.fn_er_resolve_tenant(p_tenant_id);
    if p_decision not in ('approve', 'reject') then
        raise exception 'fn_er_decide_proposal: décision invalide (%)', p_decision;
    end if;

    select * into v_proposal
    from public.er_match_proposals
    where id = p_proposal_id and tenant_id = v_tenant
    for update;

    if not found then
        raise exception 'fn_er_decide_proposal: proposition introuvable (%)', p_proposal_id;
    end if;
    if v_proposal.status <> 'proposed' then
        raise exception 'fn_er_decide_proposal: proposition déjà décidée (statut %)', v_proposal.status
            using hint = 'A decided proposal is immutable — the audit trail is the correction path.';
    end if;

    -- 1. The edge: active on approve, negative on reject.
    --    A pre-existing negative edge means the pair was rejected before —
    --    refuse the approval (the review queue never re-proposes it anyway).
    select * into v_edge
    from public.er_identity_edges
    where tenant_id = v_tenant
      and a_observation_key = v_proposal.a_observation_key
      and b_observation_key = v_proposal.b_observation_key;

    if p_decision = 'reject' then
        insert into public.er_identity_edges as e (
            tenant_id, a_observation_key, b_observation_key, confidence, status,
            evidence, created_by
        ) values (
            v_tenant, v_proposal.a_observation_key, v_proposal.b_observation_key,
            v_proposal.confidence, 'negative',
            v_proposal.evidence, p_actor_id
        )
        on conflict (tenant_id, a_observation_key, b_observation_key)
        do update set status = 'negative', severed_at = null, severed_by = null;

        update public.er_match_proposals
        set status = 'rejected', decided_by = p_actor_id,
            decided_by_name = p_actor_name, decided_at = now(), rationale = p_rationale
        where id = p_proposal_id and tenant_id = v_tenant;

        insert into public.er_aggregation_events (
            tenant_id, event_type, run_id, canonical_id, observation_keys,
            actor_id, actor_name, rationale, payload
        ) values (
            v_tenant, 'PROPOSAL_REJECTED', v_proposal.run_id, v_proposal.b_canonical_id,
            array[v_proposal.a_observation_key, v_proposal.b_observation_key],
            p_actor_id, p_actor_name, p_rationale,
            jsonb_build_object('proposalId', p_proposal_id, 'confidence', v_proposal.confidence,
                               'band', v_proposal.band)
        ) returning id into v_event_id;

    else
        if v_edge.status = 'negative' then
            raise exception 'fn_er_decide_proposal: paire déjà rejetée (contrainte négative)'
                using hint = 'Un-reject explicitly via the review surface first.';
        end if;

        insert into public.er_identity_edges as e (
            tenant_id, a_observation_key, b_observation_key, confidence, status,
            evidence, created_by
        ) values (
            v_tenant, v_proposal.a_observation_key, v_proposal.b_observation_key,
            v_proposal.confidence, 'active',
            v_proposal.evidence, p_actor_id
        )
        on conflict (tenant_id, a_observation_key, b_observation_key)
        do update set status = 'active', confidence = excluded.confidence,
                      evidence = excluded.evidence, severed_at = null, severed_by = null;

        update public.er_match_proposals
        set status = 'approved', decided_by = p_actor_id,
            decided_by_name = p_actor_name, decided_at = now(), rationale = p_rationale
        where id = p_proposal_id and tenant_id = v_tenant;

        insert into public.er_aggregation_events (
            tenant_id, event_type, run_id, canonical_id, observation_keys,
            actor_id, actor_name, rationale, payload
        ) values (
            v_tenant, 'PROPOSAL_APPROVED', v_proposal.run_id, v_proposal.b_canonical_id,
            array[v_proposal.a_observation_key, v_proposal.b_observation_key],
            p_actor_id, p_actor_name, p_rationale,
            jsonb_build_object('proposalId', p_proposal_id, 'confidence', v_proposal.confidence,
                               'band', v_proposal.band)
        ) returning id into v_event_id;
    end if;

    -- 2. Audit (the canonical trail).
    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'er.decide_proposal',
        p_entity_type := 'er_match_proposal',
        p_entity_id   := null,
        p_actor_id    := p_actor_id,
        p_actor_name  := p_actor_name,
        p_after_json  := jsonb_build_object(
                             'proposalId', p_proposal_id,
                             'decision', p_decision,
                             'confidence', v_proposal.confidence,
                             'band', v_proposal.band
                         ),
        p_note        := format('ER-PMAE : proposition %s — décision %s (confiance %s).',
                                p_proposal_id, p_decision, v_proposal.confidence)
    );

    return jsonb_build_object(
        'eventId', v_event_id,
        'proposalId', p_proposal_id,
        'status', case when p_decision = 'approve' then 'approved' else 'rejected' end
    );
end;
$er_decide$;

-- merge — the guarded recreation
create or replace function public.fn_er_merge_parents(
    p_target_parent_id  uuid,
    p_source_parent_id  uuid,
    p_proposal_id       text default null,
    p_actor_id          uuid default null,
    p_actor_name        text default null,
    p_rationale         text default null,
    p_tenant_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $er_merge$
declare
    v_tenant       uuid;
    v_target       public.parents;
    v_source       public.parents;
    v_event_id     uuid;
    v_students     jsonb := '{}'::jsonb;
    v_payments     jsonb := '{}'::jsonb;
    v_installments jsonb := '{}'::jsonb;
    v_ledger       jsonb := '{}'::jsonb;
    v_row          record;
begin
    -- 0. Tenant + guards (T-439/SEC-115: the 0128 caller-tenant-mismatch
    --    guard — the experimental flag was never an authorization boundary,
    --    and SECURITY DEFINER bypasses the er_* RLS by construction).
    v_tenant := public.fn_er_resolve_tenant(p_tenant_id);
    if p_target_parent_id is null or p_source_parent_id is null
       or p_target_parent_id = p_source_parent_id then
        raise exception 'fn_er_merge_parents: cible et source requis et distincts';
    end if;

    select * into v_target from public.parents
    where id = p_target_parent_id and tenant_id = v_tenant;
    select * into v_source from public.parents
    where id = p_source_parent_id and tenant_id = v_tenant;

    if v_target.id is null or v_source.id is null then
        raise exception 'fn_er_merge_parents: parent introuvable (cible ou source)';
    end if;
    if v_source.deleted_at is not null then
        raise exception 'fn_er_merge_parents: la source est déjà fusionnée/supprimée (deleted_at non nul)'
            using hint = 'Un-merge the prior merge first.';
    end if;

    -- 1. Capture the COMPLETE prior mapping (the restore contract), then
    --    re-point each relationship table (INV-54: re-point, never rewrite).
    for v_row in
        select id from public.students
        where tenant_id = v_tenant and parent_id = p_source_parent_id
        for update
    loop
        v_students := v_students || jsonb_build_object(v_row.id::text, p_source_parent_id::text);
    end loop;
    update public.students
    set parent_id = p_target_parent_id
    where tenant_id = v_tenant and parent_id = p_source_parent_id;

    for v_row in
        select id from public.payments
        where tenant_id = v_tenant and parent_id = p_source_parent_id
        for update
    loop
        v_payments := v_payments || jsonb_build_object(v_row.id::text, p_source_parent_id::text);
    end loop;
    update public.payments
    set parent_id = p_target_parent_id
    where tenant_id = v_tenant and parent_id = p_source_parent_id;

    for v_row in
        select id from public.installments
        where tenant_id = v_tenant and parent_id = p_source_parent_id
        for update
    loop
        v_installments := v_installments || jsonb_build_object(v_row.id::text, p_source_parent_id::text);
    end loop;
    update public.installments
    set parent_id = p_target_parent_id
    where tenant_id = v_tenant and parent_id = p_source_parent_id;

    for v_row in
        select id from public.ledger_entries
        where tenant_id = v_tenant and parent_id = p_source_parent_id
        for update
    loop
        v_ledger := v_ledger || jsonb_build_object(v_row.id::text, p_source_parent_id::text);
    end loop;
    update public.ledger_entries
    set parent_id = p_target_parent_id
    where tenant_id = v_tenant and parent_id = p_source_parent_id;

    -- 2. Soft-delete the merged-away parent (the T-384 convention).
    update public.parents
    set deleted_at = now()
    where id = p_source_parent_id and tenant_id = v_tenant;

    -- 3. The append-only event carrying the COMPLETE prior mapping.
    insert into public.er_aggregation_events (
        tenant_id, event_type, run_id, canonical_id, merged_away_id,
        observation_keys, actor_id, actor_name, rationale, payload
    ) values (
        v_tenant, 'MERGE_EXECUTED', null, p_target_parent_id, p_source_parent_id,
        '{}', p_actor_id, p_actor_name, p_rationale,
        jsonb_build_object(
            'proposalId', p_proposal_id,
            'restoreMapping', jsonb_build_object(
                'students', v_students,
                'payments', v_payments,
                'installments', v_installments,
                'ledger_entries', v_ledger
            )
        )
    ) returning id into v_event_id;

    -- 4. Audit (the canonical trail).
    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'er.merge_parents',
        p_entity_type := 'parent',
        p_entity_id   := p_target_parent_id,
        p_actor_id    := p_actor_id,
        p_actor_name  := p_actor_name,
        p_before_json := jsonb_build_object(
                             'sourceParentId', p_source_parent_id,
                             'sourceParentCode', v_source.parent_code
                         ),
        p_after_json  := jsonb_build_object(
                             'targetParentId', p_target_parent_id,
                             'targetParentCode', v_target.parent_code,
                             'eventId', v_event_id,
                             'rePointed', jsonb_build_object(
                                 'students', (select count(*) from jsonb_object_keys(v_students)),
                                 'payments', (select count(*) from jsonb_object_keys(v_payments)),
                                 'installments', (select count(*) from jsonb_object_keys(v_installments)),
                                 'ledger_entries', (select count(*) from jsonb_object_keys(v_ledger))
                             )
                         ),
        p_note        := format('ER-PMAE : fusion réversible du parent %s dans %s (%s) — mappage complet enregistré (événement %s).',
                                v_source.parent_code, v_target.parent_code,
                                coalesce(p_rationale, 'décision humaine'), v_event_id)
    );

    return jsonb_build_object(
        'eventId', v_event_id,
        'targetParentId', p_target_parent_id,
        'sourceParentId', p_source_parent_id,
        'rePointed', jsonb_build_object(
            'students', v_students,
            'payments', v_payments,
            'installments', v_installments,
            'ledger_entries', v_ledger
        )
    );
end;
$er_merge$;

-- unmerge — the guarded recreation
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
    -- 0. Tenant + guards (T-439/SEC-115: the 0128 caller-tenant-mismatch
    --    guard — the experimental flag was never an authorization boundary,
    --    and SECURITY DEFINER bypasses the er_* RLS by construction).
    v_tenant := public.fn_er_resolve_tenant(p_tenant_id);

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

-- has_state — the guarded recreation
create or replace function public.fn_er_has_aggregation_state(
    p_tenant_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $er_state$
declare
    v_tenant uuid;
begin
    -- T-439 (SEC-115): the caller-tenant guard (read-only surface, same
    -- boundary as the mutators).
    v_tenant := public.fn_er_resolve_tenant(p_tenant_id);
    return exists (
        select 1 from public.er_match_proposals
        where tenant_id = v_tenant
          and status <> 'proposed'
    ) or exists (
        select 1 from public.er_identity_edges
        where tenant_id = v_tenant
          and status = 'active'
    );
end;
$er_state$;


-- ----------------------------------------------------------------------------
-- §3. Grants (§15.34: revoke explicitly from anon + public — the platform
--      default privileges grant anon EXECUTE; keep authenticated +
--      service_role) + Registration (T-091/MIG-TOKENS — idempotent)
-- ----------------------------------------------------------------------------
revoke all on function public.fn_er_decide_proposal(text, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.fn_er_decide_proposal(text, text, uuid, text, text, uuid)
    to authenticated, service_role;
revoke all on function public.fn_er_merge_parents(uuid, uuid, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.fn_er_merge_parents(uuid, uuid, text, uuid, text, text, uuid)
    to authenticated, service_role;
revoke all on function public.fn_er_unmerge_parents(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.fn_er_unmerge_parents(uuid, uuid, text, text, uuid)
    to authenticated, service_role;
revoke all on function public.fn_er_has_aggregation_state(uuid) from public, anon;
grant execute on function public.fn_er_has_aggregation_state(uuid)
    to authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0132', '{0132_er_rpc_tenant_guards.sql}', 'er_rpc_tenant_guards')
on conflict (version) do nothing;
