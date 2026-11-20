-- ============================================================================
-- 0014_audit.sql
-- ============================================================================
-- Append-only audit log — universal traceability for every state-changing
-- operation across the platform.
--
-- Per plan §12 (Universal Action Traceability):
--   - Every DB write (INSERT/UPDATE/DELETE) → audit entry
--   - Authentication events (login, logout, failed attempts) → audit entry
--   - Permission alterations → audit entry
--   - System exports (PDF, XLSX) → audit entry
--   - Sensitive record views → audit entry
--   - Truncated before_json/after_json is FORBIDDEN (storage is cheap)
--   - System-initiated actions attribute to a system user ID, never anonymous
--   - Append-only: no edits, no deletes (enforced by trigger)
--   - Corrections require a new audit-logged entry that supersedes the original
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. audit_logs — append-only event stream
-- ----------------------------------------------------------------------------
create table public.audit_logs (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    action              text        not null,                          -- 'parent.create', 'payment.collect', 'expense.approve', etc.
    entity_type         text        not null,                          -- 'parent', 'student', 'payment', 'expense_ticket', etc.
    entity_id           uuid,                                          -- FK to the affected row (no constraint — polymorphic)
    actor_id            uuid,                                          -- user_profiles.id (NULL only for true system events)
    actor_name          text,                                          -- denormalized for performance
    actor_role          text,                                          -- role code at time of action
    session_id          uuid,                                          -- FK to sessions(id)
    before_json         jsonb,                                         -- complete pre-change snapshot (NEVER truncated)
    after_json          jsonb,                                         -- complete post-change snapshot (NEVER truncated)
    note                text,
    ip_address          inet,
    user_agent          text,
    request_id          text,                                          -- correlation ID for tracing
    supersedes_id       uuid        references public.audit_logs(id) on delete set null,  -- for corrections
    occurred_at         timestamptz not null default now(),
    created_at          timestamptz not null default now()
);

-- Indexes for common query patterns
create index audit_logs_tenant_occurred_idx on public.audit_logs (tenant_id, occurred_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, occurred_at desc) where actor_id is not null;
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, occurred_at desc);
create index audit_logs_action_idx on public.audit_logs (tenant_id, action, occurred_at desc);
create index audit_logs_session_idx on public.audit_logs (session_id) where session_id is not null;
create index audit_logs_before_gin_idx on public.audit_logs using gin (before_json jsonb_path_ops) where before_json is not null;
create index audit_logs_after_gin_idx on public.audit_logs using gin (after_json jsonb_path_ops) where after_json is not null;

comment on table public.audit_logs is
  'Append-only audit log. Universal traceability per plan §12. No edits, no deletes (trigger-enforced). before_json/after_json must be COMPLETE, never truncated.';
comment on column public.audit_logs.action is 'Stable action code, e.g. parent.create, payment.collect, expense.approve, auth.login, auth.password_change.';
comment on column public.audit_logs.entity_type is 'Polymorphic discriminator (parent, student, payment, expense_ticket, workflow_run, etc.).';
comment on column public.audit_logs.entity_id is 'UUID of the affected row. NULL for system-wide events (e.g. backup.run).';
comment on column public.audit_logs.actor_id is 'user_profiles.id of the actor. NULL only for true system-initiated events (e.g. scheduled workflow).';
comment on column public.audit_logs.actor_name is 'Denormalized actor display name for fast listing without joins.';
comment on column public.audit_logs.actor_role is 'Role code at time of action (role may change later — this preserves history).';
comment on column public.audit_logs.session_id is 'sessions.id of the actor (NULL for non-interactive events).';
comment on column public.audit_logs.before_json is 'Complete pre-change JSON snapshot. NEVER truncated. NULL for INSERT actions.';
comment on column public.audit_logs.after_json is 'Complete post-change JSON snapshot. NEVER truncated. NULL for DELETE actions.';
comment on column public.audit_logs.supersedes_id is 'Set when this entry corrects a previous one. The superseded entry remains in the log (append-only).';

-- ----------------------------------------------------------------------------
-- 2. Trigger: append-only enforcement (block UPDATE and DELETE)
-- ----------------------------------------------------------------------------
create or replace function public.enforce_audit_log_append_only()
returns trigger
language plpgsql
security definer
as $$
begin
    raise exception 'audit_logs is append-only (plan §12). UPDATE and DELETE are forbidden. Use a new entry with supersedes_id for corrections.';
end;
$$;

create trigger audit_logs_block_update before update on public.audit_logs
    for each row execute function public.enforce_audit_log_append_only();

create trigger audit_logs_block_delete before delete on public.audit_logs
    for each row execute function public.enforce_audit_log_append_only();

-- ----------------------------------------------------------------------------
-- 3. Function: write_audit_log — canonical entry point for all audit writes
-- ----------------------------------------------------------------------------
create or replace function public.write_audit_log(
    p_tenant_id uuid,
    p_action text,
    p_entity_type text,
    p_entity_id uuid default null,
    p_actor_id uuid default null,
    p_actor_name text default null,
    p_actor_role text default null,
    p_session_id uuid default null,
    p_before_json jsonb default null,
    p_after_json jsonb default null,
    p_note text default null,
    p_ip_address inet default null,
    p_user_agent text default null,
    p_request_id text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
    v_audit_id uuid;
begin
    insert into public.audit_logs (
        tenant_id, action, entity_type, entity_id,
        actor_id, actor_name, actor_role, session_id,
        before_json, after_json, note,
        ip_address, user_agent, request_id,
        occurred_at, created_at
    ) values (
        p_tenant_id, p_action, p_entity_type, p_entity_id,
        p_actor_id, p_actor_name, p_actor_role, p_session_id,
        p_before_json, p_after_json, p_note,
        p_ip_address, p_user_agent, p_request_id,
        now(), now()
    )
    returning id into v_audit_id;

    return v_audit_id;
end;
$$;

comment on function public.write_audit_log is
  'Canonical entry point for writing to the audit log. Called by every repository mutation AND by triggers on tables that lack their own audit triggers.';

-- ----------------------------------------------------------------------------
-- 4. View: audit_log_with_actor — denormalized for fast UI listing
-- ----------------------------------------------------------------------------
create or replace view public.audit_log_with_actor as
    select al.*,
           up.email as actor_email,
           up.display_name as actor_display_name,
           r.label_fr as actor_role_label
      from public.audit_logs al
      left join public.user_profiles up on up.id = al.actor_id
      left join public.roles r on r.code = al.actor_role;

comment on view public.audit_log_with_actor is 'Denormalized audit log view for fast UI listing without joins.';

-- ----------------------------------------------------------------------------
-- 5. View: audit_log_by_entity — pivot for entity-centric audit queries
-- ----------------------------------------------------------------------------
create or replace view public.audit_log_by_entity as
    select entity_type,
           entity_id,
           count(*) as event_count,
           max(occurred_at) as last_event_at,
           min(occurred_at) as first_event_at,
           array_agg(distinct action) as actions
      from public.audit_logs
     group by entity_type, entity_id;

comment on view public.audit_log_by_entity is 'Pivot view for entity-centric audit queries (e.g. "show me everything that happened to parent X").';

-- ----------------------------------------------------------------------------
-- 6. Add the deferred FK from workflow_audit_links to audit_logs
--    (referenced in 0012_workflow.sql comment)
-- ----------------------------------------------------------------------------
alter table public.workflow_audit_links
    add constraint workflow_audit_links_audit_log_fk
    foreign key (audit_log_id) references public.audit_logs(id) on delete cascade;
