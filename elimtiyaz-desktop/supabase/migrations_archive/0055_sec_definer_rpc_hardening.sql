-- ============================================================================
-- 0055_sec_definer_rpc_hardening.sql — T-006 (SEC-110, SEC-112, SEC-111)
-- ============================================================================
-- WHAT THIS FIXES (see docs/recovery/problem-registry.md for the full
-- evidence; task T-006 "Verify callers and tenants in SECURITY DEFINER
-- RPCs"):
--
--   SEC-110 — `bind_activation_code` (0005) is SECURITY DEFINER and
--   accepts p_auth_user_id without verifying it against the caller.
--   Any authenticated user could bind ANY auth_user_id to ANY activation
--   code via direct PostgREST invocation (account takeover), silently
--   overwriting an existing parent binding (STUDENT-101) with no audit
--   trail (PARENT-103).
--
--   SEC-112 — `revert_payment_allocation` (0041 body) looks the payment
--   up WITHOUT a tenant filter and stamps the audit log with the
--   caller-supplied p_tenant_id → cross-tenant refund possible; the
--   audit entry would land under the wrong tenant.
--
--   SEC-111 — `upsert_payment_from_import` (0027/0031) is SECURITY
--   DEFINER (RLS-bypassed); a caller may pass any p_tenant_id and
--   inject/upsert payments into another tenant's books. The function
--   stays SECURITY DEFINER deliberately (Android sync + desktop
--   fallback + Excel import depend on it — retiring it is UNKNOWN-002 /
--   ADR-005 territory, NOT this task); instead it now verifies the
--   caller's tenant before touching any row.
--
-- DESIGN CONSTRAINTS (AGENTS.md §4/§15):
--   - The canonical EF path (bind-activation-code) calls this RPC with
--     a service_role client after verifying the caller's JWT and
--     passing ctx.userId — service_role callers are therefore treated
--     as trusted server-side code and exempt from the auth.uid()
--     equality check. Direct authenticated callers are NOT exempt.
--   - Global admins (user_profiles.tenant_id IS NULL, per the 0053
--     RBAC reconciliation) have no resolvable current_tenant_id(); the
--     desktop TENANT-103 fallback means they legitimately call payment
--     RPCs with the demo tenant — they are staff-trusted and exempt.
--   - Canonical payment logic (waterfall, statuses, ledger shape) is
--     UNCHANGED — this migration only adds verification, the tenant
--     filter, the re-bind guard, and audit entries.
--
-- IDEMPOTENCY: create-or-replace functions only; re-applying is a no-op.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. bind_activation_code — SEC-110 (+ STUDENT-101 re-bind guard,
--    + PARENT-103 audit for the direct-RPC path)
-- ----------------------------------------------------------------------------
create or replace function public.bind_activation_code(p_tenant_id uuid, p_code text, p_auth_user_id uuid)
 returns TABLE(parent_id uuid, parent_full_name text, student_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
    v_activation record;
    v_parent_id uuid;
    v_existing_auth_user_id uuid;
    v_caller_is_service_role boolean;
begin
    -- ── SEC-110: caller verification ─────────────────────────────────
    -- Direct PostgREST callers (user JWT) must bind THEMSELVES only.
    -- The bind-activation-code Edge Function calls via service_role
    -- after verifying the caller's JWT (ctx.userId = the verified
    -- auth.users.id) — service_role is trusted server-side code.
    -- Anonymous / forged-token callers: auth.uid() IS NULL → rejected.
    v_caller_is_service_role := coalesce(auth.jwt() ->> 'role', '') = 'service_role';

    if p_auth_user_id is null then
        raise exception 'bind_activation_code: p_auth_user_id is required (SEC-110)';
    end if;

    if not v_caller_is_service_role
       and (auth.uid() is null or p_auth_user_id <> auth.uid()) then
        raise exception 'bind_activation_code: p_auth_user_id must match the authenticated caller (SEC-110)';
    end if;

    -- Lock the activation code row
    select * into v_activation
      from public.activation_codes
     where tenant_id = p_tenant_id
       and code = p_code
       and bound_to_auth_user_id is null
     for update;

    if not found then
        raise exception 'Invalid or already-used activation code';
    end if;

    if v_activation.expires_at < now() then
        raise exception 'Activation code has expired';
    end if;

    v_parent_id := v_activation.parent_id;

    -- ── STUDENT-101: silent re-bind guard ────────────────────────────
    -- Refuse to transfer a parent record that is already bound to a
    -- DIFFERENT auth user. Re-binding the SAME user (retry after a
    -- partial failure) stays allowed.
    select auth_user_id into v_existing_auth_user_id
      from public.parents
     where id = v_parent_id
     for update;

    if v_existing_auth_user_id is not null
       and v_existing_auth_user_id <> p_auth_user_id then
        raise exception 'bind_activation_code: parent % is already bound to another account — contact the school office', v_parent_id;
    end if;

    -- Mark the code as bound
    update public.activation_codes
       set bound_to_auth_user_id = p_auth_user_id,
           bound_at = now()
     where id = v_activation.id;

    -- Bind the auth.users.id to the parent record
    update public.parents
       set auth_user_id = p_auth_user_id
     where id = v_parent_id;

    -- ── PARENT-103: audit the direct-RPC path ────────────────────────
    -- The EF path already writes its own richer audit entry
    -- (activation_code.bind, with request id) AFTER this RPC returns;
    -- auditing from here too would duplicate it. Direct PostgREST
    -- callers bypass the EF entirely, so THIS path is audited here.
    if not v_caller_is_service_role then
        insert into public.audit_logs (
            id, tenant_id, action, entity_type, entity_id,
            actor_id, actor_name, after_json, note, occurred_at
        ) values (
            public.gen_uuid(), p_tenant_id, 'activation_code.bind_rpc', 'parent', v_parent_id,
            null, 'direct-rpc-caller',
            jsonb_build_object('activation_code', p_code, 'auth_user_id', p_auth_user_id),
            'bind_activation_code called directly via PostgREST (not via the Edge Function)',
            now()
        );
    end if;

    -- Return parent + student count for the response
    return query
        select p.id as parent_id,
               (p.first_name || ' ' || p.last_name) as parent_full_name,
               count(s.id)::bigint as student_count
          from public.parents p
          left join public.students s on s.parent_id = p.id and s.deleted_at is null
         where p.id = v_parent_id
         group by p.id, p.first_name, p.last_name;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2. revert_payment_allocation — SEC-112 tenant verification
-- ----------------------------------------------------------------------------
create or replace function public.revert_payment_allocation(p_tenant_id uuid, p_payment_id uuid, p_actor_id uuid, p_actor_name text, p_reason text, p_as_of timestamp with time zone DEFAULT now())
 RETURNS TABLE(payment_id uuid, new_status text, reversal_entry_id text, reverts_count integer, total_reverted numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_payment RECORD;
  v_original_ledger RECORD;
  v_reversal_id TEXT;
  v_reverts JSONB := '[]'::JSONB;
  v_count INT := 0;
  v_total_reverted NUMERIC := 0;
  v_remaining NUMERIC;
  v_ins RECORD;
  v_revert NUMERIC;
  v_new_paid NUMERIC;
  v_new_pending NUMERIC;
  v_new_status TEXT;
  v_original_was_pending BOOLEAN;
BEGIN
  -- 1. Lock payment row.
  -- SEC-112: the lookup is now tenant-scoped — a payment from another
  -- tenant is indistinguishable from a nonexistent one ("not found"),
  -- so cross-tenant refunds are impossible even for service_role
  -- callers (which bypass RLS). INVOKER callers were already protected
  -- by the payments RLS SELECT policy; this closes the DEFINER/svc gap.
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;
  IF v_payment.status NOT IN ('paid', 'pending') THEN
    RAISE EXCEPTION 'Payment % is already % (cannot revert)', p_payment_id, v_payment.status;
  END IF;

  -- 2. Update payment status.
  UPDATE payments SET status = 'refunded', updated_at = p_as_of WHERE id = p_payment_id;

  -- 3. Find original ledger entry + insert reversal.
  SELECT * INTO v_original_ledger
    FROM ledger_entries
    WHERE source_type = 'payment' AND source_id = p_payment_id::TEXT AND entry_type = 'payment'
    LIMIT 1;

  IF FOUND THEN
    -- Determine originalWasPending: true if the original payment's status
    -- was 'pending' (uncleared funds). This is the CRITICAL branch.
    v_original_was_pending := (v_original_ledger.payment_status = 'pending');

    -- FRESH-DB FIX: same triple bug (type column, text id into uuid PK,
    -- missing NOT NULL entry_number).
    v_reversal_id := 'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8);
    INSERT INTO ledger_entries (
      entry_number, tenant_id, account_id, parent_id, student_id, category, amount,
      entry_type, source_type, source_id, method, receipt_number, payment_status,
      reverses_id, description, actor_id, actor_name, at, metadata
    ) VALUES (
      v_reversal_id, v_payment.tenant_id, v_original_ledger.account_id,
      v_original_ledger.parent_id, v_original_ledger.student_id,
      v_original_ledger.category, -v_original_ledger.amount,
      'reversal', 'payment', p_payment_id::TEXT,
      -- Canonical: refund/reversal entries have method=null, paymentStatus=null.
      NULL, v_original_ledger.receipt_number, NULL,
      v_original_ledger.id::TEXT,
      'Remboursement ' || v_payment.receipt_number || ' — inversion de l''écriture de paiement',
      p_actor_id::TEXT, p_actor_name, p_as_of,
      JSONB_BUILD_OBJECT('refundReason', p_reason, 'originalPaymentId', p_payment_id, 'originalWasPending', v_original_was_pending)
    );

    -- 4. LIFO reverse-waterfall.
    v_remaining := v_payment.amount;

    IF v_original_was_pending THEN
      -- Pending branch: subtract from amount_pending. NEVER touch amount_paid.
      FOR v_ins IN
        SELECT id, amount_due, amount_paid, amount_pending, due_date, status
        FROM installments
        WHERE parent_id = v_payment.parent_id
          AND amount_pending > 0
          AND (v_payment.category IS NULL OR category = v_payment.category)
        ORDER BY due_date DESC, id DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_revert := LEAST(v_remaining, v_ins.amount_pending);
        v_new_pending := v_ins.amount_pending - v_revert;
        v_new_paid := v_ins.amount_paid;  -- UNCHANGED for pending reversals
        -- Status re-evaluation: pending reversal doesn't change paid amount,
        -- so if there were no cleared funds, tranche reverts to its prior
        -- non-pending status based on amount_paid vs amount_due.
        IF v_new_paid >= v_ins.amount_due AND v_ins.amount_due > 0 THEN
          v_new_status := 'paid';
        ELSIF v_new_paid > 0 THEN
          v_new_status := 'partial';
        ELSIF v_ins.due_date < p_as_of THEN
          v_new_status := 'overdue';
        ELSE
          -- Canonical reevaluateInstallmentStatus: fully unpaid + future due
          -- date reverts to 'pending' (equivalence finding A-0042-LADDER).
          v_new_status := 'pending';
        END IF;
        -- If amount_pending is now 0, status reverts to the above. If > 0,
        -- keep pending_clearance (still has uncleared funds).
        IF v_new_pending > 0 THEN
          v_new_status := 'pending_clearance';
        END IF;
        UPDATE installments
          SET amount_paid = v_new_paid, amount_pending = v_new_pending,
              status = v_new_status,
              paid_date = CASE WHEN v_new_status = 'paid' THEN paid_date ELSE NULL END
          WHERE id = v_ins.id;
        v_reverts := v_reverts || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'installmentId', v_ins.id, 'revertedAmount', v_revert,
          'newAmountPaid', v_new_paid, 'newAmountPending', v_new_pending,
          'newStatus', v_new_status, 'bucket', 'pending'
        ));
        v_count := v_count + 1;
        v_total_reverted := v_total_reverted + v_revert;
        v_remaining := v_remaining - v_revert;
      END LOOP;
    ELSE
      -- Cleared branch: subtract from amount_paid.
      FOR v_ins IN
        SELECT id, amount_due, amount_paid, amount_pending, due_date, status
        FROM installments
        WHERE parent_id = v_payment.parent_id
          AND amount_paid > 0
          AND (v_payment.category IS NULL OR category = v_payment.category)
        ORDER BY due_date DESC, id DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_revert := LEAST(v_remaining, v_ins.amount_paid);
        v_new_paid := v_ins.amount_paid - v_revert;
        v_new_pending := v_ins.amount_pending;  -- unchanged for cleared reversals
        IF v_new_paid >= v_ins.amount_due AND v_ins.amount_due > 0 THEN
          v_new_status := 'paid';
        ELSIF v_new_paid > 0 THEN
          v_new_status := 'partial';
        ELSIF v_ins.due_date < p_as_of THEN
          v_new_status := 'overdue';
        ELSE
          -- Canonical reevaluateInstallmentStatus: fully unpaid + future due
          -- date reverts to 'pending' (equivalence finding A-0042-LADDER).
          v_new_status := 'pending';
        END IF;
        UPDATE installments
          SET amount_paid = v_new_paid, amount_pending = v_new_pending,
              status = v_new_status,
              paid_date = CASE WHEN v_new_status = 'paid' THEN paid_date ELSE NULL END
          WHERE id = v_ins.id;
        v_reverts := v_reverts || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'installmentId', v_ins.id, 'revertedAmount', v_revert,
          'newAmountPaid', v_new_paid, 'newAmountPending', v_new_pending,
          'newStatus', v_new_status, 'bucket', 'paid'
        ));
        v_count := v_count + 1;
        v_total_reverted := v_total_reverted + v_revert;
        v_remaining := v_remaining - v_revert;
      END LOOP;
    END IF;
  END IF;

  -- 5. Audit log.
  -- SEC-112: stamped with the PAYMENT's actual tenant (v_payment.tenant_id),
  -- no longer the caller-supplied p_tenant_id.
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), v_payment.tenant_id, 'payment.refund', 'payment', p_payment_id,
    p_actor_id, p_actor_name,
    JSONB_BUILD_OBJECT(
      'before', JSONB_BUILD_OBJECT('status', v_payment.status),
      'after', JSONB_BUILD_OBJECT(
        'status', 'refunded', 'reversalEntryId', v_reversal_id,
        'revertsCount', v_count, 'totalReverted', v_total_reverted,
        'originalWasPending', v_original_was_pending
      )
    ),
    'Inversion LIFO via RPC revert_payment_allocation (canonical 0034) — ' || COALESCE(p_reason, 'N/A'),
    p_as_of
  );

  RETURN QUERY
    SELECT p_payment_id, 'refunded'::TEXT, v_reversal_id, v_count, v_total_reverted;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. upsert_payment_from_import — SEC-111 caller-tenant verification
--    (stays SECURITY DEFINER: Android sync, desktop fallback and the
--    Excel importer depend on it; retirement is UNKNOWN-002/ADR-005)
-- ----------------------------------------------------------------------------
create or replace function public.upsert_payment_from_import(p_tenant_id uuid, p_payment_number text, p_parent_id text, p_student_id text, p_invoice_id uuid DEFAULT NULL::uuid, p_installment_id text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_method text DEFAULT 'cash'::text, p_category text DEFAULT 'other'::text, p_status text DEFAULT 'paid'::text, p_check_number text DEFAULT NULL::text, p_check_bank_name text DEFAULT NULL::text, p_check_issue_date date DEFAULT NULL::date, p_check_clearance_date date DEFAULT NULL::date, p_transfer_reference text DEFAULT NULL::text, p_transfer_source_bank text DEFAULT NULL::text, p_proof_path text DEFAULT NULL::text, p_collected_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_collected_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_reversal_of_payment_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(payment_id uuid, payment_number text, was_inserted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id uuid;
    v_num text := p_payment_number;
    v_inserted boolean := false;
    v_existing RECORD;
    v_final_status text;
    v_parent uuid := public.resolve_parent_ref(p_tenant_id, p_parent_id);
    v_student uuid := public.resolve_student_ref(p_tenant_id, p_student_id);
    v_installment uuid := public.resolve_installment_ref(p_tenant_id, p_installment_id);
BEGIN
    -- ── SEC-111: caller-tenant verification ──────────────────────────
    -- The SECURITY DEFINER flag bypasses RLS, so without this check any
    -- authenticated caller could write payments into ANY tenant by
    -- passing a foreign p_tenant_id. Trusted exemptions:
    --   - service_role: server-side code (Edge Functions, import jobs);
    --   - global admins (0053): no resolvable current_tenant_id()
    --     (user_profiles.tenant_id IS NULL); the desktop TENANT-103
    --     fallback legitimately targets the demo tenant.
    IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       AND NOT public.is_global_admin()
       AND p_tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
        RAISE EXCEPTION 'upsert_payment_from_import: p_tenant_id does not match the authenticated caller''s tenant (SEC-111)';
    END IF;

    IF v_parent IS NULL THEN
        RAISE EXCEPTION 'upsert_payment_from_import: unresolvable parent ref %', p_parent_id;
    END IF;

    -- NOTE: qualify — `payment_number` is also an output column of the
    -- RETURNS TABLE (unqualified refs are ambiguous).
    SELECT pay.id, pay.payment_number INTO v_existing
      FROM public.payments pay
     WHERE pay.tenant_id = p_tenant_id
       AND pay.payment_number = p_payment_number
     LIMIT 1;

    -- Determine the auto-status for cash vs non-cash (mirrors enforce_payment_proof trigger).
    v_final_status := COALESCE(p_status, CASE WHEN p_method = 'cash' THEN 'paid' ELSE 'pending' END);

    IF FOUND THEN
        v_id := v_existing.id;
        UPDATE public.payments
           SET parent_id        = COALESCE(v_parent, parent_id),
               student_id       = COALESCE(v_student, student_id),
               invoice_id       = COALESCE(p_invoice_id, invoice_id),
               installment_id   = COALESCE(v_installment, installment_id),
               amount           = COALESCE(p_amount, amount),
               method           = COALESCE(NULLIF(p_method, ''), method),
               category         = COALESCE(NULLIF(p_category, ''), category),
               status           = v_final_status,
               check_number     = COALESCE(p_check_number, check_number),
               check_bank_name  = COALESCE(p_check_bank_name, check_bank_name),
               check_issue_date = COALESCE(p_check_issue_date, check_issue_date),
               check_clearance_date = COALESCE(p_check_clearance_date, check_clearance_date),
               transfer_reference = COALESCE(p_transfer_reference, transfer_reference),
               transfer_source_bank = COALESCE(p_transfer_source_bank, transfer_source_bank),
               proof_path       = COALESCE(p_proof_path, proof_path),
               collected_at     = COALESCE(p_collected_at, collected_at),
               collected_by     = COALESCE(p_collected_by, collected_by),
               notes            = COALESCE(p_notes, notes),
               reversal_of_payment_id = COALESCE(p_reversal_of_payment_id, reversal_of_payment_id),
               updated_at       = now()
         WHERE id = v_id;
    ELSE
        v_id := public.gen_uuid();
        v_inserted := true;
        INSERT INTO public.payments (
            id, tenant_id, payment_number, parent_id, student_id, invoice_id, installment_id,
            amount, method, category, status,
            check_number, check_bank_name, check_issue_date, check_clearance_date,
            transfer_reference, transfer_source_bank, proof_path,
            collected_at, collected_by, notes, reversal_of_payment_id,
            created_at, updated_at
        ) VALUES (
            v_id, p_tenant_id, v_num, v_parent, v_student, p_invoice_id, v_installment,
            COALESCE(p_amount, 0), COALESCE(NULLIF(p_method, ''), 'cash'),
            COALESCE(NULLIF(p_category, ''), 'other'), v_final_status,
            p_check_number, p_check_bank_name, p_check_issue_date, p_check_clearance_date,
            p_transfer_reference, p_transfer_source_bank, p_proof_path,
            COALESCE(p_collected_at, now()), p_collected_by, p_notes, p_reversal_of_payment_id,
            now(), now()
        );
    END IF;

    RETURN QUERY SELECT v_id, v_num, v_inserted;
END;
$function$;
