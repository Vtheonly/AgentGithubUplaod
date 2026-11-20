-- 0133_debt_aging_thresholds_client_contract.sql
-- ============================================================================
-- T-443 (DEBT-101, the owner's 2026-09-30 mandate) — the CLIENT contract for
-- the configurable debt-aging thresholds (the T-429/0125 architecture's
-- missing half):
--
--   (1) `compute_debt_aging_summary` gains an ADDITIVE `applied_thresholds`
--       jsonb column — the EXACT threshold values the wrapper used to shape
--       each row's status_level/reason_code. The desktop renders the FR
--       explanation + the client↔server parity cross-check from THESE values
--       (mapDebtAgingRow previously compiled them against the hardcoded
--       DEFAULTS — the explanation text carried wrong numbers whenever the
--       tenant configured non-default thresholds, and every near-boundary row
--       logged a spurious parity-drift warning).
--
--   (2) `read_debt_aging_thresholds()` — the STAFF-GATED light reader the
--       dashboard surfaces consume (the Statistics triage derivation + the
--       Finances legend). Rationale: `system_settings` SELECT is RLS-restricted
--       to super_admin/support_staff (0024), but `compute_debt_aging_summary`
--       is gated to super_admin/financial_officer/support_staff — the aging
--       audience INCLUDES financial_officer, so the thresholds must arrive
--       through a contract with the SAME gate, not through a widened RLS
--       policy (§15.15: never weaken RLS to make a client work).
--
-- PARITY: the jsonb keys are camelCase (`gracePeriodDays`, `yellowDays`,
-- `redDays`, `activePayerGraceDays`) matching the TS `DebtAgingThresholds`
-- shape verbatim — the SAME convention 0111's `obligations` jsonb uses.
--
-- Follows ADR-001: NEW migration only — 0111/0125 are never edited in place.
-- The function RECREATE (drop + create) is the documented §15.32 pattern for
-- changing a RETURNS TABLE shape (CREATE OR REPLACE cannot change a return
-- type); grants + comments are re-issued.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. compute_debt_aging_summary — recreated with the additive column.
--    (0125's definition verbatim, plus v_active + the applied_thresholds
--    column; the 4-tier hierarchy, the gates, and the ordering are unchanged.)
-- ----------------------------------------------------------------------------
drop function if exists public.compute_debt_aging_summary(timestamptz);

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
    applied_thresholds jsonb,
    computed_at timestamptz
)
language plpgsql
stable
security definer
set search_path to public
as $$
declare
    v_tenant uuid;
    v_grace integer;
    v_yellow integer;
    v_red integer;
    v_active integer;
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
    select t.grace_period_days, t.yellow_days, t.red_days, t.active_payer_grace_days
      into v_grace, v_yellow, v_red, v_active
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
           -- T-443: the EXACT values that shaped this row's status — the
           -- client renders its explanation/parity from these, so the
           -- displayed numbers can never disagree with the server's verdict.
           jsonb_build_object(
               'gracePeriodDays', coalesce(v_grace, 5),
               'yellowDays', coalesce(v_yellow, 15),
               'redDays', coalesce(v_red, 60),
               'activePayerGraceDays', coalesce(v_active, 15)
           ) as applied_thresholds,
           r.computed_at
      from public.compute_debt_aging_rows(v_tenant, coalesce(p_as_of, now())) r
     order by r.outstanding_amount desc, r.parent_id;
end;
$$;

comment on function public.compute_debt_aging_summary is
    'T-405 + T-429 + T-443: the staff debt-aging query contract — one row per debtor (installment outstanding > 0.001 DZD) with the 4-TIER CONFIGURABLE status (financial-rules §15.1 as amended: the thresholds live in system_settings category `debt`; the active-payer rule is decoupled — an annotation, never a status input) AND the applied_thresholds jsonb (the exact values used, so the client explanation/parity matches the verdict by construction). Gate: super_admin/financial_officer/support_staff + current tenant.';

revoke execute on function public.compute_debt_aging_summary(timestamptz) from anon, public;
grant execute on function public.compute_debt_aging_summary(timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. read_debt_aging_thresholds — the light staff-gated reader (the dashboard
--    triage + the Finances legend). Wraps 0125's debt_aging_thresholds()
--    (REUSE — the reader is a gate + tenant resolution, never a second
--    threshold implementation).
-- ----------------------------------------------------------------------------
create or replace function public.read_debt_aging_thresholds()
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $$
declare
    v_tenant uuid;
    v_grace integer;
    v_yellow integer;
    v_red integer;
    v_active integer;
begin
    -- The SAME staff gate as the aging surface itself (0111/0125/0133) —
    -- the thresholds are the aging audience's operational config, and the
    -- system_settings RLS (0024) stays untouched.
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: debt thresholds are a staff surface';
    end if;

    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    select t.grace_period_days, t.yellow_days, t.red_days, t.active_payer_grace_days
      into v_grace, v_yellow, v_red, v_active
      from public.debt_aging_thresholds(v_tenant) t;

    return jsonb_build_object(
        'gracePeriodDays', coalesce(v_grace, 5),
        'yellowDays', coalesce(v_yellow, 15),
        'redDays', coalesce(v_red, 60),
        'activePayerGraceDays', coalesce(v_active, 15)
    );
end;
$$;

comment on function public.read_debt_aging_thresholds is
    'T-443 (DEBT-101): the staff-gated light reader for the configurable debt-aging thresholds — the same 4 values compute_debt_aging_summary applies (0125 debt_aging_thresholds wrapped with the aging surface''s staff gate + tenant resolution). Consumed by the desktop dashboard triage + the Finances legend.';

revoke execute on function public.read_debt_aging_thresholds() from anon, public;
grant execute on function public.read_debt_aging_thresholds() to authenticated;
