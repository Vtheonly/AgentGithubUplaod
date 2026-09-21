-- ============================================================================
-- verify_t-405.sql — T-405 (cross-year debt aging & payment-behavior
-- status), migration 0111. Convention (AGENTS.md §11.1): wrapped in
-- BEGIN; … ROLLBACK; — re-runnable, never mutates. Results land in a temp
-- table; covers the happy paths AND the regression paths.
--
-- THE PARITY TARGET: this script pins the SQL mirror against the SAME
-- fixtures as the TS reference suite
-- (src/tests/domain/ledger/debt-aging.test.ts): the two archetype parents
-- (same 100 000 DZD debt, same 2024-10-15 due date — one kept paying
-- through 2025-2026 → GREEN/active_payer, one went silent →
-- RED/critical_delinquency) at the SAME pinned clock 2026-06-15T12:00Z.
--
-- SANDBOX: run-unique probe parents (PAR-T405-…), one probe academic year
-- whose window deliberately OVERLAPS the Jul1–Jun30 convention so the
-- INV-14 priority (row wins over convention) is distinguishable.
--
-- CHECKS:
--   C1  structure: 4 functions exist, secdef+search_path on the compute
--       pair, anon/public EXECUTE revoked
--   C2  the debtor surface returns exactly the 5 debtor probes (the
--       fully-paid probe is excluded)
--   C3  Parent A (archetype): green/active_payer + debt_age 608 +
--       inactivity 14 + subsequent-year payments 10 / 80 000 DZD
--   C4  Parent B (archetype): red/critical_delinquency + inactivity 591 +
--       zero subsequent-year activity
--   C5  Parent C: orange/sustained_delinquency (debt 200 d, inactivity 106 d)
--   C6  Parent D: yellow/watch (never paid, debt 70 d → inactivity = age)
--   C7  Parent E: never-paid red edge (debt 182 d > 180)
--   C8  Parent F (fully paid): absent from the surface
--   C9  INV-14 attribution priority: probe-row window beats the calendar
--       convention (2025-08-15 → the row's 2024-2025, not 2025-2026);
--       convention applies outside rows; the real 2026-2027 row resolves
--   C10 obligations JSON detail: remaining/dueDate/academicYear/daysOverdue
--       + student attribution
--   C11 Créances parity: RPC outstanding == the independent
--       Σ GREATEST(0, due−paid−pending) over the same rows
--   C12 the staff gate: super_admin impersonation → rows; role-less
--       impersonation → exception; anon has no EXECUTE privilege
--   C13 the matview extension: REFRESH lands the payment-behavior columns;
--       pre-existing column semantics preserved (aging_bucket still from
--       the ledger-overdue basis); unique indexes present
-- ============================================================================
BEGIN;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t405_results (check_id text, ok boolean, detail text);
GRANT INSERT, SELECT ON t405_results TO authenticated, anon;

-- The pinned clock — identical to the TS fixture NOW (2026-06-15T12:00Z);
-- applied as a literal in every block below.

-- ─── Block A: the sandbox ─────────────────────────────────────────────────
do $setup$
declare
    v_tenant   uuid := (select tenant_id from public.academic_years where label = '2026-2027' limit 1);
    v_ay_probe uuid;
    v_ay_real  uuid := (select id from public.academic_years where label = '2026-2027' limit 1);
    v_se       uuid;
    v_p_a uuid; v_p_b uuid; v_p_c uuid; v_p_d uuid; v_p_e uuid; v_p_f uuid;
    v_s_a1 uuid; v_s_a2 uuid;
begin
    -- The probe academic year: window 2024-08-01..2025-08-31 deliberately
    -- overlaps the convention (Jul 2025 → convention says 2025-2026, the
    -- row says 2024-2025) so C9 can prove the priority order.
    insert into public.academic_years (tenant_id, label, start_date, end_date, term_structure)
    values (v_tenant, '2024-2025', '2024-08-01', '2025-08-31', 'trimester')
    returning id into v_ay_probe;

    -- Probe parents (run-unique codes).
    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone)
    values (v_tenant, 'PAR-T405-A', 'Amine', 'ARCHETYPE-A', '0550000001') returning id into v_p_a;
    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone)
    values (v_tenant, 'PAR-T405-B', 'Bilal', 'ARCHETYPE-B', '0550000002') returning id into v_p_b;
    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone)
    values (v_tenant, 'PAR-T405-C', 'Chakib', 'ORANGE-C', '0550000003') returning id into v_p_c;
    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone)
    values (v_tenant, 'PAR-T405-D', 'Djamel', 'WATCH-D', '0550000004') returning id into v_p_d;
    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone)
    values (v_tenant, 'PAR-T405-E', 'Farid', 'NEVER-E', '0550000005') returning id into v_p_e;
    insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone)
    values (v_tenant, 'PAR-T405-F', 'Sofiane', 'RESOLVED-F', '0550000006') returning id into v_p_f;

    -- Two students for parent A (multi-student attribution).
    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name, date_of_birth)
    values (v_tenant, v_p_a, 'ELV-T405-A1', 'Enfant', 'ARCHETYPE-A', '2015-03-01') returning id into v_s_a1;
    insert into public.students (tenant_id, parent_id, student_code, first_name, last_name, date_of_birth)
    values (v_tenant, v_p_a, 'ELV-T405-A2', 'Cadet', 'ARCHETYPE-A', '2018-09-01') returning id into v_s_a2;

    -- One service enrollment per parent (the installments FK leg).
    insert into public.service_enrollments (tenant_id, student_id, academic_year_id, service_kind, annual_amount)
    values (v_tenant, v_s_a1, v_ay_probe, 'tuition', 100000) returning id into v_se;

    -- ── The obligations ──
    -- A: the 2024-10-15 obligation (100k, untouched — the archetype) + a
    --    fully-paid current-year tranche (contributes 0 remaining).
    insert into public.installments (tenant_id, parent_id, student_id, service_enrollment_id, tranche_number,
                                     amount_due, amount_paid, due_date, status)
    values (v_tenant, v_p_a, v_s_a1, v_se, 1, 100000, 0, '2024-10-15', 'unpaid');
    insert into public.installments (tenant_id, parent_id, student_id, service_enrollment_id, tranche_number,
                                     amount_due, amount_paid, due_date, status)
    values (v_tenant, v_p_a, v_s_a2, v_se, 2, 60000, 60000, '2026-03-15', 'paid');
    -- B: same 100k / same due date (the identical-debt archetype).
    insert into public.installments (tenant_id, parent_id, student_id, service_enrollment_id, tranche_number,
                                     amount_due, amount_paid, due_date, status)
    values (v_tenant, v_p_b, v_s_a1, v_se, 1, 100000, 0, '2024-10-15', 'unpaid');
    -- C: debt 200 days (due 2025-11-27), last payment 2026-03-01 (106 days) → ORANGE.
    insert into public.installments (tenant_id, parent_id, student_id, service_enrollment_id, tranche_number,
                                     amount_due, amount_paid, due_date, status)
    values (v_tenant, v_p_c, v_s_a1, v_se, 1, 50000, 0, '2025-11-27', 'unpaid');
    -- D: young never-paid debt (70 days) → YELLOW.
    insert into public.installments (tenant_id, parent_id, student_id, service_enrollment_id, tranche_number,
                                     amount_due, amount_paid, due_date, status)
    values (v_tenant, v_p_d, v_s_a1, v_se, 1, 30000, 0, '2026-04-06', 'unpaid');
    -- E: never-paid 182-day debt → RED (INV-16b edge: debt passes 180).
    insert into public.installments (tenant_id, parent_id, student_id, service_enrollment_id, tranche_number,
                                     amount_due, amount_paid, due_date, status)
    values (v_tenant, v_p_e, v_s_a1, v_se, 1, 20000, 0, '2025-12-15', 'unpaid');
    -- F: fully paid → excluded from the debtor surface.
    insert into public.installments (tenant_id, parent_id, student_id, service_enrollment_id, tranche_number,
                                     amount_due, amount_paid, due_date, status)
    values (v_tenant, v_p_f, v_s_a1, v_se, 1, 50000, 50000, '2025-10-15', 'paid');

    -- ── The payment behavior (ledger entries; amounts_pending reduces
    --    nothing here — charges mirror the obligations so the mv leg works) ──
    -- A: charge +100k on the old obligation; 10 monthly payments Sep 2025 → Jun 2026.
    insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                       entry_type, amount, category, description, entry_date)
    values (v_tenant, 'LED-T405-A-CHG', v_p_a, v_s_a1, 'parent:' || v_p_a || ':category:tuition',
            'charge', 100000, 'tuition', 'Scolarité 2024 — Tranche 1 (sonde T-405)', '2024-10-15');
    for i in 0..9 loop
        insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                           entry_type, amount, category, description, entry_date)
        values (v_tenant, 'LED-T405-A-PAY-' || i, v_p_a, v_s_a1, 'parent:' || v_p_a || ':category:tuition',
                'payment', -8000, 'tuition', 'Encaissement mensuel (sonde T-405)',
                make_timestamptz(2025 + (i >= 4)::int, case when i < 4 then 9 + i else i - 3 end, 1, 12, 0, 0));
    end loop;
    -- B: charge +100k; ONE payment 2024-11-01 (the origin year) then silence.
    insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                       entry_type, amount, category, description, entry_date)
    values (v_tenant, 'LED-T405-B-CHG', v_p_b, v_s_a1, 'parent:' || v_p_b || ':category:tuition',
            'charge', 100000, 'tuition', 'Scolarité 2024 — Tranche 1 (sonde T-405)', '2024-10-15');
    insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                       entry_type, amount, category, description, entry_date)
    values (v_tenant, 'LED-T405-B-PAY-0', v_p_b, v_s_a1, 'parent:' || v_p_b || ':category:tuition',
            'payment', -20000, 'tuition', 'Encaissement 2024 (sonde T-405)', '2024-11-01');
    -- C: charge + one payment 2026-03-01.
    insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                       entry_type, amount, category, description, entry_date)
    values (v_tenant, 'LED-T405-C-CHG', v_p_c, v_s_a1, 'parent:' || v_p_c || ':category:tuition',
            'charge', 50000, 'tuition', 'Scolarité (sonde T-405)', '2025-11-27');
    insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                       entry_type, amount, category, description, entry_date)
    values (v_tenant, 'LED-T405-C-PAY-0', v_p_c, v_s_a1, 'parent:' || v_p_c || ':category:tuition',
            'payment', -5000, 'tuition', 'Encaissement (sonde T-405)', '2026-03-01');
    -- D/E: charges only (never paid).
    insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                       entry_type, amount, category, description, entry_date)
    values (v_tenant, 'LED-T405-D-CHG', v_p_d, v_s_a1, 'parent:' || v_p_d || ':category:tuition',
            'charge', 30000, 'tuition', 'Scolarité (sonde T-405)', '2026-04-06');
    insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                       entry_type, amount, category, description, entry_date)
    values (v_tenant, 'LED-T405-E-CHG', v_p_e, v_s_a1, 'parent:' || v_p_e || ':category:tuition',
            'charge', 20000, 'tuition', 'Scolarité (sonde T-405)', '2025-12-15');
    -- F: charge + full payment (ledger balance 0 → also absent from the mv).
    insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                       entry_type, amount, category, description, entry_date)
    values (v_tenant, 'LED-T405-F-CHG', v_p_f, v_s_a1, 'parent:' || v_p_f || ':category:tuition',
            'charge', 50000, 'tuition', 'Scolarité (sonde T-405)', '2025-10-15');
    insert into public.ledger_entries (tenant_id, entry_number, parent_id, student_id, account_id,
                                       entry_type, amount, category, description, entry_date)
    values (v_tenant, 'LED-T405-F-PAY-0', v_p_f, v_s_a1, 'parent:' || v_p_f || ':category:tuition',
            'payment', -50000, 'tuition', 'Encaissement intégral (sonde T-405)', '2025-11-01');

    insert into t405_results values ('A-sandbox-created', true,
        'probes A..F + probe year 2024-2025 (window 2024-08-01..2025-08-31) inserted');
end $setup$;

-- ─── C1: structure ────────────────────────────────────────────────────────
-- academic_year_start is intentionally NOT SECURITY DEFINER (immutable,
-- zero table access); the other three must be.
insert into t405_results
select 'C1-functions-secdef',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('attribute_academic_year', 'compute_debt_aging_rows',
                             'compute_debt_aging_summary')
           and p.prosecdef) = 3
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.proname = 'academic_year_start'
                          and p.prosecdef),
       'secdef_trio=3 plain_start_fn=ok';

insert into t405_results
select 'C1-search-path-pinned', count(*) = 3,
       'pinned=' || count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('attribute_academic_year', 'compute_debt_aging_rows', 'compute_debt_aging_summary')
   and array_to_string(p.proconfig, ',') like '%search_path=public%';

insert into t405_results
select 'C1-anon-no-execute', not has_function_privilege('anon', 'public.compute_debt_aging_summary(timestamptz)', 'execute')
       and not has_function_privilege('anon', 'public.compute_debt_aging_rows(uuid, timestamptz)', 'execute')
       and not has_function_privilege('public', 'public.compute_debt_aging_rows(uuid, timestamptz)', 'execute'),
       'anon/public execute revoked';

-- ─── The pinned clock, applied via a fixed literal everywhere below ──────
-- (2026-06-15T12:00:00+00 — identical to the TS fixture NOW.)

-- ─── C2..C8 + C10 + C11: the debtor surface (as the ungated rows fn, the
--     computation itself) ─────────────────────────────────────────────────
do $rows$
declare
    v_as_of timestamptz := '2026-06-15T12:00:00+00';
    v_a uuid := (select id from public.parents where parent_code = 'PAR-T405-A');
    v_b uuid := (select id from public.parents where parent_code = 'PAR-T405-B');
    v_c uuid := (select id from public.parents where parent_code = 'PAR-T405-C');
    v_d uuid := (select id from public.parents where parent_code = 'PAR-T405-D');
    v_e uuid := (select id from public.parents where parent_code = 'PAR-T405-E');
    v_f uuid := (select id from public.parents where parent_code = 'PAR-T405-F');
    v_tenant uuid := (select tenant_id from public.parents where id = v_a);
    r record;
    n integer;
begin
    -- C2: exactly the five debtors (F excluded).
    select count(*) into n from public.compute_debt_aging_rows(v_tenant, v_as_of) d
     where d.parent_id in (v_a, v_b, v_c, v_d, v_e, v_f);
    insert into t405_results values ('C2-debtor-surface-five', n = 5, 'rows=' || n);
    select count(*) into n from public.compute_debt_aging_rows(v_tenant, v_as_of) d where d.parent_id = v_f;
    insert into t405_results values ('C2-resolved-excluded', n = 0, 'resolved_rows=' || n);

    -- C3: Parent A (archetype — old debt + kept paying).
    select * into r from public.compute_debt_aging_rows(v_tenant, v_as_of) where parent_id = v_a;
    insert into t405_results values ('C3-A-status',
        r.status_level = 'green' and r.reason_code = 'active_payer',
        'level=' || r.status_level || ' reason=' || r.reason_code);
    insert into t405_results values ('C3-A-factors',
        r.outstanding_amount = 100000 and r.debt_age_days = 608 and r.inactivity_days = 14
        and r.oldest_due_date = '2024-10-15' and r.origin_academic_year = '2024-2025',
        'outstanding=' || r.outstanding_amount || ' age=' || r.debt_age_days || ' inactivity=' || r.inactivity_days
        || ' origin=' || r.origin_academic_year);
    insert into t405_results values ('C3-A-subsequent',
        r.subsequent_year_payment_count = 10 and r.subsequent_year_payment_total = 80000
        and r.has_subsequent_year_payments,
        'count=' || r.subsequent_year_payment_count || ' total=' || r.subsequent_year_payment_total);

    -- C4: Parent B (archetype — same debt, silence).
    select * into r from public.compute_debt_aging_rows(v_tenant, v_as_of) where parent_id = v_b;
    insert into t405_results values ('C4-B-status',
        r.status_level = 'red' and r.reason_code = 'critical_delinquency',
        'level=' || r.status_level || ' reason=' || r.reason_code);
    insert into t405_results values ('C4-B-factors',
        r.outstanding_amount = 100000 and r.debt_age_days = 608 and r.inactivity_days = 591
        and r.subsequent_year_payment_count = 0 and not r.has_subsequent_year_payments,
        'outstanding=' || r.outstanding_amount || ' age=' || r.debt_age_days || ' inactivity=' || r.inactivity_days);

    -- C5: Parent C — orange/sustained.
    select * into r from public.compute_debt_aging_rows(v_tenant, v_as_of) where parent_id = v_c;
    insert into t405_results values ('C5-C-orange',
        r.status_level = 'orange' and r.reason_code = 'sustained_delinquency'
        and r.debt_age_days = 200 and r.inactivity_days = 106,
        'level=' || r.status_level || ' age=' || r.debt_age_days || ' inactivity=' || r.inactivity_days);

    -- C6: Parent D — yellow/watch, never-paid inactivity = age.
    select * into r from public.compute_debt_aging_rows(v_tenant, v_as_of) where parent_id = v_d;
    insert into t405_results values ('C6-D-yellow',
        r.status_level = 'yellow' and r.reason_code = 'watch'
        and r.debt_age_days = 70 and r.inactivity_days = 70 and r.last_payment_at is null,
        'level=' || r.status_level || ' age=' || r.debt_age_days || ' inactivity=' || r.inactivity_days);

    -- C7: Parent E — never-paid red edge (182 > 180).
    select * into r from public.compute_debt_aging_rows(v_tenant, v_as_of) where parent_id = v_e;
    insert into t405_results values ('C7-E-red-never-paid',
        r.status_level = 'red' and r.reason_code = 'critical_delinquency'
        and r.debt_age_days = 182 and r.inactivity_days = 182,
        'level=' || r.status_level || ' age=' || r.debt_age_days || ' inactivity=' || r.inactivity_days);

    -- C10: obligations JSON detail for A.
    select * into r from public.compute_debt_aging_rows(v_tenant, v_as_of) where parent_id = v_a;
    insert into t405_results values ('C10-A-obligations',
        jsonb_array_length(r.obligations) = 1
        and (r.obligations -> 0 ->> 'remaining')::numeric = 100000
        and (r.obligations -> 0 ->> 'dueDate') = '2024-10-15'
        and (r.obligations -> 0 ->> 'academicYear') = '2024-2025'
        and (r.obligations -> 0 ->> 'daysOverdue')::int = 608
        and array_length(r.student_ids, 1) = 1,
        'obligations=' || r.obligations::text || ' students=' || r.student_ids::text);

    -- C11: Créances parity — the RPC outstanding == the independent
    -- Σ GREATEST(0, due−paid−pending) over the same rows.
    insert into t405_results
    select 'C11-creances-parity', count(*) = 0,
           'mismatches=' || count(*)
      from public.compute_debt_aging_rows(v_tenant, v_as_of) rpc
      join public.parents p on p.id = rpc.parent_id
     where rpc.outstanding_amount <> coalesce((
            select sum(greatest(0, i.amount_due - i.amount_paid - i.amount_pending))
              from public.installments i
             where i.parent_id = rpc.parent_id
               and greatest(0, i.amount_due - i.amount_paid - i.amount_pending) > 0
       ), 0);
end $rows$;

-- ─── C9: INV-14 attribution priority (row window beats the convention) ───
do $attr$
declare
    v_tenant uuid := (select tenant_id from public.parents where parent_code = 'PAR-T405-A');
begin
    insert into t405_results values ('C9-row-beats-convention',
        public.attribute_academic_year('2025-08-15', v_tenant) = '2024-2025',
        'aug15=' || public.attribute_academic_year('2025-08-15', v_tenant)
        || ' (row window 2024-08-01..2025-08-31 wins over the Jul→Dec convention''s 2025-2026)');
    insert into t405_results values ('C9-convention-outside-row',
        public.attribute_academic_year('2025-09-15', v_tenant) = '2025-2026',
        'sep15=' || public.attribute_academic_year('2025-09-15', v_tenant));
    insert into t405_results values ('C9-real-row-resolves',
        public.attribute_academic_year('2026-10-21', v_tenant) = '2026-2027',
        'oct21=' || public.attribute_academic_year('2026-10-21', v_tenant));
    insert into t405_results values ('C9-convention-jan-jun',
        public.attribute_academic_year('2026-02-10', v_tenant) = '2025-2026'
        and public.academic_year_start('2024-2025') = 2024,
        'feb10=' || public.attribute_academic_year('2026-02-10', v_tenant));
end $attr$;

-- ─── C13: the matview extension (REFRESH is transactional → rolled back).
--     Runs BEFORE the role-downgrading C12 block for the privilege reason
--     documented there.
-- ─────────────────────────────────────────────────────────────────────────
do $mv$
declare
    v_a uuid := (select id from public.parents where parent_code = 'PAR-T405-A');
    v_f uuid := (select id from public.parents where parent_code = 'PAR-T405-F');
    r record;
    n integer;
begin
    refresh materialized view public.mv_debt_aging;
    refresh materialized view public.mv_top_debtors;

    -- The probe debtors appear WITH the new payment-behavior columns. The
    -- mv evaluates at the REFRESH clock (NOW()), so the factors are compared
    -- against the rows function at the SAME clock (self-consistency), plus
    -- the clock-independent facts pinned absolutely.
    select * into r from public.mv_debt_aging where parent_id = v_a;
    insert into t405_results values ('C13-mv-A-columns',
        r.installment_outstanding = 100000
        and r.origin_academic_year = '2024-2025'
        and r.subsequent_year_payment_count = 10
        and r.debt_age_days = (select debt_age_days from public.compute_debt_aging_rows(NULL, now()) d where d.parent_id = v_a)
        and r.status_level = (select status_level from public.compute_debt_aging_rows(NULL, now()) d where d.parent_id = v_a)
        and r.reason_code = (select reason_code from public.compute_debt_aging_rows(NULL, now()) d where d.parent_id = v_a),
        'level=' || coalesce(r.status_level, 'NULL') || ' installment_outstanding=' || coalesce(r.installment_outstanding::text, 'NULL')
        || ' subsequent=' || coalesce(r.subsequent_year_payment_count::text, 'NULL')
        || ' age=' || coalesce(r.debt_age_days::text, 'NULL'));

    -- The fully-paid probe is absent (ledger balance 0 → the mv's own filter).
    select count(*) into n from public.mv_debt_aging where parent_id = v_f;
    insert into t405_results values ('C13-mv-F-absent', n = 0, 'rows=' || n);

    -- Pre-existing semantics preserved: aging_bucket still derives from the
    -- ledger-overdue basis (compute_parent_summary), NOT from the new
    -- columns — the two documented bases coexist without interference.
    select * into r from public.mv_debt_aging where parent_id = v_a;
    insert into t405_results values ('C13-mv-aging-bucket-unchanged',
        r.aging_bucket is not null and r.total_outstanding = 20000,
        'aging_bucket=' || coalesce(r.aging_bucket, 'NULL') || ' total_outstanding=' || r.total_outstanding
        || ' (ledger basis: +100k charge − 80k payments)');

    -- The unique indexes exist (REFRESH ... CONCURRENTLY requirement).
    insert into t405_results
    select 'C13-mv-unique-indexes',
           count(*) = 2,
           'indexes=' || count(*)
      from pg_indexes
     where tablename in ('mv_debt_aging', 'mv_top_debtors')
       and indexname like 'uq_mv%';

    -- mv_top_debtors still ranks off the unchanged columns.
    select count(*) into n from public.mv_top_debtors where parent_id = v_a;
    insert into t405_results values ('C13-mv-top-debtors-intact', n = 1, 'rows=' || n);
end $mv$;

-- ─── C12: the staff gate (impersonation; the t-376 convention) — LAST
--     because its SET LOCAL ROLE downgrades the session until the final
--     ROLLBACK (an authenticated session cannot REFRESH a postgres-owned
--     matview — the t-376 ordering lesson).
-- ─────────────────────────────────────────────────────────────────────────
do $gate$
declare
    v_sub uuid;
    v_tenant uuid;
    v_rows integer;
    v_denied boolean := false;
begin
    -- Resolve a live super_admin for the tenant.
    select up.auth_user_id, up.tenant_id into v_sub, v_tenant
      from public.user_profiles up
      join public.role_assignments ra on ra.user_profile_id = up.id
      join public.roles r on r.id = ra.role_id
     where r.code = 'super_admin' and ra.revoked_at is null
       and up.tenant_id = (select tenant_id from public.parents where parent_code = 'PAR-T405-A')
     order by up.created_at limit 1;

    if v_sub is null then
        insert into t405_results values ('C12-staff-gate', false, 'no super_admin profile found to impersonate');
        return;
    end if;

    -- Impersonate the super_admin → the RPC returns the sandbox debtors.
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', v_sub, 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    set local role authenticated;
    begin
        select count(*) into v_rows from public.compute_debt_aging_summary('2026-06-15T12:00:00+00'::timestamptz) s
         where s.parent_id in (select id from public.parents where parent_code like 'PAR-T405-%');
    exception when others then
        v_rows := -1;
    end;
    insert into t405_results values ('C12-super-admin-allowed', v_rows = 5, 'rows=' || v_rows);

    -- Impersonate a role-less authenticated account (no role assignments)
    -- → the RPC refuses (has_any_role resolves nothing for a synthetic sub).
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-0000-0000-00000000dead', 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    begin
        perform public.compute_debt_aging_summary();
        insert into t405_results values ('C12-role-less-denied', false, 'role-less call DID NOT raise');
    exception when others then
        v_denied := position('forbidden' in sqlerrm) > 0 or position('staff' in sqlerrm) > 0;
        insert into t405_results values ('C12-role-less-denied', v_denied, 'raised: ' || sqlerrm);
    end;

    -- A second non-staff synthetic sub → same refusal (defense in depth).
    perform pg_catalog.set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-0000-0000-00000000beef', 'role', 'authenticated',
                          'app_metadata', json_build_object('tenant_id', v_tenant))::text, true);
    begin
        perform public.compute_debt_aging_summary();
        insert into t405_results values ('C12-non-staff-denied', false, 'non-staff call DID NOT raise');
    exception when others then
        insert into t405_results values ('C12-non-staff-denied', true, 'raised: ' || sqlerrm);
    end;
end $gate$;

-- ─── Report ──────────────────────────────────────────────────────────────
select check_id, ok, detail from t405_results order by check_id;

ROLLBACK;
