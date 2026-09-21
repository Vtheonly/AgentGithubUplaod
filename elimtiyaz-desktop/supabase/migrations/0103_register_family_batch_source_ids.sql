-- ============================================================================
-- 0103_register_family_batch_source_ids.sql
-- T-398 / PERF-502 (82nd session, the same-session fix-up — the REG-001
-- 0031-style pattern): register_family_batch's billing legs must keep the
-- EXACT source_id identity the OLD client-orchestrated path wrote, or a
-- re-registration of a PRE-EXISTING family through the new single-RPC path
-- would DUPLICATE the ledger charges.
--
-- THE GAP (found during the client-rewire design review, before ANY client
-- shipped the 0102 wire form):
--   OLD path (T-397 and earlier): the ledger source_id embeds the SERVER
--   uuid — `reg-<studentUuid>-t<n>`, `reg-<studentUuid>-transport-t<n>`,
--   `reg-<parentUuid>-fee`; the installments source_id defaults to
--   `<studentUuid>:<category>:T<n>` (bulkImportInstallments). Those
--   identities are what the 0027 `ledger_entries_source_uidx` dedup key
--   has been matching since IMPORT-107.
--   0102's wire form: the client cannot know the uuids BEFORE the single
--   call, so it would send code-bearing source_ids (`reg-<studentCode>-t1`)
--   — a DIFFERENT identity: no conflict, DUPLICATE charge rows on any
--   cross-path re-registration.
--
-- THE FIX (identity-token substitution, server-side):
--   The client still derives the source_id STRINGS exactly as before
--   (`reg-…-t1`, `<code>:tuition:T1`) but with the deterministic CODES in
--   place of the uuids. The RPC — which knows both the codes (p_parent/
--   p_students) and the uuids the upserts just resolved (including an
--   EXISTING student's uuid when the name-fallback converged on an
--   old-path row) — substitutes the code tokens with the resolved uuids
--   before inserting. The stored source_ids are then byte-identical to
--   what the old path would have written: cross-path re-registrations
--   CONVERGE (ON CONFLICT DO NOTHING), never duplicate.
--   The substitution is a mechanical token swap — the source_id FORMAT
--   stays client-derived (no parallel convention in SQL).
--
-- ALSO IN THIS FIX-UP: the students loop now RAISES on a blank
-- student_code (a defensive guard — the replace() token must be non-empty).
--
-- Grants: CREATE OR REPLACE preserves the 0102 ACLs; re-asserted anyway so
-- the file is self-contained (REVOKE/GRANT are idempotent).
--
-- Registration: the T-091/MIG-TOKENS embedded block (atomic with the DDL).
-- ============================================================================

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
  v_student_codes    text[] := '{}';
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
  --    0103: the code is collected for the source_id token substitution.
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
    IF NULLIF(TRIM(COALESCE(v_s.student_code, '')), '') IS NULL THEN
      RAISE EXCEPTION 'register_family_batch: student_code requis (l''élève « % % »)', v_s.first_name, v_s.last_name;
    END IF;

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
    v_student_codes := array_append(v_student_codes, v_s.student_code);
  END LOOP;

  -- ------------------------------------------------------------------
  -- 3. The ledger charges — the IMPORT-107 wire semantics: ONE plain
  --    INSERT ... ON CONFLICT DO NOTHING (no arbiter: honors BOTH the
  --    (tenant, entry_number) key and the PARTIAL source_uidx). The
  --    account_id is derived HERE with the exact deriveAccountId format
  --    (domain/calc/ledger/account-id.ts) because the client cannot know
  --    the uuids before this call.
  --    0103: the source_id CODE TOKENS are substituted with the resolved
  --    UUIDS so the stored identity is byte-identical to the old
  --    client-orchestrated path (`reg-<studentUuid>-t<n>` etc.) — a
  --    cross-path re-registration CONVERGES, never duplicates.
  -- ------------------------------------------------------------------
  IF p_ledger_entries IS NOT NULL AND jsonb_array_length(p_ledger_entries) > 0 THEN
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
      -- 0103: code tokens → resolved uuids (the old path's exact identity).
      CASE WHEN r.student_ref IS NULL THEN
             replace(r.source_id, v_parent_code, v_parent_id::text)
           ELSE
             replace(
               replace(r.source_id, v_student_codes[r.student_ref + 1], v_student_ids[r.student_ref + 1]::text),
               v_parent_code, v_parent_id::text)
      END,
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
  --    0103: same source_id token substitution (`<code>:<cat>:T<n>` →
  --    `<uuid>:<cat>:T<n>` — the bulkImportInstallments default form).
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
      -- 0103: code token → resolved uuid (the old default identity form).
      replace(
        replace(r.source_id, v_student_codes[r.student_ref + 1], v_student_ids[r.student_ref + 1]::text),
        v_parent_code, v_parent_id::text),
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
  'T-398/PERF-502 (0102 + the 0103 fix-up): the ONE-round-trip family '
  'registration. Reuses the canonical idempotent upserts inside ONE '
  'transaction; billing rows arrive client-derived (the canonical TS calc '
  'engine) with 0-based student_ref indexes the RPC resolves to uuids; '
  'account_id + the source_id identity tokens (code→uuid) are substituted '
  'server-side so the stored identities are byte-identical to the old '
  'client-orchestrated path (cross-path re-registrations converge, never '
  'duplicate); ledger/installments written ON CONFLICT DO NOTHING '
  '(IMPORT-107/IMPORT-110 wire semantics); returns the full parent + '
  'student rows; fully idempotent — safe under rpcWithIdempotentRetry.';

-- Grants re-asserted (self-contained; CREATE OR REPLACE preserves them anyway).
REVOKE ALL ON FUNCTION public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Registration (T-091/MIG-TOKENS pattern — the Management-API apply
-- embeds this statement so the DDL and the registration land in ONE atomic
-- transaction; kept here so a fresh CLI deployment registers identically.
-- ON CONFLICT keeps it idempotent.)
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0103', '{0103_register_family_batch_source_ids.sql}', 'register_family_batch_source_ids')
on conflict (version) do nothing;
