-- ============================================================================
-- 0009_attendance_hr.sql
-- ============================================================================
-- Personnel directory, Releve (teacher activity ledger), workforce attendance.
--
-- Per plan §09:
--   - Personnel categories: Administrative / Teaching / Support / Medical
--   - Releve is append-only, audit-logged, read-only to teachers
--   - Salary visibility restricted to SuperAdmin + FinancialOfficer (RLS)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. personnel — staff master records
-- ----------------------------------------------------------------------------
create table public.personnel (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    personnel_code text        not null,                            -- 'PER-2026-0014'
    user_id         uuid        references public.user_profiles(id) on delete set null,
    first_name      text        not null,
    last_name       text        not null,
    middle_name     text,
    date_of_birth   date,
    gender          text        check (gender in ('male', 'female', 'other')),
    national_id     text,
    staff_category  text        not null check (staff_category in ('administration', 'teaching', 'support', 'medical')),
    role_id         uuid        references public.roles(id) on delete restrict,
    department_id   uuid,                                            -- FK to departments(id), filled in 0010
    supervisor_id   uuid        references public.personnel(id) on delete set null,
    position        text,
    hire_date       date        not null default current_date,
    end_date        date,
    is_active       boolean     not null default true,

    -- Compensation (RLS-restricted to SuperAdmin + FinancialOfficer)
    base_salary     numeric(10,2),
    payment_method  text        check (payment_method in ('cash', 'bank_transfer', 'check')),
    bank_account    text,
    bonuses_json    jsonb       not null default '[]'::jsonb,        -- [{type, amount, effective_date}]

    -- Contact + emergency
    primary_phone   text,
    secondary_phone text,
    email           text,
    address         text,
    emergency_contact jsonb     not null default '{}'::jsonb,        -- {name, relationship, phone}

    -- Documents
    documents_json jsonb       not null default '[]'::jsonb,
    notes          text,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    unique (tenant_id, personnel_code)
);

create index personnel_tenant_active_idx on public.personnel (tenant_id, last_name, first_name) where deleted_at is null;
create index personnel_role_idx on public.personnel (role_id) where role_id is not null;
create index personnel_department_idx on public.personnel (department_id) where department_id is not null;
create index personnel_user_idx on public.personnel (user_id) where user_id is not null;
create index personnel_trgm_idx on public.personnel using gin (last_name extensions.gin_trgm_ops, first_name extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 2. releve_entries — append-only teacher activity ledger (plan §09.05)
-- ----------------------------------------------------------------------------
create table public.releve_entries (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    personnel_id    uuid        not null references public.personnel(id) on delete cascade,
    activity_type   text        not null check (activity_type in (
                        'course', 'meeting', 'surveillance', 'correction',
                        'task', 'delivery', 'warehouse', 'admin', 'other'
                    )),
    class_id        uuid        references public.classes(id) on delete set null,
    class_subject_id uuid       references public.class_subjects(id) on delete set null,
    description     text,
    clock_in_at     timestamptz not null,
    clock_out_at    timestamptz,
    duration_minutes integer    generated always as (
                        case when clock_out_at is not null
                             then extract(epoch from (clock_out_at - clock_in_at))::integer / 60
                             else null end
                    ) stored,
    recorded_by     uuid        not null,                              -- user_profiles.id (NOT the personnel themselves per §09.05)
    recorded_at     timestamptz not null default now(),
    created_at      timestamptz not null default now()
);

create index releve_entries_personnel_idx on public.releve_entries (personnel_id, clock_in_at desc);
create index releve_entries_tenant_date_idx on public.releve_entries (tenant_id, clock_in_at desc);

comment on table public.releve_entries is
  'Append-only teacher/staff activity ledger. Plan §09.05: teachers CANNOT edit their own entries (recorded_by must differ from personnel.user_id).';

-- ----------------------------------------------------------------------------
-- 3. Trigger: prevent teacher editing their own releve entries
-- ----------------------------------------------------------------------------
create or replace function public.prevent_self_releve_entry()
returns trigger
language plpgsql
security definer
as $$
declare
    v_personnel_user_id uuid;
begin
    select user_id into v_personnel_user_id from public.personnel where id = new.personnel_id;

    if v_personnel_user_id is not null and v_personnel_user_id = new.recorded_by then
        raise exception 'Plan §09.05 violation: a teacher cannot record their own Releve entry. Use a separate administrator.';
    end if;

    return new;
end;
$$;

create trigger releve_entries_prevent_self
    before insert or update on public.releve_entries
    for each row execute function public.prevent_self_releve_entry();

-- ----------------------------------------------------------------------------
-- 4. Triggers
-- ----------------------------------------------------------------------------
create trigger personnel_touch_updated_at before update on public.personnel
    for each row execute function public.touch_updated_at();
