-- ============================================================================
-- 0127_year_tracking_attribution.sql — T-436: the persisted academic-year
-- attribution (ADR-030; financial-rules.md §17; the owner's Year-Tracking
-- issue)
-- ============================================================================
-- WHAT THIS ADDS (and nothing else — the T-405 "extend, never duplicate"
-- rule, applied to attribution):
--
--   1. Nullable `academic_year_id uuid → academic_years(id)` on THREE
--      financial tables (the THREE year semantics, §17.1/INV-18):
--        - installments  → the CHARGE-BELONGING year (frozen at write
--          time — INV-18b: an échéance edit, a re-enrollment, or a later
--          payment NEVER rewrites it; DATA-051's silent-re-attribution
--          drift path is closed);
--        - payments      → the PAYMENT-MADE year (attributed from the
--          collection date);
--        - payment_allocations → the SETTLEMENT-TARGET year
--          (denormalized from the allocated installment AT ALLOCATION
--          TIME — "paid in 2026-2027 toward 2025-2026 debt" becomes a
--          first-class immutable fact, INV-18c/18d).
--      `ledger_entries` stays attribution-free (§ADR-030 consequence: no
--      read path needs a fourth column — payment behavior replays by
--      date, payments/allocation carry the years).
--   2. The BACKFILL: the INV-14 window rule materialized as a persisted
--      fact for every existing row (installments by due_date window,
--      payments by collected_at window, allocations by joining the
--      allocated installment). Rows outside every window keep NULL —
--      they resolve through the DOCUMENTED INV-14 fallback at read time
--      (one precedence: persisted column → INV-14; INV-18a).
--   3. resolve_academic_year_id_for_date(date, tenant) — the id-valued
--      twin of 0111's attribute_academic_year (used by the write paths).
--   4. collect_and_allocate_payment RECREATED (the 0115 definition —
--      signature and semantics preserved verbatim) stamping the new
--      columns: the payments row's year (resolved from p_as_of) + every
--      payment_allocations row's target year (the allocated
--      installment's persisted/attributed year).
--   5. upsert_installment_from_import RECREATED (the 0037 definition —
--      signature preserved) wiring the previously-DROPPED
--      `p_academic_year` parameter (DATA-052): the year resolves by
--      code/label match, falls back to the INV-14 window on due_date.
--   6. compute_debt_aging_rows RECREATED (the 0126 definition — same
--      signature/columns/wrapper consumption) re-basing the academic-year
--      attribution on the ONE precedence: the persisted column first,
--      the INV-14 window rule as the fallback (keeps the SQL mirror
--      parity-pinned with the TS engine's attributeInstallmentAcademicYear).
--   7. Indexes for the year-scoped read paths (the year-history engine's
--      collections).
--
-- PRESERVED: every existing behaviour — the INV-14 rule (now the
-- fallback), the receipt numbering, the waterfall order + INV-4 capacity
-- (0115), the audit shapes, the 0125 wrapper's 4-tier status, the 0126
-- factor semantics. Historical amounts are NEVER recalculated (INV-1/
-- INV-19a: amount_due is the price actually applied at creation).
--
-- GRANTS (§15.34): revoked EXPLICITLY from anon AND public on the new/
-- recreated functions (the platform default privileges grant anon
-- EXECUTE); authenticated keeps the canonical write/sync paths (RLS + the
-- RPC-internal gates do the authorization). NOTE: the live ACLs of
-- collect_and_allocate_payment + upsert_installment_from_import carried
-- the platform's DEFAULT public+anon EXECUTE (0115/0037 never revoked —
-- the §15.34 lesson predates them); 0127 hardens both to the
-- compute_debt_aging_* pattern. The desktop/Android callers use staff
-- JWTs (authenticated) — no legitimate path is affected.
--
-- Live application: T-091/MIG-TOKENS pattern (registration below,
-- atomic with the DDL; idempotent via ON CONFLICT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema: the three year columns (nullable FK; NO ACTION on delete — a
--    referenced year row cannot be hard-deleted: history is frozen)
-- ----------------------------------------------------------------------------
ALTER TABLE public.installments        ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id);
ALTER TABLE public.payments            ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id);
ALTER TABLE public.payment_allocations ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id);

-- Year-scoped read indexes (the year-history collections + the backfill's
-- verification reads). IF NOT EXISTS everywhere (idempotent re-runs).
create index if not exists ix_installments_tenant_year
    on public.installments (tenant_id, academic_year_id);
create index if not exists ix_payments_tenant_year
    on public.payments (tenant_id, academic_year_id);
create index if not exists ix_payment_allocations_installment_year
    on public.payment_allocations (installment_id, academic_year_id);

-- ----------------------------------------------------------------------------
-- 2. The backfill — the INV-14 window rule, materialized (INV-18a)
-- ----------------------------------------------------------------------------
-- 2a. Installments: the charge's year = the tenant window containing the
--     due date. Rows outside every window stay NULL (the documented
--     fallback resolves them by the Jul1–Jun30 convention at read time).
UPDATE public.installments i
   SET academic_year_id = ay.id
  FROM public.academic_years ay
 WHERE ay.tenant_id = i.tenant_id
   AND i.academic_year_id IS NULL
   AND i.due_date BETWEEN ay.start_date AND ay.end_date;

-- 2b. Payments: the payment-made year = the tenant window containing the
--     collection date (UTC).
UPDATE public.payments p
   SET academic_year_id = ay.id
  FROM public.academic_years ay
 WHERE ay.tenant_id = p.tenant_id
   AND p.academic_year_id IS NULL
   AND (p.collected_at AT TIME ZONE 'UTC')::date BETWEEN ay.start_date AND ay.end_date;

-- 2c. Payment allocations: the settlement-target year = the allocated
--     installment's (now-backfilled) year.
UPDATE public.payment_allocations pa
   SET academic_year_id = i.academic_year_id
  FROM public.installments i
 WHERE pa.academic_year_id IS NULL
   AND pa.installment_id = i.id
   AND i.academic_year_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. The id-valued attribution helper (the write paths' resolver)
-- ----------------------------------------------------------------------------
create or replace function public.resolve_academic_year_id_for_date(
    p_date date,
    p_tenant_id uuid
)
returns uuid
language sql
stable
security definer
set search_path to public
as $$
    select (
        select ay.id
          from public.academic_years ay
         where ay.tenant_id = p_tenant_id
           and p_date between ay.start_date and ay.end_date
         order by ay.start_date desc
         limit 1
    );
$$;

comment on function public.resolve_academic_year_id_for_date is
    'T-436: the id-valued INV-14 window resolver — the tenant academic_years row containing the date (NULL when no window matches; the Jul1–Jun30 convention is a CODE, not a row, and is resolved by the read-side precedence instead).';

-- ----------------------------------------------------------------------------
-- 4. collect_and_allocate_payment — RECREATED with the year stamping
--    (the 0115 definition; signature + semantics preserved verbatim —
--    §15.32a: the old overload is dropped first)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.collect_and_allocate_payment(
  uuid, uuid, uuid, numeric, text, text, uuid, text, text, uuid, text,
  text, text, date, date, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.collect_and_allocate_payment(
  p_tenant_id uuid, p_parent_id uuid, p_student_id uuid, p_amount numeric,
  p_method text, p_category text, p_installment_id uuid, p_proof_path text,
  p_notes text, p_actor_id uuid, p_actor_name text,
  p_check_number text DEFAULT NULL::text, p_check_bank_name text DEFAULT NULL::text,
  p_check_issue_date date DEFAULT NULL::date, p_check_clearance_date date DEFAULT NULL::date,
  p_transfer_reference text DEFAULT NULL::text, p_transfer_source_bank text DEFAULT NULL::text,
  p_as_of timestamp with time zone DEFAULT now()
)
 RETURNS TABLE(payment_id uuid, receipt_number text, payment_status text, total_allocated numeric, unallocated_credit numeric, allocations jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW()); v_seq INT; v_receipt TEXT; v_status TEXT;
  v_payment_id UUID := gen_random_uuid(); v_ledger_id TEXT; v_remaining NUMERIC;
  v_alloc JSONB := '[]'::JSONB; v_alloc_item JSONB; v_ins RECORD; v_unallocated NUMERIC := 0;
  v_account_id TEXT; v_ins_remaining NUMERIC; v_allocate NUMERIC; v_new_paid NUMERIC;
  v_new_pending NUMERIC; v_new_status TEXT; v_fully BOOLEAN;
  -- T-310: the RESOLVED actor (name + role).
  v_actor_name TEXT; v_actor_role TEXT;
  -- T-436: the payment-made year (INV-18) + the allocation target year.
  v_payment_year_id UUID;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be > 0 (got %)', p_amount; END IF;

  -- T-436 (ADR-030): the payment's academic year — the tenant window
  -- containing the collection date (NULL when outside: the read-side
  -- INV-14 fallback resolves it).
  v_payment_year_id := public.resolve_academic_year_id_for_date(
      (p_as_of AT TIME ZONE 'UTC')::date, p_tenant_id);

  -- T-310 (AUDIT-502): resolve the actor ONCE, up-front.
  IF p_actor_name IS NOT NULL AND p_actor_name <> '' AND p_actor_name <> p_actor_id::TEXT THEN
    v_actor_name := p_actor_name;
  ELSE
    SELECT coalesce(up.display_name, up.email) INTO v_actor_name
      FROM public.user_profiles up
     WHERE up.id = p_actor_id OR up.auth_user_id = p_actor_id
     ORDER BY (up.id = p_actor_id) DESC
     LIMIT 1;
    v_actor_name := coalesce(v_actor_name, 'System');
  END IF;
  SELECT r.code INTO v_actor_role
    FROM public.role_assignments ra
    JOIN public.roles r ON r.id = ra.role_id
   WHERE ra.user_profile_id = (
         SELECT up.id FROM public.user_profiles up
          WHERE up.id = p_actor_id OR up.auth_user_id = p_actor_id
          ORDER BY (up.id = p_actor_id) DESC LIMIT 1)
     AND ra.revoked_at IS NULL
   ORDER BY r.code
   LIMIT 1;

  v_status := CASE WHEN p_method = 'cash' THEN 'paid' ELSE 'pending' END;

  SELECT COALESCE(MAX(CAST(SUBSTRING(pay.receipt_number FROM '\d{6}$') AS INT)), 0) + 1 INTO v_seq
  FROM payments pay
  WHERE pay.tenant_id = p_tenant_id AND pay.receipt_number LIKE 'REC-' || v_year || '-%';
  v_receipt := 'REC-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');

  -- ADR-023: p_category NULL = multi-service — stored as NULL (the payments
  -- row renders "Multi-services"; per-service truth lives in
  -- payment_allocations). Concrete categories are stored verbatim (T-060).
  INSERT INTO payments (
    id, tenant_id, payment_number, receipt_number, parent_id, student_id, amount,
    method, status, category, installment_id, proof_path, notes,
    check_number, check_bank_name, check_issue_date, check_clearance_date,
    transfer_reference, transfer_source_bank,
    collected_by, collected_at, created_at, updated_at,
    academic_year_id
  ) VALUES (
    v_payment_id, p_tenant_id, v_receipt, v_receipt, p_parent_id, p_student_id, p_amount,
    p_method, v_status, p_category, p_installment_id, p_proof_path, p_notes,
    p_check_number, p_check_bank_name, p_check_issue_date, p_check_clearance_date,
    p_transfer_reference, p_transfer_source_bank,
    p_actor_id, p_as_of, p_as_of, p_as_of,
    v_payment_year_id
  );

  -- ADR-023: the cross-category payment entry books ONE entry (the revert
  -- RPC reverses a single entry by source_id) on the synthetic account
  -- `parent:{id}:category:all` with a NULL category. Parent-level replay
  -- (Σ signed balances) reduces the outstanding correctly; per-category
  -- views read payment_allocations.
  v_account_id := 'parent:' || p_parent_id || ':category:' || COALESCE(p_category, 'all');
  IF p_student_id IS NOT NULL THEN v_account_id := v_account_id || ':student:' || p_student_id; END IF;
  v_ledger_id := 'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8);
  INSERT INTO ledger_entries (
    entry_number, tenant_id, account_id, parent_id, student_id, category, amount,
    entry_type, source_type, source_id, method, receipt_number, payment_status,
    reverses_id, description, actor_id, actor_name, at, metadata
  ) VALUES (
    v_ledger_id, p_tenant_id, v_account_id, p_parent_id, p_student_id,
    p_category, -p_amount, 'payment', 'payment', v_payment_id::TEXT,
    p_method, v_receipt, v_status, NULL,
    'Encaissement ' || v_receipt || ' — ' || p_method || ' (' || COALESCE(p_category, 'multi-services') || ')',
    p_actor_id::TEXT, v_actor_name, p_as_of,
    JSONB_BUILD_OBJECT(
      'installmentId', p_installment_id, 'proofUrl', p_proof_path,
      'checkNumber', p_check_number, 'checkBankName', p_check_bank_name,
      'checkIssueDate', p_check_issue_date, 'checkClearanceDate', p_check_clearance_date,
      'transferReference', p_transfer_reference, 'transferSourceBank', p_transfer_source_bank
    )
  );

  v_remaining := p_amount;
  IF v_status = 'paid' THEN
    FOR v_ins IN
      SELECT id, amount_due, amount_paid, amount_pending, due_date, status, category, label,
             academic_year_id
      FROM installments
      WHERE parent_id = p_parent_id AND status <> 'paid'
        AND (p_category IS NULL OR category = p_category)
      ORDER BY due_date ASC, id ASC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      -- BUSINESS-107 (INV-4): the cleared branch now subtracts
      -- amount_pending too — a cheque pending on the tranche reduces the
      -- capacity for a subsequent CASH payment, so paid + pending can
      -- never exceed due.
      v_ins_remaining := GREATEST(0, v_ins.amount_due - v_ins.amount_paid - v_ins.amount_pending);
      IF v_ins_remaining <= 0 THEN CONTINUE; END IF;
      v_allocate := LEAST(v_remaining, v_ins_remaining);
      v_new_paid := v_ins.amount_paid + v_allocate;
      v_new_pending := v_ins.amount_pending;
      v_fully := v_new_paid >= v_ins.amount_due;
      IF v_fully THEN v_new_status := 'paid';
      ELSIF v_new_paid > 0 THEN v_new_status := 'partial';
      ELSE v_new_status := CASE WHEN v_ins.status = 'overdue' THEN 'overdue' ELSE 'pending' END; END IF;
      UPDATE installments
        SET amount_paid = v_new_paid, amount_pending = v_new_pending,
            status = v_new_status,
            paid_date = CASE WHEN v_new_status = 'paid' THEN COALESCE(paid_date, p_as_of) ELSE paid_date END
        WHERE id = v_ins.id;
      -- DATA-029: the canonical per-payment coverage record (T-330 chain).
      -- Concrete category per row — including for cross-category payments.
      -- T-436: the SETTLEMENT-TARGET year (INV-18c/18d) — the allocated
      -- installment's persisted year, resolved through the INV-14 window
      -- when the row predates the column.
      INSERT INTO payment_allocations (
        id, tenant_id, payment_id, charge_id, installment_id, category,
        allocated_amount, label, created_at, academic_year_id
      ) VALUES (
        gen_random_uuid(), p_tenant_id, v_payment_id, NULL, v_ins.id,
        v_ins.category, v_allocate, v_ins.label, p_as_of,
        COALESCE(v_ins.academic_year_id,
                 public.resolve_academic_year_id_for_date(v_ins.due_date, p_tenant_id))
      );
      v_alloc_item := JSONB_BUILD_OBJECT('installmentId', v_ins.id,
        'allocatedAmount', v_allocate, 'newAmountPaid', v_new_paid,
        'newAmountPending', v_new_pending, 'newStatus', v_new_status,
        'fullySatisfied', v_fully, 'cleared', TRUE, 'category', v_ins.category);
      v_alloc := v_alloc || JSONB_BUILD_ARRAY(v_alloc_item);
      v_remaining := v_remaining - v_allocate;
    END LOOP;
    v_unallocated := GREATEST(0, v_remaining);
    IF v_unallocated > 0 THEN
      INSERT INTO ledger_entries (
        entry_number, tenant_id, account_id, parent_id, student_id, category, amount,
        entry_type, source_type, source_id, method, receipt_number, payment_status,
        reverses_id, description, actor_id, actor_name, at, metadata
      ) VALUES (
        'led-' || EXTRACT(EPOCH FROM NOW()) || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8),
        p_tenant_id, 'parent:' || p_parent_id || ':category:parent_credit',
        p_parent_id, NULL, 'parent_credit', -v_unallocated,
        'adjustment', 'adjustment', 'credit-' || v_payment_id::TEXT,
        NULL, NULL, NULL, NULL,
        'Crédit parent (excédent de paiement reçu ' || v_receipt || ')',
        p_actor_id::TEXT, v_actor_name, p_as_of,
        JSONB_BUILD_OBJECT('sourcePaymentId', v_payment_id, 'unallocatedAmount', v_unallocated)
      );
    END IF;
  ELSE
    FOR v_ins IN
      SELECT id, amount_due, amount_paid, amount_pending, due_date, status, category, label,
             academic_year_id
      FROM installments
      WHERE parent_id = p_parent_id AND status <> 'paid'
        AND (p_category IS NULL OR category = p_category)
      ORDER BY due_date ASC, id ASC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_ins_remaining := GREATEST(0, v_ins.amount_due - v_ins.amount_paid - v_ins.amount_pending);
      IF v_ins_remaining <= 0 THEN CONTINUE; END IF;
      v_allocate := LEAST(v_remaining, v_ins_remaining);
      v_new_paid := v_ins.amount_paid;
      v_new_pending := v_ins.amount_pending + v_allocate;
      v_new_status := 'pending_clearance'; v_fully := FALSE;
      UPDATE installments
        SET amount_paid = v_new_paid, amount_pending = v_new_pending,
            status = v_new_status, paid_date = paid_date
        WHERE id = v_ins.id;
      -- DATA-029: pending allocations are recorded too (cleared = FALSE is
      -- derivable from the payment's status; the amount is the commitment).
      -- T-436: the settlement-target year, same as the cleared branch.
      INSERT INTO payment_allocations (
        id, tenant_id, payment_id, charge_id, installment_id, category,
        allocated_amount, label, created_at, academic_year_id
      ) VALUES (
        gen_random_uuid(), p_tenant_id, v_payment_id, NULL, v_ins.id,
        v_ins.category, v_allocate, v_ins.label, p_as_of,
        COALESCE(v_ins.academic_year_id,
                 public.resolve_academic_year_id_for_date(v_ins.due_date, p_tenant_id))
      );
      v_alloc_item := JSONB_BUILD_OBJECT('installmentId', v_ins.id,
        'allocatedAmount', v_allocate, 'newAmountPaid', v_new_paid,
        'newAmountPending', v_new_pending, 'newStatus', v_new_status,
        'fullySatisfied', FALSE, 'cleared', FALSE, 'category', v_ins.category);
      v_alloc := v_alloc || JSONB_BUILD_ARRAY(v_alloc_item);
      v_remaining := v_remaining - v_allocate;
    END LOOP;
    v_unallocated := GREATEST(0, v_remaining);
    -- No parent_credit insert for pending funds (canonical defers until clearance)
  END IF;

  -- 6. Audit log (T-310 canonical columns preserved verbatim).
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name, actor_role,
    before_json, after_json, diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.collect', 'payment', v_payment_id,
    p_actor_id, v_actor_name, v_actor_role,
    NULL,
    JSONB_BUILD_OBJECT(
      'amount', p_amount, 'method', p_method, 'receipt', v_receipt,
      'status', v_status, 'allocations', v_alloc,
      'unallocatedCredit', v_unallocated, 'category', p_category,
      'paymentAcademicYearId', v_payment_year_id
    ),
    JSONB_BUILD_OBJECT(
      'amount', p_amount, 'method', p_method, 'receipt', v_receipt,
      'status', v_status, 'allocations', v_alloc,
      'unallocatedCredit', v_unallocated, 'category', p_category,
      'paymentAcademicYearId', v_payment_year_id
    ),
    'Encaissement atomique via RPC collect_and_allocate_payment (canonical 0034 + structured fields; 0115 INV-4/cross-category; 0127 T-436 year stamping)',
    p_as_of
  );

  RETURN QUERY SELECT v_payment_id, v_receipt, v_status,
    p_amount - v_unallocated, v_unallocated, v_alloc;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. upsert_installment_from_import — RECREATED with p_academic_year
--    WIRED (DATA-052: the 0037 definition accepted the parameter and
--    silently dropped it — neither branch ever wrote it)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_installment_from_import(
    uuid, text, text, text, text, text, numeric, numeric, numeric, date, date,
    text, text, text);

CREATE OR REPLACE FUNCTION public.upsert_installment_from_import(
    p_tenant_id          uuid,
    p_parent_id          text,               -- UUID OR parent_code / local ref
    p_installment_ref    text DEFAULT NULL,  -- mobile local id ("ins-...")
    p_student_id         text DEFAULT NULL,  -- UUID OR student_code / local ref
    p_category           text DEFAULT 'tuition',
    p_label              text DEFAULT NULL,
    p_amount_due         numeric(12,2) DEFAULT NULL,
    p_amount_paid        numeric(12,2) DEFAULT NULL,
    p_amount_pending     numeric(12,2) DEFAULT NULL,
    p_due_date           date DEFAULT NULL,
    p_paid_date          date DEFAULT NULL,
    p_status             text DEFAULT 'unpaid',
    p_academic_cycle     text DEFAULT NULL,
    p_academic_year      text DEFAULT NULL
)
RETURNS table(installment_id uuid, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path to public
AS $$
DECLARE
    v_id uuid;
    v_inserted boolean := false;
    v_existing uuid;
    v_parent uuid := public.resolve_parent_ref(p_tenant_id, p_parent_id);
    v_student uuid := public.resolve_student_ref(p_tenant_id, p_student_id);
    v_tranche int;
    v_label text := NULLIF(TRIM(COALESCE(p_label, '')), '');
    -- T-436 (DATA-052): the year id the parameter resolves to — an explicit
    -- code/label match against the tenant's academic_years first, then the
    -- INV-14 window on due_date; NULL when unresolvable (the read-side
    -- precedence fallback applies).
    v_year_id uuid := NULL;
BEGIN
    IF v_parent IS NULL THEN
        RAISE EXCEPTION 'upsert_installment_from_import: unresolvable parent ref %', p_parent_id;
    END IF;

    -- T-436: resolve p_academic_year (code or label match, tenant-scoped).
    IF p_academic_year IS NOT NULL AND NULLIF(TRIM(p_academic_year), '') IS NOT NULL THEN
        SELECT ay.id INTO v_year_id
          FROM public.academic_years ay
         WHERE ay.tenant_id = p_tenant_id
           AND (ay.code = p_academic_year OR ay.label = p_academic_year)
         ORDER BY ay.start_date DESC
         LIMIT 1;
    END IF;
    -- INV-14 window fallback on the due date when no explicit match.
    IF v_year_id IS NULL AND p_due_date IS NOT NULL THEN
        v_year_id := public.resolve_academic_year_id_for_date(p_due_date, p_tenant_id);
    END IF;

    -- Derive tranche_number from the label ("Tranche 2" -> 2) for identity matching.
    v_tranche := COALESCE(
        (SELECT NULLIF(regexp_replace(v_label, '\D', '', 'g'), '')::int WHERE v_label ~ 'Tranche\s*\d+'),
        NULL
    );

    -- Identity 1: mobile source provenance (source_type='android_sync', source_id=local ref)
    IF p_installment_ref IS NOT NULL AND TRIM(p_installment_ref) <> '' THEN
        SELECT id INTO v_existing
          FROM public.installments
         WHERE tenant_id = p_tenant_id
           AND source_type = 'android_sync'
           AND source_id = p_installment_ref
         LIMIT 1;
    END IF;

    -- Identity 2: canonical tranche identity (0032 bulk-import index columns)
    IF v_existing IS NULL AND v_student IS NOT NULL AND v_tranche IS NOT NULL THEN
        SELECT id INTO v_existing
          FROM public.installments
         WHERE tenant_id = p_tenant_id
           AND parent_id = v_parent
           AND student_id = v_student
           AND category = COALESCE(NULLIF(p_category, ''), 'tuition')
           AND tranche_number = v_tranche
         LIMIT 1;
    END IF;

    IF v_existing IS NOT NULL THEN
        UPDATE public.installments
           SET parent_id       = COALESCE(v_parent, parent_id),
               student_id      = COALESCE(v_student, student_id),
               category        = COALESCE(NULLIF(p_category, ''), category),
               label           = COALESCE(v_label, label),
               amount_due      = COALESCE(p_amount_due, amount_due),
               amount_paid     = COALESCE(p_amount_paid, amount_paid),
               amount_pending  = COALESCE(p_amount_pending, amount_pending),
               due_date        = COALESCE(p_due_date, due_date),
               paid_date       = COALESCE(p_paid_date, paid_date),
               status          = COALESCE(NULLIF(p_status, ''), status),
               academic_cycle  = COALESCE(p_academic_cycle, academic_cycle),
               academic_year_id = COALESCE(v_year_id, academic_year_id),
               source_type     = COALESCE(source_type, 'android_sync'),
               source_id       = COALESCE(source_id, p_installment_ref),
               updated_at      = now()
         WHERE id = v_existing;
        v_id := v_existing;
    ELSE
        v_id := public.gen_uuid();
        v_inserted := true;
        INSERT INTO public.installments (
            id, tenant_id, parent_id, student_id, category, label,
            tranche_number, amount_due, amount_paid, amount_pending,
            due_date, paid_date, status, academic_cycle,
            academic_year_id,
            source_type, source_id,
            created_at, updated_at
        ) VALUES (
            v_id, p_tenant_id, v_parent, v_student,
            COALESCE(NULLIF(p_category, ''), 'tuition'), v_label,
            v_tranche,
            COALESCE(p_amount_due, 0), COALESCE(p_amount_paid, 0),
            COALESCE(p_amount_pending, 0),
            COALESCE(p_due_date, current_date + 30), p_paid_date,
            COALESCE(NULLIF(p_status, ''), 'unpaid'), p_academic_cycle,
            v_year_id,
            'android_sync', p_installment_ref,
            now(), now()
        )
        ON CONFLICT DO NOTHING;
        IF NOT FOUND THEN
            -- Concurrent insert hit the bulk-import identity index — re-match.
            SELECT id INTO v_id
              FROM public.installments
             WHERE tenant_id = p_tenant_id
               AND parent_id = v_parent
               AND student_id = v_student
               AND category = COALESCE(NULLIF(p_category, ''), 'tuition')
               AND tranche_number = v_tranche
             LIMIT 1;
            v_inserted := false;
        END IF;
    END IF;

    RETURN QUERY SELECT v_id, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_installment_from_import IS
  'Idempotent installment upsert for cross-platform sync push (0037). Identity: '
  '(tenant, source_type=''android_sync'', source_id=local ref) with fallback to '
  '(tenant, parent, student, category, tranche_number). Amounts are DZD '
  'numeric(12,2) — mobile clients convert centimes before calling. '
  'T-436 (DATA-052): p_academic_year is now WIRED — an explicit code/label match '
  'against the tenant''s academic_years (INV-14 window fallback on due_date) written '
  'to installments.academic_year_id on both branches; previously accepted and dropped.';

-- ----------------------------------------------------------------------------
-- 6. compute_debt_aging_rows — RECREATED with the attribution PRECEDENCE
--    (the 0126 definition; same signature/columns/wrapper consumption —
--    only the attribution expressions change: the persisted
--    installments.academic_year_id first, the INV-14 window fallback)
-- ----------------------------------------------------------------------------
create or replace function public.compute_debt_aging_rows(
    p_tenant_id uuid,        -- NULL = all tenants (the matview's usage)
    p_as_of timestamptz      -- the evaluation clock (determinism / as-of)
)
returns table (
    tenant_id uuid,
    parent_id uuid,
    parent_name text,
    parent_phone text,
    student_ids uuid[],
    outstanding_amount numeric,
    oldest_due_date date,
    debt_age_days integer,
    origin_academic_year text,
    last_payment_at timestamptz,
    days_since_last_payment integer,
    inactivity_days integer,
    subsequent_year_payment_count integer,
    subsequent_year_payment_total numeric,
    has_subsequent_year_payments boolean,
    obligations jsonb,
    status_level text,
    reason_code text,
    computed_at timestamptz
)
language sql
stable
security definer
set search_path to public
as $$
    -- T-432: the tenant's academic-year windows, materialized ONCE. When
    -- p_tenant_id IS NULL (the matview's all-tenants usage) the CTE carries
    -- EVERY tenant's windows and the attribution subqueries correlate on the
    -- row's own tenant_id.
    -- T-436: the CTE additionally carries ay.id — the persisted-column
    -- precedence (INV-18a) resolves through it.
    with ay as (
        select ayw.tenant_id, ayw.id as ay_id, ayw.label, ayw.start_date, ayw.end_date
          from public.academic_years ayw
         where p_tenant_id is null or ayw.tenant_id = p_tenant_id
    ),
    oblig as (
        select i.tenant_id,
               i.parent_id,
               i.id as installment_id,
               i.student_id,
               i.category,
               i.label,
               greatest(0, i.amount_due - i.amount_paid - i.amount_pending) as remaining,
               i.due_date,
               i.academic_year_id
          from public.installments i
         where (p_tenant_id is null or i.tenant_id = p_tenant_id)
           and greatest(0, i.amount_due - i.amount_paid - i.amount_pending) > 0
    ),
    -- T-436: the OLDEST outstanding obligation (min due date, then min
    -- installment id — the §15 ordering) WITH its own attribution inputs,
    -- so the origin year follows the persisted column of THAT obligation.
    oldest_oblig as (
        select distinct on (o.tenant_id, o.parent_id)
               o.tenant_id, o.parent_id, o.due_date, o.academic_year_id
          from oblig o
         order by o.tenant_id, o.parent_id, o.due_date, o.installment_id
    ),
    per_parent as (
        select o.tenant_id,
               o.parent_id,
               sum(o.remaining) as outstanding_amount,
               min(o.due_date) as oldest_due_date
          from oblig o
         group by o.tenant_id, o.parent_id
    ),
    attributed as (
        select pp.tenant_id,
               pp.parent_id,
               pp.outstanding_amount,
               pp.oldest_due_date,
               -- T-436 (INV-18a — the ONE precedence): the oldest
               -- obligation's PERSISTED year first (resolved through the
               -- materialized windows), then the INV-14 convention on its
               -- due date (byte-identical to 0126 when the column is NULL).
               coalesce(
                   (select a.label
                      from ay a
                     where a.tenant_id = oo.tenant_id
                       and a.ay_id = oo.academic_year_id
                     limit 1),
                   (select a.label
                      from ay a
                     where a.tenant_id = oo.tenant_id
                       and oo.due_date between a.start_date and a.end_date
                     order by a.start_date desc
                     limit 1),
                   case
                       when extract(month from oo.due_date) >= 7 then
                           extract(year from oo.due_date)::int::text || '-' || (extract(year from oo.due_date)::int + 1)::text
                       else
                           (extract(year from oo.due_date)::int - 1)::text || '-' || extract(year from oo.due_date)::int::text
                   end
               ) as origin_academic_year
          from per_parent pp
          join oldest_oblig oo
            on oo.tenant_id = pp.tenant_id
           and oo.parent_id = pp.parent_id
    ),
    pay as (
        select e.parent_id, e.entry_date, e.amount, e.source_id
          from public.ledger_entries e
         where e.entry_type = 'payment'
           and (p_tenant_id is null or e.tenant_id = p_tenant_id)
           -- Reversal exclusion mirrors the TS engine (computeAccountBalance's
           -- reversedIds): a payment reversed by ANY entry is not payment behavior.
           and not exists (
               select 1 from public.ledger_entries r
                where r.reverses_entry_id = e.id
           )
    ),
    pay_last as (
        select pl.parent_id, max(pl.entry_date) as last_payment_at
          from pay pl
         group by pl.parent_id
    ),
    pay_sub as (
        select a.parent_id,
               count(ps.entry_date) as subsequent_year_payment_count,
               coalesce(sum(abs(ps.amount)), 0) as subsequent_year_payment_total
          from attributed a
          join pay ps
            on ps.parent_id = a.parent_id
           -- T-436 (INV-18): the payment's year — the PERSISTED
           -- payments.academic_year_id first (joined through the ledger
           -- entry's source_id = the payment id), then the INV-14
           -- attribution of the entry date. The keying on a.tenant_id is
           -- the 0126 parity note, preserved.
           and public.academic_year_start(
                   coalesce(
                       (select ay2.label
                          from ay ay2
                         where ay2.tenant_id = a.tenant_id
                           and ay2.ay_id = (
                               select pr.academic_year_id
                                 from public.payments pr
                                where pr.id::text = ps.source_id
                                  and (p_tenant_id is null or pr.tenant_id = a.tenant_id)
                           )
                         limit 1),
                       (select ay2.label
                          from ay ay2
                         where ay2.tenant_id = a.tenant_id
                           and (ps.entry_date at time zone 'UTC')::date between ay2.start_date and ay2.end_date
                         order by ay2.start_date desc
                         limit 1),
                       case
                           when extract(month from (ps.entry_date at time zone 'UTC')::date) >= 7 then
                               extract(year from (ps.entry_date at time zone 'UTC')::date)::int::text || '-' || (extract(year from (ps.entry_date at time zone 'UTC')::date)::int + 1)::text
                           else
                               (extract(year from (ps.entry_date at time zone 'UTC')::date)::int - 1)::text || '-' || extract(year from (ps.entry_date at time zone 'UTC')::date)::int::text
                       end
                   )
               ) > public.academic_year_start(a.origin_academic_year)
         group by a.parent_id
    ),
    oblig_detail as (
        select o.tenant_id,
               o.parent_id,
               jsonb_agg(
                   jsonb_build_object(
                       'installmentId', o.installment_id::text,
                       'studentId', o.student_id::text,
                       'category', o.category,
                       'label', o.label,
                       'remaining', o.remaining,
                       'dueDate', to_char(o.due_date, 'YYYY-MM-DD'),
                       -- T-436 (INV-18a): the per-obligation year — the
                       -- persisted column first, the INV-14 rule fallback.
                       'academicYear', coalesce(
                           (select ay3.label
                              from ay ay3
                             where ay3.tenant_id = o.tenant_id
                               and ay3.ay_id = o.academic_year_id
                             limit 1),
                           (select ay3.label
                              from ay ay3
                             where ay3.tenant_id = o.tenant_id
                               and o.due_date between ay3.start_date and ay3.end_date
                             order by ay3.start_date desc
                             limit 1),
                           case
                               when extract(month from o.due_date) >= 7 then
                                   extract(year from o.due_date)::int::text || '-' || (extract(year from o.due_date)::int + 1)::text
                               else
                                   (extract(year from o.due_date)::int - 1)::text || '-' || extract(year from o.due_date)::int::text
                           end
                       ),
                       'daysOverdue', greatest(0, floor(extract(epoch from (p_as_of - o.due_date::timestamptz)) / 86400))::int
                   ) order by o.due_date, o.installment_id
               ) as obligations,
               coalesce(
                   array_agg(distinct o.student_id) filter (where o.student_id is not null),
                   array[]::uuid[]
               ) as student_ids
          from oblig o
         group by o.tenant_id, o.parent_id
    ),
    -- The per-parent FACTORS, computed once (the INV-16 evaluation inputs).
    -- NOTE the never-paid semantics: inactivity is CASE-based, NOT
    -- greatest(0, coalesce(...)) — postgres GREATEST IGNORES NULLs, so
    -- `greatest(0, floor(p_as_of - NULL))` collapses to 0 and a never-paid
    -- parent would look perfectly active (the live-caught defect this
    -- restructure fixed; INV-16b demands inactivity = debt age there).
    factors as (
        select
            a.tenant_id,
            a.parent_id,
            a.outstanding_amount,
            a.oldest_due_date,
            a.origin_academic_year,
            greatest(0, floor(extract(epoch from (p_as_of - a.oldest_due_date::timestamptz)) / 86400))::int as debt_age_days,
            plast.last_payment_at,
            case when plast.last_payment_at is null then null
                 else greatest(0, floor(extract(epoch from (p_as_of - plast.last_payment_at)) / 86400))::int
            end as days_since_last_payment,
            -- §15 inactivity: last-payment recency; never-paid → debt age
            -- (INV-16b).
            case when plast.last_payment_at is null
                 then greatest(0, floor(extract(epoch from (p_as_of - a.oldest_due_date::timestamptz)) / 86400))::int
                 else greatest(0, floor(extract(epoch from (p_as_of - plast.last_payment_at)) / 86400))::int
            end as inactivity_days,
            coalesce(psub.subsequent_year_payment_count, 0) as subsequent_year_payment_count,
            coalesce(psub.subsequent_year_payment_total, 0) as subsequent_year_payment_total
          from attributed a
          left join pay_last plast on plast.parent_id = a.parent_id
          left join pay_sub psub on psub.parent_id = a.parent_id
         where a.outstanding_amount > 0.001
    )
    select
        p.tenant_id,
        p.id as parent_id,
        -- Name resolution mirrors the DebtTab's seedSummary convention:
        -- display_name first, falling back to first + last.
        coalesce(
            nullif(trim(p.display_name), ''),
            trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
        ) as parent_name,
        p.primary_phone as parent_phone,
        od.student_ids,
        f.outstanding_amount,
        f.oldest_due_date,
        f.debt_age_days,
        f.origin_academic_year,
        f.last_payment_at,
        f.days_since_last_payment,
        f.inactivity_days,
        f.subsequent_year_payment_count,
        f.subsequent_year_payment_total,
        f.subsequent_year_payment_count > 0 as has_subsequent_year_payments,
        od.obligations,
        -- ── The ordered INV-16 evaluation (mirrors the TS engine exactly).
        --    Pre-T-429 labels; the 0125 wrapper overrides these two columns
        --    with the configurable 4-tier hierarchy (0111's factors are the
        --    canonical inputs — the wrapper discards these status values). ──
        case
            when f.outstanding_amount <= 0.001 then 'green'
            when f.inactivity_days <= 60 then 'green'
            when f.debt_age_days > 180 and f.inactivity_days > 180 then 'red'
            when f.debt_age_days > 90 and f.inactivity_days > 60 then 'orange'
            else 'yellow'
        end as status_level,
        case
            when f.outstanding_amount <= 0.001 then 'resolved'
            when f.inactivity_days <= 60 then 'active_payer'
            when f.debt_age_days > 180 and f.inactivity_days > 180 then 'critical_delinquency'
            when f.debt_age_days > 90 and f.inactivity_days > 60 then 'sustained_delinquency'
            else 'watch'
        end as reason_code,
        p_as_of as computed_at
    from factors f
    join public.parents p
      on p.id = f.parent_id
     and p.tenant_id = f.tenant_id
     and p.deleted_at is null
    join oblig_detail od on od.tenant_id = f.tenant_id and od.parent_id = f.parent_id
$$;

comment on function public.compute_debt_aging_rows is
    'T-405 + T-432 + T-436: the single cross-year debt-aging computation — installments (INV-4 remaining) + non-reversed payment ledger entries + academic-year attribution (INV-18a precedence: the persisted installments.academic_year_id first, then the INV-14 window/convention fallback; the payments table supplies the persisted payment-year for subsequent-year attribution) → the ordered INV-16 status. Ungated internal (owner-only); use compute_debt_aging_summary from clients.';

-- ----------------------------------------------------------------------------
-- 7. Grants (§15.34: revoke from anon AND public explicitly — the platform
--    default privileges grant anon EXECUTE on new functions)
-- ----------------------------------------------------------------------------
revoke execute on function public.resolve_academic_year_id_for_date(date, uuid) from anon, public;
revoke execute on function public.collect_and_allocate_payment(
  uuid, uuid, uuid, numeric, text, text, uuid, text, text, uuid, text,
  text, text, date, date, text, text, timestamptz) from anon, public;
revoke execute on function public.upsert_installment_from_import(
  uuid, text, text, text, text, text, numeric, numeric, numeric, date, date,
  text, text, text) from anon, public;
revoke execute on function public.compute_debt_aging_rows(uuid, timestamptz) from anon, public;
-- authenticated keeps the canonical write/sync paths (RLS + the RPC-internal
-- gates do the authorization), matching the pre-0127 default state.
grant execute on function public.collect_and_allocate_payment(
  uuid, uuid, uuid, numeric, text, text, uuid, text, text, uuid, text,
  text, text, date, date, text, text, timestamptz) to authenticated;
grant execute on function public.upsert_installment_from_import(
  uuid, text, text, text, text, text, numeric, numeric, numeric, date, date,
  text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Registration (T-091/MIG-TOKENS — atomic with the DDL for the
--    Management-API live application; idempotent via ON CONFLICT)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0127', '{0127_year_tracking_attribution.sql}', 'year_tracking_attribution')
on conflict (version) do nothing;
