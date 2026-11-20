-- ============================================================================
-- 0094_subject_context_configurations.sql
-- ============================================================================
-- MATIERE-500 / ADR-018 (62nd session, T-344): the canonical subject
-- architecture — subject IDENTITY separated from per-context CONFIGURATION.
--
--   1. subject_configurations — ONE row per (tenant, subject, academic year,
--      academic level, direction): coefficient, per-bulletin subject_code,
--      passing_grade, is_extracurricular, grading_recipe (component weights
--      incl. the NEW contrôle-continu `cc` component), weekly_hours.
--   2. assessments.cc + assessments.coefficient_cc — the contrôle continu
--      (المراقبة المستمرة) mark and its weight snapshot (0 = excluded;
--      default recipe {devoir1:1, devoir2:1, examen:2, cc:0} is
--      bit-identical to the previous (D1+D2+2×Ex)/4 engine).
--   3. compute_assessments_subject_average generalized to
--      Σ(mark×weight)/Σ(weight) over the positive-weight components (all
--      required marks present, else NULL — the T-336 honesty rule).
--   4. exam_sessions — first-class séances de composition.
--   5. Seed: for every subject × academic_level of its own cycle × the
--      current academic year — preserving the live coefficient/passing/
--      extracurricular values bit-for-bit. Cross-cycle configurations (e.g.
--      Arabe for 4AM at its CEM coefficient) are ADMIN-CREATED rows, never
--      seeded (the school decides the coefficient — never guessed).
--
-- Idempotent + additive (§15 rule 9: never edit applied migrations).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. subject_configurations — the context-specific subject configuration
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subject_configurations (
    id                 uuid        primary key default public.gen_uuid(),
    tenant_id          uuid        not null references public.tenants(id) on delete cascade,
    subject_id         uuid        not null references public.subjects(id) on delete cascade,
    academic_year_id   uuid        not null references public.academic_years(id) on delete cascade,
    academic_level_id  uuid        not null references public.academic_levels(id) on delete cascade,
    -- direction / filière (شعبة) — 'general' until classes carry a real
    -- filière field (ADR-018 residual); scoped per configuration.
    direction          text        not null default 'general',
    -- The coefficient of the subject in THIS context (year × level ×
    -- direction). NEVER edited in place once assessments exist under it —
    -- a new context (next year) gets a new row (ADR-018 §3).
    coefficient        numeric(4,2) not null default 1.00 check (coefficient > 0),
    -- Per-bulletin subject identifier for this context; NULL → subjects.code
    subject_code       text,
    passing_grade      numeric(4,2) not null default 10.00
                       check (passing_grade >= 0 and passing_grade <= 20),
    is_extracurricular boolean     not null default false,
    -- Component weights of the term-average recipe. Keys are fixed:
    -- devoir1, devoir2, examen, cc (contrôle continu). Each weight ≥ 0;
    -- a 0-weight component does not participate in the average. The sum
    -- must be > 0 (at least one component must count).
    grading_recipe     jsonb       not null default '{"devoir1":1,"devoir2":1,"examen":2,"cc":0}'::jsonb,
    weekly_hours       numeric(4,1) check (weekly_hours is null or weekly_hours > 0),
    is_active          boolean     not null default true,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (tenant_id, subject_id, academic_year_id, academic_level_id, direction),
    -- Recipe integrity: all four keys present, non-null, numeric ≥ 0, sum > 0.
    constraint subject_configurations_recipe_shape check (
        jsonb_typeof(grading_recipe) = 'object'
        and grading_recipe ? 'devoir1' and grading_recipe ? 'devoir2'
        and grading_recipe ? 'examen' and grading_recipe ? 'cc'
        and grading_recipe->>'devoir1' is not null
        and grading_recipe->>'devoir2' is not null
        and grading_recipe->>'examen' is not null
        and grading_recipe->>'cc' is not null
        and (grading_recipe->>'devoir1')::numeric >= 0
        and (grading_recipe->>'devoir2')::numeric >= 0
        and (grading_recipe->>'examen')::numeric >= 0
        and (grading_recipe->>'cc')::numeric >= 0
        and ((grading_recipe->>'devoir1')::numeric
           + (grading_recipe->>'devoir2')::numeric
           + (grading_recipe->>'examen')::numeric
           + (grading_recipe->>'cc')::numeric) > 0
    )
);

CREATE INDEX IF NOT EXISTS subject_configurations_lookup_idx
    ON public.subject_configurations (tenant_id, subject_id, academic_year_id, academic_level_id);
CREATE INDEX IF NOT EXISTS subject_configurations_level_idx
    ON public.subject_configurations (academic_level_id, is_active);

-- ----------------------------------------------------------------------------
-- 2. assessments — the contrôle-continu component + its weight snapshot
-- ----------------------------------------------------------------------------
ALTER TABLE public.assessments
    ADD COLUMN IF NOT EXISTS cc NUMERIC(4, 2)
        CHECK (cc IS NULL OR (cc >= 0 AND cc <= 20));
ALTER TABLE public.assessments
    ADD COLUMN IF NOT EXISTS coefficient_cc NUMERIC(4, 2) NOT NULL DEFAULT 0.00
        CHECK (coefficient_cc >= 0);

-- ----------------------------------------------------------------------------
-- 3. The canonical subject-average trigger — recipe-aware generalization
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_assessments_subject_average()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_c1  NUMERIC;
    v_c2  NUMERIC;
    v_c3  NUMERIC;
    v_cc  NUMERIC;
    v_num NUMERIC := 0;
    v_den NUMERIC := 0;
BEGIN
    -- Legacy row with no component marks at all — leave the stored value.
    IF NEW.devoir1 IS NULL AND NEW.devoir2 IS NULL
       AND NEW.examen IS NULL AND NEW.cc IS NULL THEN
        RETURN NEW;
    END IF;

    -- Weight snapshots (the values in force at entry — ADR-018 §3).
    v_c1 := COALESCE(NEW.coefficient_devoir1, 1.00);
    v_c2 := COALESCE(NEW.coefficient_devoir2, 1.00);
    v_c3 := COALESCE(NEW.coefficient_examen, 2.00);
    v_cc := COALESCE(NEW.coefficient_cc, 0.00);

    -- A positive-weight component is REQUIRED: any missing one makes the
    -- average not computable (NULL — the T-336 honesty rule).
    IF v_c1 > 0 AND NEW.devoir1 IS NULL THEN NEW.subject_average := NULL; RETURN NEW; END IF;
    IF v_c2 > 0 AND NEW.devoir2 IS NULL THEN NEW.subject_average := NULL; RETURN NEW; END IF;
    IF v_c3 > 0 AND NEW.examen IS NULL THEN NEW.subject_average := NULL; RETURN NEW; END IF;
    IF v_cc > 0 AND NEW.cc      IS NULL THEN NEW.subject_average := NULL; RETURN NEW; END IF;

    IF v_c1 > 0 THEN v_num := v_num + NEW.devoir1 * v_c1; v_den := v_den + v_c1; END IF;
    IF v_c2 > 0 THEN v_num := v_num + NEW.devoir2 * v_c2; v_den := v_den + v_c2; END IF;
    IF v_c3 > 0 THEN v_num := v_num + NEW.examen * v_c3; v_den := v_den + v_c3; END IF;
    IF v_cc > 0 THEN v_num := v_num + NEW.cc      * v_cc; v_den := v_den + v_cc; END IF;

    IF v_den = 0 THEN
        NEW.subject_average := NULL;
        RETURN NEW;
    END IF;

    NEW.subject_average := ROUND((v_num / v_den)::numeric, 2);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assessments_compute_subject_average ON public.assessments;
CREATE TRIGGER assessments_compute_subject_average
    BEFORE INSERT OR UPDATE OF devoir1, devoir2, examen, cc,
                               coefficient_devoir1, coefficient_devoir2,
                               coefficient_examen, coefficient_cc
    ON public.assessments
    FOR EACH ROW EXECUTE FUNCTION public.compute_assessments_subject_average();

-- ----------------------------------------------------------------------------
-- 4. upsert_assessment_from_import — the cc passthrough (defaults preserve
--    every existing caller byte-for-byte).
--    NOTE: the parameter list GREW (p_cc, p_coefficient_cc), so a plain
--    CREATE OR REPLACE would create a second OVERLOAD (ambiguous calls —
--    caught by the T-344 dry run). Drop the 0041 signature FIRST, then
--    create the extended one (same transaction: atomic for PostgREST
--    callers).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_assessment_from_import(
    UUID, UUID, UUID, INT, TEXT, UUID,
    NUMERIC, NUMERIC, NUMERIC,
    NUMERIC, NUMERIC, NUMERIC, NUMERIC,
    UUID, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.upsert_assessment_from_import(
    p_tenant_id            UUID,
    p_student_id           UUID,
    p_subject_id           UUID,
    p_term                 INT,
    p_academic_year        TEXT,
    p_class_id             UUID DEFAULT NULL,
    p_devoir1              NUMERIC(4,2) DEFAULT NULL,
    p_devoir2              NUMERIC(4,2) DEFAULT NULL,
    p_examen               NUMERIC(4,2) DEFAULT NULL,
    p_cc                   NUMERIC(4,2) DEFAULT NULL,
    p_coefficient          NUMERIC(4,2) DEFAULT 1.00,
    p_coefficient_devoir1  NUMERIC(4,2) DEFAULT 1.00,
    p_coefficient_devoir2  NUMERIC(4,2) DEFAULT 1.00,
    p_coefficient_examen   NUMERIC(4,2) DEFAULT 2.00,
    p_coefficient_cc       NUMERIC(4,2) DEFAULT 0.00,
    p_entered_by           UUID DEFAULT NULL,
    p_entered_at           TIMESTAMPTZ DEFAULT NOW()
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.assessments (
        tenant_id, student_id, subject_id, class_id, term, academic_year,
        devoir1, devoir2, examen, cc, coefficient,
        coefficient_devoir1, coefficient_devoir2, coefficient_examen, coefficient_cc,
        entered_by, entered_at, created_at, updated_at
    ) VALUES (
        p_tenant_id, p_student_id, p_subject_id, p_class_id,
        GREATEST(1, LEAST(3, p_term)), p_academic_year,
        p_devoir1, p_devoir2, p_examen, p_cc, p_coefficient,
        p_coefficient_devoir1, p_coefficient_devoir2, p_coefficient_examen, p_coefficient_cc,
        p_entered_by, p_entered_at, NOW(), NOW()
    )
    ON CONFLICT (student_id, subject_id, term, academic_year) DO UPDATE SET
        devoir1 = EXCLUDED.devoir1,
        devoir2 = EXCLUDED.devoir2,
        examen  = EXCLUDED.examen,
        cc      = EXCLUDED.cc,
        coefficient = EXCLUDED.coefficient,
        coefficient_devoir1 = EXCLUDED.coefficient_devoir1,
        coefficient_devoir2 = EXCLUDED.coefficient_devoir2,
        coefficient_examen  = EXCLUDED.coefficient_examen,
        coefficient_cc      = EXCLUDED.coefficient_cc,
        class_id  = COALESCE(EXCLUDED.class_id, public.assessments.class_id),
        entered_by = EXCLUDED.entered_by,
        entered_at = EXCLUDED.entered_at,
        updated_at = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.upsert_assessment_from_import IS
    'Idempotent canonical assessment upsert (conflict key: student, subject, term, academic year). subject_average is recomputed by the assessments_compute_subject_average trigger — the canonical recipe rule Σ(mark×weight)/Σ(weight) over positive-weight components (devoir1, devoir2, examen, cc — ADR-018).';

-- ----------------------------------------------------------------------------
-- 5. exam_sessions — first-class séances de composition
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_sessions (
    id                uuid        primary key default public.gen_uuid(),
    tenant_id         uuid        not null references public.tenants(id) on delete cascade,
    class_id          uuid        not null references public.classes(id) on delete cascade,
    subject_id        uuid        not null references public.subjects(id) on delete restrict,
    academic_year_id  uuid        not null references public.academic_years(id) on delete cascade,
    term              integer     not null check (term in (1, 2, 3)),
    kind              text        not null check (kind in ('devoir_1', 'devoir_2', 'examen', 'cc')),
    label             text,
    scheduled_at      date        not null,
    start_time        time,
    end_time          time,
    room              text,
    max_score         numeric(5,2) not null default 20.00 check (max_score > 0),
    supervisor_id     uuid,                          -- personnel.id
    notes             text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (tenant_id, class_id, subject_id, term, kind, scheduled_at)
);

CREATE INDEX IF NOT EXISTS exam_sessions_class_idx
    ON public.exam_sessions (class_id, term, scheduled_at);
CREATE INDEX IF NOT EXISTS exam_sessions_year_idx
    ON public.exam_sessions (academic_year_id, scheduled_at);

-- ----------------------------------------------------------------------------
-- 6. updated_at triggers for the two new tables
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS subject_configurations_touch_updated_at ON public.subject_configurations;
CREATE TRIGGER subject_configurations_touch_updated_at before update on public.subject_configurations
    for each row execute function public.touch_updated_at();

DROP TRIGGER IF EXISTS exam_sessions_touch_updated_at ON public.exam_sessions;
CREATE TRIGGER exam_sessions_touch_updated_at before update on public.exam_sessions
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 7. RLS — the 0019 pattern (tenant-scoped select; staff write)
-- ----------------------------------------------------------------------------
ALTER TABLE public.subject_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subject_configurations_select ON public.subject_configurations;
CREATE POLICY subject_configurations_select ON public.subject_configurations
    FOR SELECT TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS subject_configurations_admin ON public.subject_configurations;
CREATE POLICY subject_configurations_admin ON public.subject_configurations
    FOR ALL TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin', 'support_staff']))
    WITH CHECK (tenant_id = public.current_tenant_id()
                AND public.has_any_role(ARRAY['super_admin', 'support_staff']));

DROP POLICY IF EXISTS exam_sessions_select ON public.exam_sessions;
CREATE POLICY exam_sessions_select ON public.exam_sessions
    FOR SELECT TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS exam_sessions_admin ON public.exam_sessions;
CREATE POLICY exam_sessions_admin ON public.exam_sessions
    FOR ALL TO AUTHENTICATED
    USING (tenant_id = public.current_tenant_id()
           AND public.has_any_role(ARRAY['super_admin', 'support_staff', 'teacher']))
    WITH CHECK (tenant_id = public.current_tenant_id()
                AND public.has_any_role(ARRAY['super_admin', 'support_staff']));

-- ----------------------------------------------------------------------------
-- 8. Seed — configurations for every subject × the levels of its own cycle ×
--    the current academic year, preserving the live values bit-for-bit.
--    (Cross-cycle configurations are admin-created, never guessed — ADR-018.)
-- ----------------------------------------------------------------------------
INSERT INTO public.subject_configurations (
    tenant_id, subject_id, academic_year_id, academic_level_id, direction,
    coefficient, subject_code, passing_grade, is_extracurricular,
    grading_recipe, is_active
)
SELECT
    s.tenant_id,
    s.id,
    ay.id,
    al.id,
    'general',
    COALESCE(s.default_coefficient, 1),
    NULL,                                   -- falls back to subjects.code
    COALESCE(s.passing_grade, 10.00),
    COALESCE(s.is_extracurricular, FALSE),
    '{"devoir1":1,"devoir2":1,"examen":2,"cc":0}'::jsonb,
    TRUE
FROM public.subjects s
JOIN public.academic_levels al ON al.cycle = s.cycle AND al.is_active
CROSS JOIN public.academic_years ay
WHERE ay.is_current
ON CONFLICT (tenant_id, subject_id, academic_year_id, academic_level_id, direction)
DO NOTHING;
