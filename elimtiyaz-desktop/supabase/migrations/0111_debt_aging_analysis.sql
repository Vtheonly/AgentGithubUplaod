-- ============================================================================
-- 0111_debt_aging_analysis.sql — T-405: Cross-Year Debt Aging & Payment-
-- Behavior Tracking (the SQL mirror of financial-rules.md §15)
-- ============================================================================
-- WHAT THIS ADDS (and nothing else — the task's cardinal rule: extend the
-- existing Finance system, never duplicate it):
--
--   1. public.attribute_academic_year(date, uuid) — INV-14 attribution:
--      the tenant's academic_years row whose [start_date, end_date] contains
--      the date, else the Algerian school-year calendar convention
--      (Jul–Dec → YYYY-(YYYY+1); Jan–Jun → (YYYY-1)-YYYY). The live tenant
--      carries ONLY 2026-2027, so historical due dates resolve by convention.
--   2. public.academic_year_start(text) — numeric sort key of a year code.
--   3. public.compute_debt_aging_rows(p_tenant_id, p_as_of) — THE single
--      ungated computation (owner-only EXECUTE): one row per parent with
--      installment-based outstanding > 0.001 DZD. Inputs are existing
--      canonical facts ONLY:
--        - outstanding per obligation = GREATEST(0, amount_due − amount_paid
--          − amount_pending) on REAL installment rows (INV-4 family — the
--          same formula + the same rows the Créances tab
--          DebtRepository.observeSummary uses);
--        - payment behavior = NON-REVERSED entry_type='payment' ledger
--          entries (the computeParentSummary replay source);
--        - origin year = attribute_academic_year(oldest outstanding due
--          date) — a later payment NEVER rewrites it;
--        - debt age = days from the OLDEST outstanding due date (INV-4
--          basis) — NEVER reset by partial payments;
--        - inactivity = days since last payment; never-paid → debt age
--          (INV-16b);
--        - subsequent-year payments = payments attributed to an academic
--          year STRICTLY after the origin year (INV-15);
--        - status = the ordered INV-16 evaluation, thresholds = the
--          EXISTING AgingBucket edges 60/90/180 + the INV-4 0.001 epsilon
--          (green/resolved · green/active_payer · red/critical_delinquency
--          · orange/sustained_delinquency · yellow/watch).
--   4. public.compute_debt_aging_summary(p_as_of) — the STAFF RPC gate
--      (SECURITY DEFINER): has_any_role(super_admin, financial_officer,
--      support_staff — the installments_select staff branch) + tenant scope
--      via current_tenant_id(); delegates to (3). This is the query contract
--      every platform consumer (statistics, reports, exports, dashboards)
--      calls. 'resolved' never appears here BY DESIGN: this surface returns
--      debtors only (outstanding > 0.001); the resolved branch of the shared
--      status contract is pinned by the TS reference engine's suite.
--   5. mv_debt_aging EXTENDED (drop + recreate, the 0034/0041/0042 pattern)
--      with the payment-behavior columns: installment_outstanding,
--      debt_age_days, origin_academic_year, last_payment_at,
--      inactivity_days, subsequent_year_payment_count,
--      subsequent_year_payment_total, status_level, reason_code.
--      ALL pre-existing columns (total_outstanding, total_overdue,
--      aging_bucket, names) are byte-identical — INCLUDING their basis:
--      total_outstanding stays the LEDGER replay (compute_parent_summary),
--      while the NEW installment_outstanding is the §15 installment basis
--      (the Créances-tab number). Two documented columns, two documented
--      sources, zero drift introduced. mv_top_debtors recreated verbatim
--      (it reads only the unchanged columns). The 0049 unique indexes are
--      recreated (REFRESH ... CONCURRENTLY requires them; 0021's per-bucket
--      index died with the 0041/0042 drops and is intentionally not revived).
--
-- GRANTS (§15.34 lesson): platform default privileges grant anon EXECUTE on
-- new functions — revoked EXPLICITLY from anon AND public on all four; the
-- staff RPC additionally grants EXECUTE to authenticated (the gate does the
-- authorization).
--
-- PARITY: verify_t-405.sql pins the SQL factors + reason codes against the
-- same fixtures as the TS reference suite
-- (src/tests/domain/ledger/debt-aging.test.ts — the two archetype parents).
--
-- Registration: the T-091/MIG-TOKENS embedded block (atomic with the DDL
-- for the Management-API live application; idempotent via ON CONFLICT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. INV-14 attribution helper
-- ----------------------------------------------------------------------------
create or replace function public.attribute_academic_year(p_date date, p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path to public
as $$
    select coalesce(
        -- Known academic_years row containing the date (latest start wins).
        (
            select ay.label
              from public.academic_years ay
             where ay.tenant_id = p_tenant_id
               and p_date between ay.start_date and ay.end_date
             order by ay.start_date desc
             limit 1
        ),
        -- Algerian school-year convention (financial-rules §15, INV-14):
        -- July–December starts the YYYY-(YYYY+1) year; January–June belongs
        -- to (YYYY-1)-YYYY.
        case
            when extract(month from p_date) >= 7 then
                extract(year from p_date)::int::text || '-' || (extract(year from p_date)::int + 1)::text
            else
                (extract(year from p_date)::int - 1)::text || '-' || extract(year from p_date)::int::text
        end
    );
$$;

comment on function public.attribute_academic_year is
    'T-405 / INV-14: attribute a date to an academic year — the tenant academic_years window first, then the Jul1–Jun30 Algerian school-year convention.';

-- ----------------------------------------------------------------------------
-- 2. Year-code sort key
-- ----------------------------------------------------------------------------
create or replace function public.academic_year_start(p_code text)
returns integer
language sql
immutable
as $$
    select case
        when split_part(p_code, '-', 1) ~ '^\d+$' then split_part(p_code, '-', 1)::int
        else null
    end
$$;

comment on function public.academic_year_start is
    'T-405: numeric start year of a YYYY-YYYY academic-year code (NULL when unparseable).';

-- ----------------------------------------------------------------------------
-- 3. THE single debt-aging computation (ungated internal; owner-only EXECUTE)
-- ----------------------------------------------------------------------------
create or replace function public.compute_debt_aging_rows(
    p_tenant_id uuid,        -- NULL = all tenants (the matview's usage)
    p_as_of timestamptz      -- the evaluation clock (determinism / as-of)
)
returns table (
    tenant_id uuid,
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
language sql
stable
security definer
set search_path to public
as $$
    with oblig as (
        select i.tenant_id,
               i.parent_id,
               i.id as installment_id,
               i.student_id,
               i.category,
               i.label,
               greatest(0, i.amount_due - i.amount_paid - i.amount_pending) as remaining,
               i.due_date
          from public.installments i
         where (p_tenant_id is null or i.tenant_id = p_tenant_id)
           and greatest(0, i.amount_due - i.amount_paid - i.amount_pending) > 0
    ),
    per_parent as (
        select o.tenant_id,
               o.parent_id,
               sum(o.remaining) as outstanding_amount,
               min(o.due_date) as oldest_due_date
          from oblig o
         group by o.tenant_id, o.parent_id
    ),
    attributed as (
        select pp.tenant_id,
               pp.parent_id,
               pp.outstanding_amount,
               pp.oldest_due_date,
               public.attribute_academic_year(pp.oldest_due_date, pp.tenant_id) as origin_academic_year
          from per_parent pp
    ),
    pay as (
        select e.parent_id, e.entry_date, e.amount
          from public.ledger_entries e
         where e.entry_type = 'payment'
           and (p_tenant_id is null or e.tenant_id = p_tenant_id)
           -- Reversal exclusion mirrors the TS engine (computeAccountBalance's
           -- reversedIds): a payment reversed by ANY entry is not payment behavior.
           and not exists (
               select 1 from public.ledger_entries r
                where r.reverses_entry_id = e.id
           )
    ),
    pay_last as (
        select pl.parent_id, max(pl.entry_date) as last_payment_at
          from pay pl
         group by pl.parent_id
    ),
    pay_sub as (
        select a.parent_id,
               count(ps.entry_date) as subsequent_year_payment_count,
               coalesce(sum(abs(ps.amount)), 0) as subsequent_year_payment_total
          from attributed a
          join pay ps
            on ps.parent_id = a.parent_id
           and public.academic_year_start(
                   public.attribute_academic_year((ps.entry_date at time zone 'UTC')::date, a.tenant_id)
               ) > public.academic_year_start(a.origin_academic_year)
         group by a.parent_id
    ),
    oblig_detail as (
        select o.tenant_id,
               o.parent_id,
               jsonb_agg(
                   jsonb_build_object(
                       'installmentId', o.installment_id::text,
                       'studentId', o.student_id::text,
                       'category', o.category,
                       'label', o.label,
                       'remaining', o.remaining,
                       'dueDate', to_char(o.due_date, 'YYYY-MM-DD'),
                       'academicYear', public.attribute_academic_year(o.due_date, o.tenant_id),
                       'daysOverdue', greatest(0, floor(extract(epoch from (p_as_of - o.due_date::timestamptz)) / 86400))::int
                   ) order by o.due_date, o.installment_id
               ) as obligations,
               coalesce(
                   array_agg(distinct o.student_id) filter (where o.student_id is not null),
                   array[]::uuid[]
               ) as student_ids
          from oblig o
         group by o.tenant_id, o.parent_id
    ),
    -- The per-parent FACTORS, computed once (the INV-16 evaluation inputs).
    -- NOTE the never-paid semantics: inactivity is CASE-based, NOT
    -- greatest(0, coalesce(...)) — postgres GREATEST IGNORES NULLs, so
    -- `greatest(0, floor(p_as_of - NULL))` collapses to 0 and a never-paid
    -- parent would look perfectly active (the live-caught defect this
    -- restructure fixed; INV-16b demands inactivity = debt age there).
    factors as (
        select
            a.tenant_id,
            a.parent_id,
            a.outstanding_amount,
            a.oldest_due_date,
            a.origin_academic_year,
            greatest(0, floor(extract(epoch from (p_as_of - a.oldest_due_date::timestamptz)) / 86400))::int as debt_age_days,
            plast.last_payment_at,
            case when plast.last_payment_at is null then null
                 else greatest(0, floor(extract(epoch from (p_as_of - plast.last_payment_at)) / 86400))::int
            end as days_since_last_payment,
            -- §15 inactivity: last-payment recency; never-paid → debt age
            -- (INV-16b).
            case when plast.last_payment_at is null
                 then greatest(0, floor(extract(epoch from (p_as_of - a.oldest_due_date::timestamptz)) / 86400))::int
                 else greatest(0, floor(extract(epoch from (p_as_of - plast.last_payment_at)) / 86400))::int
            end as inactivity_days,
            coalesce(psub.subsequent_year_payment_count, 0) as subsequent_year_payment_count,
            coalesce(psub.subsequent_year_payment_total, 0) as subsequent_year_payment_total
          from attributed a
          left join pay_last plast on plast.parent_id = a.parent_id
          left join pay_sub psub on psub.parent_id = a.parent_id
         where a.outstanding_amount > 0.001
    )
    select
        p.tenant_id,
        p.id as parent_id,
        -- Name resolution mirrors the DebtTab's seedSummary convention:
        -- display_name first, falling back to first + last.
        coalesce(
            nullif(trim(p.display_name), ''),
            trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
        ) as parent_name,
        p.primary_phone as parent_phone,
        od.student_ids,
        f.outstanding_amount,
        f.oldest_due_date,
        f.debt_age_days,
        f.origin_academic_year,
        f.last_payment_at,
        f.days_since_last_payment,
        f.inactivity_days,
        f.subsequent_year_payment_count,
        f.subsequent_year_payment_total,
        f.subsequent_year_payment_count > 0 as has_subsequent_year_payments,
        od.obligations,
        -- ── The ordered INV-16 evaluation (mirrors the TS engine exactly) ──
        case
            when f.outstanding_amount <= 0.001 then 'green'
            when f.inactivity_days <= 60 then 'green'
            when f.debt_age_days > 180 and f.inactivity_days > 180 then 'red'
            when f.debt_age_days > 90 and f.inactivity_days > 60 then 'orange'
            else 'yellow'
        end as status_level,
        case
            when f.outstanding_amount <= 0.001 then 'resolved'
            when f.inactivity_days <= 60 then 'active_payer'
            when f.debt_age_days > 180 and f.inactivity_days > 180 then 'critical_delinquency'
            when f.debt_age_days > 90 and f.inactivity_days > 60 then 'sustained_delinquency'
            else 'watch'
        end as reason_code,
        p_as_of as computed_at
    from factors f
    join public.parents p
      on p.id = f.parent_id
     and p.tenant_id = f.tenant_id
     and p.deleted_at is null
    join oblig_detail od on od.tenant_id = f.tenant_id and od.parent_id = f.parent_id
$$;

comment on function public.compute_debt_aging_rows is
    'T-405 (financial-rules §15): the single cross-year debt-aging computation — installments (INV-4 remaining) + non-reversed payment ledger entries + academic-year attribution (INV-14) → the ordered INV-16 status. Ungated internal (owner-only); use compute_debt_aging_summary from clients.';

-- ----------------------------------------------------------------------------
-- 4. The staff RPC gate (the client/query contract)
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
set search_path to public
as $$
declare
    v_tenant uuid;
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
           r.status_level,
           r.reason_code,
           r.computed_at
      from public.compute_debt_aging_rows(v_tenant, coalesce(p_as_of, now())) r
     order by r.outstanding_amount desc, r.parent_id;
end;
$$;

comment on function public.compute_debt_aging_summary is
    'T-405: the staff debt-aging query contract — one row per debtor (installment outstanding > 0.001 DZD) with cross-year payment-behavior status (INV-16). Gate: super_admin/financial_officer/support_staff + current tenant.';

-- ----------------------------------------------------------------------------
-- 5. Grants (§15.34: revoke from anon AND public explicitly — platform
--    default privileges grant anon EXECUTE on new functions)
-- ----------------------------------------------------------------------------
revoke execute on function public.attribute_academic_year(date, uuid) from anon, public;
revoke execute on function public.academic_year_start(text) from anon, public;
revoke execute on function public.compute_debt_aging_rows(uuid, timestamptz) from anon, public;
revoke execute on function public.compute_debt_aging_summary(timestamptz) from anon, public;
grant execute on function public.compute_debt_aging_summary(timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. mv_debt_aging EXTENDED with the payment-behavior columns (the 0034/
--    0041/0042 drop+recreate pattern). Pre-existing columns byte-identical;
--    mv_top_debtors recreated verbatim (reads only unchanged columns).
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.mv_top_debtors;
DROP MATERIALIZED VIEW IF EXISTS public.mv_debt_aging;

CREATE MATERIALIZED VIEW public.mv_debt_aging AS
SELECT
  p.id AS parent_id,
  p.tenant_id,
  p.display_name,
  COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '') AS parent_name,
  summary.total_outstanding,
  summary.total_overdue,
  CASE
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 180 THEN '180_plus'
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 90 THEN '91_180'
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 60 THEN '61_90'
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 30 THEN '31_60'
    WHEN summary.total_overdue > 0 THEN '0_30'
    ELSE NULL
  END AS aging_bucket,
  -- ── T-405 payment-behavior columns (financial-rules §15 basis) ──
  aging.outstanding_amount AS installment_outstanding,
  aging.debt_age_days,
  aging.origin_academic_year,
  aging.last_payment_at,
  aging.inactivity_days,
  aging.subsequent_year_payment_count,
  aging.subsequent_year_payment_total,
  aging.status_level,
  aging.reason_code
FROM parents p
CROSS JOIN LATERAL compute_parent_summary(p.id) AS summary
LEFT JOIN public.compute_debt_aging_rows(NULL, NOW()) aging ON aging.parent_id = p.id
WHERE p.deleted_at IS NULL AND summary.total_outstanding > 0;

CREATE MATERIALIZED VIEW public.mv_top_debtors AS
SELECT
  parent_id, tenant_id, parent_name,
  total_outstanding, total_overdue, aging_bucket,
  ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY total_outstanding DESC) AS rank
FROM public.mv_debt_aging
WHERE total_outstanding > 0
ORDER BY total_outstanding DESC;

-- 0049's unique indexes (REFRESH ... CONCURRENTLY requires them).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_debt_aging_tenant_parent
  ON public.mv_debt_aging (tenant_id, parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_top_debtors_tenant_parent
  ON public.mv_top_debtors (tenant_id, parent_id);

comment on materialized view public.mv_debt_aging is
    'Per-parent debt aging: aging_bucket = ledger-overdue age band (0042 basis); T-405 columns = cross-year payment-behavior status on the installment basis (financial-rules §15 — installment_outstanding is the Créances-tab number, total_outstanding stays the ledger replay).';

-- ----------------------------------------------------------------------------
-- 7. Registration (T-091/MIG-TOKENS pattern — atomic with the DDL for the
--    Management-API live application; idempotent via ON CONFLICT)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0111', '{0111_debt_aging_analysis.sql}', 'debt_aging_analysis')
on conflict (version) do nothing;
