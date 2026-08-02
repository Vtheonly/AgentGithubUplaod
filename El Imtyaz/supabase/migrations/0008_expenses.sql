-- ============================================================================
-- 0008_expenses.sql
-- ============================================================================
-- Two-tier expense workflow (plan §08):
--   - Staff submits ticket (PENDING_APPROVAL)
--   - Admin/FinancialOfficer approves (APPROVED_FUNDS_RELEASED)
--   - Staff completes field transaction, uploads vendor receipt
--   - FinancialOfficer verifies receipt (SETTLED_AND_CLOSED)
--
-- Rules enforced at DB layer:
--   - No self-approval (approver_id <> submitted_by)
--   - Cannot skip from APPROVED_FUNDS_RELEASED to SETTLED_AND_CLOSED without receipt_path
--   - Controlled category list (no free-text)
--   - AI anomaly flags are signals only (no automatic rejection)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. expense_categories — controlled list (plan §08)
-- ----------------------------------------------------------------------------
create table public.expense_categories (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    code            text        not null check (code in ('maintenance', 'office_supplies', 'educational_material', 'utilities', 'transport', 'it', 'facilities', 'medical', 'other')),
    label_fr        text        not null,
    label_ar        text,
    is_active       boolean     not null default true,
    created_at      timestamptz not null default now(),
    unique (tenant_id, code)
);

-- ----------------------------------------------------------------------------
-- 2. expense_tickets
-- ----------------------------------------------------------------------------
create table public.expense_tickets (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    ticket_number       text        not null,                          -- 'EXP-2026-001234'
    title               text        not null,
    description         text        not null,
    category_id         uuid        not null references public.expense_categories(id) on delete restrict,
    requested_amount    numeric(12,2) not null check (requested_amount > 0),
    final_spent_amount  numeric(12,2) check (final_spent_amount is null or final_spent_amount >= 0),
    justification       text        not null,
    urgency             text        not null check (urgency in ('low', 'medium', 'high', 'critical')),
    status              text        not null default 'pending_approval' check (status in (
                        'draft', 'pending_approval', 'approved_funds_released',
                        'rejected', 'disbursed', 'settled_and_closed'
                    )),
    submitted_by        uuid        not null,                          -- user_profiles.id (staff)
    submitted_at        timestamptz not null default now(),
    approved_by         uuid,                                          -- user_profiles.id (admin/finoff)
    approved_at         timestamptz,
    approval_note       text,
    rejected_reason     text,
    disbursed_at        timestamptz,
    settled_by          uuid,                                          -- user_profiles.id (finoff)
    settled_at          timestamptz,
    receipt_path        text,                                          -- storage path under bucket 'expense-receipts'
    receipt_uploaded_at timestamptz,
    receipt_uploaded_by uuid,
    anomaly_score       numeric(5,2),                                  -- 0..1 (AI signal)
    anomaly_flags_json  jsonb       not null default '[]'::jsonb,       -- [{type, severity, explanation}]
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (tenant_id, ticket_number)
);

create index expense_tickets_tenant_status_idx on public.expense_tickets (tenant_id, status, submitted_at desc);
create index expense_tickets_submitter_idx on public.expense_tickets (submitted_by, submitted_at desc);
create index expense_tickets_approver_idx on public.expense_tickets (approved_by) where approved_by is not null;
create index expense_tickets_category_idx on public.expense_tickets (category_id, submitted_at desc);

-- ----------------------------------------------------------------------------
-- 3. expense_state_transitions — audit log of status changes
-- ----------------------------------------------------------------------------
create table public.expense_state_transitions (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    ticket_id       uuid        not null references public.expense_tickets(id) on delete cascade,
    from_status     text        not null,
    to_status       text        not null,
    actor_id        uuid        not null,                              -- user_profiles.id
    actor_note      text,
    transitioned_at timestamptz not null default now()
);

create index expense_state_transitions_ticket_idx on public.expense_state_transitions (ticket_id, transitioned_at);

-- ----------------------------------------------------------------------------
-- 4. Trigger: enforce no-self-approval + state machine + receipt requirement
-- ----------------------------------------------------------------------------
create or replace function public.enforce_expense_workflow_rules()
returns trigger
language plpgsql
security definer
as $$
begin
    -- No self-approval (plan §08)
    if new.status = 'approved_funds_released' and new.approved_by = new.submitted_by then
        raise exception 'Self-approval is forbidden (plan §08): approver must differ from submitter';
    end if;

    -- Cannot skip from approved_funds_released to settled_and_closed without receipt
    if new.status = 'settled_and_closed' and new.receipt_path is null then
        raise exception 'Receipt upload is mandatory before settlement (plan §08)';
    end if;

    -- If marking settled, ensure final_spent_amount is set
    if new.status = 'settled_and_closed' and new.final_spent_amount is null then
        raise exception 'Final spent amount must be set before settlement';
    end if;

    -- If rejected, ensure reason is set
    if new.status = 'rejected' and (new.rejected_reason is null or trim(new.rejected_reason) = '') then
        raise exception 'A rejection reason is required';
    end if;

    return new;
end;
$$;

create trigger expense_tickets_enforce_workflow
    before insert or update of status, approved_by, receipt_path, final_spent_amount on public.expense_tickets
    for each row execute function public.enforce_expense_workflow_rules();

-- ----------------------------------------------------------------------------
-- 5. Trigger: auto-write state transition row
-- ----------------------------------------------------------------------------
create or replace function public.record_expense_state_transition()
returns trigger
language plpgsql
security definer
as $$
begin
    if (tg_op = 'UPDATE') and (old.status is distinct from new.status) then
        insert into public.expense_state_transitions (tenant_id, ticket_id, from_status, to_status, actor_id, actor_note, transitioned_at)
        values (
            new.tenant_id, new.id, old.status, new.status,
            coalesce(new.approved_by, new.settled_by, new.submitted_by),
            coalesce(new.approval_note, new.rejected_reason),
            now()
        );
    end if;
    return new;
end;
$$;

create trigger expense_tickets_record_transition
    after update of status on public.expense_tickets
    for each row execute function public.record_expense_state_transition();

-- ----------------------------------------------------------------------------
-- 6. Triggers
-- ----------------------------------------------------------------------------
create trigger expense_tickets_touch_updated_at before update on public.expense_tickets
    for each row execute function public.touch_updated_at();

comment on table public.expense_tickets is
  'Two-tier expense workflow. State machine enforced at DB layer. No self-approval. Receipt mandatory before settlement (plan §08).';
