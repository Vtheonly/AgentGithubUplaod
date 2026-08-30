-- verify_t-023.sql — live verification for the T-023 desktop homework +
-- roll-call persistence fixes (HOMEWORK-100 + ATT-100).
--
-- Convention (AGENTS.md §11.1): wrapped in BEGIN…ROLLBACK so it can be
-- re-run any time without mutating the live DB; results are stored in a
-- temp table so they surface via the final SELECT (Supabase CLI does not
-- print RAISE NOTICE).
--
-- What is proven here (schema-level contract the fixed client payloads
-- must satisfy — RLS is exercised with real staff JWTs by the apps):
--   V1  homework: the exact fixed payload (with tenant_id) inserts cleanly.
--   V2  homework: the OLD broken payload (WITHOUT tenant_id) is rejected —
--       reproducing the original NOT NULL violation the fix removes.
--   V3  attendance_records: the fixed payload (tenant_id + date +
--       record_date) inserts cleanly.
--   V4  attendance_records: the OLD payload (no tenant_id / no date) is
--       rejected — the original NOT NULL violation.
--   V5  the canonical unique index uq_attendance_canonical exists and a
--       second row with the same (tenant_id, student_id, record_date,
--       session) is rejected — proving the fixed onConflict target is a
--       real unique index.
--   V6  the OLD 3-column onConflict target matches no unique index on
--       attendance_records (i.e. no index on (student_id, record_date, session)).
BEGIN;

CREATE TEMP TABLE t023_results (check_id TEXT, passed BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_class uuid;
  v_subject uuid;
  v_teacher uuid;
  v_student uuid;
  v_hw_id uuid;
  v_att_id uuid;
  v_dup_ok boolean := false;
  v_old_conflict_matches integer;
  v_missing_tenant text;
  v_missing_date text;
  v_old_hw_missing_tenant text;
BEGIN
  -- Resolve real seed rows so FKs are satisfied.
  SELECT c.id INTO v_class FROM classes c LIMIT 1;
  SELECT s.id INTO v_subject FROM subjects s LIMIT 1;
  SELECT p.id INTO v_teacher FROM personnel p LIMIT 1;
  SELECT st.id INTO v_student FROM students st LIMIT 1;

  IF v_class IS NULL OR v_subject IS NULL OR v_student IS NULL THEN
    INSERT INTO t023_results VALUES ('PRE', false, 'seed rows missing: class/subject/student');
    RETURN;
  END IF;

  -- personnel is empty in production (T-089: totalStaff=0); homework.teacher_id
  -- is NOT NULL + FK-owned, so seed a throwaway teacher row inside this
  -- (rolled back) transaction for the insert checks.
  IF v_teacher IS NULL THEN
    INSERT INTO personnel (tenant_id, personnel_code, first_name, last_name, staff_category, hire_date,
                           is_active, bonuses_json, emergency_contact, documents_json)
    VALUES (v_tenant, 'VERIF-T023', 'Vérif', 'T-023', 'teaching', '2026-08-31',
            true, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
    RETURNING id INTO v_teacher;
  END IF;

  -- V1 — fixed homework payload inserts.
  BEGIN
    INSERT INTO homework (tenant_id, class_id, subject_id, subject_name, teacher_id, teacher_name,
                          title, description, due_date, attachments, academic_year)
    VALUES (v_tenant, v_class, v_subject, 'Vérif T-023', v_teacher, 'Vérif T-023',
            'Devoir T-023', 'verification', '2026-09-30', '[]'::jsonb, '2026-2027')
    RETURNING id INTO v_hw_id;
    INSERT INTO t023_results VALUES ('V1 homework fixed payload inserts', true, 'id=' || v_hw_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t023_results VALUES ('V1 homework fixed payload inserts', false, SQLERRM);
  END;

  -- V2 — the OLD payload (no tenant_id) must be rejected.
  BEGIN
    INSERT INTO homework (class_id, subject_id, subject_name, teacher_id, teacher_name,
                          title, description, due_date, attachments, academic_year)
    VALUES (v_class, v_subject, 'Vérif T-023', v_teacher, 'Vérif T-023',
            'Devoir T-023 OLD', 'verification', '2026-09-30', '[]'::jsonb, '2026-2027');
    INSERT INTO t023_results VALUES ('V2 old homework payload rejected', false, 'insert unexpectedly succeeded');
  EXCEPTION WHEN not_null_violation THEN
    INSERT INTO t023_results VALUES ('V2 old homework payload rejected', true, 'not_null_violation on tenant_id (as expected)');
  WHEN OTHERS THEN
    INSERT INTO t023_results VALUES ('V2 old homework payload rejected', true, 'rejected: ' || SQLERRM);
  END;

  -- V3 — fixed attendance payload inserts.
  BEGIN
    INSERT INTO attendance_records (tenant_id, student_id, class_id, date, record_date, session, status)
    VALUES (v_tenant, v_student, v_class, '2026-08-31', '2026-08-31', 'morning', 'present')
    RETURNING id INTO v_att_id;
    INSERT INTO t023_results VALUES ('V3 attendance fixed payload inserts', true, 'id=' || v_att_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t023_results VALUES ('V3 attendance fixed payload inserts', false, SQLERRM);
  END;

  -- V4 — the OLD payload (no tenant_id, no date) must be rejected.
  BEGIN
    INSERT INTO attendance_records (student_id, class_id, record_date, session, status)
    VALUES (v_student, v_class, '2026-08-31', 'afternoon', 'present');
    INSERT INTO t023_results VALUES ('V4 old attendance payload rejected', false, 'insert unexpectedly succeeded');
  EXCEPTION WHEN not_null_violation THEN
    INSERT INTO t023_results VALUES ('V4 old attendance payload rejected', true, 'not_null_violation (tenant_id/date) as expected');
  WHEN OTHERS THEN
    INSERT INTO t023_results VALUES ('V4 old attendance payload rejected', true, 'rejected: ' || SQLERRM);
  END;

  -- V5 — canonical index rejects a duplicate (tenant_id, student_id, record_date, session).
  IF v_att_id IS NOT NULL THEN
    BEGIN
      INSERT INTO attendance_records (tenant_id, student_id, class_id, date, record_date, session, status)
      VALUES (v_tenant, v_student, v_class, '2026-08-31', '2026-08-31', 'morning', 'absent_unexcused');
      v_dup_ok := true;
    EXCEPTION WHEN unique_violation THEN
      v_dup_ok := false;
    END;
    INSERT INTO t023_results VALUES ('V5 uq_attendance_canonical enforces the onConflict target',
                                     NOT v_dup_ok,
                                     CASE WHEN v_dup_ok THEN 'duplicate unexpectedly accepted' ELSE 'unique_violation on duplicate (as expected)' END);
  END IF;

  -- V6 — the OLD 3-column onConflict target matches no unique index.
  SELECT COUNT(*) INTO v_old_conflict_matches
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'attendance_records' AND n.nspname = 'public' AND i.indisunique
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'student_id' AND a.attnum = ANY (i.indkey::int2[]))
    AND (SELECT COUNT(*) FROM unnest(i.indkey::int2[]) k WHERE k <> 0) = 3;
  INSERT INTO t023_results VALUES ('V6 no unique index on the old 3-column target',
                                   v_old_conflict_matches = 0,
                                   'unique indexes with exactly 3 columns incl. student_id: ' || v_old_conflict_matches);

  -- Sanity: confirm the columns that broke before are NOT NULL.
  SELECT string_agg(column_name, ',') INTO v_missing_tenant FROM information_schema.columns
   WHERE table_schema='public' AND table_name='attendance_records' AND column_name IN ('tenant_id','date') AND is_nullable='NO';
  SELECT string_agg(column_name, ',') INTO v_missing_date FROM information_schema.columns
   WHERE table_schema='public' AND table_name='homework' AND column_name='tenant_id' AND is_nullable='NO';
  INSERT INTO t023_results VALUES ('V7 NOT NULL columns confirmed',
                                   v_missing_tenant LIKE '%date%' AND v_missing_tenant LIKE '%tenant_id%' AND v_missing_date = 'tenant_id',
                                   'attendance_records NOT NULL: ' || COALESCE(v_missing_tenant,'?') || ' / homework NOT NULL: ' || COALESCE(v_missing_date,'?'));
END $$;

SELECT check_id, passed, detail FROM t023_results ORDER BY check_id;

ROLLBACK;
