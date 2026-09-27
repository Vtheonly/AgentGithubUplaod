-- ============================================================================
-- 0123_financial_read_rpcs.sql — T-423 (PERF-505, GitHub issue #23 Phase B):
-- the SECURITY DEFINER read RPCs for the financial collections
-- ============================================================================
-- WHAT THIS ADDS (and nothing else — the 0111 pattern, applied to the read
-- path the Finances page's seeds consume):
--
--   1. public.read_payments_collection() → jsonb — the tenant's payments,
--      in PRIMARY-KEY order as ONE jsonb array (immune to PostgREST's
--      1,000-row response cap by construction; the client restores the
--      display order in-memory — see the ordering note in section 1).
--   2. public.read_installments_collection() → jsonb — the tenant's
--      installments (PK order; the client sorts due_date asc in-memory).
--   3. public.read_ledger_entries_collection() → jsonb — the tenant's
--      ledger entries (PK order; the client sorts entry_date desc in-memory).
--   4. public.read_debt_summary_collection() → jsonb — the per-parent
--      debtor aggregates the desktop's SupabaseDebtRepository.readSummaries
--      computed client-side over THREE direct reads (unpaid installments +
--      parent names + student counts), each capped at 1,000 rows
--      (DATA-038/DATA-040): one row per parent with unpaid remaining,
--      carrying the RAW display fields (display_name, first_name,
--      last_name, primary_phone, oldest_due_date, student_count) so the
--      client mapper keeps every display decision (name fallback, aging
--      bucket, daysOverdue) — the RPC is a data transport, not a
--      presentation layer. The outstanding basis is the §15 installment
--      basis (INV-4): greatest(0, amount_due − amount_paid −
--      amount_pending) over status <> 'paid' rows, parents with
--      Σremaining > 0 only — byte-identical to the TS formula it replaces.
--
-- WHY (the live evidence — T-422 §3.5, the flakiness meter, two rounds):
-- the DIRECT RLS-filtered PostgREST reads of these tables take 6.5–19.9 s
-- at 80–90% per-attempt success with 57014 statement-timeout hard-fails
-- (the per-row RLS policy-function chain the structural suspect), while
-- compute_debt_aging_summary (migration 0111, SECURITY DEFINER — bypasses
-- the per-row policy chain) returns the same tenant's truth in 0.8–1.5 s
-- at 100% across ten measured rounds. These RPCs give the collections the
-- same immunity.
--
-- GATES (the 0111 conventions — §15.34 grants lesson):
--   * staff roles only: has_any_role(super_admin, financial_officer,
--     support_staff) — the installments_select staff branch (the desktop
--     Finances page is a staff surface; the portal reads per-parent under
--     its own RLS policies and does NOT call these);
--   * tenant scope via current_tenant_id() (the canonical resolver);
--   * revoke EXECUTE from anon AND public explicitly, grant to
--     authenticated (the gate does the authorization).
--
-- Registration: the T-091/MIG-TOKENS embedded block (atomic with the DDL
-- for the Management-API live application; idempotent via ON CONFLICT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The payments collection (staff-gated, tenant-scoped, jsonb payload)
-- ----------------------------------------------------------------------------
create or replace function public.read_payments_collection()
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $$
declare
    v_tenant uuid;
    v_result jsonb;
begin
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: financial collections are a staff surface';
    end if;
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    select coalesce(
        -- T-423: NO server-side sort by unindexed columns (the live
        -- EXPLAIN attribution — the due_date/collected_at sorts cost the
        -- same top-N sort that made the direct reads slow; the CLIENT
        -- restores the display order in-memory, which is free at these
        -- sizes). Primary-key order keeps the payload deterministic.
        jsonb_agg(to_jsonb(p) order by p.id),
        '[]'::jsonb
    )
      into v_result
      from public.payments p
     where p.tenant_id = v_tenant;

    return v_result;
end;
$$;

comment on function public.read_payments_collection is
    'T-423 (PERF-505): the staff read RPC for the payments collection — one jsonb array (immune to the 1000-row cap), PK order (the client restores the display order; no server-side sort by unindexed columns — the live EXPLAIN attribution). SECURITY DEFINER: bypasses the per-row RLS policy chain that makes the direct reads 6.5-19.9s at 80-90% (live-measured, issue #23).';

-- ----------------------------------------------------------------------------
-- 2. The installments collection
-- ----------------------------------------------------------------------------
create or replace function public.read_installments_collection()
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $$
declare
    v_tenant uuid;
    v_result jsonb;
begin
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: financial collections are a staff surface';
    end if;
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    select coalesce(
        jsonb_agg(to_jsonb(i) order by i.id),
        '[]'::jsonb
    )
      into v_result
      from public.installments i
     where i.tenant_id = v_tenant;

    return v_result;
end;
$$;

comment on function public.read_installments_collection is
    'T-423 (PERF-505): the staff read RPC for the installments collection — one jsonb array, PK order (the client sorts due_date asc in-memory). The whole 5,963-row schedule in one round trip (the Tranches tab T1+T2+T3 fix).';

-- ----------------------------------------------------------------------------
-- 3. The ledger entries collection
-- ----------------------------------------------------------------------------
create or replace function public.read_ledger_entries_collection()
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $$
declare
    v_tenant uuid;
    v_result jsonb;
begin
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: financial collections are a staff surface';
    end if;
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    select coalesce(
        jsonb_agg(to_jsonb(e) order by e.id),
        '[]'::jsonb
    )
      into v_result
      from public.ledger_entries e
     where e.tenant_id = v_tenant;

    return v_result;
end;
$$;

comment on function public.read_ledger_entries_collection is
    'T-423 (PERF-505): the staff read RPC for the ledger entries collection — one jsonb array, PK order (the client sorts entry_date desc in-memory). The full ledger (the old .limit(2000) was capped at 1,000 of 3,342 by PostgREST).';

-- ----------------------------------------------------------------------------
-- 4. The debt-summary collection (the readSummaries computation, server-side)
-- ----------------------------------------------------------------------------
create or replace function public.read_debt_summary_collection()
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $$
declare
    v_tenant uuid;
    v_result jsonb;
begin
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: financial collections are a staff surface';
    end if;
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
        raise exception 'forbidden: no tenant context';
    end if;

    -- The TS formula it mirrors (SupabaseDebtRepository.readSummaries):
    --   remaining = greatest(0, due − paid − pending) over status <> 'paid';
    --   skip rows with remaining <= 0; per parent: Σremaining, days from the
    --   OLDEST remaining row (the TS takes the max days-over-due — the same
    --   value); student_count = the per-parent count of students rows
    --   (tenant-scoped, deliberately NO deleted_at filter — bit-parity with
    --   the current display). RAW display fields returned; the client maps.
    with unpaid as (
        select i.parent_id,
               i.id,
               greatest(0, i.amount_due - i.amount_paid - i.amount_pending) as remaining,
               i.due_date
          from public.installments i
         where i.tenant_id = v_tenant
           and i.status <> 'paid'
    ),
    filtered as (
        select * from unpaid where remaining > 0
    ),
    per_parent as (
        select parent_id,
               sum(remaining) as outstanding_amount,
               min(due_date) as oldest_due_date
          from filtered
         group by parent_id
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'parent_id', pp.parent_id,
                'display_name', p.display_name,
                'first_name', p.first_name,
                'last_name', p.last_name,
                'primary_phone', p.primary_phone,
                'outstanding_amount', pp.outstanding_amount,
                'oldest_due_date', to_char(pp.oldest_due_date, 'YYYY-MM-DD'),
                'student_count', (
                    select count(*)
                      from public.students s
                     where s.tenant_id = v_tenant
                       and s.parent_id = pp.parent_id
                )
            )
            order by pp.outstanding_amount desc, pp.parent_id
        ),
        '[]'::jsonb
    )
      into v_result
      from per_parent pp
      join public.parents p
        on p.id = pp.parent_id
       and p.tenant_id = v_tenant;

    return v_result;
end;
$$;

comment on function public.read_debt_summary_collection is
    'T-423 (PERF-505 + DATA-038/DATA-040): the per-parent debtor aggregates (the §15 installment basis — INV-4 remaining over unpaid installments) in one jsonb array. Replaces the client-side three-read computation that PostgREST capped at 1,000 rows per read. Raw display fields; the client keeps every display decision.';

-- ----------------------------------------------------------------------------
-- 5. Grants (§15.34: revoke from anon AND public explicitly — the platform
--    default privileges grant anon EXECUTE on new functions)
-- ----------------------------------------------------------------------------
revoke execute on function public.read_payments_collection() from anon, public;
revoke execute on function public.read_installments_collection() from anon, public;
revoke execute on function public.read_ledger_entries_collection() from anon, public;
revoke execute on function public.read_debt_summary_collection() from anon, public;
grant execute on function public.read_payments_collection() to authenticated;
grant execute on function public.read_installments_collection() to authenticated;
grant execute on function public.read_ledger_entries_collection() to authenticated;
grant execute on function public.read_debt_summary_collection() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Registration (T-091/MIG-TOKENS — atomic with the DDL for the
--    Management-API live application; idempotent via ON CONFLICT)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0123', '{0123_financial_read_rpcs.sql}', 'financial_read_rpcs')
on conflict (version) do nothing;
