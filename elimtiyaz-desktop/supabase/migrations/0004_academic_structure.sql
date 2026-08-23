-- ============================================================================
-- 0004_academic_structure.sql
-- ============================================================================
-- Academic years, levels (Primaire/CEM/Lycee), classes, subjects,
-- class-subject assignments, academic history.
--
-- Per plan §04:
--   - Three-tier Scolarite hierarchy: Primaire (5 years), CEM (4 years), Lycee (3 years)
--   - Subject mapping driven from DB (not hardcoded)
--   - Coefficient changes audited; trigger GPA recompute
--   - Academic history is append-only (archived yearly)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. academic_years
-- ----------------------------------------------------------------------------
create table public.academic_years (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    label           text        not null,                          -- '2026-2027'
    start_date      date        not null,
    end_date        date        not null,
    term_structure  text        not null check (term_structure in ('semester', 'trimester', 'quarter')),
    is_current      boolean     not null default false,
    is_archived     boolean     not null default false,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, label)
);

create index academic_years_tenant_idx on public.academic_years (tenant_id, start_date desc);

-- ----------------------------------------------------------------------------
-- 2. academic_levels — Primaire / CEM / Lycee cycles
-- ----------------------------------------------------------------------------
create table public.academic_levels (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    cycle           text        not null check (cycle in ('primaire', 'cem', 'lycee', 'prescolaire')),
    year_label      text        not null,                          -- 'Grade 1', 'Year 1', 'Grande Section', etc.
    year_number     integer     not null,                          -- 1..5 for primaire, 1..4 for CEM, 1..3 for lycee
    grade_code      text        not null,                          -- '1ap', '1am', '1ere_annee', etc.
    sort_order      integer     not null,
    is_active       boolean     not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, grade_code)
);

create index academic_levels_tenant_cycle_idx on public.academic_levels (tenant_id, cycle, year_number);

-- ----------------------------------------------------------------------------
-- 3. classes — concrete class sections
-- ----------------------------------------------------------------------------
create table public.classes (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    academic_year_id uuid       not null references public.academic_years(id) on delete restrict,
    academic_level_id uuid      not null references public.academic_levels(id) on delete restrict,
    section         text        not null,                          -- 'A', 'B', 'C' or '' if single section
    code            text        not null,                          -- 'CP-A', '1AAM-B', etc.
    name            text,                                          -- 'CP Section A'
    capacity        integer     not null default 30,
    homeroom_teacher_id uuid,                                     -- FK to personnel(id), filled in 0009
    room            text,
    is_active       boolean     not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, academic_year_id, code)
);

create index classes_tenant_year_idx on public.classes (tenant_id, academic_year_id, code);
create index classes_level_idx on public.classes (academic_level_id);

-- ----------------------------------------------------------------------------
-- 4. subjects — catalog of teachable subjects
-- ----------------------------------------------------------------------------
create table public.subjects (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    code            text        not null,                          -- 'MATH', 'ARAB', 'PHYS', etc.
    name_fr         text        not null,
    name_ar         text,
    name_en         text,
    domain          text        not null check (domain in ('scolarite', 'club', 'therapy', 'auxiliary'))
                    default 'scolarite',
    default_coefficient integer  not null default 1 check (default_coefficient > 0),
    is_active       boolean     not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, code)
);

create index subjects_tenant_idx on public.subjects (tenant_id, domain, is_active);

-- ----------------------------------------------------------------------------
-- 5. class_subjects — many-to-many with per-class coefficient + teacher
-- ----------------------------------------------------------------------------
create table public.class_subjects (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    class_id        uuid        not null references public.classes(id) on delete cascade,
    subject_id      uuid        not null references public.subjects(id) on delete restrict,
    teacher_id      uuid,                                          -- FK to personnel(id), filled in 0009
    coefficient     integer     not null default 1 check (coefficient > 0),
    is_active       boolean     not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, class_id, subject_id)
);

create index class_subjects_class_idx on public.class_subjects (class_id, is_active);
create index class_subjects_teacher_idx on public.class_subjects (teacher_id) where teacher_id is not null;

-- ----------------------------------------------------------------------------
-- 6. assessments — Devoir 1, Devoir 2, Examen per subject per term
-- ----------------------------------------------------------------------------
create table public.assessments (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    class_subject_id uuid       not null references public.class_subjects(id) on delete cascade,
    term            integer     not null check (term in (1, 2, 3)),  -- trimester
    kind            text        not null check (kind in ('devoir_1', 'devoir_2', 'examen')),
    label           text,                                          -- 'Devoir 1 Trimestre 1'
    max_score       numeric(5,2) not null default 20.00 check (max_score > 0),
    weight          numeric(5,2) not null default 1.00,
    scheduled_at    date,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, class_subject_id, term, kind)
);

create index assessments_class_subject_idx on public.assessments (class_subject_id, term);

-- ----------------------------------------------------------------------------
-- 7. grades — actual scores entered by teachers
-- ----------------------------------------------------------------------------
create table public.grades (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    student_id      uuid        not null,                            -- FK to students(id), filled in 0005
    assessment_id   uuid        not null references public.assessments(id) on delete cascade,
    class_subject_id uuid       not null references public.class_subjects(id) on delete cascade,
    score           numeric(5,2) not null check (score >= 0 and score <= 20),
    subject_average numeric(5,2)                                      -- computed (d1+d2+2*ex)/4
                       check (subject_average is null or (subject_average >= 0 and subject_average <= 20)),
    is_absent       boolean     not null default false,
    entered_by      uuid,                                            -- user_profiles.id
    entered_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, student_id, assessment_id)
);

create index grades_student_idx on public.grades (student_id, class_subject_id);
create index grades_class_subject_idx on public.grades (class_subject_id);
create index grades_tenant_student_idx on public.grades (tenant_id, student_id);

-- ----------------------------------------------------------------------------
-- 8. attendance_records — 4-status roll call
-- ----------------------------------------------------------------------------
create table public.attendance_records (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    student_id      uuid        not null,                            -- FK to students(id)
    class_id        uuid        not null references public.classes(id) on delete cascade,
    class_subject_id uuid,                                           -- nullable for homeroom roll call
    date            date        not null,
    status          text        not null check (status in ('present', 'absent_excused', 'absent_unexcused', 'late')),
    arrival_time    time,                                            -- required when status='late'
    note            text,
    recorded_by     uuid,                                            -- user_profiles.id (teacher)
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create unique index attendance_records_unique_session_uidx on public.attendance_records (tenant_id, student_id, class_id, date, coalesce(class_subject_id, '00000000-0000-0000-0000-000000000000'));

create index attendance_student_date_idx on public.attendance_records (student_id, date desc);
create index attendance_class_date_idx on public.attendance_records (class_id, date);
create index attendance_tenant_status_idx on public.attendance_records (tenant_id, status, date);

-- ----------------------------------------------------------------------------
-- 9. homework_assignments — immutable after due date (per plan §05.07)
-- ----------------------------------------------------------------------------
create table public.homework_assignments (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    class_subject_id uuid       not null references public.class_subjects(id) on delete cascade,
    target_class_id uuid        not null references public.classes(id) on delete cascade,
    title           text        not null,
    description     text        not null,
    attachment_path text,                                            -- storage path under bucket 'homework-attachments'
    due_date        date        not null,
    created_by      uuid        not null,                            -- user_profiles.id (teacher)
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
    -- is_locked is computed at query time as (due_date < current_date);
    -- a generated column cannot use current_date (STABLE, not IMMUTABLE).
);

create index homework_class_idx on public.homework_assignments (target_class_id, due_date desc);
create index homework_teacher_idx on public.homework_assignments (created_by, created_at desc);

-- ----------------------------------------------------------------------------
-- 10. academic_history — archived yearly, append-only (per plan §04)
-- ----------------------------------------------------------------------------
create table public.academic_history (
    id              uuid        primary key default public.gen_uuid(),
    tenant_id       uuid        not null references public.tenants(id) on delete cascade,
    student_id      uuid        not null,                            -- FK to students(id)
    academic_year_id uuid       not null references public.academic_years(id) on delete restrict,
    academic_level_id uuid      not null references public.academic_levels(id) on delete restrict,
    class_id        uuid        references public.classes(id) on delete set null,
    gpa             numeric(5,2),
    decision        text        check (decision in ('approved_for_promotion', 'retained_same_year', 'withdrawn', 'graduated')),
    subject_grades_json jsonb   not null default '{}'::jsonb,        -- snapshot of all subject grades
    attendance_summary jsonb    not null default '{}'::jsonb,        -- {present: n, absent: n, late: n, excused: n}
    teacher_observations text,
    archived_at     timestamptz not null default now(),
    unique (tenant_id, student_id, academic_year_id)
);

create index academic_history_student_idx on public.academic_history (student_id, academic_year_id);

-- ----------------------------------------------------------------------------
-- 11. Triggers: updated_at
-- ----------------------------------------------------------------------------
create trigger academic_years_touch_updated_at before update on public.academic_years
    for each row execute function public.touch_updated_at();
create trigger academic_levels_touch_updated_at before update on public.academic_levels
    for each row execute function public.touch_updated_at();
create trigger classes_touch_updated_at before update on public.classes
    for each row execute function public.touch_updated_at();
create trigger subjects_touch_updated_at before update on public.subjects
    for each row execute function public.touch_updated_at();
create trigger class_subjects_touch_updated_at before update on public.class_subjects
    for each row execute function public.touch_updated_at();
create trigger assessments_touch_updated_at before update on public.assessments
    for each row execute function public.touch_updated_at();
create trigger grades_touch_updated_at before update on public.grades
    for each row execute function public.touch_updated_at();
create trigger attendance_records_touch_updated_at before update on public.attendance_records
    for each row execute function public.touch_updated_at();
create trigger homework_assignments_touch_updated_at before update on public.homework_assignments
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 12. Trigger: auto-compute subject_average on grade insert/update
-- ----------------------------------------------------------------------------
create or replace function public.compute_grade_subject_average()
returns trigger
language plpgsql
security definer
as $$
declare
    v_term integer;
    v_class_subject_id uuid := new.class_subject_id;
    v_student_id uuid := new.student_id;
    v_d1 numeric;
    v_d2 numeric;
    v_ex numeric;
begin
    -- Determine the term from the assessment
    select term into v_term from public.assessments where id = new.assessment_id;
    if v_term is null then
        return new;
    end if;

    -- Look up D1, D2, Examen scores for this student/subject/term
    select g.score into v_d1
      from public.grades g
      join public.assessments a on a.id = g.assessment_id
     where g.student_id = v_student_id
       and g.class_subject_id = v_class_subject_id
       and a.term = v_term
       and a.kind = 'devoir_1';

    select g.score into v_d2
      from public.grades g
      join public.assessments a on a.id = g.assessment_id
     where g.student_id = v_student_id
       and g.class_subject_id = v_class_subject_id
       and a.term = v_term
       and a.kind = 'devoir_2';

    select g.score into v_ex
      from public.grades g
      join public.assessments a on a.id = g.assessment_id
     where g.student_id = v_student_id
       and g.class_subject_id = v_class_subject_id
       and a.term = v_term
       and a.kind = 'examen';

    -- BUG FIX (TIER 4): the lookups above only see rows ALREADY IN THE TABLE.
    -- When the completing mark (e.g. the examen) is being INSERTED, its own
    -- lookup returned NULL and the average was never computed — the compute
    -- path could only fire on a subsequent UPDATE. NEW's own score is now
    -- substituted for its kind so the average is set on the completing row.
    if new.assessment_id in (
        select id from public.assessments
         where term = v_term and kind = 'devoir_1'
           and class_subject_id = v_class_subject_id
    ) then
        v_d1 := new.score;
    elsif new.assessment_id in (
        select id from public.assessments
         where term = v_term and kind = 'devoir_2'
           and class_subject_id = v_class_subject_id
    ) then
        v_d2 := new.score;
    elsif new.assessment_id in (
        select id from public.assessments
         where term = v_term and kind = 'examen'
           and class_subject_id = v_class_subject_id
    ) then
        v_ex := new.score;
    end if;

    if v_d1 is not null and v_d2 is not null and v_ex is not null then
        new.subject_average := round(((v_d1 + v_d2 + 2 * v_ex) / 4.0)::numeric, 2);
    end if;

    return new;
end;
$$;

create trigger grades_compute_subject_average
    before insert or update of score on public.grades
    for each row execute function public.compute_grade_subject_average();

comment on function public.compute_grade_subject_average is
  'Auto-computes subject_average = (D1 + D2 + 2*Examen) / 4 per plan §13.03. Triggered on every grade insert/update.';
