-- ============================================================================
-- 0095_personnel_workforce_system.sql — T-369 (WORKFORCE-500)
-- ============================================================================
-- The backend for the 74d3ebb "Personnel & Workforce Subsystem" UI commit
-- (its own commit message is the blueprint — adapted here to the chain's
-- established conventions):
--
--   1. `staff_absences`        — the absence & two-way justification loop
--      (none -> requested -> submitted -> accepted/rejected).
--   2. `salary_adjustments`   — the IMMUTABLE audited salary-modification
--      history (append-only, like audit_logs per 0014).
--   3. `salary_payments`      — the monthly payroll disbursement ledger
--      (unique per tenant+personnel+period; idempotent upsert RPC).
--   4. `tasks` columns         — completed_by / completion_note /
--      reviewed_by / review_note (the task review lifecycle).
--   5. `leave_requests` columns — amount_requested (the
--      spending_reimbursement kind) + clarification_request/response (the
--      two-way clarification loop) + the CHECK widenings for both.
--   6. `adjust_personnel_salary` RPC — atomic, audited, tenant+role
--      guarded (the 0055 hardening pattern).
--   7. `record_salary_disbursement` RPC — idempotent, audited, with the
--      period's bonuses/deductions derived from salary_adjustments.
--   8. RLS for the three new tables (the 0019 conventions).
--   9. Realtime publication membership for staff_absences + salary_payments
--      (the 0085 pattern — membership-guarded).
--
-- CONVENTION DEVIATIONS FROM THE 74d3ebb BLUEPRINT (documented):
--   * Actor columns (approved_by, paid_by, requested_by, decided_by) store
--     user_profiles.id with NO FK — the 0010 chain convention (the blueprint
--     proposed auth.users(id) FKs; every sibling table in the chain uses the
--     no-FK convention, and the desktop session's userId IS user_profiles.id).
--   * Display-name columns (approved_by_name, paid_by_name) are carried next
--     to the actor uuids — the 0070/0072 precedent (reviewed_by_name): the
--     actor uuid has no FK so a PostgREST embed cannot resolve the name.
--   * The RPCs return jsonb composites (not bare table types) so one
--     round-trip carries both artifacts the UI needs.
--
-- SAFETY / IDEMPOTENCE:
--   * ADD COLUMN IF NOT EXISTS throughout; CREATE TABLE IF NOT EXISTS.
--   * CHECK widenings drop ONLY constraints whose definition matches the
--     targeted column (the 0072 DO-block pattern) and re-add supersets.
--   * create-or-replace functions; re-applying is a no-op.
--   * Zero production rows exist in salary_adjustments / salary_payments /
--     staff_absences (the tables are NEW); tasks / leave_requests are empty
--     live (verified in the T-160 scoping — the desktop mock was the only
--     writer).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. staff_absences — absences & the two-way justification loop
-- ----------------------------------------------------------------------------
create table if not exists public.staff_absences (
    id                    uuid        primary key default public.gen_uuid(),
    tenant_id             uuid        not null references public.tenants(id) on delete cascade,
    personnel_id          uuid        not null references public.personnel(id) on delete cascade,
    date                  date        not null,
    duration_hours        numeric(4,2) not null check (duration_hours > 0),
    is_excused            boolean     not null default false,
    justification_status  text        not null default 'none' check (justification_status in (
                              'none', 'requested', 'submitted', 'accepted', 'rejected'
                          )),
    -- Admin -> worker: "please justify this absence"
    admin_request_note    text,
    requested_at          timestamptz,
    requested_by          uuid,                                            -- user_profiles.id (no FK by convention)
    -- Worker -> admin: the justification itself
    worker_explanation    text,
    worker_submitted_at   timestamptz,
    document_ref          text,                                            -- storage path / reference of the proof
    -- Admin decision
    decision_note         text,
    decided_at            timestamptz,
    decided_by            uuid,                                            -- user_profiles.id (no FK by convention)
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

create index if not exists staff_absences_personnel_idx on public.staff_absences (personnel_id, date desc);
create index if not exists staff_absences_tenant_date_idx on public.staff_absences (tenant_id, date desc);
create index if not exists staff_absences_status_idx on public.staff_absences (justification_status) where justification_status <> 'none';

-- State-transition invariant (the domain contract's loop):
--   none -> requested -> submitted -> accepted | rejected
--   (accepted/rejected are terminal; a new request on a decided absence
--    restarts the loop honestly through the admin path.)
create or replace function public.enforce_staff_absence_justification_flow()
returns trigger
language plpgsql
as $$
begin
    -- is_excused may ONLY be set by the accepted decision (an already-excused
    -- absence keeps its flag through an admin re-request — the honest restart
    -- path accepted/rejected -> requested below). This check runs BEFORE the
    -- unchanged-status early return: setting is_excused WITHOUT a status
    -- change must be refused too (caught by the verify suite's 6e leg).
    if new.is_excused
       and old.justification_status <> 'accepted'
       and new.justification_status <> 'accepted' then
        raise exception 'staff_absences: is_excused requires justification_status = accepted';
    end if;

    if new.justification_status = old.justification_status then
        return new; -- unchanged status: field edits (notes) are allowed
    end if;

    if not (
        (old.justification_status = 'none'      and new.justification_status = 'requested')
     or (old.justification_status = 'requested' and new.justification_status = 'submitted')
     or (old.justification_status = 'submitted' and new.justification_status in ('accepted', 'rejected'))
     or (old.justification_status in ('accepted', 'rejected') and new.justification_status = 'requested')
    ) then
        raise exception 'staff_absences: illegal justification transition % -> % (allowed: none->requested->submitted->accepted|rejected)',
            old.justification_status, new.justification_status;
    end if;

    return new;
end;
$$;

drop trigger if exists staff_absences_justification_flow on public.staff_absences;
create trigger staff_absences_justification_flow
    before update on public.staff_absences
    for each row execute function public.enforce_staff_absence_justification_flow();

create trigger staff_absences_touch_updated_at before update on public.staff_absences
    for each row execute function public.touch_updated_at();
-- (create trigger has no IF NOT EXISTS in PG; the apply is one-shot per the
--  migration chain's append-only discipline — 0095 lands exactly once.)

-- ----------------------------------------------------------------------------
-- 2. salary_adjustments — IMMUTABLE audited salary-modification history
-- ----------------------------------------------------------------------------
create table if not exists public.salary_adjustments (
    id               uuid        primary key default public.gen_uuid(),
    tenant_id        uuid        not null references public.tenants(id) on delete cascade,
    personnel_id     uuid        not null references public.personnel(id) on delete cascade,
    type             text        not null check (type in ('raise', 'cut', 'bonus', 'deduction')),
    amount_before    numeric(12,2) not null check (amount_before >= 0),
    amount_after     numeric(12,2) not null check (amount_after >= 0),
    delta            numeric(12,2) not null,
    reason           text        not null check (length(trim(reason)) >= 5),
    effective_date   date        not null default current_date,
    approved_by      uuid,                                            -- user_profiles.id (no FK by convention)
    approved_by_name text,                                            -- stamped at decision time (0070/0072 precedent)
    created_at       timestamptz not null default now(),
    check (
        (type in ('raise', 'cut') and amount_after = amount_before + delta)
     or (type in ('bonus', 'deduction') and amount_after = amount_before)
    )
);

create index if not exists salary_adjustments_personnel_idx on public.salary_adjustments (personnel_id, created_at desc);
create index if not exists salary_adjustments_tenant_idx on public.salary_adjustments (tenant_id, created_at desc);
create index if not exists salary_adjustments_period_idx on public.salary_adjustments (personnel_id, effective_date);

-- Append-only: corrections are NEW rows, never edits (the audit_logs 0014
-- precedent — the blueprint itself says adjustments "must never occur as
-- silent mutations").
create or replace function public.enforce_salary_adjustment_append_only()
returns trigger
language plpgsql
as $$
begin
    raise exception 'salary_adjustments is append-only: UPDATE and DELETE are forbidden (every correction is a new adjustment row).'
        using errcode = 'P0001';
end;
$$;

drop trigger if exists salary_adjustment_append_only on public.salary_adjustments;
create trigger salary_adjustment_append_only
    before update or delete on public.salary_adjustments
    for each row execute function public.enforce_salary_adjustment_append_only();

-- ----------------------------------------------------------------------------
-- 3. salary_payments — the monthly payroll disbursement ledger
-- ----------------------------------------------------------------------------
create table if not exists public.salary_payments (
    id               uuid        primary key default public.gen_uuid(),
    tenant_id        uuid        not null references public.tenants(id) on delete cascade,
    personnel_id     uuid        not null references public.personnel(id) on delete cascade,
    period           text        not null check (period ~ '^\d{4}-\d{2}$'),   -- YYYY-MM
    base_salary      numeric(12,2) not null check (base_salary >= 0),
    bonuses_total    numeric(12,2) not null default 0 check (bonuses_total >= 0),
    deductions_total numeric(12,2) not null default 0 check (deductions_total >= 0),
    net_paid         numeric(12,2) not null check (net_paid >= 0),
    status           text        not null default 'unpaid' check (status in ('paid', 'unpaid', 'pending')),
    payment_date     date,
    method           text        not null check (method in ('cash', 'bank_transfer', 'check', 'mobile_money')),
    reference_number text,
    notes            text,
    paid_by          uuid,                                            -- user_profiles.id (no FK by convention)
    paid_by_name     text,                                            -- stamped at decision time (0070/0072 precedent)
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (tenant_id, personnel_id, period)
);

create index if not exists salary_payments_period_idx on public.salary_payments (tenant_id, period);
create index if not exists salary_payments_personnel_idx on public.salary_payments (personnel_id, period);

create trigger salary_payments_touch_updated_at before update on public.salary_payments
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. tasks — the review-lifecycle columns (74d3ebb Task model) + the status
--    CHECK widening. DISCOVERY (T-369): the 0010 tasks status CHECK allows
--    pending/assigned/in_progress/blocked/completed/cancelled but NOT
--    'needs_review' — the domain's review-lifecycle status (workforce.ts
--    TaskStatus) — so a worker's "Soumettre pour validation" write would be
--    DB-REJECTED. The T-180 repository header's claim "status and priority
--    are the domain unions VERBATIM (0010 CHECKs match)" was FALSE for
--    needs_review; the table sat empty live so it never surfaced. The
--    widening below is a PURE SUPERSET ('blocked' stays: legacy rows and
--    the 74d3ebb-era mock both used it; the domain simply stopped emitting
--    it).
-- ----------------------------------------------------------------------------
alter table public.tasks
    add column if not exists completed_by uuid,                            -- user_profiles.id (no FK by convention)
    add column if not exists completion_note text,
    add column if not exists reviewed_by uuid,                             -- user_profiles.id (no FK by convention)
    add column if not exists review_note text;

do $drop_tasks_status_checks$
declare r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.tasks'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%status%'
    loop
        execute format('alter table public.tasks drop constraint %I', r.conname);
    end loop;
end
$drop_tasks_status_checks$;

alter table public.tasks
    add constraint tasks_status_kind_check
    check (status in (
        -- 0010 statuses (verbatim superset — 'blocked' retained for legacy rows)
        'pending', 'assigned', 'in_progress', 'blocked',
        'completed', 'cancelled',
        -- the 74d3ebb review lifecycle (T-369)
        'needs_review'
    ));

-- ----------------------------------------------------------------------------
-- 5. leave_requests — amount_requested + the clarification loop
-- ----------------------------------------------------------------------------

-- 5a. Widen the leave_type CHECK: + 'spending_reimbursement' (the domain's
--     6th RequestType — 0072 carried 5 of the 6; the amount column below
--     makes the kind meaningful).
do $drop_leave_type_checks$
declare r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.leave_requests'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%leave_type%'
    loop
        execute format('alter table public.leave_requests drop constraint %I', r.conname);
    end loop;
end
$drop_leave_type_checks$;

alter table public.leave_requests
    add constraint leave_requests_leave_type_kind_check
    check (leave_type in (
        -- legacy 0010 leave categories
        'annual', 'sick', 'personal', 'unpaid', 'maternity', 'paternity',
        -- desktop domain RequestType union (T-178) + the 74d3ebb 6th kind (T-369)
        'leave', 'absence', 'overtime', 'shift_swap', 'remote', 'spending_reimbursement'
    ));

-- 5b. Widen the status CHECK: + 'clarification_requested' (the two-way loop).
do $drop_leave_status_checks$
declare r record;
begin
    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.leave_requests'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%status%'
    loop
        execute format('alter table public.leave_requests drop constraint %I', r.conname);
    end loop;
end
$drop_leave_status_checks$;

alter table public.leave_requests
    add constraint leave_requests_status_kind_check
    check (status in ('pending', 'approved', 'rejected', 'clarification_requested', 'cancelled'));

-- 5c. The new columns.
alter table public.leave_requests
    add column if not exists amount_requested numeric(12,2)
        check (amount_requested is null or amount_requested >= 0),
    add column if not exists clarification_request text,
    add column if not exists clarification_response text;

-- ----------------------------------------------------------------------------
-- 6. RLS — the three new tables (0019 conventions)
-- ----------------------------------------------------------------------------

-- staff_absences: staff-trio + managers see all tenant absences; every member
-- sees their OWN absence records (the worker's justification path). INSERT
-- for tenant admins (the admin records an observed absence). UPDATE for
-- staff-trio OR own absence (the worker submits their justification).
alter table public.staff_absences enable row level security;

create policy staff_absences_select on public.staff_absences
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );

create policy staff_absences_insert on public.staff_absences
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager'])
    );

create policy staff_absences_update on public.staff_absences
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    )
    with check (tenant_id = public.current_tenant_id());

-- salary_adjustments: the compensation data is SuperAdmin + FinancialOfficer
-- territory (plan §09.04 salary visibility); a staff member sees their OWN
-- adjustments (their own payslip's history). Writes ONLY through the
-- adjust_personnel_salary RPC (SECURITY DEFINER) — direct INSERTs are
-- admin-gated so a bypass attempt stays auditable, and UPDATE/DELETE are
-- impossible (append-only trigger).
alter table public.salary_adjustments enable row level security;

create policy salary_adjustments_select on public.salary_adjustments
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );

create policy salary_adjustments_insert on public.salary_adjustments
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer'])
    );

-- salary_payments: same posture — payroll ledger visible to the finance
-- roles + own records; writes through the record_salary_disbursement RPC.
alter table public.salary_payments enable row level security;

create policy salary_payments_select on public.salary_payments
    for select to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and (
            public.has_any_role(array['super_admin', 'financial_officer'])
            or personnel_id in (select id from public.personnel where user_id = public.current_user_profile_id())
        )
    );

-- Writes go through the record_salary_disbursement RPC (SECURITY DEFINER);
-- direct INSERT/UPDATE stay finance-gated so a bypass attempt still passes
-- RLS-auditable role checks. NO delete policy (default-deny) — payroll rows
-- are corrected by re-recording the period, never removed.
create policy salary_payments_insert on public.salary_payments
    for insert to authenticated
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer'])
    );

create policy salary_payments_update on public.salary_payments
    for update to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer'])
    )
    with check (
        tenant_id = public.current_tenant_id()
        and public.has_any_role(array['super_admin', 'financial_officer'])
    );

-- ----------------------------------------------------------------------------
-- 7. adjust_personnel_salary — the atomic audited adjustment RPC
--    (the 74d3ebb blueprint §3.1, hardened with the 0055 caller-verification
--    pattern)
-- ----------------------------------------------------------------------------
create or replace function public.adjust_personnel_salary(
    p_personnel_id uuid,
    p_type text,
    p_delta numeric,
    p_reason text,
    p_effective_date date default current_date,
    p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_personnel record;
    v_amount_before numeric;
    v_amount_after numeric;
    v_signed_delta numeric;
    v_actor_id uuid := public.current_user_profile_id();
    v_actor_name text;
    v_tenant_id uuid;
    v_adjustment public.salary_adjustments;
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
    -- ── Caller verification (0055 pattern) ─────────────────────────────
    if not v_caller_is_service_role then
        if auth.uid() is null then
            raise exception 'adjust_personnel_salary: an authenticated caller is required';
        end if;
        if not public.has_any_role(array['super_admin', 'financial_officer']) then
            raise exception 'adjust_personnel_salary: only super_admin / financial_officer may adjust salaries';
        end if;
    end if;

    -- ── Input validation (mirrors the desktop UI's mandatory-reason rule) ─
    if p_type not in ('raise', 'cut', 'bonus', 'deduction') then
        raise exception 'adjust_personnel_salary: invalid adjustment type %', p_type;
    end if;
    if p_delta is null or p_delta <= 0 then
        raise exception 'adjust_personnel_salary: the adjustment amount must be positive';
    end if;
    if p_reason is null or length(trim(p_reason)) < 5 then
        raise exception 'adjust_personnel_salary: a formal justification of at least 5 characters is mandatory';
    end if;

    -- ── Lock the personnel row (atomic read-modify-write) ───────────────
    select * into v_personnel
      from public.personnel
     where id = p_personnel_id
     for update;

    if not found then
        raise exception 'adjust_personnel_salary: personnel record % not found', p_personnel_id;
    end if;

    v_tenant_id := v_personnel.tenant_id;

    -- Tenant guard (SEC-112 lesson): the caller's working tenant must own
    -- the personnel row. Global admins (tenant-less profiles) and the
    -- service_role are the 0055-trusted exemptions.
    if not v_caller_is_service_role
       and public.current_tenant_id() is not null
       and public.current_tenant_id() <> v_tenant_id then
        raise exception 'adjust_personnel_salary: cross-tenant adjustment refused (personnel tenant % does not match the caller''s working tenant)', v_tenant_id;
    end if;

    v_amount_before := coalesce(v_personnel.base_salary, 0);

    -- Actor display name: the UI-passed name wins, else the profile's
    -- display_name, else a neutral fallback.
    select coalesce(display_name, '') into v_actor_name
      from public.user_profiles
     where id = v_actor_id
       and v_actor_id is not null;
    v_actor_name := coalesce(nullif(trim(coalesce(p_actor_name, '')), ''), nullif(v_actor_name, ''), 'Admin');

    -- ── The four adjustment semantics (the blueprint's table) ───────────
    -- INVARIANT: delta = amount_after - amount_before on every row (the
    -- table CHECK enforces it for raise/cut). For a FLOORED cut the delta
    -- records the reduction that ACTUALLY happened, not the requested
    -- magnitude — a deviation from the blueprint's "-abs(p_delta)" recorded
    -- here because the blueprint's version violates its own row invariant
    -- (amount_after = amount_before + delta) whenever the floor engages.
    if p_type = 'raise' then
        v_amount_after := v_amount_before + abs(p_delta);
        v_signed_delta := abs(p_delta);
    elsif p_type = 'cut' then
        v_amount_after := greatest(0, v_amount_before - abs(p_delta));
        v_signed_delta := v_amount_after - v_amount_before;
    elsif p_type = 'bonus' then
        v_amount_after := v_amount_before;            -- one-off: base unchanged
        v_signed_delta := abs(p_delta);
    else -- 'deduction'
        v_amount_after := v_amount_before;            -- one-off: base unchanged
        v_signed_delta := -abs(p_delta);
    end if;

    -- ── Update the base salary (raise/cut only) ─────────────────────────
    if p_type in ('raise', 'cut') then
        update public.personnel
           set base_salary = v_amount_after,
               updated_at = now()
         where id = p_personnel_id;
    end if;

    -- ── The immutable adjustment row ─────────────────────────────────────
    insert into public.salary_adjustments (
        tenant_id, personnel_id, type, amount_before, amount_after,
        delta, reason, effective_date, approved_by, approved_by_name
    ) values (
        v_tenant_id, p_personnel_id, p_type, v_amount_before, v_amount_after,
        v_signed_delta, trim(p_reason), coalesce(p_effective_date, current_date), v_actor_id, v_actor_name
    )
    returning * into v_adjustment;

    -- ── Master audit log (0014) ──────────────────────────────────────────
    perform public.write_audit_log(
        p_tenant_id   := v_tenant_id,
        p_action      := 'personnel.salary_adjusted',
        p_entity_type := 'personnel',
        p_entity_id   := p_personnel_id,
        p_actor_id    := v_actor_id,
        p_actor_name  := v_actor_name,
        p_before_json := jsonb_build_object('salary', v_amount_before),
        p_after_json  := jsonb_build_object('salary', v_amount_after, 'type', p_type, 'delta', v_signed_delta, 'reason', trim(p_reason)),
        p_note        := format('Salary adjusted (%s: %s DZD)', p_type, v_signed_delta)
    );

    return jsonb_build_object(
        'adjustment', to_jsonb(v_adjustment),
        'base_salary_after', v_amount_after
    );
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. record_salary_disbursement — the idempotent payroll payout RPC
--    (the 74d3ebb blueprint §3.2, with the period's bonuses/deductions
--    derived from salary_adjustments — the blueprint hard-coded 0/0; the
--    columns exist so the month's one-off bonuses/deductions flow into the
--    payslip)
-- ----------------------------------------------------------------------------
create or replace function public.record_salary_disbursement(
    p_personnel_id uuid,
    p_period text,
    p_method text,
    p_reference_number text default null,
    p_notes text default null,
    p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_personnel record;
    v_actor_id uuid := public.current_user_profile_id();
    v_actor_name text;
    v_tenant_id uuid;
    v_bonuses numeric := 0;
    v_deductions numeric := 0;
    v_net numeric := 0;
    v_result public.salary_payments;
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
    -- ── Caller verification (0055 pattern) ─────────────────────────────
    if not v_caller_is_service_role then
        if auth.uid() is null then
            raise exception 'record_salary_disbursement: an authenticated caller is required';
        end if;
        if not public.has_any_role(array['super_admin', 'financial_officer']) then
            raise exception 'record_salary_disbursement: only super_admin / financial_officer may record payroll disbursements';
        end if;
    end if;

    if p_method not in ('cash', 'bank_transfer', 'check', 'mobile_money') then
        raise exception 'record_salary_disbursement: invalid payment method %', p_method;
    end if;
    if p_period !~ '^\d{4}-\d{2}$' then
        raise exception 'record_salary_disbursement: period must be YYYY-MM (got %)', p_period;
    end if;

    select * into v_personnel
      from public.personnel
     where id = p_personnel_id;

    if not found then
        raise exception 'record_salary_disbursement: personnel record % not found', p_personnel_id;
    end if;

    v_tenant_id := v_personnel.tenant_id;

    if not v_caller_is_service_role
       and public.current_tenant_id() is not null
       and public.current_tenant_id() <> v_tenant_id then
        raise exception 'record_salary_disbursement: cross-tenant disbursement refused';
    end if;

    select coalesce(display_name, '') into v_actor_name
      from public.user_profiles
     where id = v_actor_id
       and v_actor_id is not null;
    v_actor_name := coalesce(nullif(trim(p_actor_name), ''), nullif(v_actor_name, ''), 'Admin');

    -- The period's one-off bonuses/deductions (effective within the month).
    select
        coalesce(sum(case when type = 'bonus' then delta end), 0),
        coalesce(sum(case when type = 'deduction' then -delta end), 0)
      into v_bonuses, v_deductions
      from public.salary_adjustments
     where personnel_id = p_personnel_id
       and effective_date >= (p_period || '-01')::date
       and effective_date < ((p_period || '-01')::date + interval '1 month');

    v_net := greatest(0, coalesce(v_personnel.base_salary, 0) + v_bonuses - v_deductions);

    -- Idempotent upsert (re-recording the same month updates, never doubles).
    insert into public.salary_payments (
        tenant_id, personnel_id, period, base_salary, bonuses_total,
        deductions_total, net_paid, status, payment_date, method,
        reference_number, notes, paid_by, paid_by_name
    ) values (
        v_tenant_id, p_personnel_id, p_period, coalesce(v_personnel.base_salary, 0), v_bonuses,
        v_deductions, v_net, 'paid', current_date, p_method,
        nullif(trim(coalesce(p_reference_number, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), v_actor_id, v_actor_name
    )
    on conflict (tenant_id, personnel_id, period)
    do update set
        base_salary      = excluded.base_salary,
        bonuses_total    = excluded.bonuses_total,
        deductions_total = excluded.deductions_total,
        net_paid         = excluded.net_paid,
        status           = 'paid',
        payment_date     = current_date,
        method           = excluded.method,
        reference_number = excluded.reference_number,
        notes            = excluded.notes,
        paid_by          = excluded.paid_by,
        paid_by_name     = excluded.paid_by_name,
        updated_at       = now()
    returning * into v_result;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant_id,
        p_action      := 'personnel.salary_disbursed',
        p_entity_type := 'personnel',
        p_entity_id   := p_personnel_id,
        p_actor_id    := v_actor_id,
        p_actor_name  := v_actor_name,
        p_before_json := null,
        p_after_json  := jsonb_build_object('period', p_period, 'net_paid', v_net, 'method', p_method),
        p_note        := format('Payroll disbursed for %s (%s DZD via %s)', p_period, v_net, p_method)
    );

    return to_jsonb(v_result);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Realtime publication membership (the 0085 membership-guarded pattern)
-- ----------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_absences'
    ) then
        alter publication supabase_realtime add table public.staff_absences;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'salary_payments'
    ) then
        alter publication supabase_realtime add table public.salary_payments;
    end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Registration (T-091/MIG-TOKENS pattern — the apply script embeds this
--     so the DDL and the registration land in ONE atomic transaction)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0095', '{0095_personnel_workforce_system.sql}', 'personnel_workforce_system')
on conflict (version) do nothing;
