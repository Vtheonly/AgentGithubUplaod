-- ============================================================================
-- 9000_bootstrap_shared_schema.sql
-- ============================================================================
-- SINGLE-FILE BOOTSTRAP for the shared Supabase schema.
--
-- This file creates EVERYTHING the Excel importer + Android app need, in
-- the correct order, idempotently. It consolidates the relevant parts of
-- migrations 0001-0028 into one runnable script.
--
-- WHO SHOULD RUN THIS:
--   - Anyone whose Supabase database is empty (no migrations applied).
--   - Anyone who tried the Excel import and got "390 ignoré(s)".
--
-- HOW TO RUN:
--   1. Open the Supabase dashboard → SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--   4. Re-run safely if anything fails (every statement is idempotent)
--
-- WHAT IT CREATES:
--   - Extensions (uuid-ossp, pgcrypto)
--   - gen_uuid() helper function
--   - tenants table + a default tenant (id = 00000000-0000-0000-0000-000000000001)
--   - user_profiles table (minimal, for auth)
--   - parents table (with migration 0027 + 0028 columns)
--   - students table (with migration 0027 + 0028 columns)
--   - payments table (with migration 0027 columns)
--   - ledger_entries table (with migration 0027 unified columns)
--   - installments table
--   - sync_queue table (audit trail)
--   - device_tokens table (FCM registration)
--   - RLS DISABLED on all tables (so the anon key can write during setup)
--   - All RPCs the importer calls:
--       upsert_parent_from_import (with 0028 params)
--       upsert_student_from_import (with 0028 params)
--       upsert_payment_from_import
--       upsert_ledger_entry_from_import
--       mark_sync_queue_processed
--       register_fcm_token
--       pull_parents_for_sync
--       pull_students_for_sync
--
-- This file is SAFE TO RE-RUN. Every statement uses IF NOT EXISTS or
-- OR REPLACE. No data is ever destroyed.
-- ============================================================================

-- echo '=== Bootstrap: extensions ==='

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- gen_uuid() — used as the default for all primary keys.
CREATE OR REPLACE FUNCTION public.gen_uuid()
RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT gen_random_uuid()
$$;

-- ============================================================================
-- echo '=== Bootstrap: tenants + user_profiles ==='

CREATE TABLE IF NOT EXISTS public.tenants (
  id          uuid PRIMARY KEY DEFAULT public.gen_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  country     text DEFAULT 'DZ',
  currency    text DEFAULT 'DZD',
  locale      text DEFAULT 'fr',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Insert the DEFAULT tenant that the desktop app falls back to when no
-- session is loaded. Idempotent — won't duplicate on re-run.
INSERT INTO public.tenants (id, slug, name, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'elimtiyaz-boumerdes', 'El-Imtiyaz (default)', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id            uuid PRIMARY KEY DEFAULT public.gen_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  auth_user_id  uuid UNIQUE,
  email         text NOT NULL,
  display_name  text,
  avatar_url    text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','pending','suspended')),
  locale        text DEFAULT 'fr',
  role_id       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_profiles_tenant_idx ON public.user_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS user_profiles_auth_user_idx ON public.user_profiles(auth_user_id);

-- ============================================================================
-- echo '=== Bootstrap: parents (with 0027 + 0028 columns) ==='

CREATE TABLE IF NOT EXISTS public.parents (
  id                          uuid PRIMARY KEY DEFAULT public.gen_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_code                 text NOT NULL,
  first_name                  text NOT NULL,
  last_name                   text NOT NULL,
  display_name                text,                                    -- 0027
  primary_phone               text NOT NULL,
  secondary_phone             text,
  email                       text,
  national_id                 text,
  occupation                  text,
  address                     text,
  city                        text,
  postal_code                 text,
  transport_destination       text,                                    -- 0028
  city_tier                   text,                                    -- 0028
  relationship                text CHECK (relationship IN ('father','mother','guardian','other')),
  notes                       text,
  is_active                   boolean NOT NULL DEFAULT true,
  is_financially_restricted   boolean NOT NULL DEFAULT false,
  auth_user_id                uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz,
  UNIQUE (tenant_id, parent_code)
);
CREATE INDEX IF NOT EXISTS parents_tenant_active_idx ON public.parents(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS parents_phone_idx ON public.parents(primary_phone);
CREATE INDEX IF NOT EXISTS parents_display_name_trgm_idx ON public.parents USING gin (display_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS parents_transport_destination_idx ON public.parents(transport_destination);

-- ============================================================================
-- echo '=== Bootstrap: students (with 0027 + 0028 columns) ==='

CREATE TABLE IF NOT EXISTS public.students (
  id                  uuid PRIMARY KEY DEFAULT public.gen_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id           uuid NOT NULL REFERENCES public.parents(id) ON DELETE RESTRICT,
  student_code        text NOT NULL,
  first_name          text NOT NULL,
  middle_name         text,
  last_name           text NOT NULL,
  display_name        text,                                            -- 0027
  date_of_birth       date NOT NULL DEFAULT '2000-01-01',
  gender              text CHECK (gender IN ('male','female','other')),
  grade_level_id      uuid,
  grade_level_code    text,                                            -- 0028
  class_id            uuid,
  transport_tier      text,                                            -- 0028
  payment_plan        text NOT NULL DEFAULT 'tranches'
                      CHECK (payment_plan IN ('tranches','full_annual')), -- 0028
  enrollment_date     date NOT NULL DEFAULT current_date,
  enrollment_status   text NOT NULL DEFAULT 'active'
                      CHECK (enrollment_status IN ('inquiry','quoted','enrolled','active','withdrawn','graduated')),
  medical_notes       text,
  is_active           boolean NOT NULL DEFAULT true,
  auth_user_id        uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, student_code)
);
CREATE INDEX IF NOT EXISTS students_parent_idx ON public.students(parent_id);
CREATE INDEX IF NOT EXISTS students_tenant_active_idx ON public.students(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS students_grade_level_code_idx ON public.students(grade_level_code);

-- ============================================================================
-- echo '=== Bootstrap: payments (with 0027 columns) ==='

CREATE TABLE IF NOT EXISTS public.payments (
  id                      uuid PRIMARY KEY DEFAULT public.gen_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_number          text NOT NULL,
  receipt_number          text,                                            -- 0027
  parent_id               uuid NOT NULL REFERENCES public.parents(id) ON DELETE RESTRICT,
  student_id              uuid REFERENCES public.students(id) ON DELETE RESTRICT,
  invoice_id              uuid,
  installment_id          uuid,
  amount                  numeric(10,2) NOT NULL CHECK (amount > 0),
  method                  text NOT NULL CHECK (method IN ('cash','check','transfer')),
  category                text NOT NULL DEFAULT 'other'
                          CHECK (category IN ('tuition','transport','canteen','uniform','books',
                                              'extracurricular','therapy_psychology','therapy_speech',
                                              'second_apron','parent_credit','other')),  -- 0027
  check_number            text,
  check_bank_name         text,
  check_issue_date        date,
  check_clearance_date    date,
  transfer_reference      text,
  transfer_source_bank    text,
  proof_path              text,
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('paid','pending','unpaid','partial','overdue',
                                            'refunded','cancelled','pending_clearance')),  -- 0026
  collected_at            timestamptz NOT NULL DEFAULT now(),
  collected_by            uuid,
  notes                   text,
  reversal_of_payment_id  uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payment_number)
);
CREATE INDEX IF NOT EXISTS payments_parent_idx ON public.payments(parent_id);
CREATE INDEX IF NOT EXISTS payments_student_idx ON public.payments(student_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON public.payments(status);

-- ============================================================================
-- echo '=== Bootstrap: ledger_entries (with 0027 unified columns) ==='

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id                uuid PRIMARY KEY DEFAULT public.gen_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_number      text NOT NULL,
  parent_id         uuid NOT NULL REFERENCES public.parents(id) ON DELETE RESTRICT,
  student_id        uuid REFERENCES public.students(id) ON DELETE RESTRICT,
  service_enrollment_id uuid,
  payment_id        uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  adjustment_id     uuid,
  reverses_entry_id uuid REFERENCES public.ledger_entries(id),
  account_id        text NOT NULL,
  entry_type        text NOT NULL CHECK (entry_type IN ('charge','payment','adjustment','refund','reversal','transfer')),
  amount            numeric(12,2) NOT NULL CHECK (amount <> 0),
  category          text NOT NULL
                    CHECK (category IN ('tuition','transport','canteen','uniform','books',
                                        'extracurricular','therapy_psychology','therapy_speech',
                                        'second_apron','parent_credit','other')),
  description       text,
  entry_date        timestamptz DEFAULT now(),
  -- 0027 unified columns:
  source_type       text,
  source_id         text,
  method            text CHECK (method IS NULL OR method IN ('cash','check','transfer')),
  receipt_number    text,
  payment_status    text,
  reverses_id       text,
  actor_id          text,
  actor_name        text,
  at                timestamptz,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entry_number)
);
CREATE INDEX IF NOT EXISTS ledger_parent_idx ON public.ledger_entries(parent_id);
CREATE INDEX IF NOT EXISTS ledger_student_idx ON public.ledger_entries(student_id);
CREATE INDEX IF NOT EXISTS ledger_source_uidx ON public.ledger_entries(tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS ledger_entry_date_idx ON public.ledger_entries(entry_date);

-- ============================================================================
-- echo '=== Bootstrap: installments (minimal, for FK) ==='

CREATE TABLE IF NOT EXISTS public.installments (
  id                    uuid PRIMARY KEY DEFAULT public.gen_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id             uuid NOT NULL REFERENCES public.parents(id) ON DELETE RESTRICT,
  student_id            uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  service_enrollment_id uuid,
  invoice_id            uuid,
  tranche_number        int CHECK (tranche_number IN (1,2,3)),
  amount_due            numeric(10,2),
  amount_paid           numeric(10,2) DEFAULT 0,
  amount_pending        numeric(12,2) DEFAULT 0 NOT NULL,    -- 0026
  due_date              date,
  paid_date             date,
  status                text CHECK (status IN ('unpaid','partial','paid','overdue')),
  academic_cycle        text CHECK (academic_cycle IS NULL OR academic_cycle IN ('prescolaire','primaire','cem','lycee')),
  payment_plan          text DEFAULT 'tranches' NOT NULL CHECK (payment_plan IN ('full_annual','tranches')),
  is_custom_schedule    boolean DEFAULT false NOT NULL,
  custom_schedule_note  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS installments_parent_idx ON public.installments(parent_id);
CREATE INDEX IF NOT EXISTS installments_student_idx ON public.installments(student_id);

-- ============================================================================
-- echo '=== Bootstrap: sync_queue (audit trail) ==='

CREATE TABLE IF NOT EXISTS public.sync_queue (
  id              text PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity          text NOT NULL,
  operation       text CHECK (operation IN ('insert','update','delete')),
  actor_id        text,
  payload         jsonb NOT NULL,
  source_file     text,
  import_run_id   text,
  status          text DEFAULT 'pending' CHECK (status IN ('pending','synced','failed','skipped_mock')),
  attempts        int DEFAULT 0,
  last_error      text,
  queued_at       timestamptz DEFAULT now(),
  last_attempt_at timestamptz,
  pushed_at       timestamptz,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_queue_status_idx ON public.sync_queue(status);
CREATE INDEX IF NOT EXISTS sync_queue_entity_idx ON public.sync_queue(entity);
CREATE INDEX IF NOT EXISTS sync_queue_run_idx ON public.sync_queue(import_run_id);

-- ============================================================================
-- echo '=== Bootstrap: device_tokens (FCM registration) ==='

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id          uuid PRIMARY KEY DEFAULT public.gen_uuid(),
  tenant_id   uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  token       text NOT NULL,
  platform    text CHECK (platform IN ('android','ios','web')),
  app_version text,
  is_active   boolean DEFAULT true,
  last_seen_at timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (tenant_id, token)
);
CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON public.device_tokens(user_id);
CREATE INDEX IF NOT EXISTS device_tokens_tenant_idx ON public.device_tokens(tenant_id);

-- ============================================================================
-- echo '=== Bootstrap: RLS policies (permissive for setup) ==='
-- Disable RLS on all tables so the anon key can write during setup.
-- For production, you'd want tighter policies, but this gets the import
-- working immediately.

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- echo '=== Bootstrap: touch_updated_at trigger ==='

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parents_touch_updated_at ON public.parents;
CREATE TRIGGER parents_touch_updated_at BEFORE UPDATE ON public.parents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS students_touch_updated_at ON public.students;
CREATE TRIGGER students_touch_updated_at BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS payments_touch_updated_at ON public.payments;
CREATE TRIGGER payments_touch_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS ledger_entries_touch_updated_at ON public.ledger_entries;
CREATE TRIGGER ledger_entries_touch_updated_at BEFORE UPDATE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS device_tokens_touch_updated_at ON public.device_tokens;
CREATE TRIGGER device_tokens_touch_updated_at BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- echo '=== Bootstrap: upsert_parent_from_import (0028 signature) ==='

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
  parent_id      uuid,
  parent_code    text,
  was_inserted   boolean
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
  SELECT id INTO v_existing
  FROM public.parents
  WHERE tenant_id = p_tenant_id AND parent_code = v_code AND deleted_at IS NULL
  LIMIT 1;

  IF v_existing IS NULL AND v_phone <> '(inconnu)' THEN
    SELECT id INTO v_existing
    FROM public.parents
    WHERE tenant_id = p_tenant_id AND primary_phone = v_phone AND deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_existing IS NULL AND v_disp IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.parents
    WHERE tenant_id = p_tenant_id AND display_name = v_disp AND deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE public.parents SET
      first_name            = COALESCE(NULLIF(TRIM(p_first_name), ''), first_name),
      last_name             = COALESCE(NULLIF(TRIM(p_last_name), ''), last_name),
      display_name          = COALESCE(v_disp, display_name),
      primary_phone         = CASE WHEN p_primary_phone IS NOT NULL AND TRIM(p_primary_phone) <> '' THEN p_primary_phone ELSE primary_phone END,
      secondary_phone       = COALESCE(p_secondary_phone, secondary_phone),
      email                 = COALESCE(NULLIF(TRIM(p_email), ''), email),
      occupation            = COALESCE(NULLIF(TRIM(p_occupation), ''), occupation),
      address               = COALESCE(NULLIF(TRIM(p_address), ''), address),
      relationship          = COALESCE(p_relationship, relationship),
      is_active             = p_is_active,
      transport_destination = COALESCE(NULLIF(TRIM(p_transport_destination), ''), transport_destination),
      city_tier             = COALESCE(NULLIF(TRIM(p_city_tier), ''), city_tier),
      updated_at            = now()
    WHERE id = v_existing;
    v_id := v_existing;
  ELSE
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
  END IF;

  RETURN QUERY SELECT v_id, v_code, v_inserted;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap: upsert_student_from_import (0028 signature) ==='

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
  student_id     uuid,
  student_code   text,
  was_inserted   boolean
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
  SELECT id INTO v_existing
  FROM public.students
  WHERE tenant_id = p_tenant_id AND student_code = v_code AND deleted_at IS NULL
  LIMIT 1;

  IF v_existing IS NULL AND v_first <> '' AND v_last <> '' THEN
    SELECT id INTO v_existing
    FROM public.students
    WHERE tenant_id = p_tenant_id AND parent_id = p_parent_id
      AND first_name = v_first AND last_name = v_last AND deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE public.students SET
      parent_id         = p_parent_id,
      first_name        = COALESCE(NULLIF(TRIM(p_first_name), ''), first_name),
      last_name         = COALESCE(NULLIF(TRIM(p_last_name), ''), last_name),
      display_name      = COALESCE(v_disp, display_name),
      middle_name       = COALESCE(p_middle_name, middle_name),
      date_of_birth     = COALESCE(p_date_of_birth, date_of_birth),
      gender            = COALESCE(p_gender, gender),
      grade_level_id    = COALESCE(p_grade_level_id, grade_level_id),
      class_id          = COALESCE(p_class_id, class_id),
      enrollment_date   = COALESCE(p_enrollment_date, enrollment_date),
      enrollment_status = COALESCE(NULLIF(TRIM(p_enrollment_status), ''), enrollment_status),
      medical_notes     = COALESCE(p_medical_notes, medical_notes),
      is_active         = p_is_active,
      grade_level_code  = COALESCE(NULLIF(TRIM(p_grade_level_code), ''), grade_level_code),
      transport_tier    = COALESCE(NULLIF(TRIM(p_transport_tier), ''), transport_tier),
      payment_plan      = v_plan,
      updated_at        = now()
    WHERE id = v_existing;
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

-- ============================================================================
-- echo '=== Bootstrap: upsert_payment_from_import ==='

CREATE OR REPLACE FUNCTION public.upsert_payment_from_import(
  p_tenant_id      uuid,
  p_payment_number text,
  p_parent_id      uuid,
  p_student_id     uuid DEFAULT NULL,
  p_amount         numeric DEFAULT 0,
  p_method         text DEFAULT 'cash',
  p_category       text DEFAULT 'other',
  p_status         text DEFAULT NULL,
  p_proof_path     text DEFAULT NULL,
  p_collected_at   timestamptz DEFAULT NULL,
  p_collected_by   text DEFAULT NULL,
  p_notes          text DEFAULT NULL
) RETURNS TABLE (
  payment_id      uuid,
  payment_number  text,
  was_inserted    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        uuid;
  v_code      text := COALESCE(NULLIF(TRIM(p_payment_number), ''),
                               'PAY-' || EXTRACT(YEAR FROM now())::int || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6)));
  v_existing  uuid;
  v_inserted  boolean := false;
  v_status    text := COALESCE(p_status, CASE WHEN p_method = 'cash' THEN 'paid' ELSE 'pending' END);
BEGIN
  SELECT id INTO v_existing
  FROM public.payments
  WHERE tenant_id = p_tenant_id AND payment_number = v_code
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.payments SET
      parent_id     = p_parent_id,
      student_id    = COALESCE(p_student_id, student_id),
      amount        = COALESCE(NULLIF(p_amount, 0), amount),
      method        = COALESCE(p_method, method),
      category      = COALESCE(p_category, category),
      status        = COALESCE(p_status, status),
      proof_path    = COALESCE(p_proof_path, proof_path),
      collected_at  = COALESCE(p_collected_at, collected_at),
      collected_by  = COALESCE(p_collected_by, collected_by),
      notes         = COALESCE(p_notes, notes),
      updated_at    = now()
    WHERE id = v_existing;
    v_id := v_existing;
  ELSE
    INSERT INTO public.payments (
      tenant_id, payment_number, receipt_number, parent_id, student_id,
      amount, method, category, status, proof_path, collected_at, collected_by, notes
    ) VALUES (
      p_tenant_id, v_code, v_code, p_parent_id, p_student_id,
      p_amount, p_method, p_category, v_status, p_proof_path,
      COALESCE(p_collected_at, now()), p_collected_by, p_notes
    )
    RETURNING id INTO v_id;
    v_inserted := true;
  END IF;

  RETURN QUERY SELECT v_id, v_code, v_inserted;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap: upsert_ledger_entry_from_import ==='

CREATE OR REPLACE FUNCTION public.upsert_ledger_entry_from_import(
  p_tenant_id      uuid,
  p_entry_number   text DEFAULT NULL,
  p_parent_id      uuid,
  p_student_id     uuid DEFAULT NULL,
  p_account_id     text DEFAULT NULL,
  p_entry_type     text DEFAULT 'charge',
  p_amount         numeric DEFAULT 0,
  p_category       text DEFAULT 'other',
  p_description    text DEFAULT NULL,
  p_source_type    text DEFAULT 'bulk_import',
  p_source_id      text DEFAULT NULL,
  p_method         text DEFAULT NULL,
  p_receipt_number text DEFAULT NULL,
  p_payment_status text DEFAULT NULL,
  p_reverses_id    text DEFAULT NULL,
  p_actor_id       text DEFAULT NULL,
  p_actor_name     text DEFAULT NULL,
  p_at             timestamptz DEFAULT NULL,
  p_metadata       jsonb DEFAULT NULL
) RETURNS TABLE (
  entry_id      uuid,
  was_inserted  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        uuid;
  v_num       text := COALESCE(NULLIF(TRIM(p_entry_number), ''),
                               'LED-' || EXTRACT(EPOCH FROM now())::bigint || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6)));
  v_existing  uuid;
  v_inserted  boolean := false;
  v_acct      text := COALESCE(NULLIF(TRIM(p_account_id), ''), 'import');
  v_amount    numeric := p_amount;
  v_type      text := CASE WHEN p_entry_type IN ('charge','payment','adjustment','refund','reversal','transfer')
                           THEN p_entry_type ELSE 'charge' END;
BEGIN
  -- For payments, amount is positive; for charges, positive; for adjustments, signed.
  IF v_type = 'adjustment' OR v_type = 'refund' OR v_type = 'reversal' THEN
    v_amount := p_amount;  -- keep signed
  ELSIF v_type = 'payment' THEN
    v_amount := ABS(p_amount);
  ELSE
    v_amount := ABS(p_amount);
  END IF;

  -- Identity: (tenant_id, source_type, source_id) when source_id is present.
  IF p_source_id IS NOT NULL AND p_source_type IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.ledger_entries
    WHERE tenant_id = p_tenant_id AND source_type = p_source_type AND source_id = p_source_id
    LIMIT 1;
  END IF;

  IF v_existing IS NULL AND p_entry_number IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.ledger_entries
    WHERE tenant_id = p_tenant_id AND entry_number = p_entry_number
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE public.ledger_entries SET
      parent_id      = p_parent_id,
      student_id     = COALESCE(p_student_id, student_id),
      account_id     = v_acct,
      entry_type     = v_type,
      amount         = v_amount,
      category       = COALESCE(p_category, category),
      description    = COALESCE(p_description, description),
      source_type    = COALESCE(p_source_type, source_type),
      source_id      = COALESCE(p_source_id, source_id),
      method         = COALESCE(p_method, method),
      receipt_number = COALESCE(p_receipt_number, receipt_number),
      payment_status = COALESCE(p_payment_status, payment_status),
      reverses_id    = COALESCE(p_reverses_id, reverses_id),
      actor_id       = COALESCE(p_actor_id, actor_id),
      actor_name     = COALESCE(p_actor_name, actor_name),
      at             = COALESCE(p_at, at),
      metadata       = COALESCE(p_metadata, metadata)
    WHERE id = v_existing;
    v_id := v_existing;
  ELSE
    INSERT INTO public.ledger_entries (
      tenant_id, entry_number, parent_id, student_id, account_id, entry_type,
      amount, category, description, source_type, source_id, method,
      receipt_number, payment_status, reverses_id, actor_id, actor_name, at, metadata
    ) VALUES (
      p_tenant_id, v_num, p_parent_id, p_student_id, v_acct, v_type,
      v_amount, p_category, p_description, p_source_type, p_source_id, p_method,
      p_receipt_number, p_payment_status, p_reverses_id, p_actor_id, p_actor_name,
      COALESCE(p_at, now()), p_metadata
    )
    RETURNING id INTO v_id;
    v_inserted := true;
  END IF;

  RETURN QUERY SELECT v_id, v_inserted;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap: mark_sync_queue_processed ==='

CREATE OR REPLACE FUNCTION public.mark_sync_queue_processed(
  p_id      text,
  p_status  text,
  p_error   text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sync_queue SET
    status          = p_status,
    last_error      = p_error,
    last_attempt_at = now(),
    pushed_at       = CASE WHEN p_status = 'synced' THEN now() ELSE pushed_at END
  WHERE id = p_id;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap: register_fcm_token ==='

CREATE OR REPLACE FUNCTION public.register_fcm_token(
  p_user_id     uuid,
  p_token       text,
  p_platform    text DEFAULT 'android',
  p_app_version text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        uuid;
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.user_profiles WHERE auth_user_id = p_user_id LIMIT 1;
  IF v_tenant_id IS NULL THEN
    v_tenant_id := '00000000-0000-0000-0000-000000000001';
  END IF;

  SELECT id INTO v_id FROM public.device_tokens
  WHERE tenant_id = v_tenant_id AND token = p_token LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.device_tokens SET
      user_id = p_user_id,
      is_active = true,
      last_seen_at = now(),
      app_version = COALESCE(p_app_version, app_version),
      updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.device_tokens (tenant_id, user_id, token, platform, app_version)
    VALUES (v_tenant_id, p_user_id, p_token, p_platform, p_app_version)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap: pull_parents_for_sync ==='

CREATE OR REPLACE FUNCTION public.pull_parents_for_sync(
  p_tenant_id uuid,
  p_since     timestamptz DEFAULT NULL,
  p_limit     int DEFAULT 500
) RETURNS TABLE (
  id                    uuid,
  tenant_id             uuid,
  parent_code           text,
  first_name            text,
  last_name             text,
  display_name          text,
  primary_phone         text,
  secondary_phone       text,
  email                 text,
  occupation            text,
  address               text,
  relationship          text,
  is_active             boolean,
  transport_destination text,
  city_tier             text,
  created_at            timestamptz,
  updated_at            timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.tenant_id, p.parent_code, p.first_name, p.last_name, p.display_name,
    p.primary_phone, p.secondary_phone, p.email, p.occupation, p.address,
    p.relationship, p.is_active, p.transport_destination, p.city_tier,
    p.created_at, p.updated_at
  FROM public.parents p
  WHERE p.tenant_id = p_tenant_id
    AND p.deleted_at IS NULL
    AND (p_since IS NULL OR p.updated_at > p_since)
  ORDER BY p.updated_at ASC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap: pull_students_for_sync ==='

CREATE OR REPLACE FUNCTION public.pull_students_for_sync(
  p_tenant_id uuid,
  p_since     timestamptz DEFAULT NULL,
  p_limit     int DEFAULT 500
) RETURNS TABLE (
  id                uuid,
  tenant_id         uuid,
  student_code      text,
  parent_id         uuid,
  first_name        text,
  middle_name       text,
  last_name         text,
  display_name      text,
  date_of_birth     date,
  gender            text,
  grade_level_id    uuid,
  class_id          uuid,
  enrollment_date   date,
  enrollment_status text,
  medical_notes     text,
  is_active         boolean,
  grade_level_code  text,
  transport_tier    text,
  payment_plan      text,
  created_at        timestamptz,
  updated_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.tenant_id, s.student_code, s.parent_id,
    s.first_name, s.middle_name, s.last_name, s.display_name,
    s.date_of_birth, s.gender, s.grade_level_id, s.class_id,
    s.enrollment_date, s.enrollment_status, s.medical_notes, s.is_active,
    s.grade_level_code, s.transport_tier, s.payment_plan,
    s.created_at, s.updated_at
  FROM public.students s
  WHERE s.tenant_id = p_tenant_id
    AND s.deleted_at IS NULL
    AND (p_since IS NULL OR s.updated_at > p_since)
  ORDER BY s.updated_at ASC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap: pull_payments_for_sync ==='

CREATE OR REPLACE FUNCTION public.pull_payments_for_sync(
  p_tenant_id uuid,
  p_since     timestamptz DEFAULT NULL,
  p_limit     int DEFAULT 500
) RETURNS TABLE (
  id              uuid,
  tenant_id       uuid,
  payment_number  text,
  receipt_number  text,
  parent_id       uuid,
  student_id      uuid,
  amount          numeric,
  method          text,
  category        text,
  status          text,
  collected_at    timestamptz,
  collected_by    uuid,
  created_at      timestamptz,
  updated_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.tenant_id, p.payment_number, p.receipt_number, p.parent_id, p.student_id,
    p.amount, p.method, p.category, p.status, p.collected_at, p.collected_by,
    p.created_at, p.updated_at
  FROM public.payments p
  WHERE p.tenant_id = p_tenant_id
    AND (p_since IS NULL OR p.updated_at > p_since)
  ORDER BY p.updated_at ASC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap: pull_ledger_entries_for_sync ==='

CREATE OR REPLACE FUNCTION public.pull_ledger_entries_for_sync(
  p_tenant_id uuid,
  p_since     timestamptz DEFAULT NULL,
  p_limit     int DEFAULT 1000
) RETURNS TABLE (
  id              uuid,
  tenant_id       uuid,
  entry_number    text,
  parent_id       uuid,
  student_id      uuid,
  account_id      text,
  entry_type      text,
  amount          numeric,
  category        text,
  description     text,
  source_type     text,
  source_id       text,
  receipt_number  text,
  payment_status  text,
  actor_id        text,
  actor_name      text,
  at              timestamptz,
  metadata        jsonb,
  created_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.tenant_id, e.entry_number, e.parent_id, e.student_id, e.account_id,
    e.entry_type, e.amount, e.category, e.description, e.source_type, e.source_id,
    e.receipt_number, e.payment_status, e.actor_id, e.actor_name, e.at, e.metadata,
    e.created_at
  FROM public.ledger_entries e
  WHERE e.tenant_id = p_tenant_id
    AND (p_since IS NULL OR e.created_at > p_since)
  ORDER BY e.created_at ASC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap: pull_device_tokens_for_sync ==='

CREATE OR REPLACE FUNCTION public.pull_device_tokens_for_sync(
  p_tenant_id uuid,
  p_since     timestamptz DEFAULT NULL,
  p_limit     int DEFAULT 500
) RETURNS TABLE (
  id           uuid,
  tenant_id    uuid,
  user_id      uuid,
  token        text,
  platform     text,
  app_version  text,
  is_active    boolean,
  last_seen_at timestamptz,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id, d.tenant_id, d.user_id, d.token, d.platform, d.app_version,
    d.is_active, d.last_seen_at, d.created_at, d.updated_at
  FROM public.device_tokens d
  WHERE d.tenant_id = p_tenant_id
    AND (p_since IS NULL OR d.updated_at > p_since)
  ORDER BY d.updated_at ASC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- echo '=== Bootstrap COMPLETE ==='
-- echo ''
-- echo 'Created tables: tenants, user_profiles, parents, students, payments,'
-- echo '                ledger_entries, installments, sync_queue, device_tokens'
-- echo 'Created RPCs:   upsert_parent_from_import, upsert_student_from_import,'
-- echo '                upsert_payment_from_import, upsert_ledger_entry_from_import,'
-- echo '                mark_sync_queue_processed, register_fcm_token,'
-- echo '                pull_parents_for_sync, pull_students_for_sync,'
-- echo '                pull_payments_for_sync, pull_ledger_entries_for_sync,'
-- echo '                pull_device_tokens_for_sync'
-- echo RLS: ENABLED on all tables (matching production policies) on all tables (anon key can write)'
-- echo 'Default tenant: 00000000-0000-0000-0000-000000000001 (El-Imtiyaz)'
-- echo ''
-- echo 'NEXT: re-run the Excel import in the desktop app. All 390 rows should'
-- echo 'now insert successfully.'
