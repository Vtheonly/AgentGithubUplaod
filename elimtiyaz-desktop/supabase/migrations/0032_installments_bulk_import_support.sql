-- ============================================================================
-- 0032_installments_bulk_import_support.sql
-- ============================================================================
-- BULK IMPORT FIX: This migration adapts the `installments` table so the
-- Excel bulk importer can write tranche records directly without requiring
-- a `service_enrollments` row (which the importer doesn't manage) and
-- without being blocked by the original 4-value status check constraint.
--
-- The original schema (migration 0007) required:
--   - `service_enrollment_id NOT NULL` -> blocks bulk import because the
--     importer doesn't create service_enrollments records.
--   - `status IN ('unpaid', 'partial', 'paid', 'overdue')` -> blocks the
--     `pending_clearance` status added by migration 0026.
--
-- This migration:
--   1. Makes `service_enrollment_id` nullable.
--   2. Adds a `label` column so the importer can store the human-readable
--      tranche label (e.g. "Tranche 1 - Septembre").
--   3. Adds `source_type` and `source_id` columns for idempotent re-imports.
--   4. Replaces the status check constraint with one that includes all
--      statuses from migration 0026.
--   5. Adds a unique index on (tenant, parent, student, category, tranche_number)
--      so the importer's identity match is enforced at the DB level.
--
-- All statements are IDEMPOTENT -- re-running the migration is a safe no-op.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. installments -- make service_enrollment_id nullable
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'installments'
       AND column_name  = 'service_enrollment_id'
       AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.installments
        ALTER COLUMN service_enrollment_id DROP NOT NULL;
  END IF;
END$$;

COMMENT ON COLUMN public.installments.service_enrollment_id IS
  'Optional FK to service_enrollments. NULL for bulk-imported tranches that '
  'are not linked to a specific service enrollment (e.g. Excel import rows).';

-- ----------------------------------------------------------------------------
-- 2. installments -- add label column (human-readable tranche label)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'installments'
       AND column_name  = 'label'
  ) THEN
    ALTER TABLE public.installments ADD COLUMN label text;
    COMMENT ON COLUMN public.installments.label IS
      'Human-readable tranche label (e.g. "Tranche 1 - Septembre"). '
      'When null, the UI falls back to "Tranche {tranche_number}".';
  END IF;
END$$;

-- Backfill label for existing rows.
UPDATE public.installments
   SET label = 'Tranche ' || tranche_number::text
 WHERE label IS NULL;

-- ----------------------------------------------------------------------------
-- 2b. installments -- add category column (denormalized for bulk import)
-- ----------------------------------------------------------------------------
-- The original schema links installments to service_enrollments which carries
-- the service_kind. The bulk importer doesn't manage service_enrollments,
-- so we add a denormalized `category` column to installments directly.
-- This mirrors `ledger_entries.category` and `payments.category`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'installments'
       AND column_name  = 'category'
  ) THEN
    ALTER TABLE public.installments ADD COLUMN category text
      NOT NULL DEFAULT 'tuition'
      CHECK (category IN (
        'tuition', 'transport', 'canteen', 'uniform', 'books',
        'extracurricular', 'therapy_psychology', 'therapy_speech',
        'second_apron', 'parent_credit', 'other'
      ));
    COMMENT ON COLUMN public.installments.category IS
      'Billing category -- drives which account the ledger entry lands on. '
      'Mirrors ledger_entries.category and payments.category. Denormalized '
      'from service_enrollments.service_kind so bulk-imported rows (which '
      'do not have a service_enrollment) can still carry the category.';
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 3. installments -- add source_type + source_id for idempotent bulk imports
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'installments'
       AND column_name  = 'source_type'
  ) THEN
    ALTER TABLE public.installments ADD COLUMN source_type text;
    COMMENT ON COLUMN public.installments.source_type IS
      'Provenance of the row. "bulk_import" = Excel importer; '
      '"manual_entry" = interactive UI; NULL = legacy/seed data.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'installments'
       AND column_name  = 'source_id'
  ) THEN
    ALTER TABLE public.installments ADD COLUMN source_id text;
    COMMENT ON COLUMN public.installments.source_id IS
      'Stable id within the source. For bulk_import, this is '
      '"{studentId}:{field}" (e.g. "abc-123:FI") so re-imports hit the '
      'same row.';
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 4. installments -- replace status check constraint (add pending_clearance)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_constraint_exists boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'installments_status_check'
           AND conrelid = 'public.installments'::regclass
    ) INTO v_constraint_exists;

    IF v_constraint_exists THEN
        ALTER TABLE public.installments DROP CONSTRAINT installments_status_check;
    END IF;

    ALTER TABLE public.installments
        ADD CONSTRAINT installments_status_check
        CHECK (status IN (
            'unpaid', 'partial', 'paid', 'overdue', 'pending_clearance'
        ));
END$$;

-- ----------------------------------------------------------------------------
-- 5. installments -- unique identity index for bulk importer idempotency
-- ----------------------------------------------------------------------------
-- The Excel importer matches existing rows by
-- (tenant_id, parent_id, student_id, category, tranche_number).
-- This index enforces that identity at the DB level so re-imports can
-- never create duplicates even under concurrent imports.
-- Partial index: only enforced when ALL identity columns are non-null.
CREATE UNIQUE INDEX IF NOT EXISTS installments_bulk_import_identity_idx
    ON public.installments (tenant_id, parent_id, student_id, category, tranche_number)
    WHERE parent_id IS NOT NULL
      AND student_id IS NOT NULL
      AND category IS NOT NULL
      AND tranche_number IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. installments -- drop the auto-status trigger (it conflicts with bulk import)
-- ----------------------------------------------------------------------------
-- The original `installments_update_status` trigger (migration 0007)
-- auto-derives status from amount_paid vs amount_due. But the bulk importer
-- needs to set status explicitly (e.g. "paid" for a fully-paid tranche, even
-- if amount_paid < amount_due due to a discount applied elsewhere). The
-- trigger would override the importer's status, breaking the import.
-- Drop it -- the importer and the interactive UI both compute status
-- explicitly now.
DROP TRIGGER IF EXISTS installments_update_status ON public.installments;

-- ----------------------------------------------------------------------------
-- 7. bootstrap summary
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE 'Migration 0032 complete:';
    RAISE NOTICE '  - installments.service_enrollment_id is now nullable';
    RAISE NOTICE '  - installments.label column added';
    RAISE NOTICE '  - installments.source_type + source_id columns added';
    RAISE NOTICE '  - installments.status check constraint updated (pending_clearance allowed)';
    RAISE NOTICE '  - installments_bulk_import_identity_idx unique index created';
    RAISE NOTICE '  - installments_update_status trigger dropped (status now explicit)';
END$$;
