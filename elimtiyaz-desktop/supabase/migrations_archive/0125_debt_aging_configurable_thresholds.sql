-- 0125_debt_aging_configurable_thresholds.sql
-- ============================================================================
-- T-429 (DEBT-100, GitHub issues #24/#25 Track 5) — the CONFIGURABLE debt
-- configuration architecture:
--
--   (1) The `debt` settings category (the system_settings CHECK extended)
--       + the four seeded thresholds ("Configuration des Créances"):
--         debt.grace_period_days       (default 5)
--         debt.threshold_yellow_days   (default 15)
--         debt.threshold_red_days      (default 60)
--         debt.active_payer_grace_days (default 15)
--
--   (2) The 4-TIER canonical risk engine: the STAFF CONTRACT
--       (`compute_debt_aging_summary`) recomputes the status with the
--       configurable hierarchy. 0111's `compute_debt_aging_rows` (the
--       FACTOR engine — obligations, payment replay, academic-year
--       attribution, subsequent-year counts) is INTENTIONALLY UNTOUCHED:
--       its factors remain canonical; only the status/reason columns are
--       overridden at the wrapper (the pre-T-429 status the rows function
--       still emits is discarded by the wrapper — kept for history, never
--       surfaced).
--
--   The hierarchy (strict, no gaps — financial-rules §15.1 as amended):
--     1. outstanding <= 0.001                 -> green  / resolved
--     2. debt_age_days <= grace (5)           -> green  / not_due
--     3. debt_age_days <= yellow (15)         -> yellow / watch
--     4. debt_age_days <= red (60)            -> orange / sustained_delinquency
--     5. debt_age_days >  red (60)            -> red    / critical_delinquency
--
--   The pre-T-429 rule 2 (inactivity <= 60 -> GREEN, the "active payer"
--   masking) is REMOVED (issue #24 Track 2 item 3: "A recent payment must
--   not mask accounts that remain millions of dinars past due"); a payment
--   within active_payer_grace_days becomes an ANNOTATION in the TS
--   rendering, never a status input.
--
-- PARITY: the TS engine (src/domain/calc/ledger/debt-aging.ts,
-- DEFAULT_DEBT_AGING_THRESHOLDS + computeDebtAgingStatus) is the reference;
-- this migration keeps the SQL mirror identical (the reason codes match
-- one-for-one; scripts/verify_t-405.sql pins them).
--
-- Follows ADR-001: NEW migration only — 0111 is never edited in place.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The `debt` settings category
-- ----------------------------------------------------------------------------
alter table public.system_settings
    drop constraint if exists system_settings_category_check;

alter table public.system_settings
    add constraint system_settings_category_check
    check (category in (
        'connection', 'ai', 'email', 'push',
        'storage', 'backup', 'system', 'feature_flags', 'debt'
    ));

-- ----------------------------------------------------------------------------
-- 2. Seed the four thresholds for every tenant that has settings (plus the
--    default tenant). Idempotent (on conflict do nothing).
-- ----------------------------------------------------------------------------
insert into public.system_settings
    (tenant_id, category, key, label_fr, label_en, description_fr, value_type, value,
     is_sensitive, is_required, sort_order, validation_min, validation_max)
select t.tenant_id,
       'debt',
       v.key,
       v.label_fr,
       v.label_en,
       v.description_fr,
       'number',
       to_jsonb(v.default_value),
       false,
       true,
       v.sort_order,
       v.validation_min,
       v.validation_max
from (
    select distinct tenant_id from public.system_settings
    union
    select '00000000-0000-0000-0000-000000000001'::uuid as tenant_id
) t
cross join (
    values
        ('debt.grace_period_days', 'Délai de grâce (jours)', 'Grace period (days)',
         'Jours de retard au-delà de l''échéance toujours comptés « en cours » (vert).',
         5, 80, 0, 30),
        ('debt.threshold_yellow_days', 'Seuil « À surveiller » (jours)', 'Yellow threshold (days)',
         'Jours de retard au-delà desquels le compte passe en « À surveiller » (jaune).',
         15, 81, 1, 90),
        ('debt.threshold_red_days', 'Seuil « Critique / Contentieux » (jours)', 'Red threshold (days)',
         'Jours de retard au-delà desquels le compte passe en « Critique / Contentieux » (rouge).',
         60, 82, 5, 365),
        ('debt.active_payer_grace_days', 'Fenêtre « payeur actif » (jours)', 'Active-payer window (days)',
         'Un paiement dans les N derniers jours annote l''explication « payeur actif » — jamais un statut (le découplage T-429).',
         15, 83, 0, 90)
) as v(key, label_fr, label_en, description_fr, default_value, sort_order, validation_min, validation_max)
on conflict (tenant_id, category, key) do nothing;

-- ----------------------------------------------------------------------------
-- 3. The threshold reader (STABLE — reads system_settings; documented
--    defaults when a row is missing so the engine never NULLs out).
-- ----------------------------------------------------------------------------
create or replace function public.debt_aging_thresholds(p_tenant_id uuid)
returns table (grace_period_days integer, yellow_days integer, red_days integer,
               active_payer_grace_days integer)
language plpgsql
stable
security definer
set search_path to public
as $$
declare
    v_grace integer;
    v_yellow integer;
    v_red integer;
    v_active integer;
begin
    select coalesce(max(case when key = 'debt.grace_period_days' then (value #>> '{}')::int end), 5),
           coalesce(max(case when key = 'debt.threshold_yellow_days' then (value #>> '{}')::int end), 15),
           coalesce(max(case when key = 'debt.threshold_red_days' then (value #>> '{}')::int end), 60),
           coalesce(max(case when key = 'debt.active_payer_grace_days' then (value #>> '{}')::int end), 15)
      into v_grace, v_yellow, v_red, v_active
      from public.system_settings
     where tenant_id = p_tenant_id
       and category = 'debt'
       and key in ('debt.grace_period_days', 'debt.threshold_yellow_days',
                   'debt.threshold_red_days', 'debt.active_payer_grace_days');

    return query
    select coalesce(v_grace, 5)::integer,
           coalesce(v_yellow, 15)::integer,
           coalesce(v_red, 60)::integer,
           coalesce(v_active, 15)::integer;
end;
$$;

comment on function public.debt_aging_thresholds is
    'T-429 (DEBT-100): the configurable debt-aging thresholds for a tenant (the system_settings category `debt`) — with the documented defaults when rows are missing. Consumed by compute_debt_aging_summary.';

revoke execute on function public.debt_aging_thresholds(uuid) from anon, public;

-- ----------------------------------------------------------------------------
-- 4. The STAFF CONTRACT recomputed with the 4-tier hierarchy — the wrapper
--    shape from 0111 is preserved (same columns, same role gates, same
--    tenant gate, same order); ONLY the status_level / reason_code columns
--    are overridden (0111's compute_debt_aging_rows factors are reused
--    verbatim — the factor engine is NOT re-derived here).
-- ----------------------------------------------------------------------------
create or replace function public.compute_debt_aging_summary(
    p_as_of timestamptz default now()
)
returns table (
    parent_id uuid,
    parent_name text,
    parent_phone text,
    student_ids uuid[],
    outstanding_amount numeric,
    oldest_due_date date,
    debt_age_days integer,
    origin_academic_year text,
    last_payment_at timestamptz,
    days_since_last_payment integer,
    inactivity_days integer,
    subsequent_year_payment_count integer,
    subsequent_year_payment_total numeric,
    has_subsequent_year_payments boolean,
    obligations jsonb,
    status_level text,
    reason_code text,
    computed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_grace integer;
    v_yellow integer;
    v_red integer;
begin
    -- Gate 1 — staff roles (the installments_select staff branch).
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: debt aging is a staff surface';
    end if;

    -- Gate 2 — tenant scope (SECURITY DEFINER bypasses the RLS that would
    -- normally scope reads; current_tenant_id() is the canonical resolver).
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    -- T-429: the configurable thresholds for THIS tenant (defaults if unseeded).
    select t.grace_period_days, t.yellow_days, t.red_days
      into v_grace, v_yellow, v_red
      from public.debt_aging_thresholds(v_tenant) t;

    return query
    select r.parent_id,
           r.parent_name,
           r.parent_phone,
           r.student_ids,
           r.outstanding_amount,
           r.oldest_due_date,
           r.debt_age_days,
           r.origin_academic_year,
           r.last_payment_at,
           r.days_since_last_payment,
           r.inactivity_days,
           r.subsequent_year_payment_count,
           r.subsequent_year_payment_total,
           r.has_subsequent_year_payments,
           r.obligations,
           -- ── The T-429 4-tier hierarchy (mirrors the TS engine exactly):
           --    pure due-date aging over the INV-4 remaining; the
           --    active-payer rule is REMOVED from the status inputs. ──
           case
               when r.outstanding_amount <= 0.001 then 'green'
               when r.debt_age_days <= coalesce(v_grace, 5) then 'green'
               when r.debt_age_days <= coalesce(v_yellow, 15) then 'yellow'
               when r.debt_age_days <= coalesce(v_red, 60) then 'orange'
               else 'red'
           end as status_level,
           case
               when r.outstanding_amount <= 0.001 then 'resolved'
               when r.debt_age_days <= coalesce(v_grace, 5) then 'not_due'
               when r.debt_age_days <= coalesce(v_yellow, 15) then 'watch'
               when r.debt_age_days <= coalesce(v_red, 60) then 'sustained_delinquency'
               else 'critical_delinquency'
           end as reason_code,
           r.computed_at
      from public.compute_debt_aging_rows(v_tenant, coalesce(p_as_of, now())) r
     order by r.outstanding_amount desc, r.parent_id;
end;
$$;

comment on function public.compute_debt_aging_summary is
    'T-405 + T-429: the staff debt-aging query contract — one row per debtor (installment outstanding > 0.001 DZD) with the 4-TIER CONFIGURABLE status (financial-rules §15.1 as amended: the thresholds live in system_settings category `debt`; the active-payer rule is decoupled — an annotation, never a status input). Gate: super_admin/financial_officer/support_staff + current tenant.';

revoke execute on function public.compute_debt_aging_summary(timestamptz) from anon, public;
grant execute on function public.compute_debt_aging_summary(timestamptz) to authenticated;
