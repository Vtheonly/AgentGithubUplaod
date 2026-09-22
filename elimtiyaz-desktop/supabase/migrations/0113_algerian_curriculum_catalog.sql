-- ============================================================================
-- 0113_algerian_curriculum_catalog.sql — T-407 (ACAD-508 + SCHED-106)
-- ============================================================================
-- The Algerian national curriculum catalog, the missing data layer behind
-- the owner's mandate ("the modules and subjects must be handled according
-- to the Algerian system") and the ADR-018 architecture that was already
-- in place (subjects = IDENTITY since 0094, subject_configurations =
-- CONTEXT): the tenant's fresh setup had ZERO subjects and ZERO
-- configurations, so the owner was hand-typing the national matières —
-- through creation flows that were themselves broken (ACAD-506/507).
--
-- WHAT:
--   §1  The national matières as IDENTITY rows (cycle NULL — identity is
--       not context, ADR-018 decision 1; the per-level coefficients live
--       in subject_configurations). Idempotent on (tenant_id, code).
--   §2  The per-level context configurations for the CURRENT academic
--       year × every level × direction 'general'. The 4AM column is the
--       OFFICIAL BEM scale (Arabe 5, Maths 4, PC 2, SVT 2, HG 2, FR 3,
--       EN 2, ISL 2); primaire/lycée carry standard editable defaults —
--       the per-filière BAC coefficients at 2AS/3AS are configured per
--       direction in the SubjectConfigurationsPanel (data, not code).
--       Idempotent on the 0094 unique key. weekly_hours stay NULL: weekly
--       hours belong to the per-class curriculum (class_subjects), never
--       to the directory.
--   §3  Data repair: the seeded academic year carries code = NULL (0023
--       never set it) while the domain contract and the UI (ENS-<year>
--       codes, year pickers) require the "2026-2027" form. Backfill from
--       the label, only when the label IS a year-shaped code.
--   §4  v_timetable_published — the parent-portal projection of the ONE
--       canonical published timetable (SCHED-106): entries of PUBLISHED
--       versions with denormalized subject/teacher/room names. SECURITY
--       DEFINER so parents (who cannot SELECT personnel under RLS) still
--       see the teacher NAME of published entries — and nothing else:
--       published-only, tenant-scoped, name projections only. anon has no
--       access.
--
-- SAFETY / GUARDS:
--   * §1/§2 are pure INSERT … ON CONFLICT DO NOTHING — re-runnable.
--   * §3 is a guarded UPDATE (code IS NULL AND label ~ year shape).
--   * §4 is CREATE OR REPLACE + idempotent GRANT/REVOKE.
--   * No table is created or dropped; no policy changed; RLS untouched.
--
-- POST-CONDITIONS (asserted by scripts/verify_t-407.sql):
--   * 14 national matières present (tenant-scoped), cycle NULL.
--   * subject_configurations rows exist for every configured
--     (subject × level) pair on the current year, direction 'general',
--     with the official BEM coefficients at 4AM.
--   * Every academic year has a non-NULL code.
--   * v_timetable_published is selectable by authenticated, not by anon,
--     and exposes ONLY published-version entries.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. The Algerian national matières — identity rows (ADR-018 decision 1)
-- ----------------------------------------------------------------------------
INSERT INTO public.subjects (tenant_id, code, name_fr, name_ar, name_en, domain, cycle, default_coefficient, passing_grade, is_extracurricular, is_active)
SELECT '00000000-0000-0000-0000-000000000001', c.code, c.name_fr, c.name_ar, c.name_en, 'scolarite', NULL, 1.00, 10.00, false, true
FROM (VALUES
    ('ARABE',         'Langue arabe',                              'اللغة العربية',                 'Arabic'),
    ('MATHS',         'Mathématiques',                             'الرياضيات',                    'Mathematics'),
    ('FRANCAIS',      'Langue française',                          'اللغة الفرنسية',                'French'),
    ('ANGLAIS',       'Langue anglaise',                           'اللغة الإنجليزية',              'English'),
    ('TAMAZIGHT',     'Langue amazighe',                           'الأمازيغية',                    'Tamazight'),
    ('PHYSIQUE',      'Sciences physiques et technologiques',      'العلوم الفيزيائية والتكنولوجيا', 'Physical sciences & technology'),
    ('SVT',           'Sciences de la nature et de la vie',        'علوم الطبيعة والحياة',          'Natural & life sciences'),
    ('EVEIL_SCI',     'Éveil scientifique et technologique',       'التفتح العلمي والتكنولوجي',     'Scientific & technological awakening'),
    ('HIST_GEO',      'Histoire et géographie',                    'التاريخ والجغرافيا',            'History & geography'),
    ('EDU_ISLAM',     'Éducation islamique',                       'التربية الإسلامية',             'Islamic education'),
    ('PHILO',         'Philosophie',                               'الفلسفة',                       'Philosophy'),
    ('INFORMATIQUE',  'Informatique',                              'الإعلام الآلي',                 'Computer science'),
    ('EPS',           'Éducation physique et sportive',            'التربية البدنية والرياضية',     'Physical education'),
    ('EDU_ARTISTIQUE','Éducation artistique',                      'التربية الفنية',                'Arts education')
) AS c(code, name_fr, name_ar, name_en)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- §2. Per-level context configurations — CURRENT year × level × 'general'
-- ----------------------------------------------------------------------------
INSERT INTO public.subject_configurations
    (tenant_id, subject_id, academic_year_id, academic_level_id, direction,
     coefficient, subject_code, passing_grade, is_extracurricular, is_active)
SELECT s.tenant_id, s.id, ay.id, al.id, 'general',
       cfg.coefficient, s.code, 10.00, false, true
FROM public.subjects s
JOIN public.academic_years ay ON ay.tenant_id = s.tenant_id AND ay.is_current
JOIN public.academic_levels al ON al.tenant_id = s.tenant_id
JOIN (VALUES
    -- Préscolaire (éveil / activities weighting)
    ('prescolaire_1','ARABE',1), ('prescolaire_1','MATHS',1), ('prescolaire_1','EVEIL_SCI',1),
    ('prescolaire_1','EDU_ISLAM',1), ('prescolaire_1','EPS',1), ('prescolaire_1','EDU_ARTISTIQUE',1),
    ('prescolaire_2','ARABE',1), ('prescolaire_2','MATHS',1), ('prescolaire_2','EVEIL_SCI',1),
    ('prescolaire_2','EDU_ISLAM',1), ('prescolaire_2','EPS',1), ('prescolaire_2','EDU_ARTISTIQUE',1),
    -- Primaire 1AP/2AP (the national core)
    ('1ap','ARABE',4), ('1ap','MATHS',4), ('1ap','EVEIL_SCI',2), ('1ap','EDU_ISLAM',2),
    ('1ap','EPS',1), ('1ap','EDU_ARTISTIQUE',1),
    ('2ap','ARABE',4), ('2ap','MATHS',4), ('2ap','EVEIL_SCI',2), ('2ap','EDU_ISLAM',2),
    ('2ap','EPS',1), ('2ap','EDU_ARTISTIQUE',1),
    -- Primaire 3AP..5AP (+ FR / EN / Histoire-Géo)
    ('3ap','ARABE',4), ('3ap','MATHS',4), ('3ap','EVEIL_SCI',2), ('3ap','EDU_ISLAM',2),
    ('3ap','FRANCAIS',2), ('3ap','ANGLAIS',2), ('3ap','HIST_GEO',2), ('3ap','EPS',1), ('3ap','EDU_ARTISTIQUE',1),
    ('4ap','ARABE',4), ('4ap','MATHS',4), ('4ap','EVEIL_SCI',2), ('4ap','EDU_ISLAM',2),
    ('4ap','FRANCAIS',2), ('4ap','ANGLAIS',2), ('4ap','HIST_GEO',2), ('4ap','EPS',1), ('4ap','EDU_ARTISTIQUE',1),
    ('5ap','ARABE',4), ('5ap','MATHS',4), ('5ap','EVEIL_SCI',2), ('5ap','EDU_ISLAM',2),
    ('5ap','FRANCAIS',2), ('5ap','ANGLAIS',2), ('5ap','HIST_GEO',2), ('5ap','EPS',1), ('5ap','EDU_ARTISTIQUE',1),
    -- CEM — the OFFICIAL BEM scale (applied 1AM..4AM)
    ('1am','ARABE',5), ('1am','MATHS',4), ('1am','PHYSIQUE',2), ('1am','SVT',2), ('1am','HIST_GEO',2),
    ('1am','FRANCAIS',3), ('1am','ANGLAIS',2), ('1am','EDU_ISLAM',2), ('1am','INFORMATIQUE',1),
    ('1am','EPS',1), ('1am','EDU_ARTISTIQUE',1),
    ('2am','ARABE',5), ('2am','MATHS',4), ('2am','PHYSIQUE',2), ('2am','SVT',2), ('2am','HIST_GEO',2),
    ('2am','FRANCAIS',3), ('2am','ANGLAIS',2), ('2am','EDU_ISLAM',2), ('2am','INFORMATIQUE',1),
    ('2am','EPS',1), ('2am','EDU_ARTISTIQUE',1),
    ('3am','ARABE',5), ('3am','MATHS',4), ('3am','PHYSIQUE',2), ('3am','SVT',2), ('3am','HIST_GEO',2),
    ('3am','FRANCAIS',3), ('3am','ANGLAIS',2), ('3am','EDU_ISLAM',2), ('3am','INFORMATIQUE',1),
    ('3am','EPS',1), ('3am','EDU_ARTISTIQUE',1),
    ('4am','ARABE',5), ('4am','MATHS',4), ('4am','PHYSIQUE',2), ('4am','SVT',2), ('4am','HIST_GEO',2),
    ('4am','FRANCAIS',3), ('4am','ANGLAIS',2), ('4am','EDU_ISLAM',2), ('4am','INFORMATIQUE',1),
    ('4am','EPS',1), ('4am','EDU_ARTISTIQUE',1),
    -- Lycée 1AS (tronc commun — editable defaults)
    ('1ere_annee','ARABE',3), ('1ere_annee','MATHS',4), ('1ere_annee','PHYSIQUE',3), ('1ere_annee','SVT',2),
    ('1ere_annee','HIST_GEO',2), ('1ere_annee','FRANCAIS',2), ('1ere_annee','ANGLAIS',2),
    ('1ere_annee','EDU_ISLAM',2), ('1ere_annee','INFORMATIQUE',1), ('1ere_annee','EPS',1),
    -- Lycée 2AS/3AS ('general' — the per-filière BAC scale is configured
    -- per direction in the SubjectConfigurationsPanel; these are the
    -- standard editable defaults)
    ('2eme_annee','ARABE',3), ('2eme_annee','MATHS',5), ('2eme_annee','PHYSIQUE',4), ('2eme_annee','SVT',4),
    ('2eme_annee','HIST_GEO',2), ('2eme_annee','FRANCAIS',2), ('2eme_annee','ANGLAIS',2),
    ('2eme_annee','EDU_ISLAM',2), ('2eme_annee','PHILO',2), ('2eme_annee','INFORMATIQUE',1), ('2eme_annee','EPS',1),
    ('3eme_annee','ARABE',3), ('3eme_annee','MATHS',5), ('3eme_annee','PHYSIQUE',4), ('3eme_annee','SVT',4),
    ('3eme_annee','HIST_GEO',2), ('3eme_annee','FRANCAIS',2), ('3eme_annee','ANGLAIS',2),
    ('3eme_annee','EDU_ISLAM',2), ('3eme_annee','PHILO',2), ('3eme_annee','INFORMATIQUE',1), ('3eme_annee','EPS',1)
) AS cfg(grade_code, subject_code, coefficient)
  ON cfg.grade_code = al.grade_code AND cfg.subject_code = s.code
ON CONFLICT (tenant_id, subject_id, academic_year_id, academic_level_id, direction)
DO NOTHING;

-- ----------------------------------------------------------------------------
-- §3. Data repair — backfill academic_years.code from the label (0023 never
--     set it; the domain contract + ENS-<year> codes + year pickers need it)
-- ----------------------------------------------------------------------------
UPDATE public.academic_years
SET code = label
WHERE code IS NULL
  AND label ~ '^[0-9]{4}-[0-9]{4}$';

-- ----------------------------------------------------------------------------
-- §4. v_timetable_published — the parent-portal projection (SCHED-106)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_timetable_published AS
SELECT
    e.id,
    e.tenant_id,
    e.academic_year_id,
    e.version_id,
    e.class_id,
    c.code  AS class_code,
    c.name  AS class_name,
    e.subject_id,
    s.name_fr AS subject_name_fr,
    s.name_ar AS subject_name_ar,
    e.teacher_id,
    (p.first_name || ' ' || p.last_name) AS teacher_name,
    e.room_id,
    r.name AS room_label,
    e.day,
    e.period_index,
    e.start_minutes,
    e.end_minutes,
    e.lesson_group,
    e.notes
FROM public.timetable_entries e
JOIN public.timetable_versions v
    ON v.id = e.version_id AND v.status = 'published'
JOIN public.classes c  ON c.id = e.class_id
JOIN public.subjects s ON s.id = e.subject_id
LEFT JOIN public.personnel p ON p.id = e.teacher_id
LEFT JOIN public.rooms r ON r.id = e.room_id
WHERE e.tenant_id = public.current_tenant_id();
COMMENT ON VIEW public.v_timetable_published IS
    'T-407 (SCHED-106): parent-portal projection of the ONE canonical published timetable (0109/0110). SECURITY DEFINER semantics expose ONLY published-entry name projections — parents cannot SELECT personnel/rooms directly under RLS; the view never exposes staff-only rows, drafts or trials.';

-- The view runs with definer (owner) privileges: grant SELECT to
-- authenticated tenants only — anon gets nothing.
REVOKE ALL ON public.v_timetable_published FROM anon, public;
GRANT SELECT ON public.v_timetable_published TO authenticated;
