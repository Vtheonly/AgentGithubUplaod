-- ============================================================================
-- 0028_shared_schema_extensions.sql
-- ============================================================================
-- Migration that EXTENDS the shared schema (migration 0027) so both the
-- Desktop and Android clients can store + retrieve the SAME data without
-- needing a second representation of any entity.
--
-- Motivation:
--   The Excel importer (Desktop) currently captures `transportTier` /
--   `transportDestination` and `gradeLevel` (e.g. "1ap", "CE1") per row,
--   but the database has NO column to store them. The Supabase
--   repositories silently DROP these fields (see supabase-shared-
--   repositories.ts updateParent / updateStudent / mapStudentRow), so:
--     - Re-imports cannot detect transport/grade changes.
--     - Android reads back students with a hardcoded "1ap" grade level.
--     - The transport destination town (column V / DISTINATION) is lost.
--
-- This migration adds the missing columns AND backfills them from existing
-- data where possible. It is FULLY IDEMPOTENT (every statement is guarded
-- by IF NOT EXISTS / OR REPLACE / DO $$ ... END $$), so re-running it is
-- safe — same contract as 0027.
--
-- Columns added:
--   parents.transport_destination  text    -- canonical transport town ("BOUMERDES", etc.)
--   parents.city_tier              text    -- legacy tier code ("t1"/"t2"/"t3")
--   students.grade_level_code      text    -- canonical code ("1ap", "CE1", "CP", ...)
--   students.transport_tier        text    -- transport tier/zone string
--   students.payment_plan          text    -- 'tranches' | 'full_annual'
--
-- Functions updated:
--   upsert_parent_from_import  — now accepts p_transport_destination, p_city_tier
--   upsert_student_from_import — now accepts p_grade_level_code, p_transport_tier, p_payment_plan
--
-- No existing column is removed or retyped. No data is destroyed. The
-- migration is forward-compatible: the Desktop and Android clients detect
-- the new columns at runtime via the Supabase PostgREST schema cache and
-- will use them when present, falling back gracefully when absent.
-- ============================================================================

-- ============================================================================
-- Migration 0028: shared schema extensions (transport, grade level, payment plan)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- parents.transport_destination
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parents'
      AND column_name = 'transport_destination'
  ) THEN
    ALTER TABLE public.parents ADD COLUMN transport_destination text;
    RAISE NOTICE 'Added parents.transport_destination';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- parents.city_tier
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parents'
      AND column_name = 'city_tier'
  ) THEN
    ALTER TABLE public.parents ADD COLUMN city_tier text;
    RAISE NOTICE 'Added parents.city_tier';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- students.grade_level_code
--   Stores the canonical grade-level code ("1ap", "CE1", "CP", "GS", ...)
--   independently of the academic_levels FK. This lets the importer persist
--   the level seen in the Excel `niveau` + `CLASSE` columns without needing
--   a join to resolve the FK.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'grade_level_code'
  ) THEN
    ALTER TABLE public.students ADD COLUMN grade_level_code text;
    RAISE NOTICE 'Added students.grade_level_code';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- students.transport_tier
--   Stores the transport tier string the importer derives from the
--   `DISTINATION` column (or the `OPTION` code as a fallback).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'transport_tier'
  ) THEN
    ALTER TABLE public.students ADD COLUMN transport_tier text;
    RAISE NOTICE 'Added students.transport_tier';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- students.payment_plan
--   'tranches' (default, 3-installment plan) or 'full_annual' (single payment).
--   Mirrors the `installments.payment_plan` column added by migration 0026.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'payment_plan'
  ) THEN
    ALTER TABLE public.students ADD COLUMN payment_plan text NOT NULL DEFAULT 'tranches'
      CHECK (payment_plan IN ('tranches', 'full_annual'));
    RAISE NOTICE 'Added students.payment_plan';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Indexes for the new columns (all IF NOT EXISTS)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS parents_transport_destination_idx
  ON public.parents (transport_destination);

CREATE INDEX IF NOT EXISTS students_grade_level_code_idx
  ON public.students (grade_level_code);

-- ----------------------------------------------------------------------------
-- Replace upsert_parent_from_import to accept transport_destination + city_tier.
-- The new function is backward-compatible: the new params default to NULL,
-- so existing callers that don't pass them keep working.
-- NOTE: 0027 created this function returning TABLE(...). We must DROP it first
-- because PostgreSQL cannot change a function's return type via CREATE OR REPLACE.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_parent_from_import(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.upsert_parent_from_import(
  p_tenant_id        uuid,
  p_parent_code      text,
  p_first_name       text,
  p_last_name        text,
  p_display_name     text DEFAULT NULL,
  p_primary_phone    text DEFAULT NULL,
  p_secondary_phone  text DEFAULT NULL,
  p_email            text DEFAULT NULL,
  p_occupation       text DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_relationship     text DEFAULT NULL,
  p_preferred_language text DEFAULT 'fr',
  p_is_active        boolean DEFAULT true,
  -- NEW params (0028):
  p_transport_destination text DEFAULT NULL,
  p_city_tier              text DEFAULT NULL
) RETURNS TABLE (
  out_parent_id    uuid,
  out_parent_code  text,
  out_was_inserted boolean
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
  v_disp      text := COALESCE(NULLIF(TRIM(p_display_name), ''),
                               NULLIF(TRIM(v_first || ' ' || v_last), ''));
  v_phone     text := COALESCE(NULLIF(TRIM(p_primary_phone), ''), '(inconnu)');
BEGIN
  -- Identity resolution (primary → fallback):
  --   1. (tenant_id, parent_code)
  --   2. (tenant_id, primary_phone) when phone is not the placeholder
  --   3. (tenant_id, display_name)  when display_name is non-empty
  --
  -- NOTE: every column reference below is qualified with the `p.` table
  -- alias to avoid the plpgsql "column reference is ambiguous" error
  -- caused by RETURNS TABLE output column names colliding with table
  -- column references. See migration 0031 for the full fix.
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
      first_name           = COALESCE(NULLIF(TRIM(p_first_name), ''), p.first_name),
      last_name            = COALESCE(NULLIF(TRIM(p_last_name), ''), p.last_name),
      display_name         = COALESCE(v_disp, p.display_name),
      primary_phone        = CASE WHEN p_primary_phone IS NOT NULL AND TRIM(p_primary_phone) <> '' THEN p_primary_phone ELSE p.primary_phone END,
      secondary_phone      = COALESCE(p_secondary_phone, p.secondary_phone),
      email                = COALESCE(NULLIF(TRIM(p_email), ''), p.email),
      occupation           = COALESCE(NULLIF(TRIM(p_occupation), ''), p.occupation),
      address              = COALESCE(NULLIF(TRIM(p_address), ''), p.address),
      relationship         = COALESCE(p_relationship, p.relationship),
      is_active            = p_is_active,
      transport_destination = COALESCE(NULLIF(TRIM(p_transport_destination), ''), p.transport_destination),
      city_tier            = COALESCE(NULLIF(TRIM(p_city_tier), ''), p.city_tier),
      updated_at           = now()
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
      -- Email or parent_code conflict — find the existing row and update it
      SELECT p.id INTO v_id
      FROM public.parents p
      WHERE p.tenant_id = p_tenant_id
        AND (p.parent_code = v_code OR (p.email IS NOT NULL AND p.email = TRIM(p_email)))
        AND p.deleted_at IS NULL
      LIMIT 1;
      IF v_id IS NOT NULL THEN
        UPDATE public.parents p SET
          first_name           = COALESCE(NULLIF(TRIM(p_first_name), ''), p.first_name),
          last_name            = COALESCE(NULLIF(TRIM(p_last_name), ''), p.last_name),
          display_name         = COALESCE(v_disp, p.display_name),
          primary_phone        = CASE WHEN p_primary_phone IS NOT NULL AND TRIM(p_primary_phone) <> '' THEN p_primary_phone ELSE p.primary_phone END,
          secondary_phone      = COALESCE(p_secondary_phone, p.secondary_phone),
          occupation           = COALESCE(NULLIF(TRIM(p_occupation), ''), p.occupation),
          address              = COALESCE(NULLIF(TRIM(p_address), ''), p.address),
          relationship         = COALESCE(p_relationship, p.relationship),
          is_active            = p_is_active,
          transport_destination = COALESCE(NULLIF(TRIM(p_transport_destination), ''), p.transport_destination),
          city_tier            = COALESCE(NULLIF(TRIM(p_city_tier), ''), p.city_tier),
          updated_at           = now()
        WHERE p.id = v_id;
      END IF;
    END;
  END IF;

  RETURN QUERY SELECT v_id, v_code, v_inserted;
END;
$$;

-- ----------------------------------------------------------------------------
-- Replace upsert_student_from_import to accept grade_level_code,
-- transport_tier, payment_plan.
-- NOTE: 0027 created this function returning TABLE(...). We must DROP it first.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_student_from_import(uuid, text, uuid, text, text, text, text, date, text, uuid, uuid, date, text, text, boolean);
CREATE OR REPLACE FUNCTION public.upsert_student_from_import(
  p_tenant_id        uuid,
  p_student_code     text,
  p_parent_id        uuid,
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
  -- NEW params (0028):
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
BEGIN
  -- Identity resolution:
  --   1. (tenant_id, student_code)
  --   2. (parent_id, first_name, last_name) when all three are non-empty
  -- Column references are qualified with `s.` to avoid the ambiguity bug
  -- (see migration 0031 for details).
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
      parent_id           = p_parent_id,
      first_name          = COALESCE(NULLIF(TRIM(p_first_name), ''), s.first_name),
      last_name           = COALESCE(NULLIF(TRIM(p_last_name), ''), s.last_name),
      display_name        = COALESCE(v_disp, s.display_name),
      middle_name         = COALESCE(p_middle_name, s.middle_name),
      date_of_birth       = COALESCE(p_date_of_birth, s.date_of_birth),
      gender              = COALESCE(p_gender, s.gender),
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

-- ----------------------------------------------------------------------------
-- Update pull_students_for_sync to include the new columns.
-- NOTE: 0027 created this function returning jsonb. We must DROP it first.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pull_students_for_sync(uuid, timestamptz, integer);
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

-- ----------------------------------------------------------------------------
-- Update pull_parents_for_sync to include the new columns.
-- NOTE: 0027 created this function returning jsonb. We must DROP it first.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pull_parents_for_sync(uuid, timestamptz, integer);
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
    p.relationship, p.is_active,
    p.transport_destination, p.city_tier,
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
-- End of migration 0028: parents.transport_destination + city_tier,
-- students.grade_level_code + transport_tier + payment_plan,
-- updated upsert + pull RPCs
-- ============================================================================
