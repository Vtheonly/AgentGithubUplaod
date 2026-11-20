-- ============================================================================
-- 0143: The composite (sort_key, id) keyset on the four pull_*_for_sync RPCs
--       (SYNC-304, T-497, 148th session 2026-10-05)
-- ============================================================================
--
-- THE DEFECT (the 148th session's opening live pins, read-only, via the
-- Management-API SQL endpoint):
--
--   pull_parents_for_sync / pull_students_for_sync  (0028):
--     `updated_at > p_since` EXCLUSIVE, `ORDER BY updated_at ASC`, NO id
--     tie-break. A tie group straddling a page boundary loses every tied
--     row after the boundary FOREVER (live students: 4 tie pairs = 8 rows
--     capable of exactly this), and Postgres guarantees no stable order
--     WITHIN a tie group, so successive pages are not even guaranteed
--     disjoint.
--
--   pull_payments_for_sync  (0027):
--     `updated_at >= p_since` INCLUSIVE over a cursor that is not unique.
--     The live table's 2 198 rows ALL share one frozen bulk-backfill
--     timestamp — the day any uniform group exceeds the 5 000-row page,
--     the Android drain's uniform-page tie-guard stops it PARTIAL forever.
--
--   pull_ledger_entries_for_sync  (0037):
--     Orders and filters on COALESCE(at, entry_date, created_at) — the
--     BUSINESS date, wrong for incremental sync (a recently-updated row
--     with an old business date is invisible to every incremental pull)
--     and massively tie-prone (live: 1 111 tie groups covering 3 321 of
--     3 342 rows) — because the table NEVER HAD an updated_at column at
--     all (the live information_schema pin). The Android drain's cursor
--     (LedgerEntryDto.updated_at) is therefore permanently NULL: a silent
--     single-page truncation the moment the ledger exceeds 5 000 rows.
--     This migration gives ledger_entries the change-time column the other
--     three tables already carry (DEFAULT now() + touch_updated_at()).
--
-- THE FIX: every RPC gains `p_after_id uuid DEFAULT NULL` and the composite
-- branch — the complete keyset (sort_key, id) > (p_since, p_after_id) — with
-- the deterministic `ORDER BY sort_key ASC, id ASC`. A cursor must be a
-- TOTAL ORDER over the drained set; a non-unique column alone can never be
-- one, and no client-side loop can page correctly over it (inclusive
-- re-fetches forever, exclusive skips).
--
-- BACKWARD COMPATIBILITY (the installed T-495 APK calls all four with the
-- 3-arg named shape { p_tenant_id, p_since, p_limit }):
--   * parents/students — the NULL branch keeps EXACTLY the current
--     exclusive semantics:  p_since IS NULL OR updated_at > p_since.
--   * payments — the NULL branch keeps EXACTLY the current inclusive
--     semantics:  updated_at >= p_since  (the formula
--     `updated_at > p_since OR (updated_at = p_since AND (p_after_id IS
--     NULL OR id > p_after_id))` degenerates to `>=` when p_after_id is
--     NULL).
--   * ledger — DELIBERATELY re-keyed from the business date to updated_at
--     (the change-time semantics every incremental sync needs). Full pulls
--     (p_since = 1970) return the same rows; incremental pulls become
--     CORRECT (they previously missed recently-updated old-dated rows);
--     and the column is now RETURNED, so the installed APK's always-NULL
--     cursor starts working — its drain can paginate past one page for the
--     first time. A strict improvement; no row the old callers received
--     is lost.
--
-- SIGNATURE RULE (AGENTS.md §15.32): adding a parameter changes the
-- signature, so each old overload is DROPPED in this same migration before
-- the CREATE — a CREATE OR REPLACE across signatures would silently leave
-- TWO overloads and break every named-notation call with 42725.
--
-- ACL RULE (AGENTS.md §15.33 discipline): DROP+CREATE resets proacl; the
-- pinned live shape {=X/postgres, postgres=X/postgres, anon=X/postgres,
-- authenticated=X/postgres, service_role=X/postgres} is re-granted
-- explicitly below, per function.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. pull_parents_for_sync — row-typed (RETURNS TABLE), the 0028 shape
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pull_parents_for_sync(uuid, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.pull_parents_for_sync(
  p_tenant_id uuid,
  p_since     timestamptz DEFAULT NULL,
  p_after_id  uuid DEFAULT NULL,
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
    AND (
      p_since IS NULL
      OR p.updated_at > p_since
      OR (p_after_id IS NOT NULL AND p.updated_at = p_since AND p.id > p_after_id)
    )
  ORDER BY p.updated_at ASC, p.id ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pull_parents_for_sync(uuid, timestamptz, uuid, integer)
  TO PUBLIC, postgres, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. pull_students_for_sync — row-typed (RETURNS TABLE), the 0028 shape
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pull_students_for_sync(uuid, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.pull_students_for_sync(
  p_tenant_id uuid,
  p_since     timestamptz DEFAULT NULL,
  p_after_id  uuid DEFAULT NULL,
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
    AND (
      p_since IS NULL
      OR s.updated_at > p_since
      OR (p_after_id IS NOT NULL AND s.updated_at = p_since AND s.id > p_after_id)
    )
  ORDER BY s.updated_at ASC, s.id ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pull_students_for_sync(uuid, timestamptz, uuid, integer)
  TO PUBLIC, postgres, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. pull_payments_for_sync — jsonb (single payload, not gateway-sliced),
--    the 0027 shape. The composite formula
--      updated_at > p_since
--      OR (updated_at = p_since AND (p_after_id IS NULL OR id > p_after_id))
--    degenerates EXACTLY to the old inclusive `>=` when p_after_id is NULL
--    and to the complete keyset when it is present.
--    Hardening: SET search_path = public added (0027 lacked it; all
--    references were already schema-qualified, so this is behavior-neutral
--    but closes the SECURITY DEFINER search_path hole — AGENTS.md §15.33).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pull_payments_for_sync(uuid, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.pull_payments_for_sync(
    p_tenant_id uuid,
    p_since     timestamptz DEFAULT '1970-01-01',
    p_after_id  uuid DEFAULT NULL,
    p_limit     integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
           AND (
             updated_at > p_since
             OR (updated_at = p_since AND (p_after_id IS NULL OR id > p_after_id))
           )
         ORDER BY updated_at ASC, id ASC
         LIMIT p_limit
      ) t;
$$;

GRANT EXECUTE ON FUNCTION public.pull_payments_for_sync(uuid, timestamptz, uuid, integer)
  TO PUBLIC, postgres, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. ledger_entries — the change-time cursor column (SYNC-304): the table
--    NEVER HAD updated_at (the live information_schema pin — that is WHY
--    0037 keyed the RPC on the business date COALESCE(at, entry_date,
--    created_at) in the first place). The column follows the exact pattern
--    the other three tables already use: DEFAULT now() on INSERT (the
--    column default) + the shared touch_updated_at() BEFORE UPDATE
--    trigger (payments/parents/students all carry it). The 3 342 existing
--    rows backfill to the migration instant (Postgres 11+ fast default,
--    no rewrite) — one uniform tie group the composite keyset pages
--    through by id (and 3 342 < the installed APK's 5 000-row page, so
--    the old client cannot stick on it either).
-- ----------------------------------------------------------------------------
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS ledger_entries_touch_updated_at ON public.ledger_entries;
CREATE TRIGGER ledger_entries_touch_updated_at
  BEFORE UPDATE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5. pull_ledger_entries_for_sync — jsonb, the 0037 shape (the reverses_id
--    resolution CASE preserved verbatim). TWO changes beyond the keyset:
--    (a) the sort/filter key moves from COALESCE(at, entry_date, created_at)
--        (the business date) to updated_at (the change time) — the sync
--        semantics; (b) le.updated_at is now RETURNED so the Android drain's
--        cursor is not permanently NULL.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pull_ledger_entries_for_sync(uuid, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.pull_ledger_entries_for_sync(
    p_tenant_id uuid,
    p_since     timestamptz DEFAULT '1970-01-01',
    p_after_id  uuid DEFAULT NULL,
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
               -- 0037 (preserved): resolve the reversal pointer into the server UUID space
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
               le.actor_id, le.actor_name, le.at, le.metadata,
               -- 0143 (SYNC-304): the change-time cursor column — the Android
               -- drain advances on it (previously never returned: the client
               -- cursor was NULL on every row).
               le.updated_at
          FROM public.ledger_entries le
         WHERE le.tenant_id = p_tenant_id
           AND (
             le.updated_at > p_since
             OR (le.updated_at = p_since AND (p_after_id IS NULL OR le.id > p_after_id))
           )
         ORDER BY le.updated_at ASC, le.id ASC
         LIMIT p_limit
      ) t;
$$;

GRANT EXECUTE ON FUNCTION public.pull_ledger_entries_for_sync(uuid, timestamptz, uuid, integer)
  TO PUBLIC, postgres, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Registration (T-091/MIG-TOKENS pattern).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0143', '{0143_composite_keyset_sync_rpcs.sql}', 'composite_keyset_sync_rpcs')
on conflict (version) do nothing;
