-- ============================================================================
-- 0007_financial.sql
-- ============================================================================
-- Financial engine: invoices, payments, installments, account adjustments,
-- receipts, and the immutable ledger (single source of truth for balances).
--
-- Per plan §07:
--   - Payment methods: cash (PAID), check/transfer (PENDING) — never manual PAID
--   - Receipts auto-generated on payment entry (no separate button)
--   - Discretionary Account Adjustments replace Scholarships
--   - Ledger is canonical — balances computed by replay, never stored
--   - 3-tranche installment schedule per service per student
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. service_enrollments — what each student is billed for
-- ----------------------------------------------------------------------------
create table public.service_enrollments (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    student_id          uuid        not null references public.students(id) on delete cascade,
    academic_year_id    uuid        not null references public.academic_years(id) on delete restrict,
    service_kind        text        not null check (service_kind in (
                        'tuition', 'transport', 'canteen', 'club',
                        'speech_therapy', 'psychology', 'psychotherapy',
                        'second_apron', 'rattrapage', 'other'
                    )),
    service_ref_id      uuid,                                          -- FK to subjects(id) for clubs, etc.
    destination_id      uuid        references public.transport_destinations(id) on delete restrict,
    grade_level_id      uuid        references public.academic_levels(id) on delete restrict,
    annual_amount       numeric(10,2) not null check (annual_amount >= 0),
    tranche_1_amount    numeric(10,2) not null default 0,
    tranche_2_amount    numeric(10,2) not null default 0,
    tranche_3_amount    numeric(10,2) not null default 0,
    tranche_1_due_date  date,
    tranche_2_due_date  date,
    tranche_3_due_date  date,
    is_active           boolean     not null default true,
    enrolled_at         timestamptz not null default now(),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index service_enrollments_student_idx on public.service_enrollments (student_id, academic_year_id);
create index service_enrollments_kind_idx on public.service_enrollments (tenant_id, service_kind);

-- ----------------------------------------------------------------------------
-- 2. invoices — issued by system; students owe against these
-- ----------------------------------------------------------------------------
create table public.invoices (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    parent_id           uuid        not null references public.parents(id) on delete restrict,
    student_id          uuid        references public.students(id) on delete restrict,
    service_enrollment_id uuid      references public.service_enrollments(id) on delete set null,
    invoice_number      text        not null,                          -- 'INV-2026-001234'
    issue_date          date        not null default current_date,
    due_date            date        not null,
    amount              numeric(10,2) not null check (amount >= 0),
    status              text        not null default 'unpaid' check (status in ('unpaid', 'paid', 'partial', 'cancelled', 'overdue')),
    paid_amount         numeric(10,2) not null default 0,
    notes               text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (tenant_id, invoice_number)
);

create index invoices_parent_idx on public.invoices (parent_id, issue_date desc);
create index invoices_student_idx on public.invoices (student_id, issue_date desc);
create index invoices_status_idx on public.invoices (tenant_id, status, due_date);

-- ----------------------------------------------------------------------------
-- 3. installments — tranches per service_enrollment
-- ----------------------------------------------------------------------------
create table public.installments (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    parent_id           uuid        not null references public.parents(id) on delete restrict,
    student_id          uuid        not null references public.students(id) on delete restrict,
    service_enrollment_id uuid      not null references public.service_enrollments(id) on delete cascade,
    invoice_id          uuid        references public.invoices(id) on delete set null,
    tranche_number      integer     not null check (tranche_number in (1, 2, 3)),
    amount_due          numeric(10,2) not null check (amount_due >= 0),
    amount_paid         numeric(10,2) not null default 0 check (amount_paid >= 0),
    due_date            date        not null,
    paid_date           date,
    status              text        not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid', 'overdue')),
    academic_cycle      text        check (academic_cycle in ('primaire', 'cem', 'lycee', 'prescolaire')),
    is_custom_schedule  boolean     not null default false,
    custom_schedule_note text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index installments_parent_idx on public.installments (parent_id, due_date);
create index installments_student_idx on public.installments (student_id, tranche_number);
create index installments_status_idx on public.installments (tenant_id, status, due_date);
create index installments_overdue_idx on public.installments (due_date) where status in ('unpaid', 'partial');

comment on table public.installments is
  'Tranche-level billing. 3 tranches per service_enrollment. Status auto-computed via trigger from amount_paid.';

-- ----------------------------------------------------------------------------
-- 4. payments — actual money received (cash/check/transfer)
-- ----------------------------------------------------------------------------
create table public.payments (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    payment_number      text        not null,                          -- 'PAY-2026-001234'
    parent_id           uuid        not null references public.parents(id) on delete restrict,
    student_id          uuid        references public.students(id) on delete restrict,
    invoice_id          uuid        references public.invoices(id) on delete set null,
    installment_id      uuid        references public.installments(id) on delete set null,
    amount              numeric(10,2) not null check (amount > 0),
    method              text        not null check (method in ('cash', 'check', 'transfer')),
    -- Method-specific fields (per plan §13.05):
    check_number        text,                                          -- required when method='check'
    check_bank_name     text,
    check_issue_date    date,
    check_clearance_date date,
    transfer_reference  text,                                          -- required when method='transfer'
    transfer_source_bank text,
    proof_path          text,                                          -- storage path under bucket 'payment-proofs'; mandatory for check/transfer
    status              text        not null check (status in ('paid', 'pending', 'unpaid', 'refunded', 'cancelled')),
    collected_at        timestamptz not null default now(),
    collected_by        uuid,                                          -- user_profiles.id (cashier)
    notes               text,
    reversal_of_payment_id uuid,                                       -- set when this payment is a reversal (refund)
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (tenant_id, payment_number)
);

create index payments_parent_idx on public.payments (parent_id, collected_at desc);
create index payments_student_idx on public.payments (student_id, collected_at desc);
create index payments_status_idx on public.payments (tenant_id, status, collected_at desc);
create index payments_method_idx on public.payments (tenant_id, method, collected_at desc);

-- ----------------------------------------------------------------------------
-- 5. payment_proof_check — constraint to enforce proof for check/transfer
-- ----------------------------------------------------------------------------
create or replace function public.enforce_payment_proof()
returns trigger
language plpgsql
security definer
as $$
begin
    if new.method in ('check', 'transfer') and new.proof_path is null then
        raise exception 'Proof upload is mandatory for % payments (plan §13.05)', new.method;
    end if;

    if new.method = 'check' and (new.check_number is null or new.check_bank_name is null) then
        raise exception 'Check number and bank name are required for check payments';
    end if;

    if new.method = 'transfer' and new.transfer_reference is null then
        raise exception 'Transaction reference is required for transfer payments';
    end if;

    -- Auto-set initial status: cash → paid, check/transfer → pending
    if new.status is null then
        new.status := case new.method when 'cash' then 'paid' else 'pending' end;
    end if;

    return new;
end;
$$;

create trigger payments_enforce_proof
    before insert or update on public.payments
    for each row execute function public.enforce_payment_proof();

-- ----------------------------------------------------------------------------
-- 6. account_adjustments — replaces Scholarships (plan §07.04)
-- ----------------------------------------------------------------------------
create table public.account_adjustments (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    parent_id           uuid        references public.parents(id) on delete restrict,
    student_id          uuid        references public.students(id) on delete restrict,
    amount              numeric(10,2) not null check (amount <> 0),  -- positive = charge, negative = credit
    reason_code         text        not null check (reason_code in (
                        'sibling_discount', 'staff_family', 'early_payment',
                        'passage_palier', 'seniority_5y', 'highest_average',
                        'full_annual', 'scholarship_replacement', 'hardship',
                        'correction', 'late_fee_waiver', 'other'
                    )),
    admin_note          text        not null,                          -- mandatory (plan §07.04)
    performed_by        uuid        not null,                          -- user_profiles.id (admin)
    performed_at        timestamptz not null default now(),
    before_json         jsonb       not null,
    after_json          jsonb       not null,
    created_at          timestamptz not null default now()
);

create index account_adjustments_parent_idx on public.account_adjustments (parent_id, performed_at desc);
create index account_adjustments_student_idx on public.account_adjustments (student_id, performed_at desc);

comment on table public.account_adjustments is
  'Replaces deprecated Scholarships (plan §07.04). Every adjustment requires reason_code + admin_note + audit JSON deltas.';

-- ----------------------------------------------------------------------------
-- 7. receipts — auto-generated PDFs (one per payment, sometimes statement)
-- ----------------------------------------------------------------------------
create table public.receipts (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    receipt_number      text        not null,                          -- 'RCP-2026-00042'
    receipt_kind        text        not null check (receipt_kind in ('recent_payment', 'account_statement')),
    payment_id          uuid        references public.payments(id) on delete cascade,
    parent_id           uuid        not null references public.parents(id) on delete restrict,
    pdf_path            text        not null,                          -- storage path under bucket 'receipts'
    pdf_size_bytes      bigint,
    generated_at        timestamptz not null default now(),
    generated_by        uuid,                                          -- user_profiles.id (system or admin)
    unique (tenant_id, receipt_number)
);

create index receipts_parent_idx on public.receipts (parent_id, generated_at desc);
create index receipts_payment_idx on public.receipts (payment_id) where payment_id is not null;

-- ----------------------------------------------------------------------------
-- 8. ledger_entries — IMMUTABLE accounting (canonical, plan §07)
-- ----------------------------------------------------------------------------
create table public.ledger_entries (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    entry_number        text        not null,                          -- 'LED-2026-001234'
    parent_id           uuid        not null references public.parents(id) on delete restrict,
    student_id          uuid        references public.students(id) on delete restrict,
    service_enrollment_id uuid      references public.service_enrollments(id) on delete set null,
    payment_id          uuid        references public.payments(id) on delete set null,
    adjustment_id       uuid        references public.account_adjustments(id) on delete set null,
    reverses_entry_id   uuid        references public.ledger_entries(id) on delete set null,
    account_id          text        not null,                          -- 'parent:{parentId}:category:{cat}[:student:{studentId}]'
    entry_type          text        not null check (entry_type in ('charge', 'payment', 'adjustment', 'refund', 'reversal', 'transfer')),
    -- Signed amount: positive = debit (charge), negative = credit (payment)
    amount              numeric(12,2) not null check (amount <> 0),
    category            text        not null,                          -- 'tuition', 'transport', 'canteen', etc.
    description         text,
    entry_date          timestamptz not null default now(),
    created_at          timestamptz not null default now(),
    unique (tenant_id, entry_number)
);

create index ledger_entries_parent_idx on public.ledger_entries (parent_id, entry_date desc);
create index ledger_entries_account_idx on public.ledger_entries (account_id, entry_date);
create index ledger_entries_student_idx on public.ledger_entries (student_id, entry_date desc);
create index ledger_entries_reversal_idx on public.ledger_entries (reverses_entry_id) where reverses_entry_id is not null;
create index ledger_entries_payment_idx on public.ledger_entries (payment_id) where payment_id is not null;

comment on table public.ledger_entries is
  'IMMUTABLE accounting ledger. Single source of truth for all balances — computed by replay via compute_account_balance(). Never edited or deleted; corrections via reversal entries (plan §07).';

-- ----------------------------------------------------------------------------
-- 9. Triggers
-- ----------------------------------------------------------------------------
create trigger service_enrollments_touch_updated_at before update on public.service_enrollments
    for each row execute function public.touch_updated_at();
create trigger invoices_touch_updated_at before update on public.invoices
    for each row execute function public.touch_updated_at();
create trigger installments_touch_updated_at before update on public.installments
    for each row execute function public.touch_updated_at();
create trigger payments_touch_updated_at before update on public.payments
    for each row execute function public.touch_updated_at();
create trigger receipts_touch_updated_at before update on public.receipts
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 10. Trigger: auto-update installment status when amount_paid changes
-- ----------------------------------------------------------------------------
create or replace function public.update_installment_status()
returns trigger
language plpgsql
security definer
as $$
begin
    if new.amount_paid >= new.amount_due then
        new.status := 'paid';
        if new.paid_date is null then
            new.paid_date := current_date;
        end if;
    elsif new.amount_paid > 0 then
        new.status := 'partial';
    else
        new.status := 'unpaid';
        new.paid_date := null;
    end if;

    -- Auto-flag overdue if due_date passed and not fully paid
    if new.due_date < current_date and new.amount_paid < new.amount_due then
        if new.status <> 'paid' then
            new.status := 'overdue';
        end if;
    end if;

    return new;
end;
$$;

create trigger installments_update_status
    before insert or update of amount_paid, due_date on public.installments
    for each row execute function public.update_installment_status();

-- ----------------------------------------------------------------------------
-- 11. Functions: ledger balance computation (canonical, plan §07)
-- ----------------------------------------------------------------------------
create or replace function public.compute_account_balance(p_account_id text)
returns numeric(12,2)
language sql
stable
as $$
    select coalesce(sum(amount), 0)::numeric(12,2)
      from public.ledger_entries
     where account_id = p_account_id;
$$;

create or replace function public.compute_parent_balance(p_parent_id uuid)
returns table(
    account_id text,
    category text,
    total_charged numeric(12,2),
    total_paid numeric(12,2),
    outstanding numeric(12,2)
)
language sql
stable
as $$
    select account_id,
           max(category) as category,
           sum(case when amount > 0 then amount else 0 end) as total_charged,
           sum(case when amount < 0 then abs(amount) else 0 end) as total_paid,
           sum(amount) as outstanding
      from public.ledger_entries
     where parent_id = p_parent_id
     group by account_id
     order by account_id;
$$;

create or replace function public.compute_parent_outstanding(p_parent_id uuid)
returns numeric(12,2)
language sql
stable
as $$
    select coalesce(sum(amount), 0)::numeric(12,2)
      from public.ledger_entries
     where parent_id = p_parent_id;
$$;

create or replace function public.compute_overdue_amount(p_parent_id uuid, p_as_of date default current_date)
returns numeric(12,2)
language sql
stable
as $$
    select coalesce(sum(le.amount), 0)::numeric(12,2)
      from public.ledger_entries le
     where le.parent_id = p_parent_id
       and le.amount > 0
       and le.entry_type = 'charge'
       and le.entry_date::date <= p_as_of
       and not exists (
           select 1 from public.ledger_entries pay
            where pay.parent_id = p_parent_id
              and pay.account_id = le.account_id
              and pay.amount < 0
              and pay.entry_date::date <= p_as_of
       );
$$;

comment on function public.compute_account_balance is 'Replays ledger entries for one account_id. Returns signed balance (positive = owed).';
comment on function public.compute_parent_balance is 'Per-account balance breakdown for a parent. Computed by replay (never stored).';
comment on function public.compute_parent_outstanding is 'Total outstanding balance for a parent. Computed by replay (positive = owed, negative = credit).';
comment on function public.compute_overdue_amount is 'Outstanding charges with no matching payment by the as-of date. Used by overdue alert generator (plan §07.06).';
