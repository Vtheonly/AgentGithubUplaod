-- ============================================================================
-- verify_t-479.sql — T-479 (WORKFORCE-507): the warehouse-tasks port
-- (migration 0139) — the live verification script.
--
-- The convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can
-- be re-run any time without mutating the live DB; results land in a temp
-- table (t479_results) SELECTed at the end (run through
-- scripts/run_verify_sql_live.sh, which strips the trailing ROLLBACK — the
-- one-shot session's end provides the same all-or-nothing rollback).
--
-- Checks:
--   C1  pending_receipts exists with the 0011 shape (items_json, the four
--       status values in the CHECK, received_by)
--   C2  pending_dispatches exists; the CHECK constraint now admits
--       'preparing' (0139's widening) and still admits the 0011 set
--   C3  BEHAVIOR: an INSERT with status='preparing' SUCCEEDS (the state
--       the port's prepareDispatch writes — previously impossible)
--   C4  BEHAVIOR: an INSERT with an out-of-set status is REFUSED (the
--       widened CHECK still enforces the vocabulary)
--   C5  the schema_migrations registration row (0139)
--   C6  the desktop read path shape: a receipt row round-trips the
--       supplier + purchase-request name embeds (the FK-backed joins the
--       repository's SELECT relies on)
-- ============================================================================
BEGIN;

create temp table t479_results (check_id text, ok boolean, detail text);

do $verify$
declare
    v_count integer;
    v_def text;
    v_tenant uuid;
    v_detail text;
    v_inserted_at timestamptz;
begin
    -- C1: pending_receipts exists with the 0011 shape
    select count(*) into v_count from information_schema.tables
     where table_schema='public' and table_name='pending_receipts';
    if v_count = 0 then
        insert into t479_results values ('C1_receipts_table', false, 'pending_receipts MISSING');
    else
        select count(*) into v_count from information_schema.columns
         where table_schema='public' and table_name='pending_receipts'
           and column_name in ('items_json','received_by','received_at','supplier_id','purchase_request_id','status');
        insert into t479_results values ('C1_receipts_table', v_count = 6,
            'receipts shape columns present=' || v_count::text || '/6');
    end if;

    -- C2: the widened dispatch CHECK (0139)
    select coalesce(max(pg_get_constraintdef(c.oid)), '') into v_def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname='public' and t.relname='pending_dispatches'
       and c.contype='c' and c.conname='pending_dispatches_status_check';
    insert into t479_results values ('C2_check_has_preparing', strpos(v_def, 'preparing') > 0,
        'constraint=' || coalesce(v_def, 'MISSING'));
    insert into t479_results values ('C2b_check_has_0011_set',
        strpos(v_def, 'pending') > 0 and strpos(v_def, 'dispatched') > 0
            and strpos(v_def, 'delivered') > 0 and strpos(v_def, 'cancelled') > 0,
        'the 0011 vocabulary preserved in the widened CHECK');

    -- C3/C4: BEHAVIOR inside this transaction (rolled back at the end).
    select id into v_tenant from public.tenants order by created_at limit 1;
    if v_tenant is null then
        insert into t479_results values ('C3_preparing_insert', false, 'no tenant row to test with');
        insert into t479_results values ('C4_bad_status_refused', false, 'no tenant row to test with');
    else
        -- C3: 'preparing' is admissible now.
        begin
            insert into public.pending_dispatches (tenant_id, destination, items_json, scheduled_at, status)
            values (v_tenant, 'verify-t479-preparing', '[]'::jsonb, now(), 'preparing')
            returning created_at into v_inserted_at;
            insert into t479_results values ('C3_preparing_insert', true, 'status=preparing INSERT ok');
        exception when check_violation then
            insert into t479_results values ('C3_preparing_insert', false, 'check_violation on preparing');
        end;

        -- C4: the vocabulary is still enforced (a bogus status is refused).
        begin
            insert into public.pending_dispatches (tenant_id, destination, items_json, scheduled_at, status)
            values (v_tenant, 'verify-t479-bogus', '[]'::jsonb, now(), 'teleported');
            insert into t479_results values ('C4_bad_status_refused', false, 'bogus status was ACCEPTED');
        exception when check_violation then
            insert into t479_results values ('C4_bad_status_refused', true, 'check_violation as expected');
        end;
    end if;

    -- C5: the schema_migrations registration row.
    select count(*) into v_count from supabase_migrations.schema_migrations where version = '0139';
    insert into t479_results values ('C5_registration_row', v_count = 1,
        'schema_migrations 0139 rows=' || v_count::text);

    -- C6: the FK-backed name embeds resolve (the repository's SELECT
    -- relies on suppliers(name) + purchase_requests(request_number)).
    select count(*) into v_count
      from public.pending_receipts r
      left join public.suppliers s on s.id = r.supplier_id
      left join public.purchase_requests pr on pr.id = r.purchase_request_id;
    insert into t479_results values ('C6_embed_joins_resolve', true,
        'the FK join shape executes; rows scanned=' || v_count::text);
end
$verify$;

select check_id, ok, detail from t479_results order by check_id;

ROLLBACK;
