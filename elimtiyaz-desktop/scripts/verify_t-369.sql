-- ============================================================================
-- verify_t-369.sql — T-369 (WORKFORCE-500): the 0095 migration invariants
-- ============================================================================
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can be
-- re-run any time WITHOUT mutating the live DB. Results land in a temp table
-- SELECTed at the end. Covers BOTH the happy paths AND the regression paths
-- (guards, illegal transitions, append-only).
--
-- Run:  SUPABASE_ACCESS_TOKEN=… supabase db query --linked < scripts/verify_t-369.sql
--   or: curl the Management API SQL endpoint with this file as the payload.
--
-- NOTE (§15.27): the RLS-impersonation legs GRANT the temp table to
-- `authenticated` because SET LOCAL ROLE downgrades the session.
-- NOTE: `set local request.jwt.claims` forges the caller identity the way
-- PostgREST does — auth.uid()/auth.jwt() then resolve from the claims GUC.
-- ============================================================================

BEGIN;

-- A dedicated verify temp table (the convention).
create temp table t369_results (
    check_id text primary key,
    passed boolean not null,
    detail text
);
grant select, insert on t369_results to authenticated;

-- Clean slate for the probe personnel (rolled back at the end).
delete from public.personnel where personnel_code = 'PER-PROBE-T369';
insert into public.personnel (
    tenant_id, personnel_code, first_name, last_name, staff_category,
    position, hire_date, base_salary, is_active
)
select t.id, 'PER-PROBE-T369', 'Probe', 'T-369', 'administration',
       'Probe technique', current_date, 50000::numeric, true
  from public.tenants t
 order by created_at
 limit 1;

-- ============================================================================
-- CHECK 1 — adjust_personnel_salary RAISE: base updated, adjustment row,
--           audit entry (service-role caller path: the claims GUC carries the
--           service_role JWT role, the 0055-trusted exemption).
-- ============================================================================
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

do $$
declare
    v_personnel_id uuid;
    v_res jsonb;
    v_adjustment record;
    v_audit_count int;
begin
    select id into v_personnel_id from public.personnel where personnel_code = 'PER-PROBE-T369';

    v_res := public.adjust_personnel_salary(
        p_personnel_id := v_personnel_id,
        p_type := 'raise',
        p_delta := 5000,
        p_reason := 'Probe technique T-369 — augmentation test',
        p_actor_name := 'Probe T-369'
    );

    select * into v_adjustment from public.salary_adjustments
     where personnel_id = v_personnel_id and type = 'raise';

    select count(*) into v_audit_count from public.audit_logs
     where action = 'personnel.salary_adjusted' and entity_id = v_personnel_id;

    insert into t369_results values (
        '1_raise_updates_base',
        coalesce((select base_salary from public.personnel where id = v_personnel_id), 0) = 55000,
        'base_salary after raise: ' || coalesce((select base_salary::text from public.personnel where id = v_personnel_id), '?')
    );
    insert into t369_results values (
        '1b_adjustment_row_immutable_fields',
        v_adjustment.amount_before = 50000 and v_adjustment.amount_after = 55000
            and v_adjustment.delta = 5000 and v_adjustment.approved_by_name = 'Probe T-369',
        'before/after/delta/actor: ' || v_adjustment.amount_before || '/' || v_adjustment.amount_after || '/' || v_adjustment.delta
    );
    insert into t369_results values (
        '1c_rpc_returns_artifacts',
        (v_res -> 'adjustment' ->> 'type') = 'raise'
            and (v_res ->> 'base_salary_after')::numeric = 55000,
        'rpc jsonb: type=' || coalesce(v_res -> 'adjustment' ->> 'type', '?') || ' base_after=' || coalesce(v_res ->> 'base_salary_after', '?')
    );
    insert into t369_results values (
        '1d_master_audit_row',
        v_audit_count >= 1,
        'audit_rows=' || v_audit_count
    );
end;
$$;

-- ============================================================================
-- CHECK 2 — CUT floors at 0 (30000 cut of a 55000 base leaves 25000; a
--           999999 cut floors at 0, delta stays the requested magnitude).
-- ============================================================================
do $$
declare
    v_personnel_id uuid;
begin
    select id into v_personnel_id from public.personnel where personnel_code = 'PER-PROBE-T369';

    perform public.adjust_personnel_salary(
        p_personnel_id := v_personnel_id, p_type := 'cut', p_delta := 30000,
        p_reason := 'Probe technique T-369 — reduction test');

    insert into t369_results values (
        '2_cut_subtracts',
        (select base_salary from public.personnel where id = v_personnel_id) = 25000,
        'base after 30k cut: ' || (select base_salary::text from public.personnel where id = v_personnel_id)
    );

    perform public.adjust_personnel_salary(
        p_personnel_id := v_personnel_id, p_type := 'cut', p_delta := 999999,
        p_reason := 'Probe technique T-369 — floor test');

    insert into t369_results values (
        '2b_cut_floors_at_zero',
        (select base_salary from public.personnel where id = v_personnel_id) = 0,
        'base after over-cut: ' || (select base_salary::text from public.personnel where id = v_personnel_id)
    );
end;
$$;

-- ============================================================================
-- CHECK 3 — BONUS / DEDUCTION: base UNCHANGED; delta signed; the period
--           totals flow into record_salary_disbursement's net.
-- ============================================================================
do $$
declare
    v_personnel_id uuid;
    v_base_before numeric;
    v_payment jsonb;
begin
    select id, base_salary into v_personnel_id, v_base_before
      from public.personnel where personnel_code = 'PER-PROBE-T369';

    -- restore a base first
    update public.personnel set base_salary = 40000 where id = v_personnel_id;

    perform public.adjust_personnel_salary(
        p_personnel_id := v_personnel_id, p_type := 'bonus', p_delta := 2500,
        p_reason := 'Probe technique T-369 — prime test');
    perform public.adjust_personnel_salary(
        p_personnel_id := v_personnel_id, p_type := 'deduction', p_delta := 1000,
        p_reason := 'Probe technique T-369 — retenue test');

    insert into t369_results values (
        '3_one_offs_keep_base',
        (select base_salary from public.personnel where id = v_personnel_id) = 40000,
        'base after bonus+deduction: ' || (select base_salary::text from public.personnel where id = v_personnel_id)
    );

    v_payment := public.record_salary_disbursement(
        p_personnel_id := v_personnel_id,
        p_period := to_char(current_date, 'YYYY-MM'),
        p_method := 'bank_transfer',
        p_reference_number := 'PROBE-T369-001',
        p_actor_name := 'Probe T-369');

    insert into t369_results values (
        '3b_disbursement_nets_period_totals',
        (v_payment ->> 'bonuses_total')::numeric = 2500 and (v_payment ->> 'deductions_total')::numeric = 1000
            and (v_payment ->> 'net_paid')::numeric = 41500 and (v_payment ->> 'status') = 'paid',
        'bonuses=' || coalesce(v_payment ->> 'bonuses_total', '?') || ' deductions=' || coalesce(v_payment ->> 'deductions_total', '?')
            || ' net=' || coalesce(v_payment ->> 'net_paid', '?')
    );

    -- Idempotent re-record: same period ONE row, method updated.
    perform public.record_salary_disbursement(
        p_personnel_id := v_personnel_id,
        p_period := to_char(current_date, 'YYYY-MM'),
        p_method := 'cash',
        p_actor_name := 'Probe T-369');

    insert into t369_results values (
        '3c_disbursement_idempotent_upsert',
        (select count(*) from public.salary_payments where personnel_id = v_personnel_id) = 1
            and (select method from public.salary_payments where personnel_id = v_personnel_id) = 'cash',
        'rows=' || (select count(*)::text from public.salary_payments where personnel_id = v_personnel_id)
            || ' method=' || (select method from public.salary_payments where personnel_id = v_personnel_id)
    );
end;
$$;

-- ============================================================================
-- CHECK 4 — REGRESSION PATHS: short reason rejected; invalid type rejected;
--           non-positive delta rejected.
-- ============================================================================
do $$
declare
    v_personnel_id uuid;
    v_err text := '';
begin
    select id into v_personnel_id from public.personnel where personnel_code = 'PER-PROBE-T369';

    begin
        perform public.adjust_personnel_salary(
            p_personnel_id := v_personnel_id, p_type := 'raise', p_delta := 100,
            p_reason := 'no');
    exception when others then
        v_err := sqlerrm;
    end;
    insert into t369_results values (
        '4_short_reason_rejected',
        position('justification' in v_err) > 0,
        'err: ' || v_err
    );

    v_err := '';
    begin
        perform public.adjust_personnel_salary(
            p_personnel_id := v_personnel_id, p_type := 'gift', p_delta := 100,
            p_reason := 'Probe technique T-369');
    exception when others then
        v_err := sqlerrm;
    end;
    insert into t369_results values (
        '4b_invalid_type_rejected',
        position('invalid adjustment type' in v_err) > 0,
        'err: ' || v_err
    );

    v_err := '';
    begin
        perform public.adjust_personnel_salary(
            p_personnel_id := v_personnel_id, p_type := 'raise', p_delta := -100,
            p_reason := 'Probe technique T-369 — negative delta');
    exception when others then
        v_err := sqlerrm;
    end;
    insert into t369_results values (
        '4c_negative_delta_rejected',
        position('must be positive' in v_err) > 0,
        'err: ' || v_err
    );
end;
$$;

-- ============================================================================
-- CHECK 5 — ROLE GUARD: an authenticated caller WITHOUT super_admin /
--           financial_officer is refused (the 0055 hardening — the claims GUC
--           carries a plain authenticated identity with no role rows).
-- ============================================================================
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

do $$
declare
    v_personnel_id uuid;
    v_err text := '';
begin
    select id into v_personnel_id from public.personnel where personnel_code = 'PER-PROBE-T369';

    begin
        perform public.adjust_personnel_salary(
            p_personnel_id := v_personnel_id, p_type := 'raise', p_delta := 100,
            p_reason := 'Probe technique T-369 — role guard');
    exception when others then
        v_err := sqlerrm;
    end;
    insert into t369_results values (
        '5_role_guard_blocks_plain_user',
        position('super_admin / financial_officer' in v_err) > 0,
        'err: ' || v_err
    );
end;
$$;

-- ============================================================================
-- CHECK 6 — staff_absences: the justification loop transitions + the illegal
--           transition rejected + is_excused only on accepted.
-- ============================================================================
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

do $$
declare
    v_personnel_id uuid;
    v_absence_id uuid;
    v_err text := '';
begin
    select id into v_personnel_id from public.personnel where personnel_code = 'PER-PROBE-T369';

    insert into public.staff_absences (tenant_id, personnel_id, date, duration_hours)
    select tenant_id, id, current_date, 4 from public.personnel where id = v_personnel_id
    returning id into v_absence_id;

    insert into t369_results values ('6_absence_created_none', true, 'id=' || v_absence_id);

    -- none -> requested (admin)
    update public.staff_absences set
        justification_status = 'requested',
        admin_request_note = 'Merci de fournir un justificatif.',
        requested_at = now(),
        requested_by = '00000000-0000-0000-0000-000000000000'
    where id = v_absence_id;

    -- requested -> submitted (worker)
    update public.staff_absences set
        justification_status = 'submitted',
        worker_explanation = 'Certificat médical fourni.',
        worker_submitted_at = now(),
        document_ref = 'tenant-probe/absence/certif.pdf'
    where id = v_absence_id;

    insert into t369_results values (
        '6b_loop_reaches_submitted',
        (select justification_status from public.staff_absences where id = v_absence_id) = 'submitted',
        'status=' || (select justification_status from public.staff_absences where id = v_absence_id)
    );

    -- submitted -> accepted + is_excused flips
    update public.staff_absences set
        justification_status = 'accepted',
        is_excused = true,
        decision_note = 'Justificatif accepté.',
        decided_at = now(),
        decided_by = '00000000-0000-0000-0000-000000000000'
    where id = v_absence_id;

    insert into t369_results values (
        '6c_accepted_marks_excused',
        (select is_excused from public.staff_absences where id = v_absence_id),
        'is_excused=' || (select is_excused::text from public.staff_absences where id = v_absence_id)
    );

    -- REGRESSION: none -> submitted is ILLEGAL
    insert into public.staff_absences (tenant_id, personnel_id, date, duration_hours)
    select tenant_id, id, current_date - 1, 2 from public.personnel where id = v_personnel_id;

    begin
        update public.staff_absences set justification_status = 'submitted', worker_explanation = 'skip'
         where personnel_id = v_personnel_id and date = current_date - 1 and justification_status = 'none';
    exception when others then
        v_err := sqlerrm;
    end;
    insert into t369_results values (
        '6d_illegal_transition_rejected',
        position('illegal justification transition' in v_err) > 0,
        'err: ' || v_err
    );

    -- REGRESSION: is_excused without accepted
    v_err := '';
    begin
        update public.staff_absences set is_excused = true
         where personnel_id = v_personnel_id and date = current_date - 1 and justification_status = 'none';
    exception when others then
        v_err := sqlerrm;
    end;
    insert into t369_results values (
        '6e_excused_requires_accepted',
        position('is_excused requires' in v_err) > 0,
        'err: ' || v_err
    );
end;
$$;

-- ============================================================================
-- CHECK 7 — salary_adjustments is APPEND-ONLY (UPDATE and DELETE refused).
-- ============================================================================
do $$
declare
    v_personnel_id uuid;
    v_err text := '';
begin
    select id into v_personnel_id from public.personnel where personnel_code = 'PER-PROBE-T369';

    begin
        update public.salary_adjustments set reason = 'tampered'
         where personnel_id = v_personnel_id and type = 'raise';
    exception when others then
        v_err := sqlerrm;
    end;
    insert into t369_results values (
        '7_adjustments_update_refused',
        position('append-only' in v_err) > 0,
        'err: ' || v_err
    );

    v_err := '';
    begin
        delete from public.salary_adjustments where personnel_id = v_personnel_id;
    exception when others then
        v_err := sqlerrm;
    end;
    insert into t369_results values (
        '7b_adjustments_delete_refused',
        position('append-only' in v_err) > 0,
        'err: ' || v_err
    );
end;
$$;

-- ============================================================================
-- CHECK 8 — leave_requests: the widened CHECKs accept the 74d3ebb kinds
--           (spending_reimbursement + clarification_requested) and the new
--           columns carry their values.
-- ============================================================================
do $$
declare
    v_personnel_id uuid;
    v_req_id uuid;
begin
    select id into v_personnel_id from public.personnel where personnel_code = 'PER-PROBE-T369';

    insert into public.leave_requests (
        tenant_id, personnel_id, leave_type, start_date, end_date,
        reason, amount_requested, status
    )
    select tenant_id, id, 'spending_reimbursement', current_date, current_date,
           'Probe technique T-369 — remboursement', 4500, 'pending'
      from public.personnel where id = v_personnel_id
    returning id into v_req_id;

    update public.leave_requests set
        status = 'clarification_requested',
        clarification_request = 'Merci de détailler les frais.'
    where id = v_req_id;

    update public.leave_requests set
        status = 'pending',
        clarification_response = 'Câbles HDMI pour la salle polyvalente.'
    where id = v_req_id;

    insert into t369_results values (
        '8_leave_widened_kinds_accepted',
        (select amount_requested from public.leave_requests where id = v_req_id) = 4500
            and (select status from public.leave_requests where id = v_req_id) = 'pending'
            and (select clarification_response from public.leave_requests where id = v_req_id) like 'Câbles%',
        'amount/status/clarification round-trip ok'
    );
end;
$$;

-- ============================================================================
-- CHECK 9 — tasks: the four review-lifecycle columns exist and round-trip.
-- ============================================================================
do $$
declare
    v_personnel_id uuid;
    v_task_id uuid;
begin
    select tenant_id into v_personnel_id from public.personnel where personnel_code = 'PER-PROBE-T369';

    insert into public.tasks (tenant_id, title, description, status, priority)
    select tenant_id, 'Probe T-369 tâche', 'Cycle de validation', 'needs_review', 'medium'
      from public.personnel where personnel_code = 'PER-PROBE-T369'
    returning id into v_task_id;

    update public.tasks set
        completed_by = '00000000-0000-0000-0000-000000000000',
        completion_note = 'Rapport de fin de tâche.',
        reviewed_by = '00000000-0000-0000-0000-000000000000',
        review_note = 'Validé après examen.',
        status = 'completed',
        progress = 100
    where id = v_task_id;

    insert into t369_results values (
        '9_tasks_review_columns_roundtrip',
        (select completion_note from public.tasks where id = v_task_id) = 'Rapport de fin de tâche.'
            and (select review_note from public.tasks where id = v_task_id) = 'Validé après examen.'
            and (select completed_by is not null from public.tasks where id = v_task_id),
        'completion/review columns round-trip'
    );
end;
$$;

-- ============================================================================
-- CHECK 10 — realtime publication membership (the 0085 pattern).
-- ============================================================================
insert into t369_results
select '10_realtime_membership', count(*) = 2,
       'published new tables: ' || count(*)
  from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
   and tablename in ('staff_absences', 'salary_payments');

-- ============================================================================
-- FINAL: the summary (the CLI surfaces no RAISE NOTICE output).
-- ============================================================================
select check_id, passed, detail from t369_results order by check_id;

ROLLBACK;
