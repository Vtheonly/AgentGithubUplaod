-- ============================================================================
-- 0041_canonical_academic_flow.sql
-- ============================================================================
-- PURPOSE (cross-platform equivalence findings A-0041):
--
-- 1. ASSESSMENTS — make the canonical 0029 shape FIRST-CLASS.
--    The canonical grade model (desktop Assessment, Android Assessment,
--    portal PortalAssessmentRow) is ONE row per student × subject × term ×
--    academic_year carrying devoir1/devoir2/examen + subject_average +
--    coefficient. But the physical table still carries the 0004 legacy
--    NOT NULL columns (class_subject_id, kind) that no canonical writer
--    provides — so every canonical write FAILED. This migration relaxes
--    those columns, adds the per-component coefficient snapshot columns
--    (Android Room parity), the canonical conflict key, a tenant back-fill
--    trigger, and the server-side subject_average computation trigger
--    (the assessments-table twin of the grades-table trigger from 0004).
--
-- 2. RLS hardening (vault §07 — "prevents a parent from viewing another
--    family's data"). Migration 0029 installed tenant-wide FOR ALL policies
--    on attendance_records and homework, which let ANY tenant member
--    (including parents) INSERT/DELETE rows, and 0019's assessments/grades
--    SELECT policies expose the whole tenant to parents. Tightened to the
--    documented model: parents see ONLY their own children's records.
--    payment_allocations (0033) shipped with RLS disabled entirely.
--
-- 3. ATTENDANCE idempotent sync — Android roll-call pushes upsert by
--    (tenant_id, student_id, record_date, session); the matching unique
--    index makes re-pushing the same queue entry a no-op instead of a
--    duplicate row.
--
-- ZERO business-logic change: every rule here mirrors the documented
-- canonical engine (docs/CANONICAL-FINANCIAL-LOGIC.md + plan §13.03).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Assessments — canonical shape
-- ----------------------------------------------------------------------------
ALTER TABLE public.assessments
    ALTER COLUMN class_subject_id DROP NOT NULL;
ALTER TABLE public.assessments
    ALTER COLUMN kind DROP NOT NULL;

-- COEFFICIENT WIDENING (equivalence finding A-0041-COEF): the canonical
-- client models (desktop Assessment.coefficient, Android Assessment) and
-- assessments.coefficient (NUMERIC(4,2), migration 0029) all carry
-- FRACTIONAL coefficients — but the 0004 source columns were INTEGER,
-- so an admin-set coefficient of e.g. 1.5 could never persist. Widen the
-- two legacy columns (int values remain valid numerics — zero data loss).
-- mv_grade_summary (0021) reads class_subjects.coefficient — drop &amp; recreate
-- around the type change (definition unchanged apart from column type).
DROP MATERIALIZED VIEW IF EXISTS public.mv_grade_summary;
ALTER TABLE public.subjects
    ALTER COLUMN default_coefficient TYPE NUMERIC(4, 2);
ALTER TABLE public.class_subjects
    ALTER COLUMN coefficient TYPE NUMERIC(4, 2);
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_grade_summary AS
    select
        g.tenant_id,
        g.student_id,
        g.class_subject_id,
        cs.subject_id,
        cs.coefficient,
        max(g.subject_average) as subject_average,
        max(g.subject_average) * cs.coefficient as weighted_score
    from public.grades g
    join public.class_subjects cs on cs.id = g.class_subject_id
    group by g.tenant_id, g.student_id, g.class_subject_id, cs.subject_id, cs.coefficient;

-- Per-component coefficient snapshot (Android Room parity, vault §06.02).
-- Default weights 1 / 1 / 2 ⇒ subject average = (D1 + D2 + 2×Ex) / 4.
ALTER TABLE public.assessments
    ADD COLUMN IF NOT EXISTS coefficient_devoir1 NUMERIC(4, 2) NOT NULL DEFAULT 1.00
        CHECK (coefficient_devoir1 >= 0),
    ADD COLUMN IF NOT EXISTS coefficient_devoir2 NUMERIC(4, 2) NOT NULL DEFAULT 1.00
        CHECK (coefficient_devoir2 >= 0),
    ADD COLUMN IF NOT EXISTS coefficient_examen NUMERIC(4, 2) NOT NULL DEFAULT 2.00
        CHECK (coefficient_examen >= 0);

-- Canonical conflict key used by the desktop upsert
-- (onConflict: student_id, subject_id, term, academic_year) and the Android
-- sync push. Legacy 0004 rows carry NULL student/subject values — PostgreSQL
-- unique indexes treat NULLs as distinct, so they never conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessments_canonical
    ON public.assessments (student_id, subject_id, term, academic_year);

-- Tenant back-fill: canonical writers do not send tenant_id (the desktop
-- Supabase repo and the Android dispatcher both omit it).
CREATE OR REPLACE FUNCTION public.set_assessments_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.tenant_id IS NULL THEN
        IF NEW.student_id IS NOT NULL THEN
            SELECT s.tenant_id INTO NEW.tenant_id
              FROM public.students s WHERE s.id = NEW.student_id;
        END IF;
    END IF;
    IF NEW.tenant_id IS NULL THEN
        SELECT COALESCE(
            public.fn_current_tenant_id(),
            '00000000-0000-0000-0000-000000000001'::uuid
        ) INTO NEW.tenant_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assessments_set_tenant ON public.assessments;
CREATE TRIGGER assessments_set_tenant
    BEFORE INSERT ON public.assessments
    FOR EACH ROW EXECUTE FUNCTION public.set_assessments_tenant();

-- subject_average computation — the canonical rule (plan §13.03):
--   * ALL THREE marks present  → round((D1×c1 + D2×c2 + Ex×c3) / (c1+c2+c3), 2)
--   * some marks missing       → NULL (not computable)
--   * no marks at all (legacy) → left untouched
-- Bit-identical to the desktop/Android centi-scaled integer engines and the
-- grades-table trigger from 0004 (which uses the default 1/1/2 weights).
CREATE OR REPLACE FUNCTION public.compute_assessments_subject_average()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_c1 NUMERIC;
    v_c2 NUMERIC;
    v_c3 NUMERIC;
BEGIN
    IF NEW.devoir1 IS NULL AND NEW.devoir2 IS NULL AND NEW.examen IS NULL THEN
        RETURN NEW; -- legacy row with no component marks — leave stored value
    END IF;
    IF NEW.devoir1 IS NULL OR NEW.devoir2 IS NULL OR NEW.examen IS NULL THEN
        NEW.subject_average := NULL; -- canonical: not computable
        RETURN NEW;
    END IF;
    v_c1 := COALESCE(NEW.coefficient_devoir1, 1.00);
    v_c2 := COALESCE(NEW.coefficient_devoir2, 1.00);
    v_c3 := COALESCE(NEW.coefficient_examen, 2.00);
    IF (v_c1 + v_c2 + v_c3) = 0 THEN
        NEW.subject_average := NULL;
        RETURN NEW;
    END IF;
    NEW.subject_average := ROUND(
        ((NEW.devoir1 * v_c1 + NEW.devoir2 * v_c2 + NEW.examen * v_c3)
         / (v_c1 + v_c2 + v_c3))::numeric, 2);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assessments_compute_subject_average ON public.assessments;
CREATE TRIGGER assessments_compute_subject_average
    BEFORE INSERT OR UPDATE OF devoir1, devoir2, examen,
                               coefficient_devoir1, coefficient_devoir2, coefficient_examen
    ON public.assessments
    FOR EACH ROW EXECUTE FUNCTION public.compute_assessments_subject_average();

COMMENT ON FUNCTION public.compute_assessments_subject_average IS
    'Canonical subject average = (D1×c1 + D2×c2 + Ex×c3)/(c1+c2+c3), NULL unless all three marks are present (plan §13.03). Mirrors the grades-table trigger from 0004 and the desktop/Android engines bit-for-bit.';

-- ----------------------------------------------------------------------------
-- 2. Attendance — idempotent sync key + hardened RLS
-- ----------------------------------------------------------------------------
-- NOTE: NOT a partial index — PostgREST's `onConflict` upsert (used by the
-- Android sync dispatcher) can only target a full unique index. Legacy rows
-- carry NULL record_date values, which PostgreSQL unique indexes treat as
-- distinct, so they never conflict with canonical rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_canonical
    ON public.attendance_records (tenant_id, student_id, record_date, session);

-- Drop 0029's tenant-wide FOR ALL policy (any tenant member — including
-- parents — could INSERT/DELETE attendance). 0019's staff-write policies and
-- the portal's column-restricted parent-justification policy (website
-- migration 0027) remain in force.
DROP POLICY IF EXISTS rls_attendance_records_tenant ON public.attendance_records;

-- Parents/students see ONLY their own records (vault §07 RBAC rule);
-- staff visibility is unchanged (0019 attendance_select).
DROP POLICY IF EXISTS attendance_parent_own_select ON public.attendance_records;
CREATE POLICY attendance_parent_own_select ON public.attendance_records
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'manager'])
            OR (
                public.has_role('parent')
                AND student_id IN (
                    SELECT s.id FROM public.students s
                    JOIN public.parents p ON p.id = s.parent_id
                    WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL
                )
            )
            OR (
                public.has_role('student')
                AND student_id IN (
                    SELECT s.id FROM public.students s
                    WHERE s.auth_user_id = auth.uid() AND s.deleted_at IS NULL
                )
            )
        )
    );

-- 0019's attendance_select remains (read, tenant-wide for the listed roles)
-- — keep it for staff; the parent branch above now scopes parents tighter.

-- ----------------------------------------------------------------------------
-- 3. Homework — replace 0029's tenant-wide FOR ALL with read-for-tenant,
--    write-for-staff. Parents must READ assignments (portal feature matrix)
--    but must never write them.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS rls_homework_tenant ON public.homework;

DROP POLICY IF EXISTS homework_canonical_select ON public.homework;
CREATE POLICY homework_canonical_select ON public.homework
    FOR SELECT TO authenticated
    USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS homework_canonical_write ON public.homework;
CREATE POLICY homework_canonical_write ON public.homework
    FOR ALL TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND public.has_any_role(array['super_admin', 'teacher', 'support_staff'])
    )
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.has_any_role(array['super_admin', 'teacher', 'support_staff'])
    );

-- ----------------------------------------------------------------------------
-- 4. Assessments + grades — parents read ONLY their own children's marks.
--    (0019 granted parents tenant-wide reads on both tables.)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS assessments_select ON public.assessments;
CREATE POLICY assessments_select ON public.assessments
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND (
            public.has_any_role(array['super_admin', 'support_staff', 'teacher', 'financial_officer', 'manager'])
            OR (
                public.has_role('parent')
                AND student_id IN (
                    SELECT s.id FROM public.students s
                    JOIN public.parents p ON p.id = s.parent_id
                    WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL
                )
            )
            OR (
                public.has_role('student')
                AND student_id IN (
                    SELECT s.id FROM public.students s
                    WHERE s.auth_user_id = auth.uid() AND s.deleted_at IS NULL
                )
            )
        )
    );

DROP POLICY IF EXISTS grades_select ON public.grades;
CREATE POLICY grades_select ON public.grades
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND (
            public.has_any_role(array['super_admin', 'financial_officer', 'support_staff', 'teacher', 'manager'])
            OR (
                public.has_role('parent')
                AND student_id IN (
                    SELECT s.id FROM public.students s
                    JOIN public.parents p ON p.id = s.parent_id
                    WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL
                )
            )
            OR (
                public.has_role('student')
                AND student_id IN (
                    SELECT s.id FROM public.students s
                    WHERE s.auth_user_id = auth.uid() AND s.deleted_at IS NULL
                )
            )
        )
    );

-- ----------------------------------------------------------------------------
-- 5. Account adjustments — parents read their own adjustments (portal
--    "View Adjustments" tab). 0019 restricted the table to staff entirely,
--    which silently emptied the portal tab (RLS returns zero rows).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS account_adjustments_parent_select ON public.account_adjustments;
CREATE POLICY account_adjustments_parent_select ON public.account_adjustments
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND parent_id IN (
            SELECT p.id FROM public.parents p
            WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL
        )
    );

-- ----------------------------------------------------------------------------
-- 6. Payment allocations — RLS was never enabled (0033). Parents read the
--    allocations of their own payments; staff read everything tenant-wide.
-- ----------------------------------------------------------------------------
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_allocations_staff_select ON public.payment_allocations;
CREATE POLICY payment_allocations_staff_select ON public.payment_allocations
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );

DROP POLICY IF EXISTS payment_allocations_parent_select ON public.payment_allocations;
CREATE POLICY payment_allocations_parent_select ON public.payment_allocations
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND payment_id IN (
            SELECT pay.id FROM public.payments pay
            JOIN public.parents p ON p.id = pay.parent_id
            WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS payment_allocations_staff_write ON public.payment_allocations;
CREATE POLICY payment_allocations_staff_write ON public.payment_allocations
    FOR ALL TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    )
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.has_any_role(array['super_admin', 'financial_officer', 'support_staff'])
    );

-- ----------------------------------------------------------------------------
-- 7. Canonical sync RPCs (the `upsert_*_from_import` pattern from migration
--    0027, extended to the academic flow). Both are idempotent so the Android
--    sync dispatcher can re-push queue entries without duplicating rows.
-- ----------------------------------------------------------------------------

-- Idempotent assessment upsert on the canonical conflict key. The Android
-- sync dispatcher (grade entry, vault §06.02) and the desktop grade-entry
-- flow produce identical rows through identical conflict resolution.
-- NOTE: PostgreSQL requires every parameter after the first defaulted one to
-- also carry a default — required params come first.
CREATE OR REPLACE FUNCTION public.upsert_assessment_from_import(
    p_tenant_id            UUID,
    p_student_id           UUID,
    p_subject_id           UUID,
    p_term                 INT,
    p_academic_year        TEXT,
    p_class_id             UUID DEFAULT NULL,
    p_devoir1              NUMERIC(4,2) DEFAULT NULL,
    p_devoir2              NUMERIC(4,2) DEFAULT NULL,
    p_examen               NUMERIC(4,2) DEFAULT NULL,
    p_coefficient          NUMERIC(4,2) DEFAULT 1.00,
    p_coefficient_devoir1  NUMERIC(4,2) DEFAULT 1.00,
    p_coefficient_devoir2  NUMERIC(4,2) DEFAULT 1.00,
    p_coefficient_examen   NUMERIC(4,2) DEFAULT 2.00,
    p_entered_by           UUID DEFAULT NULL,
    p_entered_at           TIMESTAMPTZ DEFAULT NOW()
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.assessments (
        tenant_id, student_id, subject_id, class_id, term, academic_year,
        devoir1, devoir2, examen, coefficient,
        coefficient_devoir1, coefficient_devoir2, coefficient_examen,
        entered_by, entered_at, created_at, updated_at
    ) VALUES (
        p_tenant_id, p_student_id, p_subject_id, p_class_id,
        GREATEST(1, LEAST(3, p_term)), p_academic_year,
        p_devoir1, p_devoir2, p_examen, p_coefficient,
        p_coefficient_devoir1, p_coefficient_devoir2, p_coefficient_examen,
        p_entered_by, p_entered_at, NOW(), NOW()
    )
    ON CONFLICT (student_id, subject_id, term, academic_year) DO UPDATE SET
        devoir1 = EXCLUDED.devoir1,
        devoir2 = EXCLUDED.devoir2,
        examen  = EXCLUDED.examen,
        coefficient = EXCLUDED.coefficient,
        coefficient_devoir1 = EXCLUDED.coefficient_devoir1,
        coefficient_devoir2 = EXCLUDED.coefficient_devoir2,
        coefficient_examen  = EXCLUDED.coefficient_examen,
        class_id  = COALESCE(EXCLUDED.class_id, public.assessments.class_id),
        entered_by = EXCLUDED.entered_by,
        entered_at = EXCLUDED.entered_at,
        updated_at = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.upsert_assessment_from_import IS
    'Idempotent canonical assessment upsert (conflict key: student, subject, term, academic year). subject_average is recomputed by the assessments_compute_subject_average trigger — the canonical (D1×c1 + D2×c2 + Ex×c3)/(c1+c2+c3) rule.';

-- Idempotent roll-call upsert on the canonical attendance key.
CREATE OR REPLACE FUNCTION public.upsert_attendance_from_import(
    p_tenant_id   UUID,
    p_student_id  UUID,
    p_record_date DATE,
    p_status      TEXT,
    p_class_id    UUID DEFAULT NULL,
    p_session     TEXT DEFAULT 'morning',
    p_arrival_time TEXT DEFAULT NULL,
    p_note        TEXT DEFAULT NULL,
    p_recorded_by UUID DEFAULT NULL,
    p_recorded_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id UUID;
    v_session TEXT := COALESCE(NULLIF(p_session, ''), 'morning');
    v_status  TEXT := COALESCE(NULLIF(p_status, ''), 'present');
BEGIN
    IF v_session NOT IN ('morning', 'afternoon', 'both') THEN
        RAISE EXCEPTION 'Invalid session: %', v_session;
    END IF;
    IF v_status NOT IN ('present', 'absent_excused', 'absent_unexcused', 'late') THEN
        RAISE EXCEPTION 'Invalid attendance status: %', v_status;
    END IF;

    INSERT INTO public.attendance_records (
        tenant_id, student_id, class_id, record_date, session, status,
        arrival_time, note, recorded_by, recorded_at, synced_at,
        created_at, updated_at
    ) VALUES (
        p_tenant_id, p_student_id, p_class_id, p_record_date, v_session, v_status,
        p_arrival_time, p_note, p_recorded_by, p_recorded_at, NOW(),
        NOW(), NOW()
    )
    ON CONFLICT (tenant_id, student_id, record_date, session) DO UPDATE SET
        status       = EXCLUDED.status,
        arrival_time = EXCLUDED.arrival_time,
        note         = EXCLUDED.note,
        class_id     = COALESCE(EXCLUDED.class_id, public.attendance_records.class_id),
        recorded_by  = EXCLUDED.recorded_by,
        recorded_at  = EXCLUDED.recorded_at,
        synced_at    = NOW(),
        updated_at   = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.upsert_attendance_from_import IS
    'Idempotent roll-call upsert (conflict key: tenant, student, record_date, session). Used by the Android sync dispatcher (vault §06.03) so mobile roll calls reach the shared backend and the portal''s Absence Justification feature.';

-- ----------------------------------------------------------------------------
-- 8. FIX (equivalence finding A-0041-REFUND): migration 0034's
--    revert_payment_allocation inserted p_actor_id::TEXT into
--    audit_logs.actor_id — a UUID column (0014). Every canonical refund RPC
--    call failed at runtime with "column actor_id is of type uuid but
--    expression is of type text", forcing silent fallbacks to the
--    non-canonical upsert path. Function body is otherwise IDENTICAL to
--    0034's canonical definition.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.revert_payment_allocation(uuid, uuid, uuid, text, text);
CREATE OR REPLACE FUNCTION revert_payment_allocation(
  p_tenant_id UUID,
  p_payment_id UUID,
  p_actor_id UUID,
  p_actor_name TEXT,
  p_reason TEXT
) RETURNS TABLE (
  payment_id UUID,
  new_status TEXT,
  reversal_entry_id TEXT,
  reverts_count INT,
  total_reverted NUMERIC(12, 2)
) AS $$
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
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;
  IF v_payment.status NOT IN ('paid', 'pending') THEN
    RAISE EXCEPTION 'Payment % is already % (cannot revert)', p_payment_id, v_payment.status;
  END IF;

  -- 2. Update payment status.
  UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = p_payment_id;

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
      v_reversal_id, p_tenant_id, v_original_ledger.account_id,
      v_original_ledger.parent_id, v_original_ledger.student_id,
      v_original_ledger.category, -v_original_ledger.amount,
      'reversal', 'payment', p_payment_id::TEXT,
      -- Canonical: refund/reversal entries have method=null, paymentStatus=null.
      NULL, v_original_ledger.receipt_number, NULL,
      v_original_ledger.id::TEXT,
      'Remboursement ' || v_payment.receipt_number || ' — inversion de l''écriture de paiement',
      p_actor_id::TEXT, p_actor_name, NOW(),
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
        ELSIF v_ins.due_date < NOW() THEN
          v_new_status := 'overdue';
        ELSE
          v_new_status := 'unpaid';
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
        ELSIF v_ins.due_date < NOW() THEN
          v_new_status := 'overdue';
        ELSE
          v_new_status := 'unpaid';
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
  INSERT INTO audit_logs (
    id, tenant_id, action, entity_type, entity_id, actor_id, actor_name,
    diff, note, created_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'payment.refund', 'payment', p_payment_id,
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
    NOW()
  );

  RETURN QUERY
    SELECT p_payment_id, 'refunded'::TEXT, v_reversal_id, v_count, v_total_reverted;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- 9. FIX (equivalence finding A-0041-OVERDUE): migration 0034's
--    compute_parent_summary lost its overdue fallback — when a charge's
--    source_id is not an installment id, the SELECT INTO overwrote
--    v_latest_charge_due_date with NULL, silently clearing the overdue flag
--    for non-installment accounts (canteen, clubs, manual charges).
--    Function body otherwise IDENTICAL to 0034's canonical definition.
-- ----------------------------------------------------------------------------
-- The 0034 matviews depend on the function — drop them first and recreate
-- them verbatim after the redefinition (they are derived caches).
-- CASCADE: legacy 0022 functions/views may depend on these caches; they are
-- recreated (or already superseded) by the canonical definitions.
DROP MATERIALIZED VIEW IF EXISTS public.mv_dashboard_kpis CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_debt_aging CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_top_debtors CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_revenue_by_month CASCADE;
DROP FUNCTION IF EXISTS public.compute_parent_summary(uuid, timestamptz);
CREATE OR REPLACE FUNCTION compute_parent_summary(
  p_parent_id UUID,
  p_as_of TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  parent_id UUID,
  total_outstanding NUMERIC,
  total_overdue NUMERIC,
  total_charged NUMERIC,
  total_paid NUMERIC,
  total_adjusted NUMERIC,
  total_refunded NUMERIC,
  total_cleared NUMERIC,
  total_pending NUMERIC,
  total_unallocated_credit NUMERIC,
  account_count INT,
  accounts JSONB
) AS $$
DECLARE
  v_accounts JSONB := '[]'::JSONB;
  v_total_outstanding NUMERIC := 0;
  v_total_overdue NUMERIC := 0;
  v_total_charged NUMERIC := 0;
  v_total_paid NUMERIC := 0;
  v_total_adjusted NUMERIC := 0;
  v_total_refunded NUMERIC := 0;
  v_total_cleared NUMERIC := 0;
  v_total_pending NUMERIC := 0;
  v_total_unallocated_credit NUMERIC := 0;
  v_account_count INT := 0;
  v_acc RECORD;
  v_latest_charge_due_date TIMESTAMPTZ;
BEGIN
  FOR v_acc IN
    SELECT
      le.account_id,
      le.category,
      le.student_id,
      SUM(le.amount) FILTER (WHERE le.at <= p_as_of) AS balance,
      COALESCE(SUM(le.amount) FILTER (WHERE le.entry_type = 'charge' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS charged,
      COALESCE(SUM(ABS(le.amount)) FILTER (WHERE le.entry_type = 'payment' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS paid,
      COALESCE(SUM(le.amount) FILTER (WHERE le.entry_type = 'adjustment' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS adjusted,
      COALESCE(SUM(ABS(le.amount)) FILTER (WHERE le.entry_type = 'refund' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS refunded,
      COALESCE(SUM(ABS(le.amount)) FILTER (WHERE le.entry_type = 'payment' AND le.payment_status = 'paid' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS cleared,
      COALESCE(SUM(ABS(le.amount)) FILTER (WHERE le.entry_type = 'payment' AND le.payment_status = 'pending' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS pending,
      COALESCE(SUM(le.amount) FILTER (WHERE le.entry_type = 'adjustment' AND le.category = 'parent_credit' AND le.at <= p_as_of AND NOT EXISTS (SELECT 1 FROM ledger_entries rev WHERE rev.tenant_id = le.tenant_id AND (rev.reverses_id = le.id::text OR rev.reverses_id = le.entry_number))), 0) AS unallocated_credit
    FROM ledger_entries le
    WHERE le.parent_id = p_parent_id
    GROUP BY le.account_id, le.category, le.student_id
  LOOP
    v_account_count := v_account_count + 1;

    -- Determine if the account is overdue: balance > 0 AND latest charge past due.
    SELECT MAX(le.at) INTO v_latest_charge_due_date
      FROM ledger_entries le
      WHERE le.account_id = v_acc.account_id
        AND le.entry_type = 'charge'
        AND le.at <= p_as_of
        AND le.reverses_id IS NULL;

    -- For overdue detection, we look at the latest charge's installment due_date
    -- (via source_id JOIN to installments). FIX (equivalence finding
    -- A-0041-OVERDUE): when the charge's source_id does NOT reference an
    -- installment (canteen, club, manual charges...), the SELECT INTO
    -- overwrote the fallback value with NULL — silently clearing the overdue
    -- flag for every non-installment account. Keep the MAX(le.at) fallback.
    SELECT ins.due_date::TIMESTAMPTZ INTO v_latest_charge_due_date
      FROM installments ins
      WHERE ins.id::text = (
        SELECT le.source_id FROM ledger_entries le
        WHERE le.account_id = v_acc.account_id
          AND le.entry_type = 'charge'
          AND le.at <= p_as_of
          AND le.reverses_id IS NULL
        ORDER BY le.at DESC LIMIT 1
      )
      LIMIT 1;
    IF v_latest_charge_due_date IS NULL THEN
        SELECT MAX(le.at) INTO v_latest_charge_due_date
          FROM ledger_entries le
          WHERE le.account_id = v_acc.account_id
            AND le.entry_type = 'charge'
            AND le.at <= p_as_of
            AND le.reverses_id IS NULL;
    END IF;

    DECLARE
      v_is_overdue BOOLEAN := (v_acc.balance > 0.001 AND v_latest_charge_due_date IS NOT NULL AND v_latest_charge_due_date < p_as_of);
    BEGIN
      v_accounts := v_accounts || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'accountId', v_acc.account_id,
        'category', v_acc.category,
        'studentId', v_acc.student_id,
        'balance', COALESCE(v_acc.balance, 0),
        'totalCharged', COALESCE(v_acc.charged, 0),
        'totalPaid', COALESCE(v_acc.paid, 0),
        'totalAdjusted', COALESCE(v_acc.adjusted, 0),
        'totalRefunded', COALESCE(v_acc.refunded, 0),
        'totalCleared', COALESCE(v_acc.cleared, 0),
        'totalPending', COALESCE(v_acc.pending, 0),
        'unallocatedCredit', COALESCE(v_acc.unallocated_credit, 0),
        'isOverdue', v_is_overdue
      ));

      v_total_outstanding := v_total_outstanding + COALESCE(v_acc.balance, 0);
      v_total_charged := v_total_charged + COALESCE(v_acc.charged, 0);
      v_total_paid := v_total_paid + COALESCE(v_acc.paid, 0);
      v_total_adjusted := v_total_adjusted + COALESCE(v_acc.adjusted, 0);
      v_total_refunded := v_total_refunded + COALESCE(v_acc.refunded, 0);
      v_total_cleared := v_total_cleared + COALESCE(v_acc.cleared, 0);
      v_total_pending := v_total_pending + COALESCE(v_acc.pending, 0);
      v_total_unallocated_credit := v_total_unallocated_credit + COALESCE(v_acc.unallocated_credit, 0);

      IF v_is_overdue THEN
        v_total_overdue := v_total_overdue + COALESCE(v_acc.balance, 0);
      END IF;
    END;
  END LOOP;

  RETURN QUERY
    SELECT
      p_parent_id,
      v_total_outstanding,
      v_total_overdue,
      v_total_charged,
      v_total_paid,
      v_total_adjusted,
      v_total_refunded,
      v_total_cleared,
      v_total_pending,
      v_total_unallocated_credit,
      v_account_count,
      v_accounts;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;


-- Recreate the 0034 matviews verbatim (dropped above for the function fix).

-- Refresh happens on the daily cron (refresh-materialized-views edge function).


-- Recreate the 0034 matviews verbatim (dropped above for the function fix).
CREATE MATERIALIZED VIEW public.mv_dashboard_kpis AS
SELECT
  t.id AS tenant_id,
  COUNT(DISTINCT p.id) AS total_parents,
  COUNT(DISTINCT s.id) FILTER (WHERE s.enrollment_status = 'active') AS total_students,
  COALESCE(SUM(pay.amount) FILTER (
    WHERE pay.status = 'paid'
      AND pay.collected_at >= date_trunc('month', NOW())
      AND pay.collected_at < date_trunc('month', NOW() + INTERVAL '1 month')
  ), 0) AS monthly_revenue,
  COALESCE(SUM(pay.amount) FILTER (
    WHERE pay.status = 'paid'
      AND pay.collected_at >= date_trunc('day', NOW())
      AND pay.collected_at < date_trunc('day', NOW() + INTERVAL '1 day')
  ), 0) AS today_revenue,
  (
    SELECT COALESCE(SUM(summary.total_outstanding), 0)
    FROM parents p2
    CROSS JOIN LATERAL compute_parent_summary(p2.id) AS summary
    WHERE p2.tenant_id = t.id AND p2.deleted_at IS NULL
  ) AS outstanding_debt,
  (
    SELECT COALESCE(SUM(summary.total_overdue), 0)
    FROM parents p2
    CROSS JOIN LATERAL compute_parent_summary(p2.id) AS summary
    WHERE p2.tenant_id = t.id AND p2.deleted_at IS NULL
  ) AS overdue_debt,
  (
    SELECT COUNT(DISTINCT p2.id)
    FROM parents p2
    CROSS JOIN LATERAL compute_parent_summary(p2.id) AS summary
    WHERE p2.tenant_id = t.id AND p2.deleted_at IS NULL AND summary.total_overdue > 0
  ) AS overdue_families_count,
  COUNT(DISTINCT pay.id) FILTER (
    WHERE pay.method = 'check' AND pay.status = 'pending'
  ) AS pending_checks_count,
  COALESCE(SUM(pay.amount) FILTER (
    WHERE pay.method = 'check' AND pay.status = 'pending'
  ), 0) AS pending_checks_amount
FROM tenants t
LEFT JOIN parents p ON p.tenant_id = t.id AND p.deleted_at IS NULL
LEFT JOIN students s ON s.parent_id = p.id AND s.deleted_at IS NULL
LEFT JOIN payments pay ON pay.tenant_id = t.id
GROUP BY t.id;
CREATE MATERIALIZED VIEW public.mv_debt_aging AS
SELECT
  p.id AS parent_id,
  p.tenant_id,
  p.display_name,
  COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '') AS parent_name,
  summary.total_outstanding,
  summary.total_overdue,
  CASE
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 180 THEN '180_plus'
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 90 THEN '91_180'
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 60 THEN '61_90'
    WHEN summary.total_overdue > 0 AND EXTRACT(EPOCH FROM (NOW() - (
      SELECT MAX(ins.due_date) FROM installments ins
      WHERE ins.parent_id = p.id AND ins.due_date < NOW()
        AND ins.amount_due > ins.amount_paid
    ))) / 86400 > 30 THEN '31_60'
    WHEN summary.total_overdue > 0 THEN '0_30'
    ELSE NULL
  END AS aging_bucket
FROM parents p
CROSS JOIN LATERAL compute_parent_summary(p.id) AS summary
WHERE p.deleted_at IS NULL AND summary.total_outstanding > 0;
CREATE MATERIALIZED VIEW public.mv_top_debtors AS
SELECT
  parent_id, tenant_id, parent_name,
  total_outstanding, total_overdue, aging_bucket,
  ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY total_outstanding DESC) AS rank
FROM public.mv_debt_aging
WHERE total_outstanding > 0
ORDER BY total_outstanding DESC;
CREATE MATERIALIZED VIEW public.mv_revenue_by_month AS
SELECT
  tenant_id,
  DATE_TRUNC('month', collected_at) AS month,
  COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS revenue,
  -- Refunds (status='refunded') are NOT subtracted here because the
  -- canonical engine records refunds as NEGATIVE ledger entries, not as
  -- payment rows with status='refunded'. The payments table's amount
  -- column remains the original payment amount; the ledger's reversal
  -- entry cancels it. To compute NET revenue, join to ledger_entries.
  COUNT(*) FILTER (WHERE status = 'paid') AS payment_count
FROM payments
GROUP BY tenant_id, DATE_TRUNC('month', collected_at);

-- The matviews repopulate on the next scheduled refresh (refresh-materialized-views).
