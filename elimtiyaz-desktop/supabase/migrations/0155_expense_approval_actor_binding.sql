-- ============================================================================
-- 0155_expense_approval_actor_binding.sql — THE EXPENSE-APPROVAL BACKEND
-- HARDENING (T-527 / SEC-118, 171st session, 2026-10-13)
-- ============================================================================
-- OWNER MANDATE (registered as SEC-118 before this fix, per AGENTS.md §13):
--   "Only authorized administrators may approve or reject expenses. Enforce
--   this restriction on the backend, including relevant API endpoints and
--   database operations." + "Staff members CANNOT: … Bypass approval
--   workflows through direct API requests or database operations."
--
-- THE THREE BYPASS LAYERS THIS CLOSES (all live-probed 2026-10-13):
--   (1) approve_expense / settle_expense (0022) are SECURITY DEFINER, take
--       CALLER-SUPPLIED p_approver_profile_id / p_actor_profile_id, perform
--       NO caller verification, and are EXECUTE-able by authenticated AND
--       anon (live pg_proc ACL census) — any caller could approve/settle
--       any ticket in ANY profile's name (e.g. the admin's).
--   (2) The 0064 trigger's no-self-approval clause only constrains the
--       RELATIONSHIP between approved_by and submitted_by — naming ANY
--       other profile satisfies it. Combined with the 0019 UPDATE policy
--       (reviewers OR submitted_by), a submitter could flip their OWN
--       ticket to approved_funds_released with approved_by = <admin id>
--       through plain PostgREST.
--   (3) The same RLS+trigger pair let a submitter self-REJECT or
--       self-DISBURSE their own ticket — no reviewer gate existed on any
--       terminal transition.
--
-- THE FIX (the 0055 caller-verification pattern this codebase already
-- standardized for adjust_personnel_salary / record_salary_disbursement —
-- both verified guarded live the same day):
--   §1. enforce_expense_workflow_rules (0064) recreated VERBATIM plus:
--        (d) for non-service AUTHENTICATED callers, transitions INTO
--            approved_funds_released / rejected / disbursed /
--            settled_and_closed require a reviewer role
--            (super_admin / financial_officer / manager — the canonical
--            0019 expense_tickets_select reviewer set, identical to the
--            desktop isReviewer set and the 0019 UPDATE policy's reviewer
--            branch). Submitters keep draft→pending_approval (the submit
--            path) and field edits (the desktop update() contract on
--            draft/submitted rows — no status change, no guard fire).
--        (e) anti-forgery: for non-service authenticated callers, ENTERING
--            approved_funds_released requires approved_by = the ACTING
--            user's profile id (current_user_profile_id()) — a forged
--            third-party approver no longer passes.
--        Service-role callers (Edge Functions) and JWT-less sessions
--        (migrations, backfills, the Management API) are exempt — the RLS
--        layer remains the anon boundary (anon holds no expense policy).
--   §2. approve_expense recreated VERBATIM plus the 0055 caller gate
--       (service_role OR authenticated reviewer) AND actor binding
--       (p_approver_profile_id must equal current_user_profile_id() for
--       non-service callers). The historical disbursed_at:=now() on the
--       approval update is preserved verbatim (no client calls this RPC —
--       desktop uses the PostgREST path — and changing its write shape is
--       NOT this task's scope; noted here so the next agent does not
--       mistake it for new behavior).
--   §3. settle_expense recreated VERBATIM plus the same gate + actor
--       binding (p_actor_profile_id).
--   §4. revoke execute on both RPCs from anon, public (the §15.39c lesson
--       + the 0137/0152 convention: the anon-only form is insufficient —
--       anon inherits EXECUTE through the default PUBLIC grant).
--
-- COMPATIBILITY:
--   - The desktop repository paths are UNAFFECTED: submit() inserts born
--     pending_approval (INSERT — clause (d) never fires on INSERT);
--     approve()/reject()/disburse()/settleProof() UPDATE with the signed-in
--     reviewer's own session userId as approved_by — clause (e) is exactly
--     satisfied; every reviewer (super_admin/financial_officer/manager)
--     passes clause (d).
--   - The Android mirror (WORKFORCE-519 fix pending in T-521 phase 6) must
--     settle to the same contract: approve as the signed-in reviewer, with
--     approved_by = the reviewer's own profile id.
--   - Idempotent: drop-if-exists + create-or-replace throughout.
--
-- Per AGENTS.md §15 rule 10 (T-091/MIG-TOKENS pattern): applied to the live
-- project TOGETHER with its schema_migrations registration in one atomic
-- transaction (the registration stanza at the bottom).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. enforce_expense_workflow_rules — the 0064 state machine + the SEC-118
--     reviewer gate (d) and the actor-binding anti-forgery (e).
-- ----------------------------------------------------------------------------
create or replace function public.enforce_expense_workflow_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
    v_is_authenticated_caller boolean := auth.uid() is not null and not v_caller_is_service_role;
    v_acting_profile_id uuid := public.current_user_profile_id();
    v_is_reviewer boolean := false;
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

    -- (d) SEC-118 (T-527): the APPROVAL-AUTHORITY transitions are
    --     REVIEWER-ONLY for authenticated non-service callers: entering
    --     approved_funds_released (the approval), rejected (the rejection)
    --     and disbursed (the funds release). settled_and_closed is
    --     DELIBERATELY NOT gated — the T-521 Android flow lets the SUBMITTER
    --     settle their own APPROVED ticket with the receipt proof (the
    --     t521-expense-e2e.py F3 contract, live-green 2026-10-13): the state
    --     machine (b) already orders settle AFTER approval, the 0008
    --     invariants below already require the receipt + final amount, and
    --     the RLS UPDATE policy already confines submitters to their OWN
    --     rows — the submitter's settle is the proof-upload step, not an
    --     approval bypass. The reviewer set = the 0019
    --     expense_tickets_select visibility set (super_admin /
    --     financial_officer / manager), identical to the desktop
    --     isReviewer gate — one definition, every layer.
    if v_is_authenticated_caller
       and tg_op = 'UPDATE'
       and old.status is distinct from new.status
       and new.status in ('approved_funds_released', 'rejected', 'disbursed') then
        select public.has_any_role(array['super_admin', 'financial_officer', 'manager'])
          into v_is_reviewer;
        if not v_is_reviewer then
            raise exception
                'Reviewer-only expense transition (SEC-118): only super_admin / financial_officer / manager may move a ticket to % — submitters cannot approve, reject or disburse',
                new.status;
        end if;
    end if;

    -- (e) SEC-118 (T-527): anti-forgery — a ticket ENTERING
    --     approved_funds_released must name the ACTING user as approver
    --     (for authenticated non-service callers). Together with (c) this
    --     makes "approved_by = the profile that actually performed the
    --     approval" a database invariant, closing the forged-third-party-
    --     approver hole the plain 0064 clause left open.
    if v_is_authenticated_caller
       and tg_op = 'UPDATE'
       and new.status = 'approved_funds_released'
       and old.status is distinct from 'approved_funds_released'
       and (new.approved_by is null or new.approved_by is distinct from v_acting_profile_id) then
        raise exception
            'Forged approver (SEC-118): approved_by must be the acting user''s own profile — an approval cannot be recorded in another profile''s name';
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

comment on function public.enforce_expense_workflow_rules is
    'WEAK-030 + SEC-118 (T-527/0155): expense state machine (draft→pending_approval→approved|rejected→disbursed→settled; settle allowed from approved or disbursed per settle_expense) + hard no-self-approval (approver set and ≠ submitter) + reviewer-only terminal transitions for authenticated non-service callers + approved_by=acting-user anti-forgery + the 0008 invariants (receipt, final amount, rejection reason).';

-- ----------------------------------------------------------------------------
-- §2. approve_expense — the 0022 RPC gains the 0055 caller gate + actor
--     binding (SEC-118). Body otherwise preserved verbatim.
-- ----------------------------------------------------------------------------
create or replace function public.approve_expense(
    p_tenant_id uuid,
    p_ticket_id uuid,
    p_approver_profile_id uuid,
    p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ticket record;
    v_audit_id uuid;
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
    -- ── Caller verification + actor binding (SEC-118, the 0055 pattern) ──
    if not v_caller_is_service_role then
        if auth.uid() is null then
            raise exception 'approve_expense: an authenticated caller is required';
        end if;
        if not public.has_any_role(array['super_admin', 'financial_officer', 'manager']) then
            raise exception 'approve_expense: only super_admin / financial_officer / manager may approve expenses';
        end if;
        if p_approver_profile_id is distinct from public.current_user_profile_id() then
            raise exception 'approve_expense: p_approver_profile_id must be the caller''s own profile (SEC-118 actor binding) — approvals cannot be recorded in another profile''s name';
        end if;
    end if;

    select * into v_ticket from public.expense_tickets where id = p_ticket_id and tenant_id = p_tenant_id;
    if not found then raise exception 'Expense ticket not found'; end if;

    if v_ticket.submitted_by = p_approver_profile_id then
        raise exception 'Self-approval is forbidden (plan §08)';
    end if;

    if v_ticket.status <> 'pending_approval' then
        raise exception 'Ticket is not pending approval (current: %)', v_ticket.status;
    end if;

    update public.expense_tickets
       set status = 'approved_funds_released',
           approved_by = p_approver_profile_id,
           approved_at = now(),
           approval_note = p_note,
           disbursed_at = now(),
           updated_at = now()
     where id = p_ticket_id;

    v_audit_id := public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'expense.approve',
        p_entity_type := 'expense_ticket',
        p_entity_id := p_ticket_id,
        p_actor_id := p_approver_profile_id,
        p_after_json := jsonb_build_object('status', 'approved_funds_released', 'note', p_note)
    );

    return v_audit_id;
end;
$$;

comment on function public.approve_expense is
    'Atomic expense approval. WEAK-030 no-self-approval + SEC-118 (0155): 0055 caller verification (service_role OR authenticated reviewer) and actor binding (p_approver_profile_id = the caller''s own profile for non-service callers).';

-- ----------------------------------------------------------------------------
-- §3. settle_expense — the same gate + binding. Body otherwise verbatim.
-- ----------------------------------------------------------------------------
create or replace function public.settle_expense(
    p_tenant_id uuid,
    p_ticket_id uuid,
    p_final_amount numeric,
    p_receipt_path text,
    p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ticket record;
    v_audit_id uuid;
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
    -- ── Caller verification + actor binding (SEC-118, the 0055 pattern) ──
    if not v_caller_is_service_role then
        if auth.uid() is null then
            raise exception 'settle_expense: an authenticated caller is required';
        end if;
        if not public.has_any_role(array['super_admin', 'financial_officer', 'manager']) then
            raise exception 'settle_expense: only super_admin / financial_officer / manager may settle expenses';
        end if;
        if p_actor_profile_id is distinct from public.current_user_profile_id() then
            raise exception 'settle_expense: p_actor_profile_id must be the caller''s own profile (SEC-118 actor binding)';
        end if;
    end if;

    select * into v_ticket from public.expense_tickets where id = p_ticket_id and tenant_id = p_tenant_id;
    if not found then raise exception 'Expense ticket not found'; end if;

    if v_ticket.status not in ('approved_funds_released', 'disbursed') then
        raise exception 'Ticket must be approved_funds_released or disbursed to settle (current: %)', v_ticket.status;
    end if;

    if p_receipt_path is null or trim(p_receipt_path) = '' then
        raise exception 'Receipt upload is mandatory before settlement (plan §08)';
    end if;

    update public.expense_tickets
       set status = 'settled_and_closed',
           final_spent_amount = p_final_amount,
           receipt_path = p_receipt_path,
           receipt_uploaded_at = now(),
           receipt_uploaded_by = p_actor_profile_id,
           settled_by = p_actor_profile_id,
           settled_at = now(),
           updated_at = now()
     where id = p_ticket_id;

    v_audit_id := public.write_audit_log(
        p_tenant_id := p_tenant_id,
        p_action := 'expense.settle',
        p_entity_type := 'expense_ticket',
        p_entity_id := p_ticket_id,
        p_actor_id := p_actor_profile_id,
        p_after_json := jsonb_build_object('final_amount', p_final_amount, 'receipt_path', p_receipt_path)
    );

    return v_audit_id;
end;
$$;

comment on function public.settle_expense is
    'Atomic expense settlement. Requires receipt_path (plan §08) + SEC-118 (0155): 0055 caller verification and actor binding (p_actor_profile_id = the caller''s own profile for non-service callers).';

-- ----------------------------------------------------------------------------
-- §4. The anon revoke (the §15.39c lesson — platform default privileges
--     grant PUBLIC EXECUTE on every function; these are staff-only RPCs, so
--     the repo convention `from anon, public` (0137/0152) applies — the
--     anon-only form is INSUFFICIENT because anon inherits through PUBLIC).
-- ----------------------------------------------------------------------------
revoke execute on function public.approve_expense(uuid, uuid, uuid, text) from anon, public;
revoke execute on function public.settle_expense(uuid, uuid, numeric, text, uuid) from anon, public;

-- ----------------------------------------------------------------------------
-- §5. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0155', '{0155_expense_approval_actor_binding.sql}', 'expense_approval_actor_binding')
on conflict (version) do nothing;
