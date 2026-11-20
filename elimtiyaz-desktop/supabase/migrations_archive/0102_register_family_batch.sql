-- ============================================================================
-- 0102_register_family_batch.sql
-- T-398 / PERF-502 (82nd session, 2026-09-21): the ONE-round-trip
-- registration write. The owner's follow-up report ("is there no way to make
-- it faster????") after T-397: the interactive registration still issued
-- ~11 sequential HTTP round-trips (identity upserts + full-row fetches +
-- the 5-6 sequential pricing reads + the 2 bulk writes), live-measured
-- 3,189 ms from the sandbox at ~264 ms median RTT — a ~5–10 s floor on the
-- owner's Algeria→eu-west-1 route. This migration collapses the WHOLE
-- composite into ONE SECURITY DEFINER transaction = ONE network round-trip.
--
-- DESIGN (the no-parallel-implementation rule, AGENTS.md §6/§9):
--   - The identity legs REUSE the canonical idempotent upserts verbatim —
--     `upsert_parent_from_import` + `upsert_student_from_import` are CALLED
--     inside the transaction (the 0031/0037 bodies, their identity/fallback
--     chains, their activation-code write). Zero reimplementation.
--   - The billing legs adopt the EXACT wire semantics the live-proven bulk
--     paths use (IMPORT-107 `bulkAppend` + the IMPORT-110-fixed
--     `bulkImportInstallments`): plain INSERT ... ON CONFLICT DO NOTHING
--     (no arbiter — honors BOTH the partial `ledger_entries_source_uidx`
--     and the partial `installments_bulk_import_identity_idx`).
--   - ALL money amounts remain CLIENT-derived (the canonical TS calc engine
--     — evaluateAllSystemDiscounts/splitNetTuitionByOfficialSchedule —
--     stays the single derivation; NO financial logic lives in SQL).
--     The server only fills what the client cannot know before the single
--     call: the server-generated uuids (parent_id/student_id) and the
--     `deriveAccountId` string (the exact `parent:{p}:category:{c}`
--     [+ `:student:{s}`] format of domain/calc/ledger/account-id.ts —
--     pinned by the t-398 live probe).
--   - Billing rows reference students by 0-based `student_ref` (the index
--     of the student in p_students); the RPC resolves them to the uuids
--     the upserts just produced. Out-of-range refs RAISE (a client bug
--     must never write a dangling row).
--   - ATOMICITY (the registered upgrade of the DATA-019 scope decision):
--     ONE transaction — any leg failing rolls back EVERYTHING. No more
--     half-registered families ("family created, billing missing"). The
--     mock repository has had exactly these semantics since birth (its
--     snapshot rollback); this aligns the Supabase path with it.
--   - IDEMPOTENT END-TO-END (the rpcWithIdempotentRetry contract):
--     deterministic parent/student codes converge on re-run (UPDATE),
--     ledger entries conflict on (tenant, entry_number) OR the partial
--     (tenant, source_type, source_id) uidx, installments on the partial
--     identity index — a retry can never duplicate anything.
--
-- RETURNS the FULL parent + student rows (to_jsonb) so the client needs
-- ZERO follow-up fetches — the two full-row SELECTs of the T-397 shape are
-- gone too. Final round-trip count for an N-student registration: 1.
--
-- Grants (§15.34 — keep the NARROW side): EXECUTE for authenticated +
-- service_role ONLY. Family registration is a staff action; anon gets
-- nothing (unlike the 0096 sync RPC family, which the Android app's
-- unauthenticated bootstrap reads).
--
-- Registration: the T-091/MIG-TOKENS embedded block (atomic with the DDL
-- for the Management-API live application; idempotent via ON CONFLICT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The composite RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_family_batch(
  p_tenant_id       uuid,
  p_parent          jsonb,
  p_students        jsonb,
  p_ledger_entries  jsonb DEFAULT '[]'::jsonb,
  p_installments    jsonb DEFAULT '[]'::jsonb
) RETURNS TABLE (
  out_parent                jsonb,
  out_students              jsonb,
  out_ledger_written        integer,
  out_installments_written  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $register$
DECLARE
  v_parent_id        uuid;
  v_parent_code      text;
  v_parent_inserted  boolean;
  v_student_ids      uuid[] := '{}';
  v_sid              uuid;
  v_s                record;
  v_e                record;
  v_i                record;
  v_student_count    integer;
  v_ledger_written   integer := 0;
  v_inst_written     integer := 0;
  v_parent_json      jsonb;
  v_students_json    jsonb;
  v_ref              integer;
BEGIN
  -- ------------------------------------------------------------------
  -- 0. Payload guards (fail fast, before any mutation).
  -- ------------------------------------------------------------------
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'register_family_batch: p_tenant_id requis'
      USING HINT = 'The client resolves the tenant from the session fixture.';
  END IF;
  IF p_parent IS NULL
     OR NULLIF(TRIM(COALESCE(p_parent->>'parent_code', '')), '') IS NULL THEN
    RAISE EXCEPTION 'register_family_batch: p_parent.parent_code requis'
      USING HINT = 'batchRegister computes the deterministic parent code before the call (re-runs must converge, never duplicate).';
  END IF;
  IF p_students IS NULL THEN
    p_students := '[]'::jsonb;
  END IF;
  v_student_count := jsonb_array_length(p_students);
  IF v_student_count = 0 THEN
    RAISE EXCEPTION 'register_family_batch: au moins un élève requis'
      USING HINT = 'The wizard validates this client-side; this is the server-side mirror.';
  END IF;

  -- ------------------------------------------------------------------
  -- 1. The parent — the CANONICAL idempotent upsert (0031/0037 body,
  --    identity chain + activation code), CALLED, not reimplemented.
  -- ------------------------------------------------------------------
  SELECT u.out_parent_id, u.out_parent_code, u.out_was_inserted
    INTO v_parent_id, v_parent_code, v_parent_inserted
    FROM public.upsert_parent_from_import(
           p_tenant_id,
           p_parent->>'parent_code',
           p_parent->>'first_name',
           p_parent->>'last_name',
           p_parent->>'display_name',
           p_parent->>'primary_phone',
           p_parent->>'secondary_phone',
           p_parent->>'email',
           p_parent->>'occupation',
           p_parent->>'address',
           p_parent->>'relationship',
           p_parent->>'preferred_language',
           COALESCE((p_parent->>'is_active')::boolean, true),
           p_parent->>'transport_destination',
           p_parent->>'city_tier',
           p_parent->>'activation_code'
         ) u;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'register_family_batch: upsert_parent_from_import n''a retourné aucun id (%)', v_parent_code;
  END IF;

  -- ------------------------------------------------------------------
  -- 2. The students — the CANONICAL idempotent upsert per student, in
  --    payload order (the 0-based student_ref contract the billing rows
  --    rely on). §15.37: every date/uuid field blank→null at the seam.
  -- ------------------------------------------------------------------
  FOR v_s IN
    SELECT *
      FROM jsonb_to_recordset(p_students) AS s(
            student_code       text,
            first_name         text,
            last_name          text,
            display_name       text,
            middle_name        text,
            date_of_birth      text,
            gender             text,
            grade_level_id     uuid,
            class_id           uuid,
            enrollment_date    text,
            enrollment_status  text,
            medical_notes      text,
            is_active          boolean,
            grade_level_code   text,
            transport_tier     text,
            payment_plan       text
          )
  LOOP
    SELECT u.out_student_id
      INTO v_sid
      FROM public.upsert_student_from_import(
             p_tenant_id,
             v_s.student_code,
             v_parent_id::text,   -- 0037 ref-tolerant param: a server UUID text resolves directly
             v_s.first_name,
             v_s.last_name,
             v_s.display_name,
             v_s.middle_name,
             NULLIF(TRIM(COALESCE(v_s.date_of_birth, '')), '')::date,
             v_s.gender,
             v_s.grade_level_id,
             v_s.class_id,
             NULLIF(TRIM(COALESCE(v_s.enrollment_date, '')), '')::date,
             v_s.enrollment_status,
             v_s.medical_notes,
             COALESCE(v_s.is_active, true),
             v_s.grade_level_code,
             v_s.transport_tier,
             v_s.payment_plan
           ) u;

    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'register_family_batch: upsert_student_from_import n''a retourné aucun id pour « % % » (%)',
        v_s.first_name, v_s.last_name, v_s.student_code;
    END IF;
    v_student_ids := array_append(v_student_ids, v_sid);
  END LOOP;

  -- ------------------------------------------------------------------
  -- 3. The ledger charges — the IMPORT-107 wire semantics: ONE plain
  --    INSERT ... ON CONFLICT DO NOTHING (no arbiter: honors BOTH the
  --    (tenant, entry_number) key and the PARTIAL source_uidx). The
  --    account_id is derived HERE with the exact deriveAccountId format
  --    (domain/calc/ledger/account-id.ts) because the client cannot know
  --    the uuids before this call.
  -- ------------------------------------------------------------------
  IF p_ledger_entries IS NOT NULL AND jsonb_array_length(p_ledger_entries) > 0 THEN
    -- Ref guard FIRST: a dangling student_ref is a client bug — fail loudly.
    FOR v_ref IN
      SELECT (e->>'student_ref')::integer
        FROM jsonb_array_elements(p_ledger_entries) e
       WHERE e->>'student_ref' IS NOT NULL
    LOOP
      IF v_ref IS NULL OR v_ref < 0 OR v_ref >= v_student_count THEN
        RAISE EXCEPTION 'register_family_batch: student_ref % hors limites (0..%) dans p_ledger_entries', v_ref, v_student_count - 1;
      END IF;
    END LOOP;

    INSERT INTO public.ledger_entries (
      tenant_id, entry_number, parent_id, student_id, account_id,
      entry_type, amount, category, description, entry_date,
      source_type, source_id, method, receipt_number, payment_status,
      reverses_id, actor_id, actor_name, at, metadata
    )
    SELECT
      p_tenant_id,
      r.entry_number,
      v_parent_id,
      CASE WHEN r.student_ref IS NULL THEN NULL
           ELSE v_student_ids[r.student_ref + 1] END,
      -- deriveAccountId (account-id.ts) — the EXACT string format:
      'parent:' || v_parent_id || ':category:' || r.category ||
        CASE WHEN r.student_ref IS NULL THEN ''
             ELSE ':student:' || v_student_ids[r.student_ref + 1] END,
      r.entry_type,
      r.amount,
      r.category,
      r.description,
      COALESCE(NULLIF(TRIM(COALESCE(r.entry_date, '')), '')::timestamptz, now()),
      r.source_type,
      r.source_id,
      r.method,
      r.receipt_number,
      r.payment_status,
      r.reverses_id,
      r.actor_id,
      r.actor_name,
      NULLIF(TRIM(COALESCE(r.at, '')), '')::timestamptz,
      r.metadata
      FROM jsonb_to_recordset(p_ledger_entries) AS r(
            student_ref     integer,
            entry_number    text,
            entry_type      text,
            amount          numeric,
            category        text,
            description     text,
            entry_date      text,
            source_type     text,
            source_id       text,
            method          text,
            receipt_number  text,
            payment_status  text,
            reverses_id     text,
            actor_id        text,
            actor_name      text,
            at              text,
            metadata        jsonb
          )
      ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_ledger_written = ROW_COUNT;
  END IF;

  -- ------------------------------------------------------------------
  -- 4. The installment tranches — the IMPORT-110 wire semantics: ONE
  --    plain INSERT ... ON CONFLICT DO NOTHING (no arbiter: honors the
  --    PARTIAL 0032 identity index). installments.student_id is NOT NULL
  --    — every tranche row MUST carry a valid student_ref.
  -- ------------------------------------------------------------------
  IF p_installments IS NOT NULL AND jsonb_array_length(p_installments) > 0 THEN
    FOR v_ref IN
      SELECT (i->>'student_ref')::integer
        FROM jsonb_array_elements(p_installments) i
    LOOP
      IF v_ref IS NULL OR v_ref < 0 OR v_ref >= v_student_count THEN
        RAISE EXCEPTION 'register_family_batch: student_ref % hors limites (0..%) dans p_installments', v_ref, v_student_count - 1;
      END IF;
    END LOOP;

    INSERT INTO public.installments (
      tenant_id, parent_id, student_id, category, tranche_number,
      label, amount_due, amount_paid, amount_pending, due_date,
      paid_date, status, academic_cycle, payment_plan,
      is_custom_schedule, custom_schedule_note, source_type, source_id,
      updated_at
    )
    SELECT
      p_tenant_id,
      v_parent_id,
      v_student_ids[r.student_ref + 1],
      r.category,
      r.tranche_number,
      r.label,
      r.amount_due,
      COALESCE(r.amount_paid, 0),
      COALESCE(r.amount_pending, 0),
      NULLIF(TRIM(COALESCE(r.due_date, '')), '')::date,
      NULLIF(TRIM(COALESCE(r.paid_date, '')), '')::date,
      COALESCE(NULLIF(TRIM(COALESCE(r.status, '')), ''), 'unpaid'),
      NULLIF(TRIM(COALESCE(r.academic_cycle, '')), ''),
      COALESCE(NULLIF(TRIM(COALESCE(r.payment_plan, '')), ''), 'tranches'),
      COALESCE(r.is_custom_schedule, false),
      r.custom_schedule_note,
      r.source_type,
      r.source_id,
      now()
      FROM jsonb_to_recordset(p_installments) AS r(
            student_ref          integer,
            category             text,
            tranche_number       integer,
            label                text,
            amount_due           numeric,
            amount_paid          numeric,
            amount_pending       numeric,
            due_date             text,
            paid_date            text,
            status               text,
            academic_cycle       text,
            payment_plan         text,
            is_custom_schedule   boolean,
            custom_schedule_note text,
            source_type          text,
            source_id            text
          )
      ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_inst_written = ROW_COUNT;
  END IF;

  -- ------------------------------------------------------------------
  -- 5. The response — the FULL rows (the client's two full-row fetches
  --    of the T-397 shape are gone). Students in PAYLOAD order so the
  --    client can zip them with its inputs for the gradeLevel patches.
  -- ------------------------------------------------------------------
  SELECT to_jsonb(p)
    INTO v_parent_json
    FROM public.parents p
   WHERE p.id = v_parent_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY u.ord), '[]'::jsonb)
    INTO v_students_json
    FROM unnest(v_student_ids) WITH ORDINALITY AS u(sid, ord)
    JOIN public.students s ON s.id = u.sid;

  RETURN QUERY SELECT v_parent_json, v_students_json, v_ledger_written, v_inst_written;
END;
$register$;

COMMENT ON FUNCTION public.register_family_batch IS
  'T-398/PERF-502: the ONE-round-trip family registration. Reuses the canonical '
  'idempotent upserts (upsert_parent_from_import + upsert_student_from_import) '
  'inside ONE transaction; billing rows arrive client-derived (the canonical TS '
  'calc engine) with 0-based student_ref indexes the RPC resolves to uuids; '
  'ledger/installments written ON CONFLICT DO NOTHING (IMPORT-107/IMPORT-110 '
  'wire semantics); returns the full parent + student rows; fully idempotent '
  '(deterministic codes + ON CONFLICT) — safe under rpcWithIdempotentRetry.';

-- ----------------------------------------------------------------------------
-- 2. Grants — the NARROW side (§15.34): staff action. NOTE: revoking PUBLIC
--    alone is NOT enough on the live platform — the platform's default
--    privileges hand anon EXECUTE on new functions at creation time, so
--    anon is revoked EXPLICITLY (dry-run-proven, 82nd session).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Registration (T-091/MIG-TOKENS pattern — the Management-API apply
-- embeds this statement so the DDL and the registration land in ONE atomic
-- transaction; kept here so a fresh CLI deployment registers identically.
-- ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0102', '{0102_register_family_batch.sql}', 'register_family_batch_rpc')
on conflict (version) do nothing;
