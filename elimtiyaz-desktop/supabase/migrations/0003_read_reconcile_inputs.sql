-- ============================================================================
-- 0003_read_reconcile_inputs.sql
-- T-591 (E7A-2 / ROADMAP 6.4) — the targeted projections lane's server half.
--
-- WHAT: `read_reconcile_inputs()` — ONE column-projected, tenant-scoped,
-- staff-gated jsonb round trip carrying the reconciliation trio's EXACT
-- input shapes (the payments / installments / parents projections the
-- client-side cross-checks consume).
--
-- WHY (BUG-061 + BUG-069/BUG-072 — the S24/C-27 census): the desktop's
-- `reconcile()` previously issued THREE unbounded `select("*")` reads with
-- NO tenant scope and NO limit (`supabase-shared-repositories.ts:3418-3422`)
-- — the integrity-check surface ran on TRUNCATED inputs (PostgREST's
-- 1,000-row cap) and the reads were not even tenant-scoped. The
-- RELOCATION-GUIDE's Path-2 verification gates depend on this surface; an
-- integrity check must never run on a sample.
--
-- THE CONTRACT (the parity-pinned shapes — see the t-591 suite):
--   payments      → {id, amount, status, receipt_number, payment_number, installment_id}
--   installments  → {id, parent_id, student_id, category, amount_due, amount_paid, label, tranche_number, status}
--   parents       → {id, first_name, last_name, display_name}
--
-- APPEND-ONLY (OPS-020): 0001/0002 untouched; this file appends as 0003.
-- ============================================================================

create or replace function public.read_reconcile_inputs()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
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

    -- ONE round trip: the three projections in one jsonb object. The
    -- payments/installments legs are the financial collections (the same
    -- audience as read_payments_collection / read_installments_collection);
    -- the parents leg is the summary display-name join. Column-projected —
    -- never `select "*"`; tenant-scoped by construction (current_tenant_id);
    -- UNBOUNDED by design and by RIGHT (an integrity check reads the whole
    -- tenant population — the point of the RPC is that the single jsonb
    -- round trip carries it immune to the per-read 1,000-row cap, the same
    -- read_*_collection contract established in 0123/T-423).
    select jsonb_build_object(
        'payments', coalesce((
            select jsonb_agg(jsonb_build_object(
                    'id', p.id,
                    'amount', p.amount,
                    'status', p.status,
                    'receipt_number', p.receipt_number,
                    'payment_number', p.payment_number,
                    'installment_id', p.installment_id
                ) order by p.id)
              from public.payments p
             where p.tenant_id = v_tenant
        ), '[]'::jsonb),
        'installments', coalesce((
            select jsonb_agg(jsonb_build_object(
                    'id', i.id,
                    'parent_id', i.parent_id,
                    'student_id', i.student_id,
                    'category', i.category,
                    'amount_due', i.amount_due,
                    'amount_paid', i.amount_paid,
                    'label', i.label,
                    'tranche_number', i.tranche_number,
                    'status', i.status
                ) order by i.id)
              from public.installments i
             where i.tenant_id = v_tenant
        ), '[]'::jsonb),
        'parents', coalesce((
            select jsonb_agg(jsonb_build_object(
                    'id', par.id,
                    'first_name', par.first_name,
                    'last_name', par.last_name,
                    'display_name', par.display_name
                ) order by par.id)
              from public.parents par
             where par.tenant_id = v_tenant
        ), '[]'::jsonb)
    ) into v_result;

    return v_result;
end;
$function$
;
comment on function read_reconcile_inputs() is 'T-591 (E7A-2): the reconcile trio''s column-projected inputs in ONE tenant-scoped jsonb round trip — the integrity-check surface never runs on truncated or unscoped reads again (BUG-061/069/072). The Path-2 verification prerequisite.';
