-- 0064_expense_transition_guard.sql
-- WEAK-030 — enforce the expense-approval STATE MACHINE and a hard
-- no-self-approval block at the DB layer (follow-up to T-093/DRIFT-013).
--
-- The gap (registered during T-093's SupabaseExpenseRepository port):
--   (a) 0008's trigger checks individual invariants (receipt before settle,
--       final amount, rejection reason) but NOT the transition graph — any
--       caller the RLS UPDATE policy admits (a submitter on their OWN
--       ticket, or manager/finoff on any tenant ticket) could jump the
--       status to ANY value: pending_approval → settled_and_closed,
--       settled_and_closed → pending_approval (reopen), rejected →
--       disbursed, …
--   (b) 0008's self-approval rule only fired when approved_by was set AND
--       equal to submitted_by — a submitter approving their own ticket via
--       direct PostgREST could simply leave approved_by NULL and the
--       trigger passed it.
--
-- The canonical graph (from the DB's own writers — 0008's header workflow,
-- the approve_expense/settle_expense RPCs of 0022, and the desktop adapter
-- of T-093):
--     draft                 → pending_approval
--     pending_approval      → approved_funds_released | rejected
--     approved_funds_released → disbursed | settled_and_closed
--                              (settle_expense settles from EITHER state)
--     disbursed             → settled_and_closed
--     rejected, settled_and_closed → terminal (no exit)
--   INSERT may only start at draft or pending_approval.
-- NOTE the desktop client-side machine (T-093 adapter) is intentionally
-- STRICTER on the settle path (disbursed → settled only); a stricter
-- client on top of a permissive-enough server is fine — the reverse is not.
--
-- All 0008 invariants are preserved verbatim. The trigger is re-bound with
-- rejected_reason added to the UPDATE-of column list so every guarded
-- column change re-validates.

-- ----------------------------------------------------------------------------
-- 1. Replace the guard function with the full state machine
-- ----------------------------------------------------------------------------
create or replace function public.enforce_expense_workflow_rules()
returns trigger
language plpgsql
security definer
as $$
begin
    -- (a) Legal INITIAL statuses: a ticket is born draft or pending_approval.
    if tg_op = 'INSERT' and new.status not in ('draft', 'pending_approval') then
        raise exception 'Invalid initial expense status: % — a ticket must be created as draft or pending_approval (WEAK-030)', new.status;
    end if;

    -- (b) The transition graph, on every status CHANGE.
    if tg_op = 'UPDATE' and old.status is distinct from new.status then
        if not (
            (old.status = 'draft'                     and new.status in ('pending_approval'))
            or (old.status = 'pending_approval'       and new.status in ('approved_funds_released', 'rejected'))
            or (old.status = 'approved_funds_released' and new.status in ('disbursed', 'settled_and_closed'))
            or (old.status = 'disbursed'              and new.status in ('settled_and_closed'))
        ) then
            -- rejected + settled_and_closed fall through: terminal states.
            raise exception 'Unauthorized expense transition: % → % (WEAK-030 state machine)', old.status, new.status;
        end if;
    end if;

    -- (c) HARD no-self-approval (closes the NULL-approver bypass): a ticket
    --     ENTERING approved_funds_released must name an approver that is set
    --     AND different from the submitter. Scoped to the entering change so
    --     legacy approved rows (pre-0064, approved_by possibly NULL) remain
    --     editable for their other columns.
    if new.status = 'approved_funds_released'
       and (tg_op = 'INSERT' or old.status is distinct from 'approved_funds_released')
       and (new.approved_by is null or new.approved_by = new.submitted_by) then
        raise exception 'Self-approval is forbidden (plan §08 / WEAK-030): an approval must name an approver other than the submitter';
    end if;

    -- 0008 invariants, preserved verbatim.
    if new.status = 'settled_and_closed' and new.receipt_path is null then
        raise exception 'Receipt upload is mandatory before settlement (plan §08)';
    end if;
    if new.status = 'settled_and_closed' and new.final_spent_amount is null then
        raise exception 'Final spent amount must be set before settlement';
    end if;
    if new.status = 'rejected' and (new.rejected_reason is null or trim(new.rejected_reason) = '') then
        raise exception 'A rejection reason is required';
    end if;

    return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Re-bind the trigger with rejected_reason in the guarded column list
-- ----------------------------------------------------------------------------
drop trigger if exists expense_tickets_enforce_workflow on public.expense_tickets;
create trigger expense_tickets_enforce_workflow
    before insert or update of status, approved_by, receipt_path, final_spent_amount, rejected_reason
    on public.expense_tickets
    for each row execute function public.enforce_expense_workflow_rules();

comment on function public.enforce_expense_workflow_rules is
    'WEAK-030: expense state machine (draft→pending_approval→approved|rejected→disbursed|settled; settle allowed from approved or disbursed per settle_expense) + hard no-self-approval (approver set and ≠ submitter) + the 0008 invariants (receipt, final amount, rejection reason).';
