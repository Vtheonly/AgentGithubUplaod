-- ============================================================================
-- EL-IMTIYAZ EDUCATIONAL PLATFORM
-- Migration: 20260805_academics_module.sql
-- Module: Pédagogie (Academics, Grading, Attendance, Homework, Promotion)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. ACADEMIC YEARS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.academic_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    code TEXT NOT NULL, -- e.g. "2025-2026"
    label TEXT NOT NULL, -- e.g. "Année Scolaire 2025-2026"
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    term_structure TEXT NOT NULL DEFAULT 'trimester' CHECK (term_structure IN ('semester', 'trimester', 'quarter')),
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_academic_years_tenant_code UNIQUE (tenant_id, code)
);

-- ----------------------------------------------------------------------------
-- 2. ACADEMIC LEVELS (Scolarité Cycles)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.academic_levels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    cycle TEXT NOT NULL CHECK (cycle IN ('prescolaire', 'primaire', 'cem', 'lycee')),
    grade_code TEXT NOT NULL, -- e.g. 'prescolaire_1', '1ap', '1am', '1ere_annee'
    label_fr TEXT NOT NULL,
    label_ar TEXT,
    year_number INT NOT NULL, -- 0 for prescolaire, 1..5 for primary, 1..4 for CEM, 1..3 for Lycee
    sort_order INT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_academic_levels_tenant_grade UNIQUE (tenant_id, grade_code)
);

-- ----------------------------------------------------------------------------
-- 3. CLASSES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
    academic_level_id UUID NOT NULL REFERENCES public.academic_levels(id) ON DELETE RESTRICT,
    code TEXT NOT NULL, -- e.g. "CLS-4AP-A"
    name TEXT NOT NULL, -- e.g. "4ème Année A"
    grade_code TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT 'A',
    room TEXT,
    capacity INT NOT NULL DEFAULT 30 CHECK (capacity > 0),
    homeroom_teacher_id UUID,
    homeroom_teacher_name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_classes_tenant_code_year UNIQUE (tenant_id, code, academic_year_id)
);

-- ----------------------------------------------------------------------------
-- 4. SUBJECTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    code TEXT NOT NULL, -- e.g. 'MATH', 'AR', 'FR', 'CHESS'
    name_fr TEXT NOT NULL,
    name_ar TEXT,
    cycle TEXT NOT NULL CHECK (cycle IN ('prescolaire', 'primaire', 'cem', 'lycee')),
    default_coefficient NUMERIC(4, 2) NOT NULL DEFAULT 1.00 CHECK (default_coefficient > 0),
    passing_grade NUMERIC(4, 2) NOT NULL DEFAULT 10.00 CHECK (passing_grade >= 0 AND passing_grade <= 20),
    is_extracurricular BOOLEAN NOT NULL DEFAULT FALSE, -- Scolarité vs Clubs/Therapy split
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subjects_tenant_code_cycle UNIQUE (tenant_id, code, cycle)
);

-- ----------------------------------------------------------------------------
-- 5. CLASS SUBJECT ASSIGNMENTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
    teacher_id UUID,
    teacher_name TEXT,
    weekly_hours NUMERIC(4, 1) NOT NULL DEFAULT 2.0 CHECK (weekly_hours > 0),
    coefficient NUMERIC(4, 2) NOT NULL DEFAULT 1.00 CHECK (coefficient > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_class_subjects_class_subject UNIQUE (class_id, subject_id)
);

-- ----------------------------------------------------------------------------
-- 6. ASSESSMENTS (Grades)
-- Standard Formula: Subject Average = (Devoir 1 + Devoir 2 + 2 * Examen) / 4
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    student_id UUID NOT NULL, -- References public.students(id)
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
    term TEXT NOT NULL CHECK (term IN ('T1', 'T2', 'T3')),
    academic_year TEXT NOT NULL,
    devoir1 NUMERIC(4, 2) CHECK (devoir1 IS NULL OR (devoir1 >= 0 AND devoir1 <= 20)),
    devoir2 NUMERIC(4, 2) CHECK (devoir2 IS NULL OR (devoir2 >= 0 AND devoir2 <= 20)),
    examen NUMERIC(4, 2) CHECK (examen IS NULL OR (examen >= 0 AND examen <= 20)),
    subject_average NUMERIC(4, 2) GENERATED ALWAYS AS (
        CASE 
            WHEN devoir1 IS NULL AND devoir2 IS NULL AND examen IS NULL THEN NULL
            ELSE (COALESCE(devoir1, 0) + COALESCE(devoir2, 0) + (COALESCE(examen, 0) * 2)) / 4.0
        END
    ) STORED,
    coefficient NUMERIC(4, 2) NOT NULL DEFAULT 1.00,
    entered_by UUID NOT NULL,
    entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_assessments_student_subject_term_year UNIQUE (student_id, subject_id, term, academic_year)
);

-- ----------------------------------------------------------------------------
-- 7. ATTENDANCE RECORDS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    student_id UUID NOT NULL, -- References public.students(id)
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    record_date DATE NOT NULL,
    session TEXT NOT NULL DEFAULT 'morning' CHECK (session IN ('morning', 'afternoon', 'both')),
    status TEXT NOT NULL CHECK (status IN ('present', 'absent_excused', 'absent_unexcused', 'late')),
    note TEXT,
    recorded_by UUID NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_attendance_student_date_session UNIQUE (student_id, record_date, session)
);

-- ----------------------------------------------------------------------------
-- 8. HOMEWORK ASSIGNMENTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.homework (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
    subject_name TEXT NOT NULL,
    teacher_id UUID NOT NULL,
    teacher_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    due_date DATE NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    academic_year TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pushed_at TIMESTAMPTZ,
    acknowledged_count INT NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- 9. PERMANENT ACADEMIC HISTORY (Transcripts & Promotion History)
-- Append-only record of year-end student promotion/retention decisions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_academic_histories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    student_id UUID NOT NULL, -- References public.students(id)
    academic_year TEXT NOT NULL,
    cycle TEXT NOT NULL CHECK (cycle IN ('prescolaire', 'primaire', 'cem', 'lycee')),
    grade_code TEXT NOT NULL,
    grade_year INT NOT NULL,
    class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
    class_name TEXT,
    gpa NUMERIC(4, 2) NOT NULL CHECK (gpa >= 0 AND gpa <= 20),
    rank INT,
    decision TEXT NOT NULL CHECK (decision IN ('promoted', 'repeated', 'graduated', 'transferred')),
    narrative TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_academic_history_student_year UNIQUE (student_id, academic_year)
);

-- ----------------------------------------------------------------------------
-- INDICES FOR HIGH-PERFORMANCE QUERIES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_classes_tenant_year ON public.classes(tenant_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_class ON public.class_subjects(class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_student_term ON public.assessments(student_id, academic_year, term);
CREATE INDEX IF NOT EXISTS idx_assessments_class ON public.assessments(class_id, academic_year, term);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON public.attendance_records(student_id, record_date);
CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON public.attendance_records(class_id, record_date);
CREATE INDEX IF NOT EXISTS idx_homework_class_due ON public.homework(class_id, due_date);
CREATE INDEX IF NOT EXISTS idx_academic_history_student ON public.student_academic_histories(student_id);

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_academic_histories ENABLE ROW LEVEL SECURITY;

-- Helper RLS condition for tenant isolation
CREATE OR REPLACE FUNCTION public.fn_current_tenant_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE POLICY rls_academic_years_tenant ON public.academic_years
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

CREATE POLICY rls_academic_levels_tenant ON public.academic_levels
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

CREATE POLICY rls_classes_tenant ON public.classes
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

CREATE POLICY rls_subjects_tenant ON public.subjects
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

CREATE POLICY rls_class_subjects_tenant ON public.class_subjects
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

CREATE POLICY rls_assessments_tenant ON public.assessments
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

CREATE POLICY rls_attendance_records_tenant ON public.attendance_records
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

CREATE POLICY rls_homework_tenant ON public.homework
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

CREATE POLICY rls_student_academic_histories_tenant ON public.student_academic_histories
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

-- ----------------------------------------------------------------------------
-- STORED PROCEDURE: CALCULATE OVERALL GPA FOR A STUDENT IN A TERM
-- Ignores Extracurricular subjects in the Scolarité GPA calculation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_calculate_student_term_gpa(
    p_student_id UUID,
    p_term TEXT,
    p_academic_year TEXT
) RETURNS NUMERIC(4,2) AS $$
DECLARE
    v_weighted_sum NUMERIC(10, 4) := 0;
    v_total_coef NUMERIC(10, 4) := 0;
    v_rec RECORD;
BEGIN
    FOR v_rec IN 
        SELECT 
            a.subject_average,
            a.coefficient
        FROM public.assessments a
        JOIN public.subjects s ON a.subject_id = s.id
        WHERE a.student_id = p_student_id
          AND a.term = p_term
          AND a.academic_year = p_academic_year
          AND a.subject_average IS NOT NULL
          AND s.is_extracurricular = FALSE
    LOOP
        v_weighted_sum := v_weighted_sum + (v_rec.subject_average * v_rec.coefficient);
        v_total_coef := v_total_coef + v_rec.coefficient;
    END LOOP;

    IF v_total_coef = 0 THEN
        RETURN NULL;
    END IF;

    RETURN ROUND((v_weighted_sum / v_total_coef)::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql STABLE;