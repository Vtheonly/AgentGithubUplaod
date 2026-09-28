-- ============================================================================
-- 0130_er_pmae_identity_resolution.sql
-- T-438 (117th session, 2026-09-29): GitHub issues #15 + #16 — the
-- Experimental User Aggregation & Identity Resolution Engine (ER-PMAE).
-- Problems: IDENT-100, IDENT-101, IDENT-102. Rules: identity-rules.md
-- (INV-40..58) + ADR-032.
--
-- THE MODEL (ADR-032): the canonical person stays the EXISTING
-- parents/students row; ER-PMAE persists LINKAGE + PROVENANCE only
-- (observations, proposals, edges, events). The pure TS engine at
-- src/domain/identity/ computes everything; these tables + RPCs are the
-- persistence and the ONE-transaction reversible merge/unmerge.
--
-- EXPERIMENTAL (identity-rules §9): nothing in this migration changes any
-- existing behavior — the tables stay empty until a desktop explicitly
-- enables the experimental flag (per-desktop-local, never server
-- feature_flags) and a human confirms proposals. The legacy import path
-- never touches these tables when the flag is off (INV-40).
--
-- §1  er_source_observations (INV-55 — the idempotency hash keys the row)
-- §2  er_match_proposals (INV-50 — proposals, never auto-executions)
-- §3  er_identity_edges (active / negative / severed — INV-52's graph)
-- §4  er_aggregation_events (append-only; the merge's COMPLETE prior
--     mapping rides the payload — INV-54's restorability)
-- §5  RLS (the 0108 pattern: staff read, admin manage; NO parent access)
-- §6  fn_er_decide_proposal (the ONLY execution path — INV-50)
-- §7  fn_er_merge_parents (the ONE transaction: re-point + soft-delete +
--     event + audit — T-384's soft-delete convention, PERF-501's composite
--     pattern)
-- §8  fn_er_unmerge_parents (replay the recorded mapping in reverse)
-- §9  fn_er_has_aggregation_state (the honest not-pristine census)
-- §10 Registration (the T-091/MIG-TOKENS pattern — atomic with the DDL)
--
-- Numbering: 0130 is the next free number (0122 stays RESERVED for
-- IMPORT-118's flush RPC; 0118 is the documented gap, not a free number).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. er_source_observations — the immutable analyzed source rows
-- ----------------------------------------------------------------------------
create table if not exists public.er_source_observations (
    id                    uuid        primary key default gen_random_uuid(),
    tenant_id             uuid        not null references public.tenants(id) on delete cascade,
    -- The caller-constructed stable observation key (e.g. 'xlsx:2027-2026:row-42').
    observation_key       text        not null,
    source_system         text        not null,
    source_record_id      text        not null,
    kind                  text        not null check (kind in ('parent', 'student')),
    -- Set when the observation IS an existing canonical entity (the link target).
    canonical_id          uuid,
    -- INV-55: the invariant hash over the normalized payload.
    payload_hash          text        not null,
    display_name          text,
    phones                text[]      not null default '{}',
    email                 text,
    grade_level_code      text,
    transport_destination text,
    academic_year         text,
    tier                  text        not null default 'import' check (tier in ('manual', 'import')),
    analyzed_at           timestamptz not null default now(),
    run_id                text,
    created_at            timestamptz not null default now(),
    -- Idempotency: the same observation content for the same key is ONE row;
    -- a changed payload for the same source row lands a NEW row (a new
    -- observation version — the re-analysis's input).
    constraint er_source_observation_identity
        unique (tenant_id, observation_key, payload_hash)
);

create index if not exists er_source_observation_hash_idx
    on public.er_source_observations (tenant_id, payload_hash);
create index if not exists er_source_observation_canonical_idx
    on public.er_source_observations (tenant_id, canonical_id)
    where canonical_id is not null;

comment on table public.er_source_observations is
  'T-438 (ADR-032 / identity-rules §1): one ANALYZED identity observation — an import '
  'row or an existing canonical entity projected for matching. Immutable once written '
  '(append-only by convention; the engine never updates a source row). The payload hash '
  'keys the idempotency gate (INV-55).';

-- ----------------------------------------------------------------------------
-- §2. er_match_proposals — the scored proposals + their decisions
-- ----------------------------------------------------------------------------
create table if not exists public.er_match_proposals (
    id                 text        primary key, -- deterministic runId:a→b
    tenant_id          uuid        not null references public.tenants(id) on delete cascade,
    run_id             text        not null,
    a_observation_key  text        not null,
    b_observation_key  text        not null,
    b_canonical_id     uuid,
    confidence         numeric(5, 4) not null check (confidence >= 0 and confidence <= 1),
    band               text        not null check (band in ('definite', 'probable', 'review', 'separate')),
    evidence           jsonb       not null default '[]',
    vetoes             text[]      not null default '{}',
    status             text        not null default 'proposed'
                       check (status in ('proposed', 'approved', 'rejected', 'executed', 'superseded')),
    decided_by         uuid,
    decided_by_name    text,
    decided_at         timestamptz,
    rationale          text,
    created_at         timestamptz not null default now()
);

create index if not exists er_match_proposals_status_idx
    on public.er_match_proposals (tenant_id, status, created_at desc);
create index if not exists er_match_proposals_run_idx
    on public.er_match_proposals (tenant_id, run_id);

comment on table public.er_match_proposals is
  'T-438 (identity-rules §7): the engine''s match PROPOSALS with the full evidence vector '
  '(INV-51). A proposal NEVER executes on its own (INV-50) — only fn_er_decide_proposal '
  '(an explicit human decision) advances its status.';

-- ----------------------------------------------------------------------------
-- §3. er_identity_edges — the identity graph (active / negative / severed)
-- ----------------------------------------------------------------------------
create table if not exists public.er_identity_edges (
    id                 uuid        primary key default gen_random_uuid(),
    tenant_id          uuid        not null references public.tenants(id) on delete cascade,
    a_observation_key  text        not null,
    b_observation_key  text        not null,
    confidence         numeric(5, 4) not null default 1.0,
    status             text        not null default 'active'
                       check (status in ('active', 'severed', 'negative')),
    evidence           jsonb       not null default '[]',
    created_by         uuid,
    created_at         timestamptz not null default now(),
    severed_at         timestamptz,
    severed_by         uuid,
    -- ONE edge per pair: a rejection's negative edge and a later approval
    -- cannot coexist — the approval path refuses while a negative edge lives.
    constraint er_identity_edge_pair unique (tenant_id, a_observation_key, b_observation_key)
);

create index if not exists er_identity_edges_status_idx
    on public.er_identity_edges (tenant_id, status);

comment on table public.er_identity_edges is
  'T-438 (identity-rules §6.1): the identity graph. Active edges = confirmed identity links '
  '(the merged clusters); negative edges = review rejections (permanent — never re-proposed); '
  'severed edges = undone merges (unmerge provenance).';

-- ----------------------------------------------------------------------------
-- §4. er_aggregation_events — the append-only audit trail
-- ----------------------------------------------------------------------------
create table if not exists public.er_aggregation_events (
    id               uuid        primary key default gen_random_uuid(),
    tenant_id        uuid        not null references public.tenants(id) on delete cascade,
    event_type       text        not null check (event_type in (
                         'ANALYSIS_RUN', 'PROPOSAL_APPROVED', 'PROPOSAL_REJECTED',
                         'MERGE_EXECUTED', 'MERGE_UNDONE', 'BINDING_EXECUTED')),
    run_id           text,
    canonical_id     uuid,
    merged_away_id   uuid,
    observation_keys text[]      not null default '{}',
    actor_id         uuid,
    actor_name       text,
    rationale        text,
    -- MERGE_EXECUTED: the COMPLETE prior mapping (per table: rowId → previous parent).
    -- MERGE_UNDONE: the reference to the reversed event.
    payload          jsonb       not null default '{}',
    created_at       timestamptz not null default now()
);

create index if not exists er_aggregation_events_type_idx
    on public.er_aggregation_events (tenant_id, event_type, created_at desc);
create index if not exists er_aggregation_events_canonical_idx
    on public.er_aggregation_events (tenant_id, canonical_id)
    where canonical_id is not null;

comment on table public.er_aggregation_events is
  'T-438 (identity-rules §7.4): the append-only aggregation audit trail. A MERGE_EXECUTED '
  'event carries the complete prior row mapping in its payload — the unmerge restores the '
  'exact prior state from it (INV-54: ledger rows are re-pointed, never rewritten).';

-- ----------------------------------------------------------------------------
-- §5. RLS (the 0108 pattern: staff read, admin manage — NO parent access;
--      identity-resolution data is staff-only by definition)
-- ----------------------------------------------------------------------------
alter table public.er_source_observations enable row level security;
alter table public.er_match_proposals  enable row level security;
alter table public.er_identity_edges   enable row level security;
alter table public.er_aggregation_events enable row level security;

-- er_source_observations
drop policy if exists er_source_observations_staff_read on public.er_source_observations;
create policy er_source_observations_staff_read on public.er_source_observations
    for select
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'financial_officer'::text])
    );

drop policy if exists er_source_observations_admin_manage on public.er_source_observations;
create policy er_source_observations_admin_manage on public.er_source_observations
    for all
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
    );

-- er_match_proposals
drop policy if exists er_match_proposals_staff_read on public.er_match_proposals;
create policy er_match_proposals_staff_read on public.er_match_proposals
    for select
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'financial_officer'::text])
    );

drop policy if exists er_match_proposals_admin_manage on public.er_match_proposals;
create policy er_match_proposals_admin_manage on public.er_match_proposals
    for all
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
    );

-- er_identity_edges
drop policy if exists er_identity_edges_staff_read on public.er_identity_edges;
create policy er_identity_edges_staff_read on public.er_identity_edges
    for select
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'financial_officer'::text])
    );

drop policy if exists er_identity_edges_admin_manage on public.er_identity_edges;
create policy er_identity_edges_admin_manage on public.er_identity_edges
    for all
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
    );

-- er_aggregation_events
drop policy if exists er_aggregation_events_staff_read on public.er_aggregation_events;
create policy er_aggregation_events_staff_read on public.er_aggregation_events
    for select
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'financial_officer'::text])
    );

drop policy if exists er_aggregation_events_admin_manage on public.er_aggregation_events;
create policy er_aggregation_events_admin_manage on public.er_aggregation_events
    for all
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
    );

-- ----------------------------------------------------------------------------
-- §6. fn_er_decide_proposal — the ONLY execution path (INV-50)
-- ----------------------------------------------------------------------------
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
    -- 0. Tenant + guards.
    v_tenant := coalesce(p_tenant_id, public.current_tenant_id());
    if v_tenant is null then
        raise exception 'fn_er_decide_proposal: tenant requis'
            using hint = 'The client resolves the tenant from the session.';
    end if;
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

revoke all on function public.fn_er_decide_proposal(text, text, uuid, text, text, uuid) from public;
grant execute on function public.fn_er_decide_proposal(text, text, uuid, text, text, uuid)
    to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- §7. fn_er_merge_parents — the ONE reversible merge transaction (INV-54)
-- ----------------------------------------------------------------------------
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
    -- 0. Tenant + guards.
    v_tenant := coalesce(p_tenant_id, public.current_tenant_id());
    if v_tenant is null then
        raise exception 'fn_er_merge_parents: tenant requis';
    end if;
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

revoke all on function public.fn_er_merge_parents(uuid, uuid, text, uuid, text, text, uuid) from public;
grant execute on function public.fn_er_merge_parents(uuid, uuid, text, uuid, text, text, uuid)
    to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- §8. fn_er_unmerge_parents — replay the recorded mapping in reverse
-- ----------------------------------------------------------------------------
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
    if v_restore->'students' is not null then
        for v_row_id, v_prev_parent in
            select key::uuid, value::uuid
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
            select key::uuid, value::uuid
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
            select key::uuid, value::uuid
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
            select key::uuid, value::uuid
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
-- §9. fn_er_has_aggregation_state — the honest not-pristine census
-- ----------------------------------------------------------------------------
create or replace function public.fn_er_has_aggregation_state(
    p_tenant_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $er_state$
    select exists (
        select 1 from public.er_match_proposals
        where tenant_id = coalesce(p_tenant_id, public.current_tenant_id())
          and status <> 'proposed'
    ) or exists (
        select 1 from public.er_identity_edges
        where tenant_id = coalesce(p_tenant_id, public.current_tenant_id())
          and status = 'active'
    ) or exists (
        select 1 from public.er_aggregation_events
        where tenant_id = coalesce(p_tenant_id, public.current_tenant_id())
          and event_type in ('MERGE_EXECUTED', 'MERGE_UNDONE', 'BINDING_EXECUTED')
    );
$er_state$;

revoke all on function public.fn_er_has_aggregation_state(uuid) from public;
grant execute on function public.fn_er_has_aggregation_state(uuid)
    to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- §10. Registration (T-091/MIG-TOKENS pattern — atomic with the DDL)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0130', '{0130_er_pmae_identity_resolution.sql}', 'er_pmae_identity_resolution')
on conflict (version) do nothing;
