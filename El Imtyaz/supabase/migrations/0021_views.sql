-- ============================================================================
-- 0021_views.sql
-- ============================================================================
-- Materialized and regular views for dashboard queries.
-- Materialized views have UNIQUE indexes for concurrent refresh.
-- Regular views are computed on-demand.
-- ============================================================================

-- ============================================================================
-- 1. mv_dashboard_kpis — aggregated KPIs per tenant (materialized)
-- ============================================================================
create materialized view public.mv_dashboard_kpis as
    select
        t.id as tenant_id,
        t.name as tenant_name,
        (select count(*) from public.students s where s.tenant_id = t.id and s.deleted_at is null and s.is_active = true) as total_students,
        (select count(*) from public.parents p where p.tenant_id = t.id and p.deleted_at is null and p.is_active = true) as total_parents,
        (select count(*) from public.classes c where c.tenant_id = t.id and c.is_active = true) as total_classes,
        (select count(*) from public.personnel per where per.tenant_id = t.id and per.deleted_at is null and per.is_active = true) as total_personnel,
        (
            select coalesce(sum(pay.amount), 0)::numeric(14,2)
              from public.payments pay
             where pay.tenant_id = t.id
               and pay.status = 'paid'
               and pay.collected_at >= date_trunc('month', now())
        ) as monthly_revenue,
        (
            select coalesce(sum(le.amount), 0)::numeric(14,2)
              from public.ledger_entries le
             where le.tenant_id = t.id
        ) as outstanding_debt,
        (
            select count(*)
              from public.installments i
             where i.tenant_id = t.id
               and i.status in ('unpaid', 'partial', 'overdue')
               and i.due_date < current_date
        ) as overdue_count,
        case
            when (select coalesce(sum(amount), 0) from public.ledger_entries le where le.tenant_id = t.id and le.amount > 0) = 0 then 0
            else (
                (select coalesce(sum(abs(amount)), 0) from public.ledger_entries le where le.tenant_id = t.id and le.amount < 0)
                / nullif((select coalesce(sum(amount), 0) from public.ledger_entries le where le.tenant_id = t.id and le.amount > 0), 0)
            ) * 100
        end as collection_rate_pct
    from public.tenants t
    where t.deleted_at is null;

create unique index mv_dashboard_kpis_tenant_uidx on public.mv_dashboard_kpis (tenant_id);

comment on materialized view public.mv_dashboard_kpis is
  'Per-tenant KPI snapshot. Refreshed via public.refresh_all_materialized_views().';

-- ============================================================================
-- 2. mv_debt_aging — per-parent debt bucketed by aging tier
-- ============================================================================
create materialized view public.mv_debt_aging as
    select
        le.tenant_id,
        le.parent_id,
        p.last_name || ' ' || p.first_name as parent_name,
        case
            when (current_date - le.entry_date::date) <= 30 then '0-30'
            when (current_date - le.entry_date::date) <= 60 then '31-60'
            when (current_date - le.entry_date::date) <= 90 then '61-90'
            when (current_date - le.entry_date::date) <= 180 then '91-180'
            else '180+'
        end as aging_bucket,
        sum(le.amount)::numeric(12,2) as outstanding
    from public.ledger_entries le
    join public.parents p on p.id = le.parent_id
    where le.amount > 0  -- charges only
      and p.deleted_at is null
    group by le.tenant_id, le.parent_id, p.last_name, p.first_name, aging_bucket;

create unique index mv_debt_aging_uidx on public.mv_debt_aging (tenant_id, parent_id, aging_bucket);

comment on materialized view public.mv_debt_aging is
  'Per-parent outstanding debt bucketed by aging tier. Used by debt dashboard (plan §07.06).';

-- ============================================================================
-- 3. mv_top_debtors — top 20 families by outstanding amount
-- ============================================================================
create materialized view public.mv_top_debtors as
    select
        tenant_id,
        parent_id,
        parent_name,
        sum(outstanding)::numeric(12,2) as total_outstanding,
        rank() over (partition by tenant_id order by sum(outstanding) desc) as rank_in_tenant
    from public.mv_debt_aging
    group by tenant_id, parent_id, parent_name
    having sum(outstanding) > 0;

create unique index mv_top_debtors_uidx on public.mv_top_debtors (tenant_id, parent_id);

comment on materialized view public.mv_top_debtors is
  'Top 20 family debtors ranked by outstanding amount. Plan §07.06.';

-- ============================================================================
-- 4. mv_revenue_by_month — last 12 months of paid payments
-- ============================================================================
create materialized view public.mv_revenue_by_month as
    select
        tenant_id,
        date_trunc('month', collected_at)::date as month,
        sum(amount)::numeric(14,2) as revenue,
        count(*) as payment_count
    from public.payments
    where status = 'paid'
      and collected_at >= date_trunc('month', now()) - interval '11 months'
    group by tenant_id, month
    order by tenant_id, month;

create unique index mv_revenue_by_month_uidx on public.mv_revenue_by_month (tenant_id, month);

comment on materialized view public.mv_revenue_by_month is 'Last 12 months of paid payments per tenant.';

-- ============================================================================
-- 5. mv_grade_summary — per-student subject averages + overall GPA
-- ============================================================================
create materialized view public.mv_grade_summary as
    select
        g.tenant_id,
        g.student_id,
        g.class_subject_id,
        cs.subject_id,
        cs.coefficient,
        max(g.subject_average) as subject_average,
        max(g.subject_average) * cs.coefficient as weighted_score
    from public.grades g
    join public.class_subjects cs on cs.id = g.class_subject_id
    where g.subject_average is not null
    group by g.tenant_id, g.student_id, g.class_subject_id, cs.subject_id, cs.coefficient;

create unique index mv_grade_summary_uidx on public.mv_grade_summary (tenant_id, student_id, class_subject_id);

comment on materialized view public.mv_grade_summary is
  'Per-student subject averages pre-computed for GPA calculation. Refresh nightly.';

-- ============================================================================
-- 6. vw_revenue_by_category — payments grouped by service category
-- ============================================================================
create view public.vw_revenue_by_category as
    select
        pay.tenant_id,
        se.service_kind as category,
        sum(pay.amount)::numeric(14,2) as revenue,
        count(*) as payment_count
    from public.payments pay
    left join public.installments i on i.id = pay.installment_id
    left join public.service_enrollments se on se.id = i.service_enrollment_id
    where pay.status = 'paid'
    group by pay.tenant_id, se.service_kind;

comment on view public.vw_revenue_by_category is 'Paid payments grouped by service category (tuition, transport, etc.).';

-- ============================================================================
-- 7. vw_student_roster — joined student+parent+class for export
-- ============================================================================
create view public.vw_student_roster as
    select
        s.tenant_id,
        s.student_code,
        s.last_name || ' ' || s.first_name as student_name,
        s.date_of_birth,
        s.gender,
        s.enrollment_status,
        s.grade_level_id,
        al.cycle as academic_cycle,
        al.year_label as academic_level,
        c.code as class_code,
        c.name as class_name,
        p.parent_code,
        p.last_name || ' ' || p.first_name as parent_name,
        p.primary_phone,
        p.email as parent_email,
        p.relationship,
        p.address,
        p.city
    from public.students s
    left join public.parents p on p.id = s.parent_id
    left join public.classes c on c.id = s.class_id
    left join public.academic_levels al on al.id = s.grade_level_id
    where s.deleted_at is null;

comment on view public.vw_student_roster is 'Joined student+parent+class view for roster exports.';

-- ============================================================================
-- 8. vw_personnel_directory — public fields (no salary)
-- ============================================================================
create view public.vw_personnel_directory as
    select
        per.tenant_id,
        per.personnel_code,
        per.last_name || ' ' || per.first_name as full_name,
        per.staff_category,
        r.label_fr as role_label,
        d.name_fr as department_name,
        per.position,
        per.primary_phone,
        per.email,
        per.hire_date,
        per.is_active
    from public.personnel per
    left join public.roles r on r.id = per.role_id
    left join public.departments d on d.id = per.department_id
    where per.deleted_at is null;

comment on view public.vw_personnel_directory is
  'Personnel directory WITHOUT salary fields. Safe for general staff viewing.';

-- ============================================================================
-- 9. vw_personnel_directory_restricted — includes salary (RLS-gated)
-- ============================================================================
create view public.vw_personnel_directory_restricted as
    select
        per.tenant_id,
        per.personnel_code,
        per.last_name || ' ' || per.first_name as full_name,
        per.staff_category,
        r.label_fr as role_label,
        d.name_fr as department_name,
        per.position,
        per.primary_phone,
        per.email,
        per.hire_date,
        per.is_active,
        per.base_salary,
        per.payment_method,
        per.bank_account,
        per.bonuses_json
    from public.personnel per
    left join public.roles r on r.id = per.role_id
    left join public.departments d on d.id = per.department_id
    where per.deleted_at is null;

comment on view public.vw_personnel_directory_restricted is
  'Personnel directory WITH salary fields. RLS restricts to SuperAdmin + FinancialOfficer (plan §09.04).';

-- ============================================================================
-- 10. vw_audit_log_by_day — counts per day per action
-- ============================================================================
create view public.vw_audit_log_by_day as
    select
        tenant_id,
        occurred_at::date as day,
        action,
        count(*) as event_count
    from public.audit_logs
    group by tenant_id, day, action
    order by tenant_id, day desc, action;

comment on view public.vw_audit_log_by_day is 'Daily audit event counts per action code. Used for trend analysis.';

-- ============================================================================
-- 11. vw_calendar_events_derived — UNION manual + auto-derived events
-- ============================================================================
create view public.vw_calendar_events_derived as
    -- Manual events
    select
        tenant_id, kind, title, description, start_at, end_at, all_day, location,
        target_entity_type, target_entity_id, target_name, target_phone,
        'manual' as derivation_source, created_by, created_at
    from public.calendar_events
    where is_deleted = false

    union all

    -- Auto-derived from payments (kind = 'payment_received')
    select
        pay.tenant_id,
        'payment_received'::text as kind,
        'Paiement ' || pay.payment_number as title,
        pay.notes as description,
        pay.collected_at as start_at,
        pay.collected_at + interval '1 minute' as end_at,
        false as all_day,
        null::text as location,
        'payment'::text as target_entity_type,
        pay.id::uuid as target_entity_id,
        p.last_name || ' ' || p.first_name as target_name,
        p.primary_phone as target_phone,
        'system'::text as derivation_source,
        null::uuid as created_by,
        pay.created_at
    from public.payments pay
    join public.parents p on p.id = pay.parent_id
    where pay.status = 'paid'

    union all

    -- Auto-derived from expense_tickets (kind = 'expense_event')
    select
        et.tenant_id,
        'expense_event'::text as kind,
        'Dépense: ' || et.title as title,
        et.description,
        coalesce(et.disbursed_at, et.approved_at, et.submitted_at) as start_at,
        coalesce(et.disbursed_at, et.approved_at, et.submitted_at) + interval '1 minute' as end_at,
        false as all_day,
        null::text as location,
        'expense_ticket'::text as target_entity_type,
        et.id::uuid as target_entity_id,
        null::text as target_name,
        null::text as target_phone,
        'system'::text as derivation_source,
        null::uuid as created_by,
        et.created_at
    from public.expense_tickets et
    where et.status in ('approved_funds_released', 'disbursed', 'settled_and_closed')

    union all

    -- Auto-derived from audit_logs (kind = 'audit_log', high-priority only)
    select
        al.tenant_id,
        'audit_log'::text as kind,
        al.action as title,
        al.note as description,
        al.occurred_at as start_at,
        al.occurred_at + interval '1 minute' as end_at,
        false as all_day,
        null::text as location,
        al.entity_type as target_entity_type,
        al.entity_id as target_entity_id,
        al.actor_name as target_name,
        null::text as target_phone,
        'system'::text as derivation_source,
        al.actor_id as created_by,
        al.created_at
    from public.audit_logs al
    where al.action in ('expense.approve', 'expense.reject', 'payment.refund', 'workflow.deploy', 'backup.run');

comment on view public.vw_calendar_events_derived is
  'Unified calendar view: manual events + auto-derived events from payments, expenses, audit log.';

-- ============================================================================
-- 12. vw_attendance_summary — per-student attendance counts
-- ============================================================================
create view public.vw_attendance_summary as
    select
        tenant_id,
        student_id,
        count(*) filter (where status = 'present') as present_count,
        count(*) filter (where status = 'absent_excused') as absent_excused_count,
        count(*) filter (where status = 'absent_unexcused') as absent_unexcused_count,
        count(*) filter (where status = 'late') as late_count,
        count(*) as total_records,
        case
            when count(*) = 0 then 0
            else (count(*) filter (where status = 'present')::numeric / count(*)::numeric * 100)::numeric(5,2)
        end as attendance_rate_pct
    from public.attendance_records
    group by tenant_id, student_id;

comment on view public.vw_attendance_summary is 'Per-student attendance counts and rate.';

-- ============================================================================
-- 13. vw_inventory_low_stock — items below reorder level
-- ============================================================================
create view public.vw_inventory_low_stock as
    select
        tenant_id,
        sku,
        name,
        category,
        quantity_on_hand,
        reorder_level,
        reorder_quantity,
        unit_cost,
        location,
        (reorder_level - quantity_on_hand) as shortfall
    from public.inventory_items
    where quantity_on_hand <= reorder_level
      and is_active = true
      and deleted_at is null;

comment on view public.vw_inventory_low_stock is 'Items at or below reorder level. Drives restock alerts.';

-- ============================================================================
-- 14. vw_pricing_full — joined pricing config + tuition + transport + services
-- ============================================================================
create view public.vw_pricing_full as
    select
        pc.tenant_id,
        pc.id as pricing_config_id,
        pc.label,
        ay.label as academic_year,
        pc.registration_fee,
        pc.late_penalty_per_day,
        pc.second_apron_fee,
        pc.early_payment_bonus_pct,
        pc.early_payment_deadline,
        pc.is_active,
        (
            select jsonb_agg(jsonb_build_object(
                'level_id', glt.academic_level_id,
                'level_code', al.grade_code,
                'level_label', al.year_label,
                'annual_amount', glt.annual_amount,
                'tranches', jsonb_build_array(
                    jsonb_build_object('number', 1, 'amount', glt.tranche_1_amount, 'month', glt.tranche_1_month),
                    jsonb_build_object('number', 2, 'amount', glt.tranche_2_amount, 'month', glt.tranche_2_month),
                    jsonb_build_object('number', 3, 'amount', glt.tranche_3_amount, 'month', glt.tranche_3_month)
                )
            ))
            from public.grade_level_tuition glt
            join public.academic_levels al on al.id = glt.academic_level_id
            where glt.pricing_config_id = pc.id
        ) as tuition_by_level,
        (
            select jsonb_agg(jsonb_build_object(
                'destination_id', td.id,
                'code', td.code,
                'label_fr', td.label_fr,
                'annual_amount', td.annual_amount,
                'tranches', jsonb_build_array(
                    jsonb_build_object('number', 1, 'amount', td.tranche_1_amount, 'month', td.tranche_1_month),
                    jsonb_build_object('number', 2, 'amount', td.tranche_2_amount, 'month', td.tranche_2_month),
                    jsonb_build_object('number', 3, 'amount', td.tranche_3_amount, 'month', td.tranche_3_month)
                )
            ))
            from public.transport_destinations td
            where td.pricing_config_id = pc.id
        ) as transport_by_destination,
        (
            select jsonb_agg(jsonb_build_object(
                'service_id', cs.id, 'code', cs.code, 'label_fr', cs.label_fr,
                'semester_amount', cs.semester_amount, 'annual_amount', cs.annual_amount,
                'billing_model', cs.billing_model
            ))
            from public.complementary_services cs
            where cs.pricing_config_id = pc.id and cs.is_active = true
        ) as complementary_services,
        (
            select jsonb_agg(jsonb_build_object(
                'service_id', ads.id, 'code', ads.code, 'label_fr', ads.label_fr,
                'amount', ads.amount, 'billing_model', ads.billing_model
            ))
            from public.additional_services ads
            where ads.pricing_config_id = pc.id and ads.is_active = true
        ) as additional_services,
        (
            select jsonb_agg(jsonb_build_object(
                'discount_id', d.id, 'code', d.code, 'label_fr', d.label_fr,
                'discount_type', d.discount_type, 'amount', d.amount, 'applies_to', d.applies_to
            ))
            from public.discounts d
            where d.pricing_config_id = pc.id and d.is_active = true
        ) as discounts
    from public.pricing_configs pc
    join public.academic_years ay on ay.id = pc.academic_year_id;

comment on view public.vw_pricing_full is 'Fully joined pricing config (tuition + transport + services + discounts) for client hydration.';

-- ============================================================================
-- 15. vw_pending_approvals — counts of pending items per tenant
-- ============================================================================
create view public.vw_pending_approvals as
    select
        t.id as tenant_id,
        (select count(*) from public.account_approval_requests ar where ar.tenant_id = t.id and ar.status = 'pending') as pending_account_approvals,
        (select count(*) from public.expense_tickets et where et.tenant_id = t.id and et.status = 'pending_approval') as pending_expense_approvals,
        (select count(*) from public.leave_requests lr where lr.tenant_id = t.id and lr.status = 'pending') as pending_leave_requests,
        (select count(*) from public.purchase_requests pr where pr.tenant_id = t.id and pr.status = 'submitted') as pending_purchase_requests
    from public.tenants t
    where t.deleted_at is null;

comment on view public.vw_pending_approvals is 'Counts of pending items per tenant. Displayed on admin dashboard.';
