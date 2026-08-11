-- ============================================================================
-- EL-IMTIYAZ EDUCATIONAL PLATFORM
-- Migration: 0031_fix_upsert_rpc_ambiguous_columns.sql
-- Module: Shared schema (upsert RPC ambiguity fix)
--
-- WHY THIS EXISTS:
--   Migrations 0027 + 0028 declared the upsert_*_from_import RPCs with
--   `RETURNS TABLE(parent_id uuid, parent_code text, was_inserted boolean)`.
--   In plpgsql, the output column names of a `RETURNS TABLE` function are
--   in scope as variables inside the function body — they live alongside
--   the columns of the tables being queried.
--
--   When the function body then says:
--     SELECT id INTO v_existing FROM public.parents
--      WHERE tenant_id = p_tenant_id
--        AND parent_code = v_code      -- AMBIGUOUS
--        AND deleted_at IS NULL
--
--   PostgreSQL cannot decide whether `parent_code` refers to:
--     (a) the OUTPUT column variable declared in RETURNS TABLE, or
--     (b) the `parents.parent_code` column.
--
--   At runtime this surfaces as:
--     ERROR: column reference "parent_code" is ambiguous
--
--   This breaks EVERY Excel import call to `upsert_parent_from_import`
--   (and the equivalent student / payment RPCs), which in turn cascades
--   into ~390 failed parent creations per import run, hundreds of failed
--   sync queue pushes, and a flood of console errors that the user sees
--   as "1,170 sync notifications".
--
-- THE FIX:
--   Re-declare each upsert_*_from_import RPC with TABLE-ALIASED column
--   references everywhere (e.g. `p.parent_code` instead of bare
--   `parent_code`). Qualified references are never ambiguous with output
--   column variables, so the planner picks the table column unambiguously.
--
--   Because PostgreSQL's `CREATE OR REPLACE FUNCTION` cannot change a
--   function's signature or return shape, we DROP first then CREATE.
--   The DROP is idempotent (IF EXISTS), so re-running this migration is
--   a safe no-op.
--
--   This migration also supercedes 0030's version of
--   `upsert_ledger_entry_from_import` (0030 fixed the uuid-vs-text bug
--   but NOT the ambiguity bug — the ledger function had the same
--   ambiguity issue on `entry_number` / `source_type` / `source_id`).
--   The version below keeps 0030's uuid fix AND adds the alias fix.
-- ============================================================================

-- ============================================================================
-- 1. upsert_parent_from_import
-- ============================================================================
DROP FUNCTION IF EXISTS public.upsert_parent_from_import(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean,
  text, text
);
DROP FUNCTION IF EXISTS public.upsert_parent_from_import(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean
);

CREATE OR REPLACE FUNCTION public.upsert_parent_from_import(
  p_tenant_id             uuid,
  p_parent_code           text,
  p_first_name            text,
  p_last_name             text,
  p_display_name          text DEFAULT NULL,
  p_primary_phone         text DEFAULT NULL,
  p_secondary_phone       text DEFAULT NULL,
  p_email                 text DEFAULT NULL,
  p_occupation            text DEFAULT NULL,
  p_address               text DEFAULT NULL,
  p_relationship          text DEFAULT NULL,
  p_preferred_language    text DEFAULT 'fr',
  p_is_active             boolean DEFAULT true,
  p_transport_destination text DEFAULT NULL,    -- 0028
  p_city_tier             text DEFAULT NULL     -- 0028
) RETURNS TABLE (
  out_parent_id      uuid,
  out_parent_code    text,
  out_was_inserted   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        uuid;
  v_code      text := COALESCE(NULLIF(TRIM(p_parent_code), ''),
                               'PAR-' || EXTRACT(YEAR FROM now())::int || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6)));
  v_existing  uuid;
  v_inserted  boolean := false;
  v_first     text := COALESCE(NULLIF(TRIM(p_first_name), ''), '');
  v_last      text := COALESCE(NULLIF(TRIM(p_last_name), ''), '');
  v_disp      text := COALESCE(NULLIF(TRIM(p_display_name), ''), NULLIF(TRIM(v_first || ' ' || v_last), ''));
  v_phone     text := COALESCE(NULLIF(TRIM(p_primary_phone), ''), '(inconnu)');
BEGIN
  -- NOTE: every column reference is qualified with the `p.` alias so it
  -- cannot be confused with the function's RETURNS TABLE output columns.
  SELECT p.id INTO v_existing
  FROM public.parents p
  WHERE p.tenant_id = p_tenant_id
    AND p.parent_code = v_code
    AND p.deleted_at IS NULL
  LIMIT 1;

  IF v_existing IS NULL AND v_phone <> '(inconnu)' THEN
    SELECT p.id INTO v_existing
    FROM public.parents p
    WHERE p.tenant_id = p_tenant_id
      AND p.primary_phone = v_phone
      AND p.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_existing IS NULL AND v_disp IS NOT NULL THEN
    SELECT p.id INTO v_existing
    FROM public.parents p
    WHERE p.tenant_id = p_tenant_id
      AND p.display_name = v_disp
      AND p.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_existing IS NULL AND p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
    SELECT p.id INTO v_existing
    FROM public.parents p
    WHERE p.tenant_id = p_tenant_id
      AND p.email = TRIM(p_email)
      AND p.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE public.parents p SET
      first_name            = COALESCE(NULLIF(TRIM(p_first_name), ''), p.first_name),
      last_name             = COALESCE(NULLIF(TRIM(p_last_name), ''), p.last_name),
      display_name          = COALESCE(v_disp, p.display_name),
      primary_phone         = CASE WHEN p_primary_phone IS NOT NULL AND TRIM(p_primary_phone) <> '' THEN p_primary_phone ELSE p.primary_phone END,
      secondary_phone       = COALESCE(p_secondary_phone, p.secondary_phone),
      email                 = COALESCE(NULLIF(TRIM(p_email), ''), p.email),
      occupation            = COALESCE(NULLIF(TRIM(p_occupation), ''), p.occupation),
      address               = COALESCE(NULLIF(TRIM(p_address), ''), p.address),
      relationship          = COALESCE(p_relationship, p.relationship),
      is_active             = p_is_active,
      transport_destination = COALESCE(NULLIF(TRIM(p_transport_destination), ''), p.transport_destination),
      city_tier             = COALESCE(NULLIF(TRIM(p_city_tier), ''), p.city_tier),
      updated_at            = now()
    WHERE p.id = v_existing;
    v_id := v_existing;
  ELSE
    BEGIN
      INSERT INTO public.parents (
        tenant_id, parent_code, first_name, last_name, display_name,
        primary_phone, secondary_phone, email, occupation, address,
        relationship, is_active, transport_destination, city_tier
      ) VALUES (
        p_tenant_id, v_code, v_first, v_last, v_disp,
        v_phone, p_secondary_phone, p_email, p_occupation, p_address,
        p_relationship, p_is_active, p_transport_destination, p_city_tier
      )
      RETURNING id INTO v_id;
      v_inserted := true;
    EXCEPTION WHEN unique_violation THEN
      SELECT p.id INTO v_id
      FROM public.parents p
      WHERE p.tenant_id = p_tenant_id
        AND (p.parent_code = v_code OR (p.email IS NOT NULL AND p.email = TRIM(p_email)))
        AND p.deleted_at IS NULL
      LIMIT 1;
      IF v_id IS NOT NULL THEN
        UPDATE public.parents p SET
          first_name            = COALESCE(NULLIF(TRIM(p_first_name), ''), p.first_name),
          last_name             = COALESCE(NULLIF(TRIM(p_last_name), ''), p.last_name),
          display_name          = COALESCE(v_disp, p.display_name),
          primary_phone         = CASE WHEN p_primary_phone IS NOT NULL AND TRIM(p_primary_phone) <> '' THEN p_primary_phone ELSE p.primary_phone END,
          secondary_phone       = COALESCE(p_secondary_phone, p.secondary_phone),
          occupation            = COALESCE(NULLIF(TRIM(p_occupation), ''), p.occupation),
          address               = COALESCE(NULLIF(TRIM(p_address), ''), p.address),
          relationship          = COALESCE(p_relationship, p.relationship),
          is_active             = p_is_active,
          transport_destination = COALESCE(NULLIF(TRIM(p_transport_destination), ''), p.transport_destination),
          city_tier             = COALESCE(NULLIF(TRIM(p_city_tier), ''), p.city_tier),
          updated_at            = now()
        WHERE p.id = v_id;
      END IF;
    END;
  END IF;

  RETURN QUERY SELECT v_id, v_code, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_parent_from_import IS
  'Idempotent upsert for parents. Identity resolution order: '
  '(tenant, parent_code) → (tenant, primary_phone) → (tenant, display_name) → (tenant, email). '
  'Output columns are prefixed with out_ to avoid column-reference ambiguity with the parents table.';

-- ============================================================================
-- 2. upsert_student_from_import
-- ============================================================================
DROP FUNCTION IF EXISTS public.upsert_student_from_import(
  uuid, text, uuid, text, text, text, text, date, text, uuid, uuid, date, text, text, boolean,
  text, text, text
);
DROP FUNCTION IF EXISTS public.upsert_student_from_import(
  uuid, text, uuid, text, text, text, text, date, text, uuid, uuid, date, text, text, boolean
);

CREATE OR REPLACE FUNCTION public.upsert_student_from_import(
  p_tenant_id         uuid,
  p_student_code      text,
  p_parent_id         uuid,
  p_first_name        text,
  p_last_name         text,
  p_display_name      text DEFAULT NULL,
  p_middle_name       text DEFAULT NULL,
  p_date_of_birth     date DEFAULT NULL,
  p_gender            text DEFAULT NULL,
  p_grade_level_id    uuid DEFAULT NULL,
  p_class_id          uuid DEFAULT NULL,
  p_enrollment_date   date DEFAULT NULL,
  p_enrollment_status text DEFAULT 'active',
  p_medical_notes     text DEFAULT NULL,
  p_is_active         boolean DEFAULT true,
  p_grade_level_code  text DEFAULT NULL,    -- 0028
  p_transport_tier    text DEFAULT NULL,    -- 0028
  p_payment_plan      text DEFAULT 'tranches'  -- 0028
) RETURNS TABLE (
  out_student_id     uuid,
  out_student_code   text,
  out_was_inserted   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        uuid;
  v_code      text := COALESCE(NULLIF(TRIM(p_student_code), ''),
                               'ELV-' || EXTRACT(YEAR FROM now())::int || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6)));
  v_existing  uuid;
  v_inserted  boolean := false;
  v_first     text := COALESCE(NULLIF(TRIM(p_first_name), ''), '');
  v_last      text := COALESCE(NULLIF(TRIM(p_last_name), ''), '');
  v_disp      text := COALESCE(NULLIF(TRIM(p_display_name), ''), NULLIF(TRIM(v_first || ' ' || v_last), ''));
  v_plan      text := CASE WHEN p_payment_plan IN ('tranches','full_annual') THEN p_payment_plan ELSE 'tranches' END;
BEGIN
  SELECT s.id INTO v_existing
  FROM public.students s
  WHERE s.tenant_id = p_tenant_id
    AND s.student_code = v_code
    AND s.deleted_at IS NULL
  LIMIT 1;

  IF v_existing IS NULL AND v_first <> '' AND v_last <> '' THEN
    SELECT s.id INTO v_existing
    FROM public.students s
    WHERE s.tenant_id = p_tenant_id
      AND s.parent_id = p_parent_id
      AND s.first_name = v_first
      AND s.last_name = v_last
      AND s.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE public.students s SET
      parent_id         = p_parent_id,
      first_name        = COALESCE(NULLIF(TRIM(p_first_name), ''), s.first_name),
      last_name         = COALESCE(NULLIF(TRIM(p_last_name), ''), s.last_name),
      display_name      = COALESCE(v_disp, s.display_name),
      middle_name       = COALESCE(p_middle_name, s.middle_name),
      date_of_birth     = COALESCE(p_date_of_birth, s.date_of_birth),
      gender            = COALESCE(p_gender, s.gender),
      grade_level_id    = COALESCE(p_grade_level_id, s.grade_level_id),
      class_id          = COALESCE(p_class_id, s.class_id),
      enrollment_date   = COALESCE(p_enrollment_date, s.enrollment_date),
      enrollment_status = COALESCE(NULLIF(TRIM(p_enrollment_status), ''), s.enrollment_status),
      medical_notes     = COALESCE(p_medical_notes, s.medical_notes),
      is_active         = p_is_active,
      grade_level_code  = COALESCE(NULLIF(TRIM(p_grade_level_code), ''), s.grade_level_code),
      transport_tier    = COALESCE(NULLIF(TRIM(p_transport_tier), ''), s.transport_tier),
      payment_plan      = v_plan,
      updated_at        = now()
    WHERE s.id = v_existing;
    v_id := v_existing;
  ELSE
    INSERT INTO public.students (
      tenant_id, student_code, parent_id, first_name, middle_name, last_name,
      display_name, date_of_birth, gender, grade_level_id, class_id,
      enrollment_date, enrollment_status, medical_notes, is_active,
      grade_level_code, transport_tier, payment_plan
    ) VALUES (
      p_tenant_id, v_code, p_parent_id, v_first, p_middle_name, v_last,
      v_disp, p_date_of_birth, p_gender, p_grade_level_id, p_class_id,
      COALESCE(p_enrollment_date, current_date), COALESCE(NULLIF(TRIM(p_enrollment_status), ''), 'active'),
      p_medical_notes, p_is_active,
      p_grade_level_code, p_transport_tier, v_plan
    )
    RETURNING id INTO v_id;
    v_inserted := true;
  END IF;

  RETURN QUERY SELECT v_id, v_code, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_student_from_import IS
  'Idempotent upsert for students. Identity: (tenant, student_code) with fallback '
  'to (parent_id, first_name, last_name). Output columns prefixed with out_ to avoid '
  'column-reference ambiguity with the students table.';

-- ============================================================================
-- 3. upsert_payment_from_import
-- ============================================================================
DROP FUNCTION IF EXISTS public.upsert_payment_from_import(
  uuid, text, uuid, uuid, uuid, uuid, numeric, text, text, text,
  text, text, date, date, text, text, text, timestamptz, uuid, text, uuid
);

CREATE OR REPLACE FUNCTION public.upsert_payment_from_import(
  p_tenant_id        uuid,
  p_payment_number   text,
  p_parent_id        uuid,
  p_student_id       uuid DEFAULT NULL,
  p_invoice_id       uuid DEFAULT NULL,
  p_installment_id   uuid DEFAULT NULL,
  p_amount           numeric(12,2) DEFAULT NULL,
  p_method           text DEFAULT 'cash',
  p_category         text DEFAULT 'other',
  p_status           text DEFAULT 'paid',
  p_check_number     text DEFAULT NULL,
  p_check_bank_name  text DEFAULT NULL,
  p_check_issue_date date DEFAULT NULL,
  p_check_clearance_date date DEFAULT NULL,
  p_transfer_reference text DEFAULT NULL,
  p_transfer_source_bank text DEFAULT NULL,
  p_proof_path       text DEFAULT NULL,
  p_collected_at     timestamptz DEFAULT NULL,
  p_collected_by     uuid DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_reversal_of_payment_id uuid DEFAULT NULL
) RETURNS TABLE (
  out_payment_id      uuid,
  out_payment_number  text,
  out_was_inserted    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_num text := p_payment_number;
  v_inserted boolean := false;
  v_existing uuid;
  v_final_status text;
BEGIN
  SELECT pay.id INTO v_existing
  FROM public.payments pay
  WHERE pay.tenant_id = p_tenant_id
    AND pay.payment_number = p_payment_number
  LIMIT 1;

  v_final_status := COALESCE(p_status, CASE WHEN p_method = 'cash' THEN 'paid' ELSE 'pending' END);

  IF v_existing IS NOT NULL THEN
    v_id := v_existing;
    UPDATE public.payments pay SET
      parent_id        = COALESCE(p_parent_id, pay.parent_id),
      student_id       = COALESCE(p_student_id, pay.student_id),
      invoice_id       = COALESCE(p_invoice_id, pay.invoice_id),
      installment_id   = COALESCE(p_installment_id, pay.installment_id),
      amount           = COALESCE(p_amount, pay.amount),
      method           = COALESCE(NULLIF(p_method, ''), pay.method),
      category         = COALESCE(NULLIF(p_category, ''), pay.category),
      status           = v_final_status,
      check_number     = COALESCE(p_check_number, pay.check_number),
      check_bank_name  = COALESCE(p_check_bank_name, pay.check_bank_name),
      check_issue_date = COALESCE(p_check_issue_date, pay.check_issue_date),
      check_clearance_date = COALESCE(p_check_clearance_date, pay.check_clearance_date),
      transfer_reference = COALESCE(p_transfer_reference, pay.transfer_reference),
      transfer_source_bank = COALESCE(p_transfer_source_bank, pay.transfer_source_bank),
      proof_path       = COALESCE(p_proof_path, pay.proof_path),
      collected_at     = COALESCE(p_collected_at, pay.collected_at),
      collected_by     = COALESCE(p_collected_by, pay.collected_by),
      notes            = COALESCE(p_notes, pay.notes),
      reversal_of_payment_id = COALESCE(p_reversal_of_payment_id, pay.reversal_of_payment_id),
      updated_at       = now()
    WHERE pay.id = v_id;
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
      v_id, p_tenant_id, v_num, p_parent_id, p_student_id, p_invoice_id, p_installment_id,
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
$$;

COMMENT ON FUNCTION public.upsert_payment_from_import IS
  'Idempotent upsert for payments. Identity: (tenant, payment_number). '
  'Output columns prefixed with out_ to avoid column-reference ambiguity with the payments table.';

-- ============================================================================
-- 4. upsert_ledger_entry_from_import
--    (re-applies 0030s uuid fix AND adds the alias fix)
-- ============================================================================
DROP FUNCTION IF EXISTS public.upsert_ledger_entry_from_import(
    uuid, text, uuid, uuid, text, text, numeric, text, text, text, text,
    text, text, text, text, text, text, timestamptz, jsonb
);

CREATE OR REPLACE FUNCTION public.upsert_ledger_entry_from_import(
    p_tenant_id     uuid,
    p_entry_number  text DEFAULT NULL,
    p_parent_id     uuid DEFAULT NULL,
    p_student_id    uuid DEFAULT NULL,
    p_account_id    text DEFAULT NULL,
    p_entry_type    text DEFAULT 'charge',
    p_amount        numeric(12,2) DEFAULT NULL,
    p_category      text DEFAULT 'other',
    p_description   text DEFAULT NULL,
    p_source_type   text DEFAULT 'bulk_import',
    p_source_id     text DEFAULT NULL,
    p_method        text DEFAULT NULL,
    p_receipt_number text DEFAULT NULL,
    p_payment_status text DEFAULT NULL,
    p_reverses_id   text DEFAULT NULL,
    p_actor_id      text DEFAULT NULL,
    p_actor_name    text DEFAULT NULL,
    p_at            timestamptz DEFAULT NULL,
    p_metadata      jsonb DEFAULT NULL
) RETURNS TABLE (
  out_entry_id     uuid,
  out_was_inserted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
    v_existing RECORD;
    v_inserted boolean := false;
    v_entry_number text;
    v_account_id text;
BEGIN
    v_account_id := COALESCE(p_account_id,
        'parent:' || p_parent_id || ':category:' || p_category ||
        CASE WHEN p_student_id IS NOT NULL THEN ':student:' || p_student_id ELSE '' END);

    IF p_source_type IS NOT NULL AND p_source_id IS NOT NULL THEN
        SELECT le.id, le.entry_number INTO v_existing
          FROM public.ledger_entries le
         WHERE le.tenant_id = p_tenant_id
           AND le.source_type = p_source_type
           AND le.source_id   = p_source_id
         LIMIT 1;
    END IF;

    IF NOT FOUND AND p_entry_number IS NOT NULL THEN
        SELECT le.id, le.entry_number INTO v_existing
          FROM public.ledger_entries le
         WHERE le.tenant_id = p_tenant_id
           AND le.entry_number = p_entry_number
         LIMIT 1;
    END IF;

    v_entry_number := COALESCE(
        v_existing.entry_number,
        NULLIF(TRIM(p_entry_number), ''),
        'LED-' || EXTRACT(EPOCH FROM now())::bigint || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6))
    );

    IF FOUND THEN
        v_id := v_existing.id;
        UPDATE public.ledger_entries le
           SET parent_id      = COALESCE(p_parent_id, le.parent_id),
               student_id     = COALESCE(p_student_id, le.student_id),
               account_id     = v_account_id,
               entry_type     = COALESCE(NULLIF(p_entry_type, ''), le.entry_type),
               amount         = COALESCE(p_amount, le.amount),
               category       = COALESCE(NULLIF(p_category, ''), le.category),
               description    = COALESCE(p_description, le.description),
               source_type    = COALESCE(p_source_type, le.source_type),
               source_id      = COALESCE(p_source_id, le.source_id),
               method         = COALESCE(p_method, le.method),
               receipt_number = COALESCE(p_receipt_number, le.receipt_number),
               payment_status = COALESCE(p_payment_status, le.payment_status),
               reverses_id    = COALESCE(p_reverses_id, le.reverses_id),
               actor_id       = COALESCE(p_actor_id, le.actor_id),
               actor_name     = COALESCE(p_actor_name, le.actor_name),
               at             = COALESCE(p_at, le.at),
               entry_date     = COALESCE(p_at, le.entry_date),
               metadata       = COALESCE(p_metadata, le.metadata)
         WHERE le.id = v_id;
    ELSE
        v_inserted := true;
        INSERT INTO public.ledger_entries (
            tenant_id, entry_number, parent_id, student_id, account_id,
            entry_type, amount, category, description, entry_date, created_at,
            source_type, source_id, method, receipt_number, payment_status,
            reverses_id, actor_id, actor_name, at, metadata
        ) VALUES (
            p_tenant_id, v_entry_number, p_parent_id, p_student_id, v_account_id,
            COALESCE(NULLIF(p_entry_type, ''), 'charge'),
            COALESCE(p_amount, 0),
            COALESCE(NULLIF(p_category, ''), 'other'),
            p_description,
            COALESCE(p_at, now()), now(),
            p_source_type, p_source_id, p_method, p_receipt_number, p_payment_status,
            p_reverses_id, p_actor_id, p_actor_name,
            COALESCE(p_at, now()), p_metadata
        )
        RETURNING id INTO v_id;
    END IF;

    RETURN QUERY SELECT v_id, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_ledger_entry_from_import IS
  'Idempotent upsert for ledger entries. Identity: (tenant, source_type, source_id) '
  'with fallback to (tenant, entry_number). Output columns prefixed with out_ to avoid '
  'column-reference ambiguity with the ledger_entries table.';
