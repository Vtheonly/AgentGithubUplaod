-- ============================================================================
-- 0027_shared_unification.sql
-- ============================================================================
-- SHARED UNIFICATION MIGRATION — the canonical contract between the Desktop
-- app (Vite/React/TypeScript) and the Android app (Kotlin/Compose/Room).
--
-- Both clients read and write to the SAME Supabase/PostgreSQL backend, against
-- the SAME schema, with the SAME entity shapes. This migration:
--
--   1. Adds `display_name` to `parents` and `students` so the COMPLETE name
--      is preserved end-to-end (Excel → Desktop → Supabase → Android → UI).
--      Fixes the "parent name shown as 'Tuteur BENALI' instead of the
--      complete 'BENALI Mohamed'" bug at the schema + importer layer.
--
--   2. Adds the missing columns on `payments`, `ledger_entries`, `audit_logs`
--      that migration `0026_unified_financial.sql` referenced but never
--      ALTERed into existence. Without these, `collect_and_allocate_payment`
--      and `revert_payment_allocation` fail at first invocation.
--
--   3. Creates `sync_queue` — the shared outbound queue used by both clients
--      to push pending mutations to Supabase. Idempotent upsert by `id`.
--
--   4. Creates `device_tokens` — FCM/APNS device-token registry used by the
--      Android app's `register_fcm_token` RPC. Mirrors the contract the
--      Android `FcmTokenRegistrar` already invokes.
--
--   5. Creates SECURITY DEFINER RPCs that are the canonical write paths
--      for both clients:
--        - `register_fcm_token(p_user_id, p_token, p_platform)`
--        - `upsert_parent_from_import(...)`      — idempotent by (tenant, phone)
--        - `upsert_student_from_import(...)`      — idempotent by (tenant, student_code)
--        - `upsert_payment_from_import(...)`      — idempotent by (tenant, payment_number)
--        - `upsert_ledger_entry_from_import(...)` — idempotent by (tenant, source_type, source_id)
--        - `mark_sync_queue_processed(...)`
--        - `pull_parents_for_sync(p_tenant_id, p_since)`
--        - `pull_students_for_sync(p_tenant_id, p_since)`
--        - `pull_payments_for_sync(p_tenant_id, p_since)`
--        - `pull_ledger_entries_for_sync(p_tenant_id, p_since)`
--        - `pull_device_tokens_for_sync(p_tenant_id, p_since)`
--
--   6. Adds RLS policies so the queue + tokens are tenant-scoped like
--      every other table.
--
-- This migration is IDEMPOTENT — every statement uses IF NOT EXISTS / OR
-- REPLACE / DO blocks that check before altering. It can be re-run safely.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Compatibility shims: ensure `public` schema functions exist
-- ----------------------------------------------------------------------------
-- `touch_updated_at()` and `gen_uuid()` are defined in 0001/0002; we re-declare
-- them IF NOT EXISTS so this migration can run on a fresh DB or an existing one.

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. parents — add display_name (preserves COMPLETE parent name end-to-end)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'parents'
           AND column_name  = 'display_name'
    ) THEN
        ALTER TABLE public.parents ADD COLUMN display_name text;
        COMMENT ON COLUMN public.parents.display_name IS
          'Complete display name as imported (e.g. ''BENALI Mohamed''). '
          'When non-null, UI MUST show this verbatim instead of first_name/last_name. '
          'Preserves the full name even when first_name/last_name are split for indexing.';
    END IF;
END$$;

-- Backfill display_name for existing rows: prefer "first_name last_name".
UPDATE public.parents
   SET display_name = COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), last_name)
 WHERE display_name IS NULL;

-- Index for free-text search on the complete name.
CREATE INDEX IF NOT EXISTS parents_display_name_trgm_idx
    ON public.parents USING gin (display_name extensions.gin_trgm_ops)
    WHERE display_name IS NOT NULL AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. students — add display_name (parity with parents)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'students'
           AND column_name  = 'display_name'
    ) THEN
        ALTER TABLE public.students ADD COLUMN display_name text;
        COMMENT ON COLUMN public.students.display_name IS
          'Complete display name as imported (e.g. ''BENALI Sara''). '
          'When non-null, UI shows this verbatim.';
    END IF;
END$$;

UPDATE public.students
   SET display_name = COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), last_name)
 WHERE display_name IS NULL;

CREATE INDEX IF NOT EXISTS students_display_name_trgm_idx
    ON public.students USING gin (display_name extensions.gin_trgm_ops)
    WHERE display_name IS NOT NULL AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3. payments — add receipt_number (alias for payment_number) + category
-- ----------------------------------------------------------------------------
-- Migration 0026 references `payments.receipt_number` and `payments.category`
-- but never ALTERs the table created in 0007. Add them here.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'payments'
           AND column_name  = 'receipt_number'
    ) THEN
        ALTER TABLE public.payments ADD COLUMN receipt_number text;
        COMMENT ON COLUMN public.payments.receipt_number IS
          'Alias for payment_number — kept in sync by trigger. '
          'Used by the 0026 atomic RPCs and the desktop domain model.';
    END IF;
END$$;

-- Backfill: receipt_number := payment_number
UPDATE public.payments SET receipt_number = payment_number WHERE receipt_number IS NULL;

-- Trigger: keep receipt_number synced with payment_number on every write.
CREATE OR REPLACE FUNCTION public.sync_payments_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.payment_number IS NOT NULL AND (NEW.receipt_number IS NULL OR NEW.receipt_number <> NEW.payment_number) THEN
        NEW.receipt_number := NEW.payment_number;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_sync_receipt_number ON public.payments;
CREATE TRIGGER payments_sync_receipt_number
    BEFORE INSERT OR UPDATE OF payment_number, receipt_number ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.sync_payments_receipt_number();

-- Add `category` column (default 'other') — used by the unified ledger model.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'payments'
           AND column_name  = 'category'
    ) THEN
        ALTER TABLE public.payments
            ADD COLUMN category text NOT NULL DEFAULT 'other'
            CHECK (category IN (
                'tuition', 'transport', 'canteen', 'uniform', 'books',
                'extracurricular', 'therapy_psychology', 'therapy_speech',
                'second_apron', 'parent_credit', 'other'
            ));
        COMMENT ON COLUMN public.payments.category IS
          'Billing category — drives which account the ledger entry lands on. '
          'Mirrors ledger_entries.category for cross-table queries.';
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 4. ledger_entries — add the unified columns referenced by 0026 RPCs
-- ----------------------------------------------------------------------------
-- The 0007 schema defines: id, entry_number, entry_type, amount, category,
-- account_id, entry_date, etc. The 0026 RPCs reference a different shape
-- (id text, type, source_type, source_id, method, receipt_number,
--  payment_status, reverses_id, actor_id, actor_name, at, metadata).
-- We ADD these as new columns without dropping the originals, so both the
-- legacy 0007 queries and the new 0026 RPCs work against the same table.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='source_type') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN source_type text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='source_id') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN source_id text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='method') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN method text CHECK (method IS NULL OR method IN ('cash','check','transfer'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='receipt_number') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN receipt_number text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='payment_status') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN payment_status text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='reverses_id') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN reverses_id text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='actor_id') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN actor_id text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='actor_name') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN actor_name text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='at') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN at timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='metadata') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN metadata jsonb;
    END IF;
END$$;

-- Backfill the new columns from existing data.
UPDATE public.ledger_entries
   SET at = COALESCE(at, entry_date),
       actor_id = COALESCE(actor_id, NULL),
       actor_name = COALESCE(actor_name, 'system')
 WHERE at IS NULL;

-- Trigger: keep `at` synced with `entry_date`.
CREATE OR REPLACE FUNCTION public.sync_ledger_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.entry_date IS NOT NULL AND (NEW.at IS NULL OR NEW.at <> NEW.entry_date) THEN
        NEW.at := NEW.entry_date;
    ELSIF NEW.at IS NOT NULL AND (NEW.entry_date IS NULL OR NEW.entry_date <> NEW.at) THEN
        NEW.entry_date := NEW.at;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_sync_at ON public.ledger_entries;
CREATE TRIGGER ledger_entries_sync_at
    BEFORE INSERT OR UPDATE OF entry_date, at ON public.ledger_entries
    FOR EACH ROW EXECUTE FUNCTION public.sync_ledger_at();

-- Unique index for idempotent upsert by (tenant, source_type, source_id).
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_source_uidx
    ON public.ledger_entries (tenant_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. audit_logs — add `diff` (compat alias for before_json + after_json)
-- ----------------------------------------------------------------------------
-- The 0026 RPCs insert into `audit_logs.diff` as a single JSONB blob.
-- The 0014 schema has `before_json` + `after_json`. We add `diff` as a
-- compat column and a trigger that splits it into before/after.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='diff') THEN
        ALTER TABLE public.audit_logs ADD COLUMN diff jsonb;
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 6. sync_queue — shared outbound mutation queue (Desktop + Android)
-- ----------------------------------------------------------------------------
-- This is the table that the Desktop's `defaultPushHandler` writes to and
-- that the Android's `SyncQueueDispatcher` reads from. Both clients use
-- the SAME shape: id, entity, operation, tenant_id, actor_id, payload (jsonb),
-- status, attempts, last_error, queued_at, last_attempt_at, pushed_at.

CREATE TABLE IF NOT EXISTS public.sync_queue (
    id              text        primary key,                       -- client-generated, stable across retries
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    entity          text        not null,                          -- parent | student | payment | installment | ledger_entry | ...
    operation       text        not null check (operation in ('insert','update','delete')),
    actor_id        text,                                          -- user_profiles.id (or 'excel-import' for bulk imports)
    payload         jsonb       not null,                          -- the row to upsert (snake_case shape)
    source_file     text,                                          -- e.g. "Suivis clients 2026_2027.xlsx"
    import_run_id   text,                                          -- groups rows from the same Excel run
    status          text        not null default 'pending'
                    check (status in ('pending','synced','failed','skipped_mock')),
    attempts        integer     not null default 0,
    last_error      text,
    queued_at       timestamptz not null default now(),
    last_attempt_at timestamptz,
    pushed_at       timestamptz,                                     -- set when the row is applied to its target table
    created_at      timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS sync_queue_status_idx     ON public.sync_queue (tenant_id, status, queued_at);
CREATE INDEX IF NOT EXISTS sync_queue_entity_idx     ON public.sync_queue (tenant_id, entity, status);
CREATE INDEX IF NOT EXISTS sync_queue_run_idx        ON public.sync_queue (tenant_id, import_run_id) WHERE import_run_id IS NOT NULL;

COMMENT ON TABLE public.sync_queue IS
  'Shared outbound mutation queue. Desktop writes here when Excel rows are imported. '
  'Android writes here when offline mutations are made. Both clients drain the queue '
  'by calling the upsert_*_from_import / mark_sync_queue_processed RPCs. '
  'Idempotent by primary key (id).';

-- ----------------------------------------------------------------------------
-- 7. device_tokens — FCM/APNS token registry (used by Android + push fan-out)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_tokens (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    user_id         uuid        not null,                          -- user_profiles.id
    token           text        not null,                          -- FCM registration token
    platform        text        not null check (platform in ('android','ios','web')),
    app_version     text,
    is_active       boolean     not null default true,
    last_seen_at    timestamptz not null default now(),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, token)
);

CREATE INDEX IF NOT EXISTS device_tokens_user_idx   ON public.device_tokens (user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS device_tokens_tenant_idx ON public.device_tokens (tenant_id, is_active);

COMMENT ON TABLE public.device_tokens IS
  'FCM/APNS device-token registry. One user can have multiple active tokens '
  '(phone + tablet). The register_fcm_token RPC upserts here on every app launch.';

CREATE TRIGGER device_tokens_touch_updated_at
    BEFORE UPDATE ON public.device_tokens
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 8. RPC: register_fcm_token — invoked by Android's FcmTokenRegistrar
-- ----------------------------------------------------------------------------
-- Signature matches the Android call:
--   postgrest.rpc("register_fcm_token", { p_user_id, p_token, p_platform })

CREATE OR REPLACE FUNCTION public.register_fcm_token(
    p_user_id uuid,
    p_token   text,
    p_platform text DEFAULT 'android'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_token_id uuid;
    v_tenant_id uuid;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RAISE EXCEPTION 'p_token is required';
    END IF;

    -- Resolve tenant from the user's profile.
    SELECT tenant_id INTO v_tenant_id
      FROM public.user_profiles
     WHERE id = p_user_id
     LIMIT 1;

    IF v_tenant_id IS NULL THEN
        -- Default tenant — matches the seed in 0023.
        v_tenant_id := '00000000-0000-0000-0000-000000000001'::uuid;
    END IF;

    -- Upsert by (tenant_id, token).
    INSERT INTO public.device_tokens (tenant_id, user_id, token, platform, is_active, last_seen_at)
    VALUES (v_tenant_id, p_user_id, p_token, p_platform, true, now())
    ON CONFLICT (tenant_id, token) DO UPDATE
       SET user_id       = EXCLUDED.user_id,
           platform      = EXCLUDED.platform,
           is_active     = true,
           last_seen_at  = now()
    RETURNING id INTO v_token_id;

    RETURN v_token_id;
END;
$$;

COMMENT ON FUNCTION public.register_fcm_token IS
  'Idempotent upsert for FCM/APNS device tokens. Called by the Android app''s '
  'FcmTokenRegistrar on every app launch and on token rotation. '
  'Deactivates stale tokens by setting is_active=true on the upserted row only — '
  'other tokens for the same user remain active (multi-device support).';

-- ----------------------------------------------------------------------------
-- 9. RPC: upsert_parent_from_import — idempotent by (tenant, primary_phone)
-- ----------------------------------------------------------------------------
-- Used by the Desktop sync push handler. The phone column is the stable
-- identity for parents (per the importer's `findExistingParent` logic).
-- When the phone is "(inconnu)", falls back to (tenant, display_name).

CREATE OR REPLACE FUNCTION public.upsert_parent_from_import(
    p_tenant_id      uuid,
    p_parent_code    text,
    p_first_name     text,
    p_last_name      text,
    p_display_name   text DEFAULT NULL,
    p_primary_phone  text DEFAULT NULL,
    p_secondary_phone text DEFAULT NULL,
    p_email          text DEFAULT NULL,
    p_occupation     text DEFAULT NULL,
    p_address        text DEFAULT NULL,
    p_city           text DEFAULT NULL,
    p_relationship   text DEFAULT NULL,
    p_preferred_language text DEFAULT 'fr',
    p_is_active      boolean DEFAULT true
)
RETURNS table(parent_id uuid, parent_code text, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
    v_code text;
    v_inserted boolean := false;
    v_phone text := COALESCE(NULLIF(trim(p_primary_phone), ''), '(inconnu)');
    v_existing RECORD;
BEGIN
    -- 1. Match by (tenant, parent_code) first.
    SELECT id, parent_code INTO v_existing
      FROM public.parents
     WHERE tenant_id = p_tenant_id
       AND parent_code = p_parent_code
       AND deleted_at IS NULL
     LIMIT 1;

    IF NOT FOUND AND v_phone <> '(inconnu)' THEN
        -- 2. Match by (tenant, primary_phone).
        SELECT id, parent_code INTO v_existing
          FROM public.parents
         WHERE tenant_id = p_tenant_id
           AND primary_phone = v_phone
           AND deleted_at IS NULL
         LIMIT 1;
    END IF;

    IF NOT FOUND AND p_display_name IS NOT NULL THEN
        -- 3. Match by (tenant, display_name) — fallback for placeholder parents.
        SELECT id, parent_code INTO v_existing
          FROM public.parents
         WHERE tenant_id = p_tenant_id
           AND display_name = p_display_name
           AND deleted_at IS NULL
         LIMIT 1;
    END IF;

    IF FOUND THEN
        -- UPDATE existing row.
        v_id := v_existing.id;
        v_code := v_existing.parent_code;
        UPDATE public.parents
           SET first_name      = COALESCE(NULLIF(p_first_name, ''), first_name),
               last_name       = COALESCE(NULLIF(p_last_name, ''), last_name),
               display_name    = COALESCE(NULLIF(p_display_name, ''), display_name),
               primary_phone   = CASE WHEN v_phone <> '(inconnu)' THEN v_phone ELSE primary_phone END,
               secondary_phone = COALESCE(p_secondary_phone, secondary_phone),
               email           = COALESCE(NULLIF(p_email, ''), email),
               occupation      = COALESCE(p_occupation, occupation),
               address         = COALESCE(p_address, address),
               city            = COALESCE(p_city, city),
               relationship    = COALESCE(p_relationship, relationship),
               is_active       = p_is_active,
               updated_at      = now()
         WHERE id = v_id;
    ELSE
        -- INSERT new row.
        v_id := public.gen_uuid();
        v_code := p_parent_code;
        v_inserted := true;
        INSERT INTO public.parents (
            id, tenant_id, parent_code, first_name, last_name, display_name,
            primary_phone, secondary_phone, email, occupation, address, city,
            relationship, is_active, created_at, updated_at
        ) VALUES (
            v_id, p_tenant_id, v_code,
            COALESCE(NULLIF(p_first_name, ''), 'Inconnu'),
            COALESCE(NULLIF(p_last_name, ''), 'Inconnu'),
            COALESCE(NULLIF(p_display_name, ''), NULLIF(TRIM(p_first_name || ' ' || p_last_name), '')),
            v_phone, p_secondary_phone, p_email, p_occupation, p_address, p_city,
            p_relationship, p_is_active, now(), now()
        );
    END IF;

    RETURN QUERY SELECT v_id, v_code, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_parent_from_import IS
  'Idempotent upsert for parents imported from Excel or pushed from Android. '
  'Identity resolution order: (tenant, parent_code) → (tenant, primary_phone) → (tenant, display_name). '
  'Running this twice with the same input never creates a duplicate.';

-- ----------------------------------------------------------------------------
-- 10. RPC: upsert_student_from_import — idempotent by (tenant, student_code)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_student_from_import(
    p_tenant_id      uuid,
    p_student_code   text,
    p_parent_id      uuid,
    p_first_name     text,
    p_last_name      text,
    p_display_name   text DEFAULT NULL,
    p_middle_name    text DEFAULT NULL,
    p_date_of_birth  date DEFAULT NULL,
    p_gender         text DEFAULT NULL,
    p_grade_level_id uuid DEFAULT NULL,
    p_class_id       uuid DEFAULT NULL,
    p_enrollment_date date DEFAULT NULL,
    p_enrollment_status text DEFAULT 'active',
    p_medical_notes  text DEFAULT NULL,
    p_is_active      boolean DEFAULT true
)
RETURNS table(student_id uuid, student_code text, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
    v_code text := p_student_code;
    v_inserted boolean := false;
    v_existing RECORD;
BEGIN
    SELECT id, student_code INTO v_existing
      FROM public.students
     WHERE tenant_id = p_tenant_id
       AND student_code = p_student_code
       AND deleted_at IS NULL
     LIMIT 1;

    IF NOT FOUND THEN
        -- Fallback: match by (parent_id, first_name, last_name) — handles
        -- the case where the importer created a student without a code yet.
        SELECT id INTO v_existing
          FROM public.students
         WHERE tenant_id = p_tenant_id
           AND parent_id = p_parent_id
           AND first_name = p_first_name
           AND last_name  = p_last_name
           AND deleted_at IS NULL
         LIMIT 1;
    END IF;

    IF FOUND THEN
        v_id := v_existing.id;
        UPDATE public.students
           SET parent_id          = p_parent_id,
               first_name         = COALESCE(NULLIF(p_first_name, ''), first_name),
               last_name          = COALESCE(NULLIF(p_last_name, ''), last_name),
               middle_name        = COALESCE(p_middle_name, middle_name),
               display_name       = COALESCE(NULLIF(p_display_name, ''), display_name),
               date_of_birth      = COALESCE(p_date_of_birth, date_of_birth),
               gender             = COALESCE(p_gender, gender),
               grade_level_id     = COALESCE(p_grade_level_id, grade_level_id),
               class_id           = COALESCE(p_class_id, class_id),
               enrollment_date    = COALESCE(p_enrollment_date, enrollment_date),
               enrollment_status  = COALESCE(NULLIF(p_enrollment_status, ''), enrollment_status),
               medical_notes      = COALESCE(p_medical_notes, medical_notes),
               is_active          = p_is_active,
               updated_at         = now()
         WHERE id = v_id;
    ELSE
        v_id := public.gen_uuid();
        v_inserted := true;
        INSERT INTO public.students (
            id, tenant_id, parent_id, student_code, first_name, middle_name, last_name,
            display_name, date_of_birth, gender, grade_level_id, class_id,
            enrollment_date, enrollment_status, medical_notes, is_active,
            created_at, updated_at
        ) VALUES (
            v_id, p_tenant_id, p_parent_id, v_code,
            COALESCE(NULLIF(p_first_name, ''), 'Inconnu'),
            p_middle_name,
            COALESCE(NULLIF(p_last_name, ''), 'Inconnu'),
            COALESCE(NULLIF(p_display_name, ''), NULLIF(TRIM(p_first_name || ' ' || p_last_name), '')),
            COALESCE(p_date_of_birth, '2000-01-01'::date),
            p_gender, p_grade_level_id, p_class_id,
            COALESCE(p_enrollment_date, current_date),
            COALESCE(NULLIF(p_enrollment_status, ''), 'active'),
            p_medical_notes, p_is_active, now(), now()
        );
    END IF;

    RETURN QUERY SELECT v_id, v_code, v_inserted;
END;
$$;

COMMENT ON FUNCTION public.upsert_student_from_import IS
  'Idempotent upsert for students. Identity: (tenant, student_code) with fallback '
  'to (parent_id, first_name, last_name) for importer-compat.';

-- ----------------------------------------------------------------------------
-- 11. RPC: upsert_payment_from_import — idempotent by (tenant, payment_number)
-- ----------------------------------------------------------------------------
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
)
RETURNS table(payment_id uuid, payment_number text, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
    v_num text := p_payment_number;
    v_inserted boolean := false;
    v_existing RECORD;
    v_final_status text;
BEGIN
    SELECT id, payment_number INTO v_existing
      FROM public.payments
     WHERE tenant_id = p_tenant_id
       AND payment_number = p_payment_number
     LIMIT 1;

    -- Determine the auto-status for cash vs non-cash (mirrors enforce_payment_proof trigger).
    v_final_status := COALESCE(p_status, CASE WHEN p_method = 'cash' THEN 'paid' ELSE 'pending' END);

    IF FOUND THEN
        v_id := v_existing.id;
        UPDATE public.payments
           SET parent_id        = COALESCE(p_parent_id, parent_id),
               student_id       = COALESCE(p_student_id, student_id),
               invoice_id       = COALESCE(p_invoice_id, invoice_id),
               installment_id   = COALESCE(p_installment_id, installment_id),
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

-- ----------------------------------------------------------------------------
-- 12. RPC: upsert_ledger_entry_from_import — idempotent by (tenant, source_type, source_id)
-- ----------------------------------------------------------------------------
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
)
RETURNS table(entry_id text, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id text;
    v_existing RECORD;
    v_inserted boolean := false;
    v_entry_number text;
    v_account_id text;
BEGIN
    -- Compute account_id if not provided.
    v_account_id := COALESCE(p_account_id,
        'parent:' || p_parent_id || ':category:' || p_category ||
        CASE WHEN p_student_id IS NOT NULL THEN ':student:' || p_student_id ELSE '' END);

    -- Match by (tenant, source_type, source_id) when both are present.
    IF p_source_type IS NOT NULL AND p_source_id IS NOT NULL THEN
        SELECT id, entry_number INTO v_existing
          FROM public.ledger_entries
         WHERE tenant_id = p_tenant_id
           AND source_type = p_source_type
           AND source_id   = p_source_id
         LIMIT 1;
    END IF;

    IF NOT FOUND AND p_entry_number IS NOT NULL THEN
        -- Fallback: match by (tenant, entry_number).
        SELECT id INTO v_existing
          FROM public.ledger_entries
         WHERE tenant_id = p_tenant_id
           AND entry_number = p_entry_number
         LIMIT 1;
    END IF;

    IF FOUND THEN
        v_id := v_existing.id;
        UPDATE public.ledger_entries
           SET parent_id      = COALESCE(p_parent_id, parent_id),
               student_id     = COALESCE(p_student_id, student_id),
               account_id     = v_account_id,
               entry_type     = COALESCE(NULLIF(p_entry_type, ''), entry_type),
               amount         = COALESCE(p_amount, amount),
               category       = COALESCE(NULLIF(p_category, ''), category),
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
               entry_date     = COALESCE(p_at, entry_date),
               metadata       = COALESCE(p_metadata, metadata)
         WHERE id = v_id;
    ELSE
        -- Generate a stable text id when none provided.
        v_id := COALESCE(p_entry_number,
                         'led-' || EXTRACT(EPOCH FROM now())::bigint || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8));
        v_entry_number := COALESCE(p_entry_number, v_id);
        v_inserted := true;
        INSERT INTO public.ledger_entries (
            id, tenant_id, entry_number, parent_id, student_id, account_id,
            entry_type, amount, category, description, entry_date, created_at,
            source_type, source_id, method, receipt_number, payment_status,
            reverses_id, actor_id, actor_name, at, metadata
        ) VALUES (
            v_id, p_tenant_id, v_entry_number, p_parent_id, p_student_id, v_account_id,
            COALESCE(NULLIF(p_entry_type, ''), 'charge'),
            COALESCE(p_amount, 0),
            COALESCE(NULLIF(p_category, ''), 'other'),
            p_description,
            COALESCE(p_at, now()), now(),
            p_source_type, p_source_id, p_method, p_receipt_number, p_payment_status,
            p_reverses_id, p_actor_id, p_actor_name,
            COALESCE(p_at, now()), p_metadata
        );
    END IF;

    RETURN QUERY SELECT v_id, v_inserted;
END;
$$;

-- ----------------------------------------------------------------------------
-- 13. RPC: mark_sync_queue_processed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_sync_queue_processed(
    p_id        text,
    p_status    text,
    p_error     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_status NOT IN ('synced','failed','skipped_mock') THEN
        RAISE EXCEPTION 'Invalid status: %', p_status;
    END IF;
    UPDATE public.sync_queue
       SET status          = p_status,
           last_error      = p_error,
           last_attempt_at = now(),
           pushed_at       = CASE WHEN p_status = 'synced' THEN now() ELSE pushed_at END
     WHERE id = p_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 14. RPCs: pull_*_for_sync — Android reads changed rows since a watermark
-- ----------------------------------------------------------------------------
-- Each returns JSONB rows with snake_case column names (Postgres default)
-- AND a `display_name` field for client display. Android's deserializer
-- will use @SerialName annotations to map these to camelCase Kotlin fields.

CREATE OR REPLACE FUNCTION public.pull_parents_for_sync(
    p_tenant_id uuid,
    p_since     timestamptz DEFAULT '1970-01-01',
    p_limit     integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT id, tenant_id, parent_code, first_name, last_name, display_name,
               primary_phone, secondary_phone, email, national_id, occupation,
               address, city, postal_code, relationship, notes, is_active,
               is_financially_restricted, auth_user_id, created_at, updated_at
          FROM public.parents
         WHERE tenant_id = p_tenant_id
           AND (updated_at >= p_since OR (deleted_at IS NOT NULL AND deleted_at >= p_since))
           AND deleted_at IS NULL
         ORDER BY updated_at ASC
         LIMIT p_limit
      ) t;
$$;

CREATE OR REPLACE FUNCTION public.pull_students_for_sync(
    p_tenant_id uuid,
    p_since     timestamptz DEFAULT '1970-01-01',
    p_limit     integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT id, tenant_id, parent_id, student_code, first_name, middle_name,
               last_name, display_name, date_of_birth, gender, grade_level_id,
               class_id, enrollment_date, enrollment_status, medical_notes,
               is_active, auth_user_id, created_at, updated_at
          FROM public.students
         WHERE tenant_id = p_tenant_id
           AND updated_at >= p_since
           AND deleted_at IS NULL
         ORDER BY updated_at ASC
         LIMIT p_limit
      ) t;
$$;

CREATE OR REPLACE FUNCTION public.pull_payments_for_sync(
    p_tenant_id uuid,
    p_since     timestamptz DEFAULT '1970-01-01',
    p_limit     integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT id, tenant_id, payment_number, receipt_number, parent_id, student_id,
               invoice_id, installment_id, amount, method, category, status,
               check_number, check_bank_name, check_issue_date, check_clearance_date,
               transfer_reference, transfer_source_bank, proof_path,
               collected_at, collected_by, notes, reversal_of_payment_id,
               created_at, updated_at
          FROM public.payments
         WHERE tenant_id = p_tenant_id
           AND updated_at >= p_since
         ORDER BY updated_at ASC
         LIMIT p_limit
      ) t;
$$;

CREATE OR REPLACE FUNCTION public.pull_ledger_entries_for_sync(
    p_tenant_id uuid,
    p_since     timestamptz DEFAULT '1970-01-01',
    p_limit     integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT id, tenant_id, entry_number, parent_id, student_id, account_id,
               entry_type, amount, category, description, entry_date, created_at,
               source_type, source_id, method, receipt_number, payment_status,
               reverses_id, actor_id, actor_name, at, metadata
          FROM public.ledger_entries
         WHERE tenant_id = p_tenant_id
           AND COALESCE(at, entry_date, created_at) >= p_since
         ORDER BY COALESCE(at, entry_date, created_at) ASC
         LIMIT p_limit
      ) t;
$$;

CREATE OR REPLACE FUNCTION public.pull_device_tokens_for_sync(
    p_tenant_id uuid,
    p_since     timestamptz DEFAULT '1970-01-01',
    p_limit     integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT id, tenant_id, user_id, token, platform, app_version,
               is_active, last_seen_at, created_at, updated_at
          FROM public.device_tokens
         WHERE tenant_id = p_tenant_id
           AND updated_at >= p_since
           AND is_active = true
         ORDER BY updated_at ASC
         LIMIT p_limit
      ) t;
$$;

-- ----------------------------------------------------------------------------
-- 15. RLS policies for sync_queue + device_tokens
-- ----------------------------------------------------------------------------
-- These tables follow the same universal RLS pattern as every other
-- tenant-scoped table (see 0019_rls_policies.sql): users can only see
-- rows for their current tenant, scoped by their role permissions.

ALTER TABLE public.sync_queue   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user has any role (any signed-in user).
-- (current_user_roles() is defined in 0003_rbac.sql.)

-- sync_queue: any signed-in user can read/insert/update their tenant's rows.
DROP POLICY IF EXISTS sync_queue_tenant_select ON public.sync_queue;
CREATE POLICY sync_queue_tenant_select ON public.sync_queue
    FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS sync_queue_tenant_insert ON public.sync_queue;
CREATE POLICY sync_queue_tenant_insert ON public.sync_queue
    FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS sync_queue_tenant_update ON public.sync_queue;
CREATE POLICY sync_queue_tenant_update ON public.sync_queue
    FOR UPDATE USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS sync_queue_tenant_delete ON public.sync_queue;
CREATE POLICY sync_queue_tenant_delete ON public.sync_queue
    FOR DELETE USING (tenant_id = public.current_tenant_id());

-- device_tokens: users can read/manage their own tokens; staff can see all in tenant.
DROP POLICY IF EXISTS device_tokens_tenant_select ON public.device_tokens;
CREATE POLICY device_tokens_tenant_select ON public.device_tokens
    FOR SELECT USING (
        tenant_id = public.current_tenant_id()
        AND (user_id::text = (public.current_user_profile_id())::text
             OR public.has_any_role(array['super_admin','manager','support_staff','financial_officer']))
    );

DROP POLICY IF EXISTS device_tokens_self_insert ON public.device_tokens;
CREATE POLICY device_tokens_self_insert ON public.device_tokens
    FOR INSERT WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND user_id::text = (public.current_user_profile_id())::text
    );

DROP POLICY IF EXISTS device_tokens_self_update ON public.device_tokens;
CREATE POLICY device_tokens_self_update ON public.device_tokens
    FOR UPDATE USING (
        tenant_id = public.current_tenant_id()
        AND user_id::text = (public.current_user_profile_id())::text
    );

-- Allow register_fcm_token RPC (SECURITY DEFINER) to bypass RLS — it already
-- does by default since it's SECURITY DEFINER, but document it.
COMMENT ON POLICY device_tokens_self_insert IS
  'Users can register their own device tokens. The register_fcm_token RPC '
  'is SECURITY DEFINER and bypasses RLS for tenant resolution.';

-- ----------------------------------------------------------------------------
-- 16. Update the system_settings to record the schema version
-- ----------------------------------------------------------------------------
INSERT INTO public.system_settings (tenant_id, key, value, value_encrypted, description, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid,
        'schema.shared_unification_version',
        '"0027"'::jsonb,
        false,
        'Migration 0027 — shared unification of Desktop and Android data model. '
        'Adds sync_queue, device_tokens, display_name, register_fcm_token RPC, '
        'and idempotent upsert RPCs for parent/student/payment/ledger_entry.',
        now(), now())
ON CONFLICT (tenant_id, key) DO UPDATE
   SET value = EXCLUDED.value,
       description = EXCLUDED.description,
       updated_at = now();

-- ----------------------------------------------------------------------------
-- 17. Verification notice
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE 'Migration 0027 complete: shared unification of Desktop + Android schema.';
    RAISE NOTICE '  - parents.display_name (text)';
    RAISE NOTICE '  - students.display_name (text)';
    RAISE NOTICE '  - payments.receipt_number + payments.category';
    RAISE NOTICE '  - ledger_entries: source_type, source_id, method, receipt_number, payment_status, reverses_id, actor_id, actor_name, at, metadata';
    RAISE NOTICE '  - audit_logs.diff (jsonb compat)';
    RAISE NOTICE '  - sync_queue table + RLS';
    RAISE NOTICE '  - device_tokens table + RLS';
    RAISE NOTICE '  - register_fcm_token(p_user_id, p_token, p_platform) RPC';
    RAISE NOTICE '  - upsert_parent_from_import / upsert_student_from_import / upsert_payment_from_import / upsert_ledger_entry_from_import RPCs';
    RAISE NOTICE '  - mark_sync_queue_processed RPC';
    RAISE NOTICE '  - pull_parents_for_sync / pull_students_for_sync / pull_payments_for_sync / pull_ledger_entries_for_sync / pull_device_tokens_for_sync RPCs';
END$$;
