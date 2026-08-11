-- ============================================================================
-- EL-IMTIYAZ EDUCATIONAL PLATFORM
-- Migration: 20260805_academics_module.sql
-- Module: Pédagogie (Academics, Grading, Attendance, Homework, Promotion)
--
-- NOTE: This migration is ADDITIVE. The core academic tables (academic_years,
-- academic_levels, classes, subjects, class_subjects, assessments,
-- attendance_records) already exist from migration 0004 with a different
-- schema. This migration:
--   1. Adds the NEW columns required by the 2026 academic module to the
--      existing tables (via ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
--   2. Creates the NEW tables (homework, student_academic_histories).
--   3. Creates indexes only on columns that exist.
--   4. Creates RLS policies (idempotent via DROP POLICY IF EXISTS).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. ACADEMIC YEARS — add `code` column (existing table from 0004)
-- ----------------------------------------------------------------------------
ALTER TABLE public.academic_years ADD COLUMN IF NOT EXISTS code TEXT;

-- ----------------------------------------------------------------------------
-- 2. ACADEMIC LEVELS — add label_fr / label_ar (existing table from 0004)
-- ----------------------------------------------------------------------------
ALTER TABLE public.academic_levels ADD COLUMN IF NOT EXISTS label_fr TEXT;
ALTER TABLE public.academic_levels ADD COLUMN IF NOT EXISTS label_ar TEXT;

-- ----------------------------------------------------------------------------
-- 3. CLASSES — add grade_code / homeroom_teacher_name (existing table from 0004)
-- ----------------------------------------------------------------------------
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS grade_code TEXT;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS homeroom_teacher_name TEXT;

-- ----------------------------------------------------------------------------
-- 4. SUBJECTS — add cycle / passing_grade / is_extracurricular (existing from 0004)
-- ----------------------------------------------------------------------------
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS cycle TEXT
    CHECK (cycle IS NULL OR cycle IN ('prescolaire', 'primaire', 'cem', 'lycee'));
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS passing_grade NUMERIC(4, 2)
    DEFAULT 10.00 CHECK (passing_grade >= 0 AND passing_grade <= 20);
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS is_extracurricular BOOLEAN
    NOT NULL DEFAULT FALSE;

-- ----------------------------------------------------------------------------
-- 5. CLASS SUBJECTS — add teacher_name / weekly_hours (existing from 0004)
-- ----------------------------------------------------------------------------
ALTER TABLE public.class_subjects ADD COLUMN IF NOT EXISTS teacher_name TEXT;
ALTER TABLE public.class_subjects ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC(4, 1)
    DEFAULT 2.0 CHECK (weekly_hours > 0);

-- ----------------------------------------------------------------------------
-- 6. ASSESSMENTS — add the 2026 columns (existing table from 0004)
-- The 0004 schema has: class_subject_id, term (integer), kind, label, max_score,
-- weight, scheduled_at. The 2026 module adds: student_id, class_id, subject_id,
-- term (text), academic_year, devoir1, devoir2, examen, subject_average,
-- coefficient, entered_by, entered_at.
-- ----------------------------------------------------------------------------
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS student_id UUID;
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS class_id UUID
    REFERENCES public.classes(id) ON DELETE CASCADE;
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS subject_id UUID
    REFERENCES public.subjects(id) ON DELETE RESTRICT;
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS academic_year TEXT;
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS devoir1 NUMERIC(4, 2)
    CHECK (devoir1 IS NULL OR (devoir1 >= 0 AND devoir1 <= 20));
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS devoir2 NUMERIC(4, 2)
    CHECK (devoir2 IS NULL OR (devoir2 >= 0 AND devoir2 <= 20));
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS examen NUMERIC(4, 2)
    CHECK (examen IS NULL OR (examen >= 0 AND examen <= 20));
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS subject_average NUMERIC(4, 2);
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS coefficient NUMERIC(4, 2)
    NOT NULL DEFAULT 1.00 CHECK (coefficient > 0);
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS entered_by UUID;
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS entered_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW();

-- ----------------------------------------------------------------------------
-- 7. ATTENDANCE RECORDS — add the 2026 columns (existing table from 0004)
-- The 0004 schema has: class_subject_id, date, arrival_time, recorded_by.
-- The 2026 module adds: record_date, session, recorded_at, synced_at.
-- ----------------------------------------------------------------------------
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS record_date DATE;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS session TEXT
    DEFAULT 'morning' CHECK (session IN ('morning', 'afternoon', 'both'));
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW();
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ
    DEFAULT NOW();

-- ----------------------------------------------------------------------------
-- 8. HOMEWORK ASSIGNMENTS (NEW table — 2026 module)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.homework (
    id UUID PRIMARY KEY DEFAULT public.gen_uuid(),
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
-- 9. PERMANENT ACADEMIC HISTORY (NEW table — 2026 module)
-- Append-only record of year-end student promotion/retention decisions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_academic_histories (
    id UUID PRIMARY KEY DEFAULT public.gen_uuid(),
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
-- Only create indexes on columns that exist in the (possibly pre-existing) tables.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_classes_tenant_year ON public.classes(tenant_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_class ON public.class_subjects(class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_student_term ON public.assessments(student_id, academic_year, term)
    WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assessments_class ON public.assessments(class_id, academic_year, term)
    WHERE class_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON public.attendance_records(student_id, record_date)
    WHERE record_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON public.attendance_records(class_id, record_date)
    WHERE record_date IS NOT NULL;
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

DROP POLICY IF EXISTS rls_academic_years_tenant ON public.academic_years;
CREATE POLICY rls_academic_years_tenant ON public.academic_years
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

DROP POLICY IF EXISTS rls_academic_levels_tenant ON public.academic_levels;
CREATE POLICY rls_academic_levels_tenant ON public.academic_levels
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

DROP POLICY IF EXISTS rls_classes_tenant ON public.classes;
CREATE POLICY rls_classes_tenant ON public.classes
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

DROP POLICY IF EXISTS rls_subjects_tenant ON public.subjects;
CREATE POLICY rls_subjects_tenant ON public.subjects
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

DROP POLICY IF EXISTS rls_class_subjects_tenant ON public.class_subjects;
CREATE POLICY rls_class_subjects_tenant ON public.class_subjects
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

DROP POLICY IF EXISTS rls_assessments_tenant ON public.assessments;
CREATE POLICY rls_assessments_tenant ON public.assessments
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

DROP POLICY IF EXISTS rls_attendance_records_tenant ON public.attendance_records;
CREATE POLICY rls_attendance_records_tenant ON public.attendance_records
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

DROP POLICY IF EXISTS rls_homework_tenant ON public.homework;
CREATE POLICY rls_homework_tenant ON public.homework
    FOR ALL USING (tenant_id = public.fn_current_tenant_id());

DROP POLICY IF EXISTS rls_student_academic_histories_tenant ON public.student_academic_histories;
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
          AND a.term::text = p_term
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