-- 0126_rls_initplan_hoist_and_read_perf.sql
-- ============================================================================
-- T-432 (PERF-509, the 111th-session live 500-storm report) — two read-path
-- performance families, ONE migration (append-only per ADR-001; no earlier
-- migration is edited):
--
--   (1) THE RLS INITPLAN HOIST — the hot SELECT policies wrap their
--       SECURITY DEFINER helper calls in scalar subqueries:
--           tenant_id = (select public.current_tenant_id())
--           (select public.has_any_role(array[...]))
--       The helpers are STABLE but SECURITY DEFINER, so Postgres CANNOT
--       inline them — pre-0126 every ROW re-executed current_tenant_id()
--       (a user_profiles subselect + JWT parse) and has_any_role()
--       (current_user_roles(): user_profiles + roles join) — the 6.5–19.9 s
--       direct-read class T-422 measured live at 80–90% success with 57014
--       statement-timeout hard-fails. The (select …) wrapper turns each
--       helper into an InitPlan: evaluated ONCE per statement, then compared
--       row-wise (the documented Postgres RLS pattern — "Improving Postgres
--       RLS performance", supabase/blog#213 and the Postgres docs' RLS
--       performance notes). Semantics are IDENTICAL: NULL tenant still
--       filters every row (tenant_id = NULL → NULL), roles still gate the
--       same branches, the parent/student self-scope subqueries are
--       untouched verbatim.
--
--       SCOPE: the 15 SELECT policies the desktop boot storm hammers
--       (students, parents, installments, payments, ledger_entries,
--       personnel, expense_tickets, attendance_records, calendar_events,
--       audit_logs ×2, academic_years, classes, academic_levels, subjects).
--       Write policies, portal self-policies and the admin FOR ALL policies
--       are deliberately UNTOUCHED (write paths are low-volume; this
--       migration is a read-path fix).
--
--   (2) THE DEBT-AGING ATTRIBUTION MATERIALIZATION —
--       compute_debt_aging_rows (0111's factor engine, same contract) now
--       materializes the tenant's academic_years windows ONCE (the `ay`
--       CTE) and attributes dates with an inlined scalar subquery over that
--       tiny CTE. Pre-0126 it invoked the SECURITY DEFINER
--       attribute_academic_year() per obligation row, per payment row and
--       per parent row (~6–8k function invocations on live data, each an
--       index scan on academic_years + search_path setup) — under the boot
--       storm's concurrent load that crossed the statement timeout
--       (the owner's live report: "[SupabaseDebt] seedAging failed:
--       canceling statement due to statement timeout"). The attribution
--       RULE is byte-identical (the known academic_years window first —
--       latest start wins — then the Jul 1–Jun 30 Algerian school-year
--       convention, INV-14); scripts/verify_t-405.sql pins the outputs.
--
--   (3) THREE MISSING READ INDEXES:
--       * students (tenant_id, parent_id) — read_debt_summary_collection's
--         per-parent student_count subquery (0123) deliberately has NO
--         deleted_at filter (bit-parity with the display), so the partial
--         students_parent_idx (WHERE deleted_at IS NULL) could not serve
--         it: 634 debtors × seq-scan nested loop.
--       * attendance_records (tenant_id, date) — the dashboard KPI's
--         today-attendance read filtered tenant+date with NO usable index
--         ((tenant_id, status, date) requires status; the BRIN/unique
--         indexes lead elsewhere) — a full scan per KPI refresh.
--       * expense_tickets (tenant_id, submitted_at desc) — the calendar
--         repository's latest-300 expenses read (tenant + order by
--         submitted_at, NO status filter) could not use
--         expense_tickets_tenant_status_idx (status leads).
--
-- Registration: the T-091/MIG-TOKENS embedded block (atomic with the DDL
-- for the Management-API live application; idempotent via ON CONFLICT).
-- ============================================================================
-- WHY NOT a compute-size change: the read storm is client-amplified (the
-- same collections re-read by 3 surfaces at boot, each read re-executing
-- the per-row policy chain). The client half of T-432 (the in-flight RPC
-- dedupe + the calendar RPC-first read) lands in the desktop repo in the
-- same session; this migration is the server half.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE RLS INITPLAN HOIST — CRM + financial read path
-- ----------------------------------------------------------------------------
drop policy if exists parents_select on public.parents;
create policy parents_select on public.parents
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and deleted_at is null
        and (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager']))
    );

comment on policy parents_select on public.parents is
    'T-432 (PERF-509): the 0083 administrative-only shape with the InitPlan hoist — the SECURITY DEFINER helpers evaluate ONCE per statement (the scalar-subquery wrapper), not per row.';

drop policy if exists students_select on public.students;
create policy students_select on public.students
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and deleted_at is null
        and (
            (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager']))
            or (
                (select public.has_role('teacher'))
                and (
                    exists (
                        select 1
                          from public.classes c
                         where c.id = students.class_id
                           and c.homeroom_teacher_id in (
                               select p.id
                                 from public.personnel p
                                where p.user_id = public.current_user_profile_id()
                                  and p.deleted_at is null
                           )
                    )
                    or exists (
                        select 1
                          from public.class_subjects cs
                         where cs.class_id = students.class_id
                           and cs.teacher_id in (
                               select p.id
                                 from public.personnel p
                                where p.user_id = public.current_user_profile_id()
                                  and p.deleted_at is null
                           )
                    )
                )
            )
        )
    );

comment on policy students_select on public.students is
    'T-432 (PERF-509): the 0083 teacher-scoped shape (RBAC-302) with the InitPlan hoist on every SECURITY DEFINER helper call — same row visibility, once-per-statement evaluation.';

drop policy if exists installments_select on public.installments;
create policy installments_select on public.installments
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and (
            (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']))
            or ((select public.has_role('parent')) and parent_id in (
                select id from public.parents where auth_user_id = auth.uid() and deleted_at is null
            ))
        )
    );

comment on policy installments_select on public.installments is
    'T-432 (PERF-509): the 0019 staff/parent shape with the InitPlan hoist (helpers once per statement); the parent self-scope subquery is untouched verbatim.';

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and (
            (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']))
            or ((select public.has_role('parent')) and parent_id in (
                select id from public.parents where auth_user_id = auth.uid() and deleted_at is null
            ))
        )
    );

comment on policy payments_select on public.payments is
    'T-432 (PERF-509): the 0019 staff/parent shape with the InitPlan hoist — the calendar and finance direct reads of payments were the 6.5–19.9 s live-measured class.';

drop policy if exists ledger_entries_select on public.ledger_entries;
create policy ledger_entries_select on public.ledger_entries
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and (
            (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']))
            or ((select public.has_role('parent')) and parent_id in (
                select id from public.parents where auth_user_id = auth.uid() and deleted_at is null
            ))
        )
    );

comment on policy ledger_entries_select on public.ledger_entries is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist (the ledger keyset fallback read).';

-- ----------------------------------------------------------------------------
-- 2. THE RLS INITPLAN HOIST — workforce / operations / dashboard read path
-- ----------------------------------------------------------------------------
drop policy if exists personnel_select on public.personnel;
create policy personnel_select on public.personnel
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and deleted_at is null
        and (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager',
                                  'teacher', 'buyer', 'driver', 'warehouse_worker', 'worker']))
    );

comment on policy personnel_select on public.personnel is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist — the dashboard KPI personnel count.';

drop policy if exists expense_tickets_select on public.expense_tickets;
create policy expense_tickets_select on public.expense_tickets
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and (
            (select public.has_any_role(array['super_admin', 'financial_officer', 'manager']))
            or submitted_by = (select public.current_user_profile_id())
        )
    );

comment on policy expense_tickets_select on public.expense_tickets is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist — the KPI pending-expense count + the calendar expense milestones.';

drop policy if exists attendance_select on public.attendance_records;
create policy attendance_select on public.attendance_records
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'manager', 'parent', 'student']))
    );

comment on policy attendance_select on public.attendance_records is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist — the KPI today-attendance read (now index-backed too, section 5).';

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and is_deleted = false
        and (select public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'manager',
                                  'teacher', 'buyer', 'driver', 'warehouse_worker', 'worker']))
    );

comment on policy calendar_events_select on public.calendar_events is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist — the Agenda month-bucket read.';

drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and (select public.has_any_role(array['super_admin', 'financial_officer']))
    );

comment on policy audit_logs_select_admin on public.audit_logs is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist — the calendar audit-activity read.';

drop policy if exists audit_logs_select_own on public.audit_logs;
create policy audit_logs_select_own on public.audit_logs
    for select to authenticated
    using (
        tenant_id = (select public.current_tenant_id())
        and actor_id = (select public.current_user_profile_id())
    );

comment on policy audit_logs_select_own on public.audit_logs is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist.';

-- ----------------------------------------------------------------------------
-- 3. THE RLS INITPLAN HOIST — academic reference read path
-- ----------------------------------------------------------------------------
drop policy if exists academic_years_select on public.academic_years;
create policy academic_years_select on public.academic_years
    for select to authenticated
    using (tenant_id = (select public.current_tenant_id()));

comment on policy academic_years_select on public.academic_years is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist — the year selectors + compute_debt_aging_rows attribution source.';

drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes
    for select to authenticated
    using (tenant_id = (select public.current_tenant_id()));

comment on policy classes_select on public.classes is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist — the dashboard demographics + analytics classes read.';

drop policy if exists academic_levels_select on public.academic_levels;
create policy academic_levels_select on public.academic_levels
    for select to authenticated
    using (tenant_id = (select public.current_tenant_id()));

comment on policy academic_levels_select on public.academic_levels is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist.';

drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects
    for select to authenticated
    using (tenant_id = (select public.current_tenant_id()));

comment on policy subjects_select on public.subjects is
    'T-432 (PERF-509): the 0019 shape with the InitPlan hoist — the analytics subjects read.';

-- ----------------------------------------------------------------------------
-- 4. THE DEBT-AGING ATTRIBUTION MATERIALIZATION (compute_debt_aging_rows)
--    Same signature, same columns, same 0125 wrapper consumption — ONLY the
--    internal academic-year attribution changes shape (materialized once,
--    same rule). 0111's file is never edited (ADR-001): this is the
--    create-or-replace-in-a-new-migration pattern 0125 established.
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
    -- T-432: the tenant's academic-year windows, materialized ONCE. When
    -- p_tenant_id IS NULL (the matview's all-tenants usage) the CTE carries
    -- EVERY tenant's windows and the attribution subqueries correlate on the
    -- row's own tenant_id — the exact semantics attribute_academic_year
    -- applied per call (its WHERE tenant_id = <row tenant> matched nothing
    -- when NULL was passed, matching this CTE's null-tenant behaviour).
    with ay as (
        select ayw.tenant_id, ayw.label, ayw.start_date, ayw.end_date
          from public.academic_years ayw
         where p_tenant_id is null or ayw.tenant_id = p_tenant_id
    ),
    oblig as (
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
               -- T-432 (attribute_academic_year's rule, inlined over the
               -- materialized windows; the Jul 1–Jun 30 convention is the
               -- fallback exactly as in 0111/INV-14):
               coalesce(
                   (select a.label
                      from ay a
                     where a.tenant_id = pp.tenant_id
                       and pp.oldest_due_date between a.start_date and a.end_date
                     order by a.start_date desc
                     limit 1),
                   case
                       when extract(month from pp.oldest_due_date) >= 7 then
                           extract(year from pp.oldest_due_date)::int::text || '-' || (extract(year from pp.oldest_due_date)::int + 1)::text
                       else
                           (extract(year from pp.oldest_due_date)::int - 1)::text || '-' || extract(year from pp.oldest_due_date)::int::text
                   end
               ) as origin_academic_year
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
           -- T-432 parity note: the attribution is keyed on a.tenant_id (the
           -- ATTRIBUTED parent's tenant) exactly as 0111 keyed
           -- attribute_academic_year((ps.entry_date ...)::date, a.tenant_id);
           -- the materialized ay CTE replaces only the per-row function
           -- invocation, never the keying.
           and public.academic_year_start(
                   coalesce(
                       (select ay2.label
                          from ay ay2
                         where ay2.tenant_id = a.tenant_id
                           and (ps.entry_date at time zone 'UTC')::date between ay2.start_date and ay2.end_date
                         order by ay2.start_date desc
                         limit 1),
                       case
                           when extract(month from (ps.entry_date at time zone 'UTC')::date) >= 7 then
                               extract(year from (ps.entry_date at time zone 'UTC')::date)::int::text || '-' || (extract(year from (ps.entry_date at time zone 'UTC')::date)::int + 1)::text
                           else
                               (extract(year from (ps.entry_date at time zone 'UTC')::date)::int - 1)::text || '-' || extract(year from (ps.entry_date at time zone 'UTC')::date)::int::text
                       end
                   )
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
                       -- T-432: the same inlined attribution rule.
                       'academicYear', coalesce(
                           (select ay3.label
                              from ay ay3
                             where ay3.tenant_id = o.tenant_id
                               and o.due_date between ay3.start_date and ay3.end_date
                             order by ay3.start_date desc
                             limit 1),
                           case
                               when extract(month from o.due_date) >= 7 then
                                   extract(year from o.due_date)::int::text || '-' || (extract(year from o.due_date)::int + 1)::text
                               else
                                   (extract(year from o.due_date)::int - 1)::text || '-' || extract(year from o.due_date)::int::text
                           end
                       ),
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
        -- ── The ordered INV-16 evaluation (mirrors the TS engine exactly).
        --    Pre-T-429 labels; the 0125 wrapper overrides these two columns
        --    with the configurable 4-tier hierarchy (0111's factors are the
        --    canonical inputs — the wrapper discards these status values). ──
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
    'T-405 + T-432: the single cross-year debt-aging computation — installments (INV-4 remaining) + non-reversed payment ledger entries + academic-year attribution (INV-14, now materialized once per query instead of a SECURITY DEFINER call per row) → the ordered INV-16 status. Ungated internal (owner-only); use compute_debt_aging_summary from clients.';

-- ----------------------------------------------------------------------------
-- 5. THE THREE MISSING READ INDEXES
-- ----------------------------------------------------------------------------
-- read_debt_summary_collection's per-parent student_count (no deleted_at
-- filter — 0123's documented bit-parity): the partial students_parent_idx
-- (WHERE deleted_at IS NULL) cannot serve it.
create index if not exists ix_students_tenant_parent
    on public.students (tenant_id, parent_id);

comment on index public.ix_students_tenant_parent is
    'T-432 (PERF-509): the per-parent student count over ALL rows (read_debt_summary_collection bit-parity — no deleted_at filter) + the CRM parent drilldown.';

-- The dashboard KPI's today-attendance read (tenant + date): no existing
-- index leads with both.
create index if not exists ix_attendance_tenant_date
    on public.attendance_records (tenant_id, date);

comment on index public.ix_attendance_tenant_date is
    'T-432 (PERF-509): the KPI today-attendance read (tenant_id + date) — previously a full scan per KPI refresh.';

-- The calendar repository's latest-300 expenses read (tenant + submitted_at
-- desc, NO status filter — expense_tickets_tenant_status_idx leads with
-- status).
create index if not exists ix_expense_tickets_tenant_submitted
    on public.expense_tickets (tenant_id, submitted_at desc);

comment on index public.ix_expense_tickets_tenant_submitted is
    'T-432 (PERF-509): the calendar expense-milestones read (tenant + submitted_at desc).';

-- ----------------------------------------------------------------------------
-- 6. Registration (T-091/MIG-TOKENS — atomic with the DDL for the
--    Management-API live application; idempotent via ON CONFLICT)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0126', '{0126_rls_initplan_hoist_and_read_perf.sql}', 'rls_initplan_hoist_and_read_perf')
on conflict (version) do nothing;
