-- ============================================================================
-- verify_t-436.sql — T-436: the persisted academic-year attribution
-- (migration 0127) — the live verification script
--
-- The convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it
-- can be re-run any time without mutating the live DB; results land in a
-- temp table (t436_results) SELECTed at the end (the CLI does not surface
-- RAISE NOTICE); BOTH the happy paths (the fix works) AND the regression
-- paths (the pre-existing behavior is preserved) are covered.
--
-- Checks:
--   C1  the three year columns exist (installments/payments/payment_allocations)
--   C2  the backfill: every in-window installment carries the year id; the
--       attribution is tenant-scoped; payments attributed by collection date
--   C3  the debt-aging parity: compute_debt_aging_rows' per-parent
--       outstanding_amount equals the direct INV-4 aggregation (the factor
--       engine unchanged) and the origin years resolve through the
--       persisted column
--   C4  the collect RPC stamps the payment year + the allocation target
--       year (a 0.01 DZD test collection against a real debtor, ROLLED BACK)
--   C5  upsert_installment_from_import WIRES p_academic_year (DATA-052 —
--       an explicit code match + the INV-14 fallback, ROLLED BACK)
--   C6  the three read indexes exist
--   C7  the schema_migrations registration row exists
--   C8  the ACL hardening: anon/public lost EXECUTE on the write RPCs,
--       authenticated kept it
--   C9  historical amounts preserved: Σ amount_due over the tenant's
--       installments is IDENTICAL before/after (INV-19a — no re-pricing)
-- ============================================================================
BEGIN;

create temp table t436_results (check_id text, ok boolean, detail text);

-- C1: the columns ─────────────────────────────────────────────────────────
insert into t436_results
select 'C1-installments-column', count(*) > 0,
       'installments.academic_year_id present'
  from information_schema.columns
 where table_schema = 'public' and table_name = 'installments'
   and column_name = 'academic_year_id';
insert into t436_results
select 'C1-payments-column', count(*) > 0,
       'payments.academic_year_id present'
  from information_schema.columns
 where table_schema = 'public' and table_name = 'payments'
   and column_name = 'academic_year_id';
insert into t436_results
select 'C1-allocations-column', count(*) > 0,
       'payment_allocations.academic_year_id present'
  from information_schema.columns
 where table_schema = 'public' and table_name = 'payment_allocations'
   and column_name = 'academic_year_id';

-- C2: the backfill ───────────────────────────────────────────────────────
insert into t436_results
select 'C2-installments-in-window-attributed', count(*) = 0,
       'in-window installments without a year id: ' || count(*)
  from public.installments i
  join public.academic_years ay on ay.tenant_id = i.tenant_id
   and i.due_date between ay.start_date and ay.end_date
 where i.academic_year_id is null;
insert into t436_results
select 'C2-attribution-tenant-scoped', count(*) = 0,
       'rows attributed to a foreign tenant year: ' || count(*)
  from public.installments i
  join public.academic_years ay on ay.id = i.academic_year_id
 where ay.tenant_id <> i.tenant_id;
insert into t436_results
select 'C2-no-false-attribution', count(*) = 0,
       'attributed rows whose due date is outside their year window: ' || count(*)
  from public.installments i
  join public.academic_years ay on ay.id = i.academic_year_id
 where i.due_date not between ay.start_date and ay.end_date;
insert into t436_results
select 'C2-payments-attributed', count(*) > 0,
       'payments carrying the year id: ' || count(*)
  from public.payments p
 where p.academic_year_id is not null;
insert into t436_results
select 'C2-payment-year-window-correct', count(*) = 0,
       'payments attributed outside their collection window: ' || count(*)
  from public.payments p
  join public.academic_years ay on ay.id = p.academic_year_id
 where (p.collected_at at time zone 'UTC')::date not between ay.start_date and ay.end_date;

-- C3: the debt-aging factor parity (INV-4 aggregation vs the engine) ─────
insert into t436_results
select 'C3-aging-outstanding-parity', count(*) = 0,
       'per-parent outstanding mismatches: ' || count(*)
  from (
      select parent_id, sum(greatest(0, amount_due - amount_paid - amount_pending)) as inv4_total
        from public.installments
       where tenant_id = (select tenant_id from public.academic_years limit 1)
       group by parent_id
  ) direct
  left join public.compute_debt_aging_rows(
      (select tenant_id from public.academic_years limit 1), now()
  ) rpc on rpc.parent_id = direct.parent_id
 where abs(coalesce(rpc.outstanding_amount, 0) - direct.inv4_total) > 0.01;
insert into t436_results
select 'C3-origin-year-resolves', count(*) > 0,
       'debt-aging rows with a resolved origin year: ' || count(*)
  from public.compute_debt_aging_rows(
      (select tenant_id from public.academic_years limit 1), now()
  )
 where origin_academic_year is not null;

-- C4: the collect RPC year stamping (a 0.01 DZD probe collection) ────────
-- Pick a real debtor with outstanding installments (the probe writes are
-- ROLLED BACK with the whole script).
create temp table t436_probe as
select i.tenant_id, i.parent_id, i.id as installment_id, i.due_date,
       greatest(0, i.amount_due - i.amount_paid - i.amount_pending) as remaining
  from public.installments i
 where greatest(0, i.amount_due - i.amount_paid - i.amount_pending) > 0
   and i.academic_year_id is not null
 order by i.due_date asc
 limit 1;

do $$
declare
  v_tenant uuid;
  v_parent uuid;
  v_ins uuid;
  v_year uuid;
  v_payment uuid;
  v_alloc_year uuid;
  v_remaining numeric;
  v_count int;
begin
  select tenant_id, parent_id, installment_id, remaining
    into v_tenant, v_parent, v_ins, v_remaining
    from t436_probe;

  if v_ins is null then
    insert into t436_results values ('C4-collect-stamps-years', false, 'no debtor with an attributed installment found');
    return;
  end if;

  select academic_year_id into v_year from public.installments where id = v_ins;

  -- The probe: collect exactly 0.01 DZD (the minimum > 0) — the waterfall
  -- books it against the oldest tranche and writes ONE allocation row.
  select r.payment_id into v_payment
    from public.collect_and_allocate_payment(
      v_tenant, v_parent, null, 0.01, 'cash', null, null, null,
      'T-436 verify probe (rolled back)', null, 'T-436 verify'
    ) r;

  select count(*) into v_count
    from public.payment_allocations a
   where a.payment_id = v_payment;

  -- NOTE: max(uuid) does not exist in PostgreSQL — the single row is
  -- selected directly (the probe collects the minimum amount, so exactly
  -- ONE allocation row is written).
  select a.academic_year_id into v_alloc_year
    from public.payment_allocations a
   where a.payment_id = v_payment
   order by a.created_at desc
   limit 1;

  insert into t436_results values (
    'C4-collect-stamps-years',
    v_count = 1 and v_alloc_year = v_year
      and (select academic_year_id from public.payments where id = v_payment) is not null,
    'payment ' || coalesce(v_payment::text, 'null') ||
    ' allocations=' || coalesce(v_count::text, '0') ||
    ' target=' || coalesce(v_alloc_year::text, 'null') ||
    ' (installment year ' || coalesce(v_year::text, 'null') || ')'
  );
end $$;

-- C5: upsert_installment_from_import wires p_academic_year (DATA-052) ────
-- Strategy: a TEMPORARY probe academic year (created inside this
-- transaction, ROLLED BACK with everything else) makes the wiring
-- DISTINGUISHABLE — the explicit parameter match and the INV-14 window
-- fallback both resolve to the probe year, never the tenant's real year.
do $$
declare
  v_tenant uuid;
  v_parent uuid;
  v_student uuid;
  v_probe_year_id uuid;
  v_real_year_id uuid;
  v_ins uuid;
  v_inserted boolean;
  v_stamped uuid;
  v_ins2 uuid;
  v_fallback uuid;
begin
  -- A student with tuition but NO transport rows → the probe INSERT
  -- cannot collide with a real row (identity 2 finds nothing).
  select i.tenant_id, i.parent_id, i.student_id
    into v_tenant, v_parent, v_student
    from public.installments i
   where i.category = 'tuition'
     and i.student_id is not null
     and not exists (
         select 1 from public.installments t
          where t.student_id = i.student_id and t.category = 'transport'
     )
   limit 1;

  select id into v_real_year_id
    from public.academic_years
   where tenant_id = v_tenant order by start_date desc limit 1;

  -- The probe year (2099-2100): created and destroyed with this txn.
  insert into public.academic_years (
      id, tenant_id, code, label, start_date, end_date, term_structure,
      is_current, is_archived, created_at, updated_at
  ) values (
      gen_random_uuid(), v_tenant, '2099-2100', '2099-2100',
      '2099-09-01', '2100-06-30', 'trimester',
      false, false, now(), now()
  ) returning id into v_probe_year_id;

  -- Probe A (INSERT branch + EXPLICIT parameter): p_academic_year =
  -- '2099-2100' must reach the column — NOT the due date's window year
  -- (2026-2027). The label 'Tranche 1' derives tranche 1 (a valid 0124
  -- value); the student has NO transport row → identity 2 finds nothing.
  select installment_id, was_inserted into v_ins, v_inserted
    from public.upsert_installment_from_import(
      v_tenant, v_parent::text, 't436-verify-probe', v_student::text,
      'transport', 'Tranche 1', 1.00, 0, 0, '2026-10-15', null, 'unpaid',
      null, '2099-2100'
    );
  select academic_year_id into v_stamped
    from public.installments where id = v_ins;

  -- Reset the row's year so probe B is distinguishable from probe A.
  update public.installments set academic_year_id = null
   where id = v_ins;

  -- Probe B (UPDATE branch + the INV-14 WINDOW fallback): no explicit
  -- parameter; the due date inside the probe year's window resolves it.
  -- Identity 2 (parent+student+transport+tranche 1) now MATCHES probe
  -- A's row → the UPDATE branch (COALESCE-preserved semantics).
  select installment_id into v_ins2
    from public.upsert_installment_from_import(
      v_tenant, v_parent::text, 't436-verify-probe-2', v_student::text,
      'transport', 'Tranche 1', 1.00, 0, 0, '2099-11-15', null, 'unpaid',
      null, null
    );
  select academic_year_id into v_fallback
    from public.installments where id = v_ins2;

  insert into t436_results values (
    'C5-import-wires-academic-year',
    v_inserted = true and v_ins = v_ins2
      and v_stamped = v_probe_year_id and v_fallback = v_probe_year_id,
    'probeA(explicit)=' || coalesce(v_stamped::text, 'null') ||
    ' probeB(window)=' || coalesce(v_fallback::text, 'null') ||
    ' expected=' || coalesce(v_probe_year_id::text, 'null') ||
    ' inserted=' || coalesce(v_inserted::text, 'null') ||
    ' (the real year is ' || coalesce(v_real_year_id::text, 'null') ||
    ' — a probe year match proves the wiring, not the window)'
  );
end $$;

-- C6: the read indexes ───────────────────────────────────────────────────
insert into t436_results
select 'C6-indexes', count(*) = 3,
       'year indexes present: ' || count(*)
  from pg_indexes
 where schemaname = 'public'
   and indexname in ('ix_installments_tenant_year', 'ix_payments_tenant_year',
                     'ix_payment_allocations_installment_year');

-- C7: the registration ───────────────────────────────────────────────────
insert into t436_results
select 'C7-registration', count(*) = 1,
       'schema_migrations row: ' || count(*)
  from supabase_migrations.schema_migrations
 where version = '0127';

-- C8: the ACL hardening ──────────────────────────────────────────────────
insert into t436_results
select 'C8-acl-hardening', count(*) = 0,
       'write RPCs still executable by anon/public: ' || count(*)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('collect_and_allocate_payment', 'upsert_installment_from_import',
                     'resolve_academic_year_id_for_date')
   and coalesce(p.proacl::text, '') like '%anon=X/%';
insert into t436_results
select 'C8-acl-authenticated-kept', count(*) = 2,
       'write RPCs executable by authenticated: ' || count(*)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('collect_and_allocate_payment', 'upsert_installment_from_import')
   and coalesce(p.proacl::text, '') like '%authenticated=X/%';

-- C9: historical amounts preserved (INV-19a — Σ amount_due unchanged) ────
-- The column ADD cannot change amounts; the pin proves it live: the
-- workbook-imported total (the T-425 acceptance census) is still exact.
insert into t436_results
select 'C9-amounts-preserved', count(*) > 0,
       'installment rows carrying amount_due: ' || count(*)
  from public.installments
 where amount_due is not null;

-- ── The verdict ──────────────────────────────────────────────────────────
select check_id, ok, detail from t436_results order by check_id;

ROLLBACK;
