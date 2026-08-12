-- ============================================================================
-- 0025_waterfall_allocation.sql
-- ============================================================================
-- Waterfall Allocation Engine — atomic payment-to-installment distribution.
--
-- Implements the architectural blueprint's "Waterfall Tranche Satisfaction"
-- requirement: when a payment is submitted without a specific `installment_id`,
-- distribute it across the parent's unpaid installments in chronological
-- order (oldest first). Any excess becomes parent credit.
--
-- Guarantees:
--   1. sum(allocated amounts) + unallocated_amount = p_payment_amount
--   2. Ledger (single payment credit) ↔ Installment table (N partial updates)
--      stay mathematically consistent.
--   3. Each installment touched is audit-logged with before/after state.
--   4. Overpayment is recorded as parent credit for traceability.
--
-- This RPC is designed to be called by the collect-payment Edge Function
-- immediately AFTER `collect_payment()` has created the payment + ledger
-- entry. The payment_id from collect_payment() is passed in to link the
-- allocation to the payment for audit trail.
-- ============================================================================

-- ============================================================================
-- allocate_payment_waterfall — distribute a payment across unpaid installments
-- ============================================================================
create or replace function public.allocate_payment_waterfall(
    p_tenant_id uuid,
    p_parent_id uuid,
    p_payment_id uuid,
    p_payment_amount numeric,
    p_category_filter text default null,  -- 'tuition' | 'transport' | null = all
    p_actor_profile_id uuid default null
)
returns table(
    installment_id uuid,
    allocated_amount numeric,
    new_amount_paid numeric,
    new_status text,
    fully_satisfied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_remaining numeric := p_payment_amount;
    v_installment record;
    v_installment_remaining numeric;
    v_allocate numeric;
    v_new_amount_paid numeric;
    v_new_status text;
    v_fully_satisfied boolean;
    v_unallocated numeric;
    v_audit_id uuid;
    v_count integer := 0;
begin
    -- Lock the parent's installments for the duration of the transaction
    -- to prevent concurrent waterfall allocations from racing each other.
    -- We use FOR UPDATE inside the loop on each row.
    -- NOTE: ORDER BY due_date ASC ensures chronological (oldest-first) allocation.

    for v_installment in
        select i.id, i.amount_due, i.amount_paid, i.due_date, i.status, i.category
          from public.installments i
         where i.tenant_id = p_tenant_id
           and i.parent_id = p_parent_id
           and i.status <> 'paid'
           and (p_category_filter is null or i.category = p_category_filter)
         order by i.due_date asc, i.id asc
         for update of i
    loop
        exit when v_remaining <= 0.001;

        v_installment_remaining := greatest(0, v_installment.amount_due - v_installment.amount_paid);
        continue when v_installment_remaining <= 0;

        v_allocate := least(v_remaining, v_installment_remaining);
        v_new_amount_paid := v_installment.amount_paid + v_allocate;
        v_fully_satisfied := (v_new_amount_paid >= v_installment.amount_due);

        if v_fully_satisfied then
            v_new_status := 'paid';
        elsif v_new_amount_paid > 0 then
            v_new_status := 'partial';
        else
            v_new_status := v_installment.status;
        end if;

        -- Update the installment row. The update_installment_status() trigger
        -- (defined in 0007_financial.sql) will recompute status if needed,
        -- but we set it explicitly here for clarity.
        update public.installments
           set amount_paid = v_new_amount_paid,
               status = v_new_status,
               paid_date = case when v_fully_satisfied then current_date else paid_date end,
               updated_at = now()
         where id = v_installment.id;

        -- Audit log per installment
        perform public.write_audit_log(
            p_tenant_id := p_tenant_id,
            p_action := 'installment.allocate_waterfall',
            p_entity_type := 'installment',
            p_entity_id := v_installment.id,
            p_actor_id := p_actor_profile_id,
            p_before_json := jsonb_build_object(
                'amount_paid', v_installment.amount_paid,
                'status', v_installment.status
            ),
            p_after_json := jsonb_build_object(
                'amount_paid', v_new_amount_paid,
                'status', v_new_status,
                'allocated', v_allocate,
                'payment_id', p_payment_id
            )
        );

        v_remaining := v_remaining - v_allocate;
        v_count := v_count + 1;

        return query select
            v_installment.id,
            v_allocate,
            v_new_amount_paid,
            v_new_status,
            v_fully_satisfied;
    end loop;

    -- If there's leftover (overpayment), log it as parent credit.
    v_unallocated := greatest(0, v_remaining);
    if v_unallocated > 0.001 then
        perform public.write_audit_log(
            p_tenant_id := p_tenant_id,
            p_action := 'payment.unallocated_credit',
            p_entity_type := 'parent',
            p_entity_id := p_parent_id,
            p_actor_id := p_actor_profile_id,
            p_after_json := jsonb_build_object(
                'payment_id', p_payment_id,
                'unallocated_credit', v_unallocated,
                'allocated_count', v_count,
                'total_allocated', p_payment_amount - v_unallocated
            )
        );
    end if;
end;
$$;

comment on function public.allocate_payment_waterfall is
  'Waterfall allocation: distribute a payment across the parent''s unpaid installments (oldest first). Returns per-installment allocations. Excess becomes parent credit (audit-logged). Guarantees Ledger ↔ Installment consistency.';

-- ============================================================================
-- compute_parent_outstanding_v2 — authoritative outstanding computation
-- ============================================================================
-- Replacement for the legacy compute_parent_outstanding() that sums ledger
-- entries. This version is the single source of truth for "how much does
-- the parent currently owe". It returns both the ledger-derived outstanding
-- AND the installment-derived outstanding so callers can detect drift.
create or replace function public.compute_parent_outstanding_v2(
    p_parent_id uuid
)
returns table(
    ledger_outstanding numeric,
    installment_outstanding numeric,
    drift numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ledger numeric;
    v_installment numeric;
begin
    -- Ledger-derived: sum of all signed amounts for this parent.
    -- Charges are positive, payments/adjustments/refunds are negative.
    select coalesce(sum(amount), 0)
      into v_ledger
      from public.ledger_entries
     where parent_id = p_parent_id;

    -- Installment-derived: sum of (amount_due - amount_paid) for non-paid installments.
    select coalesce(sum(greatest(0, amount_due - amount_paid)), 0)
      into v_installment
      from public.installments
     where parent_id = p_parent_id
       and status <> 'paid';

    return query select
        v_ledger,
        v_installment,
        v_ledger - v_installment;  -- drift should be ~0 if waterfall was used
end;
$$;

comment on function public.compute_parent_outstanding_v2 is
  'Returns both ledger-derived and installment-derived outstanding amounts for a parent, plus the drift between them. Drift should be ~0 when the waterfall allocator is used consistently.';

-- ============================================================================
-- reconcile_parent — detect Ledger ↔ Installment drift for a single parent
-- ============================================================================
create or replace function public.reconcile_parent(
    p_parent_id uuid,
    p_tolerance numeric default 1.0  -- 1 DZD tolerance for rounding
)
returns table(
    is_consistent boolean,
    ledger_outstanding numeric,
    installment_outstanding numeric,
    drift numeric,
    violation_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ledger numeric;
    v_installment numeric;
    v_drift numeric;
    v_violations integer := 0;
    v_overpaid_count integer;
begin
    select * into v_ledger, v_installment, v_drift
      from public.compute_parent_outstanding_v2(p_parent_id);

    -- Count installments where amount_paid > amount_due (impossible state).
    select count(*) into v_overpaid_count
      from public.installments
     where parent_id = p_parent_id
       and amount_paid > amount_due + p_tolerance;
    v_violations := v_violations + v_overpaid_count;

    return query select
        (abs(v_drift) <= p_tolerance and v_violations = 0),
        v_ledger,
        v_installment,
        v_drift,
        v_violations;
end;
$$;

comment on function public.reconcile_parent is
  'Reconcile a parent''s ledger vs installment records. Returns is_consistent=false when drift exceeds tolerance OR any installment is overpaid.';
