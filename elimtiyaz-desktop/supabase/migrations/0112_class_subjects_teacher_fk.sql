-- ============================================================================
-- 0112_class_subjects_teacher_fk.sql — SCHED-103 (T-404 follow-up)
-- ============================================================================
-- Closes the root cause of the live PGRST200 defect (2026-09-22, reported
-- from the running desktop app): every Emploi du temps curriculum load
-- failed with HTTP 400 —
--   {"code":"PGRST200", "details":"Searched for a foreign key relationship
--    between 'class_subjects' and 'personnel' in the schema 'public', but
--    no matches were found."}
--
-- WHY: PostgREST embedded resources (`personnel!left(first_name,last_name)`
-- in SupabaseTimetableRepository.loadProblem) resolve relationships from
-- REAL foreign key constraints. class_subjects.teacher_id has been a BARE
-- uuid since 0004 — its inline comment said "FK to personnel(id), filled in
-- 0009", but 0009 never added the constraint (it only created the personnel
-- table). The same unfilled comment exists on classes.homeroom_teacher_id.
-- Both are closed here (the same defect class; classes is included so a
-- future `classes(...personnel...)` embed cannot hit the identical 400).
--
-- The app-side mitigation (SCHED-103 fix, same date) already removed the
-- embed and derives teacher names from a separate personnel fetch — so this
-- migration is NOT required for the app to work; it restores the missing
-- referential integrity that 0004 intended, re-enables personnel embeds,
-- and guards against orphaned teacher ids.
--
-- WHAT:
--   §1  Orphan cleanup — teacher_id / homeroom_teacher_id values pointing
--       at personnel rows that do not exist are set to NULL (SET-NULL
--       semantics, matching the FK's ON DELETE). Curriculum/class rows are
--       PRESERVED (only the dangling assignment is cleared). The
--       denormalized homeroom_teacher_name (0029) is untouched.
--   §2  The two FK constraints, NOT VALID then VALIDATE (the zero-long-lock
--       pattern; both tables are small but the pattern stays correct).
--       ON DELETE SET NULL: deleting a personnel row clears their
--       assignments but never cascades away curriculum or classes.
--
-- SAFETY / GUARDS:
--   * Idempotent: ADD CONSTRAINT IF NOT EXISTS equivalents are emulated
--     (Postgres lacks ADD CONSTRAINT IF NOT EXISTS) via a DO block that
--     checks pg_constraint by name.
--   * The UPDATE is idempotent by construction.
--   * No column is added, dropped or altered; no policy touched; RLS
--     behavior unchanged (the FK only enforces what the code already
--     guards — supabase-academic-repository writes teacher_id only when
--     isUuid() passes).
--
-- POST-CONDITIONS (asserted by scripts/apply_0112_live.sh):
--   * pg_constraint contains class_subjects_teacher_id_fkey and
--     classes_homeroom_teacher_id_fkey, both convalidated = true.
--   * Zero orphaned teacher_id / homeroom_teacher_id values remain.
--   * `bash scripts/t404-postgrest-smoke.sh --expect-fk` flips P2 to 200
--     (the personnel embed resolves in the PostgREST schema cache — the
--     cache auto-reloads on DDL, no service restart needed).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. Orphan cleanup (idempotent; preserves rows, clears dangling refs)
-- ----------------------------------------------------------------------------
UPDATE public.class_subjects
SET teacher_id = NULL
WHERE teacher_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.personnel p WHERE p.id = class_subjects.teacher_id);

UPDATE public.classes
SET homeroom_teacher_id = NULL
WHERE homeroom_teacher_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.personnel p WHERE p.id = classes.homeroom_teacher_id);

-- ----------------------------------------------------------------------------
-- §2. The FK constraints (name-guarded ADD — Postgres lacks IF NOT EXISTS)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'class_subjects_teacher_id_fkey'
          AND conrelid = 'public.class_subjects'::regclass
    ) THEN
        ALTER TABLE public.class_subjects
            ADD CONSTRAINT class_subjects_teacher_id_fkey
            FOREIGN KEY (teacher_id)
            REFERENCES public.personnel(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'classes_homeroom_teacher_id_fkey'
          AND conrelid = 'public.classes'::regclass
    ) THEN
        ALTER TABLE public.classes
            ADD CONSTRAINT classes_homeroom_teacher_id_fkey
            FOREIGN KEY (homeroom_teacher_id)
            REFERENCES public.personnel(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

-- VALIDATE takes a SHARE UPDATE EXCLUSIVE lock (no ACCESS EXCLUSIVE), so
-- concurrent reads/writes continue during the scan.
ALTER TABLE public.class_subjects VALIDATE CONSTRAINT class_subjects_teacher_id_fkey;
ALTER TABLE public.classes VALIDATE CONSTRAINT classes_homeroom_teacher_id_fkey;
