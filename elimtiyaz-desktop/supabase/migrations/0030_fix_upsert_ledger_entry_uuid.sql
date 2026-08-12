-- ============================================================================
-- EL-IMTIYAZ EDUCATIONAL PLATFORM
-- Migration: 0030_fix_upsert_ledger_entry_uuid.sql
-- Module: Shared schema (ledger sync fix)
--
-- WHY THIS EXISTS:
--   Migration 0027 was applied to the remote database BEFORE the UUID fix
--   was added. The remote still has the BROKEN version of
--   `upsert_ledger_entry_from_import` that declares `v_id text` and tries
--   to INSERT a text value into the `uuid` `ledger_entries.id` column,
--   raising:
--     ERROR: column "id" is of type uuid but expression is of type text
--
--   Because 0027 is already in the remote migration history, `supabase db
--   push` will NOT re-apply it. This migration re-applies the FIXED
--   function (idempotent DROP + CREATE) so the remote matches the local
--   fixed version.
--
--   Re-running this migration is a safe no-op (DROP + CREATE).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RPC: upsert_ledger_entry_from_import — idempotent by (tenant, source_type, source_id)
-- ----------------------------------------------------------------------------
-- BUG FIX (iteration 22): The original function declared `v_id text` and
-- tried to INSERT it as the `id` column. But `ledger_entries.id` is `uuid`
-- (declared in migration 0007 line 226 as `uuid primary key default
-- public.gen_uuid()`). Inserting a text value like 'led-1234567890-abcd1234'
-- into a uuid column raises:
--   ERROR: column "id" is of type uuid but expression is of type text
--
-- The fix mirrors the bootstrap migration (9000):
--   1. Declare `v_id uuid`.
--   2. On INSERT, omit `id` from the column list — let the table's DEFAULT
--      `gen_uuid()` populate it, then capture the generated UUID via
--      `RETURNING id INTO v_id`.
--   3. Change the return type from `table(entry_id text, was_inserted boolean)`
--      to `table(entry_id uuid, was_inserted boolean)`.
--
-- Because PostgreSQL's `CREATE OR REPLACE FUNCTION` cannot change the return
-- type, we DROP the old function first. The DROP is by parameter signature
-- (which is unchanged), so it removes any prior version — whether the buggy
-- `RETURNS table(text, boolean)` version or the fixed `RETURNS table(uuid,
-- boolean)` version — and the subsequent CREATE installs the fixed version.
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
)
RETURNS table(entry_id uuid, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
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
        SELECT id, entry_number INTO v_existing
          FROM public.ledger_entries
         WHERE tenant_id = p_tenant_id
           AND entry_number = p_entry_number
         LIMIT 1;
    END IF;

    -- Normalize the entry_number — needed both for INSERT and for fallback
    -- matching above. Use the existing row's entry_number when updating
    -- (preserves the original ID even if the caller omitted it on re-import).
    v_entry_number := COALESCE(
        v_existing.entry_number,
        NULLIF(TRIM(p_entry_number), ''),
        'LED-' || EXTRACT(EPOCH FROM now())::bigint || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6))
    );

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
        -- Insert without specifying `id` — the table's DEFAULT
        -- `public.gen_uuid()` populates the UUID primary key. Capture the
        -- generated id via RETURNING so we can return it to the caller.
        -- This is the fix for the "column id is of type uuid" error.
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