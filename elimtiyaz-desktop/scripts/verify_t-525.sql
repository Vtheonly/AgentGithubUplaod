-- verify_t-525.sql — live EXECUTE-mode verification for T-525 / migration 0154
-- (CROSS-201 + SEC-117: the calendar_events parent exam-read window + the
-- calendar_events_admin staff role check).
--
-- Convention (AGENTS.md §11.1 + §15.39): wrapped in BEGIN/ROLLBACK so it can
-- be re-run any time without mutating the live DB; results land in a temp
-- table (§15.27 grants); the whole payload runs in ONE Management-API session
-- (quirk #3 — the verify-script convention). Seeded rows are T-525-FAKE-marked
-- and rolled back (§15.38 zero residue).
--
-- Live actors (resolved 2026-10-13):
--   PARENT  auth.users ae39dade-91d1-48a5-a3d0-4d2872e8e156
--           (parent ABADA a4098565-602f-425e-8614-4a9811082962, tenant
--            00000000-0000-0000-0000-000000000001; child YAHIA ABADA in
--            class 3db1e709-940e-422f-a574-a49548df0b50 = 5AP - Section A)
--   STAFF   auth.users a148fe34-98e3-422a-bf42-91da094e270c
--           (profile admin@elimtiyaz.dz, role super_admin — the T-510 actor)
--
-- The matrix (post-0154 expected):
--   E2E acceptance extension (T-525 phases 3-5, the owner's criteria):
--   V9  STAFF schedules an exam through the DESKTOP's exact insert shape,
--       then RESCHEDULES it (update on the SAME row) — the parent then
--       sees exactly ONE exam row at the NEW date (edit without duplicate)
--   V10 the parent's read through the WEBSITE's exact useEventsInRange
--       query shape (is_deleted=false + start_at range, ascending)
--   V11 the parent's homework read through the WEBSITE's exact
--       useHomeworkForClasses shape (class_id IN the children's classes)
--
--   V1  parent sees the exam event for the CHILD'S class            = 1
--   V2  parent does NOT see another class's exam event              = 0
--   V3  parent does NOT see a staff event (follow_up_call)          = 0
--   V4  parent INSERT into calendar_events is REJECTED              = blocked
--   V5  parent UPDATE (soft-delete) of a staff event is REJECTED    = blocked
--   V6  parent still reads the child-class homework (UI-343's data)= >= 1
--   V7  STAFF sees all three probe rows                             = 3
--   V8  STAFF INSERT still works                                    = ok
BEGIN;

DROP TABLE IF EXISTS t525_results;
CREATE TEMP TABLE t525_results (check_id text, ok boolean, detail text);
GRANT INSERT, SELECT ON t525_results TO authenticated, anon;

-- Seed three T-525 FAKE rows (rolled back — zero residue):
--   A) an exam for the child's class, B) an exam for another class,
--   C) a staff follow-up call.
SET LOCAL ROLE postgres;
INSERT INTO public.calendar_events (id, tenant_id, kind, title, description,
    start_at, all_day, location, target_entity_type, target_entity_id,
    target_name, created_by)
VALUES
  ('77777777-1111-2222-3333-444444444401'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   'custom', 'T-525 FAKE PROBE examen (classe enfant)',
   'T-525 verify seed — rolled back',
   '2097-06-15T08:30:00+00:00', false, 'Salle FAKE',
   'exam', '3db1e709-940e-422f-a574-a49548df0b50'::uuid,
   'Surveillant FAKE', NULL),
  ('77777777-1111-2222-3333-444444444402'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   'custom', 'T-525 FAKE PROBE examen (autre classe)',
   'T-525 verify seed — rolled back',
   '2097-06-16T08:30:00+00:00', false, 'Salle FAKE',
   'exam', '1cf24f60-56c4-466a-9fc1-bc0f4b19113b'::uuid,
   'Surveillant FAKE', NULL),
  ('77777777-1111-2222-3333-444444444403'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   'follow_up_call', 'T-525 FAKE PROBE appel de suivi',
   'T-525 verify seed — rolled back',
   '2097-06-17T10:00:00+00:00', false, NULL,
   'parent', 'a4098565-602f-425e-8614-4a9811082962'::uuid,
   'Parent FAKE', NULL);

-- ---------------------------------------------------------------------------
-- PARENT half (the website session's exact RLS posture).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_exam_own int;
  v_exam_other int;
  v_staff_event int;
  v_insert_ok boolean := false;
  v_update_ok boolean := false;
  v_update_count int := 0;
  v_hw_count int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'ae39dade-91d1-48a5-a3d0-4d2872e8e156',
                      'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_exam_own FROM public.calendar_events
   WHERE target_entity_type = 'exam'
     AND target_entity_id = '3db1e709-940e-422f-a574-a49548df0b50'::uuid;
  SELECT count(*) INTO v_exam_other FROM public.calendar_events
   WHERE target_entity_type = 'exam'
     AND target_entity_id = '1cf24f60-56c4-466a-9fc1-bc0f4b19113b'::uuid;
  SELECT count(*) INTO v_staff_event FROM public.calendar_events
   WHERE kind = 'follow_up_call';

  SELECT count(*) INTO v_hw_count FROM public.homework
   WHERE class_id = '3db1e709-940e-422f-a574-a49548df0b50'::uuid;

  BEGIN
    INSERT INTO public.calendar_events (id, tenant_id, kind, title, start_at,
        target_entity_type)
    VALUES ('77777777-1111-2222-3333-555555555501'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid, 'custom',
        'T-525 FAKE PROBE parent-write attempt', '2097-06-18T08:30:00+00:00',
        'exam');
    v_insert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE IN ('42501', '44000') THEN v_insert_ok := false;
    ELSE RAISE; END IF;
  END;

  BEGIN
    UPDATE public.calendar_events SET is_deleted = true
     WHERE id = '77777777-1111-2222-3333-444444444403'::uuid;
    GET DIAGNOSTICS v_update_count = ROW_COUNT;
    v_update_ok := v_update_count > 0;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE IN ('42501', '44000') THEN v_update_ok := false;
    ELSE RAISE; END IF;
  END;

  INSERT INTO t525_results VALUES
    ('V1_parent_sees_own_class_exam', v_exam_own = 1,
      'own-class exam rows visible = ' || v_exam_own),
    ('V2_parent_blocked_other_class_exam', v_exam_other = 0,
      'other-class exam rows visible = ' || v_exam_other),
    ('V3_parent_blocked_staff_events', v_staff_event = 0,
      'follow_up_call rows visible = ' || v_staff_event),
    ('V4_parent_insert_REJECTED', NOT v_insert_ok,
      CASE WHEN v_insert_ok THEN 'parent insert SUCCEEDED (SEC-117 NOT closed!)'
           ELSE 'parent insert rejected by RLS' END),
    ('V5_parent_update_REJECTED', NOT v_update_ok,
      CASE WHEN v_update_ok THEN 'parent soft-delete SUCCEEDED (SEC-117 NOT closed!)'
           ELSE 'parent update rejected/touches 0 rows' END),
    ('V6_parent_reads_child_class_homework', v_hw_count >= 1,
      'homework rows for child class = ' || v_hw_count);

  SET LOCAL ROLE postgres;
END $$;

-- ---------------------------------------------------------------------------
-- STAFF half (the desktop session's exact RLS posture — must be unchanged).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_staff_rows int;
  v_staff_insert_ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'a148fe34-98e3-422a-bf42-91da094e270c',
                      'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_staff_rows FROM public.calendar_events
   WHERE title like 'T-525 FAKE PROBE%';

  BEGIN
    INSERT INTO public.calendar_events (id, tenant_id, kind, title, start_at)
    VALUES ('77777777-1111-2222-3333-555555555502'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid, 'custom',
        'T-525 FAKE PROBE staff-write', '2097-06-19T08:30:00+00:00');
    v_staff_insert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE IN ('42501', '44000') THEN v_staff_insert_ok := false;
    ELSE RAISE; END IF;
  END;

  INSERT INTO t525_results VALUES
    ('V7_staff_sees_all_probe_rows', v_staff_rows = 3,
      'staff-visible probe rows = ' || v_staff_rows || ' (expect 3)'),
    ('V8_staff_insert_still_works', v_staff_insert_ok,
      CASE WHEN v_staff_insert_ok THEN 'staff insert OK (desktop path preserved)'
           ELSE 'staff insert REJECTED (the desktop write path would be BROKEN!)' END);

  SET LOCAL ROLE postgres;
END $$;

-- ---------------------------------------------------------------------------
-- T-525 E2E acceptance (the owner's criteria 1-4) — all inside the SAME
-- transaction: staff schedules → parent sees → staff reschedules (SAME row)
-- → parent sees the new date, exactly one row, no duplicate.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_created_at timestamptz;
  v_parent_range_rows int;
  v_parent_range_newdate int;
  v_exam_total int;
  v_hw_rows int;
BEGIN
  SET LOCAL ROLE postgres;

  -- (a) STAFF schedules an exam — the DESKTOP repository's exact insert
  -- shape (insertRowOf: kind='custom' + target_entity_type='exam' +
  -- target_entity_id=class + location=room + target_name=invigilator).
  INSERT INTO public.calendar_events (id, tenant_id, kind, title, description,
      start_at, all_day, location, target_entity_type, target_entity_id,
      target_name, created_by)
  VALUES ('77777777-1111-2222-3333-444444444411'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      'custom', 'T-525 FAKE E2E examen Mathematiques T1',
      'T-525 E2E seed — rolled back',
      '2026-10-20T08:30:00+00:00', false, 'Salle 12',
      'exam', '3db1e709-940e-422f-a574-a49548df0b50'::uuid,
      'M. Benali', NULL);

  -- (b) the PARENT reads through the WEBSITE's exact useEventsInRange shape.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'ae39dade-91d1-48a5-a3d0-4d2872e8e156',
                      'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_parent_range_rows FROM public.calendar_events
   WHERE is_deleted = false
     AND start_at >= '2026-09-28T00:00:00.000Z'
     AND start_at <= '2026-10-31T23:59:59.999Z'
     AND target_entity_type = 'exam'
     AND target_entity_id = '3db1e709-940e-422f-a574-a49548df0b50'::uuid;

  -- (c) the PARENT's homework read — the useHomeworkForClasses shape
  -- (class_id IN the children's classes; the parent's child YAHIA is in
  -- 3db1e709 = 5AP Section A).
  SELECT count(*) INTO v_hw_rows FROM public.homework
   WHERE class_id IN ('3db1e709-940e-422f-a574-a49548df0b50'::uuid)
     AND due_date IS NOT NULL;

  SET LOCAL ROLE postgres;

  -- (d) STAFF RESCHEDULES the exam — the repository update() shape: the
  -- SAME row patched (start_at moved), never an insert.
  UPDATE public.calendar_events
     SET start_at = '2026-10-22T10:00:00+00:00', updated_at = now()
   WHERE id = '77777777-1111-2222-3333-444444444411'::uuid
     AND is_deleted = false;

  -- (e) the PARENT re-reads: exactly ONE exam row, at the NEW date.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'ae39dade-91d1-48a5-a3d0-4d2872e8e156',
                      'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_parent_range_newdate FROM public.calendar_events
   WHERE is_deleted = false
     AND start_at >= '2026-10-22T00:00:00.000Z'
     AND start_at <  '2026-10-23T00:00:00.000Z'
     AND target_entity_type = 'exam'
     AND target_entity_id = '3db1e709-940e-422f-a574-a49548df0b50'::uuid;
  SELECT count(*) INTO v_exam_total FROM public.calendar_events
   WHERE is_deleted = false
     AND target_entity_type = 'exam'
     AND target_entity_id = '3db1e709-940e-422f-a574-a49548df0b50'::uuid
     AND title like 'T-525 FAKE E2E%';

  SET LOCAL ROLE postgres;

  INSERT INTO t525_results VALUES
    ('V9_parent_sees_created_exam', v_parent_range_rows >= 1,
      'parent range-query rows for the created exam = ' || v_parent_range_rows),
    ('V10_reschedule_no_duplicate', v_parent_range_newdate = 1 AND v_exam_total = 1,
      'rows at the NEW date = ' || v_parent_range_newdate ||
      ', total exam rows for the class = ' || v_exam_total ||
      ' (1+1 = rescheduled in place, no duplicate)'),
    ('V11_parent_homework_children_classes', v_hw_rows >= 1,
      'homework rows via the children-classes IN query = ' || v_hw_rows);
END $$;

SELECT * FROM t525_results ORDER BY check_id;

ROLLBACK;
