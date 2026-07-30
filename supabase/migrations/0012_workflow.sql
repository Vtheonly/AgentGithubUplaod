-- ============================================================================
-- 0012_workflow.sql
-- ============================================================================
-- Workflow engine + AI provider integration:
--   - workflows: DAG-based automation definitions (nodes + edges as jsonb)
--   - workflow_runs: execution history with per-node status tracking
--   - workflow_audit_links: M:N link between runs and the audit log
--   - ai_provider_configs: encrypted API keys for Groq / OpenRouter
--   - ai_request_logs: per-call telemetry for audit + rate limiting
--
-- Per plan §12 (Workflow & AI):
--   - Workflows are DAGs: nodes have {id, type, subtype, x, y, config}
--   - Trigger types include payment events, schedule, absences, debt thresholds
--   - Run status: pending → running → succeeded/failed/timeout/cancelled
--   - API keys are stored AES-256-GCM encrypted (never plaintext); see §12.06
--   - Every AI request is logged for audit, cost tracking, and rate limiting
--   - workflow_audit_links is a pure M:N join table; the FK to audit_logs is
--     deferred until audit_logs is defined in a later migration
--
-- Conventions (consistent with 0002–0011):
--   - `public.gen_uuid()` for PKs
--   - `tenant_id` NOT NULL FK → tenants(id) ON DELETE CASCADE
--   - `created_at`/`updated_at` timestamptz NOT NULL DEFAULT now()
--   - `public.touch_updated_at()` trigger on every table with `updated_at`
--   - Actor columns (created_by, actor_id, user_id) reference user_profiles.id
--     WITHOUT FK constraints (convention)
--   - GIN indexes on jsonb columns
--   - CHECK constraints for all enum-like text fields
--
-- Scale assumptions (per plan §00):
--   - ~5,000 total users / ~300 DAU / ~50 peak concurrent
--   - max_daily_executions default 100 caps runaway workflows
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. workflows — DAG-based automation definitions
-- ----------------------------------------------------------------------------
create table public.workflows (
    id                      uuid        primary key default public.gen_uuid(),
    tenant_id               uuid        not null references public.tenants(id) on delete cascade,
    code                    text        not null,                          -- 'WF-OVERDUE-001'
    name                    text        not null,
    description             text,
    dag_definition          jsonb       not null,                          -- [{id, type, subtype, x, y, config}]
    status                  text        not null default 'draft' check (status in ('draft', 'published', 'disabled')),
    max_daily_executions    integer     not null default 100 check (max_daily_executions >= 0),
    trigger_type            text,                                          -- free-text; should match workflow_runs.trigger_type enum
    created_by              uuid,                                          -- user_profiles.id (no FK by convention)
    last_executed_at        timestamptz,
    total_executions        integer     not null default 0 check (total_executions >= 0),
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    unique (tenant_id, code)
);

create index workflows_tenant_status_idx on public.workflows (tenant_id, status);
create index workflows_tenant_trigger_idx on public.workflows (tenant_id, trigger_type) where status = 'published' and trigger_type is not null;
create index workflows_dag_gin_idx on public.workflows using gin (dag_definition jsonb_path_ops);
create index workflows_trgm_idx on public.workflows using gin (name extensions.gin_trgm_ops);

comment on table public.workflows is
  'DAG-based workflow definitions. Nodes carry {id, type, subtype, x, y, config}. Plan §12.02.';
comment on column public.workflows.dag_definition is 'JSON array of node objects: [{id, type, subtype, x, y, config}]. x/y are canvas coordinates for the visual editor.';
comment on column public.workflows.status is 'draft=editable, published=eligible to run, disabled=paused (history preserved).';
comment on column public.workflows.max_daily_executions is 'Hard cap per tenant per UTC day. Default 100. 0 = effectively disabled.';
comment on column public.workflows.trigger_type is 'Free-text discriminator (payment_overdue, schedule, etc.). Must match workflow_runs.trigger_type enum when published.';
comment on column public.workflows.created_by is 'user_profiles.id of the workflow author. No FK (convention).';
comment on column public.workflows.total_executions is 'Counter incremented per workflow_run (best-effort; authoritative count comes from workflow_runs).';

-- ----------------------------------------------------------------------------
-- 2. workflow_runs — execution history with per-node status
-- ----------------------------------------------------------------------------
create table public.workflow_runs (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    workflow_id     uuid        not null references public.workflows(id) on delete restrict,
    trigger_type    text        not null check (trigger_type in (
                        'payment_overdue', 'student_enrolled', 'payment_recorded',
                        'schedule', 'absence_limit', 'manual_run',
                        'debt_over_threshold'
                    )),
    triggered_at    timestamptz not null default now(),
    started_at      timestamptz,
    completed_at    timestamptz,
    status          text        not null default 'pending' check (status in (
                        'pending', 'running', 'succeeded', 'failed',
                        'timeout', 'cancelled'
                    )),
    actor_id        uuid,                                               -- user_profiles.id (no FK by convention)
    error_message   text,
    duration_ms     integer     check (duration_ms is null or duration_ms >= 0),
    node_results    jsonb       not null default '[]'::jsonb,            -- [{node_id, status, started_at, completed_at, error}]
    created_at      timestamptz not null default now()
);

create index workflow_runs_workflow_idx on public.workflow_runs (workflow_id, triggered_at desc);
create index workflow_runs_tenant_status_idx on public.workflow_runs (tenant_id, status, triggered_at desc);
create index workflow_runs_tenant_trigger_idx on public.workflow_runs (tenant_id, trigger_type, triggered_at desc);
create index workflow_runs_actor_idx on public.workflow_runs (actor_id, triggered_at desc) where actor_id is not null;
create index workflow_runs_node_results_gin_idx on public.workflow_runs using gin (node_results jsonb_path_ops);

comment on table public.workflow_runs is
  'Workflow execution history. workflow_id is RESTRICT (cannot delete a workflow with runs — disable instead). Plan §12.03.';
comment on column public.workflow_runs.trigger_type is 'Discriminator enum: payment_overdue/student_enrolled/payment_recorded/schedule/absence_limit/manual_run/debt_over_threshold.';
comment on column public.workflow_runs.status is 'pending=queued, running=executing, succeeded/failed/timeout=terminal, cancelled=interrupted by user.';
comment on column public.workflow_runs.actor_id is 'user_profiles.id of the user who triggered the run (NULL for system/schedule triggers). No FK (convention).';
comment on column public.workflow_runs.duration_ms is 'Wall-clock duration in milliseconds. NULL until the run reaches a terminal state.';
comment on column public.workflow_runs.node_results is 'JSON array of per-node outcomes: [{node_id, status, started_at, completed_at, error}]. GIN-indexed.';

-- ----------------------------------------------------------------------------
-- 3. workflow_audit_links — M:N link between workflow_runs and audit_logs
-- ----------------------------------------------------------------------------
-- NOTE: The FK to public.audit_logs(id) is intentionally NOT declared here
-- because the audit_logs table is created in a later migration. Once that
-- migration runs, add:
--   alter table public.workflow_audit_links
--       add constraint workflow_audit_links_audit_log_fk
--       foreign key (audit_log_id) references public.audit_logs(id) on delete cascade;
create table public.workflow_audit_links (
    workflow_run_id     uuid        not null references public.workflow_runs(id) on delete cascade,
    audit_log_id        uuid        not null,                             -- FK added in a later migration (see note above)
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    created_at          timestamptz not null default now(),
    primary key (workflow_run_id, audit_log_id)
);

create index workflow_audit_links_audit_idx on public.workflow_audit_links (audit_log_id);
create index workflow_audit_links_tenant_idx on public.workflow_audit_links (tenant_id, created_at desc);

comment on table public.workflow_audit_links is
  'M:N join between workflow_runs and audit_logs. Composite PK prevents duplicate links. Plan §12.04.';
comment on column public.workflow_audit_links.audit_log_id is 'UUID of the audit_logs row. FK constraint added in a later migration once audit_logs is defined.';

-- ----------------------------------------------------------------------------
-- 4. ai_provider_configs — encrypted API key storage
-- ----------------------------------------------------------------------------
create table public.ai_provider_configs (
    id                      uuid        primary key default public.gen_uuid(),
    tenant_id               uuid        not null references public.tenants(id) on delete cascade,
    provider                text        not null check (provider in ('groq', 'openrouter')),
    api_key_encrypted       text        not null,                          -- AES-256-GCM ciphertext, NEVER plaintext
    default_model           text        not null,                          -- 'llama-3.3-70b-versatile'
    fallback_model          text,                                          -- used when default_model times out / 5xx
    is_active               boolean     not null default true,
    rate_limit_per_minute   integer     not null default 60 check (rate_limit_per_minute >= 0),
    last_used_at            timestamptz,
    created_by              uuid,                                          -- user_profiles.id (no FK by convention)
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    unique (tenant_id, provider)
);

create index ai_provider_configs_tenant_active_idx on public.ai_provider_configs (tenant_id, is_active);

comment on table public.ai_provider_configs is
  'Encrypted AI provider API keys. AES-256-GCM ciphertext only — never plaintext. Plan §12.06.';
comment on column public.ai_provider_configs.provider is 'Provider discriminator: groq | openrouter.';
comment on column public.ai_provider_configs.api_key_encrypted is 'AES-256-GCM ciphertext blob (base64). Encryption/decryption happens in the Electron main process; the DB never sees the plaintext.';
comment on column public.ai_provider_configs.default_model is 'Primary model ID (e.g. llama-3.3-70b-versatile).';
comment on column public.ai_provider_configs.fallback_model is 'Optional fallback model used when default_model returns 5xx or times out.';
comment on column public.ai_provider_configs.rate_limit_per_minute is 'Tenant-imposed rate cap (independent of provider limits). 0 = no requests allowed.';
comment on column public.ai_provider_configs.created_by is 'user_profiles.id of the admin who entered the key. No FK (convention).';

-- ----------------------------------------------------------------------------
-- 5. ai_request_logs — per-call telemetry for audit + rate limiting
-- ----------------------------------------------------------------------------
create table public.ai_request_logs (
    id                      uuid        primary key default public.gen_uuid(),
    tenant_id               uuid        not null references public.tenants(id) on delete cascade,
    user_id                 uuid        not null,                          -- user_profiles.id (no FK by convention)
    feature                 text        not null check (feature in ('narrative', 'drafting', 'anomaly')),
    provider                text        not null,
    model                   text        not null,
    prompt_token_count      integer     not null default 0 check (prompt_token_count >= 0),
    completion_token_count  integer     not null default 0 check (completion_token_count >= 0),
    latency_ms              integer     not null default 0 check (latency_ms >= 0),
    success                 boolean     not null,
    error_message           text,
    requested_at            timestamptz not null default now(),
    created_at              timestamptz not null default now()
);

create index ai_request_logs_tenant_requested_idx on public.ai_request_logs (tenant_id, requested_at desc);
create index ai_request_logs_user_idx on public.ai_request_logs (user_id, requested_at desc);
create index ai_request_logs_feature_idx on public.ai_request_logs (tenant_id, feature, requested_at desc);
create index ai_request_logs_rate_window_idx on public.ai_request_logs (tenant_id, requested_at) where requested_at > now() - interval '1 minute';

comment on table public.ai_request_logs is
  'Append-only AI request telemetry. Used for audit, cost tracking, and tenant rate limiting. Plan §12.07.';
comment on column public.ai_request_logs.user_id is 'user_profiles.id of the caller. No FK (convention).';
comment on column public.ai_request_logs.feature is 'AI feature discriminator: narrative=report narratives, drafting=expense/workflow drafts, anomaly=financial anomaly explanation.';
comment on column public.ai_request_logs.success is 'TRUE if the provider returned a 2xx response and the app successfully parsed the body. FALSE otherwise (error_message explains).';
comment on column public.ai_request_logs.latency_ms is 'End-to-end latency including network + provider inference. Used for SLO monitoring.';
comment on column public.ai_request_logs.rate_window_idx is 'Index scoped to the last 60s for fast rate-limit checks.';

-- ----------------------------------------------------------------------------
-- 6. Triggers — touch_updated_at on every table with updated_at
-- ----------------------------------------------------------------------------
create trigger workflows_touch_updated_at before update on public.workflows
    for each row execute function public.touch_updated_at();
create trigger ai_provider_configs_touch_updated_at before update on public.ai_provider_configs
    for each row execute function public.touch_updated_at();
-- NOTE: workflow_runs, workflow_audit_links, ai_request_logs are append-only
-- (no updated_at) — no trigger.
