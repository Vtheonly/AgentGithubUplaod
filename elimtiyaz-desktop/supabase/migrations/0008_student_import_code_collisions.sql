-- T-634 / BUG-082 / ADR-037 — preserve cross-family student identity.
-- Replaces the existing canonical upsert at the SAME signature. Only the
-- foreign-parent short-code collision guard/allocation is added; all
-- existing fields, same-parent updates, family-name fallback, grants and
-- RLS are preserved. No existing student or financial row is rewritten.
-- Local verification: scripts/schema-test/t634-student-code-collision.mjs.
-- Live application remains pending the owner’s offline-first release window.

create or replace function public.upsert_student_from_import(p_tenant_id uuid, p_student_code text, p_parent_id text, p_first_name text, p_last_name text, p_display_name text DEFAULT NULL::text, p_middle_name text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_gender text DEFAULT NULL::text, p_grade_level_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_enrollment_date date DEFAULT NULL::date, p_enrollment_status text DEFAULT 'active'::text, p_medical_notes text DEFAULT NULL::text, p_is_active boolean DEFAULT true, p_grade_level_code text DEFAULT NULL::text, p_transport_tier text DEFAULT NULL::text, p_payment_plan text DEFAULT 'tranches'::text, p_filiere_code text DEFAULT NULL::text, p_specialite_code text DEFAULT NULL::text, p_origin_type text DEFAULT NULL::text, p_previous_school_name text DEFAULT NULL::text, p_previous_school_level text DEFAULT NULL::text, p_previous_academic_year text DEFAULT NULL::text, p_origin_notes text DEFAULT NULL::text)
 RETURNS TABLE(out_student_id uuid, out_student_code text, out_was_inserted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id        uuid;
  v_code      text := COALESCE(NULLIF(TRIM(p_student_code), ''),
                               'ELV-' || EXTRACT(YEAR FROM now())::int || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 6)));
  v_existing  uuid;
  v_base_code text := v_code;
  v_code_nonce integer := 0;
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

  -- T-634 / ADR-037: a short hash is only a proposed identity. Never
  -- steal a different family's child on a code collision. Serialize the
  -- base-code namespace and resolve an available stable alternate without
  -- changing the public signature or the canonical six-hex code format.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_base_code, 0));
  WHILE EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.tenant_id = p_tenant_id AND s.student_code = v_code
      AND s.parent_id IS DISTINCT FROM v_parent
  ) LOOP
    v_code_nonce := v_code_nonce + 1;
    IF v_code_nonce > 1000 THEN
      RAISE EXCEPTION 'Student code allocation exhausted; no identity was changed'
        USING ERRCODE = '23505';
    END IF;
    v_code := regexp_replace(v_base_code, '[0-9A-Fa-f]{6}$', '') ||
      upper(substr(md5(v_base_code || ':' || v_parent::text || ':' || v_first || ':' || v_last || ':' || v_code_nonce::text), 1, 6));
  END LOOP;

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
$function$
;
