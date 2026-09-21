-- verify_t-404.sql — live verification for T-404 (migration 0109, the
-- canonical Automatic Timetable backend contract: rooms,
-- timetable_configurations, timetable_constraints, timetable_versions,
-- timetable_entries, the immutability guard, the double-booking unique
-- indexes and the fn_timetable_publish RPC).
--
-- Convention (AGENTS.md §11.1): wrapped in BEGIN/ROLLBACK so it can be
-- re-run any time without mutating the live DB; results land in a temp
-- table; covers BOTH the happy paths AND the regression paths (publish
-- without approval must fail; published entries must be immutable;
-- teacher/room double-booking must be impossible; parent accounts must
-- see ONLY published entries).
--
-- Live fixtures referenced (resolved 2026-09-22, zero-business-data clone):
--   TENANT   00000000-0000-0000-0000-000000000001
--   YEAR     e90b43f6-17d7-47f6-bd80-25a93b553d8a (the only academic year)
--   LEVEL    2813607f-0b3b-4f7a-8d23-aeaaf8f9dcce (1 of the 14 seeded levels)
--   TEACHER  b35aa06f-3471-422f-a482-dbbac6343c0f (1 of the 5 personnel rows)
--   STAFF    auth sub a148fe34-98e3-422a-bf42-91da094e270c (admin@elimtiyaz.dz,
--            profile 42e369e9-9f88-40a0-8434-ffd3b2c3ba8b, super_admin — resolved
--            live 2026-09-22; the t-214 actor 0a3597e7… is an OLD-project id
--            that does NOT exist on this clone)
--
-- Everything else (class, subject, class_subject, versions, entries,
-- rooms) is SEEDED with fixed synthetic UUIDs inside the transaction and
-- rolled back — zero residue on the live business data (OPS-319 rule: no
-- destructive surface against real rows).
BEGIN;

DROP TABLE IF EXISTS t404_results;
CREATE TEMP TABLE t404_results (check_id text, ok boolean, detail text);
GRANT INSERT, SELECT ON t404_results TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- C1: registration + chain (0109 applied + registered, chain = 109)
-- ----------------------------------------------------------------------------
INSERT INTO t404_results
SELECT 'C1-registered', COUNT(*) = 1, 'rows=' || COUNT(*)
  FROM supabase_migrations.schema_migrations WHERE version = '0109';
INSERT INTO t404_results
SELECT 'C1-chain-head-0110',
       (SELECT MAX(version) FROM supabase_migrations.schema_migrations) = '0110',
       'chain=' || (SELECT COUNT(*) FROM supabase_migrations.schema_migrations)
           || ' head=' || (SELECT MAX(version) FROM supabase_migrations.schema_migrations);

-- ----------------------------------------------------------------------------
-- C2: the five tables exist with RLS enabled
-- ----------------------------------------------------------------------------
INSERT INTO t404_results
SELECT 'C2-tables-rls',
       COUNT(*) = 5 AND bool_and(rowsecurity),
       'tables=' || string_agg(tablename, ',' order by tablename)
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('rooms','timetable_configurations','timetable_constraints',
                     'timetable_versions','timetable_entries');

-- ----------------------------------------------------------------------------
-- C3: class_subjects curriculum extension (§6)
-- ----------------------------------------------------------------------------
INSERT INTO t404_results
SELECT 'C3-class-subjects-cols', COUNT(*) = 2, 'cols=' || COUNT(*)
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'class_subjects'
  AND column_name IN ('consecutive_periods','required_room_type');

-- ----------------------------------------------------------------------------
-- C4: the integrity indexes (SCHED-101 closed at the storage layer)
-- ----------------------------------------------------------------------------
INSERT INTO t404_results
SELECT 'C4-uidx-teacher', COUNT(*) = 1, 'idx=' || COUNT(*)
FROM pg_indexes WHERE schemaname='public' AND tablename='timetable_entries'
  AND indexname = 'timetable_entries_teacher_slot_uidx';
INSERT INTO t404_results
SELECT 'C4-uidx-room', COUNT(*) = 1, 'idx=' || COUNT(*)
FROM pg_indexes WHERE schemaname='public' AND tablename='timetable_entries'
  AND indexname = 'timetable_entries_room_slot_uidx';
INSERT INTO t404_results
SELECT 'C4-uidx-one-published', COUNT(*) = 1, 'idx=' || COUNT(*)
FROM pg_indexes WHERE schemaname='public' AND tablename='timetable_versions'
  AND indexname = 'timetable_versions_one_published';

-- ----------------------------------------------------------------------------
-- C5: RLS policy shapes (staff write, staff+teacher read, published-only
--     for everyone else). Quote-free position() probes only (the §11.1
--     quirk #9 rule — no '' escapes in top-level SQL).
-- ----------------------------------------------------------------------------
INSERT INTO t404_results
SELECT 'C5-entries-select-policy',
       position('super_admin' in qual) > 0
       AND position('teacher' in qual) > 0
       AND position('published' in qual) > 0
       AND position('current_tenant_id' in qual) > 0,
       'qual_chars=' || length(qual)
FROM pg_policies
WHERE schemaname='public' AND tablename='timetable_entries'
  AND policyname='timetable_entries_select';
INSERT INTO t404_results
SELECT 'C5-versions-select-policy',
       position('super_admin' in qual) > 0
       AND position('published' in qual) > 0
       AND position('current_tenant_id' in qual) > 0,
       'qual_chars=' || length(qual)
FROM pg_policies
WHERE schemaname='public' AND tablename='timetable_versions'
  AND policyname='timetable_versions_select';
INSERT INTO t404_results
SELECT 'C5-entries-write-policy',
       with_check IS NOT NULL AND position('super_admin' in with_check) > 0,
       'with_check_chars=' || length(coalesce(with_check,''))
FROM pg_policies
WHERE schemaname='public' AND tablename='timetable_entries'
  AND policyname='timetable_entries_staff_write';

-- ----------------------------------------------------------------------------
-- C6: the Algerian profile is seeded as DATA for the live tenant+year
-- ----------------------------------------------------------------------------
INSERT INTO t404_results
SELECT 'C6-algerian-profile-seeded', COUNT(*) = 1 AND bool_and(ok_day),
       'configs=' || COUNT(*) || ' days=' || min(school_days::text)
FROM (
    SELECT cardinality(school_days) = 5 AS ok_day, school_days
    FROM public.timetable_configurations
    WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
      AND academic_year_id = 'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid
      AND label = 'Profil algérien standard'
      AND cardinality(school_days) = 5
      AND 'sunday' = school_days[1] AND 'thursday' = school_days[5]
    GROUP BY school_days
) s;

-- ----------------------------------------------------------------------------
-- Seed the synthetic fixture (rolled back — zero residue).
-- Fixed UUIDs: class 404...c1, subject 404...a1, room 404...b1/b2,
-- versions 404...d1/d2, entries 404...e1/e2.
-- ----------------------------------------------------------------------------
SET LOCAL ROLE postgres;

INSERT INTO public.classes (id, tenant_id, academic_year_id, academic_level_id,
                            section, code, name, capacity, is_active)
VALUES ('00000000-0000-0404-0000-0000000000c1'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid,
        '2813607f-0b3b-4f7a-8d23-aeaaf8f9dcce'::uuid,
        'A', 'T404-CLS-A', 'T404 Classe Test A', 30, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.subjects (id, tenant_id, code, name_fr, domain,
                             default_coefficient, is_active)
VALUES ('00000000-0000-0404-0000-0000000000a1'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'T404-MATH', 'T404 Mathématiques', 'scolarite', 1, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.class_subjects (tenant_id, class_id, subject_id, teacher_id,
                                   coefficient, is_active, weekly_hours,
                                   consecutive_periods, required_room_type)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0404-0000-0000000000c1'::uuid,
        '00000000-0000-0404-0000-0000000000a1'::uuid,
        'b35aa06f-3471-422f-a482-dbbac6343c0f'::uuid,
        1, true, 4, 1, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO public.rooms (id, tenant_id, code, name, room_type, capacity, is_active)
VALUES ('00000000-0000-0404-0000-0000000000b1'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'T404-SAL-01', 'T404 Salle 01', 'classroom', 30, true),
       ('00000000-0000-0404-0000-0000000000b2'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'T404-LAB-01', 'T404 Labo', 'science_lab', 24, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.timetable_versions (id, tenant_id, academic_year_id,
                                       version_number, status, solver_id,
                                       created_by, created_by_name)
VALUES ('00000000-0000-0404-0000-0000000000d1'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid,
        1, 'draft', 'ts-greedy-v1', NULL, 'T404 verify'),
       ('00000000-0000-0404-0000-0000000000d2'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid,
        2, 'approved', 'ts-greedy-v1', NULL, 'T404 verify')
ON CONFLICT DO NOTHING;

INSERT INTO public.timetable_entries (id, tenant_id, academic_year_id, version_id,
                                      class_id, subject_id, teacher_id, room_id,
                                      day, period_index, start_minutes, end_minutes)
VALUES ('00000000-0000-0404-0000-0000000000e1'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid,
        '00000000-0000-0404-0000-0000000000d2'::uuid,
        '00000000-0000-0404-0000-0000000000c1'::uuid,
        '00000000-0000-0404-0000-0000000000a1'::uuid,
        'b35aa06f-3471-422f-a482-dbbac6343c0f'::uuid,
        '00000000-0000-0404-0000-0000000000b1'::uuid,
        'sunday', 1, 480, 540),
       ('00000000-0000-0404-0000-0000000000e2'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid,
        '00000000-0000-0404-0000-0000000000d1'::uuid,
        '00000000-0000-0404-0000-0000000000c1'::uuid,
        '00000000-0000-0404-0000-0000000000a1'::uuid,
        'b35aa06f-3471-422f-a482-dbbac6343c0f'::uuid,
        '00000000-0000-0404-0000-0000000000b1'::uuid,
        'sunday', 2, 540, 600)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- C7: publish behavior matrix (happy + regression paths). The RPC resolves
--     the caller through request.jwt.claims — set the STAFF JWT (super_admin
--     admin@elimtiyaz.dz, profile 42e369e9…, resolved live 2026-09-22) before every call. Runs as
--     postgres so the surrounding fixture UPDATEs bypass RLS.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_res jsonb;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "a148fe34-98e3-422a-bf42-91da094e270c", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);

    -- C7a: publishing a DRAFT must fail (review → approve → publish order).
    SELECT public.fn_timetable_publish('00000000-0000-0404-0000-0000000000d1'::uuid) INTO v_res;
    INSERT INTO t404_results VALUES ('C7a-draft-publish-rejected',
        (v_res->>'ok')::boolean = false AND (v_res->>'reason') = 'invalid_status',
        'reason=' || (v_res->>'reason'));

    -- C7b: publishing the APPROVED version must succeed.
    SELECT public.fn_timetable_publish('00000000-0000-0404-0000-0000000000d2'::uuid) INTO v_res;
    INSERT INTO t404_results VALUES ('C7b-approved-publish-ok',
        (v_res->>'ok')::boolean = true,
        'res=' || v_res::text);

    -- C7c: the version row is now published with stamps.
    INSERT INTO t404_results
    SELECT 'C7c-status-published',
           status = 'published' AND published_at IS NOT NULL,
           'status=' || status
    FROM public.timetable_versions
    WHERE id = '00000000-0000-0404-0000-0000000000d2'::uuid;

    -- C7d: re-publishing the SAME version (already published) must fail
    --      (status no longer approved).
    SELECT public.fn_timetable_publish('00000000-0000-0404-0000-0000000000d2'::uuid) INTO v_res;
    INSERT INTO t404_results VALUES ('C7d-republish-rejected',
        (v_res->>'ok')::boolean = false,
        'reason=' || (v_res->>'reason'));

    -- C7e: publishing a SECOND approved version archives the first
    --      (the atomic swap behind the one-published partial index).
    UPDATE public.timetable_versions
    SET status = 'approved'
    WHERE id = '00000000-0000-0404-0000-0000000000d1'::uuid;
    SELECT public.fn_timetable_publish('00000000-0000-0404-0000-0000000000d1'::uuid) INTO v_res;
    INSERT INTO t404_results
    SELECT 'C7e-atomic-swap',
           (v_res->>'ok')::boolean = true
           AND (v_res->>'archivedVersionId') = '00000000-0000-0404-0000-0000000000d2',
           'archived=' || (v_res->>'archivedVersionId');
END $$;

-- ----------------------------------------------------------------------------
-- C8: published entries are IMMUTABLE (the §5c trigger) — insert and
--     delete on a published version must raise P0001.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_raised boolean := false;
BEGIN
    BEGIN
        INSERT INTO public.timetable_entries (tenant_id, academic_year_id, version_id,
            class_id, subject_id, teacher_id, room_id, day, period_index,
            start_minutes, end_minutes)
        VALUES ('00000000-0000-0000-0000-000000000001'::uuid,
                'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid,
                '00000000-0000-0404-0000-0000000000d1'::uuid,  -- published in C7e
                '00000000-0000-0404-0000-0000000000c1'::uuid,
                '00000000-0000-0404-0000-0000000000a1'::uuid,
                NULL, NULL, 'monday', 1, 480, 540);
    EXCEPTION WHEN OTHERS THEN
        v_raised := (SQLERRM LIKE 'timetable_entries is immutable%');
    END;
    INSERT INTO t404_results VALUES ('C8a-insert-published-blocked', v_raised,
        'raised=' || v_raised);
END $$;

DO $$
DECLARE
    v_raised boolean := false;
BEGIN
    BEGIN
        DELETE FROM public.timetable_entries
        WHERE id = '00000000-0000-0404-0000-0000000000e1'::uuid;  -- v2 published in C7b
    EXCEPTION WHEN OTHERS THEN
        v_raised := (SQLERRM LIKE 'timetable_entries is immutable%');
    END;
    INSERT INTO t404_results VALUES ('C8b-delete-published-blocked', v_raised,
        'raised=' || v_raised);
END $$;

-- ----------------------------------------------------------------------------
-- C9: teacher/room double-booking is impossible (§5b unique indexes) —
--     same version, same teacher, same day+period, different class.
-- ----------------------------------------------------------------------------
SET LOCAL ROLE postgres;
INSERT INTO public.classes (id, tenant_id, academic_year_id, academic_level_id,
                            section, code, name, capacity, is_active)
VALUES ('00000000-0000-0404-0000-0000000000c2'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid,
        '2813607f-0b3b-4f7a-8d23-aeaaf8f9dcce'::uuid,
        'B', 'T404-CLS-B', 'T404 Classe Test B', 30, true)
ON CONFLICT DO NOTHING;

UPDATE public.timetable_versions SET status = 'draft'
WHERE id = '00000000-0000-0404-0000-0000000000d2'::uuid;

DO $$
DECLARE
    v_teacher_clash boolean := false;
    v_room_clash boolean := false;
BEGIN
    BEGIN
        INSERT INTO public.timetable_entries (tenant_id, academic_year_id, version_id,
            class_id, subject_id, teacher_id, room_id, day, period_index,
            start_minutes, end_minutes)
        VALUES ('00000000-0000-0000-0000-000000000001'::uuid,
                'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid,
                '00000000-0000-0404-0000-0000000000d2'::uuid,  -- draft now
                '00000000-0000-0404-0000-0000000000c2'::uuid,  -- different class
                '00000000-0000-0404-0000-0000000000a1'::uuid,
                'b35aa06f-3471-422f-a482-dbbac6343c0f'::uuid,  -- SAME teacher as e1
                NULL, 'sunday', 1, 480, 540);
    EXCEPTION WHEN unique_violation THEN
        v_teacher_clash := true;
    END;
    INSERT INTO t404_results VALUES ('C9a-teacher-double-booking-blocked',
        v_teacher_clash, 'raised=' || v_teacher_clash);

    BEGIN
        INSERT INTO public.timetable_entries (tenant_id, academic_year_id, version_id,
            class_id, subject_id, teacher_id, room_id, day, period_index,
            start_minutes, end_minutes)
        VALUES ('00000000-0000-0000-0000-000000000001'::uuid,
                'e90b43f6-17d7-47f6-bd80-25a93b553d8a'::uuid,
                '00000000-0000-0404-0000-0000000000d2'::uuid,
                '00000000-0000-0404-0000-0000000000c2'::uuid,
                '00000000-0000-0404-0000-0000000000a1'::uuid,
                NULL,
                '00000000-0000-0404-0000-0000000000b1'::uuid,  -- SAME room as e1
                'sunday', 1, 480, 540);
    EXCEPTION WHEN unique_violation THEN
        v_room_clash := true;
    END;
    INSERT INTO t404_results VALUES ('C9b-room-double-booking-blocked',
        v_room_clash, 'raised=' || v_room_clash);
END $$;

-- ----------------------------------------------------------------------------
-- C10: RLS impersonation — the super_admin staff JWT sees the draft
--      version rows; an unbound authenticated account (no profile) sees
--      nothing; a parent-role account sees ONLY published entries.
--      (Staff sub 0a3597e7-9681-48b1-bd32-0360c7981d1e — the t-214 actor.)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_staff_versions int;
    v_staff_entries int;
    v_unbound_versions int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "a148fe34-98e3-422a-bf42-91da094e270c", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    SELECT COUNT(*) INTO v_staff_versions FROM public.timetable_versions;
    SELECT COUNT(*) INTO v_staff_entries FROM public.timetable_entries;
    INSERT INTO t404_results VALUES ('C10a-staff-sees-all-versions',
        v_staff_versions >= 2, 'versions=' || v_staff_versions);
    INSERT INTO t404_results VALUES ('C10b-staff-sees-entries',
        v_staff_entries >= 1, 'entries=' || v_staff_entries);
END $$;

DO $$
DECLARE
    v_unbound int;
    v_unpublished int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "00000000-0000-0000-0000-000000000099", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    -- After 0110: a role-less tenant-authenticated account sees ONLY the
    -- published version rows (staff visibility requires staff roles).
    SELECT COUNT(*) INTO v_unbound FROM public.timetable_versions;
    SELECT COUNT(*) INTO v_unpublished FROM public.timetable_versions
    WHERE status <> 'published';
    INSERT INTO t404_results VALUES ('C10c-unbound-sees-published-only',
        v_unbound >= 1 AND v_unpublished = 0,
        'visible=' || v_unbound || ' unpublished=' || v_unpublished);
END $$;

-- Parent-role account: entries of the PUBLISHED version only (v1 is
-- published after C7e and carries e2; v2 is back to draft in C9 and
-- carries e1 → invisible to non-staff).
DO $$
DECLARE
    v_parent_entries int;
    v_parent_draft_entries int;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "00000000-0000-0000-0000-000000000098", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001", "user_role": "parent"}}',
        true);
    SET LOCAL ROLE authenticated;
    -- No role_assignments for this sub: has_any_role is false for every
    -- role list, so visibility comes exclusively from the published-version
    -- EXISTS branch of timetable_entries_select (the parent surface).
    SELECT COUNT(*) INTO v_parent_entries FROM public.timetable_entries
    WHERE version_id = '00000000-0000-0404-0000-0000000000d1'::uuid;
    SELECT COUNT(*) INTO v_parent_draft_entries FROM public.timetable_entries
    WHERE version_id = '00000000-0000-0404-0000-0000000000d2'::uuid;
    INSERT INTO t404_results VALUES ('C10d-parent-sees-published-only',
        v_parent_draft_entries = 0 AND v_parent_entries >= 1,
        'draft_visible=' || v_parent_draft_entries || ' published_visible=' || v_parent_entries);
END $$;

-- ----------------------------------------------------------------------------
-- C11: the publish RPC fails closed for a teacher-role caller (synthetic
--      profile + teacher role_assignment, rolled back). Role ids are the
--      chain-seeded fixed uuids (0003): teacher = ...103.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_res jsonb;
BEGIN
    SET LOCAL ROLE postgres;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
    INSERT INTO public.user_profiles (id, auth_user_id, tenant_id, email,
                                      display_name, status)
    VALUES ('00000000-0000-0404-0000-000000000097'::uuid,
            '00000000-0000-0000-0000-000000000097'::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid,
            't404-teacher@verify.local', 'T404 Teacher Probe', 'active')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.role_assignments (user_profile_id, tenant_id, role_id)
    VALUES ('00000000-0000-0404-0000-000000000097'::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid,
            '00000000-0000-0000-0000-000000000103'::uuid)  -- teacher
    ON CONFLICT DO NOTHING;

    -- The teacher CAN read versions (read policy includes teacher) …
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "00000000-0000-0000-0000-000000000097", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    INSERT INTO t404_results
    SELECT 'C11a-teacher-reads-versions', COUNT(*) >= 2, 'versions=' || COUNT(*)
    FROM public.timetable_versions;

    -- … but the publish RPC must reject the teacher (forbidden).
    SELECT public.fn_timetable_publish('00000000-0000-0404-0000-0000000000d2'::uuid) INTO v_res;
    INSERT INTO t404_results VALUES ('C11b-teacher-publish-forbidden',
        (v_res->>'ok')::boolean = false AND (v_res->>'reason') = 'forbidden',
        'reason=' || (v_res->>'reason'));
END $$;

-- ----------------------------------------------------------------------------
-- C12: an unbound authenticated caller (JWT tenant but NO profile) gets
--      no_tenant-independent fail-closed behavior on publish: the RPC
--      resolves the tenant from the JWT fallback but has_any_role is
--      false (no role assignments) → forbidden.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_res jsonb;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims',
        '{"sub": "00000000-0000-0000-0000-000000000096", "role": "authenticated", "app_metadata": {"tenant_id": "00000000-0000-0000-0000-000000000001"}}',
        true);
    SET LOCAL ROLE authenticated;
    SELECT public.fn_timetable_publish('00000000-0000-0404-0000-0000000000d2'::uuid) INTO v_res;
    INSERT INTO t404_results VALUES ('C12-no-role-publish-forbidden',
        (v_res->>'ok')::boolean = false AND (v_res->>'reason') = 'forbidden',
        'reason=' || (v_res->>'reason'));
END $$;

-- ----------------------------------------------------------------------------
-- Results
-- ----------------------------------------------------------------------------
SELECT * FROM t404_results ORDER BY check_id;
ROLLBACK;
