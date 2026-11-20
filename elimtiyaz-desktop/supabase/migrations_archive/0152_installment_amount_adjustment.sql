-- ============================================================================
-- 0152_installment_amount_adjustment.sql
-- ============================================================================
-- T-510 (DEBT-105, 159th session 2026-10-13) — the PER-TRANCHE AMOUNT
-- ADJUSTMENT: the owner's GitHub issue #31 mandate ("I need to edit an
-- account's outstanding amount and explicitly control how much is owed
-- for each specific tranche").
--
-- WHAT THIS DOES (and nothing else):
--
--   `adjust_installment_amount(…)` — THE canonical per-tranche amount write
--   path (the 0137 create_manual_debt conventions: SECURITY DEFINER,
--   staff-gated, tenant-scoped, the three atomic writes):
--     1. the INSTALLMENTS row UPDATE — `amount_due` := the caller's NEW
--        TOTAL (an absolute amount, NEVER a delta — the issue's "make
--        clear whether the input represents the tranche's new total due
--        or an adjustment to its existing amount"), plus the status
--        re-derivation (the 0115 waterfall predicates) and
--        `updated_at`. Payments are NEVER touched: `amount_paid`,
--        `amount_pending`, `paid_date` (except the becoming-paid stamp),
--        every payment row, every payment_allocations row, every ledger
--        payment/refund/reversal entry — ALL preserved (the issue's
--        "preserve recorded payments, payment allocations, pending
--        payments, credits, discounts, and historical transactions").
--     2. the LEDGER adjustment entry — the signed DELTA
--        (new_amount_due − old_amount_due) on the tranche's OWN account
--        (`parent:{id}:category:{cat}:student:{student}` — the live
--        charge convention, probed 2026-10-13). This preserves the T-103
--        reconciliation invariant: Σ installments due == Σ charges +
--        Σ adjustments (per parent) — the account-level and
--        tranche-level balances stay consistent BY CONSTRUCTION (the
--        issue's "must not create inconsistencies between account-level
--        and tranche-level balances").
--     3. the AUDIT row — before/after (previous amount, new amount,
--        statuses, the resulting account balance + the resulting Σ
--        installments due), the mandatory reason, the actor, the
--        timestamp (the issue's auditability mandate).
--
-- GUARDS (fail-closed, before any write):
--     - staff roles (the 0137 audience: super_admin, financial_officer,
--       support_staff);
--     - the row exists AND belongs to the caller's tenant (FOR UPDATE —
--       the row lock serialises concurrent adjustments on the SAME
--       tranche: the second writer re-reads the post-first-write amount
--       and computes its delta against the REAL current value);
--     - p_new_amount_due >= 0 (the 0007 CHECK amount_due >= 0; 0 = the
--       full-waiver edge — the settled class);
--     - the reason >= 3 chars (the 0137/BUSINESS-003 audit mandate);
--     - the delta <> 0 — the NO-OP GUARD: a repeated save of the SAME
--       value is REJECTED (the issue's "repeated saves without duplicate
--       adjustments or double application"): an applied adjustment can
--       never be double-applied because a second identical call carries
--       delta = 0 and fails closed.
--
-- THE OVER-COVERED CASE (new_amount_due < amount_paid + amount_pending —
-- the issue's "handle paid, partially paid, unpaid, and overpaid tranches
-- correctly" + "explicitly handle adjustments affecting already-paid or
-- allocated amounts"): ALLOWED, never silent. The status becomes 'paid'
-- (the INV-4 cleared-funds predicate: paid + pending >= due), the
-- canonical remaining clamps to 0 (INV-4 family), and the EXCESS
-- (paid + pending − new_due) is REPORTED in the returned row + the audit
-- metadata (`overcovered: true`). The excess is NEVER moved (no payment
-- row rewrite, no allocation move, no tranche-to-tranche transfer — the
-- issue's "do not silently move payments between tranches or rewrite
-- payment history"). The ledger delta lands on the tranche's account, so
-- the account replay shows the over-coverage exactly like the reconciled
-- historical corpus class (DATA-009's documented semantics: "balance =
-- −excess is already exact" for the pre-0062 corpus; the display layer
-- derives the credit honestly). The compensations (a refund via the
-- canonical LIFO revert, an account-level credit) remain the owner's
-- separate, explicit decisions.
--
-- STATUS RE-DERIVATION (the 0115 waterfall predicates + the ADR-033
-- vocabulary — the status trigger was DROPPED in 0032/0034, so write
-- paths own the status):
--     paid             amount_paid >= new_amount_due
--     partial          amount_paid > 0 (and < new_amount_due)
--     pending_clearance  amount_pending > 0 (uncleared funds keep their state)
--     overdue          amount_paid = 0, amount_pending = 0, due_date < now (ADR-033)
--     unpaid           amount_paid = 0, amount_pending = 0, due_date >= now (ADR-033)
--   paid_date := CASE WHEN status = 'paid' THEN COALESCE(paid_date, now)
--                     ELSE paid_date END  (the 0115 convention: a re-opened
--   tranche keeps its historical settlement date; a newly-settled one
--   stamps it once).
--
-- WHY AN RPC (not a PostgREST .update): the §15.5 rule — financial
-- mutations are server-side canonical; a bare .update({ amount_due })
-- would (a) skip the ledger delta → the T-103 invariant broken (the
-- EXACT defect class the account-level adjust() carries today —
-- DEBT-105's root cause), (b) skip the audit row, (c) skip the
-- validation. The desktop `InstallmentRepository.updateDueDate` precedent
-- writes via PostgREST because a DATE has no financial amount and no
-- ledger twin — an AMOUNT is a different class.
--
-- GRANTS (§15.34): EXECUTE revoked from anon and public; granted to
-- authenticated (the installments_admin RLS policy already gates the
-- table; the RPC re-checks the staff roles itself).
--
-- Follows ADR-001: NEW migration only — applied migrations are never
-- edited. The migration number was taken against the LIVE chain head
-- (max(live, repo) = 0151 == repo — probed 2026-10-13, the §15.86 rule).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. adjust_installment_amount — the canonical per-tranche amount write path
-- ----------------------------------------------------------------------------
create or replace function public.adjust_installment_amount(
    p_installment_id  uuid,             -- the tranche to adjust (its OWN row — never a sibling)
    p_new_amount_due  numeric,          -- the NEW TOTAL amount due (absolute, NEVER a delta)
    p_reason          text,             -- the mandatory reason (>= 3 chars — the audit mandate)
    p_actor_id        uuid default null,-- uuid (the audit_logs.actor_id convention)
    p_actor_name      text default null
)
returns table (
    installment_id        uuid,
    parent_id             uuid,
    previous_amount_due   numeric,
    new_amount_due        numeric,
    delta                 numeric,       -- signed: new − previous (the ledger entry's amount)
    previous_status       text,
    new_status            text,
    overcovered           boolean,       -- true when new_due < amount_paid + amount_pending
    excess                numeric,       -- the over-covered amount (0 when not overcovered)
    ledger_entry_id       text,
    account_balance_after numeric,       -- the resulting ledger replay on the tranche's account
    installments_due_after numeric      -- the resulting Σ amount_due for the family (all tranches)
)
language plpgsql
security definer
set search_path to public
as $$
declare
    v_tenant       uuid := public.current_tenant_id();
    v_reason       text := nullif(btrim(coalesce(p_reason, '')), '');
    v_ins          record;
    v_delta        numeric;
    v_new_status   text;
    v_ledger_id    text;
    v_account_id   text;
    v_description  text;
    v_overcovered  boolean := false;
    v_excess       numeric := 0;
    v_balance      numeric;
    v_due_after    numeric;
    v_prev_due     numeric;
    v_prev_status  text;
begin
    -- Gate 1 — staff roles (the 0137 audience).
    if not public.has_any_role(array['super_admin', 'financial_officer', 'support_staff']) then
        raise exception 'forbidden: tranche amount adjustment is a staff financial write';
    end if;

    -- Gate 2 — the contract guards (fail closed, before any write).
    if p_new_amount_due is null or p_new_amount_due < 0 then
        raise exception 'adjust_installment_amount: the new amount due must be >= 0';
    end if;
    if v_reason is null or length(v_reason) < 3 then
        raise exception 'adjust_installment_amount: the reason is required (>= 3 chars)';
    end if;

    -- Gate 3 — the row exists, tenant-scoped, LOCKED (concurrent adjustments
    -- on the same tranche serialise here: the second writer computes its
    -- delta against the post-first-write value — no lost update, no
    -- double-application).
    select i.id, i.parent_id, i.student_id, i.category, i.label,
           i.amount_due, i.amount_paid, i.amount_pending,
           i.due_date, i.paid_date, i.status
      into v_ins
      from public.installments i
     where i.id = p_installment_id
       and i.tenant_id = v_tenant
       for update;
    if not found then
        raise exception 'adjust_installment_amount: installment % not found in tenant scope', p_installment_id;
    end if;

    v_prev_due    := v_ins.amount_due;
    v_prev_status := v_ins.status;
    v_delta       := p_new_amount_due - v_ins.amount_due;

    -- Gate 4 — the NO-OP guard (the issue's double-application mandate):
    -- a save of the SAME value is rejected — an applied adjustment can
    -- never be re-applied.
    if v_delta = 0 then
        raise exception 'adjust_installment_amount: the new amount due equals the current amount due (%) — nothing to adjust', v_ins.amount_due;
    end if;

    -- The OVER-COVERED classification (explicit, never silent): the new
    -- due sits below the funds already paid or allocated on this tranche.
    if p_new_amount_due < (v_ins.amount_paid + v_ins.amount_pending) then
        v_overcovered := true;
        v_excess := (v_ins.amount_paid + v_ins.amount_pending) - p_new_amount_due;
    end if;

    -- ------------------------------------------------------------------
    -- The STATUS re-derivation (the 0115 waterfall predicates + ADR-033).
    -- Priority: paid (cleared funds cover the new due — INV-4) >
    -- pending_clearance (uncleared funds in flight — the row's settlement
    -- awaits a clearance, the honest state whenever amount_pending > 0) >
    -- partial (cleared funds present) > the ADR-033 date branch.
    -- ------------------------------------------------------------------
    if v_ins.amount_paid >= p_new_amount_due then
        v_new_status := 'paid';                              -- INV-4: cleared funds cover the (new) due
    elsif v_ins.amount_pending > 0 then
        v_new_status := 'pending_clearance';                 -- uncleared funds keep their state
    elsif v_ins.amount_paid > 0 then
        v_new_status := 'partial';
    elsif v_ins.due_date < current_date then
        v_new_status := 'overdue';                           -- ADR-033: past due + no payment activity
    else
        v_new_status := 'unpaid';                            -- ADR-033: the no-payment-activity state
    end if;

    -- ------------------------------------------------------------------
    -- Write 1/3 — the INSTALLMENTS row (the tranche's OWN row only — the
    -- issue's "only the intended tranche is affected").
    -- ------------------------------------------------------------------
    update public.installments
       set amount_due = p_new_amount_due,
           status     = v_new_status,
           paid_date  = case when v_new_status = 'paid' then coalesce(paid_date, now()) else paid_date end,
           updated_at = now()
     where id = v_ins.id;

    -- ------------------------------------------------------------------
    -- Write 2/3 — the LEDGER adjustment entry (the signed DELTA on the
    -- tranche's OWN account — the live charge convention, probed
    -- 2026-10-13). Append-only: the charge history, every payment entry,
    -- every refund/reversal — untouched.
    -- ------------------------------------------------------------------
    v_ledger_id := 'led-' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                   || '-' || substr(md5(gen_random_uuid()::text), 1, 8);
    v_account_id := 'parent:' || v_ins.parent_id || ':category:' || v_ins.category
                    || ':student:' || v_ins.student_id;
    v_description := 'Ajustement tranche — ' || coalesce(v_ins.label, 'tranche')
                     || ' · ' || to_char(p_new_amount_due, 'FM999999999D99')
                     || ' DZD (ancien ' || to_char(v_ins.amount_due, 'FM999999999D99') || ')'
                     || ' · ' || v_reason;

    insert into public.ledger_entries (
        id, tenant_id, entry_number, parent_id, student_id, account_id,
        entry_type, amount, category, description, entry_date,
        source_type, source_id, method, receipt_number, payment_status,
        reverses_id, actor_id, actor_name, at, metadata
    ) values (
        public.gen_uuid(), v_tenant, v_ledger_id, v_ins.parent_id, v_ins.student_id, v_account_id,
        'adjustment', v_delta, v_ins.category, v_description,
        now(),
        'manual_entry', 'adj-' || v_ins.id::text, null, null, null,
        null, p_actor_id::text, p_actor_name, now(),
        jsonb_build_object(
            'installmentId', v_ins.id,
            'previousAmountDue', v_prev_due,
            'newAmountDue', p_new_amount_due,
            'delta', v_delta,
            'reason', v_reason,
            'overcovered', v_overcovered,
            'excess', v_excess,
            'source', 'adjust_installment_amount'
        )
    );

    -- ------------------------------------------------------------------
    -- Write 3/3 — the AUDIT row (the issue's auditability mandate: the
    -- account, the tranche, the previous and new amounts, the reason,
    -- the acting user, the timestamp, the resulting balances).
    -- ------------------------------------------------------------------
    -- The resulting balances (computed AFTER the writes — the honest
    -- post-state, not a projection).
    select coalesce(sum(l.amount), 0) into v_balance
      from public.ledger_entries l
     where l.tenant_id = v_tenant
       and l.parent_id = v_ins.parent_id
       and l.account_id = v_account_id;

    select coalesce(sum(i.amount_due), 0) into v_due_after
      from public.installments i
     where i.tenant_id = v_tenant
       and i.parent_id = v_ins.parent_id;

    insert into public.audit_logs (
        id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
        before_json, after_json, diff, note, created_at
    ) values (
        public.gen_uuid(), v_tenant, 'installment.amount_adjusted', 'installment', v_ins.id,
        p_actor_id, p_actor_name,
        jsonb_build_object(
            'installmentId', v_ins.id, 'parentId', v_ins.parent_id, 'studentId', v_ins.student_id,
            'category', v_ins.category, 'label', v_ins.label,
            'amountDue', v_prev_due, 'status', v_prev_status,
            'amountPaid', v_ins.amount_paid, 'amountPending', v_ins.amount_pending,
            'installmentsDueTotal', v_due_after - v_delta
        ),
        jsonb_build_object(
            'installmentId', v_ins.id, 'parentId', v_ins.parent_id, 'studentId', v_ins.student_id,
            'category', v_ins.category, 'label', v_ins.label,
            'amountDue', p_new_amount_due, 'status', v_new_status,
            'amountPaid', v_ins.amount_paid, 'amountPending', v_ins.amount_pending,
            'ledgerEntryId', v_ledger_id,
            'accountBalanceAfter', v_balance, 'installmentsDueTotal', v_due_after,
            'overcovered', v_overcovered, 'excess', v_excess
        ),
        jsonb_build_object(
            'amountDue', jsonb_build_array(v_prev_due, p_new_amount_due),
            'delta', v_delta,
            'status', jsonb_build_array(v_prev_status, v_new_status)
        ),
        'Tranche ajustée via RPC adjust_installment_amount (T-510/DEBT-105 — ' || v_reason || ')',
        now()
    );

    return query select
        v_ins.id, v_ins.parent_id,
        v_prev_due, p_new_amount_due, v_delta,
        v_prev_status, v_new_status,
        v_overcovered, v_excess,
        v_ledger_id, v_balance, v_due_after;
end;
$$;

comment on function public.adjust_installment_amount is
  'T-510 (DEBT-105, GitHub issue #31): the canonical per-tranche amount '
  'write path — the installments row UPDATE (amount_due := the NEW TOTAL, '
  'the status re-derived per the 0115 waterfall predicates + ADR-033) + the '
  'signed DELTA ledger adjustment on the tranche''s own account (the T-103 '
  'invariant: Σ installments due == Σ charges + Σ adjustments) + the audit '
  'row (before/after, reason, actor, resulting balances). Payments, '
  'allocations and history are NEVER touched; the over-covered case '
  '(new < paid + pending) is allowed and flagged explicitly; the no-op '
  'delta is rejected (the double-application guard).';

revoke execute on function public.adjust_installment_amount(uuid, numeric, text, uuid, text) from anon, public;
grant execute on function public.adjust_installment_amount(uuid, numeric, text, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- §2. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0152', '{0152_installment_amount_adjustment.sql}', 'installment_amount_adjustment')
on conflict (version) do nothing;
