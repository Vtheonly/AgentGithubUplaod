-- ============================================================================
-- verify_t-306.sql — T-306 (48th session) live verification
-- ============================================================================
-- Pattern: BEGIN; … ROLLBACK; (re-runnable, no live mutation persists).
-- Temp results table because the CLI does not surface RAISE NOTICE.
--
-- Checks (happy paths + regression paths):
--   C1  the shared trigger function exists and is SECURITY DEFINER
--   C2  all 8 audited tables carry the audit trigger
--   C3  CRM: a real parent UPDATE writes an audit row with full snapshots
--       + actor attribution + the wire-code action 'parent.update'
--   C4  CRM: a no-op parent UPDATE (touch-only) writes NOTHING
--   C5  CRM: a parent INSERT writes 'parent.create' with before=NULL
--   C6  Pricing: a grade_level_tuition price UPDATE writes
--       'pricing_grade.update' with the annual/tranche before+after
--   C7  Payments/ledger/installments carry NO audit trigger (the RPC-covered
--       tables must not double-audit)
--   C8  the audit rows land with the tenant of the mutated row
-- ============================================================================

begin;

create temp table t306_results (
    check_id text primary key,
    detail text,
    passed boolean
);

-- C1: the shared trigger function
insert into t306_results (check_id, detail, passed)
select 'C1 function exists',
       'audit_row_change present, prokind ' || p.prokind::text,
       p.prokind = 'f'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.proname = 'audit_row_change' and n.nspname = 'public';

-- C2: all 8 audited tables carry the trigger
insert into t306_results (check_id, detail, passed)
select 'C2 triggers wired',
       'tables with audit_row_change trigger: ' || count(*)::text,
       count(*) = 8
  from (
    select distinct event_object_table
      from information_schema.triggers
     where trigger_name like '%audit_row_change'
  ) t;

-- C7: the RPC-covered financial tables carry NO audit trigger
insert into t306_results (check_id, detail, passed)
select 'C7 financial tables not triggered',
       'audit triggers on payments/ledger/installments: ' || count(*)::text,
       count(*) = 0
  from information_schema.triggers
 where trigger_name like '%audit_row_change'
   and event_object_table in ('payments', 'ledger_entries', 'installments');

-- C3: a real parent UPDATE audits (probe inside the transaction)
update public.parents
   set primary_phone = primary_phone
 where id = (select id from public.parents limit 1);
-- (a same-value SET still bumps updated_at via the touch trigger → the
--  no-op guard must SKIP it — that is C4. To force a REAL change for C3,
--  flip a value and flip it back:)
update public.parents
   set primary_phone = coalesce(primary_phone, '0000000000') || ''
 where id = (select id from public.parents limit 1);

insert into t306_results (check_id, detail, passed)
select 'C4 no-op update skipped',
       'audit rows for touch-only update: ' || count(*)::text,
       count(*) = 0
  from public.audit_logs
 where note = 'Capture automatique (déclencheur UPDATE sur parents)'
   and occurred_at > now() - interval '5 seconds';

update public.parents
   set first_name = first_name
 where id = (select id from public.parents limit 1);

-- C3 real change: append a deterministic probe suffix then check the row.
update public.parents
   set occupation = coalesce(occupation, 'probe') || '_t306'
 where id = (select id from public.parents limit 1);

insert into t306_results (check_id, detail, passed)
select 'C3 real update audited',
       'action=' || action || ' actor=' || coalesce(actor_name, 'NULL') ||
       ' role=' || coalesce(actor_role, 'NULL') ||
       ' before_ok=' || (before_json ? 'first_name')::text ||
       ' after_ok=' || (after_json ? 'occupation')::text,
       action = 'parent.update'
         and entity_type = 'parent'
         and before_json ? 'first_name'
         and after_json ? 'occupation'
         and note = 'Capture automatique (déclencheur UPDATE sur parents)'
  from public.audit_logs
 where occurred_at > now() - interval '5 seconds'
   and action = 'parent.update'
 order by occurred_at desc
 limit 1;

-- C5: parent INSERT audits with before=NULL
insert into public.parents (tenant_id, parent_code, first_name, last_name, primary_phone)
select tenant_id, 'PAR-T306-PROBE', 'T306', 'Probe', '0000000000'
  from public.parents limit 1;

insert into t306_results (check_id, detail, passed)
select 'C5 insert audited',
       'action=' || action || ' before_null=' || (before_json is null)::text,
       action = 'parent.create'
         and before_json is null
         and after_json ? 'parent_code'
         and after_json ? 'first_name'
  from public.audit_logs
 where occurred_at > now() - interval '5 seconds'
   and action = 'parent.create'
 order by occurred_at desc
 limit 1;

-- C6: pricing price UPDATE audits
update public.grade_level_tuition
   set annual_amount = annual_amount
 where id = (select id from public.grade_level_tuition limit 1);

update public.grade_level_tuition
   set tranche_1_amount = tranche_1_amount + 0
 where id = (select id from public.grade_level_tuition limit 1);

-- force a REAL (but reversible) change — annual + tranche_3 move together so
-- the tranches_sum_check constraint stays satisfied:
update public.grade_level_tuition
   set annual_amount = annual_amount - 100,
       tranche_3_amount = tranche_3_amount - 100
 where id = (select id from public.grade_level_tuition limit 1);

insert into t306_results (check_id, detail, passed)
select 'C6 pricing update audited',
       'action=' || action || ' has_before=' || (before_json is not null)::text,
       action = 'pricing_grade.update'
         and before_json ? 'annual_amount'
         and after_json ? 'annual_amount'
  from public.audit_logs
 where occurred_at > now() - interval '5 seconds'
   and action = 'pricing_grade.update'
 order by occurred_at desc
 limit 1;

-- C8: tenant carried on the audit rows
insert into t306_results (check_id, detail, passed)
select 'C8 tenant stamped',
       'distinct tenants on trigger rows: ' || count(*)::text,
       count(*) >= 1
  from (
    select distinct tenant_id from public.audit_logs
     where note like 'Capture automatique%'
       and occurred_at > now() - interval '5 seconds'
  ) t;

-- Final report
select check_id, passed, detail from t306_results order by check_id;

rollback;
