-- ============================================================================
-- verify_t-411.sql — T-411 Phase 1 (ADR-023 / BUSINESS-106 / BUSINESS-107),
-- migration 0115. Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK;
-- — re-runnable, never mutates. All logic inside a dollar-quoted DO block.
--
-- SANDBOX: run-unique probe parents + installments (tuition + transport).
--
-- CHECKS:
--   C1  registration + nullability (0115; both category columns nullable)
--   C2  CROSS-CATEGORY cash collection (p_category = NULL) allocates across
--       BOTH categories — the BUSINESS-106 critical fix; NULL payments row;
--       single ledger entry on parent:{id}:category:all
--   C3  payment_allocations written with CONCRETE categories (DATA-029)
--   C4  CLEARED-BRANCH INV-4: pending 50k + cash → capacity 50k only
--   C5  CLEARANCE OVERFLOW: over-allocated tranche caps at due−paid, excess
--       booked as parent_credit (BUSINESS-107)
--   C6  exact-category collection (T-060) still restricts (regression guard)
-- ============================================================================
BEGIN;

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';

create temp table t411_results (check_id text, ok boolean, detail text);

DO $$
DECLARE
  v_tenant uuid;
  v_parent uuid; v_parent2 uuid; v_parent3 uuid; v_parent4 uuid;
  v_ins3 uuid;
  v_result jsonb; v_result2 jsonb; v_result4 jsonb; v_clear jsonb;
  v_allocated numeric; v_unalloc numeric; v_tuition_paid numeric; v_transport_paid numeric;
  v_paid2 numeric; v_pending2 numeric; v_unalloc2 numeric;
  v_paid3 numeric; v_credit3 numeric;
BEGIN
  select id into v_tenant from tenants order by created_at limit 1;

  -- C1 ────────────────────────────────────────────────────────────────────
  insert into t411_results (check_id, ok, detail)
  select 'C1-registration-nullability',
    (select count(*) from supabase_migrations.schema_migrations where version = '0115') = 1
    and not (select attnotnull from pg_attribute where attrelid = 'public.payments'::regclass and attname = 'category')
    and not (select attnotnull from pg_attribute where attrelid = 'public.ledger_entries'::regclass and attname = 'category'),
    '0115 registered; both category columns nullable';

  -- C2: probe parent + cross-category installments ────────────────────────
  v_parent := gen_random_uuid();
  insert into parents (id, tenant_id, parent_code, first_name, last_name, primary_phone, created_at, updated_at)
  values (v_parent, v_tenant, 'PAR-T411-XCAT', 'Probe', 'T411Cross', '0554289100', now(), now());

  insert into students (id, tenant_id, parent_id, student_code, first_name, last_name, date_of_birth, created_at, updated_at)
  values (gen_random_uuid(), v_tenant, v_parent, 'ELV-T411-XCAT', 'Probe', 'T411Cross', '2015-01-01', now(), now());
  insert into installments (id, tenant_id, parent_id, student_id, category, label, tranche_number,
                            amount_due, amount_paid, amount_pending, due_date, status, created_at, updated_at)
  values
    (gen_random_uuid(), v_tenant, v_parent, (select id from students where parent_id = v_parent), 'tuition', 'T411 Tranche 1', 1, 80000, 0, 0, '2026-09-01', 'pending', now(), now()),
    (gen_random_uuid(), v_tenant, v_parent, (select id from students where parent_id = v_parent), 'transport', 'T411 Transport 1', 1, 20000, 0, 0, '2026-08-15', 'pending', now(), now());

  select to_jsonb(r) into v_result from collect_and_allocate_payment(
    p_tenant_id := v_tenant, p_parent_id := v_parent, p_student_id := null,
    p_amount := 100000, p_method := 'cash', p_category := null,
    p_installment_id := null, p_proof_path := null, p_notes := 'T411 cross-category probe',
    p_actor_id := null, p_actor_name := 'T411 Probe') r;

  v_allocated := ((v_result ->> 'total_allocated')::numeric);
  v_unalloc := ((v_result ->> 'unallocated_credit')::numeric);
  select sum(amount_paid) into v_tuition_paid from installments where parent_id = v_parent and category = 'tuition';
  select sum(amount_paid) into v_transport_paid from installments where parent_id = v_parent and category = 'transport';

  insert into t411_results (check_id, ok, detail)
  values ('C2-cross-category-allocates-both',
    v_allocated = 100000 and v_unalloc = 0
    and v_tuition_paid = 80000 and v_transport_paid = 20000,
    format('allocated=%s unalloc=%s tuition_paid=%s transport_paid=%s',
           v_allocated, v_unalloc, v_tuition_paid, v_transport_paid));

  insert into t411_results (check_id, ok, detail)
  values ('C2b-null-category-row-and-ledger',
    (select count(*) from payments p join ledger_entries le on le.source_id = p.id::text
      where p.parent_id = v_parent and p.category is null and le.category is null
        and le.account_id = 'parent:' || v_parent || ':category:all' and le.entry_type = 'payment') = 1,
    'payment row NULL category + single ledger entry on :category:all');

  -- C3 ────────────────────────────────────────────────────────────────────
  insert into t411_results (check_id, ok, detail)
  values ('C3-allocations-table-written',
    (select count(*) from payment_allocations pa join payments p on p.id = pa.payment_id
      where p.parent_id = v_parent) = 2
    and (select count(distinct pa.category) from payment_allocations pa join payments p on p.id = pa.payment_id
      where p.parent_id = v_parent) = 2,
    'two allocation rows, two distinct concrete categories');

  -- C4: cleared-branch INV-4 ──────────────────────────────────────────────
  v_parent2 := gen_random_uuid();
  insert into parents (id, tenant_id, parent_code, first_name, last_name, primary_phone, created_at, updated_at)
  values (v_parent2, v_tenant, 'PAR-T411-INV4', 'Probe', 'T411Inv4', '0554289200', now(), now());
  insert into students (id, tenant_id, parent_id, student_code, first_name, last_name, date_of_birth, created_at, updated_at)
  values (gen_random_uuid(), v_tenant, v_parent2, 'ELV-T411-INV4', 'Probe', 'T411Inv4', '2015-01-01', now(), now());
  insert into installments (id, tenant_id, parent_id, student_id, category, label, tranche_number,
                            amount_due, amount_paid, amount_pending, due_date, status, created_at, updated_at)
  values (gen_random_uuid(), v_tenant, v_parent2, (select id from students where parent_id = v_parent2), 'tuition', 'T411 Inv4 T1', 1, 100000, 0, 50000, '2026-09-01', 'pending_clearance', now(), now());

  select to_jsonb(r) into v_result2 from collect_and_allocate_payment(
    p_tenant_id := v_tenant, p_parent_id := v_parent2, p_student_id := null,
    p_amount := 100000, p_method := 'cash', p_category := 'tuition',
    p_installment_id := null, p_proof_path := null, p_notes := 'T411 INV-4 probe',
    p_actor_id := null, p_actor_name := 'T411 Probe') r;

  select amount_paid, amount_pending into v_paid2, v_pending2 from installments where parent_id = v_parent2;
  v_unalloc2 := ((v_result2 ->> 'unallocated_credit')::numeric);

  insert into t411_results (check_id, ok, detail)
  values ('C4-cleared-branch-inv4',
    v_paid2 = 50000 and v_pending2 = 50000 and (v_paid2 + v_pending2) = 100000 and v_unalloc2 = 50000,
    format('paid=%s pending=%s (sum must equal due 100000), credit=%s', v_paid2, v_pending2, v_unalloc2));

  -- C5: clearance overflow → parent_credit ────────────────────────────────
  v_parent3 := gen_random_uuid();
  insert into parents (id, tenant_id, parent_code, first_name, last_name, primary_phone, created_at, updated_at)
  values (v_parent3, v_tenant, 'PAR-T411-OVFL', 'Probe', 'T411Ovfl', '0554289300', now(), now());
  v_ins3 := gen_random_uuid();
  insert into students (id, tenant_id, parent_id, student_code, first_name, last_name, date_of_birth, created_at, updated_at)
  values (gen_random_uuid(), v_tenant, v_parent3, 'ELV-T411-OVFL', 'Probe', 'T411Ovfl', '2015-01-01', now(), now());
  insert into installments (id, tenant_id, parent_id, student_id, category, label, tranche_number,
                            amount_due, amount_paid, amount_pending, due_date, status, created_at, updated_at)
  values (v_ins3, v_tenant, v_parent3, (select id from students where parent_id = v_parent3), 'tuition', 'T411 Ovfl T1', 1, 100000, 80000, 40000, '2026-09-01', 'pending_clearance', now(), now());

  -- (probe only; the enforce_payment_proof trigger requires a path for checks)
  insert into payments (id, tenant_id, payment_number, receipt_number, parent_id, amount,
                        method, status, category, proof_path, check_number, check_bank_name, collected_at, created_at, updated_at)
  values (gen_random_uuid(), v_tenant, 'PAY-T411-OVFL', 'REC-T411-OVFL', v_parent3, 40000,
          'check', 'pending', 'tuition', 'tenant/probe/t411-proof.pdf',
          'T411-CHK-001', 'BNA', now(), now(), now());

  select to_jsonb(r) into v_clear from mark_payment_cleared(
    p_tenant_id := v_tenant,
    p_payment_id := (select id from payments where parent_id = v_parent3 limit 1),
    p_actor_id := null, p_actor_name := 'T411 Probe') r;

  select amount_paid into v_paid3 from installments where id = v_ins3;
  select coalesce(sum(-amount), 0) into v_credit3 from ledger_entries
    where parent_id = v_parent3 and category = 'parent_credit' and entry_type = 'adjustment'
      and description like 'Crédit parent (excédent de compensation%';

  insert into t411_results (check_id, ok, detail)
  values ('C5-clearance-overflow-to-credit',
    v_paid3 = 100000 and v_credit3 = 20000
    and ((v_clear ->> 'overflow_credit')::numeric) = 20000,
    format('paid capped at 100000 (got %s), overflow credit 20000 (got %s, rpc %s)',
           v_paid3, v_credit3, (v_clear ->> 'overflow_credit')));

  -- C6: exact-category regression guard ───────────────────────────────────
  v_parent4 := gen_random_uuid();
  insert into parents (id, tenant_id, parent_code, first_name, last_name, primary_phone, created_at, updated_at)
  values (v_parent4, v_tenant, 'PAR-T411-EXCT', 'Probe', 'T411Exact', '0554289400', now(), now());
  insert into students (id, tenant_id, parent_id, student_code, first_name, last_name, date_of_birth, created_at, updated_at)
  values (gen_random_uuid(), v_tenant, v_parent4, 'ELV-T411-EXCT', 'Probe', 'T411Exact', '2015-01-01', now(), now());
  insert into installments (id, tenant_id, parent_id, student_id, category, label, tranche_number,
                            amount_due, amount_paid, amount_pending, due_date, status, created_at, updated_at)
  values
    (gen_random_uuid(), v_tenant, v_parent4, (select id from students where parent_id = v_parent4), 'tuition', 'T411 Exact T', 1, 80000, 0, 0, '2026-09-01', 'pending', now(), now()),
    (gen_random_uuid(), v_tenant, v_parent4, (select id from students where parent_id = v_parent4), 'transport', 'T411 Exact X', 1, 20000, 0, 0, '2026-08-15', 'pending', now(), now());

  select to_jsonb(r) into v_result4 from collect_and_allocate_payment(
    p_tenant_id := v_tenant, p_parent_id := v_parent4, p_student_id := null,
    p_amount := 100000, p_method := 'cash', p_category := 'tuition',
    p_installment_id := null, p_proof_path := null, p_notes := 'T411 exact probe',
    p_actor_id := null, p_actor_name := 'T411 Probe') r;

  insert into t411_results (check_id, ok, detail)
  values ('C6-exact-category-still-restricts',
    (select sum(amount_paid) from installments where parent_id = v_parent4 and category = 'tuition') = 80000
    and (select sum(amount_paid) from installments where parent_id = v_parent4 and category = 'transport') = 0
    and ((v_result4 ->> 'unallocated_credit')::numeric) = 20000,
    'tuition-only filter left transport untouched and 20000 became credit');
END $$;

select check_id, ok, detail from t411_results order by check_id;

ROLLBACK;
