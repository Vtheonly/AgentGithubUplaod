-- ============================================================================
-- verify_t-407.sql — live verification of migration 0113 (+ the 0112 DDL
-- recovery). Run via the Supabase Management API (the inspect-live-db.sh
-- convention). Every query MUST return the expected shape/value.
-- ============================================================================

-- C1: The 14 national matières are present (tenant-scoped, identity shape).
SELECT count(*) AS identity_subjects,
       count(*) FILTER (WHERE cycle IS NULL) AS cycle_null,
       count(*) FILTER (WHERE domain = 'scolarite') AS scolarite_domain
FROM public.subjects
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND code IN ('ARABE','MATHS','FRANCAIS','ANGLAIS','TAMAZIGHT','PHYSIQUE','SVT',
               'EVEIL_SCI','HIST_GEO','EDU_ISLAM','PHILO','INFORMATIQUE','EPS',
               'EDU_ARTISTIQUE');
-- EXPECT: identity_subjects = 14, cycle_null = 14, scolarite_domain = 14

-- C2: The official BEM coefficients at 4AM (direction 'general', current year).
SELECT s.code AS subject, sc.coefficient
FROM public.subject_configurations sc
JOIN public.subjects s ON s.id = sc.subject_id
JOIN public.academic_levels al ON al.id = sc.academic_level_id
JOIN public.academic_years ay ON ay.id = sc.academic_year_id AND ay.is_current
WHERE al.grade_code = '4am' AND sc.direction = 'general'
  AND s.code IN ('ARABE','MATHS','PHYSIQUE','SVT','HIST_GEO','FRANCAIS','ANGLAIS','EDU_ISLAM')
ORDER BY s.code;
-- EXPECT 8 rows: ANGLAIS 2, ARABE 5, EDU_ISLAM 2, FRANCAIS 3, HIST_GEO 2,
--                MATHS 4, PHYSIQUE 2, SVT 2

-- C3: Configuration coverage — every configured (subject × level) pair has
--     a row on the current year.
SELECT count(*) AS config_rows,
       count(DISTINCT al.grade_code) AS levels_covered
FROM public.subject_configurations sc
JOIN public.academic_years ay ON ay.id = sc.academic_year_id AND ay.is_current
JOIN public.academic_levels al ON al.id = sc.academic_level_id
WHERE sc.direction = 'general';
-- EXPECT: config_rows = 91 (12+12+6+6+9+9+9+11+11+11+11+10+11+11), levels_covered = 14

-- C4: The academic-year code repair.
SELECT count(*) AS years_missing_code FROM public.academic_years WHERE code IS NULL;
-- EXPECT: 0

-- C5: The 0112 FK recovery — the constraints now really exist.
SELECT conname, convalidated
FROM pg_constraint
WHERE conname IN ('class_subjects_teacher_id_fkey','classes_homeroom_teacher_id_fkey');
-- EXPECT: 2 rows, both convalidated = true

-- C6: Zero orphans remain after the FK cleanup.
SELECT (SELECT count(*) FROM public.class_subjects cs
        WHERE cs.teacher_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.personnel p WHERE p.id = cs.teacher_id)) AS cs_orphans,
       (SELECT count(*) FROM public.classes cl
        WHERE cl.homeroom_teacher_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.personnel p WHERE p.id = cl.homeroom_teacher_id)) AS class_orphans;
-- EXPECT: 0, 0

-- C7: The portal view exists with the right column shape.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'v_timetable_published'
ORDER BY ordinal_position;
-- EXPECT: id, tenant_id, academic_year_id, version_id, class_id, class_code,
--         class_name, subject_id, subject_name_fr, subject_name_ar,
--         teacher_id, teacher_name, room_id, room_label, day, period_index,
--         start_minutes, end_minutes, lesson_group, notes

-- C8: The view exposes ONLY published-version entries (any state).
SELECT count(*) AS leaked_non_published
FROM public.v_timetable_published v
WHERE NOT EXISTS (SELECT 1 FROM public.timetable_versions tv
                  WHERE tv.id = v.version_id AND tv.status = 'published');
-- EXPECT: 0
