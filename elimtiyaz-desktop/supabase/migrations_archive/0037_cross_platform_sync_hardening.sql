-- ============================================================================
-- EL-IMTIYAZ EDUCATIONAL PLATFORM
-- Migration: 0037_cross_platform_sync_hardening.sql
-- Module: Shared schema (cross-platform sync + CRM status alignment)
--
-- WHY THIS EXISTS (findings from the cross-platform equivalence audit):
--
--   1. ANDROID PUSH-BACK REFERENCE MISMATCH — Android's local Room IDs are
--      text refs ("par-<uuid>", "stu-<uuid>", "ins-<uuid>"). The upsert
--      RPCs declare `p_parent_id uuid` / `p_student_id uuid`. Pushing a
--      local ref raises `invalid input syntax for type uuid`. Fix: accept
--      TEXT refs and resolve them internally (UUID cast → parent_code /
--      student_code lookup).
--
--   2. NO INSTALLMENT PUSH — Android enqueues installment mutations but the
--      SyncQueueDispatcher had no case for them (silent no-op). The server
--      never learns Android-side waterfall results. Fix: new idempotent
--      `upsert_installment_from_import` RPC.
--
--   3. ACTIVATION CODES NOT POPULATED — `upsert_parent_from_import` never
--      inserted into `activation_codes`, so parents created/imported via
--      the shared RPC could not activate on the web portal even though
--      both clients compute the canonical deterministic activation code.
--      Fix: new `p_activation_code` parameter + idempotent
--      activation_codes upsert keyed on (tenant_id, code).
--
--   4. STUDENT STATUS CHECK CONSTRAINT — 0005 restricts enrollment_status
--      to ('inquiry','quoted','enrolled','active','withdrawn','graduated').
--      Both clients (TS StudentStatus + Kotlin Student.status) also use
--      'suspended' and 'transferred' — writing them raises a fatal CHECK
--      violation. Fix: extend the constraint to the canonical superset
--      (legacy values retained for Excel-import compat).
--
--   5. PULL-SIDE REVERSAL LINKAGE — both clients push entries with
--      entry_number = local id and reverses_id = the ORIGINAL's local id.
--      pull_ledger_entries_for_sync returned the raw text ref, which
--      matched no pulled row's server-UUID id — breaking reversal pairing
--      in computeAccountBalance on both platforms. Fix: the pull rewrites
--      reverses_id into the server UUID space.
--
-- All changes are idempotent (robust DO-block drops + CREATE). No data
-- migrations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reference resolver helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_parent_ref(
    p_tenant_id  uuid,
    p_parent_ref text
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uuid uuid;
    v_id   uuid;
BEGIN
    IF p_parent_ref IS NULL OR TRIM(p_parent_ref) = '' THEN
        RETURN NULL;
    END IF;

    -- 1a. Already a server UUID (desktop push / pull round-trip).
    BEGIN
        v_uuid := p_parent_ref::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        v_uuid := NULL;
    END;
    IF v_uuid IS NOT NULL THEN
        SELECT id INTO v_id FROM public.parents
         WHERE id = v_uuid AND tenant_id = p_tenant_id AND deleted_at IS NULL;
        RETURN COALESCE(v_id, v_uuid);  -- trust valid UUIDs even if not yet present
    END IF;

    -- 1b. Android local ref → canonical parent_code ("PAR-YYYY-XXXXXX").
    SELECT id INTO v_id FROM public.parents
     WHERE tenant_id = p_tenant_id AND parent_code = p_parent_ref AND deleted_at IS NULL
     LIMIT 1;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_parent_ref IS
  'Resolve a parent reference (server UUID, or canonical parent_code such as '
  'PAR-2026-1A2B3C) to the parents.id UUID within a tenant. Returns NULL when '
  'unresolvable. Used by the ref-tolerant upsert_*_from_import RPCs so mobile '
  'clients can push their local string IDs.';

CREATE OR REPLACE FUNCTION public.resolve_student_ref(
    p_tenant_id   uuid,
    p_student_ref text
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uuid uuid;
    v_id   uuid;
BEGIN
    IF p_student_ref IS NULL OR TRIM(p_student_ref) = '' THEN
        RETURN NULL;
    END IF;

    BEGIN
        v_uuid := p_student_ref::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        v_uuid := NULL;
    END;
    IF v_uuid IS NOT NULL THEN
        SELECT id INTO v_id FROM public.students
         WHERE id = v_uuid AND tenant_id = p_tenant_id AND deleted_at IS NULL;
        RETURN COALESCE(v_id, v_uuid);
    END IF;

    SELECT id INTO v_id FROM public.students
     WHERE tenant_id = p_tenant_id AND student_code = p_student_ref AND deleted_at IS NULL
     LIMIT 1;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_student_ref IS
  'Resolve a student reference (server UUID, or canonical student_code such as '
  'ELV-2026-1A2B3C) to the students.id UUID within a tenant. NULL when '
  'unresolvable.';

CREATE OR REPLACE FUNCTION public.resolve_installment_ref(
    p_tenant_id       uuid,
    p_installment_ref text
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uuid uuid;
    v_id   uuid;
BEGIN
    IF p_installment_ref IS NULL OR TRIM(p_installment_ref) = '' THEN
        RETURN NULL;
    END IF;

    BEGIN
        v_uuid := p_installment_ref::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        v_uuid := NULL;
    END;
    IF v_uuid IS NOT NULL THEN
        RETURN v_uuid;
    END IF;

    -- Mobile local ref → android_sync provenance row.
    SELECT id INTO v_id FROM public.installments
     WHERE tenant_id = p_tenant_id
       AND source_type = 'android_sync'
       AND source_id = p_installment_ref
     LIMIT 1;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_installment_ref IS
  'Resolve an installment reference (server UUID or mobile local ref registered '
  'via upsert_installment_from_import) to installments.id. NULL when unresolvable.';

-- ----------------------------------------------------------------------------
-- 2. upsert_parent_from_import — add p_activation_code + activation_codes upsert
-- ----------------------------------------------------------------------------
DO $_drop_parent$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'upsert_parent_from_import'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
    END LOOP;
END
$_drop_parent$;

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
  p_city_tier             text DEFAULT NULL,    -- 0028
  p_activation_code       text DEFAULT NULL     -- 0037: canonical deterministic code
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
  v_id             uuid;
  v_code           text := COALESCE(NULLIF(TRIM(p_parent_code), ''),
                                   'PAR-' || EXTRACT(YEAR FROM now())::int || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6)));
  v_existing       uuid;
  v_inserted       boolean := false;
  v_first          text := COALESCE(NULLIF(TRIM(p_first_name), ''), '');
  v_last           text := COALESCE(NULLIF(TRIM(p_last_name), ''), '');
  v_disp           text := COALESCE(NULLIF(TRIM(p_display_name), ''), NULLIF(TRIM(v_first || ' ' || v_last), ''));
  v_phone          text := COALESCE(NULLIF(TRIM(p_primary_phone), ''), '(inconnu)');
  v_act_code       text := NULLIF(TRIM(COALESCE(p_activation_code, '')), '');
BEGIN
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
    -- NOTE: the parents table has no preferred_language column — the
    -- parameter is accepted for API compatibility but not persisted
    -- (matches the 0031 original).
    INSERT INTO public.parents (
      tenant_id, parent_code, first_name, last_name, display_name,
      primary_phone, secondary_phone, email, occupation, address,
      relationship, is_active, transport_destination, city_tier
    ) VALUES (
      p_tenant_id, v_code, v_first, v_last, v_disp,
      v_phone, p_secondary_phone, p_email, p_occupation, p_address,
      p_relationship, p_is_active,
      NULLIF(TRIM(COALESCE(p_transport_destination, '')), ''),
      NULLIF(TRIM(COALESCE(p_city_tier, '')), '')
    )
    RETURNING id INTO v_id;
    v_inserted := true;
  END IF;

  -- 0037: populate activation_codes so the parent can bind their web account.
  -- Idempotent on (tenant_id, code). Skips when the code is already bound to
  -- another parent (never hijack an existing binding).
  IF v_act_code IS NOT NULL THEN
    INSERT INTO public.activation_codes (tenant_id, code, parent_id, issued_at, expires_at)
    VALUES (p_tenant_id, v_act_code, v_id, now(), now() + interval '365 days')
    ON CONFLICT (tenant_id, code) DO UPDATE
      SET parent_id = EXCLUDED.parent_id
    WHERE public.activation_codes.bound_to_auth_user_id IS NULL;
  END IF;

  RETURN QUERY SELECT v_id, v_code, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_parent_from_import IS
  'Idempotent parent upsert. Identity: parent_code, then phone, then display_name, '
  'then email. 0037: also populates activation_codes when p_activation_code is '
  'provided (canonical deterministicActivationCode output) so web-portal '
  'activation works for imported / cross-platform-created parents.';

-- ----------------------------------------------------------------------------
-- 3. upsert_student_from_import — ref-tolerant p_parent_id (text), 0028 params kept
-- ----------------------------------------------------------------------------
DO $_drop_student$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'upsert_student_from_import'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
    END LOOP;
END
$_drop_student$;

CREATE OR REPLACE FUNCTION public.upsert_student_from_import(
  p_tenant_id        uuid,
  p_student_code     text,
  p_parent_id        text,               -- 0037: UUID OR parent_code / local ref
  p_first_name       text,
  p_last_name        text,
  p_display_name     text DEFAULT NULL,
  p_middle_name      text DEFAULT NULL,
  p_date_of_birth    date DEFAULT NULL,
  p_gender           text DEFAULT NULL,
  p_grade_level_id   uuid DEFAULT NULL,
  p_class_id         uuid DEFAULT NULL,
  p_enrollment_date  date DEFAULT NULL,
  p_enrollment_status text DEFAULT 'active',
  p_medical_notes    text DEFAULT NULL,
  p_is_active        boolean DEFAULT true,
  -- 0028 params (preserved so the desktop caller keeps working):
  p_grade_level_code text DEFAULT NULL,
  p_transport_tier   text DEFAULT NULL,
  p_payment_plan     text DEFAULT 'tranches'
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
  v_disp      text := COALESCE(NULLIF(TRIM(p_display_name), ''),
                               NULLIF(TRIM(v_first || ' ' || v_last), ''));
  v_plan      text := CASE WHEN p_payment_plan IN ('tranches', 'full_annual') THEN p_payment_plan ELSE 'tranches' END;
  -- 0037: Android pushes 'M'/'F' gender codes while the students.gender CHECK
  -- requires male/female/other — normalize at the RPC boundary.
  v_gender    text := CASE lower(COALESCE(p_gender, ''))
                     WHEN 'm' THEN 'male'
                     WHEN 'f' THEN 'female'
                     WHEN 'male' THEN 'male'
                     WHEN 'female' THEN 'female'
                     WHEN 'other' THEN 'other'
                     ELSE NULL END;
  v_parent    uuid := public.resolve_parent_ref(p_tenant_id, p_parent_id);
BEGIN
  IF v_parent IS NULL THEN
      RAISE EXCEPTION 'upsert_student_from_import: unresolvable parent ref %', p_parent_id
        USING HINT = 'Push the parent (upsert_parent_from_import) before its students.';
  END IF;

  -- Identity resolution (column refs qualified — see 0031):
  --   1. (tenant_id, student_code)
  --   2. (parent_id, first_name, last_name) when all three are non-empty
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
      AND s.parent_id = v_parent
      AND s.first_name = v_first
      AND s.last_name = v_last
      AND s.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE public.students s SET
      parent_id           = v_parent,
      first_name          = COALESCE(NULLIF(TRIM(p_first_name), ''), s.first_name),
      last_name           = COALESCE(NULLIF(TRIM(p_last_name), ''), s.last_name),
      display_name        = COALESCE(v_disp, s.display_name),
      middle_name         = COALESCE(p_middle_name, s.middle_name),
      date_of_birth       = COALESCE(p_date_of_birth, s.date_of_birth),
      gender              = COALESCE(v_gender, s.gender),
      grade_level_id      = COALESCE(p_grade_level_id, s.grade_level_id),
      class_id            = COALESCE(p_class_id, s.class_id),
      enrollment_date     = COALESCE(p_enrollment_date, s.enrollment_date),
      enrollment_status   = COALESCE(NULLIF(TRIM(p_enrollment_status), ''), s.enrollment_status),
      medical_notes       = COALESCE(p_medical_notes, s.medical_notes),
      is_active           = p_is_active,
      grade_level_code    = COALESCE(NULLIF(TRIM(p_grade_level_code), ''), s.grade_level_code),
      transport_tier      = COALESCE(NULLIF(TRIM(p_transport_tier), ''), s.transport_tier),
      payment_plan        = v_plan,
      updated_at          = now()
    WHERE s.id = v_existing;
    v_id := v_existing;
  ELSE
    INSERT INTO public.students (
      tenant_id, student_code, parent_id, first_name, middle_name, last_name,
      display_name, date_of_birth, gender, grade_level_id, class_id,
      enrollment_date, enrollment_status, medical_notes, is_active,
      grade_level_code, transport_tier, payment_plan
    ) VALUES (
      p_tenant_id, v_code, v_parent, v_first, p_middle_name, v_last,
      v_disp, COALESCE(p_date_of_birth, '2000-01-01'::date), v_gender, p_grade_level_id, p_class_id,
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
  'to (parent_id, first_name, last_name). 0037: p_parent_id accepts a server UUID, '
  'a canonical parent_code (PAR-YYYY-XXXXXX) or a mobile local ref; preserves the '
  '0028 params (grade_level_code / transport_tier / payment_plan).';

-- ----------------------------------------------------------------------------
-- 4. upsert_payment_from_import — ref-tolerant p_parent_id / p_student_id / p_installment_id
-- ----------------------------------------------------------------------------
DO $_drop_payment$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'upsert_payment_from_import'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
    END LOOP;
END
$_drop_payment$;

CREATE OR REPLACE FUNCTION public.upsert_payment_from_import(
    p_tenant_id        uuid,
    p_payment_number   text,
    p_parent_id        text,               -- 0037: UUID OR parent_code / local ref
    p_student_id       text,               -- 0037: UUID OR student_code / local ref
    p_invoice_id       uuid DEFAULT NULL,
    p_installment_id   text DEFAULT NULL,  -- 0037: UUID OR mobile installment ref
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
)
RETURNS table(payment_id uuid, payment_number text, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.upsert_payment_from_import IS
  'Idempotent upsert for payments. Identity: (tenant, payment_number). 0037: '
  'p_parent_id / p_student_id / p_installment_id accept server UUIDs, canonical '
  'codes or mobile local refs (resolved via resolve_*_ref).';

-- ----------------------------------------------------------------------------
-- 5. upsert_ledger_entry_from_import — ref-tolerant + reversal-safe identity
-- ----------------------------------------------------------------------------
DO $_drop_ledger$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'upsert_ledger_entry_from_import'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
    END LOOP;
END
$_drop_ledger$;

CREATE OR REPLACE FUNCTION public.upsert_ledger_entry_from_import(
    p_tenant_id     uuid,
    p_entry_number  text DEFAULT NULL,
    p_parent_id     text DEFAULT NULL,     -- 0037: UUID OR parent_code / local ref
    p_student_id    text DEFAULT NULL,     -- 0037: UUID OR student_code / local ref
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
)
RETURNS table(entry_id uuid, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
    v_entry_number text := NULLIF(TRIM(COALESCE(p_entry_number, '')), '');
    v_inserted boolean := false;
    v_existing uuid;
    v_account_id text := NULLIF(TRIM(COALESCE(p_account_id, '')), '');
    v_parent uuid := public.resolve_parent_ref(p_tenant_id, p_parent_id);
    v_student uuid := public.resolve_student_ref(p_tenant_id, p_student_id);
    v_reverses uuid;
BEGIN
    IF v_parent IS NULL THEN
        RAISE EXCEPTION 'upsert_ledger_entry_from_import: unresolvable parent ref %', p_parent_id;
    END IF;

    -- ledger_entries.entry_number is NOT NULL — generate a stable fallback
    -- when the caller (older mobile builds) omits it.
    IF v_entry_number IS NULL THEN
        v_entry_number := 'led-' || EXTRACT(EPOCH FROM NOW())::bigint || '-' ||
                          SUBSTRING(public.gen_uuid()::text, 1, 8);
    END IF;

    -- Canonical account id (re)derivation — matches the clients'' deriveAccountId.
    IF v_account_id IS NULL THEN
        v_account_id := 'parent:' || v_parent || ':category:' || p_category ||
                        CASE WHEN v_student IS NOT NULL THEN ':student:' || v_student ELSE '' END;
    END IF;

    -- Idempotency — identity resolution order:
    --   1. entry_number (UNIQUE per entry — both clients push their local id
    --      here, so this is the per-entry identity).
    --   2. (source_type, source_id) — importer idempotency for re-imports.
    --      NEVER applied to `reversal` entries: a reversal shares the
    --      original entry's source identity BY DESIGN (desktop
    --      createReversalEntry copies the original's sourceType/sourceId), so
    --      matching on it would silently UPDATE the original entry instead of
    --      INSERTING the reversal row — corrupting balances.
    IF v_entry_number IS NOT NULL THEN
        SELECT id INTO v_existing
          FROM public.ledger_entries
         WHERE tenant_id = p_tenant_id
           AND entry_number = v_entry_number
         LIMIT 1;
    END IF;

    IF v_existing IS NULL
       AND p_source_type IS NOT NULL AND p_source_id IS NOT NULL
       AND COALESCE(NULLIF(p_entry_type, ''), 'charge') <> 'reversal' THEN
        SELECT id INTO v_existing
          FROM public.ledger_entries
         WHERE tenant_id = p_tenant_id
           AND source_type = p_source_type
           AND source_id = p_source_id
         LIMIT 1;
    END IF;

    -- Resolve reversal pointer against the server UUID space.
    IF p_reverses_id IS NOT NULL AND TRIM(p_reverses_id) <> '' THEN
        SELECT id INTO v_reverses
          FROM public.ledger_entries
         WHERE tenant_id = p_tenant_id
           AND (entry_number = p_reverses_id
             OR source_type = 'payment' AND source_id = p_reverses_id)
         LIMIT 1;
    END IF;

    IF v_existing IS NOT NULL THEN
        UPDATE public.ledger_entries
           SET parent_id      = COALESCE(v_parent, parent_id),
               student_id     = COALESCE(v_student, student_id),
               account_id     = v_account_id,
               entry_type     = COALESCE(NULLIF(p_entry_type, ''), entry_type),
               amount         = COALESCE(p_amount, amount),
               category       = COALESCE(NULLIF(p_category, ''), category),
               description    = COALESCE(p_description, description),
               method         = COALESCE(p_method, method),
               receipt_number = COALESCE(p_receipt_number, receipt_number),
               payment_status = COALESCE(p_payment_status, payment_status),
               reverses_id    = COALESCE(v_reverses::text, reverses_id),
               metadata       = COALESCE(p_metadata, metadata)
         WHERE id = v_existing;
        v_id := v_existing;
    ELSE
        -- NOTE: ledger_entries has created_at only (immutable ledger — no
        -- updated_at column).
        INSERT INTO public.ledger_entries (
            tenant_id, entry_number, parent_id, student_id, account_id,
            entry_type, amount, category, description, source_type, source_id,
            method, receipt_number, payment_status, reverses_id,
            actor_id, actor_name, at, metadata,
            created_at
        ) VALUES (
            p_tenant_id, v_entry_number, v_parent, v_student, v_account_id,
            COALESCE(NULLIF(p_entry_type, ''), 'charge'),
            COALESCE(p_amount, 0),
            COALESCE(NULLIF(p_category, ''), 'other'),
            p_description,
            COALESCE(NULLIF(p_source_type, ''), 'bulk_import'),
            p_source_id,
            p_method, p_receipt_number, p_payment_status, v_reverses::text,
            p_actor_id, p_actor_name,
            COALESCE(p_at, now()),
            COALESCE(p_metadata, '{}'::jsonb),
            now()
        )
        RETURNING id INTO v_id;
        v_inserted := true;
    END IF;

    RETURN QUERY SELECT v_id, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_ledger_entry_from_import IS
  'Idempotent ledger-entry upsert. Identity: entry_number first, then '
  '(source_type, source_id) — but NEVER for reversal entries (they share the '
  'original''s source identity by design). 0037: refs resolved to server UUIDs; '
  'p_reverses_id resolved against the server entry space.';

-- ----------------------------------------------------------------------------
-- 6. NEW RPC: upsert_installment_from_import — Android installment push
-- ----------------------------------------------------------------------------
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
SET search_path = public
AS $$
DECLARE
    v_id uuid;
    v_inserted boolean := false;
    v_existing uuid;
    v_parent uuid := public.resolve_parent_ref(p_tenant_id, p_parent_id);
    v_student uuid := public.resolve_student_ref(p_tenant_id, p_student_id);
    v_tranche int;
    v_label text := NULLIF(TRIM(COALESCE(p_label, '')), '');
BEGIN
    IF v_parent IS NULL THEN
        RAISE EXCEPTION 'upsert_installment_from_import: unresolvable parent ref %', p_parent_id;
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
  'numeric(12,2) — mobile clients convert centimes before calling.';

-- ----------------------------------------------------------------------------
-- 6b. ledger_entries_source_uidx — exclude reversal rows. A reversal SHARES
--     the original entry's (source_type, source_id) BY DESIGN (the desktop's
--     createReversalEntry copies the original's provenance), so the current
--     unique index makes reversing any payment-sourced entry IMPOSSIBLE
--     (duplicate key on the reversal INSERT).
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.ledger_entries_source_uidx;
CREATE UNIQUE INDEX ledger_entries_source_uidx
    ON public.ledger_entries (tenant_id, source_type, source_id)
    WHERE source_type IS NOT NULL
      AND source_id IS NOT NULL
      AND entry_type <> 'reversal';

-- ----------------------------------------------------------------------------
-- 7. students.enrollment_status — add canonical 'suspended' + 'transferred'
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'students_enrollment_status_check'
           AND conrelid = 'public.students'::regclass
    ) THEN
        ALTER TABLE public.students DROP CONSTRAINT students_enrollment_status_check;
    END IF;

    ALTER TABLE public.students
        ADD CONSTRAINT students_enrollment_status_check
        CHECK (enrollment_status IN (
            'inquiry', 'quoted', 'enrolled', 'active', 'suspended',
            'transferred', 'withdrawn', 'graduated'
        ));
END$$;

-- ----------------------------------------------------------------------------
-- 8. Sanity: installments.status canonical 6-value check (0034 already fixed
--    the main schema; defense-in-depth no-op for drifted databases).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'installments_status_check'
           AND conrelid = 'public.installments'::regclass
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conname = 'installments_status_check'
               AND conrelid = 'public.installments'::regclass
               AND pg_get_constraintdef(oid) LIKE '%pending%'
               AND pg_get_constraintdef(oid) LIKE '%pending_clearance%'
        ) THEN
            ALTER TABLE public.installments DROP CONSTRAINT installments_status_check;
            ALTER TABLE public.installments
                ADD CONSTRAINT installments_status_check
                CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue', 'pending', 'pending_clearance'));
        END IF;
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 9. pull_ledger_entries_for_sync — rewrite reverses_id to the SERVER UUID
--    of the reversed entry so reversal links survive the push→pull round-trip.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pull_ledger_entries_for_sync(
    p_tenant_id uuid,
    p_since     timestamptz DEFAULT '1970-01-01',
    p_limit     integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT le.id, le.tenant_id, le.entry_number, le.parent_id, le.student_id, le.account_id,
               le.entry_type, le.amount, le.category, le.description, le.entry_date, le.created_at,
               le.source_type, le.source_id, le.method, le.receipt_number, le.payment_status,
               -- 0037: resolve the reversal pointer into the server UUID space
               CASE WHEN le.reverses_id IS NULL THEN NULL
                    ELSE COALESCE(
                        (SELECT ref.id::text
                           FROM public.ledger_entries ref
                          WHERE ref.tenant_id = le.tenant_id
                            AND (ref.entry_number = le.reverses_id
                                 OR (ref.source_type = 'payment' AND ref.source_id = le.reverses_id)
                                 OR ref.id::text = le.reverses_id)
                          LIMIT 1),
                        le.reverses_id)
               END AS reverses_id,
               le.actor_id, le.actor_name, le.at, le.metadata
          FROM public.ledger_entries le
         WHERE le.tenant_id = p_tenant_id
           AND COALESCE(le.at, le.entry_date, le.created_at) >= p_since
         ORDER BY COALESCE(le.at, le.entry_date, le.created_at) ASC
         LIMIT p_limit
      ) t;
$$;
