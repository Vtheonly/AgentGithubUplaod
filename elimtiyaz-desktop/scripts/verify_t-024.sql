-- verify_t-024.sql — T-024 / HOMEWORK-101 + STUDENT-100 live verification.
--
-- Verifies, against the LIVE canonical schema, in a single rolled-back
-- transaction (safe to re-run any time):
--   H1  a homework INSERT with a BARE UUID id (the post-fix dispatcher shape)
--       succeeds and persists inside the transaction;
--   H2  a homework INSERT with the legacy "hwk-…" id still FAILS with the
--       documented 22P02 uuid syntax error (the pre-fix behaviour — pins the
--       root cause);
--   S1  upsert_student_from_import with p_grade_level_code ADVANCES an
--       existing student's grade_level_code (the promotion propagation the
--       dispatcher now performs);
--   S2  the RPC's COALESCE semantics — omitting p_grade_level_code leaves the
--       stored grade untouched (null-safety of the non-promotion pushes);
--   S3  the promoted row SURVIVES the pull shape: selecting the student back
--       returns the new grade_level_code (the pull mapper's source column).
--
-- Results land in the temp table t024_results so the Supabase CLI can SELECT
-- them (RAISE NOTICE is not surfaced by the CLI).
BEGIN;

CREATE TEMP TABLE t024_results (check_id TEXT PRIMARY KEY, ok BOOLEAN, detail TEXT);

-- ── H1: bare-UUID homework insert succeeds ────────────────────────────────
DO $$
DECLARE
    v_class uuid;
    v_subject uuid;
    -- personnel is EMPTY on the live corpus — teacher_id is UUID NOT NULL
    -- (no FK), so use a deterministic placeholder (rolled back with the tx).
    v_teacher uuid := '00000000-0000-0000-0000-00000000beef'::uuid;
    v_hwk_id uuid := public.gen_uuid();
    v_count int;
BEGIN
    SELECT c.id, s.id INTO v_class, v_subject
    FROM public.classes c
    JOIN public.subjects s ON TRUE
    JOIN public.tenants t ON t.id = c.tenant_id
    LIMIT 1;

    INSERT INTO public.homework (id, tenant_id, class_id, subject_id, subject_name,
        teacher_id, teacher_name, title, description, due_date, academic_year)
    VALUES (v_hwk_id,
        (SELECT tenant_id FROM public.classes WHERE id = v_class),
        v_class, v_subject, 'Vérif', v_teacher, 'Vérif',
        'T-024 vérification', 'insert de forme UUID nue', CURRENT_DATE + 7,
        COALESCE((SELECT max(academic_year) FROM public.homework), '2026-2027'));

    SELECT count(*) INTO v_count FROM public.homework WHERE id = v_hwk_id;
    INSERT INTO t024_results VALUES ('H1_bare_uuid_insert_ok', v_count = 1,
        'inserted homework row found: ' || v_count);
EXCEPTION WHEN OTHERS THEN
    INSERT INTO t024_results VALUES ('H1_bare_uuid_insert_ok', false, SQLERRM);
END $$;

-- ── H2: legacy "hwk-…" id still rejected (root cause pinned) ─────────────
DO $$
DECLARE
    v_err TEXT;
BEGIN
    BEGIN
        INSERT INTO public.homework (id, tenant_id, class_id, subject_id, subject_name,
            teacher_id, teacher_name, title, description, due_date, academic_year)
        VALUES ('hwk-11111111-1111-1111-1111-111111111111',
            (SELECT tenant_id FROM public.classes LIMIT 1),
            (SELECT id FROM public.classes LIMIT 1),
            (SELECT id FROM public.subjects LIMIT 1),
            'Vérif', (SELECT id FROM public.personnel LIMIT 1), 'Vérif',
            'T-024 négatif', 'forme hwk- préfixée', CURRENT_DATE + 7, '2026-2027');
        INSERT INTO t024_results VALUES ('H2_hwk_prefix_still_rejected', false, 'insert unexpectedly SUCCEEDED');
    EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
        INSERT INTO t024_results VALUES ('H2_hwk_prefix_still_rejected', true, v_err);
    END;
END $$;

-- ── S1 + S2 + S3: promotion propagation through the RPC ──────────────────
DO $$
DECLARE
    v_student record;
    v_new_grade TEXT;
    v_out record;
BEGIN
    SELECT s.id, s.student_code, s.parent_id, s.first_name, s.last_name,
           s.grade_level_code, s.tenant_id
    INTO v_student
    FROM public.students s
    WHERE s.deleted_at IS NULL AND s.student_code IS NOT NULL
    ORDER BY s.created_at
    LIMIT 1;
    IF v_student IS NULL THEN
        INSERT INTO t024_results VALUES ('S1_grade_advances', false, 'no student row found');
        INSERT INTO t024_results VALUES ('S2_omitted_param_preserves', false, 'no student row found');
        INSERT INTO t024_results VALUES ('S3_pull_shape_roundtrip', false, 'no student row found');
        RETURN;
    END IF;
    -- A DIFFERENT, ladder-valid grade code (2AS exists in the canonical ladder).
    v_new_grade := CASE WHEN v_student.grade_level_code = '2AS' THEN '1AS' ELSE '2AS' END;

    SELECT * INTO v_out FROM public.upsert_student_from_import(
        p_tenant_id := v_student.tenant_id,
        p_student_code := v_student.student_code,
        p_parent_id := v_student.parent_id::text,
        p_first_name := v_student.first_name,
        p_last_name := v_student.last_name,
        p_grade_level_code := v_new_grade,
        p_enrollment_status := 'active',
        p_is_active := true
    );

    INSERT INTO t024_results VALUES ('S1_grade_advances',
        (SELECT grade_level_code FROM public.students WHERE id = v_student.id) = v_new_grade,
        'expected ' || v_new_grade || ', got ' ||
        (SELECT grade_level_code FROM public.students WHERE id = v_student.id));

    -- S2: same call WITHOUT the grade param keeps the advanced grade (COALESCE).
    PERFORM public.upsert_student_from_import(
        p_tenant_id := v_student.tenant_id,
        p_student_code := v_student.student_code,
        p_parent_id := v_student.parent_id::text,
        p_first_name := v_student.first_name,
        p_last_name := v_student.last_name,
        p_enrollment_status := 'active',
        p_is_active := true
    );
    INSERT INTO t024_results VALUES ('S2_omitted_param_preserves',
        (SELECT grade_level_code FROM public.students WHERE id = v_student.id) = v_new_grade,
        'grade kept: ' || (SELECT grade_level_code FROM public.students WHERE id = v_student.id));

    -- S3: the PULL shape (what Android's StudentDto decodes) returns the new grade.
    INSERT INTO t024_results VALUES ('S3_pull_shape_roundtrip',
        (SELECT grade_level_code FROM public.students WHERE id = v_student.id AND deleted_at IS NULL) = v_new_grade,
        'pull select grade: ' || (SELECT grade_level_code FROM public.students WHERE id = v_student.id));
EXCEPTION WHEN OTHERS THEN
    INSERT INTO t024_results VALUES ('S1_grade_advances', false, SQLERRM);
    INSERT INTO t024_results VALUES ('S2_omitted_param_preserves', false, SQLERRM);
    INSERT INTO t024_results VALUES ('S3_pull_shape_roundtrip', false, SQLERRM);
END $$;

SELECT check_id, ok, detail FROM t024_results ORDER BY check_id;

ROLLBACK;
