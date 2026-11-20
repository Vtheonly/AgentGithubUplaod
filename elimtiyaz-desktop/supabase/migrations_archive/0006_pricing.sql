-- ============================================================================
-- 0006_pricing.sql
-- ============================================================================
-- Single source of truth for all prices (plan §07 "Administration":
-- "Never hardcode payment values").
--
-- Tables:
--   - pricing_configs              — one row per tenant per academic year
--   - grade_level_tuition          — 14 grade levels (prescolaire → 3eme_annee)
--   - transport_destinations       — 4 named zones (ville_boumerdes, etc.)
--   - complementary_services       — psychology, speech therapy, etc.
--   - additional_services          — canteen, second apron, etc.
--   - discounts                    — 5 canonical discount codes
--   - discount_applications        — per-student applied discounts
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. pricing_configs — top-level config per tenant per year
-- ----------------------------------------------------------------------------
create table public.pricing_configs (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    academic_year_id    uuid        not null references public.academic_years(id) on delete restrict,
    label               text        not null,                          -- 'Tarification 2026-2027'
    registration_fee    numeric(10,2) not null default 5000.00 check (registration_fee >= 0),
    late_penalty_per_day numeric(10,2) not null default 100.00 check (late_penalty_per_day >= 0),
    second_apron_fee    numeric(10,2) not null default 2000.00 check (second_apron_fee >= 0),
    early_payment_bonus_pct numeric(5,2) not null default 5.00 check (early_payment_bonus_pct >= 0 and early_payment_bonus_pct <= 100),
    early_payment_deadline date,
    is_active           boolean     not null default true,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (tenant_id, academic_year_id)
);

comment on table public.pricing_configs is
  'Top-level pricing config per tenant per academic year. Single source of truth for all amounts (plan §07).';

-- ----------------------------------------------------------------------------
-- 2. grade_level_tuition — 14 grade levels with 3-tranche schedule
-- ----------------------------------------------------------------------------
create table public.grade_level_tuition (
    id                  uuid        primary key default public.gen_uuid(),
    pricing_config_id   uuid        not null references public.pricing_configs(id) on delete cascade,
    academic_level_id   uuid        not null references public.academic_levels(id) on delete restrict,
    annual_amount       numeric(10,2) not null check (annual_amount >= 0),
    tranche_1_amount    numeric(10,2) not null check (tranche_1_amount >= 0),
    tranche_2_amount    numeric(10,2) not null check (tranche_2_amount >= 0),
    tranche_3_amount    numeric(10,2) not null check (tranche_3_amount >= 0),
    tranche_1_month     integer     not null default 9 check (tranche_1_month between 1 and 12),
    tranche_2_month     integer     not null default 12 check (tranche_2_month between 1 and 12),
    tranche_3_month     integer     not null check (tranche_3_month between 1 and 12),
    -- Constraint: tranches must sum to annual
    constraint tranches_sum_check check (
        abs((tranche_1_amount + tranche_2_amount + tranche_3_amount) - annual_amount) < 0.01
    ),
    unique (pricing_config_id, academic_level_id)
);

create index grade_level_tuition_config_idx on public.grade_level_tuition (pricing_config_id);

-- ----------------------------------------------------------------------------
-- 3. transport_destinations — 4 named zones
-- ----------------------------------------------------------------------------
create table public.transport_destinations (
    id                  uuid        primary key default public.gen_uuid(),
    pricing_config_id   uuid        not null references public.pricing_configs(id) on delete cascade,
    code                text        not null,                          -- 'ville_boumerdes', 'tidjelabine_sahel_figuier_corso', etc.
    label_fr            text        not null,
    label_ar            text,
    annual_amount       numeric(10,2) not null check (annual_amount >= 0),
    tranche_1_amount    numeric(10,2) not null check (tranche_1_amount >= 0),
    tranche_2_amount    numeric(10,2) not null check (tranche_2_amount >= 0),
    tranche_3_amount    numeric(10,2) not null check (tranche_3_amount >= 0),
    tranche_1_month     integer     not null default 9,
    tranche_2_month     integer     not null default 12,
    tranche_3_month     integer     not null default 3,
    constraint transport_tranches_sum_check check (
        abs((tranche_1_amount + tranche_2_amount + tranche_3_amount) - annual_amount) < 0.01
    ),
    unique (pricing_config_id, code)
);

-- ----------------------------------------------------------------------------
-- 4. complementary_services — psychology, speech therapy, etc.
-- ----------------------------------------------------------------------------
create table public.complementary_services (
    id                  uuid        primary key default public.gen_uuid(),
    pricing_config_id   uuid        not null references public.pricing_configs(id) on delete cascade,
    code                text        not null,                          -- 'psychology', 'speech_therapy', 'orthophonie'
    label_fr            text        not null,
    label_ar            text,
    semester_amount     numeric(10,2),
    annual_amount       numeric(10,2),
    billing_model       text        not null check (billing_model in ('per_session', 'per_semester', 'per_year', 'per_term'))
                    default 'per_session',
    is_active           boolean     not null default true,
    unique (pricing_config_id, code)
);

-- ----------------------------------------------------------------------------
-- 5. additional_services — canteen, second apron, etc.
-- ----------------------------------------------------------------------------
create table public.additional_services (
    id                  uuid        primary key default public.gen_uuid(),
    pricing_config_id   uuid        not null references public.pricing_configs(id) on delete cascade,
    code                text        not null,
    label_fr            text        not null,
    label_ar            text,
    amount              numeric(10,2) not null check (amount >= 0),
    billing_model       text        not null check (billing_model in ('one_time', 'per_month', 'per_term', 'per_year'))
                    default 'one_time',
    is_active           boolean     not null default true,
    unique (pricing_config_id, code)
);

-- ----------------------------------------------------------------------------
-- 6. discounts — 5 canonical codes (plan §07)
-- ----------------------------------------------------------------------------
create table public.discounts (
    id                  uuid        primary key default public.gen_uuid(),
    pricing_config_id   uuid        not null references public.pricing_configs(id) on delete cascade,
    code                text        not null check (code in (
                        'passage_palier', 'seniority_5y', 'full_annual',
                        'highest_average', 'sibling_fixed'
                    )),
    label_fr            text        not null,
    label_ar            text,
    discount_type       text        not null check (discount_type in ('fixed_amount', 'percentage')),
    amount              numeric(10,2) not null check (amount >= 0),
    applies_to          text        not null check (applies_to in ('tuition', 'transport', 'total', 'per_student'))
                    default 'total',
    is_active           boolean     not null default true,
    unique (pricing_config_id, code)
);

-- ----------------------------------------------------------------------------
-- 7. discount_applications — per-student applied discounts
-- ----------------------------------------------------------------------------
create table public.discount_applications (
    id                  uuid        primary key default public.gen_uuid(),
    tenant_id           uuid        not null references public.tenants(id) on delete cascade,
    student_id          uuid        not null references public.students(id) on delete cascade,
    discount_id         uuid        not null references public.discounts(id) on delete restrict,
    amount_applied      numeric(10,2) not null check (amount_applied >= 0),
    reason_note         text,
    applied_by          uuid,                                          -- user_profiles.id (admin)
    applied_at          timestamptz not null default now(),
    created_at          timestamptz not null default now()
);

create index discount_applications_student_idx on public.discount_applications (student_id, applied_at desc);

-- ----------------------------------------------------------------------------
-- 8. Triggers
-- ----------------------------------------------------------------------------
create trigger pricing_configs_touch_updated_at before update on public.pricing_configs
    for each row execute function public.touch_updated_at();
create trigger grade_level_tuition_touch_updated_at before update on public.grade_level_tuition
    for each row execute function public.touch_updated_at();
create trigger transport_destinations_touch_updated_at before update on public.transport_destinations
    for each row execute function public.touch_updated_at();
create trigger complementary_services_touch_updated_at before update on public.complementary_services
    for each row execute function public.touch_updated_at();
create trigger additional_services_touch_updated_at before update on public.additional_services
    for each row execute function public.touch_updated_at();
create trigger discounts_touch_updated_at before update on public.discounts
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 9. View: active pricing config (latest active for tenant)
-- ----------------------------------------------------------------------------
create or replace view public.active_pricing_config as
    select pc.*, ay.label as academic_year_label
      from public.pricing_configs pc
      join public.academic_years ay on ay.id = pc.academic_year_id
     where pc.is_active = true
       and ay.is_current = true
     order by pc.updated_at desc;

comment on view public.active_pricing_config is 'Convenience view: active pricing config joined with current academic year.';
