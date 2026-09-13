-- verify_t-344.sql — migration 0094 verification (MATIERE-500 / ADR-018).
-- Convention (AGENTS.md §11.1): wrapped in BEGIN; … ROLLBACK; so it can be
-- re-run any time without mutating the DB. Results land in t344_results.
--
-- Covers BOTH the happy paths (the new architecture works) AND the
-- regression paths (the previous canonical behavior is preserved).

BEGIN;

CREATE TEMP TABLE t344_results (check_id TEXT, detail TEXT, passed BOOLEAN);

-- ─── A. subject_configurations structure ───────────────────────────────────
INSERT INTO t344_results
SELECT 'A1 table exists',
       'public.subject_configurations present',
       EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = 'subject_configurations');

INSERT INTO t344_results
SELECT 'A2 unique context key',
       'unique index on (tenant, subject, year, level, direction)',
       EXISTS (SELECT 1 FROM pg_indexes
                WHERE schemaname = 'public'
                  AND tablename = 'subject_configurations'
                  AND indexdef LIKE '%UNIQUE%(tenant_id, subject_id, academic_year_id, academic_level_id, direction)%');

INSERT INTO t344_results
SELECT 'A3 recipe check constraint',
       'subject_configurations_recipe_shape present',
       EXISTS (SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_schema = 'public'
                  AND table_name = 'subject_configurations'
                  AND constraint_name = 'subject_configurations_recipe_shape');

-- A4: a malformed recipe (missing key / negative / zero-sum) must be rejected.
DO $$
BEGIN
    BEGIN
        INSERT INTO public.subject_configurations (tenant_id, subject_id, academic_year_id, academic_level_id, grading_recipe)
        SELECT s.tenant_id, s.id, ay.id, al.id, '{"devoir1":1,"devoir2":1,"examen":2}'::jsonb
        FROM public.subjects s
        JOIN public.academic_levels al ON al.cycle = s.cycle
        CROSS JOIN public.academic_years ay
        WHERE ay.is_current
        LIMIT 1;
        INSERT INTO t344_results VALUES ('A4 rejects missing cc key', 'insert must fail', FALSE);
    EXCEPTION WHEN check_violation THEN
        INSERT INTO t344_results VALUES ('A4 rejects missing cc key', 'check_violation raised', TRUE);
    WHEN others THEN
        INSERT INTO t344_results VALUES ('A4 rejects missing cc key', 'unexpected: ' || SQLERRM, FALSE);
    END;
END $$;

DO $$
BEGIN
    BEGIN
        INSERT INTO public.subject_configurations (tenant_id, subject_id, academic_year_id, academic_level_id, grading_recipe)
        SELECT s.tenant_id, s.id, ay.id, al.id, '{"devoir1":0,"devoir2":0,"examen":0,"cc":0}'::jsonb
        FROM public.subjects s
        JOIN public.academic_levels al ON al.cycle = s.cycle
        CROSS JOIN public.academic_years ay
        WHERE ay.is_current
        LIMIT 1;
        INSERT INTO t344_results VALUES ('A5 rejects zero-sum recipe', 'insert must fail', FALSE);
    EXCEPTION WHEN check_violation THEN
        INSERT INTO t344_results VALUES ('A5 rejects zero-sum recipe', 'check_violation raised', TRUE);
    WHEN others THEN
        INSERT INTO t344_results VALUES ('A5 rejects zero-sum recipe', 'unexpected: ' || SQLERRM, FALSE);
    END;
END $$;

-- ─── B. the seed ───────────────────────────────────────────────────────────
INSERT INTO t344_results
SELECT 'B1 seeded rows exist',
       format('count = %s', count(*)),
       count(*) > 0
FROM public.subject_configurations;

-- B2: every seeded row preserves the live subject values bit-for-bit.
INSERT INTO t344_results
SELECT 'B2 seed preserves live values',
       format('%s of %s rows match', sum(CASE WHEN ok THEN 1 ELSE 0 END), count(*)),
       count(*) > 0 AND sum(CASE WHEN ok THEN 1 ELSE 0 END) = count(*)
FROM (
    SELECT (sc.coefficient = COALESCE(s.default_coefficient, 1)
        AND sc.passing_grade = COALESCE(s.passing_grade, 10.00)
        AND sc.is_extracurricular = COALESCE(s.is_extracurricular, FALSE)
        AND sc.grading_recipe = '{"devoir1":1,"devoir2":1,"examen":2,"cc":0}'::jsonb
        AND sc.direction = 'general' AND sc.is_active) AS ok
    FROM public.subject_configurations sc
    JOIN public.subjects s ON s.id = sc.subject_id
) v;

-- B3: every subject × its own cycle levels × current year is covered.
INSERT INTO t344_results
SELECT 'B3 seed coverage complete',
       format('missing = %s', count(*)),
       count(*) = 0
FROM public.subjects s
JOIN public.academic_levels al ON al.cycle = s.cycle AND al.is_active
CROSS JOIN public.academic_years ay
WHERE ay.is_current
  AND NOT EXISTS (SELECT 1 FROM public.subject_configurations sc
                   WHERE sc.subject_id = s.id AND sc.academic_level_id = al.id
                     AND sc.academic_year_id = ay.id AND sc.direction = 'general');

-- ─── C. the recipe trigger — regression paths (bit-compat) ────────────────
-- C1: the legacy formula value this engine must reproduce (reference value).
DO $$
DECLARE
    v_avg NUMERIC;
BEGIN
    SELECT ROUND(((12.00 + 14.00 + 2 * 16.00) / 4.0)::numeric, 2) INTO v_avg;
    INSERT INTO t344_results
    VALUES ('C1 legacy formula reference', format('expected 14.50, computed %s', v_avg), v_avg = 14.50);
END $$;

-- C2: the real trigger path — insert an assessment row with the default
-- weights and all three marks → the average equals the legacy formula.
DO $$
DECLARE
    v_id uuid;
    v_avg NUMERIC;
BEGIN
    INSERT INTO public.assessments (tenant_id, student_id, subject_id, term, academic_year,
                                    devoir1, devoir2, examen, coefficient)
    SELECT s.tenant_id, NULL, s.id, 1, '2026-2027', 12.00, 14.00, 16.00, 4.00
    FROM public.subjects s WHERE s.code = 'MATH'
    RETURNING id INTO v_id;
    SELECT subject_average INTO v_avg FROM public.assessments WHERE id = v_id;
    INSERT INTO t344_results
    VALUES ('C2 trigger legacy-compat', format('subject_average = %s (expected 14.50)', v_avg),
            v_avg = 14.50);
    DELETE FROM public.assessments WHERE id = v_id;
EXCEPTION WHEN others THEN
    INSERT INTO t344_results VALUES ('C2 trigger legacy-compat', 'unexpected: ' || SQLERRM, FALSE);
END $$;

-- C3: missing a positive-weight mark → NULL (not computable).
DO $$
DECLARE
    v_id uuid;
    v_avg NUMERIC;
BEGIN
    INSERT INTO public.assessments (tenant_id, subject_id, term, academic_year,
                                    devoir1, devoir2, examen, coefficient)
    SELECT s.tenant_id, s.id, 1, '2026-2027', 12.00, NULL, 16.00, 4.00
    FROM public.subjects s WHERE s.code = 'MATH'
    RETURNING id INTO v_id;
    SELECT subject_average INTO v_avg FROM public.assessments WHERE id = v_id;
    INSERT INTO t344_results
    VALUES ('C3 missing mark → NULL', format('subject_average = %s (expected NULL)', v_avg), v_avg IS NULL);
    DELETE FROM public.assessments WHERE id = v_id;
EXCEPTION WHEN others THEN
    INSERT INTO t344_results VALUES ('C3 missing mark → NULL', 'unexpected: ' || SQLERRM, FALSE);
END $$;

-- C4: the contrôle-continu path — weights (0, 0, 2, 1) with cc=15, ex=12 →
-- (15×1 + 12×2) / 3 = 13.00 — the NEW capability.
DO $$
DECLARE
    v_id uuid;
    v_avg NUMERIC;
BEGIN
    INSERT INTO public.assessments (tenant_id, subject_id, term, academic_year,
                                    devoir1, devoir2, examen, cc, coefficient,
                                    coefficient_devoir1, coefficient_devoir2,
                                    coefficient_examen, coefficient_cc)
    SELECT s.tenant_id, s.id, 1, '2026-2027', NULL, NULL, 12.00, 15.00, 4.00,
           0.00, 0.00, 2.00, 1.00
    FROM public.subjects s WHERE s.code = 'MATH'
    RETURNING id INTO v_id;
    SELECT subject_average INTO v_avg FROM public.assessments WHERE id = v_id;
    INSERT INTO t344_results
    VALUES ('C4 cc-recipe average', format('subject_average = %s (expected 13.00)', v_avg),
            v_avg = 13.00);
    DELETE FROM public.assessments WHERE id = v_id;
EXCEPTION WHEN others THEN
    INSERT INTO t344_results VALUES ('C4 cc-recipe average', 'unexpected: ' || SQLERRM, FALSE);
END $$;

-- C5: cc entered but weight 0 → cc IGNORED, legacy behavior intact.
DO $$
DECLARE
    v_id uuid;
    v_avg NUMERIC;
BEGIN
    INSERT INTO public.assessments (tenant_id, subject_id, term, academic_year,
                                    devoir1, devoir2, examen, cc, coefficient,
                                    coefficient_cc)
    SELECT s.tenant_id, s.id, 1, '2026-2027', 12.00, 14.00, 16.00, 18.00, 4.00, 0.00
    FROM public.subjects s WHERE s.code = 'MATH'
    RETURNING id INTO v_id;
    SELECT subject_average INTO v_avg FROM public.assessments WHERE id = v_id;
    INSERT INTO t344_results
    VALUES ('C5 cc-weight-0 ignored', format('subject_average = %s (expected 14.50)', v_avg),
            v_avg = 14.50);
    DELETE FROM public.assessments WHERE id = v_id;
EXCEPTION WHEN others THEN
    INSERT INTO t344_results VALUES ('C5 cc-weight-0 ignored', 'unexpected: ' || SQLERRM, FALSE);
END $$;

-- ─── D. upsert RPC passthrough ─────────────────────────────────────────────
DO $$
DECLARE
    v_id uuid;
    v_avg NUMERIC;
    v_cc  NUMERIC;
BEGIN
    SELECT public.upsert_assessment_from_import(
        p_tenant_id := (SELECT tenant_id FROM public.subjects WHERE code = 'MATH'),
        p_student_id := NULL,
        p_subject_id := (SELECT id FROM public.subjects WHERE code = 'MATH'),
        p_term := 1,
        p_academic_year := '2026-2027',
        p_devoir1 := 10.00, p_devoir2 := 10.00, p_examen := 10.00,
        p_cc := 12.00,
        p_coefficient := 4.00,
        p_coefficient_cc := 1.00
    ) INTO v_id;
    SELECT subject_average, cc INTO v_avg, v_cc FROM public.assessments WHERE id = v_id;
    INSERT INTO t344_results
    VALUES ('D1 rpc cc passthrough', format('avg = %s cc = %s (expected 10.40, 12.00)', v_avg, v_cc),
            v_avg = 10.40 AND v_cc = 12.00);
    DELETE FROM public.assessments WHERE id = v_id;
EXCEPTION WHEN others THEN
    INSERT INTO t344_results VALUES ('D1 rpc cc passthrough', 'unexpected: ' || SQLERRM, FALSE);
END $$;

-- ─── E. exam_sessions structure ────────────────────────────────────────────
INSERT INTO t344_results
SELECT 'E1 exam_sessions exists',
       'public.exam_sessions present',
       EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'exam_sessions');

INSERT INTO t344_results
SELECT 'E2 exam_sessions kind check',
       'kind constrained to devoir_1/devoir_2/examen/cc',
       EXISTS (SELECT 1 FROM information_schema.table_constraints c
                JOIN information_schema.check_constraints k ON k.constraint_name = c.constraint_name
                WHERE c.table_schema = 'public' AND c.table_name = 'exam_sessions'
                  AND k.check_clause LIKE '%devoir_1%examen%cc%');

-- ─── F. RLS ────────────────────────────────────────────────────────────────
INSERT INTO t344_results
SELECT 'F1 subject_configurations RLS enabled',
       'relrowsecurity = true',
       EXISTS (SELECT 1 FROM pg_class WHERE relname = 'subject_configurations' AND relrowsecurity);

INSERT INTO t344_results
SELECT 'F2 exam_sessions RLS enabled',
       'relrowsecurity = true',
       EXISTS (SELECT 1 FROM pg_class WHERE relname = 'exam_sessions' AND relrowsecurity);

INSERT INTO t344_results
SELECT 'F3 select policies tenant-scoped',
       'both tables carry tenant-scoped select policies',
       (SELECT count(*) FROM pg_policies
         WHERE tablename IN ('subject_configurations','exam_sessions')
           AND policyname LIKE '%_select'
           AND position('current_tenant_id' in qual) > 0) = 2;

SELECT * FROM t344_results ORDER BY check_id;

ROLLBACK;
