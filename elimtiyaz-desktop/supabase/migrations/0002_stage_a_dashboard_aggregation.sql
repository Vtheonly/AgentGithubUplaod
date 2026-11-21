-- ============================================================================
-- 0002_stage_a_dashboard_aggregation.sql
-- T-590 (E7A-1 / ROADMAP 6.3) — the dashboard server-side aggregation.
--
-- WHAT: the four compact dashboard read RPCs (KPI family, revenue-by-month,
-- debt aging, demographics) + the mv_grade_summary UNIQUE INDEX (the REFRESH
-- CONCURRENTLY precondition — S26-confirmed absent from the consolidated
-- baseline: 0041 dropped 0021's index with the matview and never restored
-- it, while the other four matviews carry theirs) + the widened
-- refresh_materialized_view whitelist (mv_grade_summary joins the canonical
-- set — refresh_all_materialized_views already refreshes it; the single-view
-- gate was the outlier).
--
-- WHY (OPS-015, the read family): the desktop dashboard previously pulled
-- the FULL payments/installments/students collections and aggregated them
-- client-side — the triple data path (ARCH-040). The egress-minimal shape
-- (the §A.3 charter) is compact JSON per widget, computed server-side.
--
-- ── THE AGING-CONVENTION RECONCILIATION (0111 `max(due_date)` vs 0123
-- `min(due_date)`) — ONE DOCUMENTED CONVENTION ─────────────────────────
-- The canonical per-parent aging anchor is the OLDEST past-due remaining
-- installment: min(due_date) over rows with a REAL remaining balance. This
-- is the "how long has this family been in arrears" semantics — the basis
-- read_debt_summary_collection (0123), collectDebtors' "days since the
-- OLDEST unpaid overdue installment", and this migration's aging RPC all
-- share. The 0111-era mv_debt_aging aging_bucket (max(due_date) over
-- past-due rows — the NEWEST past-due date) is the superseded convention:
-- the matview estate is superseded by these parameterized RPCs per the
-- Stage-A charter ("the current mv_dashboard_kpis / mv_debt_aging are
-- NOW()-anchored — T-590's supersession targets"), and no NEW code follows
-- the max() anchor.
--
-- ── THE WINDOW DISCIPLINE (the card's hard rules) ─────────────────────
-- Every aggregation window is PARAMETERIZED (the academic-year code, the
-- explicit from/to range, the as-of day). No NOW()-anchored rolling window
-- survives in these RPCs; no charges-only sums (the INV-4 remaining basis —
-- amount_due − amount_paid − amount_pending, floored at 0); no
-- stale-positive-only debt (only rows with a REAL remaining balance age —
-- DATA-046: a future tranche is "à échoir", never "en retard").
--
-- PARITY: every formula below mirrors the client-side engines it replaces
-- (SupabaseDashboardRepository.kpisForRange / revenueForRange /
-- debtByAgingForRange / demographics + buildWindowAnchoredBuckets /
-- isInstallmentOverdue / agingBucketFromDays / daysBetweenFloor). The
-- t-590 suite pins the parity at the TS seam; the labels stay client-side
-- (MONTH_LABELS_FR / GRADE_LEVEL_LABELS_FR) — the RPCs return raw keys.
--
-- APPEND-ONLY (OPS-020): 0001 is the immutable consolidated baseline; this
-- file appends the Stage-A surface as 0002. Never edit either afterwards.
-- ============================================================================

-- ── 1. read_dashboard_kpis ─────────────────────────────────────────────
-- One compact JSON row for the KPI cards. p_academic_year scopes the debt
-- family (the Sept 1 → Sept 1 billing window over due_date — the table has
-- no academic_year column, T-353); p_from/p_to scope the revenue window
-- (NULL/NULL = the current UTC month, the client's default); p_as_of is the
-- dynamic-overdue/attendance day (NULL = CURRENT_DATE — parameterized for
-- the parity fixtures, never a rolling window).
create or replace function public.read_dashboard_kpis(
    p_academic_year text,
    p_from date default null,
    p_to date default null,
    p_as_of date default null
)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
    v_tenant uuid;
    v_year_start int;
    v_debt_from date;
    v_debt_to date;
    v_rev_from timestamptz;
    v_rev_to timestamptz;
    v_as_of date := coalesce(p_as_of, current_date);
    v_monthly_revenue numeric := 0;
    v_outstanding numeric := 0;
    v_overdue_count bigint := 0;
    v_overdue_amount numeric := 0;
    v_att_present bigint := 0;
    v_att_total bigint := 0;
    v_result jsonb;
begin
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: dashboard KPIs are a staff surface';
    end if;
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    -- The revenue window: the explicit range, else the current UTC month
    -- (the client's monthStart/monthEnd convention — UTC midnight bounds).
    if p_from is not null and p_to is not null then
        v_rev_from := (p_from::text || 'T00:00:00Z')::timestamptz;
        v_rev_to := (p_to::text || 'T00:00:00Z')::timestamptz;
    else
        v_rev_from := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
        v_rev_to := (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC';
    end if;

    -- The debt family's billing window (T-353): Sept 1 of the parsed start
    -- year → Sept 1 next. An unparseable year code = NO window (the client's
    -- honest "cannot scope" behavior — every unpaid row considered).
    v_year_start := public.academic_year_start(p_academic_year);
    if v_year_start is not null then
        v_debt_from := make_date(v_year_start, 9, 1);
        v_debt_to := make_date(v_year_start + 1, 9, 1);
    end if;

    -- monthlyRevenue: Σ paid payments collected in [from, to) — UTC
    -- midnight bounds, exclusive end (the house convention).
    select coalesce(sum(pay.amount), 0)
      into v_monthly_revenue
      from public.payments pay
     where pay.tenant_id = v_tenant
       and pay.status = 'paid'
       and pay.collected_at >= v_rev_from
       and pay.collected_at < v_rev_to;

    -- outstandingDebt (INV-4): Σ max(0, due − paid − pending) over unpaid
    -- installments in the billing window — the charges are never summed
    -- alone (the §15 installment basis).
    select coalesce(sum(greatest(0, i.amount_due - i.amount_paid - i.amount_pending)), 0)
      into v_outstanding
      from public.installments i
     where i.tenant_id = v_tenant
       and i.status <> 'paid'
       and (v_debt_from is null or (i.due_date >= v_debt_from and i.due_date < v_debt_to));

    -- The dynamic-overdue family (DATA-045): status ≠ 'paid' AND strictly
    -- past due at the as-of day AND a REAL remaining balance. Never the
    -- `status = 'overdue'` string; never future tranches.
    select count(*) filter (where i.due_date < v_as_of),
           coalesce(sum(greatest(0, i.amount_due - i.amount_paid - i.amount_pending))
                     filter (where i.due_date < v_as_of), 0)
      into v_overdue_count, v_overdue_amount
      from public.installments i
     where i.tenant_id = v_tenant
       and i.status <> 'paid'
       and greatest(0, i.amount_due - i.amount_paid - i.amount_pending) > 0
       and (v_debt_from is null or (i.due_date >= v_debt_from and i.due_date < v_debt_to));

    -- attendanceRateToday: present+late / total over the as-of day's records
    -- (the ratio is rounded CLIENT-side with the existing toFixed(2) — zero
    -- rounding drift between the paths).
    select count(*) filter (where r.status in ('present', 'late')),
           count(*)
      into v_att_present, v_att_total
      from public.attendance_records r
     where r.tenant_id = v_tenant
       and r.date = v_as_of;

    select jsonb_build_object(
        'totalStudents', (select count(*) from public.students s
                           where s.tenant_id = v_tenant and s.deleted_at is null),
        'totalParents', (select count(*) from public.parents p
                           where p.tenant_id = v_tenant and p.deleted_at is null),
        'totalStaff', (select count(*) from public.personnel per
                        where per.tenant_id = v_tenant and per.deleted_at is null),
        'monthlyRevenue', v_monthly_revenue,
        'outstandingDebt', v_outstanding,
        'overdueAlerts', v_overdue_count,
        'overdueAmount', v_overdue_amount,
        'pendingExpenses', (select count(*) from public.expense_tickets e
                             where e.tenant_id = v_tenant
                               and e.status in ('draft', 'pending_approval', 'submitted')),
        'attendancePresent', v_att_present,
        'attendanceTotal', v_att_total,
        'asOf', to_char(v_as_of, 'YYYY-MM-DD')
    ) into v_result;

    return v_result;
end;
$function$
;
comment on function read_dashboard_kpis(text, date, date, date) is 'T-590 (E7A-1): the compact dashboard KPI read — parameterized year/range/as-of windows (never NOW()-anchored), the INV-4 remaining basis, the dynamic-overdue family, the attendance-day census. Parity-pinned to SupabaseDashboardRepository.kpisForRange by the t-590 suite.';

-- ── 2. read_dashboard_revenue_by_month ─────────────────────────────────
-- The window-anchored month buckets ([from-month, to) series, max 24 — the
-- buildWindowAnchoredBuckets contract): {year, month, amount} in series
-- order; the French labels map client-side (MONTH_LABELS_FR). Paid payments
-- in [from T00:00Z, to T00:00Z), bucketed by UTC calendar month, LEFT-joined
-- onto the series so empty months carry their honest zero.
create or replace function public.read_dashboard_revenue_by_month(
    p_from date,
    p_to date
)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
    v_tenant uuid;
    v_result jsonb;
begin
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: dashboard aggregates are a staff surface';
    end if;
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    with bounds as (
        select (p_from::text || 'T00:00:00Z')::timestamptz as from_ts,
               (p_to::text || 'T00:00:00Z')::timestamptz as to_ts
    ),
    series as (
        select m
          from generate_series(
              date_trunc('month', (select from_ts at time zone 'UTC' from bounds)),
              (select to_ts at time zone 'UTC' from bounds) - interval '1 month',
              interval '1 month'
          ) as m
         limit 24
    ),
    monthly as (
        select to_char(pay.collected_at at time zone 'UTC', 'YYYY-MM') as ym,
               coalesce(sum(pay.amount), 0) as amount
          from public.payments pay, bounds b
         where pay.tenant_id = v_tenant
           and pay.status = 'paid'
           and pay.collected_at >= b.from_ts
           and pay.collected_at < b.to_ts
         group by 1
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'year', extract(year from s.m at time zone 'UTC')::int,
                'month', extract(month from s.m at time zone 'UTC')::int - 1,
                'amount', coalesce(mo.amount, 0)
            )
            order by s.m
        ),
        '[]'::jsonb
    )
      into v_result
      from series s
      left join monthly mo
        on mo.ym = to_char(s.m at time zone 'UTC', 'YYYY-MM');

    return v_result;
end;
$function$
;
comment on function read_dashboard_revenue_by_month(date, date) is 'T-590 (E7A-1): the window-anchored revenue month buckets — the buildWindowAnchoredBuckets contract server-side (UTC midnight bounds, exclusive end, max 24 buckets, empty months honest-zero). Labels stay client-side.';

-- ── 3. read_dashboard_debt_aging ───────────────────────────────────────
-- The per-installment aging buckets over the year window: only past-due
-- rows with a REAL remaining balance age (DATA-046); daysOverdue = whole
-- days from the due date to the as-of day (daysBetweenFloor); the bucket
-- edges are agingBucketFromDays (≤30 / ≤60 / ≤90 / ≤180 / >180). Per bucket:
-- the Σ remaining + the DISTINCT debtor count.
create or replace function public.read_dashboard_debt_aging(
    p_academic_year text,
    p_as_of date default null
)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
    v_tenant uuid;
    v_year_start int;
    v_debt_from date;
    v_debt_to date;
    v_as_of date := coalesce(p_as_of, current_date);
    v_result jsonb;
begin
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: debt aging is a staff surface';
    end if;
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    v_year_start := public.academic_year_start(p_academic_year);
    if v_year_start is not null then
        v_debt_from := make_date(v_year_start, 9, 1);
        v_debt_to := make_date(v_year_start + 1, 9, 1);
    end if;

    with aging as (
        select i.parent_id,
               greatest(0, i.amount_due - i.amount_paid - i.amount_pending) as remaining,
               extract(days from ((v_as_of::timestamptz) - ((i.due_date::text || 'T00:00:00Z')::timestamptz)))::int as days_overdue
          from public.installments i
         where i.tenant_id = v_tenant
           and i.status <> 'paid'
           and greatest(0, i.amount_due - i.amount_paid - i.amount_pending) > 0
           and i.due_date < v_as_of
           and (v_debt_from is null or (i.due_date >= v_debt_from and i.due_date < v_debt_to))
    ),
    bucketed as (
        select parent_id, remaining,
               case when days_overdue <= 30 then '0_30'
                    when days_overdue <= 60 then '31_60'
                    when days_overdue <= 90 then '61_90'
                    when days_overdue <= 180 then '91_180'
                    else '180_plus' end as bucket
          from aging
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'bucket', b.bucket,
                'amount', b.amount,
                'debtorCount', b.debtor_count
            )
            order by b.sort_key
        ),
        '[]'::jsonb
    )
      into v_result
      from (
        select bucket,
               sum(remaining) as amount,
               count(distinct parent_id) as debtor_count
          from bucketed
         group by bucket
      ) b
      join (values ('0_30', 1), ('31_60', 2), ('61_90', 3), ('91_180', 4), ('180_plus', 5)) as k(bucket, sort_key)
        on k.bucket = b.bucket;

    -- Empty buckets are honest zeros (the client renders every bucket row).
    if v_result is null then
        v_result := '[]'::jsonb;
    end if;

    return v_result;
end;
$function$
;
comment on function read_dashboard_debt_aging(text, date) is 'T-590 (E7A-1): the per-installment aging aggregation — past-due remaining rows only (DATA-046), the daysBetweenFloor/agingBucketFromDays edges, per-bucket distinct debtor counts. The AGING CONVENTION header of 0002 documents the min(due_date) anchor reconciliation (0111 max vs 0123 min).';

-- ── 4. read_dashboard_demographics ─────────────────────────────────────
-- The compact census: per-class student counts (+ the class's grade_code),
-- the unassigned-by-enrolled-level counts (+ the truly-unknown count), the
-- gender counts, and the age-bucket counts (years = as-of year − birth
-- year — the client convention; NULL and the 2000-01-01 import placeholder
-- are "Non renseigné", DATA-018). The French label mapping stays client
-- side (GRADE_LEVEL_LABELS_FR — the parity suite pins the same mapping).
create or replace function public.read_dashboard_demographics(
    p_as_of date default null
)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
    v_tenant uuid;
    v_as_of date := coalesce(p_as_of, current_date);
    v_year int := extract(year from v_as_of)::int;
    v_result jsonb;
begin
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: demographics are a staff surface';
    end if;
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    select jsonb_build_object(
        'classes', coalesce((
            select jsonb_agg(jsonb_build_object(
                    'class_id', c.id,
                    'class_name', c.name,
                    'grade_code', c.grade_code,
                    'student_count', count(s.id)
                ) order by c.name)
              from public.classes c
              left join public.students s
                on s.class_id = c.id
               and s.tenant_id = v_tenant
               and s.deleted_at is null
             where c.tenant_id = v_tenant
        ), '[]'::jsonb),
        'unassignedByLevel', coalesce((
            select jsonb_agg(jsonb_build_object(
                    'grade_level_code', s.grade_level_code,
                    'count', count(*)
                ) order by s.grade_level_code)
              from public.students s
             where s.tenant_id = v_tenant
               and s.deleted_at is null
               and s.class_id is null
               and s.grade_level_code is not null
             group by s.grade_level_code
        ), '[]'::jsonb),
        'unassignedUnknown', (
            select count(*)
              from public.students s
             where s.tenant_id = v_tenant
               and s.deleted_at is null
               and s.class_id is null
               and s.grade_level_code is null
        ),
        'gender', (
            select jsonb_build_object(
                'male', count(*) filter (where s.gender = 'male'),
                'female', count(*) filter (where s.gender = 'female'),
                'unspecified', count(*) filter (where s.gender is null or s.gender not in ('male', 'female'))
            )
              from public.students s
             where s.tenant_id = v_tenant
               and s.deleted_at is null
        ),
        'ageBuckets', coalesce((
            select jsonb_agg(jsonb_build_object(
                    'min', k.min_years,
                    'max', k.max_years,
                    'count', k.cnt
                ) order by k.sort_key)
              from (
                select e.min_years, e.max_years, e.sort_key, count(*) as cnt
                  from public.students s
                  join (values (0, 5, 1), (6, 8, 2), (9, 11, 3), (12, 14, 4), (15, 17, 5), (18, 120, 6)) as e(min_years, max_years, sort_key)
                    on (v_year - extract(year from s.date_of_birth)::int) between e.min_years and e.max_years
                 where s.tenant_id = v_tenant
                   and s.deleted_at is null
                   and s.date_of_birth is not null
                   and to_char(s.date_of_birth, 'YYYY-MM-DD') <> '2000-01-01'
                 group by e.min_years, e.max_years, e.sort_key
              ) k
        ), '[]'::jsonb),
        'unknownBirthDate', (
            select count(*)
              from public.students s
             where s.tenant_id = v_tenant
               and s.deleted_at is null
               and (s.date_of_birth is null
                    or to_char(s.date_of_birth, 'YYYY-MM-DD') = '2000-01-01')
        )
    ) into v_result;

    return v_result;
end;
$function$
;
comment on function read_dashboard_demographics(date) is 'T-590 (E7A-1): the compact demographics census — per-class counts, unassigned-by-level, gender, age buckets (the year-minus-year convention; the 2000-01-01 placeholder is Non renseigné per DATA-018). Labels map client-side.';

-- ── 5. The mv_grade_summary UNIQUE INDEX (the REFRESH CONCURRENTLY
--    precondition — S26 audit: still absent in 0001; 0041 dropped 0021's
--    index with the matview and never restored it; the other four matviews
--    carry theirs) ─────────────────────────────────────────────────────
-- subject_id and coefficient are functionally dependent on class_subject_id
-- through the class_subjects join, so (tenant_id, student_id,
-- class_subject_id) is a valid unique key for the grouped matview.
create unique index uq_mv_grade_summary
    on public.mv_grade_summary (tenant_id, student_id, class_subject_id);

-- ── 6. The widened refresh whitelist ────────────────────────────────────
-- refresh_all_materialized_views already refreshes mv_grade_summary; the
-- single-view gate (0021/0034's four canonical names) was the outlier the
-- S26 audit flagged. The whitelist now carries the five matviews.
create or replace function public.refresh_materialized_view(p_name text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
AS $function$
BEGIN
    -- Refresh a single canonical materialized view by name. Returns TRUE on
    -- success. T-590 widened the canonical set to include mv_grade_summary
    -- (its unique index — the REFRESH CONCURRENTLY precondition — lands in
    -- this migration). Other names raise to prevent arbitrary refreshes.
    IF p_name NOT IN ('mv_dashboard_kpis', 'mv_debt_aging', 'mv_top_debtors',
                      'mv_revenue_by_month', 'mv_grade_summary') THEN
        RAISE EXCEPTION 'Cannot refresh unknown materialized view: %', p_name;
    END IF;
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', p_name);
    RETURN TRUE;
END;
$function$
;
comment on function refresh_materialized_view(text) is 'Refresh a single canonical materialized view by name. Allowed names (T-590 widening): mv_dashboard_kpis, mv_debt_aging, mv_top_debtors, mv_revenue_by_month, mv_grade_summary. Used by the refresh-materialized-views Edge Function per-view fallback.';
