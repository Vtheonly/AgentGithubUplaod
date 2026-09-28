-- ============================================================================
-- 0128_re_enrollment_and_student_origin.sql
-- T-437 (116th session, 2026-09-29): GitHub issue #18 — Student
-- Re-enrollment, Academic History, Payment Handling & Direct Student
-- Creation. Problems: ACAD-512, BUSINESS-109, STUDENT-501, STUDENT-502,
-- UI-319. Rules: academic-rules §10 (INV-21..24) + financial-rules §18
-- (INV-25..26) + ADR-031.
--
-- THE MODEL (ADR-031): Student = the same person across all academic years;
-- Enrollment = that student's registration for ONE specific academic year.
-- A re-enrollment NEVER creates a duplicate person and NEVER re-registers a
-- continuing student from scratch.
--
-- §1  students origin columns (STUDENT-502 / INV-24a — structured, not a note)
-- §2  upsert_student_from_import recreated with 5 trailing origin params
--      (the 0112 threading pattern: 0107 body verbatim + the new thread)
-- §3  register_family_batch recreated with the origin jsonb columns + the
--      threading (§2 unchanged; the §15.45a composite-param re-audit)
-- §4  re_enrollments table + indexes + RLS (the 0108 promotion-cycle pattern)
-- §5  fn_resolve_reenrollment_tenant (the 0108 §0 helper pattern)
-- §6  fn_generate_re_enrollment_candidates (INV-22 — from the finalized
--      pedagogical results ONLY; idempotent; freeze-guarded)
-- §7  fn_get_re_enrollment_candidates (the review worklist)
-- §8  fn_set_re_enrollment_decision (INV-23a — freeze-guarded)
-- §9  fn_re_enroll_student (INV-25 — the ONE composite: placement + the
--      client-derived billing legs stamped academic_year_id + status + audit)
-- §10 fn_freeze_re_enrollments (INV-23b — completion-gated)
-- §11 Registration (the T-091/MIG-TOKENS pattern — atomic with the DDL)
--
-- Numbering: 0128 is the next free number (0122 stays RESERVED for
-- IMPORT-118's flush RPC; 0118 is the documented gap, not a free number).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. students origin columns (STUDENT-502 / INV-24a)
-- ----------------------------------------------------------------------------
ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS origin_type text
        CHECK (origin_type IN ('new_admission', 'transfer', 'continuation', 'other')),
    ADD COLUMN IF NOT EXISTS previous_school_name text,
    ADD COLUMN IF NOT EXISTS previous_school_level text,
    ADD COLUMN IF NOT EXISTS previous_academic_year text,
    ADD COLUMN IF NOT EXISTS origin_notes text;

COMMENT ON COLUMN public.students.origin_type IS
  'T-437 (INV-24a): where the student came from BEFORE joining the school — '
  'new_admission | transfer | continuation (came up through El-Imtiyaz itself) | other. '
  'NULL = unknown (the pre-0128 corpus). Distinct from student_academic_histories '
  '(the AT-school history) by construction.';

-- ----------------------------------------------------------------------------
-- §2. upsert_student_from_import — recreated with the origin trailing params
--      (the 0112 pattern: the 0107 body VERBATIM plus exactly the origin
--      thread — drop-all-overloads first so no stale signature survives).
-- ----------------------------------------------------------------------------
DO $_drop_student_0128$
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
$_drop_student_0128$;

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
  p_payment_plan     text DEFAULT 'tranches',
  -- 0107 params (T-401 classification):
  p_filiere_code     text DEFAULT NULL,
  p_specialite_code  text DEFAULT NULL,
  -- 0128 params (T-437 student origin — INV-24a):
  p_origin_type      text DEFAULT NULL,
  p_previous_school_name text DEFAULT NULL,
  p_previous_school_level text DEFAULT NULL,
  p_previous_academic_year text DEFAULT NULL,
  p_origin_notes     text DEFAULT NULL
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
  -- 0107: normalized classification ('general' → NULL storage, the
  -- untagged pre-0107 state; COALESCE preserves existing values).
  v_filiere   text := lower(NULLIF(btrim(COALESCE(p_filiere_code, '')), ''));
  v_specialite text := lower(NULLIF(btrim(COALESCE(p_specialite_code, '')), ''));
  -- 0128: normalized origin (the CHECK constraint is the authority; this
  -- maps blank/unknown to NULL = unknown, preserving stored values).
  v_origin    text := lower(NULLIF(btrim(COALESCE(p_origin_type, '')), ''));
BEGIN
  IF v_parent IS NULL THEN
      RAISE EXCEPTION 'upsert_student_from_import: unresolvable parent ref %', p_parent_id
        USING HINT = 'Push the parent (upsert_parent_from_import) before its students.';
  END IF;

  IF v_filiere = 'general' THEN
      v_filiere := NULL;
  END IF;
  IF v_origin NOT IN ('new_admission', 'transfer', 'continuation', 'other') THEN
      v_origin := NULL;
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
      -- 0107: classification — provided value wins, else preserved.
      filiere_code        = COALESCE(v_filiere, s.filiere_code),
      specialite_code     = COALESCE(v_specialite, s.specialite_code),
      -- 0128 (T-437): origin — provided value wins, else preserved (imports
      -- never erase a captured origin; NULL = unknown).
      origin_type         = COALESCE(v_origin, s.origin_type),
      previous_school_name    = COALESCE(NULLIF(TRIM(COALESCE(p_previous_school_name, '')), ''), s.previous_school_name),
      previous_school_level   = COALESCE(NULLIF(TRIM(COALESCE(p_previous_school_level, '')), ''), s.previous_school_level),
      previous_academic_year  = COALESCE(NULLIF(TRIM(COALESCE(p_previous_academic_year, '')), ''), s.previous_academic_year),
      origin_notes        = COALESCE(p_origin_notes, s.origin_notes),
      updated_at          = now()
    WHERE s.id = v_existing;
    v_id := v_existing;
  ELSE
    INSERT INTO public.students (
      tenant_id, student_code, parent_id, first_name, middle_name, last_name,
      display_name, date_of_birth, gender, grade_level_id, class_id,
      enrollment_date, enrollment_status, medical_notes, is_active,
      grade_level_code, transport_tier, payment_plan,
      filiere_code, specialite_code,
      origin_type, previous_school_name, previous_school_level,
      previous_academic_year, origin_notes
    ) VALUES (
      p_tenant_id, v_code, v_parent, v_first, p_middle_name, v_last,
      v_disp, COALESCE(p_date_of_birth, '2000-01-01'::date), v_gender, p_grade_level_id, p_class_id,
      COALESCE(p_enrollment_date, current_date), COALESCE(NULLIF(TRIM(p_enrollment_status), ''), 'active'),
      p_medical_notes, p_is_active,
      p_grade_level_code, p_transport_tier, v_plan,
      v_filiere, v_specialite,
      v_origin, NULLIF(TRIM(COALESCE(p_previous_school_name, '')), ''),
      NULLIF(TRIM(COALESCE(p_previous_school_level, '')), ''),
      NULLIF(TRIM(COALESCE(p_previous_academic_year, '')), ''),
      p_origin_notes
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
  '0028 params (grade_level_code / transport_tier / payment_plan). '
  '0107 (T-401): p_filiere_code / p_specialite_code set the academic classification '
  '(NULL or the literal general = untagged; COALESCE preserves the stored '
  'classification on partial syncs — imports never erase classification). '
  '0128 (T-437): the five origin params set the pre-admission origin '
  '(origin_type/previous_school_name/previous_school_level/previous_academic_year/'
  'origin_notes — INV-24a; COALESCE preserves a captured origin on partial syncs).';

-- ----------------------------------------------------------------------------
-- §3. register_family_batch — recreated with the origin thread (0112 body
--     VERBATIM + the five jsonb_to_recordset columns + the trailing args; the
--     grants' type signature (uuid, jsonb, jsonb, jsonb, jsonb) is UNCHANGED).
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
  --    0112: the classification (filiere/specialite) is threaded through
  --    to the upsert's trailing 0107 params. 0128: the origin (T-437) is
  --    threaded the same way through the trailing 0128 params.
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
            payment_plan       text,
            filiere_code       text,
            specialite_code    text,
            origin_type        text,
            previous_school_name    text,
            previous_school_level   text,
            previous_academic_year  text,
            origin_notes       text
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
             v_s.payment_plan,
             -- 0112 (T-407): the classification the wizard's step 2
             -- collected — previously dropped at this seam.
             NULLIF(TRIM(COALESCE(v_s.filiere_code, '')), ''),
             NULLIF(TRIM(COALESCE(v_s.specialite_code, '')), ''),
             -- 0128 (T-437): the origin the wizard's step 2 collects —
             -- the same threading discipline (INV-24a).
             NULLIF(TRIM(COALESCE(v_s.origin_type, '')), ''),
             NULLIF(TRIM(COALESCE(v_s.previous_school_name, '')), ''),
             NULLIF(TRIM(COALESCE(v_s.previous_school_level, '')), ''),
             NULLIF(TRIM(COALESCE(v_s.previous_academic_year, '')), ''),
             v_s.origin_notes
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
  '(deterministic codes + ON CONFLICT) — safe under rpcWithIdempotentRetry. '
  '0112 (T-407): the student classification (filiere_code/specialite_code) is '
  'threaded through to the canonical upsert (previously dropped at this seam). '
  '0128 (T-437): the student origin (origin_type/previous_school_*) is threaded '
  'through the same way (INV-24a) — and an EXISTING parent is bound by passing '
  'its ACTUAL parent_code in p_parent (the primary identity match reuses the '
  'record — the direct add-student flow, ADR-031 §7).';

REVOKE ALL ON FUNCTION public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_student_from_import(uuid, text, text, text, text, text, text, date, text, uuid, uuid, date, text, text, boolean, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_student_from_import(uuid, text, text, text, text, text, text, date, text, uuid, uuid, date, text, text, boolean, text, text, text, text, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_student_from_import(uuid, text, text, text, text, text, text, date, text, uuid, uuid, date, text, text, boolean, text, text, text, text, text, text, text, text, text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- §4. re_enrollments — the year-transition state (ADR-031 §1)
-- ----------------------------------------------------------------------------
create table if not exists public.re_enrollments (
    id                       uuid        primary key default gen_random_uuid(),
    tenant_id                uuid        not null references public.tenants(id) on delete cascade,
    student_id               uuid        not null references public.students(id) on delete cascade,
    source_academic_year_id  uuid        not null references public.academic_years(id),
    target_academic_year_id  uuid        not null references public.academic_years(id),
    -- The source-year finalized snapshot (display stability; the LIVE truth
    -- stays in student_academic_histories — INV-22a: no second result system).
    source_grade_level_code  text,
    source_class_id          uuid references public.classes(id) on delete set null,
    source_class_name        text,
    final_decision           text check (final_decision in ('promoted', 'repeated', 'graduated', 'transferred')),
    final_average            numeric(4, 2),
    expected_grade_level_code text,
    -- The decision state (INV-23a).
    status                   text        not null default 'waiting'
                             check (status in ('waiting', 'started', 're_enrolled', 'not_continuing')),
    target_class_id          uuid references public.classes(id) on delete set null,
    decided_at               timestamptz,
    decided_by_profile_id    uuid,
    decided_by_name          text,
    re_enrolled_at           timestamptz,
    installments_written     integer,
    notes                    text,
    frozen_at                timestamptz,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),
    -- INV-21b: ONE row per (tenant, student, target year).
    constraint re_enrollments_student_target_key unique (tenant_id, student_id, target_academic_year_id)
);

create index if not exists re_enrollments_target_idx on public.re_enrollments (tenant_id, target_academic_year_id, status);
create index if not exists re_enrollments_source_idx on public.re_enrollments (tenant_id, source_academic_year_id);

comment on table public.re_enrollments is
  'T-437 (ADR-031): the year-transition state for CONTINUING students — one row per '
  '(tenant, student, target academic year). Carries the source-year finalized snapshot '
  '(from student_academic_histories at generation time), the expected next level, the '
  'decision state (waiting/started/re_enrolled/not_continuing), and the freeze. NEVER '
  'a duplicate person: the flow operates on the existing students row (INV-21a).';

-- RLS: the 0108 promotion-cycle pattern — staff read, admin manage.
alter table public.re_enrollments enable row level security;

drop policy if exists re_enrollments_staff_read on public.re_enrollments;
create policy re_enrollments_staff_read on public.re_enrollments
  for select
  using (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text, 'teacher'::text])
  );

drop policy if exists re_enrollments_admin_manage on public.re_enrollments;
create policy re_enrollments_admin_manage on public.re_enrollments
  for all
  using (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_any_role(ARRAY['super_admin'::text, 'support_staff'::text])
  );

-- ----------------------------------------------------------------------------
-- §5. fn_resolve_reenrollment_tenant (the 0108 §0 helper pattern)
-- ----------------------------------------------------------------------------
create or replace function public.fn_resolve_reenrollment_tenant(p_tenant_id uuid default null)
returns uuid
language plpgsql
stable
as $$
declare
    v_tenant uuid;
    v_caller_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
    v_tenant := public.current_tenant_id();
    if p_tenant_id is not null and (v_tenant is null or p_tenant_id <> v_tenant) then
        if not v_caller_is_service_role and not public.is_global_admin() then
            raise exception 're-enrollment: caller tenant mismatch (p_tenant_id=%)', p_tenant_id
              using errcode = '42501';
        end if;
        v_tenant := p_tenant_id;
    end if;
    if v_tenant is null then
        raise exception 're-enrollment: caller tenant unresolvable'
          using errcode = '42501';
    end if;
    return v_tenant;
end;
$$;

-- ----------------------------------------------------------------------------
-- §6. fn_generate_re_enrollment_candidates (INV-22)
-- ----------------------------------------------------------------------------
create or replace function public.fn_generate_re_enrollment_candidates(
    p_source_academic_year_id uuid,
    p_target_academic_year_id uuid,
    p_actor_profile_id uuid default null,
    p_actor_name text default null,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := public.fn_resolve_reenrollment_tenant(p_tenant_id);
    v_source public.academic_years;
    v_target public.academic_years;
    v_frozen_count integer;
    v_total integer := 0;
    v_inserted integer := 0;
begin
    if p_source_academic_year_id is null or p_target_academic_year_id is null then
        raise exception 'fn_generate_re_enrollment_candidates: p_source_academic_year_id et p_target_academic_year_id sont requis'
          using errcode = '22023';
    end if;

    select * into v_source from public.academic_years ay
     where ay.id = p_source_academic_year_id and ay.tenant_id = v_tenant;
    if v_source.id is null then
        raise exception 'fn_generate_re_enrollment_candidates: année source introuvable dans le tenant'
          using errcode = '23503';
    end if;

    select * into v_target from public.academic_years ay
     where ay.id = p_target_academic_year_id and ay.tenant_id = v_tenant;
    if v_target.id is null then
        raise exception 'fn_generate_re_enrollment_candidates: année cible introuvable dans le tenant (créez-la dans Années scolaires d''abord)'
          using errcode = '23503';
    end if;

    if v_source.id = v_target.id then
        raise exception 'fn_generate_re_enrollment_candidates: l''année cible doit différer de l''année source (%)', v_source.code
          using errcode = '22023';
    end if;

    -- The freeze guard (INV-23b): a frozen list is FINAL — no new candidates.
    select count(*) into v_frozen_count
      from public.re_enrollments re
     where re.tenant_id = v_tenant
       and re.target_academic_year_id = v_target.id
       and re.frozen_at is not null;
    if v_frozen_count > 0 then
        raise exception 'fn_generate_re_enrollment_candidates: la liste % → % est FIGÉE (%) — aucune génération possible', v_source.code, v_target.code, v_frozen_count
          using errcode = '55006';
    end if;

    select count(*) into v_total
      from public.re_enrollments re
     where re.tenant_id = v_tenant
       and re.target_academic_year_id = v_target.id;

    -- INV-22a: candidates = the active roster + the FINALIZED source-year
    -- results from student_academic_histories (the promotion flow's writer).
    -- INV-22b: history-less candidates surface final_decision = NULL (the
    -- honest « non finalisé » state). INV-22c: expected level — promoted →
    -- the student's CURRENT grade (0059 already advanced it); repeated → the
    -- source grade (0059 left the row untouched); no history → the canonical
    -- academic_levels progression.
    with roster as (
        select s.id as student_id,
               s.grade_level_code,
               s.class_id
          from public.students s
         where s.tenant_id = v_tenant
           and s.deleted_at is null
           and s.is_active
           and s.enrollment_status in ('active', 'enrolled')
    ),
    hist as (
        select h.student_id, h.grade_code, h.class_id as hist_class_id,
               h.class_name as hist_class_name, h.gpa, h.decision
          from public.student_academic_histories h
         where h.tenant_id = v_tenant
           and h.academic_year = v_source.code
    ),
    snap as (
        select r.student_id,
               r.grade_level_code,
               coalesce(hc.grade_code, r.grade_level_code) as source_grade,
               coalesce(hc.hist_class_id, r.class_id)      as source_class_id,
               coalesce(hc.hist_class_name, cc.name, cc.code) as source_class_name,
               hc.decision as final_decision,
               hc.gpa      as final_average,
               case
                 when hc.decision = 'promoted' then r.grade_level_code
                 when hc.decision = 'repeated' then hc.grade_code
                 else coalesce(nx.next_grade, r.grade_level_code)
               end as expected_grade
          from roster r
          left join hist hc on hc.student_id = r.student_id
          left join public.classes cc on cc.id = r.class_id
          left join lateral (
              select al2.grade_code as next_grade
                from public.academic_levels al1
                join lateral (
                    select aln.grade_code
                      from public.academic_levels aln
                     where aln.tenant_id = v_tenant
                       and aln.is_active
                       and aln.sort_order > al1.sort_order
                     order by aln.sort_order
                     limit 1
                ) al2 on true
               where al1.tenant_id = v_tenant
                 and al1.grade_code = r.grade_level_code
               limit 1
          ) nx on true
    )
    insert into public.re_enrollments (
        tenant_id, student_id,
        source_academic_year_id, target_academic_year_id,
        source_grade_level_code, source_class_id, source_class_name,
        final_decision, final_average, expected_grade_level_code,
        status
    )
    select v_tenant, sn.student_id,
           v_source.id, v_target.id,
           sn.source_grade, sn.source_class_id, sn.source_class_name,
           sn.final_decision, sn.final_average, sn.expected_grade,
           'waiting'
      from snap sn
      on conflict (tenant_id, student_id, target_academic_year_id) do update set
           -- Regeneration REFRESHES the finalized snapshot for rows still
           -- WAITING (generate-before-finalize → finalize → regenerate picks
           -- up the results, INV-22b); DECIDED rows are frozen facts (the
           -- decision was taken on the data the school saw at the time).
           source_grade_level_code = excluded.source_grade_level_code,
           source_class_id = excluded.source_class_id,
           source_class_name = excluded.source_class_name,
           final_decision = excluded.final_decision,
           final_average = excluded.final_average,
           expected_grade_level_code = excluded.expected_grade_level_code,
           updated_at = now()
         where public.re_enrollments.status = 'waiting';

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- The AFTER count (rows now materialized for the target year).
    select count(*) into v_total
      from public.re_enrollments re
     where re.tenant_id = v_tenant
       and re.target_academic_year_id = v_target.id;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 're_enrollment.candidates_generated',
        p_entity_type := 're_enrollment',
        p_entity_id   := null,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json  := jsonb_build_object(
                             'source_academic_year', v_source.code,
                             'target_academic_year', v_target.code,
                             'candidates_written', v_inserted,
                             'total_rows', v_total
                         ),
        p_note        := format('Candidats de réinscription générés pour %s → %s : %s écriture(s) (insertions + rafraîchissements en attente), %s au total.',
                                v_source.code, v_target.code, v_inserted, v_total)
    );

    return jsonb_build_object(
        'ok', true,
        'source_academic_year', v_source.code,
        'target_academic_year', v_target.code,
        'candidates_written', v_inserted,
        'total_rows', v_total
    );
end;
$$;

-- ----------------------------------------------------------------------------
-- §7. fn_get_re_enrollment_candidates — the review worklist (live-joined)
-- ----------------------------------------------------------------------------
create or replace function public.fn_get_re_enrollment_candidates(
    p_target_academic_year_id uuid,
    p_tenant_id uuid default null
)
returns table (
    re_enrollment_id        uuid,
    student_id              uuid,
    student_code            text,
    student_first_name      text,
    student_last_name       text,
    student_grade_level     text,
    student_class_id        uuid,
    parent_id               uuid,
    parent_code             text,
    parent_display_name     text,
    parent_phone            text,
    source_academic_year    text,
    target_academic_year    text,
    source_grade_level_code text,
    source_class_name       text,
    final_decision          text,
    final_average           numeric,
    expected_grade_level_code text,
    status                  text,
    target_class_id         uuid,
    target_class_name       text,
    decided_at              timestamptz,
    decided_by_name         text,
    re_enrolled_at          timestamptz,
    installments_written    integer,
    notes                   text,
    frozen_at               timestamptz,
    created_at              timestamptz
)
language plpgsql
stable
as $$
declare
    v_tenant uuid := public.fn_resolve_reenrollment_tenant(p_tenant_id);
begin
    return query
    select re.id,
           s.id, s.student_code, s.first_name, s.last_name,
           s.grade_level_code, s.class_id,
           p.id, p.parent_code,
           coalesce(p.display_name, (p.first_name || ' ' || p.last_name)),
           p.primary_phone,
           ay_src.code,
           ay_tgt.code,
           re.source_grade_level_code,
           re.source_class_name,
           re.final_decision,
           re.final_average,
           re.expected_grade_level_code,
           re.status,
           re.target_class_id,
           tc.name,
           re.decided_at,
           re.decided_by_name,
           re.re_enrolled_at,
           re.installments_written,
           re.notes,
           re.frozen_at,
           re.created_at
      from public.re_enrollments re
      join public.students s on s.id = re.student_id
      join public.parents p on p.id = s.parent_id
      join public.academic_years ay_src on ay_src.id = re.source_academic_year_id
      join public.academic_years ay_tgt on ay_tgt.id = re.target_academic_year_id
      left join public.classes tc on tc.id = re.target_class_id
     where re.tenant_id = v_tenant
       and re.target_academic_year_id = p_target_academic_year_id
     order by (re.status = 'waiting') desc, s.last_name, s.first_name;
end;
$$;

-- ----------------------------------------------------------------------------
-- §8. fn_set_re_enrollment_decision (INV-23a — freeze-guarded)
-- ----------------------------------------------------------------------------
create or replace function public.fn_set_re_enrollment_decision(
    p_re_enrollment_id uuid,
    p_decision text,
    p_notes text default null,
    p_actor_profile_id uuid default null,
    p_actor_name text default null,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := public.fn_resolve_reenrollment_tenant(p_tenant_id);
    v_row public.re_enrollments;
begin
    if p_decision not in ('waiting', 'started', 'not_continuing') then
        raise exception 'fn_set_re_enrollment_decision: décision « % » invalide (waiting | started | not_continuing ; re_enrolled passe par fn_re_enroll_student)', p_decision
          using errcode = '22023';
    end if;

    select * into v_row
      from public.re_enrollments re
     where re.id = p_re_enrollment_id
       and re.tenant_id = v_tenant
     for update;
    if v_row.id is null then
        raise exception 'fn_set_re_enrollment_decision: candidat introuvable dans le tenant'
          using errcode = '42501';
    end if;

    if v_row.frozen_at is not null then
        raise exception 'fn_set_re_enrollment_decision: la liste est FIGÉE depuis % — aucune modification possible', v_row.frozen_at
          using errcode = '55006';
    end if;

    if v_row.status = 're_enrolled' then
        raise exception 'fn_set_re_enrollment_decision: l''élève est déjà réinscrit (%) — décision terminale', v_row.status
          using errcode = '55006';
    end if;

    update public.re_enrollments re
       set status = p_decision,
           decided_at = case when p_decision in ('started', 'not_continuing') then now() else null end,
           decided_by_profile_id = case when p_decision in ('started', 'not_continuing') then p_actor_profile_id else null end,
           decided_by_name = case when p_decision in ('started', 'not_continuing') then coalesce(p_actor_name, '—') else null end,
           notes = coalesce(p_notes, re.notes),
           updated_at = now()
     where re.id = v_row.id;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 're_enrollment.decision',
        p_entity_type := 're_enrollment',
        p_entity_id   := v_row.id,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_before_json := jsonb_build_object('status', v_row.status),
        p_after_json  := jsonb_build_object('status', p_decision),
        p_note        := format('Décision de réinscription : %s → %s.', v_row.status, p_decision)
    );

    return jsonb_build_object('ok', true, 're_enrollment_id', v_row.id, 'status', p_decision);
end;
$$;

-- ----------------------------------------------------------------------------
-- §9. fn_re_enroll_student (INV-25 — the ONE composite)
-- ----------------------------------------------------------------------------
create or replace function public.fn_re_enroll_student(
    p_re_enrollment_id uuid,
    p_grade_level_code text,
    p_class_id uuid default null,
    p_payment_plan text default 'tranches',
    p_transport_tier text default null,
    p_installments jsonb default '[]'::jsonb,
    p_ledger_entries jsonb default '[]'::jsonb,
    p_notes text default null,
    p_actor_profile_id uuid default null,
    p_actor_name text default null,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := public.fn_resolve_reenrollment_tenant(p_tenant_id);
    v_row public.re_enrollments;
    v_student public.students;
    v_target public.academic_years;
    v_plan text := coalesce(nullif(btrim(p_payment_plan), ''), 'tranches');
    v_ledger_written integer := 0;
    v_inst_written integer := 0;
    v_e record;
    v_i record;
begin
    -- -----------------------------------------------------------------
    -- 0. Guards: lock the candidate, tenant match, freeze, state.
    -- -----------------------------------------------------------------
    select * into v_row
      from public.re_enrollments re
     where re.id = p_re_enrollment_id
       and re.tenant_id = v_tenant
     for update;
    if v_row.id is null then
        raise exception 'fn_re_enroll_student: candidat introuvable dans le tenant'
          using errcode = '42501';
    end if;

    if v_row.frozen_at is not null then
        raise exception 'fn_re_enroll_student: la liste est FIGÉE depuis % — aucune réinscription possible', v_row.frozen_at
          using errcode = '55006';
    end if;

    if v_row.status not in ('waiting', 'started') then
        raise exception 'fn_re_enroll_student: statut « % » non réinscriptible (waiting | started requis)', v_row.status
          using errcode = '55006';
    end if;

    if v_plan not in ('tranches', 'full_annual') then
        raise exception 'fn_re_enroll_student: p_payment_plan « % » invalide (tranches | full_annual)', p_payment_plan
          using errcode = '22023';
    end if;

    select * into v_target from public.academic_years ay
     where ay.id = v_row.target_academic_year_id and ay.tenant_id = v_tenant;
    if v_target.id is null then
        raise exception 'fn_re_enroll_student: année cible introuvable'
          using errcode = '23503';
    end if;

    -- INV-21a: the EXISTING student row — never a duplicate person.
    select * into v_student
      from public.students s
     where s.id = v_row.student_id
       and s.tenant_id = v_tenant
       and s.deleted_at is null
     for update;
    if v_student.id is null then
        raise exception 'fn_re_enroll_student: élève introuvable dans le tenant'
          using errcode = '42501';
    end if;

    -- -----------------------------------------------------------------
    -- 1. The new-year placement (INV-21c: identity/parent/history rows
    --    are NEVER touched — grade/class/plan/transport only).
    -- -----------------------------------------------------------------
    update public.students s
       set grade_level_code = coalesce(nullif(btrim(p_grade_level_code), ''), s.grade_level_code),
           class_id = p_class_id,
           payment_plan = v_plan,
           transport_tier = coalesce(nullif(btrim(coalesce(p_transport_tier, '')), ''), s.transport_tier),
           enrollment_status = 'active',
           updated_at = now()
     where s.id = v_student.id;

    -- -----------------------------------------------------------------
    -- 2. The ledger charges (the register_family_batch wire semantics —
    --    the account_id derived HERE with the REAL uuids).
    -- -----------------------------------------------------------------
    if p_ledger_entries is not null and jsonb_array_length(p_ledger_entries) > 0 then
        insert into public.ledger_entries (
            tenant_id, entry_number, parent_id, student_id, account_id,
            entry_type, amount, category, description, entry_date,
            source_type, source_id, method, receipt_number, payment_status,
            reverses_id, actor_id, actor_name, at, metadata
        )
        select
            v_tenant,
            r.entry_number,
            v_student.parent_id,
            v_student.id,
            'parent:' || v_student.parent_id || ':category:' || r.category ||
              ':student:' || v_student.id,
            r.entry_type,
            r.amount,
            r.category,
            r.description,
            coalesce(nullif(btrim(coalesce(r.entry_date, '')), '')::timestamptz, now()),
            r.source_type,
            r.source_id,
            r.method,
            r.receipt_number,
            r.payment_status,
            r.reverses_id,
            r.actor_id,
            r.actor_name,
            nullif(btrim(coalesce(r.at, '')), '')::timestamptz,
            r.metadata
          from jsonb_to_recordset(p_ledger_entries) as r(
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
          on conflict do nothing;

        get diagnostics v_ledger_written = row_count;
    end if;

    -- -----------------------------------------------------------------
    -- 3. The installment tranches (INV-25c: academic_year_id = TARGET —
    --    the charge-belonging year, frozen at write per INV-18b).
    -- -----------------------------------------------------------------
    if p_installments is not null and jsonb_array_length(p_installments) > 0 then
        insert into public.installments (
            tenant_id, parent_id, student_id, category, tranche_number,
            label, amount_due, amount_paid, amount_pending, due_date,
            paid_date, status, academic_cycle, payment_plan,
            is_custom_schedule, custom_schedule_note, source_type, source_id,
            academic_year_id, updated_at
        )
        select
            v_tenant,
            v_student.parent_id,
            v_student.id,
            r.category,
            r.tranche_number,
            r.label,
            r.amount_due,
            coalesce(r.amount_paid, 0),
            coalesce(r.amount_pending, 0),
            nullif(btrim(coalesce(r.due_date, '')), '')::date,
            nullif(btrim(coalesce(r.paid_date, '')), '')::date,
            coalesce(nullif(btrim(coalesce(r.status, '')), ''), 'unpaid'),
            nullif(btrim(coalesce(r.academic_cycle, '')), ''),
            coalesce(nullif(btrim(coalesce(r.payment_plan, '')), ''), 'tranches'),
            coalesce(r.is_custom_schedule, false),
            r.custom_schedule_note,
            r.source_type,
            r.source_id,
            v_target.id,
            now()
          from jsonb_to_recordset(p_installments) as r(
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
          on conflict do nothing;

        get diagnostics v_inst_written = row_count;
    end if;

    -- -----------------------------------------------------------------
    -- 4. The status flip (INV-23a: re_enrolled is terminal pre-freeze).
    -- -----------------------------------------------------------------
    update public.re_enrollments re
       set status = 're_enrolled',
           target_class_id = p_class_id,
           decided_at = now(),
           decided_by_profile_id = p_actor_profile_id,
           decided_by_name = coalesce(p_actor_name, '—'),
           re_enrolled_at = now(),
           installments_written = v_inst_written,
           notes = coalesce(p_notes, re.notes),
           updated_at = now()
     where re.id = v_row.id;

    -- -----------------------------------------------------------------
    -- 5. ONE audit entry (the 0014 canonical entry point).
    -- -----------------------------------------------------------------
    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 'student.re_enrolled',
        p_entity_type := 'student',
        p_entity_id   := v_student.id,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_before_json := jsonb_build_object(
                             'status', v_row.status,
                             'grade_level_code', v_student.grade_level_code,
                             'class_id', v_student.class_id
                         ),
        p_after_json  := jsonb_build_object(
                             'target_academic_year', v_target.code,
                             'grade_level_code', coalesce(nullif(btrim(p_grade_level_code), ''), v_student.grade_level_code),
                             'class_id', p_class_id,
                             'installments_written', v_inst_written,
                             'ledger_written', v_ledger_written
                         ),
        p_note        := format('Réinscription %s : %s %s réinscrit pour %s (%s tranche(s) écrite(s)).',
                                v_target.code, v_student.first_name, v_student.last_name, v_target.code, v_inst_written)
    );

    return jsonb_build_object(
        'ok', true,
        're_enrollment_id', v_row.id,
        'student_id', v_student.id,
        'student_code', v_student.student_code,
        'target_academic_year', v_target.code,
        'installments_written', v_inst_written,
        'ledger_written', v_ledger_written
    );
end;
$$;

-- ----------------------------------------------------------------------------
-- §10. fn_freeze_re_enrollments (INV-23b — completion-gated)
-- ----------------------------------------------------------------------------
create or replace function public.fn_freeze_re_enrollments(
    p_target_academic_year_id uuid,
    p_actor_profile_id uuid default null,
    p_actor_name text default null,
    p_tenant_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := public.fn_resolve_reenrollment_tenant(p_tenant_id);
    v_target public.academic_years;
    v_total integer := 0;
    v_waiting integer := 0;
    v_frozen integer := 0;
begin
    select * into v_target from public.academic_years ay
     where ay.id = p_target_academic_year_id and ay.tenant_id = v_tenant;
    if v_target.id is null then
        raise exception 'fn_freeze_re_enrollments: année cible introuvable dans le tenant'
          using errcode = '23503';
    end if;

    select count(*),
           count(*) filter (where re.status = 'waiting'),
           count(*) filter (where re.frozen_at is not null)
      into v_total, v_waiting, v_frozen
      from public.re_enrollments re
     where re.tenant_id = v_tenant
       and re.target_academic_year_id = p_target_academic_year_id;

    if v_total = 0 then
        raise exception 'fn_freeze_re_enrollments: aucun candidat généré pour % — générez la liste d''abord', v_target.code
          using errcode = '55006';
    end if;

    if v_frozen > 0 then
        raise exception 'fn_freeze_re_enrollments: la liste % est DÉJÀ figée', v_target.code
          using errcode = '55006';
    end if;

    -- INV-23b: the freeze REFUSES while any candidate is still waiting —
    -- "record that decision rather than leaving them unresolved".
    if v_waiting > 0 then
        raise exception 'fn_freeze_re_enrollments: % candidat(s) en attente de décision pour % — décidez chaque élève avant de figer', v_waiting, v_target.code
          using errcode = '55006';
    end if;

    update public.re_enrollments re
       set frozen_at = now(),
           updated_at = now()
     where re.tenant_id = v_tenant
       and re.target_academic_year_id = p_target_academic_year_id
       and re.frozen_at is null;

    perform public.write_audit_log(
        p_tenant_id   := v_tenant,
        p_action      := 're_enrollment.frozen',
        p_entity_type := 're_enrollment',
        p_entity_id   := null,
        p_actor_id    := p_actor_profile_id,
        p_actor_name  := p_actor_name,
        p_after_json  := jsonb_build_object(
                             'target_academic_year', v_target.code,
                             'total', v_total
                         ),
        p_note        := format('Liste de réinscription %s FIGÉE (%s candidat(s)) — la revue est terminée.', v_target.code, v_total)
    );

    return jsonb_build_object(
        'ok', true,
        'target_academic_year', v_target.code,
        'frozen_count', v_total
    );
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants (§15.34 the narrow side) — staff call the workflow RPCs; the
-- caller-RLS model (execute_batch_promotion's) stays enforced.
-- ----------------------------------------------------------------------------
revoke execute on function public.fn_resolve_reenrollment_tenant(uuid) from anon, public;
revoke execute on function public.fn_generate_re_enrollment_candidates(uuid, uuid, uuid, text, uuid) from anon, public;
revoke execute on function public.fn_get_re_enrollment_candidates(uuid, uuid) from anon, public;
revoke execute on function public.fn_set_re_enrollment_decision(uuid, text, text, uuid, text, uuid) from anon, public;
revoke execute on function public.fn_re_enroll_student(uuid, text, uuid, text, text, jsonb, jsonb, text, uuid, text, uuid) from anon, public;
revoke execute on function public.fn_freeze_re_enrollments(uuid, uuid, text, uuid) from anon, public;
grant execute on function public.fn_generate_re_enrollment_candidates(uuid, uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.fn_get_re_enrollment_candidates(uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_set_re_enrollment_decision(uuid, text, text, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.fn_re_enroll_student(uuid, text, uuid, text, text, jsonb, jsonb, text, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.fn_freeze_re_enrollments(uuid, uuid, text, uuid) to authenticated, service_role;

comment on function public.fn_generate_re_enrollment_candidates is
  'T-437 (INV-22): materialize the re-enrollment candidates for a year pair — the '
  'active roster enriched from the FINALIZED student_academic_histories rows of the '
  'source year (never a second pass/fail engine). Idempotent (ON CONFLICT DO NOTHING '
  '— existing decisions survive); freeze-guarded.';
comment on function public.fn_re_enroll_student is
  'T-437 (INV-25): the ONE composite re-enrollment transaction — the target-year '
  'placement update on the EXISTING student row (identity/parent/history untouched, '
  'INV-21a/21c), the client-derived billing legs (the register_family_batch wire '
  'shapes) stamped academic_year_id = target (INV-25c), the status flip, ONE audit. '
  'Money stays client-derived (§15.39b); previous-year financial rows are never '
  'touched (INV-26a).';
comment on function public.fn_freeze_re_enrollments is
  'T-437 (INV-23b): freeze the target-year re-enrollment list — refuses while any '
  'candidate is still waiting; after the freeze every decision/re-enrollment is '
  'refused. The re-enrollment-side counterpart of the promotion-cycle completion.';

-- ----------------------------------------------------------------------------
-- §11. Registration (T-091/MIG-TOKENS pattern — the Management-API apply
-- embeds this statement so the DDL and the registration land in ONE atomic
-- transaction; ON CONFLICT keeps it idempotent).
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, statements, name)
values ('0128', '{0128_re_enrollment_and_student_origin.sql}', 're_enrollment_and_student_origin')
on conflict (version) do nothing;
