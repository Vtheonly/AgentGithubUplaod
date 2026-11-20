-- ============================================================================
-- 0117_price_config_per_year.sql
-- ============================================================================
-- T-414 (issue #14 Task 1, problem PRICING-500, ADR-025 — 2026-09-26):
-- Price configurations are per academic year with exactly ONE active config
-- per tenant.
--
-- The 0006 schema already models one config per tenant per academic year
-- (unique (tenant_id, academic_year_id) + child grids keyed by
-- pricing_config_id) but nothing enforced a single ACTIVE row, and the
-- application layer (T-307 port) selected "first active" with no year
-- predicate — preparing a new academic year could only be done by mutating
-- the previous year's rows.
--
-- This migration:
--   1. Sanitizes any multi-active tenant state (keep the config bound to the
--      is_current year, then the most recently updated) — idempotent.
--   2. Enforces ONE active config per tenant with a partial unique index.
--   3. set_active_pricing_config(p_config_id) — the explicit, atomic
--      activation switch (deactivate siblings + activate target in ONE
--      transaction). Audited by the 0086 pricing mutation triggers.
--   4. create_pricing_config_for_year(p_academic_year_id, p_label,
--      p_clone_from_active) — the new-year preparation flow (ADR-025 §3:
--      create-then-activate). Cloning copies the five child grids from the
--      tenant's ACTIVE config so year-over-year changes are a delta, not a
--      re-entry.
--
-- Historical preservation is NOT touched here: balances replay from stored
-- ledger/service_enrollments/installments rows (ADR-017 §4 / INV-1) — this
-- migration changes WHERE future prices live, never past records.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Sanitize: at most one active config per tenant BEFORE the index
-- ----------------------------------------------------------------------------
-- Deterministic survivor ranking per tenant:
--   1) the config bound to the is_current academic year,
--   2) then the most recently updated,
--   3) then the greatest id (total-order tiebreak).
-- Idempotent: a second run finds no rn > 1 rows and updates nothing.
-- ----------------------------------------------------------------------------
with ranked as (
    select pc.id,
           row_number() over (
               partition by pc.tenant_id
               order by (ay.is_current) desc nulls last,
                        pc.updated_at desc,
                        pc.id desc
           ) as rn
      from public.pricing_configs pc
      left join public.academic_years ay on ay.id = pc.academic_year_id
     where pc.is_active
)
update public.pricing_configs pc
   set is_active = false,
       updated_at = now()
  where pc.is_active
    and pc.id in (select id from ranked where rn > 1);

-- ----------------------------------------------------------------------------
-- 2. The invariant: one ACTIVE config per tenant (PRICING-500 core fix)
-- ----------------------------------------------------------------------------
create unique index if not exists pricing_configs_one_active_per_tenant
    on public.pricing_configs (tenant_id)
    where (is_active);

comment on index public.pricing_configs_one_active_per_tenant is
  'T-414 / ADR-025: exactly one ACTIVE pricing config per tenant — the active-config selection (.eq(is_active).limit(1)) is deterministic by construction; activation goes through set_active_pricing_config.';

-- ----------------------------------------------------------------------------
-- 3. set_active_pricing_config — the explicit atomic activation switch
-- ----------------------------------------------------------------------------
create or replace function public.set_active_pricing_config(p_config_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_target public.pricing_configs%rowtype;
begin
    -- Gate 1 — staff roles (mirrors the 0019 pricing_configs_admin policy:
    -- pricing writes are super_admin / financial_officer).
    if not public.has_any_role(array['super_admin', 'financial_officer']) then
        raise exception 'forbidden: pricing activation is a staff surface'
            using errcode = '42501';
    end if;

    -- Gate 2 — tenant scope (SECURITY DEFINER bypasses the RLS that would
    -- normally scope writes; current_tenant_id() is the canonical resolver).
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context'
            using errcode = '42501';
    end if;

    select * into v_target
      from public.pricing_configs
     where id = p_config_id;

    if v_target.id is null then
        raise exception 'pricing config not found: %', p_config_id
            using errcode = '22023';
    end if;

    if v_target.tenant_id <> v_tenant then
        raise exception 'forbidden: pricing config belongs to another tenant'
            using errcode = '42501';
    end if;

    if v_target.is_active then
        -- Idempotent no-op: activating the already-active config.
        return v_target.id;
    end if;

    -- The switch, atomically: deactivate siblings, activate the target.
    update public.pricing_configs
       set is_active = false,
           updated_at = now()
     where tenant_id = v_tenant
       and is_active
       and id <> p_config_id;

    update public.pricing_configs
       set is_active = true,
           updated_at = now()
     where id = p_config_id
    returning * into v_target;

    -- 0086 pricing mutation triggers already audit both UPDATEs (before/after
    -- snapshots with actor attribution) — no manual audit row here.
    return v_target.id;
end;
$$;

comment on function public.set_active_pricing_config is
  'T-414 / PRICING-500 / ADR-025: atomically switches the tenant''s ACTIVE pricing config (deactivates siblings, activates the target). Idempotent for the already-active config. Gates: super_admin/financial_officer + current tenant. The previously active config is left UNCHANGED except is_active=false — historical pricing is preserved (INV-1: financial records replay stored amounts, never re-priced).';

-- ----------------------------------------------------------------------------
-- 4. create_pricing_config_for_year — the new-year preparation flow
-- ----------------------------------------------------------------------------
create or replace function public.create_pricing_config_for_year(
    p_academic_year_id uuid,
    p_label text,
    p_clone_from_active boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_year public.academic_years%rowtype;
    v_new_id uuid;
    v_source_id uuid;
    v_count integer;
begin
    -- Gate 1 — staff roles (same surface as pricing writes).
    if not public.has_any_role(array['super_admin', 'financial_officer']) then
        raise exception 'forbidden: pricing configuration is a staff surface'
            using errcode = '42501';
    end if;

    -- Gate 2 — tenant scope.
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context'
            using errcode = '42501';
    end if;

    -- Gate 3 — the academic year must exist and belong to the tenant.
    select * into v_year
      from public.academic_years
     where id = p_academic_year_id;

    if v_year.id is null then
        raise exception 'academic year not found: %', p_academic_year_id
            using errcode = '22023';
    end if;

    if v_year.tenant_id <> v_tenant then
        raise exception 'forbidden: academic year belongs to another tenant'
            using errcode = '42501';
    end if;

    -- Gate 4 — one config per (tenant, year) — the 0006 unique constraint,
    -- surfaced as a friendly error instead of a raw 23505.
    select count(*) into v_count
      from public.pricing_configs
     where tenant_id = v_tenant
       and academic_year_id = p_academic_year_id;

    if v_count > 0 then
        raise exception 'a pricing configuration already exists for academic year % (%)', v_year.label, v_year.id
            using errcode = '23505';
    end if;

    -- The active config (clone source) — resolved AFTER the uniqueness gate
    -- so the clone is optional even when no active config exists.
    select id into v_source_id
      from public.pricing_configs
     where tenant_id = v_tenant
       and is_active
     order by updated_at desc
     limit 1;

    -- Create the config (INACTIVE — activation is the separate explicit
    -- set_active_pricing_config step, per ADR-025 §3 create-then-activate).
    insert into public.pricing_configs (
        tenant_id, academic_year_id, label,
        registration_fee, late_penalty_per_day, second_apron_fee,
        early_payment_bonus_pct, early_payment_deadline,
        is_active
    )
    values (
        v_tenant, p_academic_year_id,
        coalesce(nullif(btrim(p_label), ''), 'Tarification ' || v_year.label),
        coalesce((select pc.registration_fee
                    from public.pricing_configs pc
                   where pc.id = v_source_id), 5000.00),
        coalesce((select pc.late_penalty_per_day
                    from public.pricing_configs pc
                   where pc.id = v_source_id), 100.00),
        coalesce((select pc.second_apron_fee
                    from public.pricing_configs pc
                   where pc.id = v_source_id), 2000.00),
        coalesce((select pc.early_payment_bonus_pct
                    from public.pricing_configs pc
                   where pc.id = v_source_id), 5.00),
        (select pc.early_payment_deadline
           from public.pricing_configs pc
          where pc.id = v_source_id),
        false
    )
    returning id into v_new_id;

    -- Clone the five child grids from the ACTIVE config (year-over-year
    -- changes become a delta the owner edits before activating).
    if p_clone_from_active and v_source_id is not null then
        insert into public.grade_level_tuition (
            pricing_config_id, academic_level_id, annual_amount,
            tranche_1_amount, tranche_2_amount, tranche_3_amount,
            tranche_1_month, tranche_2_month, tranche_3_month,
            registration_fee
        )
        select v_new_id, t.academic_level_id, t.annual_amount,
               t.tranche_1_amount, t.tranche_2_amount, t.tranche_3_amount,
               t.tranche_1_month, t.tranche_2_month, t.tranche_3_month,
               t.registration_fee
          from public.grade_level_tuition t
         where t.pricing_config_id = v_source_id;

        insert into public.transport_destinations (
            pricing_config_id, code, label_fr, label_ar,
            annual_amount, tranche_1_amount, tranche_2_amount, tranche_3_amount,
            tranche_1_month, tranche_2_month, tranche_3_month
        )
        select v_new_id, t.code, t.label_fr, t.label_ar,
               t.annual_amount, t.tranche_1_amount, t.tranche_2_amount, t.tranche_3_amount,
               t.tranche_1_month, t.tranche_2_month, t.tranche_3_month
          from public.transport_destinations t
         where t.pricing_config_id = v_source_id;

        insert into public.complementary_services (
            pricing_config_id, code, label_fr, label_ar,
            semester_amount, annual_amount, billing_model, is_active
        )
        select v_new_id, t.code, t.label_fr, t.label_ar,
               t.semester_amount, t.annual_amount, t.billing_model, t.is_active
          from public.complementary_services t
         where t.pricing_config_id = v_source_id;

        insert into public.additional_services (
            pricing_config_id, code, label_fr, label_ar,
            amount, billing_model, is_active
        )
        select v_new_id, t.code, t.label_fr, t.label_ar,
               t.amount, t.billing_model, t.is_active
          from public.additional_services t
         where t.pricing_config_id = v_source_id;

        insert into public.discounts (
            pricing_config_id, code, label_fr, discount_type, amount,
            applies_to, is_active
        )
        select v_new_id, t.code, t.label_fr, t.discount_type, t.amount,
               t.applies_to, t.is_active
          from public.discounts t
         where t.pricing_config_id = v_source_id;
    end if;

    -- 0086 pricing mutation triggers audit the config + children inserts.
    return v_new_id;
end;
$$;

comment on function public.create_pricing_config_for_year is
  'T-414 / PRICING-500 / ADR-025: prepares the pricing configuration for an academic year (optionally cloning the ACTIVE config''s five child grids — tuition, transport, complementary, additional, discounts). The new config is created INACTIVE; activation is the separate explicit set_active_pricing_config step. Gates: super_admin/financial_officer + current tenant + year-in-tenant + one-config-per-year (0006 unique constraint surfaced as a friendly 23505).';

-- ----------------------------------------------------------------------------
-- 5. Grants (§15.34: revoke from anon AND public explicitly — platform
--    default privileges grant anon EXECUTE on new functions)
-- ----------------------------------------------------------------------------
revoke execute on function public.set_active_pricing_config(uuid) from anon, public;
revoke execute on function public.create_pricing_config_for_year(uuid, text, boolean) from anon, public;
grant execute on function public.set_active_pricing_config(uuid) to authenticated;
grant execute on function public.create_pricing_config_for_year(uuid, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Registration (T-091/MIG-TOKENS pattern — atomic with the DDL for the
--    Management-API live application; idempotent via ON CONFLICT)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0117', '{0117_price_config_per_year.sql}', 'price_config_per_year')
on conflict (version) do nothing;
