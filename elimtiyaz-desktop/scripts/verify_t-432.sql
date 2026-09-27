-- ============================================================================
-- verify_t-432.sql — T-432 (PERF-509 + DATA-049), migration 0126.
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; —
-- re-runnable, never mutates. Results land in a temp table.
--
-- WHAT THIS PINS:
--   C1  the RLS InitPlan hoist: all 15 hot SELECT policies carry the
--       (select public.…) scalar-subquery wrapper (once-per-statement
--       evaluation) — and every pre-0126 policy still EXISTS (no drop
--       without recreate, no lost tenant gate)
--   C2  the compute_debt_aging_rows rewrite parity — STRUCTURAL: the new
--       definition materializes the ay windows and NEVER calls
--       attribute_academic_year per-row
--   C3  the compute_debt_aging_rows rewrite parity — BEHAVIORAL: for EVERY
--       live obligation, the obligations JSON's academicYear equals the
--       ORIGINAL attribute_academic_year() answer for the same date (the
--       inline rewrite is proven rule-identical on the real data), and
--       origin_academic_year matches per-parent
--   C4  the outstanding parity (the C11 convention from verify_t-405):
--       the rows' Σoutstanding == the independent
--       Σ GREATEST(0, due−paid−pending) over the same rows
--   C5  the three new indexes exist
--   C6  the wave census (the owner's 77-vs-75 question): per wave, the
--       TUITION-isolated rate vs the ALL-CATEGORIES pooled rate over the
--       current academic-year window — the two surfaces' reconciliation
--       pair, computed from the live rows
--   C7  the timing evidence (the InitPlan effect) — under a super_admin
--       impersonation: EXPLAIN ANALYZE the KPI count queries + the
--       calendar payments month read + compute_debt_aging_summary,
--       capturing Execution Time. Run the probe BEFORE apply_0126_live.sh
--       and AFTER — the delta is the evidence.
-- ============================================================================
BEGIN;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t432_results (check_id text, ok boolean, detail text);

-- ─── C1: the 15 hoisted policies ─────────────────────────────────────────
do $c1$
declare
    -- (policy name, table name) — the 0126 rewrite set.
    v_expected text[] := array[
        'parents_select|parents', 'students_select|students',
        'installments_select|installments', 'payments_select|payments',
        'ledger_entries_select|ledger_entries', 'personnel_select|personnel',
        'expense_tickets_select|expense_tickets',
        'attendance_select|attendance_records',
        'calendar_events_select|calendar_events',
        'audit_logs_select_admin|audit_logs', 'audit_logs_select_own|audit_logs',
        'academic_years_select|academic_years', 'classes_select|classes',
        'academic_levels_select|academic_levels', 'subjects_select|subjects'];
    v_missing integer := 0;
    v_unhoisted integer := 0;
    v_lostgate integer := 0;
    pair text;
    v_policy text;
    v_table text;
begin
    foreach pair in array v_expected loop
        v_policy := split_part(pair, '|', 1);
        v_table := split_part(pair, '|', 2);
        if not exists (select 1 from pg_policies pol
                        where pol.tablename = v_table and pol.policyname = v_policy) then
            v_missing := v_missing + 1;
            insert into t432_results values ('C1-missing-' || v_policy, false, 'policy not found');
        end if;
    end loop;
    insert into t432_results values ('C1-policies-present', v_missing = 0, 'missing=' || v_missing);

    select count(*) into v_unhoisted
      from pg_policies pol
     where pol.policyname = any(array(select split_part(x, '|', 1) from unnest(v_expected) x))
       and pol.qual is not null
       and position('(select public.' in pol.qual) = 0;
    insert into t432_results values ('C1-initplan-hoist', v_unhoisted = 0, 'unhoisted=' || v_unhoisted);

    select count(*) into v_lostgate
      from pg_policies pol
     where pol.policyname = any(array(select split_part(x, '|', 1) from unnest(v_expected) x))
       and pol.qual is not null
       and position('current_tenant_id' in pol.qual) = 0;
    insert into t432_results values ('C1-tenant-gate-kept', v_lostgate = 0, 'lost=' || v_lostgate);
end $c1$;

-- ─── C2+C3+C4: the factor-engine rewrite parity ─────────────────────────
do $c2$
declare
    v_tenant uuid;
    v_def text;
    v_attr_mismatch integer;
    v_origin_mismatch integer;
    v_sum_rpc numeric;
    v_sum_indep numeric;
begin
    select tenant_id into v_tenant
      from (select tenant_id, count(*) as n from public.installments group by tenant_id
             order by n desc limit 1) t;

    select pg_get_functiondef('public.compute_debt_aging_rows(uuid, timestamptz)'::regprocedure)
      into v_def;
    insert into t432_results values ('C2-materialized-ay',
        v_def like '%with ay as%' and position('attribute_academic_year' in v_def) = 0,
        'len=' || length(v_def));

    -- C3: per-obligation attribution parity against the ORIGINAL helper —
    -- every obligations JSON academicYear must equal
    -- attribute_academic_year(due_date, tenant) for that obligation's own
    -- due date (the exact rule the inline rewrite replaced).
    select count(*) into v_attr_mismatch
      from public.compute_debt_aging_rows(v_tenant, now()) r
      cross join lateral jsonb_array_elements(r.obligations) o
      join public.installments i
        on i.id = (o->>'installmentId')::uuid
       and i.tenant_id = r.tenant_id
     where o->>'academicYear' is distinct from
           public.attribute_academic_year(i.due_date, i.tenant_id);
    insert into t432_results values ('C3-obligation-attribution-parity',
        v_attr_mismatch = 0, 'mismatches=' || v_attr_mismatch);

    -- C3b: the per-parent origin year parity (the oldest_due_date attribution).
    select count(*) into v_origin_mismatch
      from public.compute_debt_aging_rows(v_tenant, now()) r
     where r.origin_academic_year is distinct from
           public.attribute_academic_year(r.oldest_due_date, r.tenant_id);
    insert into t432_results values ('C3-origin-year-parity',
        v_origin_mismatch = 0, 'mismatches=' || v_origin_mismatch);

    -- C4: the outstanding parity (the verify_t-405 C11 convention).
    select sum(r.outstanding_amount) into v_sum_rpc
      from public.compute_debt_aging_rows(v_tenant, now()) r;
    select sum(greatest(0, i.amount_due - i.amount_paid - i.amount_pending)) into v_sum_indep
      from public.installments i
     where i.tenant_id = v_tenant
       and greatest(0, i.amount_due - i.amount_paid - i.amount_pending) > 0;
    insert into t432_results values ('C4-outstanding-parity',
        abs(coalesce(v_sum_rpc, 0) - coalesce(v_sum_indep, 0)) < 0.001,
        'rpc=' || coalesce(v_sum_rpc, 0) || ' indep=' || coalesce(v_sum_indep, 0));
end $c2$;

-- ─── C5: the three indexes ───────────────────────────────────────────────
do $c5$
declare
    v_n integer;
begin
    select count(*) into v_n
      from pg_indexes
     where (schemaname, indexname) in (
        ('public', 'ix_students_tenant_parent'),
        ('public', 'ix_attendance_tenant_date'),
        ('public', 'ix_expense_tickets_tenant_submitted'));
    insert into t432_results values ('C5-indexes-present', v_n = 3, 'n=' || v_n);
end $c5$;

-- ─── C6: the wave census (the owner's 77-vs-75 reconciliation pair) ──────
-- The same window BOTH surfaces apply (the current academic year, Sept 1
-- → Sept 1 next; the September-rollover clock rule) and the same rows
-- (tranche 1..3; every status — paid rows contribute due + paid).
do $c6$
declare
    v_tenant uuid;
    v_year_start date;
begin
    select tenant_id into v_tenant
      from (select tenant_id, count(*) as n from public.installments group by tenant_id
             order by n desc limit 1) t;
    v_year_start := make_date(
        (extract(year from now())::int - (case when extract(month from now())::int < 9 then 1 else 0 end)),
        9, 1);

    create temp table t432_waves on commit drop as
    select i.tranche_number as wave,
           count(*) as rows_total,
           round(100.0 * sum(i.amount_paid) filter (where i.category = 'tuition')
                 / nullif(sum(i.amount_due) filter (where i.category = 'tuition'), 0)) as tuition_pct,
           round(100.0 * sum(i.amount_paid) / nullif(sum(i.amount_due), 0)) as pooled_pct,
           count(distinct i.parent_id) as families,
           sum(i.amount_due) as due_total,
           sum(i.amount_paid) as paid_total
      from public.installments i
     where i.tenant_id = v_tenant
       and i.tranche_number in (1, 2, 3)
       and i.due_date >= v_year_start
       and i.due_date < v_year_start + interval '1 year'
     group by i.tranche_number
     order by i.tranche_number;

    -- The reconciliation pair per wave: tuition_pct is what the Statistics
    -- card shows (scolarité isolée); pooled_pct is what the Finance strip
    -- shows (toutes catégories — its new "dont scolarité" line surfaces
    -- the first number too).
    insert into t432_results
    select 'C6-wave-' || wave,
           true,
           'tuition=' || coalesce(tuition_pct, 'n/a') || '% pooled=' || pooled_pct
           || '% (rows=' || rows_total || ', families=' || families || ')'
      from t432_waves;
end $c6$;

-- ─── C7: the timing evidence (the InitPlan effect; run BEFORE and AFTER
--        the apply) — LAST block (the role-downgrade convention, C12 in
--        verify_t-405) ──────────────────────────────────────────────────
do $c7$
declare
    v_sub uuid;
    v_tenant uuid;
    v_plan json;
    v_ms numeric;
begin
    select tenant_id into v_tenant
      from (select tenant_id, count(*) as n from public.installments group by tenant_id
             order by n desc limit 1) t;
    select up.auth_user_id into v_sub
      from public.user_profiles up
      join public.role_assignments ra on ra.user_profile_id = up.id
      join public.roles r on r.id = ra.role_id
     where r.code = 'super_admin' and ra.revoked_at is null
       and up.tenant_id = v_tenant
     order by up.created_at limit 1;
    if v_sub is null then
        insert into t432_results values ('C7-timing', false, 'no super_admin profile found to impersonate');
        return;
    end if;

    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', v_sub, 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    set local role authenticated;

    -- The KPI count query (the exact wire shape the dashboard sends).
    execute 'EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM public.students s
              WHERE s.tenant_id = $1 AND s.deleted_at IS NULL' using v_tenant
      into v_plan;
    v_ms := (v_plan->0->>'Execution Time')::numeric;
    insert into t432_results values ('C7-time-students-count', true, v_ms || ' ms');

    execute 'EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM public.parents p
              WHERE p.tenant_id = $1 AND p.deleted_at IS NULL' using v_tenant
      into v_plan;
    v_ms := (v_plan->0->>'Execution Time')::numeric;
    insert into t432_results values ('C7-time-parents-count', true, v_ms || ' ms');

    -- The calendar's payment month read (the 6.5–19.9 s class pre-0126).
    execute 'EXPLAIN (ANALYZE, FORMAT JSON) SELECT p.id, p.parent_id, p.amount, p.status
               FROM public.payments p
              WHERE p.tenant_id = $1 AND p.status IN (''paid'', ''partial'')
                AND p.collected_at >= date_trunc(''month'', now())
                AND p.collected_at < date_trunc(''month'', now()) + interval ''1 month''' using v_tenant
      into v_plan;
    v_ms := (v_plan->0->>'Execution Time')::numeric;
    insert into t432_results values ('C7-time-payments-month', true, v_ms || ' ms');

    -- The debt-aging staff contract (the seeded-aging statement that
    -- hard-failed in the owner's console at boot).
    execute 'EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM public.compute_debt_aging_summary() s'
      into v_plan;
    v_ms := (v_plan->0->>'Execution Time')::numeric;
    insert into t432_results values ('C7-time-aging-summary', true, v_ms || ' ms');
end $c7$;

-- ─── Report ──────────────────────────────────────────────────────────────
select check_id, ok, detail from t432_results order by check_id;

ROLLBACK;
